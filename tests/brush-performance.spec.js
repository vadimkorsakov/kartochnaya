const { PNG } = require('pngjs');
const { createHash } = require('node:crypto');
const { test, expect, openHome, createDocument, canvasPoint, exportedDocument, exportPNG, openLibraryDocument, fixturePath, importPayload, records } = require('./helpers');
const { instrument, reset, snapshot, moves, fixture } = require('./brush-diagnostics.cjs');

test.use({ serviceWorkers: 'block' });
test.setTimeout(60_000);
const decode = src => PNG.sync.read(Buffer.from(src.split(',')[1], 'base64'));
const pixel = (image, x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x + 1) * 4)];
const hash = image => createHash('sha256').update(image.data).digest('hex');
const frame = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function brush(page, { profile = 'round', size = 18, alpha = 100, hardness = 100, smoothing = 48 } = {}) {
  const viewport = page.viewportSize(), mobile = viewport.width <= 760;
  // Existing mobile CSS hides the brush settings dock. Configure through its
  // desktop UI, then exercise the actual mobile canvas and trusted touch input.
  if (mobile) await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('#canvas').focus();
  await page.keyboard.press('b');
  await page.locator('#inkProfile').selectOption(profile);
  for (const [id, value] of Object.entries({ inkSizeNum: size, inkAlpha: alpha, inkHardness: hardness, inkSmoothing: smoothing })) {
    await page.locator(`#${id}`).evaluate((input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }, String(value));
  }
  await page.locator('#inkClose').click();
  if (mobile) { await page.setViewportSize(viewport); await frame(page); }
}
async function start(page, x = 40, y = 120) {
  const point = await canvasPoint(page, x, y); await page.mouse.move(point.x, point.y); await page.mouse.down();
}
async function segment(page, x, y, steps = 5) {
  const point = await canvasPoint(page, x, y); await page.mouse.move(point.x, point.y, { steps });
}
async function released(page) {
  await frame(page);
  await expect(page.locator('#inkPreview')).toBeHidden();
  expect(await page.locator('#inkPreview').evaluate(c => [c.width, c.height])).toEqual([0, 0]);
}
async function blank(page, title = 'Brush test') { await openHome(page, '/index.html'); await createDocument(page, title); }
async function nativeStroke(page, x, y, toX = x, toY = y) { await start(page, x, y); if (x !== toX || y !== toY) await segment(page, toX, toY); await page.mouse.up(); }

test('tap, short and long strokes reuse one raster; every stroke is one Undo/Redo step; save/reopen and PNG agree', async ({ page }) => {
  await blank(page, 'Brush persistence'); await brush(page);
  const states = [];
  await nativeStroke(page, 40, 40); states.push(await exportedDocument(page));
  await nativeStroke(page, 90, 80, 96, 82); states.push(await exportedDocument(page));
  await start(page, 30, 150); await moves(page, { width: 320, count: 400, batches: 20 }); await page.mouse.up();
  states.push(await exportedDocument(page)); await released(page);
  for (const state of states) { expect(state.elements).toHaveLength(1); expect(state.elements[0].type).toBe('raster'); expect(state.elements[0].id).toBe(states[0].elements[0].id); }
  const raster = decode(states[2].elements[0].rasterSrc);
  expect(pixel(raster, 40, 40)[3]).toBeGreaterThan(0); expect(pixel(raster, 92, 80)[3]).toBeGreaterThan(0);
  expect(pixel(raster, 310, 10)[3]).toBe(0);
  for (let i = 1; i >= 0; i--) { await page.locator('#undoBtn').click(); expect((await exportedDocument(page)).elements).toEqual(states[i].elements); }
  await page.locator('#undoBtn').click(); expect((await exportedDocument(page)).elements).toEqual([]);
  for (const state of states) { await page.locator('#redoBtn').click(); expect((await exportedDocument(page)).elements).toEqual(state.elements); }
  const before = await exportPNG(page);
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  await page.reload(); await openLibraryDocument(page, states[2].id);
  expect((await exportedDocument(page)).elements).toEqual(states[2].elements);
  expect((await exportPNG(page)).image.data.equals(before.image.data)).toBe(true);
});

