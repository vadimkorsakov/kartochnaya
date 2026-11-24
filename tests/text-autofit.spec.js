const { test, expect, openHome, createDocument, canvasPoint, exportedDocument, importPayload, openLibraryDocument, records, exportPNG, fixturePath } = require('./helpers');
const {model} = require('./support/text-interaction');
const fixture = require('./fixtures/canvas-graph.json');

async function drawTextFrame(page, value = 'Текст') {
  // Native textarea-specific regressions retain their explicit fallback mode.
  await openHome(page,'/?experimentalTextWysiwyg=0');
  await createDocument(page, 'Text autofit', 320, 240);
  await page.keyboard.press('t');
  const a = await canvasPoint(page, 30, 40), b = await canvasPoint(page, 270, 130);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
  await expect(page.locator('#inlineText')).toBeFocused();
  await page.locator('#inlineText').fill(value);
  await page.locator('#inlineText').press('ControlOrMeta+Enter');
  await expect(page.locator('#inlineText')).toBeHidden();
  return (await exportedDocument(page)).elements[0];
}
const historyCount = page => page.locator('#historyEntries [data-history-index]').count();

test('a new horizontal frame automatically fits font size to the text', async ({ page }) => {
  const e = await drawTextFrame(page, 'Короткий текст');
  expect(e.autoFontSize).toBe(true);
  expect(e.fontSize).toBeGreaterThan(20);
  expect(e.w).toBe(240);
  expect(e.h).toBe(90);
  await expect(page.locator('#inspector [data-text-auto-font]')).toBeChecked();
});

test('disabling auto sizing preserves manual font size even when the frame is resized', async ({ page }) => {
  const original = await drawTextFrame(page, 'Пример');
  const auto = page.locator('#inspector [data-text-auto-font]');
  await auto.uncheck();
  expect((await exportedDocument(page)).elements[0].autoFontSize).toBe(false);
  const size = page.locator('#inspector [data-key="fontSize"]');
  await size.fill('22');
  await size.press('Enter');
  await expect(auto).not.toBeChecked();
  const width = page.locator('#inspector [data-key="w"]');
  await width.fill('125');
  await width.press('Enter');
  const now = (await exportedDocument(page)).elements[0];
  expect(now.fontSize).toBe(22);
  expect(now.w).toBe(125);
  await auto.check();
  const fitted = (await exportedDocument(page)).elements[0];
  expect(fitted.autoFontSize).toBe(true);
  expect(fitted.fontSize).not.toBe(22);
  expect(fitted.text).toBe(original.text);
});

test('double click on an edge fits text box to its content with a single Undo', async ({ page }) => {
  await drawTextFrame(page, 'Привет');
  const toggle = page.locator('#inspector [data-text-auto-font]');
  await toggle.uncheck();
  const size = page.locator('#inspector [data-key="fontSize"]');
  await size.fill('24'); await size.press('Enter');
  const before = (await exportedDocument(page)).elements[0], count = await historyCount(page);
  const p = await canvasPoint(page, before.x + before.w / 2, before.y + 1);
  await page.mouse.dblclick(p.x, p.y);
  const after = (await exportedDocument(page)).elements[0];
  expect(after.text).toBe('Привет');
  expect(after.w).toBeLessThan(before.w);
  expect(after.h).toBeLessThan(before.h);
  expect(await historyCount(page)).toBe(count + 1);
  await expect(page.locator('#inlineText')).toBeHidden();
  await page.locator('#undoBtn').click();
  expect((await exportedDocument(page)).elements[0].w).toBe(before.w);
  await page.locator('#redoBtn').click();
  expect((await exportedDocument(page)).elements[0].w).toBe(after.w);
  const inside = await canvasPoint(page, after.x + after.w / 2, after.y + after.h / 2);
  await page.mouse.dblclick(inside.x, inside.y);
  await expect(page.locator('#inlineText')).toBeFocused();
});

