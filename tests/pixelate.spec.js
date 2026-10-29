const { PNG } = require('pngjs');
const { test, expect, openHome, importPayload, records, openLibraryDocument, exportedDocument, exportPNG, canvasPoint } = require('./helpers');
test.use({ serviceWorkers: 'block' });
test.setTimeout(60_000);

const pixel = (image, x, y) => image.data.subarray((y * image.width + x) * 4, (y * image.width + x + 1) * 4);
const decode = src => PNG.sync.read(Buffer.from(src.split(',')[1], 'base64'));
let fixtureNumber = 0;
const fx = (type, extra = {}) => ({ id: type, type, enabled: true, blockSize: 32, radius: 8, ...extra });
async function fixture(page, { transparent = false, type = 'image', effects = [], mask = null, region = false, width = 320, height = 240 } = {}) {
  const title = `Pixel document ${++fixtureNumber}`;
  await openHome(page);
  const source = await page.evaluate(({ transparent, width, height }) => {
    const c = document.createElement('canvas'); c.width = width; c.height = height;
    const g = c.getContext('2d'), grad = g.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#ff2400'); grad.addColorStop(.4, '#14df63'); grad.addColorStop(1, '#1824ff');
    if (transparent) { g.beginPath(); g.ellipse(width / 2, height / 2, width * .44, height * .42, .2, 0, Math.PI * 2); g.clip(); g.globalAlpha = .65; }
    g.fillStyle = grad; g.fillRect(0, 0, width, height);
    for (let x = 0; x < width; x += 7) { g.fillStyle = x % 2 ? '#ffffff' : '#101820'; g.fillRect(x, 0, 2, height); }
    return c.toDataURL();
  }, { transparent, width, height });
  const layer = { id: 'source', name: 'Source', type, x: 0, y: 0, w: width, h: height, rotation: 0, visible: true, opacity: 100, fill: '#f54269', fillType: 'image', fillOpacity: 100, strokeWidth: 0, imageSrc: source, text: 'Пикселизация', fontSize: 80, fontFamily: 'Arial', textColor: '#1926e1', fontWeight: 400, lineHeight: 1.2, effects: region ? [] : effects, ...(mask && !region ? { layerMaskSrc: mask } : {}) };
  const elements = [layer];
  if (region) elements.push({ ...layer, id: 'region', name: 'Region', type: 'rect', fillType: 'none', isFxRegion: true, layerMaskSrc: mask, effects });
  await importPayload(page, { format: 'kartochnaya-project-v1', project: { id: 'pixel-project', name: 'Pixel tests', resources: [], resourceFolders: [] }, documents: [{ id: 'pixel-doc', projectId: 'pixel-project', title, type: 'template', width, height, background: '#ffffff', backgroundAlpha: transparent ? 0 : 100, createdAt: 1, updatedAt: 1, groups: [], rulers: [], palette: [], elements }], fonts: [] });
  await expect(page.locator('#toast')).toContainText('Импортировано проектов');
  const doc = (await records(page, 'docs')).find(d => d.title === title);
  await openLibraryDocument(page, doc.id);
  return doc;
}
async function select(page, id = 'source') { await page.locator(`#layers [data-select-layer-thumb="${id}"]`).click(); }
async function add(page) { await page.locator('[data-fx-show]').click(); await page.locator('[data-fx-add="pixelate"]').click(); }
const field = (page, type = 'number') => page.locator(`#fxPopover [data-fx-key="blockSize"][type="${type}"]`);
async function maskSource(page, kind) {
  return page.evaluate(kind => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 240; const g = c.getContext('2d'); g.fillStyle = '#fff';
    if (kind === 'ellipse') { g.beginPath(); g.ellipse(143.3, 111.7, 85.2, 68.4, .3, 0, Math.PI * 2); g.fill(); }
    else { g.beginPath(); g.moveTo(29.4, 35.2); g.lineTo(245.8, 66.3); g.lineTo(189.6, 207.2); g.lineTo(71.3, 147.8); g.closePath(); g.fill(); }
    if (kind === 'grayscale') { g.fillStyle = '#000'; g.fillRect(85, 65, 35, 45); g.fillStyle = '#808080'; g.fillRect(130, 80, 30, 35); }
    return c.toDataURL();
  }, kind);
}
async function nativeCanvas(page) {
  // Adjust only the public viewport until Fit is exactly 1:1; no editor globals.
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  const size = page.viewportSize();
  const stageWidth = await page.locator('#stageScroller').evaluate(e => e.clientWidth);
  await page.setViewportSize({ width: size.width + 388 - stageWidth, height: size.height });
  await expect(page.locator('#canvas')).toHaveJSProperty('width', 320);
  return Buffer.from(await page.locator('#canvas').evaluate(c => Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data)));
}
async function assertPreview(page, image) {
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  const same = await page.locator('#canvas').evaluate(async (c, src) => {
    const img = new Image(); img.src = src; await img.decode();
    const expected = document.createElement('canvas'); expected.width = c.width; expected.height = c.height;
    const g = expected.getContext('2d'); g.scale(parseFloat(c.style.width) / img.width, parseFloat(c.style.height) / img.height); g.drawImage(img, 0, 0);
    const a = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, b = g.getImageData(0, 0, c.width, c.height).data;
    return a.every((value, i) => value === b[i]);
  }, 'data:image/png;base64,' + PNG.sync.write(image).toString('base64'));
  expect(same, 'Preview samples the native composition at every zoom').toBe(true);
}
function assertMask(before, after, full, mask) {
  let changed = 0, outside = 0, edge = 0;
  for (let i = 0; i < mask.data.length; i += 4) {
    const a = mask.data[i + 3], original = before.data.subarray(i, i + 4), actual = after.data.subarray(i, i + 4);
    if (!a) { if (!actual.equals(original)) throw new Error(`RGBA changed outside mask at pixel ${i / 4}`); outside++; }
    else if (a === 255) {
      // M selections are binary masks: verify the pixels touching their contour too.
      const x = (i / 4) % mask.width, y = Math.floor(i / 4 / mask.width);
      if ((x > 0 && !mask.data[i - 1]) || (y > 0 && !mask.data[i - mask.width * 4 + 3])) edge++;
      if (!actual.equals(full.data.subarray(i, i + 4))) throw new Error(`Wrong block source at pixel ${i / 4}`); if (!actual.equals(original)) changed++; }
    else {
      // Opaque source: a single mask application interpolates without a dark fringe.
      for (let k = 0; k < 3; k++) expect(Math.abs(actual[k] - Math.round((before.data[i + k] * (255 - a) + full.data[i + k] * a) / 255))).toBeLessThanOrEqual(2);
      expect(actual[3]).toBe(255); edge++;
    }
  }
  expect(changed).toBeGreaterThan(100); expect(outside).toBeGreaterThan(1000);
  return edge;
}

