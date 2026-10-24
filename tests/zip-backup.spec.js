const { readFile, writeFile, mkdir } = require('node:fs/promises');
const { dirname } = require('node:path');
const { randomFillSync } = require('node:crypto');
const { PNG } = require('pngjs');
const { zipSync, unzipSync, strToU8 } = require('fflate');
const { test, expect, openHome, importPayload, records, createDocument, addShape, exportedDocument, openLibraryDocument } = require('./helpers');
const archive = require('./fixtures/project-with-folders.json');
const linked = require('./fixtures/linked-document.json');
const catalog = require('./fixtures/shape-catalog-expected.json');
const model = () => import('../src/backup/archive.mjs');
async function all(page) { const out = {}; for (const name of ['projects', 'docs', 'fonts', 'settings']) out[name] = await records(page, name); return out; }
async function dataPane(page) { await page.locator('#documentTabsHome').click(); await page.locator('[data-home-nav=data]').click(); }
async function createZIP(page, ids = null) {
  await dataPane(page); await page.locator('#zipCreate').click(); await expect(page.locator('#zipConfirm')).toBeEnabled();
  if (ids) { await page.locator('[name=zipScope][value=selected]').check(); for (const box of await page.locator('[data-zip-project]').all()) await box.setChecked(ids.includes(await box.getAttribute('data-zip-project'))); }
  const pending = page.waitForEvent('download'); await page.locator('#zipConfirm').click(); const download = await pending;
  const bytes = await readFile(await download.path()); await expect(page.locator('#zipStatus')).toContainText('передан браузеру');
  await page.locator('#zipCancel').click(); return bytes;
}
async function settled(page) { await dataPane(page); await page.locator('#zipCreate').click(); await expect(page.locator('#zipConfirm')).toBeEnabled(); await page.locator('#zipCancel').click(); }
async function preview(page, bytes) {
  if (bytes.length > 50 * 1024 * 1024) { const path = test.info().outputPath('large-input.zip'); await mkdir(dirname(path), {recursive:true}); await writeFile(path, bytes); await page.locator('#zipInput').setInputFiles(path); }
  else await page.locator('#zipInput').setInputFiles({ name: 'copy.zip', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
  await expect(page.locator('#zipBackupDialog')).toBeVisible();
}
async function rich(page) {
  const payload = structuredClone(archive); payload.project.name = 'ZIP rich'; payload.project.extra = { future: ['keep'] }; payload.project.cover = payload.project.resources[0].src;
  payload.project.resourceFolders.push({ id: 'nested', parentId: 'folder-original', name: 'Nested' }); payload.project.resources[0].folderId = 'nested';
  payload.documents = [{ ...structuredClone(linked.document), id: 'zip-doc', projectId: payload.project.id, extra: { future: 'doc' } }];
  payload.documents[0].elements[0].layerMaskSrc = payload.project.cover;
  payload.documents[0].elements.push({ ...structuredClone(payload.documents[0].elements[0]), id: 'embedded', type: 'image', imageSrc: payload.project.cover, fillType: 'image' });
  payload.shapeCatalog = catalog.sections || catalog;
  payload.fonts = [{ id: 'font', name: 'ZIP Font', family: 'ZIP Font', weight: 400, style: 'normal', future: 'font', data: 'data:font/ttf;base64,' + (await readFile(require.resolve('./fixtures/fonts/DejaVuSans.ttf'))).toString('base64') }];
  await importPayload(page, payload);
  let p; await expect.poll(async () => { p = (await records(page, 'projects')).find(p => p.name === 'ZIP rich (импорт)'); return !!p; }).toBe(true);
  return { p, payload };
}
async function fault(page) {
  await page.addInitScript(() => {
    window.zipFault = { failRead: false, abortRestore: false, holdDocs: false, release: [], reads: 0, restores: 0, commits: 0 };
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, ...args) {
      if (zipFault.failRead && mode === 'readonly' && Array.isArray(stores) && stores.length === 4) throw new DOMException('Snapshot refused', 'InvalidStateError');
      const t = transaction.call(this, stores, mode, ...args);
      if (Array.isArray(stores) && stores.length === 4 && mode === 'readonly') { zipFault.reads++; t.addEventListener('complete', () => { zipFault.commits++; }); }
      return t;
    };
    for (const method of ['add', 'put']) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (...args) {
        const r = original.apply(this, args), store = this, t = this.transaction;
        if (zipFault.abortRestore && t.mode === 'readwrite' && t.objectStoreNames.contains('projects') && t.objectStoreNames.contains('docs')) {
          r.addEventListener('success', () => { zipFault.restores++; if (zipFault.restores === 1) t.abort(); });
        }
        if (zipFault.holdDocs && store.name === 'docs' && t.mode === 'readwrite') r.addEventListener('success', () => {
          if (!zipFault.holdDocs) return;
          let ready = false; zipFault.release.push(() => { ready = true; });
          const pump = () => { if (!ready) store.count().addEventListener('success', pump); }; pump();
        });
        return r;
      };
    }
  });
}