test('fixed-size text keeps its Canvas line breaks while editing near the wrap boundary', async ({ page }) => {
  await drawTextFrame(page, 'подбор шрифта для текстовой карточки');
  await page.locator('#inspector [data-text-auto-font]').uncheck();
  const size = page.locator('#inspector [data-key="fontSize"]');
  await size.fill('24'); await size.press('Enter');
  const targetWidth = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('2d');
    c.font = 'normal 400 24px Arial';
    return Math.ceil(c.measureText('подбор шрифта для').width) + 4;
  });
  const width = page.locator('#inspector [data-key="w"]');
  await width.fill(String(targetWidth)); await width.press('Enter');
  const height = page.locator('#inspector [data-key="h"]');
  await height.fill('62'); await height.press('Enter');
  const layer = (await exportedDocument(page)).elements[0];
  const p = await canvasPoint(page, layer.x + Math.min(layer.w / 2, 60), layer.y + 20);
  await page.mouse.dblclick(p.x, p.y);
  await expect(page.locator('#inlineText')).toBeFocused();
  const metrics = await page.locator('#inlineText').evaluate(el => ({
    clientWidth: el.clientWidth, scrollWidth: el.scrollWidth,
    clientHeight: el.clientHeight, scrollHeight: el.scrollHeight,
    scrollbarWidth: getComputedStyle(el).scrollbarWidth
  }));
  expect(metrics.scrollbarWidth).toBe('none');
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight);
  await page.locator('#inlineText').press('ControlOrMeta+Enter');
  expect((await exportedDocument(page)).elements[0].text).toBe(layer.text);
});

test('auto font adjusts when text changes; empty text keeps a persistent frame', async ({ page }) => {
  await openHome(page,'/?experimentalTextWysiwyg=0'); await createDocument(page, 'Live sizing');
  await page.keyboard.press('t');
  const a = await canvasPoint(page, 20, 20), b = await canvasPoint(page, 180, 65);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y); await page.mouse.up();
  const editor = page.locator('#inlineText');
  await editor.fill('А');
  const first = await editor.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  await editor.fill('Слово за словом возникает длинная строка и много переносов текста');
  const second = await editor.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  expect(second).toBeLessThan(first);
  await editor.fill('');
  await editor.press('ControlOrMeta+Enter');
  const e = (await exportedDocument(page)).elements[0];
  expect(e.text).toBe('');
  expect(e.autoFontSize).toBe(true);
  expect(e.w).toBe(160);
  expect(e.h).toBe(45);
});


test('new auto-fit text box opens live WYSIWYG and fits initial typing',async({page,browserName})=>{
 await openHome(page);await createDocument(page,'Live auto sizing',320,240);
 await page.keyboard.press('t');const a=await canvasPoint(page,30,40),b=await canvasPoint(page,270,130);
 await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});await page.mouse.up();
 await expect(page.locator('#inlineWysiwyg')).toBeFocused();
 await expect(page.locator('#inlineText')).toBeHidden();
 const initial=(await exportedDocument(page)).elements[0];expect(initial.autoFontSize).toBe(true);expect(initial.text).toBe('');
 await page.keyboard.press('KeyA');
 expect((await model(page)).text).toBe('a');
 await page.keyboard.press('Backspace');
 await typeLiveText(page,'Текст',browserName);
 const changed=(await exportedDocument(page)).elements[0];
 expect(changed.text).toBe('Текст');expect(changed.autoFontSize).toBe(true);expect(changed.fontSize).toBeGreaterThan(initial.fontSize);
 const actualSize=await page.locator('#inlineWysiwyg [data-wysiwyg-fragment]').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
 if(browserName==='firefox'){
  const {fontDeclarationSize}=await import('../src/render/rich-text-layout.mjs');
  expect(actualSize).toBe(fontDeclarationSize(changed.fontSize));
 }else expect(actualSize).toBe(changed.fontSize);
 await page.keyboard.press('ControlOrMeta+Enter');await expect(page.locator('#inlineWysiwyg')).toBeHidden();
 expect((await exportedDocument(page)).elements[0]).toEqual(changed);
});

