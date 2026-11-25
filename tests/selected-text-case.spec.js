const {test,expect,openHome,importPayload,records,openLibraryDocument,canvasPoint,exportPNG}=require('./helpers');
const {model}=require('./support/text-interaction');
const {PNG}=require('pngjs');
const {writeFile}=require('node:fs/promises');
const fixture=require('./fixtures/visual-text.json');

const width=640,height=480,origin={x:40,y:38};
const host=page=>page.locator('#inlineWysiwyg');
const button=(page,mode)=>page.locator(`#inspector [data-text-case=${mode}]`);
const press=async(page,...keys)=>{for(const key of keys)await page.keyboard.press(key)};
async function evidence(info,name,body){
 const path=info.outputPath(name);
 await writeFile(path,body);
 await info.attach(name,{path,contentType:name.endsWith('.png')?'image/png':'application/json'});
}
const pause=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function seed(page,patch={},documentPatch={},extraLayers=[]){
 await page.addInitScript(()=>{
  window.caseDraws=[];
  const proto=CanvasRenderingContext2D.prototype,{fillText,clearRect}=proto;
  proto.clearRect=function(...args){if(this.canvas.id==='canvas')window.caseDraws=[];return clearRect.apply(this,args)};
  proto.fillText=function(text,x,y,...args){
   if(this.canvas.id==='canvas')window.caseDraws.push({text,x,y,width:this.measureText(text).width});
   return fillText.call(this,text,x,y,...args);
  };
 });
 await openHome(page);
 const payload=structuredClone(fixture);
 Object.assign(payload.document,{width,height,...documentPatch});
 Object.assign(payload.document.elements[0],{...origin,id:'case',name:'Case sample',w:535,h:365,
  fontFamily:'Arial',fontSize:39.75,lineHeight:1.2,text:'Straße',textColor:'#202020',fill:'#202020',autoFontSize:false,...patch});
 payload.document.elements.push(...extraLayers);
 await importPayload(page,payload);
 const doc=(await records(page,'docs')).find(d=>d.title==='Visual fixed font (импорт)');
 await openLibraryDocument(page,doc.id);
 return doc.id;
}
async function actualSize(page){
 await page.locator('#fitBtn').click();
 await page.locator('#zoomLabel').click();
 await page.locator('#zoomInput').fill('100');
 await page.locator('#zoomInput').press('Enter');
 await pause(page);
}
async function edit(page){
 await actualSize(page);
 const p=await canvasPoint(page,origin.x+30,origin.y+25,width,height);
 await page.mouse.dblclick(p.x,p.y);
 await expect(host(page)).toBeFocused();
 await expect(page.locator('#inlineText')).toBeHidden();
 await expect(page.locator('#wysiwygRecovery')).toBeHidden();
}
async function choose(page,mode,projected){
 await button(page,mode).click();
 await expect(button(page,mode)).toHaveAttribute('aria-pressed','true');
 await expect(host(page)).toBeFocused();
 await expect(host(page)).toHaveText(projected);
}
async function done(page){
 await host(page).focus();await press(page,'Control+Enter');await expect(host(page)).toBeHidden();
}
async function nativeSelection(page){
 return host(page).evaluate(el=>{
  const s=getSelection();
  const offset=(node,i)=>{const r=document.createRange();r.setStart(el,0);r.setEnd(node,i);return r.toString().length};
  const row=s.focusNode.parentElement.closest('[data-wysiwyg-row]');
  const rect=s.getRangeAt(0).getBoundingClientRect();
  return {anchor:offset(s.anchorNode,s.anchorOffset),focus:offset(s.focusNode,s.focusOffset),
   text:s.toString(),row:[...el.children].indexOf(row),x:rect.x,y:rect.y};
 });
}
const offsets=async page=>{const {anchor,focus}=await nativeSelection(page);return [anchor,focus]};
async function rangeBox(page,start,end){
 return host(page).evaluate((el,{start,end})=>{
  const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
  const range=document.createRange();let offset=0,node;
  while(node=walker.nextNode()){
   if(start>=offset&&start<offset+node.length){
    range.setStart(node,start-offset);range.setEnd(node,end-offset);
    return range.getBoundingClientRect().toJSON();
   }
   offset+=node.length;
  }
  throw Error('Missing glyph range');
 },{start,end});
}
const img=url=>PNG.sync.read(Buffer.from(url.split(',')[1],'base64')).data;
function maxDelta(a,b){
 expect(a.length).toBe(b.length);
 return a.reduce((max,p,i)=>Math.max(max,Math.abs(p-b[i])),0);
}
async function outside(page){
 const p=await canvasPoint(page,620,458,width,height);await page.mouse.click(p.x,p.y);
}

