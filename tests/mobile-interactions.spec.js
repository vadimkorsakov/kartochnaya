const { test, expect, openHome, importPayload, records, openLibraryDocument, exportedDocument } = require('./helpers');
const { installMobilePointerDiagnostics, attachMobilePointerDiagnostics } = require('./mobile-pointer-diagnostics');
const graphFixture = require('./fixtures/canvas-graph.json');

test.afterEach(async ({ page }, info) => {
  if (/^(color plane |color Done |color UI )/.test(info.title) && info.status !== info.expectedStatus) await attachMobilePointerDiagnostics(page, info);
});

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
    for (const type of ['click', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) {
      document.addEventListener(type, ev => {
        const button = ev.target.closest?.('button');
        mobileAudit.events.push({ type, id: ev.pointerId, x: ev.clientX, y: ev.clientY, trusted: ev.isTrusted, action: button?.dataset.mpAction, mobile: button?.dataset.mobile, target: ev.target.id || ev.target.dataset?.mpNudge || ev.target.dataset?.mpPlane });
      }, true);
    }
  });
}
async function open(page, { graph = false, locked = false, fill, distances = false } = {}) {
  await observe(page); await openHome(page);
  const payload = structuredClone(graphFixture); payload.documents = [payload.documents[0]];
  if (!graph) {
    payload.documents[0].groups = [];
    payload.documents[0].elements = [{ ...payload.documents[0].elements[3], x: 40, y: 40, w: 80, h: 80, locked }];
  }
  if (distances) {
    const base = payload.documents[0].elements[0];
    payload.documents[0].elements.push(
      { ...base, id: 'nearest', x: 160, y: 50, w: 20, h: 20, rotation: 90 },
      { ...base, id: 'hidden-near', x: 130, visible: false },
      { ...base, id: 'off-axis', x: 125, y: 180, w: 10, h: 10 }
    );
  }
  if (fill) payload.documents[0].elements[0].fill = fill;
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
// Ordinary buttons use Playwright's actionable tap. CDP is reserved for the
// controlled plane gesture; a raw touchStart/touchEnd pair need not yield click.
async function tapButton(page, selector) {
  const button = page.locator(selector);
  await expect(button).toBeVisible(); await expect(button).toBeEnabled();
  const expected = await button.evaluate(el => ({ action: el.dataset.mpAction, mobile: el.dataset.mobile }));
  const start = (await audit(page)).events.length;
  await button.tap();
  try {
    await expect.poll(async () => (await audit(page)).events.slice(start).some(e => e.type === 'click' && e.trusted && e.action === expected.action && e.mobile === expected.mobile)).toBe(true);
  } catch (error) {
    throw new Error(error.message + '\nButton tap events: ' + JSON.stringify((await audit(page)).events.slice(start)));
  }
}
async function color(page) {
  await tapButton(page, '#mobileContext [data-mobile="color"]');
  await tapButton(page, '[data-mp-action="colorEdit"]');
}
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
    move: async (x, y) => {
      const next = { ...point, x: r.x + r.width * x, y: r.y + r.height * y };
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [next] });
      // CDP acknowledgement can precede delivery of a coalesced pointermove.
      await expect.poll(async () => (await audit(page)).events.some(e => e.type === 'pointermove' && e.id === id && Math.abs(e.x - next.x) < 1 && Math.abs(e.y - next.y) < 1)).toBe(true);
    },
    end: async (cancel = false) => {
      await client.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
      await expect.poll(async () => (await audit(page)).events.some(e => e.id === id && e.type === (cancel ? 'pointercancel' : 'pointerup'))).toBe(true);
    },
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
async function undoRedo(page, before, after, input = 'tap') {
  await page.locator('#undoBtn')[input](); expect((await exportedDocument(page)).elements).toEqual(before.elements);
  await page.locator('#redoBtn')[input](); expect((await exportedDocument(page)).elements).toEqual(after.elements);
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
  await page.clock.runFor(640); // 1 immediate + 3 early repeats, before acceleration changes step size.
  expect((await exportedDocument(page)).elements[0].x).toBe(44);
  await pointer(page, '#mobilePropertyUI', 'pointercancel', 11);
  expect((await exportedDocument(page)).elements[0].x).toBe(44);
  await page.clock.runFor(700); expect((await exportedDocument(page)).elements[0].x).toBe(44);
  expect((await history(page)).length).toBe(h.length + 1);
});