async function typeLiveText(page, value, browserName) {
 // Playwright's Firefox inserts unmapped Cyrillic via synthetic IME, which
 // deliberately enters the editor's recovery mode. Exercise regular input.
 if(browserName!=='firefox'){await page.keyboard.type(value);return;}
 await page.locator('#inlineWysiwyg').evaluate((host,text)=>{
  for(const data of text)host.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertText',data,bubbles:true,cancelable:true}));
 },value);
}

function copyLiveText(editor) {
 return editor.evaluate(host=>{
  const data=new DataTransfer(),copy=new Event('copy',{bubbles:true,cancelable:true});
  Object.defineProperty(copy,'clipboardData',{value:data});
  host.dispatchEvent(copy);
  return data.getData('text/plain');
 });
}

async function drawLiveFrame(page, w, h, docW=320, docH=240) {
 await openHome(page);await createDocument(page,'T4.3',docW,docH);
 await page.keyboard.press('t');
 const a=await canvasPoint(page,24,24,docW,docH),b=await canvasPoint(page,24+w,24+h,docW,docH);
 await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});await page.mouse.up();
 const editor=page.locator('#inlineWysiwyg');await expect(editor).toBeFocused();
 return editor;
}
function nativeSelection(editor, offsets) {
 return editor.evaluate((host,offsets)=>{
  const leaves=document.createTreeWalker(host,NodeFilter.SHOW_TEXT);
  const native=getSelection();
  if(offsets){
   const nodes=[];
   while(leaves.nextNode())nodes.push(leaves.currentNode);
   const point=offset=>{
    for(const node of nodes){if(offset<node.length)return [node,offset];offset-=node.length;}
    return [nodes.at(-1),nodes.at(-1).length];
   };
   native.setBaseAndExtent(...point(offsets[0]),...point(offsets[1]));
  }
  const sourceOffset=(node,offset)=>{const range=document.createRange();range.setStart(host,0);range.setEnd(node,offset);return range.toString().length;};
  return [sourceOffset(native.anchorNode,native.anchorOffset),sourceOffset(native.focusNode,native.focusOffset)];
 },offsets);
}

test('typing, list settings, frame resize and the compact toggle retain source and backward selection',async({page,browserName})=>{
 const editor=await drawLiveFrame(page,180,190);
 const lines=['Тест автоматического подбора размера текста.','Список:','Пункт 1','Пункт 2','Пункт 3'];
 for(const [i,line] of lines.entries()){
  if(i)await page.keyboard.press('Enter');
  await typeLiveText(page,line,browserName);
 }
 const text=lines.join('\n');
 const initial=await model(page);expect(initial.text).toBe(text);
 expect(initial.w).toBe(180);expect(initial.h).toBe(190);
 const fragments=editor.locator('[data-wysiwyg-fragment]');
 expect((await fragments.allTextContents()).some(value=>value.includes('автоматического'))).toBe(true);
 const range=[text.length,text.indexOf('Пункт 1')];
 expect(await nativeSelection(editor,range)).toEqual(range);
 await page.locator('[data-list-kind=ordered]').click();
 const panel=page.locator('#listStylePanel');
 await expect(panel).toBeVisible();
 const listed=await model(page);
 expect(listed.paragraphRuns).toHaveLength(3);
 expect(listed.fontSize).toBeLessThanOrEqual(initial.fontSize);
 const toggle=page.getByRole('checkbox',{name:'Автоподбор размера текста под рамку'});
 await expect(toggle).toBeChecked();
 await expect(toggle.locator('..')).toHaveAttribute('title','Автоподбор размера текста под рамку');
 expect((await toggle.locator('..').boundingBox()).width).toBe(36);
 await expect(page.locator('#inspector [data-action=fonts]')).toHaveCount(0);
 await editor.focus();
 expect(await nativeSelection(editor)).toEqual(range);
 await toggle.click();
 await expect(toggle).not.toBeChecked();
 await expect(panel).toBeVisible();
 expect(await nativeSelection(editor)).toEqual(range);
 await toggle.focus();await toggle.press('Space');
 await expect(toggle).toBeChecked();
 await expect(toggle).toBeFocused();
 await expect(panel).toBeVisible();
 await editor.focus();
 expect(await nativeSelection(editor)).toEqual(range);
 await panel.locator('[data-list-close]').click();
 const width=page.locator('#inspector [data-key=w]');
 await width.fill('118');await width.press('Enter');
 const narrow=await model(page);
 expect(narrow.w).toBe(118);
 expect(narrow.fontSize).toBeLessThan(listed.fontSize);
 expect(narrow.text).toBe(text);
 expect(narrow.paragraphRuns).toEqual(listed.paragraphRuns);
 const height=page.locator('#inspector [data-key=h]');
 await height.fill('70');await height.press('Enter');
 const shorter=await model(page);
 expect(shorter.h).toBe(70);expect(shorter.fontSize).toBeLessThan(narrow.fontSize);
 await editor.focus();await page.keyboard.press('ControlOrMeta+Enter');
 const size=page.locator('#inspector [data-key=fontSize]');
 await size.fill('14.5');await size.press('Enter');
 await expect(toggle).not.toBeChecked();
 expect((await model(page)).fontSize).toBe(14.5);
 await page.locator('#undoBtn').click();await expect(toggle).toBeChecked();
 await page.locator('#redoBtn').click();await expect(toggle).not.toBeChecked();
 await page.locator('#inspector [data-action=lock]').click();
 await expect(toggle).toBeDisabled();
});

