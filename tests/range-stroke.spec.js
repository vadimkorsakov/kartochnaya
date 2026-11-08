const {test,expect,openHome,importPayload,records,openLibraryDocument,exportedDocument,exportPNG,canvasPoint}=require('./helpers');
const {PNG}=require('pngjs');
const fs=require('node:fs'),path=require('node:path');
const fixture=require('./fixtures/canvas-graph.json'),surface='#inlineWysiwyg',overlay='[data-text-stroke-overlay]';
test.describe.configure({timeout:90000});
const font=(family,file)=>({name:family,family,weight:400,style:'normal',data:'data:font/ttf;base64,'+fs.readFileSync(path.join(__dirname,'fixtures/fonts',file)).toString('base64')});
const fonts=[font('Stroke Serif','DejaVuSerif.ttf'),font('Stroke Sans','DejaVuSans.ttf')];
const layer=d=>d.elements.find(e=>e.id==='title');
async function seed(page,patch={},multiple=false,backdrop=false){
 await page.setViewportSize({width:2200,height:1400});
 await openHome(page);const payload=structuredClone(fixture);payload.fonts=fonts;payload.documents=[payload.documents[0]];
 const doc=payload.documents[0];doc.groups=[];doc.background='#ffffff';doc.elements=doc.elements.filter(e=>e.id==='title');
 Object.assign(doc.elements[0],{text:'Первое второе слово',x:20,y:40,w:280,h:160,fontFamily:'Stroke Serif',fontSize:24,lineHeight:1.2,textColor:'#111111',autoFontSize:false,rotation:0,textAlign:'left',verticalAlign:'top',...patch});
 if(multiple)doc.elements.push({...structuredClone(doc.elements[0]),id:'second',text:'Другой текст',y:130,h:60});
 if(backdrop){
  const image=new PNG({width:320,height:240});
  for(let y=0;y<240;y++)for(let x=0;x<320;x++){const i=(y*320+x)*4,color=(Math.floor(x/8)+Math.floor(y/8))%2?[40,220,240,255]:[245,220,70,255];image.data.set(color,i);}
  const rasterSrc='data:image/png;base64,'+PNG.sync.write(image).toString('base64');
  doc.elements.unshift({id:'backdrop',type:'raster',name:'Контрастное изображение',x:0,y:0,w:320,h:240,visible:true,opacity:100,rasterSrc});
  await page.evaluate(src=>window.__rangeBackdrop=src,rasterSrc);
 }
 await importPayload(page,payload);await expect(page.locator('#toast')).toContainText('Импортировано проектов');
 const stored=(await records(page,'docs')).find(d=>layer(d));await openLibraryDocument(page,stored.id);
 await actualSize(page);
 await expect(page.locator('#zoomLabel')).toHaveText('100%');
 // Remove only editing affordances from ink measurements; product ink remains.
 await page.addStyleTag({content:'.inline-wysiwyg{outline:none!important;caret-color:transparent!important}.inline-wysiwyg ::selection{background:transparent!important}'});
 return stored;
}
async function actualSize(page){for(let i=0;i<60;i++){const zoom=parseInt(await page.locator('#zoomLabel').textContent());if(zoom===100)break;await page.locator(zoom>100?'#zoomOutBtn':'#zoomInBtn').click();}await expect(page.locator('#zoomLabel')).toHaveText('100%');}
async function edit(page){await page.locator('#layers [data-layer="title"] .layer-name').click();const p=await canvasPoint(page,55,57);await page.mouse.dblclick(p.x,p.y);await expect(page.locator(surface)).toBeFocused();await expect(page.locator('#inlineText')).toBeHidden();}
async function selection(page){return page.locator(surface).evaluate(el=>{
 const s=getSelection(),offset=(node,n)=>{const r=document.createRange();r.setStart(el,0);r.setEnd(node,n);return r.toString().length;};return {anchor:offset(s.anchorNode,s.anchorOffset),focus:offset(s.focusNode,s.focusOffset)};
});}
async function select(page,anchor,focus){
 await page.locator(surface).focus();await page.keyboard.press('Control+Home');const text=await page.locator(surface).textContent();
 const count=i=>Array.from(text.slice(0,i)).length;
 for(let i=0;i<count(anchor);i++)await page.keyboard.press('ArrowRight');
 for(let i=0;i<Math.abs(count(anchor)-count(focus));i++)await page.keyboard.press(focus<anchor?'Shift+ArrowLeft':'Shift+ArrowRight');
 expect(await selection(page)).toEqual({anchor,focus});
}
async function field(page,key,value){const input=page.locator(`#inspector [data-key="${key}"]`);await input.fill(String(value));await expect(input).toBeFocused();await input.press('Tab');}
async function color(page,value,{close=true}={}){
 if(!await page.locator('#fillPopover').isVisible())await page.locator('#inspector [data-fill-open="stroke"]').click();
 const input=page.locator('#fillPopover [data-cp-part="0"]');await input.fill(value);await expect(input).toBeFocused();
 if(close){await input.press('Tab');await page.locator('[data-fill-close]').click();}
}
async function model(page){
 return layer(await page.evaluate(async()=>{
  const click=HTMLAnchorElement.prototype.click;let url;
  HTMLAnchorElement.prototype.click=function(...args){if(this.download?.endsWith('.json'))url=this.href;else return click.apply(this,args);};
  try{document.querySelector('#jsonExportBtn').click();return await (await fetch(url)).json();}finally{HTMLAnchorElement.prototype.click=click;}
 }).then(p=>p.document));
}
async function exportedPayload(page){
 const pending=page.waitForEvent('download');await page.locator('#jsonExportBtn').evaluate(el=>el.click());
 const download=await pending;expect(await download.failure()).toBeNull();
 return JSON.parse(fs.readFileSync(await download.path(),'utf8'));
}
async function livePixels(page){
 return page.evaluate(async()=>{
  const canvas=document.querySelector('#canvas'),ink=document.querySelector('[data-text-stroke-overlay]');
  if(!ink||getComputedStyle(ink).display==='none')throw Error('No live ink overlay');
  const a=canvas.getBoundingClientRect(),b=ink.getBoundingClientRect(),scale=a.width/320;
  const image=document.createElement('canvas');image.width=320;image.height=240;const c=image.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,320,240);
  if(window.__rangeBackdrop){const img=new Image();img.src=window.__rangeBackdrop;await img.decode();c.drawImage(img,0,0);}
  c.drawImage(ink,(b.left-a.left)/scale,(b.top-a.top)/scale,b.width/scale,b.height/scale);
  return [...c.getImageData(0,0,320,240).data];
 });
}
function diff(a,b){let changed=0,above2=0,max=0;for(let i=0;i<a.length;i+=4){const d=Math.max(...[0,1,2,3].map(k=>Math.abs(a[i+k]-b[i+k])));if(d)changed++;if(d>2)above2++;max=Math.max(max,d);}return {changed,above2,max};}
async function parity(page,testInfo,label='parity'){
 const live=await livePixels(page);await testInfo.attach(label+'-live.png',{body:PNG.sync.write({width:320,height:240,data:Buffer.from(live)}),contentType:'image/png'});
 await page.locator(surface).focus();await page.keyboard.press('Control+Enter');await expect(page.locator(overlay)).toHaveCount(0);
 const p=await canvasPoint(page,310,230);await page.mouse.click(p.x,p.y);
 if(await page.evaluate(()=>!!window.__rangeBackdrop))await page.keyboard.press('Escape');
 const screen=await page.locator('#canvas').evaluate(c=>[...c.getContext('2d').getImageData(0,0,c.width,c.height).data]);
 const exported=await exportPNG(page),canvas=diff(screen,exported.image.data),projection=diff(live,exported.image.data);
 await testInfo.attach(label+'-export.png',{body:exported.bytes,contentType:'image/png'});
 await testInfo.attach(label+'.json',{body:JSON.stringify({canvas,projection}),contentType:'application/json'});
 expect(canvas.max).toBeLessThanOrEqual(1);expect(projection.max).toBeLessThanOrEqual(2);expect(projection.above2).toBe(0);
 return exported.image;
}

