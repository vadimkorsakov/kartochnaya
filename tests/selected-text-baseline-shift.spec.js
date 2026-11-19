const {test,expect,openHome,importPayload,records,openLibraryDocument,canvasPoint,exportPNG,exportedDocument}=require('./helpers');
const {model}=require('./support/text-interaction');
const {PNG}=require('pngjs');
const {writeFile}=require('node:fs/promises');
const fixture=require('./fixtures/visual-text.json');

const surface='#inlineWysiwyg', width=640, height=480;
const origin={x:40,y:38};
const indexButton=(page,value)=>page.locator(`#inspector [data-baseline-shift=${value}]`);
const source='H2Ox2\nH2Ox2\n';
const indexRuns=[
 {start:1,end:2,style:{baselineShift:'sub'}},
 {start:4,end:5,style:{baselineShift:'super'}},
 {start:7,end:8,style:{baselineShift:'sub'}},
 {start:10,end:11,style:{baselineShift:'super'}},
];

async function seed(page,patch={}){
 await page.addInitScript(()=>{
  window.indexDraws=[];
  const proto=CanvasRenderingContext2D.prototype,fill=proto.fillText,clear=proto.clearRect;
  proto.clearRect=function(...args){if(this.canvas.id==='canvas')window.indexDraws=[];return clear.apply(this,args)};
  proto.fillText=function(text,x,y,...args){
   if(this.canvas.id==='canvas')window.indexDraws.push({text,x,y,font:this.font,width:this.measureText(text).width});
   return fill.call(this,text,x,y,...args);
  };
 });
 await openHome(page);
 const payload=structuredClone(fixture);
 Object.assign(payload.document,{width,height});
 Object.assign(payload.document.elements[0],{...origin,id:'indices',name:'Indices',w:530,h:390,fontFamily:'Arial',
  fontSize:42.375,lineHeight:1.2,text:source,textColor:'#202020',fill:'#202020',autoFontSize:false,...patch});
 await importPayload(page,payload);
 const doc=(await records(page,'docs')).find(d=>d.title==='Visual fixed font (импорт)');
 await openLibraryDocument(page,doc.id);
 return doc.id;
}
async function actualSize(page){
 await page.locator('#fitBtn').click();
 await page.locator('#zoomLabel').click();
 const zoom=page.locator('#zoomInput');await zoom.fill('100');await zoom.press('Enter');
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
}
async function edit(page){
 await actualSize(page);
 const p=await canvasPoint(page,origin.x+50,origin.y+20,width,height);
 await page.mouse.dblclick(p.x,p.y);
 await expect(page.locator(surface)).toBeFocused();
 await expect(page.locator('#inlineText')).toBeHidden();
 await expect(page.locator('#wysiwygRecovery')).toBeHidden();
}
async function done(page){
 await page.locator(surface).focus();
 await page.keyboard.press('Control+Enter');
 await expect(page.locator(surface)).toBeHidden();
}
async function selection(page){
 return page.locator(surface).evaluate(host=>{
  const s=getSelection();
  function offset(node,n){
   const r=document.createRange();r.setStart(host,0);r.setEnd(node,n);return r.toString().length;
  }
  const row=s.focusNode.parentElement.closest('[data-wysiwyg-row]');
  return {anchor:offset(s.anchorNode,s.anchorOffset),focus:offset(s.focusNode,s.focusOffset),
   row:[...host.children].indexOf(row)};
 });
}
async function press(page,...keys){for(const key of keys)await page.keyboard.press(key)}
async function choose(page,mode){
 await indexButton(page,mode).click();
 await expect(indexButton(page,mode)).toHaveAttribute('aria-pressed','true');
 await expect(page.locator(surface)).toBeFocused();
}
async function glyphBox(page,index){
 return page.locator(surface).evaluate((host,index)=>{
  const walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT);
  let node,offset=0;
  while(node=walker.nextNode()){
   if(index<offset+node.length){
    const r=document.createRange();r.setStart(node,index-offset);r.setEnd(node,index-offset+1);
    return r.getBoundingClientRect().toJSON();
   }
   offset+=node.length;
  }
  throw Error('Missing glyph');
 },index);
}
async function clickGlyph(page,index,fraction){
 const box=await glyphBox(page,index);
 await page.mouse.click(box.left+box.width*fraction,box.top+box.height/2);
}
async function geometry(page){
 return page.locator(surface).evaluate(host=>{
  const bounds=host.getBoundingClientRect(),scale=bounds.width/parseFloat(host.style.width);
  const canvas=document.createElement('canvas').getContext('2d');
  return [...host.querySelectorAll('[data-wysiwyg-fragment]')].flatMap(part=>{
   const text=part.textContent.replace(/\n$/,'');if(!text)return [];
   const native=document.createRange();native.setStart(part.firstChild,0);native.setEnd(part.firstChild,text.length);
   const rect=native.getBoundingClientRect(),css=getComputedStyle(part);
   // Measure the browser's alphabetic baseline using an offscreen copy.
   const probe=document.createElement('div'),copy=part.cloneNode(false),marker=document.createElement('span');
   probe.style.cssText='position:fixed;left:-100000px;top:0;visibility:hidden;white-space:pre;width:max-content';
   Object.assign(copy.style,{position:'static',marginLeft:'0',verticalAlign:'baseline'});
   marker.style.cssText='display:inline-block;width:0;height:0;vertical-align:baseline';
   copy.append(document.createTextNode(text),marker);probe.append(copy);document.body.append(probe);
   const range=document.createRange();range.selectNodeContents(copy.firstChild);
   const dy=marker.getBoundingClientRect().top-range.getBoundingClientRect().top;
   probe.remove();
   canvas.font=[css.fontStyle,css.fontWeight,css.fontSize,css.fontFamily].join(' ');
   return [{text,x:(rect.x-bounds.x)/scale,y:(rect.y-bounds.y)/scale+dy,width:rect.width/scale,font:canvas.font}];
  });
 });
}
async function evidence(info,name,body){
 const path=info.outputPath(name);
 await writeFile(path,body);
 await info.attach(name,{path,contentType:name.endsWith('.png')?'image/png':'application/json'});
}
const decodeCanvas=url=>PNG.sync.read(Buffer.from(url.split(',')[1],'base64')).data;
function maxDelta(a,b){
 expect(a.length).toEqual(b.length);
 return a.reduce((max,value,i)=>Math.max(max,Math.abs(value-b[i])),0);
}
async function canvasPixels(page){
 const p=await canvasPoint(page,620,458,width,height);await page.mouse.click(p.x,p.y);
 return decodeCanvas(await page.locator('#canvas').evaluate(canvas=>canvas.toDataURL()));
}

