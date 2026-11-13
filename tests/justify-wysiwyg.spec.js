const {test,expect,openHome,importPayload,records,openLibraryDocument,exportPNG,canvasPoint}=require('./helpers');
const {PNG}=require('pngjs');
const fixture=require('./fixtures/canvas-graph.json');
const surface='#inlineWysiwyg';
test.describe.configure({timeout:60000});
// Exercise the shipped bundle with a deterministic fresh document.
test.use({serviceWorkers:'block'});

async function seed(page,patch={},url='/'){
 await page.setViewportSize({width:1600,height:1100});
 await openHome(page,url);const payload=structuredClone(fixture);payload.documents=[payload.documents[0]];
 const doc=payload.documents[0];doc.groups=[];doc.background='#ffffff';doc.palette=['#ff0000','#000000'];doc.elements=doc.elements.filter(e=>e.id==='title');
 Object.assign(doc.elements[0],{text:'ABCD',x:20,y:40,w:280,h:170,fontFamily:'Arial',fontSize:24,lineHeight:1.2,letterSpacing:0,textColor:'#111111',autoFontSize:false,rotation:0,textAlign:'left',verticalAlign:'top',...patch});
 await importPayload(page,payload);await expect(page.locator('#toast')).toContainText('Импортировано проектов');
 const stored=(await records(page,'docs')).find(d=>d.elements.some(e=>e.id==='title'));await openLibraryDocument(page,stored.id);
 for(let i=0;i<60;i++){const z=parseInt(await page.locator('#zoomLabel').textContent());if(z===100)break;await page.locator(z>100?'#zoomOutBtn':'#zoomInBtn').click()}
 await expect(page.locator('#zoomLabel')).toHaveText('100%');return stored.elements[0];
}
async function edit(page,live=true){
 await page.locator('#layers [data-layer="title"] .layer-name').click();const p=await canvasPoint(page,55,57);await page.mouse.dblclick(p.x,p.y);
 await expect(page.locator(live?surface:'#inlineText')).toBeFocused();await expect(page.locator(live?'#inlineText':surface)).toBeHidden();
}
async function model(page){return page.evaluate(async()=>{
 const click=HTMLAnchorElement.prototype.click;let url;
 HTMLAnchorElement.prototype.click=function(...args){if(this.download?.endsWith('.json'))url=this.href;else return click.apply(this,args)};
 try{document.querySelector('#jsonExportBtn').click();return (await (await fetch(url)).json()).document.elements.find(e=>e.id==='title')}finally{HTMLAnchorElement.prototype.click=click}
})}
async function selection(page){return page.locator(surface).evaluate(host=>{
 const s=getSelection(),offset=(n,i)=>{const r=document.createRange();r.setStart(host,0);r.setEnd(n,i);return r.toString().length};
 return {anchor:offset(s.anchorNode,s.anchorOffset),focus:offset(s.focusNode,s.focusOffset)};
})}
async function select(page,anchor,focus){
 await page.locator(surface).focus();await page.keyboard.press('Control+Home');const text=await page.locator(surface).textContent();
 const count=i=>[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text.slice(0,i))].length;
 for(let i=0;i<count(anchor);i++)await page.keyboard.press('ArrowRight');
 for(let i=0;i<Math.abs(count(anchor)-count(focus));i++)await page.keyboard.press(focus<anchor?'Shift+ArrowLeft':'Shift+ArrowRight');
 expect(await selection(page)).toEqual({anchor,focus});
}
function diff(a,b){let changed=0,above2=0,max=0;for(let i=0;i<a.length;i+=4){const d=Math.max(...[0,1,2,3].map(k=>Math.abs(a[i+k]-b[i+k])));if(d)changed++;if(d>2)above2++;max=Math.max(max,d)}return {changed,above2,max}}
async function parity(page,info,label){
 await info.attach(label+'-editor.png',{body:await page.screenshot(),contentType:'image/png'});
 const live=await page.locator('[data-text-stroke-overlay]').evaluate(ink=>{
  const c=document.createElement('canvas');c.width=320;c.height=240;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,320,240);ctx.drawImage(ink,0,0,320,240);return [...ctx.getImageData(0,0,320,240).data];
 });
 await page.keyboard.press('Control+Enter');await expect(page.locator(surface)).toBeHidden();
 const p=await canvasPoint(page,310,230);await page.mouse.click(p.x,p.y);
 const screen=await page.locator('#canvas').evaluate(c=>[...c.getContext('2d').getImageData(0,0,c.width,c.height).data]);
 const png=await exportPNG(page),result={canvas:diff(screen,png.image.data),wysiwyg:diff(live,png.image.data)};
 await info.attach(label+'.json',{body:JSON.stringify(result),contentType:'application/json'});
 await info.attach(label+'-live.png',{body:PNG.sync.write({width:320,height:240,data:Buffer.from(live)}),contentType:'image/png'});
 await info.attach(label+'-export.png',{body:png.bytes,contentType:'image/png'});
 console.log('Alignment pixel parity',info.project.name,label,JSON.stringify(result));
 expect(result.canvas.max).toBeLessThanOrEqual(1);expect(result.wysiwyg.max).toBeLessThanOrEqual(2);expect(result.wysiwyg.above2).toBe(0);
}

