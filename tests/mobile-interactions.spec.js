const { test, expect, openHome, importPayload, records, openLibraryDocument, exportedDocument } = require('./helpers');
const graphFixture = require('./fixtures/canvas-graph.json');

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

// Observe browser APIs and public DOM only; never expose or invoke editor internals.
async function observe(page) {
  await page.addInitScript(() => {
    window.mobileAudit = { saves: 0, puts: [], completed: [], events: [] };
    const timeout = window.setTimeout;
    window.setTimeout = function (fn, delay, ...args) {
      if (delay === 420) mobileAudit.saves++;
      return timeout.call(this, fn, delay, ...args);
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      const request = put.call(this, value, ...args);
      if (this.name === 'docs') {
        mobileAudit.puts.push(structuredClone(value));
        this.transaction.addEventListener('complete', () => mobileAudit.completed.push(value.id));
      }
      return request;
    };
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) {
      document.addEventListener(type, ev => mobileAudit.events.push({ type, id: ev.pointerId, target: ev.target.id || ev.target.dataset?.mpNudge || ev.target.dataset?.mpPlane }), true);
    }
  });
}
async function open(page, { graph = false, locked = false } = {}) {
  await observe(page); await openHome(page);
  const payload = structuredClone(graphFixture); payload.documents = [payload.documents[0]];
  if (!graph) {
    payload.documents[0].groups = [];
    payload.documents[0].elements = [{ ...payload.documents[0].elements[3], x: 40, y: 40, w: 80, h: 80, locked }];
  }
  await importPayload(page, payload);
  let doc;
  await expect.poll(async () => { doc = (await records(page, 'docs')).find(d => d.title === 'Graph template'); return doc?.id; }).toBeTruthy();
  await expect(page.locator('#toast')).toContainText('Импортировано проектов');
  await openLibraryDocument(page, doc.id);
  await select(page, graph ? 'title' : 'independent');
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  await resetAudit(page);
  return doc;
}
async function select(page, id, group = false) {
  await page.locator('#mobileToolbars [data-mobile="layers"]:visible').tap();
  await page.locator(`#mobileLayerList [${group ? 'data-group-id' : 'data-layer'}="${id}"] .layer-name`).tap();
  await page.locator('#mobileLayersClose').tap();
}
async function tool(page, name) {
  const button = page.locator(`#mobileContext [data-mobile="${name}"]`);
  await button.scrollIntoViewIfNeeded(); await button.tap();
}
async function color(page) { await tool(page, 'color'); await page.locator('[data-mp-action="colorEdit"]').tap(); }
async function resetAudit(page) { await page.evaluate(() => { mobileAudit.saves = 0; mobileAudit.puts = []; mobileAudit.completed = []; mobileAudit.events = []; }); }
async function freezeClock(page) {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
}
async function audit(page) { return page.evaluate(() => mobileAudit); }
async function history(page) {
  return page.locator('#historyEntries [data-history-index]').evaluateAll(rows => ({ length: rows.length, index: rows.findIndex(r => r.getAttribute('aria-current') === 'step') }));
}
async function pointer(page, selector, type, id, x = .5, y = .5) {
  await page.locator(selector).evaluate((target, { type, id, x, y }) => {
    const r = target.getBoundingClientRect();
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: id, button: 0, buttons: type === 'pointerdown' || type === 'pointermove' ? 1 : 0, clientX: r.left + r.width * x, clientY: r.top + r.height * y }));
  }, { type, id, x, y });
}
async function touch(page, selector, x = .5, y = .5) {
  const client = await page.context().newCDPSession(page), r = await page.locator(selector).boundingBox();
  const point = { x: r.x + r.width * x, y: r.y + r.height * y, id: 0 };
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  const id = (await audit(page)).events.filter(e => e.type === 'pointerdown').at(-1).id;
  expect(await page.locator(selector).evaluate((el, id) => el.hasPointerCapture(id), id)).toBe(true);
  return { id, client, point,
    move: async (x, y) => client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, x: r.x + r.width * x, y: r.y + r.height * y }] }),
    end: async (cancel = false) => client.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] }),
  };
}
async function saved(page, expected) {
  await expect.poll(async () => (await records(page, 'docs')).find(d => d.id === expected.id)?.elements).toEqual(expected.elements);
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
}
async function reload(page, doc) {
  await saved(page, doc); await page.reload(); await openLibraryDocument(page, doc.id);
  expect((await exportedDocument(page)).elements).toEqual(doc.elements);
}
async function undoRedo(page, before, after) {
  await page.locator('#undoBtn').tap(); expect((await exportedDocument(page)).elements).toEqual(before.elements);
  await page.locator('#redoBtn').tap(); expect((await exportedDocument(page)).elements).toEqual(after.elements);
}

