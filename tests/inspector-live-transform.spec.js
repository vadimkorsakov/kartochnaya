const {test,expect,openHome,createDocument,canvasPoint,addShape,exportedDocument}=require('./helpers');

test.use({viewport:{width:1280,height:900}});
const W=600,H=400;

const value=(page,key)=>page.locator('#inspector input[data-key="'+key+'"]').inputValue().then(Number);

async function canvasDragStart(page,x,y){
 const point=await canvasPoint(page,x,y,W,H);
 await page.mouse.move(point.x,point.y);
 await page.mouse.down();
}

test('X and Y update before pointerup during canvas movement and remain undoable as one action',async({page})=>{
 await openHome(page);
 await createDocument(page,'Live XY inspector',W,H);
 await addShape(page);
 const shape=(await exportedDocument(page)).elements.at(-1);
 const oldX=await value(page,'x'),oldY=await value(page,'y');
 const width=await value(page,'w'),height=await value(page,'h');
 const xInput=await page.locator('#inspector input[data-key="x"]').elementHandle();

 await canvasDragStart(page,shape.x+shape.w/2,shape.y+shape.h/2);
 const target=await canvasPoint(page,shape.x+shape.w/2+46,shape.y+shape.h/2+33,W,H);
 await page.mouse.move(target.x,target.y,{steps:7});
 // These assertions happen while the pointer is still down.
 expect(await value(page,'x')).toBeGreaterThan(oldX+20);
 expect(await value(page,'y')).toBeGreaterThan(oldY+10);
 expect(await value(page,'w')).toBe(width);
 expect(await value(page,'h')).toBe(height);
 expect(await xInput.evaluate(node=>node.isConnected),'no inspector rebuild while dragging').toBe(true);
 await page.mouse.up();

 const moved=(await exportedDocument(page)).elements.at(-1);
 expect(await value(page,'x')).toBe(moved.x);
 expect(await value(page,'y')).toBe(moved.y);
 await page.locator('#undoBtn').click();
 expect(await value(page,'x')).toBe(oldX);
 expect(await value(page,'y')).toBe(oldY);
});

test('W and H update while dragging a corner resize handle',async({page})=>{
 await openHome(page);
 await createDocument(page,'Live WH inspector',W,H);
 await addShape(page);
 const shape=(await exportedDocument(page)).elements.at(-1);
 const oldW=await value(page,'w'),oldH=await value(page,'h');
 const wInput=await page.locator('#inspector input[data-key="w"]').elementHandle();

 await canvasDragStart(page,shape.x+shape.w,shape.y+shape.h);
 const point=await canvasPoint(page,shape.x+shape.w+65,shape.y+shape.h+38,W,H);
 await page.mouse.move(point.x,point.y,{steps:9});
 expect(await value(page,'w')).toBeGreaterThan(oldW+15);
 expect(await value(page,'h')).toBeGreaterThan(oldH+8);
 expect(await wInput.evaluate(node=>node.isConnected),'numeric inputs stay mounted').toBe(true);
 await page.mouse.up();

 const updated=(await exportedDocument(page)).elements.at(-1);
 expect(await value(page,'w')).toBe(updated.w);
 expect(await value(page,'h')).toBe(updated.h);
});

test('rotation numeric field updates while turning the selected layer handle',async({page})=>{
 await openHome(page);
 await createDocument(page,'Live rotation inspector',W,H);
 await addShape(page);
 const shape=(await exportedDocument(page)).elements.at(-1);
 const canvas=await page.locator('#canvas').boundingBox();
 const zoom=canvas.width/W;
 const knobX=shape.x+shape.w/2,knobY=shape.y-29/zoom;
 const oldAngle=await value(page,'rotation');
 const angleInput=await page.locator('#inspector input[data-key="rotation"]').elementHandle();

 await canvasDragStart(page,knobX,knobY);
 const to=await canvasPoint(page,knobX+75,knobY+3,W,H);
 await page.mouse.move(to.x,to.y,{steps:9});
 expect(Math.abs((await value(page,'rotation'))-oldAngle)).toBeGreaterThan(8);
 expect(await angleInput.evaluate(node=>node.isConnected),'numeric inputs stay mounted').toBe(true);
 await page.mouse.up();

 const updated=(await exportedDocument(page)).elements.at(-1);
 expect(await value(page,'rotation')).toBe(updated.rotation);
});