test('live index buttons preserve native backward selection, nominal size, history and storage',async({page},info)=>{
 const id=await seed(page);
 await edit(page);
 const normal=await geometry(page);
 const b=await glyphBox(page,1),y=b.top+b.height/2;
 await page.mouse.move(b.left+b.width*.8,y);await page.mouse.down();
 await page.mouse.move(b.left+b.width*.2,y,{steps:8});await page.mouse.up();
 expect(await selection(page)).toEqual({anchor:2,focus:1,row:0});
 await choose(page,'sub');
 expect(await selection(page)).toEqual({anchor:2,focus:1,row:0});
 expect((await model(page)).textRuns).toEqual(indexRuns.slice(0,1));
 const size=page.locator('#inspector [data-key=fontSize]');
 expect(Number(await size.inputValue())).toBeCloseTo(42.375,1);
 await choose(page,'sub');
 await press(page,'Control+z');
 expect((await model(page)).textRuns).toBeUndefined();
 await press(page,'Control+Shift+z');
 expect((await model(page)).textRuns).toEqual(indexRuns.slice(0,1));

 await press(page,'End','Shift+ArrowLeft');
 expect(await selection(page)).toEqual({anchor:5,focus:4,row:0});
 await indexButton(page,'super').focus();await press(page,'Space');
 await expect(page.locator(surface)).toBeFocused();
 expect(await selection(page)).toEqual({anchor:5,focus:4,row:0});
 await expect(indexButton(page,'super')).toHaveAttribute('aria-pressed','true');
 await press(page,'Home','Shift+End');
 await expect(page.locator('[data-baseline-shift-mixed]')).toHaveText('Mixed');
 for(const mode of ['normal','sub','super'])await expect(indexButton(page,mode)).toHaveAttribute('aria-pressed','false');
 const stage=await canvasPoint(page,610,440,width,height);await page.mouse.move(stage.x,stage.y);
 await evidence(info,'baseline-editor.png',await page.screenshot());
 await clickGlyph(page,2,.25);
 expect(await selection(page)).toEqual({anchor:2,focus:2,row:0});
 await expect(page.locator('[data-text-stroke-overlay]')).toBeHidden();
 const dom=await geometry(page),nominal=42.375;
 const [h,sub,ox,sup]=dom;
 expect([h.text,sub.text,ox.text,sup.text]).toEqual(['H','2','Ox','2']);
 expect(Math.abs(sub.y-h.y-nominal*.18)).toBeLessThan(.12);
 expect(Math.abs(sup.y-h.y+nominal*.35)).toBeLessThan(.12);
 expect(sub.width).toBeLessThan(sup.width+.12);
 expect(sub.width).toBeLessThan((normal[0].width-h.width-ox.width)/2);
 const saved=await model(page);
 expect(saved.text).toBe(source);expect(saved.fontSize).toBe(nominal);
 expect(saved.textRunsBaseFontSize).toBeUndefined();
 expect(await page.locator(surface).textContent()).toBe(source);
 await evidence(info,'baseline-live.png',await page.locator(surface).screenshot());
 await done(page);
 const draws=await page.evaluate(()=>window.indexDraws);
 expect(draws.map(p=>p.text)).toEqual(dom.map(p=>p.text));
 for(const [i,part] of dom.entries()){
  for(const key of ['x','y','width'])expect(Math.abs(part[key]-draws[i][key]),`fragment ${i} ${key}`).toBeLessThan(.12);
  expect(part.font).toEqual(draws[i].font);
 }
 const canvas=await canvasPixels(page),png=await exportPNG(page,width,height);
 const canvasToPNG=maxDelta(canvas,png.image.data);expect(canvasToPNG).toBeLessThanOrEqual(1);
 await evidence(info,'baseline-geometry.json',JSON.stringify({dom,draws,canvasToPNG},null,2));
 await evidence(info,'baseline-export.png',png.bytes);
 await page.locator('#undoBtn').click();expect((await model(page)).textRuns).toEqual(indexRuns.slice(0,1));
 await page.locator('#redoBtn').click();expect((await exportedDocument(page)).elements[0]).toEqual(saved);
 await expect.poll(async()=>(await records(page,'docs')).find(d=>d.id===id)?.elements[0].textRuns).toEqual(saved.textRuns);
 await page.reload();await openLibraryDocument(page,id);await edit(page);
 expect(await model(page)).toEqual(saved);expect(await geometry(page)).toEqual(dom);
});

