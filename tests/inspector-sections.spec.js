const { test, expect, openHome, createDocument, addShape, createText, exportedDocument, savedDocument, openLibraryDocument } = require('./helpers');

test.use({ screenshot: 'off', trace: 'off', video: 'off' });
const key = 'kartochnaya-ui-inspector-sections-v1';
const header = (page, title) => page.locator('#inspector').getByRole('button', { name: title, exact: true });
const body = (page, title) => header(page, title).locator('..').locator('.ins-section-body');

test('desktop sections toggle independently with click, Enter and Space', async ({ page }) => {
  await openHome(page); await createDocument(page); await addShape(page);
  const fill = header(page, 'Заливка');
  await expect(fill).toHaveAttribute('aria-expanded', 'true');
  const fields = await body(page, 'Заливка').locator('input,select,button').count();
  await fill.click();
  await expect(fill).toHaveAttribute('aria-expanded', 'false');
  await expect(body(page, 'Заливка')).toBeHidden();
  expect(await body(page, 'Заливка').locator('input,select,button').count()).toBe(fields);
  await expect(body(page, 'Внешний вид')).toBeVisible();
  await fill.press('Enter');
  await expect(body(page, 'Заливка')).toBeVisible();
  await fill.press('Space');
  await expect(body(page, 'Заливка')).toBeHidden();
  await expect(fill).toBeFocused();
});

test('collapsed titles persist across layer types, documents and reload', async ({ page }) => {
  await openHome(page); await createDocument(page, 'First'); await addShape(page);
  await header(page, 'Эффекты').click();
  await createText(page);
  await expect(header(page, 'Эффекты')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#layers [data-layer]').last().click();
  await expect(body(page, 'Эффекты')).toBeHidden();
  await page.locator('#brandHomeBtn').click();
  await createDocument(page, 'Second'); await addShape(page);
  await expect(header(page, 'Эффекты')).toHaveAttribute('aria-expanded', 'false');
  const id = (await savedDocument(page, 'Second', 1)).id;
  await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible();
  await openLibraryDocument(page, id);
  await page.locator('#layers [data-layer]').first().click();
  await expect(body(page, 'Эффекты')).toBeHidden();
});

test('toggles preserve document and Undo; reopened fields work with broken storage', async ({ page }) => {
  await page.addInitScript(storageKey => localStorage.setItem(storageKey, '{broken'), key);
  await openHome(page); await createDocument(page); await addShape(page);
  const before = await exportedDocument(page);
  const history = await page.locator('#historyEntries').innerHTML();
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Unavailable', 'QuotaExceededError'); }; });
  await header(page, 'Внешний вид').click();
  await header(page, 'Внешний вид').press('Enter');
  expect(await exportedDocument(page)).toEqual(before);
  expect(await page.locator('#historyEntries').innerHTML()).toBe(history);
  await page.locator('#inspector [data-key="opacity"]').fill('42');
  await page.locator('#inspector [data-key="opacity"]').press('Tab');
  expect((await exportedDocument(page)).elements[0].opacity).toBe(42);
  await page.locator('#undoBtn').click();
  expect((await exportedDocument(page)).elements).toEqual(before.elements);
  await page.locator('#undoBtn').click();
  await expect(page.locator('#layers [data-layer]')).toHaveCount(0);
});
