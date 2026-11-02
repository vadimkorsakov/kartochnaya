const {test,expect,openHome,createDocument}=require('./helpers');

async function zoomPercent(page){
 return Number((await page.locator('#zoomLabel').textContent()).replace('%',''));
}

async function zoomOutRepeatedly(page,count=18){
 for(let i=0;i<count;i++)await page.locator('#zoomOutBtn').click();
}

test('desktop buttons, Ctrl+minus and wheel cannot shrink a normal card below 10 percent',async({page})=>{
 await openHome(page);
 await createDocument(page,'Zoom floor desktop',1080,1080);
 const fitted=await zoomPercent(page);
 expect(fitted).toBeGreaterThan(10);
 await zoomOutRepeatedly(page);
 expect(await zoomPercent(page)).toBe(10);
 await page.locator('#canvas').focus();
 await page.keyboard.press('Control+Minus');
 expect(await zoomPercent(page)).toBe(10);
 await page.locator('#stageScroller').hover();
 await page.keyboard.down('Control');
 try{await page.mouse.wheel(0,120)}finally{await page.keyboard.up('Control')}
 expect(await zoomPercent(page)).toBe(10);
 await page.locator('#zoomLabel').click();
 expect(await zoomPercent(page)).toBe(fitted);
});

test.describe('mobile viewport',()=>{
 test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});

 test('a normal card has the same 10 percent minimum and Fit restores its view',async({page})=>{
  await openHome(page);
  await createDocument(page,'Zoom floor mobile',1080,1080);
  const fitted=await zoomPercent(page);
  expect(fitted).toBeGreaterThan(10);
  await zoomOutRepeatedly(page);
  expect(await zoomPercent(page)).toBe(10);
  await page.locator('#zoomLabel').click();
  expect(await zoomPercent(page)).toBe(fitted);
 });

 test('a very large document can still fit below 10 percent',async({page})=>{
  await openHome(page);
  await createDocument(page,'Large document fit',5000,5000);
  const fitted=await zoomPercent(page);
  expect(fitted).toBeGreaterThanOrEqual(4);
  expect(fitted).toBeLessThan(10);
  await zoomOutRepeatedly(page,6);
  expect(await zoomPercent(page),'zoom-out must never jump above the fitted level').toBe(fitted);
  await page.locator('#zoomInBtn').click();
  expect(await zoomPercent(page)).toBeGreaterThan(fitted);
  await page.locator('#zoomLabel').click();
  expect(await zoomPercent(page)).toBe(fitted);
 });
});
