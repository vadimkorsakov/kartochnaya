const {test,expect,openHome,createDocument,importPayload,records,openLibraryDocument,exportedDocument,canvasPoint,exportPNG}=require('./helpers');
const {model}=require('./support/text-interaction');
const {PNG}=require('pngjs');
const {readFile}=require('node:fs/promises');
const fixture=require('./fixtures/visual-text.json');

const width=640,height=480,origin={x:40,y:38};
const host=page=>page.locator('#inlineWysiwyg');
const kind=(page,value)=>page.locator('[data-list-kind='+value+']');
const configure=page=>page.getByRole('button',{name:'Настроить существующий список'});
const field=(page,value)=>page.locator('[data-list-field='+value+']');
const spacingSlider=(page,value)=>page.locator('[data-list-spacing-range='+value+']');
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
  window.listDraws={canvas:[],overlay:[],export:[]};
  const {fillText,clearRect,setTransform}=CanvasRenderingContext2D.prototype;
  const tag=canvas=>canvas.id==='canvas'?'canvas':'textStrokeOverlay' in canvas.dataset?'overlay':
   !canvas.isConnected&&canvas.width===640&&canvas.height===480?'export':null;
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
 await expect(configure(page)).toBeDisabled();
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
 await expect(panel(page)).toBeVisible();
 await panel(page).locator('[data-list-close]').click();
 await expect(panel(page)).toBeHidden();
 await host(page).focus();await press(page,'Escape');
 expect(await model(page)).toEqual(expected);
});

test('whole-layer settings edit only list items, with one undo per spacing drag',async({page},info)=>{
 const lines=['Обычный заголовок','Первый пункт','Второй пункт','Обычный заключительный абзац'];
 const text=lines.join('\n'),starts=lines.slice(1,3).map(line=>text.indexOf(line));
 const paragraphRuns=starts.map(start=>run(start,{listKind:'bullet'}));
 const id=await seed(page,{text,w:540,paragraphRuns});
 await page.locator('#layers .layer-name').filter({hasText:'List sample'}).click();
 const initial=await model(page);
 const settings=configure(page),mode=key=>panel(page).locator(`[data-list-mode=${key}]`);
 await expect(settings).toHaveAttribute('title','Настроить существующий список');
 await settings.click();await expect(settings).toHaveAttribute('aria-expanded','true');
 await expect(page.locator('.paragraph-list-controls svg')).toHaveCount(4);
 await expect(mode('ordered')).toBeDisabled();
 await expect(field(page,'listGap')).toHaveValue('8');
 expect(await model(page)).toEqual(initial);
 for(const [key,value] of [['listMarkerScale','74'],['listMarkerColor','#c51953']]){
  await field(page,key).fill(value);await press(page,'Enter');
  await expect(field(page,key)).toBeFocused();
 }
 const painted=await model(page);
 expect(painted.paragraphRuns).toEqual(starts.map(start=>run(start,{listKind:'bullet',listMarkerScale:74,listMarkerColor:'#c51953'})));
 for(const [index,key] of ['listIndent','listGap','listItemSpacing'].entries()){
  const slider=spacingSlider(page,key),numeric=field(page,key),before=await model(page);
  const readDraws=()=>page.evaluate(()=>listDraws.canvas);
  const anchor=await panel(page).boundingBox();
  await slider.scrollIntoViewIfNeeded();
  const {x,y,width:w,height:h}=await slider.boundingBox();
  const mid=y+h/2;
  const beforePNG=index===2?await pngWithoutFocusChange(page):null;
  if(index===2)await expect.poll(async()=>(await records(page,'docs')).find(doc=>doc.id===id).elements[0]).toEqual(before);
  const beforeDraws=await readDraws();
  await slider.evaluate(el=>el.addEventListener('pointerdown',e=>el.dataset.pointerId=e.pointerId));
  await page.mouse.move(x+w*.2,mid);await page.mouse.down();
  await page.mouse.move(x+w*.35,mid,{steps:4});await frame(page);
  const firstPreview=await readDraws();expect(firstPreview).not.toEqual(beforeDraws);
  await page.mouse.move(x+w*.64,mid,{steps:4});await frame(page);
  expect(await readDraws()).not.toEqual(firstPreview);
  await expect(numeric).toHaveValue(await slider.inputValue());
  expect(await model(page)).toEqual(before);
  if(index===2){
   expect((await records(page,'docs')).find(doc=>doc.id===id).elements[0]).toEqual(before);
   expect(maxDelta(await pngWithoutFocusChange(page),beforePNG)).toBe(0);
  }
  await page.mouse.up();
  const changed=await model(page),value=Number(await slider.inputValue());
  expect(changed.paragraphRuns).toEqual(before.paragraphRuns.map(({start,style})=>run(start,{...style,[key]:value})));
  await press(page,'Control+z');expect(await model(page)).toEqual(before);
  await press(page,'Control+Shift+z');expect(await model(page)).toEqual(changed);
  await settings.click();await slider.scrollIntoViewIfNeeded();
  await page.mouse.move(x+w*.3,mid);await page.mouse.down();
  await page.mouse.move(x+w*.8,mid,{steps:5});
  await slider.dispatchEvent(index===1?'lostpointercapture':'pointercancel',{pointerId:Number(await slider.getAttribute('data-pointer-id'))});
  await page.mouse.up();expect(await model(page)).toEqual(changed);
  await expect(slider).toHaveValue(String(value));
  await slider.focus();await press(page,'ArrowRight');
  expect((await model(page)).paragraphRuns[0].style[key]).toBe(value+1);
  await numeric.fill('900.5');await press(page,'Enter');
  await expect(numeric).toBeFocused();await expect(numeric).toHaveValue('900.5');
  await expect(slider).toHaveAttribute('aria-valuetext','900.5 px');
  await press(page,'Enter');await press(page,'Control+z');
  expect((await model(page)).paragraphRuns[0].style[key]).toBe(value+1);
  await settings.click();await numeric.fill(String(16+index*4));await press(page,'Enter');
  expect(await panel(page).boundingBox()).toEqual(anchor);
 }
 const after=await model(page);
 expect(after.text).toBe(text);
 expect(after.paragraphRuns.map(p=>p.start)).toEqual(starts);
 await page.setViewportSize({width:1600,height:980});
 await spacingSlider(page,'listItemSpacing').scrollIntoViewIfNeeded();
 const path=info.outputPath('list-compact-controls.png');
 await page.screenshot({path,animations:'disabled'});
 await info.attach('Новые контролы расстояний',{path,contentType:'image/png'});
 const spacing=spacingSlider(page,'listItemSpacing'),box=await spacing.boundingBox();
 await page.mouse.move(box.x+box.width*.55,box.y+box.height/2);await page.mouse.down();
 await press(page,'Escape');await page.mouse.up();
 await expect(panel(page)).toBeHidden();await expect(settings).toBeFocused();
 expect(await model(page)).toEqual(after);
});

