const { test, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');
const { openHome, importPayload, records, createDocument, exportedDocument, addShape, openLibraryDocument } = require('./helpers');
const archive = require('./fixtures/project-with-folders.json');
const linked = require('./fixtures/linked-document.json');
const catalog = require('./fixtures/shape-catalog-expected.json');

async function richArchive() {
  const payload = structuredClone(archive), p = payload.project;
  p.name = 'Integrity synthetic'; p.extra = { futureMetadata: ['keep'] }; p.cover = p.resources[0].src;
  p.resourceFolders.push({ id: 'nested', parentId: p.resourceFolders[0].id, name: 'Nested' }); p.resources[0].folderId = 'nested';
  const doc = { ...structuredClone(linked.document), projectId: p.id, id: 'rich-first' };
  doc.elements[0].layerMaskSrc = p.resources[0].src;
  doc.elements[1].clipped = true; doc.elements[1].clipBaseId = doc.elements[0].id; doc.elements[1].fontFamily = 'Synthetic DejaVu';
  doc.elements.push({ ...structuredClone(doc.elements[0]), id: 'embedded-image', type: 'image', imageSrc: p.resources[0].src, fillType: 'image', imageFit: 'fill' });
  const card = { ...structuredClone(doc), id: 'rich-second', type: 'card', title: 'Synthetic series', activeSlideIndex: 0 };
  card.slides = [0, 1].map(i => ({ id: 'slide-' + i, width: doc.width, height: doc.height, background: '#ffffff', elements: structuredClone(doc.elements), groups: structuredClone(doc.groups) }));
  payload.documents = [doc, card]; payload.shapeCatalog = catalog.sections || catalog;
  payload.fonts = [{ id: 'old-font', name: 'Synthetic DejaVu', family: 'Synthetic DejaVu', weight: 400, style: 'normal', data: 'data:font/ttf;base64,' + (await readFile(require.resolve('./fixtures/fonts/DejaVuSans.ttf'))).toString('base64') }];
  return payload;
}
async function instrument(page) {
  await page.addInitScript(() => {
    window.integrity = { count: 0, abortAt: null, holdAt: null, releases: [], successes: [], completes: 0, aborts: 0, toasts: [] };
    const observe = (request, store, method, value) => {
      const tr = store.transaction, c = window.integrity;
      if (c.holdAutosave && tr.mode === 'readwrite' && tr.objectStoreNames.length === 1 && store.name === 'docs') {
        request.addEventListener('success', () => {
          let released = false; c.releases.push(() => { released = true; });
          const pump = () => { if (!released) store.count().addEventListener('success', pump); }; pump();
        });
      }
      if (!c.enabled || tr.mode !== 'readwrite' || !tr.objectStoreNames.contains('projects') || !tr.objectStoreNames.contains('docs')) return request;
      const number = ++c.count;
      request.addEventListener('success', () => {
        c.successes.push({ store: store.name, method, id: value?.id || value, number });
        if (number === c.abortAt) { tr.abort(); return; }
        if (number === c.holdAt) {
          let released = false; c.releases.push(() => { released = true; });
          const pump = () => { if (!released) store.count().addEventListener('success', pump); }; pump();
        }
      });
      tr.addEventListener('abort', () => { c.aborts++; }); tr.addEventListener('complete', () => { c.completes++; });
      return request;
    };
    for (const method of ['add', 'put', 'delete']) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (...args) { return observe(original.apply(this, args), this, method, args[0]); };
    }
    const original = IDBCursor.prototype.delete;
    IDBCursor.prototype.delete = function (...args) { return observe(original.apply(this, args), this.source, 'cursor-delete', this.value); };
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver(() => { const value = document.querySelector('#toast')?.textContent; if (value) window.integrity.toasts.push(value); }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
  });
}
async function enable(page, options) { await page.evaluate(options => Object.assign(integrity, { enabled: true, count: 0, successes: [], aborts: 0, completes: 0, toasts: [], ...options }), options); }
async function release(page) { await page.evaluate(() => integrity.releases.splice(0).forEach(f => f())); }
async function all(page) { return { projects: await records(page, 'projects'), docs: await records(page, 'docs'), fonts: await records(page, 'fonts'), settings: await records(page, 'settings') }; }
async function imported(page, name = archive.project.name) {
  let p; await expect.poll(async () => { p = (await records(page, 'projects')).find(p => p.name === name + ' (импорт)'); return !!p; }).toBe(true); return p;
}
async function removeProject(page, id) {
  page.once('dialog', dialog => dialog.accept());
  await page.locator(`[data-delete-project="${id}"]`).click();
}
async function aborted(page) {
  await expect.poll(() => page.evaluate(() => integrity.aborts)).toBeGreaterThan(0);
  await expect(page.locator('#toast')).toContainText(/Ошибка|Не удалось/);
}

// A and G: full records are observed through the public import action and after a restart.
test('A/G: rich project keeps folders, images, fonts, custom catalog and all local document links after reload', async ({ page }) => {
  await openHome(page); const payload = await richArchive(), before = await all(page); await importPayload(page, payload);
  const p = await imported(page, payload.project.name);
  await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible();
  const after = await all(page), docs = after.docs.filter(d => d.projectId === p.id);
  for (const field of ['resources', 'resourceFolders', 'cover', 'extra']) expect(after.projects.find(x => x.id === p.id)[field]).toEqual(payload.project[field]);
  expect(docs).toHaveLength(2);
  for (const d of docs) {
    const original = payload.documents.find(x => x.title === d.title);
    expect(d.id).not.toBe(original.id);
    for (const field of ['elements', 'groups', 'slides', 'activeSlideIndex']) expect(d[field]).toEqual(original[field]);
  }
  expect(after.projects).toEqual(expect.arrayContaining(before.projects));
  expect(after.fonts[0]).toMatchObject({ ...payload.fonts[0], id: expect.any(String) });
  expect(after.fonts[0].id).not.toBe('old-font'); expect(after.settings).toContainEqual({ key: 'shapes-v1', sections: payload.shapeCatalog });
  await openLibraryDocument(page, docs.find(d => d.type === 'template').id); expect((await exportedDocument(page)).groups).toEqual(payload.documents[0].groups);
});
for (const abortAt of [1, 3, 5]) test(`B: project import abort at successful request ${abortAt} leaves no project/docs/fonts/catalog or false success`, async ({ page }) => {
  await instrument(page); await openHome(page); await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве'); const payload = await richArchive(), before = await all(page);
  await enable(page, { abortAt }); await importPayload(page, payload); await aborted(page);
  expect(await all(page)).toEqual(before);
  expect(await page.evaluate(() => integrity.toasts.some(t => /Импортировано|Проект импортирован/.test(t)))).toBe(false);
  await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible(); expect(await all(page)).toEqual(before);
});
for (const abortAt of [null, 4]) test(`C: workspace is one transaction, abortAt=${abortAt}`, async ({ page }) => {
  await instrument(page); await openHome(page); await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве'); const before = await all(page);
  const first = structuredClone(archive), last = structuredClone(archive); last.project.id = 'last-project'; last.project.name = 'Last'; last.documents[0].id = 'last-doc';
  const payload = { format: 'kartochnaya-workspace-v1', projects: [first, last] };
  await enable(page, { abortAt }); await importPayload(page, payload);
  if (abortAt) { await aborted(page); expect(await all(page)).toEqual(before); }
  else {
    await imported(page, 'Last'); await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible();
    const after = await all(page); expect(after.projects.length).toBe(before.projects.length + 2); expect(after.docs.length).toBe(before.docs.length + 2);
    for (const p of after.projects.filter(p => !before.projects.some(x => x.id === p.id))) expect(after.docs.filter(d => d.projectId === p.id)).toHaveLength(1);
  }
});
for (const abortAt of [null, 3]) test(`D/E: deletion includes a stored document missing from app memory, abortAt=${abortAt}`, async ({ page }) => {
  await instrument(page); await openHome(page); const payload = await richArchive(); await importPayload(page, payload); const p = await imported(page, payload.project.name);
  // An isolated synthetic historical orphan is intentionally absent from editor memory.
  await page.evaluate(async ({ id, document }) => {
    const db = await new Promise(r => { const q = indexedDB.open('kartochnaya_local_v1'); q.onsuccess = () => r(q.result); });
    await new Promise((resolve, reject) => { const tr = db.transaction('docs', 'readwrite'); tr.objectStore('docs').put({ ...document, id: 'hidden-stored-doc', projectId: id }); tr.oncomplete = resolve; tr.onabort = () => reject(tr.error); }); db.close();
  }, { id: p.id, document: archive.documents[0] });
  const before = await all(page); await enable(page, { abortAt }); await removeProject(page, p.id);
  if (abortAt) { await aborted(page); expect(await all(page)).toEqual(before); }
  else {
    await expect.poll(async () => (await records(page, 'projects')).some(x => x.id === p.id)).toBe(false);
    await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible(); const after = await all(page);
    expect(after.docs.some(d => d.projectId === p.id)).toBe(false); expect(after.projects).toEqual(before.projects.filter(x => x.id !== p.id));
  }
});
for (const abortAt of [null, 2]) test(`F: last-project replacement commits or rolls back with deletion, abortAt=${abortAt}`, async ({ page }) => {
  await instrument(page); await openHome(page); await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве'); const before = await all(page); expect(before.projects).toHaveLength(1);
  await enable(page, { abortAt }); await removeProject(page, before.projects[0].id);
  if (abortAt) { await aborted(page); expect(await all(page)).toEqual(before); }
  else {
    await expect.poll(async () => (await records(page, 'projects'))[0]?.id).not.toBe(before.projects[0].id);
    await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible(); const projects = await records(page, 'projects'); expect(projects).toHaveLength(1); expect(projects[0].name).toBe('Мой проект');
    expect((await records(page, 'docs')).some(d => d.projectId === before.projects[0].id)).toBe(false);
  }
});
test('G: unchanged KF-002 fixture survives reopening and displays the original resource folder', async ({ page }) => {
  await openHome(page); await importPayload(page, archive); const p = await imported(page); await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible();
  const saved = (await records(page, 'projects')).find(x => x.id === p.id); expect(saved.resourceFolders).toEqual(archive.project.resourceFolders); expect(saved.resources).toEqual(archive.project.resources);
  await page.locator('[data-filter="resource"]').click(); await page.locator('[data-folder-open="folder-original"]').first().click(); await expect(page.locator('[data-assetid="resource-original"] img')).toBeVisible();
});
for (const abortAt of [null, 2]) test(`H: active/dormant tabs and debounced save remain safe through deletion, abortAt=${abortAt}`, async ({ page }) => {
  await instrument(page); await openHome(page); await createDocument(page, 'First open'); const first = await exportedDocument(page);
  await page.locator('#documentTabsHome').click(); await createDocument(page, 'Second open'); await addShape(page); const second = await exportedDocument(page);
  await page.locator('#documentTabsHome').click(); const p = (await records(page, 'projects'))[0];
  await enable(page, { abortAt, holdAt: abortAt ? null : 1 }); await removeProject(page, p.id);
  if (abortAt) {
    await aborted(page); await expect(page.locator(`[data-tab-id="${first.id}"]`)).toBeVisible(); await expect(page.locator(`[data-tab-id="${second.id}"]`)).toBeVisible();
    expect((await records(page, 'docs')).find(d => d.id === second.id).elements).toHaveLength(1);
  } else {
    await expect.poll(() => page.evaluate(() => integrity.releases.length)).toBeGreaterThan(0);
    // Public interactions are frozen while the real transaction is awaiting commit.
    await page.locator(`[data-tab-id="${first.id}"]`).click(); await release(page);
    await expect.poll(async () => (await records(page, 'docs')).some(d => [first.id, second.id].includes(d.id))).toBe(false);
    await expect(page.locator(`[data-tab-id="${first.id}"]`)).toHaveCount(0); await expect(page.locator(`[data-tab-id="${second.id}"]`)).toHaveCount(0);
    await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible(); expect((await records(page, 'docs')).some(d => d.projectId === p.id)).toBe(false);
  }
});
test('import commit waits, repeated import and project switch cannot overwrite its UI context', async ({ page }) => {
  await instrument(page); await openHome(page); await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве'); const before = await all(page); await enable(page, { holdAt: 1 }); await importPayload(page, archive);
  await expect.poll(() => page.evaluate(() => integrity.releases.length)).toBeGreaterThan(0);
  await importPayload(page, archive); await page.locator(`[data-switch-project="${before.projects[0].id}"]`).click();
  expect(await page.evaluate(() => integrity.completes)).toBe(0); expect(await page.evaluate(() => integrity.toasts.some(t => /Импортировано/.test(t)))).toBe(false);
  await release(page); await imported(page); expect((await records(page, 'projects')).length).toBe(before.projects.length + 1);
});
test('multi-store production helper: real second-request ConstraintError rolls back the successful first store', async ({ page }) => {
  await openHome(page);
  const result = await page.evaluate(async () => {
    const { runStoreTransaction, runStoreRequest } = await import('/__tests/indexeddb.mjs');
    const db = await new Promise(r => { const q = indexedDB.open('isolated-multi-' + crypto.randomUUID(), 1); q.onupgradeneeded = () => { for (const name of ['projects', 'docs']) q.result.createObjectStore(name, { keyPath: 'id' }); }; q.onsuccess = () => r(q.result); });
    let success = false, name;
    try {
      await runStoreTransaction(db, ['projects', 'docs'], 'readwrite', s => { s('docs').add({ id: 'existing' }); });
      try { await runStoreTransaction(db, ['projects', 'docs'], 'readwrite', s => { const q = s('projects').add({ id: 'p' }); q.onsuccess = () => { success = true; s('docs').add({ id: 'existing' }); }; }); } catch (error) { name = error.name; }
      return { success, name, projects: await runStoreRequest(db, 'projects', 'readonly', s => s.getAll()), docs: await runStoreRequest(db, 'docs', 'readonly', s => s.getAll()) };
    } finally { db.close(); }
  });
  expect(result).toEqual({ success: true, name: 'ConstraintError', projects: [], docs: [{ id: 'existing' }] });
});

test('H: deletion waits for an already successful but uncommitted autosave before removing open tabs', async ({ page }) => {
  await instrument(page); await openHome(page); await createDocument(page, 'Pending first'); const first = await exportedDocument(page);
  await page.locator('#documentTabsHome').click(); await createDocument(page, 'Pending second'); const second = await exportedDocument(page);
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  await enable(page, { holdAutosave: true }); await addShape(page);
  await expect.poll(() => page.evaluate(() => integrity.releases.length)).toBeGreaterThan(0);
  await expect(page.locator('#saveStatus')).toHaveText('Сохраняем…');
  await page.locator('#documentTabsHome').click();
  // captureDocumentTab clears the debounce and shares the pending save promise.
  const projects = await records(page, 'projects'); await removeProject(page, projects[0].id);
  expect(await page.evaluate(() => integrity.count)).toBe(0);
  await expect(page.locator(`[data-tab-id="${first.id}"]`)).toBeVisible(); await expect(page.locator(`[data-tab-id="${second.id}"]`)).toBeVisible();
  await page.evaluate(() => { integrity.holdAutosave = false; }); await release(page);
  await expect.poll(async () => (await records(page, 'projects')).some(p => p.id === projects[0].id)).toBe(false);
  await expect(page.locator(`[data-tab-id="${second.id}"]`)).toHaveCount(0);
  expect((await records(page, 'docs')).some(d => d.projectId === projects[0].id)).toBe(false);
  await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible(); expect((await records(page, 'docs')).some(d => [first.id, second.id].includes(d.id))).toBe(false);
});
test('failed project import leaves the currently open document and its unsaved content available', async ({ page }) => {
  await instrument(page); await openHome(page); await createDocument(page, 'Retained active'); await addShape(page); const doc = await exportedDocument(page);
  await enable(page, { abortAt: 2 }); await importPayload(page, await richArchive()); await aborted(page);
  await expect(page.locator(`[data-tab-id="${doc.id}"]`)).toHaveAttribute('aria-selected', 'true');
  const retained = await exportedDocument(page); expect(retained.id).toBe(doc.id); expect(retained.elements).toEqual(doc.elements);
  expect((await records(page, 'docs')).find(d => d.id === doc.id).elements).toEqual(doc.elements);
});
test('invalid last workspace item is rejected before any project or global write', async ({ page }) => {
  await instrument(page); await openHome(page); await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  const before = await all(page), rich = await richArchive();
  await enable(page, {}); await importPayload(page, { ...rich, format: 'kartochnaya-workspace-v1', projects: [rich, { project: { id: 'broken' }, documents: [{ width: 9000, elements: [] }] }] });
  await expect(page.locator('#toast')).toContainText('Ошибка'); expect(await all(page)).toEqual(before); expect(await page.evaluate(() => integrity.count)).toBe(0);
});

test('late resource-file decoding cannot recreate a project after its deletion', async ({ page }) => {
  await page.addInitScript(() => {
    window.decodeControl = { enabled: false, releases: [] };
    const original = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function (...args) {
      await original.apply(this, args);
      if (decodeControl.enabled) await new Promise(resolve => decodeControl.releases.push(resolve));
    };
  });
  await openHome(page); await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве'); const p = (await records(page, 'projects'))[0];
  await page.evaluate(() => { decodeControl.enabled = true; });
  await page.locator('#resourceInput').setInputFiles(require.resolve('./fixtures/sample.png'));
  await expect.poll(() => page.evaluate(() => decodeControl.releases.length)).toBeGreaterThan(0);
  await removeProject(page, p.id); await expect.poll(async () => (await records(page, 'projects')).some(x => x.id === p.id)).toBe(false);
  await page.evaluate(() => { decodeControl.enabled = false; decodeControl.releases.splice(0).forEach(f => f()); });
  await expect(page.locator('#toast')).toContainText('Недостаточно места');
  expect((await records(page, 'projects')).some(x => x.id === p.id)).toBe(false);
  await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible(); expect((await records(page, 'projects')).some(x => x.id === p.id)).toBe(false);
});

for (const workspace of [false, true]) test(`empty first imported project preserves tabs and selected project; workspace=${workspace}`, async ({ page }) => {
  await openHome(page); await createDocument(page, 'Retained first tab'); await addShape(page); const first = await exportedDocument(page);
  await page.locator('#documentTabsHome').click(); await createDocument(page, 'Retained active tab'); await addShape(page); const active = await exportedDocument(page);
  const empty = { project: { id: 'empty-source', name: 'Empty first', resources: [], resourceFolders: [] }, documents: [] };
  const payload = workspace ? { format: 'kartochnaya-workspace-v1', projects: [empty, structuredClone(archive)] } : { format: 'kartochnaya-project-v1', ...empty };
  const beforeDocs = await records(page, 'docs');
  await importPayload(page, payload); const selected = await imported(page, 'Empty first');
  await expect(page.locator('#homeScreen')).toBeVisible();
  await expect(page.locator('#documentTabsHome')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator(`[data-switch-project="${selected.id}"]`)).toHaveClass(/active/);
  expect(await page.evaluate(() => localStorage.getItem('kartochnaya_current_project'))).toBe(selected.id);
  expect((await records(page, 'docs')).filter(d => d.projectId === selected.id)).toEqual([]);
  const beforeIds = new Set([...beforeDocs.map(d => d.id), first.id, active.id]);
  expect(await records(page, 'docs')).toHaveLength(beforeIds.size + (workspace ? archive.documents.length : 0));
  for (const doc of [first, active]) {
    await expect(page.locator(`[data-tab-id="${doc.id}"]`)).toBeVisible();
    await page.locator(`[data-tab-id="${doc.id}"]`).click();
    await expect(page.locator(`[data-tab-id="${doc.id}"]`)).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => localStorage.getItem('kartochnaya_current_project'))).toBe(doc.projectId);
    const reopened = await exportedDocument(page); expect(reopened.id).toBe(doc.id); expect(reopened.elements).toEqual(doc.elements);
  }
  await page.locator('#documentTabsHome').click(); await page.locator(`[data-switch-project="${selected.id}"]`).click();
  expect(await page.evaluate(() => localStorage.getItem('kartochnaya_current_project'))).toBe(selected.id);
  await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible();
  await expect(page.locator(`[data-switch-project="${selected.id}"]`)).toHaveClass(/active/);
  for (const doc of [first, active]) expect((await records(page, 'docs')).find(d => d.id === doc.id).elements).toEqual(doc.elements);
});

