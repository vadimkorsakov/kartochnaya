const {test,expect,openHome,importPayload,records,openLibraryDocument,canvasPoint,exportPNG}=require('./helpers');
const {model}=require('./support/text-interaction');
const {PNG}=require('pngjs');
const fixture=require('./fixtures/visual-text.json');
const host='#inlineWysiwyg';
const text='Привет мир. Длинный русский текст с автоматическими переносами строк и выделением отдельных слов. Здесь подчёркивание и зачёркивание работают вместе.\nЭмодзи 😀 и новая строка сохраняют границы UTF-16.';
const button=(page,key)=>page.locator(`#inspector [data-text-decoration=${key}]`);
async function setup(page,patch={},mobile=false){
 await page.addInitScript(()=>{
  window.glyphs=[];window.lines=[];window.exportLines=[];
  const p=CanvasRenderingContext2D.prototype,fill=p.fillText,rect=p.fillRect,clear=p.clearRect;
  p.clearRect=function(...args){if(this.canvas.id==='canvas'){window.glyphs=[];window.lines=[]}return clear.apply(this,args)};
  p.fillText=function(text,x,y,...args){if(this.canvas.id==='canvas')window.glyphs.push({text,x,y,font:this.font,color:this.fillStyle});return fill.call(this,text,x,y,...args)};
  p.fillRect=function(x,y,width,height){
   if(height>0&&height<10&&width>0){const r={x,y,width,height,color:this.fillStyle};if(this.canvas.id==='canvas')window.lines.push(r);else if(window.captureExport)window.exportLines.push(r)}
   return rect.call(this,x,y,width,height);
  };
 });
 await openHome(page);const payload=structuredClone(fixture);
 Object.assign(payload.document,{width:640,height:480});
 Object.assign(payload.document.elements[0],{id:'decorations',name:'Decorations',x:24,y:20,w:592,h:440,fontFamily:'Arial',fontSize:32,lineHeight:1.25,text,textColor:'#000000',fill:'#000000',fillType:'solid',autoFontSize:false,...patch});
 await importPayload(page,payload);const doc=(await records(page,'docs')).find(d=>d.title==='Visual fixed font (импорт)');await openLibraryDocument(page,doc.id);
 if(mobile){await page.locator('[data-mobile=layers]:visible').click();await page.locator('#mobileLayerList .layer-name').filter({hasText:'Decorations'}).click();await page.locator('#mobileLayersClose').click();await page.locator('#mobileContext [data-mobile=edit]').click();await expect(page.locator('#inlineText')).toBeFocused()}
 else await reopen(page);
 return doc.id;
}
async function reopen(page){
 await page.locator('#fitBtn').click();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const p=await canvasPoint(page,60,40,640,480);await page.mouse.dblclick(p.x,p.y);
 await expect(page.locator(host)).toBeFocused();await expect(page.locator('#inlineText')).toBeHidden();await expect(page.locator('#wysiwygRecovery')).toBeHidden();
}
async function selection(page){return page.locator(host).evaluate(el=>{
 const s=getSelection(),offset=(node,n)=>{const r=document.createRange();r.setStart(el,0);r.setEnd(node,n);return r.toString().length};return {anchor:offset(s.anchorNode,s.anchorOffset),focus:offset(s.focusNode,s.focusOffset)};
})}
// Native Selection in real source text nodes; no app/test hook or fake metrics.
async function select(page,anchor,focus){await page.locator(host).evaluate((el,{anchor,focus})=>{
 el.focus();const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),nodes=[];let n,offset=0;
 while(n=walker.nextNode()){nodes.push({n,start:offset,end:offset+n.length});offset+=n.length}
 const point=i=>{const p=nodes.find(p=>i>=p.start&&i<=p.end);return [p.n,i-p.start]};getSelection().setBaseAndExtent(...point(anchor),...point(focus));
 },{anchor,focus});await expect.poll(()=>selection(page)).toEqual({anchor,focus});
}
async function geometry(page){return page.locator(host).evaluate(el=>[...el.querySelectorAll('[data-wysiwyg-fragment]')].map(p=>({text:p.textContent,style:p.getAttribute('style'),row:p.parentElement.style.top})));}
async function lines(page){return page.locator(host).evaluate(el=>[...el.querySelectorAll('[data-wysiwyg-row]')].flatMap(row=>{
 if(!row.style.backgroundImage)return [];
 const split=s=>s.split(/,(?![^()]*\))/).map(s=>s.trim());
 const positions=split(row.style.backgroundPosition),sizes=split(row.style.backgroundSize),colors=[...row.style.backgroundImage.matchAll(/linear-gradient\((rgb\([^)]+\)|#[0-9a-f]+)/gi)].map(m=>m[1]);
 return positions.map((p,i)=>{const [x,y]=p.split(' ').map(parseFloat),[width,height]=sizes[i].split(' ').map(parseFloat);const c=colors[i];const canvas=document.createElement('canvas').getContext('2d');canvas.fillStyle=c;return {x,y:y+parseFloat(row.style.top),width,height,color:canvas.fillStyle}});
 }));}
async function close(page){await page.locator(host).focus();await page.keyboard.press('Control+Enter');await expect(page.locator(host)).toBeHidden();}

for(const auto of [false,true])test(`U/S native selection, mixed, history, persistence and geometry auto=${auto}`,async({page},info)=>{
 test.setTimeout(60000);
 const id=await setup(page,{autoFontSize:auto});const original=await model(page),before=await geometry(page);
 // User keyboard selection (including backward direction), then real toolbar clicks.
 await page.keyboard.press('Control+Home');for(let i=0;i<6;i++)await page.keyboard.press('Shift+ArrowRight');
 expect(await selection(page)).toEqual({anchor:0,focus:6});
 await button(page,'underline').click();await expect(page.locator(host)).toBeFocused();expect(await selection(page)).toEqual({anchor:0,focus:6});
 expect((await model(page)).textRuns).toEqual([{start:0,end:6,style:{underline:true}}]);
 await expect(button(page,'underline')).toHaveAttribute('aria-pressed','true');
 expect(await geometry(page)).toEqual(before);
 // Several soft wraps; both decorations overlap only on part of the range.
 await select(page,6,110);await expect(button(page,'underline')).toHaveAttribute('aria-pressed','false');await button(page,'underline').click();
 await select(page,75,20);await button(page,'strikethrough').click();expect(await selection(page)).toEqual({anchor:75,focus:20});
 await expect(button(page,'strikethrough')).toHaveAttribute('aria-pressed','true');
 await button(page,'underline').click();await expect(button(page,'underline')).toHaveAttribute('aria-pressed','false');await expect(button(page,'strikethrough')).toHaveAttribute('aria-pressed','true');
 expect(await geometry(page)).toEqual(before);
 await select(page,0,75);await expect(button(page,'underline')).toHaveAttribute('aria-pressed','mixed');await expect(button(page,'underline')).toContainText('Mixed');
 await button(page,'underline').click();await expect(button(page,'underline')).toHaveAttribute('aria-pressed','true');
 const decorated=await model(page);expect(decorated.autoFontSize).toBe(auto);expect(decorated.fontSize).toBe(original.fontSize);
 await page.keyboard.press('Control+z');await expect(button(page,'underline')).toHaveAttribute('aria-pressed','mixed');
 await page.keyboard.press('Control+Shift+z');expect(await model(page)).toEqual(decorated);
 await page.keyboard.press('Escape');expect(await model(page)).toEqual(original);await expect(page.locator(host)).toBeHidden();
 await reopen(page);await select(page,0,110);await button(page,'underline').click();
 // LF and surrogate pair are retained, with both flags on the complete emoji.
 const emoji=text.indexOf('😀');await select(page,emoji,emoji+2);await button(page,'strikethrough').click();
 const saved=await model(page);expect(saved.text).toBe(text);expect(await page.locator(host).textContent()).toBe(text);
 await expect(page.locator('#wysiwygRecovery')).toBeHidden();await close(page);
 await page.locator('#undoBtn').click();expect((await model(page)).textRuns).toEqual([{start:0,end:110,style:{underline:true}}]);
 await page.locator('#undoBtn').click();expect((await model(page)).textRuns).toBeUndefined();
 await page.locator('#redoBtn').click();await page.locator('#redoBtn').click();expect(await model(page)).toEqual(saved);
 await expect.poll(async()=>(await records(page,'docs')).find(d=>d.id===id)?.elements[0].textRuns).toEqual(saved.textRuns);
 await page.reload();await openLibraryDocument(page,id);await reopen(page);expect(await model(page)).toEqual(saved);
 await info.attach('decorated-editor.png',{body:await page.locator(host).screenshot(),contentType:'image/png'});
});

test('shared DOM/Canvas/real PNG lines: range color/size, wraps, legacy inheritance and explicit false',async({page},info)=>{
 await setup(page,{mobileUnderline:true,mobileStrike:true,textRuns:[
  {start:0,end:6,style:{underline:false,strikethrough:false}},
  {start:7,end:55,style:{textColor:'#cc2244',fontSize:38, strikethrough:false}},
 ]});
 const old=await model(page),before=await geometry(page);
 await select(page,0,6);await expect(button(page,'underline')).toHaveAttribute('aria-pressed','false');await button(page,'underline').click();
 await button(page,'underline').click();expect(await geometry(page)).toEqual(before);
 expect((await model(page)).mobileUnderline).toBe(true);expect((await model(page)).mobileStrike).toBe(true);
 const dom=await lines(page);expect(dom.length).toBeGreaterThan(5);expect(dom.some(r=>r.color==='#cc2244'&&r.height===2)).toBe(true);
 expect(await page.locator(host).textContent()).toBe(text);expect(await page.locator(host).locator('[contenteditable=false]').count()).toBe(0);
 // Remove selection highlight and sample real DOM raster at decoration centers.
 await select(page,text.length,text.length);
 const shot=await page.locator(host).screenshot();await info.attach('live-decoration-lines.png',{body:shot,contentType:'image/png'});const screenshot=PNG.sync.read(shot);
 const domWidth=await page.locator(host).evaluate(el=>el.getBoundingClientRect().width),scale=domWidth/old.w;
 const pixelNear=(image,x,y,color)=>{const rgb=color.match(/../g).map(s=>parseInt(s,16));for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=Math.round(x)+dx,yy=Math.round(y)+dy;if(xx<0||yy<0||xx>=image.width||yy>=image.height)continue;const p=(yy*image.width+xx)*4;if(rgb.every((v,k)=>Math.abs(image.data[p+k]-v)<50))return true}return false};
 for(const r of dom.filter(r=>r.color==='#cc2244'&&r.width>10))expect(pixelNear(screenshot,(r.x+r.width/2)*scale,(r.y+r.height/2)*scale,r.color.slice(1)),JSON.stringify({r,scale,size:[screenshot.width,screenshot.height]})).toBe(true);
 await close(page);const canvas=await page.evaluate(()=>window.lines);expect(canvas.length).toBe(dom.length);
 for(let i=0;i<dom.length;i++){expect(canvas[i].color).toBe(dom[i].color);for(const key of ['x','y','width','height'])expect(Math.abs(canvas[i][key]-dom[i][key]),`${key} line ${i}`).toBeLessThan(.001)}
 await page.evaluate(()=>{window.captureExport=true;window.exportLines=[]});const png=await exportPNG(page,640,480);await page.evaluate(()=>window.captureExport=false);
 expect(await page.evaluate(()=>window.exportLines)).toEqual(canvas);
 for(const r of canvas.filter(r=>r.color==='#cc2244'&&r.width>10))expect(pixelNear(png.image,old.x+r.x+r.width/2,old.y+r.y+r.height/2,r.color.slice(1))).toBe(true);
 await info.attach('decorations.png',{body:png.bytes,contentType:'image/png'});await info.attach('line-geometry.json',{body:JSON.stringify({dom,canvas}),contentType:'application/json'});
});

test('keyboard toolbar activation retains saved backward Selection',async({page})=>{
 await setup(page);await select(page,6,0);await button(page,'underline').focus();await page.keyboard.press('Space');
 await expect(button(page,'underline')).toHaveAttribute('aria-pressed','true');
 expect((await model(page)).textRuns).toEqual([{start:0,end:6,style:{underline:true}}]);
 await page.locator(host).focus();expect(await selection(page)).toEqual({anchor:6,focus:0});
 const a=text.indexOf('\n')-3,b=text.indexOf('😀')+2;
 await select(page,b,a);await button(page,'strikethrough').click();
 expect(await selection(page)).toEqual({anchor:b,focus:a});expect(await page.locator(host).textContent()).toBe(text);
 expect((await model(page)).textRuns).toContainEqual({start:a,end:b,style:{strikethrough:true}});
 await expect(page.locator('#wysiwygRecovery')).toBeHidden();
});

test('mobile U/S uses textarea selection and legacy whole-layer behavior',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await setup(page,{mobileUnderline:true,mobileStrike:true},true);
 const input=page.locator('#inlineText');
 await input.evaluate(el=>el.setSelectionRange(0,6,'backward'));await input.dispatchEvent('select');
 await page.locator('#mobileContext [data-mobile=format]').click();
 const u=page.locator('#mobilePropertyUI [data-mp-format=underline]'),s=page.locator('#mobilePropertyUI [data-mp-format=strike]');
 await expect(u).toHaveAttribute('aria-pressed','true');await u.click();
 expect((await model(page)).textRuns).toEqual([{start:0,end:6,style:{underline:false}}]);
 await s.click();expect((await model(page)).textRuns).toEqual([{start:0,end:6,style:{strikethrough:false,underline:false}}]);
 expect(await input.evaluate(el=>[el.selectionStart,el.selectionEnd,el.selectionDirection])).toEqual([0,6,'backward']);
 await input.evaluate(el=>{el.focus();el.setSelectionRange(10,10)});await input.dispatchEvent('select');await u.click();
 const layer=await model(page);expect(layer.underline).toBe(true);expect(layer.mobileUnderline).toBe(true);
 await page.keyboard.press('Control+Enter');await expect(input).toBeHidden();
 const png=await exportPNG(page,640,480);expect(png.image.data.length).toBe(640*480*4);
});