for (const finish of ['cancel', 'up', 'close', 'switch']) test(`color plane ${finish} keeps last preview, one undo and persisted color`, async ({ page }) => {
  await installMobilePointerDiagnostics(page);
  await open(page); const before = await exportedDocument(page), h = await history(page); await color(page);
  const t = await touch(page, '[data-mp-plane]', .1, .1); await t.move(.8, .7);
  const after = await exportedDocument(page); expect(after.elements[0].fill).not.toBe(before.elements[0].fill);
  await resetAudit(page);
  if (finish === 'close') { await page.locator('[data-mp-action="done"]').click(); await t.end(true); }
  else if (finish === 'switch') {
    const more = page.locator('#mobileContext [data-mobile="more"]');
    await more.focus(); await more.press('Enter'); await t.end(true);
  }
  else await t.end(finish === 'cancel');
  expect((await audit(page)).saves).toBe(1);
  expect(await history(page)).toEqual({ length: h.length + 1, index: h.index + 1 });
  for (const id of [t.id + 100, t.id, t.id]) {
    await pointer(page, '#mobilePropertyUI', 'pointercancel', id);
    await pointer(page, '#mobilePropertyUI', 'pointerup', id);
    expect((await audit(page)).saves).toBe(1);
    expect(await history(page)).toEqual({ length: h.length + 1, index: h.index + 1 });
  }
  expect((await exportedDocument(page)).elements).toEqual(after.elements);
  await expect(page.locator('#mobileContext')).not.toHaveClass(/hidden/);
  // Mouse is an independent, actionable UI close after the controlled CDP stream.
  // Touch-click delivery is covered below in fresh contexts without synthetic IDs.
  if (finish !== 'close') await page.locator('[data-mp-action="done"]').click();
  await expect(page.locator('#mobilePropertyUI')).not.toHaveClass(/mp-open/);
  await saved(page, after);
  await expect.poll(async () => (await audit(page)).completed.length).toBe(1);
  expect((await audit(page)).puts).toHaveLength(1);
  await attachMobilePointerDiagnostics(page, test.info());
  await undoRedo(page, before, after, 'click'); await reload(page, after);
});

test('color Done tap delivers trusted click, closes and reopens without mutation', async ({ page }) => {
  await installMobilePointerDiagnostics(page);
  await open(page, { fill: '#2874A6' });
  const before = await exportedDocument(page), h = await history(page);
  await color(page); await expect(page.locator('[data-mp-hex]')).toHaveValue('#2874A6');
  await resetAudit(page);
  await tapButton(page, '[data-mp-action="done"]');
  await expect(page.locator('#mobilePropertyUI')).not.toHaveClass(/mp-open/);
  await color(page); await expect(page.locator('[data-mp-hex]')).toHaveValue('#2874A6');
  await tapButton(page, '[data-mp-action="done"]');
  await expect(page.locator('#mobilePropertyUI')).not.toHaveClass(/mp-open/);
  expect(await exportedDocument(page)).toEqual(before); expect(await history(page)).toEqual(h);
  expect((await audit(page)).saves).toBe(0);
  await page.waitForTimeout(550);
  expect((await audit(page)).puts).toHaveLength(0); expect((await audit(page)).completed).toHaveLength(0);
  await attachMobilePointerDiagnostics(page, test.info());
  await reload(page, before);
});

