const {test,expect,openHome,importPayload,records,openLibraryDocument,exportPNG,canvasPoint}=require('./helpers');
const {PNG}=require('pngjs');
const fixture=require('./fixtures/canvas-graph.json');
const surface='#inlineWysiwyg';
test.describe.configure({timeout:60000});
// Test-only module routes must reach Playwright rather than the PWA worker.
test.use({serviceWorkers:'block'});

async function seed(page,patch={},url='/'){
 await page.setViewportSize({width:1600,height:1100});
 await page.addInitScript(()=>{
  window.alignmentDraws=[];window.alignmentExport=[];
  const p=CanvasRenderingContext2D.prototype,fill=p.fillText,clear=p.clearRect;
  p.clearRect=function(...args){if(this.canvas.id==='canvas')window.alignmentDraws=[];return clear.apply(this,args)};
  p.fillText=function(text,x,y,...args){
   const out=this.canvas.id==='canvas'?window.alignmentDraws:window.captureAlignmentExport?window.alignmentExport:null;
   if(out)out.push({text,x,y,width:this.measureText(text).width});return fill.call(this,text,x,y,...args);
  };
 });
 await openHome(page,url);const payload=structuredClone(fixture);payload.documents=[payload.documents[0]];
 const doc=payload.documents[0];doc.groups=[];doc.background='#ffffff';doc.elements=doc.elements.filter(e=>e.id==='title');
 Object.assign(doc.elements[0],{text:'ABCD',x:20,y:40,w:280,h:170,fontFamily:'Arial',fontSize:24,lineHeight:1.2,letterSpacing:0,textColor:'#111111',autoFontSize:false,rotation:0,textAlign:'left',verticalAlign:'top',...patch});
 await importPayload(page,payload);await expect(page.locator('#toast')).toContainText('Импортировано проектов');
 const stored=(await records(page,'docs')).find(d=>d.elements.some(e=>e.id==='title'));await openLibraryDocument(page,stored.id);
 for(let i=0;i<60;i++){const z=parseInt(await page.locator('#zoomLabel').textContent());if(z===100)break;await page.locator(z>100?'#zoomOutBtn':'#zoomInBtn').click()}
 await expect(page.locator('#zoomLabel')).toHaveText('100%');return stored.elements[0];
}
async function edit(page,live=true){
 await page.locator('#layers [data-layer="title"] .layer-name').click();const p=await canvasPoint(page,55,57);await page.mouse.dblclick(p.x,p.y);
 await expect(page.locator(live?surface:'#inlineText')).toBeFocused();await expect(page.locator(live?'#inlineText':surface)).toBeHidden();
}
async function model(page){return page.evaluate(async()=>{
 const click=HTMLAnchorElement.prototype.click;let url;
 HTMLAnchorElement.prototype.click=function(...args){if(this.download?.endsWith('.json'))url=this.href;else return click.apply(this,args)};
 try{document.querySelector('#jsonExportBtn').click();return (await (await fetch(url)).json()).document.elements.find(e=>e.id==='title')}finally{HTMLAnchorElement.prototype.click=click}
})}
async function selection(page){return page.locator(surface).evaluate(host=>{
 const s=getSelection(),offset=(n,i)=>{const r=document.createRange();r.setStart(host,0);r.setEnd(n,i);return r.toString().length};
 return {anchor:offset(s.anchorNode,s.anchorOffset),focus:offset(s.focusNode,s.focusOffset)};
})}
async function select(page,anchor,focus){
 await page.locator(surface).focus();await page.keyboard.press('Control+Home');const text=await page.locator(surface).textContent();
 const count=i=>[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text.slice(0,i))].length;
 for(let i=0;i<count(anchor);i++)await page.keyboard.press('ArrowRight');
 for(let i=0;i<Math.abs(count(anchor)-count(focus));i++)await page.keyboard.press(focus<anchor?'Shift+ArrowLeft':'Shift+ArrowRight');
 expect(await selection(page)).toEqual({anchor,focus});
}
async function align(page,value){
 await page.locator(`#inspector [data-align="${value==='center'?'hcenter':value}"]`).first().click();
 await expect(page.locator(surface)).toBeFocused();await expect(page.locator('#wysiwygRecovery')).toBeHidden();
 expect((await model(page)).textAlign).toBe(value);
}
async function geometry(page){return page.locator(surface).evaluate(host=>{
 const h=host.getBoundingClientRect(),scale=h.width/parseFloat(host.style.width);
 return [...host.querySelectorAll('[data-wysiwyg-row]')].map(row=>({
  y:(row.getBoundingClientRect().y-h.y)/scale,
  parts:[...row.children].map(span=>{
   const r=span.getBoundingClientRect(),text=span.textContent.replace(/\n$/,'');
   // Independently measure the browser's inline alphabetic baseline; a Range
   // rectangle alone reports the glyph box, not the Canvas baseline.
   const probe=document.createElement('div'),copy=span.cloneNode(false),marker=document.createElement('span');
   probe.style.cssText='position:fixed;left:-100000px;top:0;visibility:hidden;white-space:pre;width:max-content;padding:0;border:0;margin:0';
   copy.style.position='static';copy.style.marginLeft='0';copy.style.verticalAlign='baseline';copy.append(document.createTextNode(text||'Mg'));
   marker.style.cssText='display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline';copy.append(marker);probe.append(copy);document.body.append(probe);
   const baseline=marker.getBoundingClientRect().top-copy.getBoundingClientRect().top;probe.remove();
   return {text,x:(r.x-h.x)/scale,y:(r.y-h.y)/scale+baseline,width:r.width/scale};
  })
 }));
})}
function diff(a,b){let changed=0,above2=0,max=0;for(let i=0;i<a.length;i+=4){const d=Math.max(...[0,1,2,3].map(k=>Math.abs(a[i+k]-b[i+k])));if(d)changed++;if(d>2)above2++;max=Math.max(max,d)}return {changed,above2,max}}
async function parity(page,info,label){
 await info.attach(label+'-editor.png',{body:await page.screenshot(),contentType:'image/png'});
 const live=await page.locator('[data-text-stroke-overlay]').evaluate(ink=>{
  const c=document.createElement('canvas');c.width=320;c.height=240;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,320,240);ctx.drawImage(ink,0,0,320,240);return [...ctx.getImageData(0,0,320,240).data];
 });
 await page.keyboard.press('Control+Enter');await expect(page.locator(surface)).toBeHidden();
 const p=await canvasPoint(page,310,230);await page.mouse.click(p.x,p.y);
 const screen=await page.locator('#canvas').evaluate(c=>[...c.getContext('2d').getImageData(0,0,c.width,c.height).data]);
 const png=await exportPNG(page),result={canvas:diff(screen,png.image.data),wysiwyg:diff(live,png.image.data)};
 await info.attach(label+'.json',{body:JSON.stringify(result),contentType:'application/json'});
 await info.attach(label+'-live.png',{body:PNG.sync.write({width:320,height:240,data:Buffer.from(live)}),contentType:'image/png'});
 await info.attach(label+'-export.png',{body:png.bytes,contentType:'image/png'});
 console.log('Alignment pixel parity',info.project.name,label,JSON.stringify(result));
 expect(result.canvas.max).toBeLessThanOrEqual(1);expect(result.wysiwyg.max).toBeLessThanOrEqual(2);expect(result.wysiwyg.above2).toBe(0);
}