test('mouse word selection decorates exactly that word in DOM, Canvas and downloaded PNG',async({page},info)=>{
 await setup(page);const before=await geometry(page);
 const first=page.locator(`${host} [data-wysiwyg-fragment]`).first(),box=await first.boundingBox();
 await page.mouse.dblclick(box.x+20,box.y+15);expect(await selection(page)).toEqual({anchor:0,focus:6});
 await button(page,'underline').click();expect(await selection(page)).toEqual({anchor:0,focus:6});
 expect(await geometry(page)).toEqual(before);const dom=await lines(page);expect(dom).toHaveLength(1);expect(dom[0].x).toBe(0);
 const expectedWidth=await first.evaluate(el=>{const r=document.createRange();r.setStart(el.firstChild,0);r.setEnd(el.firstChild,6);const scale=el.closest('#inlineWysiwyg').getBoundingClientRect().width/592;return r.getBoundingClientRect().width/scale});
 expect(Math.abs(expectedWidth-dom[0].width)).toBeLessThan(.1);
 await close(page);const canvas=await page.evaluate(()=>window.lines);expect(canvas).toHaveLength(1);expect(Math.abs(canvas[0].width-dom[0].width)).toBeLessThan(.001);
 const png=await exportPNG(page,640,480),r=canvas[0];
 const dark=(x,y)=>{const p=(y*png.image.width+x)*4;return png.image.data[p]<80&&png.image.data[p+1]<80&&png.image.data[p+2]<80};
 const y=Math.round(20+r.y+r.height/2);
 expect(dark(Math.round(24+r.width/2),y)||dark(Math.round(24+r.width/2),y-1)).toBe(true);
 // The adjacent unselected gap and letters have no line at this baseline.
 for(let x=Math.ceil(24+r.width+3);x<24+r.width+15;x++)expect(dark(x,y)).toBe(false);
 await info.attach('one-word-export.png',{body:png.bytes,contentType:'image/png'});
});

