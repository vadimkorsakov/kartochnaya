const {test,expect,openHome,importPayload,records,openLibraryDocument,exportedDocument,exportPNG,canvasPoint}=require('./helpers');
const fixture=require('./fixtures/visual-text.json');
const {PNG}=require('pngjs');

// Observe real calls and keep the native rendering implementation intact.
async function observe(page){
 await page.addInitScript(()=>{
  window.richDraws=[];window.richMeasures=0;window.richFrame=[];
  const proto=CanvasRenderingContext2D.prototype;
  const clear=proto.clearRect;proto.clearRect=function(...args){if(this.canvas.id==='canvas')window.richFrame=[];return clear.apply(this,args)};
  const measure=proto.measureText;proto.measureText=function(...args){window.richMeasures++;return measure.apply(this,args)};
  for(const method of ['fillText','strokeText']){
   const original=proto[method];proto[method]=function(text,x,y,...args){
    const m=measure.call(this,text),d={method,text,x,y,font:this.font,color:method==='fillText'?this.fillStyle:this.strokeStyle,spacing:this.letterSpacing,width:m.width,ascent:m.actualBoundingBoxAscent,descent:m.actualBoundingBoxDescent,canvas:this.canvas.id,baseline:this.textBaseline,alpha:this.globalAlpha};
    if(window.richDraws.length>20000)window.richDraws=[];
    window.richDraws.push(d);if(this.canvas.id==='canvas')window.richFrame.push(d);
    return original.call(this,text,x,y,...args);
   };
  }
 });
}
async function seed(page,patch={}){
 await observe(page);await openHome(page);
 const payload=structuredClone(fixture),e=payload.document.elements[0];
 Object.assign(e,{id:'mixed',name:'Mixed',x:16,y:16,w:288,h:208,fontFamily:'Arial',fontSize:20,lineHeight:1.25,text:'Красный Синий',textColor:'#ff0000',autoFontSize:false,textRuns:[{start:8,end:13,style:{textColor:'#0000ff'}}]},patch);
 await importPayload(page,payload);
 let doc;await expect.poll(async()=>{doc=(await records(page,'docs')).find(d=>d.title==='Visual fixed font (импорт)');return doc?.id}).toBeTruthy();
 await openLibraryDocument(page,doc.id);await expect.poll(()=>page.evaluate(()=>window.richDraws.some(d=>d.baseline==='alphabetic'))).toBe(true);
 return doc;
}
const frame=page=>page.evaluate(()=>window.richFrame.filter(d=>d.baseline==='alphabetic'&&d.method==='fillText'));
const compact=draws=>draws.map(({text,x,y,font,color,spacing})=>({text,x,y,font,color,spacing}));
const layer=async page=>(await exportedDocument(page)).elements[0];
async function select(page){await page.locator('#layers .layer-name').filter({hasText:'Mixed'}).click()}
async function property(page,key,value){const el=page.locator(`#inspector [data-key="${key}"]`);await el.fill(String(value));await el.press('Enter')}
function colored(image,r,g,b){let n=0;for(let i=0;i<image.data.length;i+=4)if(image.data[i]===r&&image.data[i+1]===g&&image.data[i+2]===b&&image.data[i+3]>0)n++;return n}
async function canvasImage(page){return PNG.sync.read(Buffer.from(await page.locator('#canvas').evaluate(c=>c.toDataURL().split(',')[1]),'base64'))}
function rowGroups(draws){const rows=[];for(const d of draws){let row=rows.find(r=>r[0].y===d.y);if(!row)rows.push(row=[]);row.push(d)}return rows}

