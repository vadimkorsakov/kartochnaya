const {test,expect,openHome,createDocument,addShape,exportedDocument,records,importPayload}=require('./helpers');
const archive=require('./fixtures/project-with-folders.json');

test.use({viewport:{width:1360,height:900}});

test('new card dialog offers a current-project template picker and creates an independent card',async({page})=>{
 await openHome(page);
 await createDocument(page,'Source for home card',320,240);
 await addShape(page);
 const original=await exportedDocument(page);
 await page.locator('#documentTabsHome').click();
 await page.locator('[data-filter="card"]').click();
 await page.locator('#createTemplateBtn').click();
 await expect(page.locator('#createCardFromTemplateBtn')).toBeVisible();
 await page.locator('#createCardFromTemplateBtn').click();
 await expect(page.locator('#tabPickerDialog')).toBeVisible();
 await expect(page.locator('#tabPickerTitle')).toHaveText('Из шаблона');
 await expect(page.locator('[data-tab-picker-new-blank-card]')).toHaveCount(0);
 await expect(page.locator('[data-tab-picker-from-template]')).toHaveCount(1);
 await expect(page.locator('#tabPickerGrid')).toContainText('Source for home card');
 await page.locator('#tabPickerBack').click();
 await expect(page.locator('#sizeDialog')).toBeVisible();
 await expect(page.locator('#createCardFromTemplateBtn')).toBeVisible();
 await page.locator('#createCardFromTemplateBtn').click();
 await page.locator('[data-tab-picker-from-template]').click();
 await expect(page.locator('#typeChip')).toHaveText('КАРТОЧКА');
 const newCard=await exportedDocument(page);
 expect(newCard.id).not.toBe(original.id);
 expect(newCard.type).toBe('card');
 expect(newCard.projectId).toBe(original.projectId);
 expect(newCard.elements).toHaveLength(original.elements.length);
 expect(newCard.elements[0].id).not.toBe(original.elements[0].id);
 expect(newCard.elements[0]).toMatchObject({
  type:original.elements[0].type,x:original.elements[0].x,y:original.elements[0].y,
  w:original.elements[0].w,h:original.elements[0].h,fill:original.elements[0].fill
 });
 expect(newCard.slides).toHaveLength(1);
 await expect.poll(async()=> (await records(page,'docs')).find(x=>x.id===newCard.id)?.type).toBe('card');
 await page.locator('#documentTabsHome').click();
 await page.locator('[data-filter="template"]').click();
 await page.locator('#createTemplateBtn').click();
 await expect(page.locator('#createCardFromTemplateBtn')).toBeHidden();
});

test('resource folders render 2x2 previews, large footer actions and compact asset placement',async({page})=>{
 await openHome(page);
 const payload=structuredClone(archive);
 payload.project.resourceFolders.push({id:'nested-test-folder',name:'Nested images',parentId:'folder-original'});
 payload.project.resources.push({...payload.project.resources[0],id:'nested-test-image',name:'Nested image',folderId:'nested-test-folder'});
 await importPayload(page,payload);
 await expect.poll(async()=> (await records(page,'projects')).some(x=>x.name==='Known folder project (импорт)')).toBe(true);
 await page.locator('[data-filter="resource"]').click();
 const folder=page.locator('[data-folder-card="folder-original"]');
 await expect(folder).toBeVisible();
 await expect(folder).toHaveAttribute('data-preview-count','2');
 await expect(folder.locator('.folder-preview-cell')).toHaveCount(4);
 await expect(folder.locator('.folder-preview-cell img')).toHaveCount(2);
 const geometry=await folder.evaluate(el=>{
  const preview=el.querySelector('.resource-folder-preview').getBoundingClientRect();
  const title=el.querySelector('.folder-name').getBoundingClientRect();
  const actions=el.querySelector('.asset-folder-actions').getBoundingClientRect();
  const btn=el.querySelector('[data-folder-delete]').getBoundingClientRect();
  return {dw:Math.abs(preview.width-preview.height),titleRight:title.right,actionsLeft:actions.left,buttonWidth:btn.width};
 });
 expect(geometry.dw).toBeLessThan(2);
 expect(geometry.titleRight).toBeLessThanOrEqual(geometry.actionsLeft);
 expect(geometry.buttonWidth).toBeGreaterThanOrEqual(30);
 await expect(folder.locator('[data-folder-rename] svg')).toHaveCount(1);
 await expect(folder.locator('[data-folder-delete] svg')).toHaveCount(1);
 await folder.locator('[data-folder-open]').click();
 const card=page.locator('[data-assetid="resource-original"]');
 await expect(card).toBeVisible();
 const footer=await card.evaluate(el=>{
  const label=el.querySelector('.project-title').getBoundingClientRect();
  const select=el.querySelector('.resource-move').getBoundingClientRect();
  const actions=el.querySelector('.resource-card-footer .project-controls').getBoundingClientRect();
  return {nameBottom:label.bottom,selectTop:select.top,selectRight:select.right,actionsLeft:actions.left,
   selectWidth:select.width,cardWidth:el.getBoundingClientRect().width};
 });
 expect(footer.selectTop-footer.nameBottom).toBeGreaterThanOrEqual(7);
 expect(footer.selectRight).toBeLessThanOrEqual(footer.actionsLeft);
 expect(footer.selectWidth).toBeLessThan(footer.cardWidth);
});

test('resource creation moves into two stacked floating buttons, only on Resources',async({page})=>{
 await openHome(page);
 const fabs=page.locator('#resourceFabActions'),folder=page.locator('#resourceNewFolder'),upload=page.locator('#uploadResourcesBtn');
 await expect(fabs).toBeHidden();
 await page.locator('[data-filter="resource"]').click();
 await expect(fabs).toBeVisible();
 await expect(folder).toBeVisible();
 await expect(upload).toBeVisible();
 await expect(page.locator('#resourceControls #resourceNewFolder')).toHaveCount(0);
 const positions=await page.evaluate(()=>{
  const f=document.querySelector('#resourceNewFolder').getBoundingClientRect();
  const u=document.querySelector('#uploadResourcesBtn').getBoundingClientRect();
  return {gap:u.top-f.bottom,right:innerWidth-u.right,bottom:innerHeight-u.bottom};
 });
 expect(positions.gap).toBeGreaterThanOrEqual(8);
 expect(positions.right).toBeGreaterThanOrEqual(15);
 expect(positions.bottom).toBeGreaterThanOrEqual(15);
 page.once('dialog',dialog=>dialog.accept('Added via floating action'));
 await folder.click();
 await expect(page.locator('.resource-folder-card .folder-name')).toContainText('Added via floating action');
 await expect(page.locator('.resource-folder-card[data-preview-count="0"]')).toBeVisible();
 await page.locator('[data-filter="template"]').click();
 await expect(fabs).toBeHidden();
});
