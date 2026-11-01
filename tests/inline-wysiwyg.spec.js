const {test,expect,openHome,importPayload,records,openLibraryDocument,exportedDocument,canvasPoint}=require('./helpers');
const fixture=require('./fixtures/canvas-graph.json');
const surface='#inlineWysiwyg';
const getLayer=doc=>doc.elements.find(e=>e.id==='title');
async function seed(page,{flag=true,patch={},palette,fonts}={}){
 await openHome(page,flag?'/?experimentalTextWysiwyg=1':'/');
 const payload=structuredClone(fixture);if(fonts)payload.fonts=fonts;payload.documents=[payload.documents[0]];
 const doc=payload.documents[0];if(palette)doc.palette=palette;doc.groups=[];doc.elements=doc.elements.filter(e=>e.id==='title');
 Object.assign(doc.elements[0],{text:'A',textRuns:[{start:0,end:1,style:{fontWeight:'700',textColor:'#ff0000'}}],autoFontSize:false,rotation:0,textAlign:'left',verticalAlign:'top',...patch});
 await importPayload(page,payload);await expect(page.locator('#toast')).toContainText('Импортировано проектов');
 const stored=(await records(page,'docs')).find(d=>getLayer(d));await openLibraryDocument(page,stored.id);return stored;
}
async function edit(page){const p=await canvasPoint(page,100,175);await page.mouse.dblclick(p.x,p.y);await expect(page.locator('#inlineText:visible,#inlineWysiwyg:visible')).toBeFocused();}
async function state(page){return page.locator(surface).evaluate(el=>{
 const sel=getSelection();const offset=(node,n)=>{const r=document.createRange();r.setStart(el,0);r.setEnd(node,n);return r.toString().length;};
 return {text:el.textContent,anchor:offset(sel.anchorNode,sel.anchorOffset),focus:offset(sel.focusNode,sel.focusOffset)};
});}
async function value(page){return getLayer(await exportedDocument(page));}
// Observe the real JSON export Blob without asking Chromium to download a file
// for every intermediate Undo/Redo state. Actual downloads remain covered by
// exportedDocument() elsewhere; these two long tests would otherwise issue
// eleven successive automatic downloads in a single page.
async function snapshotValue(page){
 const payload=await page.evaluate(async()=>{
  const originalClick=HTMLAnchorElement.prototype.click;
  let blobUrl=null;
  HTMLAnchorElement.prototype.click=function(...args){
   if(this.download?.endsWith('.json')&&this.href.startsWith('blob:')){blobUrl=this.href;return;}
   return originalClick.apply(this,args);
  };
  try{
   const button=document.querySelector('#jsonExportBtn');
   if(!button)throw Error('JSON export control missing');
   button.click();
   if(!blobUrl)throw Error('JSON exporter did not create a downloadable Blob');
   const response=await fetch(blobUrl);
   if(!response.ok)throw Error('JSON export Blob could not be read');
   return JSON.parse(await response.text());
  }finally{HTMLAnchorElement.prototype.click=originalClick;}
 });
 expect(payload.format).toBe('kartochnaya-v1');
 return getLayer(payload.document);
}
async function redPixels(page){return page.locator('#canvas').evaluate(canvas=>{const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>180&&pixels[i+1]<70&&pixels[i+2]<70&&pixels[i+3])count++;return count;});}