test('real pointer and keyboard put a native caret on shifted glyphs and edit their source',async({page},info)=>{
 await seed(page,{textRuns:indexRuns});await edit(page);
 for(const [index,fraction,offset] of [[1,.25,1],[1,.8,2],[4,.25,4],[4,.8,5],[7,.25,7],[10,.8,11]]){
  await clickGlyph(page,index,fraction);
  expect(await selection(page),`click inside glyph ${index} at ${fraction}`).toEqual({anchor:offset,focus:offset,row:index>=6?1:0});
 }
 const locations=[];
 for(const index of [1,4]){
  await clickGlyph(page,index,.25);
  const glyph=await glyphBox(page,index);
  const native=()=>page.evaluate(()=>{const s=getSelection();return {caret:s.getRangeAt(0).getBoundingClientRect().toJSON(),node:s.focusNode.textContent,offset:s.focusOffset}});
  await expect.poll(async()=>Math.abs((await native()).caret.y-glyph.y),`index ${index} native caret baseline`).toBeLessThan(.12);
  const {caret,node,offset}=await native();
  expect(Math.abs(caret.x-glyph.x)).toBeLessThan(.12);
  expect(caret.height).toBe(glyph.height);
  locations.push({index,node,offset,caret:{x:caret.x,y:caret.y,height:caret.height},glyph:{x:glyph.x,y:glyph.y,width:glyph.width,height:glyph.height}});
 }
 const left=await glyphBox(page,1),right=await glyphBox(page,2);
 expect(Math.abs(left.right-right.left)).toBeLessThan(.12);
 for(const [x,box] of [[left.right-.3,left],[right.left+.3,right]]){
  await page.mouse.click(x,box.top+box.height/2);
  expect(await selection(page)).toEqual({anchor:2,focus:2,row:0});
 }
 await evidence(info,'baseline-caret.json',JSON.stringify(locations,null,2));
 await clickGlyph(page,1,.25);
 await press(page,'ArrowRight','ArrowDown');
 expect(await selection(page)).toEqual({anchor:8,focus:8,row:1});
 await press(page,'ArrowUp','ArrowLeft');
 expect(await selection(page)).toEqual({anchor:1,focus:1,row:0});
 await press(page,'End','Home','Shift+ArrowRight','Shift+ArrowRight');
 expect(await selection(page)).toEqual({anchor:0,focus:2,row:0});
 await press(page,'Control+c','End','Control+v');
 expect(await page.locator(surface).textContent()).toBe('H2Ox2H2\nH2Ox2\n');
 expect((await model(page)).textRuns[1]).toEqual({start:4,end:7,style:{baselineShift:'super'}});
 await press(page,'Backspace','Shift+ArrowLeft','Control+x');
 expect(await page.locator(surface).textContent()).toBe(source);
 await clickGlyph(page,1,.25);
 await press(page,'Delete');
 expect(await page.locator(surface).textContent()).toBe('HOx2\nH2Ox2\n');
 await press(page,'Control+z');
 expect(await page.locator(surface).textContent()).toBe(source);
 await clickGlyph(page,1,.8);
 await press(page,'4');
 expect((await model(page)).textRuns[0]).toEqual({start:1,end:3,style:{baselineShift:'sub'}});
 expect(await page.locator(surface).textContent()).toBe('H24Ox2\nH2Ox2\n');
 await press(page,'Escape');await expect(page.locator(surface)).toBeHidden();
 expect((await model(page)).text).toBe(source);
});