test('switching the layer or document discards an unconfirmed spacing gesture',async({page})=>{
 const paragraphRuns=[run(0,{listKind:'bullet'}),run(6,{listKind:'bullet'})];
 const id=await seed(page,{paragraphRuns});
 await page.locator('#documentTabsHome').click();await createDocument(page,'Другой документ');
 const otherId=(await exportedDocument(page)).id;
 const tab=page.locator(`[data-tab-id="${id}"]`);
 await tab.click();
 const layer=page.locator('#layers').getByText('List sample',{exact:true});
 await layer.click();await page.locator('#inspector [data-action=duplicate]').click();
 const copy=page.locator('#layers').getByText('List sample — копия',{exact:true});
 const before=(await exportedDocument(page)).elements;
 const begin=async()=>{
  await layer.click();await configure(page).click();
  const slider=spacingSlider(page,'listItemSpacing');
  await slider.scrollIntoViewIfNeeded();
  const {x,y,width,height}=await slider.boundingBox();
  await page.mouse.move(x+width*.45,y+height/2);await page.mouse.down();
  await expect(field(page,'listItemSpacing')).not.toHaveValue('0');
 };
 await begin();
 await copy.evaluate(button=>button.click());
 await page.mouse.up();await expect(panel(page)).toBeVisible();
 expect((await exportedDocument(page)).elements).toEqual(before);
 await begin();
 // Switching documents must cancel drafts, but the settings panel stays visible.
 await page.locator(`[data-tab-id="${otherId}"]`).evaluate(button=>button.click());
 await page.mouse.up();await expect(panel(page)).toBeVisible();
 expect((await exportedDocument(page)).id).toBe(otherId);
 await tab.click();expect((await exportedDocument(page)).elements).toEqual(before);
});

