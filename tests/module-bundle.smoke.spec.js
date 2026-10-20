const { readFile } = require('node:fs/promises');
const path = require('node:path');
const {
  test, expect, openHome, createDocument, addShape, exportedDocument,
  exportPNG, records, openLibraryDocument,
} = require('./helpers');

test('module bundle smoke: color, legacy gradient, PNG and IndexedDB reopening', async ({ page }) => {
  const scriptRequests = [];
  page.on('request', r => { if (r.resourceType() === 'script') scriptRequests.push(r.url()); });
  await openHome(page);
  const served = await page.request.get(page.url());
  expect(await served.body()).toEqual(await readFile(path.join(__dirname, '../dist/kartochnaya.html')));
  await expect(page.locator('script')).toHaveCount(1);
  await expect(page.locator('script[src], script[type="module"]')).toHaveCount(0);
  const title = 'Модули <цвет> & градиент';
  await createDocument(page, title);
  await addShape(page);
  await page.locator('#inspector [data-fill-open="fill"]').click();
  await page.locator('#cpFormat').selectOption('HEX');
  const hex = page.getByRole('textbox', { name: 'HEX 1', exact: true });
  await hex.fill('#123456'); await hex.press('Tab');
  await page.locator('#fillPopover [data-fill-close]').click();
  expect((await exportedDocument(page)).elements[0].fill).toBe('#123456');
  const solid = await exportPNG(page);
  const center = (120 * 320 + 160) * 4;
  expect([...solid.image.data.subarray(center, center + 4)]).toEqual([18, 52, 86, 255]);
  await page.locator('#inspector [data-fill-open="fill"]').click();
  await page.locator('#fillPopover [data-fill-mode="gradient"]').click();
  await expect(page.locator('[data-stop-row]')).toHaveCount(2);
  await page.locator('[data-gstop-add]').click();
  await expect(page.locator('[data-stop-row]')).toHaveCount(3);
  await page.locator('#fillPopover [data-fill-close]').click();
  const document = await exportedDocument(page);
  expect(document.title).toBe(title);
  expect(document.elements[0]).toMatchObject({ fillType: 'gradient' });
  expect(document.elements[0].gradientStops.map(s => [s.pos, s.color])).toEqual([
    [0, '#123456'], [50, '#87605f'], [100, '#fb8c67'],
  ]);
  const png = await exportPNG(page);
  expect(png.image.data).not.toEqual(solid.image.data);
  await expect.poll(async () => (await records(page, 'docs')).find(d => d.id === document.id)?.elements)
    .toEqual(document.elements);
  await page.reload();
  await expect(page.locator('#homeScreen')).toBeVisible();
  await openLibraryDocument(page, document.id);
  expect((await exportedDocument(page)).elements).toEqual(document.elements);
  expect((await exportPNG(page)).image.data).toEqual(png.image.data);
  expect(scriptRequests, 'No external JavaScript or ES module requests, including reload').toEqual([]);
});