test('opt-in input, three undo/redo, single document commit and persistence',async({page})=>{
 const initial=await seed(page);expect(await redPixels(page)).toBeGreaterThan(0);await edit(page);await expect.poll(()=>redPixels(page)).toBe(0);await expect(page.locator(surface)).toBeFocused();await expect(page.locator('#inlineText')).toBeHidden();
 await page.keyboard.type('X');await page.keyboard.press('Enter');expect(await state(page)).toEqual({text:'AX\n',anchor:3,focus:3});
 await page.keyboard.type('Z');const changed=await value(page);expect(changed.text).toBe('AX\nZ');expect(changed.textRuns).toEqual([{start:0,end:4,style:{fontWeight:'700',textColor:'#ff0000'}}]);
 for(const [text,caret] of [['AX\n',3],['AX',2],['A',1]]){await page.keyboard.press('Control+z');expect(await state(page)).toEqual({text,anchor:caret,focus:caret});expect((await value(page)).textRuns).toEqual([{start:0,end:text.length,style:{fontWeight:'700',textColor:'#ff0000'}}]);}
 for(const [text,caret] of [['AX',2],['AX\n',3],['AX\nZ',4]]){await page.keyboard.press('Control+Shift+z');expect(await state(page)).toEqual({text,anchor:caret,focus:caret});}
 await page.keyboard.press('Control+Enter');await expect(page.locator(surface)).toBeHidden();expect(await redPixels(page)).toBeGreaterThan(0);
 await page.locator('#undoBtn').click();expect((await value(page)).text).toBe('A');await page.locator('#redoBtn').click();expect(await value(page)).toEqual(changed);
 await expect.poll(async()=>getLayer((await records(page,'docs')).find(d=>d.id===initial.id))).toEqual(changed);
 await page.reload();await expect(page.locator('#homeScreen')).toBeVisible();await openLibraryDocument(page,initial.id);expect(await value(page)).toEqual(changed);
});
test('UTF-16 emoji, full deletion, continued session and Escape restore exact layer',async({page})=>{
 const initial=await seed(page,{patch:{text:'A😀B',textRuns:[{start:1,end:3,style:{fontWeight:'700',textColor:'#ff0000'}}]}});await edit(page);
 await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await page.keyboard.type('X');
 expect((await value(page)).text).toBe('A😀XB');expect((await value(page)).textRuns).toEqual([{start:1,end:4,style:{fontWeight:'700',textColor:'#ff0000'}}]);
 await page.keyboard.press('Control+a');await page.keyboard.press('Backspace');expect((await value(page)).text).toBe('');await page.keyboard.type('Q');expect((await value(page)).text).toBe('Q');
 await page.keyboard.press('Escape');expect(await value(page)).toEqual(getLayer(initial));
});
test('without flag the legacy textarea edits normally',async({page})=>{
 await seed(page,{flag:false});await edit(page);await expect(page.locator('#inlineText')).toBeFocused();await page.keyboard.type('X');await page.keyboard.press('Control+Enter');expect((await value(page)).text).toBe('AX');
});
for(const [name,patch] of Object.entries({autoFit:{autoFontSize:true},center:{textAlign:'center'},unavailableFont:{fontFamily:'DefinitelyMissingFont987'},mask:{layerMaskSrc:'data:image/png;base64,AA=='},CRLF:{text:'A\r\nБ',textRuns:[{start:0,end:4,style:{bold:true}}]}}))test('textarea eligibility and unchanged open/close: '+name,async({page})=>{
 const initial=await seed(page,{patch});await edit(page);await expect(page.locator('#inlineText')).toBeFocused();await expect(page.locator(surface)).toBeHidden();await page.keyboard.press('Control+Enter');expect(await value(page)).toEqual(getLayer(initial));
});
test('geometry at 50, 100 and 200 percent uses document coordinates',async({page})=>{
 await page.setViewportSize({width:2200,height:1600});await seed(page);await edit(page);
 for(const zoom of [50,100,200]){
  for(let i=0;i<60;i++){const current=parseInt(await page.locator('#zoomLabel').textContent());if(current===zoom)break;await page.locator('#stageScroller').dispatchEvent('wheel',{ctrlKey:true,deltaY:current<zoom?-10:10,clientX:800,clientY:600});}
  await expect(page.locator('#zoomLabel')).toHaveText(zoom+'%');
  await expect(page.locator(surface)).toBeFocused();
  const e=await value(page);const rect=await page.locator(surface).boundingBox(),point=await canvasPoint(page,e.x,e.y);
  expect(Math.abs(rect.x-point.x)).toBeLessThan(1);expect(Math.abs(rect.y-point.y)).toBeLessThan(1);expect(Math.abs(rect.width-e.w*zoom/100)).toBeLessThan(1);
 }
 await page.keyboard.press('Control+Enter');
});
test('unsupported formatting falls back preserving backward Selection',async({page})=>{
 await seed(page,{patch:{text:'AB',textRuns:[{start:0,end:2,style:{bold:true}}]}});await edit(page);await page.keyboard.press('End');await page.keyboard.press('Shift+ArrowLeft');
 await page.locator(surface).evaluate(el=>el.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'formatBold'})));
 await expect(page.locator('#inlineText')).toBeFocused();expect(await page.locator('#inlineText').evaluate(el=>[el.selectionStart,el.selectionEnd,el.selectionDirection])).toEqual([1,2,'backward']);expect((await value(page)).text).toBe('AB');await page.keyboard.press('Control+z');await page.keyboard.press('Control+Shift+z');expect(await page.locator('#inlineText').evaluate(el=>[el.selectionStart,el.selectionEnd,el.selectionDirection])).toEqual([1,2,'backward']);
});
test('unconfirmed DOM and composition require explicit recovery',async({page})=>{
 await seed(page);await edit(page);
 await page.locator(surface).evaluate(el=>{el.append(document.createTextNode('unconfirmed'));el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'unconfirmed'}));});
 expect((await value(page)).text).toBe('A');await page.keyboard.press('Control+z');await expect(page.locator(surface)).toContainText('unconfirmed');await expect(page.locator('#wysiwygRecovery')).toBeVisible();await page.locator('#wysiwygRecover').click();expect((await value(page)).text).toBe('A');
 await page.locator(surface).focus();await page.locator(surface).evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.append('IME');});
 await page.locator('#wysiwygRecover').click();await expect(page.locator(surface)).toContainText('IME');expect((await value(page)).text).toBe('A');
 await page.locator(surface).evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));await page.locator('#wysiwygRecover').click();await expect(page.locator(surface)).toHaveText('A');
 await page.locator(surface).focus();await page.locator(surface).evaluate(el=>{el.append('pending');el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'pending'}));});
 await page.keyboard.press('Control+Enter');await expect(page.locator('.archived')).toContainText('Apending');expect((await value(page)).text).toBe('A');
 await edit(page);await page.keyboard.type('X');expect((await value(page)).text).toBe('AX');await page.keyboard.press('Escape');
 await page.locator('.archived button').click();await expect(page.locator('.archived')).toHaveCount(0);
});
test.describe('mobile viewport',()=>{test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true});test('flag retains mobile textarea',async({page})=>{
 await seed(page);await page.locator('[data-mobile=layers]:visible').tap();await page.locator('#mobileLayerList [data-layer="title"] .layer-name').tap();await page.locator('#mobileLayersClose').tap();await page.locator('#mobileContext [data-mobile=edit]').tap();await expect(page.locator('#inlineText')).toBeFocused();await expect(page.locator(surface)).toBeHidden();
});});

test('native paste, Backspace/Delete, blur and document tab close preserve styles',async({page,context})=>{
 const initial=await seed(page);await context.grantPermissions(['clipboard-read','clipboard-write']);await edit(page);
 await page.evaluate(()=>navigator.clipboard.writeText('P\nQ'));await page.keyboard.press('Control+v');expect((await value(page)).text).toBe('AP\nQ');
 await page.keyboard.press('Backspace');expect((await value(page)).text).toBe('AP\n');await page.keyboard.press('ArrowLeft');await page.keyboard.press('Delete');expect((await value(page)).text).toBe('AP');
 await page.locator('#documentTabsHome').click();await expect(page.locator(surface)).toBeHidden();
 await page.locator(`[data-tab-id="${initial.id}"]`).click();await edit(page);await page.keyboard.type('X');
 await page.keyboard.press('Control+w');await expect(page.locator(surface)).toBeHidden();
 await openLibraryDocument(page,initial.id);const changed=await value(page);expect(changed.text).toBe('APX');expect(changed.textRuns).toEqual([{start:0,end:3,style:{fontWeight:'700',textColor:'#ff0000'}}]);
});

