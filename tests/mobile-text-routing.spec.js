const {test,expect,openHome,importPayload,records,openLibraryDocument,exportedDocument,exportPNG}=require('./helpers');
const fixture=require('./fixtures/visual-text.json');
const panel=(page,tool)=>page.locator(`#mobileContext [data-mobile=${tool}]`).tap();
const caret=page=>page.locator('#inlineText').evaluate(e=>[e.selectionStart,e.selectionEnd,e.selectionDirection]);
const history=page=>page.locator('#historyEntries [data-history-index]').count();
const element=async page=>(await exportedDocument(page)).elements[0];
async function open(page,patch={},two=false){
 await openHome(page);const payload=structuredClone(fixture);
 Object.assign(payload.document.elements[0],{id:'routing',name:'Routing',x:16,y:16,w:288,h:200,fontFamily:'Arial',fontSize:20,text:'Привет мир и семья 👨‍👩‍👧‍👦\nЕщё русский текст 😀',fontWeight:'400',fontStyle:'normal',autoFontSize:false,...patch});
 if(two)payload.document.elements.push({...payload.document.elements[0],id:'other',name:'Other',y:180,text:'Другой слой'});
 payload.document.palette=['#ff0000','#000000'];await importPayload(page,payload);
 const d=(await records(page,'docs')).find(d=>d.elements.some(e=>e.name==='Routing'));await openLibraryDocument(page,d.id);
 await page.locator('[data-mobile=layers]:visible').tap();await page.locator('#mobileLayerList .layer-name').filter({hasText:'Routing',exact:true}).tap();await page.locator('#mobileLayersClose').tap();
 await page.locator('#mobileContext [data-mobile=edit]').tap();await expect(page.locator('#inlineText')).toBeFocused();
}
async function select(page,start=0,end=6){await page.locator('#inlineText').evaluate((e,{start,end})=>{e.focus();e.setSelectionRange(start,end,'backward');e.dispatchEvent(new Event('select',{bubbles:true}))},{start,end})}
for(const viewport of [{width:360,height:640},{width:390,height:844}])test.describe(`mobile range routing ${viewport.width}`,()=>{
 test.use({viewport,hasTouch:true,isMobile:true});
 for(const command of ['bold','italic','underline','color','size'])test(`Justify refuses ${command} without layer fallback`,async({page})=>{
  await open(page,{textAlign:'justify'});await select(page);const before=await element(page),h=await history(page);
  if(command==='color'){await panel(page,'color');await page.locator('[data-mp-swatch="#ff0000"]').first().tap()}
  else if(command==='size'){await panel(page,'size');const field=page.locator('input[type=number][data-mp-key=fontSize]');await field.fill('28');await field.press('Enter')}
  else{await panel(page,'format');await page.locator(`[data-mp-format=${command}]`).tap()}
  expect(await element(page)).toEqual(before);await expect(page.locator('#toast')).toContainText('недоступно');expect(await history(page)).toBe(h);
  expect(await page.locator('#inlineText').evaluate(e=>[e.selectionStart,e.selectionEnd,e.selectionDirection])).toEqual([0,6,'backward']);
 });
 for(const align of ['left','center','right'])test(`supported ${align}: family size bold color underline, PNG, Done and reload`,async({page})=>{
  await open(page,{textAlign:align,textRuns:[{start:7,end:10,style:{fontStyle:'italic'}}]});
  const original=await element(page);const pngBefore=(await exportPNG(page)).image.data;await panel(page,'edit');await expect(page.locator('#inlineText')).toBeFocused();
  await select(page);await panel(page,'font');await page.locator('[data-mp-font="Georgia"]').first().tap();
  await panel(page,'size');const field=page.locator('input[type=number][data-mp-key=fontSize]');await field.tap();await field.fill('28');await expect(field).toBeFocused();
  // A delayed native notification after blur must not collapse the saved target.
  await page.locator('#inlineText').evaluate(e=>{e.setSelectionRange(1,1);e.dispatchEvent(new Event('select',{bubbles:true}));document.dispatchEvent(new Event('selectionchange'))});
  await field.press('Enter');expect(await caret(page)).toEqual([0,6,'backward']);
  await field.tap();await field.fill('29');await field.press('Enter');expect(await caret(page)).toEqual([0,6,'backward']);
  await panel(page,'format');await page.locator('[data-mp-format=bold]').tap();
  await panel(page,'color');await page.locator('[data-mp-swatch="#ff0000"]').first().tap();
  await panel(page,'format');await page.locator('[data-mp-format=underline]').tap();
  const styled=await element(page);expect(styled.text).toBe(original.text);expect(styled.fontWeight).toBe(original.fontWeight);expect(styled.fontSize).toBe(original.fontSize);
  expect(styled.textRuns).toEqual([{start:0,end:6,style:{fontFamily:'Georgia',fontSize:29,fontWeight:'700',textColor:'#ff0000',underline:true}},{start:7,end:10,style:{fontStyle:'italic'}}]);
  expect(await caret(page)).toEqual([0,6,'backward']);
  await page.locator('#mobileConfirm').tap();await expect(page.locator('#inlineText')).toBeHidden();
  const pngAfter=(await exportPNG(page)).image.data;expect(pngAfter.equals(pngBefore)).toBe(false);
  const doc=await exportedDocument(page);await expect.poll(async()=>(await records(page,'docs')).find(d=>d.id===doc.id)?.elements).toEqual(doc.elements);
  await page.reload();await openLibraryDocument(page,doc.id);expect((await exportedDocument(page)).elements).toEqual(doc.elements);expect((await exportPNG(page)).image.data.equals(pngAfter)).toBe(true);
 });
 test('all supported property routes preserve adjacent runs and numeric/slider focus',async({page})=>{
  await open(page,{textRuns:[{start:7,end:10,style:{fontStyle:'italic'}}]});await select(page);
  await panel(page,'font');await page.locator('[data-mp-font="Georgia"]').first().tap();
  await page.locator('[data-mp-action=expand]').tap();const variant=page.locator('[data-mp-variant="700:normal"]');await variant.tap();
  await panel(page,'spacing');
  for(const [key,val] of [['letterSpacing','2'],['lineHeight','1.5']]){const field=page.locator(`input[type=number][data-mp-key=${key}]`);await field.fill(val);await expect(field).toBeFocused();await field.press('Enter');expect(await caret(page)).toEqual([0,6,'backward'])}
  // The text toolbar exposes stroke through legacy effects. Exercise the existing
  // generic stroke property route without inventing another mobile control.
  await page.locator('#inspector [data-key=strokeWidth]').evaluate(field=>{field.value='2';field.dispatchEvent(new Event('change',{bubbles:true}))});
  await page.locator('#inspector [data-fill-open=stroke]').evaluate(button=>button.click());
  await page.locator('#fillPopover [data-fill-palette="#ff0000"]').first().tap();
  const beforeUnsupported=await element(page);const alpha=page.locator('#cpAlphaInput');await alpha.fill('50');await alpha.press('Enter');await expect(page.locator('#toast')).toContainText('недоступно');expect(await element(page)).toEqual(beforeUnsupported);
  await page.locator('#fillPopover [data-fill-close]').tap();
  await page.locator('#inspector [data-key=strokeStyle]').evaluate(field=>{field.value='dashed';field.dispatchEvent(new Event('change',{bubbles:true}))});await expect(page.locator('#toast')).toContainText('недоступно');expect(await element(page)).toEqual(beforeUnsupported);
  await panel(page,'format');await page.locator('[data-mp-format=italic]').tap();await page.locator('[data-mp-format=strike]').tap();
  let e=await element(page);expect(e.textRuns).toEqual([{start:0,end:6,style:{fontFamily:'Georgia',fontWeight:'700',fontStyle:'italic',letterSpacing:2,lineHeight:1.5,strokeWidth:2,stroke:'#ff0000',strikethrough:true}},{start:7,end:10,style:{fontStyle:'italic'}}]);
  await panel(page,'size');const slider=page.locator('input[type=range][data-mp-key=fontSize]');await slider.focus();await slider.press('ArrowRight');await expect(slider).toBeFocused();expect(await caret(page)).toEqual([0,6,'backward']);const stepped=await element(page);await page.locator('#inlineText').focus();await page.keyboard.press('Control+z');await page.keyboard.press('Control+y');expect(await element(page)).toEqual(stepped);await slider.focus();await slider.press('ArrowRight');expect(await element(page)).not.toEqual(stepped);
 });
 test('Unicode multiline whole graphemes are safe; split ZWJ/surrogate/combining selections refuse',async({page})=>{
  await open(page,{text:'Привет семья 👨‍👩‍👧‍👦 😀 е\u0301'+('\nЕщё длинный русский текст с переносом строки, кириллицей и emoji 😀.').repeat(12)});
  const before=await element(page),start=before.text.indexOf('👨'),end=before.text.indexOf('Ещё');
  await select(page,start,end);await panel(page,'format');await page.locator('[data-mp-format=bold]').tap();
  const styled=await element(page);expect(styled.text).toBe(before.text);expect(styled.textRuns).toEqual([{start,end,style:{fontWeight:'700'}}]);
  for(const [a,b] of [[start,start+2],[start+1,start+2],[before.text.indexOf('е\u0301'),before.text.indexOf('е\u0301')+1]]){
   await select(page,a,b);await page.locator('[data-mp-format=italic]').tap();await expect(page.locator('#toast')).toContainText('целиком');expect(await element(page)).toEqual(styled);
  }
 });
 test('input → formatting → input, exact Undo/Redo, no-op, Done and saved snapshots',async({page})=>{
  await open(page);const h=await history(page);await page.locator('#inlineText').press('End');await page.keyboard.insertText(' ввод');
  const input=await element(page);await select(page);await panel(page,'size');const field=page.locator('input[type=number][data-mp-key=fontSize]');
  await field.fill('28');await field.press('Enter');const formatted=await element(page);
  // Identical final values must not add another undo state.
  await field.fill('28');await field.press('Enter');await page.locator('#inlineText').press('Control+z');expect(await element(page)).toEqual(input);
  await page.locator('#inlineText').press('Control+y');expect(await element(page)).toEqual(formatted);expect(await caret(page)).toEqual([0,6,'backward']);
  await page.keyboard.insertText('Ёж');const typed=await element(page);await page.keyboard.press('Control+z');expect(await element(page)).toEqual(formatted);await page.keyboard.press('Control+y');expect(await element(page)).toEqual(typed);
  await page.locator('#mobileConfirm').tap();expect(await history(page)).toBe(h+3);await page.locator('#undoBtn').tap();expect(await element(page)).toEqual(formatted);await page.locator('#redoBtn').tap();expect(await element(page)).toEqual(typed);const doc=await exportedDocument(page);await expect.poll(async()=>(await records(page,'docs')).find(d=>d.id===doc.id)?.elements).toEqual(doc.elements);
  await page.reload();await openLibraryDocument(page,doc.id);expect((await exportedDocument(page)).elements).toEqual(doc.elements);
 });
 for(const mode of ['vertical','path','boundary'])test(`specialized ${mode} refuses selected bold`,async({page})=>{
  await open(page,{textMode:mode,textPathPoints:[{x:0,y:.5},{x:1,y:.5}]});await select(page);const before=await element(page),h=await history(page);
  await panel(page,'format');await page.locator('[data-mp-format=bold]').tap();await expect(page.locator('#toast')).toContainText('недоступно');expect(await element(page)).toEqual(before);expect(await history(page)).toBe(h);
 });
 test('alignment stays layer-only; switching left to Justify cannot enable fallback',async({page})=>{
  await open(page);await select(page);await panel(page,'format');await page.locator('[data-mp-format=justify]').tap();
  const before=await element(page);expect(before.textAlign).toBe('justify');expect(before.textRuns).toBeUndefined();
  await page.locator('[data-mp-format=bold]').tap();await expect(page.locator('#toast')).toContainText('недоступно');expect(await element(page)).toEqual(before);
 });
 test('rejected commands leave PNG and document history unchanged after Done',async({page})=>{
  await open(page,{textAlign:'justify',textRuns:[{start:7,end:10,style:{fontStyle:'italic'}}]});const png=(await exportPNG(page)).image.data,h=await history(page);
  await panel(page,'edit');await select(page);const before=await element(page);await panel(page,'format');
  for(const key of ['bold','italic','underline'])await page.locator(`[data-mp-format=${key}]`).tap();
  await page.locator('#mobileConfirm').tap();expect(await element(page)).toEqual(before);expect(await history(page)).toBe(h);expect((await exportPNG(page)).image.data.equals(png)).toBe(true);
 });
 test('old panel controls cannot mutate either layer after selection changes',async({page})=>{
  await open(page,{},true);await select(page);await panel(page,'format');await page.locator('[data-mp-format=bold]').evaluate(button=>window.oldMobileCommand=button);
  const before=(await exportedDocument(page)).elements;
  await page.locator('[data-mobile=layers]:visible').tap();await page.locator('#mobileLayerList .layer-name').filter({hasText:'Other',exact:true}).tap();await page.locator('#mobileLayersClose').tap();
  await page.evaluate(()=>window.oldMobileCommand.click());expect((await exportedDocument(page)).elements).toEqual(before);
 });
 test('old panel controls cannot mutate either document after document switch',async({page})=>{
  await open(page);const first=await exportedDocument(page);await select(page);await panel(page,'format');await page.locator('[data-mp-format=bold]').evaluate(button=>window.oldMobileCommand=button);
  await page.locator('#documentTabsHome').tap();await openLibraryDocument(page,first.id);
  // Import another actual document, switch to it and replay the detached control.
  await page.locator('#documentTabsHome').tap();const payload=structuredClone(fixture);payload.document.title='Other document';await importPayload(page,payload);
  const second=(await records(page,'docs')).find(d=>d.title==='Other document (импорт)');await openLibraryDocument(page,second.id);const before=await exportedDocument(page);
  await page.evaluate(()=>window.oldMobileCommand.click());expect((await exportedDocument(page)).elements).toEqual(before.elements);
  expect((await records(page,'docs')).find(d=>d.id===first.id).elements).toEqual(first.elements);
 });
 test('layer text transformation cannot silently reconfirm saved UTF-16 offsets',async({page})=>{
  await open(page,{text:'Привет ß семья 😀'});await select(page);await panel(page,'format');await page.locator('[data-mp-format=case]').tap();
  expect((await element(page)).text).toBe('ПРИВЕТ SS СЕМЬЯ 😀');await page.locator('[data-mp-format=case]').tap();const transformed=await element(page);expect(transformed.text).toBe('привет ß семья 😀');
  await page.locator('[data-mp-format=bold]').tap();await expect(page.locator('#toast')).toContainText('заново');expect(await element(page)).toEqual(transformed);
 });
 test('old panel after native text revision refuses command until reopened',async({page})=>{
  await open(page);await select(page);await panel(page,'format');await page.locator('#inlineText').focus();await page.keyboard.insertText('Новое');const before=await element(page),h=await history(page);
  await page.locator('[data-mp-format=bold]').tap();await expect(page.locator('#toast')).toContainText('устарела');expect(await element(page)).toEqual(before);expect(await history(page)).toBe(h);
 });
});
