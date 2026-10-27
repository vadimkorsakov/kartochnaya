const { test, expect, openHome, importPayload, records, openLibraryDocument, exportPNG } = require('./helpers');

test.use({ serviceWorkers: 'block' });
const rect = (id, extra = {}) => ({ id, name: `Слой ${id}`, type: 'rect', x: 15 + id.charCodeAt(0) % 8 * 35, y: 30, w: 24, h: 30, rotation: 0, visible: true, locked: false, opacity: 100, fillType: 'solid', fill: '#ab92fb', fillOpacity: 100, strokeWidth: 0, ...extra });
async function open(page, elements = ['A','B','C','D'].map(id => rect(id)), groups = []) {
  await page.addInitScript(() => {
    window.groupWrites = 0;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args) { if (this.name === 'docs') this.transaction.addEventListener('complete', () => window.groupWrites++); return put.apply(this, args); };
  });
  await openHome(page);
  await importPayload(page, { format: 'kartochnaya-project-v1', project: { id: 'group-project', name: 'Grouping', resources: [], resourceFolders: [] }, documents: [{ id: 'group-doc', projectId: 'group-project', title: 'Grouping', type: 'template', width: 320, height: 240, background: '#ffffff', backgroundAlpha: 100, createdAt: 1, updatedAt: 1, elements, groups }], fonts: [] });
  await expect(page.locator('#toast')).toContainText('Импортировано проектов');
  const doc = (await records(page, 'docs')).find(d => d.title === 'Grouping');
  await openLibraryDocument(page, doc.id);
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  return doc;
}
const row = (page, id, root = '#layers') => page.locator(`${root} [data-sort="${id}"]`);
async function choose(page, ids, root = '#layers') {
  for (let i = 0; i < ids.length; i++) await row(page, ids[i], root).locator('.layer-name').click({ modifiers: i ? ['Control'] : [] });
}
async function saved(page) {
  await expect(page.locator('#saveStatus')).toHaveText('Сохранено на этом устройстве');
  return (await records(page, 'docs')).find(d => d.title === 'Grouping');
}
const order = (page, root = '#layers') => page.locator(`${root} .layer-sort`).evaluateAll(rows => rows.map(r => r.dataset.sort));

test('two nonadjacent layers group at the upper selected position', async ({ page },info) => {
  await open(page); await choose(page, ['A','C']);
  await page.keyboard.press('Control+g');
  await expect(page.locator('#toast')).toContainText('Группа создана');
  await expect(page.locator('#layers [data-group-id]')).toHaveCount(1);
  const doc = await saved(page), group = doc.groups[0];
  expect(doc.elements.map(e => e.id)).toEqual(['B','A','C','D']);
  expect(await order(page)).toEqual(['D',group.id,'C','A','B']);
  await shot(page,info,'desktop-grouped');
});

for (const [name, names, selected, expected] of [
  ['three nonadjacent', 'ABCDEF', ['A','C','E'], ['B','D','A','C','E','F']],
  ['adjacent', 'ABCD', ['B','C'], ['A','B','C','D']],
  ['document extremes', 'ABCD', ['A','D'], ['B','C','A','D']],
]) test(`${name} preserves order and geometry`, async ({ page }) => {
  const before = await open(page, names.split('').map(id => rect(id)));
  await choose(page, selected); await page.keyboard.press('Control+g');
  await expect(page.locator('#toast')).toContainText('Группа создана');
  const d = await saved(page), id = d.groups[0].id;
  expect(d.elements.map(e => e.id)).toEqual(expected);
  expect(d.elements.filter(e => e.groupId === id).map(e => e.id)).toEqual(selected);
  for (const e of d.elements) { const {groupId,...rest} = e; expect(rest).toEqual(before.elements.find(x => x.id === e.id)); }
  await page.keyboard.press('Control+Shift+g');
  expect((await saved(page)).elements.map(e => e.id)).toEqual(expected);
});

