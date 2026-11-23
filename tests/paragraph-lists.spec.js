const {test,expect,openHome,importPayload,records,openLibraryDocument,canvasPoint,exportPNG}=require('./helpers');
const {model}=require('./support/text-interaction');
const {PNG}=require('pngjs');
const {readFile}=require('node:fs/promises');
const fixture=require('./fixtures/visual-text.json');

const width=640,height=480,origin={x:40,y:38};
const host=page=>page.locator('#inlineWysiwyg');
const kind=(page,value)=>page.locator('[data-list-kind='+value+']');
const field=(page,value)=>page.locator('[data-list-field='+value+']');
const panel=page=>page.locator('#listStylePanel');
const preset=(page,value)=>page.locator('[data-list-marker="'+value+'"]');
const counter=(page,value)=>page.locator('[data-list-counter='+value+']');
const colorButton=page=>panel(page).locator('[data-list-color]');
const autoRun=(start,style)=>run(start,{...style,listMarkerScale:'auto'});
const press=async(page,...keys)=>{for(const key of keys)await page.keyboard.press(key);};
const frame=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const run=(start,style)=>({start,style});
async function seed(page,patch={},docPatch={}){
 await page.addInitScript(()=>{
  window.listDraws={canvas:[],overlay:[]};
  const {fillText,clearRect,setTransform}=CanvasRenderingContext2D.prototype;
  const tag=canvas=>canvas.id==='canvas'?'canvas':'textStrokeOverlay' in canvas.dataset?'overlay':null;
  CanvasRenderingContext2D.prototype.clearRect=function(...args){
   const key=tag(this.canvas);if(key)window.listDraws[key]=[];
   return clearRect.apply(this,args);
  };
  CanvasRenderingContext2D.prototype.setTransform=function(...args){
   if(tag(this.canvas)==='overlay')window.listDraws.overlay=[];
   return setTransform.apply(this,args);
  };
  CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...args){
   const key=tag(this.canvas);if(key)window.listDraws[key].push({text,x,y,width:this.measureText(text).width,font:this.font,
    color:this.fillStyle,alpha:this.globalAlpha});
   return fillText.call(this,text,x,y,...args);
  };
 });
 await openHome(page);
 const payload=structuredClone(fixture);
 Object.assign(payload.document,{width,height,...docPatch});
 Object.assign(payload.document.elements[0],{id:'lists',name:'List sample',...origin,w:390,h:325,
  text:'Alpha\nBeta\nGamma',fontFamily:'Arial',fontSize:30,lineHeight:1.2,textColor:'#192b40',fill:'#192b40',autoFontSize:false,...patch});
 await importPayload(page,payload);
 const doc=(await records(page,'docs')).find(d=>d.elements.some(e=>e.name==='List sample'));
 await openLibraryDocument(page,doc.id);
 return doc.id;
}
async function edit(page){
 await page.locator('#fitBtn').click();
 await page.locator('#zoomLabel').click();
 await page.locator('#zoomInput').fill('100');
 await page.locator('#zoomInput').press('Enter');
 await frame(page);
 const point=await canvasPoint(page,origin.x+20,origin.y+15,width,height);
 await page.mouse.dblclick(point.x,point.y);
 await expect(host(page)).toBeFocused();
}
const selection=page=>host(page).evaluate(el=>{
 const s=getSelection();
 const offset=(node,i)=>{const r=document.createRange();r.setStart(el,0);r.setEnd(node,i);return r.toString().length;};
 return [offset(s.anchorNode,s.anchorOffset),offset(s.focusNode,s.focusOffset)];
});
async function done(page){
 await host(page).focus();await press(page,'Control+Enter');await expect(host(page)).toBeHidden();
}
async function markerDraws(page,pattern){
 const draws=await page.evaluate(()=>listDraws.overlay);
 return draws.filter(part=>pattern.test(part.text));
}
async function markerPoint(page,marker){
 const {x,y}=await host(page).evaluate(el=>el.getBoundingClientRect().toJSON());
 return {x:x+marker.x+marker.width/2,y:y+marker.y-10};
}
async function pngWithoutFocusChange(page){
 const pending=page.waitForEvent('download');
 await page.locator('#exportBtn').evaluate(button=>button.click());
 return PNG.sync.read(await readFile(await (await pending).path())).data;
}
test('Inspector icons, persistent gallery, Mixed, numeric controls, history and reload',async({page})=>{
 const text='Alpha\nBeta\nGamma',id=await seed(page,{text});
 await page.locator('#layers .layer-name').filter({hasText:'List sample'}).click();
 const section=page.locator('[data-ins-section="Списки"]');
 await section.click();
 await expect(section).toHaveAttribute('aria-expanded','false');
 await edit(page);
 await section.click();
 await expect(host(page)).toBeVisible();
 await expect(page.locator('[data-list-kind] svg')).toHaveCount(3);
 for(const value of ['none','bullet','ordered']){
  const button=kind(page,value);
  await expect(button).toHaveAttribute('title',await button.getAttribute('aria-label'));
  expect((await button.boundingBox()).width).toBeLessThan(45);
 }
 await host(page).focus();
 await press(page,'Control+Home','ArrowRight','Shift+ArrowRight');
 await kind(page,'bullet').focus();await press(page,'Enter');
 await expect(kind(page,'bullet')).toHaveAttribute('aria-pressed','true');
 await expect(kind(page,'bullet')).toHaveAttribute('aria-expanded','true');
 await expect(panel(page)).toBeVisible();
 expect((await model(page)).paragraphRuns).toEqual([autoRun(0,{listKind:'bullet'})]);
 await expect(panel(page).locator('legend')).toHaveText(['Основные','Декоративные','Отметки','Стрелки','Эмодзи']);
 await expect(panel(page).locator('[data-list-marker]')).toHaveCount(33);
 await preset(page,'•').focus();await press(page,'ArrowRight');
 await expect(preset(page,'∙')).toBeFocused();
 await preset(page,'🔶').focus();await press(page,'Space');
 await expect(preset(page,'🔶')).toBeFocused();
 await expect(panel(page)).toBeVisible();
 expect((await model(page)).paragraphRuns).toEqual([autoRun(0,{listKind:'bullet',listMarker:'🔶'})]);
 await preset(page,'🔶').click();
 await press(page,'Control+z');
 expect((await model(page)).paragraphRuns).toEqual([autoRun(0,{listKind:'bullet'})]);
 await press(page,'Control+Shift+z');
 await host(page).focus();expect(await selection(page)).toEqual([1,2]);
 await press(page,'Control+Home');
 for(let i=0;i<8;i++)await press(page,'Shift+ArrowRight');
 await expect(page.locator('[data-list-mixed]')).toHaveText('Mixed');
 await expect(kind(page,'ordered')).toHaveAttribute('aria-pressed','mixed');
 await kind(page,'ordered').click();
 await expect(panel(page).locator('[data-list-counter]')).toHaveText(['1. 2. 3.','1) 2) 3)','a. b. c.','A. B. C.','i. ii. iii.','I. II. III.','01. 02. 03.']);
 await counter(page,'decimal-paren').click();
 await counter(page,'roman-lower-dot').click();
 await expect(panel(page)).toBeVisible();
 await field(page,'listStart').fill('18');await press(page,'Enter');
 await expect(field(page,'listStart')).toBeFocused();
 await field(page,'listIndent').fill('13');await press(page,'Tab');
 await field(page,'listGap').fill('9');await press(page,'Tab');
 expect((await markerDraws(page,/^[ixv]+\.$/)).map(p=>p.text)).toEqual(['xviii.','xix.']);
 expect(await host(page).textContent()).toBe(text);
 const expected=await model(page);
 expect(expected.paragraphRuns).toEqual([
  autoRun(0,{listKind:'ordered',listMarker:'🔶',listCounterStyle:'roman-lower-dot',listStart:18,listIndent:13,listGap:9}),
  autoRun(6,{listKind:'ordered',listCounterStyle:'roman-lower-dot',listIndent:13,listGap:9}),
 ]);
 await done(page);
 await expect.poll(async()=>(await records(page,'docs')).find(d=>d.id===id)?.elements[0]).toEqual(expected);
 await page.reload();await openLibraryDocument(page,id);await edit(page);
 await press(page,'Control+Home');await kind(page,'none').click();
 await expect(panel(page)).toBeHidden();
 await host(page).focus();await press(page,'Escape');
 expect(await model(page)).toEqual(expected);
});