test('five buttons, mixed native backward range, explicit original, history and reload',async({page})=>{
 const text='пРИмер ТЕКСТА. второе предложение!';
 const id=await seed(page,{text,w:535,fontSize:25});await edit(page);
 await choose(page,'upper','ПРИМЕР ТЕКСТА. ВТОРОЕ ПРЕДЛОЖЕНИЕ!');
 await choose(page,'lower','пример текста. второе предложение!');
 await choose(page,'title','Пример Текста. Второе Предложение!');
 await choose(page,'sentence','Пример текста. Второе предложение!');
 await choose(page,'original',text);
 await choose(page,'upper','ПРИМЕР ТЕКСТА. ВТОРОЕ ПРЕДЛОЖЕНИЕ!');
 await button(page,'upper').click();
 await host(page).focus();await press(page,'Control+z');
 expect((await model(page)).textCase).toBeUndefined();
 await press(page,'Control+Shift+z','Control+Home','ArrowRight','ArrowRight','Shift+ArrowLeft');
 await button(page,'original').focus();await press(page,'Space');
 await expect(host(page)).toBeFocused();
 expect(await offsets(page)).toEqual([2,1]);
 expect((await model(page)).textRuns).toEqual([{start:1,end:2,style:{textCase:'original'}}]);
 await press(page,'Control+Home','Shift+ArrowRight','Shift+ArrowRight');
 await expect(page.locator('[data-text-case-mixed]')).toHaveText('Mixed');
 for(const mode of ['original','upper','lower','title','sentence'])await expect(button(page,mode)).toHaveAttribute('aria-pressed','false');
 await button(page,'lower').click();
 expect(await offsets(page)).toEqual([0,2]);
 expect((await model(page)).text).toBe(text);
 const saved=await model(page);
 await done(page);
 await expect.poll(async()=>(await records(page,'docs')).find(d=>d.id===id)?.elements[0]).toEqual(saved);
 await page.reload();await openLibraryDocument(page,id);await edit(page);
 await expect(host(page)).toHaveText('прИМЕР ТЕКСТА. ВТОРОЕ ПРЕДЛОЖЕНИЕ!');
 expect(await model(page)).toEqual(saved);
 await press(page,'Control+Home');
 await choose(page,'original',text);
 await press(page,'Escape');await expect(host(page)).toBeHidden();expect(await model(page)).toEqual(saved);
});

test('native clicks and backward drag snap expansion; arrows, delete, clipboard and typing use source',async({page},info)=>{
 await seed(page,{text:'Straße\nİx 👩‍💻',textCase:'upper',
  textRuns:[{start:7,end:9,style:{textCase:'lower',fontFamily:'Georgia',textColor:'#1a5482'}}]});
 await edit(page);
 expect(await host(page).textContent()).toBe('STRASSE\ni\u0307x 👩‍💻');
 const ss=await rangeBox(page,4,6),y=ss.top+ss.height/2;
 const positions=[];
 for(const [part,display] of [[.08,4],[.37,4],[.63,6],[.92,6]]){
  await page.mouse.click(ss.left+ss.width*part,y);
  await expect.poll(()=>offsets(page)).toEqual([display,display]);
  const selected=await nativeSelection(page);
  const caretError=Math.abs(selected.x-(display===4?ss.left:ss.right));
  expect(caretError).toBeLessThan(.12);
  positions.push({part,display,caretError});
 }
 await page.mouse.move(ss.left+ss.width*.63,y);await page.mouse.down();
 await page.mouse.move(ss.left-14,y,{steps:8});await page.mouse.up();
 await expect.poll(async()=>(await nativeSelection(page)).anchor).toBe(6);
 const drag=await nativeSelection(page);
 expect(drag.focus).toBeLessThanOrEqual(4);expect(drag.text).toMatch(/SS$/);
 await press(page,'Home','ArrowRight','ArrowRight','ArrowRight','ArrowRight','Shift+ArrowRight');
 expect(await offsets(page)).toEqual([4,6]);
 await press(page,'Control+c','End','Control+v');
 expect((await model(page)).text).toBe('Straßeß\nİx 👩‍💻');
 await press(page,'Backspace');
 expect((await model(page)).text).toBe('Straße\nİx 👩‍💻');
 await press(page,'Home','ArrowRight','ArrowRight','ArrowRight','ArrowRight','Shift+ArrowRight','Control+x');
 expect((await model(page)).text).toBe('Strae\nİx 👩‍💻');
 await press(page,'Control+v');expect((await model(page)).text).toBe('Straße\nİx 👩‍💻');
 await press(page,'ArrowLeft','Delete');expect((await model(page)).text).toBe('Strae\nİx 👩‍💻');
 await press(page,'Control+z','ArrowDown','Home');
 expect((await nativeSelection(page)).row).toBe(1);
 await press(page,'ArrowRight');expect(await offsets(page)).toEqual([10,10]);
 await press(page,'ArrowUp','End','Enter');await page.keyboard.type('world');
 expect((await model(page)).text).toBe('Straße\nworld\nİx 👩‍💻');
 expect(await host(page).textContent()).toBe('STRASSE\nWORLD\ni\u0307x 👩‍💻');
 await button(page,'original').click();
 expect(await host(page).textContent()).toBe('Straße\nworld\nİx 👩‍💻');
 await evidence(info,'case-native-caret.json',JSON.stringify({positions,drag}));
});