test('inspector formatting directly applies the selected range',async({page})=>{
 await seed(page,{patch:{text:'AB',textRuns:[{start:0,end:2,style:{bold:true}}]}});await edit(page);await page.keyboard.press('End');await page.keyboard.press('Shift+ArrowLeft');
 const size=page.locator('#inspector input[data-key=fontSize]');await size.fill('24');await expect(size).toBeFocused();await size.press('Tab');await expect(page.locator(surface)).toBeVisible();await expect(page.locator('#inlineText')).toBeHidden();
 const changed=await value(page);expect(changed.text).toBe('AB');expect(changed.textRuns).toEqual([{start:0,end:1,style:{bold:true}},{start:1,end:2,style:{bold:true,fontSize:24}}]);
});

// Selection is established with native keyboard events; formatting uses the
// shipping inspector, font menu and picker rather than a session test API.
async function selectRange(page,anchor,focus){
 await page.locator(surface).focus();await page.keyboard.press('Control+Home');
 // Fixtures before the emoji use BMP characters; ArrowRight crosses the emoji
 // as one scalar while offsets below remain UTF-16.
 const text=(await value(page)).text;
 const steps=offset=>Array.from(text.slice(0,offset)).length;
 for(let i=0;i<steps(anchor);i++)await page.keyboard.press('ArrowRight');
 for(let i=0;i<Math.abs(steps(focus)-steps(anchor));i++)await page.keyboard.press(focus<anchor?'Shift+ArrowLeft':'Shift+ArrowRight');
 expect(await state(page)).toEqual({text,anchor,focus});
}
async function openColor(page){await page.locator('#inspector [data-fill-open=fill]').click();await expect(page.locator('#fillPopover')).toBeVisible();}
async function hexColor(page,hex,final=true){const field=page.locator('#fillPopover [data-cp-part="0"]');await field.fill(hex);await expect(field).toBeFocused();if(final)await field.press('Tab');}
async function assertRange(page,text,anchor,focus){await page.locator(surface).focus();expect(await state(page)).toEqual({text,anchor,focus});await expect(page.locator('#inlineText')).toBeHidden();await expect(page.locator('#wysiwygRecovery')).toBeHidden();}
const boldRuns=[{start:0,end:4,style:{bold:true}}];
const rangeRuns=color=>[{start:0,end:1,style:{bold:true}},{start:1,end:3,style:{bold:true,textColor:color}},{start:3,end:4,style:{bold:true}}];

test('range color, one live preview history action, Canvas, document undo and reload',async({page})=>{
 const doc=await seed(page,{patch:{text:'ABCD',fontSize:20,textRuns:boldRuns}});await edit(page);const outsideColor=await page.locator(surface+' span').first().evaluate(s=>getComputedStyle(s).color);await selectRange(page,1,3);await openColor(page);
 for(const hex of ['#990011','#2244aa','#11aa33'])await hexColor(page,hex,false);
 expect((await value(page)).textRuns).toEqual(rangeRuns('#11aa33'));await expect(page.locator(surface)).toBeVisible();
 await page.locator('#fillPopover [data-cp-part="0"]').press('Tab');
 expect(await page.locator(surface+' span').evaluateAll(spans=>spans.map(s=>[s.textContent,getComputedStyle(s).color]))).toEqual([['A',outsideColor],['BC','rgb(17, 170, 51)'],['D',outsideColor]]);
 await page.locator('[data-fill-close]').click();await assertRange(page,'ABCD',1,3);
 await page.keyboard.press('Control+z');expect((await value(page)).textRuns).toEqual(boldRuns);await assertRange(page,'ABCD',1,3);
 await page.keyboard.press('Control+Shift+z');expect((await value(page)).textRuns).toEqual(rangeRuns('#11aa33'));await assertRange(page,'ABCD',1,3);
 const changed=await value(page);await page.keyboard.press('Control+Enter');
 expect(await page.locator('#canvas').evaluate(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=0;i<d.length;i+=4)if(d[i]===17&&d[i+1]===170&&d[i+2]===51&&d[i+3])return true;return false;})).toBe(true);
 await page.locator('#undoBtn').click();expect((await value(page)).textRuns).toEqual(boldRuns);await page.locator('#redoBtn').click();expect(await value(page)).toEqual(changed);
 await expect.poll(async()=>getLayer((await records(page,'docs')).find(d=>d.id===doc.id))).toEqual(changed);
 await page.reload();await openLibraryDocument(page,doc.id);expect(await value(page)).toEqual(changed);await edit(page);await expect(page.locator(surface)).toBeVisible();
});

test('backward range, font menu, variant, scaled size and numeric native undo ownership',async({page})=>{
 const initial=await seed(page,{patch:{text:'ABCD',fontSize:20,textRunsBaseFontSize:40,textRuns:[{start:0,end:4,style:{bold:true,fontSize:44}}]}});await edit(page);await selectRange(page,3,1);
 await page.locator('#inspector [data-font-open]').click();await page.locator('#inspector [data-font-option="Georgia"]').click();await assertRange(page,'ABCD',3,1);
 await page.locator('#inspector [data-key=fontVariant]').selectOption('500:normal');await assertRange(page,'ABCD',3,1);
 const beforeSize=await value(page),size=page.locator('#inspector [data-key=fontSize]');await size.fill('28');await expect(size).toBeFocused();
 expect((await value(page)).textRuns).toEqual([{start:0,end:1,style:{bold:true,fontSize:44}},{start:1,end:3,style:{fontFamily:'Georgia',fontSize:56,fontStyle:'normal',fontWeight:'500'}},{start:3,end:4,style:{bold:true,fontSize:44}}]);
 expect(await page.locator(surface+' span').nth(1).evaluate(s=>getComputedStyle(s).fontSize)).toBe('28px');
 const changed=await value(page);expect(changed.textRunsBaseFontSize).toBe(40);expect([changed.x,changed.y,changed.w,changed.h]).toEqual([getLayer(initial).x,getLayer(initial).y,getLayer(initial).w,getLayer(initial).h]);
 await size.press('Tab');await assertRange(page,'ABCD',3,1);await page.keyboard.press('Control+z');expect(await value(page)).toEqual(beforeSize);await assertRange(page,'ABCD',3,1);await page.keyboard.press('Control+Shift+z');expect(await value(page)).toEqual(changed);await assertRange(page,'ABCD',3,1);
 await size.focus();await size.evaluate(el=>el.addEventListener('keydown',e=>{if(e.code==='KeyZ')el.dataset.undoPrevented=String(e.defaultPrevented)}));await size.press('Control+z');expect(await size.getAttribute('data-undo-prevented')).toBe('false');
 await size.press('Escape');expect(await value(page)).toEqual(getLayer(initial));
});

