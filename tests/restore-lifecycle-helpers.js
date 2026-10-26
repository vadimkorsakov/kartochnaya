const { expect, records } = require('./helpers');
const stores = ['projects', 'docs', 'fonts', 'settings'];

async function contents(page) {
  return Object.fromEntries(await Promise.all(stores.map(async name => [name, await records(page, name)])));
}

// Faults affect actual browser IDB transactions, never archive validation or app hooks.
async function observeRestore(page) {
  await page.addInitScript(() => {
    window.restoreProbe = { failReads: false, readFailure: 'InvalidStateError', abortReads: false, reads: 0, writes: 0, completes: 0, aborts: 0 };
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(names, mode, ...args) {
      const workspace = Array.isArray(names) && names.length === 4;
      if (workspace && mode === 'readonly') {
        restoreProbe.reads++;
        if (restoreProbe.failReads) throw new DOMException('F-08 temporary workspace read failure', restoreProbe.readFailure);
      }
      const tx = transaction.call(this, names, mode, ...args);
      if (workspace && mode === 'readonly' && restoreProbe.abortReads) {
        const request = tx.objectStore('projects').getAll();
        request.addEventListener('success', () => tx.abort());
      }
      if (mode === 'readwrite') {
        restoreProbe.writes++;
        tx.addEventListener('complete', () => restoreProbe.completes++);
        tx.addEventListener('abort', () => restoreProbe.aborts++);
      }
      return tx;
    };
  });
}
async function idle(page) { await expect(page.locator('#zipBackupDialog')).not.toHaveAttribute('aria-busy', 'true'); }
async function selectReplace(page) {
  await page.locator('[name=zipRestoreMode][value=replace]').check(); await idle(page);
}
async function ready(page) {
  await page.locator('#zipReplacePrepare').click();
  await expect(page.locator('#zipReplaceReady')).toBeVisible();
  await expect(page.locator('#zipConfirm')).toBeEnabled(); await idle(page);
}
async function retryable(page, reason = 'F-08 temporary workspace read failure') {
  await expect(page.locator('#zipStatus')).toContainText(reason); await idle(page);
  await expect(page.locator('#zipConfirm')).toBeDisabled();
  const locks = await page.evaluate(() => navigator.locks.query());
  expect(locks.held.filter(lock => lock.mode === 'exclusive')).toEqual([]);
  await expect(page.locator('#zipReplacePrepare')).toBeVisible();
  await expect(page.locator('#zipReplacePrepare')).toBeEnabled();
  await expect(page.locator('[name=zipRestoreMode][value=replace]')).toBeChecked();
  await expect(page.locator('#zipReplaceReady')).toBeHidden();
}
module.exports = { contents, observeRestore, idle, selectReplace, ready, retryable };
