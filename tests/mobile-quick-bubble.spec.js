const { test, expect, openHome, importPayload, records, openLibraryDocument, exportedDocument } = require('./helpers');
const fixture = require('./fixtures/canvas-graph.json');

async function select(page, id = 'independent') {
  await page.locator('#mobileToolbars [data-mobile="layers"]:visible').tap();
  await page.locator(`#mobileLayerList [data-layer="${id}"] .layer-name`).tap();
  await page.locator('#mobileLayersClose').tap();
  await expect(page.locator('#quickBubble')).toBeVisible();
}
async function open(page, elements) {
  await openHome(page);
  const payload = structuredClone(fixture), doc = payload.documents[0];
  doc.groups = [];
  doc.elements = elements.map((geometry, i) => ({ ...doc.elements[3], id: i ? 'second' : 'independent', ...geometry }));
  await importPayload(page, payload);
  await expect(page.locator('#toast')).toContainText('Импортировано проектов');
  await openLibraryDocument(page, (await records(page, 'docs')).find(d => d.title === doc.title).id);
  await select(page);
}
async function geometry(page, element) {
  return page.evaluate(e => {
    const rect = selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const canvas = rect('#canvas'), bubble = rect('#quickBubble'), stage = rect('#stageScroller'), toolbar = rect('#mobileToolbars');
    const sx = canvas.width / 320, sy = canvas.height / 240;
    return { bubble, canvas, stage, toolbar, selection: { left: canvas.left + e.x * sx, right: canvas.left + (e.x + e.w) * sx, top: canvas.top + e.y * sy, bottom: canvas.top + (e.y + e.h) * sy } };
  }, element);
}
function safe({ bubble: b, stage, toolbar }) {
  expect(b.left).toBeGreaterThanOrEqual(stage.left + 7);
  expect(b.right).toBeLessThanOrEqual(stage.right - 7);
  expect(b.top).toBeGreaterThanOrEqual(stage.top + 7);
  expect(b.bottom).toBeLessThanOrEqual(Math.min(stage.bottom, toolbar.top) - 7);
}
async function above(page, element) {
  await expect.poll(async () => {
    const g = await geometry(page, element);
    return Math.round(g.selection.top - g.bubble.bottom);
  }).toBe(8);
  await expect.poll(async () => {
    const g = await geometry(page, element);
    return Math.abs((g.bubble.left + g.bubble.right - g.selection.left - g.selection.right) / 2);
  }).toBeLessThan(1);
  const g = await geometry(page, element);
  safe(g);
  return g;
}

