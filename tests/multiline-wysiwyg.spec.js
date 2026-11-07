const {test,expect,openHome,createDocument,canvasPoint,exportPNG,records,openLibraryDocument}=require('./helpers');
const text='Поэтому после выбора шрифта редактор переходит в обычное текстовое поле. Там выделенный текст отображается без индивидуального оформления, хотя после выхода из редактирования Canvas показывает выбранный шрифт и красный цвет. При повторном входе происходит то же самое.';
const surface='#inlineWysiwyg';

// Observe the shipping exporters and native drawing calls, without exposing app,
// changing metrics, importing fixture documents or replacing either renderer.
async function model(page){return page.evaluate(async()=>{
 const click=HTMLAnchorElement.prototype.click;let url;
 HTMLAnchorElement.prototype.click=function(...args){if(this.download?.endsWith('.json')){url=this.href;return;}return click.apply(this,args)};
 try{document.querySelector('#jsonExportBtn').click();if(!url)throw Error('Missing document export');return (await (await fetch(url)).json()).document.elements[0]}
 finally{HTMLAnchorElement.prototype.click=click}
})}
async function observe(page){await page.addInitScript(()=>{
 window.textFrame=[];window.exportFrame=[];
 const p=CanvasRenderingContext2D.prototype,clear=p.clearRect,fill=p.fillText;
 p.clearRect=function(...args){if(this.canvas.id==='canvas')window.textFrame=[];return clear.apply(this,args)};
 p.fillText=function(text,x,y,...args){
  const target=this.canvas.id==='canvas'?window.textFrame:window.captureTextExport?window.exportFrame:null;
  if(target){const m=this.measureText(text);target.push({text,x,y,width:m.width,font:this.font,color:this.fillStyle,spacing:this.letterSpacing})}
  return fill.call(this,text,x,y,...args);
 };
 window.textTransitions=[];
 document.addEventListener('focusin',e=>window.textTransitions.push({focus:e.target.id||e.target.tagName}),true);
})}
async function live(page){await expect(page.locator(surface)).toBeVisible();await expect(page.locator('#inlineText')).toBeHidden();await expect(page.locator('#wysiwygRecovery')).toBeHidden();expect((await model(page)).text).toBe(text)}
async function field(page,key,value){const el=page.locator(`#inspector [data-key="${key}"]`);await el.fill(String(value));await expect(el).toBeFocused();await el.press('Tab')}
async function font(page,name){await page.locator('#inspector [data-font-open]').click();await page.locator(`#inspector [data-font-option="${name}"]`).click();await live(page)}
async function color(page,hex){await page.locator('#inspector [data-fill-open=fill]').click();const el=page.locator('#fillPopover [data-cp-part="0"]');await el.fill(hex);await expect(el).toBeFocused();await live(page);await el.press('Tab');await page.locator('[data-fill-close]').click()}
async function selection(page){return page.locator(surface).evaluate(el=>{
 const s=getSelection(),offset=(node,n)=>{const r=document.createRange();r.setStart(el,0);r.setEnd(node,n);return r.toString().length};return {anchor:offset(s.anchorNode,s.anchorOffset),focus:offset(s.focusNode,s.focusOffset)};
})}
async function select(page,a,b){
 await page.locator(surface).focus();await page.keyboard.press('Control+Home');
 for(let i=0;i<a;i++)await page.keyboard.press('ArrowRight');
 for(let i=a;i<b;i++)await page.keyboard.press('Shift+ArrowRight');
 expect(await selection(page)).toEqual({anchor:a,focus:b});
}
async function reopen(page){
 const e=await model(page);await page.locator('#fitBtn').click();
 // Fit changes pan/scroll on the next frame; click the settled canvas.
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const p=await canvasPoint(page,e.x+100,e.y+40,1080,1350);await page.mouse.dblclick(p.x,p.y);await expect(page.locator(surface)).toBeFocused();await live(page);
}
async function createLayer(page,auto){
 await openHome(page);await createDocument(page,'Многострочный текст',1080,1350);
 await page.keyboard.press('t');const a=await canvasPoint(page,80,80,1080,1350),b=await canvasPoint(page,818,714,1080,1350);
 await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});await page.mouse.up();
 await expect(page.locator(surface)).toBeFocused();
 // Firefox's Playwright insertText/type(non-ASCII) simulates composition. A
 // real clipboard paste exercises the user's scenario and trusted beforeinput.
 await page.evaluate(value=>navigator.clipboard.writeText(value),text);await page.keyboard.press('Control+v');await live(page);
 await page.keyboard.press('Control+Enter');
 await page.locator('#inspector [data-text-auto-font]').setChecked(auto);
 if(!auto)await field(page,'fontSize',49);
 await field(page,'w',738);await field(page,'h',634);await field(page,'lineHeight',1.1);
 expect((await model(page)).autoFontSize).toBe(auto);await reopen(page);
}
// Measure real text Range rectangles and their alphabetic baselines. The
// independent offscreen clone locates the browser baseline with a zero-height
// marker; no text-engine rows or synthetic test hook supply expected geometry.
async function domGeometry(page){return page.locator(surface).evaluate(host=>{
 const h=host.getBoundingClientRect(),scale=h.width/parseFloat(host.style.width),ctx=document.createElement('canvas').getContext('2d');
 return [...host.querySelectorAll('[data-wysiwyg-fragment]')].filter(el=>el.textContent.replace(/\n/g,'')&&(el.parentElement.getBoundingClientRect().top-h.top)/scale<=parseFloat(host.style.height)).map(el=>{
  const text=el.textContent.replace(/\n$/,''),r=document.createRange();r.setStart(el.firstChild,0);r.setEnd(el.firstChild,text.length);const box=r.getBoundingClientRect(),css=getComputedStyle(el);
  const probe=document.createElement('div'),copy=el.cloneNode(false),marker=document.createElement('span');
  probe.style.cssText='position:fixed;left:-100000px;top:0;visibility:hidden;white-space:pre;width:max-content;padding:0;border:0;margin:0';
  copy.style.position='static';copy.style.marginLeft='0';copy.style.verticalAlign='baseline';copy.append(document.createTextNode(text));
  marker.style.cssText='display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline';copy.append(marker);probe.append(copy);document.body.append(probe);
  const q=document.createRange();q.setStart(copy.firstChild,0);q.setEnd(copy.firstChild,text.length);const baselineOffset=marker.getBoundingClientRect().top-q.getBoundingClientRect().top;probe.remove();
  ctx.font=[css.fontStyle,css.fontWeight,css.fontSize,css.fontFamily].join(' ');ctx.fontKerning='normal';ctx.fillStyle=css.color;
  return {text,x:(box.x-h.x)/scale,y:(box.y-h.y)/scale+baselineOffset,width:box.width/scale,font:ctx.font,color:ctx.fillStyle,spacing:parseFloat(css.letterSpacing)||0};
 });
})}
async function compareGeometry(page,dom,draws,evidence,label){
 expect(draws.length).toBeGreaterThan(0);expect(dom.map(p=>p.text)).toEqual(draws.map(p=>p.text));
 const errors=[];
 for(let i=0;i<dom.length;i++){
  const a=dom[i],b=draws[i];expect(a.font).toBe(b.font);expect(a.color).toBe(b.color);expect(a.spacing).toBe(parseFloat(b.spacing)||0);
  const error={x:Math.abs(a.x-b.x),baseline:Math.abs(a.y-b.y),width:Math.abs(a.width-b.width)};errors.push(error);
  // Browser fractional layout units, measured across both real engines. This
  // bound is also stricter than the existing .5/.75 px parity assertions.
  for(const value of Object.values(error))expect(value,`${label}: ${JSON.stringify({a,b})}`).toBeLessThan(.25);
 }
 evidence.push({label,dom,canvas:draws,errors});
}
async function verifyClosed(page,evidence,label){
 const expected=await model(page),dom=await domGeometry(page);await page.locator(surface).focus();await page.keyboard.press('Control+Enter');await expect(page.locator(surface)).toBeHidden();
 expect(await model(page)).toEqual(expected);const canvas=await page.evaluate(()=>window.textFrame);await compareGeometry(page,dom,canvas,evidence,label);
 await page.evaluate(()=>{window.exportFrame=[];window.captureTextExport=true});const png=await exportPNG(page,1080,1350);await page.evaluate(()=>window.captureTextExport=false);
 expect(await page.evaluate(()=>window.exportFrame)).toEqual(canvas);
 // Real exported ink from the styled range as well as the whole paragraph.
 let colored=0;for(let i=0;i<png.image.data.length;i+=4){const p=png.image.data;if(p[i]>140&&p[i+1]<90&&p[i+2]<100)colored++}
 if(expected.textRuns?.some(r=>r.style.textColor==='#cc2244'))expect(colored).toBeGreaterThan(100);
 return expected;
}

