const {test,expect,openHome,importPayload,records,openLibraryDocument,exportedDocument}=require('./helpers');
const graph=require('./fixtures/canvas-graph.json');

test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});

async function openLayer(page,text=false){
 await openHome(page);
 const payload=structuredClone(graph);payload.documents=[payload.documents[0]];
 if(!text){
  payload.documents[0].groups=[];
  payload.documents[0].elements=[{...payload.documents[0].elements[3],id:'independent',x:40,y:40,w:160,h:120}];
 }
 await importPayload(page,payload);
 await expect(page.locator('#toast')).toContainText('Импортировано проектов');
 let doc;
 await expect.poll(async()=>{
  doc=(await records(page,'docs')).find(d=>d.title==='Graph template');return doc?.id;
 }).toBeTruthy();
 await openLibraryDocument(page,doc.id);
 await page.locator('#mobileToolbars [data-mobile="layers"]:visible').tap();
 await page.locator('#mobileLayerList [data-layer="'+(text?'title':'independent')+'"] .layer-name').tap();
 await page.locator('#mobileLayersClose').tap();
 const effects=page.locator('#mobileContext [data-mobile="effects"]');
 await effects.scrollIntoViewIfNeeded();await effects.tap();
}
async function openEffect(page,type){
 const tile=page.locator('#mobilePropertyUI [data-mp-effect="'+type+'"]');
 await expect(tile).toBeVisible();
 await tile.tap(); await tile.tap();
 await expect(page.locator('#mobilePropertyUI [data-mp-effect-color="'+type+'"]')).toHaveCount(1);
 await expect(page.locator('#mobilePropertyUI [data-unified-color]')).toBeVisible();
}
async function layer(page,text=false){
 const id=text?'title':'independent';
 return (await exportedDocument(page)).elements.find(e=>e.id===id);
}
async function pickBySharedColorEditor(page,type,expectedProperty,text=false){
 const trigger=page.locator('#mobilePropertyUI [data-mp-effect-color="'+type+'"] + [data-unified-color]');
 await trigger.tap();
 const popup=page.locator('#fillPopover');
 await expect(popup).toBeVisible();
 await expect(popup).toHaveAttribute('data-key','_effect');
 await expect(popup).toHaveAttribute('data-effect-type',type);
 const old=await layer(page,text);
 const previous=expectedProperty==='fx'?old.effects.find(f=>f.type===type).color:old[expectedProperty];
 await page.locator('#cpSquare').tap({position:{x:30,y:135}});
 await expect.poll(async()=>{
  const current=await layer(page,text);
  return expectedProperty==='fx'?current.effects.find(f=>f.type===type).color:current[expectedProperty];
 }).not.toBe(previous);
 const sample=page.locator('#mobilePropertyUI [data-mp-effect-color="'+type+'"] + [data-unified-color]');
 const sampleColor=await sample.evaluate(el=>getComputedStyle(el).backgroundColor);
 expect(sampleColor).not.toBe('');
 // Typing a HEX value must commit it to the SAME effect, not to the layer fill.
 const field=popup.locator('[data-cp-part="0"]');
 await field.fill('#22BB88');await field.press('Tab');
 const value=()=>layer(page,text).then(e=>expectedProperty==='fx'?e.effects.find(f=>f.type===type).color:e[expectedProperty]);
 await expect.poll(async()=>(await value()).toLowerCase()).toBe('#22bb88');
 await expect(field).toHaveValue(/22BB88/i);
 await popup.locator('[data-fill-close]').tap();
 await expect(popup).toBeHidden();
 return value();
}
for(const [type,property] of [['glow','mobileGlowColor'],['outline','stroke'],['background','mobileBackgroundColor']]){
 test('mobile '+type+' color changes through unified picker and persists in the correct property',async({page})=>{
  await openLayer(page,false);
  await openEffect(page,type);
  const before=await layer(page);
  await pickBySharedColorEditor(page,type,property);
  const after=await layer(page);
  expect(after[property].toLowerCase()).toBe('#22bb88');
  if(type!=='outline')expect(after.fill).toBe(before.fill);
  await page.locator('#mobilePropertyUI [data-unified-color]').tap();
  await expect(page.locator('#fillPopover [data-cp-part="0"]')).toHaveValue(/22BB88/i);
  await page.locator('#fillPopover [data-fill-close]').tap();
 });
}

test('mobile textGlow with effect ID edits its own color instead of layer fill',async({page})=>{
 await openLayer(page,true);
 await openEffect(page,'textGlow');
 const before=await layer(page,true);
 await pickBySharedColorEditor(page,'textGlow','fx',true);
 const after=await layer(page,true);
 expect(after.effects.find(f=>f.type==='textGlow').color.toLowerCase()).toBe('#22bb88');
 expect(after.fill).toBe(before.fill);
});

test('mobile effect HEX editor uses the same legacy glow color as the shared picker',async({page})=>{
 await openLayer(page,false);
 await openEffect(page,'glow');
 const hex=page.locator('#mobilePropertyUI [data-mp-fx-pick="glow"]');
 await hex.tap();
 const editor=page.locator('#mobilePropertyUI [data-mp-plane]');
 await expect(editor).toBeVisible();
 // On short mobile viewports the color plane is clipped to its visible area.
 // Tap inside that visible area instead of at a fixed 125px offset below it.
 await editor.tap({position:{x:25,y:25}});
 await expect.poll(async()=> (await layer(page)).mobileGlowColor.toLowerCase()).not.toBe('#7857de');
 const setHex=page.locator('#mobilePropertyUI [data-mp-hex]');
 await setHex.fill('#14AABB');
 await setHex.press('Tab');
 await expect.poll(async()=> (await layer(page)).mobileGlowColor.toLowerCase()).toBe('#14aabb');
});