test('list settings stay visible when the selected layer enters and exits WYSIWYG',async({page})=>{
 const text='Title\\nFirst\\nSecond';
 const first=text.indexOf('First'),second=text.indexOf('Second');
 await seed(page,{text,paragraphRuns:[run(first,{listKind:'bullet'}),run(second,{listKind:'bullet'})]});
 await page.locator('#layers .layer-name').filter({hasText:'List sample'}).click();
 await configure(page).click();
 const settings=panel(page);
 await expect(settings).toBeVisible();
 // This used to close the floating menu through openInlineText -> hideInspector.
 await edit(page);
 await expect(settings).toBeVisible();
 await press(page,'Control+Home','ArrowDown','Home');
 await expect(settings.locator('[data-list-target-note]')).toBeHidden();
 await preset(page,'◆').click();
 expect((await model(page)).paragraphRuns).toEqual([
  autoRun(first,{listKind:'bullet',listMarker:'◆'}),run(second,{listKind:'bullet'}),
 ]);
 await done(page);
 await expect(settings).toBeVisible();
 // Even leaving the entire text layer selected must not implicitly dismiss it.
 const empty=await canvasPoint(page,610,430,width,height);
 await page.mouse.click(empty.x,empty.y);
 await expect(settings).toBeVisible();
 await settings.locator('[data-list-close]').click();
 await expect(settings).toBeHidden();
});

test('list settings stay open across real caret clicks and retarget only existing list paragraphs',async({page})=>{
 const text='Title\nAlpha\nPlain\nBeta';
 const alpha=text.indexOf('Alpha'),beta=text.indexOf('Beta');
 const original=[run(alpha,{listKind:'bullet'}),run(beta,{listKind:'bullet'})];
 await seed(page,{text,paragraphRuns:original});
 await edit(page);await press(page,'Control+Home','ArrowDown','Home');
 await configure(page).click();
 await expect(panel(page)).toBeVisible();

 const clickRow=async index=>{
  const rect=await host(page).locator('[data-wysiwyg-row]').nth(index)
   .locator('[data-wysiwyg-fragment]').first().boundingBox();
  await page.mouse.click(rect.x+Math.min(12,rect.width/2),rect.y+rect.height/2);
 };
 await clickRow(3);
 await expect(panel(page)).toBeVisible();
 const [anchor,focus]=await selection(page);
 expect(anchor).toBe(focus);
 expect(anchor).toBeGreaterThanOrEqual(beta);
 await preset(page,'◆').click();
 expect((await model(page)).paragraphRuns).toEqual([
  run(alpha,{listKind:'bullet'}),autoRun(beta,{listKind:'bullet',listMarker:'◆'}),
 ]);
 await clickRow(2);
 await expect(panel(page)).toBeVisible();
 await expect(panel(page).locator('[data-list-target-note]')).toBeVisible();
 await expect(preset(page,'◇')).toBeDisabled();
 expect((await model(page)).paragraphRuns).toEqual([
  run(alpha,{listKind:'bullet'}),autoRun(beta,{listKind:'bullet',listMarker:'◆'}),
 ]);
 await clickRow(1);
 await expect(panel(page).locator('[data-list-target-note]')).toBeHidden();
 await preset(page,'◇').click();
 expect((await model(page)).paragraphRuns).toEqual([
  autoRun(alpha,{listKind:'bullet',listMarker:'◇'}),autoRun(beta,{listKind:'bullet',listMarker:'◆'}),
 ]);
 await press(page,'Escape');
 await expect(panel(page)).toBeHidden();
});

