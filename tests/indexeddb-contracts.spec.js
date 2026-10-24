const { test, expect } = require('@playwright/test');
const { openHome, createDocument, addShape, createText, exportedDocument, records, savedDocument, openLibraryDocument, importPayload } = require('./helpers');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

// Fault injection lives in an isolated context, never in the application bundle.
// Every request and transaction below is a real Chromium IndexedDB object.
async function instrument(page) {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    window.idbControl = { hold: false, abort: false, successes: [], releases: [], completes: 0 };
    IDBObjectStore.prototype.put = function (...args) {
      const request = original.apply(this, args), tr = this.transaction, store = this;
      if (!(window.idbControl.stores || ['docs']).includes(this.name) || !window.idbControl.enabled) return request;
      tr.addEventListener('complete', () => { window.idbControl.completes++; });
      request.addEventListener('success', () => {
        const control = window.idbControl;
        control.successes.push({ id: args[0].id, status: document.querySelector('#saveStatus').textContent });
        if (control.abort) { tr.abort(); return; }
        if (control.hold) {
          let released = false;
          control.releases.push(() => { released = true; });
          // Keep this real transaction active until the test explicitly releases it.
          const pump = () => { if (!released) store.get(args[0].id).addEventListener('success', pump); };
          pump();
        }
      });
      return request;
    };
  });
}
async function release(page) {
  await page.evaluate(() => { idbControl.hold = false; idbControl.releases.splice(0).forEach(fn => fn()); });
}

test('A: production helper rejects real request success → transaction abort; original record survives', async ({ page }) => {
  await openHome(page);
  const result = await page.evaluate(async () => {
    const { runStoreRequest } = await import('/__tests/indexeddb.mjs');
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('isolated-contract-' + crypto.randomUUID(), 1);
      request.onupgradeneeded = () => request.result.createObjectStore('docs', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      const initial = { id: 'synthetic', value: 'before' };
      const key = await runStoreRequest(db, 'docs', 'readwrite', store => store.put(initial));
      let requestSucceeded = false, resolved = false, name;
      const promise = runStoreRequest(db, 'docs', 'readwrite', store => {
        const request = store.put({ id: 'synthetic', value: 'after' });
        request.addEventListener('success', () => { requestSucceeded = true; store.transaction.abort(); });
        return request;
      });
      try { await promise; resolved = true; } catch (error) { name = error.name; }
      const after = await runStoreRequest(db, 'docs', 'readonly', store => store.get('synthetic'));
      const all = await runStoreRequest(db, 'docs', 'readonly', store => store.getAll());
      await runStoreRequest(db, 'docs', 'readwrite', store => store.put({ id: 'synthetic', value: 'updated' }));
      const updated = await runStoreRequest(db, 'docs', 'readonly', store => store.get('synthetic'));
      const deleted = await runStoreRequest(db, 'docs', 'readwrite', store => store.delete('synthetic'));
      const missing = await runStoreRequest(db, 'docs', 'readonly', store => store.get('synthetic'));
      db.close();
      let closed;
      try { await runStoreRequest(db, 'docs', 'readonly', store => store.getAll()); } catch (error) { closed = error.name; }
      return { key, requestSucceeded, resolved, name, after, all, updated, deleted, missing, closed };
    } finally { db.close(); }
  });
  expect(result).toEqual({ key: 'synthetic', requestSucceeded: true, resolved: false, name: 'AbortError',
    after: { id: 'synthetic', value: 'before' }, all: [{ id: 'synthetic', value: 'before' }],
    updated: { id: 'synthetic', value: 'updated' }, deleted: undefined, missing: undefined, closed: 'InvalidStateError' });
});

test('B: real editor stays saving until transaction completion; latest edits survive reload and Undo/Redo', async ({ page }) => {
  await instrument(page); await openHome(page); await createDocument(page, 'Storage B');
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  await page.evaluate(() => Object.assign(idbControl, { enabled: true, hold: true }));
  await addShape(page);
  await expect.poll(() => page.evaluate(() => idbControl.successes.length)).toBeGreaterThan(0);
  await expect(page.locator('#saveStatus')).toHaveText('Сохраняем…');
  expect(await page.evaluate(() => idbControl.completes)).toBe(0);
  // Another edit arrives after request success but before the previous transaction commits.
  await createText(page, 'Последняя редакция');
  await release(page);
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  const document = await exportedDocument(page);
  expect(await page.evaluate(() => idbControl.successes.every(event => !event.status.includes('Сохранено')))).toBe(true);
  expect((await records(page, 'docs')).find(d => d.id === document.id)).toEqual(document);
  await page.locator('#canvas').focus(); await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  await page.reload(); await openLibraryDocument(page, document.id);
  expect((await exportedDocument(page)).elements).toEqual(document.elements);
});