test('word stroke is live, isolated, backward-selection safe, persisted and identical in Canvas/PNG',async({page,browser},testInfo)=>{
 const doc=await seed(page);await edit(page);await select(page,6,0);
 await field(page,'strokeWidth',3);await color(page,'#dd2244');await page.locator(surface).focus();
 expect(await selection(page)).toEqual({anchor:6,focus:0});
 const e=await model(page);expect(e.textRuns).toEqual([{start:0,end:6,style:{stroke:'#dd2244',strokeWidth:3}}]);
 await expect(page.locator(overlay)).toHaveCSS('pointer-events','none');
 await expect(page.locator(overlay)).toBeVisible();await expect(page.locator(surface)).toHaveClass(/wysiwyg-canvas-ink/);
 await testInfo.attach('live-editor.png',{body:await page.screenshot(),contentType:'image/png'});
 expect(await page.locator(overlay).evaluate(el=>document.querySelector('#inlineWysiwyg').contains(el))).toBe(false);
 const image=await parity(page,testInfo);
 let colored=0,neighbor=0;for(let y=0;y<240;y++)for(let x=0;x<320;x++){const i=(y*320+x)*4;if(image.data[i]>150&&image.data[i+1]<100&&image.data[i+2]<130){colored++;if(x>135)neighbor++;}}
 expect(colored).toBeGreaterThan(100);expect(neighbor).toBe(0);
 await expect.poll(async()=>layer((await records(page,'docs')).find(d=>d.id===doc.id))).toEqual(e);
 const payload=await exportedPayload(page),json=payload.document;expect(layer(json)).toEqual(e);
 await page.reload();await openLibraryDocument(page,doc.id);await edit(page);expect(await model(page)).toEqual(e);
 await page.keyboard.press('Control+Enter');
 // Import the actual exported document into a clean database/context as well.
 const fresh=await browser.newContext({baseURL:'http://127.0.0.1:4173',viewport:{width:2200,height:1400},acceptDownloads:true});
 try{
  const imported=await fresh.newPage();await openHome(imported);
  await importPayload(imported,payload);
  await expect(imported.locator('#toast')).toContainText('Документ импортирован');const saved=(await records(imported,'docs')).find(d=>d.elements.some(t=>t.type==='text'&&t.text===e.text));
  await openLibraryDocument(imported,saved.id);const target=saved.elements.find(t=>t.type==='text');
  await imported.locator(`#layers [data-layer="${target.id}"] .layer-name`).click();const point=await canvasPoint(imported,55,57);await imported.mouse.dblclick(point.x,point.y);await expect(imported.locator(surface)).toBeFocused();
  const restored=(await exportedDocument(imported)).elements.find(t=>t.type==='text');expect({...restored,id:e.id}).toEqual(e);
  await imported.keyboard.press('Control+Enter');
 }finally{await fresh.close();}
});

test('adjacent stroke widths, Mixed empty input and arrows, zero override and grouped picker undo',async({page},testInfo)=>{
 await seed(page,{text:'fiAV',fontSize:36,strokeWidth:4,stroke:'#333333'});await edit(page);
 await select(page,0,1);await field(page,'strokeWidth',0);await select(page,1,2);await field(page,'strokeWidth',2);
 await select(page,0,2);const width=page.locator('#inspector [data-key="strokeWidth"]');await expect(width).toHaveValue('');await expect(width).toHaveAttribute('placeholder','Mixed');
 const mixed=await model(page);await width.fill('');await width.press('Tab');expect(await model(page)).toEqual(mixed);
 await width.locator('..').locator('[data-num-direction="up"]').click();await expect(width).toHaveValue('1');
 await select(page,2,1);await color(page,'#dd2244',{close:false});await color(page,'#2266dd',{close:false});await color(page,'#228844',{close:false});
 await page.locator('[data-fill-close]').click();await page.locator(surface).focus();expect(await selection(page)).toEqual({anchor:2,focus:1});
 const changed=await model(page);await page.keyboard.press('Control+z');expect((await model(page)).textRuns.some(r=>r.style.stroke==='#228844')).toBe(false);
 await page.keyboard.press('Control+Shift+z');expect(await model(page)).toEqual(changed);
 await parity(page,testInfo);
});

for(const partial of [true,false])test(`fi ${partial?'partial':'whole'} stroke uses the same split fill and stroke geometry on all surfaces`,async({page},testInfo)=>{
 await seed(page,{text:'fi AV',fontSize:48});await edit(page);await select(page,0,partial?1:2);
 await field(page,'strokeWidth',4);await color(page,'#2266dd');
 const parts=await page.locator(surface+' [data-wysiwyg-fragment]').allTextContents();
 expect(parts).toEqual(partial?['f','i AV']:['fi',' AV']);
 // Independent native oracle: it never imports the production layout/painter.
 // In the partial case BOTH fill calls must split; a fused fill + f outline
 // would differ substantially from this raster.
 const expected=await page.evaluate(partial=>{
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const c=canvas.getContext('2d');
  c.fillStyle='#fff';c.fillRect(0,0,320,240);c.font='normal 400 48px "Stroke Serif"';c.fontKerning='normal';c.letterSpacing='0px';
  const m=c.measureText('Mg'),baseline=40+m.fontBoundingBoxAscent+(Math.max(48*1.2,m.fontBoundingBoxAscent+m.fontBoundingBoxDescent)-m.fontBoundingBoxAscent-m.fontBoundingBoxDescent)/2;
  const first=partial?'f':'fi',rest=partial?'i AV':' AV',x=20+c.measureText('fi AV').width-c.measureText(rest).width;
  c.fillStyle='#111111';c.fillText(first,20,baseline);c.fillText(rest,x,baseline);
  c.lineWidth=4;c.strokeStyle='#2266dd';c.lineJoin='round';c.miterLimit=2;c.strokeText(first,20,baseline);
  return [...c.getImageData(0,0,320,240).data];
 },partial);
 const oracle=diff(await livePixels(page),expected);expect(oracle.max).toBeLessThanOrEqual(2);
 await testInfo.attach('independent-fi-oracle.json',{body:JSON.stringify(oracle),contentType:'application/json'});
 await parity(page,testInfo,partial?'partial-fi':'whole-fi');
});