const folder = (id, extra = {}) => ({id,name:`Папка ${id}`,visible:true,locked:false,collapsed:false,...extra});
for (const mode of ['group and layer','two groups','nested groups','collapsed group','inside parent','group plus descendant']) test(`${mode} moves complete blocks`, async ({ page }) => {
  const parent = mode === 'inside parent' ? 'parent' : null;
  const nested = mode === 'nested groups';
  const groups = [folder('one',{parentId:parent,collapsed:mode==='collapsed group'}), ...(nested?[folder('inner',{parentId:'one'})]:[]), ...(mode==='two groups'?[folder('two')]:[]), ...(parent?[folder(parent)]:[])];
  const elements = [rect('A',{groupId:nested?'inner':'one'}),rect('B',{groupId:'one'}),rect('gap',{groupId:parent}),rect('C',{groupId:mode==='two groups'?'two':parent}),rect('D',{groupId:parent})];
  const before = await open(page,elements,groups);
  const chosen = mode === 'group plus descendant' ? ['A','one','C'] : ['one',mode==='two groups'?'two':'C'];
  await choose(page,chosen); await page.keyboard.press('Control+g');
  await expect(page.locator('#toast')).toContainText('Группа создана');
  const d=await saved(page), created=d.groups.find(g=>!groups.some(x=>x.id===g.id));
  expect(d.elements.map(e=>e.id)).toEqual(['gap','A','B','C','D']);
  expect(created.parentId).toBe(parent); expect(d.groups.find(g=>g.id==='one').parentId).toBe(created.id);
  expect(d.elements.slice(1,3)).toEqual(before.elements.slice(0,2));
  if(nested)expect(d.groups.find(g=>g.id==='inner')).toEqual(before.groups.find(g=>g.id==='inner'));
  if(mode==='two groups')expect(d.groups.find(g=>g.id==='two').parentId).toBe(created.id);
  expect(new Set([...d.elements,...d.groups].map(e=>e.id)).size).toBe(d.elements.length+d.groups.length);
});

const history = page => page.locator('#historyEntries [data-history-index]').evaluateAll(rows => ({length:rows.length,index:rows.findIndex(r=>r.getAttribute('aria-current')==='step')}));
test('one Undo restores ordering, hierarchy and selection; Redo persists; a new edit invalidates Redo', async ({ page }) => {
  const original=await open(page); await choose(page,['A','C']); const h=await history(page);
  await page.keyboard.press('Control+g'); const grouped=await saved(page);
  expect(await history(page)).toEqual({length:h.length+1,index:h.index+1});
  await page.keyboard.press('Control+z');
  expect(await order(page)).toEqual(['D','C','B','A']);
  await expect(page.locator('#layers .selected')).toHaveCount(2);
  expect(await page.locator('#layers .selected').evaluateAll(rows=>rows.map(r=>r.dataset.sort))).toEqual(['C','A']);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('#layers .group-row.selected')).toHaveAttribute('data-group-id',grouped.groups[0].id);
  expect((await saved(page)).elements).toEqual(grouped.elements);
  await page.reload(); await openLibraryDocument(page,original.id);
  expect(await order(page)).toEqual(['D',grouped.groups[0].id,'C','A','B']);
  // New session: exercise invalidation after a fresh atomic group operation.
  await choose(page,['B','D']); await page.keyboard.press('Control+g'); await page.keyboard.press('Control+z');
  await row(page,'D').locator('.layer-thumb').click(); await page.keyboard.press('Control+d');
  await expect(page.locator('#redoBtn')).toBeDisabled();
});

