const {test,expect,openHome,importPayload,records,openLibraryDocument}=require('./helpers');
const fixture=require('./fixtures/canvas-graph.json');

test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});

async function openTemplate(page,selectShape=true){
 await openHome(page);
 const payload=structuredClone(fixture);
 payload.documents=[payload.documents[0]];
 await importPayload(page,payload);
 await expect(page.locator('#toast')).toContainText('Импортировано проектов');
 const doc=(await records(page,'docs')).find(d=>d.title==='Graph template');
 expect(doc).toBeTruthy();
 await openLibraryDocument(page,doc.id);
 if(selectShape){
  await page.locator('#mobileToolbars [data-mobile="layers"]:visible').tap();
  await page.locator('#mobileLayerList [data-layer="independent"] .layer-name').tap();
  await page.locator('#mobileLayersClose').tap();
 }
}

async function expectFlushWithToolbar(page,selector,margin=5){
 const geometry=await page.evaluate(selector=>{
  const sheet=document.querySelector(selector);
  const toolbar=document.querySelector('#mobileToolbars');
  const a=sheet.getBoundingClientRect(),b=toolbar.getBoundingClientRect();
  return {sheetTop:a.top,sheetBottom:a.bottom,toolbarTop:b.top,
   viewportTop:visualViewport?.offsetTop||0,height:a.height};
 },selector);
 expect(geometry.height,'drawer needs a nonzero height').toBeGreaterThan(40);
 expect(Math.abs(geometry.sheetBottom-geometry.toolbarTop),
  `drawer bottom ${geometry.sheetBottom} must align with toolbar top ${geometry.toolbarTop}`).toBeLessThanOrEqual(margin);
 expect(geometry.sheetTop).toBeGreaterThanOrEqual(geometry.viewportTop-2);
}

test('shape property sheets remain above mobile toolbar for stroke, position, color and more',async({page})=>{
 await openTemplate(page);
 const dockTop=await page.locator('#mobileToolbars').evaluate(el=>el.getBoundingClientRect().top);
 for(const action of ['stroke','position','color','more']){
  const tool=page.locator(`#mobileContext [data-mobile="${action}"]`);
  await tool.scrollIntoViewIfNeeded();
  await tool.tap();
  if(action==='color')await page.locator('#mobilePropertyUI [data-mp-action="expand"]').tap();
  const sheet=page.locator('#mobilePropertyUI .mp-sheet');
  await expect(sheet).toBeVisible();
  await expect(page.locator('#mobileToolbars')).toBeVisible();
  await expectFlushWithToolbar(page,'#mobilePropertyUI .mp-sheet');
  const currentDockTop=await page.locator('#mobileToolbars').evaluate(el=>el.getBoundingClientRect().top);
  expect(Math.abs(currentDockTop-dockTop),'opening properties must not move the bottom toolbar').toBeLessThanOrEqual(2);
  await sheet.locator('[data-mp-action="done"]').tap();
 }
});

test('boundary text action is part of the scrolling More menu, not a fixed overlay',async({page})=>{
 await openTemplate(page);
 const button=page.locator('#mobileContext [data-mobile="more"]');
 await button.scrollIntoViewIfNeeded();await button.tap();
 const action=page.locator('#mobilePropertyUI .mp-body button').filter({hasText:'Текст вдоль границ'});
 await expect(action).toHaveCount(1);
 await action.scrollIntoViewIfNeeded();
 await expect(action).toBeVisible();
 await expectFlushWithToolbar(page,'#mobilePropertyUI .mp-sheet');
 const inside=await action.evaluate(el=>el.parentElement?.classList.contains('mp-body'));
 expect(inside).toBe(true);
});

test('shape catalogue is flush with the bottom tool dock',async({page})=>{
 await openTemplate(page,false);
 await page.locator('[data-mobile="shapes"]:visible').tap();
 await expect(page.locator('#shapeTray')).toBeVisible();
 await expectFlushWithToolbar(page,'#shapeTray',6);
});
