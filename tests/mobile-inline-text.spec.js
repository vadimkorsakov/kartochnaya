const { test, expect, openHome, importPayload, records, openLibraryDocument, exportedDocument, canvasPoint, createDocument } = require('./helpers');
const fixture = require('./fixtures/canvas-graph.json');
const editor = '#inlineText', done = '#mobileConfirm';
const text = doc => doc.elements.find(e => e.id === 'title').text;
const history = page => page.locator('#historyEntries [data-history-index]').count();
async function select(page, id = 'title', mobile = true, mouse = false) {
  if (mobile) {
    await page.locator('[data-mobile=layers]:visible')[mouse ? 'click' : 'tap']();
    await page.locator(`#mobileLayerList [data-layer="${id}"] .layer-name`)[mouse ? 'click' : 'tap']();
    await page.locator('#mobileLayersClose')[mouse ? 'click' : 'tap']();
  } else await page.locator(`#layers [data-layer="${id}"] .layer-name`).click();
}
async function edit(page, mobile = true, mouse = false) {
  if (mobile) await page.locator('#mobileContext [data-mobile=edit]')[mouse ? 'click' : 'tap']();
  else { const p = await canvasPoint(page, 100, 175); await page.mouse.dblclick(p.x, p.y); }
  await expect(page.locator(editor)).toBeFocused();
}
async function open(page, options = {}) {
  if (page.url() === 'about:blank') await openHome(page);
  const payload = structuredClone(fixture); payload.documents = [payload.documents[0]];
  const d = payload.documents[0];
  if (options.large) { d.width = Math.round((page.viewportSize().width - 16) / .29); d.height = 1350; Object.assign(d.elements.find(e => e.id === 'title'), { x: 50, y: 1100, w: 800, h: 100, fontSize: 64 }); }
  if (options.card) { d.type = 'card'; d.hasCustomName = false; }
  if (options.mode) d.elements.find(e => e.id === 'title').textMode = options.mode;
  if (options.mode === 'path') d.elements.find(e => e.id === 'title').textPathPoints = [{ x: 0, y: .7 }, { x: .5, y: .2 }, { x: 1, y: .7 }];
  if (options.tall) { d.height = 2000; d.elements.find(e => e.id === 'title').y = 1700; }
  if (options.rotation) d.elements.find(e => e.id === 'title').rotation = options.rotation;
  if (options.locked) d.elements.find(e => e.id === 'title').locked = true;
  if (options.group) d.elements.find(e => e.id === 'title').groupId = 'inner';
  await importPayload(page, payload);
  await expect(page.locator('#toast')).toContainText('Импортировано проектов');
  const doc = (await records(page, 'docs')).find(d => d.elements.some(e => e.id === 'title' && e.text === 'Graph title'));
  if (options.card) await page.getByRole('button', { name: 'Карточки', exact: true }).click();
  await openLibraryDocument(page, doc.id);
  await select(page, options.id || 'title', options.mobile !== false, options.mouse);
  return exportedDocument(page);
}
async function visibleExit(page) {
  await expect(page.locator(done)).toBeVisible();
  await expect(page.locator('#mobileContext [data-mobile=font]')).toBeVisible();
  await expect(page.locator('#inlineTextDone')).toHaveCount(0);
  try { await expect.poll(() => page.evaluate(() => {
    const r = document.querySelector('#mobileConfirm').getBoundingClientRect(), bar = document.querySelector('#mobileToolbars').getBoundingClientRect();
    const t = document.querySelector('#inlineText').getBoundingClientRect(), c = document.querySelector('#mobileContext').getBoundingClientRect(), v = window.visualViewport;
    return { inside: r.left >= 0 && bar.top >= (v?.offsetTop || 0) && r.right <= innerWidth && bar.bottom <= (v?.offsetTop || 0) + (v?.height || innerHeight) + 1,
      overlap: r.left < t.right && r.right > t.left && r.top < t.bottom && r.bottom > t.top,
      gap: Math.abs((v?.offsetTop||0)+(v?.height||innerHeight)-bar.bottom)<=4, touch: r.width >= 44 && r.height >= 44, compact: bar.height <= 50 && c.right <= r.left,
      hit: !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('#mobileConfirm') };
  })).toEqual({ inside: true, overlap: false, gap: true, touch: true, compact: true, hit: true }); } catch(error) {
    await test.info().attach('failed-viewport-geometry.json',{body:JSON.stringify(await page.evaluate(()=>({height:visualViewport?.height,offsetTop:visualViewport?.offsetTop,pageTop:visualViewport?.pageTop,innerHeight,rects:['app','stageScroller','mobileToolbars'].map(id=>({id,rect:document.getElementById(id).getBoundingClientRect().toJSON()})),variables:getComputedStyle(document.documentElement).getPropertyValue('--v41-editor-height')})),null,2),contentType:'application/json'}); throw error;
  }
}
async function mockViewport(page, viewport) {
  await page.addInitScript(({ width, height }) => {
    const vv = new EventTarget(); Object.assign(vv, { height, width, offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
    window.imeViewport = values => { Object.assign(vv, values); vv.pageTop=vv.offsetTop+scrollY; vv.dispatchEvent(new Event('resize')); vv.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('resize')); };
  }, viewport);
}
async function zoomTo29(page) {
  await page.locator('#zoomLabel').click();
  await expect(page.locator('#zoomLabel')).toHaveText('29%');
}
for (const viewport of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) test.describe(`inline finish ${viewport.width}`, () => {
  test.use({ viewport, hasTouch: true, isMobile: true });
  test('Done commits several inputs once, unchanged and repeated blur do nothing; sessions invalidate redo', async ({ page }) => {
    const before = await open(page); const h = await history(page);
    await expect(page.locator('#inlineTextDone')).toHaveCount(0); await edit(page); await visibleExit(page);
    await page.locator(editor).fill('Первый ввод'); await page.locator(editor).fill('Окончательный\nтекст');
    expect(await history(page)).toBe(h);
    await page.locator(done).tap(); await expect(page.locator(editor)).toBeHidden(); await expect(page.locator('#mobileContext [data-mobile=edit]')).toBeVisible();
    expect(await history(page)).toBe(h + 1);
    await page.locator(editor).dispatchEvent('blur'); expect(await history(page)).toBe(h + 1);
    const after = await exportedDocument(page);
    expect(text(after)).toBe('Окончательный\nтекст');
    expect(after.elements.map(({text, ...e}) => e)).toEqual(before.elements.map(({text, ...e}) => e));
    await page.locator('#undoBtn').tap(); expect(text(await exportedDocument(page))).toBe(text(before));
    await expect(page.locator(editor)).toBeHidden();
    await page.locator('#redoBtn').tap(); expect(text(await exportedDocument(page))).toBe(text(after));
    await edit(page); await page.locator(done).tap(); expect(await history(page)).toBe(h + 1);
    await edit(page); await page.locator(editor).fill('Второй сеанс'); await page.locator(done).tap();
    expect(await history(page)).toBe(h + 2); await page.locator('#undoBtn').tap(); expect(text(await exportedDocument(page))).toBe(text(after));
    await edit(page); await page.locator(editor).fill('Новая ветка истории'); await page.locator(done).tap();
    await expect(page.locator('#redoBtn')).toBeDisabled(); expect(await history(page)).toBe(h + 2);
  });
  test('IME and real window resizes preserve 29%, zoom buttons keep the session and toolbar', async ({ page }, info) => {
    await mockViewport(page, viewport);
    await open(page, { large: true }); await zoomTo29(page); await edit(page);
    await page.locator(editor).fill('Текст при 29%');
    const h = await history(page);
    await page.evaluate(height => imeViewport({ height, offsetTop: 16 }), viewport.height - 260);
    await visibleExit(page); await expect(page.locator('#zoomLabel')).toHaveText('29%');
    await expect.poll(() => page.locator(editor).evaluate(el => {
      const r=el.getBoundingClientRect(),s=document.querySelector('#stageScroller').getBoundingClientRect();return r.top >= s.top && r.bottom <= s.bottom + 1;
    })).toBe(true);
    await page.screenshot({ path: info.outputPath('01-ime-29.png') });
    // Android IME can resize the layout viewport as well as VisualViewport.
    await page.setViewportSize({ width: viewport.width, height: viewport.height - 260 });
    await page.evaluate(() => imeViewport({ height: innerHeight, offsetTop: 0 }));
    await expect(page.locator('#zoomLabel')).toHaveText('29%'); await visibleExit(page);
    await page.locator('#zoomInBtn').tap(); await expect(page.locator('#zoomLabel')).toHaveText('32%');
    await expect(page.locator(editor)).toBeFocused(); await visibleExit(page);
    await page.setViewportSize(viewport); await page.evaluate(height => imeViewport({ height, offsetTop: 16 }), viewport.height - 260); await visibleExit(page);
    await page.screenshot({ path: info.outputPath('02-ime-manual-zoom.png') });
    await page.locator('#zoomOutBtn').tap(); await expect(page.locator('#zoomLabel')).toHaveText('29%');
    await page.locator('#zoomInBtn').tap(); await expect(page.locator('#zoomLabel')).toHaveText('32%');
    expect(await history(page)).toBe(h); await page.locator(editor).press('End'); await page.keyboard.type(' + ввод');
    await page.setViewportSize(viewport); await page.evaluate(() => imeViewport({ width: innerWidth, height: innerHeight, offsetTop: 0 }));
    await expect(page.locator('#zoomLabel')).toHaveText('32%'); await visibleExit(page);
    await page.setViewportSize({ width: viewport.height, height: viewport.width });
    await page.evaluate(() => imeViewport({ width: innerWidth, height: innerHeight }));
    await expect(page.locator(editor)).toBeVisible(); await expect(page.locator('#zoomLabel')).toHaveText('32%');
    await page.setViewportSize(viewport); await page.evaluate(() => imeViewport({ width: innerWidth, height: innerHeight })); await visibleExit(page);
    await page.locator(done).tap(); await expect(page.locator(editor)).toBeHidden();
    await expect(page.locator('#mobileContext [data-mobile=edit]')).toBeVisible();
    await expect(page.locator('#mobileLayerList [data-layer=title]')).toHaveClass(/selected/);
    await page.screenshot({ path: info.outputPath('03-confirmed-selection.png') });
    expect(text(await exportedDocument(page))).toContain('ввод'); expect(await history(page)).toBe(h + 1);
    await page.locator('#undoBtn').tap(); expect(text(await exportedDocument(page))).toBe('Graph title');
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
    await expect(page.locator(editor)).toBeHidden(); await expect(page.locator('#mobileContext [data-mobile=edit]')).toBeVisible();
    expect((await exportedDocument(page)).elements).toEqual(before.elements); expect(await history(page)).toBe(h + 1);
    await page.locator('#undoBtn').tap(); expect(text(await exportedDocument(page))).toBe('Graph title');
  });
  test('font, size, color and format remain usable during input; confirmation retains the open panel and caret', async ({ page }) => {
    await mockViewport(page, { width: 390, height: 844 });
    await open(page); await edit(page); await page.locator(editor).fill('Сохраняемый текст');
    await page.evaluate(() => imeViewport({ height: 500, offsetTop: 10 })); await visibleExit(page);
    const h = await history(page);
    await page.locator(editor).press('Home'); await page.locator(editor).press('ArrowRight');
    const caret = await page.locator(editor).evaluate(el => el.selectionStart);
    await page.locator('#mobileContext [data-mobile=font]').tap();
    await page.locator('[data-mp-font="Georgia"]').tap();
    await expect(page.locator(editor)).toBeVisible(); await expect(page.locator(editor)).toHaveValue('Сохраняемый текст');
    expect(await page.locator(editor).evaluate(el => el.selectionStart)).toBe(caret);
    await page.locator('#mobileContext [data-mobile=size]').tap();
    await page.locator('[data-mp-key=fontSize][type=number]').fill('24'); await page.locator('[data-mp-key=fontSize][type=number]').press('Tab');
    await page.locator('#mobileContext [data-mobile=color]').tap();
    await page.locator('[data-mp-swatch="#ab92fb"]').tap();
    await expect.poll(() => page.locator(editor).evaluate(el => getComputedStyle(el).color)).toBe('rgb(171, 146, 251)');
    await page.locator('#mobileContext [data-mobile=format]').tap();
    await page.locator('[data-mp-format=bold]').tap(); await page.locator('[data-mp-format=center]').tap();
    await expect(page.locator(editor)).toBeVisible(); await expect(page.locator(editor)).toHaveValue('Сохраняемый текст'); expect(await history(page)).toBe(h);
    await page.locator('#mobileContext [data-mobile=edit]').tap();
    await expect(page.locator(editor)).toBeFocused(); expect(await page.locator(editor).evaluate(el => el.selectionStart)).toBe(caret);
    await page.locator('#mobileContext [data-mobile=size]').tap();
    await page.locator('[data-mp-key=fontSize][type=number]').fill('24');
    await page.locator(done).tap(); await expect(page.locator(editor)).toBeHidden();
    await expect(page.locator('[data-mp-key=fontSize][type=number]')).toBeVisible();
    await expect(page.locator('[data-mp-key=fontSize][type=number]')).not.toBeFocused();
    await expect(page.locator('#mobileContext [data-mobile=edit]')).toBeVisible(); expect(await history(page)).toBe(h + 1);
    const e=(await exportedDocument(page)).elements.find(e=>e.id==='title');
    expect(e).toMatchObject({ text: 'Сохраняемый текст', fontFamily: 'Georgia', fontSize: 24, fontWeight: '700', textAlign: 'center', textColor: '#ab92fb' });
    await page.keyboard.press('Escape'); await expect(page.locator('#mobilePropertyUI')).toBeHidden();
    await expect(page.locator('#mobileContext')).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.locator('#mobilePrimary')).toBeVisible();
    await page.locator('#undoBtn').tap(); expect(text(await exportedDocument(page))).toBe('Graph title');
    await page.locator('#redoBtn').tap(); expect((await exportedDocument(page)).elements.find(e=>e.id==='title')).toEqual(e);
  });
  test('mobile Escape saves, another Escape closes properties, then clears text selection', async ({ page }) => {
    await open(page); await edit(page); await page.locator(editor).fill('Back сохраняет');
    await page.locator('#mobileContext [data-mobile=size]').tap(); await page.keyboard.press('Escape');
    await expect(page.locator(editor)).toBeHidden(); await expect(page.locator('#mobilePropertyUI')).toBeHidden();
    expect(text(await exportedDocument(page))).toBe('Back сохраняет');
    await expect(page.locator('#mobilePropertyUI')).toBeHidden(); await expect(page.locator('#mobileContext')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.locator('#mobilePrimary')).toBeVisible();
  });
  test('switching text layers refreshes actions; a later empty canvas tap clears selection', async ({ page }) => {
    await open(page); await edit(page); await page.locator(editor).fill('Первый слой');
    await select(page, 'text-original'); await expect(page.locator(editor)).toBeHidden(); await edit(page); await expect(page.locator(editor)).toHaveValue('Контур');
    await page.locator(editor).fill('Второй слой'); await page.locator(done).tap();
    const p=await canvasPoint(page,245,220); await page.touchscreen.tap(p.x,p.y); await expect(page.locator('#mobilePrimary')).toBeVisible();
    const d=await exportedDocument(page); expect(text(d)).toBe('Первый слой'); expect(d.elements.find(e=>e.id==='text-original').text).toBe('Второй слой');
  });
  test('CDP pinch and one-finger pan keep editing alive without history; no native tap mixed into the gesture sequence', async ({ page }) => {
    await open(page, { mouse: true, large: true, tall: true }); await edit(page, true, true); await page.locator(editor).fill('До pinch');
    const h=await history(page), z=await page.locator('#zoomLabel').textContent(), stage=await page.locator('#stageScroller').boundingBox();
    const client=await page.context().newCDPSession(page), y=stage.y+stage.height*.4;
    const a={x:100,y,id:0},b={x:240,y,id:1};
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a]});
    // A held first finger must not finish text, even after the old router's delay.
    await page.waitForTimeout(120); await expect(page.locator(editor)).toBeVisible();
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a,b]});
    await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...a,x:70,y:y+10},{...b,x:270,y:y+10}]});
    await expect.poll(()=>page.locator('#zoomLabel').textContent()).not.toBe(z);
    const beforePan=await page.locator('#stageScroller').evaluate(el=>el.scrollTop);
    await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...a,x:70,y:y-10},{...b,x:270,y:y-10}]});
    await expect.poll(()=>page.locator('#stageScroller').evaluate(el=>el.scrollTop)).not.toBe(beforePan);
    await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect(page.locator(editor)).toBeVisible(); expect(await history(page)).toBe(h);
    await page.locator(editor).press('End'); await page.keyboard.type(' — после pinch');
    expect(text(await exportedDocument(page))).toBe('До pinch — после pinch');
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a]});
    await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...a,y:y-30}]});
    await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect(page.locator(editor)).toBeVisible(); expect(await history(page)).toBe(h);
    await page.locator(editor).press('ControlOrMeta+Enter'); expect(await history(page)).toBe(h+1);
  });
  test('real browser Back consumes one mobile UI level and never undoes confirmed text', async ({ page }, info) => {
    await mockViewport(page, {width:390,height:844}); await open(page); await edit(page);
    await page.locator(editor).fill('Back не отменяет');
    await page.evaluate(()=>imeViewport({height:500,offsetTop:12})); await visibleExit(page);
    const h=await history(page);
    await page.evaluate(()=>history.back());
    await expect(page.locator(editor)).not.toBeFocused(); await expect(page.locator(editor)).toBeVisible();
    expect(await history(page)).toBe(h);
    await page.evaluate(()=>imeViewport({height:844,offsetTop:0}));
    await page.evaluate(()=>history.back());
    await expect(page.locator('#mobilePrimary')).toBeVisible(); expect(text(await exportedDocument(page))).toBe('Back не отменяет');
    expect(await history(page)).toBe(h+1);
    const count=await page.evaluate(()=>history.length);
    await page.evaluate(()=>dispatchEvent(new PopStateEvent('popstate',{state:null})));
    expect(await history(page)).toBe(h+1); expect(await page.evaluate(()=>history.length)).toBe(count);
    await select(page); await page.locator('#mobileContext [data-mobile=color]').tap();
    await page.locator('[data-mp-action=expand]').tap();
    await page.evaluate(()=>history.back()); await expect(page.locator('#mobilePropertyUI .mp-pill')).toBeVisible();
    await page.evaluate(()=>history.back()); await expect(page.locator('#mobilePropertyUI')).toBeHidden();
    await page.evaluate(()=>history.back()); await expect(page.locator('#mobilePrimary')).toBeVisible();
  });
  test('second confirmation clears context without another history entry; geometry follows actual app origin', async ({page},info)=>{
    await mockViewport(page,{width:390,height:844}); await open(page); await edit(page); await page.locator(editor).fill('Два подтверждения');
    await page.locator('#app').evaluate(el=>el.style.marginTop='25px');
    await page.evaluate(()=>imeViewport({height:500,offsetTop:18})); await visibleExit(page);
    await page.locator('#app').evaluate(el=>el.style.marginTop=''); await page.evaluate(()=>imeViewport({height:500,offsetTop:18})); await visibleExit(page);
    const geometry=await page.evaluate(()=>{const rect=id=>document.querySelector(id).getBoundingClientRect().toJSON();const vv=visualViewport;return {app:rect('#app'),stage:rect('#stageScroller'),toolbar:rect('#mobileToolbars'),height:vv.height,offsetTop:vv.offsetTop,pageTop:vv.pageTop,innerHeight,gap:vv.offsetTop+vv.height-document.querySelector('#mobileToolbars').getBoundingClientRect().bottom}});
    await info.attach('viewport-geometry.json',{body:JSON.stringify(geometry,null,2),contentType:'application/json'});
    const label=await page.addStyleTag({content:`body::after{content:'Application gap: ${geometry.gap.toFixed(1)} CSS px | browser UI not emulated';position:fixed;top:90px;left:4px;background:#111;color:white;font:11px monospace;z-index:10000;padding:3px;pointer-events:none}`});
    await page.screenshot({path:info.outputPath('ime-gap.png')}); await label.evaluate(el=>el.remove());
    await page.locator(done).tap(); const h=await history(page); await expect(page.locator('#mobileContext')).toBeVisible();
    await page.screenshot({path:info.outputPath('first-confirm.png')});
    await page.locator(done).tap(); await expect(page.locator('#mobilePrimary')).toBeVisible();
    expect(await history(page)).toBe(h); expect(text(await exportedDocument(page))).toBe('Два подтверждения');
    await page.screenshot({path:info.outputPath('second-confirm.png')});
  });
  for (const kind of ['rect','image']) test(`confirmation and Back close ${kind} context, not history`,async({page},info)=>{
    await open(page); await page.keyboard.press('Escape');
    if(kind==='image'){
      const input=page.locator('#imageInput');
      await page.locator('[data-mobile=image]:visible').tap();
      await input.setInputFiles({name:'image.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><rect width="50" height="50" fill="red"/></svg>')});
    }else{
      await page.locator('[data-mobile=shapes]:visible').tap();await page.locator('[data-tray-shape=basic0]').tap();
    }
    await expect(page.locator('#mobileContext')).toBeVisible();const h=await history(page),d=await exportedDocument(page);
    await page.screenshot({path:info.outputPath(`${kind}-before-back.png`)});
    await page.evaluate(()=>history.back());await expect(page.locator('#mobilePrimary')).toBeVisible();
    await page.screenshot({path:info.outputPath(`${kind}-after-back.png`)});
    expect(await history(page)).toBe(h);expect((await exportedDocument(page)).elements).toEqual(d.elements);
    const id=d.elements.at(-1).id;await select(page,id);await page.locator(done).tap();await expect(page.locator('#mobilePrimary')).toBeVisible();expect(await history(page)).toBe(h);
  });
  test('Back closes brush, selection, layers and the upper dialog one level at a time',async({page})=>{
    await open(page);await page.keyboard.press('Escape');const h=await history(page);
    await page.keyboard.press('b');await expect(page.locator('#inkPopover')).not.toHaveClass(/hidden/);await page.evaluate(()=>history.back());
    await expect(page.locator('#inkPopover')).toHaveClass(/hidden/);
    await page.locator('[data-mobile=marquee]:visible').tap();await expect(page.locator('#selectionToolbar')).toBeVisible();
    await page.evaluate(()=>history.back());await expect(page.locator('#selectionToolbar')).toBeHidden();
    await page.locator('[data-mobile=layers]:visible').tap();await page.evaluate(()=>history.back());await expect(page.locator('#mobileLayersSheet')).not.toHaveClass(/open/);
    await page.locator('#documentTabsPlus').tap();await expect(page.locator('#tabPickerDialog')).toBeVisible();
    await page.evaluate(()=>history.back());await expect(page.locator('#tabPickerDialog')).toBeHidden();expect(await history(page)).toBe(h);
  });
  test('toolbar Undo finalizes the active session before restoring history', async ({ page }) => {
    await open(page); await edit(page); await page.locator(editor).fill('Первый сеанс'); await page.locator(done).tap();
    await edit(page); await page.locator(editor).fill('Ещё открытый сеанс');
    await page.locator('#undoBtn').tap(); await expect(page.locator(editor)).toBeHidden(); await expect(page.locator('#mobileContext [data-mobile=edit]')).toBeVisible();
    expect(text(await exportedDocument(page))).toBe('Первый сеанс');
    await page.locator('#redoBtn').tap(); expect(text(await exportedDocument(page))).toBe('Ещё открытый сеанс');
  });
  test('fallback without VisualViewport retains accessible Done', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(window, 'visualViewport', { value: undefined }));
    await open(page); await edit(page); await visibleExit(page); await page.locator(done).tap();
    await expect(page.locator('#mobileContext [data-mobile=edit]')).toBeVisible();
  });
  for (const options of [{ mode: 'vertical' }, { mode: 'path' }, { rotation: 30 }, { group: true }, { id: 'text-original' }]) test(`text compatibility ${JSON.stringify(options)}`, async ({ page }) => {
    const before = await open(page, options); const id = options.id || 'title'; await edit(page);
    if (options.id) await expect(page.locator(editor)).toHaveClass(/boundary-inline-editor/);
    await visibleExit(page); await page.locator(editor).fill('Текст\nABC'); await page.locator(done).tap();
    const after = await exportedDocument(page), original = before.elements.find(e => e.id === id), changed = after.elements.find(e => e.id === id);
    expect(changed).toEqual({ ...original, text: 'Текст\nABC' });
    await page.locator('#undoBtn').tap(); expect((await exportedDocument(page)).elements.find(e => e.id === id)).toEqual(original);
  });
  test('locked text refuses inline editing without changing geometry or history', async ({ page }) => {
    const before = await open(page, { locked: true }), h = await history(page);
    const p = await canvasPoint(page, 100, 175);
    await page.touchscreen.tap(p.x, p.y); await page.touchscreen.tap(p.x, p.y);
    await expect(page.locator(editor)).toBeHidden(); await expect(page.locator('#mobileContext [data-mobile=edit]')).toBeVisible();
    expect((await exportedDocument(page)).elements).toEqual(before.elements); expect(await history(page)).toBe(h);
  });
  test('automatic card title follows text through Undo and Redo', async ({ page }) => {
    const before = await open(page, { card: true }); await edit(page); await page.locator(editor).fill('Новый заголовок'); await page.locator(done).tap();
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
    await expect(page.locator(editor)).toBeHidden(); await expect(page.locator('#mobilePrimary')).toBeVisible(); expect(await history(page)).toBe(1);
    await page.locator('#documentTabsMenuToggle').tap(); await page.locator(`[data-mobile-tab-id="${first.id}"] [data-mobile-tab-activate]`).tap();
    expect(text(await exportedDocument(page))).toBe('Черновик для переключения'); expect(await history(page)).toBe(h + 1);
    await edit(page); await page.locator(editor).fill('Сбой сохранения'); await page.evaluate(() => { failInlineSave = true; });
    await page.locator('#documentTabsMenuToggle').tap(); await page.locator(`[data-mobile-tab-id="${first.id}"] [data-mobile-tab-close]`).tap();
    await expect(page.locator(`[data-mobile-tab-id="${first.id}"]`)).toBeVisible(); await expect(page.locator('#toast')).toContainText('Сохранение не подтверждено');
    await page.locator('#documentTabsMenuClose').tap(); expect(text(await exportedDocument(page))).toBe('Сбой сохранения');
    await edit(page); await expect(page.locator(editor)).toHaveValue('Сбой сохранения'); await page.locator(done).tap();
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