for (const cancel of [false, true]) test(`nudge ${cancel ? 'pointercancel' : 'pointerup'} settles one actual change once`, async ({ page }) => {
  await open(page); const before = await exportedDocument(page), h = await history(page);
  await tool(page, 'nudge'); const t = await touch(page, '[data-mp-nudge="right"]');
  expect((await exportedDocument(page)).elements[0].x).toBe(41);
  await resetAudit(page); await t.end(cancel);
  expect((await audit(page)).saves, 'one finish, no second generic commit').toBe(1);
  expect(await page.locator('[data-mp-nudge="right"]').evaluate((el, id) => el.hasPointerCapture(id), t.id)).toBe(false);
  expect(await history(page)).toEqual({ length: h.length + 1, index: h.index + 1 });
  const after = await exportedDocument(page); expect(after.elements[0].x).toBe(41);
  await page.waitForTimeout(550); expect((await audit(page)).puts).toHaveLength(1); expect((await audit(page)).completed).toHaveLength(1);
  await pointer(page, '#mobilePropertyUI', 'pointercancel', t.id);
  expect((await audit(page)).saves).toBe(1);
  await undoRedo(page, before, after); await reload(page, after);
});

test('foreign and repeated cancellation cannot finalize a pending numeric edit', async ({ page }) => {
  await open(page); await tool(page, 'opacity');
  await page.locator('input[type="range"][data-mp-key="opacity"]').evaluate(input => { input.value = '70'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  const h = await history(page); await resetAudit(page);
  for (let i = 0; i < 2; i++) await pointer(page, '#mobilePropertyUI', 'pointercancel', 99);
  expect(await history(page)).toEqual(h); expect((await audit(page)).saves).toBe(0);
  await page.locator('input[type="range"][data-mp-key="opacity"]').dispatchEvent('change');
  expect((await exportedDocument(page)).elements[0].opacity).toBe(70);
});

test('foreign pointerup/cancel and second down cannot steal a held nudge', async ({ page }) => {
  await open(page); await tool(page, 'nudge'); await freezeClock(page);
  await pointer(page, '[data-mp-nudge="right"]', 'pointerdown', 11);
  await resetAudit(page); const h = await history(page);
  await pointer(page, '[data-mp-nudge="left"]', 'pointerdown', 12);
  await pointer(page, '[data-mp-nudge="right"]', 'pointerup', 12);
  await page.locator('[data-mp-nudge="left"]').dispatchEvent('click');
  await pointer(page, '#mobilePropertyUI', 'lostpointercapture', 11);
  await pointer(page, '#mobilePropertyUI', 'pointercancel', 12);
  expect(await history(page)).toEqual(h); expect((await audit(page)).saves).toBe(0);
  await page.clock.runFor(640); // 1 immediate + 4 repeats at 430, 500, 570, 640.
  expect((await exportedDocument(page)).elements[0].x).toBe(45);
  await pointer(page, '#mobilePropertyUI', 'pointercancel', 11);
  expect((await exportedDocument(page)).elements[0].x).toBe(45);
  await page.clock.runFor(700); expect((await exportedDocument(page)).elements[0].x).toBe(45);
  expect((await history(page)).length).toBe(h.length + 1);
});

for (const finish of ['cancel', 'up', 'close', 'switch']) test(`color plane ${finish} keeps last preview, one undo and persisted color`, async ({ page }) => {
  await open(page); const before = await exportedDocument(page), h = await history(page); await color(page);
  const t = await touch(page, '[data-mp-plane]', .1, .1); await t.move(.8, .7);
  const after = await exportedDocument(page); expect(after.elements[0].fill).not.toBe(before.elements[0].fill);
  await resetAudit(page);
  if (finish === 'close') { await page.locator('#mobileConfirm').dispatchEvent('click'); await t.end(true); }
  else if (finish === 'switch') { await page.locator('#mobileContext [data-mobile="more"]').dispatchEvent('click'); await t.end(true); }
  else await t.end(finish === 'cancel');
  expect((await audit(page)).saves).toBe(1);
  expect(await history(page)).toEqual({ length: h.length + 1, index: h.index + 1 });
  await pointer(page, '#mobilePropertyUI', 'pointercancel', t.id); expect((await audit(page)).saves).toBe(1);
  expect((await exportedDocument(page)).elements).toEqual(after.elements);
  await expect(page.locator('#mobileContext')).not.toHaveClass(/hidden/);
  if (finish !== 'close') await page.locator('#mobileConfirm').dispatchEvent('click');
  await color(page);
  await expect(page.locator('[data-mp-hex]')).toHaveValue(after.elements[0].fill);
  await page.locator('#mobileConfirm').dispatchEvent('click');
  await undoRedo(page, before, after); await reload(page, after);
});

test('foreign cancellation leaves captured color plane active', async ({ page }) => {
  await open(page); await color(page); const t = await touch(page, '[data-mp-plane]', .2, .2);
  const h = await history(page); await resetAudit(page);
  await pointer(page, '[data-mp-plane]', 'pointercancel', t.id + 100);
  await pointer(page, '[data-mp-plane]', 'pointerup', t.id + 100);
  expect((await audit(page)).saves).toBe(0); expect(await history(page)).toEqual(h);
  await t.move(.8, .8); const preview = await exportedDocument(page); await t.end(true);
  expect((await exportedDocument(page)).elements).toEqual(preview.elements);
  expect((await history(page)).length).toBe(h.length + 1);
});

test('closing a held nudge stops repeats and releases capture', async ({ page }) => {
  await open(page); await tool(page, 'nudge'); const h = await history(page);
  const t = await touch(page, '[data-mp-nudge="down"]');
  await page.locator('#mobileConfirm').dispatchEvent('click');
  await page.waitForTimeout(600); expect((await exportedDocument(page)).elements[0].y).toBe(41);
  await t.end(true); expect((await history(page)).length).toBe(h.length + 1);
  const after = await exportedDocument(page); await reload(page, after);
});

test('locked nudge and idle cancellation create no selection-only history', async ({ page }) => {
  await open(page, { locked: true }); const before = await exportedDocument(page), h = await history(page); await tool(page, 'nudge');
  await resetAudit(page); const t = await touch(page, '[data-mp-nudge="right"]'); await t.end(true);
  expect(await history(page)).toEqual(h); expect((await audit(page)).saves).toBe(0);
  expect(await exportedDocument(page)).toEqual(before);
});

for (const mode of ['single', 'group']) test(`More copy ${mode} is read-only; paste allocates IDs, history and linked graph`, async ({ page }) => {
  await open(page, { graph: true }); if (mode === 'group') await select(page, 'outer', true);
  const before = await exportedDocument(page), h = await history(page); await tool(page, 'more');
  await expect(page.locator('[data-mp-more="copy"]')).toBeVisible();
  await resetAudit(page); await page.locator('[data-mp-more="copy"]').tap();
  expect(await exportedDocument(page)).toEqual(before); expect(await history(page)).toEqual(h); expect((await audit(page)).saves).toBe(0);
  await page.waitForTimeout(550); expect((await audit(page)).puts).toHaveLength(0);
  await page.locator('[data-mp-more="paste"]').tap();
  const after = await exportedDocument(page), copies = after.elements.filter(e => !before.elements.some(o => o.id === e.id));
  expect(copies).toHaveLength(mode === 'group' ? 2 : 1); expect(new Set(after.elements.map(e => e.id)).size).toBe(after.elements.length);
  for (const e of copies) { const original = before.elements.find(o => e.name === o.name + ' копия'); expect(e.x).toBe(original.x + 24); expect(e.y).toBe(original.y + 24); }
  if (mode === 'group') {
    const shape = copies.find(e => e.type === 'rect'), text = copies.find(e => e.pathBoundary);
    expect(text.pathBoundary.sourceId).toBe(shape.id); expect(text.clipBaseId).toBe(shape.id);
    const inner = after.groups.find(g => g.id === shape.groupId); expect(inner.custom).toEqual({ keep: 1 });
    expect(inner.id).not.toBe('inner'); expect(inner.parentId).not.toBe('outer'); expect(text.groupId).toBe(inner.id);
    expect(after.groups).toHaveLength(4);
  } else expect(after.elements.filter(e => e.isTitleLayer)).toHaveLength(1);
  expect(await history(page)).toEqual({ length: h.length + 1, index: h.index + 1 });
  await undoRedo(page, before, after); await reload(page, after);
});

for (const kind of ['tap', 'hold', 'color cancel']) test(`baseline control: ${kind} normal contract`, async ({ page }) => {
  await open(page); const before = await exportedDocument(page), h = await history(page);
  if (kind === 'color cancel') {
    await color(page); const t = await touch(page, '[data-mp-plane]', .7, .7); const preview = await exportedDocument(page);
    await t.end(true); expect((await exportedDocument(page)).elements).toEqual(preview.elements);
  } else {
    await tool(page, 'nudge'); await freezeClock(page); await pointer(page, '[data-mp-nudge="right"]', 'pointerdown', 21);
    if (kind === 'hold') await page.clock.runFor(640);
    await pointer(page, '[data-mp-nudge="right"]', 'pointerup', 21);
    expect((await exportedDocument(page)).elements[0].x).toBe(kind === 'hold' ? 45 : 41);
    await page.clock.runFor(700); expect((await exportedDocument(page)).elements[0].x).toBe(kind === 'hold' ? 45 : 41);
    await page.clock.resume();
  }
  expect(await history(page)).toEqual({ length: h.length + 1, index: h.index + 1 });
  const after = await exportedDocument(page); await undoRedo(page, before, after); await reload(page, after);
});

test('two-finger canvas router cancels tentative drag, zooms and leaves no pointer state', async ({ page }) => {
  await open(page); const before = await exportedDocument(page), h = await history(page), zoom = await page.locator('#zoomLabel').textContent();
  const r = await page.locator('#canvas').boundingBox(), client = await page.context().newCDPSession(page);
  const a = { x: r.x + r.width * .2, y: r.y + r.height * .2, id: 0 }, b = { x: r.x + r.width * .6, y: a.y, id: 1 };
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] });
  await page.waitForTimeout(120);
  const moved = { ...a, x: a.x + 12 };
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [moved] });
  expect((await exportedDocument(page)).elements[0].x).not.toBe(before.elements[0].x);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [moved, b] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...moved, x: moved.x - 12, y: moved.y + 8 }, { ...b, x: b.x + 18, y: b.y + 8 }] });
  const scroller = page.locator('#stageScroller'), panBefore = await scroller.evaluate(el => el.scrollLeft);
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...moved, x: moved.x - 32, y: moved.y + 8 }, { ...b, x: b.x - 2, y: b.y + 8 }] });
  expect(await scroller.evaluate(el => el.scrollLeft)).toBeGreaterThan(panBefore);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await page.locator('#zoomLabel').textContent()).not.toBe(zoom);
  expect((await exportedDocument(page)).elements).toEqual(before.elements); expect(await history(page)).toEqual(h);
  await tool(page, 'nudge'); await page.locator('[data-mp-nudge="right"]').tap();
  let after = await exportedDocument(page); expect(after.elements[0].x).toBe(41);
  await page.locator('#mobileConfirm').tap();
  const nextBox = await page.locator('#canvas').boundingBox();
  const next = { x: nextBox.x + nextBox.width * .2, y: nextBox.y + nextBox.height * .2, id: 0 };
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [next] });
  await page.waitForTimeout(120);
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...next, x: next.x + 24 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  after = await exportedDocument(page); expect(after.elements[0].x).toBeGreaterThan(41); expect(after.elements[0].y).toBe(40);
  await reload(page, after);
});

