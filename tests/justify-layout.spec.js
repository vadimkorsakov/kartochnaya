const {test,expect,openHome,importPayload,records,openLibraryDocument,exportPNG,canvasPoint}=require('./helpers');
const fs=require('node:fs/promises');
const path=require('node:path');
const fixture=require('./fixtures/visual-text.json');
test.use({serviceWorkers:'block'});

async function setup(page){
 await page.route('**/__shipping/**',async route=>{
  const name=new URL(route.request().url()).pathname.slice('/__shipping/'.length);
  if(!['render/rich-text-layout.mjs','render/text-baseline-shift.mjs','render/text-decorations.mjs','model/rich-text.mjs','model/text-case.mjs','model/paragraph-style.mjs','model/list-presets.mjs'].includes(name))return route.abort();
  await route.fulfill({body:await fs.readFile(path.join(__dirname,'../src',name)),contentType:'text/javascript'});
 });
 await openHome(page);
 const source=await fs.readFile(path.join(__dirname,'../src/editor.js'),'utf8');
 // Execute the shipping wrapLines and exact historical stage-1 override; no reimplemented
 // word-spacing formula or separate legacy layout implementation in the test.
 const wrap=source.slice(source.indexOf('const textLayoutProbe='),source.indexOf('// Horizontal text layout uses Canvas metrics'));
 const override=await fs.readFile(path.join(__dirname,'fixtures/justify-stage-1-override.txt'),'utf8');
 await page.evaluate(({wrap,override})=>{
  window.legacyJustify=new Function('c','e',`
   const supportsHorizontalTextLayout=()=>false;
   const fontString=e=>'normal 400 '+e.fontSize+'px "Arial"';
   const resolveRichTextStyle=()=>({});
   let drawTextGlyphs=()=>{throw new Error('unexpected fallback')};
   ${wrap}\n${override}\ndrawTextGlyphs(c,e);`);
 },{wrap,override});
}

test('stage-1 compatibility matrix versus shared rows with real Canvas metrics',async({page},info)=>{
 await setup(page);
 const measurements=await page.evaluate(async()=>{
  const {createRichTextLayoutEngine}=await import('/__shipping/render/rich-text-layout.mjs');
  const ctx=document.createElement('canvas').getContext('2d'),engine=createRichTextLayoutEngine(ctx,document.fonts);
  ctx.font='normal 400 20px Arial';ctx.fontKerning='normal';ctx.letterSpacing='0px';
  const threshold=ctx.measureText('AA BB CC').width;
  const cases=[['single','Hello',200],['words','AA BB CC',200],['spaces','AA   BB CC',200],['paragraphs','AA BB\nCC DD',200],['blank','AA BB\n\nCC DD\n',200],['long','ABCDEFGHIJKLMNO',65],['wrap','AA BB CC DD EE',100],['below','AA BB CC',threshold-.1],['boundary','AA BB CC',threshold],['above','AA BB CC',threshold+.1],['positive','AA BB CC DD EE',100,2],['negative','AA BB CC DD EE',100,-1]];
  return cases.map(([name,text,w,letterSpacing=0])=>{
   const e={type:'text',text,w,h:500,fontSize:20,lineHeight:1.2,textAlign:'justify',letterSpacing};
   const calls=[],c=document.createElement('canvas').getContext('2d'),native=c.fillText;
   c.fillText=function(text,x,y){calls.push({text,x,y});native.call(this,text,x,y)};
   window.legacyJustify(c,e);
   const layout=engine.layoutJustified(e);
   const rows=layout.rows.map(r=>({start:r.start,end:r.end,softWrap:r.softWrap,width:r.width,contentWidth:r.justification.contentWidth,extra:r.justification.extraPerSpace,words:r.fragments.filter(p=>/\S/u.test(p.text)).map(p=>({text:p.text,x:p.x,y:p.y}))}));
   return {name,text,w,letterSpacing,legacy:calls,experimental:rows};
  });
 });
 const by=Object.fromEntries(measurements.map(m=>[m.name,m]));
 expect(new Set(by.below.legacy.map(p=>p.y)).size).toBeGreaterThan(new Set(by.above.legacy.map(p=>p.y)).size);
 expect(by.below.experimental.length).toBeGreaterThan(by.above.experimental.length);
 expect(by.single.legacy.map(p=>p.text)).toEqual(['Hello']);
 expect(by.words.legacy.map(p=>p.x)).toEqual(by.spaces.legacy.map(p=>p.x));
 expect(by.paragraphs.legacy[1].x).toBeGreaterThan(150);
 expect(by.paragraphs.experimental.every(r=>r.extra===0)).toBe(true);
 expect(by.blank.legacy.at(-1).x).toBeGreaterThan(150,'trailing blank makes preceding paragraph stretch');
 expect(by.wrap.experimental.some(r=>r.extra>0&&Math.abs(r.contentWidth-100)<1e-6)).toBe(true);
 for(const m of measurements)for(const r of m.experimental)for(const p of r.words)expect(Number.isFinite(p.x)&&p.x>=0).toBe(true);
 await info.attach('justify-measurements.json',{body:JSON.stringify(measurements,null,2),contentType:'application/json'});
 await fs.mkdir(path.join(__dirname,'../work'),{recursive:true});
 await fs.writeFile(path.join(__dirname,'../work/justify-measurements.json'),JSON.stringify(measurements,null,2));
});

