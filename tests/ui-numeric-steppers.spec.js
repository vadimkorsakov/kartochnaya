const {test,expect,openHome,createDocument}=require('./helpers');

test.use({viewport:{width:1280,height:850}});

const stepButton=(input,direction)=>input.locator('xpath=..').locator('.k-num-step[data-num-direction="'+direction+'"]');

async function addShapeFromVisibleDock(page){
 await page.locator('#dockShapes').click();
 const shape=page.locator('#shapeTray [data-tray-shape]').first();
 await expect(shape).toBeVisible();
 await shape.click();
 await expect(page.locator('#inspector input[data-key="x"]')).toBeVisible();
}

test('all desktop number inputs get one custom control; existing keyboard and limits remain native',async({page})=>{
 await openHome(page);
 await expect.poll(()=>page.evaluate(()=>{
  const fields=[...document.querySelectorAll('input[type="number"]')].filter(el=>!el.closest('#mobilePropertyUI'));
  return fields.length>5&&fields.every(el=>el.parentElement.classList.contains('k-num-wrap')
   &&el.parentElement.querySelectorAll('.k-num-step').length===2);
 })).toBe(true);
 await page.locator('#createTemplateBtn').click();
 const width=page.locator('#newDocW');
 await expect(width).toBeVisible();
 const before=Number(await width.inputValue());
 await stepButton(width,'up').click();
 await expect(width).toHaveValue(String(before+1));
 await width.focus();
 await page.keyboard.press('ArrowUp');
 await expect(width).toHaveValue(String(before+2));
 await width.fill('5000');
 await stepButton(width,'up').click();
 await expect(width).toHaveValue('5000');
 await width.fill('100');
 await stepButton(width,'down').click();
 await expect(width).toHaveValue('100');
 // Manual edit still works; valid document sizes are honored.
 await width.fill('320');
 await page.locator('#newDocH').fill('240');
 await page.locator('#confirmNewDoc').click();
 await expect(page.locator('#sizeLabel')).toHaveText('320 × 240 px');
});

test('compact inspector number keeps its spacing and commits exactly as an ordinary value change',async({page})=>{
 await openHome(page);
 await createDocument(page,'Numeric inspector',500,400);
 await addShapeFromVisibleDock(page);
 const position=page.locator('#inspector input[data-key="x"]');
 await expect(position).toBeVisible();
 const before=Number(await position.inputValue());
 await stepButton(position,'up').click();
 await expect(position).toHaveValue(String(before+1));
 const metrics=await position.evaluate(el=>{
  const field=el.getBoundingClientRect(),buttons=el.parentElement.querySelector('.k-num-steps').getBoundingClientRect();
  return {inputRight:field.right,controlsRight:buttons.right,paddingRight:parseFloat(getComputedStyle(el).paddingRight)};
 });
 expect(metrics.inputRight-metrics.controlsRight).toBeGreaterThanOrEqual(2);
 expect(metrics.paddingRight).toBeGreaterThanOrEqual(30);
 await position.fill('65');
 await position.press('Enter');
 await expect(position).toHaveValue('65');
});

test('popover alpha number has the same chevrons and updates linked slider',async({page})=>{
 await openHome(page);
 await createDocument(page,'Numeric popover',500,400);
 await addShapeFromVisibleDock(page);
 await page.locator('#inspector [data-fill-open="fill"]').click();
 const alpha=page.locator('#cpAlphaInput');
 await expect(alpha).toBeVisible();
 const before=Number(await alpha.inputValue());
 expect(before).toBeGreaterThan(0);
 await stepButton(alpha,'down').click();
 await expect(alpha).toHaveValue(String(before-1));
 await expect(page.locator('#cpAlpha')).toHaveValue(String(before-1));
});
