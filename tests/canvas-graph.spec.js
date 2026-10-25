const { test, expect, openHome, importPayload, records, openLibraryDocument, exportedDocument, canvasPoint } = require('./helpers');
const fixture = require('./fixtures/canvas-graph.json');
const linked = require('./fixtures/linked-document.json');

async function seed(page, type = 'template') {
  await openHome(page); await importPayload(page, fixture);
  let source;
  await expect.poll(async () => { source = (await records(page, 'docs')).find(d => d.title === (type === 'card' ? 'Graph series' : 'Graph template')); return source?.id; }).toBeTruthy();
  await expect(page.locator('#toast')).toContainText('Импортировано проектов');
  await page.locator(`[data-filter="${type}"]`).click();
  return source;
}
async function open(page, type) { const d = await seed(page, type); await openLibraryDocument(page, d.id); return d; }
const layer = (page, id) => page.locator(`#layers [data-layer="${id}"]`);
async function selectLayer(page, id, modifiers = []) { await layer(page, id).locator('.layer-name').click({position:{x:5,y:5}, modifiers}); }
async function selectGroup(page, id = 'outer') { await page.locator(`#layers [data-group-id="${id}"] .layer-name`).click({position:{x:5,y:5}}); }
function graph(canvas) {
  const shape = canvas.elements.find(e => e.name.startsWith('Source rectangle'));
  const text = canvas.elements.find(e => e.name.startsWith('Boundary text'));
  expect(text.pathBoundary.sourceId, 'boundary follows the copied shape').toBe(shape.id);
  expect(text.clipBaseId, 'clip follows the copied shape').toBe(shape.id);
  const child = canvas.groups.find(g => g.id === shape.groupId);
  expect(child?.name).toMatch(/^Inner/); expect(child.custom).toEqual({keep:1});
  expect(text.groupId).toBe(child.id);
  expect(canvas.groups.find(g => g.id === child.parentId)?.name).toMatch(/^Outer/);
  expect(new Set(canvas.elements.map(e => e.id)).size).toBe(canvas.elements.length);
  expect(new Set(canvas.groups.map(g => g.id)).size).toBe(canvas.groups.length);
}
async function healthy(doc) {
  const { analyzeProject } = await import('../src/model/project-integrity.mjs');
  const result = analyzeProject({id:doc.projectId},[doc]);
  expect(result.errors).toEqual([]); expect(result.warnings).toEqual([]);
}
async function saved(page, id, count) {
  let doc; await expect.poll(async()=>{doc=(await records(page,'docs')).find(d=>d.id===id);return doc?.elements.length;}).toBe(count);return doc;
}
function copies(doc, original) { return {...doc,elements:doc.elements.filter(e=>!original.elements.some(o=>o.id===e.id)),groups:doc.groups}; }
function disjoint(a,b) { const ids = new Set(a.elements.map(e=>e.id)); expect(b.elements.some(e=>ids.has(e.id))).toBe(false); }
async function unchanged(page, source) { expect((await records(page,'docs')).find(d=>d.id===source.id)).toEqual(source); }

test('single document import remaps every canvas and the active root once', async ({page}) => {
  await openHome(page);
  const source = fixture.documents[1];
  await importPayload(page,{format:'kartochnaya-v1',document:source});
  let doc; await expect.poll(async()=>{doc=(await records(page,'docs')).find(d=>d.title===source.title+' (импорт)');return doc?.id;}).toBeTruthy();
  graph(doc);doc.slides.forEach(graph);await healthy(doc);
  expect(doc.elements).toEqual(doc.slides[1].elements);expect(doc.groups).toEqual(doc.slides[1].groups);
  disjoint(doc.slides[0],doc.slides[1]);disjoint(source,doc);
  await page.reload();expect((await records(page,'docs')).find(d=>d.id===doc.id)).toEqual(doc);
  await page.locator('[data-filter="card"]').click();await openLibraryDocument(page,doc.id);
  const reopened=await exportedDocument(page);graph(reopened);expect(reopened.elements).toEqual(reopened.slides[1].elements);
});

for (const wizard of [false,true]) test(`card from template via ${wizard?'wizard':'library'} preserves graph and source`,async({page})=>{
  const source=await seed(page), beforeIds=new Set((await records(page,'docs')).map(d=>d.id));
  if(wizard){
    await page.locator('#documentTabsPlus').click();
    await page.locator(`[data-tab-picker-project="${source.projectId}"]`).click();
    await page.locator('[data-tab-picker-category="card"]').click();
    await page.locator('[data-tab-picker-create="card"]').click();
    await page.locator(`[data-tab-picker-from-template="${source.id}"]`).click();
  }else await page.locator(`[data-docid="${source.id}"] [data-projectact="card"]`).click();
  let doc;await expect.poll(async()=>{doc=(await records(page,'docs')).find(d=>d.type==='card'&&!beforeIds.has(d.id));return doc?.id;}).toBeTruthy();
  graph(doc);graph(doc.slides[0]);await healthy(doc);disjoint(source,doc);
  expect(doc.elements).toEqual(doc.slides[0].elements);await unchanged(page,source);
  await page.reload();expect((await records(page,'docs')).find(d=>d.id===doc.id)).toEqual(doc);
});