test('emoji range color and size preserve UTF-16 boundaries and Undo',async({page})=>{
 const initial=await seed(page,{patch:{text:'A😀Б',fontSize:20,textRuns:[{start:0,end:4,style:{bold:true}}]}});await edit(page);await selectRange(page,1,3);await openColor(page);await hexColor(page,'#11aa33');await page.locator('[data-fill-close]').click();
 const color=await value(page);expect(color.textRuns).toEqual(rangeRuns('#11aa33'));
 const size=page.locator('#inspector [data-key=fontSize]');await size.fill('28');await expect(size).toBeFocused();await size.press('Tab');
 expect((await value(page)).textRuns).toEqual([{start:0,end:1,style:{bold:true}},{start:1,end:3,style:{bold:true,fontSize:28,textColor:'#11aa33'}},{start:3,end:4,style:{bold:true}}]);
 await assertRange(page,'A😀Б',1,3);await page.keyboard.press('Control+z');expect(await value(page)).toEqual(color);await page.keyboard.press('Control+z');expect(await value(page)).toEqual(getLayer(initial));await assertRange(page,'A😀Б',1,3);
});

test('mixed typing Enter and formatting history, branch truncation and pending preview close',async({page})=>{
 await seed(page,{patch:{text:'ABCD',fontSize:20,textRuns:boldRuns}});await edit(page);await page.keyboard.type('X');await page.keyboard.press('Enter');const typed=await snapshotValue(page);await selectRange(page,1,3);
 const spacing=page.locator('#inspector [data-key=letterSpacing]');await spacing.fill('2');await spacing.press('Tab');const formatted=await snapshotValue(page);await assertRange(page,'ABCDX\n',1,3);
 await page.keyboard.press('Control+z');expect(await snapshotValue(page)).toEqual(typed);await assertRange(page,'ABCDX\n',1,3);
 await page.keyboard.press('Control+z');expect((await snapshotValue(page)).text).toBe('ABCDX');await assertRange(page,'ABCDX',5,5);
 await page.keyboard.press('Control+Shift+z');expect(await snapshotValue(page)).toEqual(typed);await assertRange(page,'ABCDX\n',1,3);
 await page.keyboard.press('Control+Shift+z');expect(await snapshotValue(page)).toEqual(formatted);await assertRange(page,'ABCDX\n',1,3);
 await page.keyboard.press('Control+z');await page.keyboard.type('Y');const branch=await snapshotValue(page);await page.keyboard.press('Control+Shift+z');expect(await snapshotValue(page)).toEqual(branch);
 await selectRange(page,0,1);await spacing.fill('3');await spacing.press('Control+Enter');await expect(page.locator(surface)).toBeHidden();expect((await snapshotValue(page)).textRuns[0].style.letterSpacing).toBe(3);
});

for(const property of ['lineHeight','autoFit'])test('unsupported inspector action safely hands off after panel focus: '+property,async({page})=>{
 await seed(page,{patch:{text:'ABCD',fontSize:20,textRuns:boldRuns}});await edit(page);await selectRange(page,3,1);
 // Focus transfer without pointerdown, then native Tab between panel inputs.
 const variant=page.locator('#inspector [data-key=fontVariant]');await variant.focus();await page.keyboard.press('Tab');
 const size=page.locator('#inspector [data-key=fontSize]');await expect(size).toBeFocused();await expect(page.locator(surface)).toBeVisible();await expect(page.locator('#wysiwygRecovery')).toBeHidden();
 if(property==='lineHeight'){const field=page.locator('#inspector [data-key=lineHeight]');await field.fill('1.5');await field.press('Tab');}else await page.locator('#inspector [data-text-auto-font]').check();
 await expect(page.locator(surface)).toBeHidden();await expect(page.locator('#inlineText')).toBeVisible();await expect(page.locator('#wysiwygRecovery')).toBeHidden();expect((await value(page)).text).toBe('ABCD');expect((await value(page)).textRuns).toEqual(boldRuns);
 expect(await page.locator('#inlineText').evaluate(el=>[el.selectionStart,el.selectionEnd,el.selectionDirection])).toEqual([1,3,'backward']);
});

test('palette, hue slider and square use direct range previews with one Undo each',async({page})=>{
 await seed(page,{palette:['#cc2244'],patch:{text:'ABCD',fontSize:20,textRuns:boldRuns}});await edit(page);await selectRange(page,3,1);await openColor(page);
 const palette=page.locator('#fillPopover [data-fill-palette]').first(),hex=await palette.getAttribute('data-fill-palette');await palette.click();
 expect((await value(page)).textRuns).toEqual(rangeRuns(hex));await assertRange(page,'ABCD',3,1);
 // Palette click keeps the picker open; hue input/change come from real keys.
 const hue=page.locator('#cpHue');await hue.focus();await hue.press('ArrowRight');const slider=await value(page);expect(slider.textRuns[1].style.textColor).not.toBe(hex);await expect(page.locator(surface)).toBeVisible();
 await assertRange(page,'ABCD',3,1);await page.keyboard.press('Control+z');expect((await value(page)).textRuns).toEqual(rangeRuns(hex));await page.keyboard.press('Control+Shift+z');expect(await value(page)).toEqual(slider);
 const square=await page.locator('#cpSquare').boundingBox();await page.mouse.move(square.x+square.width*.3,square.y+square.height*.3);await page.mouse.down();await page.mouse.move(square.x+square.width*.6,square.y+square.height*.5,{steps:4});await page.mouse.up();
 const colored=await value(page);expect(colored.text).toBe('ABCD');expect(colored.textRuns[1].style.textColor).not.toBe(slider.textRuns[1].style.textColor);await assertRange(page,'ABCD',3,1);
 await page.keyboard.press('Control+z');expect(await value(page)).toEqual(slider);await page.keyboard.press('Control+Shift+z');expect(await value(page)).toEqual(colored);
});

