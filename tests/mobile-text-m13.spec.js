const {test,expect,openHome,importPayload,records,openLibraryDocument,exportedDocument,exportPNG}=require('./helpers');
const fixture=require('./fixtures/visual-text.json');

const editor=page=>page.locator('#inlineText');
const sheet=page=>page.locator('#mobilePropertyUI .mp-sheet');
const tool=(page,name)=>page.locator(`#mobileContext [data-mobile=${name}]`).tap();
const button=(page,key)=>sheet(page).locator(`[data-mp-format=${key}]`);
const shift=(page,mode)=>sheet(page).locator(`[data-mp-baseline-shift=${mode}]`);
const textCase=(page,mode)=>sheet(page).locator(`[data-mp-text-case=${mode}]`);
const back=page=>sheet(page).getByRole('button',{name:'Назад'}).tap();
const done=page=>sheet(page).getByRole('button',{name:'Готово'}).tap();
const finish=page=>page.locator('#mobileConfirm').tap();
const undo=page=>page.locator('#undoBtn').tap();
const redo=page=>page.locator('#redoBtn').tap();
const element=async page=>(await exportedDocument(page)).elements[0];
const caret=page=>editor(page).evaluate(el=>[el.selectionStart,el.selectionEnd,el.selectionDirection]);
const focusCount=page=>page.evaluate(()=>window.m13TextFocus);
const waitForPaint=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));

async function selectLayer(page,name='M1.3'){
 await page.locator('[data-mobile=layers]:visible').tap();
 await page.locator('#mobileLayerList').getByText(name,{exact:true}).tap();
 await page.locator('#mobileLayersClose').tap();
}
async function open(page,patch={},{other=false,series=false}={}){
 await page.addInitScript(()=>{
  window.m13TextFocus=0;
  window.m13Glyphs=[];
  document.addEventListener('focusin',ev=>{if(ev.target.id==='inlineText')window.m13TextFocus++});
  const proto=CanvasRenderingContext2D.prototype,{fillText,clearRect}=proto;
  proto.clearRect=function(...args){if(this.canvas.id==='canvas')window.m13Glyphs=[];return clearRect.apply(this,args)};
  proto.fillText=function(text,...args){if(this.canvas.id==='canvas')window.m13Glyphs.push(text);return fillText.call(this,text,...args)};
 });
 await openHome(page);
 const payload=structuredClone(fixture);
 const sample=payload.document.elements[0];
 Object.assign(sample,{id:'m13',name:'M1.3',text:'До   Оплатить   после и ещё слова.\nАбзац 👩‍💻 😀 е\u0301 конец.',
  x:16,y:16,w:288,h:170,fontFamily:'Arial',fontSize:21,fontWeight:'400',fontStyle:'normal',textAlign:'justify',autoFontSize:false,...patch});
 if(other)payload.document.elements.push({...sample,id:'other',name:'Другой слой',text:'7/12 и 9.30',x:16,y:200,h:28,textRuns:undefined,paragraphRuns:undefined,typography:undefined,autoFontSize:false});
 if(series){
  const {width,height,background,elements}=payload.document;
  Object.assign(payload.document,{type:'card',hasCustomName:true,activeSlideIndex:1,slides:[
   {id:'first',width,height,background,elements:[{...sample,id:'first-text',name:'Первый холст'}]},
   {id:'second',width,height,background,elements},
  ]});
 }
 await importPayload(page,payload);
 const doc=(await records(page,'docs')).find(d=>d.elements.some(e=>e.name==='M1.3'));
 await openLibraryDocument(page,doc.id);
 await selectLayer(page);
 return doc.id;
}
async function edit(page){
 await tool(page,'edit');
 await expect(editor(page)).toBeFocused();
 await expect(page.locator('#inlineWysiwyg')).toBeHidden();
}
async function select(page,start,end){
 if(await editor(page).evaluate(el=>el.readOnly))await edit(page);
 await editor(page).evaluate((el,[start,end])=>{
  el.setSelectionRange(start,end,'backward');
  el.dispatchEvent(new Event('select',{bubbles:true}));
 },[start,end]);
}
async function paused(page){
 await expect(editor(page)).not.toBeFocused();
 await expect(editor(page)).toHaveJSProperty('readOnly',true);
 await expect(editor(page)).toHaveAttribute('inputmode','none');
}
async function nativeWord(page,start,end){
 await waitForPaint(page);
 const box=await editor(page).boundingBox();
 const row=await editor(page).evaluate(el=>parseFloat(getComputedStyle(el).lineHeight)*el.getBoundingClientRect().width/el.offsetWidth);
 const y=box.y+row/2;
 let point;
 // Locate the word with native hit testing, then let two actual taps select it.
 for(let x=box.x+8;x<box.x+box.width-8;x+=12){
  await page.mouse.click(x,y);
  const [offset]=await caret(page);
  if(offset>start&&offset<end){point=x;break}
 }
 expect(point).toBeDefined();
 await page.waitForTimeout(450);
 await page.touchscreen.tap(point,y);
 await page.touchscreen.tap(point,y);
 expect((await caret(page)).slice(0,2)).toEqual([start,end]);
}
async function capture(page,info,name,viewport){
 const geometry=await sheet(page).evaluate(el=>{
  const body=el.querySelector('.mp-body'),rect=el.getBoundingClientRect();
  const controls=Array.from(el.querySelectorAll('button,label,summary'))
   .filter(node=>node.getClientRects().length)
   .map(node=>{const r=node.getBoundingClientRect();return {width:r.width,height:r.height}});
  return {sheetHeight:rect.height,top:rect.top,scrollWidth:body.scrollWidth,bodyWidth:body.clientWidth,
   scrollHeight:body.scrollHeight,bodyHeight:body.clientHeight,documentWidth:document.documentElement.scrollWidth,controls};
 });
 expect(geometry.top).toBeGreaterThan(viewport.height*.40);
 expect(geometry.scrollWidth).toBe(geometry.bodyWidth);
 expect(geometry.documentWidth).toBe(viewport.width);
 for(const {width,height} of geometry.controls){expect(width).toBeGreaterThanOrEqual(44);expect(height).toBeGreaterThanOrEqual(44)}
 if(name==='format'||name==='case')expect(geometry.scrollHeight).toBe(geometry.bodyHeight);
 const path=info.outputPath(`${name}-${viewport.width}.png`);
 await page.screenshot({path});
 await info.attach(name,{path,contentType:'image/png'});
 await info.attach(name+' measurements',{body:JSON.stringify(geometry),contentType:'application/json'});
}