test('baseline real app smoke: one word and source space',async({page})=>{
 await seed(page,{text:'AVATAR   To WA',w:170,textAlign:'justify'});await edit(page,false);
 await page.locator('#inlineText').evaluate(e=>e.setSelectionRange(0,6));
 await page.keyboard.type('WORD');expect((await model(page)).text).toBe('WORD   To WA');
});

test('experimental app smoke: first expanded space and immediate input',async({page})=>{
 await seed(page,{text:'AVATAR   To WA',w:170,textAlign:'justify'},'/?experimentalJustifyWysiwyg=1');await edit(page);
 await page.keyboard.press('Control+Home');
 const point=await page.locator(surface).evaluate(host=>{
  const span=[...host.querySelectorAll('[data-wysiwyg-fragment]')].find(s=>s.textContent===' '),r=span.getBoundingClientRect();
  return {x:r.x+r.width*.4,y:r.y+r.height*.5};
 });
 await page.mouse.click(point.x,point.y);await expect.poll(()=>selection(page)).toEqual({anchor:6,focus:6});
 await page.keyboard.type('X');expect((await model(page)).text).toBe('AVATARX   To WA');
});

const experimental='/?experimentalJustifyWysiwyg=1';
async function zoom(page,value){await page.locator('#zoomLabel').click();const field=page.locator('#zoomInput');await field.fill(String(value));await field.press('Enter');await expect(page.locator('#zoomLabel')).toHaveText(value+'%');await page.locator(surface).focus();}
async function spacePoint(page,fraction=.4){return page.locator(surface).evaluate((host,fraction)=>{
 const span=[...host.querySelectorAll('[data-wysiwyg-fragment]')].find(s=>s.textContent===' '),r=span.getBoundingClientRect();return {x:r.x+r.width*fraction,y:r.y+r.height*.5};
},fraction)}
async function pointAt(page,offset){return page.locator(surface).evaluate((host,offset)=>{
 const walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT);let n,left=offset;
 while(n=walker.nextNode()){if(left<=n.length){const r=document.createRange();r.setStart(n,left);r.collapse(true);const b=r.getBoundingClientRect();return {x:b.x,y:b.y+b.height*.5}}left-=n.length}
},offset)}
for(const opened of ['justify','left'])for(const scale of [60,100,150])test(`real clicks, editing, native drag and Shift at ${scale}% opened ${opened}`,async({page})=>{
 await seed(page,{text:'AVATAR   To WA more words across rows',w:170,textAlign:opened},experimental);await edit(page);if(opened==='left')await alignmentButton(page,'justify').click();await zoom(page,scale);
 const original=await model(page);
 for(const [key,text,caret] of [['X','AVATARX   To WA more words across rows',7],['Backspace','AVATA   To WA more words across rows',5],['Delete','AVATAR  To WA more words across rows',6]]){
  const p=await spacePoint(page);await page.mouse.click(p.x,p.y);
  // No settled-selection wait: actual input competes with the post-click task.
  await page.keyboard.press(key);expect((await model(page)).text).toBe(text);expect(await selection(page)).toEqual({anchor:caret,focus:caret});
  await page.keyboard.press('Control+z');expect(await model(page)).toEqual(original);
 }
 // Re-enter by a real space click while the inspector owns focus.
 await page.locator('#inspector [data-key=w]').click();const reentry=await spacePoint(page);await page.mouse.click(reentry.x,reentry.y);await page.keyboard.type('X');
 expect((await model(page)).text).toBe('AVATARX   To WA more words across rows');await page.keyboard.press('Control+z');
 const start=await pointAt(page,0),end=await pointAt(page,21);
 await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:15});await page.mouse.up();
 expect(await selection(page)).toEqual({anchor:0,focus:21});
 await select(page,21,21);const anchor=await page.locator(surface).evaluate(()=>{window.justifyAnchor={node:getSelection().anchorNode,offset:getSelection().anchorOffset};return true});expect(anchor).toBe(true);
 const p=await spacePoint(page);await page.keyboard.down('Shift');await page.mouse.click(p.x,p.y);await page.keyboard.up('Shift');
 await expect.poll(()=>selection(page)).toEqual({anchor:21,focus:6});
 expect(await page.evaluate(()=>getSelection().anchorNode===window.justifyAnchor.node&&getSelection().anchorOffset===window.justifyAnchor.offset)).toBe(true);
 expect(await model(page)).toEqual(original);
});