test('list panel keeps its owner, scroll and focus through sizing, palette and mode changes',async({page},info)=>{
 const text='Alpha\nBeta\nGamma';
 const id=await seed(page,{text},{palette:['#d71d49']});
 await edit(page);
 await press(page,'Control+Home','ArrowDown','End');
 for(let i=0;i<8;i++)await press(page,'Shift+ArrowLeft');
 expect(await selection(page)).toEqual([10,2]);
 await kind(page,'bullet').click();
 const settings=panel(page),body=settings.locator('.list-style-body');
 await expect(settings).toBeVisible();
 await expect(settings.locator('[data-list-mode=bullet]')).toBeFocused();
 const b=await settings.boundingBox();
 const stage=await page.locator('#stageScroller').boundingBox();
 expect(b.x).toBeGreaterThan(stage.x+stage.width/2);
 expect(b.x+b.width).toBeLessThanOrEqual(page.viewportSize().width);
 expect(b.y+b.height).toBeLessThanOrEqual(page.viewportSize().height);
 const capture=async(name,locator)=>{
  const path=info.outputPath(name+'.png');
  await (locator||page).screenshot({path,animations:'disabled'});
  await info.attach(name,{path,contentType:'image/png'});
 };
 await capture('list-compact-controls',page.locator('[data-ins-section="Списки"]').locator('..'));
 await capture('list-bullet-panel',settings);
 const bulletDefault=(await markerDraws(page,/^•$/u))[0];
 await page.setViewportSize({width:1210,height:690});
 const resized=await settings.boundingBox();
 expect(resized.y+resized.height).toBeLessThanOrEqual(690);
 await preset(page,'🔴').scrollIntoViewIfNeeded();
 const galleryScroll=await body.evaluate(el=>el.scrollTop);
 expect(galleryScroll).toBeGreaterThan(0);
 await preset(page,'🔴').click();
 expect(await body.evaluate(el=>el.scrollTop)).toBe(galleryScroll);
 let emoji=(await markerDraws(page,/^🔴$/u))[0];
 expect(parseFloat(emoji.font.match(/[0-9.]+px/)[0])).toBe(18);
 expect(parseFloat(bulletDefault.font.match(/[0-9.]+px/)[0])).toBe(30);
 await expect(colorButton(page)).toBeDisabled();
 await expect(field(page,'listMarkerOpacity')).toBeEnabled();
 await field(page,'listMarkerOpacity').fill('35');await press(page,'Enter');
 expect((await markerDraws(page,/^🔴$/u))[0].alpha).toBeCloseTo(.35,2);
 await settings.locator('[data-list-reset=listMarkerOpacity]').click();
 await preset(page,'✅').click();await expect(settings).toBeVisible();
 await preset(page,'◆').click();
 const initial=await model(page);
 const beforePNG=await pngWithoutFocusChange(page);
 const slider=settings.locator('[data-list-scale-range]');
 await slider.scrollIntoViewIfNeeded();
 const {x,y,width:w,height:h}=await slider.boundingBox();
 await page.mouse.move(x+w*.25,y+h/2);await page.mouse.down();
 await page.mouse.move(x+w*.82,y+h/2,{steps:12});
 expect(await model(page)).toEqual(initial);
 expect(maxDelta(await pngWithoutFocusChange(page),beforePNG)).toBe(0);
 const draft=(await markerDraws(page,/^◆$/u))[0];
 expect(parseFloat(draft.font.match(/[0-9.]+px/)[0])).toBeGreaterThan(30);
 expect((await records(page,'docs')).find(doc=>doc.id===id).elements[0].paragraphRuns).toBeUndefined();
 await page.mouse.up();
 const sized=await model(page);
 expect(sized.paragraphRuns[0].style.listMarkerScale).toBeGreaterThan(100);
 expect(sized.paragraphRuns[1].style.listMarkerScale).toBe(sized.paragraphRuns[0].style.listMarkerScale);
 await press(page,'Control+z');expect(await model(page)).toEqual(initial);
 await press(page,'Control+Shift+z');expect(await model(page)).toEqual(sized);
 await kind(page,'bullet').click();
 await settings.locator('[data-list-reset=listMarkerScale]').click();
 await expect(field(page,'listMarkerScale')).toHaveAttribute('placeholder','Auto');
 await field(page,'listMarkerScale').fill('56');await press(page,'Enter');
 await expect(field(page,'listMarkerScale')).toBeFocused();
 expect(parseFloat((await markerDraws(page,/^◆$/u))[0].font.match(/[0-9.]+px/)[0])).toBeCloseTo(16.8,0);
 await colorButton(page).click();
 const picker=page.locator('#fillPopover[data-key=_listMarker]');
 await expect(picker).toBeVisible();
 const hex=picker.locator('[data-cp-part="0"]');
 await hex.fill('#148555');await press(page,'Enter');await expect(hex).toBeFocused();
 expect((await markerDraws(page,/^◆$/u))[0].color).toBe('#148555');
 await picker.locator('[data-fill-palette="#d71d49"]').click();
 expect((await markerDraws(page,/^◆$/u))[0].color).toBe('#d71d49');
 const beforePickerDrag=await model(page);
 const square=await picker.locator('#cpSquare').boundingBox();
 await page.mouse.move(square.x+square.width*.4,square.y+30);await page.mouse.down();
 await page.mouse.move(square.x+square.width*.8,square.y+80,{steps:7});
 expect(await model(page)).toEqual(beforePickerDrag);
 await page.mouse.up();
 expect(await model(page)).not.toEqual(beforePickerDrag);
 await press(page,'Control+z');expect(await model(page)).toEqual(beforePickerDrag);
 await kind(page,'bullet').click();await colorButton(page).click();
 await press(page,'Escape');await expect(picker).toBeHidden();await expect(settings).toBeVisible();
 await expect(colorButton(page)).toBeFocused();
 await field(page,'listMarkerOpacity').fill('0');await press(page,'Enter');
 expect((await markerDraws(page,/^◆$/u))[0].alpha).toBe(0);
 await settings.locator('[data-list-reset=listMarkerOpacity]').click();
 await settings.locator('[data-list-mode=ordered]').click();
 expect((await markerDraws(page,/^1\.$/u))[0].color).toBe('#d71d49');
 await capture('list-numbering-panel',settings);
 await settings.locator('[data-list-mode=bullet]').click();
 const formatted=await model(page);
 expect(formatted.paragraphRuns).toEqual([0,6].map(start=>run(start,{
  listKind:'bullet',listMarker:'◆',listMarkerScale:56,listMarkerColor:'#d71d49',
 })));
 await press(page,'Escape');
 await expect(settings).toBeHidden();await expect(kind(page,'bullet')).toBeFocused();
 await host(page).focus();
 expect(await selection(page)).toEqual([10,2]);
 await done(page);
 await expect.poll(async()=>(await records(page,'docs')).find(doc=>doc.id===id)?.elements[0]).toEqual(formatted);
});
test('list settings reject stale, composing and locked targets, and discard canceled gestures',async({page})=>{
 const original=[autoRun(0,{listKind:'bullet'})];
 await seed(page,{paragraphRuns:original});
 await edit(page);await press(page,'Control+Home');
 await kind(page,'bullet').click();
 const slider=panel(page).locator('[data-list-scale-range]');
 await slider.evaluate(el=>el.addEventListener('pointerdown',ev=>el.dataset.pointerId=ev.pointerId,{once:true}));
 await slider.scrollIntoViewIfNeeded();
 const {x,y,width:w,height:h}=await slider.boundingBox();
 await page.mouse.move(x+w*.4,y+h/2);await page.mouse.down();
 await page.mouse.move(x+w*.9,y+h/2,{steps:5});
 await slider.dispatchEvent('pointercancel',{pointerId:Number(await slider.getAttribute('data-pointer-id'))});
 await page.mouse.up();
 expect((await model(page)).paragraphRuns).toEqual(original);
 await host(page).focus();
 await press(page,'Control+End');
 await expect(panel(page)).toBeHidden();
 await preset(page,'◆').dispatchEvent('click');
 expect((await model(page)).paragraphRuns).toEqual(original);
 await kind(page,'bullet').click();
 await host(page).dispatchEvent('compositionstart');
 await expect(panel(page)).toBeHidden();await expect(kind(page,'ordered')).toBeDisabled();
 await kind(page,'ordered').dispatchEvent('click');
 expect((await model(page)).paragraphRuns.at(-1)).toEqual(autoRun(11,{listKind:'bullet'}));
 await host(page).dispatchEvent('compositionend');
 await page.locator('#wysiwygRecover').click();
 await done(page);
 await kind(page,'bullet').click();
 const lock=page.locator('#inspector [data-action=lock]');
 await lock.click();
 await expect(panel(page)).toBeHidden();await expect(kind(page,'ordered')).toBeDisabled();
 const locked=await model(page);
 await kind(page,'ordered').dispatchEvent('click');
 expect(await model(page)).toEqual(locked);
});