for(const mobile of [false,true])test.describe(mobile?'mixed rendering mobile':'mixed rendering desktop',()=>{
 test.use(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{});
 test('colors share one baseline; screen and PNG paint both colors',async({page})=>{
  await seed(page);const draws=await frame(page);
  expect(draws.map(d=>d.text)).toEqual(['Красный ','Синий']);expect(draws[0].y).toBe(draws[1].y);
  expect(draws.map(d=>d.color)).toEqual(['#ff0000','#0000ff']);expect(draws[1].x).toBeCloseTo(draws[0].width,5);
  const screen=await canvasImage(page);expect(colored(screen,255,0,0)).toBeGreaterThan(5);expect(colored(screen,0,0,255)).toBeGreaterThan(5);
  const {image}=await exportPNG(page);expect(colored(image,255,0,0)).toBeGreaterThan(20);expect(colored(image,0,0,255)).toBeGreaterThan(20);
 });
});

test('families, explicit weights/styles, boolean aliases and letter spacing reach real glyph drawing',async({page})=>{
 await seed(page,{text:'MMMMiiiiЖЖЖЖ',textRuns:[
  {start:0,end:4,style:{fontFamily:'serif',fontWeight:'300',bold:true,fontStyle:'italic',italic:false,letterSpacing:3}},
  {start:4,end:8,style:{fontFamily:'monospace',bold:true,italic:false,letterSpacing:0}},
  {start:8,end:12,style:{bold:false,italic:true}}
 ]});
 const d=await frame(page);expect(d).toHaveLength(3);
 expect(d[0].font).toContain('italic 300');expect(d[0].font).toContain('serif');expect(d[0].spacing).toBe('3px');
 expect(d[1].font).toMatch(/bold|700/);expect(d[1].font).toContain('monospace');expect(d[1].font).not.toContain('italic');
 expect(d[2].font).toContain('italic');expect(d[2].font).not.toContain('700');
 const widths=await page.evaluate(()=>{
  const c=document.createElement('canvas').getContext('2d');c.fontKerning='normal';
  c.font='italic 300 20px serif';c.letterSpacing='3px';const serif=c.measureText('MMMM').width;
  c.font='700 20px monospace';c.letterSpacing='0px';return [serif,c.measureText('iiii').width];
 });
 expect(d[0].width).toBeCloseTo(widths[0],5);expect(d[1].width).toBeCloseTo(widths[1],5);
 expect(d[1].x).toBeCloseTo(d[0].width,5);expect(d[2].x).toBeCloseTo(d[0].width+d[1].width,5);
 const {image}=await exportPNG(page);expect(colored(image,255,0,0)).toBeGreaterThan(100);
});

for(const align of ['left','center','right'])test(`mixed sizes share a baseline, wrap across styles and align ${align}`,async({page})=>{
 await seed(page,{text:'AAaa BBBB\nccCC\n\nЯ😀  хвост',w:110,textAlign:align,textRuns:[
  {start:2,end:4,style:{fontSize:40,textColor:'#0000ff'}},
  {start:11,end:13,style:{fontSize:30}},
  {start:17,end:18,style:{textColor:'#0000ff'}}
 ]});
 const rows=rowGroups(await frame(page));expect(rows[0].map(d=>d.text).join('')).toBe('AAaa ');
 expect(rows[1].map(d=>d.text).join('')).toBe('BBBB');
 expect(rows[0].map(d=>d.font.match(/([\d.]+)px/)[1])).toContain('40');
 const expected=rows.map(r=>r.map(d=>d.text).join(''));expect(expected.join('')).toBe('AAaa BBBBccCCЯ😀  хвост');
 for(const row of rows){const w=row.reduce((n,d)=>n+d.width,0);expect(row[0].x).toBeCloseTo(align==='left'?0:align==='center'?(110-w)/2:110-w,5)}
 for(let i=1;i<rows.length;i++){
  const previousBottom=Math.max(...rows[i-1].map(d=>d.y+d.descent));const top=Math.min(...rows[i].map(d=>d.y-d.ascent));
  expect(top).toBeGreaterThanOrEqual(previousBottom-.01);
 }
 const before=compact(await frame(page));await page.evaluate(()=>window.richDraws=[]);await exportPNG(page);
 const exported=await page.evaluate(()=>window.richDraws.filter(d=>!d.canvas&&d.baseline==='alphabetic'&&d.method==='fillText'));
 expect(compact(exported.slice(-before.length))).toEqual(before);
});