test('real word formatting, inspector focus, reprojection, history and saved document',async({page})=>{
 await seed(page,{text:'AVATAR   To WA more words across rows',w:170,textAlign:'justify'},experimental);await edit(page);
 const p=await pointAt(page,3);await page.mouse.dblclick(p.x,p.y);expect(await selection(page)).toEqual({anchor:0,focus:6});
 await page.locator('#inspector [data-fill-open=fill]').click();await expect(page.locator(surface)).toBeFocused();
 await page.locator('#fillPopover [data-fill-palette="#ff0000"]').click();
 expect((await model(page)).textRuns).toEqual([{start:0,end:6,style:{textColor:'#ff0000'}}]);
 expect(await page.locator(surface).evaluate(h=>getComputedStyle(h.querySelector('[data-wysiwyg-fragment]')).color)).toBe('rgb(255, 0, 0)');
 await page.locator('#fillPopover [data-fill-close]').click();
 await page.locator('#inspector [data-text-decoration=underline]').click();
 const formatted=await model(page);expect(formatted.textRuns).toEqual([{start:0,end:6,style:{textColor:'#ff0000',underline:true}}]);expect(formatted.textColor).toBe('#111111');expect(formatted.underline).toBeFalsy();
 expect(await page.locator(surface+' [data-wysiwyg-row]').first().evaluate(e=>e.style.backgroundImage)).toContain('linear-gradient');
 await page.keyboard.press('Control+z');expect((await model(page)).textRuns).toEqual([{start:0,end:6,style:{textColor:'#ff0000'}}]);
 await page.keyboard.press('Control+Shift+z');expect(await model(page)).toEqual(formatted);
 // A numeric field owns focus through live reprojection, retaining the range.
 const width=page.locator('#inspector [data-key=w]');await width.fill('180');await width.press('Enter');await expect(page.locator(surface)).toBeFocused();expect(await selection(page)).toEqual({anchor:0,focus:6});
 const changed=await model(page);expect(changed.w).toBe(180);expect(changed.textRuns).toEqual(formatted.textRuns);
 await page.keyboard.press('Control+Enter');
 await expect.poll(async()=>{const docs=await records(page,'docs');return docs.find(d=>d.elements.some(e=>e.id==='title')).elements.find(e=>e.id==='title')}).toEqual(changed);
 await page.reload();const docs=await records(page,'docs'),stored=docs.find(d=>d.elements.some(e=>e.id==='title'));await openLibraryDocument(page,stored.id);await edit(page);expect(await model(page)).toEqual(changed);
});

for(const url of ['/',experimental+'&experimentalTextWysiwyg=0'])test(`safe textarea range formatting ${url}`,async({page})=>{
 await seed(page,{text:'AVATAR   To WA',w:170,textAlign:'justify'},url);await edit(page,false);const before=await model(page);
 await page.locator('#inlineText').evaluate(e=>e.setSelectionRange(0,6));
 await page.locator('#inspector [data-text-decoration=underline]').click();await expect(page.locator('#toast')).toContainText('Форматирование выделения justify');expect(await model(page)).toEqual(before);
 await page.locator('#inspector [data-fill-open=fill]').click();await page.locator('#fillPopover [data-fill-palette="#ff0000"]').click();expect(await model(page)).toEqual(before);
 await page.locator('#fillPopover [data-fill-close]').click();await page.locator('#inlineText').focus();await page.locator('#inlineText').evaluate(e=>e.setSelectionRange(0,0));
 await page.locator('#inspector [data-text-decoration=underline]').click();expect((await model(page)).underline).toBe(true);
});

for(const textAlign of ['left','center','right'])test(`experimental flag retains native ${textAlign}`,async({page})=>{
 await seed(page,{text:'AVATAR   To WA',w:170,textAlign},experimental);await edit(page);await select(page,0,6);await page.keyboard.type('X');expect((await model(page)).text).toBe('X   To WA');await page.keyboard.press('Control+z');expect((await model(page)).text).toBe('AVATAR   To WA');
});

test('justify Canvas/PNG and live ink keep strict pixel tolerances',async({page},info)=>{
 await seed(page,{text:'AVATAR   To WA more words',w:170,textAlign:'justify',strokeWidth:2,stroke:'#cc2244',strokeOpacity:60,fillOpacity:75,underline:true,textRuns:[{start:9,end:11,style:{textColor:'#ff0000',strikethrough:true}}]},experimental);await edit(page);await parity(page,info,'justify');
});