test('numeric previews from origin, no-op history and ordinary input finalize once',async({page})=>{
 await seed(page,{patch:{text:'ABCD',fontSize:20,textRuns:boldRuns}});await edit(page);await page.keyboard.type('X');const typed=await snapshotValue(page);await selectRange(page,1,3);
 const size=page.locator('#inspector [data-key=fontSize]');for(const n of ['24','28','20']){await size.fill(n);await expect(size).toBeFocused();}await size.press('Tab');expect(await snapshotValue(page)).toEqual(typed);
 await assertRange(page,'ABCDX',1,3);await page.keyboard.press('Control+z');expect((await snapshotValue(page)).text).toBe('ABCD');await page.keyboard.press('Control+Shift+z');expect(await snapshotValue(page)).toEqual(typed);
 await selectRange(page,1,3);await size.fill('28');await size.fill('30');await assertRange(page,'ABCDX',1,3);const formatted=await snapshotValue(page);
 await page.keyboard.type('Y');const afterInput=await snapshotValue(page);await page.keyboard.press('Control+z');expect(await snapshotValue(page)).toEqual(formatted);await page.keyboard.press('Control+z');expect(await snapshotValue(page)).toEqual(typed);
 await page.keyboard.press('Control+Shift+z');expect(await snapshotValue(page)).toEqual(formatted);await page.keyboard.press('Control+Shift+z');expect(await snapshotValue(page)).toEqual(afterInput);
});

test('unmeasurable style projection safely hands off with no partial preview history',async({page})=>{
 await seed(page,{patch:{text:'ABCD',fontSize:20,textRuns:boldRuns}});await edit(page);await selectRange(page,3,1);
 await page.evaluate(()=>{const measure=CanvasRenderingContext2D.prototype.measureText;CanvasRenderingContext2D.prototype.measureText=function(text){const result=measure.call(this,text);return text==='Mg'?{width:result.width}:result;};});
 const size=page.locator('#inspector [data-key=fontSize]');await size.fill('28');await expect(page.locator(surface)).toBeHidden();await expect(page.locator('#inlineText')).toBeVisible();await expect(page.locator('#wysiwygRecovery')).toBeHidden();await size.press('Tab');
 expect((await value(page)).textRuns).toEqual([{start:0,end:1,style:{bold:true}},{start:1,end:3,style:{bold:true,fontSize:28}},{start:3,end:4,style:{bold:true}}]);
 await page.locator('#inlineText').focus();await page.keyboard.press('Control+z');expect((await value(page)).textRuns).toEqual(boldRuns);
});

test('collapsed WYSIWYG caret hands off for a whole-layer size change',async({page})=>{
 await seed(page,{patch:{text:'ABCD',fontSize:20,textRuns:boldRuns}});await edit(page);await assertRange(page,'ABCD',4,4);
 const size=page.locator('#inspector [data-key=fontSize]');await size.fill('28');await size.press('Tab');await expect(page.locator(surface)).toBeHidden();await expect(page.locator('#inlineText')).toBeVisible();await expect(page.locator('#wysiwygRecovery')).toBeHidden();
 const changed=await value(page);expect(changed.fontSize).toBe(28);expect(changed.text).toBe('ABCD');expect(changed.textRuns).toEqual(boldRuns);
});

// A real uploaded font with compatible top/alphabetic metrics. Arial 32 is an
// explicit failing transition below; this fixture does not stand in for it.
const plainFont={name:'Nimbus Sans Regular',family:'Nimbus Sans',weight:400,style:'normal',data:'data:font/otf;base64,'+require('node:fs').readFileSync(require('node:path').join(__dirname,'fixtures/fonts/NimbusSans-Regular.otf')).toString('base64')};
async function seedPlain(page,patch={},options={}){
 return seed(page,{fonts:[plainFont],...options,patch:{text:'ABCD',fontFamily:'Nimbus Sans',fontSize:26,lineHeight:1.03,textRuns:undefined,...patch}});
}

test('plain compatible layer opens with a virtual span; no-op close has no model, history or IDB writes',async({page})=>{
 await page.addInitScript(()=>{window.docWrites=0;const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='docs')window.docWrites++;return put.apply(this,args)};});
 const doc=await seedPlain(page),initial=getLayer(doc);expect(initial).not.toHaveProperty('textRuns');expect(initial).not.toHaveProperty('textRunsBaseFontSize');
 const undo=await page.locator('#undoBtn').isEnabled();await page.waitForTimeout(700);const writes=await page.evaluate(()=>window.docWrites);
 await edit(page);await expect(page.locator(surface)).toBeFocused();expect(await snapshotValue(page)).toEqual(initial);
 expect(await page.locator(surface+' span').allTextContents()).toEqual(['ABCD']);
 await selectRange(page,3,1);await page.keyboard.press('ArrowRight');await page.keyboard.press('Control+Enter');
 expect(await snapshotValue(page)).toEqual(initial);expect(await page.locator('#undoBtn').isEnabled()).toBe(undo);
 await page.waitForTimeout(700);expect(await page.evaluate(()=>window.docWrites)).toBe(writes);expect(getLayer((await records(page,'docs')).find(d=>d.id===doc.id))).toEqual(initial);
});