async function glyphGeometry(page){
 return host(page).evaluate(el=>{
  const box=el.getBoundingClientRect(),scale=box.width/parseFloat(el.style.width);
  return [...el.querySelectorAll('[data-wysiwyg-fragment]')].flatMap(part=>{
   const text=part.textContent.replace(/\n$/,'');if(!text)return [];
   const bounds=document.createRange();
   bounds.setStart(part.firstChild,0);bounds.setEnd(part.firstChild,text.length);
   const rect=bounds.getBoundingClientRect();
   const probe=document.createElement('div'),copy=part.cloneNode(false),marker=document.createElement('span');
   probe.style.cssText='position:fixed;left:-100000px;top:0;visibility:hidden;white-space:pre;width:max-content';
   Object.assign(copy.style,{position:'static',marginLeft:'0',verticalAlign:'baseline'});
   marker.style.cssText='display:inline-block;width:0;height:0;vertical-align:baseline';
   copy.append(document.createTextNode(text),marker);probe.append(copy);document.body.append(probe);
   const range=document.createRange();range.selectNodeContents(copy.firstChild);
   const baseline=marker.getBoundingClientRect().top-range.getBoundingClientRect().top;
   probe.remove();
   return [{text,x:(rect.x-box.x)/scale,y:(rect.y-box.y)/scale+baseline,width:rect.width/scale}];
  });
 });
}
const sample='AV Straße  fi x2   ещё İ  H2O AV  fi Привет и е\u0301\n\nКонец x2\n';
for(const [textAlign,verticalAlign,pattern] of [
 ['left','top','dotted'],['center','middle','wavy'],['right','bottom','dotted'],['justify','top','wavy'],
])test(`${textAlign}/${verticalAlign}: transformed glyphs, decorated lines and PNG retain shared geometry`,async({page},info)=>{
 const sup=sample.indexOf('ß'),sub=sample.indexOf('İ'),end=sample.indexOf('\n');
 // Compare transparent rasters directly on the right/bottom case; the other
 // alignments also measure compositing onto the opaque document background.
 const transparent=textAlign==='right';
 await seed(page,{text:sample,textCase:'upper',textAlign,verticalAlign,w:395,h:390,fontSize:34,underline:true,strikethrough:true,
  underlineDetails:{style:pattern,color:'#c11a54',opacity:87,thickness:5,offset:7},
  textRuns:[
   {start:sup,end:sup+1,style:{baselineShift:'super',fontSize:48,fillOpacity:67,strokeWidth:1.5,stroke:'#244b21',strokeOpacity:71}},
   {start:sub,end:sub+1,style:{baselineShift:'sub',textCase:'lower',fontFamily:'Georgia',textColor:'#235f87'}},
   {start:end-2,end,style:{textCase:'original',fontFamily:'Georgia',textColor:'#974819'}},
  ]},{backgroundAlpha:transparent?0:100});
 await edit(page);
 const projected=sample.toUpperCase().replace('İ','i\u0307').replace('Е\u0301','е\u0301');
 expect(await host(page).textContent()).toBe(projected);
 expect((await model(page)).text).toBe(sample);
 await expect(host(page).locator('br[data-caret-sentinel]')).toHaveCount(1);
 if(textAlign==='justify'){
  const first=host(page).locator('[data-wysiwyg-row]').first();
  const wrapped=(await first.textContent()).length;
  expect(wrapped).toBeLessThan(projected.indexOf('\n'));
  await press(page,'Control+Home','End');expect(await offsets(page)).toEqual([wrapped,wrapped]);
  expect((await nativeSelection(page)).row).toBe(0);
  await press(page,'ArrowDown','Home');expect(await offsets(page)).toEqual([wrapped,wrapped]);
  expect((await nativeSelection(page)).row).toBe(1);
 }
 const overlay=page.locator('[data-text-stroke-overlay]');
 await expect(overlay).toBeVisible();
 const live=img(await overlay.evaluate((ink,bg)=>{
  if(!bg)return ink.toDataURL();
  const canvas=document.createElement('canvas');canvas.width=ink.width;canvas.height=ink.height;
  const c=canvas.getContext('2d');c.fillStyle=bg;c.fillRect(0,0,canvas.width,canvas.height);c.drawImage(ink,0,0);
  return canvas.toDataURL();
 },transparent?null:fixture.document.background));
 const dom=await glyphGeometry(page);
 await evidence(info,'case-editor.png',await page.screenshot());
 await done(page);
 const draws=await page.evaluate(()=>window.caseDraws);
 expect(draws.map(p=>p.text)).toEqual(dom.map(p=>p.text));
 const diff={x:0,y:0,width:0};
 for(const [i,part] of dom.entries()){
  for(const key of ['x','y','width']){
   if(key==='width'&&part.text===' ')continue;
   diff[key]=Math.max(diff[key],Math.abs(part[key]-draws[i][key]));
  }
 }
 await outside(page);
 const canvas=img(await page.locator('#canvas').evaluate(el=>el.toDataURL())),png=await exportPNG(page,width,height);
 const canvasToPNG=maxDelta(canvas,png.image.data),overlayToPNG=maxDelta(live,png.image.data);
 await evidence(info,'case-export.png',png.bytes);
 await evidence(info,'case-geometry.json',JSON.stringify({diff,canvasToPNG,overlayToPNG,transparent,dom,draws}));
 for(const [key,error] of Object.entries(diff))expect(error,key).toBeLessThan(.12);
 expect(canvasToPNG).toBeLessThanOrEqual(1);expect(overlayToPNG).toBeLessThanOrEqual(2);
});

