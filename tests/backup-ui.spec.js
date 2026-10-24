const { readFile } = require('node:fs/promises');
const { test, expect, openHome, createDocument, addShape, records, exportedDocument } = require('./helpers');

async function noJSONControls(page) {
  await expect(page.locator('button:visible, a:visible, input:visible').filter({ hasText: /JSON/i })).toHaveCount(0);
  for (const id of ['jsonInput', 'jsonExportBtn']) {
    await expect(page.locator('#' + id)).toBeHidden();
    await expect(page.locator('#' + id)).toHaveAttribute('tabindex', '-1');
  }
  await expect(page.locator('[data-compact-json], [data-home-action="import-json"], [data-home-action="export-document"], #projectExportShade')).toHaveCount(0);
}

test('backup home creates and verifies ZIP with no JSON controls or data changes', async ({ page }) => {
  await openHome(page);
  // Finish the normal first-open model normalization before observing stored data.
  await page.locator('#homeEditorBtn').click();
  await page.locator('#backupsBtn').click();
  await expect(page.locator('#homeDataPane')).toBeVisible();
  await page.locator('[data-home-nav="workspace"]').click();
  const before = await records(page, 'docs');
  await noJSONControls(page);
  await expect(page.locator('[data-home-nav="data"]')).toHaveText('Резервные копии');
  await page.locator('[data-home-nav="data"]').click();
  await expect(page.locator('#homeDataPane h1')).toHaveText('Резервные копии');
  await expect(page.locator('#homeDataPane .home-pane-heading p')).toHaveText('Сохраняй проекты, документы, ресурсы и шрифты в ZIP-архивах на устройстве или в облаке');
  await expect(page.locator('#homeDataPane .home-data-card')).toHaveCount(1);
  for (const id of ['zipCreate', 'zipOpen']) await expect(page.locator('#' + id)).toBeVisible();
  await noJSONControls(page);
  expect(await records(page, 'docs')).toEqual(before);
  await page.locator('[data-home-nav="workspace"]').click();
  await page.locator('[data-home-action="export-backup"]').click();
  await expect(page.locator('#zipConfirm')).toBeEnabled();
  const pending = page.waitForEvent('download');
  await page.locator('#zipConfirm').click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  expect(await download.failure()).toBeNull();
  const bytes = await readFile(await download.path());
  const { readBackup } = await import('../src/backup/archive.mjs');
  expect((await readBackup(bytes)).data.docs).toEqual(before);
  await page.locator('#zipCancel').click();
  // Use the visible file picker route for verification.
  await page.locator('[data-home-nav="data"]').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#zipOpen').click();
  await (await chooser).setFiles({ name: 'backup.zip', mimeType: 'application/zip', buffer: bytes });
  await expect(page.locator('#zipConfirm')).toBeEnabled();
  await expect(page.locator('#zipStatus')).toContainText('Проверка пройдена');
  expect(await records(page, 'docs')).toEqual(before);
  await page.locator('#zipCancel').click();
  await page.reload();
  expect(await records(page, 'docs')).toEqual(before);
});

for (const menu of [false, true]) test(`editor backup route saves edits and keeps PNG (${menu ? 'menu' : 'sidebar'})`, async ({ page }) => {
  await openHome(page); await createDocument(page, 'UI-1 saved document');
  await addShape(page);
  const document = await exportedDocument(page);
  await expect(page.locator('#exportBtn')).toBeVisible();
  await expect(page.locator('#fontsBtn')).toBeVisible();
  await noJSONControls(page);
  if (menu) {
    await page.locator('#libraryBtn').click();
    await expect(page.locator('[data-compact-page="workspace"]')).toBeVisible();
    await expect(page.locator('[data-compact-page="fonts"]')).toBeVisible();
    await noJSONControls(page);
    await page.locator('[data-compact-full="data"]').click();
  } else await page.locator('#backupsBtn').click();
  await expect(page.locator('#homeDataPane')).toBeVisible();
  expect((await records(page, 'docs')).find(d => d.id === document.id).elements).toEqual(document.elements);
  await page.locator('#homeEditorBtn').click();
  await expect(page.locator('#exportBtn')).toBeVisible();
  expect((await exportedDocument(page)).elements).toEqual(document.elements);
});

for (const menu of [false, true]) test(`failed save prevents backup navigation (${menu ? 'menu' : 'sidebar'})`, async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args);
      if (window.failBackupSave && this.name === 'docs') request.addEventListener('success', () => this.transaction.abort());
      return request;
    };
  });
  await openHome(page); await createDocument(page, 'UI-1 unsaved document');
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  const before = await records(page, 'docs');
  await page.evaluate(() => { window.failBackupSave = true; });
  await addShape(page);
  if (menu) { await page.locator('#libraryBtn').click(); await page.locator('[data-compact-full="data"]').click(); }
  else await page.locator('#backupsBtn').click();
  await expect(page.locator('#toast')).toContainText('Раздел резервных копий не открыт');
  await expect(page.locator('#homeScreen')).toBeHidden();
  await expect(page.locator('#exportBtn')).toBeVisible();
  expect(await records(page, 'docs')).toEqual(before);
});