// Hold only the adapter's post-click task and Selectionchange notification.
// Real mouse/keyboard events still pass through the shipping application.
async function holdCorrection(page){await page.addInitScript(()=>{
 const schedule=window.setTimeout;window.pendingJustify=[];window.holdJustify=false;
 window.setTimeout=function(fn,...args){if(window.holdJustify&&/pointerGesture\s*===\s*p/.test(String(fn))){window.pendingJustify.push(fn);return -1}return schedule.call(this,fn,...args)};
 document.addEventListener('selectionchange',e=>{if(window.holdJustify)e.stopImmediatePropagation()},true);
 window.releaseJustify=()=>{window.holdJustify=false;for(const fn of window.pendingJustify.splice(0))fn()};
})}
test('post-click input guard and stale callbacks across inspector, zoom and close',async({page})=>{
 await holdCorrection(page);await seed(page,{text:'AVATAR   To WA more words',w:170,textAlign:'justify'},experimental);await edit(page);
 await page.evaluate(()=>window.holdJustify=true);let p=await spacePoint(page);await page.mouse.click(p.x,p.y);expect(await page.evaluate(()=>window.pendingJustify.length)).toBeGreaterThan(0);await page.keyboard.type('X');
 expect((await model(page)).text).toBe('AVATARX   To WA more words');await page.evaluate(()=>window.releaseJustify());await page.keyboard.press('Control+z');
 for(const action of ['inspector','zoom','close']){
  await page.locator(surface).focus();await select(page,0,0);await page.evaluate(()=>window.holdJustify=true);p=await spacePoint(page);await page.mouse.click(p.x,p.y);
  if(action==='inspector')await page.locator('#inspector [data-key=w]').click();
  if(action==='zoom'){await page.locator('#zoomLabel').click();await page.locator('#zoomInput').fill('150');await page.locator('#zoomInput').press('Enter')}
  if(action==='close')await page.keyboard.press('Control+Enter');
  const before=await page.evaluate(()=>({active:document.activeElement.id,selection:getSelection().toString()}));
  await page.evaluate(()=>window.releaseJustify());expect(await page.evaluate(()=>({active:document.activeElement.id,selection:getSelection().toString()}))).toEqual(before);
 }
 await expect(page.locator(surface)).toBeHidden();expect((await model(page)).text).toBe('AVATAR   To WA more words');
});

for(const [name,patch] of [['rotation',{rotation:10}],['mask',{mask:true}],['effect',{effects:[{type:'blur',enabled:true}]}],['vertical',{textMode:'vertical'}]])test(`experimental justify retains ${name} fallback`,async({page})=>{await seed(page,{text:'AVATAR   To WA',w:170,textAlign:'justify',...patch},experimental);await edit(page,false)});

for(const cancellation of ['pointercancel','transform','composition'])test(`pending click invalidation: ${cancellation}`,async({page})=>{
 await holdCorrection(page);await seed(page,{text:'AVATAR   To WA more words',w:170,textAlign:'justify'},experimental);await edit(page);
 await page.evaluate(()=>window.holdJustify=true);const p=await spacePoint(page);await page.mouse.click(p.x,p.y);
 expect(await page.evaluate(()=>window.pendingJustify.length)).toBeGreaterThan(0);
 await page.locator(surface).evaluate((host,cancellation)=>{
  // Fault injection only; this does not claim real OS IME qualification.
  if(cancellation==='pointercancel')host.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true}));
  if(cancellation==='composition')host.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
  if(cancellation==='transform')host.style.transform+=' translateX(10px)';
  const node=host.querySelector('[data-wysiwyg-fragment]').firstChild;getSelection().setBaseAndExtent(node,0,node,0);
 },cancellation);
 await page.evaluate(()=>window.releaseJustify());expect(await selection(page)).toEqual({anchor:0,focus:0});expect((await model(page)).text).toBe('AVATAR   To WA more words');
});

test('experimental justify keeps mobile textarea',async({page})=>{
 await seed(page,{text:'AVATAR   To WA',w:170,textAlign:'justify'},experimental);await page.setViewportSize({width:700,height:900});
 const p=await canvasPoint(page,55,57);await page.mouse.dblclick(p.x,p.y);await expect(page.locator('#inlineText')).toBeVisible();await expect(page.locator(surface)).toBeHidden();
});

