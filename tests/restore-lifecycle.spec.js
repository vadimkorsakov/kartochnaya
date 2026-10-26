const { test, expect, openHome } = require('./helpers');
const { contents, observeRestore, idle, selectReplace, ready, retryable } = require('./restore-lifecycle-helpers');

async function archive() {
  const data = { projects: [{ id: 'f08-project', name: 'F-08 archive' }], docs: [], fonts: [], settings: [{ key: 'f08-archive', value: 'verified' }] };
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