test('large Russian paste fits in ink geometry and hidden spaces retain native offsets and paint parity',async({page})=>{
 await page.addInitScript(()=>{
  window.autoFitDraws={canvas:[],png:[]};
  const {clearRect,fillText}=CanvasRenderingContext2D.prototype;
  CanvasRenderingContext2D.prototype.clearRect=function(...args){
   if(this.canvas.id==='canvas')window.autoFitDraws.canvas=[];
   return clearRect.apply(this,args);
  };
  CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...args){
   const c=this.canvas, list=c.id==='canvas'?window.autoFitDraws.canvas:
    !c.isConnected&&c.width===640&&c.height===550?window.autoFitDraws.png:null;
   list?.push({text,x,y,font:this.font});
   return fillText.call(this,text,x,y,...args);
  };
 });
 const editor=await drawLiveFrame(page,220,490,640,550);
 const paragraph='При вставке большого объёма текста автоматический подбор иногда выбирает неоправданно маленький размер шрифта. В нижней части текстовой рамки остаётся много свободного места.';
 const text=Array(5).fill(paragraph).join('\n\n');
 await editor.evaluate((host,value)=>{
  const data=new DataTransfer();data.setData('text/plain',value);
  host.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  host.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertFromPaste',dataTransfer:data,bubbles:true,cancelable:true}));
 },text);
 expect(await editor.textContent()).toBe(text);
 const fitted=await model(page);
 expect(fitted.fontSize).toBeGreaterThan(12);
 expect(fitted.fontSize).toBeLessThan(14);
 const geometry=await editor.evaluate(host=>{
  const last=host.lastElementChild;
  const separators=[...host.querySelectorAll('[data-wysiwyg-separator]')];
  return {height:parseFloat(last.style.top)+parseFloat(last.style.height),
   rows:[...host.children].map(row=>[...row.querySelectorAll('[data-wysiwyg-fragment]')].map(span=>span.textContent).join('')),
   separators:separators.map(span=>{const r=document.createRange();r.selectNodeContents(span);return r.getBoundingClientRect().width;})};
 });
 expect(geometry.height).toBeLessThanOrEqual(490.01);
 expect(geometry.height).toBeGreaterThan(470);
 expect(geometry.rows.length).toBeGreaterThan(30);
 expect(geometry.rows.every(line=>!line.startsWith(' '))).toBe(true);
 expect(geometry.separators.length).toBeGreaterThan(0);
 expect(Math.max(...geometry.separators)).toBeLessThan(.5);
 const boundary=await editor.evaluate(host=>{
  const separator=host.querySelector('[data-wysiwyg-separator]');
  const range=document.createRange();range.setStart(host,0);range.setEnd(separator.firstChild,0);
  return range.toString().length;
 });
 await page.keyboard.press('ControlOrMeta+Home');
 await page.keyboard.press('End');
 expect(await nativeSelection(editor)).toEqual([boundary+1,boundary+1]);
 await page.keyboard.press('ArrowDown');
 await page.keyboard.press('Home');
 expect(await nativeSelection(editor)).toEqual([boundary+1,boundary+1]);
 await page.keyboard.press('ArrowUp');
 expect(await nativeSelection(editor)).toEqual([0,0]);
 await nativeSelection(editor,[boundary,boundary]);
 await page.keyboard.press('ArrowRight');expect(await nativeSelection(editor)).toEqual([boundary+1,boundary+1]);
 await page.keyboard.press('Backspace');expect((await model(page)).text).toBe(text.slice(0,boundary)+text.slice(boundary+1));
 await page.keyboard.press('ControlOrMeta+z');expect((await model(page)).text).toBe(text);
 await page.keyboard.press('ControlOrMeta+Shift+z');expect((await model(page)).text).toHaveLength(text.length-1);
 await page.keyboard.press('ControlOrMeta+z');
 await nativeSelection(editor,[boundary+2,boundary-2]);
 const copied=await copyLiveText(editor);
 expect(copied).toBe(text.slice(boundary-2,boundary+2));
 await nativeSelection(editor,[boundary,boundary]);
 await page.keyboard.press('Delete');expect((await model(page)).text).toHaveLength(text.length-1);
 await page.keyboard.press('ControlOrMeta+z');
 expect(await editor.textContent()).toBe(text);
 await page.keyboard.press('ControlOrMeta+Enter');
 await expect(editor).toBeHidden();
 const canvas=await page.evaluate(()=>window.autoFitDraws.canvas);
 expect(canvas.map(part=>part.text)).toEqual(geometry.rows.filter(row=>row.replace(/\n/g,'' )).map(row=>row.replace(/\n/g,'')));
 await exportPNG(page,640,550);
 expect(await page.evaluate(()=>window.autoFitDraws.png)).toEqual(canvas);
 const readStored=async()=> (await records(page,'docs')).find(doc=>doc.title==='T4.3');
 await expect.poll(async()=> (await readStored())?.elements[0]).toEqual(fitted);
 const {id}=await readStored();
 await page.reload();await openLibraryDocument(page,id);
 expect(await model(page)).toEqual(fitted);
});

