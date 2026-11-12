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
for(const scale of [60,100,150])test(`real clicks, editing, native drag and Shift at ${scale}%`,async({page})=>{
 await seed(page,{text:'AVATAR   To WA more words across rows',w:170,textAlign:'justify'},experimental);await edit(page);await zoom(page,scale);
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
