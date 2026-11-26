const {readFile} = require('node:fs/promises');
const {PNG} = require('pngjs');
const {test, expect, openHome, importPayload, records, openLibraryDocument, exportedDocument, exportPNG} = require('./helpers');
const fixture = require('./fixtures/visual-text.json');

const text = 'Первый пункт\nОбычный текст\nЕщё один пункт\nПервая строка\nВторая строка\nПоследний пункт\n';
const second = text.indexOf('Ещё');
const ordered = text.indexOf('Первая');
const continuation = text.indexOf('Вторая');
const last = text.indexOf('Последний');
const runs = [
  {start:0, style:{listKind:'bullet', listMarker:'◆'}},
  {start:second, style:{listKind:'bullet', listMarker:'○', listGap:15}},
  {start:ordered, style:{listKind:'ordered'}},
  {start:continuation, style:{listKind:'ordered'}},
  {start:last, style:{listKind:'bullet', listMarker:'✓'}},
];
const rich = [{start:0,end:6,style:{fontWeight:'700',baselineShift:'super'}},
  {start:second,end:second+3,style:{textColor:'#345678'}}];
const flag = '🇳🇱', joiner = '👩‍💻';
const editor = page => page.locator('#inlineText');
const sheet = page => page.locator('#mobilePropertyUI .mp-sheet');
const tool = (page, name) => page.locator(`#mobileContext [data-mobile=${name}]`).tap();
const settings = page => sheet(page).locator('[data-mp-format=listSettings]');
const mode = (page, kind) => sheet(page).locator(`[data-mp-list-mode=${kind}]`);
const choice = (page, key, value) => sheet(page).locator(`[data-mp-list-key="${key}"][data-mp-list-value="${value}"]`);
const note = (page, key) => sheet(page).locator(`[data-mp-list-state="${key}"]`);
const field = (page, key, type = 'number') => sheet(page).locator(`input[type=${type}][data-mp-list-field="${key}"]`);
const tab = (page, name) => sheet(page).getByRole('tab',{name,exact:true});
const opener = (page, name) => sheet(page).locator(`[data-mp-list-open=${name}]`);
const back = page => sheet(page).getByRole('button',{name:'Назад',exact:true}).tap();
const undo = page => page.locator('#undoBtn').tap();
const redo = page => page.locator('#redoBtn').tap();
const element = async page => (await exportedDocument(page)).elements[0];
const caret = page => editor(page).evaluate(el => [el.selectionStart, el.selectionEnd, el.selectionDirection]);
const nextPaint = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const expectPaused = async page => {
  await expect(editor(page)).not.toBeFocused();
  await expect(editor(page)).toHaveJSProperty('readOnly', true);
  await expect(editor(page)).toHaveAttribute('inputmode', 'none');
};