// Fixed event clock makes the existing speed-dependent profiles reproducible.
async function clock(page) {
  await page.addInitScript(() => {
    const now = performance.now.bind(performance); window.brushClock = null;
    Object.defineProperty(performance, 'now', { value: () => window.brushClock ?? now() });
  });
}
async function referenceStroke(page) {
  await page.evaluate(() => { window.brushClock = 1000; }); await start(page, 35, 120);
  await page.locator('#canvas').evaluate(canvas => {
    const rect = canvas.getBoundingClientRect();
    for (let i = 1; i <= 80; i++) {
      window.brushClock = 1000 + i * (i < 40 ? 2 : 25);
      canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: rect.left + (35 + i * 3) / 320 * rect.width, clientY: rect.top + (120 + Math.sin(i / 8) * 44) / 240 * rect.height }));
    }
  });
  await page.mouse.up(); await page.evaluate(() => { window.brushClock = null; });
}
for (const profile of ['round', 'taper', 'calligraphy', 'marker', 'chalk', 'spray', 'dashed', 'dotted']) {
  test(`completed ${profile} retains main pixels with alpha, hardness, smoothing and changing speed`, async ({ page }, info) => {
    await clock(page);
    await blank(page); await brush(page, { profile, alpha: 43, hardness: 62, smoothing: 70, size: 26 });
    await referenceStroke(page);
    const doc = await exportedDocument(page), raster = decode(doc.elements[0].rasterSrc);
    const actual = { profile, hash: hash(raster) };
    await info.attach('brush-pixels', { body: JSON.stringify(actual), contentType: 'application/json' });
    const references = require('./fixtures/brush-pixels.json');
    expect(actual.hash).toBe(references[profile]); await released(page);
    expect(pixel(raster, 8, 8)[3]).toBe(0);
    expect(raster.data.some((v, i) => i % 4 === 3 && v > 0 && v < 255)).toBe(true);
    const png = await exportPNG(page); expect(new Set(png.image.data).size).toBeGreaterThan(2);
  });
}

test('many samples and coalesced events retain their trajectory without composing or allocating per move; one queued frame; cleanup', async ({ page }, info) => {
  await instrument(page); await openHome(page, '/index.html');
  const payload = fixture(320); payload.documents[0].height = 240;
  await importPayload(page, payload); await expect(page.locator('#toast')).toContainText('Импортировано проектов');
  const saved = (await records(page, 'docs')).find(d => d.title === 'Brush diagnostics'); await openLibraryDocument(page, saved.id);
  await brush(page, { size: 4, smoothing: 0 });
  // Establish an existing target so creation is excluded from move measurements.
  await nativeStroke(page, 12, 12); await start(page, 30, 120); await frame(page); await reset(page);
  const before = await page.locator('#canvas').evaluate(c => c.toDataURL());
  await reset(page);
  let audit = await page.locator('#canvas').evaluate(canvas => {
    const rect = canvas.getBoundingClientRect();
    for (let i = 1; i <= 600; i++) {
      const x = 30 + i * .44, y = 120 + Math.sin(i / 30) * 55;
      canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: rect.left + x / 320 * rect.width, clientY: rect.top + y / 240 * rect.height }));
    }
    // A coalesced event includes an excursion absent from the dispatch endpoint.
    const sample = (x, y) => new PointerEvent('pointermove', { pointerId: 1, clientX: rect.left + x / 320 * rect.width, clientY: rect.top + y / 240 * rect.height });
    const event = sample(290, 120); Object.defineProperty(event, 'getCoalescedEvents', { value: () => [sample(280, 40), sample(290, 40)] }); canvas.dispatchEvent(event);
    return structuredClone(window.brushAudit);
  });
  expect(audit.calls.inkMove).toBe(601); expect(audit.calls.paint || 0).toBe(0); expect(audit.calls.paintDocument || 0).toBe(0);
  expect(audit.pending).toBe(1); expect(audit.maxPending).toBe(1); expect(audit.canvases).toBe(0);
  await frame(page); audit = await snapshot(page);
  expect(audit.frames).toBe(1); expect(audit.pending).toBe(0);
  expect(await page.locator('#canvas').evaluate(c => c.toDataURL())).toBe(before);
  await page.mouse.up(); await released(page);
  const raster = decode((await exportedDocument(page)).elements.at(-1).rasterSrc);
  for (let i = 10; i <= 590; i += 10) expect(pixel(raster, Math.round(30 + i * .44), Math.round(120 + Math.sin(i / 30) * 55))[3]).toBeGreaterThan(0);
  expect(pixel(raster, 280, 40)[3]).toBeGreaterThan(0);
  expect(pixel(raster, 290, 40)[3]).toBeGreaterThan(0);
  audit = await snapshot(page); expect(audit.pending).toBe(0); expect(audit.calls.inkEnd).toBe(1);
  await info.attach('brush-diagnostics', { body: JSON.stringify(audit), contentType: 'application/json' });
});

