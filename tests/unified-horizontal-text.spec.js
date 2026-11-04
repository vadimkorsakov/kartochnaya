const {test,expect,openHome,importPayload,records,openLibraryDocument,exportPNG}=require('./helpers');
const fixture=require('./fixtures/visual-text.json');

test('plain and styled horizontal layers use the same alphabetic layout in Canvas and PNG',async({page})=>{
 await page.addInitScript(()=>{
  window.horizontalGlyphs=[];
  const old=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...args){
   window.horizontalGlyphs.push({text,x,y,baseline:this.textBaseline,canvas:this.canvas.id,color:this.fillStyle,font:this.font});
   return old.call(this,text,x,y,...args);
  };
 });
 await openHome(page);
 const payload=structuredClone(fixture),first=payload.document.elements[0];
 Object.assign(first,{id:'plain',name:'Plain unified',x:16,y:16,w:280,h:90,
  text:'HHHH HHHH',fontFamily:'Arial',fontSize:24,lineHeight:1.2,
  textColor:'#dd2211',textRuns:undefined,autoFontSize:false});
 payload.document.elements.push({...first,id:'styled',name:'Styled unified',y:128,textRuns:[
  {start:2,end:6,style:{textColor:'#2244dd'}}
 ]});
 await importPayload(page,payload);
 let doc;await expect.poll(async()=>{
  doc=(await records(page,'docs')).find(d=>d.title==='Visual fixed font (импорт)');
  return doc?.id;
 }).toBeTruthy();
 await openLibraryDocument(page,doc.id);
 await expect.poll(()=>page.evaluate(()=>window.horizontalGlyphs.some(g=>g.canvas==='canvas'&&g.text==='HHHH HHHH'&&g.baseline==='alphabetic'))).toBe(true);
 const recorded=await page.evaluate(()=>window.horizontalGlyphs.filter(g=>g.canvas==='canvas'&&g.baseline==='alphabetic'));
 const plain=recorded.find(g=>g.text==='HHHH HHHH');
 const styled=recorded.slice(recorded.indexOf(plain)+1).filter(g=>g.text==='HH'||g.text==='HH H'||g.text==='HHH');
 expect(plain).toBeTruthy();
 expect(styled.length).toBeGreaterThan(1);
 for(const g of styled)expect(g.y).toBeCloseTo(plain.y,4);
 expect(styled[0].x).toBeCloseTo(plain.x,4);
 // Observing the exported offscreen Canvas ensures the shared drawing path is
 // also used for PNG; no old top-baseline rendering is allowed for either layer.
 await page.evaluate(()=>{window.horizontalGlyphs=[]});
 await exportPNG(page);
 const exported=await page.evaluate(()=>window.horizontalGlyphs.filter(g=>!g.canvas&&g.text.includes('H')));
 expect(exported.length).toBeGreaterThan(2);
 expect(exported.every(g=>g.baseline==='alphabetic')).toBe(true);
 const docAgain=(await records(page,'docs')).find(d=>d.id===doc.id);
 expect(docAgain.elements[0].textRuns).toBeUndefined();
 expect(docAgain.elements[1].textRuns).toHaveLength(1);
});

test('plain layout preserves same baseline and width before and after a color-only run',async({page})=>{
 await openHome(page);
 const result=await page.evaluate(async()=>{
  const {createRichTextLayoutEngine}=await import('/src/render/rich-text-layout.mjs');
  const ctx=document.createElement('canvas').getContext('2d');
  const engine=createRichTextLayoutEngine(ctx,document.fonts);
  const base={text:'HHHH HH',w:300,h:100,fontSize:26,fontFamily:'Arial',lineHeight:1.1};
  const a=engine.layout(base),b=engine.layout({...base,textRuns:[{start:2,end:4,style:{textColor:'#aabbcc'}}]});
  return {plain:[a.width,a.height,a.rows[0].baseline],colored:[b.width,b.height,b.rows[0].baseline]};
 });
 expect(result.colored[0]).toBeCloseTo(result.plain[0],4);
 expect(result.colored[1]).toBeCloseTo(result.plain[1],4);
 expect(result.colored[2]).toBeCloseTo(result.plain[2],4);
});
