const {test,expect,openHome,importPayload,records,openLibraryDocument,canvasPoint,exportPNG}=require('./helpers');
const {model}=require('./support/text-interaction');
const {PNG}=require('pngjs');
const fixture=require('./fixtures/visual-text.json');
const host='#inlineWysiwyg';
const paragraph='Привет мир. Длинный русский текст с автоматическими переносами строк и выделением отдельных слов. Здесь интервалы меняются внутри одного абзаца, сохраняя ширину букв и оформление соседних участков.';
const text=paragraph+'\n\nПоследняя строка.\n';
const field=page=>page.locator('#inspector [data-key=lineHeight]');
async function setup(page,patch={}){
 await page.setViewportSize({width:2200,height:1600});
 await page.addInitScript(()=>{
  window.leadingGlyphs=[];window.leadingLines=[];window.leadingExport=[];
  const p=CanvasRenderingContext2D.prototype,fill=p.fillText,rect=p.fillRect,clear=p.clearRect;
  p.clearRect=function(...args){if(this.canvas.id==='canvas'){window.leadingGlyphs=[];window.leadingLines=[]}return clear.apply(this,args)};
  p.fillText=function(text,x,y,...args){const v={text,x,y,font:this.font,color:this.fillStyle,spacing:this.letterSpacing,width:this.measureText(text).width};if(this.canvas.id==='canvas')window.leadingGlyphs.push(v);else if(window.captureLeading)window.leadingExport.push(v);return fill.call(this,text,x,y,...args)};
  p.fillRect=function(x,y,width,height){if(this.canvas.id==='canvas'&&height>0&&height<10&&width>0)window.leadingLines.push({x,y,width,height,color:this.fillStyle});return rect.call(this,x,y,width,height)};
 });
 await openHome(page);const payload=structuredClone(fixture);
 Object.assign(payload.document,{width:800,height:1000,background:'#ffffff'});
 Object.assign(payload.document.elements[0],{id:'leading',name:'Leading',x:24,y:20,w:740,h:950,fontFamily:'Arial',fontSize:28,lineHeight:1.2,text,textColor:'#000000',fill:'#000000',fillType:'solid',autoFontSize:false,...patch});
 await importPayload(page,payload);const doc=(await records(page,'docs')).find(d=>d.title==='Visual fixed font (импорт)');await openLibraryDocument(page,doc.id);await edit(page);return doc.id;
}
async function edit(page){await page.locator('#fitBtn').click();const p=await canvasPoint(page,60,40,800,1000);await page.mouse.dblclick(p.x,p.y);await expect(page.locator(host)).toBeFocused();await safe(page)}
async function safe(page){await expect(page.locator('#inlineText')).toBeHidden();await expect(page.locator('#wysiwygRecovery')).toBeHidden()}
async function selection(page){return page.locator(host).evaluate(el=>{const s=getSelection(),offset=(node,n)=>{const r=document.createRange();r.setStart(el,0);r.setEnd(node,n);return r.toString().length};return [offset(s.anchorNode,s.anchorOffset),offset(s.focusNode,s.focusOffset)]})}
async function select(page,anchor,focus=anchor){
 await page.locator(host).evaluate((el,{anchor,focus})=>{
  el.focus();const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),nodes=[];let n,start=0;
  while(n=walker.nextNode()){nodes.push({n,start,end:start+n.length});start+=n.length}
  const point=i=>{const p=nodes.find(p=>i>=p.start&&i<=p.end);return [p.n,i-p.start]};getSelection().setBaseAndExtent(...point(anchor),...point(focus));
 },{anchor,focus});await expect.poll(()=>selection(page)).toEqual([anchor,focus]);
}
async function checkRange(page,a,b){await page.locator(host).focus();expect(await selection(page)).toEqual([a,b]);await safe(page)}
async function mixed(page){await expect(field(page)).toHaveValue('');await expect(field(page)).toHaveAttribute('placeholder','Mixed')}
async function close(page){await page.locator(host).focus();await page.keyboard.press('Control+Enter');await expect(page.locator(host)).toBeHidden()}
async function set(page,value){await field(page).fill(String(value));await expect(field(page)).toBeFocused();await expect(field(page)).toHaveValue(String(value));await field(page).press('Tab');await safe(page)}
async function geometry(page){return page.locator(host).evaluate(el=>{
 const box=el.getBoundingClientRect(),scale=box.width/parseFloat(el.style.width);
 return [...el.querySelectorAll('[data-wysiwyg-row]')].map(row=>({y:parseFloat(row.style.top),height:parseFloat(row.style.height),parts:[...row.querySelectorAll('[data-wysiwyg-fragment]')].map(p=>{
  const marker=document.createElement('span');marker.style.cssText='display:inline-block;width:0;height:0;vertical-align:baseline';p.prepend(marker);
  const b=p.getBoundingClientRect(),baseline=(marker.getBoundingClientRect().bottom-box.top)/scale;marker.remove();
  const range=document.createRange();range.setStart(p.firstChild,0);range.setEnd(p.firstChild,p.firstChild.length-(p.firstChild.data.endsWith('\n')?1:0));
  return {text:p.textContent.replace(/\n$/,''),x:(b.left-box.left)/scale,y:baseline,width:range.getBoundingClientRect().width/scale,font:[getComputedStyle(p).fontStyle,getComputedStyle(p).fontWeight,getComputedStyle(p).fontSize,getComputedStyle(p).fontFamily].join(' '),color:getComputedStyle(p).color,spacing:getComputedStyle(p).letterSpacing};
 })}));
 })}