for(const auto of [false,true])test(`real Cyrillic UI repeated styling auto=${auto}`,async({page},info)=>{
 // This end-to-end scenario includes repeated character-by-character selection,
 // DOM/Canvas measurements, JSON persistence, PNG export and a reload.
 // GitHub runners exceed the global 30s limit even when every assertion passes.
 test.setTimeout(90_000);
 const evidence=[];await observe(page);
 try{
  await createLayer(page,auto);expect((await domGeometry(page)).length).toBeGreaterThanOrEqual(5);
  const initial=await model(page),states=[];
  await select(page,40,40);await page.keyboard.press('ArrowUp');expect((await selection(page)).focus).toBeLessThan(40);await page.keyboard.press('ArrowDown');expect(await selection(page)).toEqual({anchor:40,focus:40});
  await select(page,0,text.length);
  for(const family of ['Georgia','Tahoma','Arial']){
   await font(page,family);const state=await model(page);states.push(state);
   expect(state.autoFontSize).toBe(auto);expect((await domGeometry(page)).every(p=>p.font.includes(family))).toBe(true);
   if(auto&&family==='Georgia')expect(state.fontSize).not.toBe(initial.fontSize);
   await page.locator(surface).focus();expect(await selection(page)).toEqual({anchor:0,focus:text.length});
  }
  await page.locator('#inspector [data-text-auto-font]').setChecked(!auto);await live(page);await page.locator('#inspector [data-text-auto-font]').setChecked(auto);await live(page);
  await field(page,'w',720);await live(page);await field(page,'w',738);await field(page,'lineHeight',1.2);await live(page);await field(page,'lineHeight',1.1);
  await color(page,'#cc2244');states.push(await model(page));
  await page.locator('#inspector [data-key=fontVariant]').selectOption('700:normal');states.push(await model(page));await live(page);
  await field(page,'fontSize',42);await live(page);expect((await model(page)).autoFontSize).toBe(false);await expect(page.locator('#inspector [data-text-auto-font]')).not.toBeChecked();states.push(await model(page));
  // Individual completed operations remain separate while editing.
  await page.locator(surface).focus();await page.keyboard.press('Control+z');expect(await model(page)).toEqual(states.at(-2));await page.keyboard.press('Control+Shift+z');expect(await model(page)).toEqual(states.at(-1));
  const full=await verifyClosed(page,evidence,'full selection');await reopen(page);
  // A range crossing multiple visual rows must retain its exact source offsets
  // through menus, live color previews, mixed sizes, close and document history.
  await select(page,20,90);const partial=[];
  await font(page,'Georgia');partial.push(await model(page));
  await color(page,'#cc2244'); // same color: deliberately no new history action
  await field(page,'fontSize',59);partial.push(await model(page));await live(page);
  await page.locator(surface).focus();expect(await selection(page)).toEqual({anchor:20,focus:90});
  const final=await verifyClosed(page,evidence,'mixed cross-row selection');
  for(const expected of [partial[0],full]){await page.locator('#undoBtn').click();expect(await model(page)).toEqual(expected)}
  for(const expected of partial){await page.locator('#redoBtn').click();expect(await model(page)).toEqual(expected)}
  const stored=(await records(page,'docs')).find(d=>d.elements?.some(e=>e.id===final.id));expect(stored).toBeTruthy();
  await expect.poll(async()=>((await records(page,'docs')).find(d=>d.id===stored.id)).elements[0]).toEqual(final);
  await page.reload();await openLibraryDocument(page,stored.id);expect(await model(page)).toEqual(final);await reopen(page);await verifyClosed(page,evidence,'reload and reopen');
  // Resize the persisted layer, repeat formatting on already styled content.
  await page.locator('#inspector [data-text-auto-font]').setChecked(auto);await field(page,'w',680);await field(page,'h',600);await reopen(page);
  await select(page,0,text.length);await font(page,'Tahoma');await color(page,'#cc2244');const resized=await verifyClosed(page,evidence,'resize and reformat');expect(resized.autoFontSize).toBe(auto);
  await reopen(page);await select(page,20,90);await page.keyboard.type('XY');expect((await model(page)).text).toBe(text.slice(0,20)+'XY'+text.slice(90));await page.keyboard.press('Control+z');expect((await model(page)).text).toBe(text.slice(0,20)+'X'+text.slice(90));await page.keyboard.press('Control+z');expect(await model(page)).toEqual(resized);await page.keyboard.press('Escape');expect(await model(page)).toEqual(resized);
  await page.screenshot({path:info.outputPath('canvas-after.png')});
 }finally{
  require('node:fs').writeFileSync(info.outputPath('geometry.json'),JSON.stringify(evidence,null,2));
  const errors=evidence.flatMap(item=>item.errors);console.log('Measured DOM/Canvas maxima (px)',info.project.name,JSON.stringify(Object.fromEntries(['x','baseline','width'].map(key=>[key,Math.max(0,...errors.map(error=>error[key]))]))));
 }
});