test('full workspace: preview, cancel, rich data and globals, repeated restore, reopen', async ({ page }) => {
  await openHome(page); const { p, payload } = await rich(page); const before = await all(page);
  const bytes = await createZIP(page); const parsed = await (await model()).readBackup(bytes);
  expect(parsed.manifest.scope).toBe('workspace'); expect(parsed.data.projects.length).toBe(2); expect(parsed.data.docs).toEqual((await all(page)).docs); expect(parsed.data.fonts).toEqual(before.fonts); expect(parsed.data.settings).toEqual(before.settings);
  await preview(page, bytes); await expect(page.locator('#zipConfirm')).toBeEnabled(); await expect(page.locator('#zipBody')).toContainText('папок'); expect((await all(page)).projects).toEqual(before.projects);
  await page.locator('#zipCancel').click(); expect((await all(page)).projects).toEqual(before.projects);
  for (let n = 1; n <= 2; n++) {
    await preview(page, bytes); await expect(page.locator('#zipConfirm')).toBeEnabled(); await page.locator('#zipConfirm').click(); await expect(page.locator('#zipStatus')).toContainText('Транзакция завершена'); await page.locator('#zipCancel').click();
    const after = await all(page); expect(after.projects).toHaveLength(before.projects.length + n * before.projects.length); expect(after.docs).toHaveLength(before.docs.length + n * before.docs.length);
    expect(after.projects).toEqual(expect.arrayContaining(before.projects)); expect(after.fonts).toEqual(before.fonts); expect(after.settings).toEqual(before.settings);
    const restored = after.projects.filter(x => x.id !== p.id && x.name.startsWith(p.name)); expect(restored).toHaveLength(n);
    for (const copy of restored) {
      for (const field of ['resources', 'resourceFolders', 'cover', 'extra']) expect(copy[field]).toEqual(p[field]);
      const doc = after.docs.find(d => d.projectId === copy.id); expect(doc.id).not.toBe('zip-doc'); expect(doc.elements).toEqual(payload.documents[0].elements); expect(doc.extra).toEqual(payload.documents[0].extra);
    }
  }
  const saved = await all(page); await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible(); expect(await all(page)).toEqual(saved);
});
for (const count of [1, 2]) test(`selection: ${count} projects, including an empty project`, async ({ page }) => {
  await openHome(page); const { p } = await rich(page);
  const empty = await (await model()).createBackup({ projects: [{ id: 'empty', name: 'Empty' }], docs: [], fonts: [], settings: [] });
  await preview(page, empty.bytes); await expect(page.locator('#zipConfirm')).toBeEnabled(); await page.locator('#zipConfirm').click(); await expect(page.locator('#zipStatus')).toContainText('Транзакция завершена'); await page.locator('#zipCancel').click();
  const e = (await records(page, 'projects')).find(x => x.name === 'Empty (импорт)');
  const ids = count === 1 ? [e.id] : [p.id, e.id]; const parsed = await (await model()).readBackup(await createZIP(page, ids));
  expect(parsed.manifest.scope).toBe('selected-projects'); expect(parsed.manifest.projectIds.sort()).toEqual([...ids].sort()); expect(parsed.data.docs).toHaveLength(count - 1); expect(parsed.data.fonts).toHaveLength(1);
});
test('snapshot sees documents imported in another editor after this editor loaded', async ({ page, context }) => {
  await openHome(page); const second = await context.newPage(); await openHome(second); const {p} = await rich(second); await settled(second); const persisted = await all(second); await second.close();
  const parsed = await (await model()).readBackup(await createZIP(page));
  // The first editor legitimately flushes its own loaded document, including
  // renderer-generated gradient metadata. Compare the completed snapshot to IDB
  // after that barrier, and independently prove that unseen external docs survive.
  expect(parsed.data.docs).toEqual(await records(page, 'docs')); expect(parsed.data.projects).toEqual(persisted.projects);
  expect(parsed.data.docs.filter(d=>d.projectId===p.id)).toEqual(persisted.docs.filter(d=>d.projectId===p.id));
});
test('active and inactive tabs, debounce and held genuine transactions are drained before snapshot', async ({ page }) => {
  await fault(page); await openHome(page); await createDocument(page, 'ZIP tab A'); const a = await exportedDocument(page);
  await page.locator('#documentTabsHome').click(); await createDocument(page, 'ZIP tab B'); const b = await exportedDocument(page);
  await page.locator(`[data-tab-id="${a.id}"]`).click(); await page.evaluate(() => { zipFault.holdDocs = true; }); await addShape(page);
  await expect.poll(() => page.evaluate(() => zipFault.release.length)).toBeGreaterThan(0);
  await page.locator(`[data-tab-id="${b.id}"]`).click(); await addShape(page); await dataPane(page);
  await page.locator('#zipCreate').click(); await expect(page.locator('#zipStatus')).toContainText('Подтверждаем'); await expect(page.locator('#zipConfirm')).toBeDisabled();
  expect(await page.evaluate(() => zipFault.reads)).toBe(0);
  await page.evaluate(() => { zipFault.holdDocs = false; zipFault.release.splice(0).forEach(f => f()); });
  await expect(page.locator('#zipConfirm')).toBeEnabled(); const downloadPromise = page.waitForEvent('download'); await page.locator('#zipConfirm').click(); const bytes = await readFile(await (await downloadPromise).path());
  const data = (await (await model()).readBackup(bytes)).data; expect(data.docs.find(d => d.id === a.id).elements).toHaveLength(1); expect(data.docs.find(d => d.id === b.id).elements).toHaveLength(1);
  expect(await page.evaluate(() => zipFault.commits)).toBe(2);
});
test('snapshot refusal preserves data and produces no backup download', async ({ page }) => {
  await fault(page); await openHome(page); await dataPane(page); let downloads = 0; page.on('download', () => { downloads++; });
  await page.evaluate(() => { zipFault.failRead = true; }); await page.locator('#zipCreate').click(); await expect(page.locator('#zipStatus')).toContainText('Snapshot refused'); await expect(page.locator('#zipConfirm')).toBeDisabled(); expect(downloads).toBe(0);
  await page.locator('#zipCancel').click(); await expect(page.locator('#zipCreate')).toBeEnabled();
});
test('restore abort after first successful request rolls back all additions and keeps globals', async ({ page }) => {
  await fault(page); await openHome(page); await settled(page); const before = await all(page);
  const backup = await (await model()).createBackup({ projects: [archive.project], docs: archive.documents.map(d => ({...d, projectId: archive.project.id})), fonts: [], settings: [] }); await preview(page, backup.bytes); await expect(page.locator('#zipConfirm')).toBeEnabled();
  await page.evaluate(() => { zipFault.abortRestore = true; }); await page.locator('#zipConfirm').click(); await expect(page.locator('#zipStatus')).toContainText('Не удалось');
  expect(await page.evaluate(() => zipFault.restores)).toBe(1); expect(await all(page)).toEqual(before); await expect(page.locator('#zipStatus')).not.toContainText('Транзакция завершена');
});
for (const kind of ['corrupt', 'json', 'missing', 'checksum', 'version', 'path', 'duplicate']) test(`invalid ZIP cannot enable restore: ${kind}`, async ({ page }) => {
  await openHome(page); await settled(page); const before = await all(page), m = await model(); const base = await m.createBackup(before); const files = unzipSync(base.bytes);
  let bytes;
  if (kind === 'corrupt') bytes = Buffer.from('not a ZIP');
  if (kind === 'json') { files['data/docs.json'] = strToU8('{broken'); const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'])); const f = manifest.files.find(f => f.path === 'data/docs.json'); f.bytes = files[f.path].length; f.sha256 = await m.sha256(files[f.path]); files['manifest.json'] = strToU8(JSON.stringify(manifest)); }
  if (kind === 'missing') delete files['data/docs.json'];
  if (kind === 'checksum') files['data/docs.json'][20] ^= 1;
  if (kind === 'version') { const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'])); manifest.formatVersion = 99; files['manifest.json'] = strToU8(JSON.stringify(manifest)); }
  if (kind === 'path') { files['../manifest.json'] = files['manifest.json']; delete files['manifest.json']; }
  if (kind === 'duplicate') { const { zip } = await import('../scripts/distribution.mjs'); const entries = Object.entries(files).map(([name, data]) => ({ name, data: Buffer.from(data) })); entries[0].name = entries[1].name; bytes = zip(entries); }
  bytes ||= zipSync(files, { level: 0 }); await preview(page, bytes); await expect(page.locator('#zipStatus')).toContainText('Не удалось'); await expect(page.locator('#zipConfirm')).toBeDisabled(); expect(await all(page)).toEqual(before);
});
test('settings and localStorage are archived but never applied; existing fonts are skipped', async ({ page }) => {
  await openHome(page); const { p } = await rich(page); const bytes = await createZIP(page, [p.id]); const incoming = await (await model()).readBackup(bytes);
  await page.reload(); await page.evaluate(() => { localStorage.setItem('kartochnaya-layer-width', '333'); localStorage.setItem('token', 'do-not-export'); });
  incoming.data.settings.find(row=>row.key==='shapes-v1').sections=[];
  incoming.data.settings.push({ key: 'future-setting', value: 'archive-only' }); incoming.data.preferences = { 'kartochnaya-layer-width': '570' };
  const prepared = await (await model()).createBackup(incoming.data, { preferences: incoming.data.preferences });
  const before = await all(page); await preview(page, prepared.bytes); await expect(page.locator('#zipConfirm')).toBeEnabled(); await page.locator('#zipConfirm').click(); await expect(page.locator('#zipStatus')).toContainText('Транзакция завершена');
  expect((await all(page)).settings).toEqual(before.settings); expect((await all(page)).fonts).toEqual(before.fonts); expect(await page.evaluate(() => localStorage.getItem('kartochnaya-layer-width'))).toBe('333');
});
for (const url of ['/']) test(`offline ZIP works without external requests: ${url}`, async ({ page }) => {
  const external = []; await page.route('**/*', route => { const url = route.request().url(); if (/^https?:/.test(url) && !url.startsWith('http://127.0.0.1:4173')) { external.push(url); return route.abort(); } return route.continue(); });
  await openHome(page, url); const bytes = await createZIP(page); await preview(page, bytes); await expect(page.locator('#zipConfirm')).toBeEnabled(); expect(external).toEqual([]);
});
test('Android sized viewport: ZIP controls, preview and explicit cancellation', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 851 }); await openHome(page); const bytes = await createZIP(page); await preview(page, bytes); await expect(page.locator('#zipConfirm')).toBeEnabled(); await page.locator('#zipCancel').click();
});
test('ZIP larger than 50 MiB contains real embedded PNG images and can be verified and restored', async ({ page }) => {
  test.setTimeout(180_000);
  await openHome(page); const png = new PNG({ width: 1024, height: 1024 }); randomFillSync(png.data); for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;
  const image = 'data:image/png;base64,' + PNG.sync.write(png).toString('base64');
  const payload = structuredClone(archive); payload.project.id = 'large'; payload.project.name = 'ZIP Large'; payload.project.resources = Array.from({ length: 15 }, (_, i) => ({ id: 'img-' + i, name: 'Noise ' + i, src: image }));
  payload.documents = [{ id: 'large-doc', projectId: 'large', title: 'Image mask', width: 320, height: 240, elements: [{ id: 'image', type: 'image', imageSrc: image, layerMaskSrc: image }] }];
  const inputPath = test.info().outputPath('large.json'); await mkdir(dirname(inputPath), {recursive:true}); await writeFile(inputPath, JSON.stringify(payload)); await page.locator('#jsonInput').setInputFiles(inputPath); let project; await expect.poll(async () => { project = (await records(page, 'projects')).find(p => p.name === 'ZIP Large (импорт)'); return !!project; }, { timeout: 60_000 }).toBe(true);
  const bytes = await createZIP(page, [project.id]); console.log('Large ZIP bytes:', bytes.length); expect(bytes.length).toBeGreaterThan(50 * 1024 * 1024);
  await preview(page, bytes); await expect(page.locator('#zipConfirm')).toBeEnabled({ timeout: 60_000 }); await page.locator('#zipConfirm').click(); await expect(page.locator('#zipStatus')).toContainText('Транзакция завершена', { timeout: 60_000 });
  const projects = await records(page, 'projects'); const restored = projects.find(p => p.name === 'ZIP Large (импорт) (импорт)'); expect(restored.resources).toEqual(payload.project.resources);
});