test('plain first range color stays sparse, previews undo to absence, redo and persistence reopen',async({page})=>{
 const doc=await seedPlain(page),initial=getLayer(doc);await edit(page);await selectRange(page,3,1);await openColor(page);
 for(const color of ['#bb1133','#11aa33'])await hexColor(page,color,false);
 expect((await snapshotValue(page)).textRuns).toEqual([{start:1,end:3,style:{textColor:'#11aa33'}}]);
 await page.locator('#fillPopover [data-cp-part="0"]').press('Tab');await page.locator('[data-fill-close]').click();await assertRange(page,'ABCD',3,1);
 expect(await page.locator(surface+' span').evaluateAll(spans=>spans.map(s=>[s.textContent,getComputedStyle(s).fontFamily,getComputedStyle(s).fontSize,getComputedStyle(s).letterSpacing]))).toEqual(['A','BC','D'].map(t=>[t,'"Nimbus Sans"','26px','normal']));
 const changed=await snapshotValue(page);expect(changed).not.toHaveProperty('textRunsBaseFontSize');
 await page.keyboard.press('Control+z');expect(await snapshotValue(page)).toEqual(initial);await assertRange(page,'ABCD',3,1);
 await page.keyboard.press('Control+Shift+z');expect(await snapshotValue(page)).toEqual(changed);await page.keyboard.press('Control+Enter');
 await expect.poll(async()=>getLayer((await records(page,'docs')).find(d=>d.id===doc.id))).toEqual(changed);
 await page.reload();await openLibraryDocument(page,doc.id);await edit(page);await expect(page.locator(surface)).toBeFocused();expect(await snapshotValue(page)).toEqual(changed);
 await page.keyboard.press('Escape');expect(await snapshotValue(page)).toEqual(changed);
});

test('plain typing formatting typing mixed history and Escape preserve exact structure',async({page})=>{
 const doc=await seedPlain(page),initial=getLayer(doc);await edit(page);await page.keyboard.type('H');const typed=await snapshotValue(page);expect(typed.text).toBe('ABCDH');expect(typed).not.toHaveProperty('textRuns');expect(typed).not.toHaveProperty('textRunsBaseFontSize');
 await selectRange(page,1,3);const spacing=page.locator('#inspector [data-key=letterSpacing]');await spacing.fill('1');await spacing.press('Tab');await assertRange(page,'ABCDH',1,3);const formatted=await snapshotValue(page);
 await page.keyboard.type('Y');const after=await snapshotValue(page);
 for(const expected of [formatted,typed,initial]){await page.keyboard.press('Control+z');expect(await snapshotValue(page)).toEqual(expected)}
 for(const expected of [typed,formatted,after]){await page.keyboard.press('Control+Shift+z');expect(await snapshotValue(page)).toEqual(expected)}
 await page.keyboard.press('Escape');expect(await snapshotValue(page)).toEqual(initial);
});

for(const key of ['fontFamily','fontSize'])test('plain first '+key+' works without closing and Escape removes first runs',async({page})=>{
 const doc=await seedPlain(page),initial=getLayer(doc);await edit(page);await selectRange(page,1,3);
 if(key==='fontFamily'){await page.locator('#inspector [data-font-open]').click();await page.locator('#inspector [data-font-option="Georgia"]').click()}
 else {const field=page.locator('#inspector [data-key=fontSize]');await field.fill('40');await expect(field).toBeFocused();await field.press('Tab')}
 await assertRange(page,'ABCD',1,3);const changed=await snapshotValue(page);expect(changed.textRuns).toEqual([{start:1,end:3,style:{[key]:key==='fontSize'?40:'Georgia'}}]);
 const styles=await page.locator(surface+' span').evaluateAll(spans=>spans.map(s=>[getComputedStyle(s).fontFamily,getComputedStyle(s).fontSize]));expect(styles[0]).toEqual(['"Nimbus Sans"','26px']);expect(styles[2]).toEqual(styles[0]);
 await page.keyboard.press('Control+z');expect(await snapshotValue(page)).toEqual(initial);await page.keyboard.press('Control+Shift+z');expect(await snapshotValue(page)).toEqual(changed);
 await page.keyboard.press('Escape');expect(await snapshotValue(page)).toEqual(initial);
});

