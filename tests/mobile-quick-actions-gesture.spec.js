const {test,expect,openHome,importPayload,records,openLibraryDocument,exportedDocument}=require('./helpers');
const graph=require('./fixtures/canvas-graph.json');

test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});

async function openSelectedShape(page){
 await openHome(page);
 const payload=structuredClone(graph);
 payload.documents=[payload.documents[0]];
 const doc=payload.documents[0];
 doc.groups=[];
 doc.elements=[{...doc.elements.find(e=>e.id==='independent'),x:85,y:70,w:125,h:95}];
 await importPayload(page,payload);
 await expect(page.locator('#toast')).toContainText('Импортировано проектов');
 const stored=(await records(page,'docs')).find(d=>d.title==='Graph template');
 expect(stored).toBeTruthy();
 await openLibraryDocument(page,stored.id);
 await page.locator('#mobileToolbars [data-mobile="layers"]:visible').tap();
 await page.locator('#mobileLayerList [data-layer="independent"] .layer-name').tap();
 await page.locator('#mobileLayersClose').tap();
 await expect(page.locator('#quickBubble')).toBeVisible();
 return {bubble:page.locator('#quickBubble'),doc:await exportedDocument(page)};
}
async function selectedCenter(page,element){
 return page.locator('#canvas').evaluate((canvas,e)=>{
  const r=canvas.getBoundingClientRect();
  return {x:r.left+(e.x+e.w/2)*r.width/320,y:r.top+(e.y+e.h/2)*r.height/240};
 },element);
}
async function touch(page,point){
 const session=await page.context().newCDPSession(page);
 const send=(type,points)=>session.send('Input.dispatchTouchEvent',{type,touchPoints:points});
 const start={...point,id:1};
 await send('touchStart',[start]);
 return {
  move:async(dx,dy)=>send('touchMove',[{...start,x:start.x+dx,y:start.y+dy}]),
  end:async()=>send('touchEnd',[]),
  cancel:async()=>send('touchCancel',[]),
  close:async()=>session.detach(),
 };
}

test('quick actions stay hidden through mobile drag and return after release',async({page})=>{
 const {bubble,doc}=await openSelectedShape(page);
 const before=doc.elements[0],at=await selectedCenter(page,before);
 const gesture=await touch(page,at);
 await expect(bubble).toBeHidden();
 await gesture.move(35,25);
 await expect(bubble).toBeHidden();
 await gesture.end();
 await expect(bubble).toBeVisible();
 await gesture.close();
 const after=(await exportedDocument(page)).elements[0];
 expect(after.x).toBeGreaterThan(before.x);
 expect(after.y).toBeGreaterThan(before.y);
 await expect(page.locator('#quickBubble [data-quick="duplicate"]')).toBeVisible();
});

test('a short tap or canceled touch restores actions without changing the document',async({page})=>{
 const {bubble,doc}=await openSelectedShape(page);
 const at=await selectedCenter(page,doc.elements[0]);
 let gesture=await touch(page,at);
 await expect(bubble).toBeHidden();
 await gesture.end();
 await expect(bubble).toBeVisible();
 await gesture.close();

 gesture=await touch(page,at);
 await expect(bubble).toBeHidden();
 await gesture.cancel();
 await expect(bubble).toBeVisible();
 await gesture.close();
 expect((await exportedDocument(page)).elements).toEqual(doc.elements);
});

test('mobile floating action remains usable when no canvas gesture is active',async({page})=>{
 const {bubble,doc}=await openSelectedShape(page);
 await bubble.locator('[data-quick="duplicate"]').tap();
 await expect.poll(async()=>(await exportedDocument(page)).elements.length).toBe(doc.elements.length+1);
 await expect(bubble).toBeVisible();
});
