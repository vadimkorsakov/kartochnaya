const { PNG } = require('pngjs');
const {
  test, expect, openHome, importPayload, records, openLibraryDocument,
  exportedDocument, exportPNG, canvasPoint, createDocument,
} = require('./helpers');
const linked = require('./fixtures/linked-document.json');

function documentFixture() {
  const d = structuredClone(linked.document);
  d.groups = []; d.elements.forEach(e => { e.groupId = null; });
  return d;
}
async function importDocument(page, document) {
  // Project import preserves local IDs; single-document import has the separate KF-001.
  await importPayload(page, {
    format: 'kartochnaya-project-v1',
    project: { id: 'render-project', name: 'Render project', resources: [], resourceFolders: [] },
    documents: [document], fonts: [],
  });
  let saved;
  await expect.poll(async () => {
    saved = (await records(page, 'docs')).find(d => d.title === document.title);
    return !!saved;
  }).toBe(true);
  if(document.type==='card') await page.locator('[data-filter="card"]').click();
  await openLibraryDocument(page, saved.id);
  return saved.id;
}
async function savedElements(page, id, elements) {
  await expect.poll(async () => (await records(page, 'docs')).find(d => d.id === id)?.elements).toEqual(elements);
}
async function rerender(page) {
  for (let i = 0; i < 3; i++) {
    await page.locator('#zoomOutBtn').click();
    await page.locator('#zoomInBtn').click();
  }
}
for (const metadata of [false, true]) test(`R1/R4/R5/R6: boundary render and PNG preserve imported fields, metadata=${metadata}`, async ({ page }) => {
  const d = documentFixture(), b = d.elements[1].pathBoundary;
  if (metadata) {
    b.sourceLast = { x: 10, y: 20, w: 200, h: 100, rotation: 0 };
    b.geometrySignature = 'historical-signature';
  }
  await openHome(page);
  const id = await importDocument(page, d);
  expect((await exportedDocument(page)).elements).toEqual(d.elements);
  const before = await exportedDocument(page);
  const history = await page.locator('#historyEntries').innerHTML();
  const png = await exportPNG(page);
  // Boundary glyphs are visible above the source rectangle, even with stale metadata.
  const ink = (x, y) => png.image.data[(y * d.width + x) * 4] < 100;
  expect(Array.from({ length: 16 * 150 }, (_, i) => ink(i % 150 + 20, 2 + Math.floor(i / 150))).some(Boolean)).toBe(true);
  await rerender(page);
  expect(await exportedDocument(page)).toEqual(before);
  expect(await page.locator('#historyEntries').innerHTML()).toBe(history);
  await savedElements(page, id, d.elements);
  await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible();
  await openLibraryDocument(page, id);
  expect((await exportedDocument(page)).elements).toEqual(d.elements);
  expect((await exportPNG(page)).image.data).toEqual(png.image.data);
});

