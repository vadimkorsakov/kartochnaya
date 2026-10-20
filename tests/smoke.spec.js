const {
  test, expect, fixturePath, openHome, createDocument, exportedDocument, exportPNG,
  canvasPoint, createText, addShape, openLibraryDocument, savedDocument,
} = require('./helpers');
const baseline = require('../docs/baseline-v045.json');

test('Chromium starts the editor without JavaScript errors', async ({ page }) => {
  await openHome(page);
  await expect(page).toHaveTitle('Карточная · v0.45');
  await expect(page.locator('#projectGrid [data-docid]')).toHaveCount(1);
  const schema = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('kartochnaya_local_v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const schema = { database: db.name, version: db.version, stores: [...db.objectStoreNames].sort() };
    db.close();
    return schema;
  });
  expect(schema).toEqual(baseline.storage);
});

test('creates a new empty document with requested dimensions', async ({ page }) => {
  await openHome(page);
  await createDocument(page);
  const document = await exportedDocument(page);
  expect(document).toMatchObject({ title: 'Baseline smoke', type: 'template', width: 320, height: 240, elements: [] });
});

test('creates a text layer and edits its content through the inline editor', async ({ page }) => {
  await openHome(page);
  await createDocument(page);
  await createText(page, 'Начальный текст');
  expect((await exportedDocument(page)).elements).toEqual([
    expect.objectContaining({ type: 'text', text: 'Начальный текст' }),
  ]);
  // The text tool stays active in v0.45; return to selection before editing.
  await page.locator('#dockSelect').click();
  const point = await canvasPoint(page, 70, 65);
  await page.mouse.dblclick(point.x, point.y);
  await expect(page.locator('#inlineText')).toBeVisible();
  await page.locator('#inlineText').fill('Изменённый текст\nВторая строка');
  await page.locator('#inlineText').press('ControlOrMeta+Enter');
  expect((await exportedDocument(page)).elements).toEqual([
    expect.objectContaining({ type: 'text', text: 'Изменённый текст\nВторая строка' }),
  ]);
});

test('adds a simple rectangle from the existing shape catalogue', async ({ page }) => {
  await openHome(page);
  await createDocument(page);
  await addShape(page);
  expect((await exportedDocument(page)).elements).toEqual([
    expect.objectContaining({ type: 'vector', vectorId: 'basic0', visible: true }),
  ]);
  await expect(page.locator('#layers [data-layer]')).toHaveCount(1);
});

test('imports a synthetic image through the photo tool and renders it', async ({ page }) => {
  await openHome(page);
  await createDocument(page);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.dock-tool[data-add="image"]').click();
  await (await chooser).setFiles(fixturePath('sample.png'));
  await expect(page.locator('#layers [data-layer]')).toHaveCount(1);
  const document = await exportedDocument(page);
  expect(document.elements).toHaveLength(1);
  expect(document.elements[0]).toMatchObject({ type: 'image', fillType: 'image' });
  expect(document.elements[0].imageSrc).toMatch(/^data:image\//);
  const { image } = await exportPNG(page);
  const colors = new Set();
  for (let i = 0; i < image.data.length; i += 4) colors.add(image.data.subarray(i, i + 4).toString('hex'));
  expect(colors.size, 'Export contains the uploaded coloured image, not only the white background').toBeGreaterThan(2);
});

test('Undo removes the added shape and Redo restores the same layer', async ({ page }) => {
  await openHome(page);
  await createDocument(page);
  await addShape(page);
  const original = await exportedDocument(page);
  await page.locator('#undoBtn').click();
  expect((await exportedDocument(page)).elements).toEqual([]);
  await expect(page.locator('#layers [data-layer]')).toHaveCount(0);
  await page.locator('#redoBtn').click();
  expect((await exportedDocument(page)).elements).toEqual(original.elements);
  await expect(page.locator('#layers [data-layer]')).toHaveCount(1);
});

test('persists to IndexedDB and restores the document after reload', async ({ page }) => {
  await openHome(page);
  await createDocument(page, 'Persistence smoke');
  await addShape(page);
  const before = await exportedDocument(page);
  const saved = await savedDocument(page, 'Persistence smoke', 1);
  expect(saved.elements).toEqual(before.elements);
  await page.reload();
  await expect(page.locator('#homeScreen')).toBeVisible();
  await openLibraryDocument(page, saved.id);
  const restored = await exportedDocument(page);
  expect(restored).toMatchObject({ id: saved.id, title: saved.title, width: 320, height: 240 });
  expect(restored.elements).toEqual(before.elements);
  await expect(page.locator('#layers [data-layer]')).toHaveCount(1);
});

test('exports a nonempty PNG with the expected dimensions and visible shape', async ({ page }) => {
  await openHome(page);
  await createDocument(page);
  await addShape(page);
  const { image } = await exportPNG(page);
  const at = (160 + 120 * image.width) * 4;
  expect([...image.data.subarray(at, at + 4)]).toEqual([171, 146, 251, 255]);
});
