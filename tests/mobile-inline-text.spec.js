const { test, expect, openHome, importPayload, records, openLibraryDocument, exportedDocument, canvasPoint, createDocument } = require('./helpers');
const fixture = require('./fixtures/canvas-graph.json');
const editor = '#inlineText', done = '#inlineTextDone';
const text = doc => doc.elements.find(e => e.id === 'title').text;
const history = page => page.locator('#historyEntries [data-history-index]').count();
async function select(page, id = 'title', mobile = true) {
  if (mobile) {
    await page.locator('[data-mobile=layers]:visible').tap();
    await page.locator(`#mobileLayerList [data-layer="${id}"] .layer-name`).tap();
    await page.locator('#mobileLayersClose').tap();
  } else await page.locator(`#layers [data-layer="${id}"] .layer-name`).click();
}
async function edit(page, mobile = true) {
  if (mobile) await page.locator('#mobileContext [data-mobile=edit]').tap();
  else { const p = await canvasPoint(page, 100, 175); await page.mouse.dblclick(p.x, p.y); }
  await expect(page.locator(editor)).toBeFocused();
}
async function open(page, options = {}) {
  if (page.url() === 'about:blank') await openHome(page);
  const payload = structuredClone(fixture); payload.documents = [payload.documents[0]];
  const d = payload.documents[0];
  if (options.card) { d.type = 'card'; d.hasCustomName = false; }
  if (options.mode) d.elements.find(e => e.id === 'title').textMode = options.mode;
  if (options.mode === 'path') d.elements.find(e => e.id === 'title').textPathPoints = [{ x: 0, y: .7 }, { x: .5, y: .2 }, { x: 1, y: .7 }];
  if (options.rotation) d.elements.find(e => e.id === 'title').rotation = options.rotation;
  if (options.locked) d.elements.find(e => e.id === 'title').locked = true;
  if (options.group) d.elements.find(e => e.id === 'title').groupId = 'inner';
  await importPayload(page, payload);
  await expect(page.locator('#toast')).toContainText('Импортировано проектов');
  const doc = (await records(page, 'docs')).find(d => d.elements.some(e => e.id === 'title' && e.text === 'Graph title'));
  if (options.card) await page.getByRole('button', { name: 'Карточки', exact: true }).click();
  await openLibraryDocument(page, doc.id);
  await select(page, options.id || 'title', options.mobile !== false);
  return exportedDocument(page);
}
async function visibleExit(page) {
  await expect(page.locator(done)).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const r = document.querySelector('#inlineTextDone').getBoundingClientRect();
    const t = document.querySelector('#inlineText').getBoundingClientRect(), v = window.visualViewport;
    return { inside: r.left >= (v?.offsetLeft || 0) && r.top >= (v?.offsetTop || 0) && r.right <= (v?.offsetLeft || 0) + (v?.width || innerWidth) && r.bottom <= (v?.offsetTop || 0) + (v?.height || innerHeight), overlap: r.left < t.right && r.right > t.left && r.top < t.bottom && r.bottom > t.top, height: document.querySelector('#inlineTextDone button').getBoundingClientRect().height, hit: !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('#inlineTextDone') };
  })).toEqual({ inside: true, overlap: false, height: 44, hit: true });
}
for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) test.describe(`inline finish ${viewport.width}`, () => {
  test.use({ viewport, hasTouch: true, isMobile: true });
  test('Done commits several inputs once, unchanged and repeated blur do nothing; sessions invalidate redo', async ({ page }) => {
    const before = await open(page); const h = await history(page);
    await expect(page.locator(done)).toBeHidden(); await edit(page); await visibleExit(page);
    await page.locator(editor).fill('Первый ввод'); await page.locator(editor).fill('Окончательный\nтекст');
    expect(await history(page)).toBe(h);
    await page.locator(`${done} button`).tap(); await expect(page.locator(editor)).toBeHidden(); await expect(page.locator(done)).toBeHidden();
    expect(await history(page)).toBe(h + 1);
    await page.locator(editor).dispatchEvent('blur'); expect(await history(page)).toBe(h + 1);
    const after = await exportedDocument(page);
    expect(text(after)).toBe('Окончательный\nтекст');
    expect(after.elements.map(({text, ...e}) => e)).toEqual(before.elements.map(({text, ...e}) => e));
    await page.locator('#undoBtn').tap(); expect(text(await exportedDocument(page))).toBe(text(before));
    await expect(page.locator(done)).toBeHidden(); await expect(page.locator(editor)).toBeHidden();
    await page.locator('#redoBtn').tap(); expect(text(await exportedDocument(page))).toBe(text(after));
    await edit(page); await page.locator(`${done} button`).tap(); expect(await history(page)).toBe(h + 1);
    await edit(page); await page.locator(editor).fill('Второй сеанс'); await page.locator(`${done} button`).tap();
    expect(await history(page)).toBe(h + 2); await page.locator('#undoBtn').tap(); expect(text(await exportedDocument(page))).toBe(text(after));
    await edit(page); await page.locator(editor).fill('Новая ветка истории'); await page.locator(`${done} button`).tap();
    await expect(page.locator('#redoBtn')).toBeDisabled(); expect(await history(page)).toBe(h + 2);
  });
  test('visual viewport IME simulation, scroll, rotation, blur and mobile Escape preserve text', async ({ page }, info) => {
    // Controlled API geometry, not a claim to reproduce a physical Android IME.
    await page.addInitScript(({ width, height }) => {
      const vv = new EventTarget(); Object.assign(vv, { height, width, offsetTop: 0, offsetLeft: 0, scale: 1 });
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
      window.imeViewport = values => { Object.assign(vv, values); vv.dispatchEvent(new Event('resize')); vv.dispatchEvent(new Event('scroll')); };
    }, viewport);
    await open(page); await edit(page); await page.locator(editor).fill('Сохранить после Back');
    for (const state of [{ height: viewport.height - 280, offsetTop: 20 }, { height: viewport.height - 240, offsetTop: 10 }, { height: viewport.height, offsetTop: 0 }]) {
      await page.evaluate(state => imeViewport(state), state); await visibleExit(page);
      if (state.offsetTop === 20) { await page.locator(done).screenshot({ path: info.outputPath('done-button.png') }); await page.screenshot({ path: info.outputPath('inline-ime-simulation.png') }); await visibleExit(page); }
    }
    await page.locator(editor).evaluate(el => el.blur()); await expect(page.locator(editor)).toBeVisible(); await visibleExit(page);
    await page.setViewportSize({ width: viewport.height, height: viewport.width });
    await page.evaluate(() => imeViewport({ width: innerWidth, height: innerHeight, offsetTop: 0 }));
    if (viewport.height <= 760) await visibleExit(page); else await expect(page.locator(done)).toBeHidden();
    await page.setViewportSize(viewport); await page.evaluate(() => imeViewport({ width: innerWidth, height: innerHeight })); await visibleExit(page);
    await page.locator(editor).focus(); await page.keyboard.press('Escape');
    await expect(page.locator(editor)).toBeHidden(); expect(text(await exportedDocument(page))).toBe('Сохранить после Back');
  });
});
test.describe('mobile inline integration', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  for (const target of ['card', 'workspace', 'object']) test(`first real touch on ${target} only finishes text`, async ({ page }) => {
    await open(page); await edit(page); await page.locator(editor).fill('Фиксация тапом');
    await page.locator(editor).evaluate(el => el.blur());
    const h = await history(page), before = await exportedDocument(page);
    let p;
    if (target === 'workspace') {
      const r = await page.locator('#stageScroller').boundingBox(); p = { x: r.x + 3, y: r.y + 6 };
    } else p = await canvasPoint(page, target === 'object' ? 280 : 245, target === 'object' ? 190 : 220);
    await page.touchscreen.tap(p.x, p.y);
    await expect(page.locator(editor)).toBeHidden(); await expect(page.locator(done)).toBeHidden();
    expect((await exportedDocument(page)).elements).toEqual(before.elements); expect(await history(page)).toBe(h + 1);
    await page.locator('#undoBtn').tap(); expect(text(await exportedDocument(page))).toBe('Graph title');
  });
  test('toolbar Undo finalizes the active session before restoring history', async ({ page }) => {
    await open(page); await edit(page); await page.locator(editor).fill('Первый сеанс'); await page.locator(`${done} button`).tap();
    await edit(page); await page.locator(editor).fill('Ещё открытый сеанс');
    await page.locator('#undoBtn').tap(); await expect(page.locator(editor)).toBeHidden(); await expect(page.locator(done)).toBeHidden();
    expect(text(await exportedDocument(page))).toBe('Первый сеанс');
    await page.locator('#redoBtn').tap(); expect(text(await exportedDocument(page))).toBe('Ещё открытый сеанс');
  });
  test('fallback without VisualViewport retains accessible Done', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(window, 'visualViewport', { value: undefined }));
    await open(page); await edit(page); await visibleExit(page); await page.locator(`${done} button`).tap();
    await expect(page.locator(done)).toBeHidden();
  });
  for (const options of [{ mode: 'vertical' }, { mode: 'path' }, { rotation: 30 }, { group: true }, { id: 'text-original' }]) test(`text compatibility ${JSON.stringify(options)}`, async ({ page }) => {
    const before = await open(page, options); const id = options.id || 'title'; await edit(page);
    if (options.id) await expect(page.locator(editor)).toHaveClass(/boundary-inline-editor/);
    await visibleExit(page); await page.locator(editor).fill('Текст\nABC'); await page.locator(`${done} button`).tap();
    const after = await exportedDocument(page), original = before.elements.find(e => e.id === id), changed = after.elements.find(e => e.id === id);
    expect(changed).toEqual({ ...original, text: 'Текст\nABC' });
    await page.locator('#undoBtn').tap(); expect((await exportedDocument(page)).elements.find(e => e.id === id)).toEqual(original);
  });
  test('locked text refuses inline editing without changing geometry or history', async ({ page }) => {
    const before = await open(page, { locked: true }), h = await history(page);
    const p = await canvasPoint(page, 100, 175);
    await page.touchscreen.tap(p.x, p.y); await page.touchscreen.tap(p.x, p.y);
    await expect(page.locator(editor)).toBeHidden(); await expect(page.locator(done)).toBeHidden();
    expect((await exportedDocument(page)).elements).toEqual(before.elements); expect(await history(page)).toBe(h);
  });
  test('automatic card title follows text through Undo and Redo', async ({ page }) => {
    const before = await open(page, { card: true }); await edit(page); await page.locator(editor).fill('Новый заголовок'); await page.locator(`${done} button`).tap();
    expect((await exportedDocument(page)).title).toBe('Новый заголовок');
    await page.locator('#undoBtn').tap(); expect((await exportedDocument(page)).title).toBe(before.title);
    await page.locator('#redoBtn').tap(); expect((await exportedDocument(page)).title).toBe('Новый заголовок');
  });
  test('switcher browsing, confirmed save failure and independent document history', async ({ page }) => {
    await page.addInitScript(() => {
      window.failInlineSave = false; const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) { const r = put.apply(this, args); if (this.name === 'docs') r.addEventListener('success', () => { if (failInlineSave) this.transaction.abort(); }); return r; };
    });
    await openHome(page); await createDocument(page, 'Другой документ');
    const other = await exportedDocument(page); await page.locator('#documentTabsHome').tap();
    const first = await open(page); await edit(page); await page.locator(editor).fill('Черновик для переключения');
    const h = await history(page);
    await page.locator('#documentTabsMenuToggle').tap(); await expect(page.locator(editor)).toBeVisible();
    await page.locator('#documentTabsMenuClose').tap(); await expect(page.locator(editor)).toBeFocused(); expect(await history(page)).toBe(h);
    await page.locator('#documentTabsMenuToggle').tap(); await page.locator(`[data-mobile-tab-id="${other.id}"] [data-mobile-tab-activate]`).tap();
    await expect(page.locator(editor)).toBeHidden(); await expect(page.locator(done)).toBeHidden(); expect(await history(page)).toBe(1);
    await page.locator('#documentTabsMenuToggle').tap(); await page.locator(`[data-mobile-tab-id="${first.id}"] [data-mobile-tab-activate]`).tap();
    expect(text(await exportedDocument(page))).toBe('Черновик для переключения'); expect(await history(page)).toBe(h + 1);
    await edit(page); await page.locator(editor).fill('Сбой сохранения'); await page.evaluate(() => { failInlineSave = true; });
    await page.locator('#documentTabsMenuToggle').tap(); await page.locator(`[data-mobile-tab-id="${first.id}"] [data-mobile-tab-close]`).tap();
    await expect(page.locator(`[data-mobile-tab-id="${first.id}"]`)).toBeVisible(); await expect(page.locator('#toast')).toContainText('Сохранение не подтверждено');
    await page.locator('#documentTabsMenuClose').tap(); expect(text(await exportedDocument(page))).toBe('Сбой сохранения');
    await edit(page); await expect(page.locator(editor)).toHaveValue('Сбой сохранения'); await page.locator(`${done} button`).tap();
    await page.evaluate(() => { failInlineSave = false; });
    await page.locator('#undoBtn').tap(); expect(text(await exportedDocument(page))).toBe('Черновик для переключения');
  });
});
test('desktop Escape cancels without a history entry and Done never appears', async ({ page }) => {
  const before = await open(page, { mobile: false, card: true }), h = await history(page);
  await edit(page, false); await expect(page.locator(done)).toBeHidden(); await page.locator(editor).fill('Отменяемый заголовок'); await page.keyboard.press('Escape');
  await expect(page.locator(editor)).toBeHidden(); expect(await history(page)).toBe(h);
  const after = await exportedDocument(page); expect(text(after)).toBe(text(before)); expect(after.title).toBe(before.title);
});