for (const mode of ['linear', 'radial']) for (const stops of [false, true]) test(`R3/R5: incomplete ${mode} gradient is read-only, stops=${stops}`, async ({ page }) => {
  const d = documentFixture(); d.title = `Read-only ${mode} ${stops}`; d.elements = [d.elements[0]];
  const e = d.elements[0];
  Object.assign(e, { fillType: 'gradient', gradientMode: mode, fill: '#000000', fill2: '#ffffff', gradientAngle: 90 });
  if (stops) { e.gradientStops = [{ pos: 100, color: '#fff', alpha: 100 }, { pos: 0, color: '#000', alpha: 20 }]; e.gradientStart = { x: 7, y: 8 }; }
  await openHome(page); const id = await importDocument(page, d);
  expect((await exportedDocument(page)).elements).toEqual(d.elements);
  const before = await exportedDocument(page), png = await exportPNG(page);
  const pixel = x => [...png.image.data.subarray((70 * 320 + x) * 4, (70 * 320 + x) * 4 + 4)];
  expect(pixel(40)[3]).toBe(255); expect(pixel(200)[0]).toBeGreaterThan(pixel(40)[0]);
  const probes=[[40,70],[120,95],[200,70]];
  const expected=await page.evaluate(({mode,stops,probes})=>{
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const c=canvas.getContext('2d');
    c.fillStyle='#ffffff';c.fillRect(0,0,320,240);c.translate(20,20);
    const length=Math.hypot(200,100),a=100-length/2,b=100+length/2;
    const gradient=mode==='radial'?c.createRadialGradient(a,50,0,a,50,length):c.createLinearGradient(a,50,b,50);
    gradient.addColorStop(0,stops?'rgba(0,0,0,.2)':'#000000');gradient.addColorStop(1,'#ffffff');
    c.fillStyle=gradient;c.fillRect(0,0,200,100);
    return probes.map(([x,y])=>[...c.getImageData(x,y,1,1).data]);
  },{mode,stops,probes});
  probes.forEach(([x,y],i)=>{
    const actual=[...png.image.data.subarray((y*320+x)*4,(y*320+x)*4+4)];
    actual.forEach((channel,j)=>expect(Math.abs(channel-expected[i][j]),`gradient pixel ${x},${y}, channel ${j}`).toBeLessThanOrEqual(1));
  });
  await rerender(page);
  expect(await exportedDocument(page)).toEqual(before);
  await savedElements(page, id, d.elements);
  // Opening the gradient editor and adding a stop is an explicit editing operation.
  await page.locator(`#layers [data-layer="${e.id}"] .layer-name`).click();
  await page.locator('#inspector [data-fill-open="fill"]').click();
  await page.locator('[data-gstop-add]').click();
  await expect(page.locator('[data-stop-row]')).toHaveCount(3);
  await page.locator('#fillPopover [data-fill-close]').click();
  const edited = await exportedDocument(page), ids = edited.elements[0].gradientStops.map(s => s.id);
  expect(new Set(ids).size).toBe(3); expect(ids.every(id => typeof id === 'string' && id.length > 0)).toBe(true);
  expect(edited.elements[0].gradientStops.map(s => s.pos)).toEqual([0, 50, 100]);
  await savedElements(page, id, edited.elements);
  await page.reload(); await expect(page.locator('#homeScreen')).toBeVisible(); await openLibraryDocument(page, id);
  expect((await exportedDocument(page)).elements).toEqual(edited.elements);
});

function darkBounds(image, width = 320, height = 240) {
  let x1=Infinity,y1=Infinity,x2=-1,y2=-1;
  for(let y=0;y<image.height;y++) for(let x=0;x<image.width;x++) {
    const i=(y*image.width+x)*4;
    if(image.data[i+3]>200 && image.data[i]<80 && image.data[i+1]<80 && image.data[i+2]<80) {
      x1=Math.min(x1,x);y1=Math.min(y1,y);x2=Math.max(x2,x);y2=Math.max(y2,y);
    }
  }
  expect(x2).toBeGreaterThanOrEqual(0);
  return {x:x1/image.width*width,y:y1/image.height*height,right:(x2+1)/image.width*width,bottom:(y2+1)/image.height*height};
}
async function liveBounds(page) {
  const data=await page.locator('#canvas').evaluate(c=>c.toDataURL());
  return darkBounds(PNG.sync.read(Buffer.from(data.split(',')[1],'base64')));
}
async function changeGeometry(page,key,value) {
  const input=page.locator(`#inspector [data-key="${key}"]`);
  await input.fill(String(value));await input.press('Tab');
}

test('R2/R6: live movement and Undo/Redo preserve exact snapshots', async ({ page }) => {
  const d=documentFixture();d.elements.reverse();await openHome(page);const id=await importDocument(page,d);
  const before=await exportedDocument(page),beforePNG=await exportPNG(page);
  await page.locator('#layers [data-layer="shape-original"] .layer-name').click();
  const bounds=await liveBounds(page),from=await canvasPoint(page,120,70),to=await canvasPoint(page,150,90);
  await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:5});
  // Before pointerup/commit the derived Canvas already follows the edited source.
  const live=await liveBounds(page);
  expect(live.x-bounds.x).toBeCloseTo(30,0);expect(live.y-bounds.y).toBeCloseTo(20,0);
  await page.mouse.up();
  const moved=await exportedDocument(page);
  expect(moved.elements[0].x-before.elements[0].x).toBe(moved.elements[1].x-before.elements[1].x);
  expect(moved.elements[0].y-before.elements[0].y).toBe(moved.elements[1].y-before.elements[1].y);
  const movedPNG=await exportPNG(page),history=await page.locator('#historyEntries').innerHTML();
  await rerender(page);expect(await page.locator('#historyEntries').innerHTML()).toBe(history);
  await page.locator('#undoBtn').click();expect((await exportedDocument(page)).elements).toEqual(before.elements);
  expect((await exportPNG(page)).image.data).toEqual(beforePNG.image.data);
  await page.locator('#redoBtn').click();expect((await exportedDocument(page)).elements).toEqual(moved.elements);
  expect((await exportPNG(page)).image.data).toEqual(movedPNG.image.data);
  await savedElements(page,id,moved.elements);
});

