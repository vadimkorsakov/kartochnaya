const {test,expect,openHome,importPayload,records,openLibraryDocument,exportedDocument,exportPNG,canvasPoint,createDocument}=require('./helpers');
const fixture=require('./fixtures/canvas-graph.json');
const originalRuns=[{start:0,end:5,style:{fontWeight:'700'}},{start:6,end:11,style:{textColor:'#ff0000',fontSize:32}}];
const element=doc=>doc.elements.find(e=>e.id==='title');
async function seed(page,formatted=true,repeated=false){
  await openHome(page);const payload=structuredClone(fixture);payload.documents=[payload.documents[0]];
  const doc=payload.documents[0];doc.elements=doc.elements.filter(e=>e.id==='title');doc.groups=[];
  if(formatted)doc.elements[0].textRuns=structuredClone(originalRuns);if(repeated){doc.elements[0].text='aaaa';doc.elements[0].textRuns=[{start:1,end:3,style:{bold:true}}]}
  await importPayload(page,payload);await expect(page.locator('#toast')).toContainText('Импортировано проектов');
  const stored=(await records(page,'docs')).find(d=>d.elements.some(e=>e.id==='title'));await openLibraryDocument(page,stored.id);return stored;
}
async function edit(page,mobile){
  if(mobile){await page.locator('[data-mobile=layers]:visible').tap();await page.locator('#mobileLayerList [data-layer="title"] .layer-name').tap();await page.locator('#mobileLayersClose').tap();await page.locator('#mobileContext [data-mobile=edit]').tap();}
  else {const p=await canvasPoint(page,100,175);await page.mouse.dblclick(p.x,p.y);}
  await expect(page.locator('#inlineText')).toBeFocused();
}
for(const mobile of [false,true])test.describe(mobile?'rich text Android textarea':'rich text desktop textarea',()=>{
  test.use(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{});
  test('edit, history, independent duplicate, save/reload and document tab switch retain formatting',async({page})=>{
    const initial=await seed(page);await edit(page,mobile);
    await page.locator('#inlineText').evaluate(el=>el.setSelectionRange(2,2));await page.keyboard.insertText('😀');
    // An IME can emit input without beforeinput; exercise the shared fallback too.
    await page.locator('#inlineText').evaluate(el=>{el.value+='!';el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',isComposing:true}));});
    if(mobile)await page.locator('#mobileConfirm').tap();else await page.locator('#inlineText').press('ControlOrMeta+Enter');
    const changed=element(await exportedDocument(page));expect(changed.text).toBe('Gr😀aph title!');
    expect(changed.textRuns).toEqual([{start:0,end:7,style:{fontWeight:'700'}},{start:8,end:14,style:{fontSize:32,textColor:'#ff0000'}}]);
    await page.locator('#undoBtn').click();expect(element(await exportedDocument(page)).textRuns).toEqual(originalRuns);
    await page.locator('#redoBtn').click();expect(element(await exportedDocument(page))).toEqual(changed);
    if(!mobile){await page.locator('#layers [data-layer="title"] .layer-name').click();await page.keyboard.press('Control+d');const copies=(await exportedDocument(page)).elements;expect(copies).toHaveLength(2);expect(copies[1].textRuns).toEqual(changed.textRuns);}
    await page.locator('#documentTabsHome').click();await createDocument(page,'Second tab');
    if(mobile){await page.locator('#documentTabsMenuToggle').tap();await page.locator(`[data-mobile-tab-id="${initial.id}"] [data-mobile-tab-activate]`).tap()}else await page.locator(`[data-tab-id="${initial.id}"]`).click();
    expect(element(await exportedDocument(page))).toEqual(changed);
    await expect.poll(async()=>element((await records(page,'docs')).find(d=>d.id===initial.id))).toEqual(changed);
    await page.reload();await expect(page.locator('#homeScreen')).toBeVisible();await openLibraryDocument(page,initial.id);expect(element(await exportedDocument(page))).toEqual(changed);
  });
  test('native textarea undo/redo restores formatting after deleting all text',async({page})=>{
    await seed(page);await edit(page,mobile);await page.locator('#inlineText').evaluate(el=>el.select());await page.keyboard.press('Backspace');
    await page.keyboard.press('Control+z');await expect(page.locator('#inlineText')).toHaveValue('Graph title');
    expect(element(await exportedDocument(page)).textRuns).toEqual(originalRuns);
    await page.keyboard.press('Control+Shift+z');await expect(page.locator('#inlineText')).toHaveValue('');expect(element(await exportedDocument(page)).textRuns).toBeUndefined();
    await page.keyboard.press('Control+z');
    if(mobile)await page.locator('#mobileConfirm').tap();else await page.locator('#inlineText').press('ControlOrMeta+Enter');
    expect(element(await exportedDocument(page)).textRuns).toEqual(originalRuns);
  });
  test('Backspace in repeated text uses the pre-input caret',async({page})=>{
    await seed(page,true,true);await edit(page,mobile);await page.locator('#inlineText').evaluate(el=>el.setSelectionRange(2,2));await page.keyboard.press('Backspace');
    if(mobile)await page.locator('#mobileConfirm').tap();else await page.locator('#inlineText').press('ControlOrMeta+Enter');
    const e=element(await exportedDocument(page));expect(e.text).toBe('aaa');expect(e.textRuns).toEqual([{start:1,end:2,style:{bold:true}}]);
  });
});
test('desktop cancel restores the exact original ranges',async({page})=>{
  await seed(page);await edit(page,false);await page.locator('#inlineText').fill('Замена 😀');await page.locator('#inlineText').press('Escape');
  const e=element(await exportedDocument(page));expect(e.text).toBe('Graph title');expect(e.textRuns).toEqual(originalRuns);
});
test('range metadata leaves Canvas and PNG unchanged',async({page})=>{
  await seed(page);const formatted=(await exportPNG(page)).image.data;
  await page.locator('#documentTabsHome').click();
  const d=structuredClone(fixture.documents[0]);d.id='plain-doc';d.title='Plain rendering';d.elements=d.elements.filter(e=>e.id==='title');d.groups=[];
  await importPayload(page,{format:'kartochnaya-v1',document:d});
  let stored;await expect.poll(async()=>{stored=(await records(page,'docs')).find(d=>d.title==='Plain rendering (импорт)');return stored?.id}).toBeTruthy();await openLibraryDocument(page,stored.id);
  expect((await exportPNG(page)).image.data.equals(formatted)).toBe(true);
});