for(const verticalAlign of ['top','middle','bottom'])for(const textAlign of ['center','right'])test(`aligned input, UTF-16, Enter and empty caret: ${verticalAlign} ${textAlign}`,async({page})=>{
 await seed(page,{text:'A😀B',textAlign,verticalAlign});await edit(page);
 await select(page,3,1);await align(page,textAlign==='center'?'right':'center');expect(await selection(page)).toEqual({anchor:3,focus:1});
 await page.keyboard.press('Control+c');
 await page.keyboard.type('X');expect((await model(page)).text).toBe('AXB');await page.keyboard.press('Control+z');expect(await selection(page)).toEqual({anchor:3,focus:1});
 await select(page,3,3);await page.keyboard.press('Delete');expect((await model(page)).text).toBe('A😀');await page.keyboard.press('Backspace');expect((await model(page)).text).toBe('A');
 await page.keyboard.press('Enter');expect(await selection(page)).toEqual({anchor:2,focus:2});
 let rows=await geometry(page);expect(rows).toHaveLength(2);expect(rows[1].y).toBeGreaterThan(rows[0].y);
 const e=await model(page);expect(Math.abs(rows[1].parts[0].x-(e.textAlign==='right'?e.w:e.w/2))).toBeLessThan(.05);
 expect(await page.locator(surface).evaluate(host=>getSelection().focusNode.parentElement.closest('[data-wysiwyg-row]')===host.querySelectorAll('[data-wysiwyg-row]')[1])).toBe(true);
 await page.keyboard.type('Z');expect((await model(page)).text).toBe('A\nZ');
 await page.keyboard.press('Control+a');await page.keyboard.press('Backspace');await expect(page.locator(surface)).toBeFocused();
 rows=await geometry(page);expect(Math.abs(rows[0].parts[0].x-(e.textAlign==='right'?e.w:e.w/2))).toBeLessThan(.05);
 await page.keyboard.type('Q');expect((await model(page)).text).toBe('Q');
 await page.keyboard.press('Control+v');expect((await model(page)).text).toBe('Q😀');expect(await selection(page)).toEqual({anchor:3,focus:3});
 await page.keyboard.press('Control+z');expect((await model(page)).text).toBe('Q');
});