for(const strokeStyle of ['solid','dashed','dotted'])test(`legacy ${strokeStyle} layer stroke and opacity survive a live zero-width range`,async({page},testInfo)=>{
 await seed(page,{text:'fi AV',fontSize:36,strokeWidth:4,stroke:'#dd2244',strokeOpacity:35,strokeStyle});
 await edit(page);await select(page,0,2);await field(page,'strokeWidth',0);
 const e=await model(page);expect(e.strokeWidth).toBe(4);expect(e.strokeOpacity).toBe(35);expect(e.strokeStyle).toBe(strokeStyle);
 expect(e.textRuns).toEqual([{start:0,end:2,style:{strokeWidth:0}}]);
 const image=await parity(page,testInfo,strokeStyle+'-zero');let first=0,rest=0;
 for(let y=35;y<100;y++)for(let x=15;x<180;x++){const i=(y*320+x)*4;if(image.data[i]>image.data[i+1]+30&&image.data[i]>image.data[i+2]+15){if(x<48)first++;else rest++;}}
 expect(first).toBe(0);expect(rest).toBeGreaterThan(20);
});

for(const autoFontSize of [false,true])test(`mixed typography, LF/soft wrap, emoji, U/S, text edits and auto fit ${autoFontSize}`,async({page},testInfo)=>{
 const text='AV fi Жук 😀 мягкий перенос\nСледующая строка';
 const doc=await seed(page,{text,fontSize:28,w:180,h:160,autoFontSize,textRuns:[
  {start:0,end:2,style:{fontWeight:'700',underline:true}},
  {start:3,end:5,style:{fontFamily:'Stroke Sans',fontSize:36,lineHeight:1.5}},
  {start:6,end:9,style:{fontSize:22,letterSpacing:1.5,strikethrough:true}},
 ]});
 await edit(page);const size=(await model(page)).fontSize;
 await select(page,0,14);await field(page,'strokeWidth',2);await color(page,'#2266dd');
 expect((await model(page)).fontSize).toBe(size);expect((await model(page)).autoFontSize).toBe(autoFontSize);
 await field(page,'lineHeight',1.8);await page.locator('#inspector [data-text-decoration="underline"]').click();await page.locator('#inspector [data-text-decoration="strikethrough"]').click();
 await page.locator(surface).focus();const formatted=await model(page);
 await page.keyboard.press('ArrowRight');await page.keyboard.type('X');const typed=await model(page);
 expect(typed.text).toBe(text.slice(0,14)+'X'+text.slice(14));
 await page.keyboard.press('Control+z');expect(await model(page)).toEqual(formatted);
 await page.keyboard.press('Control+Shift+z');expect(await model(page)).toEqual(typed);
 await parity(page,testInfo,'mixed-auto-'+autoFontSize);
 await expect.poll(async()=>layer((await records(page,'docs')).find(d=>d.id===doc.id))).toEqual(typed);
 await edit(page);await select(page,0,2);await field(page,'strokeWidth',9);await page.locator(surface).focus();await page.keyboard.press('Escape');
 expect(await model(page)).toEqual(typed);await expect(page.locator(overlay)).toHaveCount(0);
});

test('a caret requires a range; layer editing outside WYSIWYG still changes the whole layer',async({page})=>{
 await seed(page,{text:'fi AV'});await edit(page);await select(page,1,1);const before=await model(page);
 await field(page,'strokeWidth',4);await color(page,'#dd2244');expect(await model(page)).toEqual(before);
 await expect(page.locator(surface)).toBeVisible();await expect(page.locator('#inlineText')).toBeHidden();
 await page.locator(surface).focus();expect(await selection(page)).toEqual({anchor:1,focus:1});await page.keyboard.press('Control+Enter');
 await field(page,'strokeWidth',3);await color(page,'#2266dd');const after=await model(page);
 expect(after.strokeWidth).toBe(3);expect(after.stroke).toBe('#2266dd');expect(after.textRuns).toBeUndefined();
});

test('multiple text layers retain Mixed controls and whole-layer stroke updates',async({page})=>{
 await seed(page,{text:'fi AV',textRuns:[{start:0,end:1,style:{strokeWidth:2,stroke:'#dd2244'}}]},true);
 await page.locator('#layers [data-layer="title"] .layer-name').click();await page.locator('#layers [data-layer="second"] .layer-name').click({modifiers:['Control']});
 const width=page.locator('#inspector [data-key="strokeWidth"]');await expect(width).toHaveAttribute('placeholder','Mixed');
 await width.locator('..').locator('[data-num-direction="up"]').click();await color(page,'#2266dd');
 const doc=await exportedDocument(page);for(const e of doc.elements){expect(e.strokeWidth).toBe(3);expect(e.stroke).toBe('#2266dd');expect(e.textRuns).toBeUndefined();}
});

test('formatting fi preserves the existing colored AV fragment pixel for pixel',async({page},testInfo)=>{
 await seed(page,{text:'AV fi',fontSize:48,textRuns:[{start:1,end:2,style:{textColor:'#2266dd'}}]});
 const original=(await exportPNG(page)).image;await edit(page);await select(page,3,4);await field(page,'strokeWidth',2);await color(page,'#dd2244');
 const painted=await parity(page,testInfo,'unaffected-colored-V');
 let changed=0;for(let y=35;y<110;y++)for(let x=35;x<96;x++)for(let k=0;k<4;k++){const i=(y*320+x)*4+k;if(original.data[i]!==painted.data[i])changed++;}
 expect(changed).toBe(0);
});

test('stroke overlay preserves the existing unconfirmed-DOM recovery guard',async({page})=>{
 await seed(page,{text:'fi AV',strokeWidth:3});await edit(page);const before=await model(page);
 await page.locator(surface).evaluate(el=>{el.querySelector('[data-wysiwyg-fragment]').firstChild.appendData('Q');el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'Q'}));});
 expect(await model(page)).toEqual(before);await expect(page.locator('#wysiwygRecovery')).toBeVisible();
 await expect(page.locator(surface)).not.toHaveClass(/wysiwyg-canvas-ink/);await expect(page.locator(overlay)).toBeHidden();
 await expect(page.locator(surface)).toContainText('Q');await page.locator('#wysiwygRecover').click();
 await expect(page.locator(surface)).toHaveText(before.text);await expect(page.locator(overlay)).toBeVisible();
 await page.locator(surface).focus();await page.keyboard.press('Control+Enter');await expect(page.locator(overlay)).toHaveCount(0);
});