for (const mode of ['base only','clipped only','different parents','region crossing']) test(`reject ${mode} before history or docs.put`, async ({ page }) => {
  let elements=[rect('A'),rect('clip',{clipped:true,clipBaseId:'A'}),rect('B'),rect('C')], groups=[];
  if(mode==='different parents'){groups=[folder('one')];elements=[rect('A',{groupId:'one'}),rect('B'),rect('C')];}
  if(mode==='region crossing')elements=[rect('A'),rect('FX',{isFxRegion:true,fillType:'none',effects:[]}),rect('C')];
  const original=await open(page,elements,groups); await choose(page,[mode==='clipped only'?'clip':'A','C']);
  const h=await history(page), writes=await page.evaluate(()=>window.groupWrites), tree=await order(page);
  await page.keyboard.press('Control+g');
  await expect(page.locator('#toast')).toContainText(mode==='different parents'?'одного уровня':mode==='region crossing'?'эффекта выделения':'обтравочную маску');
  await page.waitForTimeout(600); // Observe beyond the existing 420ms save debounce.
  expect(await history(page)).toEqual(h); expect(await order(page)).toEqual(tree);
  expect(await page.evaluate(()=>window.groupWrites)).toBe(writes);
  expect((await records(page,'docs')).find(d=>d.id===original.id)).toEqual(original);
});

for(const mode of ['whole chain','unselected chain','nested chain']) test(`${mode} retains clipBaseId, mask and PNG pixels`,async({page})=>{
  const { PNG }=require('pngjs'), mask=new PNG({width:320,height:240}); mask.data.fill(255);
  const maskSrc='data:image/png;base64,'+PNG.sync.write(mask).toString('base64');
  const nested=mode==='nested chain';
  const base=rect('A',{groupId:nested?'inner':null,x:15,y:30,w:24,h:30,fill:'#00ff00',layerMaskSrc:maskSrc});
  const clip=rect('clip',{groupId:nested?'inner':null,clipped:true,clipBaseId:'A',x:10,y:25,w:35,h:40,fill:'#ff0000'});
  const elements=mode==='unselected chain'?[rect('B'),base,clip,rect('C')]:[base,clip,rect('B'),rect('C')];
  await open(page,elements,nested?[folder('outer'),folder('inner',{parentId:'outer'})]:[]);
  const before=(await exportPNG(page)).image.data;
  await choose(page,nested?['outer','C']:mode==='unselected chain'?['B','C']:['A','clip','C']);
  await page.keyboard.press('Control+g'); await expect(page.locator('#toast')).toContainText('Группа создана');
  const d=await saved(page); expect(d.elements.find(e=>e.id==='clip').clipBaseId).toBe('A');
  expect(d.elements.find(e=>e.id==='A').layerMaskSrc).toBe(maskSrc);
  expect((await exportPNG(page)).image.data.equals(before)).toBe(true);
});

test('grouping above a masked effect region keeps its data and rendered backdrop',async({page})=>{
  const {PNG}=require('pngjs'), mask=new PNG({width:320,height:240});mask.data.fill(255);
  const region=rect('FX',{isFxRegion:true,x:0,y:0,w:320,h:240,fillType:'none',layerMaskSrc:'data:image/png;base64,'+PNG.sync.write(mask).toString('base64'),effects:[{id:'blur',type:'gaussianBlur',radius:5,enabled:true,opacity:100}]});
  await open(page,[rect('A'),region,rect('B'),rect('C'),rect('D')]);
  const before=await saved(page), png=(await exportPNG(page)).image.data;
  await choose(page,['B','D']);await page.keyboard.press('Control+g');
  await expect(page.locator('#toast')).toContainText('Группа создана');
  const after=await saved(page);
  expect(after.elements.map(e=>e.id)).toEqual(['A','FX','C','B','D']);
  expect(after.elements.find(e=>e.isFxRegion)).toEqual(before.elements.find(e=>e.isFxRegion));
  expect((await exportPNG(page)).image.data.equals(png)).toBe(true);
});

