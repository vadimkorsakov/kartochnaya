const {test,expect,openHome,importPayload,records,openLibraryDocument}=require('./helpers');
const fixture=require('./fixtures/canvas-graph.json');

test.use({viewport:{width:390,height:640},hasTouch:true,isMobile:true});

async function openSelectedTextAndFonts(page){
 await openHome(page);
 const payload=structuredClone(fixture);
 payload.documents=[payload.documents[0]];
 await importPayload(page,payload);
 await expect(page.locator('#toast')).toContainText('Импортировано проектов');
 const doc=(await records(page,'docs')).find(d=>d.elements.some(e=>e.id==='title'));
 expect(doc).toBeTruthy();
 await openLibraryDocument(page,doc.id);
 // Match the real mobile workflow: select the text layer through the layers sheet.
 await page.locator('[data-mobile=layers]:visible').tap();
 await page.locator('#mobileLayerList [data-layer="title"] .layer-name').tap();
 await page.locator('#mobileLayersClose').tap();
 await expect(page.locator('#mobileContext [data-mobile=font]')).toBeVisible();
 await page.locator('#mobileContext [data-mobile=font]').tap();
 await page.locator('#mobilePropertyUI [data-mp-action=expand]').tap();
 const list=page.locator('#mobilePropertyUI .mp-font-scroll');
 await expect(list).toBeVisible();
 await expect(list.locator('.mp-font-row')).toHaveCount(9);
 return list;
}
const top=list=>list.evaluate(el=>el.scrollTop);

test('font selection and variant changes preserve position of the mobile list',async({page})=>{
 const list=await openSelectedTextAndFonts(page);
 // Scroll to a font far enough down for an observable nonzero offset.
 const family='Courier New';
 const row=list.locator('[data-mp-font]').filter({hasText:family});
 await row.scrollIntoViewIfNeeded();
 expect(await top(list)).toBeGreaterThan(0);
 const beforeFamily=await top(list);
 await row.tap();
 await expect(list.locator('.mp-font-row.active')).toHaveAttribute('data-mp-font',family);
 await expect(list.locator('.mp-variant-inline')).toBeVisible();
 expect(Math.abs((await top(list))-beforeFamily)).toBeLessThanOrEqual(2);

 const bold=list.locator('[data-mp-variant="700:normal"]');
 await bold.scrollIntoViewIfNeeded();
 const beforeVariant=await top(list);
 expect(beforeVariant).toBeGreaterThan(0);
 await bold.tap();
 await expect(bold).toHaveClass(/active/);
 expect(Math.abs((await top(list))-beforeVariant)).toBeLessThanOrEqual(2);
});

test('changing the category and font search resets the mobile list scroll to its start',async({page})=>{
 const list=await openSelectedTextAndFonts(page);
 await list.evaluate(el=>{el.scrollTop=el.scrollHeight});
 expect(await top(list)).toBeGreaterThan(0);
 await page.locator('#mobilePropertyUI [data-mp-font-category]').selectOption('project');
 await expect(list.locator('.mp-font-row')).toHaveCount(1);
 expect(await top(list)).toBe(0);

 await page.locator('#mobilePropertyUI [data-mp-font-category]').selectOption('all');
 await expect(list.locator('.mp-font-row')).toHaveCount(9);
 expect(await top(list)).toBe(0);
 await list.evaluate(el=>{el.scrollTop=el.scrollHeight});
 expect(await top(list)).toBeGreaterThan(0);
 await page.locator('#mobilePropertyUI [data-mp-action=fontSearch]').tap();
 const search=page.locator('#mobilePropertyUI [data-mp-search=font]');
 await search.fill('Georgia');
 await expect(list.locator('.mp-font-row')).toHaveCount(1);
 await expect(list.locator('.mp-font-row')).toContainText('Georgia');
 expect(await top(list)).toBe(0);
});