for(const autoFontSize of [false,true])test(`live alignment history, forward/backward range and caret auto=${autoFontSize}`,async({page})=>{
 const initial=await seed(page,{text:'A😀BC\nDEFG',autoFontSize,textRuns:[{start:1,end:5,style:{fontSize:30,letterSpacing:2,fontFamily:'Georgia',fontWeight:'700',fontStyle:'italic',underline:true,strikethrough:true}}]});await edit(page);
 const host=await page.locator(surface).elementHandle();let previous=await model(page);
 for(const [target,a,b] of [['center',5,1],['right',1,5],['left',3,3]]){
  await select(page,a,b);await align(page,target);const changed=await model(page);
  expect(changed).toEqual({...previous,textAlign:target});expect(await selection(page)).toEqual({anchor:a,focus:b});
  expect(await host.evaluate(el=>el===document.querySelector('#inlineWysiwyg'))).toBe(true);
  await page.keyboard.press('Control+z');expect(await model(page)).toEqual(previous);expect(await selection(page)).toEqual({anchor:a,focus:b});
  await page.keyboard.press('Control+Shift+z');expect(await model(page)).toEqual(changed);expect(await selection(page)).toEqual({anchor:a,focus:b});previous=changed;
 }
 expect(previous.fontSize).toBe(initial.fontSize);expect(previous.textRuns).toEqual(initial.textRuns);
 await page.keyboard.type('X');expect((await model(page)).text).toBe('A😀XBC\nDEFG');await page.keyboard.press('Control+z');expect(await model(page)).toEqual(previous);
 // End with a real model change: returning left→center→right→left alone
 // is intentionally a no-op when closing the session.
 await align(page,'center');const final=await model(page);
 await page.keyboard.press('Control+Enter');await page.locator('#undoBtn').click();expect(await model(page)).toEqual(previous);await page.locator('#redoBtn').click();expect(await model(page)).toEqual(final);
});

test('alignment on a plain layer never creates textRuns',async({page})=>{
 await seed(page);await edit(page);for(const value of ['center','right','left']){await align(page,value);expect((await model(page)).textRuns).toBeUndefined()}
});