async function shot(page,info,name,root='#layers') {
  await expect(page.locator('#toast')).not.toHaveClass(/\bshow\b/);
  const file=info.outputPath(`${name}.png`); await page.locator(root).screenshot({path:file});
  await info.attach(name,{path:file,contentType:'image/png'});
}
async function compact(page,root) {
  const measures=await page.locator(root).evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,rows:[...el.querySelectorAll('.layer-sort')].map(r=>{const b=r.getBoundingClientRect(),name=r.querySelector('.layer-name'),n=name.getBoundingClientRect(),thumb=r.querySelector('.layer-thumb').getBoundingClientRect();return {inset:parseFloat(getComputedStyle(r).paddingLeft),left:b.left,right:b.right,nameRight:n.right,actionsRight:r.querySelector('.layer-actions')?.getBoundingClientRect().right||b.right,folder:!!r.querySelector('.folder-icon'),thumb:thumb.width,height:b.height};})}));
  expect(measures.scroll).toBeLessThanOrEqual(measures.width);
  for(const r of measures.rows){expect(r.inset).toBeLessThanOrEqual(6);expect(r.nameRight).toBeLessThanOrEqual(r.right);expect(r.actionsRight).toBeLessThanOrEqual(r.right);expect(r.thumb).toBe(r.folder?18:root==='#layers'?38:32);expect(r.height).toBeGreaterThanOrEqual(30);}
}
const treeGroups=[folder('outer'),folder('middle',{parentId:'outer'}),folder('inner',{parentId:'middle'}),folder('deep',{parentId:'inner'})];
const treeElements=[rect('A',{groupId:'deep',name:'Очень длинное название слоя, которое должно обрезаться многоточием'}),rect('B',{groupId:'outer'}),rect('C'),rect('D')];
test('desktop tree containers, SVGs, disclosure, narrow panel, controls, rename and drag',async({page},info)=>{
  await open(page,treeElements,treeGroups);
  await compact(page,'#layers'); await shot(page,info,'desktop-expanded');
  const group=row(page,'outer'), toggle=group.locator('[data-folder-toggle]');
  await expect(toggle).toHaveAttribute('aria-expanded','true'); await expect(toggle.locator('svg path')).toHaveAttribute('d','M6 9l6 6 6-6');
  const gap=await group.evaluate(r=>{const a=r.querySelector('.folder-toggle').getBoundingClientRect(),b=r.querySelector('.folder-icon').getBoundingClientRect();return b.left-a.right;});
  expect(gap).toBeGreaterThanOrEqual(4); expect(gap).toBeLessThanOrEqual(6);
  await expect(page.locator('[data-group-container="deep"] [data-layer="A"]')).toHaveCount(1);
  await choose(page,['C']); await toggle.click(); await expect(row(page,'A')).toHaveCount(0);
  await expect(row(page,'C')).toHaveClass(/selected/); await expect(toggle.locator('svg path')).toHaveAttribute('d','M9 6l6 6-6 6');
  await shot(page,info,'desktop-collapsed'); await toggle.click();
  await group.locator('[data-layeract="visibility"]').click(); await expect(row(page,'A')).toHaveClass(/tree-hidden/);
  await group.locator('[data-layeract="visibility"]').click();
  await group.locator('[data-layeract="lock"]').click(); await expect(row(page,'A')).toHaveClass(/tree-locked/);
  await group.locator('[data-layeract="lock"]').click();
  await row(page,'A').locator('.layer-name').dblclick(); await page.locator('.layer-rename-input').fill('Переименованный слой'); await page.locator('.layer-rename-input').press('Enter');
  await expect(row(page,'A').locator('.layer-name')).toHaveText('Переименованный слой');
  const resize=page.locator('#layerPanelResize');
  const handle=await resize.boundingBox(); await page.mouse.move(handle.x+handle.width/2,handle.y+100); await page.mouse.down(); await page.mouse.move(handle.x-80,handle.y+100,{steps:8}); await page.mouse.up();
  await compact(page,'#layers'); await shot(page,info,'desktop-narrow');
  expect(await row(page,'A').locator('.layer-name').evaluate(e=>e.getBoundingClientRect().width)).toBeGreaterThan(40);
  const a=await row(page,'D').locator('.layer-thumb').boundingBox(), b=await row(page,'C').boundingBox();
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2); await page.mouse.down(); await page.mouse.move(b.x+20,b.y+b.height-3,{steps:8}); await page.mouse.up();
  expect((await saved(page)).elements.map(e=>e.id)).toEqual(['A','B','D','C']);
});