for(const [key,value] of [['w',230],['h',130],['rotation',15],['corner',24]]) test(`R2: source ${key} updates boundary in one reversible saved edit`,async({page})=>{
  const d=documentFixture();await openHome(page);const id=await importDocument(page,d);
  await page.locator('#layers [data-layer="shape-original"] .layer-name').click();
  await changeGeometry(page,key,value);
  const after=await exportedDocument(page);
  if(key==='corner') expect(after.elements[1].pathBoundary.fallback).not.toEqual(d.elements[1].pathBoundary.fallback);
  else expect(after.elements[1][key]-d.elements[1][key]).toBe(after.elements[0][key]-d.elements[0][key]);
  const png=await exportPNG(page);
  await page.locator('#undoBtn').click();expect((await exportedDocument(page)).elements).toEqual(d.elements);
  await page.locator('#redoBtn').click();expect((await exportedDocument(page)).elements).toEqual(after.elements);
  await savedElements(page,id,after.elements);
  await page.reload();await expect(page.locator('#homeScreen')).toBeVisible();await openLibraryDocument(page,id);
  expect((await exportedDocument(page)).elements).toEqual(after.elements);
  expect((await exportPNG(page)).image.data).toEqual(png.image.data);
});

test('R2: deleting a source keeps fallback geometry and Undo restores its link',async({page})=>{
  const d=documentFixture();await openHome(page);await importDocument(page,d);
  await page.locator('#layers [data-layer="shape-original"] .layer-name').click();
  await changeGeometry(page,'corner',24);
  const transformed=await exportedDocument(page),png=await exportPNG(page);
  await page.locator('#canvas').focus();await page.keyboard.press('Delete');
  const removed=await exportedDocument(page);
  expect(removed.elements).toHaveLength(1);
  expect(removed.elements[0].pathBoundary).toEqual({...transformed.elements[1].pathBoundary,sourceId:null,sourceLast:null});
  expect(darkBounds((await exportPNG(page)).image)).toEqual(darkBounds(png.image));
  await page.locator('#undoBtn').click();expect((await exportedDocument(page)).elements).toEqual(transformed.elements);
  await page.locator('#redoBtn').click();expect((await exportedDocument(page)).elements).toEqual(removed.elements);
});

for(const sourceId of ['missing-source',null]) test(`fallback boundary stays read-only with sourceId=${sourceId}`, async ({page})=>{
  const d=documentFixture();d.elements=[d.elements[1]];d.elements[0].pathBoundary.sourceId=sourceId;
  await openHome(page);const id=await importDocument(page,d);
  expect((await exportedDocument(page)).elements).toEqual(d.elements);
  darkBounds((await exportPNG(page)).image);await rerender(page);
  expect((await exportedDocument(page)).elements).toEqual(d.elements);
  await savedElements(page,id,d.elements);
});