test('cancel before the queued frame releases it; a different pointer cannot extend or finish the stroke', async ({ page }) => {
  await instrument(page); await blank(page); await brush(page); await nativeStroke(page, 12, 12);
  const before = await exportedDocument(page);
  await start(page); await frame(page); await reset(page);
  const audit = await page.locator('#canvas').evaluate(canvas => {
    const r = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientX: r.left + r.width * .9, clientY: r.top + r.height * .9 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2 }));
    canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: r.left + r.width * .8, clientY: r.top + r.height * .5 }));
    const queued = window.brushAudit.pending;
    canvas.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }));
    return { queued, ...structuredClone(window.brushAudit) };
  });
  expect(audit.queued).toBe(1); expect(audit.pending).toBe(0); expect(audit.maxPending).toBe(1); expect(audit.frames).toBe(0);
  expect(audit.calls.inkEnd || 0).toBe(0);
  await frame(page); expect((await snapshot(page)).frames).toBe(0); await released(page);
  await page.mouse.up(); expect((await exportedDocument(page)).elements).toEqual(before.elements);
});

for (const reason of ['pointercancel', 'lostpointercapture', 'Escape', 'tool', 'layer', 'mask']) {
  test(`active stroke clears on ${reason} with no duplicate history or stale frame`, async ({ page }) => {
    await blank(page); await brush(page); await nativeStroke(page, 15, 15);
    const before = await exportedDocument(page);
    if (reason === 'layer' || reason === 'mask') {
      await page.locator('#newPaintLayerBtn').click();
      if (reason === 'mask') {
        await page.locator('#layers [data-create-mask]').last().click();
        await page.locator('#layers [data-select-layer-thumb]').last().click();
      }
    }
    const state = await exportedDocument(page), historyCount = await page.locator('.history-entry').count();
    await start(page); await segment(page, 260, 120); await expect(page.locator('#inkPreview')).toBeVisible();
    if (reason === 'pointercancel') await page.locator('#canvas').dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse' });
    if (reason === 'lostpointercapture') await page.locator('#canvas').evaluate(c => c.releasePointerCapture(1));
    if (reason === 'Escape') await page.keyboard.press('Escape');
    if (reason === 'tool') await page.keyboard.press('v');
    if (reason === 'layer') await page.locator(`#layers [data-select-layer-thumb="${before.elements[0].id}"]`).evaluate(e => e.click());
    if (reason === 'mask') await page.locator('#layers [data-select-mask]').evaluate(e => e.click());
    await page.mouse.up(); await released(page);
    expect((await exportedDocument(page)).elements).toEqual(state.elements);
    expect(await page.locator('.history-entry').count()).toBe(historyCount);
    await page.locator('#undoBtn').click();
    const undone = await exportedDocument(page);
    if (reason === 'mask') expect(undone.elements.at(-1).layerMaskSrc).toBeFalsy();
    else expect(undone.elements.length).toBe(state.elements.length - 1);
  });
}