for(const viewport of [{width:360,height:640},{width:390,height:844}])test.describe(`M1.3 ${viewport.width}`,()=>{
 test.use({viewport,hasTouch:true,isMobile:true});

 test('native word, Mixed, graphemes, indices, case, paragraphs and history',async({page},info)=>{
  const text='До   Оплатить   после и ещё слова.\nАбзац 👩‍💻 😀 е\u0301 конец.';
  const start=text.indexOf('Оплатить'),end=start+'Оплатить'.length;
  await open(page,{text,autoFontSize:true,textRuns:[
   {start,end:start+3,style:{baselineShift:'sub',textCase:'lower'}},
   {start:end+3,end:end+8,style:{underline:true,fontSize:24}},
  ]});
  await edit(page);
  const initial=await element(page),focus=await focusCount(page);
  await nativeWord(page,start,end);
  await tool(page,'format');
  await expect(sheet(page).locator('[data-mobile-text-selection]')).toHaveText('Выделено: «Оплатить»');
  await expect(sheet(page).locator('[data-mp-baseline-mixed]')).toContainText('Mixed');
  await expect(sheet(page).locator('[data-mp-baseline-shift][aria-pressed=true]')).toHaveCount(0);
  await expect(button(page,'case')).toHaveAttribute('aria-description','Mixed');
  await capture(page,info,'format',viewport);
  expect(await element(page)).toEqual(initial);
  await shift(page,'super').tap();
  const shifted=await element(page);
  expect(shifted.textRuns).toEqual([
   {start,end:start+3,style:{baselineShift:'super',textCase:'lower'}},
   {start:start+3,end,style:{baselineShift:'super'}},
   initial.textRuns[1],
  ]);
  expect(shifted).toMatchObject({text,autoFontSize:true,textAlign:'justify',
   textRunsBaseFontSize:initial.textRunsBaseFontSize??initial.fontSize});
  await shift(page,'super').tap();
  await undo(page);expect(await element(page)).toEqual(initial);
  await redo(page);expect(await element(page)).toEqual(shifted);

  await button(page,'case').tap();
  await expect(sheet(page)).toHaveAccessibleName('Регистр текста');
  await expect(sheet(page).locator('[data-mp-case-mixed]')).toHaveText('Mixed');
  await expect(sheet(page).locator('[data-mp-text-case][aria-pressed=true]')).toHaveCount(0);
  await capture(page,info,'case',viewport);
  expect(await element(page)).toEqual(shifted);
  await textCase(page,'upper').tap();
  const upper=await element(page);
  expect(upper.textRuns).toEqual([{start,end,style:{baselineShift:'super',textCase:'upper'}},initial.textRuns[1]]);
  await expect(textCase(page,'upper')).toHaveAttribute('aria-pressed','true');
  await undo(page);expect(await element(page)).toEqual(shifted);
  await expect(sheet(page).locator('[data-mp-case-mixed]')).toHaveText('Mixed');
  await redo(page);expect(await element(page)).toEqual(upper);
  await page.goBack();
  await expect(sheet(page)).toHaveAccessibleName('Формат');
  await paused(page);
  await expect(editor(page)).toHaveValue(text);
  await button(page,'bullet').tap();
  expect((await element(page)).paragraphRuns).toEqual([expect.objectContaining({start:0,style:expect.objectContaining({listKind:'bullet'})})]);
  expect(await focusCount(page)).toBe(focus);

  await edit(page);
  const unicodeStart=text.indexOf('👩'),unicodeEnd=text.indexOf(' конец');
  await select(page,unicodeStart,unicodeEnd);
  await tool(page,'format');
  await shift(page,'sub').tap();
  await button(page,'case').tap();
  await textCase(page,'lower').tap();
  expect(await caret(page)).toEqual([unicodeStart,unicodeEnd,'backward']);
  expect((await element(page)).textRuns.at(-1)).toEqual({start:unicodeStart,end:unicodeEnd,style:{baselineShift:'sub',textCase:'lower'}});
  await back(page);
  await done(page);
  await expect(sheet(page)).toHaveCount(0);
  await paused(page);
  await edit(page);
  await select(page,0,0);
  await tool(page,'format');
  await expect(sheet(page).locator('[data-mp-format-target]')).toHaveText('Весь слой');
  await expect(sheet(page).locator('[data-mp-baseline-mixed]')).toContainText('Mixed');
  await shift(page,'normal').tap();
  await button(page,'case').tap();
  await textCase(page,'sentence').tap();
  const whole=await element(page);
  expect(whole.textCase).toBe('sentence');
  expect(whole.baselineShift).toBeUndefined();
  expect(whole.textRuns).toEqual([initial.textRuns[1]]);
  await done(page);await finish(page);
  await expect(editor(page)).toBeHidden();
  expect(await element(page)).toEqual(whole);
  await undo(page);expect((await element(page)).textCase).toBeUndefined();
  await redo(page);expect(await element(page)).toEqual(whole);
 });

 test('all typography settings are layer-only and preserve scrolling, source and stored font size',async({page},info)=>{
  test.setTimeout(60_000);
  const text='"Голос “да”" -- -25 °C; 3 * 4; (tm); 1/2, 7/12; в доме.\nStraße 09.05';
  const textRuns=[{start:0,end:6,style:{underline:true}}];
  const paragraphRuns=[{start:0,style:{listKind:'ordered'}}];
  const id=await open(page,{text,textRuns,paragraphRuns,autoFontSize:true},{other:true});
  const beforePNG=(await exportPNG(page)).image.data;
  await edit(page);
  await select(page,text.indexOf('7/12'),text.indexOf('7/12')+4);
  const nativeSelection=await caret(page),focus=await focusCount(page);
  await tool(page,'format');
  const initial=await exportedDocument(page);
  await button(page,'typography').tap();
  await expect(sheet(page)).toHaveAccessibleName('Автоматическая типографика');
  await expect(sheet(page).locator('.mp-text-selection')).toHaveText('Весь слой');
  await expect(sheet(page).locator('[data-mobile-text-selection]')).toHaveCount(0);
  expect((await exportedDocument(page)).elements).toEqual(initial.elements);
  const master=sheet(page).locator('[data-typography-master]');
  const toggle=selector=>sheet(page).locator('label').filter({has:page.locator(selector)}).tap();
  const rules=sheet(page).locator('[data-typography-rule]');
  const groups=sheet(page).locator('[data-typography-nbsp]');
  const settings=async locator=>locator.evaluateAll(inputs=>Object.fromEntries(inputs.map(input=>[
   input.dataset.typographyRule||input.dataset.typographyNbsp,input.checked,
  ])));
  await expect(master).not.toBeChecked();
  await expect(rules).toHaveCount(9);
  await expect(groups).toHaveCount(7);
  const defaults={rules:await settings(rules),nbspRules:await settings(groups)};
  await capture(page,info,'typography',viewport);
  await toggle('[data-typography-master]');
  for(const key of ['multiply','marks','fractions','timeColon'])await toggle(`[data-typography-rule="${key}"]`);
  const summary=sheet(page).locator('summary'),details=sheet(page).locator('details'),body=sheet(page).locator('.mp-body');
  await summary.tap();
  await expect(details).toHaveJSProperty('open',true);
  await summary.evaluate(el=>el.scrollIntoView({block:'start'}));
  await capture(page,info,'typography-nbsp',viewport);
  await sheet(page).locator('label').filter({has:page.locator('[data-typography-nbsp=dash]')}).scrollIntoViewIfNeeded();
  const scroll=()=>body.evaluate(el=>el.scrollTop),beforeToggle=await scroll();
  expect(beforeToggle).toBeGreaterThan(0);
  await toggle('[data-typography-nbsp=dash]');
  expect(await scroll()).toBe(beforeToggle);
  await undo(page);await expect(groups.last()).toBeChecked();
  await redo(page);await expect(groups.last()).not.toBeChecked();
  expect(await scroll()).toBe(beforeToggle);
  await expect(details).toHaveJSProperty('open',true);
  for(const key of Object.keys(defaults.nbspRules).filter(key=>key!=='dash'))await toggle(`[data-typography-nbsp="${key}"]`);
  expect(Object.values(await settings(groups))).toEqual(Array(7).fill(false));
  await toggle('[data-typography-master]');
  await expect(master).not.toBeChecked();
  const off=await element(page);
  expect(off.typography).toEqual({enabled:false,rules:Object.fromEntries(Object.keys(defaults.rules).map(key=>[key,true])),
   nbspRules:Object.fromEntries(Object.keys(defaults.nbspRules).map(key=>[key,false]))});
  await sheet(page).getByRole('button',{name:'По умолчанию'}).tap();
  const reset=await element(page);
  expect(reset.typography).toEqual({enabled:false,...defaults});
  await sheet(page).getByRole('button',{name:'По умолчанию'}).tap();
  await undo(page);expect(await element(page)).toEqual(off);
  await redo(page);expect(await element(page)).toEqual(reset);
  await expect(details).toHaveJSProperty('open',true);
  await toggle('[data-typography-master]');
  for(const key of ['multiply','marks','fractions','timeColon'])await toggle(`[data-typography-rule="${key}"]`);
  await back(page);
  await expect(button(page,'typography')).toHaveAttribute('title',/9$/);
  await expect(button(page,'typography')).toHaveClass(/active/);
  expect(await caret(page)).toEqual(nativeSelection);
  await paused(page);
  await expect(editor(page)).toHaveValue(text);
  expect(await focusCount(page)).toBe(focus);
  await button(page,'typography').tap();await done(page);
  await expect(sheet(page)).toHaveCount(0);await paused(page);
  await finish(page);await expect(editor(page)).toBeHidden();await waitForPaint(page);
  const glyphs=await page.evaluate(()=>window.m13Glyphs.join(''));
  for(const token of ['«Голос','„да“»','—','−25','×','™','½','⁷⁄₁₂','в\u00a0доме','09:05'])expect(glyphs).toContain(token);
  const final=await exportedDocument(page),saved=final.elements[0];
  expect(saved).toEqual({...initial.elements[0],typography:{...off.typography,enabled:true,nbspRules:defaults.nbspRules}});
  expect(final.elements[1]).toEqual(initial.elements[1]);
  const png=(await exportPNG(page)).image.data;
  expect(png.equals(beforePNG)).toBe(false);
  await selectLayer(page,'Другой слой');await tool(page,'format');await button(page,'typography').tap();
  await expect(master).not.toBeChecked();await summary.tap();
  await toggle('[data-typography-nbsp=dash]');
  const layerScroll=await scroll();
  await undo(page);await expect(groups.last()).toBeChecked();
  await redo(page);await expect(groups.last()).not.toBeChecked();
  expect(await scroll()).toBe(layerScroll);
  await expect(details).toHaveJSProperty('open',true);
  await undo(page);await done(page);
  await expect.poll(async()=>(await records(page,'docs')).find(doc=>doc.id===id)?.elements).toEqual(final.elements);
  await page.reload();await openLibraryDocument(page,id);
  expect((await exportedDocument(page)).elements).toEqual(final.elements);
  expect((await exportPNG(page)).image.data.equals(png)).toBe(true);
  await page.locator('#documentTabsHome').tap();
  await importPayload(page,{format:'kartochnaya-v1',document:final});
  const copy=(await records(page,'docs')).find(doc=>doc.id!==id&&doc.elements.some(el=>el.name==='M1.3'));
  await openLibraryDocument(page,copy.id);
  const restored=(await exportedDocument(page)).elements;
  expect(restored.map((el,i)=>({...el,id:final.elements[i].id}))).toEqual(final.elements);
  expect((await exportPNG(page)).image.data.equals(png)).toBe(true);
 });

 test('composition, split graphemes and stale owner reject replayed commands',async({page})=>{
  await open(page,{},{other:true});await edit(page);
  const initial=await element(page);
  const emoji=initial.text.indexOf('👩');
  await select(page,emoji,emoji+2);
  await tool(page,'format');
  for(const control of [shift(page,'super'),button(page,'case'),button(page,'typography')]){
   await expect(control).toBeDisabled();
   await control.dispatchEvent('click');
  }
  expect(await element(page)).toEqual(initial);
  await edit(page);await select(page,5,13);
  await tool(page,'format');await button(page,'case').tap();
  await editor(page).dispatchEvent('compositionstart');
  await textCase(page,'upper').dispatchEvent('click');
  expect(await element(page)).toEqual(initial);
  await editor(page).dispatchEvent('compositionend');
  await editor(page).tap({position:{x:12,y:10}});await expect(editor(page)).toBeFocused();
  await page.keyboard.insertText('Я');
  const typed=await exportedDocument(page);
  await textCase(page,'upper').dispatchEvent('click');
  expect((await exportedDocument(page)).elements).toEqual(typed.elements);
  await textCase(page,'upper').evaluate(el=>{window.oldM13Control=el});
  await selectLayer(page,'Другой слой');
  await page.evaluate(()=>window.oldM13Control.dispatchEvent(new Event('click',{bubbles:true})));
  expect((await exportedDocument(page)).elements).toEqual(typed.elements);
 });
});