async function selectLayer(page, name = 'M1.4'){
  await page.locator('[data-mobile=layers]:visible').tap();
  await page.locator('#mobileLayerList').getByText(name, {exact:true}).tap();
  await page.locator('#mobileLayersClose').tap();
}
async function seed(page, patch = {}, {series = false} = {}){
  await page.addInitScript(() => {
    window.m14TextareaFocus = 0;
    window.m14Glyphs = [];
    document.addEventListener('focusin', ev => { if(ev.target.id === 'inlineText') window.m14TextareaFocus++; });
    const {fillText, clearRect} = CanvasRenderingContext2D.prototype;
    CanvasRenderingContext2D.prototype.clearRect = function(...args) {
      if(this.canvas.id === 'canvas') window.m14Glyphs = [];
      return clearRect.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.fillText = function(value, ...args) {
      if(this.canvas.id === 'canvas') window.m14Glyphs.push(value);
      return fillText.call(this, value, ...args);
    };
  });
  await openHome(page);
  const payload = structuredClone(fixture);
  const sample = payload.document.elements[0];
  Object.assign(sample, {id:'m14', name:'M1.4', text, x:16, y:16, w:288, h:192, fontFamily:'Arial',
    fontSize:22, lineHeight:1.1, textAlign:'left', textColor:'#234567', fill:'#234567', fillType:'solid',
    fillOpacity:70, autoFontSize:true, paragraphRuns:runs, textRuns:rich, typography:{enabled:true}, ...patch});
  if(series){
    const {width,height,background,elements} = payload.document;
    Object.assign(payload.document,{type:'card',activeSlideIndex:0,hasCustomName:true,slides:[
      {id:'first',width,height,background,elements:[...elements,{...sample,id:'neighbor',name:'Соседний слой',y:210,h:26}]},
      {id:'second',width,height,background,elements:[{...sample,id:'other',name:'Другой холст'}]},
    ]});
  }
  await importPayload(page, payload);
  await expect.poll(async () => (await records(page, 'docs')).some(d => d.elements.some(e => e.name === 'M1.4'))).toBe(true);
  const doc = (await records(page, 'docs')).find(d => d.elements.some(e => e.name === 'M1.4'));
  await openLibraryDocument(page, doc.id);
  await selectLayer(page);
  return doc.id;
}
async function showSettings(page){
  await tool(page, 'format');
  await settings(page).tap();
  await expect(sheet(page)).toHaveAccessibleName('Настройки списка');
}
async function selectOffsets(page, start, end = start){
  await tool(page, 'edit');
  await expect(editor(page)).toBeFocused();
  await editor(page).evaluate((el,[a,b]) => {
    el.setSelectionRange(a,b,'backward');
    el.dispatchEvent(new Event('select', {bubbles:true}));
  }, [start,end]);
}
async function setField(page, key, value, type){
  const input = field(page,key,type);
  await input.tap();
  await input.fill(value);
  await input.press('Enter');
  await expect(input).not.toBeFocused();
}
async function scrollState(page){
  return sheet(page).locator('.mp-body').evaluate(el => ({
    top:el.scrollTop, tab:el.querySelector('[data-mp-list-view=settings] [aria-selected=true]').id,
  }));
}
async function capture(page, info, name, viewport){
  await nextPaint(page);
  const geometry = await sheet(page).evaluate(el => {
    const rect = el.getBoundingClientRect(), body = el.querySelector('.mp-body'), clip = body.getBoundingClientRect();
    const stage = document.querySelector('#stageScroller').getBoundingClientRect();
    const bounds = node => {
      const {left,right,top,bottom,width,height} = node.getBoundingClientRect();
      return {left,right,top,bottom,width,height};
    };
    return {height:rect.height, top:rect.top, width:body.clientWidth, scrollWidth:body.scrollWidth,
      bodyHeight:body.clientHeight, scrollHeight:body.scrollHeight, documentWidth:document.documentElement.scrollWidth,
      stage:{width:stage.width,height:stage.height,uncovered:Math.min(stage.bottom,rect.top)-stage.top},
      properties:[...body.querySelectorAll('[data-mp-list-property]')].filter(node=>node.checkVisibility())
        .map(node=>{
          const r = bounds(node);
          return {key:node.dataset.mpListProperty,height:r.height,visible:r.top>=clip.top&&r.bottom<=clip.bottom};
        }),
      targets:[...el.querySelectorAll('button,input')].filter(node=>node.checkVisibility())
        .map(node=>({name:node.getAttribute('aria-label')||node.textContent.trim()||node.id,
          type:node.type, markerTile:!!node.closest('.mp-list-tiles:not(.mp-list-counters)'), ...bounds(node)}))};
  });
  expect(geometry.top).toBeGreaterThan(viewport.height*.4);
  expect(geometry.scrollWidth).toBe(geometry.width);
  expect(geometry.documentWidth).toBe(viewport.width);
  if(name.endsWith('format')) {
    expect(geometry.targets.every(({width,height}) => width >= 44 && height >= 44)).toBe(true);
    expect(geometry.height).toBe(293);
    expect(geometry.scrollHeight).toBe(geometry.bodyHeight);
  } else {
    expect(geometry.height).toBeLessThanOrEqual(Math.min(.49*viewport.height,440)+.5);
    expect(geometry.stage.uncovered).toBeGreaterThan(100);
    for(const [index, a] of geometry.targets.entries()){
      expect(a.width, a.name).toBeGreaterThanOrEqual(a.markerTile ? 42 : 44);
      expect(a.height, a.name).toBeGreaterThanOrEqual(a.markerTile ? 40 : 30);
      if(a.type==='number') expect(a.width).toBeLessThanOrEqual(60);
      if(a.type==='range') expect(a.height).toBeGreaterThanOrEqual(40);
      for(const b of geometry.targets.slice(index+1)){
        expect(Math.min(a.right,b.right)>Math.max(a.left,b.left)&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)).toBe(false);
      }
    }
  }
  const path = info.outputPath(`${name}-${viewport.width}.png`);
  await page.screenshot({path});
  await info.attach(name, {path, contentType:'image/png'});
  await info.attach(name+' measurements', {body:JSON.stringify(geometry), contentType:'application/json'});
  return geometry;
}
async function pngWhileFormatting(page){
  const download = page.waitForEvent('download');
  await page.locator('#exportBtn').evaluate(button=>button.click());
  return PNG.sync.read(await readFile(await (await download).path())).data;
}
async function startDrag(page, slider){
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();
  const client = await page.context().newCDPSession(page);
  const point = fraction => ({x:box.x+box.width*fraction,y:box.y+box.height/2});
  const send = (type, fraction) => client.send('Input.dispatchTouchEvent',{type,touchPoints:fraction === undefined ? [] : [point(fraction)]});
  await send('touchStart',.25);
  await send('touchMove',.6);
  await send('touchMove',.8);
  return {end:()=>send('touchEnd'),cancel:()=>send('touchCancel')};
}