test('desktop controls, square blocks, zoom, native Canvas, persistence and history', async ({ page }) => {
  const doc = await fixture(page); const original = (await exportPNG(page)).image;
  await select(page); await add(page);
  await expect(field(page)).toHaveValue('32');
  for (const attr of ['min', 'max', 'step']) await expect(field(page)).toHaveAttribute(attr, { min: '2', max: '160', step: '1' }[attr]);
  await field(page, 'range').fill('16'); await field(page, 'range').dispatchEvent('change');
  await expect(field(page)).toHaveValue('16');
  const small = (await exportPNG(page)).image;
  await page.locator('[data-fx-open]').click();
  await field(page).fill('48'); await field(page).press('Tab'); await expect(field(page, 'range')).toHaveValue('48');
  const big = await exportPNG(page), model = await exportedDocument(page);
  expect(model.elements[0].effects[0]).toMatchObject({ type: 'pixelate', blockSize: 48 });
  expect(big.image.data.equals(small.data)).toBe(false);
  for (const [image, block] of [[small, 16], [big.image, 48]]) {
    for (let y = 0; y < 240; y++) for (let x = 0; x < 320; x++) {
      if (!pixel(image, x, y).equals(pixel(image, Math.floor(x / block) * block, Math.floor(y / block) * block))) throw new Error(`Non-square block at ${x},${y}`);
    }
    expect(pixel(image, block - 1, 50)).not.toEqual(pixel(image, block, 50));
    expect(pixel(image, 319, 239)[3]).toBe(255); // Partial last blocks must be filled.
  }
  await page.locator('#zoomOutBtn').click(); expect((await exportPNG(page)).image.data.equals(big.image.data)).toBe(true);
  expect((await exportedDocument(page)).elements).toEqual(model.elements);
  await page.locator('#undoBtn').click(); expect((await exportPNG(page)).image.data.equals(small.data)).toBe(true);
  await page.locator('#redoBtn').click(); expect((await exportPNG(page)).image.data.equals(big.image.data)).toBe(true);
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible(); await openLibraryDocument(page, doc.id);
  expect((await exportPNG(page)).image.data.equals(big.image.data)).toBe(true);
  expect((await nativeCanvas(page)).equals(big.image.data)).toBe(true);
  await select(page); await page.locator('[data-fx-toggle]').click(); expect((await exportPNG(page)).image.data.equals(original.data)).toBe(true);
  await page.locator('[data-fx-toggle]').click(); expect((await exportPNG(page)).image.data.equals(big.image.data)).toBe(true);
  await page.locator('[data-fx-remove]').click(); expect((await exportPNG(page)).image.data.equals(original.data)).toBe(true);
});