// Stage 2B.2 gate: the adapter must also exist in sessions opened as left.
test('late justify activation: first space and immediate input',async({page})=>{
 await seed(page,{text:'AVATAR   To WA more words across rows',w:170,textAlign:'left'},experimental);await edit(page);
 await select(page,0,6);
 await page.locator(surface).evaluate(host=>window.originalJustifyHost=host);
 for(const value of ['justify','left','justify']){
  await page.locator(`#inspector [data-align=${value}]`).last().click();
  await expect(page.locator(surface)).toBeFocused();
  expect(await selection(page)).toEqual({anchor:0,focus:6});
  expect((await model(page)).textAlign).toBe(value);
 }
 expect(await page.locator(surface).evaluate(host=>host===window.originalJustifyHost)).toBe(true);
 const p=await spacePoint(page);await page.mouse.click(p.x,p.y);await page.keyboard.type('X');
 expect((await model(page)).text).toBe('AVATARX   To WA more words across rows');
 expect(await selection(page)).toEqual({anchor:7,focus:7});
});

const alignmentButton=(page,value)=>page.locator(`#inspector [data-align-scope=text] [data-align=${value==='center'?'hcenter':value}]`);
for(const verticalAlign of ['top','middle','bottom'])test(`four live alignments, history and LF rows: ${verticalAlign}`,async({page})=>{
 await seed(page,{text:'AVATAR   To WA more words\nA😀 é 👩‍💻 end',w:170,verticalAlign,textRuns:[{start:9,end:11,style:{textColor:'#ff0000'}}]},experimental);await edit(page);
 const host=await page.locator(surface).elementHandle();let previous=await model(page);
 await select(page,21,9);
 for(const value of ['justify','left','center','justify','right','center','justify']){
  const button=alignmentButton(page,value);await expect(button).toHaveAttribute('aria-label',/.+/);await button.click();
  await expect(button).toHaveAttribute('aria-pressed','true');await expect(page.locator(surface)).toBeFocused();
  expect(await selection(page)).toEqual({anchor:21,focus:9});const changed=await model(page);expect(changed).toEqual({...previous,textAlign:value});
  expect(await host.evaluate(h=>h===document.querySelector('#inlineWysiwyg'))).toBe(true);
  await page.keyboard.press('Control+z');expect(await model(page)).toEqual(previous);expect(await selection(page)).toEqual({anchor:21,focus:9});
  await page.keyboard.press('Control+Shift+z');expect(await model(page)).toEqual(changed);previous=changed;
 }
 // Last paragraph rows (including the row before LF) have no expanded spaces.
 expect(await page.locator(surface).evaluate(h=>[...h.querySelectorAll('[data-wysiwyg-row]')].filter(r=>r.textContent.endsWith('\n')||r===h.querySelector('[data-wysiwyg-row]:last-child')).every(r=>[...r.querySelectorAll('[data-wysiwyg-fragment]')].every(s=>!s.style.wordSpacing)))).toBe(true);
 await page.keyboard.press('Control+Enter');
 await expect.poll(async()=>(await records(page,'docs')).find(d=>d.elements.some(e=>e.id==='title')).elements.find(e=>e.id==='title')).toEqual(previous);
 await page.reload();const stored=(await records(page,'docs')).find(d=>d.elements.some(e=>e.id==='title'));await openLibraryDocument(page,stored.id);await edit(page);expect(await model(page)).toEqual(previous);
});

test('justify button keyboard activation and ordinary live session fallback',async({page})=>{
 await seed(page,{text:'AVATAR   To WA',w:170});await edit(page);await select(page,0,6);
 await page.keyboard.type('EDITED');await select(page,6,0);const before=await model(page);
 const button=alignmentButton(page,'justify');await button.focus();await button.press('Space');
 await expect(page.locator(surface)).toBeHidden();await expect(page.locator('#inlineText')).toBeVisible();
 expect(await model(page)).toEqual({...before,textAlign:'justify'});
 expect(await page.locator('#inlineText').evaluate(e=>({start:e.selectionStart,end:e.selectionEnd,direction:e.selectionDirection}))).toEqual({start:0,end:6,direction:'backward'});
 await page.keyboard.press('Control+z');expect(await model(page)).toEqual(before);
 await page.keyboard.press('Control+Shift+z');expect((await model(page)).textAlign).toBe('justify');
 await page.keyboard.press('Control+Enter');await edit(page,false);
});