test('marker clicks and drags, Home, Enter, Backspace and ordered renumbering use source offsets',async({page})=>{
 const text='Alpha\nBeta\nGamma';
 await seed(page,{text,paragraphRuns:[0,6,11].map((start,i)=>run(start,{listKind:'ordered',...(i===0?{listStart:9}:{})}))});
 await edit(page);
 const numbers=()=>markerDraws(page,/^\d+\.$/);
 const points=await numbers();
 expect(points.map(p=>p.text)).toEqual(['9.','10.','11.']);
 const point=await markerPoint(page,points[1]);
 await page.mouse.click(point.x,point.y);
 expect(await selection(page)).toEqual([6,6]);
 const glyph=await host(page).locator('[data-wysiwyg-row]').nth(1).locator('[data-wysiwyg-fragment]').boundingBox();
 await page.mouse.move(point.x,point.y);await page.mouse.down();
 await page.mouse.move(glyph.x+glyph.width*.74,point.y,{steps:7});
 await page.mouse.up();
 const selected=await selection(page);
 expect(selected[0]).toBe(6);expect(selected[1]).toBeGreaterThan(6);
 await press(page,'Home','Backspace');
 expect((await model(page)).text).toBe(text);
 expect((await numbers()).map(p=>p.text)).toEqual(['9.','1.']);
 await press(page,'Control+z','End','Enter');
 expect(await host(page).textContent()).toBe('Alpha\nBeta\n\nGamma');
 expect((await numbers()).map(p=>p.text)).toEqual(['9.','10.','11.','12.']);
 await press(page,'Enter');
 expect(await host(page).textContent()).toBe('Alpha\nBeta\n\nGamma');
 expect((await numbers()).map(p=>p.text)).toEqual(['9.','10.','1.']);
 await press(page,'Control+z','Control+z');
 expect(await host(page).textContent()).toBe(text);
 expect((await numbers()).map(p=>p.text)).toEqual(['9.','10.','11.']);
 await press(page,'Control+Shift+z');
 expect((await numbers()).map(p=>p.text)).toEqual(['9.','10.','11.','12.']);
 await press(page,'Backspace');
 expect((await numbers()).map(p=>p.text)).toEqual(['9.','10.','1.']);
 expect((await model(page)).text).toBe('Alpha\nBeta\n\nGamma');
 await press(page,'Backspace');
 expect((await model(page)).text).toBe(text);
 expect((await numbers()).map(p=>p.text)).toEqual(['9.','10.','11.']);
 await press(page,'Control+End','ArrowLeft','ArrowLeft','Enter');
 expect((await model(page)).text).toBe('Alpha\nBeta\nGam\nma');
 expect((await numbers()).map(p=>p.text)).toEqual(['9.','10.','11.','12.']);
 await press(page,'Control+End','Enter');
 expect((await model(page)).text).toBe('Alpha\nBeta\nGam\nma\n');
 expect((await numbers()).map(p=>p.text)).toEqual(['9.','10.','11.','12.','13.']);
 await press(page,'Enter');
 expect((await model(page)).text).toBe('Alpha\nBeta\nGam\nma\n');
 expect((await numbers()).map(p=>p.text)).toEqual(['9.','10.','11.','12.']);
 await press(page,'Control+z','Control+z','Control+z','Control+Home','Shift+End');
 expect(await selection(page)).toEqual([0,5]);
 await press(page,'Control+c','Control+End','Control+v');
 expect((await model(page)).text).toBe(text+'Alpha');
});

