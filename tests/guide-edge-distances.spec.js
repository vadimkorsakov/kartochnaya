const {test,expect,openHome,createDocument,canvasPoint,exportedDocument}=require('./helpers');

test.use({viewport:{width:1280,height:900}});

const width=600,height=400;
async function hasMeasurementInk(page,x,y){
 return page.locator('#canvas').evaluate((canvas,{x,y,width,height})=>{
  const context=canvas.getContext('2d');
  const px=Math.round(x*canvas.width/width),py=Math.round(y*canvas.height/height);
  for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
   const X=px+dx,Y=py+dy;
   if(X<0||Y<0||X>=canvas.width||Y>=canvas.height)continue;
   const [r,g,b,a]=context.getImageData(X,Y,1,1).data;
   if(a>170&&r>170&&g<185&&b>95&&r>g*1.23&&b>g*1.1)return true;
  }
  return false;
 },{x,y,width,height});
}
async function guideFromRuler(page,axis,position){
 const canvas=await canvasPoint(page,axis==='x'?position:width/2,axis==='x'?height/2:position,width,height);
 const ruler=await page.locator(axis==='x'?'#rulerLeft':'#rulerTop').boundingBox();
 expect(ruler).toBeTruthy();
 const start=axis==='x'?{x:ruler.x+ruler.width/2,y:canvas.y}:{x:canvas.x,y:ruler.y+ruler.height/2};
 await page.mouse.move(start.x,start.y);
 await page.mouse.down();
 await page.mouse.move(canvas.x,canvas.y,{steps:8});
}
async function guideCoordinate(page,axis){
 const doc=await exportedDocument(page);
 const guide=doc.rulers?.find(g=>g.axis===axis);
 expect(guide,'saved guide '+axis).toBeTruthy();
 return guide.pos;
}

test('vertical guide shows both horizontal edge distances while creating and moving',async({page})=>{
 await openHome(page);
 await createDocument(page,'Vertical guide distances',width,height);
 await expect(page.locator('#rulerLeft')).toBeVisible();
 await guideFromRuler(page,'x',240);
 await expect.poll(()=>hasMeasurementInk(page,70,200)).toBe(true);
 await expect.poll(()=>hasMeasurementInk(page,520,200)).toBe(true);
 await page.mouse.up();
 await expect.poll(()=>hasMeasurementInk(page,70,200)).toBe(false);
 let x=await guideCoordinate(page,'x');
 expect(x).toBeGreaterThan(230);expect(x).toBeLessThan(250);

 // Existing saved guide: show the same measurements during canvas drag.
 const from=await canvasPoint(page,x,200,width,height),to=await canvasPoint(page,325,200,width,height);
 await page.mouse.move(from.x,from.y);await page.mouse.down();
 await page.mouse.move(to.x,to.y,{steps:6});
 await expect.poll(()=>hasMeasurementInk(page,70,200)).toBe(true);
 await expect.poll(()=>hasMeasurementInk(page,520,200)).toBe(true);
 await page.mouse.up();
 await expect.poll(()=>hasMeasurementInk(page,70,200)).toBe(false);
 x=await guideCoordinate(page,'x');
 expect(x).toBeGreaterThan(315);expect(x).toBeLessThan(335);
});

test('horizontal guide shows both vertical edge distances only during drag',async({page})=>{
 await openHome(page);
 await createDocument(page,'Horizontal guide distances',width,height);
 await expect(page.locator('#rulerTop')).toBeVisible();
 await guideFromRuler(page,'y',150);
 await expect.poll(()=>hasMeasurementInk(page,300,35)).toBe(true);
 await expect.poll(()=>hasMeasurementInk(page,300,345)).toBe(true);
 await page.mouse.up();
 await expect.poll(()=>hasMeasurementInk(page,300,35)).toBe(false);
 let y=await guideCoordinate(page,'y');
 expect(y).toBeGreaterThan(140);expect(y).toBeLessThan(160);

 const from=await canvasPoint(page,300,y,width,height),to=await canvasPoint(page,300,220,width,height);
 await page.mouse.move(from.x,from.y);await page.mouse.down();
 await page.mouse.move(to.x,to.y,{steps:6});
 await expect.poll(()=>hasMeasurementInk(page,300,35)).toBe(true);
 await expect.poll(()=>hasMeasurementInk(page,300,345)).toBe(true);
 await page.mouse.up();
 await expect.poll(()=>hasMeasurementInk(page,300,35)).toBe(false);
 y=await guideCoordinate(page,'y');
 expect(y).toBeGreaterThan(210);expect(y).toBeLessThan(230);
});