test('My Fonts still imports a custom face and selecting it refits the layer',async({page})=>{
 await drawTextFrame(page,'WWWWWWWWWWWW');
 const initial=await model(page);
 await page.locator('#libraryBtn').click();
 await page.locator('#editorProjectMenu [data-compact-page=fonts]').click();
 await expect(page.getByRole('button',{name:'Добавить шрифты'})).toBeVisible();
 await page.locator('#fontInput').setInputFiles(fixturePath('fonts/DejaVuSerif.ttf'));
 await expect(page.locator('#toast')).toContainText('Загружено начертаний: 1');
 await page.locator('#inspector [data-font-open]').click();
 await page.locator('#inspector [data-font-option="DejaVu Serif"]').click();
 const fitted=await model(page);
 expect(fitted.fontFamily).toBe('DejaVu Serif');
 expect(fitted.autoFontSize).toBe(true);
 expect(fitted.fontSize).not.toBe(initial.fontSize);
 expect(fitted.text).toBe(initial.text);
});

test('an older saved auto layer renders whole words without changing its stored size on open',async({page})=>{
 await openHome(page);
 const payload=structuredClone(require('./fixtures/visual-text.json'));
 const text='Тест автоматического подбора размера текста.';
 Object.assign(payload.document.elements[0],{text,textMode:'horizontal',x:20,y:20,w:180,h:185,autoFontSize:true,fontFamily:'Arial',fontSize:42});
 await importPayload(page,payload);
 const doc=(await records(page,'docs')).find(d=>d.elements[0]?.text===text);
 await openLibraryDocument(page,doc.id);
 const point=await canvasPoint(page,38,40,payload.document.width,payload.document.height);
 await page.mouse.dblclick(point.x,point.y);
 const editor=page.locator('#inlineWysiwyg');
 await expect(editor).toBeFocused();
 const word=editor.locator('[data-wysiwyg-fragment]').filter({hasText:'автоматического'});
 await expect(word).toHaveCount(1);
 expect(await word.evaluate(span=>parseFloat(getComputedStyle(span).fontSize))).toBeLessThan(42);
 expect(await editor.textContent()).toBe(text);
 expect((await model(page)).fontSize).toBe(42);
 await page.keyboard.press('ControlOrMeta+Enter');
 expect((await records(page,'docs')).find(d=>d.id===doc.id).elements[0]).toEqual(doc.elements[0]);
});

