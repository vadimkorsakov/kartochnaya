const { readFile } = require('node:fs/promises');
const { PNG } = require('pngjs');
const { test, expect, openHome, importPayload, records, openLibraryDocument, exportedDocument } = require('./helpers');

test.use({serviceWorkers:'block'});
const url = name => `http://127.0.0.1:4173/png-resources/${name}.png`;
const red=[255,0,0,255], white=[255,255,255,255];
function png(kind='red') {
  const p=new PNG({width:32,height:24});
  for(let y=0;y<24;y++)for(let x=0;x<32;x++)p.data.set(kind==='split'?[255,255,255,x<16?0:255]:kind==='half'?[255,0,0,128]:red,(y*32+x)*4);
  return PNG.sync.write(p);
}
function layer(extra={}) {return {id:'resource-layer',name:'Resource',type:'rect',x:0,y:0,w:320,h:240,visible:true,opacity:100,rotation:0,fillType:'solid',fill:'#ff0000',fillOpacity:100,strokeWidth:0,...extra};}
function doc(title,elements=[layer()]) {return {id:title,projectId:'png',title,type:'template',width:320,height:240,background:'#ffffff',backgroundAlpha:100,createdAt:1,updatedAt:1,elements,groups:[],rulers:[],palette:[]};}
async function seed(page,documents,fonts=[]) {
  await openHome(page);await importPayload(page,{format:'kartochnaya-project-v1',project:{id:'png',name:'PNG resources',resources:[],resourceFolders:[]},documents,fonts});
  await expect(page.locator('#toast')).toContainText('Импортировано проектов');return (await records(page,'docs')).filter(d=>documents.some(x=>x.title===d.title));
}
async function gate(page,name,kind='red',delayed=true) {
  let released=!delayed,requests=0;const waiters=[];
  await page.route(url(name),async route=>{requests++;if(!released)await new Promise(r=>waiters.push(r));await route.fulfill({contentType:'image/png',body:kind==='broken'?Buffer.from('broken PNG'):png(kind)});});
  return {release(){released=true;waiters.splice(0).forEach(r=>r());},async requested(){await expect.poll(()=>requests).toBeGreaterThan(0);},count:()=>requests};
}
async function image(download) {return PNG.sync.read(await readFile(await download.path()));}
function pixels(p,points=[[80,120],[240,120]]) {return points.map(([x,y])=>[...p.data.subarray((y*p.width+x)*4,(y*p.width+x)*4+4)]);}
async function start(page,selector='#exportBtn') {const downloads=[];page.on('download',d=>downloads.push(d));await page.locator(selector).click();return downloads;}
async function finish(downloads,n=1) {await expect.poll(()=>downloads.length).toBe(n);return image(downloads[n-1]);}
async function evidence(info,name,value){await info.attach(name,{body:JSON.stringify(value),contentType:'application/json'});}

for(const kind of ['imageSrc','rasterSrc','effectMask','combined']) test(`delayed ${kind}: PNG pixels wait, then hot export agrees`,async({page},info)=>{
  const g=await gate(page,kind,kind==='imageSrc'||kind==='rasterSrc'?'red':'split');
  let e=layer({fillType:'image',imageSrc:url(kind)}), expected=[red,red];
  if(kind==='rasterSrc')e=layer({type:'raster',fillType:'none',rasterSrc:url(kind)});
  if(kind==='effectMask'||kind==='combined'){
    e=layer({effects:[{id:'fx',type:'noise',enabled:true,amount:100,opacity:100,density:100,size:1,seed:123,maskSrc:url(kind)}]});
    if(kind==='combined'){const base=await gate(page,'base','red',false),mask=await gate(page,'layer','split',false);e.imageSrc=url('base');e.fillType='image';e.layerMaskSrc=url('layer');expected=[white,null];void base;void mask;}else expected=[red,null];
  }
  const [saved]=await seed(page,[doc(kind,[e])]);await openLibraryDocument(page,saved.id);await g.requested();
  const downloads=await start(page);await page.waitForTimeout(180);const early=downloads.length;g.release();
  const first=await finish(downloads);await evidence(info,'pixels-and-early-download',{early,pixels:pixels(first)});
  expect.soft(early,'no file while required resource is loading').toBe(0);
  const actual=pixels(first);expect.soft(actual[0]).toEqual(expected[0]);if(expected[1])expect.soft(actual[1]).toEqual(expected[1]);else expect.soft(actual[1]).not.toEqual(red);
  const hot=await start(page);expect(pixels(await finish(hot))).toEqual(actual);
});

