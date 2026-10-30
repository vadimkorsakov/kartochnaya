const { test, expect, openHome, createDocument, canvasPoint, exportedDocument, addShape, fixturePath } = require('./helpers');

async function setup(page, width = 320, height = 240) {
  await openHome(page);
  await createDocument(page, 'Ruler gestures', width, height);
  if (await page.locator('#rulerTop').isHidden()) await page.locator('#toggleRulersBtn').click();
  await expect(page.locator('#rulerTop')).toBeVisible();
}

async function startGuide(page, ruler, target) {
  const box = await page.locator(ruler).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 6 });
}

// Read only the rendered canvas: the cyan preview must exist before pointerup.
async function guidePixels(page) {
  return page.locator('#canvas').evaluate(canvas => {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const points = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 1] - data[i] > 30 && data[i + 2] - data[i + 1] > 5 && data[i + 2] > 150) {
        points.push({ x: (i / 4 % canvas.width) / canvas.width, y: Math.floor(i / 4 / canvas.width) / canvas.height });
      }
    }
    return points.length ? {
      count: points.length,
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
    } : { count: 0 };
  });
}

for (const [ruler, axis, coordinate, title] of [
  ['#rulerTop', 'y', 90, 'горизонтальную'],
  ['#rulerLeft', 'x', 120, 'вертикальную'],
]) {
  test(`${ruler} pulls a live ${axis} guide and ignores clicks`, async ({ page }) => {
    await setup(page);
    await expect(page.locator(ruler)).toHaveAttribute('title', new RegExp(title));
    await page.locator(ruler).click();
    expect((await exportedDocument(page)).rulers || []).toEqual([]);
    await expect(page.locator('#undoBtn')).toBeDisabled();
    let target = await canvasPoint(page, 120, 90);
    await startGuide(page, ruler, target);
    await expect.poll(async () => (await guidePixels(page)).count).toBeGreaterThan(50);
    expect((await guidePixels(page))[axis]).toBeCloseTo(coordinate / (axis === 'x' ? 320 : 240), 2);
    target = await canvasPoint(page, 160, 130);
    await page.mouse.move(target.x, target.y, { steps: 4 });
    expect((await guidePixels(page))[axis]).toBeCloseTo(axis === 'x' ? .5 : 130 / 240, 2);
    await page.mouse.up();
    const guides = (await exportedDocument(page)).rulers;
    expect(guides).toHaveLength(1);
    expect(guides[0].axis).toBe(axis);
    expect(guides[0].pos).toBeCloseTo(axis === 'x' ? 160 : 130, 0);
  });
}

