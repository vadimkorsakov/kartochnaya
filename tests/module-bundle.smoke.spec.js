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

const catalogInput = require('./fixtures/shape-catalog-input.json');
const catalogExpected = require('./fixtures/shape-catalog-expected.json');
const { importPayload } = require('./helpers');

async function importCatalogDocument(page) {
  await openHome(page);
  await createDocument(page, 'Synthetic catalog');
  const document = await exportedDocument(page);
  await importPayload(page, { format: 'kartochnaya-v1', document, shapeCatalog: catalogInput });
  await expect(page.locator('#toast')).toHaveText('Документ импортирован');
  return document;
}
async function savedCatalog(page) {
  return (await records(page, 'settings')).find(row => row.key === 'shapes-v1')?.sections;
}

test('shape catalog module: real file import, export, IndexedDB, reload and canvas insertion', async ({ page }) => {
  await importCatalogDocument(page);
  await expect.poll(() => savedCatalog(page)).toEqual(catalogExpected);
  const download = page.waitForEvent('download');
  await page.locator('#jsonExportBtn').click();
  const file = await download;
  const payload = JSON.parse(await readFile(await file.path(), 'utf8'));
  expect(payload.shapeCatalog).toEqual(catalogExpected);
  await page.locator('#dockShapes').click();
  await expect(page.locator('#shapeSections .shape-category-name').first()).toContainText('Синтетические контуры');
  await expect(page.locator('[data-tray-shape="stage8-triangle"]')).toBeVisible();
  const document = await exportedDocument(page);
  await expect.poll(async () => (await records(page, 'docs')).some(d => d.id === document.id)).toBe(true);
  await page.reload();
  await expect(page.locator('#homeScreen')).toBeVisible();
  await openLibraryDocument(page, document.id);
  await page.locator('#dockShapes').click();
  await expect(page.locator('[data-tray-shape="stage8-triangle"]')).toBeVisible();
  await page.locator('[data-tray-shape="stage8-triangle"]').click();
  await expect(page.locator('#shapeTray')).toBeHidden();
  const result = await exportedDocument(page);
  expect(result.elements).toHaveLength(1);
  expect(result.elements[0]).toMatchObject({ type: 'vector', name: 'Треугольник', vectorId: 'stage8-triangle', vectorD: 'M0 0 L100 0 L50 100 Z' });
  expect(await savedCatalog(page)).toEqual(catalogExpected);
  expect(await page.evaluate(() => Object.hasOwn(window, 'validateShapeCatalog'))).toBe(false);
});

// The importer intentionally logs caught validation errors. Observe the exact error
// here without weakening helpers.js's strict console checks for other tests.
const { test: importErrorTest } = require('@playwright/test');
importErrorTest('shape catalog module: duplicate ID rejects import without replacing saved catalog', async ({ page }, testInfo) => {
  const uncaught = [], errors = [], standaloneWarnings = [];
  page.on('pageerror', error => uncaught.push(error.message));
  page.on('console', message => {
    if (testInfo.project.name === 'standalone' && message.type() === 'error'
      && message.text() === 'A bad HTTP response code (404) was received when fetching the script.') {
      standaloneWarnings.push(message.text()); return;
    }
    const optionalFavicon = message.location().url.endsWith('/favicon.ico') && message.text().includes('404');
    if (message.type() === 'error' && !optionalFavicon) errors.push(message.text());
  });
  await importCatalogDocument(page);
  const before = await savedCatalog(page);
  const document = await exportedDocument(page);
  await expect.poll(async () => (await records(page, 'docs')).some(d => d.id === document.id)).toBe(true);
  await importPayload(page, { format: 'kartochnaya-v1', document,
    shapeCatalog: [{ name: 'Rejected', shapes: [{id:'duplicate',d:'M0 0'}, {id:'duplicate',d:'M1 1'}] }] });
  await expect(page.locator('#toast')).toHaveText('Ошибка: Некорректный контур: duplicate');
  expect(await savedCatalog(page)).toEqual(before);
  await page.locator('#dockShapes').click();
  await expect(page.locator('[data-tray-shape="stage8-triangle"]')).toBeVisible();
  await expect(page.locator('[data-tray-shape="duplicate"]')).toHaveCount(0);
  await expect(page.locator('#shapeSections')).not.toContainText('Rejected');
  await page.reload();
  await expect(page.locator('#homeScreen')).toBeVisible();
  await openLibraryDocument(page, document.id);
  await page.locator('#dockShapes').click();
  await expect(page.locator('[data-tray-shape="stage8-triangle"]')).toBeVisible();
  expect(await savedCatalog(page)).toEqual(before);
  expect(uncaught).toEqual([]);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toContain('Некорректный контур: duplicate');
  if (standaloneWarnings.length) await testInfo.attach('standalone-worker-warning', { body: standaloneWarnings.join('\n'), contentType: 'text/plain' });
});
