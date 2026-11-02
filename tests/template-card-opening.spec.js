const {test,expect,openHome,createDocument,addShape,exportedDocument,records,openLibraryDocument}=require('./helpers');

test('editor creates an independent card and activates its new tab while retaining the template',async({page})=>{
 await openHome(page);
 await createDocument(page,'Template to card',320,240);
 await addShape(page);
 const template=await exportedDocument(page);
 expect(template.type).toBe('template');
 expect(template.elements).toHaveLength(1);
 await expect(page.locator('#newCardBtn')).toBeVisible();
 await page.locator('#newCardBtn').click();

 await expect(page.locator('#typeChip')).toHaveText('КАРТОЧКА');
 await expect(page.locator('#documentTabsScroll .document-tab')).toHaveCount(2);
 const card=await exportedDocument(page);
 expect(card.id).not.toBe(template.id);
 expect(card.type).toBe('card');
 expect(card.elements).toHaveLength(1);
 expect(card.slides).toHaveLength(1);
 await expect(page.locator(`[data-tab-id="${card.id}"]`)).toHaveClass(/active/);
 await expect(page.locator(`[data-tab-id="${template.id}"]`)).toBeVisible();

 await addShape(page);
 expect((await exportedDocument(page)).elements).toHaveLength(2);
 await page.locator(`[data-tab-id="${template.id}"]`).click();
 await expect(page.locator('#typeChip')).toHaveText('ШАБЛОН');
 expect((await exportedDocument(page)).elements).toHaveLength(1);
 await page.locator(`[data-tab-id="${card.id}"]`).click();
 expect((await exportedDocument(page)).elements).toHaveLength(2);

 await expect.poll(async()=> (await records(page,'docs')).find(d=>d.id===card.id)?.elements.length).toBe(2);
 await page.reload();
 await expect(page.locator('#homeScreen')).toBeVisible();
 await openLibraryDocument(page,card.id);
 const reopened=await exportedDocument(page);
 expect(reopened.id).toBe(card.id);
 expect(reopened.type).toBe('card');
 expect(reopened.elements).toHaveLength(2);
});

test('the inspector create-card action also opens the new document tab',async({page})=>{
 await openHome(page);
 await createDocument(page,'Inspector template',320,240);
 const source=await exportedDocument(page);
 await expect(page.locator('#inspector [data-action="makeCard"]')).toBeVisible();
 await page.locator('#inspector [data-action="makeCard"]').click();
 await expect(page.locator('#typeChip')).toHaveText('КАРТОЧКА');
 const created=await exportedDocument(page);
 expect(created.type).toBe('card');
 expect(created.id).not.toBe(source.id);
 expect(created.projectId).toBe(source.projectId);
 await expect(page.locator(`[data-tab-id="${created.id}"]`)).toHaveClass(/active/);
 await expect(page.locator(`[data-tab-id="${source.id}"]`)).toBeVisible();
});

test('creating a card from the home library does not force navigation into the editor',async({page})=>{
 await openHome(page);
 await createDocument(page,'Library template',320,240);
 const template=await exportedDocument(page);
 await page.locator('#documentTabsHome').click();
 await expect(page.locator('#homeScreen')).toBeVisible();
 await page.locator(`[data-docid="${template.id}"] [data-projectact="card"]`).click();
 await expect(page.locator('#homeScreen')).toBeVisible();
 await expect(page.locator(`[data-tab-id="${template.id}"]`)).toBeVisible();
 await expect(page.locator('#documentTabsScroll .document-tab')).toHaveCount(1);
 await expect.poll(async()=> (await records(page,'docs')).filter(d=>d.type==='card'&&d.projectId===template.projectId).length).toBe(1);
});