const horizontal=rows=>rows.map(r=>r.parts.map(p=>({text:p.text,x:p.x,width:p.width})));

for(const autoFontSize of [false,true])test(`range lineHeight input, Mixed arrows, backward Selection, history and persistence; auto-fit ${autoFontSize}`,async({page})=>{
 test.setTimeout(60000);
 const id=await setup(page,{text:paragraph,autoFontSize}),initial=await model(page),before=await geometry(page);
 expect(before.length).toBeGreaterThan(2);
 // Real keyboard selects one word inside a single auto-wrapped paragraph.
 await page.keyboard.press('Control+Home');for(let i=0;i<7;i++)await page.keyboard.press('ArrowRight');for(let i=0;i<3;i++)await page.keyboard.press('Shift+ArrowRight');
 expect(await selection(page)).toEqual([7,10]);await set(page,2.2);await checkRange(page,7,10);
 expect((await model(page)).textRuns).toEqual([{start:7,end:10,style:{lineHeight:2.2}}]);
 const after=await geometry(page);
 if(!autoFontSize){expect(horizontal(after)).toEqual(horizontal(before));expect(after[0].height).toBeGreaterThan(before[0].height);expect(after[1].y).toBeGreaterThan(before[1].y)}
 else {
  const fitted=await model(page),widths=await page.evaluate(({e,rows})=>{const ctx=document.createElement('canvas').getContext('2d');ctx.font=`${e.fontSize}px Arial`;ctx.fontKerning='normal';ctx.letterSpacing='0px';return rows.map(r=>ctx.measureText(r.parts.map(p=>p.text).join('')).width)},{e:fitted,rows:after});
  for(let i=0;i<after.length;i++)expect(Math.abs(after[i].parts.reduce((sum,p)=>sum+p.width,0)-widths[i])).toBeLessThan(.12);
  expect(after.reduce((sum,r)=>sum+r.height,0)).toBeLessThanOrEqual(fitted.h-1);
  expect(after[0].height).toBeCloseTo(fitted.fontSize*2.2,5);
 }
 await select(page,7,10);await expect(field(page)).toHaveValue('2.2');await select(page,11,17);await expect(field(page)).toHaveValue('1.2');await select(page,17,7);await mixed(page);
 const step=direction=>field(page).locator('xpath=..').locator(`[data-num-direction=${direction}]`);
 await step('up').click();await checkRange(page,17,7);await expect(field(page)).toHaveValue('2.25');
 const changed=await model(page);expect(changed.lineHeight).toBe(1.2);expect(changed.autoFontSize).toBe(autoFontSize);
 await page.keyboard.press('Control+z');await mixed(page);await field(page).focus();await field(page).press('ArrowDown');await field(page).press('Tab');await checkRange(page,17,7);await expect(field(page)).toHaveValue('2.15');
 await page.keyboard.press('Control+z');await mixed(page);await step('up').click();await checkRange(page,17,7);expect(await model(page)).toEqual(changed);
 await page.keyboard.press('Control+z');await page.keyboard.press('Control+Shift+z');expect(await model(page)).toEqual(changed);
 await field(page).focus();await field(page).press('Escape');await expect(page.locator(host)).toBeHidden();expect(await model(page)).toEqual(initial);
 await edit(page);await select(page,7,17);await set(page,2.25);const saved=await model(page),live=await geometry(page);await close(page);await mixed(page);
 const canvas=await page.evaluate(()=>window.leadingGlyphs),parts=live.flatMap(r=>r.parts).filter(p=>p.text);
 expect(canvas.map(p=>p.text)).toEqual(parts.map(p=>p.text));
 for(let i=0;i<parts.length;i++)for(const key of ['x','y','width'])expect(Math.abs(canvas[i][key]-parts[i][key]),`${key} auto=${autoFontSize}`).toBeLessThan(.12);
 await page.evaluate(()=>{window.captureLeading=true;window.leadingExport=[]});const png=await exportPNG(page,800,1000);expect(png.image.width).toBe(800);expect((await page.evaluate(()=>window.leadingExport)).slice(-canvas.length)).toEqual(canvas);

 await page.locator('#undoBtn').click();expect(await model(page)).toEqual(initial);await page.locator('#redoBtn').click();expect(await model(page)).toEqual(saved);
 await edit(page);await select(page,7,17);await expect(field(page)).toHaveValue('2.25');await close(page);
 await expect.poll(async()=>(await records(page,'docs')).find(d=>d.id===id)?.elements[0]).toEqual(saved);
 await page.reload();await openLibraryDocument(page,id);await edit(page);expect(await model(page)).toEqual(saved);await select(page,7,17);await expect(field(page)).toHaveValue('2.25');
});

