const {test,expect,openHome,importPayload,records,openLibraryDocument}=require('../helpers');
const {model}=require('../support/text-interaction');
const {install,patch}=require('./harness.cjs');
const fixture=require('../fixtures/visual-text.json');
async function open(page,align='left',research=true,uniform=false){
 if(research)await install(page);
 await openHome(page);const payload=structuredClone(fixture);
 Object.assign(payload.document,{width:320,height:480});Object.assign(payload.document.elements[0],patch(align),{id:'m0',name:'M0'});
 if(uniform)delete payload.document.elements[0].textRuns;
 payload.document.palette=['#ff0000','#000000'];await importPayload(page,payload);
 const d=(await records(page,'docs')).find(d=>d.elements.some(e=>e.name==='M0'));await openLibraryDocument(page,d.id);
 await page.locator('[data-mobile=layers]:visible').tap();await page.locator('#mobileLayerList .layer-name').filter({hasText:'M0',exact:true}).tap();await page.locator('#mobileLayersClose').tap();
 await page.locator('#mobileContext [data-mobile=edit]').tap();await expect(page.locator('#inlineText')).toBeFocused();
}
const state=page=>page.evaluate(()=>mobileM0.state());
async function evidence(page,info,label,value){await info.attach(label+'.json',{body:JSON.stringify(value,null,2),contentType:'application/json'});await info.attach(label+'.png',{body:await page.screenshot(),contentType:'image/png'});console.log(label,JSON.stringify(value.hits?{samples:value.samples,mismatches:value.mismatches}:value.geometry?{geometry:value.geometry,panelFallback:value.panelFallback,ime:value.ime}:{recorded:true}))}
for(const viewport of [{width:360,height:640},{width:390,height:844}])test.describe(`${viewport.width}`,()=>{
 test.use({viewport});
 for(const align of ['left','justify'])test(`A native textarea hit geometry ${align}`,async({page},info)=>{
  await open(page,align);await expect(page.locator('#inlineWysiwyg')).toBeHidden();
  await page.evaluate(()=>mobileM0.drawPreview());const points=await page.evaluate(()=>mobileM0.targets());expect(points.length).toBeGreaterThan(10);
  const hits=[];for(const initial of points.filter((_,i)=>i%3===0)){await page.waitForTimeout(550);const p=await page.evaluate(offset=>mobileM0.targets().find(p=>p.expected===offset),initial.expected);if(!p)continue;await page.touchscreen.tap(p.x,p.y);const actual=await page.locator('#inlineText').evaluate(e=>e.selectionStart);hits.push({...p,actual})}
  const mismatches=hits.filter(p=>p.actual!==p.expected);
  await evidence(page,info,`A-${viewport.width}-${align}`,{browser:await page.context().browser().version(),samples:hits.length,mismatches:mismatches.length,hits});
  // Negative feasibility gate: showing correct ink does not fix native geometry.
  expect(mismatches.length).toBeGreaterThan(0);
  await page.locator('#mobileContext [data-mobile=size]').tap();await page.setViewportSize({width:viewport.width,height:viewport.height-220});
  await page.evaluate(()=>mobileM0.drawPreview());await expect(page.locator('#inlineText')).toBeVisible();await expect(page.locator('#mobileConfirm')).toBeVisible();
  await evidence(page,info,`A-${viewport.width}-${align}-resize`,{kind:'layout resize surrogate, no OS keyboard',state:await state(page)});
 });
 test('A uniform left control calibrates native hit probes',async({page},info)=>{
  await open(page,'left',true,true);const points=await page.evaluate(()=>mobileM0.targets());const hits=[];
  for(const initial of points.filter((_,i)=>i%5===0).slice(0,8)){
   await page.waitForTimeout(550);const p=await page.evaluate(offset=>mobileM0.targets().find(p=>p.expected===offset),initial.expected);
   await page.touchscreen.tap(p.x,p.y);hits.push({...p,actual:await page.locator('#inlineText').evaluate(e=>e.selectionStart)});
  }
  const mismatches=hits.filter(p=>p.actual!==p.expected).length;await evidence(page,info,`control-${viewport.width}`,{samples:hits.length,mismatches,hits});expect(mismatches).toBe(0);
 });
 test('native saved backward range, numeric preview, repeat, slider, history, UTF-16',async({page},info)=>{
  await open(page);const start=patch().text.indexOf('семья'),end=patch().text.indexOf('Последний');
  await page.evaluate(({start,end})=>mobileM0.select(start,end,'backward'),{start,end});
  await page.locator('#mobileContext [data-mobile=size]').tap();const input=page.locator('#mobilePropertyUI input[type=number][data-mp-key=fontSize]');
  const initialHistory=(await state(page)).history;
  await input.tap();await input.fill('25');expect((await state(page)).history).toEqual(initialHistory);await input.press('Enter');
  let s=await state(page);expect(s.caret).toEqual({start,end,direction:'backward'});expect(s.element.fontSize).toBe(18);expect(s.element.textRuns.some(r=>r.start===start&&r.end===end&&r.style.fontSize===25)).toBe(true);
  await input.tap();await input.fill('27');await input.press('Enter');s=await state(page);expect(s.caret).toEqual({start,end,direction:'backward'});
  const beforeSlider=s;const slider=page.locator('#mobilePropertyUI input[type=range][data-mp-key=fontSize]');await slider.focus();await slider.press('ArrowRight');
  const afterSlider=await state(page);expect(afterSlider.history.index).toBe(beforeSlider.history.index+1);expect(afterSlider.element).not.toEqual(beforeSlider.element);
  await page.locator('#inlineText').focus();await page.keyboard.press('Control+z');expect((await state(page)).element).toEqual(beforeSlider.element);
  await page.keyboard.press('Control+y');expect((await state(page)).element).toEqual(afterSlider.element);
  s=await state(page);expect(s.element.text).toBe(patch().text);expect(s.element.fontSize).toBe(18);expect(s.caret).toEqual({start,end,direction:'backward'});
  await page.keyboard.insertText('ёж');expect((await state(page)).element.text).toBe(patch().text.slice(0,start)+'ёж'+patch().text.slice(end));
  await page.keyboard.press('Control+z');expect((await state(page)).element).toEqual(afterSlider.element);
  await evidence(page,info,`selection-${viewport.width}`,{...await state(page),exactUndoRedo:true,previewHistoryUnchanged:true,multiline:true,resumedTyping:true});
 });
 test('B real desktop session geometry, panels, input, IME stop',async({page},info)=>{
  await open(page,'justify');await page.evaluate(()=>mobileM0.startCandidate());await expect(page.locator('#inlineWysiwyg')).toBeFocused();
  const geometry=await page.locator('#inlineWysiwyg').evaluate(host=>{
   const rows=mobileM0.rows(),hr=host.getBoundingClientRect(),scale=hr.width/parseFloat(host.style.width),errors=[];
   for(const [i,row] of rows.entries())for(const [j,p] of row.fragments.entries()){
    if(!p.text.trim())continue;const span=host.querySelectorAll('[data-wysiwyg-row]')[i].querySelectorAll('[data-wysiwyg-fragment]')[j],r=document.createRange();r.setStart(span.firstChild,0);r.collapse(true);
    errors.push(Math.abs((r.getBoundingClientRect().x-hr.x)/scale-p.x));
   }return {maxStartError:Math.max(...errors),samples:errors.length,rows:rows.length,text:host.textContent};
  });expect(geometry.text).toBe(patch().text);expect(geometry.maxStartError).toBeLessThan(.75);
  await page.evaluate(()=>mobileM0.select(7,14,'backward'));await page.locator('#mobileContext [data-mobile=size]').tap();
  const input=page.locator('#mobilePropertyUI input[type=number][data-mp-key=fontSize]');await input.tap();await input.fill('24');await input.press('Enter');
  expect((await state(page)).caret).toEqual({start:7,end:14,direction:'backward'});
  const panelFallback=!(await state(page)).live;expect(panelFallback).toBe(true);
  await page.setViewportSize({width:viewport.width,height:viewport.height-220});await expect(page.locator('#mobileConfirm')).toBeVisible();
  await page.evaluate(()=>mobileM0.startCandidate());
  await page.evaluate(()=>mobileM0.select(0,0));await page.keyboard.type('Я');expect((await state(page)).element.text.startsWith('ЯПривет')).toBe(true);
  const before=(await state(page)).element;await page.locator('#inlineWysiwyg').evaluate(host=>{
   host.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));
   host.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:false,inputType:'insertCompositionText',data:'ё',isComposing:true}));
   host.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'ё'}));
  });
  await expect(page.locator('#wysiwygRecovery')).toBeVisible();expect((await state(page)).clean).toBe(false);expect((await state(page)).element).toEqual(before);
  await evidence(page,info,`B-${viewport.width}`,{geometry,panelFallback,state:await state(page),ime:'synthetic boundary replay; recovery required; canonical model preserved'});
 });
 test('shipped Justify bold exposes existing whole-layer routing hole',async({page},info)=>{
  await open(page,'justify',false);const before=await model(page);await page.locator('#inlineText').evaluate(e=>e.setSelectionRange(0,6,'backward'));
  await page.locator('#mobileContext [data-mobile=format]').tap();await page.locator('[data-mp-format=bold]').tap();
  const after=await model(page);expect(after.fontWeight).not.toBe(before.fontWeight);expect(after.textRuns).toEqual(before.textRuns);
  await evidence(page,info,`justify-bold-${viewport.width}`,{beforeWeight:before.fontWeight,afterWeight:after.fontWeight,runsUnchanged:true,scope:'whole-layer despite selected word; existing defect'});
 });
 test('shipped mobile Justify rejects selected range color without whole-layer fallback',async({page})=>{
  await open(page,'justify',false);const before=await model(page);await page.locator('#inlineText').evaluate(e=>e.setSelectionRange(7,14,'backward'));
  await page.locator('#mobileContext [data-mobile=color]').tap();await page.locator('[data-mp-swatch="#ff0000"]').first().tap();
  await expect(page.locator('#toast')).toContainText('недоступно');expect(await model(page)).toEqual(before);
 });
});
