const {test,expect,openHome,importPayload,records,openLibraryDocument,exportedDocument,exportPNG,canvasPoint}=require('./helpers');
const fs=require('node:fs/promises'),path=require('node:path');
const fixture=require('./fixtures/canvas-graph.json');
test.use({serviceWorkers:'block'});
test.describe.configure({timeout:60000});

async function seed(page,patch={}){
 await page.setViewportSize({width:1600,height:1100});
 await page.route('**/__shipping/**',async route=>{
  const name=new URL(route.request().url()).pathname.slice('/__shipping/'.length);
  if(!['render/rich-text-layout.mjs','render/text-decorations.mjs','model/rich-text.mjs'].includes(name))return route.abort();
  await route.fulfill({body:await fs.readFile(path.join(__dirname,'../src',name)),contentType:'text/javascript'});
 });
 await page.addInitScript(()=>{
  window.justifyDraws=[];window.justifyExport=[];
  const p=CanvasRenderingContext2D.prototype,clear=p.clearRect;
  p.clearRect=function(...a){if(this.canvas.id==='canvas')window.justifyDraws=[];return clear.apply(this,a)};
  for(const method of ['fillText','strokeText','fillRect']){
   const native=p[method];p[method]=function(...args){
    const out=this.canvas.id==='canvas'?window.justifyDraws:window.captureJustifyExport?window.justifyExport:null;
    if(out)out.push({method,args,font:this.font,spacing:this.letterSpacing,baseline:this.textBaseline,alpha:this.globalAlpha,color:method==='strokeText'?this.strokeStyle:this.fillStyle,dash:this.getLineDash(),cap:this.lineCap,lineWidth:this.lineWidth});
    return native.apply(this,args);
   };
  }
 });
 await openHome(page);const payload=structuredClone(fixture);payload.documents=[payload.documents[0]];
 const doc=payload.documents[0];doc.groups=[];doc.background='#ffffff';doc.elements=doc.elements.filter(e=>e.id==='title');
 Object.assign(doc.elements[0],{text:'AA   BB CC DD EE\nFF GG\n\nHH II\r\nJJ\tKK\u00a0LL 👩‍💻 é',x:20,y:20,w:130,h:210,fontFamily:'Arial',fontSize:20,lineHeight:1.2,letterSpacing:0,textColor:'#111111',autoFontSize:false,rotation:0,textAlign:'justify',verticalAlign:'top',...patch});
 await importPayload(page,payload);await expect(page.locator('#toast')).toContainText('Импортировано проектов');
 const stored=(await records(page,'docs')).find(d=>d.elements.some(e=>e.id==='title'));await openLibraryDocument(page,stored.id);
 for(let i=0;i<60;i++){const z=parseInt(await page.locator('#zoomLabel').textContent());if(z===100)break;await page.locator(z>100?'#zoomOutBtn':'#zoomInBtn').click()}
 await expect(page.locator('#zoomLabel')).toHaveText('100%');return stored;
}
const layer=d=>d.elements.find(e=>e.id==='title');
async function projection(page,e){return page.evaluate(async e=>{
 const {createRichTextLayoutEngine}=await import('/__shipping/render/rich-text-layout.mjs');
 return createRichTextLayoutEngine(document.createElement('canvas').getContext('2d'),document.fonts).layoutJustified(e);
},e)}
const glyphs=calls=>calls.filter(p=>p.method!=='fillRect');
async function parity(page,info,label){
 for(let i=0;i<60;i++){const z=parseInt(await page.locator('#zoomLabel').textContent());if(z===100)break;await page.locator(z>100?'#zoomOutBtn':'#zoomInBtn').click()}
 await page.keyboard.press('Escape');const p=await canvasPoint(page,310,230);await page.mouse.click(p.x,p.y);
 const screen=await page.locator('#canvas').evaluate(c=>({width:c.width,height:c.height,data:[...c.getContext('2d').getImageData(0,0,c.width,c.height).data]}));
 expect([screen.width,screen.height]).toEqual([320,240]);
 const calls=await page.evaluate(()=>window.justifyDraws);
 await page.evaluate(()=>{window.justifyExport=[];window.captureJustifyExport=true});const png=await exportPNG(page);
 const exported=await page.evaluate(()=>{window.captureJustifyExport=false;return window.justifyExport});
 // Full glyph state, coordinates and decoration rectangles agree, with no duplicate calls.
 expect(exported).toEqual(calls);
 let max=0,changed=0;for(let i=0;i<screen.data.length;i++){const d=Math.abs(screen.data[i]-png.image.data[i]);max=Math.max(max,d);if(d)changed++}
 expect(max).toBeLessThanOrEqual(1);
 const measurement={maxChannelDelta:max,changedChannels:changed,glyphCalls:glyphs(calls).length};
 console.log('Justify parity',info.project.name,label,JSON.stringify(measurement));
 await info.attach(label+'.json',{body:JSON.stringify({measurement,calls}),contentType:'application/json'});
 await info.attach(label+'-export.png',{body:png.bytes,contentType:'image/png'});
 await info.attach(label+'-editor.png',{body:await page.screenshot(),contentType:'image/png'});
 return calls;
}