test('style boundaries do not break words; long Unicode text preserves spaces and complete emoji',async({page})=>{
 const text='  Привет😀длинноеслово 👩‍💻  \n\nКонец ',runs=[{start:4,end:9,style:{textColor:'#0000ff'}},{start:26,end:27,style:{fontSize:24}}];
 await seed(page,{text,w:74,fontSize:20,h:600,textRuns:runs});
 // Export all rows even when the document viewport clips the bottom of the layer.
 await page.evaluate(()=>window.richDraws=[]);await exportPNG(page);
 const d=await page.evaluate(()=>window.richDraws.filter(d=>!d.canvas&&d.baseline==='alphabetic'&&d.method==='fillText'));
 expect(d.map(d=>d.text).join('')).toBe(text.replaceAll('\n',''));
 for(const part of d)expect(part.text).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
 expect(d.some(d=>d.text.includes('👩‍💻'))).toBe(true);
 // A word which fits must remain together across a color boundary.
 await select(page);await property(page,'w',288);
 const rows=rowGroups(await frame(page));expect(rows[0].map(d=>d.text).join('')).toContain('Привет😀длинноеслово');
 expect((await layer(page)).textRuns).toEqual(runs);
});

test('width/height changes, clipping and vertical alignment use the current mixed geometry',async({page})=>{
 await seed(page,{text:'Большой малый\nСтрока',w:270,h:160,verticalAlign:'bottom',textRuns:[{start:0,end:7,style:{fontSize:40,textColor:'#0000ff'}}]});
 await select(page);const wide=await frame(page);await property(page,'w',140);const narrow=await frame(page);
 expect(rowGroups(narrow).length).toBeGreaterThan(rowGroups(wide).length);
 await property(page,'h',45);const clipped=await exportPNG(page);
 // Neither fill nor mixed glyph overhangs may paint below the frame.
 let outside=0;for(let y=62;y<240;y++)for(let x=16;x<156;x++){const i=(y*320+x)*4;if(clipped.image.data[i]!==245||clipped.image.data[i+1]!==243||clipped.image.data[i+2]!==237)outside++}expect(outside).toBe(0)
 await property(page,'h',180);const taller=await frame(page);expect(taller[0].y).toBeGreaterThan(narrow[0].y);
});

test('auto fit scales all sizes without rewriting runs, stays stable and survives save/reopen',async({page})=>{
 const runs=[{start:2,end:4,style:{fontSize:60,textColor:'#0000ff',underline:true,baselineShift:'super',fontFeatures:{liga:0}}}];
 const doc=await seed(page,{text:'aaBB cc dd',fontSize:20,w:140,h:55,textRuns:runs});
 await select(page);await page.locator('#inspector [data-text-auto-font]').check();
 const small=await layer(page);expect(small.textRuns).toEqual(runs);expect(small.textRunsBaseFontSize).toBe(20);
 const checkRatio=async()=>{const d=await frame(page);const sizes=d.map(d=>parseFloat(d.font.match(/([\d.]+)px/)[1]));expect(Math.max(...sizes)/Math.min(...sizes)).toBeCloseTo(3,3)};
 await checkRatio();await property(page,'h',150);const large=await layer(page);expect(large.fontSize).toBeGreaterThan(small.fontSize);await checkRatio();
 await property(page,'h',55);expect((await layer(page)).fontSize).toBe(small.fontSize);await checkRatio();
 const before=(await exportPNG(page)).image.data;
 await expect.poll(async()=>((await records(page,'docs')).find(d=>d.id===doc.id)).elements[0].textRunsBaseFontSize).toBe(20);
 await page.reload();await expect(page.locator('#homeScreen')).toBeVisible();await openLibraryDocument(page,doc.id);
 expect((await exportPNG(page)).image.data.equals(before)).toBe(true);expect((await layer(page)).textRuns).toEqual(runs);
});