test('native backward mouse range crosses visual rows and retains exact styled offsets',async({page},info)=>{
 await observe(page);await createLayer(page,false);
 const point=async offset=>page.locator(surface).evaluate((host,offset)=>{
  const walk=document.createTreeWalker(host,NodeFilter.SHOW_TEXT);let start=0;
  for(let node;node=walk.nextNode();){if(offset<start+node.length){const r=document.createRange();r.setStart(node,offset-start);r.collapse(true);const b=r.getBoundingClientRect();return {x:b.x,y:b.y+b.height*.6}}start+=node.length}
  throw Error('Source offset missing');
 },offset);
 const a=await point(90),b=await point(20);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:12});await page.mouse.up();
 const selected=await selection(page);expect(selected.anchor).toBeGreaterThan(selected.focus);expect(selected.anchor-selected.focus).toBeGreaterThan(50);
 // Assert the actual native range, rather than substituting model-only offsets.
 const selectedText=await page.evaluate(()=>getSelection().toString());expect(selectedText.replace(/\n/g,'')).toBe(text.slice(selected.focus,selected.anchor));
 await font(page,'Georgia');await page.locator(surface).focus();expect(await selection(page)).toEqual(selected);
 const value=await model(page);expect(value.textRuns).toEqual([{start:selected.focus,end:selected.anchor,style:{fontFamily:'Georgia'}}]);
 await info.attach('rich-editor.png',{body:await page.screenshot(),contentType:'image/png'});
 const evidence=[];await verifyClosed(page,evidence,'native mouse range');await reopen(page);expect(await model(page)).toEqual(value);
 require('node:fs').writeFileSync(info.outputPath('geometry.json'),JSON.stringify(evidence,null,2));
});