for (const kind of ['rect', 'ellipse', 'lasso']) test(`M → ${kind} → region pixelate preserves every outside RGBA`, async ({ page, browser }) => {
  const doc = await fixture(page); const original = (await exportPNG(page)).image;
  // A second document renderer supplies the unmasked effect reference, not a screenshot.
  const reference = await browser.newPage({ baseURL: 'http://127.0.0.1:4173', serviceWorkers: 'block' }); await fixture(reference, { effects: [fx('pixelate')] }); const full = (await exportPNG(reference)).image; await reference.close();
  await page.locator('#dockMarquee').click();
  if (kind !== 'rect') { await page.locator('#selectKindBtn').click(); await page.locator(`[data-select-kind="${kind}"]`).click(); }
  const points = kind === 'lasso' ? [[35, 30], [249, 60], [187, 205], [67, 155], [35, 30]] : [[35, 30], [249, 205]];
  const first = await canvasPoint(page, ...points[0]); await page.mouse.move(first.x, first.y); await page.mouse.down();
  for (const point of points.slice(1)) { const p = await canvasPoint(page, ...point); await page.mouse.move(p.x, p.y, { steps: 10 }); } await page.mouse.up();
  await page.locator('#fxFromSelection').click(); await page.locator('[data-fx-add="pixelate"]').click();
  const model = await exportedDocument(page), region = model.elements.find(e => e.isFxRegion), result = (await exportPNG(page)).image;
  expect(region.effects[0]).toMatchObject({ type: 'pixelate', blockSize: 32 });
  expect(model.elements[0]).toEqual((await records(page, 'docs')).find(d => d.id === doc.id).elements[0]);
  const edge = assertMask(original, result, full, decode(region.layerMaskSrc)); if (kind !== 'rect') expect(edge).toBeGreaterThan(20);
  await page.locator('#undoBtn').click(); expect((await exportPNG(page)).image.data.equals(original.data)).toBe(true);
  await page.locator('#redoBtn').click(); expect((await exportPNG(page)).image.data.equals(result.data)).toBe(true);
  await page.locator('#clearPixelSelection').click();
  expect((await exportPNG(page)).image.data.equals(result.data)).toBe(true);
  await page.locator('#zoomOutBtn').click(); expect((await exportPNG(page)).image.data.equals(result.data)).toBe(true);
  await assertPreview(page, result);
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible(); await openLibraryDocument(page, doc.id);
  expect((await exportPNG(page)).image.data.equals(result.data)).toBe(true);
  expect((await nativeCanvas(page)).equals(result.data)).toBe(true);
  await select(page, region.id); await page.locator('[data-fx-toggle]').click(); expect((await exportPNG(page)).image.data.equals(original.data)).toBe(true);
  await page.locator('[data-fx-remove]').click(); expect((await exportPNG(page)).image.data.equals(original.data)).toBe(true);
});