test('edge fit uses mixed content and is stable; manual font changes preserve size hierarchy',async({page})=>{
 await seed(page,{text:'aBB',fontSize:20,w:280,h:180,textRuns:[{start:1,end:3,style:{fontSize:50}}]});await select(page);
 await property(page,'fontSize',30);let e=await layer(page);expect(e.textRuns[0].style.fontSize).toBe(50);
 expect((await frame(page)).map(d=>d.font)).toEqual(expect.arrayContaining([expect.stringContaining('30px'),expect.stringContaining('75px')]));
 let p=await canvasPoint(page,e.x+e.w/2,e.y+1);await page.mouse.dblclick(p.x,p.y);const fitted=await layer(page);
 expect(fitted.w).toBeLessThan(e.w);expect(fitted.h).toBeLessThan(e.h);expect(fitted.h).toBeGreaterThan(75);
 expect(fitted.textRuns).toEqual(e.textRuns);p=await canvasPoint(page,fitted.x+fitted.w/2,fitted.y+1);await page.mouse.dblclick(p.x,p.y);
 e=await layer(page);expect([e.w,e.h]).toEqual([fitted.w,fitted.h]);
});

test('zoom reuses measurements and keeps the same layer-local Canvas/PNG positions',async({page})=>{
 await seed(page,{text:'Привет большой 😀 мир\nВторая строка',textRuns:[{start:7,end:14,style:{fontSize:36,fontWeight:'700'}}]});
 const before=compact(await frame(page));const measurements=await page.evaluate(()=>window.richMeasures);
 for(let i=0;i<3;i++){await page.locator('#zoomOutBtn').click();expect(compact(await frame(page))).toEqual(before)}
 expect(await page.evaluate(()=>window.richMeasures)-measurements).toBeLessThan(10);
 await page.evaluate(()=>window.richDraws=[]);await exportPNG(page);
 const exported=await page.evaluate(()=>window.richDraws.filter(d=>!d.canvas&&d.baseline==='alphabetic'&&d.method==='fillText'));
 expect(compact(exported.slice(-before.length))).toEqual(before);
});

for(const fillType of ['solid','gradient','image'])test(`mixed glyphs preserve ${fillType} fill masks, stroke, rotation, opacity and effects`,async({page})=>{
 const image=new PNG({width:2,height:2});for(let i=0;i<image.data.length;i+=4)image.data.set([0,160,0,255],i);
 await seed(page,{text:'Большой A',fillType,imageSrc:'data:image/png;base64,'+PNG.sync.write(image).toString('base64'),fill:'#00aa00',fill2:'#0000aa',stroke:'#111111',strokeWidth:2,rotation:8,opacity:70,effects:[{id:'shadow',type:'dropShadow',enabled:true,blur:3,distance:4,opacity:50,color:'#000000'}],textRuns:[{start:0,end:7,style:{fontSize:36,textColor:'#0000ff'}}]});
 await page.evaluate(()=>window.richDraws=[]);const {image:png}=await exportPNG(page);
 expect(colored(png,245,243,237)).toBeLessThan(320*240-400);
 const d=await page.evaluate(()=>window.richDraws.filter(d=>d.baseline==='alphabetic'));
 const fill=d.filter(d=>d.method==='fillText'),stroke=d.filter(d=>d.method==='strokeText');expect(fill.length).toBeGreaterThan(0);expect(stroke.length).toBeGreaterThan(0);
 expect(fill[0].font).toContain('36px');expect(compact(stroke).map(({color,...d})=>d)).toEqual(compact(fill).map(({color,...d})=>d));
 if(fillType==='solid')expect(fill[0].color).toBe('#0000ff');else expect(fill.every(d=>d.color==='#ffffff')).toBe(true);
});

