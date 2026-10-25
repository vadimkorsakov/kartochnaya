const { PNG } = require('pngjs');
const { test, expect, openHome, importPayload, records, openLibraryDocument, exportPNG, exportedDocument } = require('./helpers');

function maskPNG(kind) {
  const png = new PNG({width: 32, height: 24});
  for(let y=0;y<24;y++) for(let x=0;x<32;x++) {
    const i=(y*32+x)*4;
    const value=kind==='black'?0:kind==='split'&&x<16?0:255;
    png.data.set([value,value,value,kind==='half'?128:kind==='region'&&x>=16?0:255],i);
  }
  return PNG.sync.write(png);
}
// Synthetic image requests must reach Playwright's deterministic gate.
test.use({serviceWorkers:'block'});
const source = kind => `http://127.0.0.1:4173/masks/${kind}.png`;
function doc(id, kind='split', width=320, height=240) {
  return {id,projectId:'masks',title:id,type:'template',width,height,background:'#ffffff',backgroundAlpha:100,
    createdAt:1,updatedAt:1,rulers:[],palette:[],groups:[],elements:[{id:'historical-id',type:'rect',name:'Masked red',
      x:0,y:0,w:width,h:height,rotation:0,visible:true,opacity:100,fillType:'solid',fill:'#ff0000',fillOpacity:100,strokeWidth:0,layerMaskSrc:source(kind)}]};
}
async function imageGate(page, kind, delayed=false) {
  const pending=[]; let released=!delayed, requests=0;
  await page.route(source(kind),async route=>{
    requests++; if(!released)await new Promise(resolve=>pending.push(resolve));
    await route.fulfill({contentType:'image/png',body:maskPNG(kind)});
  });
  return {release(){released=true;pending.splice(0).forEach(resolve=>resolve());}, async requested(){await expect.poll(()=>requests).toBeGreaterThan(0);}};
}
async function seed(page, documents) {
  await openHome(page);
  await importPayload(page,{format:'kartochnaya-project-v1',project:{id:'masks',name:'Mask regression',resources:[],resourceFolders:[]},documents,fonts:[]});
  await expect(page.locator('#toast')).toContainText('Импортировано проектов');
  return (await records(page,'docs')).filter(d=>documents.some(s=>s.title===d.title));
}
const white=[255,255,255,255], red=[255,0,0,255], half=[255,127,127,255];
async function pixels(locator, points=[[.25,.5],[.75,.5]]) {
  return locator.evaluate((c,points)=>points.map(([x,y])=>[...c.getContext('2d').getImageData(Math.floor(c.width*x),Math.floor(c.height*y),1,1).data]),points);
}
async function live(page, expected) {await expect.poll(()=>pixels(page.locator('#canvas'))).toEqual(expected);}
function pngPixels(image) {return [.25,.75].map(x=>[...image.data.subarray((Math.floor(image.height/2)*image.width+Math.floor(image.width*x))*4,(Math.floor(image.height/2)*image.width+Math.floor(image.width*x))*4+4)]);}
async function evidence(info, name, value) {await info.attach(name,{body:JSON.stringify(value),contentType:'application/json'});}

for(const [kind,expected] of [['black',[white,white]],['half',[half,half]],['white',[red,red]]]) test(`cold reload: ${kind} mask reaches canvas and repeated PNG`,async({page},info)=>{
  await imageGate(page,kind);const [saved]=await seed(page,[doc('Cold '+kind,kind)]);
  await page.reload();await expect(page.locator('#homeScreen')).toBeVisible();
  await openLibraryDocument(page,saved.id);
  const first=await exportPNG(page);await evidence(info,'first-PNG-pixels',pngPixels(first.image));
  expect.soft(pngPixels(first.image)).toEqual(expected);await live(page,expected);
  expect(pngPixels((await exportPNG(page)).image)).toEqual(expected);
});

test('loading layer mask hides layer until ready and repaints without interaction',async({page},info)=>{
  const gate=await imageGate(page,'split',true);const [saved]=await seed(page,[doc('Async split')]);
  await openLibraryDocument(page,saved.id);await gate.requested();
  const before=await pixels(page.locator('#canvas'));await evidence(info,'pending-pixels',before);
  expect.soft(before).toEqual([white,white]);gate.release();
  await live(page,[white,red]);expect(pngPixels((await exportPNG(page)).image)).toEqual([white,red]);
});

test('non-active library thumbnail refreshes after its mask loads',async({page})=>{
  const gate=await imageGate(page,'split',true);await imageGate(page,'white');
  const docs=await seed(page,[doc('Target'),doc('Active','white',160,120)]);
  await openLibraryDocument(page,docs.find(d=>d.title==='Active').id);
  await page.locator('#documentTabsHome').click();await gate.requested();gate.release();
  const thumb=page.locator(`[data-docid="${docs.find(d=>d.title==='Target').id}"] canvas`);
  await expect.poll(()=>pixels(thumb)).toEqual([white,red]);
});

