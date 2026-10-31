const {test,expect,openHome,importPayload,records,openLibraryDocument,canvasPoint,exportPNG}=require('./helpers');
const {PNG}=require('pngjs');
const fixture=require('./fixtures/visual-text.json');
const editor='#inlineText';
// Read the real JSON export blob without repeated downloads taking focus or
// hitting Chromium's automatic-download limit. PNG still uses a real download.
async function model(page){return page.evaluate(async()=>{
 let blob;const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;
 try{
  URL.createObjectURL=function(value){if(value.type==='application/json')blob=value;return create.call(this,value)};
  HTMLAnchorElement.prototype.click=function(){if(!this.download.endsWith('.json'))return click.call(this)};
  document.querySelector('#jsonExportBtn').click();
 }finally{URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click}
 return JSON.parse(await blob.text()).document;
})}
const layer=async page=>(await model(page)).elements[0];
async function seed(page,patch={},mobile=false){
 await page.addInitScript(()=>{window.textDraws=[];const proto=CanvasRenderingContext2D.prototype,fn=proto.fillText;proto.fillText=function(text,x,y,...rest){if(this.canvas.id==='canvas')window.textDraws.push({text,font:this.font,color:this.fillStyle,spacing:this.letterSpacing});return fn.call(this,text,x,y,...rest)}});
 await openHome(page);const payload=structuredClone(fixture);
 Object.assign(payload.document.elements[0],{id:'selected-text',name:'Selected text',x:16,y:16,w:288,h:208,fontFamily:'Arial',fontSize:20,lineHeight:1.25,text:'Привет мир 😀',textColor:'#000000',fill:'#000000',fillType:'solid',autoFontSize:false},patch);
 await importPayload(page,payload);const doc=(await records(page,'docs')).find(d=>d.title==='Visual fixed font (импорт)');await openLibraryDocument(page,doc.id);
 if(mobile){await page.locator('[data-mobile=layers]:visible').tap();await page.locator('#mobileLayerList .layer-name').filter({hasText:'Selected text'}).tap();await page.locator('#mobileLayersClose').tap();await page.locator('#mobileContext [data-mobile=edit]').tap()}
 else {const p=await canvasPoint(page,60,40);await page.mouse.dblclick(p.x,p.y)}
 await expect(page.locator(editor)).toBeFocused();return doc;
}
async function select(page,start,end){await page.locator(editor).focus();await page.locator(editor).evaluate((el,[a,b])=>{el.setSelectionRange(a,b);el.dispatchEvent(new Event('select'))},[start,end])}
async function caret(page,start,end){await expect(page.locator(editor)).toBeVisible();expect(await page.locator(editor).evaluate(el=>[el.selectionStart,el.selectionEnd])).toEqual([start,end])}
async function field(page,key,value){const f=page.locator(`#inspector [data-key="${key}"]`);await f.fill(String(value));await f.press('Tab')}
async function color(page,hex){if(!await page.locator('#fillPopover').isVisible())await page.locator('#inspector [data-fill-open=fill]').click();const f=page.locator('#fillPopover [data-cp-part="0"]');await f.fill(hex);await f.press('Tab')}
async function finish(page,mobile=false){if(mobile)await page.locator('#mobileConfirm').tap();else{await page.locator(editor).focus();await page.locator(editor).press('Control+Enter')}await expect(page.locator(editor)).toBeHidden()}
function pixels(image,r,g,b){let n=0;for(let i=0;i<image.data.length;i+=4)if(image.data[i]===r&&image.data[i+1]===g&&image.data[i+2]===b)n++;return n}

