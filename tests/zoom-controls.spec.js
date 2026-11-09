const {test,expect,openHome,createDocument}=require('./helpers');

test.use({viewport:{width:1600,height:1000}});
async function enterZoom(page,value){
 await page.locator('#zoomLabel').click();
 await page.locator('#zoomInput').fill(String(value));
 await page.locator('#zoomInput').press('Enter');
}
async function expectZoom(page,percent,width=500){
 await expect(page.locator('#zoomLabel')).toHaveText(`${percent}%`);
 // Read the real canvas scale, not just the rounded label.
 expect(await page.locator('#canvas').evaluate((node,w)=>node.getBoundingClientRect().width/w,width)).toBeCloseTo(percent/100,8);
}
test.beforeEach(async({page})=>{
 await openHome(page);await createDocument(page,'Exact zoom',500,100);
});

test('Fit at 147% steps to 150% or 140%; arbitrary and exact values use the grid',async({page})=>{
 await page.locator('#stageScroller').evaluate(node=>node.style.maxWidth='803px');
 await page.locator('#fitBtn').click();await expectZoom(page,147);
 await page.locator('#zoomInBtn').click();await expectZoom(page,150);
 await page.locator('#fitBtn').click();await expectZoom(page,147);
 await page.locator('#zoomOutBtn').click();await expectZoom(page,140);
 for(const [value,button,result] of [[97,'In',100],[107,'Out',100],[100,'In',110],[100,'Out',90]]){
  await enterZoom(page,value);await page.locator(`#zoom${button}Btn`).click();await expectZoom(page,result);
 }
});

test('manual input applies exact values, restores focus, reopens with current scale and keeps Fit',async({page})=>{
 const fit=await page.locator('#zoomLabel').textContent();
 for(const value of [100,125]){
  await enterZoom(page,value);await expectZoom(page,value);
  await expect(page.locator('#zoomInput')).toBeHidden();
  await expect(page.locator('#zoomLabel')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#zoomInput')).toBeFocused();
  await expect(page.locator('#zoomInput')).toHaveValue(String(value));
  expect(await page.locator('#zoomInput').evaluate(n=>n.selectionEnd-n.selectionStart)).toBe(String(value).length);
  await page.keyboard.press('Escape');
 }
 await page.locator('#fitBtn').click();await expect(page.locator('#zoomLabel')).toHaveText(fit);
 await enterZoom(page,100);await page.keyboard.press('Control+Digit0');
 await expect(page.locator('#zoomLabel')).toHaveText(fit);
});

test('Escape, outside pointer and blur cancel; invalid input never changes zoom',async({page})=>{
 await enterZoom(page,125);
 await page.locator('#zoomLabel').click();await page.locator('#zoomInput').fill('100');
 await expectZoom(page,125);await page.keyboard.press('Escape');await expectZoom(page,125);
 await page.locator('#zoomLabel').click();await page.locator('#zoomInput').fill('100');
 await page.locator('#sizeLabel').click();await expect(page.locator('#zoomInput')).toBeHidden();await expectZoom(page,125);
 for(const value of ['', 'NaN','Infinity','3','801','125.5']){
  await page.locator('#zoomLabel').click();await page.locator('#zoomInput').fill(value);await page.keyboard.press('Enter');
  await expectZoom(page,125);await expect(page.locator('#zoomInput')).toHaveAttribute('aria-invalid','true');
  await page.keyboard.press('Escape');
 }
 await page.locator('#zoomLabel').click();await page.locator('#zoomInput').fill('100');await page.keyboard.press('Tab');
 await expect(page.locator('#zoomInput')).toBeHidden();await expectZoom(page,125);
});

test('keyboard and cursor anchored wheel share desktop grid; input guards remain active',async({page})=>{
 await enterZoom(page,107);await page.keyboard.press('Control+Minus');await expectZoom(page,100);
 await page.keyboard.press('Meta+Equal');await expectZoom(page,110);
 await enterZoom(page,147);
 const box=await page.locator('#canvas').boundingBox();const x=box.x+150,y=box.y+60;
 await page.mouse.move(x,y);await page.keyboard.down('Control');await page.mouse.wheel(0,-120);await page.keyboard.up('Control');
 await expect(page.locator('#zoomLabel')).toHaveText('150%');
 const after=await page.locator('#canvas').boundingBox();
 expect(Math.abs((x-box.x)/1.47-(x-after.x)/1.5)).toBeLessThan(1);
 expect(Math.abs((y-box.y)/1.47-(y-after.y)/1.5)).toBeLessThan(1);
 await page.locator('#zoomLabel').click();
 for(const key of ['Control+Equal','Control+Minus','Control+Digit0'])await page.keyboard.press(key);
 await expectZoom(page,150);await expect(page.locator('#zoomInput')).toBeFocused();
});

test('mobile keeps a compact control and a 3% step',async({page})=>{
 await page.setViewportSize({width:390,height:844});await enterZoom(page,100);
 await page.locator('#zoomInBtn').click();await expectZoom(page,103);
 await page.locator('#zoomOutBtn').click();await expectZoom(page,100);
 await page.locator('#zoomLabel').click();
 const box=await page.locator('#zoomInput').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);
 await page.keyboard.press('Escape');await page.locator('#fitBtn').click();
 await expect(page.locator('#zoomInput')).toBeHidden();
});

test('manual zoom and Fit retain multiple artboards',async({page})=>{
 await page.locator('#newCardBtn').click();await page.locator('#seriesSidebarAdd').click();await page.locator('#seriesCreateBlank').click();
 await expect(page.locator('.series-board')).toHaveCount(1);
 for(const percent of [100,125]){
  await enterZoom(page,percent);await expectZoom(page,percent);
  await expect(page.locator('.series-board')).toHaveCount(1);
 }
 await page.locator('#fitBtn').click();await expect(page.locator('.series-board')).toHaveCount(1);
 await expect(page.locator('#zoomInput')).toBeHidden();
});