test('saved justify layers use shared Canvas/PNG and default WYSIWYG',async({page})=>{
 await page.addInitScript(()=>{
  window.justifyFrame=[];window.justifyExport=[];
  const p=CanvasRenderingContext2D.prototype,clear=p.clearRect,fill=p.fillText;
  p.clearRect=function(...a){if(this.canvas.id==='canvas')window.justifyFrame=[];return clear.apply(this,a)};
  p.fillText=function(text,x,y,...a){const out=this.canvas.id==='canvas'?window.justifyFrame:window.captureJustify?window.justifyExport:null;if(out)out.push({text,x,y,baseline:this.textBaseline});return fill.call(this,text,x,y,...a)};
 });
 await openHome(page);
 const payload=structuredClone(fixture),e=payload.document.elements[0];
 Object.assign(e,{id:'justify',name:'Justify',text:'AA BB\nCC DD',x:16,y:16,w:200,h:150,fontSize:20,fontFamily:'Arial',textAlign:'justify',letterSpacing:0,autoFontSize:false,textRuns:[{start:0,end:2,style:{textColor:'#ff0000'}}]});
 await importPayload(page,payload);
 let doc;await expect.poll(async()=>{doc=(await records(page,'docs')).find(d=>d.title==='Visual fixed font (импорт)');return doc?.id}).toBeTruthy();
 await openLibraryDocument(page,doc.id);
 await expect.poll(()=>page.evaluate(()=>window.justifyFrame.filter(p=>['AA','BB','CC','DD'].includes(p.text)).length)).toBe(4);
 const live=await page.evaluate(()=>window.justifyFrame.filter(p=>['AA','BB','CC','DD'].includes(p.text)));
 expect(live.every(p=>p.baseline==='alphabetic')).toBe(true);expect(live[1].x).toBeLessThan(60);expect(live[3].x).toBeLessThan(60);
 await page.evaluate(()=>{window.captureJustify=true});await exportPNG(page);
 const exported=await page.evaluate(()=>window.justifyExport.filter(p=>['AA','BB','CC','DD'].includes(p.text)));
 expect(exported).toEqual(live);
 await page.locator('#layers .layer-name').filter({hasText:'Justify'}).click();
 const point=await canvasPoint(page,50,30);await page.mouse.dblclick(point.x,point.y);
 await expect(page.locator('#inlineWysiwyg')).toBeFocused();await expect(page.locator('#inlineText')).toBeHidden();
});