for(const rich of [false,true])test(`shared justify actual glyphs, decorations and Canvas/PNG: rich=${rich}`,async({page},info)=>{
 const patch=rich?{underline:true,textRuns:[
  {start:0,end:2,style:{fontFamily:'serif',fontSize:24,fontWeight:'700',fontStyle:'italic',lineHeight:1.4,letterSpacing:1,textColor:'#cc2244',fillOpacity:45,strokeWidth:1,strokeOpacity:35,strokeStyle:'dashed',stroke:'#2233bb',strikethrough:true}},
  {start:5,end:7,style:{fontFamily:'monospace',fontSize:18,letterSpacing:-1,textColor:'#2255bb',fillOpacity:70,strokeWidth:2,strokeOpacity:60,strokeStyle:'dotted',stroke:'#cc2244'}},
 ]}:{};
 const doc=await seed(page,patch),e=layer(doc),before=structuredClone(e),layout=await projection(page,e);
 expect(layout.rows.some(r=>r.justification.extraPerSpace>0)).toBe(true);
 expect(layout.rows.filter(r=>!r.softWrap).every(r=>r.justification.extraPerSpace===0)).toBe(true);
 expect(layout.rows.some(r=>r.width>e.w&&Math.abs(r.justification.contentWidth-e.w)<1e-6)).toBe(true);
 const calls=await parity(page,info,rich?'rich':'plain'),fills=calls.filter(p=>p.method==='fillText');
 const parts=layout.rows.filter(r=>r.y<=e.h).flatMap(r=>r.fragments);
 expect(fills.map(p=>p.args)).toEqual(parts.map(p=>[p.text,p.x,p.y]));
 expect(fills.every(p=>p.baseline==='alphabetic')).toBe(true);
 expect(fills.map(p=>p.args[0]).join('')).toBe(e.text.replace(/[\r\n]/g,''));
 if(rich){
  const strokes=calls.filter(p=>p.method==='strokeText');
  expect(strokes.map(p=>p.args)).toEqual(parts.filter(p=>p.style.strokeWidth>0).map(p=>[p.text,p.x,p.y]));
  expect(strokes.some(p=>p.alpha===.35&&p.dash[0]===4)).toBe(true);
  expect(strokes.some(p=>p.alpha===.6&&p.cap==='round'&&p.dash[0]===1)).toBe(true);
  expect(fills.some(p=>p.alpha===.45&&p.color==='#cc2244'&&p.font.includes('italic')&&p.font.includes('24px'))).toBe(true);
  const rects=calls.filter(p=>p.method==='fillRect'&&p.args[3]<5);
  expect(rects.map(p=>p.args)).toEqual(layout.rows.flatMap(r=>r.decorations).map(r=>[r.x,r.y,r.width,r.height]));
  const first=layout.rows[0];expect(Math.max(...first.decorations.map(r=>r.x+r.width))).toBeGreaterThanOrEqual(e.w);
 }
 const saved=layer(await exportedDocument(page));expect(saved.text).toBe(before.text);expect(saved.textRuns).toEqual(before.textRuns);
 await page.reload();await expect(page.locator('#homeScreen')).toBeVisible();await openLibraryDocument(page,doc.id);
 const reopened=layer(await exportedDocument(page));expect(reopened.text).toBe(saved.text);expect(reopened.textRuns).toEqual(saved.textRuns);
 await parity(page,info,'reopened-'+rich);
});