test('whole-layer mode clears only index overrides and normal overrides the indexed layer',async({page})=>{
 const paint={underline:true,strikethrough:true,underlineDetails:{style:'dotted',opacity:83,thickness:3,offset:4,color:'#b01442'},strokeOpacity:100};
 await seed(page,{text:'H2O',textRuns:[{start:1,end:2,style:{...paint,baselineShift:'super'}}]});
 await edit(page);
 await expect(page.locator('[data-baseline-shift-mixed]')).toHaveText('Mixed');
 await choose(page,'sub');
 const layer=await model(page);expect(layer.baselineShift).toBe('sub');
 expect(layer.textRuns).toEqual([{start:1,end:2,style:paint}]);
 await press(page,'Home','ArrowRight','Shift+ArrowRight');await choose(page,'normal');
 expect((await model(page)).textRuns).toEqual([{start:1,end:2,style:{...paint,baselineShift:'normal'}}]);
 const size=page.locator('#inspector [data-key=fontSize]');
 await choose(page,'super');await size.fill('57');await size.press('Tab');await page.locator(surface).focus();
 expect(await selection(page)).toEqual({anchor:1,focus:2,row:0});
 expect((await model(page)).textRuns).toEqual([{start:1,end:2,style:{...paint,baselineShift:'super',fontSize:57}}]);
 expect(await size.inputValue()).toBe('57');
 await done(page);
 await indexButton(page,'normal').press('Enter');
 const reset=await model(page);expect(reset.baselineShift).toBeUndefined();expect(reset.textRuns).toEqual([{start:1,end:2,style:{...paint,fontSize:57}}]);
 await page.locator('#undoBtn').click();
 expect((await model(page)).baselineShift).toBe('sub');
});

