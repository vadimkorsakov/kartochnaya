const {
  test, expect, openHome, createDocument, addShape, exportedDocument,
  exportPNG, records, openLibraryDocument,
} = require('./helpers');

async function createGradient(page, title) {
  await openHome(page);
  await createDocument(page, title);
  await addShape(page);
  await page.locator('#inspector [data-fill-open="fill"]').click();
  await page.locator('#fillPopover [data-fill-mode="gradient"]').click();
  await expect(page.locator('#fillPopover [data-stop-row]')).toHaveCount(2);
}
async function change(page, selector, value) {
  await page.locator(selector).fill(value);
  await page.locator(selector).press('Tab');
}
async function closeFill(page) { await page.locator('#fillPopover [data-fill-close]').click(); }
async function reopen(page, document, png) {
  await expect.poll(async () => (await records(page, 'docs')).find(item => item.id === document.id)?.elements)
    .toEqual(document.elements);
  await page.reload();
  await expect(page.locator('#homeScreen')).toBeVisible();
  await openLibraryDocument(page, document.id);
  expect((await exportedDocument(page)).elements).toEqual(document.elements);
  expect((await exportPNG(page)).image.data).toEqual(png.image.data);
}

test('gradient add button is square and aligned to the right of the select', async ({page}) => {
  await createGradient(page, 'Gradient controls layout');
  const mode = page.locator('.cp-gradient-mode');
  const select = page.locator('#cpGradientMode');
  const add = page.locator('[data-gstop-add]');
  await expect(add).toHaveText('+');
  await expect(add).toHaveAttribute('title', 'Добавить точку');
  await expect(add).toHaveAccessibleName('Добавить точку градиента');
  for (const width of [null, '180px']) {
    if (width) await mode.evaluate((element, value) => { element.style.width = value; }, width);
    const row = await mode.boundingBox();
    const field = await select.boundingBox();
    const button = await add.boundingBox();
    expect(Math.abs(button.width - button.height)).toBeLessThanOrEqual(1);
    expect(button.x).toBeGreaterThan(field.x + field.width);
    expect(Math.abs(button.y - field.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(button.y + button.height - field.y - field.height)).toBeLessThanOrEqual(1);
    expect(button.x + button.width).toBeLessThanOrEqual(row.x + row.width + 1);
  }
});

test('gradient endpoint colors and opacity persist through JSON, PNG and IndexedDB reopening', async ({page}) => {
  await createGradient(page, 'Gradient persistence');
  await closeFill(page);
  const before = await exportPNG(page);
  const initial = (await exportedDocument(page)).elements[0].gradientStops;
  expect(initial.map(s => s.pos)).toEqual([0,100]);
  expect(initial.every(s => typeof s.id === 'string' && s.id.length > 0)).toBe(true);
  await page.locator('#inspector [data-fill-open="fill"]').click();
  await change(page, `[data-stop-hex="${initial[0].id}"]`, '#ff0000');
  await change(page, `[data-stop-hex="${initial[1].id}"]`, '#0000ff');
  await change(page, `[data-stop-alpha="${initial[0].id}"]`, '40');
  await closeFill(page);
  const document = await exportedDocument(page);
  expect(document.elements[0].gradientStops).toEqual([
    {id:initial[0].id,pos:0,color:'#ff0000',alpha:40},
    {id:initial[1].id,pos:100,color:'#0000ff',alpha:100},
  ]);
  const png = await exportPNG(page);
  expect(png.image.data).not.toEqual(before.image.data);
  // Existing UI creates a vertical gradient. The lower pixel is bluer.
  const pixel = y => [...png.image.data.subarray((y * 320 + 160)*4,(y * 320 + 160)*4+3)];
  expect(pixel(150)[2]).toBeGreaterThan(pixel(90)[2]);
  await reopen(page, document, png);
});

test('adding an interpolated point and moving it past an endpoint sorts and saves the same ids', async ({page}) => {
  await createGradient(page, 'Gradient third stop');
  const ids = await page.locator('[data-stop-row]').evaluateAll(rows => rows.map(row => row.dataset.stopRow));
  await change(page, `[data-stop-hex="${ids[0]}"]`, '#000000');
  await change(page, `[data-stop-hex="${ids[1]}"]`, '#ffffff');
  await page.locator('[data-gstop-add]').click();
  await expect(page.locator('[data-stop-row]')).toHaveCount(3);
  const allIds = await page.locator('[data-stop-row]').evaluateAll(rows => rows.map(row => row.dataset.stopRow));
  const added = allIds.find(id => !ids.includes(id));
  expect(added).toBeTruthy();
  await closeFill(page);
  const middle = (await exportedDocument(page)).elements[0].gradientStops[1];
  expect(middle).toEqual({id:added,pos:50,color:'#808080',alpha:100});
  await page.locator('#inspector [data-fill-open="fill"]').click();
  await change(page, `[data-stop-position="${ids[0]}"]`, '75');
  await change(page, `[data-stop-position="${added}"]`, '25');
  expect(await page.locator('[data-stop-row]').evaluateAll(rows => rows.map(row => row.dataset.stopRow))).toEqual([added, ids[0], ids[1]]);
  await closeFill(page);
  const document = await exportedDocument(page);
  expect(document.elements[0].gradientStops.map(s => [s.id,s.pos])).toEqual([[added,25],[ids[0],75],[ids[1],100]]);
  expect(document.elements[0].gradientStops[0].color).toBe('#808080');
  await reopen(page, document, await exportPNG(page));
});