function series() {
  const d=doc('Mask series','white',160,120);d.type='card';d.hasCustomName=true;d.activeSlideIndex=0;
  d.slides=[doc('small','white',160,120),doc('large','white',320,240)].map(({id,width,height,background,backgroundAlpha,rulers,palette,groups,elements})=>({id,width,height,background,backgroundAlpha,rulers,palette,groups,elements}));
  return d;
}
test('same historical ID and source at two sizes: thumbnails, switching, reopen and series PNG',async({page})=>{
  await imageGate(page,'white');const [saved]=await seed(page,[series()]);
  await page.locator('[data-filter="card"]').click();await openLibraryDocument(page,saved.id);
  for(const i of [1,0,1,0]) {
    await page.locator(`#seriesSidebarList [data-side-slide="${i}"]`).click();await live(page,[red,red]);
    for(const j of [0,1])await expect.poll(()=>pixels(page.locator(`#seriesSidebarList [data-side-slide="${j}"] canvas`))).toEqual([red,red]);
  }
  const downloads=[];page.on('download',d=>downloads.push(d));await page.locator('#exportBtn').click();await page.locator('#seriesExportConfirm').click();await expect.poll(()=>downloads.length).toBe(2);
  const {readFile}=require('node:fs/promises');
  for(const d of downloads)expect(pngPixels(PNG.sync.read(await readFile(await d.path())))).toEqual([red,red]);
  await page.reload();await expect(page.locator('#homeScreen')).toBeVisible();await page.locator('[data-filter="card"]').click();await openLibraryDocument(page,saved.id);await live(page,[red,red]);
});

test('active document changes before mask completion; returning keeps correct pixels',async({page})=>{
  const gate=await imageGate(page,'split',true);await imageGate(page,'white');
  const docs=await seed(page,[doc('Loading'),doc('Other','white',160,120)]);
  await openLibraryDocument(page,docs.find(d=>d.title==='Loading').id);await gate.requested();
  await page.locator('#documentTabsHome').click();await openLibraryDocument(page,docs.find(d=>d.title==='Other').id);gate.release();await live(page,[red,red]);
  await page.locator('#documentTabsHome').click();await openLibraryDocument(page,docs.find(d=>d.title==='Loading').id);await live(page,[white,red]);
});

test('pending isFxRegion never applies noise to the whole document',async({page},info)=>{
  const gate=await imageGate(page,'region',true);const d=doc('FX region','region');
  delete d.elements[0].layerMaskSrc;
  d.elements.push({...d.elements[0],id:'region',fillType:'none',isFxRegion:true,layerMaskSrc:source('region'),effects:[{id:'noise',type:'noise',enabled:true,amount:100,opacity:100,density:100,size:1,seed:123}]});
  const [saved]=await seed(page,[d]);await openLibraryDocument(page,saved.id);await gate.requested();
  const pending=await pixels(page.locator('#canvas'));await evidence(info,'pending-fx-pixels',pending);expect.soft(pending).toEqual([red,red]);
  gate.release();await expect.poll(async()=>{const p=await pixels(page.locator('#canvas'));return p[0].join()!==red.join()&&p[1].join()===red.join();}).toBe(true);
  const ready=pngPixels((await exportPNG(page)).image);expect(ready[0]).not.toEqual(red);expect(ready[1]).toEqual(red);
});

test('rendering masks preserves model, updatedAt, history, IDs and document writes',async({page})=>{
  await page.addInitScript(()=>{window.maskObservation={writes:0,ids:0};
    for(const method of ['put','add','delete']){const fn=IDBObjectStore.prototype[method];IDBObjectStore.prototype[method]=function(...args){if(this.name==='docs')maskObservation.writes++;return fn.apply(this,args);};}
    const uuid=Crypto.prototype.randomUUID;Crypto.prototype.randomUUID=function(...args){maskObservation.ids++;return uuid.apply(this,args);};
  });
  await imageGate(page,'split');const [saved]=await seed(page,[doc('Readonly masks')]);await openLibraryDocument(page,saved.id);
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  const model=await exportedDocument(page),stored=await records(page,'docs'),history=await page.locator('#historyEntries').innerHTML(),observed=await page.evaluate(()=>({...maskObservation}));
  for(let i=0;i<3;i++){await page.locator('#zoomOutBtn').click();await page.locator('#zoomInBtn').click();await exportPNG(page);}
  expect(await exportedDocument(page)).toEqual(model);expect(await records(page,'docs')).toEqual(stored);
  expect(await page.locator('#historyEntries').innerHTML()).toBe(history);expect(await page.evaluate(()=>maskObservation)).toEqual(observed);
});