test('collapsed desktop caret formats the whole layer and remains one history action',async({page})=>{
 await setup(page);await select(page,0,6);await button(page,'underline').click();
 await select(page,10,10);await expect(button(page,'underline')).toHaveAttribute('aria-pressed','mixed');
 await button(page,'underline').click();let e=await model(page);expect(e.underline).toBe(true);expect(e.textRuns).toBeUndefined();
 await expect(button(page,'underline')).toHaveAttribute('aria-pressed','true');expect(await selection(page)).toEqual({anchor:10,focus:10});
 await page.keyboard.press('Control+z');expect((await model(page)).textRuns).toEqual([{start:0,end:6,style:{underline:true}}]);
 await page.keyboard.press('Control+Shift+z');expect((await model(page)).underline).toBe(true);
 await button(page,'underline').click();e=await model(page);expect(e.underline).toBe(false);await expect(button(page,'underline')).toHaveAttribute('aria-pressed','false');
});

test('desktop multi-layer typography buttons format all selected text layers',async({page})=>{
 await setup(page);await close(page);await page.locator('#inspector [data-action=duplicate]').click();
 await page.locator('#layers .layer-name').filter({hasText:/^Decorations$/}).click({modifiers:['Shift']});
 await expect(page.locator('#inspector .ins-object-title')).toContainText('Выбрано 2');
 await button(page,'underline').click();await expect(button(page,'underline')).toHaveAttribute('aria-pressed','true');
 const {exportedDocument}=require('./helpers');const doc=await exportedDocument(page);
 expect(doc.elements).toHaveLength(2);expect(doc.elements.every(e=>e.underline===true)).toBe(true);
 await button(page,'underline').click();const off=await exportedDocument(page);expect(off.elements.every(e=>e.underline===false)).toBe(true);
});