test('outlined text keeps native caret and remains editable through a thick contour',async({page,browserName},testInfo)=>{
 await seed(page,{text:'MMMM',fontSize:48,fontWeight:'700',strokeWidth:16,stroke:'#2266dd'});await edit(page);await select(page,0,0);
 const caret=await page.locator(surface).evaluate(el=>{
  el.style.setProperty('caret-color','#00ff00','important');const r=document.createRange(),node=el.querySelector('[data-wysiwyg-fragment]').firstChild;
  r.setStart(node,0);r.collapse(true);return r.getBoundingClientRect().toJSON();
 });
 let greenRows=null,lastShot=null;
 if(browserName==='chromium'){
  greenRows=0;
  for(let attempt=0;attempt<10;attempt++){
   lastShot=await page.screenshot({caret:'initial',clip:{x:Math.floor(caret.x)-3,y:Math.floor(caret.y)-2,width:8,height:Math.ceil(caret.height)+4}});
   const image=PNG.sync.read(lastShot),rows=new Set();
   for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){const i=(y*image.width+x)*4;if(image.data[i+1]>image.data[i]+80&&image.data[i+1]>image.data[i+2]+50)rows.add(y);}
   greenRows=Math.max(greenRows,rows.size);if(greenRows>=Math.floor(caret.height)-2)break;await page.waitForTimeout(120);
  }
  expect(greenRows).toBeGreaterThanOrEqual(Math.floor(caret.height)-2);
  await testInfo.attach('native-caret.png',{body:lastShot,contentType:'image/png'});
 }
 // The existing Arial caret diagnostics establish that Playwright Firefox
 // screenshots omit the native caret even on unmodified contenteditable.
 // Verify its real Selection and editing contract without fabricating pixels.
 expect(caret.height).toBeGreaterThan(40);expect(await selection(page)).toEqual({anchor:0,focus:0});
 await page.keyboard.press('ArrowRight');await page.keyboard.type('X');expect((await model(page)).text).toBe('MXMMM');
 await page.keyboard.press('Control+z');expect((await model(page)).text).toBe('MMMM');
 await testInfo.attach('native-caret.json',{body:JSON.stringify({browserName,caret,greenRows,rasterVerified:browserName==='chromium'}),contentType:'application/json'});
 await page.keyboard.press('Control+Enter');
});

test.describe('retina projection',()=>{
 test.use({deviceScaleFactor:2});
 for(const ink of ['stroke','fillOpacity'])test(`${ink} overlay follows zoom, fractional origin, DPR, scroll and viewport resizing`,async({page},testInfo)=>{
  await seed(page,{text:'AV fi Жук',fontSize:28.375,x:20.25,y:40.5});await edit(page);await select(page,2,0);if(ink==='stroke'){await field(page,'strokeWidth',4);await color(page,'#2266dd');}else await fillAlpha(page,50);
  const results=[];
  for(const zoom of [100,150,50]){
   await page.locator(surface).focus();
   for(let i=0;i<20;i++){const current=parseInt(await page.locator('#zoomLabel').textContent());if(current===zoom)break;await page.locator('#stageScroller').dispatchEvent('wheel',{ctrlKey:true,deltaY:current<zoom?-10:10,clientX:850,clientY:600});}
   await expect(page.locator('#zoomLabel')).toHaveText(zoom+'%');
   await page.locator('#stageScroller').evaluate(el=>{el.scrollLeft+=31;el.scrollTop+=19;});
   if(zoom===150)await page.setViewportSize({width:2100,height:1300});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   expect(await selection(page)).toEqual({anchor:2,focus:0});
   const geometry=await page.evaluate(()=>{const a=document.querySelector('#canvas'),b=document.querySelector('[data-text-stroke-overlay]');return {canvas:a.getBoundingClientRect().toJSON(),ink:b.getBoundingClientRect().toJSON(),backing:{width:b.width,height:b.height},style:b.style.cssText};});
   // Playwright rounds screenshot clips in CSS pixels. Request an integer CSS
   // clip, then sample the known device-pixel rectangle; do not shift images
   // to find a better match or resample the captured ink.
   // Stay below the fixed-size north resize handle even at 50% zoom. The
   // full backing-raster comparison above still covers every glyph edge.
   const screenshot=async()=>{
    const a=await page.locator('#canvas').boundingBox(),z=a.width/320;
    const x=a.x+35*z,y=a.y+56*z,clip={x:Math.floor(x),y:Math.floor(y),width:Math.ceil(220*z)+2,height:Math.ceil(32*z)+2};
    const full=PNG.sync.read(await page.screenshot({clip})),width=Math.round(220*z*2),height=Math.round(32*z*2),data=Buffer.alloc(width*height*4);
    const left=Math.round((x-clip.x)*2),top=Math.round((y-clip.y)*2);
    for(let row=0;row<height;row++)full.data.copy(data,row*width*4,((row+top)*full.width+left)*4,((row+top)*full.width+left+width)*4);
    return {width,height,data};
   };
   const visible=await screenshot();
   const live=await page.evaluate(()=>{
    const base=document.querySelector('#canvas'),ink=document.querySelector('[data-text-stroke-overlay]'),a=base.getBoundingClientRect(),b=ink.getBoundingClientRect(),scale=base.width/a.width;
    const image=document.createElement('canvas');image.width=base.width;image.height=base.height;const c=image.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,image.width,image.height);
    const x=(b.left-a.left)*scale,y=(b.top-a.top)*scale;
    // The overlay's raster origin is constructed on this same integer grid.
    // DOMRect in Gecko exposes 1/60-CSS-pixel precision, so validate that grid
    // and copy intrinsic backing pixels without a second image resampling.
    if(Math.abs(x-Math.round(x))>.04||Math.abs(y-Math.round(y))>.04||Math.abs(b.width*scale-ink.width)>.04||Math.abs(b.height*scale-ink.height)>.04)throw Error('Overlay is off the main Canvas pixel grid');
    c.drawImage(ink,Math.round(x),Math.round(y));return image.toDataURL();
   });
   await page.keyboard.press('Control+Enter');const p=await canvasPoint(page,310,230);await page.mouse.click(p.x,p.y);
   const screen=await page.locator('#canvas').evaluate(c=>c.toDataURL());
   const decode=data=>PNG.sync.read(Buffer.from(data.split(',')[1],'base64')).data;
   const metric=diff(decode(live),decode(screen));results.push({zoom,...metric});
   const closed=await screenshot(),display=diff(visible.data,closed.data);
   await testInfo.attach('retina-'+zoom+'.json',{body:JSON.stringify({metric,display,geometry}),contentType:'application/json'});
   if(metric.max>2){await testInfo.attach('retina-live-'+zoom+'.png',{body:Buffer.from(live.split(',')[1],'base64'),contentType:'image/png'});await testInfo.attach('retina-canvas-'+zoom+'.png',{body:Buffer.from(screen.split(',')[1],'base64'),contentType:'image/png'});}
   if(display.max>2){await testInfo.attach('visible-live-'+zoom+'.png',{body:PNG.sync.write(visible),contentType:'image/png'});await testInfo.attach('visible-closed-'+zoom+'.png',{body:PNG.sync.write(closed),contentType:'image/png'});}
   expect(metric.max).toBeLessThanOrEqual(2);
   expect(display.max).toBeLessThanOrEqual(2);
   if(zoom!==50){await edit(page);await select(page,2,0);}
  }
  await testInfo.attach('retina-zoom.json',{body:JSON.stringify(results),contentType:'application/json'});
 });
});