for (const cancellation of ['Escape', 'pointercancel', 'lostpointercapture', 'blur']) {
  test(`a pulled guide is discarded on ${cancellation}`, async ({ page }) => {
    await setup(page);
    await startGuide(page, '#rulerTop', await canvasPoint(page, 120, 90));
    await expect.poll(async () => (await guidePixels(page)).count).toBeGreaterThan(50);
    if (cancellation === 'Escape') await page.keyboard.press('Escape');
    else if (cancellation === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else {
      // Lifecycle event injection only; all creation and movement use mouse input.
      await page.locator('#rulerTop').evaluate((el, kind) => {
        if (kind === 'lostpointercapture') el.releasePointerCapture(1);
        else el.dispatchEvent(new PointerEvent(kind, { pointerId: 1, bubbles: true }));
      }, cancellation);
    }
    await page.mouse.up();
    expect((await guidePixels(page)).count).toBe(0);
    expect((await exportedDocument(page)).rulers || []).toEqual([]);
    await expect(page.locator('#undoBtn')).toBeDisabled();
  });
}

test('guides use document coordinates after zoom and scroll', async ({ page }) => {
  await setup(page, 1600, 1200);
  for (let n = 0; n < 10; n++) await page.locator('#zoomInBtn').click();
  const stage = page.locator('#stageScroller');
  const box = await stage.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const before = await stage.evaluate(el => ({ x: el.scrollLeft, y: el.scrollTop }));
  await page.mouse.wheel(180, 180);
  await expect.poll(() => stage.evaluate(el => el.scrollTop)).toBeGreaterThan(before.y);
  expect(await stage.evaluate(el => el.scrollLeft)).toBeGreaterThan(before.x);
  const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const canvas = await page.locator('#canvas').boundingBox();
  const x = (target.x - canvas.x) / canvas.width * 1600;
  const y = (target.y - canvas.y) / canvas.height * 1200;
  for (const ruler of ['#rulerTop', '#rulerLeft']) {
    await startGuide(page, ruler, target);
    await page.mouse.up();
  }
  const guides = (await exportedDocument(page)).rulers;
  expect(guides.map(g => g.axis)).toEqual(['y', 'x']);
  expect(guides[0].pos).toBeCloseTo(y, 0);
  expect(guides[1].pos).toBeCloseTo(x, 0);
});

test('a saved guide moves, undoes, redoes, persists and deletes', async ({ page }) => {
  await setup(page);
  await startGuide(page, '#rulerTop', await canvasPoint(page, 120, 90));
  await page.mouse.up();
  const from = await canvasPoint(page, 200, 90), to = await canvasPoint(page, 200, 150);
  await page.mouse.move(from.x, from.y);
  await expect(page.locator('#canvas')).toHaveCSS('cursor', 'ns-resize');
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  expect((await exportedDocument(page)).rulers[0].pos).toBeCloseTo(150, 0);
  await page.locator('#undoBtn').click();
  expect((await exportedDocument(page)).rulers[0].pos).toBeCloseTo(90, 0);
  await page.locator('#undoBtn').click();
  expect((await exportedDocument(page)).rulers || []).toEqual([]);
  await page.locator('#redoBtn').click();
  await page.locator('#redoBtn').click();
  expect((await exportedDocument(page)).rulers[0].pos).toBeCloseTo(150, 0);
  await page.reload();
  await page.locator('[data-projectact="open"]').first().click();
  expect((await exportedDocument(page)).rulers[0].pos).toBeCloseTo(150, 0);
  if (await page.locator('#rulerTop').isHidden()) await page.locator('#toggleRulersBtn').click();
  const at = await canvasPoint(page, 200, 150);
  await page.mouse.dblclick(at.x, at.y);
  expect((await exportedDocument(page)).rulers || []).toEqual([]);
  await page.locator('#undoBtn').click();
  expect((await exportedDocument(page)).rulers).toHaveLength(1);
});

test('Alt + wheel leaves editing and scroll unchanged; Ctrl/Cmd + wheel still zoom', async ({ page }) => {
  await setup(page, 1600, 1200);
  await addShape(page);
  const before = await exportedDocument(page);
  const stage = page.locator('#stageScroller');
  const box = await stage.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const scroll = await stage.evaluate(el => [el.scrollLeft, el.scrollTop]);
  const zoom = await page.locator('#zoomLabel').innerText();
  await page.keyboard.down('Alt');
  let observed;
  await page.exposeFunction('observeWheel', event => { observed = event; });
  await stage.evaluate(el => {
    el.addEventListener('wheel', ev => window.observeWheel({ cancelled: ev.defaultPrevented, trusted: ev.isTrusted }), { once: true });
  });
  await page.mouse.wheel(0, 120);
  await expect.poll(() => observed).toEqual({ cancelled: true, trusted: true });
  expect(await stage.evaluate(el => [el.scrollLeft, el.scrollTop])).toEqual(scroll);
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Alt');
  expect(await stage.evaluate(el => [el.scrollLeft, el.scrollTop])).toEqual(scroll);
  await expect(page.locator('#zoomLabel')).toHaveText(zoom);
  expect((await exportedDocument(page)).elements).toEqual(before.elements);
  await expect(page.locator('#cropActions')).toBeHidden();
  for (const modifier of ['Control', 'Meta']) {
    const old = parseInt(await page.locator('#zoomLabel').innerText());
    await page.keyboard.down(modifier);
    await page.mouse.wheel(0, -120);
    await page.keyboard.up(modifier);
    await expect(page.locator('#zoomLabel')).toHaveText(`${old + 10}%`);
  }
  // This exercises editor behavior in Chromium. It does not prove Firefox's
  // browser/OS history shortcut can always be cancelled by a web page.
});

test('wheel cropping keeps its behavior, including Alt; Ctrl still controls canvas zoom', async ({ page }) => {
  await setup(page);
  await page.locator('.dock-tool[data-add="image"]').click();
  await page.locator('#imageInput').setInputFiles(fixturePath('sample.png'));
  const photo = (await exportedDocument(page)).elements[0];
  const center = await canvasPoint(page, photo.x + photo.w / 2, photo.y + photo.h / 2);
  await page.mouse.dblclick(center.x, center.y);
  await expect(page.locator('#cropActions')).toBeVisible();
  const zoom = await page.locator('#zoomLabel').innerText();
  const before = (await exportedDocument(page)).elements[0].cropZoom;
  await page.mouse.wheel(0, -120);
  const cropped = (await exportedDocument(page)).elements[0].cropZoom;
  expect(cropped).toBeGreaterThan(before);
  await page.keyboard.down('Alt');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Alt');
  const altCropped = (await exportedDocument(page)).elements[0].cropZoom;
  expect(altCropped).toBeGreaterThan(cropped);
  await expect(page.locator('#zoomLabel')).toHaveText(zoom);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await expect(page.locator('#zoomLabel')).toHaveText(`${parseInt(zoom) + 10}%`);
  expect((await exportedDocument(page)).elements[0].cropZoom).toBe(altCropped);
  await page.locator('#cropDoneBtn').click();
});