test('settings retain the backward WYSIWYG range and isolate mixed list kinds and plain paragraphs',async({page})=>{
 const text='Title\nFirst\nPlain\nSecond\nNine\nTen\nEnd';
 const first=text.indexOf('First'),second=text.indexOf('Second'),nine=text.indexOf('Nine'),ten=text.indexOf('Ten');
 const original=[run(first,{listKind:'bullet'}),run(second,{listKind:'bullet',listItemSpacing:20}),
  run(nine,{listKind:'ordered',listStart:9,listItemSpacing:30}),run(ten,{listKind:'ordered',listItemSpacing:30})];
 await seed(page,{text,paragraphRuns:original});
 await edit(page);await press(page,'Control+Home');
 await expect(configure(page)).toBeDisabled();
 await press(page,'ArrowDown','Home');
 await configure(page).click();
 await expect(panel(page).locator('[data-list-mode=ordered]')).toBeDisabled();
 await expect(field(page,'listItemSpacing')).toHaveValue('0');
 const slider=spacingSlider(page,'listIndent');
 await slider.scrollIntoViewIfNeeded();
 const box=await slider.boundingBox();
 await page.mouse.move(box.x+box.width*.4,box.y+box.height/2);await page.mouse.down();
 await expect(field(page,'listIndent')).not.toHaveValue('0');
 await host(page).focus();await press(page,'Control+End');
 await page.mouse.up();
 await expect(panel(page)).toBeVisible();
 await expect(panel(page).locator('[data-list-target-note]')).toBeVisible();
 expect((await model(page)).paragraphRuns).toEqual(original);
 await press(page,'Control+Shift+Home');expect(await selection(page)).toEqual([text.length,0]);
 await expect(panel(page).locator('[data-list-target-note]')).toBeHidden();
 const mode=key=>panel(page).locator(`[data-list-mode=${key}]`);
 await configure(page).click();await expect(mode('bullet')).toBeFocused();
 await expect(field(page,'listItemSpacing')).toHaveAttribute('placeholder','Mixed');
 await expect(spacingSlider(page,'listItemSpacing')).toHaveAttribute('aria-valuetext','Mixed');
 await mode('ordered').click();await expect(field(page,'listItemSpacing')).toHaveValue('30');
 await mode('bullet').click();expect((await model(page)).paragraphRuns).toEqual(original);
 await field(page,'listItemSpacing').fill('18');await press(page,'Enter');
 const changed=[...original];
 changed[0]=run(first,{listKind:'bullet',listItemSpacing:18});
 changed[1]=run(second,{listKind:'bullet',listItemSpacing:18});
 expect((await model(page)).paragraphRuns).toEqual(changed);
 await host(page).focus();expect(await selection(page)).toEqual([text.length,0]);
 await press(page,'Control+z');expect((await model(page)).paragraphRuns).toEqual(original);
 await press(page,'Control+Shift+z');expect((await model(page)).paragraphRuns).toEqual(changed);
 await configure(page).click();await mode('ordered').click();
 await field(page,'listGap').fill('15');await press(page,'Enter');
 expect((await model(page)).paragraphRuns).toEqual(changed.map(({start,style})=>run(start,style.listKind==='ordered'?{...style,listGap:15}:style)));
 await colorButton(page).click();await expect(page.locator('#fillPopover')).toBeVisible();
 await press(page,'Escape');await expect(colorButton(page)).toBeFocused();
 await press(page,'Escape');await expect(configure(page)).toBeFocused();
 await host(page).focus();expect(await selection(page)).toEqual([text.length,0]);
 await kind(page,'ordered').click();
 expect((await model(page)).paragraphRuns.every(p=>p.style.listKind==='ordered')).toBe(true);
 expect((await model(page)).paragraphRuns).toHaveLength(7);
});

