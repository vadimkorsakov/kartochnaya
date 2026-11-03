const {test,expect,openHome,importPayload,records,openLibraryDocument,exportedDocument}=require('./helpers');
const graph=require('./fixtures/canvas-graph.json');

async function openLayerFixture(page){
 await openHome(page);
 const payload=structuredClone(graph);
 payload.documents=[payload.documents[0]];
 await importPayload(page,payload);
 await expect(page.locator('#toast')).toContainText('Импортировано проектов');
 let id;
 await expect.poll(async()=>{
  const saved=(await records(page,'docs')).find(d=>d.title==='Graph template');
  id=saved?.id;return id;
 }).toBeTruthy();
 await openLibraryDocument(page,id);
 await expect(page.locator('#layers [data-layer="independent"]')).toBeVisible();
}
const independent=page=>page.locator('#layers [data-layer="independent"]');
const maskSource=async page=>(await exportedDocument(page)).elements.find(x=>x.id==='independent')?.layerMaskSrc||null;

test('desktop group and ordinary layer actions are hidden until hover or focus; text uses supplied icon',async({page})=>{
 await openLayerFixture(page);
 const group=page.locator('#layers .group-row[data-group-id="outer"]');
 const ordinary=independent(page);
 await page.mouse.move(0,0);
 for(const row of [group,ordinary]){
  const actions=row.locator(':scope > .layer-actions');
  await expect(actions).toHaveCSS('opacity','0');
  await row.hover();
  await expect(actions).toHaveCSS('opacity','1');
  await page.mouse.move(0,0);
  await expect(actions).toHaveCSS('opacity','0');
 }
 const button=ordinary.locator('[data-layeract="lock"]');
 await button.focus();
 await expect(ordinary.locator(':scope > .layer-actions')).toHaveCSS('opacity','1');

 for(const id of ['title','text-original']){
  const thumb=page.locator('#layers [data-layer="'+id+'"] .text-layer-thumb');
  await expect(thumb.locator('svg.text-layer-glyph')).toBeVisible();
  await expect(thumb.locator('img')).toHaveCount(0);
  expect(await thumb.locator('svg.text-layer-glyph path').getAttribute('d')).toContain('M224 160');
 }
 await expect(independent(page).locator('.layer-thumb img')).toHaveCount(1);
 await expect(independent(page).locator('[data-create-mask]')).toHaveCount(0);
});

test('mask is created from layer context, repeat-click never deletes it, right-click mask can delete',async({page})=>{
 await openLayerFixture(page);
 await independent(page).click({button:'right'});
 const create=page.locator('#contextCreateMask');
 await expect(create).toBeVisible();
 await expect(create).toHaveText(/Создать маску/);
 await create.click();
 await expect(independent(page).locator('[data-select-mask="independent"]')).toBeVisible();
 let src=await maskSource(page);
 expect(src).toMatch(/^data:image\/png;base64,/);

 for(let i=0;i<2;i++){
  await independent(page).locator('[data-select-mask="independent"]').click();
  expect(await maskSource(page),'mask persists through repeated thumbnail clicks').toBe(src);
  await expect(independent(page).locator('[data-select-mask="independent"]')).toBeVisible();
 }
 // Creation cannot be invoked again after the layer already has a mask.
 await independent(page).locator('.layer-name').click({button:'right'});
 await expect(create).toBeHidden();
 await page.locator('#contextMenu').press('Escape').catch(()=>{});
 // Only the mask thumbnail's own context menu may delete the mask.
 await independent(page).locator('[data-select-mask="independent"]').click({button:'right'});
 await expect(page.locator('#maskContextMenu')).toBeVisible();
 await expect(page.locator('#maskContextDelete')).toBeVisible();
 await page.locator('#maskContextDelete').click();
 expect(await maskSource(page)).toBeNull();
 await expect(independent(page).locator('[data-select-mask="independent"]')).toHaveCount(0);
 await independent(page).click({button:'right'});
 await expect(create).toBeVisible();
});

test.describe('mobile layer list',()=>{
 test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 test('text icon remains visible and mask actions cannot delete an existing mask',async({page})=>{
  await openLayerFixture(page);
  await page.locator('#mobileToolbars [data-mobile="layers"]:visible').tap();
  const text=page.locator('#mobileLayerList [data-layer="title"] .text-layer-thumb');
  await expect(text.locator('svg.text-layer-glyph')).toBeVisible();
  const row=page.locator('#mobileLayerList [data-layer="independent"]');
  const more=row.locator('[data-mobile-layer-menu]');
  await more.tap();
  let mask=page.locator('#mobileLayerActionMenu [data-mobile-layer-action="mask"]');
  await expect(mask).toContainText('Создать маску');
  await mask.tap();
  const before=await maskSource(page);
  expect(before).toMatch(/^data:image\/png;base64,/);
  await more.tap();
  mask=page.locator('#mobileLayerActionMenu [data-mobile-layer-action="mask"]');
  await expect(mask).toContainText('Редактировать маску');
  await expect(mask).not.toContainText('Удалить');
  await mask.tap();
  expect(await maskSource(page),'reopening mask edit must retain mask').toBe(before);
 });
});
