const {test,expect,openHome,importPayload,records,openLibraryDocument,exportedDocument,exportPNG}=require('./helpers');
const fixture=require('./fixtures/visual-text.json');
const tool=(page,name)=>page.locator(`#mobileContext [data-mobile=${name}]`).tap();
const editor=page=>page.locator('#inlineText');
const field=(page,key)=>page.locator(`input[type=number][data-mp-key=${key}]`);
const element=async page=>(await exportedDocument(page)).elements[0];
const caret=page=>editor(page).evaluate(e=>[e.selectionStart,e.selectionEnd,e.selectionDirection]);
const select=(page,start=3,end=11,direction='backward')=>editor(page).evaluate((e,c)=>{e.focus();e.setSelectionRange(...c);e.dispatchEvent(new Event('select',{bubbles:true}))},[start,end,direction]);
async function open(page,patch={}){
 await openHome(page);const payload=structuredClone(fixture);
 Object.assign(payload.document.elements[0],{id:'m121',name:'M121',text:'До Оплатить после и ещё слова для переноса строки.\nДругой абзац 👨‍👩‍👧‍👦 😀 е\u0301',x:16,y:16,w:288,h:200,fontFamily:'Arial',fontSize:20,fontWeight:'400',fontStyle:'normal',textAlign:'justify',autoFontSize:false,textColor:'#000000',...patch});
 payload.document.palette=['#ff0000','#000000'];await importPayload(page,payload);
 const doc=(await records(page,'docs')).find(d=>d.elements.some(e=>e.name==='M121'));await openLibraryDocument(page,doc.id);
 await page.locator('[data-mobile=layers]:visible').tap();await page.locator('#mobileLayerList .layer-name').filter({hasText:'M121',exact:true}).tap();await page.locator('#mobileLayersClose').tap();
 await tool(page,'edit');await expect(editor(page)).toBeFocused();await select(page);return doc;
}
async function unfocused(page){await expect(editor(page)).not.toBeFocused();expect(await caret(page)).toEqual([3,11,'backward'])}
test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  window.m121Events=[];
  const log=ev=>{const e=document.querySelector('#inlineText');m121Events.push({type:ev.type,target:ev.target?.id||ev.target?.tagName||'viewport',active:document.activeElement?.id||document.activeElement?.tagName,selection:e?[e.selectionStart,e.selectionEnd,e.selectionDirection]:null,height:visualViewport?.height});if(m121Events.length>2000)m121Events.shift()};
  for(const type of ['focusin','focusout','selectionchange','pointerdown'])document.addEventListener(type,log,true);
  visualViewport?.addEventListener('resize',ev=>log({type:'visualViewport.resize',target:ev.target}));
 });
});
test.afterEach(async({page},info)=>{await info.attach('focus-selection-viewport',{body:JSON.stringify(await page.evaluate(()=>window.m121Events||[]),null,2),contentType:'application/json'})});
for(const viewport of [{width:360,height:640},{width:390,height:844}])test.describe(`M1.2.1 ${viewport.width}`,()=>{
 test.use({viewport,hasTouch:true,isMobile:true});
 test('Justify Bold changes only the confirmed word',async({page})=>{
  await open(page);const before=await element(page);await tool(page,'format');await page.locator('[data-mp-format=bold]').tap();
  const after=await element(page);expect(after.fontWeight).toBe(before.fontWeight);expect(after.text).toBe(before.text);
  expect(after.textRuns).toEqual([{start:3,end:11,style:{fontWeight:'700'}}]);await expect(page.locator('#toast')).not.toContainText('недоступно');
 });
 test('Format and repeated commands release textarea focus and preserve the range',async({page})=>{
  await open(page,{textAlign:'left'});await tool(page,'format');await unfocused(page);
  for(const key of ['bold','italic','underline','strike']){await page.locator(`[data-mp-format=${key}]`).tap();await unfocused(page)}
  for(const name of ['color','size','spacing','format']){await tool(page,name);await unfocused(page)}
 });
 test('numeric Enter releases its own focus without returning to textarea',async({page})=>{
  await open(page,{textAlign:'left'});await tool(page,'size');await field(page,'fontSize').fill('28');await expect(field(page,'fontSize')).toBeFocused();await field(page,'fontSize').press('Enter');
  await expect(field(page,'fontSize')).not.toBeFocused();await unfocused(page);
  expect((await element(page)).textRuns).toEqual([{start:3,end:11,style:{fontSize:28}}]);
 });
 for(const align of ['justify','left'])test(`${align}: repeated commands, Undo/Redo, Done, IDB, JSON and PNG`,async({page})=>{
  const doc=await open(page,{textAlign:align,textRuns:[{start:12,end:17,style:{underline:true}}]}),original=await element(page),states=[original];
  const focusCount=()=>page.evaluate(()=>m121Events.filter(e=>e.type==='focusin'&&e.target==='inlineText').length);
  const initialFocus=await focusCount();await tool(page,'format');await unfocused(page);
  await expect(page.locator('[data-mobile-text-selection]')).toHaveText('Выделено: «Оплатить»');
  for(const key of ['bold','italic']){await page.locator(`[data-mp-format=${key}]`).tap();await unfocused(page);states.push(await element(page))}
  await tool(page,'color');await page.locator('[data-mp-swatch="#ff0000"]').first().tap();await unfocused(page);states.push(await element(page));
  await tool(page,'format');
  for(const key of ['italic','underline','strike']){await page.locator(`[data-mp-format=${key}]`).tap();await unfocused(page);states.push(await element(page))}
  const styled=states.at(-1);expect(styled).toEqual({...original,textRuns:[{start:3,end:11,style:{fontWeight:'700',textColor:'#ff0000',underline:true,strikethrough:true}},{start:12,end:17,style:{underline:true}}]});
  for(const expected of states.slice(0,-1).reverse()){await page.locator('#undoBtn').tap();await unfocused(page);expect(await element(page)).toEqual(expected)}
  for(const expected of states.slice(1)){await page.locator('#redoBtn').tap();await unfocused(page);expect(await element(page)).toEqual(expected)}
  expect(await focusCount()).toBe(initialFocus);
  await page.locator('#mobileConfirm').tap();await expect(editor(page)).toBeHidden();
  await page.locator('#undoBtn').tap();expect(await element(page)).toEqual(states.at(-2));await page.locator('#redoBtn').tap();expect(await element(page)).toEqual(styled);
  const png=(await exportPNG(page)).image.data,final=await exportedDocument(page);
  await expect.poll(async()=>(await records(page,'docs')).find(d=>d.id===doc.id)?.elements).toEqual(final.elements);
  await page.reload();await openLibraryDocument(page,doc.id);expect((await exportedDocument(page)).elements).toEqual(final.elements);expect((await exportPNG(page)).image.data.equals(png)).toBe(true);
  await page.locator('#documentTabsHome').tap();await importPayload(page,{format:'kartochnaya-v1',document:final});
  const copy=(await records(page,'docs')).find(d=>d.id!==doc.id&&d.elements[0]?.name==='M121');await openLibraryDocument(page,copy.id);const imported=await element(page);expect({...imported,id:styled.id}).toEqual(styled);
 });
 test('late collapsed events, numeric and HEX Enter preserve the confirmed snapshot without focus',async({page})=>{
  await open(page);await tool(page,'size');
  await editor(page).evaluate(e=>{e.setSelectionRange(0,0);e.dispatchEvent(new Event('select'));document.dispatchEvent(new Event('selectionchange'))});
  await field(page,'fontSize').fill('28');await field(page,'fontSize').press('Enter');await unfocused(page);
  await tool(page,'color');await page.locator('[data-mp-action=colorEdit]').tap();const hex=page.locator('[data-mp-hex]');await hex.fill('#123456');await hex.press('Enter');await unfocused(page);await expect(page.locator('[data-mp-hex]')).not.toBeFocused();
  const after=await element(page);expect(after.textRuns).toEqual([{start:3,end:11,style:{fontSize:28,textColor:'#123456'}}]);
  await page.locator('#undoBtn').tap();await unfocused(page);expect((await element(page)).textRuns).toEqual([{start:3,end:11,style:{fontSize:28}}]);
 });
 test('explicit tap resumes native input; replacement, composition and typing Undo retain runs',async({page})=>{
  await open(page);await tool(page,'format');await page.locator('[data-mp-format=bold]').tap();await unfocused(page);const formatted=await element(page);
  await editor(page).tap({position:{x:5,y:12}});await expect(editor(page)).toBeFocused();
  // Native tap decides the insertion position; never restore the old word over it.
  const point=(await caret(page))[0];await page.keyboard.insertText('Я');
  expect((await element(page)).text).toBe(formatted.text.slice(0,point)+'Я'+formatted.text.slice(point));
  await page.keyboard.press('Control+z');expect(await element(page)).toEqual(formatted);await page.keyboard.press('Control+y');const typed=await element(page);
  await editor(page).dispatchEvent('compositionstart');
  await editor(page).evaluate(e=>{const p=e.selectionStart;e.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,inputType:'insertCompositionText',data:'漢',isComposing:true}));e.setRangeText('漢',p,e.selectionEnd,'end');e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:'漢',isComposing:true}))});
  await editor(page).dispatchEvent('compositionend');const composed=await element(page);expect(composed.text).toContain('漢');
  await page.keyboard.press('Control+z');expect(await element(page)).toEqual(typed);await page.keyboard.press('Control+y');expect(await element(page)).toEqual(composed);
  // Existing panel was created before this native revision and must refuse.
  await page.locator('[data-mp-format=italic]').tap();await expect(page.locator('#toast')).toContainText('устарела');expect(await element(page)).toEqual(composed);await expect(editor(page)).not.toBeFocused();
 });
 test('Justify spanning paragraphs and stretched spaces keeps exact backward UTF-16 boundaries',async({page})=>{
  await open(page,{text:'До   Оплатить  после много слов для переноса\n\nАбзац 👨‍👩‍👧‍👦 😀 е\u0301 конец'});
  const original=await element(page),start=original.text.indexOf('Оплатить'),end=original.text.indexOf(' конец');await select(page,start,end);
  await tool(page,'format');await page.locator('[data-mp-format=bold]').tap();await page.locator('[data-mp-format=italic]').tap();
  expect(await caret(page)).toEqual([start,end,'backward']);await expect(editor(page)).not.toBeFocused();
  expect((await element(page)).textRuns).toEqual([{start,end,style:{fontWeight:'700',fontStyle:'italic'}}]);
  for(const [a,b] of [[original.text.indexOf('👨'),original.text.indexOf('👨')+2],[original.text.indexOf('😀')+1,original.text.indexOf('😀')+2],[original.text.indexOf('е\u0301'),original.text.indexOf('е\u0301')+1]]){
   await select(page,a,b);await page.locator('[data-mp-format=underline]').tap();await expect(page.locator('#toast')).toContainText('целиком');expect((await element(page)).textRuns).toEqual([{start,end,style:{fontWeight:'700',fontStyle:'italic'}}]);
  }
 });
 test('Back and Escape from a numeric gesture never resume text input',async({page})=>{
  await open(page);await tool(page,'size');const original=await element(page);
  await field(page,'fontSize').fill('42');await field(page,'fontSize').press('Escape');await unfocused(page);expect(await element(page)).toEqual(original);
  await tool(page,'format');await page.locator('[data-mp-format=bold]').tap();const styled=await element(page);
  await page.goBack();await expect(editor(page)).toBeHidden();expect(await element(page)).toEqual(styled);
 });
 for(const align of ['justify','left'])test(`${align}: native touch word offsets survive geometry changes and panel handoff`,async({page},info)=>{
  await open(page,{textAlign:align,autoFontSize:true,text:'До   Оплатить   после много слов для переноса строки.\nЕщё абзац 😀'});
  const samples=[];
  for(const phase of ['before','after']){
   if(phase==='after'){await tool(page,'edit');await expect(editor(page)).toBeFocused()}
   const box=await editor(page).boundingBox(),row=await editor(page).evaluate(e=>parseFloat(getComputedStyle(e).lineHeight)*e.getBoundingClientRect().width/e.offsetWidth);
   let point;
   // Probe Chromium's own caret hit testing. No Canvas/overlay coordinate oracle
   // and no setSelectionRange repair of the word selected by the two touch taps.
   for(let x=box.x+8;x<box.x+box.width-8;x+=12){
    await page.mouse.click(x,box.y+row/2);const offsets=await caret(page);samples.push({phase,x,offsets});
    if(offsets[0]>5&&offsets[0]<13){point={x,y:box.y+row/2};break}
   }
   expect(point).toBeTruthy();await page.waitForTimeout(450); // Separate the probe click from the native double tap.
   await page.touchscreen.tap(point.x,point.y);await page.touchscreen.tap(point.x,point.y);
   expect((await caret(page)).slice(0,2)).toEqual([5,13]);expect(await editor(page).evaluate(e=>e.value.slice(e.selectionStart,e.selectionEnd))).toBe('Оплатить');
   await tool(page,'format');await page.locator(`[data-mp-format=${phase==='before'?'bold':'underline'}]`).tap();await expect(editor(page)).not.toBeFocused();
   await expect(page.locator('[data-mobile-text-selection]')).toHaveText('Выделено: «Оплатить»');
   if(phase==='before'){
    await tool(page,'size');await field(page,'fontSize').fill('48');await field(page,'fontSize').press('Enter');
    await tool(page,'font');await page.locator('[data-mp-font="Georgia"]').first().tap();await expect(editor(page)).not.toBeFocused();
   }
   const after=await element(page);expect(after.textRuns.every(r=>r.start===5&&r.end===13)).toBe(true);expect(after.textRuns[0].style.fontWeight).toBe('700');
  }
  await info.attach('native-hit-test',{body:JSON.stringify(samples,null,2),contentType:'application/json'});
  await page.screenshot({path:info.outputPath('confirmed-word.png')});
 });
 test('font search Enter closes its explicit input without resuming textarea',async({page})=>{
  await open(page);await tool(page,'font');await page.locator('[data-mp-action=expand]').tap();await page.locator('[data-mp-action=fontSearch]').tap();
  const search=page.locator('[data-mp-search]');await search.fill('Arial');await expect(search).toBeFocused();await search.press('Enter');await expect(search).not.toBeFocused();await unfocused(page);
 });
 test('an unfinished composition cannot be blurred into formatting',async({page})=>{
  await open(page);await editor(page).dispatchEvent('compositionstart');await tool(page,'format');
  await expect(editor(page)).toBeFocused();await expect(page.locator('#toast')).toContainText('Завершите ввод');expect((await element(page)).textRuns).toBeUndefined();
  await editor(page).dispatchEvent('compositionend');await select(page);await tool(page,'format');await page.locator('[data-mp-format=bold]').tap();await unfocused(page);
  expect((await element(page)).textRuns).toEqual([{start:3,end:11,style:{fontWeight:'700'}}]);
 });
 test('a synchronous IME input during blur cannot certify pre-blur offsets',async({page})=>{
  await open(page);
  await editor(page).evaluate(e=>e.addEventListener('blur',()=>{e.setRangeText('Я',0,0,'preserve');e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'Я'}))},{once:true}));
  await tool(page,'format');const before=await element(page);await page.locator('[data-mp-format=bold]').tap();
  await expect(page.locator('#toast')).toContainText('Выделение не подтверждено');expect(await element(page)).toEqual(before);await expect(editor(page)).not.toBeFocused();
  await select(page,4,12);await page.locator('[data-mp-format=bold]').tap();expect((await element(page)).textRuns).toEqual([{start:4,end:12,style:{fontWeight:'700'}}]);
 });
});