test('typography multi-select alignment changes no frame coordinates',async({page})=>{
 await seed(page,{text:'AVATAR   To WA',w:170},experimental);
 await page.locator('#layers [data-layer=title] .layer-name').click();
 await page.locator('#inspector [data-action=duplicate]').click();
 await page.locator('#layers [data-layer=title] .layer-name').click({modifiers:['Control']});
 await expect(page.locator('#inspector .ins-object-title')).toContainText('2 слоя');
 const exportLayers=()=>page.evaluate(async()=>{const click=HTMLAnchorElement.prototype.click;let url;HTMLAnchorElement.prototype.click=function(...args){if(this.download?.endsWith('.json'))url=this.href;else return click.apply(this,args)};try{document.querySelector('#jsonExportBtn').click();return (await(await fetch(url)).json()).document.elements}finally{HTMLAnchorElement.prototype.click=click}});
 const before=await exportLayers();
 expect(await page.locator('#inspector [data-align-scope=all] [data-align=justify]').count()).toBe(0);
 for(const value of ['justify','center','right','left']){await alignmentButton(page,value).click();expect(await exportLayers()).toEqual(before.map(e=>({...e,textAlign:value})));await expect(alignmentButton(page,value)).toHaveAttribute('aria-pressed','true')}
});

test('alignment invalidates held post-click work from a session opened left',async({page})=>{
 await holdCorrection(page);await seed(page,{text:'AVATAR   To WA more words',w:170},experimental);await edit(page);
 await alignmentButton(page,'justify').click();await page.evaluate(()=>window.holdJustify=true);
 const p=await spacePoint(page);await page.mouse.click(p.x,p.y);expect(await page.evaluate(()=>window.pendingJustify.length)).toBeGreaterThan(0);
 await alignmentButton(page,'left').click();await select(page,9,11);
 await page.evaluate(()=>window.releaseJustify());expect(await selection(page)).toEqual({anchor:9,focus:11});
 await alignmentButton(page,'justify').click();const next=await spacePoint(page);await page.mouse.click(next.x,next.y);await page.keyboard.type('X');expect((await model(page)).text).toBe('AVATARX   To WA more words');
});

