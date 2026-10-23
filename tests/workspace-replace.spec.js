const { readFile } = require('node:fs/promises');
const { test, expect, openHome, records, createDocument, addShape } = require('./helpers');
const linked = require('./fixtures/linked-document.json');
const catalog = require('./fixtures/shape-catalog-expected.json');
const model = () => import('../src/backup/archive.mjs');
const stores = ['projects', 'docs', 'fonts', 'settings'];
async function all(page) { const out = {}; for (const name of stores) out[name] = await records(page, name); return out; }
async function incoming(options) {
  const data = {
    projects: [{ id: 'restored-one', name: 'One', createdAt: 111, future: { raw: ['keep'] } }, { id: 'restored-two', name: 'Two', updatedAt: 222 }],
    docs: ['restored-one', 'restored-two'].map((projectId, i) => ({ ...structuredClone(linked.document), id: 'restored-doc-' + i, projectId, createdAt: 123, updatedAt: 456, future: { raw: i } })),
    fonts: [{ id: 'restored-font', name: 'DejaVuSans.ttf', family: 'DejaVu Sans', weight: 400, style: 'normal', future: 'keep', data: 'data:font/ttf;base64,' + (await readFile(require.resolve('./fixtures/fonts/DejaVuSans.ttf'))).toString('base64') }],
    settings: [{ key: 'shapes-v1', sections: catalog }, { key: 'historical-setting', raw: { keep: true } }],
  };
  const preferences = { 'kartochnaya-layer-width': '345', 'kartochnaya-ink-v1': '{"size":25}', 'kartochnaya-shapes-v1': '[]' };
  return { data, preferences, ...(await (await model()).createBackup(data, { preferences, ...options })) };
}
async function preview(page, bytes) {
  await page.locator('#zipInput').setInputFiles({ name: 'restore.zip', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
  await expect(page.locator('#zipConfirm')).toBeEnabled();
}
async function replaceMode(page, bytes) {
  await preview(page, bytes); await page.locator('[name=zipRestoreMode][value=replace]').check();
  await expect(page.locator('#zipComparison')).toContainText('Текущие данные');
  await expect(page.locator('#zipReplacePrepare')).toBeEnabled();
  await expect(page.locator('#zipBackupDialog')).not.toHaveAttribute('aria-busy', 'true');
}
async function prepare(page) {
  await page.locator('#zipReplacePrepare').click();
  await expect(page.locator('#zipReplaceReady')).toBeVisible();
  await expect(page.locator('#zipConfirm')).toBeEnabled();
  await expect(page.locator('#zipBackupDialog')).not.toHaveAttribute('aria-busy', 'true');
}
async function safety(page) {
  const pending = page.waitForEvent('download'); await page.locator('#zipSafetyDownload').click();
  const file = await pending, bytes = await readFile(await file.path());
  await expect(page.locator('#zipStatus')).toContainText('передан браузеру');
  return bytes;
}
async function confirmReplacement(page) {
  page.once('dialog', async dialog => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toContain('документы, проекты, шрифты и настройки');
    await dialog.accept();
  });
  await page.locator('#zipConfirm').click();
}
async function commit(page) {
  await Promise.all([page.waitForEvent('load'), confirmReplacement(page)]);
  await expect(page.locator('#homeScreen')).toBeVisible();
}
async function fault(page) {
  await page.addInitScript(() => {
    window.replaceFault = { abortAt: 0, requestFailure: false, successes: 0, failIDB: false, failSnapshot: false, failLocal: false, failPackaging: false, failDownload: false, hold: false, releases: [], replacements: 0 };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (...args) {
      if (replaceFault.failDownload && this.download && this.href.startsWith('blob:')) throw Error('Injected browser download failure');
      return click.apply(this, args);
    };
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = (...args) => { if (replaceFault.failPackaging) throw Error('Injected ZIP packaging failure'); return digest(...args); };
    const tx = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (names, mode, ...args) {
      const replacement = mode === 'readwrite' && Array.isArray(names) && names.length === 4;
      if (replaceFault.failSnapshot && mode === 'readonly' && Array.isArray(names) && names.length === 4) throw new DOMException('Injected safety snapshot failure', 'InvalidStateError');
      if (replacement && replaceFault.failIDB) throw new DOMException('Injected IDB failure', 'InvalidStateError');
      const t = tx.call(this, names, mode, ...args); if (replacement) replaceFault.replacements++;
      return t;
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const r = put.apply(this, args), t = this.transaction, s = this;
      if (t.mode === 'readwrite' && t.objectStoreNames.length === 4) r.addEventListener('success', () => {
        if (++replaceFault.successes === replaceFault.abortAt) t.abort();
        if (replaceFault.requestFailure && replaceFault.successes === 2) t.objectStore('projects').add({ id: 'restored-one' });
      });
      if (s.name === 'docs' && replaceFault.hold && t.mode === 'readwrite') r.addEventListener('success', () => {
        let release = false; replaceFault.releases.push(() => { release = true; });
        const pump = () => { if (!release) s.count().addEventListener('success', pump); }; pump();
      });
      return r;
    };
    const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (k, v) { if (this === localStorage && replaceFault.failLocal && k === 'kartochnaya-layer-width') throw Error('Injected localStorage failure'); return set.call(this, k, v); };
    Storage.prototype.removeItem = function (k) { if (this === localStorage && replaceFault.failLocal && k === 'kartochnaya-layer-width') throw Error('Injected localStorage failure'); return remove.call(this, k); };
  });
}

for (const withSafety of [false, true]) test(`full replacement ${withSafety ? 'with optional ZIP' : 'without ZIP'}: projects, documents, fonts, settings and reopen`, async ({ page }) => {
  await fault(page); await openHome(page); await createDocument(page, 'Old active'); await addShape(page);
  await page.locator('#documentTabsHome').click(); await createDocument(page, 'Old inactive'); await addShape(page);
  await page.locator('#documentTabsHome').click(); const oldIDs = (await all(page)).docs.map(x => x.id);
  await page.evaluate(() => localStorage.setItem('token', 'private'));
  const archive = await incoming(); await replaceMode(page, archive.bytes);
  let downloads = 0; page.on('download', () => downloads++);
  await prepare(page);
  expect(downloads).toBe(0);
  if (withSafety) {
    const saved = await (await model()).readBackup(await safety(page));
    expect(saved.data).toEqual({ ...(await all(page)), preferences: await page.evaluate(() => Object.fromEntries(['kartochnaya-layer-width', 'kartochnaya-ink-v1', 'kartochnaya-shapes-v1'].flatMap(k => localStorage.getItem(k) === null ? [] : [[k, localStorage.getItem(k)]]))) });
    expect(saved.data.docs.map(x => x.id)).toEqual(expect.arrayContaining(oldIDs));
  }
  expect(downloads).toBe(withSafety ? 1 : 0);
   await commit(page);
  await expect(page.locator('#toast')).toContainText('транзакция IndexedDB подтверждена');
  const after = await all(page);
  expect(after.projects).toEqual(archive.data.projects); expect(after.fonts).toEqual(archive.data.fonts); expect(after.settings).toEqual([...archive.data.settings].sort((a, b) => a.key.localeCompare(b.key)));
  expect(after.docs.map(x => x.id)).toEqual(archive.data.docs.map(x => x.id));
  for (const doc of after.docs) {
    const original = archive.data.docs.find(x => x.id === doc.id);
    for (const k of ['projectId', 'createdAt', 'updatedAt', 'future', 'elements']) expect(doc[k]).toEqual(original[k]);
  }
  expect(await page.evaluate(() => Object.fromEntries(['kartochnaya-layer-width', 'kartochnaya-ink-v1', 'kartochnaya-shapes-v1', 'token'].map(k => [k, localStorage.getItem(k)])))).toEqual({ ...archive.preferences, token: 'private' });
  // Debounced saves and beforeunload have both had a chance to run; reopen again.
  await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible();
  expect((await all(page)).docs.map(x => x.id)).toEqual(archive.data.docs.map(x => x.id));
  expect(await page.locator('[data-tab-id]').count()).toBe(0);
  await page.screenshot({ path: test.info().outputPath('restored.png') });
});
test('refuse replacement without preparation and refuse selected-projects ZIP', async ({ page }) => {
  await openHome(page); const archive = await incoming(); await replaceMode(page, archive.bytes);
  const before = await all(page); await expect(page.locator('#zipConfirm')).toBeDisabled(); expect(await all(page)).toEqual(before);
  await page.locator('#zipCancel').click(); await preview(page, (await incoming({ selectedIds: ['restored-one'] })).bytes);
  await expect(page.locator('[name=zipRestoreMode][value=replace]')).toBeDisabled(); expect(await all(page)).toEqual(before);
});
test('invalid incoming ZIP after preparation releases the session and cannot prepare or write', async ({ page }) => {
  await openHome(page); const archive = await incoming();
  const badCRC = Buffer.from(archive.bytes); badCRC[60] ^= 1;
  for (const bytes of [badCRC, Buffer.from('not zip')]) {
    await replaceMode(page, archive.bytes); await prepare(page); const before = await all(page);
    await page.locator('#zipInput').setInputFiles({ name: 'wrong.zip', mimeType: 'application/zip', buffer: bytes });
    await expect(page.locator('#zipStatus')).toContainText('Не удалось'); await expect(page.locator('#zipConfirm')).toBeDisabled();
    await expect(page.locator('#zipReplacePrepare')).toHaveCount(0); expect(await all(page)).toEqual(before);
    const locks = await page.evaluate(() => navigator.locks.query()); expect(locks.held.some(x => x.mode === 'exclusive')).toBe(false);
    await page.locator('#zipCancel').click();
  }
});
for (const abortAt of [1, 3]) test(`genuine transaction rollback after ${abortAt} successful put requests`, async ({ page }) => {
  await fault(page); await openHome(page); await replaceMode(page, (await incoming()).bytes); await prepare(page); const before = await all(page);
  await page.evaluate(n => { replaceFault.abortAt = n; }, abortAt); await confirmReplacement(page);
  await expect(page.locator('#zipStatus')).toContainText('Не удалось'); expect(await all(page)).toEqual(before);
  expect(await page.evaluate(() => replaceFault.successes)).toBe(abortAt); expect(await page.evaluate(() => replaceFault.replacements)).toBe(1);
  await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible(); expect((await all(page)).projects).toEqual(before.projects);
});
test('IDB failure before opening replacement transaction leaves original data', async ({ page }) => {
  await fault(page); await openHome(page); await replaceMode(page, (await incoming()).bytes); await prepare(page); const before = await all(page);
  await page.evaluate(() => { replaceFault.failIDB = true; }); await confirmReplacement(page);
  await expect(page.locator('#zipStatus')).toContainText('Injected IDB failure'); expect(await all(page)).toEqual(before);
});
test('external database drift after preparation is checked under the replacement transaction lock', async ({ page }) => {
  await openHome(page); await replaceMode(page, (await incoming()).bytes); await prepare(page);
  await page.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open('kartochnaya_local_v1', 3); r.onsuccess = () => { const db = r.result, t = db.transaction('settings', 'readwrite'); t.objectStore('settings').put({ key: 'external-change' }); t.oncomplete = () => { db.close(); resolve(); }; t.onerror = reject; };
  }));
  const before = await all(page); await confirmReplacement(page); await expect(page.locator('#zipStatus')).toContainText('Не удалось'); expect(await all(page)).toEqual(before);
});
test('localStorage failure after commit is explicit and safety ZIP remains readable', async ({ page }) => {
  await fault(page); await openHome(page); const archive = await incoming(); await replaceMode(page, archive.bytes); await prepare(page); const backup = await safety(page);
  const messages = []; page.on('dialog', async dialog => { messages.push(dialog.message()); if (dialog.type() === 'alert') await dialog.accept(); });
  await page.evaluate(() => { replaceFault.failLocal = true; }); await commit(page);
  await expect.poll(() => messages.join(' ')).toContain('Частичное восстановление настроек');
  expect((await all(page)).projects).toEqual(archive.data.projects);
  expect((await (await model()).readBackup(backup)).manifest.scope).toBe('workspace');
});
test('another active instance blocks replacement and closing it allows a new preparation', async ({ page, context }) => {
  await openHome(page); const second = await context.newPage(); await openHome(second); await replaceMode(page, (await incoming()).bytes); const before = await all(page);
  await page.locator('#zipReplacePrepare').click(); await expect(page.locator('#zipStatus')).toContainText('другое активное окно'); expect(await all(page)).toEqual(before);
  await second.close(); await page.locator('#zipCancel').click(); await replaceMode(page, (await incoming()).bytes); await prepare(page); await page.locator('#zipCancel').click();
});
test('new instance cannot start with stale data during exclusive safety lock', async ({ page, context }) => {
  await openHome(page); const archive = await incoming(); await replaceMode(page, archive.bytes); await prepare(page);
  const second = await context.newPage(); await second.goto('/');
  const locks = await second.evaluate(() => navigator.locks.query()); expect(locks.pending.some(x => x.name === 'kartochnaya-workspace-v1')).toBe(true);
  await commit(page); await expect(second.locator('#createTemplateBtn')).toBeVisible(); await expect.poll(async () => (await all(second)).projects).toEqual(archive.data.projects); await second.close();
});
test('preparation waits for a genuine pending save; frozen old timers cannot resurrect old docs', async ({ page }) => {
  await fault(page); await openHome(page); await createDocument(page, 'Pending old'); await addShape(page); await page.locator('#documentTabsHome').click();
  await replaceMode(page, (await incoming()).bytes); await page.evaluate(() => { replaceFault.hold = true; });
  await page.locator('#zipReplacePrepare').click();
  await expect.poll(() => page.evaluate(() => replaceFault.releases.length)).toBeGreaterThan(0); await expect(page.locator('#zipConfirm')).toBeDisabled();
  await page.evaluate(() => { replaceFault.hold = false; replaceFault.releases.splice(0).forEach(f => f()); });
  await expect(page.locator('#zipConfirm')).toBeEnabled(); await commit(page);
  await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible(); expect((await all(page)).docs.every(x => x.id.startsWith('restored-doc-'))).toBe(true);
});