// Native Canvas calls retain actual font metrics. No app internals, screenshots
// or expected images are patched to make the two painters agree.
async function observePlainGeometry(page){
 await page.addInitScript(()=>{
  window.plainFrame=[];const proto=CanvasRenderingContext2D.prototype,clear=proto.clearRect,fill=proto.fillText;
  proto.clearRect=function(...args){if(this.canvas.id==='canvas')window.plainFrame=[];return clear.apply(this,args)};
  proto.fillText=function(text,x,y,...args){
   if(this.canvas.id==='canvas'){
    const m=this.measureText(text);const saved=this.textBaseline;this.textBaseline='alphabetic';const a=this.measureText(text);this.textBaseline=saved;
    window.plainFrame.push({text,x,y,baseline:y+a.actualBoundingBoxAscent-m.actualBoundingBoxAscent,top:y-m.actualBoundingBoxAscent,bottom:y+m.actualBoundingBoxDescent,width:m.width,font:this.font,spacing:this.letterSpacing,mode:saved});
   }
   return fill.call(this,text,x,y,...args);
  };
 });
}
const plainFrame=page=>page.evaluate(()=>window.plainFrame);
async function zoomTo(page,zoom){
 for(let i=0;i<60;i++){const current=parseInt(await page.locator('#zoomLabel').textContent());if(current===zoom)break;await page.locator('#stageScroller').dispatchEvent('wheel',{ctrlKey:true,deltaY:current<zoom?-10:10,clientX:800,clientY:600})}
 await expect(page.locator('#zoomLabel')).toHaveText(zoom+'%');
}
const canvasPixels=page=>page.locator('#canvas').evaluate(c=>c.toDataURL());
const plainCases=[
 ['single line',{text:'ABCD'},true],
 ['explicit LF',{text:'ABCD\nABCD'},true],
 ['automatic wrap',{text:'alpha beta gamma delta',w:170},false],
 ['long words',{text:'abcdefghijklmnop qrstuvwxyzabcdefghijklmnop',w:170},false],
 ['Cyrillic spaces emoji',{text:'Группа  А😀Б'},false],
];
for(const [name,patch,compatible] of plainCases)test('plain real geometry at 50/100/200: '+name,async({page},testInfo)=>{
 await page.setViewportSize({width:2200,height:1600});await observePlainGeometry(page);
 const doc=await seedPlain(page,{y:80,h:120,...patch}),initial=getLayer(doc);await page.locator('#layers [data-layer="title"] .layer-name').click();
 const evidence=[];
 for(const zoom of [50,100,200]){
  await zoomTo(page,zoom);const before=await plainFrame(page),pixels=await canvasPixels(page);expect(before.length).toBeGreaterThan(0);
  await edit(page);await expect(page.locator(compatible?surface:'#inlineText')).toBeFocused();
  if(compatible){
   const geometry=await page.locator(surface).evaluate(el=>{
    const host=el.getBoundingClientRect(),scale=host.width/parseFloat(el.style.width),walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),chars=[];
    for(let node;node=walk.nextNode();)for(let i=0;i<node.length;){const end=i+String.fromCodePoint(node.data.codePointAt(i)).length,r=document.createRange();r.setStart(node,i);r.setEnd(node,end);const b=r.getBoundingClientRect();chars.push({text:node.data.slice(i,end),x:(b.x-host.x)/scale,y:(b.y-host.y)/scale,width:b.width/scale});i=end}
    return chars;
   });
   const rows=geometry.filter(c=>c.text!=='\n').reduce((out,c)=>{let row=out.find(r=>Math.abs(r.y-c.y)<.5);if(!row)out.push(row={y:c.y,text:'',x:c.x,end:c.x});row.text+=c.text;row.end=c.x+c.width;return out},[]);
   expect(rows.map(r=>r.text)).toEqual(before.map(r=>r.text));
   rows.forEach((r,i)=>{expect(Math.abs(r.x-before[i].x)).toBeLessThan(.5);expect(Math.abs(r.end-r.x-before[i].width)).toBeLessThan(.5)});
   evidence.push({zoom,canvas:before,dom:geometry});
  }else evidence.push({zoom,canvas:before,fallback:true});
  await page.keyboard.press('Control+Enter');expect(await snapshotValue(page)).toEqual(initial);expect(await plainFrame(page)).toEqual(before);expect(await canvasPixels(page)).toBe(pixels);
 }
 if(compatible){
  await edit(page);await selectRange(page,1,3);await openColor(page);await hexColor(page,'#11aa33');await page.locator('[data-fill-close]').click();await assertRange(page,initial.text,1,3);await page.keyboard.press('Control+Enter');
  const mixed=await plainFrame(page),legacy=evidence.at(-1).canvas;expect(mixed.every(d=>d.mode==='alphabetic')).toBe(true);
  for(const part of mixed){const row=legacy.find(d=>Math.abs(d.baseline-part.baseline)<=.5);expect(row).toBeTruthy();expect(part.font).toBe(row.font);expect(part.spacing).toBe(row.spacing)}
  const expected=await page.evaluate(({mixed,legacy})=>{
   const c=document.createElement('canvas').getContext('2d'),offsets=legacy.map(()=>0);
   return mixed.map(part=>{const i=legacy.findIndex(r=>Math.abs(r.baseline-part.baseline)<=.5),row=legacy[i];c.font=row.font;c.fontKerning='normal';c.letterSpacing=row.spacing||'0px';c.textBaseline='alphabetic';const m=c.measureText(part.text),x=c.measureText(row.text.slice(0,offsets[i])).width;offsets[i]+=part.text.length;return {x,width:m.width,top:row.baseline-m.actualBoundingBoxAscent,bottom:row.baseline+m.actualBoundingBoxDescent}});
  },{mixed,legacy});
  mixed.forEach((part,i)=>{expect(Math.abs(part.x-expected[i].x)).toBeLessThanOrEqual(1);expect(Math.abs(part.top-expected[i].top)).toBeLessThanOrEqual(.5);expect(Math.abs(part.bottom-expected[i].bottom)).toBeLessThanOrEqual(.5);expect(part.width).toBeCloseTo(expected[i].width,5)});
  expect(mixed.map(d=>d.text).join('')).toBe(legacy.map(d=>d.text).join(''));evidence.push({firstColor:mixed});
 }
 await testInfo.attach('plain-layout.json',{body:JSON.stringify(evidence,null,2),contentType:'application/json'});
});

test('plain Arial 32 transition reproducer: baseline jump keeps legacy textarea',async({page},testInfo)=>{
 await observePlainGeometry(page);const doc=await seedPlain(page,{text:'ABCD',fontFamily:'Arial',fontSize:32,lineHeight:1.15});await page.locator('#layers [data-layer="title"] .layer-name').click();const legacy=await plainFrame(page);
 await edit(page);await expect(page.locator('#inlineText')).toBeFocused();await expect(page.locator(surface)).toBeHidden();await page.keyboard.press('Control+Enter');expect(await snapshotValue(page)).toEqual(getLayer(doc));expect(await plainFrame(page)).toEqual(legacy);
 // Reproduce the existing first-run transition through the real legacy inspector.
 await edit(page);await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('Shift+ArrowRight');await openColor(page);await hexColor(page,'#11aa33');await page.locator('[data-fill-close]').click();await page.locator('#inlineText').focus();await page.keyboard.press('Control+Enter');
 const mixed=await plainFrame(page);expect(mixed[0].baseline-legacy[0].baseline).toBeGreaterThan(4);expect(mixed[0].baseline-legacy[0].baseline).toBeLessThan(5);
 await testInfo.attach('arial32-transition.json',{body:JSON.stringify({legacy,mixed},null,2),contentType:'application/json'});
});

for(const [name,patch] of Object.entries({autoFit:{autoFontSize:true},rotation:{rotation:10},vertical:{textMode:'vertical'},effect:{effects:[{type:'blur',enabled:true}]},mask:{mask:true},CRLF:{text:'A\r\nB'},center:{textAlign:'center'}}))test('plain unsupported eligibility retains textarea: '+name,async({page})=>{
 const doc=await seedPlain(page,patch);await edit(page);await expect(page.locator('#inlineText')).toBeFocused();await expect(page.locator(surface)).toBeHidden();await page.keyboard.press('Control+Enter');expect(await snapshotValue(page)).toEqual(getLayer(doc));
});
test('plain without flag retains textarea',async({page})=>{await seedPlain(page,{}, {flag:false});await edit(page);await expect(page.locator('#inlineText')).toBeFocused();await expect(page.locator(surface)).toBeHidden()});

