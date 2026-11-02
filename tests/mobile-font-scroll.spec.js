const {test,expect,openHome,createDocument,createText}=require('./helpers');

async function mobileFontList(page){
 await page.setViewportSize({width:390,height:540});
 await expect(page.locator('#mobileContext [data-mobile="font"]')).toBeVisible();
 await page.locator('#mobileContext [data-mobile="font"]').click();
 await page.locator('#mobilePropertyUI [data-mp-action="expand"]').click();
 const list=page.locator('#mobilePropertyUI .mp-font-scroll');
 await expect(list).toBeVisible();
 return list;
}

async function scrollTop(list){return list.evaluate(el=>el.scrollTop)}

test('mobile font list keeps its scroll position when choosing a family and its variant',async({page})=>{
 await openHome(page);
 await createDocument(page,'Mobile font scroll');
 await createText(page,'Пример шрифта');
 const list=await mobileFontList(page);
 await expect(list.locator('.mp-font-row')).toHaveCount(9);
 const row=list.locator('.mp-font-row').nth(7);
 await row.scrollIntoViewIfNeeded();
 const beforeFamily=await scrollTop(list);
 expect(beforeFamily,'a compact mobile sheet must have a scrollable font list').toBeGreaterThan(0);
 const family=await row.getAttribute('data-mp-font');
 await row.click();
 await expect(list.locator('.mp-font-row.active')).toHaveAttribute('data-mp-font',family);
 expect(Math.abs((await scrollTop(list))-beforeFamily)).toBeLessThanOrEqual(1);

 const bold=list.locator('.mp-variant-inline [data-mp-variant="700:normal"]');
 await bold.scrollIntoViewIfNeeded();
 const beforeVariant=await scrollTop(list);
 expect(beforeVariant).toBeGreaterThan(0);
 await bold.click();
 await expect(list.locator('.mp-variant-inline [data-mp-variant="700:normal"]')).toHaveClass(/active/);
 expect(Math.abs((await scrollTop(list))-beforeVariant)).toBeLessThanOrEqual(1);
});

test('mobile font list starts at the top when changing category or search query',async({page})=>{
 await openHome(page);
 await createDocument(page,'Mobile font filter');
 await createText(page,'Проверка списка');
 const list=await mobileFontList(page);
 await list.evaluate(el=>{el.scrollTop=el.scrollHeight});
 expect(await scrollTop(list)).toBeGreaterThan(0);
 await page.locator('#mobilePropertyUI [data-mp-font-category]').selectOption('project');
 await expect(list.locator('.mp-font-row')).toHaveCount(1);
 expect(await scrollTop(list)).toBe(0);

 await page.locator('#mobilePropertyUI [data-mp-font-category]').selectOption('all');
 await expect(list.locator('.mp-font-row')).toHaveCount(9);
 expect(await scrollTop(list)).toBe(0);
 await list.evaluate(el=>{el.scrollTop=el.scrollHeight});
 expect(await scrollTop(list)).toBeGreaterThan(0);
 await page.locator('#mobilePropertyUI [data-mp-action="fontSearch"]').click();
 const search=page.locator('#mobilePropertyUI [data-mp-search="font"]');
 await search.fill('Georgia');
 await expect(list.locator('.mp-font-row')).toHaveCount(1);
 await expect(list.locator('.mp-font-row')).toContainText('Georgia');
 expect(await scrollTop(list)).toBe(0);
});