async function rangeOperation(page,key,value){
 if(key==='fontFamily'){
  await page.locator('#inspector [data-font-open]').click();await page.locator(`#inspector [data-font-option="${value}"]`).click();
 }else if(key==='fontVariant'||key==='strokeStyle'){
  await page.locator(`#inspector [data-key=${key}]`).selectOption(value);
 }else if(['underline','strikethrough'].includes(key)){
  await page.locator(`#inspector [data-text-decoration=${key}]`).click();
 }else if(['textColor','stroke','fillOpacity','strokeOpacity'].includes(key)){
  await page.locator(`#inspector [data-fill-open=${key==='stroke'||key==='strokeOpacity'?'stroke':'fill'}]`).click();
  const input=page.locator(key.endsWith('Opacity')?'#cpAlphaInput':'#fillPopover [data-cp-part="0"]');
  // Three previews must still produce just one confirmed history operation.
  for(const v of key.endsWith('Opacity')?[90,80,value]:['#224466','#336699',value]){await input.fill(String(v));await expect(input).toBeFocused()}
  await input.press('Tab');await page.locator('#fillPopover [data-fill-close]').click();
 }else{
  const input=page.locator(`#inspector [data-key=${key}]`);
  for(const v of [Number(value)+1,Number(value)+2,value]){await input.fill(String(v));await expect(input).toBeFocused()}
  await input.press('Tab');
 }
 await expect(page.locator(surface)).toBeVisible();await expect(page.locator('#inlineText')).toBeHidden();await expect(page.locator('#wysiwygRecovery')).toBeHidden();
}
const rawStyle=(e,i)=>({...e.textRuns?.find(r=>r.start<=i&&r.end>i)?.style});
const effective=(e,i,key)=>rawStyle(e,i)[key]??e[key]??({fontWeight:'400',fontStyle:'normal',fillOpacity:100,strokeOpacity:100,strokeStyle:'solid',underline:false,strikethrough:false}[key]);
async function assertRangeChange(page,before,after,start,end,patch){
 expect(after.text).toBe(before.text);expect(await page.locator(surface).textContent()).toBe(before.text);
 for(let i=0;i<before.text.length;i++){
  if(i<start||i>=end){expect(rawStyle(after,i)).toEqual(rawStyle(before,i));for(const key of Object.keys(patch))expect(effective(after,i,key)).toBe(effective(before,i,key));}
  else for(const [key,value] of Object.entries(patch))expect(effective(after,i,key)).toBe(value);
 }
 // Every projected fragment must expose the corresponding effective font/color;
 // native DOM text and source offsets include LF, surrogate pairs and ZWJ.
 const fragments=await page.locator(surface).evaluate(h=>{let offset=0;return [...h.querySelectorAll('[data-wysiwyg-fragment]')].map(s=>{const start=offset;offset+=s.textContent.length;const c=getComputedStyle(s);return {start,end:offset,family:c.fontFamily,weight:c.fontWeight,style:c.fontStyle,size:parseFloat(c.fontSize),spacing:parseFloat(c.letterSpacing)||0,color:s.style.color}})});
 for(const f of fragments.filter(f=>f.start<end&&f.end>start)){
  if(patch.fontFamily)expect(f.family).toContain(patch.fontFamily);
  if(patch.fontWeight)expect(f.weight).toBe(patch.fontWeight);
  if(patch.fontStyle)expect(f.style).toBe(patch.fontStyle);
  if(patch.fontSize)expect(f.size).toBeCloseTo(patch.fontSize*after.fontSize/(after.textRunsBaseFontSize||after.fontSize),3);
  if(patch.letterSpacing)expect(f.spacing).toBe(patch.letterSpacing);
  if(patch.textColor)expect(f.color).toBe('rgb(204, 34, 68)');
 }
 expect(await page.locator('[data-text-stroke-overlay]').evaluate(c=>getComputedStyle(c).display)).toBe('block');
}
const styleGroups={
 font:[['fontFamily','Georgia',{fontFamily:'Georgia'}],['fontVariant','700:normal',{fontWeight:'700'}],['fontVariant','700:italic',{fontWeight:'700',fontStyle:'italic'}]],
 metrics:[['fontSize',28,{fontSize:28}],['letterSpacing',1,{letterSpacing:1}],['lineHeight',1.6,{lineHeight:1.6}]],
 fill:[['textColor','#cc2244',{textColor:'#cc2244'}],['fillOpacity',55,{fillOpacity:55}]],
 stroke:[['stroke','#cc2244',{stroke:'#cc2244'}],['strokeWidth',3,{strokeWidth:3}],['strokeOpacity',45,{strokeOpacity:45}],...['dashed','dotted','solid'].map(v=>['strokeStyle',v,{strokeStyle:v}])],
 decorations:[['underline',true,{underline:true}],['strikethrough',true,{strikethrough:true}]]
};
for(const [group,operations] of Object.entries(styleGroups))test(`justify full range styles: ${group}`,async({page},info)=>{
 test.setTimeout(120000);
 await seed(page,{text:'AVATAR   To WA more words\nlast line',w:170,textAlign:'justify',strokeWidth:1,stroke:'#111111',textRuns:[{start:0,end:2,style:{textColor:'#ff0000'}},{start:10,end:11,style:{letterSpacing:.5}}]},experimental);await edit(page);
 await select(page,11,9);
 for(const [key,value,patch] of operations){
  const before=await model(page),inkBefore=await page.locator('[data-text-stroke-overlay]').evaluate(c=>c.toDataURL());await rangeOperation(page,key,value);const changed=await model(page);
  expect(await page.locator('[data-text-stroke-overlay]').evaluate(c=>c.toDataURL())).not.toBe(inkBefore);
  await assertRangeChange(page,before,changed,9,11,patch);
  await page.locator(surface).focus();expect(await selection(page)).toEqual({anchor:11,focus:9});
  await page.keyboard.press('Control+z');expect(await model(page)).toEqual(before);
  await page.keyboard.press('Control+Shift+z');expect(await model(page)).toEqual(changed);
 }
 await parity(page,info,'range-'+group);
});

for(const autoFontSize of [false,true])test(`justify range font size, cancellation and Mixed auto=${autoFontSize}`,async({page},info)=>{
 await seed(page,{text:'AVATAR   To WA more words',w:170,textAlign:'justify',autoFontSize,strokeWidth:1,textRuns:[{start:0,end:6,style:{fontFamily:'Georgia'}}]},experimental);await edit(page);
 const original=await model(page);await select(page,0,11);await expect(page.locator('#inspector [data-font-current]')).toHaveText('Mixed');
 await select(page,11,9);await rangeOperation(page,'fontSize',28);const changed=await model(page);
 expect(changed.autoFontSize).toBe(false);await expect(page.locator('#inspector [data-text-auto-font]')).not.toBeChecked();
 expect(effective(changed,9,'fontSize')*changed.fontSize/(changed.textRunsBaseFontSize||changed.fontSize)).toBeCloseTo(28,3);
 await page.locator(surface).focus();await page.keyboard.press('Control+z');expect(await model(page)).toEqual(original);await page.keyboard.press('Control+Shift+z');expect(await model(page)).toEqual(changed);
 // Repeated changes of the same property remain independent confirmed actions.
 await rangeOperation(page,'fontSize',30);await page.locator(surface).focus();await page.keyboard.press('Control+z');expect(await model(page)).toEqual(changed);
 await page.keyboard.press('Escape');expect(await model(page)).toEqual(original);await edit(page);await select(page,0,0);
 const before=await model(page);await rangeOperation(page,'strokeWidth',4);await expect(page.locator('#toast')).toContainText('Выделите фрагмент');expect(await model(page)).toEqual(before);
 await rangeOperation(page,'fontSize',26);expect((await model(page)).fontSize).toBe(26);expect((await model(page)).autoFontSize).toBe(false);
 await parity(page,info,'auto-'+autoFontSize);
});

