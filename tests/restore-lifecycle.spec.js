const { test, expect, openHome, createDocument, addShape } = require('./helpers');
const { contents, observeRestore, idle, selectReplace, ready, retryable } = require('./restore-lifecycle-helpers');

async function archive() {
  const data = { projects: [{ id: 'f08-project', name: 'F-08 archive' }], docs: [{ ...structuredClone(require('./fixtures/linked-document.json').document), id: 'f08-doc', projectId: 'f08-project' }], fonts: [], settings: [{ key: 'f08-archive', value: 'verified' }] };
  return { data, ...(await (await import('../src/backup/archive.mjs')).createBackup(data)) };
}
async function load(page, bytes) {
  await page.locator('#zipInput').setInputFiles({ name: 'f08.zip', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
  await expect(page.locator('#zipStatus')).toContainText('Проверка пройдена'); await idle(page);
}
async function confirm(page) {
  page.once('dialog', dialog => dialog.accept());
  await Promise.all([page.waitForEvent('load'), page.locator('#zipConfirm').click()]);
  await expect(page.locator('#homeScreen')).toBeVisible();
}

for (const stage of ['comparison', 'prepare', 'recomparison', 'locks']) test('F-08 baseline: verified local ZIP survives ' + stage, async ({ page, context }) => {
  await observeRestore(page); await openHome(page); const zip = await archive(); await load(page, zip.bytes);
  const before = await contents(page), probe = await page.evaluate(() => ({ ...restoreProbe }));
  let second;
  if (stage !== 'comparison') await selectReplace(page);
  if (stage === 'recomparison') { await ready(page); await page.locator('[name=zipRestoreMode][value=copies]').check(); await idle(page); }
  if (stage === 'locks') { second = await context.newPage(); await openHome(second); }
  else await page.evaluate(() => { restoreProbe.failReads = true; });
  if (stage === 'comparison' || stage === 'recomparison') await selectReplace(page);
  else await page.locator('#zipReplacePrepare').click();
  await expect(page.locator('#zipStatus')).toContainText(stage === 'locks' ? 'другое активное окно' : 'F-08 temporary');
  expect(await contents(page)).toEqual(before);
  expect((await page.evaluate(() => restoreProbe.writes))).toBe(probe.writes);
  await retryable(page, stage === 'locks' ? 'другое активное окно' : undefined);
  if (second) await second.close();
  await page.evaluate(() => { restoreProbe.failReads = false; });
  // A fresh prepare must include data written since the failed attempt.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open('kartochnaya_local_v1', 3);
    r.onsuccess = () => {
      const db = r.result, t = db.transaction('settings', 'readwrite');
      t.objectStore('settings').put({ key: 'f08-new-current', value: 'after failure' });
      t.oncomplete = () => { db.close(); resolve(); }; t.onabort = () => reject(t.error);
    };
  }));
  const reads = await page.evaluate(() => restoreProbe.reads);
  await ready(page); expect(await page.evaluate(() => restoreProbe.reads)).toBeGreaterThan(reads);
  const row = page.locator('#zipComparison tr').filter({ hasText: 'Записей settings' });
  await expect(row.locator('td').nth(1)).toHaveText(String(before.settings.length + 1));
  const writes = await page.evaluate(() => restoreProbe.writes);
  expect(writes).toBe(probe.writes + 1); // only the deliberate external change
  // Record completed replacement transactions across the application's reload.
  await page.evaluate(() => {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(names, mode, ...args) {
      const tx = transaction.call(this, names, mode, ...args);
      if (mode === 'readwrite' && Array.isArray(names) && names.length === 4) {
        sessionStorage.setItem('f08-replacements', String(Number(sessionStorage.getItem('f08-replacements') || 0) + 1));
        tx.addEventListener('complete', () => sessionStorage.setItem('f08-complete', 'yes'));
      }
      return tx;
    };
  });
  await confirm(page);
  expect(await contents(page)).toEqual(zip.data);
  expect(await page.evaluate(() => [sessionStorage.getItem('f08-replacements'), sessionStorage.getItem('f08-complete')])).toEqual(['1', 'yes']);
  await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible(); expect(await contents(page)).toEqual(zip.data);
});