test('auto-fit uses index advances and nominal line height without disabling fit',async({page})=>{
 await seed(page,{text:'MMMMMMMM',w:220,h:90,autoFontSize:true});
 await edit(page);
 await choose(page,'super');const superLayer=await model(page),indexed=await geometry(page);
 expect(superLayer.autoFontSize).toBe(true);
 expect(superLayer.textRunsBaseFontSize).toBeUndefined();
 expect(indexed).toHaveLength(1);
 expect(indexed[0].width).toBeLessThan(superLayer.w);
 await choose(page,'normal');const normal=await model(page);
 expect(normal.autoFontSize).toBe(true);expect(normal.fontSize).toBeLessThan(superLayer.fontSize);
 await press(page,'Control+z');expect(await model(page)).toEqual(superLayer);
 await press(page,'Control+Shift+z');expect(await model(page)).toEqual(normal);
 await press(page,'Control+z');await done(page);
 const corner=await canvasPoint(page,origin.x+superLayer.w,origin.y+superLayer.h,width,height);
 await page.mouse.dblclick(corner.x,corner.y);
 const fitted=await model(page);
 expect(fitted.w).toBe(Math.ceil(indexed[0].width+2)+2);
 expect(fitted.h).toBeGreaterThan(superLayer.fontSize);
 expect(fitted.autoFontSize).toBe(false);expect(fitted.baselineShift).toBe('super');
});

for(const [name,patch] of [
 ['locked',{locked:true}],['vertical',{textMode:'vertical'}],['gradient',{fillType:'gradient'}],
 ['CRLF',{text:'H2O\r\nx2\r\n'}],
])test(`rejects indexing in ${name} while stored formatting survives`,async({page})=>{
 const runs=[{start:1,end:2,style:{baselineShift:'sub'}}];
 await seed(page,{...patch,textRuns:runs});
 await page.locator('#layers .layer-name').filter({hasText:'Indices'}).click();
 const before=await model(page),button=indexButton(page,'super');
 await expect(button).toBeDisabled();
 await button.dispatchEvent('click');
 expect(await model(page)).toEqual(before);
 expect(before.textRuns).toEqual(runs);
 const png=await exportPNG(page,width,height);
 expect(png.image.data.some((value,i)=>i%4===0&&value<150)).toBe(true);
});

test('unconfirmed native edits cannot fall through to a whole-layer index command',async({page})=>{
 await seed(page);await edit(page);
 await press(page,'Home','Shift+ArrowRight');const before=await model(page);
 await page.locator(surface).dispatchEvent('compositionstart');
 await expect(page.locator('#wysiwygRecovery')).toBeVisible();
 await indexButton(page,'sub').dispatchEvent('click');
 expect(await model(page)).toEqual(before);
 await expect(page.locator('#inlineText')).toBeHidden();
 await page.locator(surface).dispatchEvent('compositionend');
 await page.locator('#wysiwygRecover').click();
 await expect(page.locator('#wysiwygRecovery')).toBeHidden();
});