test('color UI taps edit, confirm, reopen and edit again with history and persistence', async ({ page }) => {
  await installMobilePointerDiagnostics(page);
  await open(page); const before = await exportedDocument(page), h = await history(page);
  await color(page);
  const versions = [before];
  for (const fraction of [{ x: .2, y: .25 }, { x: .8, y: .7 }]) {
    await resetAudit(page);
    // One Playwright touch stream throughout: no CDP or dispatched PointerEvents.
    const plane = page.locator('[data-mp-plane]');
    const position = await plane.evaluate((el, f) => ({ x: el.clientWidth * f.x, y: el.clientHeight * f.y }), fraction);
    await plane.tap({ position });
    const after = await exportedDocument(page); versions.push(after);
    expect(after.elements[0].fill).not.toBe(versions.at(-2).elements[0].fill);
    await expect(page.locator('[data-mp-hex]')).toHaveValue(after.elements[0].fill);
    expect(await history(page)).toEqual({ length: h.length + versions.length - 1, index: h.index + versions.length - 1 });
    // Plane preview plus its finish; confirming and reopening must add no saves.
    const saves = (await audit(page)).saves;
    await tapButton(page, '[data-mp-action="done"]');
    await expect(page.locator('#mobilePropertyUI')).not.toHaveClass(/mp-open/);
    await color(page); await expect(page.locator('[data-mp-hex]')).toHaveValue(after.elements[0].fill);
    expect((await audit(page)).saves).toBe(saves);
    expect((await exportedDocument(page)).elements).toEqual(after.elements);
    await saved(page, after);
    await expect.poll(async () => (await audit(page)).completed.length).toBe(1);
    expect((await audit(page)).puts).toHaveLength(1);
  }
  await tapButton(page, '[data-mp-action="done"]');
  await expect(page.locator('#mobilePropertyUI')).not.toHaveClass(/mp-open/);
  await undoRedo(page, versions[1], versions[2]);
  await page.locator('#undoBtn').tap(); await page.locator('#undoBtn').tap();
  expect((await exportedDocument(page)).elements).toEqual(before.elements);
  await page.locator('#redoBtn').tap(); await page.locator('#redoBtn').tap();
  expect((await exportedDocument(page)).elements).toEqual(versions[2].elements);
  expect(await history(page)).toEqual({ length: h.length + 2, index: h.index + 2 });
  await attachMobilePointerDiagnostics(page, test.info());
  await reload(page, versions[2]);
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
    expect((await exportedDocument(page)).elements[0].x).toBe(kind === 'hold' ? 44 : 41);
    await page.clock.runFor(700); expect((await exportedDocument(page)).elements[0].x).toBe(kind === 'hold' ? 44 : 41);
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
  await expect.poll(() => page.locator('#zoomLabel').textContent()).not.toBe(zoom);
  const scroller = page.locator('#stageScroller'), panBefore = await scroller.evaluate(el => el.scrollLeft);
  // Pan away from the nearest bound: increasing an already maximal scrollLeft
  // is clamped and cannot demonstrate whether the router panned correctly.
  const dx = panBefore >= 20 ? 20 : -20;
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...moved, x: moved.x - 12 + dx, y: moved.y + 8 }, { ...b, x: b.x + 18 + dx, y: b.y + 8 }] });
  if (dx > 0) await expect.poll(() => scroller.evaluate(el => el.scrollLeft)).toBeLessThan(panBefore);
  else await expect.poll(() => scroller.evaluate(el => el.scrollLeft)).toBeGreaterThan(panBefore);
  expect(Math.abs(await scroller.evaluate(el => el.scrollLeft) - (panBefore - dx))).toBeLessThanOrEqual(1);
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
  // setPointerCapture is pending after down. Apply it before testing actual loss.
  await t.move(.31, .41);
  expect((await audit(page)).events.some(e => e.type === 'gotpointercapture' && e.id === t.id)).toBe(true);
  const after = await exportedDocument(page); await resetAudit(page);
  await page.locator('[data-mp-plane]').evaluate((el, id) => el.releasePointerCapture(id), t.id);
  await t.move(.32, .42);
  expect((await audit(page)).events.some(e => e.type === 'lostpointercapture' && e.id === t.id)).toBe(true);
  await t.end(true);
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


const residentRight = '#mobileNudge [data-mp-nudge="right"]';
test('resident arrows follow selection, menus, properties, viewport and home', async ({ page }) => {
  await open(page); await expect(page.locator('#mobileNudge')).toBeVisible();
  const panel = await page.locator('#mobileNudge').boundingBox(), toolbar = await page.locator('#mobileToolbars').boundingBox();
  expect(panel.y + panel.height).toBeLessThan(toolbar.y);
  await color(page); await expect(page.locator('#mobileNudge')).toBeHidden();
  await page.locator('[data-mp-action="done"]').tap(); await expect(page.locator('#mobileNudge')).toBeVisible();
  await page.locator('#historyToggle').tap(); await expect(page.locator('#mobileNudge')).toBeHidden();
  await page.locator('#historyToggle').tap(); await expect(page.locator('#mobileNudge')).toBeVisible();
  await page.setViewportSize({ width: 800, height: 844 }); await expect(page.locator('#mobileNudge')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 }); await expect(page.locator('#mobileNudge')).toBeVisible();
  await page.locator('#documentTabsHome').tap(); await expect(page.locator('#mobileNudge')).toBeHidden();
  await page.locator('#homeEditorBtn').tap(); await expect(page.locator('#mobileNudge')).toBeVisible();
  await page.locator('#mobileConfirm').tap(); await expect(page.locator('#mobileNudge')).toBeHidden();
});