test('ZIP adds absent user fonts atomically and skips duplicates on repeat restore', async ({ page }) => {
  await openHome(page); const before = await all(page);
  const font = { id: 'zip-new-font', name: 'ZIP New Face', family: 'ZIP New Face', weight: 400, style: 'normal', futureMetadata: { keep: true }, data: 'data:font/ttf;base64,' + (await readFile(require.resolve('./fixtures/fonts/DejaVuSans.ttf'))).toString('base64') };
  const backup = await (await model()).createBackup({ projects: [{id:'font-p',name:'Fonts'}], docs: [], fonts: [font], settings: [] });
  for (let n = 0; n < 2; n++) {
    await preview(page, backup.bytes); await expect(page.locator('#zipConfirm')).toBeEnabled(); await page.locator('#zipConfirm').click(); await expect(page.locator('#zipStatus')).toContainText('Транзакция завершена'); await page.locator('#zipCancel').click();
    const fonts = await records(page,'fonts'); expect(fonts).toHaveLength(before.fonts.length + 1); expect(fonts.at(-1)).toMatchObject({...font,id:expect.any(String)}); expect(fonts.at(-1).id).not.toBe(font.id);
  }
  expect(await page.evaluate(() => [...document.fonts].some(face=>face.family.replace(/^"|"$/g,'')==='ZIP New Face'&&face.status==='loaded'))).toBe(true);
});

test.describe('standalone offline without optional service worker', () => {
  test.use({ serviceWorkers: 'block' });
  test('standalone ZIP has no CDN dependencies', async ({ page, context }) => {
    const external = []; await page.route('**/*', route => { const url = route.request().url(); if (/^https?:/.test(url) && !url.startsWith('http://127.0.0.1:4173')) { external.push(url); return route.abort(); } return route.continue(); });
    await openHome(page, '/standalone/kartochnaya.html'); await context.setOffline(true);
    const bytes = await createZIP(page); await preview(page, bytes); await expect(page.locator('#zipConfirm')).toBeEnabled(); expect(external).toEqual([]);
  });
});
test('PWA ZIP works after the browser goes offline', async ({ page, context }) => {
  await openHome(page); await page.evaluate(() => navigator.serviceWorker.ready); await context.setOffline(true);
  const bytes = await createZIP(page); await preview(page, bytes); await expect(page.locator('#zipConfirm')).toBeEnabled(); await page.locator('#zipConfirm').click(); await expect(page.locator('#zipStatus')).toContainText('Транзакция завершена');
});