test.describe('M1.3 series on touch',()=>{
 test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 test('updates only the active slide and invalidates controls when switching slides',async({page})=>{
  const id=await open(page,{text:'До 7/12 и 9.30'},{series:true});
  const initial=await exportedDocument(page);
  expect(initial.activeSlideIndex).toBe(1);
  await edit(page);await select(page,0,2);
  await tool(page,'format');await shift(page,'super').tap();
  await button(page,'case').tap();await textCase(page,'upper').tap();await back(page);
  await button(page,'typography').tap();
  const master=sheet(page).locator('[data-typography-master]');
  await master.tap();
  const active=await exportedDocument(page);
  expect(active.elements[0]).toMatchObject({textRuns:[{start:0,end:2,style:{baselineShift:'super',textCase:'upper'}}],typography:{enabled:true}});
  expect(active.slides[1].elements).toEqual(active.elements);
  expect(active.slides[0]).toEqual(initial.slides[0]);
  await master.evaluate(el=>{window.oldM13Control=el});
  await page.locator('#mobileSeriesToggle').tap();
  await page.locator('#mobileSeriesList [data-side-slide="0"]').tap();
  await expect(sheet(page)).toHaveCount(0);await expect(editor(page)).toBeHidden();
  await page.evaluate(()=>window.oldM13Control.dispatchEvent(new Event('change',{bubbles:true})));
  const switched=await exportedDocument(page);
  expect(switched.activeSlideIndex).toBe(0);
  expect(switched.slides).toEqual(active.slides);
  await expect.poll(async()=>(await records(page,'docs')).find(doc=>doc.id===id)?.slides).toEqual(active.slides);
 });
});