async function fillPicker(page){if(!await page.locator('#fillPopover').isVisible())await page.locator('#inspector [data-fill-open="textColor"],#inspector [data-fill-open="fill"]').first().click();}
async function fillAlpha(page,value,slider=false){
 await fillPicker(page);
 const input=page.locator(slider?'#cpAlpha':'#cpAlphaInput');
 if(slider){await input.focus();await input.press('Home');for(let i=0;i<value;i++)await input.press('ArrowRight');await input.press('Tab');}
 else{await input.fill(String(value));await expect(input).toBeFocused();await input.press('Tab');}
 await expect(page.locator('#cpAlphaInput')).toHaveValue(String(value));
 await page.locator('[data-fill-close]').click();
}
async function visibleInk(page,width=220){
 const a=await page.locator('#canvas').boundingBox();
 // Fixed document ROI inside the text frame excludes only selection handles.
 return PNG.sync.read(await page.screenshot({clip:{x:Math.ceil(a.x+35),y:Math.ceil(a.y+56),width,height:32}}));
}

test('fill opacity zero reveals the lower image only inside the selected word and preserves opaque contours',async({page,browser},testInfo)=>{
 const doc=await seed(page,{text:'HH NN',fontSize:64,fontWeight:'700',strokeWidth:1,stroke:'#dd2244'},false,true);
 const opaque=(await exportPNG(page)).image;
 await edit(page);await select(page,2,0);await fillAlpha(page,0);
 await page.locator(surface).focus();expect(await selection(page)).toEqual({anchor:2,focus:0});
 const e=await model(page);expect(e.fillOpacity??100).toBe(100);expect(e.textRuns).toEqual([{start:0,end:2,style:{fillOpacity:0}}]);
 await expect(page.locator(overlay)).toBeVisible();const visible=await visibleInk(page);
 const image=await parity(page,testInfo,'fill-zero-lower-image');
 const closed=await visibleInk(page),display=diff(visible.data,closed.data);
 await testInfo.attach('fill-zero-closed.png',{body:PNG.sync.write(closed),contentType:'image/png'});
 await testInfo.attach('fill-zero-screen.json',{body:JSON.stringify(display),contentType:'application/json'});
 await testInfo.attach('fill-zero-visible.png',{body:PNG.sync.write(visible),contentType:'image/png'});expect(display.max).toBeLessThanOrEqual(2);
 // Interior pixels formerly covered by opaque glyphs now show the exact lower
 // checker image. Stroke pixels and the neighboring word are unchanged.
 const background=PNG.sync.read(Buffer.from((await page.evaluate(()=>window.__rangeBackdrop)).split(',')[1],'base64'));
 const native=await page.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const c=canvas.getContext('2d'),img=new Image();img.src=window.__rangeBackdrop;await img.decode();c.drawImage(img,0,0);
  c.font='normal 700 64px "Stroke Serif"';c.fontKerning='normal';c.letterSpacing='0px';
  const m=c.measureText('Mg'),baseline=40+m.fontBoundingBoxAscent+(Math.max(64*1.2,m.fontBoundingBoxAscent+m.fontBoundingBoxDescent)-m.fontBoundingBoxAscent-m.fontBoundingBoxDescent)/2;
  const x=20+c.measureText('HH NN').width-c.measureText(' NN').width;
  c.fillStyle='#111111';c.fillText(' NN',x,baseline);
  c.lineWidth=1;c.strokeStyle='#dd2244';c.lineJoin='round';c.miterLimit=2;c.strokeText('HH',20,baseline);c.strokeText(' NN',x,baseline);
  return [...c.getImageData(0,0,320,240).data];
 });
 const oracle=diff(image.data,native);await testInfo.attach('fill-zero-native-oracle.json',{body:JSON.stringify(oracle),contentType:'application/json'});expect(oracle.max).toBeLessThanOrEqual(2);

 let revealed=0,strokePixels=0,neighborChanges=0;
 for(let y=40;y<130;y++)for(let x=20;x<295;x++){
  const i=(y*320+x)*4,pixel=(a,b)=>[0,1,2,3].every(k=>a[i+k]===b[i+k]);
  if(x<150){if(opaque.data[i]<25&&opaque.data[i+1]<25&&opaque.data[i+2]<25&&pixel(image.data,background.data))revealed++;
   if(image.data[i]>150&&image.data[i+1]<100&&image.data[i+2]<130)strokePixels++;
  }else if(!pixel(image.data,opaque.data))neighborChanges++;
 }
 await testInfo.attach('fill-zero-revealed.json',{body:JSON.stringify({revealed,strokePixels,neighborChanges}),contentType:'application/json'});
 expect(revealed).toBeGreaterThan(100);expect(strokePixels).toBeGreaterThan(100);expect(neighborChanges).toBe(0);
 await expect.poll(async()=>layer((await records(page,'docs')).find(d=>d.id===doc.id))).toEqual(e);
 const payload=await exportedPayload(page);expect(layer(payload.document)).toEqual(e);
 await page.reload();await openLibraryDocument(page,doc.id);await edit(page);expect(await model(page)).toEqual(e);await page.keyboard.press('Control+Enter');
 const fresh=await browser.newContext({baseURL:'http://127.0.0.1:4173',viewport:{width:2200,height:1400},acceptDownloads:true});
 try{const imported=await fresh.newPage();await openHome(imported);await importPayload(imported,payload);await expect(imported.locator('#toast')).toContainText('Документ импортирован');
  const saved=(await records(imported,'docs')).find(d=>d.elements.some(t=>t.type==='text'&&t.text===e.text)),restored=saved.elements.find(t=>t.type==='text');
  expect({...restored,id:e.id}).toEqual(e);
 }finally{await fresh.close();}
});