test('word selection, overlapping styles, reset, real Canvas/PNG and persisted reopening',async({page})=>{
 const doc=await seed(page);const before=await layer(page);
 // Use a genuine double click in the textarea, followed by Shift+arrows.
 const box=await page.locator(editor).boundingBox();await page.mouse.dblclick(box.x+24,box.y+12);
 const word=await page.locator(editor).evaluate(el=>el.value.slice(el.selectionStart,el.selectionEnd));expect(word.trim()).toBe('Привет');
 await select(page,0,0);await page.locator(editor).press('Shift+ArrowRight');await page.locator(editor).press('Shift+ArrowRight');await caret(page,0,2);
 await color(page,'#ff0000');await caret(page,0,2);
 expect((await layer(page)).textRuns).toEqual([{start:0,end:2,style:{textColor:'#ff0000'}}]);
 await page.locator('#fillPopover').press('Tab');
 await select(page,1,4);await page.locator('#inspector [data-key=fontVariant]').selectOption('700:normal');await caret(page,1,4);
 await select(page,2,5);await field(page,'fontSize',36);await caret(page,2,5);
 await field(page,'letterSpacing',2);await caret(page,2,5);
 await field(page,'fontSize',30); // Repeat the same range.
 let e=await layer(page);expect(e.fontSize).toBe(20);expect(e.text).toBe(before.text);expect([e.x,e.y,e.w,e.h]).toEqual([before.x,before.y,before.w,before.h]);
 expect(e.textRuns).toEqual([
  {start:0,end:1,style:{textColor:'#ff0000'}},
  {start:1,end:2,style:{fontWeight:'700',textColor:'#ff0000'}},
  {start:2,end:4,style:{fontSize:30,fontWeight:'700',letterSpacing:2}},
  {start:4,end:5,style:{fontSize:30,letterSpacing:2}}
 ]);
 await select(page,0,1);await color(page,'#000000');expect((await layer(page)).textRuns[0].start).toBe(1);
 await finish(page);e=await layer(page);
 await expect.poll(()=>page.evaluate(()=>window.textDraws.some(d=>d.text==='ив'&&d.font.includes('30px')))).toBe(true);
 const screen=PNG.sync.read(Buffer.from(await page.locator('#canvas').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
 expect(pixels(screen,255,0,0)).toBeGreaterThan(2);expect(pixels((await exportPNG(page)).image,255,0,0)).toBeGreaterThan(2);
 await expect.poll(async()=>((await records(page,'docs')).find(d=>d.id===doc.id)).elements[0]).toEqual(e);
 await page.locator('#documentTabsHome').click();await page.reload();await expect(page.locator('#homeScreen')).toBeVisible();await openLibraryDocument(page,doc.id);expect(await layer(page)).toEqual(e);
});

test('formatting history interleaves typing/deletion, survives finalization without duplicates, Escape cancels all',async({page})=>{
 await seed(page);const initial=await layer(page);
 await page.keyboard.insertText('!');await page.locator(editor).press('Control+z');expect(await layer(page)).toEqual(initial);
 await select(page,0,0);await page.keyboard.insertText('Я');await select(page,0,2);await field(page,'fontSize',32);
 const formatted=await layer(page);await select(page,1,1);await page.keyboard.press('Delete');expect((await layer(page)).text).toBe('Яривет мир 😀');
 await page.locator(editor).press('Control+z');expect(await layer(page)).toEqual(formatted);
 await page.locator(editor).press('Control+z');expect((await layer(page)).textRuns).toBeUndefined();expect((await layer(page)).text).toBe('ЯПривет мир 😀');
 await page.locator(editor).press('Control+Shift+z');expect(await layer(page)).toEqual(formatted);await caret(page,1,1);
 await finish(page);await page.locator('#undoBtn').click();expect((await layer(page)).textRuns).toBeUndefined();
 await page.locator('#redoBtn').click();expect(await layer(page)).toEqual(formatted);
 const p=await canvasPoint(page,60,40);await page.mouse.dblclick(p.x,p.y);await select(page,0,3);await field(page,'fontSize',50);await page.locator('#inspector [data-key=fontSize]').press('Escape');expect(await layer(page)).toEqual(formatted);
 expect(initial.textRuns).toBeUndefined();
});

test('no selection preserves whole-layer behavior; family and explicit style clear conflicting aliases',async({page})=>{
 await seed(page,{textRuns:[{start:0,end:6,style:{bold:true,italic:true}}]});
 await select(page,0,3);await page.locator('#inspector [data-key=fontVariant]').selectOption('400:normal');
 expect((await layer(page)).textRuns).toEqual([{start:3,end:6,style:{bold:true,italic:true}}]);
 await page.locator('#inspector [data-font-open]').click();await page.locator('#inspector [data-font-option="Georgia"]').click();await caret(page,0,3);
 expect((await layer(page)).textRuns[0]).toEqual({start:0,end:3,style:{fontFamily:'Georgia'}});
 await select(page,6,6);await field(page,'fontSize',26);const e=await layer(page);expect(e.fontSize).toBe(26);expect(e.autoFontSize).toBe(false);await expect(page.locator(editor)).toBeVisible();await finish(page);
});

test('UTF-16 emoji boundaries and reference sizes with auto-fit',async({page})=>{
 const doc=await seed(page,{fontSize:10,textRunsBaseFontSize:20,textRuns:[{start:0,end:6,style:{fontSize:30}}]});
 await select(page,12,13);await field(page,'fontSize',24);await caret(page,12,13);
 let e=await layer(page);expect(e.textRuns).toContainEqual({start:11,end:13,style:{fontSize:48}});expect(e.textRuns[0].style.fontSize).toBe(30);
 await page.locator('#inspector [data-text-auto-font]').check();e=await layer(page);const scale=e.fontSize/e.textRunsBaseFontSize;
 await select(page,7,9);await field(page,'fontSize',40);e=await layer(page);expect(e.autoFontSize).toBe(false);expect(e.textRuns.find(r=>r.start===7).style.fontSize).toBeCloseTo(40/scale,6);expect(e.textRuns[0].style.fontSize).toBe(30);
 await finish(page);expect((await layer(page)).textRuns).toEqual(e.textRuns);
 await expect.poll(()=>page.evaluate(()=>window.textDraws.some(d=>d.text==='ми'&&d.font.includes('40px')))).toBe(true);
 await expect.poll(async()=>((await records(page,'docs')).find(d=>d.id===doc.id)).elements[0]).toEqual(e);
 await page.locator('#documentTabsHome').click();await page.reload();await expect(page.locator('#homeScreen')).toBeVisible();await openLibraryDocument(page,doc.id);expect(await layer(page)).toEqual(e);
 await expect.poll(()=>page.evaluate(()=>window.textDraws.some(d=>d.text==='ми'&&d.font.includes('40px')))).toBe(true);
});

test.describe('mobile selection tools',()=>{
 test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 test('font, variant, numeric input, bold/italic, color and done retain native selection',async({page})=>{
  await seed(page,{textRuns:[{start:0,end:6,style:{bold:true,italic:true}}]},true);await select(page,0,6);
  await page.locator('#mobileContext [data-mobile=font]').tap();await page.locator('[data-mp-font="Georgia"]').first().tap();await caret(page,0,6);
  await page.locator('#mobileContext [data-mobile=size]').tap();const size=page.locator('#mobilePropertyUI [data-mp-key=fontSize]').first();await size.fill('28');await size.press('Tab');await caret(page,0,6);await page.locator('[data-mp-step=fontSize][data-dir="1"]').tap();await page.locator('[data-mp-step=fontSize][data-dir="-1"]').tap();await caret(page,0,6);
  await page.locator('#mobileContext [data-mobile=format]').tap();await page.locator('[data-mp-format=bold]').tap();await page.locator('[data-mp-format=italic]').tap();expect((await layer(page)).textRuns[0].style).not.toHaveProperty('bold');expect((await layer(page)).textRuns[0].style).not.toHaveProperty('italic');await page.locator('[data-mp-format=bold]').tap();await page.locator('[data-mp-format=italic]').tap();await caret(page,0,6);
  await page.locator('#mobileContext [data-mobile=spacing]').tap();const spacing=page.locator('#mobilePropertyUI input[type=number][data-mp-key=letterSpacing]');await spacing.fill('1.5');await spacing.press('Tab');await caret(page,0,6);
  await page.locator('#mobileContext [data-mobile=color]').tap();await page.locator('[data-mp-action=expand]').tap();await page.locator('[data-mp-swatch="#ff4545"]').first().tap();await caret(page,0,6);
  const e=await layer(page);expect(e.fontSize).toBe(20);expect(e.textColor).toBe('#000000');expect(e.textRuns[0].style).toMatchObject({fontFamily:'Georgia',fontSize:28,fontWeight:'700',fontStyle:'italic',textColor:'#ff4545',letterSpacing:1.5});
  await finish(page,true);await expect.poll(()=>page.evaluate(()=>window.textDraws.some(d=>d.text==='Привет'&&d.font.includes('italic')&&/bold|700/.test(d.font)&&d.font.includes('28px')&&d.font.includes('Georgia')))).toBe(true);const png=await exportPNG(page);expect(pixels(png.image,255,69,69)).toBeGreaterThan(2);
 });
});
