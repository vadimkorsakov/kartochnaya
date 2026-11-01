const {test,expect,openHome,importPayload,records,openLibraryDocument,exportedDocument,canvasPoint}=require('./helpers');
const fixture=require('./fixtures/canvas-graph.json');
const surface='#inlineWysiwyg';
const getLayer=doc=>doc.elements.find(e=>e.id==='title');
async function seed(page,{flag=true,patch={},palette}={}){
 await openHome(page,flag?'/?experimentalTextWysiwyg=1':'/');
 const payload=structuredClone(fixture);payload.documents=[payload.documents[0]];
 const doc=payload.documents[0];if(palette)doc.palette=palette;doc.groups=[];doc.elements=doc.elements.filter(e=>e.id==='title');
 Object.assign(doc.elements[0],{text:'A',textRuns:[{start:0,end:1,style:{fontWeight:'700',textColor:'#ff0000'}}],autoFontSize:false,rotation:0,textAlign:'left',verticalAlign:'top',...patch});
 await importPayload(page,payload);await expect(page.locator('#toast')).toContainText('Импортировано проектов');
 const stored=(await records(page,'docs')).find(d=>getLayer(d));await openLibraryDocument(page,stored.id);return stored;
}
async function edit(page){const p=await canvasPoint(page,100,175);await page.mouse.dblclick(p.x,p.y);}
async function state(page){return page.locator(surface).evaluate(el=>{
 const sel=getSelection();const offset=(node,n)=>{const r=document.createRange();r.setStart(el,0);r.setEnd(node,n);return r.toString().length;};
 return {text:el.textContent,anchor:offset(sel.anchorNode,sel.anchorOffset),focus:offset(sel.focusNode,sel.focusOffset)};
});}
async function value(page){return getLayer(await exportedDocument(page));}
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
 await seed(page,{patch:{text:'ABCD',fontSize:20,textRuns:boldRuns}});await edit(page);await page.keyboard.type('X');await page.keyboard.press('Enter');const typed=await value(page);await selectRange(page,1,3);
 const spacing=page.locator('#inspector [data-key=letterSpacing]');await spacing.fill('2');await spacing.press('Tab');const formatted=await value(page);await assertRange(page,'ABCDX\n',1,3);
 await page.keyboard.press('Control+z');expect(await value(page)).toEqual(typed);await assertRange(page,'ABCDX\n',1,3);
 await page.keyboard.press('Control+z');expect((await value(page)).text).toBe('ABCDX');await assertRange(page,'ABCDX',5,5);
 await page.keyboard.press('Control+Shift+z');expect(await value(page)).toEqual(typed);await assertRange(page,'ABCDX\n',1,3);
 await page.keyboard.press('Control+Shift+z');expect(await value(page)).toEqual(formatted);await assertRange(page,'ABCDX\n',1,3);
 await page.keyboard.press('Control+z');await page.keyboard.type('Y');const branch=await value(page);await page.keyboard.press('Control+Shift+z');expect(await value(page)).toEqual(branch);
 await selectRange(page,0,1);await spacing.fill('3');await spacing.press('Control+Enter');await expect(page.locator(surface)).toBeHidden();expect((await value(page)).textRuns[0].style.letterSpacing).toBe(3);
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
 await seed(page,{patch:{text:'ABCD',fontSize:20,textRuns:boldRuns}});await edit(page);await page.keyboard.type('X');const typed=await value(page);await selectRange(page,1,3);
 const size=page.locator('#inspector [data-key=fontSize]');for(const n of ['24','28','20']){await size.fill(n);await expect(size).toBeFocused();}await size.press('Tab');expect(await value(page)).toEqual(typed);
 await assertRange(page,'ABCDX',1,3);await page.keyboard.press('Control+z');expect((await value(page)).text).toBe('ABCD');await page.keyboard.press('Control+Shift+z');expect(await value(page)).toEqual(typed);
 await selectRange(page,1,3);await size.fill('28');await size.fill('30');await assertRange(page,'ABCDX',1,3);const formatted=await value(page);
 await page.keyboard.type('Y');const afterInput=await value(page);await page.keyboard.press('Control+z');expect(await value(page)).toEqual(formatted);await page.keyboard.press('Control+z');expect(await value(page)).toEqual(typed);
 await page.keyboard.press('Control+Shift+z');expect(await value(page)).toEqual(formatted);await page.keyboard.press('Control+Shift+z');expect(await value(page)).toEqual(afterInput);
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