test('fill opacity Mixed preserves empty input, first-character stepping, backward selection and one preview Undo',async({page},testInfo)=>{
 await seed(page,{text:'fi AV',fontSize:36,fillOpacity:75,textRuns:[{start:0,end:1,style:{fillOpacity:50}}]});await edit(page);await select(page,2,0);
 await fillPicker(page);const input=page.locator('#cpAlphaInput');await expect(input).toHaveValue('');await expect(input).toHaveAttribute('placeholder','Mixed');await expect(page.locator('#cpAlpha')).toHaveAttribute('aria-valuetext','Mixed');
 const mixed=await model(page);await input.fill('');await input.press('Tab');expect(await model(page)).toEqual(mixed);
 await input.focus();await input.press('ArrowUp');await expect(input).toHaveValue('51');
 await page.locator('[data-fill-close]').click();await page.locator(surface).focus();expect(await selection(page)).toEqual({anchor:2,focus:0});
 await page.keyboard.press('Control+z');expect(await model(page)).toEqual(mixed);
 await fillPicker(page);await input.fill('');await input.locator('..').locator('[data-num-direction="up"]').click();await expect(input).toHaveValue('51');
 await page.locator('[data-fill-close]').click();await page.locator(surface).focus();await page.keyboard.press('Control+z');expect(await model(page)).toEqual(mixed);
 await fillPicker(page);await input.fill('');await input.pressSequentially('100');await expect(input).toHaveValue('100');
 // Keep one preview open while applying multiple intermediate input events.
 await input.fill('50');await input.fill('0');await input.press('Tab');await page.locator('[data-fill-close]').click();await page.locator(surface).focus();
 const changed=await model(page);expect(changed.textRuns).toEqual([{start:0,end:2,style:{fillOpacity:0}}]);expect(await selection(page)).toEqual({anchor:2,focus:0});
 await page.keyboard.press('Control+z');expect(await model(page)).toEqual(mixed);await page.keyboard.press('Control+Shift+z');expect(await model(page)).toEqual(changed);
 await page.keyboard.press('ArrowRight');await page.keyboard.type('X');const typed=await model(page);expect(typed.text).toBe('fiX AV');expect(typed.textRuns).toEqual([{start:0,end:3,style:{fillOpacity:0}}]);
 await page.keyboard.press('Control+z');expect(await model(page)).toEqual(changed);await page.keyboard.press('Control+Shift+z');expect(await model(page)).toEqual(typed);
 await parity(page,testInfo,'fill-mixed-history');
});

for(const value of [50,100])test(`fill opacity ${value} via native slider and number preserves inherited layer alpha without a stroke`,async({page},testInfo)=>{
 await seed(page,{text:'AV fi Жук',fontSize:36,fillOpacity:25});await edit(page);await select(page,1,0);
 await fillAlpha(page,value,true);expect((await model(page)).textRuns).toEqual([{start:0,end:1,style:{fillOpacity:value}}]);
 await select(page,3,4);await fillAlpha(page,value);const e=await model(page);expect(e.fillOpacity).toBe(25);expect(e.textRuns).toEqual([{start:0,end:1,style:{fillOpacity:value}},{start:3,end:4,style:{fillOpacity:value}}]);
 await expect(page.locator(overlay)).toBeVisible();await parity(page,testInfo,'fill-'+value);
});

for(const autoFontSize of [false,true])test(`fill opacity preserves LF, wrap, mixed fonts, AV/fi and auto-fit ${autoFontSize}`,async({page},testInfo)=>{
 const text='AV fi Жук 😀 мягкий перенос\nСледующая строка';
 await seed(page,{text,fontSize:28,w:180,h:160,autoFontSize,textRuns:[{start:0,end:2,style:{fontWeight:'700',underline:true}},{start:3,end:5,style:{fontFamily:'Stroke Sans',fontSize:36,lineHeight:1.5}},{start:6,end:9,style:{fontSize:22,letterSpacing:1.5,strikethrough:true}}]});
 await edit(page);const before=await model(page),rows=await page.locator(surface+' [data-wysiwyg-row]').count();
 await select(page,0,14);await fillAlpha(page,50);const after=await model(page);expect(after.fontSize).toBe(before.fontSize);expect(after.autoFontSize).toBe(autoFontSize);expect(await page.locator(surface+' [data-wysiwyg-row]').count()).toBe(rows);
 const visible=await visibleInk(page,140);await parity(page,testInfo,'fill-mixed-auto-'+autoFontSize);
 const display=diff(visible.data,(await visibleInk(page,140)).data);await testInfo.attach('fill-US-screen.json',{body:JSON.stringify(display),contentType:'application/json'});expect(display.max).toBeLessThanOrEqual(2);
});

test('fill opacity caret requires selection and multiple layers still use layer opacity outside editing',async({page})=>{
 await seed(page,{text:'fi AV'},true);await edit(page);await select(page,1,1);const before=await model(page);
 await fillPicker(page);await page.locator('#cpAlphaInput').fill('50');await page.locator('#cpAlphaInput').press('Tab');await page.locator('[data-fill-close]').click();expect(await model(page)).toEqual(before);await expect(page.locator('#toast')).toContainText('Выделите фрагмент текста');await expect(page.locator(surface)).toBeVisible();
 await page.locator(surface).focus();await page.keyboard.press('Control+Enter');
 await page.locator('#layers [data-layer="second"] .layer-name').click({modifiers:['Control']});await fillAlpha(page,50);
 const doc=await exportedDocument(page);for(const e of doc.elements){expect(e.fillOpacity).toBe(50);expect(e.textRuns).toBeUndefined();}
});

for(const partial of [true,false])test(`fill opacity native fi ${partial?'partial':'whole'} oracle keeps layer alpha and opaque stroke independent`,async({page},testInfo)=>{
 await seed(page,{text:'fi AV',fontSize:48,fillOpacity:50,strokeWidth:3,stroke:'#2266dd'});await edit(page);await select(page,0,partial?1:2);await fillAlpha(page,0);
 const expected=await page.evaluate(partial=>{
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const c=canvas.getContext('2d');
  c.fillStyle='#fff';c.fillRect(0,0,320,240);c.font='normal 400 48px "Stroke Serif"';c.fontKerning='normal';c.letterSpacing='0px';
  const m=c.measureText('Mg'),baseline=40+m.fontBoundingBoxAscent+(Math.max(48*1.2,m.fontBoundingBoxAscent+m.fontBoundingBoxDescent)-m.fontBoundingBoxAscent-m.fontBoundingBoxDescent)/2;
  const first=partial?'f':'fi',rest=partial?'i AV':' AV',x=20+c.measureText('fi AV').width-c.measureText(rest).width;
  c.fillStyle='#111111';c.globalAlpha=.5;c.fillText(rest,x,baseline);
  c.globalAlpha=1;c.lineWidth=3;c.strokeStyle='#2266dd';c.lineJoin='round';c.miterLimit=2;c.strokeText(first,20,baseline);c.strokeText(rest,x,baseline);
  return [...c.getImageData(0,0,320,240).data];
 },partial);
 const oracle=diff(await livePixels(page),expected);await testInfo.attach('fill-native-fi-oracle.json',{body:JSON.stringify(oracle),contentType:'application/json'});expect(oracle.max).toBeLessThanOrEqual(2);
 await parity(page,testInfo,'fill-native-fi');
});

