const { PNG } = require('pngjs');
const {
  test, expect, openHome, createDocument, createText, canvasPoint, addShape,
  exportedDocument, exportPNG, savedDocument, openLibraryDocument, records,
} = require('./helpers');

const layerIds = page => page.locator('#layers [data-layer]').evaluateAll(rows => rows.map(row => row.dataset.layer));
const elements = async page => (await exportedDocument(page)).elements;
async function deselect(page) {
  await page.locator('#dockSelect').click();
  const point = await canvasPoint(page, 300, 220);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#layers .selected')).toHaveCount(0);
}
async function canvasPixels(page) {
  // Read the public Canvas bitmap only; no application internals or test hooks.
  const url = await page.locator('#canvas').evaluate(canvas => canvas.toDataURL('image/png'));
  return PNG.sync.read(Buffer.from(url.split(',')[1], 'base64'));
}
async function reopen(page, document) {
  await savedDocument(page, document.title, document.elements.length);
  await expect.poll(async () => (await records(page, 'docs')).find(item => item.id === document.id)?.elements,
    { message: 'Wait for the latest layer content and order to be saved' }).toEqual(document.elements);
  await page.reload();
  await expect(page.locator('#homeScreen')).toBeVisible();
  await openLibraryDocument(page, document.id);
}

test('text edits keep the displayed Canvas and PNG export pixel-identical at 100% zoom', async ({ page }) => {
  // The fit limit is exactly 300% at this viewport; UI zoom buttons reach 100%.
  await page.setViewportSize({ width: 1920, height: 1440 });
  await openHome(page);
  await createDocument(page, 'Core text rendering');
  await expect(page.locator('#zoomLabel')).toHaveText('300%');
  for (let i = 0; i < 20; i++) await page.locator('#zoomOutBtn').click();
  await expect(page.locator('#zoomLabel')).toHaveText('100%');
  await createText(page, 'Первый текст');
  await deselect(page);
  const before = await exportPNG(page);
  expect((await canvasPixels(page)).data).toEqual(before.image.data);
  const point = await canvasPoint(page, 70, 65);
  await page.mouse.dblclick(point.x, point.y);
  await expect(page.locator('#inlineText')).toBeVisible();
  await page.locator('#inlineText').fill('Новый текст\nLine two');
  await page.locator('#inlineText').press('ControlOrMeta+Enter');
  await deselect(page);
  const after = await exportPNG(page);
  expect(after.image.data).not.toEqual(before.image.data);
  const canvas = await canvasPixels(page);
  expect({ width: canvas.width, height: canvas.height }).toEqual({ width: 320, height: 240 });
  expect(canvas.data).toEqual(after.image.data);
  expect(await elements(page)).toEqual([expect.objectContaining({ type: 'text', text: 'Новый текст\nLine two' })]);
});

test('layer reorder is one keyboard Undo/Redo step and survives saving and reopening', async ({ page }) => {
  await openHome(page);
  await createDocument(page, 'Core layer history');
  for (let i = 0; i < 3; i++) await addShape(page);
  const original = await elements(page);
  const ids = original.map(element => element.id);
  expect(await layerIds(page)).toEqual([...ids].reverse());
  const rows = page.locator('#layers [data-layer]');
  const from = await rows.first().locator('.layer-name').boundingBox();
  const to = await rows.last().boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 90, to.y + to.height - 3, { steps: 12 });
  await page.mouse.up();
  const reordered = [{ ...original[2], groupId: null }, original[0], original[1]];
  expect(await elements(page)).toEqual(reordered);
  expect(await layerIds(page)).toEqual(reordered.map(element => element.id).reverse());
  // Focus the actual Canvas so both legacy key listeners would be eligible.
  await page.locator('#canvas').focus();
  await page.keyboard.press('ControlOrMeta+z');
  expect(await elements(page)).toEqual(original);
  await page.locator('#canvas').focus();
  await page.keyboard.press('ControlOrMeta+Shift+z');
  expect(await elements(page)).toEqual(reordered);
  // Also detect a duplicate undo that removes more than the last added object.
  await page.locator('#canvas').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await elements(page)).toEqual(original.slice(0, 2));
  await page.keyboard.press('ControlOrMeta+y');
  await page.keyboard.press('ControlOrMeta+y');
  expect(await elements(page)).toEqual(reordered);
  const document = await exportedDocument(page);
  await reopen(page, document);
  expect(await elements(page)).toEqual(reordered);
  expect(await layerIds(page)).toEqual(reordered.map(element => element.id).reverse());
});