const img=url=>PNG.sync.read(Buffer.from(url.split(',')[1],'base64')).data;
const maxDelta=(a,b)=>a.reduce((max,value,i)=>Math.max(max,Math.abs(value-b[i])),0);
for(const customized of [false,true])test(`live DOM position, ${customized?'customized':'legacy'} markers, justify, T1–T3, Canvas and PNG agree`,async({page},info)=>{
 const text='Straße  one two three four five six seven eight nine\nSmall';
 await seed(page,{text,w:250,textAlign:'justify',verticalAlign:'middle',strokeWidth:1,fillOpacity:86,
  paragraphRuns:[run(0,{listKind:'bullet',listMarker:'◆',listIndent:8,listGap:12,
   ...(customized?{listMarkerScale:62,listMarkerColor:'#cc203c',listMarkerOpacity:67}:{})}),
   run(text.indexOf('Small'),{listKind:'ordered',listStart:5,
    ...(customized?{listMarkerScale:147,listMarkerColor:'#1467d9',listMarkerOpacity:0}:{})})],
  textRuns:[{start:0,end:6,style:{textCase:'upper',baselineShift:'super',underline:true,
   underlineDetails:{style:'wavy',color:'#d53548'}}}]},{backgroundAlpha:0});
 await edit(page);
 await expect(host(page)).toHaveClass(/wysiwyg-canvas-ink/);
 expect(await host(page).textContent()).toBe(text.replace('Straße','STRASSE'));
 const markers=await markerDraws(page,/^(◆|5\.)$/);
 expect(markers.map(part=>part.text)).toEqual(['◆','5.']);
 if(customized){
  expect(markers.map(part=>part.color)).toEqual(['#cc203c','#1467d9']);
  expect(markers[0].alpha).toBeCloseTo(.67,2);
  expect(markers[1].alpha).toBe(0);
 }
 const dom=await host(page).locator('[data-wysiwyg-fragment]').evaluateAll(spans=>spans.map(span=>
  ({text:span.textContent.replaceAll('\n',''),x:span.getBoundingClientRect().left-span.closest('#inlineWysiwyg').getBoundingClientRect().left})
 ).filter(part=>part.text));
 const live=img(await page.locator('[data-text-stroke-overlay]').evaluate(el=>el.toDataURL()));
 const draws=(await page.evaluate(()=>listDraws.overlay)).filter(p=>p.text!=='◆'&&p.text!=='5.');
 expect(dom.map(p=>p.text)).toEqual(draws.map(p=>p.text));
 const domError=Math.max(...dom.map((p,i)=>Math.abs(p.x-draws[i].x)));
 expect(domError).toBeLessThan(.12);
 expect(dom[0].x).toBeGreaterThan(markers[0].x+markers[0].width);
 const rowOrigins=await host(page).locator('[data-wysiwyg-row]').evaluateAll(rows=>rows.map(row=>
  row.firstChild.getBoundingClientRect().left-row.getBoundingClientRect().left));
 expect(Math.abs(rowOrigins[0]-rowOrigins[1])).toBeLessThan(.12);
 await done(page);
 const outside=await canvasPoint(page,625,465,width,height);
 await page.mouse.click(outside.x,outside.y);
 const canvas=img(await page.locator('#canvas').evaluate(el=>el.toDataURL()));
 const png=await exportPNG(page,width,height);
 expect(live.length).toBe(png.image.data.length);
 expect(canvas.length).toBe(live.length);
 const canvasToPNG=maxDelta(canvas,png.image.data),liveToPNG=maxDelta(live,png.image.data);
 await info.attach('list-geometry',{body:JSON.stringify({domError,canvasToPNG,liveToPNG,markers}),contentType:'application/json'});
 await info.attach('list-export',{body:png.bytes,contentType:'image/png'});
 expect(canvasToPNG).toBeLessThanOrEqual(1);expect(liveToPNG).toBeLessThanOrEqual(2);
});

