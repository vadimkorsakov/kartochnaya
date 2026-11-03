const {test,expect,openHome,createDocument,exportedDocument,exportPNG}=require('./helpers');

test.use({viewport:{width:1360,height:950}});
const SIZE=800;
const approx=(actual,expected,tolerance=2.6)=>expect(Math.abs(actual-expected)).toBeLessThanOrEqual(tolerance);

async function insert(page,id){
 await page.locator('#dockShapes').click();
 const choice=page.locator('[data-tray-shape="'+id+'"]');
 await expect(choice).toBeVisible();await choice.click();
 await expect(page.locator('#shapeTray')).toBeHidden();
 const doc=await exportedDocument(page);
 const shape=doc.elements.at(-1);
 expect(shape.type).toBe('vector');
 expect(shape.vectorId).toBe(id);
 return shape;
}
function paintedBounds(image){
 const {width,height,data}=image;
 let minX=width,minY=height,maxX=-1,maxY=-1;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4,r=data[i],g=data[i+1],b=data[i+2],a=data[i+3];
  // The newly inserted vector uses #ab92fb, on a white artboard.
  if(a>150&&r<225&&g<220&&b>210){
   minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
  }
 }
 expect(maxX,'visible filled shape in PNG').toBeGreaterThan(-1);
 return {x:minX,y:minY,right:maxX+1,bottom:maxY+1};
}
async function expectBoundsMatchPixels(page,shape){
 const {image}=await exportPNG(page,SIZE,SIZE);
 const p=paintedBounds(image);
 approx(p.x,shape.x);
 approx(p.y,shape.y);
 approx(p.right,shape.x+shape.w);
 approx(p.bottom,shape.y+shape.h);
}

for(const [id,title] of [
 ['basic0','square'],['basic1','rounded square'],['basic2','circle'],
 ['basic3','triangle'],['flow2','flowchart block'],['abstract7','shape with inner contour'],
]){
 test('new '+title+' uses the visible SVG bounds, not padded 100x100 thumbnail coordinates',async({page})=>{
  await openHome(page);await createDocument(page,'Tight '+title,SIZE,SIZE);
  const e=await insert(page,id);
  const box=e.vectorViewBox;
  expect(box,'new vector has an explicit source viewBox').toBeTruthy();
  for(const key of ['x','y','w','h'])expect(Number.isFinite(box[key])).toBe(true);
  expect(box.w).toBeGreaterThan(0);expect(box.h).toBeGreaterThan(0);
  const oldW=Math.round(SIZE*.44),oldH=oldW;
  const oldX=Math.round((SIZE-oldW)/2),oldY=oldX;
  approx(e.x,oldX+oldW*box.x/100,.02);
  approx(e.y,oldY+oldH*box.y/100,.02);
  approx(e.w,oldW*box.w/100,.02);
  approx(e.h,oldH*box.h/100,.02);
  await expectBoundsMatchPixels(page,e);
 });
}

test('new square keeps its visual footprint while tightening the inspector W/H',async({page})=>{
 await openHome(page);await createDocument(page,'Tight geometry',SIZE,SIZE);
 let shape=await insert(page,'basic0');
 expect(shape.vectorViewBox).toEqual({x:7,y:7,w:86,h:86});
 expect(shape.w).toBeCloseTo(Math.round(SIZE*.44)*.86,3);
 expect(shape.h).toBeCloseTo(Math.round(SIZE*.44)*.86,3);
 await expectBoundsMatchPixels(page,shape);
 // Resize through the normal inspector and verify the *painted* shape still
 // reaches the new layer frame without reintroducing any internal padding.
 const width=page.locator('#inspector input[data-key="w"]');
 await expect(width).toBeVisible();
 await width.fill('500');await width.press('Enter');
 shape=(await exportedDocument(page)).elements.at(-1);
 expect(shape.w).toBe(500);
 expect(shape.vectorViewBox).toEqual({x:7,y:7,w:86,h:86});
 await expectBoundsMatchPixels(page,shape);
});

test('line shapes keep their historic line and end-cap coordinate system',async({page})=>{
 await openHome(page);await createDocument(page,'Original line geometry',SIZE,SIZE);
 const line=await insert(page,'line3');
 expect(line.vectorLine).toBe(true);
 expect(line.vectorViewBox).toBeUndefined();
 expect(line.w).toBe(Math.round(SIZE*.65));
 expect(line.h).toBe(Math.round(SIZE*.13));
 expect(line.vectorCapEnd).toBe('arrow');
});