test('whole-layer case auto-fits and rejects unconfirmed DOM and composition',async({page})=>{
 const text='ßßß i i';
 await seed(page,{text,w:200,h:40,autoFontSize:true});
 await page.locator('#layers .layer-name').filter({hasText:'Case sample'}).click();
 const initial=await model(page);
 await button(page,'upper').click();
 const fitted=await model(page);
 expect(fitted).toMatchObject({text,textCase:'upper',autoFontSize:true});
 expect(fitted.fontSize).toBeLessThan(initial.fontSize);
 await edit(page);expect(await host(page).textContent()).toBe('SSSSSS I I');
 await press(page,'Control+Home','Shift+ArrowRight');
 await host(page).evaluate(el=>{
  const span=el.querySelector('[data-wysiwyg-fragment]');
  span.dataset.externalMutation='same-text';
  el.dispatchEvent(new InputEvent('input',{bubbles:true}));
 });
 await expect(page.locator('#wysiwygRecovery')).toBeVisible();
 await button(page,'original').dispatchEvent('click');
 expect(await model(page)).toEqual(fitted);
 await page.locator('#wysiwygRecover').click();
 await expect(host(page)).toHaveText('SSSSSS I I');
 await host(page).dispatchEvent('compositionstart');
 await expect(page.locator('#wysiwygRecovery')).toBeVisible();
 await button(page,'lower').dispatchEvent('click');
 expect(await model(page)).toEqual(fitted);
 await host(page).dispatchEvent('compositionend');
 await page.locator('#wysiwygRecover').click();
 await expect(page.locator('#inlineText')).toBeHidden();
 await expect(page.locator('#wysiwygRecovery')).toBeHidden();
});

for(const patch of [{locked:true},{textMode:'vertical'},{rotation:12}])test(`case command is disabled and leaves the layer intact for ${Object.keys(patch)[0]}`,async({page})=>{
 await seed(page,{...patch,textCase:'lower',textRuns:[{start:4,end:5,style:{textCase:'original'}}]});
 await page.locator('#layers .layer-name').filter({hasText:'Case sample'}).click();
 const before=await model(page);
 await expect(button(page,'upper')).toBeDisabled();
 await button(page,'upper').dispatchEvent('click');
 expect(await model(page)).toEqual(before);
});