async function strokePicker(page){if(!await page.locator('#fillPopover').isVisible())await page.locator('#inspector [data-fill-open="stroke"]').click();}
async function strokeAlpha(page,value,slider=false){
 await strokePicker(page);const input=page.locator(slider?'#cpAlpha':'#cpAlphaInput');
 if(slider){await input.focus();await input.press('Home');for(let i=0;i<value;i++)await input.press('ArrowRight');await input.press('Tab');}
 else{await input.fill(String(value));await expect(input).toBeFocused();await input.press('Tab');}
 await expect(page.locator('#cpAlphaInput')).toHaveValue(String(value));await page.locator('[data-fill-close]').click();
}

test('stroke opacity Mixed preserves empty input, first-character stepping, backward selection and one preview Undo',async({page},testInfo)=>{
 await seed(page,{text:'fi AV',fontSize:36,strokeWidth:3,strokeOpacity:75,textRuns:[{start:0,end:1,style:{strokeOpacity:50}}]});await edit(page);await select(page,2,0);
 await strokePicker(page);const input=page.locator('#cpAlphaInput');await expect(input).toHaveValue('');await expect(input).toHaveAttribute('placeholder','Mixed');await expect(page.locator('#cpAlpha')).toHaveAttribute('aria-valuetext','Mixed');
 const mixed=await model(page);await input.fill('');await input.press('Tab');expect(await model(page)).toEqual(mixed);
 await input.focus();await input.press('ArrowUp');await expect(input).toHaveValue('51');
 await page.locator('[data-fill-close]').click();await page.locator(surface).focus();expect(await selection(page)).toEqual({anchor:2,focus:0});
 await page.keyboard.press('Control+z');expect(await model(page)).toEqual(mixed);
 await strokePicker(page);await input.fill('');await input.locator('..').locator('[data-num-direction="up"]').click();await expect(input).toHaveValue('51');
 await page.locator('[data-fill-close]').click();await page.locator(surface).focus();await page.keyboard.press('Control+z');expect(await model(page)).toEqual(mixed);
 await strokePicker(page);await input.fill('');await input.pressSequentially('100');await expect(input).toHaveValue('100');
 // Keep one preview open while applying multiple intermediate input events.
 await input.fill('50');await input.fill('0');await input.press('Tab');await page.locator('[data-fill-close]').click();await page.locator(surface).focus();
 const changed=await model(page);expect(changed.textRuns).toEqual([{start:0,end:2,style:{strokeOpacity:0}}]);expect(await selection(page)).toEqual({anchor:2,focus:0});
 await page.keyboard.press('Control+z');expect(await model(page)).toEqual(mixed);await page.keyboard.press('Control+Shift+z');expect(await model(page)).toEqual(changed);
 await page.keyboard.press('ArrowRight');await page.keyboard.type('X');const typed=await model(page);expect(typed.text).toBe('fiX AV');expect(typed.textRuns).toEqual([{start:0,end:3,style:{strokeOpacity:0}}]);
 await page.keyboard.press('Control+z');expect(await model(page)).toEqual(changed);await page.keyboard.press('Control+Shift+z');expect(await model(page)).toEqual(typed);
 await parity(page,testInfo,'stroke-mixed-history');
});

for(const autoFontSize of [false,true])test(`stroke opacity preserves LF, wrap, mixed fonts, AV/fi and auto-fit ${autoFontSize}`,async({page},testInfo)=>{
 const text='AV fi Жук 😀 мягкий перенос\nСледующая строка';
 await seed(page,{text,strokeWidth:3,fontSize:28,w:180,h:160,autoFontSize,textRuns:[{start:0,end:2,style:{fontWeight:'700',underline:true}},{start:3,end:5,style:{fontFamily:'Stroke Sans',fontSize:36,lineHeight:1.5}},{start:6,end:9,style:{fontSize:22,letterSpacing:1.5,strikethrough:true}}]});
 await edit(page);const before=await model(page),rows=await page.locator(surface+' [data-wysiwyg-row]').count();
 await select(page,0,14);await strokeAlpha(page,50);const after=await model(page);expect(after.fontSize).toBe(before.fontSize);expect(after.autoFontSize).toBe(autoFontSize);expect(await page.locator(surface+' [data-wysiwyg-row]').count()).toBe(rows);
 const visible=await visibleInk(page,140);await parity(page,testInfo,'stroke-mixed-auto-'+autoFontSize);
 const display=diff(visible.data,(await visibleInk(page,140)).data);await testInfo.attach('fill-US-screen.json',{body:JSON.stringify(display),contentType:'application/json'});expect(display.max).toBeLessThanOrEqual(2);
});

test('stroke opacity caret requires selection; whole-layer multi edit retains explicit overrides',async({page})=>{
 const textRuns=[{start:0,end:1,style:{strokeOpacity:100}},{start:1,end:2,style:{strokeOpacity:0}}];
 await seed(page,{text:'fi AV',strokeWidth:3,strokeOpacity:75,textRuns},true);await edit(page);await select(page,1,1);const before=await model(page);
 await strokePicker(page);await page.locator('#cpAlphaInput').fill('40');await page.locator('#cpAlphaInput').press('Tab');await page.locator('[data-fill-close]').click();expect(await model(page)).toEqual(before);await expect(page.locator('#toast')).toContainText('Выделите фрагмент текста');await expect(page.locator(surface)).toBeVisible();
 await page.locator(surface).focus();await page.keyboard.press('Control+Enter');
 await page.locator('#layers [data-layer="second"] .layer-name').click({modifiers:['Control']});await strokeAlpha(page,40);
 const doc=await exportedDocument(page);for(const e of doc.elements){expect(e.strokeOpacity).toBe(40);expect(e.textRuns).toEqual(textRuns);}
});