test('capture ordinary, smaller and recolored bullets on the canvas',async({page},info)=>{
 await seed(page,{text:'Обычный маркер\nУменьшенный маркер\nСобственный цвет',fontSize:35,h:200,
  paragraphRuns:[
   autoRun(0,{listKind:'bullet',listMarker:'◆'}),
   run('Обычный маркер\n'.length,{listKind:'bullet',listMarker:'◆',listMarkerScale:45}),
   run('Обычный маркер\nУменьшенный маркер\n'.length,{listKind:'bullet',listMarker:'◆',listMarkerScale:72,listMarkerColor:'#ce2355'}),
  ]});
 await page.locator('#layers .layer-name').filter({hasText:'List sample'}).click();
 await kind(page,'bullet').click();
 await expect(panel(page)).toBeVisible();
 const path=info.outputPath('list-marker-examples.png');
 await page.screenshot({path,animations:'disabled'});
 await info.attach('list-marker-examples',{path,contentType:'image/png'});
});

test('whole-layer list participates in auto-fit and document undo',async({page})=>{
 const text='Straße one two three four';
 await seed(page,{text,w:140,h:48,autoFontSize:true});
 await page.locator('#layers .layer-name').filter({hasText:'List sample'}).click();
 const plain=await model(page);
 await kind(page,'bullet').click();
 const bullet=await model(page);
 expect(bullet.text).toBe(text);
 expect(bullet.fontSize).toBeLessThan(plain.fontSize);
 expect(bullet.paragraphRuns).toEqual([autoRun(0,{listKind:'bullet'})]);
 await page.locator('#undoBtn').click();
 expect(await model(page)).toEqual(plain);
});
test('vertical text retains imported paragraph runs with list commands disabled',async({page})=>{
 const paragraphRuns=[run(0,{listKind:'ordered'})];
 await seed(page,{textMode:'vertical',paragraphRuns});
 await page.locator('#layers .layer-name').filter({hasText:'List sample'}).click();
 await expect(kind(page,'bullet')).toBeDisabled();
 await kind(page,'bullet').dispatchEvent('click');
 expect((await model(page)).paragraphRuns).toEqual(paragraphRuns);
});