for(const [name,patch] of [
 ['single',{text:'ABCD'}],['LF and blanks',{text:'AB\n\nC\n'}],['soft wrap',{text:'Alpha beta gamma delta epsilon',w:145}],
 ['mixed sizes/tracking',{text:'ABCD EFGH\nIJKL',textRuns:[{start:1,end:3,style:{fontSize:35,fontFamily:'Georgia',letterSpacing:2}},{start:7,end:12,style:{letterSpacing:-1,fontWeight:'700',fontStyle:'italic'}}]}],
 ['wrap threshold below',{text:'MMMM MMMM',w:159.9}],['wrap threshold above',{text:'MMMM MMMM',w:160.1}],
 ['auto fit',{text:'Alpha beta gamma delta epsilon',w:145,h:100,autoFontSize:true}]
])test(`shared row and caret geometry: ${name}`,async({page},info)=>{
 await seed(page,patch);const evidence=[];
 if(name.startsWith('wrap threshold')){
  await page.locator('#layers [data-layer="title"] .layer-name').click();
  const width=await page.evaluate(()=>{const c=document.createElement('canvas').getContext('2d');c.font='normal 400 24px Arial';c.fontKerning='normal';return c.measureText('MMMM MMMM').width});
  const input=page.locator('#inspector [data-key=w]');await input.fill(String(width+(name.endsWith('below')?-.05:.05)));await input.press('Tab');
 }
 for(const textAlign of ['left','center','right']){
  await edit(page);await align(page,textAlign);const e=await model(page),rows=await geometry(page);
  if(name.startsWith('wrap threshold'))expect(rows).toHaveLength(name.endsWith('below')?2:1);
  for(const row of rows){
   const width=row.parts.reduce((n,p)=>n+p.width,0),expected=textAlign==='center'?(e.w-width)/2:textAlign==='right'?e.w-width:0;
   expect(Math.abs(row.parts[0].x-expected)).toBeLessThan(.25);
  }
  // Home/End must select the actual start/end of every visual row, including
  // soft-wrap boundaries where one source offset belongs to two row boxes.
  await page.keyboard.press('Control+Home');
  for(let i=0;i<rows.length;i++){
   if(i)await page.keyboard.press('ArrowDown');
   for(const key of ['Home','End']){
    await page.keyboard.press(key);
    const caret=await page.locator(surface).evaluate(host=>{const s=getSelection(),r=s.getRangeAt(0).getBoundingClientRect(),h=host.getBoundingClientRect(),scale=h.width/parseFloat(host.style.width),node=s.focusNode.nodeType===3?s.focusNode.parentElement:s.focusNode;return {row:[...host.querySelectorAll('[data-wysiwyg-row]')].indexOf(node.closest('[data-wysiwyg-row]')),x:(r.x-h.x)/scale}});
    expect(caret.row).toBe(i);const part=key==='Home'?rows[i].parts[0]:rows[i].parts.at(-1),x=part.x+(key==='End'?part.width:0);
    // Empty native Range rectangles can be omitted by Gecko; fragment boxes
    // above still establish their canonical position.
    if(rows[i].parts.some(p=>p.text))expect(Math.abs(caret.x-x)).toBeLessThan(.75);
   }
  }
  await page.keyboard.press('Control+Enter');const draws=await page.evaluate(()=>window.alignmentDraws);
  const parts=rows.flatMap(r=>r.parts).filter(p=>p.text);expect(parts.map(p=>p.text)).toEqual(draws.map(p=>p.text));
  const errors=parts.map((p,i)=>({x:Math.abs(p.x-draws[i].x),width:Math.abs(p.width-draws[i].width),baseline:Math.abs(p.y-draws[i].y)}));for(const error of errors){expect(error.x).toBeLessThan(.25);expect(error.width).toBeLessThan(.25);expect(error.baseline).toBeLessThan(.25)}
  await page.evaluate(()=>{window.alignmentExport=[];window.captureAlignmentExport=true});await exportPNG(page);expect(await page.evaluate(()=>{window.captureAlignmentExport=false;return window.alignmentExport})).toEqual(draws);
  evidence.push({textAlign,errors});
 }
 await info.attach('geometry.json',{body:JSON.stringify(evidence),contentType:'application/json'});
 console.log('Alignment geometry maxima',info.project.name,name,JSON.stringify({x:Math.max(0,...evidence.flatMap(e=>e.errors.map(r=>r.x))),width:Math.max(0,...evidence.flatMap(e=>e.errors.map(r=>r.width))),baseline:Math.max(0,...evidence.flatMap(e=>e.errors.map(r=>r.baseline)))}));
});

for(const strokeStyle of ['solid','dashed','dotted'])for(const textAlign of ['center','right'])test(`strict pixel parity ${textAlign} ${strokeStyle}`,async({page},info)=>{
 await seed(page,{text:'AB fi\nCD EF',textAlign,fontSize:26,strokeWidth:2,stroke:'#cc2244',strokeOpacity:60,strokeStyle,fillOpacity:75,underline:true,strikethrough:true,textRuns:[{start:1,end:4,style:{fontFamily:'Georgia',fontSize:32,fontWeight:'700',fontStyle:'italic',letterSpacing:1,strokeWidth:3,strokeOpacity:40,strokeStyle,fillOpacity:50}}]});
 await edit(page);await select(page,4,1);await align(page,textAlign==='center'?'right':'center');await align(page,textAlign);await parity(page,info,textAlign+'-'+strokeStyle);
});

