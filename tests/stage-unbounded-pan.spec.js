const {test,expect,openHome,createDocument}=require('./helpers');

test.use({viewport:{width:1360,height:900}});

// The test uses the public hand tool and real pointer movements; no app state
// is mutated directly. Canvas must stay draggable even once entirely offscreen.
async function stageGeometry(page){
 return page.evaluate(()=>{
  const stage=document.querySelector('#stageScroller'),canvas=document.querySelector('#canvas');
  const a=stage.getBoundingClientRect(),b=canvas.getBoundingClientRect();
  return {
   stage:{left:a.left,top:a.top,right:a.right,bottom:a.bottom,cx:a.left+stage.clientWidth/2,cy:a.top+stage.clientHeight/2},
   canvas:{left:b.left,top:b.top,right:b.right,bottom:b.bottom,cx:b.left+b.width/2,cy:b.top+b.height/2},
   scrollLeft:stage.scrollLeft,scrollTop:stage.scrollTop,
   rightRoom:stage.scrollWidth-stage.clientWidth-stage.scrollLeft,
   bottomRoom:stage.scrollHeight-stage.clientHeight-stage.scrollTop,
  };
 });
}
async function dragWorkspace(page,dx,dy){
 const rect=await page.locator('#stageScroller').boundingBox();
 const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
 await page.mouse.move(x,y);
 await page.mouse.down();
 await page.mouse.move(x+dx,y+dy,{steps:4});
 await page.mouse.up();
}
function expectPanDelta(before,after,dx,dy){
 expect(Math.abs(after.canvas.left-before.canvas.left-dx),'horizontal pan should not jump when margins grow').toBeLessThan(5);
 expect(Math.abs(after.canvas.top-before.canvas.top-dy),'vertical pan should not jump when margins grow').toBeLessThan(5);
}

test('hand drag can pan into an empty workspace in all directions; Ctrl+0 recovers the canvas',async({page})=>{
 await openHome(page);
 await createDocument(page,'Unbounded stage',520,520);
 await page.locator('#dockHand').click();
 let previous=await stageGeometry(page);
 for(let i=0;i<13;i++){
  await dragWorkspace(page,130,88);
  const next=await stageGeometry(page);
  expectPanDelta(previous,next,130,88);
  previous=next;
 }
 expect(previous.canvas.left).toBeGreaterThan(previous.stage.right);
 expect(previous.canvas.top).toBeGreaterThan(previous.stage.bottom);
 // No canvas pixel is visible, but the blank stage is still pannable.
 await dragWorkspace(page,130,88);
 let next=await stageGeometry(page);
 expectPanDelta(previous,next,130,88);
 previous=next;
 for(let i=0;i<27;i++){
  await dragWorkspace(page,-130,-88);
  next=await stageGeometry(page);
  expectPanDelta(previous,next,-130,-88);
  previous=next;
 }
 expect(previous.canvas.right).toBeLessThan(previous.stage.left);
 expect(previous.canvas.bottom).toBeLessThan(previous.stage.top);
 await page.keyboard.press('Control+Digit0');
 await expect.poll(async()=>{
  const g=await stageGeometry(page);
  const dockTop=await page.locator('.floating-docks').evaluate(el=>el.getBoundingClientRect().top);
  const top=g.stage.top+8,bottom=Math.min(g.stage.top+(await page.locator('#stageScroller').evaluate(el=>el.clientHeight))-8,dockTop-6);
  return Math.max(Math.abs(g.canvas.cx-g.stage.cx),Math.abs(g.canvas.cy-(top+Math.max(top+80,bottom))/2));
 }).toBeLessThan(4);
});

test('artboard series keeps panning and zoom anchoring after its contents leave the screen',async({page})=>{
 await openHome(page);
 await createDocument(page,'Series infinite stage',450,450);
 await page.locator('#newCardBtn').click();
 await expect(page.locator('#seriesSidebar')).toBeVisible();
 await page.locator('#seriesSidebarAdd').click();
 await page.locator('#seriesCreateBlank').click();
 await expect(page.locator('.series-board')).toHaveCount(1);
 await page.locator('#dockHand').click();
 let previous=await stageGeometry(page);
 for(let i=0;i<12;i++){
  await dragWorkspace(page,125,75);
  const next=await stageGeometry(page);
  expectPanDelta(previous,next,125,75);
  previous=next;
 }
 expect(previous.canvas.left).toBeGreaterThan(previous.stage.right);
 await dragWorkspace(page,125,75);
 expectPanDelta(previous,await stageGeometry(page),125,75);
 // Zooming from blank workspace must not snap to zero or lose the board.
 const oldZoom=await page.locator('#zoomLabel').textContent();
 await page.keyboard.press('Control+Equal');
 await expect(page.locator('#zoomLabel')).not.toHaveText(oldZoom);
 await page.keyboard.press('Control+Digit0');
 await expect.poll(async()=>{
  const g=await stageGeometry(page);
  return Math.max(Math.abs(g.canvas.cx-g.stage.cx),Math.abs(g.canvas.cy-g.stage.cy));
 }).toBeLessThan(4);
});