for(const kind of ['spaces','unicode cross rows'])test(`justify exact source range: ${kind}`,async({page},info)=>{
 const text='AVATAR   To WA\né 😀 👩‍💻 more words';
 await seed(page,{text,w:170,textAlign:'justify',strokeWidth:1},experimental);await edit(page);
 const start=kind==='spaces'?6:9,end=kind==='spaces'?9:text.indexOf(' more');await select(page,end,start);
 const before=await model(page);await rangeOperation(page,'strikethrough',true);const changed=await model(page);
 expect(changed.textRuns).toEqual([{start,end,style:{strikethrough:true}}]);await assertRangeChange(page,before,changed,start,end,{strikethrough:true});
 await page.locator(surface).focus();expect(await selection(page)).toEqual({anchor:end,focus:start});
 await page.keyboard.press('Control+z');expect(await model(page)).toEqual(before);await page.keyboard.press('Control+Shift+z');expect(await model(page)).toEqual(changed);
 await parity(page,info,kind);
});

test('justify styled JSON export/import preserves the document and editing',async({page,browser})=>{
 await seed(page,{text:'AVATAR   To WA more words',w:170,textAlign:'justify',strokeWidth:1},experimental);await edit(page);await select(page,9,11);
 await rangeOperation(page,'fontVariant','700:italic');await rangeOperation(page,'fillOpacity',60);await alignmentButton(page,'right').click();await alignmentButton(page,'justify').click();
 const changed=await model(page);await page.keyboard.press('Control+Enter');
 const pending=page.waitForEvent('download');await page.locator('#jsonExportBtn').evaluate(el=>el.click());const download=await pending;
 const payload=JSON.parse(require('node:fs').readFileSync(await download.path(),'utf8'));
 const context=await browser.newContext({baseURL:'http://127.0.0.1:4173',viewport:{width:1600,height:1100},acceptDownloads:true,serviceWorkers:'block'});
 try{
  const imported=await context.newPage();await openHome(imported,experimental);await importPayload(imported,payload);await expect(imported.locator('#toast')).toContainText('Документ импортирован');
  const stored=(await records(imported,'docs')).find(d=>d.elements.some(e=>e.text===changed.text));await openLibraryDocument(imported,stored.id);
  const restored=stored.elements.find(e=>e.text===changed.text);expect({...restored,id:changed.id}).toEqual(changed);
  await imported.locator(`#layers [data-layer="${restored.id}"] .layer-name`).click();const p=await canvasPoint(imported,55,57);await imported.mouse.dblclick(p.x,p.y);await expect(imported.locator(surface)).toBeFocused();
  await imported.keyboard.press('Control+End');await imported.keyboard.type('X');await expect(imported.locator(surface)).toHaveText(changed.text+'X');
 }finally{await context.close()}
});

test('late justify keyboard and rapid click regressions',async({page})=>{
 await seed(page,{text:'AVATAR   To WA more words across rows',w:170},experimental);await edit(page);await alignmentButton(page,'justify').click();const original=await model(page);
 await select(page,6,6);await page.keyboard.press('ArrowRight');expect(await selection(page)).toEqual({anchor:7,focus:7});await page.keyboard.press('ArrowLeft');expect(await selection(page)).toEqual({anchor:6,focus:6});
 await page.keyboard.press('Home');expect(await selection(page)).toEqual({anchor:0,focus:0});await page.keyboard.press('End');const end=await selection(page);expect(end.focus).toBeGreaterThan(6);expect(end.focus).toBeLessThan(original.text.length);
 await select(page,0,0);await page.keyboard.press('ArrowDown');const down=await selection(page);expect(down.focus).toBeGreaterThan(0);await page.keyboard.press('ArrowUp');expect(await selection(page)).toEqual({anchor:0,focus:0});
 await select(page,6,6);await page.keyboard.press('Enter');expect((await model(page)).text).toBe('AVATAR\n   To WA more words across rows');await page.keyboard.press('Control+z');expect(await model(page)).toEqual(original);
 for(const fraction of [.8,.4,.8,.4]){const p=await spacePoint(page,fraction);await page.mouse.click(p.x,p.y)}
 await page.keyboard.type('X');expect((await model(page)).text).toBe('AVATARX   To WA more words across rows');
});