for(const action of ['duplicate','alt drag','paste']) test(`nested group ${action} keeps links, properties and title ownership`,async({page})=>{
  const source=await open(page);await selectGroup(page);
  if(action==='duplicate')await page.keyboard.press('Control+d');
  if(action==='paste'){await page.keyboard.press('Control+c');await page.keyboard.press('Control+v');}
  if(action==='alt drag'){
    const p=await canvasPoint(page,100,70);await page.keyboard.down('Alt');await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+30,p.y+25,{steps:5});await page.mouse.up();await page.keyboard.up('Alt');
  }
  const doc=await exportedDocument(page);expect(doc.elements).toHaveLength(6);
  const cp=copies(doc,source);graph(cp);expect(cp.groups).toHaveLength(4);await healthy(doc);
  expect(doc.elements.filter(e=>e.isTitleLayer)).toHaveLength(1);
  expect(doc.elements.filter(e=>source.elements.some(o=>o.id===e.id))).toEqual(source.elements);
  await saved(page,source.id,6);await page.reload();const stored=(await records(page,'docs')).find(d=>d.id===source.id);graph(copies(stored,source));await openLibraryDocument(page,source.id);graph(copies(await exportedDocument(page),source));
});

for(const mode of ['linked pair','boundary only','shape only','independent','title']) test(`copy and paste ${mode}`,async({page})=>{
  const source=await open(page);
  const ids=mode==='linked pair'?['shape-original','text-original']:mode==='boundary only'?['text-original']:mode==='shape only'?['shape-original']:mode==='title'?['title']:['independent'];
  await selectLayer(page,ids[0]);if(ids[1])await selectLayer(page,ids[1],['Control']);
  await page.keyboard.press('Control+c');await page.keyboard.press('Control+v');
  const doc=await exportedDocument(page),cp=copies(doc,source);expect(cp.elements).toHaveLength(ids.length);
  const text=cp.elements.find(e=>e.pathBoundary);
  if(text){const shape=cp.elements.find(e=>e.type==='rect');expect(text.pathBoundary.sourceId).toBe(shape?.id||'shape-original');expect(text.clipBaseId).toBe(shape?.id||'shape-original');}
  expect(doc.elements.filter(e=>e.isTitleLayer)).toHaveLength(1);await healthy(doc);
});

test('duplicate isolated clipped boundary keeps available source and title stays singular on Alt drag',async({page})=>{
  const source=await open(page);await selectLayer(page,'text-original');await page.keyboard.press('Control+d');
  let doc=await exportedDocument(page);const cp=copies(doc,source).elements[0];
  expect(cp.pathBoundary.sourceId).toBe('shape-original');expect(cp.clipBaseId).toBe('shape-original');await healthy(doc);
  await selectLayer(page,'title');const p=await canvasPoint(page,60,175);await page.keyboard.down('Alt');await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+25,p.y+20,{steps:5});await page.mouse.up();await page.keyboard.up('Alt');
  doc=await exportedDocument(page);expect(doc.elements).toHaveLength(6);expect(doc.elements.filter(e=>e.isTitleLayer)).toHaveLength(1);
});

test('template added twice through sidebar has fresh IDs on both slides',async({page})=>{
  const card=await open(page,'card');const template=(await records(page,'docs')).find(d=>d.title==='Graph template');
  for(let i=0;i<2;i++){
    await page.locator('#seriesSidebarAdd').click();await page.locator(`[data-series-template="${template.id}"]`).click();
  }
  const doc=await exportedDocument(page);expect(doc.slides).toHaveLength(4);
  graph(doc.slides[2]);graph(doc.slides[3]);disjoint(doc.slides[2],doc.slides[3]);
  expect(doc.elements).toEqual(doc.slides[3].elements);await healthy(doc);
  await saved(page,doc.id,4);await page.reload();const stored=(await records(page,'docs')).find(d=>d.id===doc.id);expect(stored.slides).toEqual(doc.slides);
});

test('legacy optional fields stay compatible on import and reload',async({page})=>{
  await openHome(page);const old=structuredClone(linked.document);delete old.groups;old.elements=old.elements.map(({groupId,...e})=>e);
  await importPayload(page,{document:old});let doc;await expect.poll(async()=>{doc=(await records(page,'docs')).find(d=>d.title===old.title+' (импорт)');return doc?.id;}).toBeTruthy();
  expect(doc.elements[1].pathBoundary.sourceId).toBe(doc.elements[0].id);await page.reload();expect((await records(page,'docs')).find(d=>d.id===doc.id)).toEqual(doc);
});


