const { readFile } = require('node:fs/promises');
const { test, expect, openHome, records } = require('./helpers');

test.use({ serviceWorkers: 'block' });
for (const url of ['/', '/standalone/kartochnaya.html']) for (const viewport of [
  { width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 390, height: 844 }, { width: 360, height: 640 },
]) test(`unified local ZIP, offline, reopen and geometry ${url} ${viewport.width}x${viewport.height}`, async ({ page, context }) => {
  await page.setViewportSize(viewport); await openHome(page, url);
  await page.locator('#homeEditorBtn').click(); await page.locator('#documentTabsHome').click(); await page.locator('[data-home-nav=data]').click();
  const before = await records(page, 'docs'), requests = [];
  page.on('request', req => requests.push(req.url())); await context.setOffline(true);
  await page.locator('#createBackups').click(); await expect(page.locator('#cloudConnectionHint')).toContainText('без облаков');
  await page.locator('#cloudStart').click(); await expect(page.locator('#cloudSave')).toBeVisible();
  const dimensions = await page.locator('#cloudBackupDialog').evaluate(d => {
    const b = d.getBoundingClientRect(), a = d.querySelector('#cloudSave').getBoundingClientRect();
    return { left: b.left, right: b.right, bottom: b.bottom, top: b.top, action: a.bottom, overflow: d.scrollWidth > d.clientWidth };
  });
  expect(dimensions.left).toBeGreaterThanOrEqual(0); expect(dimensions.top).toBeGreaterThanOrEqual(0); expect(dimensions.right).toBeLessThanOrEqual(viewport.width); expect(dimensions.bottom).toBeLessThanOrEqual(viewport.height); expect(dimensions.action).toBeLessThanOrEqual(viewport.height); expect(dimensions.overflow).toBe(false);
  const pending = page.waitForEvent('download'); await page.locator('#cloudSave').click(); const download = await pending;
  const bytes = await readFile(await download.path()); const { readBackup } = await import('../src/backup/archive.mjs');
  const archive = await readBackup(bytes); expect(archive.manifest.scope).toBe('workspace'); expect(archive.data.docs).toEqual(before);
  await expect(page.locator('#cloudStatus')).toContainText('Проверь фактическое сохранение');
  await page.keyboard.press('Escape'); await expect(page.locator('#createBackups')).toBeFocused();
  await page.locator('#createBackups').click(); await expect(page.locator('#cloudSave')).toBeHidden(); await expect(page.locator('#cloudStart')).toBeVisible();
  await page.locator('#cloudStart').click(); await expect(page.locator('#cloudSave')).toBeVisible();
  await expect(page.locator('#cloudArchive')).not.toContainText(archive.manifest.backupId);
  await page.locator('#cloudFinish').click(); expect(await records(page, 'docs')).toEqual(before);
  expect(requests.filter(url => !url.startsWith('blob:'))).toEqual([]);
});

test('prepared replacement keeps its modal and lease until explicit cancellation', async ({ page }) => {
  await openHome(page); await page.locator('[data-home-nav=data]').click(); await page.locator('#createBackups').click(); await page.locator('#cloudStart').click();
  await expect(page.locator('#cloudSave')).toBeVisible(); const pending = page.waitForEvent('download'); await page.locator('#cloudSave').click(); const bytes = await readFile(await (await pending).path()); await page.locator('#cloudFinish').click();
  await page.locator('#zipStorage').click(); await expect(page.locator('#zipConfirm')).toBeEnabled(); await page.locator('#zipRestore').click(); await page.locator('#zipInput').setInputFiles({ name: 'workspace.zip', mimeType: 'application/zip', buffer: bytes });
  await expect(page.locator('#zipConfirm')).toBeEnabled(); await page.locator('[name=zipRestoreMode][value=replace]').check(); await page.locator('#zipReplacePrepare').click(); await expect(page.locator('#zipReplaceReady')).toBeVisible();
  await page.locator('#createBackups').evaluate(button => button.click()); await expect(page.locator('#cloudBackupDialog')).toBeHidden(); await expect(page.locator('#zipReplaceReady')).toBeVisible();
  await page.locator('#zipCancel').click(); await page.locator('#createBackups').click(); await page.locator('#cloudStart').click(); await expect(page.locator('#cloudSave')).toBeVisible();
});

for (const saves of [1, 2]) test(`download URLs survive immediate finish after ${saves} saves and expire normally`, async ({ page }) => {
  await openHome(page); await page.clock.install();
  await page.evaluate(() => {
    window.zipURLs = []; window.zipRevoked = [];
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); if (blob.type === 'application/zip') window.zipURLs.push(url); return url; };
    URL.revokeObjectURL = url => { window.zipRevoked.push(url); revoke(url); };
  });
  await page.locator('[data-home-nav=data]').click(); await page.locator('#createBackups').click(); await page.locator('#cloudStart').click(); await expect(page.locator('#cloudSave')).toBeVisible();
  const downloads = [];
  for (let i = 0; i < saves; i++) { const pending = page.waitForEvent('download'); await page.locator('#cloudSave').click(); downloads.push(await pending); }
  await page.locator('#cloudFinish').click();
  expect(await page.evaluate(() => window.zipURLs.length)).toBe(saves);
  expect(await page.evaluate(() => window.zipURLs.filter(url => window.zipRevoked.includes(url)))).toEqual([]);
  for (const download of downloads) { expect(await download.failure()).toBeNull(); const { readBackup } = await import('../src/backup/archive.mjs'); await readBackup(await readFile(await download.path())); }
  await page.locator('#createBackups').click(); await expect(page.locator('#cloudSave')).toBeHidden();
  await page.clock.fastForward(30001);
  expect(await page.evaluate(() => window.zipURLs.every(url => window.zipRevoked.includes(url)))).toBe(true);
});