async function selectPair(page) {
  await tool(page, 'layers');
  await page.locator('#mobileLayerList [data-layer="shape-original"] .layer-name').tap();
  // Existing additive selection contract, delivered through the real DOM handler.
  await page.locator('#mobileLayerList [data-layer="text-original"] .layer-name').click({ modifiers: ['Control'] });
  await expect(page.locator('#mobileLayerList [data-layer].selected')).toHaveCount(2);
  await page.locator('#mobileLayersClose').tap();
}

for (const mode of ['pair', 'group', 'boundary']) test(`mobile clipboard across documents: ${mode}`, async ({ page }) => {
  const source = await open(page, { graph: true });
  if (mode === 'pair') await selectPair(page);
  else await select(page, mode === 'group' ? 'outer' : 'text-original', mode === 'group');
  const original = await exportedDocument(page), h = await history(page);
  await tool(page, 'more'); await page.locator('[data-mp-more="copy"]').tap();
  expect(await exportedDocument(page)).toEqual(original); expect(await history(page)).toEqual(h);
  await page.locator('#documentTabsPlus').tap();
  await page.locator(`[data-tab-picker-project="${source.projectId}"]`).tap();
  await page.locator('[data-tab-picker-create="template"]').tap();
  await page.locator('[data-mobile="shapes"]:visible').tap(); await page.locator('[data-tray-shape="basic0"]').tap();
  const before = await exportedDocument(page), targetHistory = await history(page);
  await saved(page, before);
  await tool(page, 'more'); await resetAudit(page); await page.locator('[data-mp-more="paste"]').tap();
  const after = await exportedDocument(page), copies = after.elements.filter(e => !before.elements.some(o => o.id === e.id));
  expect(copies).toHaveLength(mode === 'boundary' ? 1 : 2);
  const text = copies.find(e => e.pathBoundary), shape = copies.find(e => e.type === 'rect');
  expect(text.pathBoundary.sourceId).toBe(shape?.id || null);
  if (shape) { expect(text.clipBaseId).toBe(shape.id); expect(text.clipped).toBe(true); }
  else { expect(text.clipBaseId).toBeUndefined(); expect(text.clipped).toBe(false); expect(text.pathBoundary.fallback.points.length).toBeGreaterThan(0); }
  expect(new Set(after.elements.map(e => e.id)).size).toBe(after.elements.length);
  expect(copies.every(e => !original.elements.some(o => o.id === e.id))).toBe(true);
  if (mode === 'group') {
    expect(after.groups).toHaveLength(2); expect(text.groupId).toBe(shape.groupId);
    const inner = after.groups.find(g => g.id === shape.groupId); expect(inner.custom).toEqual({ keep: 1 });
    expect(after.groups.some(g => g.id === inner.parentId)).toBe(true);
  } else { expect(after.groups).toEqual([]); expect(copies.every(e => !e.groupId)).toBe(true); }
  expect(await history(page)).toEqual({ length: targetHistory.length + 1, index: targetHistory.index + 1 });
  await saved(page, after); await page.waitForTimeout(550);
  expect((await audit(page)).puts.filter(d => d.id === after.id)).toHaveLength(1);
  expect((await records(page, 'docs')).find(d => d.id === source.id)).toEqual(source);
  await undoRedo(page, before, after); await reload(page, after);
});

