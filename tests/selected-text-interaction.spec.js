const {test,expect,exportPNG}=require('./helpers');
const {setup,model,selectWord,range,trace,editor}=require('./support/text-interaction');

for(const tool of ['font','color'])test(`real desktop word selection through ${tool} menu`,async({page},info)=>{
 try{
  const plain=await setup(page);await selectWord(page);
  if(tool==='font'){
   const selectionImage=await page.locator(editor).screenshot();
   await page.locator('#inspector [data-font-open]').click();
   await expect(page.locator(editor)).toBeFocused();expect(await range(page)).toEqual([0,6]);
   // Compare the native highlight before/after opening the menu, no PNG baseline.
   expect(await page.locator(editor).screenshot()).toEqual(selectionImage);
   const search=page.locator('#inspector [data-font-search]');await search.click();
   await search.press('Control+a');await search.pressSequentially('Georgia');
   await page.locator('#inspector [data-font-option="Georgia"]').click();
  }else{
   await page.locator('#inspector [data-fill-open=fill]').click();
   await expect(page.locator(editor)).toBeFocused();expect(await range(page)).toEqual([0,6]);
   await page.locator('#fillPopover [data-fill-palette="#ff0000"]').click();
  }
  await expect(page.locator(editor)).toBeFocused();expect(await range(page)).toEqual([0,6]);
  expect((await model(page)).textRuns).toEqual([{start:0,end:6,style:tool==='font'?{fontFamily:'Georgia'}:{textColor:'#ff0000'}}]);
  if(tool==='color')await page.locator('#fillPopover [data-fill-close]').click();
  // No .focus()/.click() repair before ending the session.
  await page.keyboard.press('Control+Enter');await expect(page.locator(editor)).toBeHidden();
  await expect.poll(()=>page.evaluate(tool=>window.textDraws.some(d=>d.text==='Привет'&&(tool==='font'?d.font.includes('Georgia'):d.color==='#ff0000')),tool)).toBe(true);
  const png=await exportPNG(page);expect(png.image.data.equals(plain)).toBe(false);
  if(tool==='color')expect(redPixels(png.image)).toBeGreaterThan(10);
 }finally{await trace(page,info)}
});

function redPixels(image){let n=0;for(let i=0;i<image.data.length;i+=4)if(image.data[i]===255&&image.data[i+1]===0&&image.data[i+2]===0)n++;return n}

async function keyboardWord(page){await page.keyboard.press('Control+Home');for(let i=0;i<6;i++)await page.keyboard.press('Shift+ArrowRight');expect(await range(page)).toEqual([0,6])}

test('keyboard selection, slow menu click, continued input, Undo/Redo and Escape',async({page},info)=>{
 try{
  await setup(page);const original=await model(page);await keyboardWord(page);
  await page.locator('#inspector [data-font-open]').click({delay:200});
  await page.locator('#inspector [data-font-option="Georgia"]').click();
  await expect(page.locator(editor)).toBeFocused();expect(await range(page)).toEqual([0,6]);
  await page.keyboard.press('Control+End');await page.keyboard.type('!');
  expect((await model(page)).text).toBe('Привет мир!');
  await page.keyboard.press('Control+z');expect((await model(page)).text).toBe('Привет мир');
  expect((await model(page)).textRuns).toEqual([{start:0,end:6,style:{fontFamily:'Georgia'}}]);
  await page.keyboard.press('Control+z');expect((await model(page)).textRuns).toBeUndefined();
  await page.keyboard.press('Control+Shift+z');expect((await model(page)).textRuns).toEqual([{start:0,end:6,style:{fontFamily:'Georgia'}}]);
  await page.keyboard.press('Escape');await expect(page.locator(editor)).toBeHidden();expect(await model(page)).toEqual(original);
 }finally{await trace(page,info)}
});

for(const selected of [true,false])test(`native numeric input and Enter return ${selected?'selected':'plain'} text focus`,async({page},info)=>{
 try{
  await setup(page);if(selected)await keyboardWord(page);
  const expected=selected?[0,6]:[10,10];
  const field=page.locator('#inspector input[data-key=fontSize]');await field.click();await expect(field).toBeFocused();
  await field.press('Control+a');await field.pressSequentially('28');await field.press('Enter');
  await expect(page.locator(editor)).toBeFocused();expect(await range(page)).toEqual(expected);
  const e=await model(page);expect(e.text).toBe('Привет мир');
  if(selected){expect(e.fontSize).toBe(20);expect(e.textRuns).toEqual([{start:0,end:6,style:{fontSize:28}}]);await page.keyboard.press('Control+z');expect((await model(page)).textRuns).toBeUndefined()}
  else{expect(e.fontSize).toBe(28);expect(e.textRuns).toBeUndefined()}
  await page.keyboard.press('Escape');
 }finally{await trace(page,info)}
});
