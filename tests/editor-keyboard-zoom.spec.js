const {test,expect,openHome,createDocument}=require('./helpers');

// Observe the real cancelable key event before the app intercepts it in
// capture phase. The audit runs in a microtask after all key listeners.
async function auditZoomKeys(page){
 await page.addInitScript(()=>{
  window.zoomKeyAudit=[];
  window.addEventListener('keydown',event=>{
   if(!(event.ctrlKey||event.metaKey))return;
   const record={code:event.code,key:event.key,prevented:false};
   window.zoomKeyAudit.push(record);
   queueMicrotask(()=>{record.prevented=event.defaultPrevented});
  },{capture:true});
 });
}
async function pressZoom(page,key){
 const before=await page.evaluate(()=>window.zoomKeyAudit.length);
 await page.keyboard.press(key);
 await expect.poll(()=>page.evaluate(()=>window.zoomKeyAudit.length)).toBe(before+1);
 const latest=await page.evaluate(()=>window.zoomKeyAudit.at(-1));
 expect(latest.prevented, `${key} should cancel browser zoom`).toBe(true);
}
async function zoomPercent(page){
 return Number((await page.locator('#zoomLabel').textContent()).replace('%',''));
}

test('Ctrl+plus/minus and numpad shortcuts zoom the document, Ctrl+0 fits the canvas',async({page})=>{
 await auditZoomKeys(page);
 await openHome(page);
 await createDocument(page,'Keyboard zoom',320,240);
 await page.locator('#canvas').focus();
 const fitted=await zoomPercent(page);
 await pressZoom(page,'Control+Equal'); // Standard keyboard Ctrl+= (zoom in)
 expect(await zoomPercent(page)).toBeGreaterThan(fitted);
 const plus=await zoomPercent(page);
 await pressZoom(page,'Control+Shift+Equal'); // Ctrl++
 expect(await zoomPercent(page)).toBeGreaterThan(plus);
 const again=await zoomPercent(page);
 await pressZoom(page,'Control+Minus');
 expect(await zoomPercent(page)).toBeLessThan(again);
 const minus=await zoomPercent(page);
 await pressZoom(page,'Control+NumpadAdd');
 expect(await zoomPercent(page)).toBeGreaterThan(minus);
 const numPlus=await zoomPercent(page);
 await pressZoom(page,'Control+NumpadSubtract');
 expect(await zoomPercent(page)).toBeLessThan(numPlus);
 await pressZoom(page,'Control+Digit0');
 expect(await zoomPercent(page)).toBe(fitted);
 await pressZoom(page,'Control+Numpad0');
 expect(await zoomPercent(page)).toBe(fitted);
});

test('Ctrl+0 and Ctrl+plus/minus do not zoom the browser on the home screen',async({page})=>{
 await auditZoomKeys(page);
 await openHome(page);
 for(const key of ['Control+Equal','Control+Shift+Equal','Control+Minus','Control+Digit0']){
  await pressZoom(page,key);
  await expect(page.locator('#homeScreen')).toBeVisible();
 }
});

test('zoom shortcuts do not steal focus or change the canvas while a field is active',async({page})=>{
 await auditZoomKeys(page);
 await openHome(page);
 await createDocument(page,'Keyboard focus guard',320,240);
 const field=page.locator('#inspector input[data-doc="title"]');
 await expect(field).toBeVisible();
 await field.focus();
 const value=await field.inputValue(),before=await zoomPercent(page);
 for(const key of ['Control+Equal','Control+Minus','Control+Digit0']){
  await pressZoom(page,key);
  await expect(field).toBeFocused();
  expect(await field.inputValue()).toBe(value);
  expect(await zoomPercent(page)).toBe(before);
 }
 // Outside the field the same shortcuts work again.
 await page.locator('#canvas').focus();
 await pressZoom(page,'Control+Equal');
 expect(await zoomPercent(page)).toBeGreaterThan(before);
});

test('the zoom keyboard shortcuts work on card documents too',async({page})=>{
 await auditZoomKeys(page);
 await openHome(page);
 await createDocument(page,'Card keyboard zoom',320,240);
 await page.locator('#newCardBtn').click();
 await expect(page.locator('#typeChip')).toHaveText('КАРТОЧКА');
 await page.locator('#canvas').focus();
 const fitted=await zoomPercent(page);
 await pressZoom(page,'Control+Minus');
 expect(await zoomPercent(page)).toBeLessThan(fitted);
 await pressZoom(page,'Control+Digit0');
 expect(await zoomPercent(page)).toBe(fitted);
});
