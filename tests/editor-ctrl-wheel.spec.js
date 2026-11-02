const {test,expect,openHome,createDocument}=require('./helpers');

async function wheelAt(page,selector,deltaY,control=true){
 await page.locator(selector).hover();
 if(control)await page.keyboard.down('Control');
 try{await page.mouse.wheel(0,deltaY)}finally{if(control)await page.keyboard.up('Control')}
}

test('Ctrl+wheel on home workspace cancels browser zoom, plain wheel remains native',async({page})=>{
 await openHome(page);
 await page.evaluate(()=>{
  window.wheelAudit=[];
  document.addEventListener('wheel',ev=>{
   wheelAudit.push({ctrl:ev.ctrlKey,defaultPrevented:ev.defaultPrevented,target:ev.target.id});
  },{passive:true});
 });
 for(const area of ['#projectGrid','#createTemplateBtn','#documentTabsHome']){
  const count=await page.evaluate(()=>wheelAudit.length);
  await wheelAt(page,area,-120);
  await expect.poll(()=>page.evaluate(()=>wheelAudit.length)).toBe(count+1);
  const event=await page.evaluate(()=>wheelAudit.at(-1));
  expect(event.ctrl,area).toBe(true);
  expect(event.defaultPrevented,area).toBe(true);
  await expect(page.locator('#homeScreen')).toBeVisible();
 }
 const count=await page.evaluate(()=>wheelAudit.length);
 await wheelAt(page,'#projectGrid',120,false);
 await expect.poll(()=>page.evaluate(()=>wheelAudit.length)).toBe(count+1);
 expect((await page.evaluate(()=>wheelAudit.at(-1))).defaultPrevented).toBe(false);
});

test('Ctrl+wheel over editor panels cancels browser zoom without zooming the canvas',async({page})=>{
 await openHome(page);
 await createDocument(page,'Ctrl wheel panels',320,240);
 await page.evaluate(()=>{
  window.wheelAudit=[];
  document.addEventListener('wheel',ev=>{
   wheelAudit.push({ctrl:ev.ctrlKey,defaultPrevented:ev.defaultPrevented,target:ev.target.id});
  },{passive:true});
 });
 const zoom=await page.locator('#zoomLabel').textContent();
 for(const panel of ['#inspector','#layers','#libraryBtn']){
  const before=await page.evaluate(()=>wheelAudit.length);
  await wheelAt(page,panel,-120);
  await expect.poll(()=>page.evaluate(()=>wheelAudit.length)).toBe(before+1);
  const event=await page.evaluate(()=>wheelAudit.at(-1));
  expect(event.ctrl,panel).toBe(true);
  expect(event.defaultPrevented,panel).toBe(true);
  expect(await page.locator('#zoomLabel').textContent()).toBe(zoom);
 }
 // Ordinary unmodified wheel events must retain native scrolling behavior.
 const before=await page.evaluate(()=>wheelAudit.length);
 await wheelAt(page,'#inspector',120,false);
 await expect.poll(()=>page.evaluate(()=>wheelAudit.length)).toBe(before+1);
 expect((await page.evaluate(()=>wheelAudit.at(-1))).defaultPrevented).toBe(false);
});

test('Ctrl+wheel over stage still zooms the document, not the browser',async({page})=>{
 await openHome(page);
 await createDocument(page,'Ctrl wheel stage',320,240);
 await page.evaluate(()=>{
  window.wheelAudit=[];
  document.addEventListener('wheel',ev=>{
   wheelAudit.push({ctrl:ev.ctrlKey,defaultPrevented:ev.defaultPrevented});
  },{passive:true});
 });
 const before=await page.locator('#zoomLabel').textContent();
 await wheelAt(page,'#stageScroller',-120);
 await expect.poll(()=>page.locator('#zoomLabel').textContent()).not.toBe(before);
 expect(await page.evaluate(()=>wheelAudit.at(-1))).toMatchObject({ctrl:true,defaultPrevented:true});
});
