const {test,expect,openHome,importPayload,records,openLibraryDocument,canvasPoint,exportPNG}=require('./helpers');
const {model}=require('./support/text-interaction');
const {PNG}=require('pngjs');
const fixture=require('./fixtures/visual-text.json');

const width=640,height=480,origin={x:40,y:38};
const host=page=>page.locator('#inlineWysiwyg');
const kind=(page,value)=>page.locator('[data-list-kind='+value+']');
const field=(page,value)=>page.locator('[data-list-field='+value+']');
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
   const key=tag(this.canvas);if(key)window.listDraws[key].push({text,x,y,width:this.measureText(text).width});
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
test('Inspector gallery, Mixed, numeric controls, no-op, history, Done, reload and Escape',async({page})=>{
 const text='Alpha\nBeta\nGamma',id=await seed(page,{text});
 await edit(page);
 await press(page,'Control+Home','ArrowRight','Shift+ArrowRight');
 await kind(page,'bullet').click();
 await expect(kind(page,'bullet')).toHaveAttribute('aria-pressed','true');
 expect(await selection(page)).toEqual([1,2]);
 expect((await model(page)).paragraphRuns).toEqual([run(0,{listKind:'bullet'})]);
 const summary=page.getByLabel('Галерея маркеров');
 await summary.focus();await press(page,'Enter');
 await page.locator('[data-list-marker="🔶"]').focus();await press(page,'Space');
 await expect(host(page)).toBeFocused();
 expect((await model(page)).paragraphRuns).toEqual([run(0,{listKind:'bullet',listMarker:'🔶'})]);
 await kind(page,'bullet').click();
 await press(page,'Control+z');
 expect((await model(page)).paragraphRuns).toEqual([run(0,{listKind:'bullet'})]);
 await press(page,'Control+Shift+z','Control+Home');
 for(let i=0;i<8;i++)await press(page,'Shift+ArrowRight');
 await expect(page.locator('[data-list-mixed]')).toHaveText('Mixed');
 await kind(page,'ordered').click();
 await field(page,'listCounterStyle').selectOption('roman-lower-dot');
 await field(page,'listStart').fill('18');await press(page,'Enter');
 await field(page,'listIndent').fill('13');await press(page,'Tab');
 await field(page,'listGap').fill('9');await press(page,'Tab');
 expect((await markerDraws(page,/^[ixv]+\.$/)).map(p=>p.text)).toEqual(['xviii.','xix.']);
 expect(await host(page).textContent()).toBe(text);
 const expected=await model(page);
 expect(expected.paragraphRuns).toEqual([
  run(0,{listKind:'ordered',listMarker:'🔶',listCounterStyle:'roman-lower-dot',listStart:18,listIndent:13,listGap:9}),
  run(6,{listKind:'ordered',listCounterStyle:'roman-lower-dot',listIndent:13,listGap:9}),
 ]);
 await done(page);
 await expect.poll(async()=>(await records(page,'docs')).find(d=>d.id===id)?.elements[0]).toEqual(expected);
 await page.reload();await openLibraryDocument(page,id);await edit(page);
 await press(page,'Control+Home');await kind(page,'none').click();await press(page,'Escape');
 expect(await model(page)).toEqual(expected);
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
 const copied=await host(page).evaluate(el=>{
  const clipboardData=new DataTransfer();
  el.dispatchEvent(new ClipboardEvent('copy',{clipboardData,bubbles:true,cancelable:true}));
  return clipboardData.getData('text/plain');
 });
 expect(copied).toBe('Alpha');
});

const img=url=>PNG.sync.read(Buffer.from(url.split(',')[1],'base64')).data;
const maxDelta=(a,b)=>a.reduce((max,value,i)=>Math.max(max,Math.abs(value-b[i])),0);
test('live DOM position, markers, justify, T1–T3, Canvas and PNG agree',async({page},info)=>{
 const text='Straße  one two three four five six seven eight nine\nSmall';
 await seed(page,{text,w:250,textAlign:'justify',verticalAlign:'middle',strokeWidth:1,fillOpacity:86,
  paragraphRuns:[run(0,{listKind:'bullet',listMarker:'◆',listIndent:8,listGap:12}),
   run(text.indexOf('Small'),{listKind:'ordered',listStart:5})],
  textRuns:[{start:0,end:6,style:{textCase:'upper',baselineShift:'super',underline:true,
   underlineDetails:{style:'wavy',color:'#d53548'}}}]},{backgroundAlpha:0});
 await edit(page);
 await expect(host(page)).toHaveClass(/wysiwyg-canvas-ink/);
 expect(await host(page).textContent()).toBe(text.replace('Straße','STRASSE'));
 const markers=await markerDraws(page,/^(◆|5\.)$/);
 expect(markers.map(part=>part.text)).toEqual(['◆','5.']);
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

test('whole-layer list participates in auto-fit and document undo',async({page})=>{
 const text='Straße one two three four';
 await seed(page,{text,w:140,h:48,autoFontSize:true});
 await page.locator('#layers .layer-name').filter({hasText:'List sample'}).click();
 const plain=await model(page);
 await kind(page,'bullet').click();
 const bullet=await model(page);
 expect(bullet.text).toBe(text);
 expect(bullet.fontSize).toBeLessThan(plain.fontSize);
 expect(bullet.paragraphRuns).toEqual([run(0,{listKind:'bullet'})]);
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
   paragraphRuns:[run(0,{listMarker:'✓'}),run(17,{listCounterStyle:'latin-upper-dot'})]});
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
  expect(after.paragraphRuns).toEqual([run(0,{listKind:'bullet',listMarker:'✓'}),
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