test('mixed sizes, leading, LF/empty rows: measured DOM baseline and x agree with Canvas and downloaded PNG, including U/S',async({page},info)=>{
 test.setTimeout(60000);
 await setup(page,{textRuns:[
  {start:0,end:6,style:{fontSize:36,fontWeight:'700',fontFamily:'Georgia',underline:true}},
  {start:7,end:35,style:{letterSpacing:1.5,textColor:'#cc2244',strikethrough:true}},
 ]});
 const initial=await model(page),before=await geometry(page);
 await select(page,7,10);await set(page,3);await checkRange(page,7,10);
 const one=await geometry(page);expect(horizontal(one)).toEqual(horizontal(before));expect(one[0].height).toBe(84);expect(one[1].y-before[1].y).toBeGreaterThan(30);
 const lf=text.indexOf('\n');await select(page,lf+2,lf-15);await set(page,1.9);await checkRange(page,lf+2,lf-15);
 await select(page,text.length-1,text.length);await set(page,2.5);await checkRange(page,text.length-1,text.length);
 const current=await model(page);expect(current.textRuns.find(r=>r.start===0).style).toEqual(initial.textRuns[0].style);
 // Caret keyboard navigation must follow the new row layout through hard/soft wraps.
 await select(page,7);await page.keyboard.press('ArrowDown');expect((await selection(page))[0]).toBeGreaterThan(7);
 await select(page,text.length);await page.keyboard.press('ArrowUp');expect((await selection(page))[0]).toBeLessThan(text.length);
 await select(page,text.length);const dom=await geometry(page);expect(dom.at(-1).height).toBe(70);expect(dom.at(-2).height).toBeCloseTo(28*1.2,6);
 const decorations=await page.locator(host).evaluate(el=>[...el.querySelectorAll('[data-wysiwyg-row]')].flatMap(row=>{
  const split=s=>s.split(/,(?![^()]*\))/).map(s=>s.trim());if(!row.style.backgroundImage)return [];
  const positions=split(row.style.backgroundPosition),sizes=split(row.style.backgroundSize);
  return positions.map((p,i)=>{const [x,y]=p.split(' ').map(parseFloat),[width,height]=sizes[i].split(' ').map(parseFloat);return {x,y:y+parseFloat(row.style.top),width,height}});
 }));
 const screenshot=await page.locator(host).screenshot();await info.attach('mixed-leading-wysiwyg.png',{body:screenshot,contentType:'image/png'});
 await close(page);const canvas=await page.evaluate(()=>window.leadingGlyphs),parts=dom.flatMap(r=>r.parts).filter(p=>p.text);
 expect(canvas.map(p=>p.text)).toEqual(parts.map(p=>p.text));
 for(let i=0;i<parts.length;i++)for(const key of ['x','y','width'])expect(Math.abs(canvas[i][key]-parts[i][key]),`${key} fragment ${i}`).toBeLessThan(.12);
 const lines=await page.evaluate(()=>window.leadingLines);expect(lines.length).toBe(decorations.length);
 for(let i=0;i<lines.length;i++)for(const key of ['x','y','width','height'])expect(Math.abs(lines[i][key]-decorations[i][key])).toBeLessThan(.01);
 await page.evaluate(()=>{window.captureLeading=true;window.leadingExport=[]});const png=await exportPNG(page,800,1000);
 expect((await page.evaluate(()=>window.leadingExport)).slice(-canvas.length)).toEqual(canvas);
 // Reconstruct the exported ink from independently measured DOM positions.
 const expected=PNG.sync.read(Buffer.from(await page.evaluate(({parts,decorations,e})=>{
  const c=document.createElement('canvas');c.width=800;c.height=1000;const ctx=c.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,c.width,c.height);ctx.translate(e.x,e.y);ctx.fontKerning='normal';ctx.textBaseline='alphabetic';
  for(const p of parts){ctx.font=p.font;ctx.letterSpacing=p.spacing==='normal'?'0px':p.spacing;ctx.fillStyle=p.color;ctx.fillText(p.text,p.x,p.y)}
  // Canvas-recorded colors are paired with DOM-measured line coordinates.
  decorations.forEach((r,i)=>{ctx.fillStyle=window.leadingLines[i].color;ctx.fillRect(r.x,r.y,r.width,r.height)});
  return c.toDataURL().split(',')[1];
 },{parts,decorations,e:current}),'base64'));
 // Native DOM boxes round fractional coordinates to the CSS pixel grid.
 // Check strong ink in both rasters within one pixel, allowing antialiasing;
 // the independent coordinate assertions above remain tighter than .12px.
 const unmatched=(a,b)=>{let ink=0,missing=0;for(let y=1;y<a.height-1;y++)for(let x=1;x<a.width-1;x++){
  const i=(y*a.width+x)*4;if(Math.min(a.data[i],a.data[i+1],a.data[i+2])>=100)continue;ink++;
  let found=false;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const j=((y+dy)*b.width+x+dx)*4;if([0,1,2].every(k=>Math.abs(a.data[i+k]-b.data[j+k])<60))found=true}
  if(!found)missing++;
 }expect(ink).toBeGreaterThan(1000);return missing};
 expect(unmatched(png.image,expected),'exported ink has a DOM-positioned counterpart').toBe(0);
 expect(unmatched(expected,png.image),'all DOM-positioned ink appears in PNG').toBe(0);
 await info.attach('mixed-leading-export.png',{body:png.bytes,contentType:'image/png'});await info.attach('leading-geometry.json',{body:JSON.stringify({dom,canvas,decorations}),contentType:'application/json'});
});