test('document tab switch finishes the old stroke once; close and later pointerup cannot draw in another tab', async ({ page }) => {
  await blank(page, 'First brush tab'); const first = await exportedDocument(page);
  await page.locator('#documentTabsHome').click(); await createDocument(page, 'Second brush tab'); const second = await exportedDocument(page);
  await page.locator(`[data-tab-id="${first.id}"]`).click(); await brush(page); await start(page); await segment(page, 260, 120);
  await page.locator(`[data-tab-id="${second.id}"]`).evaluate(e => e.click()); await page.mouse.up(); await released(page);
  expect((await exportedDocument(page)).elements).toEqual([]);
  await page.locator(`[data-tab-id="${first.id}"]`).click(); const drawn = await exportedDocument(page); expect(drawn.elements).toHaveLength(1);
  await page.locator('#undoBtn').click(); expect((await exportedDocument(page)).elements).toEqual([]);
  await page.locator('#redoBtn').click(); expect((await exportedDocument(page)).elements).toEqual(drawn.elements);
  await start(page, 80, 80); await segment(page, 100, 80);
  await page.locator(`[data-tab-id="${first.id}"] .document-tab-close`).evaluate(e => e.click());
  await page.mouse.up(); await released(page); expect((await exportedDocument(page)).id).toBe(second.id); expect((await exportedDocument(page)).elements).toEqual([]);
});

for (const mobile of [false, true]) test.describe(mobile ? 'mobile brush DPR 2' : 'desktop brush DPR 1', () => {
  test.use({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  test('preview follows zoom, scroll and resize; never intercepts input; tap and transparent stroke clear', async ({ page }) => {
    await blank(page); await brush(page);
    await start(page, 80, 80); await segment(page, 150, 90); await frame(page);
    expect(await page.locator('#inkPreview').evaluate(c => getComputedStyle(c).pointerEvents)).toBe('none');
    await page.locator('#zoomInBtn').evaluate(e => { for (let i = 0; i < 12; i++) e.click(); });
    const scroll = await page.locator('#stageScroller').evaluate(e => {
      const before = [e.scrollLeft, e.scrollTop]; e.scrollLeft += 40; e.scrollTop += 30;
      return { before, after: [e.scrollLeft, e.scrollTop] };
    });
    expect(scroll.after).not.toEqual(scroll.before);
    await page.setViewportSize(mobile ? { width: 430, height: 900 } : { width: 1400, height: 960 }); await frame(page);
    const boxes = await page.locator('#canvasHost').evaluate(host => {
      const a = host.querySelector('#canvas'), b = host.querySelector('#inkPreview');
      return { a: a.getBoundingClientRect().toJSON(), b: b.getBoundingClientRect().toJSON(), dimensions: [a.width, a.height, b.width, b.height] };
    });
    expect(boxes.a).toEqual(boxes.b); expect(boxes.dimensions.slice(0, 2)).toEqual(boxes.dimensions.slice(2));
    await page.mouse.up(); await released(page);
    const doc = await exportedDocument(page); expect(pixel(decode(doc.elements[0].rasterSrc), 100, 83)[3]).toBeGreaterThan(0);
    await page.locator('#zoomLabel').evaluate(e => e.click()); await frame(page);
    if (mobile) {
      const p = await canvasPoint(page, 210, 140); await page.touchscreen.tap(p.x, p.y); await released(page);
      expect(pixel(decode((await exportedDocument(page)).elements[0].rasterSrc), 210, 140)[3]).toBeGreaterThan(0);
    }
    await brush(page, { alpha: 25 }); await start(page, 40, 180); await frame(page);
    const alpha = await page.locator('#inkPreview').evaluate(c => {
      const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let max = 0; for (let i = 3; i < pixels.length; i += 4) max = Math.max(max, pixels[i]); return max;
    });
    expect(alpha).toBeGreaterThan(0); expect(alpha).toBeLessThanOrEqual(64);
    await page.mouse.up(); await released(page);
  });
  if (mobile) test('second touch cancels a tentative stroke and owns the gesture until all fingers release', async ({ page }) => {
    await blank(page); await brush(page); await nativeStroke(page, 15, 15);
    const before = await exportedDocument(page), historyCount = await page.locator('.history-entry').count();
    const session = await page.context().newCDPSession(page);
    const a = await canvasPoint(page, 80, 80), b = await canvasPoint(page, 120, 160);
    const point = (id, p) => ({ id, x: p.x, y: p.y, radiusX: 1, radiusY: 1, force: .5 });
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(1, a)] });
    a.x += 20;
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(1, a)] });
    await expect(page.locator('#inkPreview')).toBeVisible();
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(1, a), point(2, b)] });
    await released(page);
    b.x += 15;
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(1, a), point(2, b)] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [point(1, a)] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await released(page); expect((await exportedDocument(page)).elements).toEqual(before.elements);
    expect(await page.locator('.history-entry').count()).toBe(historyCount);
    await session.detach();
  });
});