for(const [name,patch,url] of [
 ['justify',{textAlign:'justify'}],['vertical',{textMode:'vertical'}],['rotation',{rotation:10}],['mask',{mask:true}],['clipping',{clipped:true}],['effect',{effects:[{type:'blur',enabled:true}]}],['invalid vertical alignment',{verticalAlign:'justify'}],['blend',{blendMode:'multiply'}],['path',{textMode:'path'}],['opt-out',{textAlign:'right'},'/?experimentalTextWysiwyg=0']
])test(`alignment fallback: ${name}`,async({page})=>{await seed(page,{textAlign:'center',...patch},url);await edit(page,false)});
test('alignment fallback: mobile width',async({page})=>{
 await seed(page,{textAlign:'right'});await page.setViewportSize({width:700,height:900});
 const p=await canvasPoint(page,55,57);await page.mouse.dblclick(p.x,p.y);await expect(page.locator('#inlineText')).toBeVisible();await expect(page.locator(surface)).toBeHidden();
});

test.describe('coarse pointer',()=>{
 test.use({hasTouch:true});
 test('alignment fallback on a desktop-sized touch viewport',async({page})=>{
  await seed(page,{textAlign:'center'});expect(await page.evaluate(()=>matchMedia('(pointer:coarse)').matches)).toBe(true);await edit(page,false);
 });
});

async function vertical(page,value){
 await page.locator(`#inspector [data-align="${value==='middle'?'vcenter':value}"]`).first().click();
 await expect(page.locator(surface)).toBeFocused();await expect(page.locator('#inlineText')).toBeHidden();await expect(page.locator('#wysiwygRecovery')).toBeHidden();
 expect((await model(page)).verticalAlign).toBe(value);
}
for(const verticalAlign of ['top','middle','bottom'])for(const textAlign of ['left','center','right'])test(`vertical eligibility ${verticalAlign} ${textAlign}`,async({page})=>{
 await seed(page,{verticalAlign,textAlign,text:'AB\nCD'});const before=await model(page);await edit(page);
 expect(await model(page)).toEqual(before);
 const rows=await geometry(page);await page.keyboard.press('Control+Enter');expect(await model(page)).toEqual(before);
 const draws=await page.evaluate(()=>window.alignmentDraws);
 for(const [i,p] of rows.flatMap(r=>r.parts).entries())expect(Math.abs(p.y-draws[i].y)).toBeLessThan(.25);
});

for(const autoFontSize of [false,true])test(`vertical live history and exact layer preservation auto=${autoFontSize}`,async({page})=>{
 await seed(page,{text:'A😀BC\nDEFG',autoFontSize,strokeWidth:2,stroke:'#cc2244',strokeOpacity:60,fillOpacity:75,strokeStyle:'dotted',underline:true,strikethrough:true,textRuns:[{start:1,end:5,style:{fontSize:30,letterSpacing:2,lineHeight:1.5,fontFamily:'Georgia',fontWeight:'700',fontStyle:'italic'}}]});
 const undo=await page.locator('#undoBtn').isEnabled();await edit(page);const initial=await model(page),host=await page.locator(surface).elementHandle();let previous=initial;
 for(const [target,a,b] of [['middle',3,3],['bottom',1,8],['top',8,1]]){
  await select(page,a,b);await vertical(page,target);const changed=await model(page);
  expect(changed).toEqual({...previous,verticalAlign:target});expect(await selection(page)).toEqual({anchor:a,focus:b});
  expect(await host.evaluate(el=>el===document.querySelector('#inlineWysiwyg'))).toBe(true);
  await page.keyboard.type('X');expect((await model(page)).text).toBe(previous.text.slice(0,Math.min(a,b))+'X'+previous.text.slice(Math.max(a,b)));
  await page.keyboard.press('Control+z');expect(await model(page)).toEqual(changed);expect(await selection(page)).toEqual({anchor:a,focus:b});
  await page.keyboard.press('Control+z');expect(await model(page)).toEqual(previous);expect(await selection(page)).toEqual({anchor:a,focus:b});
  await page.keyboard.press('Control+Shift+z');expect(await model(page)).toEqual(changed);expect(await selection(page)).toEqual({anchor:a,focus:b});previous=changed;
 }
 expect(previous).toEqual(initial);
 await page.keyboard.press('Control+Enter');expect(await page.locator('#undoBtn').isEnabled()).toBe(undo);expect(await model(page)).toEqual(initial);
 await edit(page);await vertical(page,'middle');await vertical(page,'bottom');await page.keyboard.press('Control+Enter');
 await page.locator('#undoBtn').click();expect(await model(page)).toEqual({...initial,verticalAlign:'middle'});
 await page.locator('#undoBtn').click();expect(await model(page)).toEqual(initial);
 await page.locator('#redoBtn').click();expect(await model(page)).toEqual({...initial,verticalAlign:'middle'});
 await page.locator('#redoBtn').click();expect(await model(page)).toEqual({...initial,verticalAlign:'bottom'});
 // Persisted layer and reopened projection retain the final alignment.
 await expect.poll(async()=>{const docs=await records(page,'docs');return docs.find(d=>d.elements.some(e=>e.id==='title')).elements.find(e=>e.id==='title')}).toEqual({...initial,verticalAlign:'bottom'});
 await edit(page);expect(await model(page)).toEqual({...initial,verticalAlign:'bottom'});
});