test('F-08 asynchronous readonly abort releases locks and allows fresh preparation', async ({ page }) => {
  await observeRestore(page); await openHome(page); await load(page, (await archive()).bytes); await selectReplace(page);
  const before = await contents(page), writes = await page.evaluate(() => restoreProbe.writes);
  await page.evaluate(() => { restoreProbe.abortReads = true; }); await page.locator('#zipReplacePrepare').click();
  await retryable(page, 'Не удалось подготовить'); expect(await contents(page)).toEqual(before);
  await page.evaluate(() => { restoreProbe.abortReads = false; }); await ready(page);
  expect(await page.evaluate(() => restoreProbe.writes)).toBe(writes);
});

for (const errorName of ['SecurityError', 'NotAllowedError']) test('F-08 access denial discards trusted source: ' + errorName, async ({ page }) => {
  await observeRestore(page); await openHome(page); await load(page, (await archive()).bytes); await selectReplace(page);
  const before = await contents(page), writes = await page.evaluate(() => restoreProbe.writes);
  await page.evaluate(name => { restoreProbe.failReads = true; restoreProbe.readFailure = name; }, errorName);
  await page.locator('#zipReplacePrepare').click(); await expect(page.locator('#zipStatus')).toContainText('Не удалось завершить'); await idle(page);
  await expect(page.locator('#zipReplacePrepare')).toHaveCount(0); await expect(page.locator('#zipConfirm')).toBeDisabled();
  await page.evaluate(() => { restoreProbe.failReads = false; });
  await page.locator('#zipCreate').click(); await expect(page.locator('#zipConfirm')).toBeEnabled(); await page.locator('#zipRestore').click();
  await expect(page.locator('[name=zipRestoreMode]')).toHaveCount(0); await expect(page.locator('#zipConfirm')).toBeDisabled();
  expect(await contents(page)).toEqual(before); expect(await page.evaluate(() => restoreProbe.writes)).toBe(writes);
});

for (const close of ['cancel', 'close', 'Escape']) test('F-08 retry view releases archive on ' + close, async ({ page }) => {
  await page.setViewportSize({ width: close === 'close' ? 1280 : 360, height: 640 });
  await observeRestore(page); await openHome(page); await load(page, (await archive()).bytes);
  const before = await contents(page); await page.evaluate(() => { restoreProbe.failReads = true; }); await selectReplace(page); await retryable(page);
  const geometry = await page.locator('#zipReplacePrepare').boundingBox();
  expect(geometry.y).toBeGreaterThanOrEqual(0); expect(geometry.y + geometry.height).toBeLessThanOrEqual(640);
  await page.evaluate(() => { restoreProbe.failReads = false; });
  if (close === 'Escape') await page.keyboard.press('Escape');
  else await page.locator(close === 'cancel' ? '#zipCancel' : '#zipBackupDialog [data-backup-close]').click();
  await expect(page.locator('#zipBackupDialog')).not.toBeVisible();
  await page.locator('#zipRestore').evaluate(n => n.click());
  await expect(page.locator('[name=zipRestoreMode]')).toHaveCount(0); await expect(page.locator('#zipConfirm')).toBeDisabled();
  expect(await contents(page)).toEqual(before);
  await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible(); expect(await contents(page)).toEqual(before);
});

test('F-08 retry cannot bypass sticky workspace writeFailure', async ({ page }) => {
  await observeRestore(page); await page.addInitScript(() => {
    window.failProjectWrite = false;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) {
      const r = put.apply(this, args);
      if (window.failProjectWrite && this.name === 'projects') r.addEventListener('success', () => this.transaction.abort());
      return r;
    };
  });
  await openHome(page); const before = await contents(page);
  // The ordinary project handler crosses dbOp/workspaceBarrier and aborts a real write.
  await page.evaluate(() => { window.failProjectWrite = true; document.querySelector('#newProjectName').value = 'Failed project'; document.querySelector('#createProjectBtn').click(); });
  await expect.poll(() => page.evaluate(() => restoreProbe.aborts)).toBeGreaterThan(0);
  await page.evaluate(() => { window.failProjectWrite = false; });
  await load(page, (await archive()).bytes); await selectReplace(page); await retryable(page, 'неподтверждённая запись');
  for (let i = 0; i < 2; i++) {
    await page.locator('#zipReplacePrepare').click(); await retryable(page, 'неподтверждённая запись');
    expect(await contents(page)).toEqual(before);
  }
});