test('spacing shifts complete list items and block alignment with real font metrics',async({page})=>{
 await setup(page);
 const measurements=await page.evaluate(async()=>{
  const {createRichTextLayoutEngine}=await import('/__shipping/render/rich-text-layout.mjs');
  const engine=createRichTextLayoutEngine(document.createElement('canvas').getContext('2d'),document.fonts);
  const lines=['Title','Straße alpha beta gamma delta','','Last','Plain','Nine','Ten','Restart','Latin','Next','Bullet',''];
  const text=lines.join('\n'),starts=lines.map((_,i)=>i?lines.slice(0,i).join('\n').length+1:0);
  const styles=[null,{listKind:'bullet',listIndent:6}, {listKind:'bullet'}, {listKind:'bullet'}, null,
   {listKind:'ordered',listStart:9}, {listKind:'ordered'}, {listKind:'ordered',listStart:60},
   {listKind:'ordered',listCounterStyle:'latin-lower-dot'}, {listKind:'ordered',listCounterStyle:'latin-lower-dot'},
   {listKind:'bullet'}, {listKind:'bullet'}];
  const spacings=[0,17.5,31,80,0,9.25,18,55,6,65,22,99];
  const runs=withSpacing=>styles.flatMap((style,i)=>style?[{start:starts[i],style:{...style,...withSpacing(i)}}]:[]);
  const sample={text,w:155,h:850,fontSize:20,fontFamily:'Arial',lineHeight:1.25,
   textRuns:[{start:starts[1],end:starts[1]+6,style:{textCase:'upper',baselineShift:'super',underline:true,underlineDetails:{style:'wavy'}}},
    {start:starts[1]+7,end:starts[1]+12,style:{baselineShift:'sub',lineHeight:1.8}}]};
  const summarize=layout=>({height:layout.height,width:layout.width,inkOverflow:layout.inkOverflow,
   rows:layout.rows.map(r=>({y:r.y,baseline:r.baseline,height:r.height,x:r.x,width:r.width,start:r.start,end:r.end,nextStart:r.nextStart,
    gap:r.spacingBefore??0,softWrap:r.softWrap,marker:r.marker,extra:r.justification?.extraPerSpace,
    decorations:r.decorations,fragments:r.fragments.map(p=>({text:p.text,x:p.x,y:p.y,width:p.width}))}))});
  return ['left','center','right','justify'].flatMap(textAlign=>['top','middle','bottom'].map(verticalAlign=>{
   const layout=runs=>engine[textAlign==='justify'?'layoutJustified':'layout']({...sample,textAlign,verticalAlign,paragraphRuns:runs});
   const before=layout(runs(()=>({}))),zero=layout(runs(()=>({listItemSpacing:0}))),
    after=layout(runs(i=>({listItemSpacing:spacings[i]})));
   return {textAlign,verticalAlign,starts,zero:summarize(zero),before:summarize(before),after:summarize(after)};
  }));
 });
 const total=85.75;
 for(const {textAlign,verticalAlign,starts,zero,before,after} of measurements){
  expect(zero).toEqual(before);
  expect(after.width).toBe(before.width);
  expect(after.inkOverflow).toBeCloseTo(before.inkOverflow,7);
  expect(after.height-before.height).toBeCloseTo(total,7);
  expect(after.rows.map(row=>[row.start,row.end,row.nextStart,row.softWrap])).toEqual(before.rows.map(row=>[row.start,row.end,row.nextStart,row.softWrap]));
  expect(after.rows.filter(row=>row.start>=starts[1]&&row.start<starts[2])).toHaveLength(3);
  expect(after.rows.filter(row=>row.gap).map(row=>[row.start,row.gap])).toEqual([[starts[2],17.5],[starts[3],31],[starts[6],9.25],[starts[9],6],[starts[11],22]]);
  expect(after.rows.flatMap(row=>row.marker?.text??[])).toEqual(['•','•','•','9.','10.','60.','a.','b.','•','•']);
  expect(after.rows.at(-1).start).toBe(after.rows.at(-1).end);
  expect(after.rows.find(row=>row.start===starts[2]).fragments).toEqual([]);
  if(textAlign==='justify')expect(after.rows.some(row=>row.softWrap&&row.extra>0)).toBe(true);
  let shift=-total*({top:0,middle:.5,bottom:1}[verticalAlign]);
  for(const [i,row] of after.rows.entries()){
   shift+=row.gap;
   const previous=after.rows[i-1],original=before.rows[i];
   expect(row.height).toBeCloseTo(original.height,7);
   expect(row.y-original.y).toBeCloseTo(shift,7);
   expect(row.baseline-original.baseline).toBeCloseTo(shift,7);
   if(previous)expect(row.y-previous.y-previous.height).toBeCloseTo(row.gap,7);
   expect([row.x,row.width,row.extra]).toEqual([original.x,original.width,original.extra]);
   if(row.marker){
    expect(row.marker.columnX).toBe(original.marker.columnX);
    expect(row.marker.y-original.marker.y).toBeCloseTo(shift,7);
   }
   for(const [j,part] of row.fragments.entries())expect(part.y-original.fragments[j].y).toBeCloseTo(shift,7);
   for(const [j,decoration] of row.decorations.entries())expect(decoration.y-original.decorations[j].y).toBeCloseTo(shift,7);
  }
 }
});