test('a genuine ConstraintError request after successful writes rolls back every store', async ({ page }) => {
  await fault(page); await openHome(page); await replaceMode(page, (await incoming()).bytes); await prepare(page); const before = await all(page);
  page.once('dialog', dialog => dialog.accept());
  await page.evaluate(() => { replaceFault.requestFailure = true; document.querySelector('#zipConfirm').click(); document.querySelector('#zipConfirm').click(); });
  await expect(page.locator('#zipStatus')).toContainText('Не удалось');
  expect(await page.evaluate(() => replaceFault.successes)).toBeGreaterThan(2); expect(await page.evaluate(() => replaceFault.replacements)).toBe(1); expect(await all(page)).toEqual(before);
});
test('replacement is refused when Web Locks is unavailable', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
  await openHome(page); await replaceMode(page, (await incoming()).bytes); const before = await all(page);
  await page.locator('#zipReplacePrepare').click(); await expect(page.locator('#zipStatus')).toContainText('не поддерживает Web Locks'); expect(await all(page)).toEqual(before);
});

test('safety snapshot failure produces no download and preserves existing stores', async ({ page }) => {
  await fault(page); await openHome(page); await replaceMode(page, (await incoming()).bytes); const before = await all(page); let downloads = 0;
  page.on('download', () => downloads++); await page.evaluate(() => { replaceFault.failSnapshot = true; });
  await page.locator('#zipReplacePrepare').click(); await expect(page.locator('#zipStatus')).toContainText('Injected safety snapshot failure');
  await expect(page.locator('#zipConfirm')).toBeDisabled(); expect(downloads).toBe(0); expect(await all(page)).toEqual(before);
});
test('simultaneous replacement attempts in two loaded windows both refuse without dropping stale-state protection', async ({ page, context }) => {
  // Widen the real shared→exclusive gap: without the intent lock both windows
  // would release shared ownership before the browser evaluates either upgrade.
  await context.addInitScript(() => {
    const request = LockManager.prototype.request;
    LockManager.prototype.request = function (...args) {
      if (args[0] === 'kartochnaya-workspace-v1' && args[1]?.mode === 'exclusive') return new Promise(resolve => setTimeout(resolve, 100)).then(() => request.apply(this, args));
      return request.apply(this, args);
    };
  });
  await openHome(page); const second = await context.newPage(); await openHome(second); const archive = await incoming();
  await Promise.all([replaceMode(page, archive.bytes), replaceMode(second, archive.bytes)]);
  const before = await all(page); let downloads = 0; page.on('download', () => downloads++); second.on('download', () => downloads++);
  await Promise.all([page.evaluate(() => document.querySelector('#zipReplacePrepare').click()), second.evaluate(() => document.querySelector('#zipReplacePrepare').click())]);
  await expect(page.locator('#zipStatus')).toContainText('Не удалось'); await expect(second.locator('#zipStatus')).toContainText('Не удалось');
  expect(downloads).toBe(0); expect(await all(page)).toEqual(before);
  const locks = await page.evaluate(() => navigator.locks.query()); expect(locks.held.filter(x => x.name === 'kartochnaya-workspace-v1' && x.mode === 'shared')).toHaveLength(2);
  await second.close(); await page.locator('#zipCancel').click(); await replaceMode(page, archive.bytes); await prepare(page); await commit(page);
  expect((await all(page)).projects).toEqual(archive.data.projects);
});