test('un-grouped multi-selection copy/paste retains available parents and internal links', async ({ page }) => {
  await open(page, { graph: true }); await selectPair(page); const before = await exportedDocument(page), h = await history(page);
  await tool(page, 'more'); await resetAudit(page); await page.locator('[data-mp-more="copy"]').tap();
  expect(await exportedDocument(page)).toEqual(before); expect(await history(page)).toEqual(h); expect((await audit(page)).saves).toBe(0);
  await page.locator('[data-mp-more="paste"]').tap(); const after = await exportedDocument(page), copies = after.elements.filter(e => !before.elements.some(o => o.id === e.id));
  expect(copies).toHaveLength(2); expect(after.groups).toEqual(before.groups);
  const shape = copies.find(e => e.type === 'rect'), text = copies.find(e => e.pathBoundary);
  expect(shape.groupId).toBe('inner'); expect(text.groupId).toBe('inner'); expect(text.pathBoundary.sourceId).toBe(shape.id); expect(text.clipBaseId).toBe(shape.id);
  await undoRedo(page, before, after); await reload(page, after);
});

test('matching pointerup outside the panel works without pointer capture', async ({ page }) => {
  await open(page); await tool(page, 'nudge'); const h = await history(page);
  await pointer(page, '[data-mp-nudge="up"]', 'pointerdown', 31);
  await resetAudit(page); await pointer(page, 'body', 'pointerup', 31);
  const after = await exportedDocument(page); expect(after.elements[0].y).toBe(39); expect((await audit(page)).saves).toBe(1);
  await page.waitForTimeout(550); expect((await exportedDocument(page)).elements).toEqual(after.elements);
  expect((await history(page)).length).toBe(h.length + 1); await reload(page, after);
});