for(const viewport of [{width:360,height:640},{width:390,height:844}]) test.describe(`M1.4 ${viewport.width}`,()=>{
  test.use({viewport,hasTouch:true,isMobile:true});

  test('compact inspector geometry and child navigation preserve selection, values and history', async({page},info)=>{
    test.setTimeout(50000);
    await seed(page);
    const initial = await element(page);
    const expectAllRows = async(name,keys)=>{
      const geometry = await capture(page,info,name,viewport);
      expect(geometry.scrollHeight).toBe(geometry.bodyHeight);
      expect(geometry.properties.map(({key,visible})=>[key,visible])).toEqual(keys.map(key=>[key,true]));
    };
    const appearance = ['style','listMarkerScale','listMarkerColor','listMarkerOpacity'];
    await tool(page,'format');
    await capture(page,info,'compact-format',viewport);
    await settings(page).tap();
    await expectAllRows('appearance-bullet',appearance);
    await mode(page,'ordered').tap();
    await expectAllRows('appearance-ordered',[...appearance,'listStart']);
    await tab(page,'Интервалы').tap();
    await expectAllRows('spacing',['listIndent','listGap','listItemSpacing']);
    await tab(page,'Интервалы').press('Home');
    await expect(tab(page,'Оформление')).toHaveAttribute('aria-selected','true');
    expect(await element(page)).toEqual(initial);

    await selectOffsets(page,2,last);
    const given = await caret(page);
    const focus = await page.evaluate(()=>m14TextareaFocus);
    await showSettings(page);
    const scope = await sheet(page).locator('[data-mp-list-target]').textContent();
    await field(page,'listMarkerScale').fill('145');
    await opener(page,'gallery').tap();
    await expect(sheet(page)).toHaveAccessibleName('Маркеры');
    await tab(page,'Мои маркеры').tap();
    const custom = sheet(page).locator('[data-mp-list-custom]');
    await custom.fill(flag);
    await back(page);
    await expect(tab(page,'Оформление')).toHaveAttribute('aria-selected','true');
    await expect(sheet(page).locator('[data-mp-list-target]')).toHaveText(scope);
    await expect(field(page,'listMarkerScale')).toHaveValue('100');
    await expect(choice(page,'listMarkerScale','auto')).toHaveAttribute('aria-pressed','false');
    await opener(page,'gallery').tap();
    await expect(tab(page,'Мои маркеры')).toHaveAttribute('aria-selected','true');
    await expect(custom).toHaveValue(flag);
    await tab(page,'Стандартные').tap();
    await expect(choice(page,'listMarker','•')).toBeInViewport({ratio:1});
    await expect(choice(page,'listMarker','✅')).toBeInViewport({ratio:1});
    await page.goBack();
    await expect(sheet(page)).toHaveAccessibleName('Настройки списка');
    await expect(opener(page,'gallery')).toBeFocused();

    await opener(page,'color').tap();
    await expect(sheet(page)).toHaveAccessibleName('Цвет маркера');
    await capture(page,info,'color-editor',viewport);
    const hex = field(page,'listMarkerColor','text');
    await hex.focus();
    // Exercise the existing IME Back branch with a controlled viewport signal.
    await page.evaluate(()=>{
      const vv = window.visualViewport;
      Object.defineProperty(vv,'height',{configurable:true,value:innerHeight-240});
      vv.dispatchEvent(new Event('resize'));
    });
    await page.goBack();
    await expect(sheet(page)).toHaveAccessibleName('Цвет маркера');
    await expect(hex).not.toBeFocused();
    await page.evaluate(()=>{
      delete window.visualViewport.height;
      window.visualViewport.dispatchEvent(new Event('resize'));
    });
    await page.goBack();
    await expect(sheet(page)).toHaveAccessibleName('Настройки списка');
    await expect(opener(page,'color')).toBeFocused();
    expect(await caret(page)).toEqual(given);
    expect(await element(page)).toEqual(initial);

    await opener(page,'color').tap();
    const plane = sheet(page).locator('[data-mp-list-plane]');
    const rect = await plane.boundingBox();
    const client = await page.context().newCDPSession(page);
    const send = (type,x,y)=>client.send('Input.dispatchTouchEvent',{
      type,touchPoints:x==null?[]:[{x:rect.x+rect.width*x,y:rect.y+rect.height*y}],
    });
    await send('touchStart',.6,.3);
    await send('touchMove',.8,.2);
    expect(await element(page)).toEqual(initial);
    await send('touchCancel');
    await expect(hex).toHaveValue('');
    // Chromium 154 can infer a fling from raw CDP move/end events and consume
    // the next tap to stop it. Generate the completed touch drag without a fling.
    // Read the preview on the plane before the sheet handles pointerup.
    await plane.evaluate(node=>{
      const isTouch = event => event.isTrusted&&event.pointerType==='touch';
      node.addEventListener('pointermove',event=>{
        if(isTouch(event)) node.dataset.testMoved = 'true';
      },{once:true});
      node.addEventListener('pointerup',event=>{
        if(isTouch(event)){
          node.dataset.testPreview = node.closest('.mp-list-settings').querySelector('#mp-list-hex').value;
        }
      },{once:true});
    });
    await client.send('Input.synthesizeScrollGesture',{
      x:rect.x+rect.width*.6,y:rect.y+rect.height*.3,
      xDistance:rect.width*.2,yDistance:-rect.height*.1,
      gestureSourceType:'touch',preventFling:true,
    });
    await client.detach();
    await expect(plane).toHaveAttribute('data-test-moved','true');
    const preview = await plane.getAttribute('data-test-preview');
    expect(preview).toMatch(/^#[0-9a-f]{6}$/);
    const confirmed = await element(page);
    expect(confirmed.paragraphRuns[0].style.listMarkerColor).toBe(preview);
    await undo(page);
    await expect(page.locator('#undoBtn')).toBeDisabled();
    expect(await element(page)).toEqual(initial);
    await redo(page);
    expect(await element(page)).toEqual(confirmed);
    await nextPaint(page);
    await back(page);
    await expect(sheet(page)).toHaveAccessibleName('Настройки списка');
    await expect(opener(page,'color')).toBeVisible();
    await expect(opener(page,'color')).toBeFocused();
    await expect(opener(page,'color').locator('[data-mp-list-color-sample]')).toHaveCSS('background-color',
      'rgb('+preview.slice(1).match(/../g).map(part=>parseInt(part,16)).join(', ')+')');
    expect(await caret(page)).toEqual(given);
    await nextPaint(page);
    await back(page);
    await expect(sheet(page)).toHaveAccessibleName('Формат');
    await nextPaint(page);
    // Separately verify two actual touch Back actions with each intermediate
    // view visible and its changed sheet geometry settled before the next tap.
    await settings(page).tap();
    await expect(sheet(page)).toHaveAccessibleName('Настройки списка');
    await opener(page,'gallery').tap();
    await expect(sheet(page)).toHaveAccessibleName('Маркеры');
    await nextPaint(page);
    await back(page);
    await expect(sheet(page)).toHaveAccessibleName('Настройки списка');
    await expect(opener(page,'gallery')).toBeVisible();
    await expect(opener(page,'gallery')).toBeFocused();
    await nextPaint(page);
    await back(page);
    await expect(sheet(page)).toHaveAccessibleName('Формат');
    expect(await caret(page)).toEqual(given);
    expect(await element(page)).toEqual(confirmed);
    await settings(page).tap();
    await opener(page,'gallery').tap();
    await expect(sheet(page)).toHaveAccessibleName('Маркеры');
    await sheet(page).getByRole('button',{name:'Готово'}).tap();
    await expect(sheet(page)).toHaveCount(0);
    await expectPaused(page);
    expect(await page.evaluate(()=>m14TextareaFocus)).toBe(focus);
  });

  test('touch caret, exclusive backward range, Mixed, presets, sizes, numbering, focus and reload', async({page},info)=>{
    test.setTimeout(65000);
    const id = await seed(page);
    const initial = await element(page);
    await tool(page,'edit');
    await expect(editor(page)).toBeFocused();
    await nextPaint(page);
    const box = await editor(page).boundingBox();
    const lineHeight = await editor(page).evaluate(el=>parseFloat(getComputedStyle(el).lineHeight)*el.getBoundingClientRect().width/el.offsetWidth);
    await page.touchscreen.tap(box.x+18,box.y+lineHeight/2);
    const firstCaret = await caret(page);
    expect(firstCaret[0]).toBeLessThan(second);
    expect(firstCaret[0]).toBe(firstCaret[1]);
    await tool(page,'format');
    await capture(page,info,'format',viewport);
    await settings(page).tap();
    await expectPaused(page);
    await expect(mode(page,'ordered')).toBeHidden();
    await expect(sheet(page).locator('[data-mp-list-single-kind]')).toHaveText('Маркированный');
    await expect(sheet(page).locator('[data-mp-list-target]')).toContainText('Первый пункт');
    await opener(page,'gallery').tap();
    await choice(page,'listMarker','•').tap();
    const first = await element(page);
    expect(first.paragraphRuns).toEqual([{start:0,style:{listKind:'bullet',listMarkerScale:'auto'}},...runs.slice(1)]);
    await undo(page);
    expect(await element(page)).toEqual(initial);

    await selectOffsets(page,2,last);
    const given = await caret(page), focus = await page.evaluate(()=>m14TextareaFocus);
    await showSettings(page);
    await expect(sheet(page).locator('[data-mp-list-target]')).toContainText('Разные · Абзацы');
    await expect(sheet(page).locator('[data-mp-list-style]')).toHaveText('Разные');
    await opener(page,'gallery').tap();
    await expect(choice(page,'listMarker','●')).toHaveAttribute('aria-pressed','mixed');
    await expect(sheet(page).locator('[data-mp-list-key=listMarker]')).toHaveCount(33);
    await capture(page,info,'lists',viewport);
    expect(await element(page)).toEqual(initial);
    await choice(page,'listMarker','●').tap();
    const dotted = await element(page);
    expect(dotted.paragraphRuns.slice(0,2)).toEqual([
      {start:0,style:{listKind:'bullet',listMarker:'●',listMarkerScale:'auto'}},
      {start:second,style:{listKind:'bullet',listMarker:'●',listGap:15,listMarkerScale:'auto'}},
    ]);
    expect(dotted.paragraphRuns.slice(2)).toEqual(runs.slice(2));
    expect(dotted.text).toBe(text);
    expect(dotted.textRuns).toEqual(initial.textRuns);
    expect(dotted.typography).toEqual(initial.typography);
    await choice(page,'listMarker','●').tap();
    await undo(page);
    expect(await element(page)).toEqual(initial);
    await redo(page);
    expect(await element(page)).toEqual(dotted);
    await back(page);
    await expect(note(page,'listMarkerScale')).toHaveText('Авто · 72%');
    await setField(page,'listMarkerScale','135');
    expect((await element(page)).paragraphRuns[0].style.listMarkerScale).toBe(135);
    await choice(page,'listMarkerScale','auto').tap();
    await expect(note(page,'listMarkerScale')).toHaveText('Авто · 72%');
    await expect(note(page,'listMarkerColor')).toHaveText('Как у текста');
    await opener(page,'color').tap();
    await setField(page,'listMarkerColor','#a13fc2','text');
    await back(page);
    await setField(page,'listMarkerOpacity','38');
    const colored = await element(page);
    expect(colored.fontSize).toBe(dotted.fontSize);
    expect(colored.paragraphRuns[0].style).toMatchObject({listMarkerColor:'#a13fc2',listMarkerOpacity:38});
    await choice(page,'listMarkerColor','inherit').tap();
    expect((await element(page)).paragraphRuns[0].style).not.toHaveProperty('listMarkerColor');
    expect((await element(page)).paragraphRuns[0].style.listMarkerOpacity).toBe(38);
    await choice(page,'listMarkerOpacity','inherit').tap();
    await expect(note(page,'listMarkerOpacity')).toHaveText('Как у текста');
    await opener(page,'gallery').tap();
    await choice(page,'listMarker','🔶').tap();
    await back(page);
    await expect(opener(page,'color')).toBeDisabled();
    await expect(field(page,'listMarkerColor','text')).toBeDisabled();
    await expect(field(page,'listMarkerOpacity')).toBeEnabled();
    const bullets = await element(page);

    await mode(page,'ordered').tap();
    expect(await element(page)).toEqual(bullets);
    await expect(sheet(page).locator('[data-mp-list-key=listCounterStyle]')).toHaveCount(7);
    await expect(note(page,'listStart')).toHaveText('Авто');
    await opener(page,'gallery').tap();
    await capture(page,info,'numbering',viewport);
    await choice(page,'listCounterStyle','roman-lower-dot').tap();
    await back(page);
    await setField(page,'listStart','18');
    const numbered = await element(page);
    expect(numbered.paragraphRuns.slice(2,4)).toEqual([
      {start:ordered,style:{listKind:'ordered',listCounterStyle:'roman-lower-dot',listStart:18,listMarkerScale:'auto'}},
      {start:continuation,style:{listKind:'ordered',listCounterStyle:'roman-lower-dot',listMarkerScale:'auto'}},
    ]);
    await choice(page,'listStart','auto').tap();
    expect((await element(page)).paragraphRuns[2].style).not.toHaveProperty('listStart');
    await undo(page); expect(await element(page)).toEqual(numbered);
    await expect(mode(page,'ordered')).toHaveAttribute('aria-pressed','true');
    expect(await caret(page)).toEqual(given);
    await expectPaused(page);
    await page.goBack();
    await expect(sheet(page)).toHaveAccessibleName('Формат');
    await settings(page).tap();
    await sheet(page).getByRole('button',{name:'Готово'}).tap();
    await expect(sheet(page)).toHaveCount(0);
    await expectPaused(page);
    expect(await page.evaluate(()=>m14TextareaFocus)).toBe(focus);
    await page.locator('#mobileConfirm').tap();
    await expect(editor(page)).toBeHidden();
    await nextPaint(page);
    expect(await page.evaluate(()=>m14Glyphs)).toEqual(expect.arrayContaining(['🔶','xviii.','xix.','✓']));
    const png = (await exportPNG(page)).image.data;
    await expect.poll(async()=> (await records(page,'docs')).find(doc=>doc.id===id)?.elements[0]).toEqual(numbered);
    await page.reload();
    await openLibraryDocument(page,id);
    expect(await element(page)).toEqual(numbered);
    expect((await exportPNG(page)).image.data.equals(png)).toBe(true);
    const document = await exportedDocument(page);
    await importPayload(page,{format:'kartochnaya-v1',document},'m14-roundtrip.json');
    await expect.poll(async()=> (await element(page)).paragraphRuns).toEqual(numbered.paragraphRuns);
  });

  test('touch slider draft, cancellation, persistence during drag and one Undo per gesture', async({page})=>{
    test.setTimeout(50000);
    const id = await seed(page);
    const initial = await element(page);
    await showSettings(page);
    await expect(sheet(page).locator('[data-mp-list-target]')).toHaveText('Разные · Весь слой');
    await tab(page,'Интервалы').tap();
    await expect(note(page,'listGap')).toHaveText('Разные');
    await setField(page,'listIndent','24.5');
    const committed = await element(page);
    expect(committed.paragraphRuns.filter(r=>r.style.listKind==='bullet').every(r=>r.style.listIndent===24.5)).toBe(true);
    await expect.poll(async()=> (await records(page,'docs')).find(doc=>doc.id===id)?.elements[0]).toEqual(committed);
    const beforePNG = await pngWhileFormatting(page);

    const slider = field(page,'listGap','range');
    let drag = await startDrag(page,slider);
    await expect(field(page,'listGap')).not.toHaveValue('');
    expect(await element(page)).toEqual(committed);
    // Trigger the normal save handler without a second pointer or a blur.
    await page.evaluate(()=>window.dispatchEvent(new Event('beforeunload')));
    expect((await records(page,'docs')).find(doc=>doc.id===id).elements[0]).toEqual(committed);
    expect((await pngWhileFormatting(page)).equals(beforePNG)).toBe(true);
    await drag.cancel();
    expect(await element(page)).toEqual(committed);
    await expect(note(page,'listGap')).toHaveText('Разные');

    drag = await startDrag(page,slider);
    const gap = Number(await slider.inputValue());
    expect(gap).toBeGreaterThan(15);
    await drag.end();
    const applied = await element(page);
    expect(applied.paragraphRuns.filter(r=>r.style.listKind==='bullet').map(r=>r.style.listGap)).toEqual([gap,gap,gap]);
    expect(applied.paragraphRuns.filter(r=>r.style.listKind==='ordered')).toEqual(runs.slice(2,4));
    const scroll = await scrollState(page);
    await undo(page); expect(await element(page)).toEqual(committed);
    expect(await scrollState(page)).toEqual(scroll);
    await redo(page); expect(await element(page)).toEqual(applied);
    await setField(page,'listItemSpacing','1000');
    expect((await element(page)).paragraphRuns[0].style.listItemSpacing).toBe(1000);
    await setField(page,'listItemSpacing','1001');
    expect((await element(page)).paragraphRuns[0].style.listItemSpacing).toBe(1000);
    await undo(page); expect(await element(page)).toEqual(applied);
    await undo(page); expect(await element(page)).toEqual(committed);
    await undo(page); expect(await element(page)).toEqual(initial);
  });

  test('gallery, confirmed Unicode, async rollback, unsaved markers and shared ZIP', async({page,browser},info)=>{
    test.setTimeout(65000);
    await page.addInitScript(() => {
      window.m14Fault = {abortNext:true};
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(record,...args){
        const request = put.call(this,record,...args);
        if(record?.key === 'list-markers-v1' && m14Fault.abortNext){
          m14Fault.abortNext = false;
          request.addEventListener('success',()=>this.transaction.abort());
        }
        return request;
      };
    });
    const id = await seed(page,{fillType:'gradient'});
    const initial = await element(page);
    await selectOffsets(page,0);
    await showSettings(page);
    const input = sheet(page).locator('[data-mp-list-custom]');
    const add = sheet(page).getByRole('button',{name:'Добавить',exact:true});
    const apply = sheet(page).getByRole('button',{name:'Применить',exact:true});
    const status = sheet(page).locator('[data-mp-list-library-note]');
    const preview = sheet(page).locator('[data-mp-list-custom-preview]');
    const gallery = sheet(page).locator('[data-mp-list-gallery]');
    const saved = glyph => gallery.getByRole('button',{name:'Применить маркер '+glyph,exact:true});
    const library = async()=> (await records(page,'settings')).find(row=>row.key==='list-markers-v1');
    await expect(opener(page,'color')).toBeDisabled();
    await expect(field(page,'listMarkerColor','text')).toBeDisabled();
    await expect(field(page,'listMarkerOpacity')).toBeDisabled();
    await opener(page,'gallery').tap();
    await tab(page,'Мои маркеры').tap();
    for(const invalid of ['ab',' ','x'.repeat(33)]){
      await input.fill(invalid);
      await expect(input).toHaveAttribute('aria-invalid','true');
      await expect(apply).toBeDisabled();
    }
    await input.dispatchEvent('compositionstart');
    await input.fill(joiner);
    await expect(preview).toBeEmpty();
    await expect(add).toBeDisabled();
    await tab(page,'Стандартные').tap();
    await tab(page,'Мои маркеры').tap();
    await expect(preview).toBeEmpty();
    await expect(add).toBeDisabled();
    await input.dispatchEvent('compositionend');
    await expect(preview).toHaveText(joiner);
    await input.press('Enter');
    await expect(input).not.toBeFocused();
    await expectPaused(page);
    await add.tap();
    await expect(status).toHaveText('Изменение галереи не сохранено.');
    expect(await library()).toBeUndefined();
    expect(await element(page)).toEqual(initial);
    await add.tap();
    await expect(saved(joiner)).toBeVisible();
    await expect(add).toBeDisabled();
    await expect(sheet(page).locator('[data-mp-list-input-note]')).toHaveText('Этот маркер уже есть в галерее.');
    expect(await element(page)).toEqual(initial);
    await input.fill(flag);
    await apply.tap();
    expect((await element(page)).paragraphRuns[0].style.listMarker).toBe(flag);
    expect((await library()).markers).toEqual([joiner]);
    await add.tap();
    await expect(saved(flag)).toBeVisible();
    await gallery.getByRole('button',{name:'Удалить маркер '+flag,exact:true}).tap();
    await expect(saved(flag)).toHaveCount(0);
    expect((await element(page)).paragraphRuns[0].style.listMarker).toBe(flag);
    await input.fill('<');
    await add.tap();
    await expect(saved('<')).toHaveText('<');
    await saved(joiner).tap();
    await input.fill(flag);
    await gallery.scrollIntoViewIfNeeded();
    await capture(page,info,'gallery',viewport);
    await expectPaused(page);
    await sheet(page).getByRole('button',{name:'Готово'}).tap();
    await page.locator('#mobileConfirm').tap();
    const decorated = await element(page);
    expect(decorated.paragraphRuns[0].style.listMarker).toBe(joiner);
    await expect.poll(async()=> (await records(page,'docs')).find(d=>d.id===id)?.elements[0]).toEqual(decorated);

    // Reopen the same persisted workspace with a fine pointer. A wide viewport
    // alone still has a coarse pointer in the mobile Playwright context.
    const state = await page.context().storageState({indexedDB:true});
    const desktop = await browser.newContext({viewport:{width:1280,height:900},isMobile:false,hasTouch:false,
      baseURL:page.url(),storageState:state});
    try {
      const desktopPage = await desktop.newPage();
      await openHome(desktopPage);
      expect(await desktopPage.evaluate(()=>matchMedia('(pointer:fine)').matches)).toBe(true);
      await openLibraryDocument(desktopPage,id);
      await desktopPage.locator('#layers .layer-name').filter({hasText:'M1.4'}).click();
      await desktopPage.locator('[data-list-settings]').click();
      await expect(desktopPage.locator('#listStylePanel [data-list-library] [data-list-marker]')).toHaveText([joiner,'<']);
      await desktopPage.locator('#listStylePanel [data-list-close]').click();
      await desktopPage.locator('#documentTabsHome').click();
      await desktopPage.locator('[data-home-nav=data]').click();
      await desktopPage.locator('#zipStorage').click();
      await expect(desktopPage.locator('#zipConfirm')).toBeEnabled();
      const download = desktopPage.waitForEvent('download');
      await desktopPage.locator('#zipConfirm').click();
      const {readBackup} = await import('../src/backup/archive.mjs');
      const backup = await readBackup(await readFile(await (await download).path()));
      expect(backup.data.settings.find(row=>row.key==='list-markers-v1').markers).toEqual([joiner,'<']);
      expect(backup.data.docs.find(d=>d.id===id).elements[0]).toEqual(decorated);
    } finally {
      await desktop.close();
    }
  });
});

test.describe('M1.4 stale targets on Android-sized Chromium',()=>{
  test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});

  test('lock, composition, slide and document changes invalidate pending controls and gallery responses',async({page})=>{
    test.setTimeout(65000);
    await page.addInitScript(()=>{
      window.m14Completion = null;
      window.m14HoldGallery = false;
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function(stores,mode,...args){
        const tx = transaction.call(this,stores,mode,...args);
        if(window.m14HoldGallery && mode==='readwrite' && Array.isArray(stores) && stores.join()==='settings'){
          window.m14HoldGallery = false;
          let complete;
          Object.defineProperty(tx,'oncomplete',{
            configurable:true,get:()=>complete,set:handler=>{complete=handler;},
          });
          tx.addEventListener('complete',ev=>{window.m14Completion=()=>complete.call(tx,ev);});
        }
        return tx;
      };
    });
    const id = await seed(page,{}, {series:true});
    const initial = await exportedDocument(page);
    await selectOffsets(page, 'Первый пункт\n'.length+2);
    await tool(page,'format');
    await expect(settings(page)).toBeDisabled();
    expect((await element(page)).paragraphRuns).toEqual(runs);
    await selectOffsets(page,1);
    await showSettings(page);
    await tab(page,'Интервалы').tap();
    const gap = field(page,'listGap');
    await gap.fill('40');
    await editor(page).dispatchEvent('compositionstart');
    await expect(gap).toBeDisabled();
    await editor(page).dispatchEvent('compositionend');
    await expect(gap).toBeEnabled();
    await gap.dispatchEvent('change');
    expect((await element(page)).paragraphRuns).toEqual(runs);

    await gap.fill('40');
    const lock = page.locator('#mobileLayerList [data-layer]').filter({hasText:'M1.4'}).locator('[data-layeract=lock]');
    await lock.evaluate(el=>el.click());
    await expect(gap).toBeDisabled();
    await gap.dispatchEvent('change');
    const locked = await element(page);
    expect(locked.locked).toBe(true);
    expect(locked.paragraphRuns).toEqual(runs);
    await lock.evaluate(el=>el.click());
    await expect(gap).toBeEnabled();
    await gap.fill('54');
    await gap.press('Escape');
    await expectPaused(page);
    expect((await element(page)).paragraphRuns).toEqual(runs);

    await tab(page,'Оформление').tap();
    await opener(page,'gallery').tap();
    await tab(page,'Мои маркеры').tap();
    const input = sheet(page).locator('[data-mp-list-custom]');
    await input.fill(flag);
    await input.press('Enter');
    await page.evaluate(()=>{window.m14HoldGallery=true;});
    await sheet(page).getByRole('button',{name:'Добавить',exact:true}).tap();
    await expect.poll(()=>page.evaluate(()=>!!window.m14Completion)).toBe(true);
    await back(page);
    await tab(page,'Интервалы').tap();
    await gap.fill('57');
    await gap.evaluate(el=>{window.m14OldField=el;});

    await page.locator('#mobileSeriesToggle').tap();
    await page.locator('#mobileSeriesList [data-side-slide="1"]').tap();
    await expect(sheet(page)).toHaveCount(0);
    await expect(editor(page)).toBeHidden();
    await selectLayer(page,'Другой холст');
    await showSettings(page);
    await page.evaluate(()=>{
      window.m14OldField.dispatchEvent(new Event('change',{bubbles:true}));
      window.m14Completion();
    });
    await opener(page,'gallery').tap();
    await tab(page,'Мои маркеры').tap();
    await expect(sheet(page).getByRole('button',{name:'Применить маркер '+flag,exact:true})).toBeVisible();
    await expect(sheet(page).locator('[data-mp-list-library-note]')).toBeHidden();
    const switched = await exportedDocument(page);
    expect(switched.activeSlideIndex).toBe(1);
    expect(switched.slides.map(slide=>slide.elements[0].paragraphRuns)).toEqual(initial.slides.map(slide=>slide.elements[0].paragraphRuns));
    await expect.poll(async()=> (await records(page,'docs')).find(doc=>doc.id===id)?.activeSlideIndex).toBe(1);

    await page.locator('#mobileSeriesToggle').tap();
    await page.locator('#mobileSeriesList [data-side-slide="0"]').tap();
    await selectLayer(page);
    await showSettings(page);
    await tab(page,'Интервалы').tap();
    await field(page,'listGap').fill('77');
    await field(page,'listGap').evaluate(el=>{window.m14OldField=el;});
    await selectLayer(page,'Соседний слой');
    await expect(sheet(page)).toHaveCount(0);
    await page.evaluate(()=>window.m14OldField.dispatchEvent(new Event('change',{bubbles:true})));
    expect((await exportedDocument(page)).elements.map(layer=>layer.paragraphRuns)).toEqual([runs,runs]);
    await showSettings(page);
    await tab(page,'Интервалы').tap();
    await field(page,'listGap').fill('44');
    await field(page,'listGap').evaluate(el=>{window.m14OldField=el;});
    await importPayload(page,{format:'kartochnaya-v1',document:fixture.document},'other.json');
    await expect(sheet(page)).toHaveCount(0);
    const other = await exportedDocument(page);
    expect(other.id).not.toBe(id);
    await page.evaluate(()=>window.m14OldField.dispatchEvent(new Event('change',{bubbles:true})));
    expect((await exportedDocument(page)).elements).toEqual(other.elements);
  });
});

test.describe('landscape mobile list inspector',()=>{
  test.use({viewport:{width:640,height:360},hasTouch:true,isMobile:true});

  test('Back returns to the previous scroll position and both header actions stay visible',async({page})=>{
    await seed(page);
    await showSettings(page);
    const scroller = sheet(page).locator('.mp-body');
    const top = await scroller.evaluate(el=>{el.scrollTop=64;return el.scrollTop;});
    expect(top).toBeGreaterThan(0);
    await opener(page,'gallery').tap();
    await expect(sheet(page)).toHaveAccessibleName('Маркеры');
    await scroller.evaluate(el=>{el.scrollTop=el.scrollHeight;});
    for(const name of ['Назад','Готово']){
      await expect(sheet(page).getByRole('button',{name,exact:true})).toBeInViewport({ratio:1});
    }
    await back(page);
    expect((await scrollState(page)).top).toBe(top);
    await expect(opener(page,'gallery')).toBeFocused();
  });
});