test('document tabs preserve their own selection, zoom and Undo history', async ({ page }) => {
  await openHome(page);
  await createDocument(page, 'Core tab A');
  await addShape(page);
  const first = await exportedDocument(page);
  const firstZoom = await page.locator('#zoomLabel').textContent();
  await page.locator('#documentTabsHome').click();
  await createDocument(page, 'Core tab B');
  await createText(page, 'Текст документа B');
  await page.locator('#zoomOutBtn').click();
  const second = await exportedDocument(page);
  const secondZoom = await page.locator('#zoomLabel').textContent();
  expect(secondZoom).not.toBe(firstZoom);
  for (const [document, zoom] of [[first, firstZoom], [second, secondZoom], [first, firstZoom]]) {
    await page.locator(`[data-tab-id="${document.id}"]`).click();
    await expect(page.locator(`[data-tab-id="${document.id}"]`)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#zoomLabel')).toHaveText(zoom);
    expect((await exportedDocument(page)).id).toBe(document.id);
    expect(await elements(page)).toEqual(document.elements);
    await expect(page.locator(`#layers [data-layer="${document.elements[0].id}"]`)).toHaveClass(/selected/);
  }
  await page.locator('#undoBtn').click();
  expect(await elements(page)).toEqual([]);
  await page.locator(`[data-tab-id="${second.id}"]`).click();
  expect(await elements(page)).toEqual(second.elements);
  await page.locator(`[data-tab-id="${first.id}"]`).click();
  await page.locator('#redoBtn').click();
  expect(await elements(page)).toEqual(first.elements);
});

test('boundary text follows its source shape and retains the link and rendered PNG after reload', async ({ page }) => {
  await openHome(page);
  await createDocument(page, 'Core boundary text');
  await addShape(page);
  const source = (await elements(page))[0];
  const point = await canvasPoint(page, 160, 120);
  await page.mouse.click(point.x, point.y, { button: 'right' });
  await page.locator('#contextBoundaryText').click();
  await expect(page.locator('#inlineText')).toBeVisible();
  await page.locator('#inlineText').fill('Контур ABC');
  await page.locator('#inlineText').press('ControlOrMeta+Enter');
  const before = await elements(page);
  expect(before).toHaveLength(2);
  expect(before[1]).toMatchObject({ type: 'text', textMode: 'boundary', text: 'Контур ABC', pathBoundary: { sourceId: source.id } });
  const beforePNG = await exportPNG(page);
  await page.locator(`#layers [data-layer="${source.id}"] .layer-name`).click();
  await page.locator('#canvas').focus();
  await page.keyboard.press('Shift+ArrowRight');
  const after = await elements(page);
  expect(after[0].x).toBe(source.x + 10);
  expect(after[1].x).toBe(before[1].x + 10);
  expect(after[1].pathBoundary.sourceId).toBe(source.id);
  const afterPNG = await exportPNG(page);
  expect(afterPNG.image.data).not.toEqual(beforePNG.image.data);
  // Hiding just the text must change the bitmap: the boundary wrapper renders glyphs.
  await page.locator(`#layers [data-layer="${after[1].id}"] [data-layeract="visibility"]`).click();
  expect((await exportPNG(page)).image.data).not.toEqual(afterPNG.image.data);
  await page.locator('#undoBtn').click();
  const document = await exportedDocument(page);
  await reopen(page, document);
  expect(await elements(page)).toEqual(document.elements);
  expect((await exportPNG(page)).image.data).toEqual(afterPNG.image.data);
});