for(const defaults of [false,true]) test(`R7: previews, slide changes, history and series PNG preserve slide fields, defaults=${defaults}`, async ({page})=>{
  const d=documentFixture();d.type='card';d.title='Read-only series';d.hasCustomName=true;d.activeSlideIndex=0;
  Object.assign(d.elements[0],{fillType:'gradient',fill:'#ff0000',fill2:'#0000ff'});
  d.slides=[0,1].map(i=>({id:`slide-${i}`,width:320,height:240,background:'#ffffff',backgroundAlpha:100,rulers:[],palette:[],groups:[],elements:structuredClone(d.elements)}));
  if(!defaults) for(const slide of d.slides){delete slide.rulers;delete slide.palette;delete slide.backgroundAlpha;}
  for(const e of d.slides[1].elements){e.x+=40;e.y+=40;e.id+='-second';}
  d.slides[1].elements[1].pathBoundary.sourceId='shape-original-second';
  Object.assign(d.slides[1].elements[0],{fill:'#00ff00',fill2:'#ffff00'});
  await openHome(page);const id=await importDocument(page,d);
  const current=await exportedDocument(page);expect(current.slides).toEqual(d.slides);
  await page.locator('#seriesSidebarList [data-side-slide="1"]').click();
  expect((await exportedDocument(page)).elements).toEqual(d.slides[1].elements);
  await page.locator('#layers [data-layer="shape-original-second"] .layer-name').click();
  await page.locator('#canvas').focus();await page.keyboard.press('Shift+ArrowRight');
  const edited=await exportedDocument(page);expect(edited.elements[1].x).toBe(d.slides[1].elements[1].x+10);
  expect(edited.slides[0].elements).toEqual(d.slides[0].elements);
  await page.locator('#undoBtn').click();const undone=await exportedDocument(page);expect(undone.elements).toEqual(d.elements);expect(undone.slides[1].elements).toEqual(d.slides[1].elements);
  await page.locator('#redoBtn').click();expect((await exportedDocument(page)).elements).toEqual(edited.elements);
  await page.locator('#seriesSidebarList [data-side-slide="0"]').click();
  expect((await exportedDocument(page)).elements).toEqual(d.elements);
  const before=await exportedDocument(page),downloads=[];page.on('download',d=>downloads.push(d));
  await page.locator('#exportBtn').click();await page.locator('#seriesExportConfirm').click();
  await expect.poll(()=>downloads.length).toBe(2);
  const {readFile}=require('node:fs/promises');
  const images=await Promise.all(downloads.map(async d=>PNG.sync.read(await readFile(await d.path()))));
  expect(darkBounds(images[1]).x-darkBounds(images[0]).x).toBe(50);
  expect(darkBounds(images[1]).y-darkBounds(images[0]).y).toBe(40);
  expect(images[0].data[(70*320+120)*4+1]).toBe(0);expect(images[1].data[(110*320+180)*4+1]).toBe(255);
  expect(await exportedDocument(page)).toEqual(before);
  await savedElements(page,id,before.elements);
  await page.reload();await expect(page.locator('#homeScreen')).toBeVisible();await page.locator('[data-filter="card"]').click();await openLibraryDocument(page,id);
  expect((await exportedDocument(page)).slides).toEqual(before.slides);
});

test('R2: editing a vector path node updates the contour and restores exact history',async({page})=>{
  const d=documentFixture(),source=d.elements[0];source.type='path';source.pathClosed=true;
  source.pathNodes=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
  await openHome(page);const id=await importDocument(page,d);
  await page.locator('#layers [data-layer="shape-original"] .layer-name').click();
  await page.locator('#inspector [data-action="editPath"]').click();
  const from=await canvasPoint(page,220,20),to=await canvasPoint(page,190,45);
  await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:4});await page.mouse.up();
  const after=await exportedDocument(page);
  expect(after.elements[0].pathNodes).not.toEqual(source.pathNodes);
  expect(after.elements[1].pathBoundary.fallback).not.toEqual(d.elements[1].pathBoundary.fallback);
  const png=await exportPNG(page);
  await page.locator('#undoBtn').click();expect((await exportedDocument(page)).elements).toEqual(d.elements);
  await page.locator('#redoBtn').click();expect((await exportedDocument(page)).elements).toEqual(after.elements);
  await savedElements(page,id,after.elements);
  await page.reload();await expect(page.locator('#homeScreen')).toBeVisible();await openLibraryDocument(page,id);
  expect((await exportPNG(page)).image.data).toEqual(png.image.data);
});