for (const type of ['image', 'circle', 'text']) test(`ordinary ${type}: alpha and existing layer masks stay intact`, async ({ page }) => {
  const mask = await maskSource(page, 'ellipse');
  await fixture(page, { type, transparent: true, mask }); const original = (await exportPNG(page)).image;
  await select(page); await add(page); const result = (await exportPNG(page)).image;
  expect(result.data.equals(original.data)).toBe(false);
  for (let i = 3; i < original.data.length; i += 4) {
    if (result.data[i] !== original.data[i]) throw new Error(`Alpha changed at pixel ${(i - 3) / 4}`);
    if (!original.data[i] && !result.data.subarray(i - 3, i + 1).equals(original.data.subarray(i - 3, i + 1))) throw new Error(`RGB leaked into transparency at pixel ${(i - 3) / 4}`);
  }
  await page.locator('[data-fx-toggle]').click(); expect((await exportPNG(page)).image.data.equals(original.data)).toBe(true);
});

for (const maskKind of ['polygon', 'grayscale']) test(`existing ${maskKind} region mask and ordered Gaussian stack remain editable`, async ({ page, browser }) => {
  const mask = await maskSource(page, maskKind), effects = [fx('gaussianBlur'), fx('pixelate', { maskSrc: mask })];
  await fixture(page, { region: true, mask, effects }); const result = (await exportPNG(page)).image;
  const ref = await browser.newPage({ baseURL: 'http://127.0.0.1:4173', serviceWorkers: 'block' }); await fixture(ref); const original = (await exportPNG(ref)).image;
  await select(ref); await ref.locator('[data-fx-show]').click(); await ref.locator('[data-fx-add="gaussianBlur"]').click();
  const radius = ref.locator('#fxPopover [data-fx-key="radius"][type="number"]'); await radius.fill('8'); await radius.press('Tab'); await add(ref);
  const full = (await exportPNG(ref)).image; await ref.close();
  const coverage = decode(mask);
  for (let i = 0; i < coverage.data.length; i += 4) coverage.data[i + 3] = Math.round(Math.round(.2126 * coverage.data[i] + .7152 * coverage.data[i + 1] + .0722 * coverage.data[i + 2]) * coverage.data[i + 3] / 255);
  expect(assertMask(original, result, full, coverage)).toBeGreaterThan(20);
  await select(page, 'region'); await page.locator('[data-fx-menu="pixelate"]').click();
  await page.locator('[data-fx-move="pixelate"][data-dir="-1"]').click();
  expect((await exportedDocument(page)).elements[1].effects.map(f => f.type)).toEqual(['pixelate', 'gaussianBlur']);
  const reordered = (await exportPNG(page)).image; expect(reordered.data.equals(result.data)).toBe(false);
  await page.locator('#undoBtn').click(); expect((await exportPNG(page)).image.data.equals(result.data)).toBe(true);
});

for (const region of [false, true]) test(`mobile first tap, second tap and paired controls (region: ${region})`, async ({ page }) => {
  await fixture(page);
  if (region) {
    await page.locator('#dockMarquee').click(); const a = await canvasPoint(page, 30, 30), b = await canvasPoint(page, 200, 180);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  if (!region) {
    await page.locator('#mobileToolbars [data-mobile="layers"]:visible').click();
    await page.locator('#mobileLayerList [data-layer="source"] .layer-name').click();
    await page.locator('#mobileLayersClose').click();
  }
  if (region) await page.locator('#fxFromSelection').click(); else await page.locator('#mobileContext [data-mobile="effects"]').click();
  const tile = page.locator('[data-mp-effect="pixelate"]'); await expect(tile).toBeVisible(); await tile.click();
  const number = page.locator('[data-mp-effect-key="blockSize"][type="number"]'), range = page.locator('[data-mp-effect-key="blockSize"][type="range"]');
  await expect(number).toHaveCount(0); await tile.click(); await expect(number).toHaveValue('32');
  await number.fill('51'); await number.press('Tab'); await expect(range).toHaveValue('51');
  await range.fill('18'); await range.dispatchEvent('change'); await expect(number).toHaveValue('18');
  const model = await exportedDocument(page); expect(model.elements.at(-1).effects[0]).toMatchObject({ type: 'pixelate', blockSize: 18 });
  expect(model.elements.filter(e => e.isFxRegion)).toHaveLength(region ? 1 : 0);
  await expect(page.locator('[data-mp-effect-color="pixelate"]')).toHaveCount(0);
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  expect((await records(page, 'docs')).find(d => d.id === model.id).elements).toEqual(model.elements);
});
