const {test,expect,exportPNG}=require('./helpers');
const {setup,model,range,trace,editor}=require('./support/text-interaction');
test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
async function touchWord(page){const b=await page.locator(editor).boundingBox();await page.touchscreen.tap(b.x+24,b.y+12);await page.touchscreen.tap(b.x+24,b.y+12);expect(await range(page)).toEqual([0,6])}

test('touch word selection then font, bold, color and Done paint Canvas/PNG',async({page},info)=>{
 try{
  await setup(page,true);await touchWord(page);
  await page.locator('#mobileContext [data-mobile=font]').tap();await page.locator('[data-mp-font="Georgia"]').first().tap();
  await expect(page.locator(editor)).toBeFocused();expect(await range(page)).toEqual([0,6]);
  await page.locator('#mobileContext [data-mobile=format]').tap();await page.locator('[data-mp-format=bold]').tap();
  await page.locator('#mobileContext [data-mobile=color]').tap();await page.locator('[data-mp-swatch="#ff0000"]').first().tap();
  await expect(page.locator(editor)).toBeFocused();expect(await range(page)).toEqual([0,6]);
  expect((await model(page)).textRuns).toEqual([{start:0,end:6,style:{fontFamily:'Georgia',fontWeight:'700',textColor:'#ff0000'}}]);
  // Base-style textarea is intentional until the separate WYSIWYG stage.
  await expect(page.locator(editor)).toHaveCSS('color','rgb(0, 0, 0)');
  await page.locator('#mobileConfirm').tap();await expect(page.locator(editor)).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>window.textDraws.some(d=>d.text==='Привет'&&d.color==='#ff0000'&&d.font.includes('Georgia')&&/700|bold/.test(d.font)))).toBe(true);
  const {image}=await exportPNG(page);let red=0;for(let i=0;i<image.data.length;i+=4)if(image.data[i]===255&&image.data[i+1]===0&&image.data[i+2]===0)red++;expect(red).toBeGreaterThan(10);
 }finally{await trace(page,info)}
});

for(const replay of [false,true])test(`touch numeric Enter restores selection${replay?' after platform event replay':''}`,async({page},info)=>{
 try{
  await setup(page,true);await touchWord(page);
  await page.locator('#mobileContext [data-mobile=size]').tap();
  const field=page.locator('#mobilePropertyUI input[type=number][data-mp-key=fontSize]');await field.tap();await expect(field).toBeFocused();
  if(replay){
   // Emulation cannot drive Android's OS handles/IME. Replay the relevant
   // boundary: the unfocused control reports a collapsed DOM selection while
   // document selectionchange/select arrive with the property field focused.
   await page.locator(editor).evaluate(el=>{el.setSelectionRange(el.value.length,el.value.length);document.dispatchEvent(new Event('selectionchange'));el.dispatchEvent(new Event('select'))});
  }
  await field.press('Control+a');await field.pressSequentially('28');await field.press('Enter');
  expect((await model(page)).textRuns).toEqual([{start:0,end:6,style:{fontSize:28}}]);expect((await model(page)).fontSize).toBe(20);
  await expect(page.locator(editor)).toBeFocused();expect(await range(page)).toEqual([0,6]);
  await page.locator('#mobileConfirm').tap();
 }finally{await trace(page,info)}
});