test('resident tap is one document pixel at any zoom with one undo and redo', async ({ page }) => {
  await open(page); const before = await exportedDocument(page), h = await history(page);
  await page.locator(residentRight).tap(); const after = await exportedDocument(page);
  expect(after.elements[0].x).toBe(before.elements[0].x + 1);
  expect(after.elements[0].y).toBe(before.elements[0].y);
  expect((await history(page)).length).toBe(h.length + 1);
  await undoRedo(page, before, after);
  await page.locator(residentRight).focus(); await page.locator(residentRight).press('Enter');
  expect((await exportedDocument(page)).elements[0].x).toBe(after.elements[0].x + 1);
});

test('resident hold accelerates gradually, stops immediately and resets on next press', async ({ page }) => {
  await open(page); await freezeClock(page); const h = await history(page);
  await pointer(page, residentRight, 'pointerdown', 70);
  const x = async () => (await exportedDocument(page)).elements[0].x;
  expect(await x()).toBe(41); await page.clock.runFor(349); expect(await x()).toBe(41);
  await page.clock.runFor(1); expect(await x()).toBe(42);
  await page.clock.runFor(600); const early = await x();
  await page.clock.runFor(600); const middle = await x();
  await page.clock.runFor(600); const late = await x();
  expect(middle - early).toBeGreaterThan(early - 42); expect(late - middle).toBeGreaterThan(middle - early);
  await pointer(page, 'body', 'pointerup', 70); await page.clock.runFor(1000); expect(await x()).toBe(late);
  expect((await history(page)).length).toBe(h.length + 1);
  await pointer(page, residentRight, 'pointerdown', 71); expect(await x()).toBe(late + 1);
  await page.clock.runFor(349); expect(await x()).toBe(late + 1); await pointer(page, 'body', 'pointercancel', 71);
});

test('resident long press prevents selection, callout, context menu and dragging locally', async ({ page }) => {
  await open(page); await freezeClock(page); const t = await touch(page, residentRight);
  await page.clock.runFor(1400);
  expect(await page.evaluate(() => getSelection().toString())).toBe('');
  const protection = await page.locator(residentRight).evaluate(el => {
    const css = getComputedStyle(el);
    return { select: css.userSelect, touch: css.touchAction, label: el.getAttribute('aria-label'), prevented: ['contextmenu', 'selectstart', 'dragstart'].map(type => !el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))) };
  });
  expect(protection).toEqual({ select: 'none', touch: 'none', label: 'Сдвинуть вправо', prevented: [true, true, true] });
  await t.end();
  expect(await page.locator('#projectTitle').evaluate(el => el.dispatchEvent(new Event('selectstart', { bubbles: true, cancelable: true })))).toBe(true);
});

test('resident measurements use nearest projected visible bounds and expire without model data', async ({ page }) => {
  await page.addInitScript(() => {
    window.measureLabels = [];
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { if (this.canvas.id === 'canvas') measureLabels.push(String(text)); return fillText.call(this, text, ...args); };
  });
  await open(page, { distances: true }); await freezeClock(page);
  await pointer(page, residentRight, 'pointerdown', 72);
  expect(await page.evaluate(() => measureLabels.slice(-4))).toEqual(['41', '39', '40', '120']);
  await pointer(page, 'body', 'pointerup', 72);
  const after = await exportedDocument(page); expect(JSON.stringify(after)).not.toMatch(/measure|nudge/i);
  await page.evaluate(() => { measureLabels = []; }); await page.clock.runFor(851);
  expect(await page.evaluate(() => measureLabels)).not.toEqual(expect.arrayContaining(['39', '120']));
});

test('resident cancellation, foreign touch, lost capture, blur and locked layers preserve ownership', async ({ page }) => {
  await open(page); await freezeClock(page); const before = await exportedDocument(page), h = await history(page);
  await pointer(page, residentRight, 'pointerdown', 73);
  await pointer(page, residentRight, 'pointerdown', 74); await pointer(page, 'body', 'pointercancel', 74);
  expect((await history(page)).length).toBe(h.length);
  await pointer(page, residentRight, 'lostpointercapture', 73); await page.clock.runFor(900);
  expect((await exportedDocument(page)).elements[0].x).toBe(41); expect((await history(page)).length).toBe(h.length + 1);
  await undoRedo(page, before, await exportedDocument(page));
  await pointer(page, residentRight, 'pointerdown', 75); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.clock.runFor(900);
  expect((await exportedDocument(page)).elements[0].x).toBe(42);
  await page.locator('#quickBubble [data-quick="lock"]').tap(); await expect(page.locator(residentRight)).toBeDisabled();
  await pointer(page, residentRight, 'pointerdown', 76); await page.clock.runFor(900);
  expect((await exportedDocument(page)).elements[0].x).toBe(42);
});