test('copy and cut use source text across soft rows without adding LF',async({page})=>{
 await observe(page);await createLayer(page,false);const original=await model(page);
 await select(page,20,90);await page.keyboard.press('Control+c');expect(await model(page)).toEqual(original);
 await page.keyboard.press('Control+End');await page.keyboard.press('Control+v');
 expect((await model(page)).text).toBe(text+text.slice(20,90));await page.keyboard.press('Control+z');expect(await model(page)).toEqual(original);
 await select(page,20,90);await page.keyboard.press('Control+x');expect((await model(page)).text).toBe(text.slice(0,20)+text.slice(90));
 await expect(page.locator('#inlineText')).toBeHidden();await page.keyboard.press('Control+z');expect(await model(page)).toEqual(original);
 await page.keyboard.press('Control+Shift+z');expect((await model(page)).text).toBe(text.slice(0,20)+text.slice(90));
 await page.keyboard.press('Escape');expect(await model(page)).toEqual(original);
 await reopen(page);await page.keyboard.press('Control+End');await page.evaluate(()=>navigator.clipboard.writeText('\r\nСтрока'));await page.keyboard.press('Control+v');
 expect((await model(page)).text).toBe(text+'\nСтрока');await page.keyboard.press('Control+z');expect(await model(page)).toEqual(original);await page.keyboard.press('Escape');
});