for (const failure of ['failPackaging', 'failDownload']) test(`optional ZIP ${failure} stays explicit and does not prevent commit without a copy`, async ({ page }) => {
  await fault(page); await openHome(page); const archive = await incoming(); await replaceMode(page, archive.bytes); await prepare(page);
  let downloads = 0; page.on('download', () => downloads++);
  await page.evaluate(key => { replaceFault[key] = true; }, failure); await page.locator('#zipSafetyDownload').click();
  await expect(page.locator('#zipStatus')).toContainText(failure === 'failPackaging' ? 'Не удалось скачать копию: Injected ZIP packaging failure' : 'Не удалось скачать копию: Injected browser download failure');
  await expect(page.locator('#zipConfirm')).toBeEnabled(); expect(downloads).toBe(0);
  await page.evaluate(key => { replaceFault[key] = false; }, failure); await commit(page);
  expect((await all(page)).projects).toEqual(archive.data.projects);
});
for (const escape of [false, true]) test(`cancel prepared replacement using ${escape ? 'Escape' : 'button'} releases lock and allows editing and re-preparation`, async ({ page }) => {
  await openHome(page); const archive = await incoming(); await replaceMode(page, archive.bytes); await prepare(page);
  if (escape) await page.keyboard.press('Escape'); else await page.locator('#zipCancel').click();
  await expect(page.locator('#zipBackupDialog')).not.toBeVisible();
  const locks = await page.evaluate(() => navigator.locks.query()); expect(locks.held.some(x => x.mode === 'exclusive')).toBe(false);
  await createDocument(page, 'After cancel'); await addShape(page); await page.locator('#documentTabsHome').click();
  await replaceMode(page, archive.bytes); await prepare(page); await commit(page);
  expect((await all(page)).projects).toEqual(archive.data.projects);
});
test('declining final confirmation preserves prepared data and allows cancellation', async ({ page }) => {
  await openHome(page); await replaceMode(page, (await incoming()).bytes); await prepare(page); const before = await all(page);
  page.once('dialog', dialog => dialog.dismiss()); await page.locator('#zipConfirm').click();
  await expect(page.locator('#zipConfirm')).toBeEnabled(); expect(await all(page)).toEqual(before);
  await page.locator('#zipCancel').click(); await expect(page.locator('#zipBackupDialog')).not.toBeVisible();
});
test('localStorage drift requires fresh preparation and no database writes', async ({ page }) => {
  await openHome(page); await replaceMode(page, (await incoming()).bytes); await prepare(page); const before = await all(page);
  await page.evaluate(() => localStorage.setItem('kartochnaya-layer-width', '390')); await confirmReplacement(page);
  await expect(page.locator('#zipStatus')).toContainText('Настройки изменились'); expect(await all(page)).toEqual(before);
  await expect(page.locator('#zipConfirm')).toBeDisabled(); await page.locator('#zipCancel').click();
});

test('reopening a valid ZIP after preparation releases the prior session and requires a fresh prepare', async ({ page }) => {
  await openHome(page); const archive = await incoming(); await replaceMode(page, archive.bytes); await prepare(page);
  await replaceMode(page, archive.bytes); await expect(page.locator('#zipConfirm')).toBeDisabled();
  const locks = await page.evaluate(() => navigator.locks.query()); expect(locks.held.some(x => x.mode === 'exclusive')).toBe(false);
  await prepare(page); await commit(page); expect((await all(page)).projects).toEqual(archive.data.projects);
});