test('custom Unicode markers stay reusable while the document owns its text and markers',async({page},info)=>{
 const lines=['Title','First item','Second item','Plain','Ordered'];
 const text=lines.join('\n'),first=text.indexOf(lines[1]),second=text.indexOf(lines[2]),ordered=text.indexOf(lines[4]);
 const original=[run(first,{listKind:'bullet'}),run(second,{listKind:'bullet',listMarker:'◆'}),
  run(ordered,{listKind:'ordered',listStart:9})];
 const family='👨‍👩‍👧‍👦',flag='🇳🇱',arrow='➤';
 const id=await seed(page,{text,paragraphRuns:original,textRuns:[{start:first,end:first+5,style:{underline:true}}]});
 await edit(page);await press(page,'Control+End','Control+Shift+Home');
 expect(await selection(page)).toEqual([text.length,0]);
 const before=await model(page);
 await expect(page.locator('[data-list-mixed]')).toHaveText('Mixed');
 await configure(page).click();
 const settings=panel(page),input=settings.locator('[data-list-marker-input]'),preview=settings.locator('[data-list-marker-preview]');
 const add=settings.getByRole('button',{name:'Добавить',exact:true});
 const apply=settings.getByRole('button',{name:'Применить',exact:true});
 const gallery=settings.locator('[data-list-library]');
 const saved=marker=>gallery.getByRole('button',{name:'Применить маркер '+marker,exact:true});
 const remove=marker=>gallery.getByRole('button',{name:'Удалить маркер '+marker,exact:true});
 const libraryRecord=async()=>(await records(page,'settings')).find(row=>row.key==='list-markers-v1');
 for(const invalid of [' ', '🦊🔥', '➤\n','\u202e✔️','<svg><foreignObject/></svg>']){
  await input.fill(invalid);
  await expect(input).toHaveAttribute('aria-invalid','true');
  await expect(preview).toBeEmpty();
  await expect(add).toBeDisabled();await expect(apply).toBeDisabled();
 }
 await input.fill('<');await expect(preview).toHaveText('<');
 await add.click();await expect(saved('<')).toHaveText('<');
 await expect(gallery.locator('svg,img,script')).toHaveCount(0);
 await remove('<').click();await expect(saved('<')).toHaveCount(0);
 await input.fill(family);
 await press(page,'Control+a','Control+c','Backspace','Control+v');
 await expect(input).toHaveValue(family);
 await expect(preview).toHaveText(family);
 await add.click();await expect(saved(family)).toHaveText(family);
 await expect(settings.locator('[data-list-library-status]')).toHaveText('Маркер сохранён.');
 await expect(input).toBeFocused();await expect(add).toBeDisabled();
 await expect(settings).toBeVisible();
 for(const marker of [flag,arrow]){
  await input.fill(marker);await add.click();await expect(saved(marker)).toBeVisible();
 }
 expect((await libraryRecord()).markers).toEqual([family,flag,arrow]);
 expect(await model(page)).toEqual(before);
 await input.fill('◆');await expect(add).toBeDisabled();
 await expect(settings.locator('[data-list-presets] [data-list-marker]')).toHaveCount(33);
 await expect(settings.locator('[data-list-presets] [data-list-marker-remove]')).toHaveCount(0);
 await input.fill(family);await apply.click();
 const featured=await model(page);
 expect(featured).toEqual({...before,paragraphRuns:[autoRun(first,{listKind:'bullet',listMarker:family}),
  autoRun(second,{listKind:'bullet',listMarker:family}),original[2]]});
 await expect(saved(family)).toHaveAttribute('aria-pressed','true');
 await expect(colorButton(page)).toBeDisabled();
 await expect(settings.locator('[data-list-color-hint]')).toContainText('Цвет эмодзи задаёт системный шрифт');
 await expect(field(page,'listMarkerOpacity')).toBeEnabled();
 await expect(settings.locator('[data-list-scale-range]')).toHaveAttribute('aria-valuetext','Auto · 70%');
 const draws=()=>markerDraws(page,/^👨‍👩‍👧‍👦$/u);
 expect((await draws()).map(part=>part.text)).toEqual([family,family]);
 expect((await draws())[0].width).toBeGreaterThan(0);
 expect(await host(page).textContent()).toBe(text);
 await input.fill('✔️');
 await input.scrollIntoViewIfNeeded();
 const screenshot=info.outputPath('list-custom-markers.png');
 await settings.screenshot({path:screenshot,animations:'disabled'});
 await info.attach('list-custom-markers',{path:screenshot,contentType:'image/png'});
 await host(page).focus();expect(await selection(page)).toEqual([text.length,0]);
 await press(page,'Control+z');expect(await model(page)).toEqual(before);
 await press(page,'Control+Shift+z');expect(await model(page)).toEqual(featured);
 await configure(page).click();await expect(saved(family)).toHaveAttribute('aria-pressed','true');
 await saved(arrow).click();await expect(saved(arrow)).toHaveAttribute('aria-pressed','true');
 await expect(colorButton(page)).toBeEnabled();
 const originalArrow=(await markerDraws(page,/^➤$/u))[0];
 for(const [key,value] of [['listMarkerScale','64'],['listMarkerOpacity','37'],['listMarkerColor','#c51953'],
  ['listIndent','13'],['listGap','17'],['listItemSpacing','22']]){
  await field(page,key).fill(value);await press(page,'Enter');
 }
 const [painted,next]=(await markerDraws(page,/^➤$/u));
 expect(painted.font).toContain('19.');
 expect(painted.alpha).toBeCloseTo(.37,2);
 expect(painted.color).toBe('#c51953');
 expect(painted.x-originalArrow.x).toBeCloseTo(13);
 expect(next.y-painted.y).toBeGreaterThanOrEqual(22);
 const decorated=await model(page);
 expect(decorated.paragraphRuns[0].style).toEqual({listKind:'bullet',listMarker:arrow,listMarkerScale:64,
  listMarkerOpacity:37,listMarkerColor:'#c51953',listIndent:13,listGap:17,listItemSpacing:22});
 const png=await pngWithoutFocusChange(page);
 const body=settings.locator('.list-style-body');
 await body.evaluate(el=>{el.scrollTop=0;});
 await remove(arrow).click();await expect(saved(arrow)).toHaveCount(0);
 await expect(settings.locator('[data-list-unsaved-marker] bdi')).toHaveText(arrow);
 await expect(settings).toBeVisible();
 expect(await model(page)).toEqual(decorated);
 expect((await libraryRecord()).markers).toEqual([family,flag]);
 expect(await pngWithoutFocusChange(page)).toEqual(png);
 await done(page);
 await expect.poll(async()=>(await records(page,'docs')).find(d=>d.id===id)?.elements[0]).toEqual(decorated);
 await page.reload();await openLibraryDocument(page,id);await edit(page);
 await expect.poll(async()=>await model(page)).toEqual(decorated);
 expect(await pngWithoutFocusChange(page)).toEqual(png);
 await press(page,'Control+End','Control+Shift+Home');await configure(page).click();
 await expect(saved(flag)).toBeVisible();
 await expect(settings.locator('[data-list-unsaved-marker] bdi')).toHaveText(arrow);
 await settings.locator('[data-list-mode=ordered]').click();
 await expect(input).toBeHidden();
 await settings.locator('[data-list-marker-apply]').dispatchEvent('click');
 expect(await model(page)).toEqual(decorated);
});