test('lost capture settles a real color preview only once', async ({ page }) => {
  await open(page); await color(page); const h = await history(page), t = await touch(page, '[data-mp-plane]', .3, .4);
  const after = await exportedDocument(page); await resetAudit(page);
  await page.locator('[data-mp-plane]').evaluate((el, id) => el.releasePointerCapture(id), t.id);
  await t.move(.3, .4); await t.end(true);
  expect((await audit(page)).saves).toBe(1); expect((await history(page)).length).toBe(h.length + 1);
  expect((await exportedDocument(page)).elements).toEqual(after.elements); await reload(page, after);
});

test('text editing, lock and separate Duplicate still work after color cancellation', async ({ page }) => {
  await open(page, { graph: true }); const before = await exportedDocument(page); await color(page);
  const t = await touch(page, '[data-mp-plane]', .4, .6); await t.end(true);
  let after = await exportedDocument(page); expect(after.elements.find(e => e.id === 'title').textColor).not.toBe('#111111');
  await page.locator('[data-mp-action="done"]').tap(); await tool(page, 'edit');
  await expect(page.locator('#inlineText')).toBeVisible(); await page.locator('#inlineText').fill('После отмены');
  await page.locator('#inlineText').press('ControlOrMeta+Enter');
  after = await exportedDocument(page); expect(after.elements.find(e => e.id === 'title').text).toBe('После отмены');
  await tool(page, 'more'); await page.locator('[data-mp-more="lock"]').tap();
  expect((await exportedDocument(page)).elements.find(e => e.id === 'title').locked).toBe(true);
  await page.locator('[data-mp-more="lock"]').tap(); await page.locator('[data-mp-action="done"]').tap();
  const h = await history(page); await page.locator('#quickBubble [data-quick="duplicate"]').tap();
  after = await exportedDocument(page); expect(after.elements).toHaveLength(before.elements.length + 1);
  expect(after.elements.filter(e => e.isTitleLayer)).toHaveLength(1); expect((await history(page)).length).toBe(h.length + 1);
  await reload(page, after);
});

