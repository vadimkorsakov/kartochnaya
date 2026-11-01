const {test,expect,openHome,importPayload,records,openLibraryDocument,exportedDocument,canvasPoint}=require('./helpers');
const fixture=require('./fixtures/canvas-graph.json');
const surface='#inlineWysiwyg';
const getLayer=doc=>doc.elements.find(e=>e.id==='title');
async function seed(page,{flag=true,patch={}}={}){
 await openHome(page,flag?'/?experimentalTextWysiwyg=1':'/');
 const payload=structuredClone(fixture);payload.documents=[payload.documents[0]];
 const doc=payload.documents[0];doc.groups=[];doc.elements=doc.elements.filter(e=>e.id==='title');
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

test('inspector formatting hands off before applying the selected range',async({page})=>{
 await seed(page,{patch:{text:'AB',textRuns:[{start:0,end:2,style:{bold:true}}]}});await edit(page);await page.keyboard.press('End');await page.keyboard.press('Shift+ArrowLeft');
 const size=page.locator('#inspector input[data-key=fontSize]');await size.fill('24');await size.press('Tab');await expect(page.locator(surface)).toBeHidden();await expect(page.locator('#inlineText')).toBeVisible();
 const changed=await value(page);expect(changed.text).toBe('AB');expect(changed.textRuns).toEqual([{start:0,end:1,style:{bold:true}},{start:1,end:2,style:{bold:true,fontSize:24}}]);
});