for(const action of ['duplicate','copy']) test(`regrouped nested graph ${action} retains linked text, clipping and unique IDs`,async({page})=>{
  const fixture=require('./fixtures/canvas-graph.json').documents[0];
  await open(page,fixture.elements,fixture.groups);
  await choose(page,['outer','independent']); await page.keyboard.press('Control+g');
  const grouped=await saved(page), root=grouped.groups.find(g=>!fixture.groups.some(x=>x.id===g.id));
  await expect(row(page,root.id)).toHaveClass(/selected/);
  if(action==='duplicate')await page.keyboard.press('Control+d');
  else{await page.keyboard.press('Control+c');await page.keyboard.press('Control+v');}
  const d=await saved(page), copies=d.elements.filter(e=>!grouped.elements.some(x=>x.id===e.id));
  expect(copies).toHaveLength(3);
  const text=copies.find(e=>e.pathBoundary),shape=copies.find(e=>e.type==='rect');
  expect(text.pathBoundary.sourceId).toBe(shape.id); expect(text.clipBaseId).toBe(shape.id);
  expect(d.groups.find(g=>g.id===shape.groupId).parentId).not.toBe('outer');
  expect(new Set([...d.elements,...d.groups].map(e=>e.id)).size).toBe(d.elements.length+d.groups.length);
  expect(d.elements.filter(e=>grouped.elements.some(x=>x.id===e.id))).toEqual(grouped.elements);
  await page.reload(); await openLibraryDocument(page,d.id);
  expect((await records(page,'docs')).find(x=>x.id===d.id).elements).toEqual(d.elements);
});

test.describe('mobile tree',()=>{
  test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  test('same containers and disclosure, touch controls, grouping and drag handle',async({page},info)=>{
    await open(page,treeElements,treeGroups);
    await page.locator('#mobileToolbars [data-mobile="layers"]:visible').tap();
    const root='#mobileLayerList'; await compact(page,root); await shot(page,info,'mobile-expanded',root);
    const toggle=row(page,'outer',root).locator('[data-folder-toggle]');
    await toggle.tap(); await expect(row(page,'A',root)).toHaveCount(0); await expect(toggle).toHaveAttribute('aria-expanded','false');
    await shot(page,info,'mobile-collapsed',root); await toggle.tap();
    await row(page,'outer',root).locator('[data-layeract="lock"]').tap(); await expect(row(page,'A',root)).toHaveClass(/tree-locked/);
    await row(page,'outer',root).locator('[data-layeract="lock"]').tap();
    await page.locator('#mobileLayersSelect').tap();
    await row(page,'outer',root).locator('.layer-name').tap(); await row(page,'D',root).locator('.layer-name').tap();
    await page.locator('[data-multi-action="group"]').tap(); await expect(page.locator('#toast')).toContainText('Группа создана');
    const d=await saved(page), created=d.groups.find(g=>!treeGroups.some(x=>x.id===g.id));
    expect(d.elements.map(e=>e.id)).toEqual(['C','A','B','D']);
    await compact(page,root); await shot(page,info,'mobile-grouped',root);
    await row(page,'outer',root).locator('[data-folder-toggle]').tap();
    await row(page,'C',root).scrollIntoViewIfNeeded();
    const a=await row(page,'C',root).locator('.mobile-drag-handle').boundingBox(), b=await row(page,created.id,root).boundingBox();
    await page.mouse.move(a.x+a.width/2,a.y+a.height/2); await page.mouse.down(); await page.mouse.move(b.x+45,b.y+2,{steps:8}); await page.mouse.up();
    expect((await saved(page)).elements.map(e=>e.id)).toEqual(['A','B','D','C']);
  });
});
