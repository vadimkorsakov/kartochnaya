const {test,expect,fixturePath,openHome,createDocument,addShape,exportedDocument}=require('./helpers');

test.use({viewport:{width:1440,height:1000}});

async function openShapeCrop(page){
 await openHome(page);
 await createDocument(page,'Crop overlay controls',600,400);
 await addShape(page);
 await page.locator('#inspector [data-fill-open="fill"]').click();
 const chooser=page.waitForEvent('filechooser');
 await page.locator('#fillPopover [data-fill-mode="image"]').click();
 await (await chooser).setFiles(fixturePath('sample.png'));
 await expect(page.locator('#inspector [data-action="toggleCrop"]')).toBeVisible();
 await page.locator('#fillPopover [data-fill-close]').click();
 const zoom=page.locator('#inspector [data-key="cropZoom"]');
 await zoom.fill('1.6');
 await zoom.press('Enter');
 await page.locator('#inspector [data-action="toggleCrop"]').click();
 const preview=page.locator('#cropPreview');
 await expect(preview).toBeVisible();
 await expect.poll(async()=>preview.evaluate(el=>el.width>100&&el.height>100)).toBe(true);
 return preview;
}

async function cropCursorAt(page,preview,offsetX,offsetY){
 const rect=await preview.boundingBox();
 expect(rect).toBeTruthy();
 await page.mouse.move(rect.x+offsetX,rect.y+offsetY);
 return preview.evaluate(el=>getComputedStyle(el).cursor);
}

test('photo in a shape shows corner/edge/rotate handles on the top preview and matching hover cursors',async({page})=>{
 const preview=await openShapeCrop(page);
 const rect=await preview.boundingBox();
 expect(rect.width).toBeGreaterThan(90);
 expect(rect.height).toBeGreaterThan(90);

 // The preview bounds include 38 CSS px on every side of the photo.
 // A white square at photo top-left proves the handle is rendered on the
 // overlaid preview rather than clipped behind the artboard.
 const handlePixel=await preview.evaluate(el=>{
  const ctx=el.getContext('2d'),box=el.getBoundingClientRect(),scaleX=el.width/box.width,scaleY=el.height/box.height;
  return [...ctx.getImageData(Math.round(38*scaleX),Math.round(38*scaleY),1,1).data];
 });
 expect(handlePixel[3]).toBe(255);
 expect(Math.min(...handlePixel.slice(0,3))).toBeGreaterThan(185);

 expect(await cropCursorAt(page,preview,38,38)).toBe('nwse-resize');
 expect(await cropCursorAt(page,preview,rect.width/2,38)).toBe('ns-resize');
 expect(await cropCursorAt(page,preview,rect.width-38,rect.height/2)).toBe('ew-resize');
 expect(await cropCursorAt(page,preview,rect.width/2,9)).toBe('crosshair');
 expect(await cropCursorAt(page,preview,rect.width-9,rect.height/2)).toBe('crosshair');
 expect(await cropCursorAt(page,preview,3,3)).toBe('default');

 // The original dashed border is still painted on the same preview.
 const border=await preview.evaluate(el=>{
  const ctx=el.getContext('2d'),rect=el.getBoundingClientRect(),sx=el.width/rect.width,sy=el.height/rect.height;
  let blue=0;
  for(let x=52;x<Math.min(rect.width-52,175);x+=2){
   const [r,g,b,a]=ctx.getImageData(Math.round(x*sx),Math.round(38*sy),1,1).data;
   if(a>110&&b>170&&b>r*1.2&&g>75)blue++;
  }
  return blue;
 });
 expect(border,'blue dashed image boundary remains visible').toBeGreaterThan(6);
});

test('visible crop handles resize and rotate the photo, without changing shape geometry',async({page})=>{
 const preview=await openShapeCrop(page);
 const before=(await exportedDocument(page)).elements.at(-1);
 let rect=await preview.boundingBox();
 await page.mouse.move(rect.x+rect.width-38,rect.y+38);
 await page.mouse.down();
 await page.mouse.move(rect.x+rect.width-10,rect.y+12,{steps:7});
 await page.mouse.up();
 const resized=(await exportedDocument(page)).elements.at(-1);
 expect(resized.cropZoom).toBeGreaterThan(before.cropZoom);
 expect([resized.x,resized.y,resized.w,resized.h]).toEqual([before.x,before.y,before.w,before.h]);

 rect=await preview.boundingBox();
 await page.mouse.move(rect.x+rect.width/2,rect.y+9);
 await expect.poll(()=>preview.evaluate(el=>getComputedStyle(el).cursor)).toBe('crosshair');
 await page.mouse.down();
 await page.mouse.move(rect.x+rect.width/2+45,rect.y+38,{steps:7});
 await page.mouse.up();
 const rotated=(await exportedDocument(page)).elements.at(-1);
 expect(Math.abs(rotated.cropRotation)).toBeGreaterThan(5);
 expect([rotated.x,rotated.y,rotated.w,rotated.h]).toEqual([before.x,before.y,before.w,before.h]);

 await page.locator('#cropDoneBtn').click();
 await expect(preview).toBeHidden();
 const saved=(await exportedDocument(page)).elements.at(-1);
 expect(saved.cropZoom).toBe(rotated.cropZoom);
 expect(saved.cropRotation).toBe(rotated.cropRotation);
});
