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