const sample='AV fi  x2  ещё H2O AV  fi Привет 👩‍💻 и е\u0301\n\nКонец x2\n';
for(const [textAlign,verticalAlign,pattern] of [
 ['left','top','dotted'],['center','middle','wavy'],['right','bottom','dotted'],['justify','top','wavy'],
])test(`${textAlign}/${verticalAlign}: index glyphs, T1, stroke and alpha agree with PNG`,async({page},info)=>{
 const superAt=sample.indexOf('2'),subAt=sample.indexOf('2',superAt+1);
 const decorations={style:pattern,color:'#c11a54',opacity:87,thickness:5,offset:7};
 const runs=[{start:superAt,end:superAt+1,style:{baselineShift:'super',fontSize:48,fillOpacity:67,strokeWidth:1.5,stroke:'#244b21',strokeOpacity:71}},
  {start:subAt,end:subAt+1,style:{baselineShift:'sub'}},
  {start:sample.indexOf('👩'),end:sample.indexOf('\n'),style:{baselineShift:'super',fontFamily:'Georgia'}}];
 await seed(page,{text:sample,textAlign,verticalAlign,w:400,h:390,fontSize:34,underline:true,underlineDetails:decorations,strikethrough:true,textRuns:runs});
 await edit(page);
 const overlay=page.locator('[data-text-stroke-overlay]');
 await expect(overlay).toBeVisible();
 const live=decodeCanvas(await overlay.evaluate((ink,bg)=>{
  const canvas=document.createElement('canvas');canvas.width=ink.width;canvas.height=ink.height;
  const c=canvas.getContext('2d');c.fillStyle=bg;c.fillRect(0,0,canvas.width,canvas.height);c.drawImage(ink,0,0);
  return canvas.toDataURL();
 },fixture.document.background));
 expect(await page.locator(surface).textContent()).toBe(sample);
 expect(await page.locator(surface).locator('br[data-caret-sentinel]').count()).toBe(1);
 const dom=await geometry(page);
 const sub=dom.filter(p=>p.text==='2').find(p=>Math.abs(parseFloat(p.font.match(/[\d.]+px/)[0])-34*.65)<.3);
 const sup=dom.filter(p=>p.text==='2').find(p=>Math.abs(parseFloat(p.font.match(/[\d.]+px/)[0])-48*.65)<.3);
 expect(sub).toBeTruthy();expect(sup).toBeTruthy();
 if(textAlign==='justify'){
  const first=page.locator(`${surface} [data-wysiwyg-row]`).first();
  const wrapped=(await first.textContent()).length;
  expect(wrapped).toBeLessThan(sample.indexOf('\n'));
  await press(page,'Control+Home','End');
  expect(await selection(page)).toEqual({anchor:wrapped,focus:wrapped,row:0});
  await press(page,'ArrowDown','Home');
  expect(await selection(page)).toEqual({anchor:wrapped,focus:wrapped,row:1});
 }
 const preview=await page.locator(surface).screenshot();
 await done(page);
 const draws=await page.evaluate(()=>window.indexDraws);
 expect(draws.map(p=>p.text)).toEqual(dom.map(p=>p.text));
 for(const [i,part] of dom.entries()){
  for(const key of ['x','y'])expect(Math.abs(part[key]-draws[i][key]),`fragment ${i} ${key}`).toBeLessThan(.12);
  if(part.text!==' ')expect(Math.abs(part.width-draws[i].width),`fragment ${i} width`).toBeLessThan(.12);
 }
 const canvas=await canvasPixels(page),png=await exportPNG(page,width,height);
 const canvasToPNG=maxDelta(canvas,png.image.data),overlayToPNG=maxDelta(live,png.image.data);
 expect(canvasToPNG).toBeLessThanOrEqual(1);expect(overlayToPNG).toBeLessThanOrEqual(2);
 await evidence(info,'baseline-live.png',preview);
 await evidence(info,'baseline-export.png',png.bytes);
 await evidence(info,'baseline-geometry.json',JSON.stringify({dom,draws,canvasToPNG,overlayToPNG},null,2));
});

test('mobile textarea and existing formatting preserve indices for Canvas and PNG',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});
 await seed(page,{text:'H2O x2',w:330,h:220,textRuns:[
  {start:1,end:2,style:{baselineShift:'sub'}},{start:5,end:6,style:{baselineShift:'super'}},
 ]});
 await page.locator('[data-mobile=layers]:visible').click();
 await page.locator('#mobileLayerList .layer-name').filter({hasText:'Indices'}).click();
 await page.locator('#mobileLayersClose').click();
 await page.locator('#mobileContext [data-mobile=edit]').click();
 const input=page.locator('#inlineText');await expect(input).toBeFocused();
 await expect(page.locator('[data-baseline-shift]')).toHaveCount(0);
 await press(page,'Home','ArrowRight','Shift+ArrowRight');
 await page.locator('#mobileContext [data-mobile=format]').click();
 for(const name of ['bold','italic','underline','strike'])await page.locator(`[data-mp-format=${name}]`).click();
 await page.locator('#mobileContext [data-mobile=font]').click();
 await page.locator('[data-mp-font=Georgia]').first().click();
 await page.locator('#mobileContext [data-mobile=size]').click();
 const size=page.locator('input[type=number][data-mp-key=fontSize]');await size.fill('33');await size.press('Enter');
 expect((await model(page)).textRuns[0]).toEqual({start:1,end:2,style:{baselineShift:'sub',fontFamily:'Georgia',fontSize:33,fontStyle:'italic',fontWeight:'700',underline:true,strikethrough:true}});
 await page.locator('#mobileContext [data-mobile=edit]').click();await expect(input).toBeFocused();
 await press(page,'End','4');
 await expect(input).toHaveValue('H2O x24');
 await page.locator('#mobileConfirm').click();await expect(input).toBeHidden();
 expect((await model(page)).textRuns.at(-1)).toEqual({start:5,end:7,style:{baselineShift:'super'}});
 const draws=await page.evaluate(()=>window.indexDraws),png=await exportPNG(page,width,height);
 expect(draws.map(p=>p.text)).toEqual(['H','2','O x','24']);
 expect(draws[1].y).toBeGreaterThan(draws[0].y);expect(draws[3].y).toBeLessThan(draws[0].y);
 await evidence(info,'baseline-export.png',png.bytes);
});