test('painting a selected image converts and reuses that raster layer', async ({ page }) => {
  await blank(page);
  const chooser = page.waitForEvent('filechooser'); await page.locator('.dock-tool[data-add="image"]').click();
  await (await chooser).setFiles(fixturePath('sample.png'));
  await expect(page.locator('#layers [data-layer]')).toHaveCount(1);
  const image = (await exportedDocument(page)).elements[0]; expect(image.type).toBe('image');
  await brush(page); await nativeStroke(page, 70, 70, 100, 80); await nativeStroke(page, 160, 160, 200, 170);
  const after = await exportedDocument(page); expect(after.elements).toHaveLength(1); expect(after.elements[0]).toMatchObject({ type: 'raster', id: image.id });
  await page.locator('#undoBtn').click(); await page.locator('#undoBtn').click(); expect((await exportedDocument(page)).elements).toEqual([image]);
});

test('historical vector strokes survive raster painting, Undo/Redo and reopening', async ({ page }) => {
  await openHome(page);
  const legacy = { id: 'legacy-ink', type: 'path', name: 'Old brush', x: 30, y: 30, w: 200, h: 40, visible: true, opacity: 100, rotation: 0, fillType: 'none', stroke: '#ff0000', strokeWidth: 14, strokeOpacity: 65, inkTool: 'brush', inkProfile: 'calligraphy', inkHardness: 75, inkPoints: [{ x: 0, y: 0, time: 1 }, { x: .5, y: 1, time: 25 }, { x: 1, y: 0, time: 50 }], pathClosed: false, pathNodes: [{ x: 0, y: 0 }, { x: .5, y: 1 }, { x: 1, y: 0 }] };
  await importPayload(page, { format: 'kartochnaya-project-v1', project: { id: 'legacy-project', name: 'Legacy brush', resources: [], resourceFolders: [] }, fonts: [], documents: [{ id: 'legacy-doc', projectId: 'legacy-project', title: 'Legacy brush', type: 'template', width: 320, height: 240, background: '#ffffff', backgroundAlpha: 100, elements: [legacy], groups: [], rulers: [], palette: [], createdAt: 1, updatedAt: 1 }] });
  await expect(page.locator('#toast')).toContainText('Импортировано проектов');
  const saved = (await records(page, 'docs')).find(d => d.title === 'Legacy brush'); await openLibraryDocument(page, saved.id);
  const before = await exportedDocument(page), png = await exportPNG(page);
  expect(png.image.data.some((v, i) => i % 4 === 1 && v < 250)).toBe(true);
  await brush(page); await nativeStroke(page, 30, 180, 270, 180); await released(page);
  const after = await exportedDocument(page); expect(after.elements).toHaveLength(2); expect(after.elements[0]).toEqual(before.elements[0]);
  await page.locator('#undoBtn').click(); expect((await exportPNG(page)).image.data.equals(png.image.data)).toBe(true);
  await page.locator('#redoBtn').click(); const painted = await exportPNG(page);
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  await page.reload(); await openLibraryDocument(page, saved.id); expect((await exportPNG(page)).image.data.equals(painted.image.data)).toBe(true);
});
