const {test,expect,openHome,importPayload,records,openLibraryDocument,exportPNG,canvasPoint}=require('./helpers');
const fs=require('node:fs/promises');
const path=require('node:path');
const fixture=require('./fixtures/visual-text.json');
test.use({serviceWorkers:'block'});

async function setup(page){
 await page.route('**/__shipping/**',async route=>{
  const name=new URL(route.request().url()).pathname.slice('/__shipping/'.length);
  if(!['render/rich-text-layout.mjs','render/text-decorations.mjs','model/rich-text.mjs'].includes(name))return route.abort();
  await route.fulfill({body:await fs.readFile(path.join(__dirname,'../src',name)),contentType:'text/javascript'});
 });
 await openHome(page);
 const source=await fs.readFile(path.join(__dirname,'../src/editor.js'),'utf8');
 // Execute the ACTUAL shipping wrapLines and late justify override; no copied
 // word-spacing formula or separate legacy layout implementation in the test.
 const wrap=source.slice(source.indexOf('const textLayoutProbe='),source.indexOf('// Horizontal text layout uses Canvas metrics'));
 const override=source.slice(source.indexOf('const mobileV36BaseDrawText='),source.indexOf('const mobileV36BasePaintText='));
 await page.evaluate(({wrap,override})=>{
  window.legacyJustify=new Function('c','e',`
   const supportsHorizontalTextLayout=()=>false;
   const fontString=e=>'normal 400 '+e.fontSize+'px "Arial"';
   const resolveRichTextStyle=()=>({});
   let drawTextGlyphs=()=>{throw new Error('unexpected fallback')};
   ${wrap}\n${override}\ndrawTextGlyphs(c,e);`);
 },{wrap,override});
}

test('legacy compatibility matrix versus opt-in shared rows with real Canvas metrics',async({page},info)=>{
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

test('saved justify layers still use legacy Canvas/PNG and textarea fallback',async({page})=>{
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
 expect(live.every(p=>p.baseline==='top')).toBe(true);expect(live[1].x).toBeGreaterThan(150);expect(live[3].x).toBeLessThan(60);
 await page.evaluate(()=>{window.captureJustify=true});await exportPNG(page);
 const exported=await page.evaluate(()=>window.justifyExport.filter(p=>['AA','BB','CC','DD'].includes(p.text)));
 expect(exported).toEqual(live);
 await page.locator('#layers .layer-name').filter({hasText:'Justify'}).click();
 const point=await canvasPoint(page,50,30);await page.mouse.dblclick(point.x,point.y);
 await expect(page.locator('#inlineText')).toBeFocused();await expect(page.locator('#inlineWysiwyg')).toBeHidden();
});