for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) test.describe(`${viewport.width}x${viewport.height}`, () => {
  test.use({ viewport, hasTouch: true, isMobile: true });

  test('compact menu sits above the object with separate working buttons', async ({ page }) => {
    const element = { x: 120, y: 100, w: 80, h: 60 };
    await open(page, [element]);
    const g = await above(page, element);
    expect(g.bubble.height).toBe(32);
    const buttons = page.locator('#quickBubble button:visible');
    await expect(buttons).toHaveCount(4);
    const boxes = await buttons.evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, height: r.height }; }));
    for (let i = 0; i < boxes.length; i++) {
      expect(boxes[i].width).toBe(30); expect(boxes[i].height).toBe(30);
      if (i) expect(boxes[i].left - boxes[i - 1].right).toBeGreaterThanOrEqual(4);
    }
    await page.locator('#quickBubble [data-quick="lock"]').tap();
    expect((await exportedDocument(page)).elements[0].locked).toBe(true);
    await page.locator('#quickBubble [data-quick="lock"]').tap();
    expect((await exportedDocument(page)).elements[0].locked).toBe(false);
    await page.locator('#quickBubble [data-quick="duplicate"]').tap();
    expect((await exportedDocument(page)).elements).toHaveLength(2);
    await page.locator('#quickBubble [data-quick="delete"]').tap();
    expect((await exportedDocument(page)).elements).toHaveLength(1);
  });

  test('object at the workspace top switches below after zoom and scroll', async ({ page }) => {
    const element = { x: 120, y: 0, w: 80, h: 60 };
    await open(page, [element]);
    const stage = page.locator('#stageScroller');
    // Use the public wheel handler to create a genuinely scrollable canvas.
    const r = await stage.boundingBox();
    for (let i = 0; i < 20; i++) await stage.dispatchEvent('wheel', { ctrlKey: true, deltaY: -100, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 });
    await stage.evaluate(node => { node.scrollTop = 0; });
    await expect.poll(async () => {
      const g = await geometry(page, element); return Math.round(g.bubble.top - g.selection.bottom);
    }).toBe(8);
    safe(await geometry(page, element));
  });

  test('top edge flips below and can leave the card', async ({ page }) => {
    const element = { x: 120, y: -240, w: 80, h: 480 };
    await open(page, [element]);
    // The object extends above the workspace and ends at the card's bottom edge.
    await expect.poll(async () => {
      const g = await geometry(page, element); return Math.round(g.bubble.top - g.selection.bottom);
    }).toBe(8);
    const g = await geometry(page, element);
    safe(g); expect(g.bubble.top).toBeGreaterThan(g.canvas.bottom);
  });

  test('zoom, scroll, selection and orientation recalculate; properties and home hide it', async ({ page }) => {
    const first = { x: 120, y: 100, w: 80, h: 60 }, second = { x: 170, y: 150, w: 50, h: 40 };
    await open(page, [first, second]);
    const initial = await above(page, first);
    for (let i = 0; i < 8; i++) await page.locator('#zoomInBtn').tap();
    const zoomed = await above(page, first);
    expect(zoomed.canvas.width).toBeGreaterThan(initial.canvas.width);
    await page.locator('#stageScroller').evaluate(stage => { stage.scrollLeft += 20; });
    const scrolled = await above(page, first);
    expect(scrolled.bubble.left).toBeLessThan(zoomed.bubble.left);
    await select(page, 'second');
    await above(page, second);
    await page.setViewportSize({ width: viewport.height, height: viewport.width });
    if (viewport.height > 760) await expect(page.locator('#quickBubble')).toBeHidden();
    await page.setViewportSize(viewport);
    await expect(page.locator('#quickBubble')).toBeVisible();
    safe(await geometry(page, second));
    await page.locator('#quickBubble [data-quick="more"]').tap();
    await expect(page.locator('#mobilePropertyUI .mp-sheet')).toBeVisible();
    await expect(page.locator('#quickBubble')).toBeHidden();
    await page.locator('#documentTabsHome').tap();
    await expect(page.locator('#quickBubble')).toBeHidden();
    await page.locator('#stageScroller').dispatchEvent('scroll');
    await expect(page.locator('#quickBubble')).toBeHidden();
  });

  test('visual viewport avoids keyboard occlusion and text editing hides the menu', async ({ page }) => {
    // Browser-only viewport simulation, matching the existing mobile IME tests.
    await page.addInitScript(({ width, height }) => {
      const vv = new EventTarget();
      Object.assign(vv, { width, height, offsetTop: 0, offsetLeft: 0, pageTop: 0, scale: 1 });
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
    }, viewport);
    const element = { x: 120, y: 100, w: 80, h: 60, type: 'text', text: 'Menu', fontSize: 24, fontFamily: 'Arial' };
    await open(page, [element]);
    await above(page, element);
    await page.evaluate(({ width, height }) => {
      Object.assign(visualViewport, { width: width - 20, height: height - 300, offsetTop: 24, offsetLeft: 10 });
      visualViewport.dispatchEvent(new Event('resize'));
      visualViewport.dispatchEvent(new Event('scroll'));
    }, viewport);
    await expect.poll(async () => {
      const { bubble } = await geometry(page, element);
      return bubble.bottom <= viewport.height - 300 + 24 - 8;
    }).toBe(true);
    safe(await geometry(page, element));
    await page.evaluate(({ width, height }) => {
      Object.assign(visualViewport, { width, height, offsetTop: 0, offsetLeft: 0 });
      visualViewport.dispatchEvent(new Event('resize'));
    }, viewport);
    await page.locator('#mobileContext [data-mobile="edit"]').tap();
    await expect(page.locator('#inlineText')).toBeVisible();
    await expect(page.locator('#quickBubble')).toBeHidden();
  });

  test('oversized selection uses a safe position with minimal overlap', async ({ page }) => {
    const element = { x: 100, y: -1000, w: 50, h: 2240 };
    await open(page, [element]);
    const g = await geometry(page, element);
    safe(g);
    expect(g.bubble.right <= g.selection.left || g.bubble.left >= g.selection.right).toBe(true);
  });
});