test.describe('mobile native bridge',()=>{
 test.use({viewport:{width:390,height:844},hasTouch:true});
 test('paused range and collapsed caret toggle list kinds without restoring stale snapshots',async({page,browserName})=>{
  test.skip(browserName!=='chromium','Android-sized touch behavior is covered in Chromium.');
  const text='• Keep 😀\nSecond\nThird';
  const legacy={mobileList:'bullet',mobileListRawText:'Stale text',
   mobileListRawTextRuns:[{start:0,end:5,style:{italic:true}}]};
  const id=await seed(page,{...legacy,text,w:330,h:280,
   textRuns:[{start:2,end:6,style:{underline:true,baselineShift:'super',textCase:'upper'}}],
   paragraphRuns:[run(0,{listMarker:'✓',listMarkerScale:70,listMarkerColor:'#e42e54',listMarkerOpacity:45}),run(17,{listCounterStyle:'latin-upper-dot'})]});
  const input=page.locator('#inlineText'),tool=name=>page.locator('#mobileContext [data-mobile='+name+']').tap();
  await page.locator('[data-mobile=layers]:visible').tap();
  await page.locator('#mobileLayerList .layer-name').filter({hasText:'List sample'}).tap();
  await page.locator('#mobileLayersClose').tap();
  const before=await model(page);
  const select=async(start,end=start)=>{
   await tool('edit');await expect(input).toBeFocused();
   await input.evaluate((el,[a,b])=>{el.setSelectionRange(a,b,'backward');el.dispatchEvent(new Event('select',{bubbles:true}));},[start,end]);
   await tool('format');await expect(input).not.toBeFocused();
  };
  const bullet=page.locator('[data-mp-format=bullet]'),number=page.locator('[data-mp-format=number]');
  await select(2,12);await bullet.tap();
  await expect(input).toHaveValue(text);
  let after=await model(page);
  expect(after.paragraphRuns).toEqual([run(0,{listKind:'bullet',listMarker:'✓',listMarkerScale:70,listMarkerColor:'#e42e54',listMarkerOpacity:45}),
   run(10,{listKind:'bullet'}),run(17,{listCounterStyle:'latin-upper-dot'})]);
  expect({...after,paragraphRuns:before.paragraphRuns}).toEqual(before);
  expect(await input.evaluate(el=>[el.selectionStart,el.selectionEnd])).toEqual([2,12]);
  await page.locator('#undoBtn').tap();expect(await model(page)).toEqual(before);
  await page.locator('#redoBtn').tap();expect(await model(page)).toEqual(after);
  await select(18);await number.tap();await expect(number).toHaveAttribute('aria-pressed','true');
  after=await model(page);expect(after.paragraphRuns.at(-1)).toEqual(run(17,{listKind:'ordered',listCounterStyle:'latin-upper-dot'}));
  await page.locator('#mobileConfirm').tap();await expect(input).toBeHidden();
  await expect.poll(async()=>(await records(page,'docs')).find(d=>d.id===id)?.elements[0]).toEqual(after);
  const png=await exportPNG(page,width,height);
  expect(png.bytes.length).toBeGreaterThan(100);
 });
});