test('keyboard formatting retains upstream affinity at an unchanged soft wrap',async({page})=>{
 const text='AAAA  H2O  WWWWWWWWWWW';
 await seed(page,{text,w:273});
 await edit(page);
 const first=page.locator(`${surface} [data-wysiwyg-row]`).first();
 const boundary=(await first.textContent()).length;
 expect(boundary).toBe(11);
 await press(page,'Control+Home',...Array(6).fill('ArrowRight'),'Shift+End');
 expect(await selection(page)).toEqual({anchor:6,focus:boundary,row:0});
 await indexButton(page,'sub').focus();await press(page,'Enter');
 expect(await selection(page)).toEqual({anchor:6,focus:boundary,row:0});
 await press(page,'ArrowDown','Home');
 expect(await selection(page)).toEqual({anchor:boundary,focus:boundary,row:1});
});

for(const fillType of ['gradient','image'])test(`${fillType} uses the shifted glyph mask on Canvas and in PNG`,async({page})=>{
 const swatch=new PNG({width:4,height:4});
 for(let i=0;i<swatch.data.length;i+=4)swatch.data.set([190,40,60,255],i);
 const fill=fillType==='gradient'?{fill:'#be283c',fill2:'#be283c'}:
  {imageSrc:'data:image/png;base64,'+PNG.sync.write(swatch).toString('base64')};
 await seed(page,{text:'2\n2\n2',lineHeight:1.6,fillType,...fill,opacity:78,textRuns:[
  {start:2,end:3,style:{baselineShift:'sub'}},{start:4,end:5,style:{baselineShift:'super'}},
 ]});
 await actualSize(page);
 const png=await exportPNG(page,width,height);
 const canvas=await canvasPixels(page);expect(maxDelta(canvas,png.image.data)).toBeLessThanOrEqual(1);
 const bands=[];
 for(let y=0;y<height;y++){
  const xs=[];
  for(let x=0;x<width;x++){
   const p=(y*width+x)*4;
   if(png.image.data[p+1]<190)xs.push(x);
  }
  if(!xs.length)continue;
  if(bands.at(-1)?.end!==y-1)bands.push({start:y,end:y,left:Infinity,right:-Infinity});
  const band=bands.at(-1);band.end=y;band.left=Math.min(band.left,...xs);band.right=Math.max(band.right,...xs);
 }
 expect(bands).toHaveLength(3);
 const [normal,sub,sup]=bands;
 for(const index of [sub,sup])expect(index.right-index.left).toBeLessThan(normal.right-normal.left);
 const nominalGap=42.375*1.6;
 expect(sub.end-normal.end).toBeGreaterThan(nominalGap+5);
 expect(sup.end-normal.end).toBeLessThan(2*nominalGap-12);
});

test('an invalid grapheme selection cannot format the layer',async({page})=>{
 await seed(page,{text:'Hе\u0301O'});await edit(page);
 const before=await model(page);
 await page.locator(surface).evaluate(host=>{
  const node=host.querySelector('[data-wysiwyg-fragment]').firstChild;
  getSelection().setBaseAndExtent(node,2,node,3);
 });
 await indexButton(page,'super').dispatchEvent('click');
 expect(await model(page)).toEqual(before);
 await expect(page.locator(surface)).toBeFocused();
});
