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
  await expect(page.locator('#zipStorage')).toBeVisible();
  await expect(page.locator('#zipBackupDialog')).toBeHidden();
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
  await page.locator('#zipStorage').click();
  await expect(page.locator('#zipConfirm')).toBeEnabled();
  await page.locator('#zipRestore').click();
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

test.describe('local modal layouts without optional service worker', () => {
  test.use({ serviceWorkers: 'block' });
for (const url of ['/', '/standalone/kartochnaya.html']) for (const viewport of [
  { width: 1920, height: 1080 }, { width: 1366, height: 768 },
  { width: 390, height: 844 }, { width: 360, height: 640 },
]) test(`UI-2 local modal geometry, keyboard, focus and preserved selection: ${url} ${viewport.width}x${viewport.height}`, async ({ page }) => {
  await page.setViewportSize(viewport); await openHome(page, url);
  // Let the editor finish its existing first-open normalization before comparing.
  await page.locator('#homeEditorBtn').click(); await page.locator('#documentTabsHome').click(); await page.locator('[data-home-nav=data]').click();
  const before = {};
  for (const store of ['projects', 'docs', 'fonts', 'settings']) before[store] = await records(page, store);
  const row = page.locator('#zipStorage');
  await expect(page.locator('.home-data-grid .home-data-card')).toHaveCount(1);
  const height = (await row.boundingBox()).height;
  expect(height).toBeGreaterThanOrEqual(88); expect(height).toBeLessThanOrEqual(104);
  await row.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#zipConfirm')).toBeEnabled();
  await page.locator('[name=zipScope][value=selected]').check();
  await page.locator('[data-zip-project]').first().uncheck();
  await page.locator('#zipRestore').click();
  await expect(page.locator('#zipOpen')).toBeVisible();
  await page.locator('#zipCreate').click();
  await expect(page.locator('[name=zipScope][value=selected]')).toBeChecked();
  await expect(page.locator('[data-zip-project]').first()).not.toBeChecked();
  await expect(page.locator('#zipConfirm')).toBeDisabled();
  const dimensions = await page.locator('#zipBackupDialog').evaluate(dialog => {
    const box = dialog.getBoundingClientRect(), action = dialog.querySelector('#zipConfirm').getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, actionBottom: action.bottom,
      overflow: dialog.scrollWidth > dialog.clientWidth, scroll: dialog.scrollHeight > dialog.clientHeight,
      locked: getComputedStyle(document.documentElement).overflow };
  });
  expect(dimensions.left).toBeGreaterThanOrEqual(0); expect(dimensions.top).toBeGreaterThanOrEqual(0);
  expect(dimensions.right).toBeLessThanOrEqual(viewport.width); expect(dimensions.bottom).toBeLessThanOrEqual(viewport.height);
  expect(dimensions.actionBottom).toBeLessThanOrEqual(viewport.height); expect(dimensions.overflow).toBe(false); expect(dimensions.scroll).toBe(false);
  expect(dimensions.locked).toBe('hidden');
  await page.locator('#zipStatus').evaluate(node => { node.textContent = 'Длинный результат операции '.repeat(100); });
  expect((await row.boundingBox()).height).toBe(height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.locator('#zipBackupDialog')).toBeHidden(); await expect(row).toBeFocused();
  await row.click(); await expect(page.locator('#zipConfirm')).toBeEnabled();
  await page.locator('#zipBackupDialog [data-backup-close]').click(); await expect(row).toBeFocused();
  for (const store of Object.keys(before)) expect(await records(page, store)).toEqual(before[store]);
});

});
