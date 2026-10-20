const { readFile } = require('node:fs/promises');
const path = require('node:path');
const {
  test, expect, openHome, createDocument, addShape, exportedDocument,
  exportPNG, records, openLibraryDocument,
} = require('./helpers');

test('module bundle smoke: color, modular gradient, PNG and IndexedDB reopening', async ({ page }) => {
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

test('gradient factory integration: unique stop ids, imported interpolation, radial PNG and persisted order', async ({ page }) => {
  await openHome(page);
  await createDocument(page, 'Gradient ES module persistence');
  await addShape(page);
  await page.locator('#inspector [data-fill-open="fill"]').click();
  await page.locator('#fillPopover [data-fill-mode="gradient"]').click();
  const initialIds = await page.locator('[data-stop-row]').evaluateAll(rows => rows.map(row => row.dataset.stopRow));
  async function change(selector, value) {
    await page.locator(selector).fill(value);
    await page.locator(selector).press('Tab');
  }
  for (const [index, color, alpha] of [[0, '#000000', '20'], [1, '#ffffff', '80']]) {
    await change(`[data-stop-hex="${initialIds[index]}"]`, color);
    await change(`[data-stop-alpha="${initialIds[index]}"]`, alpha);
  }
  await page.locator('[data-gstop-add]').click();
  await expect(page.locator('[data-stop-row]')).toHaveCount(3);
  await page.locator('#fillPopover [data-fill-close]').click();
  const linear = await exportedDocument(page), element = linear.elements[0];
  const ids = element.gradientStops.map(s => s.id);
  expect(ids.every(id => typeof id === 'string' && id.length > 0)).toBe(true);
  expect(new Set([linear.id, element.id, ...ids]).size).toBe(5);
  expect([ids[0], ids[2]]).toEqual(initialIds);
  expect(element.gradientStops[1]).toEqual({id:ids[1],pos:50,color:'#808080',alpha:50});
  for (const point of [element.gradientStart, element.gradientEnd]) {
    expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
  }
  const linearPNG = await exportPNG(page);
  await page.locator('#inspector [data-fill-open="fill"]').click();
  await page.locator('#cpGradientMode').selectOption('radial');
  await change(`[data-stop-position="${ids[1]}"]`, '37');
  await page.locator('#fillPopover [data-fill-close]').click();
  const document = await exportedDocument(page);
  expect(document.elements[0].gradientMode).toBe('radial');
  expect(document.elements[0].gradientStops).toEqual([
    {id:ids[0],pos:0,color:'#000000',alpha:20},
    {id:ids[1],pos:37,color:'#808080',alpha:50},
    {id:ids[2],pos:100,color:'#ffffff',alpha:80},
  ]);
  const png = await exportPNG(page);
  expect(png.image.data).not.toEqual(linearPNG.image.data);
  await expect.poll(async () => (await records(page, 'docs')).find(d => d.id === document.id)?.elements)
    .toEqual(document.elements);
  await page.reload();
  await expect(page.locator('#homeScreen')).toBeVisible();
  await openLibraryDocument(page, document.id);
  expect((await exportedDocument(page)).elements).toEqual(document.elements);
  expect((await exportPNG(page)).image.data).toEqual(png.image.data);
});
