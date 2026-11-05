const {test,expect,openHome,importPayload,records,openLibraryDocument,exportedDocument,canvasPoint}=require('./helpers');
const fixture=require('./fixtures/canvas-graph.json');

// Diagnostic only. This does NOT enable soft wrapping in the editor.
// Canvas is the source of truth; the off-screen DOM is an independent probe.
// Differences are reported rather than asserted away or silently accepted.
const cases=[
 ['word-boundaries',{text:'alpha beta gamma delta',w:135}],
 ['unbroken-word',{text:'abcdefghijklmnopqrstuvwxy',w:85}],
 ['color-run',{text:'Цветной текст для новостей',w:155,textRuns:[{start:0,end:7,style:{textColor:'#2255cc'}}]}],
 ['hard-plus-soft',{text:'Слова для первого абзаца\nВторой абзац снова длинный',w:150}],
];

async function captureCanvas(page){
 await page.addInitScript(()=>{
  window.softWrapPaint=[];
  const proto=CanvasRenderingContext2D.prototype;
  const clear=proto.clearRect,fill=proto.fillText;
  proto.clearRect=function(...args){
   if(this.canvas.id==='canvas')window.softWrapPaint=[];
   return clear.apply(this,args);
  };
  proto.fillText=function(text,x,y,...rest){
   if(this.canvas.id==='canvas'){
    window.softWrapPaint.push({text:String(text),x,y,width:this.measureText(text).width,
     font:this.font,spacing:this.letterSpacing,baseline:this.textBaseline});
   }
   return fill.call(this,text,x,y,...rest);
  };
 });
}

async function setup(page,patch){
 await openHome(page);
 const payload=structuredClone(fixture);
 payload.documents=[payload.documents[0]];
 const document=payload.documents[0];
 document.groups=[];
 document.elements=document.elements.filter(e=>e.id==='title');
 Object.assign(document.elements[0],{text:'',fontFamily:'Arial',fontWeight:'400',
  fontStyle:'normal',fontSize:24,lineHeight:1.15,letterSpacing:0,
  x:20,y:20,w:150,h:205,textRuns:undefined,autoFontSize:false,
  rotation:0,textAlign:'left',verticalAlign:'top',...patch});
 await importPayload(page,payload);
 const record=(await records(page,'docs')).find(d=>d.elements.some(e=>e.id==='title'));
 expect(record).toBeTruthy();
 await openLibraryDocument(page,record.id);
 await page.locator('#layers [data-layer="title"] .layer-name').click();
 return (await exportedDocument(page)).elements.find(e=>e.id==='title');
}

function groupCanvas(draws){
 const rows=[];
 for(const part of draws){
  let row=rows.find(r=>Math.abs(r.baseline-part.y)<0.2);
  if(!row)rows.push(row={baseline:part.y,text:'',x:part.x,right:part.x,parts:[]});
  row.text+=part.text;
  row.x=Math.min(row.x,part.x);
  row.right=Math.max(row.right,part.x+part.width);
  row.parts.push(part);
 }
 return rows.sort((a,b)=>a.baseline-b.baseline).map(r=>({
  text:r.text,baseline:r.baseline,x:r.x,width:r.right-r.x,parts:r.parts
 }));
}