test('unchanged black color plane cancellation never creates a history entry', async ({ page }) => {
  await open(page); await color(page);
  await page.locator('[data-mp-hex]').fill('#000000'); await page.locator('[data-mp-hex]').press('Tab');
  const before = await exportedDocument(page), h = await history(page);
  await pointer(page, '[data-mp-plane]', 'pointerdown', 88, .5, 1);
  expect((await exportedDocument(page)).elements).toEqual(before.elements); await resetAudit(page); await pointer(page, '[data-mp-plane]', 'pointercancel', 88);
  expect(await history(page)).toEqual(h); expect((await audit(page)).saves).toBe(0);
  expect((await exportedDocument(page)).elements).toEqual(before.elements); await reload(page, before);
});

for (const mode of ['gradient', 'effect']) test(`color cancellation retains ${mode} preview and undo contract`, async ({ page }) => {
  await open(page);
  if (mode === 'gradient') { await color(page); await page.locator('[data-mp-tab="gradient"]').tap(); }
  else {
    await tool(page, 'effects'); await page.locator('[data-mp-effect="dropShadow"]').tap();
    await page.locator('[data-mp-effect="dropShadow"]').tap();
    await page.locator('[data-mp-fx-pick="dropShadow"]').tap();
  }
  const before = await exportedDocument(page), h = await history(page);
  const t = await touch(page, '[data-mp-plane]', .8, .6); const after = await exportedDocument(page);
  expect(after.elements).not.toEqual(before.elements); await resetAudit(page); await t.end(true);
  expect((await audit(page)).saves).toBe(1); expect((await history(page)).length).toBe(h.length + 1);
  expect((await exportedDocument(page)).elements).toEqual(after.elements);
  await page.locator('[data-mp-action="done"]').tap(); await undoRedo(page, before, after); await reload(page, after);
});