test('C: delayed old document cannot mark the new document saved; both tabs persist', async ({ page }) => {
  await instrument(page); await openHome(page); await createDocument(page, 'Storage C first');
  await addShape(page); const first = await exportedDocument(page);
  await page.locator('#documentTabsHome').click(); await createDocument(page, 'Storage C second');
  const second = await exportedDocument(page);
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  await page.locator(`[data-tab-id="${first.id}"]`).click();
  await page.evaluate(() => Object.assign(idbControl, { enabled: true, hold: true }));
  await addShape(page);
  await expect.poll(() => page.evaluate(() => idbControl.successes.length)).toBeGreaterThan(0);
  await page.locator(`[data-tab-id="${second.id}"]`).click(); await createText(page, 'Второй документ');
  await expect(page.locator('#saveStatus')).toHaveText('Сохраняем…');
  await release(page);
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  await savedDocument(page, first.title, 2); await savedDocument(page, second.title, 1);
  const saved = await records(page, 'docs');
  await page.reload(); await openLibraryDocument(page, first.id);
  expect((await exportedDocument(page)).elements).toEqual(saved.find(d => d.id === first.id).elements);
  await page.locator('#documentTabsHome').click(); await openLibraryDocument(page, second.id);
  expect((await exportedDocument(page)).elements).toEqual(saved.find(d => d.id === second.id).elements);
});

test('D: aborted autosave keeps active and dormant tabs; ZIP refuses unconfirmed memory without losing tabs', async ({ page }) => {
  await instrument(page); await openHome(page); await createDocument(page, 'Storage D');
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  const original = await exportedDocument(page);
  await page.evaluate(() => Object.assign(idbControl, { enabled: true, abort: true }));
  await addShape(page);
  await expect(page.locator('#saveStatus')).toContainText('Ошибка сохранения');
  await page.locator(`[data-tab-id="${original.id}"] .document-tab-close`).click();
  await expect(page.locator(`[data-tab-id="${original.id}"]`)).toBeVisible();
  expect((await exportedDocument(page)).elements).toHaveLength(1);
  expect((await records(page, 'docs')).find(d => d.id === original.id).elements).toHaveLength(0);
  await page.locator('#documentTabsHome').click();
  // ZIP must refuse an unconfirmed dormant tab and preserve the in-memory edit.
  await page.locator(`[data-tab-id="${original.id}"] .document-tab-close`).click();
  await expect(page.locator(`[data-tab-id="${original.id}"]`)).toBeVisible();
  await page.locator('[data-home-nav="data"]').click();
  let downloads = 0; page.on('download', () => downloads++);
  await page.locator('#zipStorage').click();
  await expect(page.locator('#zipStatus')).toContainText('не подтверждено');
  await expect(page.locator('#zipConfirm')).toBeDisabled();
  expect(downloads).toBe(0);
  await page.locator('#zipCancel').click();
  await page.locator(`[data-tab-id="${original.id}"]`).click();
  expect((await exportedDocument(page)).elements).toHaveLength(1);
  await expect(page.locator('#saveStatus')).toContainText('Ошибка сохранения');
  await page.evaluate(() => { idbControl.abort = false; });
  await addShape(page); await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  await savedDocument(page, original.title, 2);
});

test('unavailable IndexedDB: first launch remains editable, fixture observation works, close retains unsaved tab', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { get() { throw new DOMException('Synthetic denial', 'SecurityError'); } }));
  await openHome(page); await createDocument(page, 'Только память'); await createText(page, 'Спасти в JSON');
  await expect(page.locator('#saveStatus')).toContainText('сохранение не подтверждено');
  expect(await page.locator('#saveStatus').textContent()).not.toContain('Сохранено');
  const document = await exportedDocument(page); expect(document.elements[0].text).toBe('Спасти в JSON');
  await page.locator(`[data-tab-id="${document.id}"] .document-tab-close`).click();
  await expect(page.locator(`[data-tab-id="${document.id}"]`)).toBeVisible();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.locator('#documentTabsHome').click();
  await expect(page.locator('#homeScreen')).toBeVisible();
  expect(errors).toEqual([]);
});