test('auto rows project T3 expansion, a hidden run of spaces, a tab and a compound emoji',async({page})=>{
 const editor=await drawLiveFrame(page,115,198);
 const text='X    straße\n  👩‍💻\tüber';
 await editor.evaluate((host,value)=>{
  const [first,second]=value.split('\n');
  for(const data of [first,'\n',second]){
   const inputType=data==='\n'?'insertParagraph':'insertText';
   host.dispatchEvent(new InputEvent('beforeinput',{inputType,data,bubbles:true,cancelable:true}));
  }
 },text);
 expect(await editor.textContent()).toBe(text);
 await nativeSelection(editor,[text.length,0]);
 await page.locator('#inspector [data-text-case=upper]').click();
 expect(await editor.textContent()).toBe(text.toUpperCase());
 expect((await model(page)).text).toBe(text);
 expect(await editor.locator('[data-wysiwyg-separator]').first().textContent()).toBe('    ');
 expect((await editor.locator('[data-wysiwyg-fragment]').allTextContents()).some(value=>value.includes('👩‍💻'))).toBe(true);
 expect(await copyLiveText(editor)).toBe(text);
});

test.describe('mobile auto sizing', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('legacy text has no automatic fitting; mobile can enable auto size', async ({ page }) => {
  await openHome(page);
  const data = structuredClone(fixture);
  data.documents = [data.documents[0]];
  await importPayload(page, data);
  const record = (await records(page, 'docs')).find(d => d.title === 'Graph template');
  expect(record).toBeTruthy();
  await openLibraryDocument(page, record.id);
  await page.locator('#mobileToolbars [data-mobile="layers"]:visible').tap();
  await page.locator('#mobileLayerList [data-layer="title"] .layer-name').tap();
  await page.locator('#mobileLayersClose').tap();
  const before = (await exportedDocument(page)).elements.find(x => x.id === 'title');
  expect(before.autoFontSize).toBeUndefined();
  await page.locator('#mobileContext [data-mobile="size"]').tap();
  await expect(page.locator('#mobilePropertyUI')).toHaveClass(/mp-open/);
  const auto = page.locator('#mobilePropertyUI [data-text-auto-font]');
  await expect(auto).not.toBeChecked();
  await auto.check();
  await expect(page.locator('#mobilePropertyUI')).toHaveClass(/mp-open/);
  const after = (await exportedDocument(page)).elements.find(x => x.id === 'title');
  expect(after.autoFontSize).toBe(true);
  expect(after.fontSize).toBeGreaterThan(0);
  await page.locator('#mobileContext [data-mobile=edit]').tap();
  const editor=page.locator('#inlineText');
  await expect(editor).toBeVisible();
  await expect(page.locator('#inlineWysiwyg')).toBeHidden();
  const text='Тест автоматического подбора размера текста.';
  await editor.fill(text);
  await expect(editor).toHaveValue(text);
  await editor.press('ControlOrMeta+Enter');
  expect((await exportedDocument(page)).elements.find(x=>x.id==='title').text).toBe(text);
  await exportPNG(page);
  });
});