test('R6: repeated renders and PNG allocate no IDs, save no documents and leave history snapshots intact',async({page})=>{
  await page.addInitScript(()=>{
    window.renderObservation={ids:0,docWrites:0,snapshots:[]};
    const uuid=Crypto.prototype.randomUUID;
    Crypto.prototype.randomUUID=function(...args){renderObservation.ids++;return uuid.apply(this,args);};
    for(const method of ['put','add','delete']) {
      const original=IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method]=function(...args){if(this.name==='docs')renderObservation.docWrites++;return original.apply(this,args);};
    }
    const stringify=JSON.stringify;
    JSON.stringify=function(value,...args){
      const result=stringify.call(this,value,...args);
      if(value&&Object.hasOwn(value,'selection')&&Object.hasOwn(value,'hasCustomName')&&Array.isArray(value.elements))renderObservation.snapshots.push(result);
      return result;
    };
  });
  const d=documentFixture();await openHome(page);await importDocument(page,d);
  await page.locator('#layers [data-layer="shape-original"] .layer-name').click();
  await page.locator('#canvas').focus();await page.keyboard.press('Shift+ArrowRight');
  const before=await exportedDocument(page);
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  const observed=await page.evaluate(()=>structuredClone(renderObservation));
  expect(observed.snapshots.length).toBeGreaterThan(1);
  await rerender(page);await exportPNG(page);await exportPNG(page);
  expect(await exportedDocument(page)).toEqual(before);
  expect(await page.evaluate(()=>renderObservation)).toEqual(observed);
  await page.locator('#undoBtn').click();expect((await exportedDocument(page)).elements).toEqual(d.elements);
  await page.locator('#redoBtn').click();expect((await exportedDocument(page)).elements).toEqual(before.elements);
});

test('deleting a legacy source retains its effective contour even before the first geometry edit',async({page})=>{
  const d=documentFixture();d.elements[0].corner=24;
  await openHome(page);await importDocument(page,d);
  const before=await exportedDocument(page);expect(before.elements).toEqual(d.elements);
  const bounds=darkBounds((await exportPNG(page)).image);
  await page.locator('#layers [data-layer="shape-original"] .layer-name').click();
  await page.locator('#canvas').focus();await page.keyboard.press('Delete');
  const removed=await exportedDocument(page);
  expect(removed.elements[0].pathBoundary).toMatchObject({sourceId:null,sourceLast:null});
  expect(removed.elements[0].pathBoundary.fallback).not.toEqual(d.elements[1].pathBoundary.fallback);
  expect(darkBounds((await exportPNG(page)).image)).toEqual(bounds);
  await page.locator('#undoBtn').click();expect((await exportedDocument(page)).elements).toEqual(d.elements);
});

test('selection creates an independent boundary that survives rendering and reopening',async({page})=>{
  await openHome(page);await createDocument(page,'Independent selection contour');
  await page.locator('#dockMarquee').click();
  const from=await canvasPoint(page,40,60),to=await canvasPoint(page,240,160);
  await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:3});await page.mouse.up();
  await page.locator('#selectKindBtn').click();await page.locator('#selectionBoundaryText').click();
  await expect(page.locator('#inlineText')).toBeVisible();await page.locator('#inlineText').fill('Самостоятельный контур');
  await page.locator('#inlineText').press('ControlOrMeta+Enter');
  const before=await exportedDocument(page);expect(before.elements[0].pathBoundary).toMatchObject({sourceId:null,sourceLast:null});
  const png=await exportPNG(page);darkBounds(png.image);await rerender(page);
  expect(await exportedDocument(page)).toEqual(before);await savedElements(page,before.id,before.elements);
  await page.reload();await expect(page.locator('#homeScreen')).toBeVisible();await openLibraryDocument(page,before.id);
  expect((await exportedDocument(page)).elements).toEqual(before.elements);
  expect((await exportPNG(page)).image.data).toEqual(png.image.data);
});