async function measureDOM(page,element){
 return page.evaluate(e=>{
  const paint=document.createElement('canvas').getContext('2d');
  const font=(e.fontStyle||'normal')+' '+(e.fontWeight||'400')+' '+e.fontSize+'px '+JSON.stringify(e.fontFamily||'Arial');
  paint.font=font;
  const m=paint.measureText('Mg');
  const lineHeight=Math.max(e.fontSize*(Number(e.lineHeight)||1.15),
   (m.fontBoundingBoxAscent||e.fontSize*.8)+(m.fontBoundingBoxDescent||e.fontSize*.2));
  const host=document.createElement('div');
  Object.assign(host.style,{position:'fixed',left:'-10000px',top:'0',visibility:'hidden',
   margin:'0',padding:'0',border:'0',boxSizing:'content-box',
   width:Math.max(1,e.w)+'px',height:Math.max(1,e.h)+'px',
   font,fontKerning:'normal',lineHeight:lineHeight+'px',
   letterSpacing:(e.letterSpacing||0)+'px',whiteSpace:'break-spaces',
   overflowWrap:'anywhere',wordBreak:'normal',textAlign:'left'});
  // Preserve sparse style boundaries, even though these probes vary only color.
  const cuts=[0,e.text.length];
  for(const run of e.textRuns||[])cuts.push(run.start,run.end);
  const boundaries=[...new Set(cuts)].sort((a,b)=>a-b);
  const leaves=[];
  for(let i=0;i<boundaries.length-1;i++){
   const start=boundaries[i],end=boundaries[i+1];
   if(end<=start)continue;
   const span=document.createElement('span');
   span.textContent=e.text.slice(start,end);
   Object.assign(span.style,{font,lineHeight:lineHeight+'px',
    letterSpacing:(e.letterSpacing||0)+'px'});
   host.append(span);leaves.push({node:span.firstChild,start});
  }
  document.body.append(host);
  try{
   const box=host.getBoundingClientRect(),chars=[];
   const segmenter=new Intl.Segmenter('ru',{granularity:'grapheme'});
   for(const leaf of leaves){
    for(const part of segmenter.segment(leaf.node.data)){
     if(part.segment==='\n')continue;
     const range=document.createRange();
     range.setStart(leaf.node,part.index);
     range.setEnd(leaf.node,part.index+part.segment.length);
     const rect=range.getBoundingClientRect();
     chars.push({offset:leaf.start+part.index,text:part.segment,
      x:rect.x-box.x,y:rect.y-box.y,width:rect.width});
    }
   }
   const rows=[];
   for(const part of chars){
    let row=rows.find(r=>Math.abs(r.y-part.y)<0.5);
    if(!row)rows.push(row={y:part.y,text:'',x:part.x,right:part.x,offsets:[]});
    row.text+=part.text;
    row.x=Math.min(row.x,part.x);
    row.right=Math.max(row.right,part.x+part.width);
    row.offsets.push(part.offset);
   }
   return {font,lineHeight,rows:rows.sort((a,b)=>a.y-b.y).map(r=>({
    text:r.text,y:r.y,x:r.x,width:r.right-r.x,offsets:r.offsets
   }))};
  }finally{host.remove();}
 },element);
}

for(const [name,patch] of cases){
 test('soft wrap read-only Canvas/DOM diagnostic: '+name,async({page},testInfo)=>{
  await page.setViewportSize({width:2200,height:1600});
  await captureCanvas(page);
  const element=await setup(page,patch);
  await expect.poll(async()=>page.evaluate(()=>window.softWrapPaint.length)).toBeGreaterThan(1);
  const draws=await page.evaluate(()=>window.softWrapPaint);
  const canvas=groupCanvas(draws);
  const dom=await measureDOM(page,element);
  const text=element.text.replaceAll('\n','');
  const differences=[];
  for(let i=0;i<Math.max(canvas.length,dom.rows.length);i++){
   const a=canvas[i],b=dom.rows[i];
   if(!a||!b||a.text!==b.text||Math.abs(a.width-b.width)>0.5)
    differences.push({row:i,canvas:a&&{text:a.text,width:a.width},
     dom:b&&{text:b.text,width:b.width}});
  }
  const report={name,source:{text:element.text,width:element.w,fontSize:element.fontSize,
    textRuns:element.textRuns||[]},canvas,dom,summary:{
    canvasRows:canvas.length,domRows:dom.rows.length,
    mismatchedRows:differences.length,differences}};
  await testInfo.attach('soft-wrap-'+name+'.json',{
   body:JSON.stringify(report,null,2),contentType:'application/json'});
  console.log('[soft-wrap-diag] '+JSON.stringify({
   case:name,canvas:canvas.map(r=>r.text),dom:dom.rows.map(r=>r.text),
   mismatchedRows:differences.length}));
  // Diagnostic invariants, NOT a parity gate: discrepancies are the output.
  expect(canvas.length).toBeGreaterThan(element.text.split('\n').length);
  expect(dom.rows.length).toBeGreaterThan(0);
  expect(canvas.map(r=>r.text).join('')).toBe(text);
  expect(dom.rows.map(r=>r.text).join('')).toBe(text);
  expect(canvas.every(r=>Number.isFinite(r.x)&&Number.isFinite(r.width))).toBe(true);
  expect(dom.rows.every(r=>Number.isFinite(r.x)&&Number.isFinite(r.width))).toBe(true);
  // Select on the first painted line, not in blank frame space.
  const p=await canvasPoint(page,35,35);
  await page.mouse.dblclick(p.x,p.y);
  await expect(page.locator('#inlineText')).toBeFocused();
  await expect(page.locator('#inlineWysiwyg')).toBeHidden();
  await page.keyboard.press('ControlOrMeta+Enter');
  expect((await exportedDocument(page)).elements.find(e=>e.id==='title')).toEqual(element);
 });
}
