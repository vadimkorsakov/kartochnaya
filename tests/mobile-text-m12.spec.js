const {test,expect,openHome,importPayload,records,openLibraryDocument,exportedDocument,exportPNG}=require('./helpers');
const fixture=require('./fixtures/visual-text.json');
const tool=(page,name)=>page.locator(`#mobileContext [data-mobile=${name}]`).tap();
const select=(page,start=0,end=13,direction='backward')=>page.locator('#inlineText').evaluate((e,c)=>{e.focus();e.setSelectionRange(...c);e.dispatchEvent(new Event('select',{bubbles:true}))},[start,end,direction]);
const field=(page,key)=>page.locator(`input[type=number][data-mp-key=${key}]`);
const element=async page=>(await exportedDocument(page)).elements[0];
async function open(page,mixed=true){
 await openHome(page);const payload=structuredClone(fixture),e=payload.document.elements[0];
 Object.assign(e,{name:'M12',text:'Первое Второе\nХвост 😀',x:16,y:16,w:280,h:200,fontFamily:'Arial',fontSize:24,fontWeight:'400',fontStyle:'normal',textAlign:'left',autoFontSize:false,textColor:'#000000',letterSpacing:0,lineHeight:1.15});
 if(mixed)e.textRuns=[{start:7,end:13,style:{fontFamily:'Georgia',fontSize:36,fontWeight:'700',fontStyle:'italic',textColor:'#ff0000',letterSpacing:2,lineHeight:1.5,underline:true,strikethrough:true,strokeWidth:2,stroke:'#ff0000'}}];
 else delete e.textRuns;
 payload.document.palette=['#000000','#ff0000'];await importPayload(page,payload);
 const doc=(await records(page,'docs')).find(d=>d.elements.some(e=>e.name==='M12'));await openLibraryDocument(page,doc.id);
 await page.locator('[data-mobile=layers]:visible').tap();await page.locator('#mobileLayerList .layer-name').filter({hasText:'M12',exact:true}).tap();await page.locator('#mobileLayersClose').tap();
 await tool(page,'edit');await expect(page.locator('#inlineText')).toBeFocused();await select(page);return doc;
}
async function drag(page,selector,{finish=true,end=.65}={}){
 const el=page.locator(selector);const b=await el.boundingBox();
 await page.mouse.move(b.x+b.width*.2,b.y+b.height*.5);await page.mouse.down();
 await page.mouse.move(b.x+b.width*end,b.y+b.height*.5,{steps:32});
 if(finish)await page.mouse.up();
}
async function touchPlane(page,{cancel=false}={}){
 const box=await page.locator('[data-mp-plane]').boundingBox(),cdp=await page.context().newCDPSession(page);
 await page.evaluate(()=>{window.m12Touch=[];for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])document.addEventListener(type,e=>window.m12Touch.push({type,id:e.pointerId,x:e.clientX}),{capture:true})});
 const point=f=>[{x:box.x+box.width*f,y:box.y+box.height*.45,id:1,radiusX:3,radiusY:3,force:1}];
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:point(.15)});
 await expect.poll(()=>page.evaluate(()=>window.m12Touch.some(e=>e.type==='pointerdown'))).toBe(true);
 for(let i=1;i<=30;i++){
  const touchPoints=point(.15+i*.02);await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints});
  // CDP ack precedes coalesced pointer delivery. Assert actual browser events.
  await expect.poll(()=>page.evaluate(x=>window.m12Touch.some(e=>e.type==='pointermove'&&Math.abs(e.x-x)<1),touchPoints[0].x)).toBe(true);
 }
 await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
 await expect.poll(()=>page.evaluate(type=>window.m12Touch.some(e=>e.type===type),cancel?'pointercancel':'pointerup')).toBe(true);
 await cdp.detach();
 expect(await page.evaluate(()=>window.m12Touch.filter(e=>e.type==='pointermove').length)).toBeGreaterThanOrEqual(30);
}
for(const viewport of [{width:360,height:640},{width:390,height:844}])test.describe(`M1.2 ${viewport.width}`,()=>{
 test.use({viewport,hasTouch:true,isMobile:true});
 test('Mixed reads the entire range; toggles, selection boundaries and Undo/Redo',async({page},info)=>{
  await open(page);const original=await element(page);await tool(page,'size');await expect(field(page,'fontSize')).toHaveValue('');await expect(field(page,'fontSize')).toHaveAttribute('placeholder','Смешано');
  await page.screenshot({path:info.outputPath('mixed-size.png')});
  await tool(page,'spacing');for(const k of ['letterSpacing','lineHeight'])await expect(field(page,k)).toHaveValue('');
  await tool(page,'color');await expect(page.locator('[data-mp-swatch].active')).toHaveCount(0);
  await tool(page,'format');for(const k of ['bold','italic','underline','strike'])await expect(page.locator(`[data-mp-format=${k}]`)).toHaveAttribute('aria-pressed','mixed');
  await page.screenshot({path:info.outputPath('mixed-format.png')});
  await page.locator('[data-mp-format=bold]').tap();await expect(page.locator('[data-mp-format=bold]')).toHaveAttribute('aria-pressed','true');const bold=await element(page);
  await page.locator('[data-mp-format=bold]').tap();await expect(page.locator('[data-mp-format=bold]')).toHaveAttribute('aria-pressed','false');
  await page.locator('#undoBtn').tap();expect(await element(page)).toEqual(bold);await page.locator('#undoBtn').tap();expect(await element(page)).toEqual(original);
  await expect(page.locator('[data-mp-format=bold]')).toHaveAttribute('aria-pressed','mixed');await page.locator('#redoBtn').tap();expect(await element(page)).toEqual(bold);
  await select(page,7,13,'forward');await tool(page,'size');await expect(field(page,'fontSize')).toHaveValue('36');
  await page.screenshot({path:info.outputPath('uniform-size.png')});await select(page,0,13);await expect(field(page,'fontSize')).toHaveValue('');
 });
 test('real size drags, numeric Enter and independent steppers each settle once',async({page},info)=>{
  await open(page,false);const original=await element(page);await tool(page,'size');
  await page.evaluate(()=>{window.m12Inputs=0;document.addEventListener('input',e=>{if(e.target.matches('[data-mp-key=fontSize]'))window.m12Inputs++})});
  await drag(page,'[type=range][data-mp-key=fontSize]');const first=await element(page);expect(first).not.toEqual(original);expect(await page.evaluate(()=>window.m12Inputs)).toBeGreaterThan(10);
  await drag(page,'[type=range][data-mp-key=fontSize]',{end:.5});const second=await element(page);
  expect(second).not.toEqual(first);
  await field(page,'fontSize').fill('');await field(page,'fontSize').pressSequentially('42');await field(page,'fontSize').press('Enter');const numeric=await element(page);
  await page.locator('[data-mp-step=fontSize][data-dir="1"]').tap();const step1=await element(page);await page.locator('[data-mp-step=fontSize][data-dir="1"]').tap();const step2=await element(page);
  await page.locator('#mobileConfirm').tap();
  for(const expected of [step1,numeric,second,first,original]){await page.locator('#undoBtn').tap();expect(await element(page)).toEqual(expected)}
  for(const expected of [first,second,numeric,step1,step2]){await page.locator('#redoBtn').tap();expect(await element(page)).toEqual(expected)}
  await info.attach('pointer-input-count',{body:String(await page.evaluate(()=>window.m12Inputs)),contentType:'text/plain'});
 });
 test('active preview cannot be saved; color plane settles once and survives reload/JSON/PNG',async({page})=>{
  const doc=await open(page,false);const original=await element(page);await tool(page,'size');await drag(page,'[type=range][data-mp-key=fontSize]',{finish:false});
  // The real beforeunload handler calls flushSave without settling the range.
  await page.locator('#inlineText').evaluate(()=>window.dispatchEvent(new Event('beforeunload')));
  await page.waitForTimeout(650);
  expect((await records(page,'docs')).find(d=>d.id===doc.id).elements[0].textRuns).toEqual(original.textRuns);
  await page.mouse.up();const sized=await element(page);
  await tool(page,'color');await page.locator('[data-mp-action=colorEdit]').tap();await touchPlane(page);const colored=await element(page);expect(colored).not.toEqual(sized);
  await page.locator('#undoBtn').tap();expect(await element(page)).toEqual(sized);await page.locator('#redoBtn').tap();expect(await element(page)).toEqual(colored);
  await page.locator('#mobileConfirm').tap();const png=(await exportPNG(page)).image.data,final=await exportedDocument(page);
  await expect.poll(async()=>(await records(page,'docs')).find(d=>d.id===doc.id)?.elements).toEqual(final.elements);
  await page.reload();await openLibraryDocument(page,doc.id);expect((await exportedDocument(page)).elements).toEqual(final.elements);expect((await exportPNG(page)).image.data.equals(png)).toBe(true);
  await page.locator('#documentTabsHome').tap();await importPayload(page,{format:'kartochnaya-v1',document:final});const copy=(await records(page,'docs')).find(d=>d.id!==doc.id&&d.elements[0]?.name==='M12');await openLibraryDocument(page,copy.id);expect((await exportedDocument(page)).elements[0].textRuns).toEqual(final.elements[0].textRuns);
 });
 for(const ending of ['pointercancel','lostpointercapture','panel','back','done','document'])test(`active drag interruption: ${ending}`,async({page})=>{
  const doc=await open(page,false),original=await element(page);await tool(page,'size');
  await page.locator('[type=range][data-mp-key=fontSize]').evaluate(e=>e.addEventListener('pointerdown',ev=>window.m12Pointer=ev.pointerId));
  await drag(page,'[type=range][data-mp-key=fontSize]',{finish:false});const value=Number(await field(page,'fontSize').inputValue()),preview={...original,textRuns:[{start:0,end:13,style:{fontSize:value}}],textRunsBaseFontSize:24};expect(value).not.toBe(original.fontSize);
  // JSON also exports only confirmed fields while the pointer is still down.
  expect(await element(page)).toEqual(original);
  if(ending==='pointercancel'||ending==='lostpointercapture')await page.locator('[type=range][data-mp-key=fontSize]').evaluate((e,type)=>e.dispatchEvent(new PointerEvent(type,{pointerId:window.m12Pointer,bubbles:true})),ending);
  if(ending==='panel')await page.locator('#mobileContext [data-mobile=spacing]').evaluate(e=>e.click());
  if(ending==='back')await page.goBack();
  if(ending==='done')await page.locator('#mobileConfirm').evaluate(e=>e.click());
  if(ending==='document'){await page.locator('#documentTabsHome').evaluate(e=>e.click());await openLibraryDocument(page,doc.id)}
  await page.mouse.up();expect(await element(page)).toEqual(preview);
  if(await page.locator('#inlineText').isVisible())await page.locator('#mobileConfirm').tap();
  await page.locator('#undoBtn').tap();expect(await element(page)).toEqual(original);await page.locator('#redoBtn').tap();expect(await element(page)).toEqual(preview);
 });
 test('composition aborts preview; late change cannot resurrect it; invalid numeric and Escape are no-op',async({page})=>{
  await open(page,false);const before=await element(page);await tool(page,'size');
  await drag(page,'[type=range][data-mp-key=fontSize]',{finish:false});
  await page.locator('#inlineText').dispatchEvent('compositionstart');await page.locator('#inlineText').dispatchEvent('compositionend');await page.mouse.up();expect(await element(page)).toEqual(before);
  const numeric=field(page,'fontSize');await numeric.fill('43');await numeric.press('Escape');expect(await element(page)).toEqual(before);
  await numeric.fill('999');await numeric.press('Enter');expect(await element(page)).toEqual(before);
  await numeric.fill('');await numeric.press('Enter');expect(await element(page)).toEqual(before);
  await page.locator('#mobileConfirm').tap();await expect(page.locator('#undoBtn')).toBeDisabled();
 });
 test('tracking, leading, hue and HEX share atomic history; touchcancel keeps last color',async({page})=>{
  await open(page,false);const before=await element(page);await tool(page,'spacing');
  const states=[before];
  for(const key of ['letterSpacing','lineHeight']){await drag(page,`[type=range][data-mp-key=${key}]`);states.push(await element(page))}
  await tool(page,'color');await page.locator('[data-mp-action=colorEdit]').tap();
  await touchPlane(page,{cancel:true});states.push(await element(page));
  await drag(page,'[data-mp-hue]');states.push(await element(page));
  const hex=page.locator('[data-mp-hex]');await hex.fill('');await hex.pressSequentially('#12AB34');await hex.press('Enter');states.push(await element(page));
  await page.locator('#mobileConfirm').tap();
  for(let i=states.length-2;i>=0;i--){await page.locator('#undoBtn').tap();expect(await element(page)).toEqual(states[i])}
  for(let i=1;i<states.length;i++){await page.locator('#redoBtn').tap();expect(await element(page)).toEqual(states[i])}
 });
 test('precise sizes at 1, 100, 224 and 500 stay synchronized with stepper and slider',async({page})=>{
  await open(page,false);await tool(page,'size');
  for(const size of [1,100,224,500]){
   await field(page,'fontSize').fill(String(size));await field(page,'fontSize').press('Enter');await expect(field(page,'fontSize')).toHaveValue(String(size));
   const expectedPosition=size<=100?(size-1)*4:396+(size-100)*.25;await expect(page.locator('[data-mp-size-scale]')).toHaveValue(String(expectedPosition));
   const dir=size===500?-1:1;await page.locator(`[data-mp-step=fontSize][data-dir="${dir}"]`).tap();await expect(field(page,'fontSize')).toHaveValue(String(size+dir));
  }
 });

 test('HEX preview confirms once or rolls back on invalid confirmation and Escape',async({page})=>{
  await open(page,false);const before=await element(page);await tool(page,'color');await page.locator('[data-mp-action=colorEdit]').tap();
  const hex=page.locator('[data-mp-hex]');await hex.fill('#123456');await hex.fill('#abcdef');await hex.fill('#abc');await hex.press('Enter');expect(await element(page)).toEqual(before);
  await hex.fill('#123456');await hex.press('Escape');expect(await element(page)).toEqual(before);
  await hex.fill('#123456');await hex.fill('#abcdef');await hex.press('Enter');const after=await element(page);expect(after).not.toEqual(before);
  await page.locator('#mobileConfirm').tap();await page.locator('#undoBtn').tap();expect(await element(page)).toEqual(before);await page.locator('#redoBtn').tap();expect(await element(page)).toEqual(after);
 });

});