for(const value of [0,40,100])test(`stroke opacity ${value} isolates a word, reveals backdrop and persists through reload/JSON`,async({page,browser},testInfo)=>{
 const doc=await seed(page,{text:'HH NN',fontSize:48,strokeWidth:4,stroke:'#dd2244',strokeOpacity:75,fillOpacity:100},false,true);
 await edit(page);await select(page,2,0);if(value===100)await fillAlpha(page,0);await strokeAlpha(page,value,value===40);
 const e=await model(page);expect(e.strokeOpacity).toBe(75);expect(e.fillOpacity).toBe(100);expect(e.textRuns).toEqual([{start:0,end:2,style:{...(value===100?{fillOpacity:0}:{}),strokeOpacity:value}}]);
 const native=await page.evaluate(async value=>{
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const c=canvas.getContext('2d'),img=new Image();img.src=window.__rangeBackdrop;await img.decode();c.drawImage(img,0,0);
  c.font='normal 400 48px "Stroke Serif"';c.fontKerning='normal';c.letterSpacing='0px';
  const m=c.measureText('Mg'),baseline=40+m.fontBoundingBoxAscent+(Math.max(48*1.2,m.fontBoundingBoxAscent+m.fontBoundingBoxDescent)-m.fontBoundingBoxAscent-m.fontBoundingBoxDescent)/2;
  const x=20+c.measureText('HH NN').width-c.measureText(' NN').width;
  c.fillStyle='#111111';c.globalAlpha=value===100?0:1;c.fillText('HH',20,baseline);c.globalAlpha=1;c.fillText(' NN',x,baseline);
  c.lineWidth=4;c.strokeStyle='#dd2244';c.lineJoin='round';c.miterLimit=2;c.globalAlpha=value/100;c.strokeText('HH',20,baseline);c.globalAlpha=.75;c.strokeText(' NN',x,baseline);
  return [...c.getImageData(0,0,320,240).data];
 },value);
 const oracle=diff(await livePixels(page),native);await testInfo.attach('stroke-word-native.json',{body:JSON.stringify(oracle),contentType:'application/json'});expect(oracle.max).toBeLessThanOrEqual(2);
 await parity(page,testInfo,'stroke-word-'+value);
 await expect.poll(async()=>layer((await records(page,'docs')).find(d=>d.id===doc.id))).toEqual(e);
 const payload=await exportedPayload(page);expect(layer(payload.document)).toEqual(e);
 await page.reload();await openLibraryDocument(page,doc.id);await edit(page);expect(await model(page)).toEqual(e);await page.keyboard.press('Control+Enter');
 const fresh=await browser.newContext({baseURL:'http://127.0.0.1:4173',viewport:{width:2200,height:1400},acceptDownloads:true});
 try{const imported=await fresh.newPage();await openHome(imported);await importPayload(imported,payload);await expect(imported.locator('#toast')).toContainText('Документ импортирован');const saved=(await records(imported,'docs')).find(d=>d.elements.some(t=>t.type==='text'&&t.text===e.text));expect({...saved.elements.find(t=>t.type==='text'),id:e.id}).toEqual(e);}finally{await fresh.close();}
 if(value===40){
  await page.locator('#documentTabsHome').click();await page.locator('[data-home-nav=data]').click();await page.locator('#zipStorage').click();await expect(page.locator('#zipConfirm')).toBeEnabled();
  const pending=page.waitForEvent('download');await page.locator('#zipConfirm').click();const bytes=fs.readFileSync(await (await pending).path());await expect(page.locator('#zipStatus')).toContainText('передан браузеру');await page.locator('#zipCancel').click();
  const {readBackup}=await import('../src/backup/archive.mjs');const backup=await readBackup(bytes);expect(layer(backup.data.docs.find(d=>d.id===doc.id))).toEqual(e);
  await page.locator('#zipInput').setInputFiles({name:'stroke-opacity.zip',mimeType:'application/zip',buffer:bytes});await expect(page.locator('#zipBackupDialog')).toBeVisible();await expect(page.locator('#zipConfirm')).toBeEnabled();await page.locator('#zipConfirm').click();await expect(page.locator('#zipStatus')).toContainText('Транзакция завершена');await page.locator('#zipCancel').click();
  const copy=(await records(page,'docs')).find(d=>d.id!==doc.id&&d.elements.some(t=>t.id===e.id));expect(layer(copy)).toEqual(e);await page.locator('[data-home-nav=workspace]').click();await page.locator(`[data-switch-project="${copy.projectId}"]`).click();await openLibraryDocument(page,copy.id);await actualSize(page);await edit(page);expect(await model(page)).toEqual(e);
  // Reload cleared the fixture background used by livePixels to composite ink.
  await page.evaluate(src=>window.__rangeBackdrop=src,copy.elements.find(t=>t.id==='backdrop').rasterSrc);
  await parity(page,testInfo,'stroke-backup');
 }

});

for(const [pair,partial,strokeWidth] of [['fi',true,3],['fi',false,3],['AV',true,3],['fi',true,0]])test(`stroke opacity native ${pair} ${partial?'partial':'whole'} width ${strokeWidth} oracle preserves fill and contextual kerning`,async({page},testInfo)=>{
 await seed(page,{text:pair+' AV',fontSize:48,fillOpacity:50,strokeWidth,stroke:'#2266dd',strokeOpacity:75});await edit(page);await select(page,0,partial?1:2);await strokeAlpha(page,40);
 const expected=await page.evaluate(({pair,partial,strokeWidth})=>{
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const c=canvas.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,320,240);c.font='normal 400 48px "Stroke Serif"';c.fontKerning='normal';c.letterSpacing='0px';
  const m=c.measureText('Mg'),baseline=40+m.fontBoundingBoxAscent+(Math.max(48*1.2,m.fontBoundingBoxAscent+m.fontBoundingBoxDescent)-m.fontBoundingBoxAscent-m.fontBoundingBoxDescent)/2;
  const text=pair+' AV',first=partial?pair[0]:pair,rest=partial?pair[1]+' AV':' AV',x=20+c.measureText(text).width-c.measureText(rest).width;
  c.fillStyle='#111111';c.globalAlpha=.5;if(strokeWidth){c.fillText(first,20,baseline);c.fillText(rest,x,baseline);}else c.fillText(text,20,baseline);
  if(strokeWidth){c.lineWidth=strokeWidth;c.strokeStyle='#2266dd';c.lineJoin='round';c.miterLimit=2;c.globalAlpha=.4;c.strokeText(first,20,baseline);c.globalAlpha=.75;c.strokeText(rest,x,baseline);}
  return [...c.getImageData(0,0,320,240).data];
 },{pair,partial,strokeWidth});
 const oracle=diff(await livePixels(page),expected);await testInfo.attach('stroke-native-fi-oracle.json',{body:JSON.stringify(oracle),contentType:'application/json'});expect(oracle.max).toBeLessThanOrEqual(2);await parity(page,testInfo,'stroke-native-fi');
});

for(const textMode of ['vertical','path'])test(`stroke opacity keeps legacy ${textMode} textarea changes layer-wide`,async({page})=>{
 const textRuns=[{start:0,end:1,style:{strokeOpacity:100}}];await seed(page,{text:'fi AV',strokeWidth:3,strokeOpacity:75,textMode,textRuns});
 await page.locator('#layers [data-layer="title"] .layer-name').click();const point=await canvasPoint(page,55,57);await page.mouse.dblclick(point.x,point.y);const input=page.locator('#inlineText');await expect(input).toBeFocused();await expect(page.locator(surface)).toBeHidden();
 await input.press('Control+Home');await input.press('Shift+ArrowRight');await strokeAlpha(page,40);
 const e=await model(page);expect(e.strokeOpacity).toBe(40);expect(e.textRuns).toEqual(textRuns);
});