test('collapsed lineHeight keeps layer behavior, full uniform override is displayed, invalid input is harmless',async({page})=>{
 await setup(page,{text:paragraph,textRuns:[{start:0,end:paragraph.length,style:{lineHeight:1.8}}]});await close(page);await expect(field(page)).toHaveValue('1.8');await edit(page);await select(page,2);
 const before=await model(page);await field(page).fill('');expect(await model(page)).toEqual(before);await field(page).fill('-1');await field(page).press('Tab');expect(await model(page)).toEqual(before);
 await field(page).fill('-1');await field(page).press('Enter');await checkRange(page,2,2);expect(await model(page)).toEqual(before);
 await set(page,1.4);await checkRange(page,2,2);expect((await model(page)).lineHeight).toBe(1.4);expect((await model(page)).textRuns).toEqual(before.textRuns);
});

test('whole-layer Mixed arrow starts from the base and retains explicit overrides',async({page})=>{
 await setup(page,{text:paragraph,textRuns:[{start:0,end:6,style:{lineHeight:1.8}}]});await close(page);await mixed(page);
 const before=await model(page);await field(page).locator('xpath=..').locator('[data-num-direction=up]').click();
 expect((await model(page)).lineHeight).toBe(1.25);expect((await model(page)).textRuns).toEqual(before.textRuns);await mixed(page);
});