for (const type of ['template','card']) test(`duplicate whole ${type} keeps graph and allocates distinct canvas IDs`,async({page})=>{
  const source=await seed(page,type), beforeIds=new Set((await records(page,'docs')).map(d=>d.id));
  await page.locator(`[data-docid="${source.id}"] [data-projectact="duplicate"]`).click();
  let doc;await expect.poll(async()=>{doc=(await records(page,'docs')).find(d=>!beforeIds.has(d.id));return doc?.id;}).toBeTruthy();
  graph(doc);await healthy(doc);disjoint(source,doc);await unchanged(page,source);
  if(type==='card'){doc.slides.forEach(graph);disjoint(doc.slides[0],doc.slides[1]);expect(doc.elements).toEqual(doc.slides[0].elements);}
});

test('boundary copy follows its copied shape after a real transform',async({page})=>{
  const source=await open(page);await selectGroup(page);await page.keyboard.press('Control+d');
  const before=await exportedDocument(page), cp=copies(before,source), shape=cp.elements.find(e=>e.type==='rect'), text=cp.elements.find(e=>e.pathBoundary);
  await selectLayer(page,shape.id);await page.keyboard.press('ArrowRight');
  const after=await exportedDocument(page), moved=after.elements.find(e=>e.id===text.id);
  expect(after.elements.find(e=>e.id===shape.id).x).toBe(shape.x+1);expect(moved.x).toBe(text.x+1);
  expect(after.elements.find(e=>e.id==='text-original')).toEqual(before.elements.find(e=>e.id==='text-original'));
});

async function newBlankTab(page,projectId){
  await page.locator('#documentTabsPlus').click();await page.locator(`[data-tab-picker-project="${projectId}"]`).click();await page.locator('[data-tab-picker-create="template"]').click();
}
for(const pair of [false,true]) test(`paste ${pair?'pair':'boundary only'} into another document retains only available references`,async({page})=>{
  const source=await open(page);await selectLayer(page,'text-original');if(pair)await selectLayer(page,'shape-original',['Control']);await page.keyboard.press('Control+c');
  await newBlankTab(page,source.projectId);await page.keyboard.press('Control+v');
  const doc=await exportedDocument(page),text=doc.elements.find(e=>e.pathBoundary),shape=doc.elements.find(e=>e.type==='rect');
  expect(text.pathBoundary.sourceId).toBe(shape?.id||null);expect(text.pathBoundary.fallback.points.length).toBeGreaterThan(0);
  if(pair){expect(text.clipBaseId).toBe(shape.id);expect(text.clipped).toBe(true);}else{expect(text.clipBaseId).toBeUndefined();expect(text.clipped).toBe(false);}
  expect(doc.groups).toEqual([]);expect(doc.elements.every(e=>!e.groupId)).toBe(true);await healthy(doc);await unchanged(page,source);
});

for(const legacy of [false,true]) test(`isolated clipped duplicate still renders against the original base, legacy=${legacy}`,async({page})=>{
  const payload=structuredClone(fixture),doc=payload.documents[0];payload.documents=[doc];doc.title='Clip behavior';doc.groups=[];doc.backgroundAlpha=0;
  const base={...doc.elements[0],id:'clip-base',name:'Clip base',groupId:null,x:20,y:20,w:80,h:80,fill:'#00ff00'};
  doc.elements=[base,{...base,id:'clip-child',name:'Clip child',clipped:true,clipBaseId:base.id,x:0,y:0,w:200,h:160,fill:'#ff0000'},{...base,id:'other-base',name:'Other base',x:270,y:180,w:20,h:20,fill:'#0000ff'}];
  if(legacy)delete doc.elements[1].clipBaseId;
  await openHome(page);await importPayload(page,payload);let stored;await expect.poll(async()=>{stored=(await records(page,'docs')).find(d=>d.title===doc.title);return stored?.id;}).toBeTruthy();await openLibraryDocument(page,stored.id);
  await selectLayer(page,'clip-child');await page.keyboard.press('Control+d');
  const result=await exportedDocument(page);expect(result.elements.find(e=>e.name==='Clip child — копия').clipBaseId).toBe('clip-base');
  await page.locator('#layers [data-layeract="visibility"][data-id="clip-child"]').click();
  const {image}=await require('./helpers').exportPNG(page);const pixel=(x,y)=>[...image.data.subarray((y*320+x)*4,(y*320+x)*4+4)];
  expect(pixel(50,50)).toEqual([255,0,0,255]);expect(pixel(150,50)[3]).toBe(0);expect(pixel(15,50)[3]).toBe(0);
});

test('partial paste across slides does not bind to a different historical object with the same ID',async({page})=>{
  await open(page,'card');await selectLayer(page,'text-original');await page.keyboard.press('Control+c');
  await page.locator('#seriesSidebarList [data-side-slide="0"]').click();await page.keyboard.press('Control+v');
  const doc=await exportedDocument(page),text=doc.elements.find(e=>e.name==='Boundary text копия');
  expect(text.pathBoundary.sourceId).toBeNull();expect(text.clipBaseId).toBeUndefined();expect(text.clipped).toBe(false);expect(text.groupId).toBeNull();await healthy(doc);
});