test('vertical plain alignment never creates runs or size metadata and round-trip is a history no-op',async({page})=>{
 await page.addInitScript(()=>{window.docWrites=0;const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='docs')window.docWrites++;return put.apply(this,args)};});
 await seed(page);await page.waitForTimeout(700);const writes=await page.evaluate(()=>window.docWrites),initial=await model(page),undo=await page.locator('#undoBtn').isEnabled();await edit(page);
 for(const value of ['middle','bottom','top']){await vertical(page,value);expect(await model(page)).toEqual({...initial,verticalAlign:value})}
 await page.keyboard.press('Control+Enter');expect(await model(page)).toEqual(initial);expect(await page.locator('#undoBtn').isEnabled()).toBe(undo);
 await page.waitForTimeout(700);expect(await page.evaluate(()=>window.docWrites)).toBe(writes);
});

// Import the shipping module through a test-only route; DOM measurements below
// remain independent browser boxes and baseline probes, not CSS-style assertions.
async function shippingLayout(page,e){
 await page.route('**/__shipping/**',async route=>{
  const path=require('node:path'),fs=require('node:fs/promises');
  const name=new URL(route.request().url()).pathname.split('/__shipping/')[1];
  await route.fulfill({body:await fs.readFile(path.join(__dirname,'../src',name)),contentType:'text/javascript'});
 });
 return page.evaluate(async e=>{
  const {createRichTextLayoutEngine}=await import('/__shipping/render/rich-text-layout.mjs');
  const engine=createRichTextLayoutEngine(document.createElement('canvas').getContext('2d'),document.fonts);
  return {top:engine.layout({...e,verticalAlign:'top'}),aligned:engine.layout(e)};
 },e);
}
for(const [name,patch] of [
 ['single',{text:'A😀B'}],['LF blanks and terminal LF',{text:'AB\n\n\nCD\n'}],['soft wrap',{text:'Alpha beta gamma delta epsilon',w:145}],
 ['mixed sizes lineHeight tracking',{text:'ABCD EFGH\nIJKL',lineHeight:1.7,textRuns:[{start:1,end:3,style:{fontSize:35,lineHeight:2,fontFamily:'Georgia',letterSpacing:2}},{start:7,end:12,style:{letterSpacing:-1,lineHeight:1.1,fontWeight:'700',fontStyle:'italic'}}]}],
 ['overflow',{text:'AB\nCD\nEF\nGH',h:35}],['short lineHeight',{text:'AB\nCD',lineHeight:.8}]
])test(`vertical shared geometry and navigation: ${name}`,async({page},info)=>{
 await seed(page,patch);await edit(page);const evidence=[];
 for(const value of ['top','middle','bottom']){
  await vertical(page,value);const e=await model(page),{top,aligned}=await shippingLayout(page,e),rows=await geometry(page);
  const offset=value==='middle'?Math.max(0,(e.h-top.height)/2):value==='bottom'?Math.max(0,e.h-top.height):0;
  expect(rows).toHaveLength(top.rows.length);
  for(const [i,row] of rows.entries()){
   expect(aligned.rows[i].y-top.rows[i].y).toBeCloseTo(offset,8);
   expect(Math.abs(row.y-aligned.rows[i].y)).toBeLessThan(.05);
   for(const part of row.parts)expect(Math.abs(part.y-aligned.rows[i].baseline)).toBeLessThan(.25);
  }
  // Every visual row, including consecutive and terminal empty rows, owns
  // Home/End, Up/Down and Shift selection after the block has moved.
  await page.keyboard.press('Control+Home');
  for(let i=0;i<rows.length;i++){
   if(i)await page.keyboard.press('ArrowDown');
   for(const key of ['Home','End']){
    await page.keyboard.press(key);
    const caret=await page.locator(surface).evaluate(host=>{const s=getSelection(),n=s.focusNode.nodeType===3?s.focusNode.parentElement:s.focusNode;return [...host.querySelectorAll('[data-wysiwyg-row]')].indexOf(n.closest('[data-wysiwyg-row]'))});expect(caret).toBe(i);
    expect(await selection(page)).toEqual({anchor:key==='Home'?aligned.rows[i].start:aligned.rows[i].end,focus:key==='Home'?aligned.rows[i].start:aligned.rows[i].end});
   }
  }
  if(rows.length>1){await page.keyboard.press('Home');await page.keyboard.press('Shift+ArrowUp');expect((await selection(page)).anchor).toBe(aligned.rows.at(-1).start);expect((await selection(page)).focus).toBeLessThan(aligned.rows.at(-1).start)}
  await page.keyboard.press('Control+Enter');const draws=await page.evaluate(()=>window.alignmentDraws),parts=rows.flatMap(r=>r.parts).filter(p=>p.text);
  // Canvas deliberately clips rows beyond frame height; DOM keeps source text.
  const visible=parts.filter(p=>rows.find(r=>r.parts.includes(p)).y<=e.h);
  expect(visible.map(p=>p.text)).toEqual(draws.map(d=>d.text));
  const errors=visible.map((p,i)=>({x:Math.abs(p.x-draws[i].x),baseline:Math.abs(p.y-draws[i].y)}));
  for(const error of errors){expect(error.x).toBeLessThan(.25);expect(error.baseline).toBeLessThan(.25)}
  evidence.push({value,blockHeight:top.height,offset,rowError:Math.max(...rows.map((r,i)=>Math.abs(r.y-aligned.rows[i].y))),errors});await edit(page);
 }
 await info.attach('vertical-geometry.json',{body:JSON.stringify(evidence),contentType:'application/json'});
 console.log('Vertical geometry',info.project.name,name,JSON.stringify(evidence));
});

