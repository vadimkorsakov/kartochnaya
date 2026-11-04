const {test,expect,openHome,createDocument}=require('./helpers');

test.use({viewport:{width:1360,height:900}});

async function fitGeometry(page){
 return page.evaluate(()=>{
  const sc=document.querySelector('#stageScroller'),board=document.querySelector('#canvas');
  const dock=document.querySelector('.floating-docks');
  const s=sc.getBoundingClientRect(),b=board.getBoundingClientRect(),d=dock.getBoundingClientRect();
  const top=s.top+8,bottom=Math.min(s.top+sc.clientHeight-8,d.top-6);
  const centerX=s.left+sc.clientWidth/2,centerY=(top+Math.max(top+80,bottom))/2;
  return {
   top,bottom,centerX,centerY,board:{top:b.top,bottom:b.bottom,left:b.left,right:b.right,
    centerX:b.left+b.width/2,centerY:b.top+b.height/2,width:b.width,height:b.height},
   dockTop:d.top,stageTop:s.top,stageBottom:s.bottom,stageWidth:sc.clientWidth,
  };
 });
}
async function assertUnobstructedFit(page,width,height){
 await expect.poll(async()=>{
  const g=await fitGeometry(page);
  return Math.max(Math.abs(g.board.centerX-g.centerX),Math.abs(g.board.centerY-g.centerY));
 }).toBeLessThan(3);
 const g=await fitGeometry(page);
 const expected=Math.min((g.stageWidth-68)/width,(g.bottom-g.top)/height,3);
 const actual=g.board.width/width;
 expect(Math.abs(actual-expected),'fit zoom uses clear working area rather than dock-covered height').toBeLessThan(.005);
 expect(g.board.top,'canvas stays below upper stage controls').toBeGreaterThanOrEqual(g.top-3);
 expect(g.board.bottom,'canvas remains above the floating tools').toBeLessThanOrEqual(g.bottom+3);
 expect(g.board.bottom).toBeLessThan(g.dockTop);
 return g;
}

test('fit button uses space between zoom controls and tool dock for a portrait document',async({page})=>{
 await openHome(page);
 await createDocument(page,'Portrait fit',1080,1350);
 await page.locator('#fitBtn').click();
 const g=await assertUnobstructedFit(page,1080,1350);
 // Tall documents should nearly touch both safe boundaries.
 expect(Math.abs(g.board.top-g.top)).toBeLessThan(4);
 expect(Math.abs(g.bottom-g.board.bottom)).toBeLessThan(4);
 await page.locator('#zoomInBtn').click();
 await page.locator('#fitBtn').click();
 await assertUnobstructedFit(page,1080,1350);
});

test('Ctrl+0 returns a panned canvas to the safe fit area, including after resize',async({page})=>{
 await openHome(page);
 await createDocument(page,'Fit and resize',1080,1350);
 await page.locator('#dockHand').click();
 await page.locator('#stageScroller').evaluate(node=>{node.scrollLeft+=350;node.scrollTop+=440;});
 await page.keyboard.press('Control+Digit0');
 await assertUnobstructedFit(page,1080,1350);
 await page.setViewportSize({width:1000,height:700});
 await assertUnobstructedFit(page,1080,1350);
});

test('wide document is centered inside unobstructed area without unnecessary upscaling',async({page})=>{
 await openHome(page);
 await createDocument(page,'Wide fit',1920,700);
 await page.locator('#fitBtn').click();
 const g=await assertUnobstructedFit(page,1920,700);
 expect(g.board.top).toBeGreaterThan(g.top);
 expect(g.bottom-g.board.bottom).toBeGreaterThan(0);
});