test('plain ordinary typing commit and reopen never fabricates runs',async({page})=>{
 const doc=await seedPlain(page);await edit(page);await page.keyboard.type('H');await page.keyboard.press('Control+Enter');const typed=await snapshotValue(page);expect(typed.text).toBe('ABCDH');expect(typed).not.toHaveProperty('textRuns');expect(typed).not.toHaveProperty('textRunsBaseFontSize');await expect.poll(async()=>getLayer((await records(page,'docs')).find(d=>d.id===doc.id))).toEqual(typed);await page.reload();await openLibraryDocument(page,doc.id);await edit(page);await expect(page.locator(surface)).toBeFocused();expect(await snapshotValue(page)).toEqual(typed);
});


test('plain typing an incompatible wrap hands off without fabricating runs',async({page})=>{
 await seedPlain(page);await edit(page);await page.keyboard.type(' HHHHHHHHHHHHHHHHHHHHHHHH');await expect(page.locator(surface)).toBeHidden();await expect(page.locator('#inlineText')).toBeVisible();const layer=await snapshotValue(page);expect(layer.text).toBe('ABCD HHHHHHHHHHHHHHHHHHHHHHHH');expect(layer).not.toHaveProperty('textRuns');expect(layer).not.toHaveProperty('textRunsBaseFontSize');await page.keyboard.press('Escape');
});
test('plain no-op formatting keeps absent runs and native numeric undo ownership',async({page})=>{
 const initial=getLayer(await seedPlain(page));await edit(page);await selectRange(page,1,3);const size=page.locator('#inspector [data-key=fontSize]');await size.fill('26');await size.press('Tab');expect(await snapshotValue(page)).toEqual(initial);
 await size.focus();await size.evaluate(el=>el.addEventListener('keydown',e=>{if(e.code==='KeyZ')el.dataset.undoPrevented=String(e.defaultPrevented)}));await size.press('Control+z');expect(await size.getAttribute('data-undo-prevented')).toBe('false');await size.press('Escape');expect(await snapshotValue(page)).toEqual(initial);
});
test.describe('plain mobile viewport',()=>{test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true});test('plain flag retains mobile textarea',async({page})=>{
 await seedPlain(page);await page.locator('[data-mobile=layers]:visible').tap();await page.locator('#mobileLayerList [data-layer="title"] .layer-name').tap();await page.locator('#mobileLayersClose').tap();await page.locator('#mobileContext [data-mobile=edit]').tap();await expect(page.locator('#inlineText')).toBeFocused();await expect(page.locator(surface)).toBeHidden();expect(await snapshotValue(page)).not.toHaveProperty('textRuns');
});});

test('plain near-width shaping reproducer stays on textarea before first color adds a wrap',async({page},testInfo)=>{
 const editNarrow=async()=>{const p=await canvasPoint(page,64,175);await page.mouse.dblclick(p.x,p.y)};
 await observePlainGeometry(page);const doc=await seedPlain(page,{fontSize:32,lineHeight:1,w:88,h:100});await page.locator('#layers [data-layer="title"] .layer-name').click();const legacy=await plainFrame(page);expect(legacy).toHaveLength(1);
 await editNarrow();await expect(page.locator('#inlineText')).toBeFocused();await expect(page.locator(surface)).toBeHidden();await page.keyboard.press('Control+Enter');expect(await snapshotValue(page)).toEqual(getLayer(doc));
 await editNarrow();await page.keyboard.press('Control+Home');await page.keyboard.press('ArrowRight');await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('Shift+ArrowRight');expect(await page.locator('#inlineText').evaluate(el=>[el.selectionStart,el.selectionEnd])).toEqual([1,3]);await openColor(page);await hexColor(page,'#11aa33');expect((await snapshotValue(page)).textRuns).toEqual([{start:1,end:3,style:{textColor:'#11aa33'}}]);await page.locator('[data-fill-close]').click();await page.locator('#inlineText').focus();await page.keyboard.press('Control+Enter');
 const mixed=await plainFrame(page);expect(new Set(mixed.map(d=>d.baseline)).size).toBe(2);await testInfo.attach('near-width-transition.json',{body:JSON.stringify({legacy,mixed},null,2),contentType:'application/json'});
});


test('plain typing stronger kerning hands off with exact UTF-16 caret and absent runs',async({page})=>{
 const initial=getLayer(await seedPlain(page));await edit(page);await page.keyboard.type('X');await expect(page.locator('#inlineText')).toBeFocused();await expect(page.locator(surface)).toBeHidden();expect(await page.locator('#inlineText').evaluate(el=>[el.value,el.selectionStart,el.selectionEnd])).toEqual(['ABCDX',5,5]);expect(await snapshotValue(page)).not.toHaveProperty('textRuns');await page.keyboard.press('Escape');expect(await snapshotValue(page)).toEqual(initial);
});


test('plain native metrics guard explicitly records the Nimbus 32 Firefox exception',async({page,browserName},testInfo)=>{
 const initial=getLayer(await seedPlain(page,{fontSize:32,lineHeight:1}));
 const metrics=await page.evaluate(()=>{const c=document.createElement('canvas').getContext('2d');c.font='32px "Nimbus Sans"';c.textBaseline='top';const top=c.measureText('ABCD').actualBoundingBoxAscent;c.textBaseline='alphabetic';const m=c.measureText('ABCD'),legacy=m.actualBoundingBoxAscent-top,rich=m.fontBoundingBoxAscent+(Math.max(32,m.fontBoundingBoxAscent+m.fontBoundingBoxDescent)-m.fontBoundingBoxAscent-m.fontBoundingBoxDescent)/2;return {legacy,rich,delta:rich-legacy}});
 if(browserName==='firefox')expect(Math.abs(metrics.delta)).toBeGreaterThan(.5);else expect(Math.abs(metrics.delta)).toBeLessThanOrEqual(.5);
 await edit(page);await expect(page.locator(browserName==='firefox'?'#inlineText':surface)).toBeFocused();await page.keyboard.press('Control+Enter');expect(await snapshotValue(page)).toEqual(initial);await testInfo.attach('nimbus32-native-metrics.json',{body:JSON.stringify(metrics,null,2),contentType:'application/json'});
});