for(const verticalAlign of ['top','middle','bottom'])for(const textAlign of ['left','center','right'])test(`vertical strict pixel parity ${verticalAlign} ${textAlign}`,async({page},info)=>{
 await seed(page,{text:'AB fi\nCD EF',verticalAlign,textAlign,fontSize:26,strokeWidth:2,stroke:'#cc2244',strokeOpacity:60,strokeStyle:'dashed',fillOpacity:75,underline:true,strikethrough:true,textRuns:[{start:1,end:4,style:{fontFamily:'Georgia',fontSize:32,fontWeight:'700',fontStyle:'italic',letterSpacing:1,strokeWidth:3,strokeOpacity:40,strokeStyle:'dotted',fillOpacity:50}}]});
 await edit(page);await select(page,4,1);await vertical(page,verticalAlign==='middle'?'bottom':'middle');await vertical(page,verticalAlign);expect(await selection(page)).toEqual({anchor:4,focus:1});await parity(page,info,verticalAlign+'-'+textAlign);
});

test('vertical absent alignment inherits top without persisting a default on open/close',async({page})=>{
 await seed(page,{verticalAlign:undefined,text:'AB\nCD'});const before=await model(page);await edit(page);
 expect(await model(page)).toEqual(before);const rows=await geometry(page);expect(Math.abs(rows[0].y)).toBeLessThan(.05);
 await page.keyboard.press('Control+Enter');expect(await model(page)).toEqual(before);
});