test('existing v3 synthetic records retain IDs, image, slides, font, resources, folders and catalog after update', async ({ page }) => {
  // Prepare a database before loading the updated program. Schema and records match stage 9 fixtures.
  await page.route('**/__tests/blank', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Isolated seed</title>' }));
  await page.goto('/__tests/blank');
  const projectFixture = JSON.parse(await readFile(path.join(__dirname, 'fixtures/project-with-folders.json'), 'utf8'));
  const shapeFixture = JSON.parse(await readFile(path.join(__dirname, 'fixtures/shape-catalog-expected.json'), 'utf8'));
  const textFixture = JSON.parse(await readFile(path.join(__dirname, 'fixtures/visual-text.json'), 'utf8'));
  const font = (await readFile(path.join(__dirname, 'fixtures/fonts/DejaVuSans.ttf'))).toString('base64');
  const seed = await page.evaluate(async ({ projectFixture, shapeFixture, textFixture, font }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('kartochnaya_local_v1', 3);
      request.onupgradeneeded = () => { for (const store of ['docs', 'projects', 'fonts', 'settings']) request.result.createObjectStore(store, { keyPath: store === 'settings' ? 'key' : 'id' }); };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const project = { ...projectFixture.project, id: 'preexisting-project' };
    const other = { ...project, id: 'preexisting-other', name: 'Другой проект', resources: [], resourceFolders: [] };
    const base = { ...textFixture.document, projectId: project.id, rulers: [], groups: [] };
    base.elements.push({ id: 'old-image', type: 'image', name: 'Existing image', x: 10, y: 180, w: 32, h: 24, visible: true, locked: false, opacity: 100, rotation: 0, fillType: 'image', fillOpacity: 100, imageSrc: project.resources[0].src, imageFit: 'fill', cropX: 0, cropY: 0, cropZoom: 1, cropRotation: 0 });
    const text = { ...base, id: 'preexisting-text', title: 'Existing text and image' };
    const card = { ...base, id: 'preexisting-card', title: 'Existing series', type: 'card', slides: [
      { id: 'old-slide-a', width: base.width, height: base.height, background: base.background, elements: structuredClone(base.elements), groups: [] },
      { id: 'old-slide-b', width: base.width, height: base.height, background: '#ffffff', elements: [], groups: [] }], activeSlideIndex: 0 };
    const face = { id: 'preexisting-font', name: 'DejaVuSans', family: 'Synthetic DejaVu', weight: 400, style: 'normal', data: 'data:font/ttf;base64,' + font };
    const sections = shapeFixture.sections || shapeFixture;
    const settings = { key: 'shapes-v1', sections };
    await new Promise((resolve, reject) => {
      const tr = db.transaction(['docs', 'projects', 'fonts', 'settings'], 'readwrite');
      tr.objectStore('projects').put(project); tr.objectStore('projects').put(other);
      tr.objectStore('docs').put(text); tr.objectStore('docs').put(card);
      tr.objectStore('fonts').put(face); tr.objectStore('settings').put(settings);
      tr.oncomplete = resolve; tr.onabort = () => reject(tr.error);
    });
    db.close(); localStorage.setItem('kartochnaya_current_project', project.id); return { text, card, project, other, face, settings };
  }, { projectFixture, shapeFixture, textFixture, font });
  await openHome(page);
  await openLibraryDocument(page, seed.text.id);
  expect((await exportedDocument(page)).elements).toEqual(seed.text.elements);
  await page.locator('#documentTabsHome').click(); await page.locator('[data-filter="card"]').click(); await openLibraryDocument(page, seed.card.id);
  const card = await exportedDocument(page);
  expect(card.id).toBe(seed.card.id); expect(card.slides.map(s => s.id)).toEqual(['old-slide-a', 'old-slide-b']);
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible();
  expect(await records(page, 'projects')).toEqual(expect.arrayContaining([seed.project, seed.other]));
  expect(await records(page, 'fonts')).toEqual([seed.face]);
  expect(await records(page, 'settings')).toEqual([seed.settings]);
  await openLibraryDocument(page, seed.text.id);
  expect((await exportedDocument(page)).elements).toEqual(seed.text.elements);
  expect(await page.evaluate(async () => { const db = await new Promise(r => { const q = indexedDB.open('kartochnaya_local_v1'); q.onsuccess = () => r(q.result); }); const info = { name: db.name, version: db.version, stores: [...db.objectStoreNames] }; db.close(); return info; })).toEqual({ name: 'kartochnaya_local_v1', version: 3, stores: ['docs', 'fonts', 'projects', 'settings'] });
});

test('real request ConstraintError rolls back earlier writes in the same transaction', async ({ page }) => {
  await openHome(page);
  const result = await page.evaluate(async () => {
    const { runStoreRequest } = await import('/__tests/indexeddb.mjs');
    const db = await new Promise((resolve, reject) => { const q = indexedDB.open('constraint-' + crypto.randomUUID(), 1); q.onupgradeneeded = () => q.result.createObjectStore('docs', { keyPath: 'id' }); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
    try {
      await runStoreRequest(db, 'docs', 'readwrite', s => s.put({ id: 'a', value: 1 }));
      let name;
      try { await runStoreRequest(db, 'docs', 'readwrite', s => { s.put({ id: 'a', value: 2 }); return s.add({ id: 'a', value: 3 }); }); } catch (e) { name = e.name; }
      return { name, record: await runStoreRequest(db, 'docs', 'readonly', s => s.get('a')) };
    } finally { db.close(); }
  });
  expect(result).toEqual({ name: 'ConstraintError', record: { id: 'a', value: 1 } });
});

test('closing a tab waits for a real pending commit and leaves the next document active', async ({ page }) => {
  await instrument(page); await openHome(page); await createDocument(page, 'Closing first');
  const first = await exportedDocument(page);
  await page.locator('#documentTabsHome').click(); await createDocument(page, 'Closing second');
  const second = await exportedDocument(page);
  await page.evaluate(() => Object.assign(idbControl, { enabled: true, hold: true }));
  await addShape(page);
  await expect.poll(() => page.evaluate(() => idbControl.successes.length)).toBeGreaterThan(0);
  await page.locator(`[data-tab-id="${second.id}"] .document-tab-close`).click();
  await expect(page.locator(`[data-tab-id="${second.id}"]`)).toBeVisible();
  await release(page);
  await expect(page.locator(`[data-tab-id="${second.id}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-tab-id="${first.id}"]`)).toHaveAttribute('aria-selected', 'true');
  await savedDocument(page, second.title, 1);
});

test('history original preview is not persisted or discarded by closing the tab', async ({ page }) => {
  await openHome(page); await createDocument(page, 'Storage history');
  await addShape(page); const doc = await exportedDocument(page); await savedDocument(page, doc.title, 1);
  await page.locator('#undoBtn').click();
  await expect(page.locator('#saveStatus')).toHaveText('Исходное состояние · предпросмотр');
  await page.locator(`[data-tab-id="${doc.id}"] .document-tab-close`).click();
  await expect(page.locator(`[data-tab-id="${doc.id}"]`)).toBeVisible();
  expect((await records(page, 'docs')).find(d => d.id === doc.id).elements).toHaveLength(1);
  await page.locator('#redoBtn').click();
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
});

test('startup read failure does not overwrite an existing database with defaults', async ({ page }) => {
  await openHome(page); await createDocument(page, 'Before read denial'); await createText(page, 'До отказа чтения');
  const doc = await exportedDocument(page); await savedDocument(page, doc.title, 1);
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (...args) { if (this.name === 'projects') throw new DOMException('Synthetic read denial', 'UnknownError'); return original.apply(this, args); };
  });
  await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible();
  // Separate readonly inspection bypasses the test-only getAll failure by reading the docs store.
  const persisted = (await records(page, 'docs')).find(d => d.id === doc.id);
  expect(persisted.elements).toEqual(doc.elements); expect(persisted.projectId).toBe(doc.projectId);
  await openLibraryDocument(page, doc.id);
  expect((await exportedDocument(page)).elements).toEqual(doc.elements);
  await expect(page.locator('#saveStatus')).toContainText('сохранение не подтверждено');
});

test('failed project writes preserve resource folders, assets and the old project name in memory', async ({ page }) => {
  await instrument(page); await openHome(page);
  const fixture = JSON.parse(await readFile(path.join(__dirname, 'fixtures/project-with-folders.json'), 'utf8'));
  await importPayload(page, { format: 'kartochnaya-workspace-v1', projects: [{ project: fixture.project, documents: fixture.documents }] });
  await expect(page.locator('#activeProjectName')).toContainText('(импорт)');
  const project = (await records(page, 'projects')).find(p => p.name.includes('(импорт)'));
  await page.evaluate(() => Object.assign(idbControl, { enabled: true, stores: ['projects'], abort: true }));
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.locator('[data-filter="resource"]').click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator(`[data-folder-delete="${project.resourceFolders[0].id}"]`).click();
  await expect(page.locator('#toast')).toContainText('Сохранение не подтверждено');
  await expect(page.locator(`[data-folder-card="${project.resourceFolders[0].id}"]`)).toBeVisible();
  await page.locator(`[data-folder-open="${project.resourceFolders[0].id}"]`).first().click();
  const assetId = project.resources[0].id;
  page.once('dialog', dialog => dialog.accept());
  await page.locator(`[data-assetid="${assetId}"] [data-assetact="remove"]`).click();
  await expect(page.locator(`[data-assetid="${assetId}"]`)).toBeVisible();
  await page.locator('#projectRenameBtn').click(); await page.locator('.rename-project').fill('Uncommitted name');
  await page.locator('.rename-project').press('Enter');
  await expect(page.locator('#activeProjectName')).toHaveText(project.name);
  await page.locator('[data-home-nav="data"]').click();
  await page.locator('#zipStorage').click();
  await expect(page.locator('#zipStatus')).toContainText('Есть неподтверждённая запись');
  await expect(page.locator('#zipConfirm')).toBeDisabled();
  expect((await records(page, 'projects')).find(p => p.id === project.id)).toEqual(project);
  await page.locator('#zipCancel').click();
  // Reload reconciles memory with committed storage; the rejected mutations stay rejected.
  await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible();
  await page.locator('[data-home-nav="data"]').click();
  await page.locator('#zipStorage').click();
  await expect(page.locator('#zipConfirm')).toBeEnabled();
  const pending = page.waitForEvent('download'); await page.locator('#zipConfirm').click();
  const download = await pending;
  const payload = await (await import('../src/backup/archive.mjs')).readBackup(await readFile(await download.path()));
  const exported = payload.data.projects.find(p => p.id === project.id);
  expect(exported.name).toBe(project.name);
  expect(exported.resources).toEqual(project.resources);
  expect(exported.resourceFolders).toEqual(project.resourceFolders);
  expect((await records(page, 'projects')).find(p => p.id === project.id)).toEqual(project);
  expect(errors).toEqual([]);
});

test('aborted font upload does not add a phantom installed font', async ({ page }) => {
  await instrument(page); await openHome(page);
  await page.evaluate(() => Object.assign(idbControl, { enabled: true, stores: ['fonts'], abort: true }));
  await page.locator('[data-home-nav="fonts"]').click();
  await page.locator('#fontInput').setInputFiles(path.join(__dirname, 'fixtures/fonts/DejaVuSans.ttf'));
  await expect(page.locator('#toast')).toContainText('Загружено начертаний: 0');
  expect(await records(page, 'fonts')).toEqual([]);
  await expect(page.locator('#fontList .font-item')).toHaveCount(0);
});

for (const action of ['move category', 'delete category', 'delete custom shape']) {
  test(`shape tray ${action}: settings abort refreshes memory UI without unhandled rejection; recovery commits`, async ({ page }) => {
    await instrument(page);
    await page.addInitScript(() => {
      window.shapeUnhandledRejections = [];
      window.addEventListener('unhandledrejection', event => shapeUnhandledRejections.push(String(event.reason)));
    });
    const uncaught = [];
    page.on('pageerror', error => uncaught.push(error.message));
    await openHome(page); await createDocument(page, 'Shape tray failure');
    const doc = await exportedDocument(page);
    const shape = (id, name) => ({ id, name, d: 'M0 0 L100 0 L50 100 Z', mode: 'fill', outlineCaps: false });
    const sections = [
      { name: 'Категория A', shapes: [shape('custom-a1', 'Фигура A1'), shape('custom-a2', 'Фигура A2')] },
      { name: 'Категория B', shapes: [shape('custom-b', 'Фигура B')] },
      { name: 'Категория C', shapes: [shape('custom-c', 'Фигура C')] },
    ];
    await importPayload(page, { format: 'kartochnaya-v1', document: doc, shapeCatalog: sections });
    await expect(page.locator('#toast')).toHaveText('Документ импортирован');
    const catalogInDB = async () => (await records(page, 'settings')).find(record => record.key === 'shapes-v1')?.sections;
    await expect.poll(catalogInDB).toEqual(sections);
    const expected = structuredClone(sections);
    await page.evaluate(() => Object.assign(idbControl, { enabled: true, stores: ['settings'], abort: true }));
    await page.locator('#dockShapes').click();
    if (action === 'move category') {
      [expected[0], expected[1]] = [expected[1], expected[0]];
      await page.locator('[data-cat-move="0"][data-dir="1"]').click();
    } else if (action === 'delete category') {
      expected.splice(1, 1);
      page.once('dialog', dialog => dialog.accept());
      await page.locator('[data-cat-remove="1"]').click();
    } else {
      expected[0].shapes.shift();
      page.once('dialog', dialog => dialog.accept());
      await page.locator('[data-shape-remove="custom-a1"]').click();
    }
    await expect(page.locator('#toast')).toHaveText('Изменения фигур только в памяти · сохранение не подтверждено');
    await expect.poll(() => page.evaluate(() => idbControl.successes.length)).toBe(1);
    expect(await page.evaluate(() => idbControl.completes)).toBe(0);
    expect(await catalogInDB()).toEqual(sections); // Request success was rolled back by the real transaction.
    const trayNames = () => page.locator('#shapeSections .shape-category-name').evaluateAll(nodes => nodes.map(n => n.firstChild.textContent.trim()));
    const trayIds = () => page.locator('#shapeSections [data-tray-shape]').evaluateAll(nodes => nodes.map(n => n.dataset.trayShape));
    expect(await trayNames()).toEqual(expected.map(group => group.name));
    expect(await trayIds()).toEqual(expected.flatMap(group => group.shapes.map(shape => shape.id)));
    await page.locator('#dockShapes').click();
    const downloadPromise = page.waitForEvent('download'); await page.locator('#jsonExportBtn').evaluate(button => button.click());
    const download = await downloadPromise;
    const payload = JSON.parse(await readFile(await download.path(), 'utf8'));
    expect(payload.shapeCatalog).toEqual(expected); // Unsaved catalog can be rescued from memory.
    expect(uncaught).toEqual([]);
    expect(await page.evaluate(() => shapeUnhandledRejections)).toEqual([]);

    // Remove only the artificial failure. The next ordinary tray action persists the entire current catalog.
    await page.evaluate(() => { idbControl.abort = false; });
    [expected[0], expected[1]] = [expected[1], expected[0]];
    await page.locator('#dockShapes').click();
    await page.locator('[data-cat-move="0"][data-dir="1"]').click();
    await expect.poll(catalogInDB).toEqual(expected);
    expect(await trayNames()).toEqual(expected.map(group => group.name));
    expect(await trayIds()).toEqual(expected.flatMap(group => group.shapes.map(shape => shape.id)));
    expect(await page.evaluate(() => idbControl.completes)).toBe(1);
    await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
    await page.reload(); await openLibraryDocument(page, payload.document.id);
    await page.locator('#dockShapes').click();
    expect(await trayNames()).toEqual(expected.map(group => group.name));
    expect(await trayIds()).toEqual(expected.flatMap(group => group.shapes.map(shape => shape.id)));
    expect(await catalogInDB()).toEqual(expected);
    expect(uncaught).toEqual([]);
    expect(await page.evaluate(() => shapeUnhandledRejections)).toEqual([]);
  });
}