test('justify textarea fallback, undo/redo, closing painter and zoom/mobile export',async({page},info)=>{
 const doc=await seed(page,{text:'AA BB CC DD EE'}),original=layer(doc).text;
 await page.locator('#layers [data-layer="title"] .layer-name').click();let p=await canvasPoint(page,50,35);await page.mouse.dblclick(p.x,p.y);
 await expect(page.locator('#inlineText')).toBeFocused();await expect(page.locator('#inlineWysiwyg')).toBeHidden();
 await page.locator('#inlineText').fill(original+' FF');await page.keyboard.press('Control+Enter');await expect(page.locator('#inlineText')).toBeHidden();
 expect(layer(await exportedDocument(page)).text).toBe(original+' FF');
 await page.keyboard.press('Control+z');expect(layer(await exportedDocument(page)).text).toBe(original);
 await page.keyboard.press('Control+Shift+z');expect(layer(await exportedDocument(page)).text).toBe(original+' FF');
 const calls=await parity(page,info,'closed');await page.locator('#zoomOutBtn').click();
 expect(glyphs(await page.evaluate(()=>window.justifyDraws))).toEqual(glyphs(calls));
 await page.setViewportSize({width:390,height:844});await expect(page.locator('#inlineWysiwyg')).toBeHidden();
 // Mobile uses the same document-space glyphs regardless of viewport scale.
 expect(glyphs(await page.evaluate(()=>window.justifyDraws))).toEqual(glyphs(calls));
 await page.evaluate(()=>{window.justifyExport=[];window.captureJustifyExport=true});await exportPNG(page);
 expect(glyphs(await page.evaluate(()=>window.justifyExport))).toEqual(glyphs(calls));
});

test('real Canvas geometry: hanging spaces cannot shrink auto-fit or enlarge content sizing',async({page},info)=>{
 await seed(page);
 const source=await fs.readFile(path.join(__dirname,'../src/editor.js'),'utf8');
 const fit=source.slice(source.indexOf('function autoFitTextFont('),source.indexOf('function setTextAutoFont('));
 const results=await page.evaluate(async fit=>{
  const {createRichTextLayoutEngine,supportsHorizontalTextLayout,retainRichTextSizeBase,richTextFont,resolveRichTextStyle}=await import('/__shipping/render/rich-text-layout.mjs');
  const c=document.createElement('canvas').getContext('2d'),engine=createRichTextLayoutEngine(c,document.fonts);
  const run=new Function('richTextEngine','supportsHorizontalTextLayout','retainRichTextSizeBase','textFitContext','fontString',fit+';return {autoFitTextFont,fitTextBoxToContent}')(engine,supportsHorizontalTextLayout,retainRichTextSizeBase,c,e=>richTextFont(resolveRichTextStyle(e)));
  const cases=[];
  for(const text of ['AA   BB CC DD EE','AA BB\n\nCC DD\r\n','A\tB C\u00a0D EE','ABCDEFGHIJKLMNO','AV fi é 👩‍💻 AA BB'])for(const letterSpacing of [-1,0,2]){
   const e={type:'text',text,w:105,h:180,fontFamily:'Arial',fontSize:20,lineHeight:1.2,letterSpacing,autoFontSize:true,textAlign:'justify'},before=structuredClone(e);
   const natural=engine.layout({...e,textAlign:'left'}),projected=engine.layoutJustified(e);
   const left={...e,textAlign:'left'};run.autoFitTextFont(left);run.autoFitTextFont(e);
   const sized={...before},sizedLeft={...before,textAlign:'left'};run.fitTextBoxToContent(sized);run.fitTextBoxToContent(sizedLeft);
   cases.push({text,letterSpacing,fontSize:e.fontSize,leftSize:left.fontSize,box:[sized.w,sized.h],leftBox:[sizedLeft.w,sizedLeft.h],hanging:projected.rows.some(r=>r.width>before.w+.001&&Math.abs(r.justification.contentWidth-before.w)<.001),wraps:projected.rows.map(r=>[r.start,r.end]),naturalWraps:natural.rows.map(r=>[r.start,r.end]),sourcePreserved:e.text===before.text});
  }
  c.font='20px Arial';c.fontKerning='normal';c.letterSpacing='0px';const boundary=c.measureText('AA BB CC').width;
  const edge=[-.1,0,.1].map(d=>engine.layoutJustified({text:'AA BB CC',w:boundary+d,h:100,fontSize:20}).rows.length);
  return {cases,boundary,edge};
 },fit);
 for(const c of results.cases){expect(c.fontSize).toBe(c.leftSize);expect(c.box).toEqual(c.leftBox);expect(c.wraps).toEqual(c.naturalWraps);expect(c.sourcePreserved).toBe(true)}
 expect(results.cases.some(c=>c.hanging)).toBe(true);expect(results.edge[0]).toBeGreaterThan(results.edge[1]);expect(results.edge[1]).toBe(results.edge[2]);
 await info.attach('geometry.json',{body:JSON.stringify(results,null,2),contentType:'application/json'});
});