test.describe('large native ZIP round trips', () => {
  test.describe.configure({ mode: 'serial' });
  for (const workspace of [false, true]) test(`native ${workspace ? 'workspace' : 'project'} ZIP preserves embedded resources over 50 MiB`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const { PNG } = require('pngjs');
    const { writeFile, stat } = require('node:fs/promises');
    // Valid deterministic noise PNGs make the normal image-resource JSON > 50 MiB.
    const image = new PNG({ width: 1024, height: 1024 }); let state = 12345;
    for (let i = 0; i < image.data.length; i++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; image.data[i] = state & 255; }
    const src = 'data:image/png;base64,' + PNG.sync.write(image).toString('base64');
    const source = structuredClone(archive); source.project.name = 'Large native';
    source.project.resources = Array.from({ length: 10 }, (_, i) => ({ ...source.project.resources[0], id: 'large-resource-' + i, src }));
    const other = { project: { id: 'large-other', name: 'Other native', resources: [], resourceFolders: [] }, documents: [] };
    const payload = workspace ? { format: 'kartochnaya-workspace-v1', projects: [source, other] } : source;
    const seedPath = testInfo.outputPath('large-synthetic.json'); await writeFile(seedPath, JSON.stringify(payload));
    expect((await stat(seedPath)).size).toBeGreaterThan(50 * 1024 * 1024);
    await openHome(page); await page.locator('#jsonInput').setInputFiles(seedPath);
    await expect(page.locator('#toast')).toContainText('Импортировано проектов', { timeout: 60_000 });
    await page.locator('[data-home-nav="data"]').click(); await page.locator('#zipCreate').click();
    await expect(page.locator('#zipConfirm')).toBeEnabled();
    await page.locator('[name=zipScope][value=selected]').check();
    const boxes = page.locator('[data-zip-project]');
    for (const box of await boxes.all()) {
      const row = await box.locator('..').textContent();
      await box.setChecked(row.includes('Large native') || (workspace && row.includes('Other native')));
    }
    const pending = page.waitForEvent('download'); await page.locator('#zipConfirm').click(); const download = await pending;
    const exportedPath = await download.path(); const exportedBytes = (await stat(exportedPath)).size;
    const verified = await (await import('../src/backup/archive.mjs')).readBackup(await require('node:fs/promises').readFile(exportedPath));
    expect(verified.data.projects.find(p => p.name.startsWith('Large native')).resources.reduce((sum, r) => sum + r.src.length, 0)).toBeGreaterThan(50 * 1024 * 1024);
    await testInfo.attach('native-export-size', { body: JSON.stringify({ workspace, exportedBytes }), contentType: 'application/json' });
    // Use the exact file generated by the editor, with no changes after export.
    await page.locator('#zipCancel').click();
    await page.locator('#zipInput').setInputFiles(exportedPath);
    await expect(page.locator('#zipConfirm')).toBeEnabled({ timeout: 60_000 });
    await page.locator('#zipConfirm').click();
    await expect(page.locator('#zipStatus')).toContainText('Транзакция завершена', { timeout: 60_000 });
    await page.locator('#zipCancel').click();
    // ZIP uses the committed IndexedDB order; UUID ordering can put the empty project first.
    await expect(page.locator('#homeProjectBadge')).toHaveText(verified.data.projects[0].name + ' (импорт)');
    await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible({ timeout: 60_000 });
    const summary = await page.evaluate(async () => {
      const db = await new Promise(r => { const q = indexedDB.open('kartochnaya_local_v1'); q.onsuccess = () => r(q.result); });
      try {
        return await new Promise((resolve, reject) => {
          const tr = db.transaction(['projects', 'docs'], 'readonly'), q = tr.objectStore('projects').getAll(), d = tr.objectStore('docs').getAll();
          tr.oncomplete = async () => {
            const resource = q.result.find(p => p.name === 'Large native (импорт) (импорт)')?.resources[0];
            const digest = resource ? await crypto.subtle.digest('SHA-256', new TextEncoder().encode(resource.src)) : new ArrayBuffer(0);
            resolve({ imageHash: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join(''), projects: q.result.map(p => ({ id: p.id, name: p.name, resources: (p.resources || []).map(r => ({ id: r.id, folderId: r.folderId, length: r.src.length, same: r.src === p.resources[0].src })), folders: p.resourceFolders })), docs: d.result.map(x => ({ projectId: x.projectId, title: x.title })) });
          };
          tr.onabort = () => reject(tr.error);
        });
      } finally { db.close(); }
    });
    expect(summary.imageHash).toBe(require('node:crypto').createHash('sha256').update(src).digest('hex'));
    const imported = summary.projects.find(p => p.name === 'Large native (импорт) (импорт)'); expect(imported).toBeTruthy();
    expect(imported.folders).toEqual(source.project.resourceFolders);
    expect(imported.resources).toEqual(source.project.resources.map(r => ({ id: r.id, folderId: r.folderId, length: src.length, same: true })));
    expect(summary.docs.filter(d => d.projectId === imported.id)).toHaveLength(source.documents.length);
    if (workspace) expect(summary.projects.some(p => p.name === 'Other native (импорт) (импорт)')).toBe(true);
  });
});

for (const readFailure of [false, true]) test(`JSON ${readFailure ? 'reading' : 'parsing'} error keeps existing records`, async ({ page }) => {
  if (readFailure) await page.addInitScript(() => {
    const original = File.prototype.text;
    File.prototype.text = function () { return this.name === 'denied.json' ? Promise.reject(new DOMException('Synthetic read failure', 'NotReadableError')) : original.call(this); };
  });
  await openHome(page); await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве'); const before = await all(page);
  await page.locator('#jsonInput').setInputFiles({ name: readFailure ? 'denied.json' : 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{invalid JSON') });
  await expect(page.locator('#toast')).toContainText('Ошибка'); if (readFailure) await expect(page.locator('#toast')).toContainText('Synthetic read failure');
  expect(await all(page)).toEqual(before);
});