test('an aborted gallery transaction reports failure without changing the document or tiles',async({page})=>{
 await page.addInitScript(()=>{
  const put=IDBObjectStore.prototype.put;
  let abortNext=true;
  IDBObjectStore.prototype.put=function(record,...args){
   const request=put.call(this,record,...args);
   if(record?.key==='list-markers-v1'&&abortNext){
    abortNext=false;
    request.addEventListener('success',()=>this.transaction.abort());
   }
   return request;
  };
 });
 await seed(page,{paragraphRuns:[run(0,{listKind:'bullet',listMarker:'<svg>',listIndent:10})]});
 await page.locator('#layers .layer-name').filter({hasText:'List sample'}).click();
 const before=await model(page);
 expect(before.paragraphRuns).toEqual([run(0,{listKind:'bullet',listIndent:10})]);
 await configure(page).click();
 const settings=panel(page);
 const add=settings.getByRole('button',{name:'Добавить',exact:true});
 await settings.locator('[data-list-marker-input]').fill('🧑‍💻');
 await add.click();
 await expect(settings.locator('[data-list-library-status]')).toHaveText('Изменение галереи не сохранено.');
 await expect(settings.locator('[data-list-library]')).toBeEmpty();
 await expect(add).toBeEnabled();
 expect((await records(page,'settings')).some(row=>row.key==='list-markers-v1')).toBe(false);
 await add.click();
 await expect(settings.locator('[data-list-library] [data-list-marker]')).toHaveText('🧑‍💻');
 expect((await records(page,'settings')).find(row=>row.key==='list-markers-v1').markers).toEqual(['🧑‍💻']);
 expect(await model(page)).toEqual(before);
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
test('list settings survive caret moves but reject composing and locked targets and cancel gestures',async({page})=>{
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
 await expect(panel(page)).toBeVisible();
 await expect(panel(page).locator('[data-list-target-note]')).toBeVisible();
 await expect(preset(page,'◆')).toBeDisabled();
 await preset(page,'◆').dispatchEvent('click');
 expect((await model(page)).paragraphRuns).toEqual(original);
 await kind(page,'bullet').click();
 const custom=panel(page).locator('[data-list-marker-input]'),apply=panel(page).locator('[data-list-marker-apply]');
 await custom.fill('🇳🇱');
 await custom.dispatchEvent('compositionstart');await expect(apply).toBeDisabled();
 await custom.dispatchEvent('compositionend');await expect(apply).toBeEnabled();
 await host(page).dispatchEvent('compositionstart');
 await expect(panel(page)).toBeVisible();await expect(kind(page,'ordered')).toBeDisabled();
 await expect(configure(page)).toBeDisabled();
 await configure(page).dispatchEvent('click');
 await apply.dispatchEvent('click');
 await expect(panel(page)).toBeVisible();
 await kind(page,'ordered').dispatchEvent('click');
 expect((await model(page)).paragraphRuns.at(-1)).toEqual(autoRun(11,{listKind:'bullet'}));
 await host(page).dispatchEvent('compositionend');
 await page.locator('#wysiwygRecover').click();
 await done(page);
 await kind(page,'bullet').click();
 const lock=page.locator('#inspector [data-action=lock]');
 await lock.click();
 await expect(panel(page)).toBeVisible();await expect(kind(page,'ordered')).toBeDisabled();
 await expect(configure(page)).toBeDisabled();
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

test('WYSIWYG list gaps preserve native source offsets, empty rows and vertical navigation',async({page})=>{
 const text='Alpha\nBeta\n\nPlain\nTail\n';
 const paragraphRuns=[run(0,{listKind:'bullet',listItemSpacing:26}),run(6,{listKind:'bullet',listItemSpacing:14}),
  run(11,{listKind:'bullet',listItemSpacing:90}),run(18,{listKind:'ordered',listStart:9,listItemSpacing:18}),
  run(23,{listKind:'ordered',listItemSpacing:60})];
 await seed(page,{text,paragraphRuns,verticalAlign:'bottom'});
 await edit(page);
 const rows=await host(page).locator('[data-wysiwyg-row]').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().toJSON()));
 expect(rows).toHaveLength(6);
 for(const [i,gap] of [26,14,0,0,18].entries())expect(rows[i+1].top-rows[i].bottom).toBeCloseTo(gap,1);
 expect(await host(page).textContent()).toBe(text);
 expect(await host(page).locator('[data-caret-sentinel]').count()).toBe(1);
 const x=rows[0].left+120,y=rows[0].bottom;
 await page.mouse.click(x,y+4);expect(await selection(page)).toEqual([5,5]);
 await page.mouse.click(x,y+21);expect(await selection(page)).toEqual([6,6]);
 await press(page,'ArrowUp','Home');expect(await selection(page)).toEqual([0,0]);
 await press(page,'ArrowDown','ArrowDown');expect(await selection(page)).toEqual([11,11]);
 await press(page,'ArrowDown','Home');expect(await selection(page)).toEqual([12,12]);
 await press(page,'ArrowDown','ArrowDown');expect(await selection(page)).toEqual([23,23]);
 await press(page,'Shift+ArrowUp');expect(await selection(page)).toEqual([23,18]);
 await page.mouse.move(x,y+21);await page.mouse.down();await page.mouse.move(x,y+4);await page.mouse.up();
 expect(await selection(page)).toEqual([6,5]);
 expect((await model(page)).paragraphRuns).toEqual(paragraphRuns);
});

const img=url=>PNG.sync.read(Buffer.from(url.split(',')[1],'base64')).data;
const maxDelta=(a,b)=>a.reduce((max,value,i)=>Math.max(max,Math.abs(value-b[i])),0);
for(const variant of ['legacy','customized','spaced','Unicode'])test(`live DOM position, ${variant} markers, justify, T1–T3, Canvas and PNG agree`,async({page},info)=>{
 const customized=variant!=='legacy',spaced=variant==='spaced',unicode=variant==='Unicode';
 const marker=unicode?'👨‍👩‍👧‍👦':'◆';
 const text='Straße  one two three four five six seven eight nine\nSmall'+(spaced?'\nNext':'');
 await seed(page,{text,w:250,textAlign:'justify',verticalAlign:'middle',strokeWidth:1,fillOpacity:86,
  paragraphRuns:[run(0,{listKind:'bullet',listMarker:marker,listIndent:8,listGap:12,
   ...(customized?{listMarkerScale:62,listMarkerColor:'#cc203c',listMarkerOpacity:67}:{})}),
   run(text.indexOf('Small'),{listKind:'ordered',listStart:spaced?9:5,
    ...(customized?{listMarkerScale:147,listMarkerColor:'#1467d9',listMarkerOpacity:0}:{}),
    ...(spaced?{listItemSpacing:32}:{})}),
   ...(spaced?[run(text.indexOf('Next'),{listKind:'ordered'})]:[])],
  textRuns:[{start:0,end:6,style:{textCase:'upper',baselineShift:'super',underline:true,
   underlineDetails:{style:'wavy',color:'#d53548'}}},
   ...(spaced?[{start:text.indexOf('Small'),end:text.indexOf('Small')+2,style:{baselineShift:'sub'}}]:[])]},{backgroundAlpha:0});
 await edit(page);
 await expect(host(page)).toHaveClass(/wysiwyg-canvas-ink/);
 expect(await host(page).textContent()).toBe(text.replace('Straße','STRASSE'));
 const markerPattern=unicode?/^(👨‍👩‍👧‍👦|5\.)$/u:/^(◆|5\.|9\.|10\.)$/;
 const markers=await markerDraws(page,markerPattern);
 expect(markers.map(part=>part.text)).toEqual(spaced?[marker,'9.','10.']:[marker,'5.']);
 if(customized){
  expect(markers.slice(0,2).map(part=>part.color)).toEqual([unicode?'#192b40':'#cc203c','#1467d9']);
  expect(markers[0].alpha).toBeCloseTo(.67,2);
  expect(markers[1].alpha).toBe(0);
 }
 const dom=await host(page).locator('[data-wysiwyg-fragment]').evaluateAll(spans=>spans.map(span=>
  ({text:span.textContent.replaceAll('\n',''),x:span.getBoundingClientRect().left-span.closest('#inlineWysiwyg').getBoundingClientRect().left})
 ).filter(part=>part.text));
 const live=img(await page.locator('[data-text-stroke-overlay]').evaluate(el=>el.toDataURL()));
 const draws=(await page.evaluate(()=>listDraws.overlay)).filter(p=>!markerPattern.test(p.text));
 expect(dom.map(p=>p.text)).toEqual(draws.map(p=>p.text));
 const domError=Math.max(...dom.map((p,i)=>Math.abs(p.x-draws[i].x)));
 expect(domError).toBeLessThan(.12);
 expect(dom[0].x).toBeGreaterThan(markers[0].x+markers[0].width);
 const rowOrigins=await host(page).locator('[data-wysiwyg-row]').evaluateAll(rows=>rows.map(row=>
  row.firstChild.getBoundingClientRect().left-row.getBoundingClientRect().left));
 expect(Math.abs(rowOrigins[0]-rowOrigins[1])).toBeLessThan(.12);
 if(spaced){
  const gap=await host(page).locator('[data-wysiwyg-row]').evaluateAll(rows=>rows.at(-1).getBoundingClientRect().top-rows.at(-2).getBoundingClientRect().bottom);
  expect(gap).toBeCloseTo(32,1);
 }
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
 await panel(page).locator('[data-list-marker-input]').fill('👨‍👩‍👧‍👦');
 await panel(page).getByRole('button',{name:'Применить',exact:true}).click();
 const custom=await model(page);
 expect(custom.text).toBe(text);
 expect(custom.fontSize).toBeLessThanOrEqual(bullet.fontSize);
 expect(custom.paragraphRuns).toEqual([autoRun(0,{listKind:'bullet',listMarker:'👨‍👩‍👧‍👦'})]);
 await page.locator('#undoBtn').click();
 expect(await model(page)).toEqual(bullet);
 await page.locator('#undoBtn').click();
 expect(await model(page)).toEqual(plain);
});
test('vertical text retains imported paragraph runs with list commands disabled',async({page})=>{
 const paragraphRuns=[run(0,{listKind:'ordered'})];
 await seed(page,{textMode:'vertical',paragraphRuns});
 await page.locator('#layers .layer-name').filter({hasText:'List sample'}).click();
 await expect(kind(page,'bullet')).toBeDisabled();
 await expect(configure(page)).toBeDisabled();
 await kind(page,'bullet').dispatchEvent('click');
 expect((await model(page)).paragraphRuns).toEqual(paragraphRuns);
});

test.describe('mobile native bridge',()=>{
 test.use({viewport:{width:390,height:844},hasTouch:true});
 test('mobile Canvas and PNG preserve custom graphemes without a gallery',async({page,browserName})=>{
  test.skip(browserName!=='chromium','Android-sized touch behavior is covered in Chromium.');
  const text='First item\nSecond item',family='👨‍👩‍👧‍👦',flag='🇳🇱';
  const paragraphRuns=[run(0,{listKind:'bullet',listMarker:family,listMarkerScale:85,listMarkerOpacity:45,listGap:13}),
   autoRun(text.indexOf('Second'),{listKind:'bullet',listMarker:flag})];
  const id=await seed(page,{text,paragraphRuns});
  const markerDrawsFor=target=>page.evaluate(({target,family,flag})=>listDraws[target].filter(p=>[family,flag].includes(p.text)),
   {target,family,flag});
  const canvas=await markerDrawsFor('canvas');
  expect(canvas.map(p=>p.text)).toEqual([family,flag]);
  expect(canvas.every(p=>p.width>0)).toBe(true);
  expect(canvas[0].alpha).toBeCloseTo(.45,2);
  await page.evaluate(()=>{listDraws.export=[];});
  await exportPNG(page,width,height);
  expect(await markerDrawsFor('export')).toEqual(canvas);
  expect((await records(page,'settings')).some(row=>row.key==='list-markers-v1')).toBe(false);
  const stored=(await records(page,'docs')).find(doc=>doc.id===id).elements[0];
  expect(stored.text).toBe(text);
  expect(stored.paragraphRuns).toEqual(paragraphRuns);
 });
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