test('justify retains contextual glyph origin across stroke and opacity run boundaries',async({page})=>{
 await seed(page);
 const rows=await page.evaluate(async()=>{
  const {createRichTextLayoutEngine}=await import('/__shipping/render/rich-text-layout.mjs');
  const engine=createRichTextLayoutEngine(document.createElement('canvas').getContext('2d'),document.fonts);
  return ['AV','fi'].map(text=>{
   const e={text,w:200,h:100,fontFamily:'serif',fontSize:32,textRuns:[{start:0,end:1,style:{fillOpacity:50,strokeWidth:1}}]};
   return {natural:engine.layout(e).rows[0].fragments,justify:engine.layoutJustified(e).rows[0].fragments};
  });
 });
 for(const row of rows)expect(row.justify.map(p=>[p.text,p.x,p.logicalX??p.x])).toEqual(row.natural.map(p=>[p.text,p.x,p.logicalX??p.x]));
});

test('text backdrop measures justified visible fragments instead of hanging source spaces',async({page})=>{
 const doc=await seed(page,{text:'AA   BB CC DD EE'}),e=layer(doc);
 const source=await fs.readFile(path.join(__dirname,'../src/editor.js'),'utf8');
 const mixed=source.slice(source.indexOf('function mixedTextLayout('),source.indexOf('// The editable surface projects'));
 const backdrop=source.slice(source.indexOf('function tf43Backdrop('),source.indexOf('function tf43Under('));
 const result=await page.evaluate(async({mixed,backdrop,e})=>{
  const {createRichTextLayoutEngine,supportsHorizontalTextLayout,richTextFont}=await import('/__shipping/render/rich-text-layout.mjs');
  const engine=createRichTextLayoutEngine(document.createElement('canvas').getContext('2d'),document.fonts),rows=[];
  const canvas=d=>Object.assign(document.createElement('canvas'),{width:d.width,height:d.height});
  const run=new Function('richTextEngine','supportsHorizontalTextLayout','richTextFont','fxCanvas','tf45UnionPath',`
   const app={},pngRendering=false,clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),normalizeHex=x=>x,fxLimitMask=()=>{};
   ${mixed}\n${backdrop}\nreturn tf43Backdrop;`)(engine,supportsHorizontalTextLayout,richTextFont,canvas,(c,r)=>{rows.push(...r);c.beginPath();for(const p of r)c.rect(p.l,p.t,p.r-p.l,p.b-p.t)});
  run(e,{spread:3,roundness:0},{width:320,height:240});
  return {rows,layout:engine.layoutJustified(e)};
 },{mixed,backdrop,e});
 const visible=result.layout.rows.filter(r=>r.fragments.some(p=>p.text.trim()));
 expect(result.rows).toHaveLength(visible.length);
 for(const [i,row] of visible.entries()){
  const parts=row.fragments.filter(p=>p.text.trim());expect(result.rows[i].l).toBe(parts[0].x-3);
  expect(result.rows[i].r).toBe(parts.at(-1).x+parts.at(-1).width+3);
  if(row.justification.extraPerSpace>0){expect(result.rows[i].r).toBeCloseTo(e.w+3,6);expect(row.width).toBeGreaterThan(e.w)}
 }
});