test('mobile gradient edits normalize stops and geometry before saving',async({page})=>{
  const d=documentFixture();d.elements=[d.elements[0]];await openHome(page);const id=await importDocument(page,d);
  await page.setViewportSize({width:390,height:844});
  const point=await canvasPoint(page,100,70);await page.mouse.click(point.x,point.y);
  await page.locator('#mobileContext [data-mobile="color"]').click();
  await page.locator('[data-mp-action="expand"]').click();
  await page.locator('[data-mp-gradient]').first().click();
  let e;await expect.poll(async()=>{e=(await records(page,'docs')).find(d=>d.id===id)?.elements[0];return e?.fillType;}).toBe('gradient');
  expect(new Set(e.gradientStops.map(s=>s.id)).size).toBe(2);expect(e.gradientStops.every(s=>!!s.id)).toBe(true);
  expect(e.gradientStart).toBeTruthy();expect(e.gradientEnd).toBeTruthy();
  await page.locator('[data-mp-action="colorEdit"]').click();
  await page.locator('[data-mp-tab="gradient"]').click();
  await page.locator('[data-mp-gradient-style="45"]').focus();await page.keyboard.press('Enter');
  await page.locator('[data-mp-action="addStop"]').focus();await page.keyboard.press('Enter');
  await page.locator('[data-mp-action="done"]').click();
  await page.setViewportSize({width:1280,height:900});
  const before=await exportedDocument(page);e=before.elements[0];
  expect(e.gradientAngle).toBe(45);expect(e.gradientStops).toHaveLength(3);expect(new Set(e.gradientStops.map(s=>s.id)).size).toBe(3);
  await savedElements(page,id,before.elements);const png=await exportPNG(page);
  expect(await exportedDocument(page)).toEqual(before);
  await page.reload();await expect(page.locator('#homeScreen')).toBeVisible();await openLibraryDocument(page,id);
  expect((await exportedDocument(page)).elements).toEqual(before.elements);expect((await exportPNG(page)).image.data).toEqual(png.image.data);
});

test('switching the selected legacy gradient keeps its first stop drag functional',async({page})=>{
  const d=documentFixture();d.elements=[d.elements[0]];
  Object.assign(d.elements[0],{w:100,h:80,fillType:'gradient'});
  d.elements.push({...structuredClone(d.elements[0]),id:'second-gradient',x:20,y:140,gradientStops:[{pos:100,color:'#ffffff'},{pos:50,color:'#000000'}]});
  await openHome(page);await importDocument(page,d);
  await page.locator('#layers [data-layer="shape-original"] .layer-name').click();
  await page.locator('#inspector [data-fill-open="fill"]').click();
  const center=await canvasPoint(page,70,180),to=await canvasPoint(page,80,180);
  // Selecting another gradient on Canvas keeps the existing gradient editor open.
  await page.mouse.click(center.x,center.y);
  await expect(page.locator('#layers [data-layer="second-gradient"]')).toHaveClass(/selected/);
  await page.mouse.move(center.x,center.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:3});await page.mouse.up();
  const e=(await exportedDocument(page)).elements[1];
  expect(e).toMatchObject({x:20,y:140,w:100,h:80});
  expect(e.gradientStart).toBeTruthy();expect(e.gradientEnd).toBeTruthy();
  expect(e.gradientStops.map(s=>s.pos)).toEqual([58,100]);expect(new Set(e.gradientStops.map(s=>s.id)).size).toBe(2);
  expect(e.gradientStops.every(s=>!!s.id)).toBe(true);
});

test('absent slide defaults stay independent of the active slide through preview, switching and save',async({page})=>{
  const d=documentFixture();Object.assign(d,{type:'card',hasCustomName:true,activeSlideIndex:0,elements:[]});
  d.slides=[0,1].map(i=>({id:`alpha-${i}`,width:320,height:240,background:'#ffffff',elements:[],groups:[]}));
  Object.assign(d.slides[0],{backgroundAlpha:40,rulers:[{axis:'x',pos:30}],palette:['#123456']});
  await openHome(page);const id=await importDocument(page,d);
  const preview=page.locator('.series-board[data-board-index="1"] canvas');
  expect(await preview.evaluate(c=>[...c.getContext('2d').getImageData(0,0,1,1).data])).toEqual([255,255,255,255]);
  await page.locator('#seriesSidebarList [data-side-slide="1"]').click();
  const second=await exportedDocument(page);expect(second).toMatchObject({backgroundAlpha:100,rulers:[],palette:[]});
  expect(second.slides).toEqual(d.slides);
  await page.locator('#seriesSidebarList [data-side-slide="0"]').click();
  const first=await exportedDocument(page);expect(first).toMatchObject({backgroundAlpha:40,rulers:[{axis:'x',pos:30}],palette:['#123456']});
  expect(first.slides).toEqual(d.slides);
  await expect.poll(async()=>(await records(page,'docs')).find(d=>d.id===id)?.slides).toEqual(d.slides);
});