test('F-08 successful retry still refuses drift inside the replacement transaction', async ({ page }) => {
  await observeRestore(page); await openHome(page); await load(page, (await archive()).bytes); await selectReplace(page);
  await page.evaluate(() => { restoreProbe.failReads = true; }); await page.locator('#zipReplacePrepare').click(); await retryable(page);
  await page.evaluate(() => { restoreProbe.failReads = false; }); await ready(page);
  await page.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open('kartochnaya_local_v1'); r.onsuccess = () => {
      const db = r.result, tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ key: 'f08-drift', value: 'must survive' });
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    };
  }));
  const before = await contents(page), probe = await page.evaluate(() => ({ ...restoreProbe }));
  page.once('dialog', d => d.accept()); await page.locator('#zipConfirm').click();
  await expect(page.locator('#zipStatus')).toContainText('Не удалось завершить'); await idle(page);
  expect(await contents(page)).toEqual(before); await expect(page.locator('#zipConfirm')).toBeDisabled();
  expect(await page.evaluate(() => [restoreProbe.writes - 1, restoreProbe.aborts - 1, restoreProbe.completes])).toEqual([probe.writes, probe.aborts, probe.completes]);
  await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible(); expect(await contents(page)).toEqual(before);
});

test('F-08 invalid SHA ZIP discards the previously retained archive', async ({ page }) => {
  await observeRestore(page); await openHome(page); const zip = await archive(); await load(page, zip.bytes);
  const before = await contents(page); await page.evaluate(() => { restoreProbe.failReads = true; }); await selectReplace(page); await retryable(page);
  const { unzipSync, zipSync, strFromU8, strToU8 } = require('fflate');
  const files = unzipSync(zip.bytes), manifest = JSON.parse(strFromU8(files['manifest.json'])); manifest.files[0].sha256 = '0'.repeat(64); files['manifest.json'] = strToU8(JSON.stringify(manifest));
  await page.locator('#zipInput').setInputFiles({ name: 'bad-sha.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync(files, { level: 0 })) });
  await expect(page.locator('#zipStatus')).toContainText('SHA-256 не совпадает'); await idle(page);
  await expect(page.locator('#zipConfirm')).toBeDisabled(); await expect(page.locator('#zipReplacePrepare')).toHaveCount(0);
  await page.evaluate(() => { restoreProbe.failReads = false; }); await page.locator('#zipCancel').click(); await page.locator('#zipRestore').evaluate(n => n.click());
  await expect(page.locator('[name=zipRestoreMode]')).toHaveCount(0); expect(await contents(page)).toEqual(before);
});

test('F-08 post-commit failure reports committed database and requires manual reload', async ({ page }) => {
  await observeRestore(page); await page.addInitScript(() => {
    let failClose = false;
    const transaction = IDBDatabase.prototype.transaction, close = IDBDatabase.prototype.close;
    IDBDatabase.prototype.transaction = function(names, mode, ...args) {
      const tx = transaction.call(this, names, mode, ...args);
      if (Array.isArray(names) && names.length === 4 && mode === 'readwrite') tx.addEventListener('complete', () => { failClose = true; });
      return tx;
    };
    IDBDatabase.prototype.close = function(...args) {
      if (failClose) { failClose = false; throw Error('F-08 failure after confirmed commit'); }
      return close.apply(this, args);
    };
  });
  await openHome(page); const zip = await archive(); await load(page, zip.bytes); await selectReplace(page); await ready(page);
  const probe = await page.evaluate(() => ({ ...restoreProbe }));
  page.once('dialog', d => d.accept()); await page.locator('#zipConfirm').click();
  await expect(page.locator('#zipStatus')).toContainText('Транзакция IndexedDB уже подтверждена');
  await expect(page.locator('#zipStatus')).toContainText('Перезагрузи приложение вручную');
  await expect(page.locator('#zipStatus')).not.toContainText('Замена не выполнена');
  await expect(page.locator('#zipConfirm')).toBeDisabled(); expect(await contents(page)).toEqual(zip.data);
  expect(await page.evaluate(() => [restoreProbe.writes - 1, restoreProbe.completes - 1])).toEqual([probe.writes, probe.completes]);
  await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible(); expect(await contents(page)).toEqual(zip.data);
});

test('F-08 retry waits for the latest document revision and transaction complete', async ({ page }) => {
  await observeRestore(page); await page.addInitScript(() => {
    window.holdF08Doc = false; window.releaseF08Docs = [];
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) {
      const request = put.apply(this, args), store = this;
      if (store.name === 'docs' && window.holdF08Doc) request.addEventListener('success', () => {
        let released = false; window.releaseF08Docs.push(() => { released = true; });
        const pump = () => { if (!released) store.count().addEventListener('success', pump); }; pump();
      });
      return request;
    };
  });
  await openHome(page); await createDocument(page, 'F-08 current revision'); await addShape(page); await page.locator('#documentTabsHome').click();
  await load(page, (await archive()).bytes); await selectReplace(page);
  await page.evaluate(() => { restoreProbe.failReads = true; }); await page.locator('#zipReplacePrepare').click(); await retryable(page);
  await page.evaluate(() => { restoreProbe.failReads = false; window.holdF08Doc = true; });
  const before = (await contents(page)).docs.find(d => d.title === 'F-08 current revision');
  await page.locator('#layers [data-layeract=visibility]').first().evaluate(n => n.click());
  await page.locator('#zipReplacePrepare').click();
  await expect.poll(() => page.evaluate(() => window.releaseF08Docs.length)).toBeGreaterThan(0);
  await expect(page.locator('#zipBackupDialog')).toHaveAttribute('aria-busy', 'true'); await expect(page.locator('#zipConfirm')).toBeDisabled();
  await page.evaluate(() => { window.holdF08Doc = false; window.releaseF08Docs.splice(0).forEach(release => release()); });
  await expect(page.locator('#zipConfirm')).toBeEnabled(); await idle(page);
  const pending = page.waitForEvent('download'); await page.locator('#zipSafetyDownload').click(); const file = await pending;
  const saved = await (await import('../src/backup/archive.mjs')).readBackup(new Uint8Array(await require('node:fs/promises').readFile(await file.path())));
  const current = (await contents(page)).docs.find(d => d.id === before.id);
  expect(current.elements[0].visible).toBe(false); expect(before.elements[0].visible).toBe(true);
  expect(saved.data.docs.find(d => d.id === before.id)).toEqual(current);
  await page.locator('#zipCancel').click(); await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible();
  expect((await contents(page)).docs.find(d => d.id === before.id)).toEqual(current);
});

test('F-08 retry view survives mode changes with no prepared authority', async ({ page }) => {
  await observeRestore(page); await openHome(page); await load(page, (await archive()).bytes); await selectReplace(page);
  await page.evaluate(() => { restoreProbe.failReads = true; }); await page.locator('#zipReplacePrepare').click(); await retryable(page);
  await page.evaluate(() => { restoreProbe.failReads = false; });
  await page.locator('#zipCreate').click(); await expect(page.locator('#zipConfirm')).toBeEnabled();
  await page.locator('#zipRestore').click(); await retryable(page);
  await ready(page); await page.locator('#zipCreate').click(); await expect(page.locator('#zipConfirm')).toBeEnabled();
  await page.locator('#zipRestore').click(); await expect(page.locator('#zipConfirm')).toBeDisabled(); await expect(page.locator('#zipReplacePrepare')).toBeEnabled();
  expect((await page.evaluate(() => navigator.locks.query())).held.some(l => l.mode === 'exclusive')).toBe(false);
  await ready(page);
});