test('the mobile case panel keeps native source and renders range and layer case in Canvas/PNG',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});
 const text='Straße. второе слово';
 await seed(page,{text,w:410,h:270,mobileCase:1,mobileRawText:'stale'});
 await page.locator('[data-mobile=layers]:visible').click();
 await page.locator('#mobileLayerList .layer-name').filter({hasText:'Case sample'}).click();
 await page.locator('#mobileLayersClose').click();
 await page.locator('#mobileContext [data-mobile=edit]').click();
 const input=page.locator('#inlineText'),options=page.getByRole('dialog',{name:'Регистр текста',exact:true});
 await expect(input).toBeFocused();await expect(host(page)).toBeHidden();
 await press(page,'Control+Home','Shift+ArrowRight');
 await page.locator('#mobileContext [data-mobile=format]').click();
 const before=await model(page);
 await page.locator('[data-mp-format=case]').click();await expect(options).toBeVisible();
 expect(await model(page)).toEqual(before);
 const modeButton=mode=>options.locator(`[data-mp-text-case=${mode}]`);
 await modeButton('upper').click();await expect(modeButton('upper')).toHaveAttribute('aria-pressed','true');
 await page.locator('#undoBtn').click();await expect(modeButton('original')).toHaveAttribute('aria-pressed','true');
 await page.locator('#redoBtn').click();await expect(modeButton('upper')).toHaveAttribute('aria-pressed','true');
 for(const mode of ['lower','title','sentence','original','upper']){
  await modeButton(mode).click();await expect(modeButton(mode)).toHaveAttribute('aria-pressed','true');
  await expect(input).toHaveValue(text);
  expect(await model(page)).toEqual(mode==='original'?before:{...before,textRuns:[{start:0,end:1,style:{textCase:mode}}]});
  expect(await input.evaluate(el=>[el.selectionStart,el.selectionEnd])).toEqual([0,1]);
  await expect(input).not.toBeFocused();
 }
 await page.locator('#mobileContext [data-mobile=edit]').click();
 await press(page,'Control+End');
 await page.locator('#mobileContext [data-mobile=format]').click();
 await page.locator('[data-mp-format=case]').click();
 await modeButton('upper').click();
 expect(await model(page)).toEqual({...before,textCase:'upper'});
 await options.getByRole('button',{name:'Готово'}).click();
 await page.locator('#mobileContext [data-mobile=edit]').click();
 await press(page,'Control+End');await page.keyboard.insertText(' world');
 await expect(input).toHaveValue(text+' world');
 await page.locator('#mobileConfirm').click();await expect(input).toBeHidden();
 const png=await exportPNG(page,width,height);
 expect((await model(page)).text).toBe(text+' world');
 expect((await page.evaluate(()=>window.caseDraws)).map(p=>p.text).join('')).toBe('STRASSE. ВТОРОЕ СЛОВО WORLD');
 await evidence(info,'case-mobile-export.png',png.bytes);
});

test('gradient, image fill and layer masks render case identically to equivalent source glyphs',async({page})=>{
 const tile=new PNG({width:4,height:4}),mask=new PNG({width,height});
 for(let i=0;i<tile.data.length;i+=4)tile.data.set([35,98,145,255],i);
 const gap=275,layerWidth=220,layerHeight=82;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const opaque=[origin.x,origin.x+gap].some(start=>x>=start&&x<start+125);
  const c=opaque?255:30;
  mask.data.set([c,c,c,255],(y*width+x)*4);
 }
 const url=png=>'data:image/png;base64,'+PNG.sync.write(png).toString('base64');
 const styles=[{fillType:'gradient',fill:'#145c83',fill2:'#e05252'},
  {fillType:'image',imageSrc:url(tile)},{fillType:'solid',layerMaskSrc:url(mask)}];
 const layers=styles.flatMap((fill,i)=>[false,true].map(original=>({
  ...fixture.document.elements[0],...fill,id:`fill-${i}-${original}`,name:`Fill ${i}`,
  x:origin.x+(original?gap:0),y:origin.y+i*110,w:layerWidth,h:layerHeight,
  text:original?'STRASSE':'Straße',textCase:original?'original':'upper',
  fontFamily:'Arial',fontSize:39.75,lineHeight:1.2,textColor:'#205773',autoFontSize:false,
 })));
 const [first,...rest]=layers;
 await seed(page,first,{},rest);await actualSize(page);
 const png=await exportPNG(page,width,height);
 await outside(page);
 expect(maxDelta(img(await page.locator('#canvas').evaluate(el=>el.toDataURL())),png.image.data)).toBeLessThanOrEqual(1);
 for(let i=0;i<styles.length;i++){
  const left=[],right=[];
  for(let y=origin.y+i*110;y<origin.y+i*110+layerHeight;y++){
   const start=(y*width+origin.x)*4,end=start+layerWidth*4;
   left.push(...png.image.data.subarray(start,end));right.push(...png.image.data.subarray(start+gap*4,end+gap*4));
  }
  expect(left.some((p,j)=>j%4===1&&p<160)).toBe(true);
  expect(maxDelta(left,right),styles[i].fillType).toBeLessThanOrEqual(1);
 }
});
