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

const { canvasPoint } = require('./helpers');

async function rotatedGeometryDocument(page, gradient = false) {
  await openHome(page);
  await createDocument(page, gradient ? 'Rotated gradient geometry' : 'Rotated rectangle geometry');
  const document = await exportedDocument(page);
  // Synthetic public JSON input, with a plain rectangle so its exact visible
  // bounds are known independently of the production geometry functions.
  document.elements = [{id:'geometry-rect',name:'Geometry rectangle',type:'rect',
    x:100,y:80,w:100,h:40,rotation:90,opacity:100,visible:true,locked:false,
    fillType:gradient?'gradient':'solid',fill:'#ff0000',fill2:'#0000ff',fillOpacity:100,
    stroke:'#000000',strokeWidth:0,corner:0,
    ...(gradient ? {gradientMode:'linear',gradientStart:{x:.2,y:.5},gradientEnd:{x:.8,y:.5},
      gradientStops:[{id:'geometry-stop-a',pos:0,color:'#ff0000',alpha:100},
        {id:'geometry-stop-b',pos:100,color:'#0000ff',alpha:100}]} : {})}];
  await importPayload(page,{format:'kartochnaya-v1',document});
  await expect(page.locator('#toast')).toHaveText('Документ импортирован');
  await page.locator('#dockSelect').click();
  return (await exportedDocument(page)).elements[0];
}
async function clickDocumentPoint(page,x,y) {
  const p=await canvasPoint(page,x,y);
  await page.mouse.click(p.x,p.y);
}
async function dragDocumentPoint(page,from,to) {
  const a=await canvasPoint(page,...from), b=await canvasPoint(page,...to);
  await page.mouse.move(a.x,a.y);
  await page.mouse.down();
  await page.mouse.move(b.x,b.y,{steps:8});
  await page.mouse.up();
}
async function reopenGeometry(page,document,png) {
  await expect.poll(async () => (await records(page,'docs')).find(d=>d.id===document.id)?.elements).toEqual(document.elements);
  await page.reload();
  await expect(page.locator('#homeScreen')).toBeVisible();
  await openLibraryDocument(page,document.id);
  expect((await exportedDocument(page)).elements).toEqual(document.elements);
  expect((await exportPNG(page)).image.data).toEqual(png.image.data);
}

test('geometry module: rotated hit testing, mouse move/resize, Undo/Redo, JSON and PNG reopening', async ({page}) => {
  const initial=await rotatedGeometryDocument(page);
  await page.keyboard.press('Escape');
  // Rotation 90 makes the visible rectangle [130,50]–[170,150].
  // (110,90) is inside its unrotated frame but outside the visible rectangle.
  await clickDocumentPoint(page,110,90);
  await expect(page.locator('#layers [data-layer].selected')).toHaveCount(0);
  await clickDocumentPoint(page,150,60);
  await expect(page.locator(`#layers [data-layer="${initial.id}"]`)).toHaveClass(/selected/);
  const beforePNG=await exportPNG(page);
  await dragDocumentPoint(page,[150,100],[173,117]);
  const moved=(await exportedDocument(page)).elements[0];
  // Existing snapMovement attracts center Y=117 to the document center Y=120.
  expect(moved).toEqual({...initial,x:123,y:100});
  await page.locator('#undoBtn').click();
  expect((await exportedDocument(page)).elements).toEqual([initial]);
  await page.locator('#redoBtn').click();
  expect((await exportedDocument(page)).elements).toEqual([moved]);
  await page.locator(`#layers [data-layer="${initial.id}"] .layer-name`).click();
  // Local east midpoint becomes the lower midpoint after the 90° rotation.
  await dragDocumentPoint(page,[173,170],[173,180]);
  const document=await exportedDocument(page);
  expect(document.elements[0]).toEqual({...moved,x:118,y:105,w:110});
  await page.locator('#undoBtn').click();
  expect((await exportedDocument(page)).elements).toEqual([moved]);
  await page.locator('#redoBtn').click();
  expect((await exportedDocument(page)).elements).toEqual(document.elements);
  const png=await exportPNG(page);
  expect(png.image.data).not.toEqual(beforePNG.image.data);
  await reopenGeometry(page,document,png);
});

test('geometry module: rotated gradient endpoint mouse drag preserves points and stop ids after reopening', async ({page}) => {
  const initial=await rotatedGeometryDocument(page,true);
  await clickDocumentPoint(page,150,100);
  const beforePNG=await exportPNG(page);
  await page.locator('#inspector [data-fill-open="fill"]').click();
  // Local start (20,20) is document (150,70); drag to local (30,10),
  // document (160,80). Fixed values also check the sign of the rotation.
  await dragDocumentPoint(page,[150,70],[160,80]);
  await page.locator('#fillPopover [data-fill-close]').click();
  const document=await exportedDocument(page), e=document.elements[0];
  expect(e.rotation).toBe(90);
  expect(e.gradientStart.x).toBeCloseTo(.3,10);
  expect(e.gradientStart.y).toBeCloseTo(.25,10);
  expect(e.gradientEnd).toEqual(initial.gradientEnd);
  expect(e.gradientStops).toEqual(initial.gradientStops);
  expect({x:e.x,y:e.y,w:e.w,h:e.h}).toEqual({x:100,y:80,w:100,h:40});
  const png=await exportPNG(page);
  expect(png.image.data).not.toEqual(beforePNG.image.data);
  await reopenGeometry(page,document,png);
});