test('cold raster reload preserves geometry, alpha and clipping',async({page},info)=>{
  const g=await gate(page,'cold','half',false);
  const d=doc('Cold raster',[layer({id:'base',x:160,w:160,fill:'#0000ff'}),layer({type:'raster',x:80,y:40,w:160,h:160,fillType:'none',rasterSrc:url('cold'),clipped:true})]);
  const [saved]=await seed(page,[d]);
  await page.unroute(url('cold'));const delayed=await gate(page,'cold','half');
  await page.reload();await expect(page.locator('#homeScreen')).toBeVisible();await openLibraryDocument(page,saved.id);await delayed.requested();
  const downloads=await start(page);await page.waitForTimeout(180);delayed.release();const p=await finish(downloads);
  const actual=pixels(p,[[40,120],[120,120],[200,120],[280,120]]);await evidence(info,'cold-raster-pixels',actual);
  expect(actual).toEqual([white,white,[128,0,127,255],[0,0,255,255]]);void g;
});

test('shared image source uses one Image request lifecycle',async({page},info)=>{
  await page.addInitScript(()=>{window.pngImageStarts=[];const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');Object.defineProperty(HTMLImageElement.prototype,'src',{...descriptor,set(value){if(String(value).includes('/png-resources/'))pngImageStarts.push(value);return descriptor.set.call(this,value);}});});
  const g=await gate(page,'shared');const [saved]=await seed(page,[doc('Shared',[layer({fillType:'image',imageSrc:url('shared')}),layer({id:'second',x:160,w:160,fillType:'image',imageSrc:url('shared')})])]);
  await openLibraryDocument(page,saved.id);await g.requested();const downloads=await start(page);await page.waitForTimeout(180);g.release();
  expect(pixels(await finish(downloads))).toEqual([red,red]);const starts=await page.evaluate(()=>pngImageStarts.length);await evidence(info,'image-instances',{starts,requests:g.count()});expect(starts).toBe(1);
});

for(const field of ['imageSrc','rasterSrc','effectMask']) test(`broken ${field} refuses PNG without advancing numbering`,async({page},info)=>{
  const g=await gate(page,field,'broken',false);let e=layer({fillType:'image',imageSrc:url(field)});
  if(field==='rasterSrc')e=layer({type:'raster',rasterSrc:url(field),fillType:'none'});
  if(field==='effectMask')e=layer({effects:[{type:'noise',enabled:true,maskSrc:url(field)}]});
  const [saved]=await seed(page,[doc('Broken '+field,[e])]);await openLibraryDocument(page,saved.id);await g.requested();
  const before=await records(page,'projects');const downloads=await start(page);await page.waitForTimeout(250);
  await evidence(info,'failure-downloads',downloads.length);expect.soft(downloads).toHaveLength(0);expect.soft(await records(page,'projects')).toEqual(before);
  await expect(page.locator('#toast')).toContainText(/Не удалось|Ошибка/);
});

test('hidden groups, disabled effects and unused sources do not block PNG',async({page})=>{
  await gate(page,'never','broken',false);
  const d=doc('Unused',[layer(),layer({id:'hidden',visible:false,type:'raster',rasterSrc:url('never')}),layer({id:'grouped',groupId:'hidden-group',fillType:'image',imageSrc:url('never')}),layer({id:'unused',imageSrc:url('never'),effects:[{type:'noise',enabled:false,maskSrc:url('never')}]})]);d.groups=[{id:'hidden-group',visible:false}];
  const [saved]=await seed(page,[d]);await openLibraryDocument(page,saved.id);expect(pixels(await finish(await start(page)))).toEqual([red,red]);
});

function text(extra={}) {return layer({type:'text',text:'WWMi',fontFamily:'PNG Custom',fontWeight:'700',fontStyle:'italic',fontSize:64,textColor:'#000000',textAlign:'left',lineHeight:1.1,letterSpacing:0,...extra});}
test('custom face: exact family, weight, style and legacy alias render real glyphs after cold start',async({page},info)=>{
  const bytes=await readFile(require.resolve('./fixtures/fonts/DejaVuSans.ttf'));
  const fonts=[{id:'font',name:'PNG-Legacy-BoldItalic',family:'PNG Custom',weight:700,style:'italic',data:'data:font/ttf;base64,'+bytes.toString('base64')}];
  const [saved]=await seed(page,[doc('Font',[text()])],fonts);await page.reload();await expect(page.locator('#homeScreen')).toBeVisible();await openLibraryDocument(page,saved.id);
  const actual=await finish(await start(page));
  const reference=await page.evaluate(async data=>{
    const face=new FontFace('PNG Reference',`url("${data}")`,{weight:'700',style:'italic'});await face.load();document.fonts.add(face);
    const c=document.createElement('canvas');c.width=320;c.height=240;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,320,240);ctx.fillStyle='#000';ctx.font='italic 700 64px "PNG Reference"';ctx.textBaseline='top';ctx.fillText('WWMi',0,0);
    const fallback=document.createElement('canvas').getContext('2d');fallback.font='italic 700 64px Arial';
    return {pixels:[...ctx.getImageData(0,0,320,240).data],width:ctx.measureText('WWMi').width,fallbackWidth:fallback.measureText('WWMi').width,faces:[...document.fonts].filter(f=>f.family.replaceAll('\"','')==='PNG Custom').map(f=>({weight:f.weight,style:f.style,status:f.status}))};
  },fonts[0].data);
  await evidence(info,'font-evidence',{width:reference.width,fallbackWidth:reference.fallbackWidth,faces:reference.faces});
  expect(reference.width).not.toBe(reference.fallbackWidth);expect([...actual.data]).toEqual(reference.pixels);expect(reference.faces).toEqual([{weight:'700',style:'italic',status:'loaded'}]);
});

test('known failed custom font cannot silently export fallback glyphs',async({page},info)=>{
  await openHome(page);await importPayload(page,{format:'kartochnaya-v1',document:doc('Failed font',[text()]),fonts:[{id:'bad',name:'PNG Custom',family:'PNG Custom',weight:700,style:'italic',data:'data:font/ttf;base64,YmFk'}]});
  await expect(page.locator('#toast')).toContainText('Документ импортирован');const saved=(await records(page,'docs')).find(d=>d.title.startsWith('Failed font'));await openLibraryDocument(page,saved.id);
  const downloads=await start(page);await page.waitForTimeout(250);await evidence(info,'failed-font-downloads',downloads.length);expect(downloads).toHaveLength(0);await expect(page.locator('#toast')).toContainText(/шрифт/i);
});

test('document switch and layer deletion during preparation keep the original PNG snapshot',async({page},info)=>{
  const g=await gate(page,'snapshot');const docs=await seed(page,[doc('Snapshot',[layer({imageSrc:url('snapshot'),fillType:'image'})]),doc('Other',[layer({fill:'#0000ff'})])]);
  await openLibraryDocument(page,docs.find(d=>d.title==='Snapshot').id);await g.requested();const downloads=await start(page);
  await page.locator('#layers [data-select-layer-thumb]').first().click();await page.keyboard.press('Delete');
  await page.locator('#documentTabsHome').click();await openLibraryDocument(page,docs.find(d=>d.title==='Other').id);g.release();
  const actual=pixels(await finish(downloads));await evidence(info,'snapshot-pixels',actual);expect(actual).toEqual([red,red]);
});

test('preparation and repeated exports preserve model, docs, history and PNG numbering',async({page})=>{
  const g=await gate(page,'readonly');const [saved]=await seed(page,[doc('Readonly',[layer({type:'raster',rasterSrc:url('readonly'),fillType:'none'})])]);await openLibraryDocument(page,saved.id);
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');const before=await exportedDocument(page),stored=await records(page,'docs'),history=await page.locator('#historyEntries').innerHTML();
  const downloads=await start(page);await page.waitForTimeout(120);g.release();expect(pixels(await finish(downloads))).toEqual([red,red]);
  await page.locator('#exportBtn').click();await finish(downloads,2);await page.locator('#exportBtn').click();await finish(downloads,3);
  expect(downloads.map(d=>d.suggestedFilename())).toEqual(['Readonly (PNG resources (импорт)).png','Readonly (PNG resources (импорт)) 1.png','Readonly (PNG resources (импорт)) 2.png']);
  expect(await exportedDocument(page)).toEqual(before);expect(await records(page,'docs')).toEqual(stored);expect(await page.locator('#historyEntries').innerHTML()).toBe(history);
});

test('series prepares each slide sequentially; failure retains successful count and numbering',async({page},info)=>{
  const first=await gate(page,'series-first'),second=await gate(page,'series-second','broken');const d=doc('Series');d.type='card';d.hasCustomName=true;d.activeSlideIndex=0;d.elements=[layer({type:'raster',fillType:'none',rasterSrc:url('series-first')})];
  d.slides=[{...doc('first',d.elements)},{...doc('second',[layer({type:'raster',fillType:'none',rasterSrc:url('series-second')})])}];
  const [saved]=await seed(page,[d]);await page.locator('[data-filter="card"]').click();await openLibraryDocument(page,saved.id);await page.locator('#exportBtn').click();const downloads=await start(page,'#seriesExportConfirm');
  await page.waitForTimeout(180);const early=downloads.length;first.release();expect(pixels(await finish(downloads))).toEqual([red,red]);second.release();
  await expect(page.locator('#toast')).toContainText(/Экспортировано холстов: 1/);await evidence(info,'series-downloads',{early,names:downloads.map(d=>d.suggestedFilename())});expect(early).toBe(0);expect(downloads.map(d=>d.suggestedFilename())).toEqual(['Series (PNG resources (импорт)) 1.png']);
  expect(Object.values((await records(page,'projects')).find(p=>p.name.startsWith('PNG resources')).exportCounters||{})).toEqual([1]);
});