test('long text with forty ranges renders within budget and avoids repeated full measurement',async({page})=>{
 const text=('Слова 😀 длинный текст с пробелами. ').repeat(100),textRuns=Array.from({length:40},(_,i)=>({start:i*70,end:i*70+35,style:{fontSize:18+i%3,textColor:i%2?'#0000ff':'#ff0000',bold:!!(i%2)}}));
 const start=Date.now();await seed(page,{text,textRuns,w:288,h:208,fontSize:18});await exportPNG(page);expect(Date.now()-start).toBeLessThan(20000);
 const count=await page.evaluate(()=>window.richMeasures);for(let i=0;i<3;i++)await page.locator('#zoomOutBtn').click();
 expect(await page.evaluate(()=>window.richMeasures)-count).toBeLessThan(10);
 expect((await frame(page)).length).toBeGreaterThan(5);
});

test('at document scale the real display Canvas and PNG are pixel-identical',async({page})=>{
 await seed(page,{text:'Цвет 😀 размер\nВторая строка',textRuns:[{start:5,end:7,style:{fontSize:32,textColor:'#0000ff'}},{start:8,end:14,style:{fontFamily:'monospace',italic:true}}]});
 const stageHeight=await page.locator('#stageScroller').evaluate(el=>el.clientHeight);
 await page.setViewportSize({width:1280,height:900+308-stageHeight});await page.locator('#zoomLabel').click();
 await expect(page.locator('#zoomLabel')).toHaveText('100%');
 const screen=await canvasImage(page);expect([screen.width,screen.height]).toEqual([320,240]);
 const png=(await exportPNG(page)).image;expect(png.data.equals(screen.data)).toBe(true);
});

test('loading a font used only by a run invalidates cached geometry for Canvas and PNG',async({page})=>{
 await seed(page,{text:'MMMMiiii хвост',textRuns:[{start:0,end:8,style:{fontFamily:'Rich Run Only Test',fontSize:30}}]});
 const before=(await frame(page))[0].width;
 const bytes=require('node:fs').readFileSync(require('node:path').join(__dirname,'fixtures/fonts/DejaVuSans.ttf'));
 await page.evaluate(async bytes=>{const face=new FontFace('Rich Run Only Test',new Uint8Array(bytes));document.fonts.add(face);await document.fonts.load('30px \"Rich Run Only Test\"','MMMMiiii')},[...bytes]);
 await expect.poll(()=>page.evaluate(()=>[...document.fonts].some(f=>f.family.replaceAll('"','')==='Rich Run Only Test'&&f.status==='loaded'))).toBe(true);
 await page.locator('#zoomOutBtn').click();
 const after=(await frame(page))[0].width;expect(after).not.toBeCloseTo(before,1);
 const screen=compact(await frame(page));await page.evaluate(()=>window.richDraws=[]);await exportPNG(page);
 const draws=await page.evaluate(()=>window.richDraws.filter(d=>!d.canvas&&d.baseline==='alphabetic'&&d.method==='fillText'));
 expect(compact(draws.slice(-screen.length))).toEqual(screen);
});

test('text backdrop follows the ink bands of mixed-size rows',async({page})=>{
 await seed(page,{text:'A b\nc',textRuns:[{start:0,end:1,style:{fontSize:50,textColor:'#0000ff'}}],effects:[{id:'backdrop',type:'textBackdrop',enabled:true,spread:0,roundness:0,opacity:100,color:'#00ff00'}]});
 await page.evaluate(()=>window.richDraws=[]);const {image}=await exportPNG(page);
 const draws=await page.evaluate(()=>window.richDraws.filter(d=>d.baseline==='alphabetic'&&d.method==='fillText'));
 const inkBottom=Math.max(...draws.map(d=>16+d.y+d.descent));let greenBottom=-1;
 for(let y=0;y<240;y++)for(let x=0;x<320;x++){const i=(y*320+x)*4;if(image.data[i]===0&&image.data[i+1]===255&&image.data[i+2]===0)greenBottom=y}
 expect(greenBottom).toBeGreaterThanOrEqual(Math.floor(inkBottom)-2);
 expect(colored(image,0,255,0)).toBeGreaterThan(200);
});
