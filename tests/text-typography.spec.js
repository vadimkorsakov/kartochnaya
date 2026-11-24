const {test,expect,openHome,importPayload,records,openLibraryDocument,exportedDocument,exportPNG,canvasPoint}=require('./helpers');
const {seed,edit,model,selection}=require('./wysiwyg-fixture.cjs');
const fixture=require('./fixtures/visual-text.json');

const trigger=page=>page.locator('[data-typography-open]');
const panel=page=>page.locator('#typographyPanel');
const host=page=>page.locator('#inlineWysiwyg');
const master=page=>panel(page).locator('[data-typography-master]');
const rule=(page,key)=>panel(page).locator(`[data-typography-rule="${key}"]`);
const layer=(page,id='title')=>page.locator(`#layers [data-layer="${id}"]`);
const selectLayer=(page,id)=>layer(page,id).locator('.layer-name').click();
const press=async(page,...keys)=>{for(const key of keys)await page.keyboard.press(key);};
const pause=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const allRules=Object.fromEntries(['quotes','nestedQuotes','emDash','minus','multiply','marks','fractions','nbsp'].map(key=>[key,true]));
const source='"Голос “да”" -- -25 °C; 3 * 4; (tm); 1/2; в доме.\nStraße';
const projected='«ГОЛОС „ДА“»\u00a0— −25\u00a0°C; 3 × 4; ™; ½; В\u00a0ДОМЕ.\nSTRASSE';

async function finishEdit(page){
 await host(page).focus();
 await press(page,'Control+Enter');
 await expect(host(page)).toBeHidden();
}
async function glyphBox(page,index){
 return host(page).evaluate((el,index)=>{
  const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
  let node,offset=0;
  while(node=walker.nextNode()){
   if(index<offset+node.length){
    const range=document.createRange();
    range.setStart(node,index-offset);range.setEnd(node,index-offset+1);
    return range.getBoundingClientRect().toJSON();
   }
   offset+=node.length;
  }
  throw Error('Glyph offset outside host');
 },index);
}

test('panel stays in place, targets one layer, preserves canonical runs and persists through reload and duplication',async({page},info)=>{
 const textRuns=[{start:0,end:6,style:{underline:true,baselineShift:'super',strokeWidth:.75,stroke:'#395298'}}];
 const paragraphRuns=[{start:0,style:{listKind:'bullet',listMarker:'◆',listGap:9,listIndent:5}},
  {start:source.indexOf('\n')+1,style:{listKind:'ordered',listCounterStyle:'decimal-paren',listStart:3}}];
 const before=await seed(page,{text:source,w:280,h:185,fontSize:23,textCase:'upper',textRuns,paragraphRuns,textAlign:'justify'});
 await selectLayer(page);
 await expect(page.locator('.text-auto-font + [data-typography-open] svg')).toBeVisible();
 await expect(trigger(page)).toHaveAttribute('aria-expanded','false');
 await trigger(page).focus();await press(page,'Space');
 await expect(master(page)).toBeFocused();
 await expect(trigger(page)).toHaveAttribute('aria-expanded','true');
 expect(await model(page)).toEqual(before);
 await master(page).check();
 for(const key of ['multiply','marks','fractions'])await rule(page,key).check();
 await expect(trigger(page)).toHaveClass(/active/);
 await expect(trigger(page)).toHaveAttribute('title',/8$/);
 await panel(page).locator('summary').click();
 await expect(panel(page).locator('[data-typography-nbsp]:visible')).toHaveCount(7);
 const buttonImage=info.outputPath('typography-button.png'),panelImage=info.outputPath('typography-panel.png');
 await trigger(page).screenshot({path:buttonImage});
 await panel(page).screenshot({path:panelImage});
 await info.attach('typography-button',{path:buttonImage,contentType:'image/png'});
 await info.attach('typography-panel',{path:panelImage,contentType:'image/png'});
 await panel(page).locator('summary').click();

 await edit(page);
 await expect(panel(page)).toBeVisible();
 expect(await host(page).textContent()).toBe(projected);
 await press(page,'Control+End','Shift+ArrowLeft','Shift+ArrowLeft');
 const backward=await selection(page);
 await rule(page,'fractions').uncheck();
 await expect(host(page)).toContainText('1/2');
 await host(page).focus();
 const after=await selection(page);
 expect(after.anchor-after.focus).toBe(backward.anchor-backward.focus);
 await press(page,'Control+z');expect(await host(page).textContent()).toBe(projected);
 await press(page,'Control+Shift+z');await expect(host(page)).toContainText('1/2');
 await press(page,'Control+z');
 await master(page).uncheck();
 expect(await host(page).textContent()).toBe(source.toUpperCase());
 await master(page).check();
 expect(await host(page).textContent()).toBe(projected);
 await trigger(page).click();
 await expect(panel(page)).toBeVisible();
 await finishEdit(page);
 await expect(panel(page)).toBeVisible();
 await page.locator('#zoomInBtn').click();
 await expect(panel(page)).toBeVisible();
 const saved=await model(page);
 expect(saved.text).toBe(source);expect(saved.textRuns).toEqual(textRuns);expect(saved.paragraphRuns).toEqual(paragraphRuns);
 expect(saved.typography.rules).toEqual(allRules);
 await page.locator('#inspector [data-action=duplicate]').click();
 const duplicate=(await exportedDocument(page)).elements.find(e=>e.id!=='title');
 expect(duplicate.typography).toEqual(saved.typography);
 await expect(panel(page).locator('#typographyTarget')).not.toHaveText('Весь слой · '+before.name);
 await master(page).uncheck();
 expect((await model(page)).typography).toEqual(saved.typography);
 await master(page).dispatchEvent('pointerdown');
 await selectLayer(page);
 await master(page).evaluate(input=>{
  input.checked=false;
  input.dispatchEvent(new Event('change',{bubbles:true}));
 });
 await expect(master(page)).toBeChecked();
 expect((await model(page)).typography).toEqual(saved.typography);
 await panel(page).locator('[data-typography-reset]').click();
 await expect(rule(page,'fractions')).not.toBeChecked();
 await press(page,'Control+z');
 await expect(rule(page,'fractions')).toBeChecked();
 await selectLayer(page);
 await expect(panel(page).locator('#typographyTarget')).toHaveText('Весь слой · '+before.name);
 await layer(page).locator('[data-layeract=lock]').click();
 await expect(master(page)).toBeDisabled();
 await expect(trigger(page)).toBeDisabled();
 await expect(panel(page)).toBeVisible();
 await layer(page).locator('[data-layeract=lock]').click();
 await expect(master(page)).toBeEnabled();
 await press(page,'Escape');await expect(panel(page)).toBeHidden();

 let doc;
 await expect.poll(async()=>{
  doc=(await records(page,'docs')).find(d=>d.elements.some(e=>e.id==='title'));
  return doc?.elements[0]?.typography?.enabled;
 }).toBe(true);
 await page.reload();await openLibraryDocument(page,doc.id);await selectLayer(page);
 await expect(trigger(page)).toHaveClass(/active/);
 await expect(panel(page)).toBeHidden();
});

test('contractions and expansions are atomic for arrows, backward drag, delete and clipboard, with safe IME recovery',async({page})=>{
 const text='ß (tm) 1/2';
 await seed(page,{text,fontSize:26,textCase:'upper',typography:{enabled:true,rules:allRules}});
 await edit(page);
 expect(await host(page).textContent()).toBe('SS ™ ½');
 await press(page,'Home','ArrowRight');
 expect(await selection(page)).toEqual({anchor:2,focus:2});
 await press(page,'ArrowRight','Delete');
 expect((await model(page)).text).toBe('ß  1/2');
 await press(page,'Control+z','End','Backspace');
 expect((await model(page)).text).toBe('ß (tm) ');
 await press(page,'Control+z','End','Shift+ArrowLeft');
 expect(await selection(page)).toEqual({anchor:6,focus:5});
 await press(page,'Control+c','End','Enter','Control+v');
 expect((await model(page)).text).toBe(text+'\n1/2');
 await press(page,'Control+z','Control+z','End','Shift+ArrowLeft','Control+x');
 expect((await model(page)).text).toBe('ß (tm) ');
 await press(page,'Control+v');
 expect((await model(page)).text).toBe(text);
 const fraction=await glyphBox(page,5),mark=await glyphBox(page,3),midY=fraction.y+fraction.height/2;
 await page.mouse.click(fraction.x+fraction.width*.83,midY);
 await expect.poll(()=>selection(page)).toEqual({anchor:6,focus:6});
 await page.mouse.move(fraction.x+fraction.width*.94,midY);
 await page.mouse.down();await page.mouse.move(mark.x+mark.width*.05,midY,{steps:10});await page.mouse.up();
 await expect.poll(()=>selection(page)).toEqual({anchor:6,focus:3});
 expect(await page.evaluate(()=>getSelection().toString())).toBe('™ ½');
 await page.keyboard.type('"word"');
 expect(await host(page).textContent()).toBe('SS «WORD»');
 await press(page,'End','Enter');
 await page.keyboard.type('"test"');
 expect(await host(page).textContent()).toBe('SS «WORD»\n«TEST»');

 await trigger(page).click();await host(page).focus();
 await host(page).dispatchEvent('compositionstart',{data:'x'});
 await expect(master(page)).toBeDisabled();
 await expect(panel(page)).toBeVisible();
 await host(page).dispatchEvent('compositionend',{data:'x'});
 await expect(master(page)).toBeDisabled();
 await page.locator('#wysiwygRecover').click();
 await expect(master(page)).toBeEnabled();
 expect((await model(page)).text).toBe('ß "word"\n"test"');
});

test('glued text, custom list decoration and PNG agree at fixed size and auto-fit',async({page})=>{
 const text='Первая строка 10 кг в доме и 1/2 возле окна\nВторая -- строка.';
 await seed(page,{text,w:163,h:150,fontSize:23,textAlign:'justify',
  typography:{enabled:true,rules:allRules},
  textRuns:[{start:0,end:6,style:{underline:true,strokeWidth:1,baselineShift:'super'}}],
  paragraphRuns:[{start:0,style:{listKind:'bullet',listMarker:'◆',listIndent:6}}]});
 await edit(page);
 const rows=()=>host(page).locator('[data-wysiwyg-row]').allTextContents();
 expect((await rows()).some(row=>row.includes('10\u00a0кг'))).toBe(true);
 expect((await rows()).some(row=>row.includes('в\u00a0доме'))).toBe(true);
 expect((await rows()).some(row=>row.includes('½'))).toBe(true);
 await finishEdit(page);
 const fixed=await model(page);
 const originalPNG=(await exportPNG(page)).image.data;
 await trigger(page).click();await master(page).uncheck();
 expect((await exportPNG(page)).image.data.equals(originalPNG)).toBe(false);
 await master(page).check();
 expect((await exportPNG(page)).image.data.equals(originalPNG)).toBe(true);
 await page.locator('[data-text-auto-font]').click();
 expect((await model(page)).autoFontSize).toBe(true);
 await edit(page);
 expect(await host(page).locator('[data-wysiwyg-separator]').count()).toBeGreaterThan(0);
 expect((await host(page).locator('[data-wysiwyg-separator]').allTextContents()).every(value=>/^ +$/u.test(value))).toBe(true);
 const autoRows=await rows();
 expect(autoRows.some(row=>row.includes('10\u00a0кг'))).toBe(true);
 await press(page,'Control+Home','ArrowDown','End','ArrowLeft','Home');
 await expect(host(page)).toBeFocused();
 await finishEdit(page);
 const fitted=await model(page);
 expect(fitted.text).toBe(fixed.text);expect(fitted.textRuns).toEqual(fixed.textRuns);
 expect(fitted.paragraphRuns).toEqual(fixed.paragraphRuns);
 const fittedPNG=(await exportPNG(page)).image.data;
 await master(page).uncheck();
 expect((await model(page)).fontSize).toBe(fitted.fontSize);
 await master(page).check();
 expect((await exportPNG(page)).image.data.equals(fittedPNG)).toBe(true);
});

test('mobile Canvas and PNG keep identical projection while native textarea edits source',async({page})=>{
 await page.addInitScript(()=>{
  window.drawnText=[];
  const proto=CanvasRenderingContext2D.prototype,{fillText,clearRect}=proto;
  proto.fillText=function(text,...args){
   if(this.canvas.id==='canvas')window.drawnText.push(text);
   return fillText.call(this,text,...args);
  };
  proto.clearRect=function(...args){
   if(this.canvas.id==='canvas')window.drawnText=[];
   return clearRect.apply(this,args);
  };
 });
 await openHome(page);
 const payload=structuredClone(fixture);
 Object.assign(payload.document.elements[0],{text:source,name:'T5 mobile source',textCase:'upper',fontSize:24,
  w:280,h:200,x:16,y:20,autoFontSize:false,typography:{enabled:true,rules:allRules}});
 await importPayload(page,payload);
 const doc=(await records(page,'docs')).find(d=>d.elements[0].name==='T5 mobile source');
 await openLibraryDocument(page,doc.id);
 const desktop=(await exportPNG(page)).image.data;
 await page.setViewportSize({width:390,height:844});
 await pause(page);
 await expect(trigger(page)).toHaveCount(0);
 const draws=await page.evaluate(()=>window.drawnText.join(''));
 for(const value of ['−25','™','½','STRASSE','\u00a0'])expect(draws).toContain(value);
 expect((await exportPNG(page)).image.data.equals(desktop)).toBe(true);
 const p=await canvasPoint(page,50,34);
 await page.mouse.dblclick(p.x,p.y);
 const textarea=page.locator('#inlineText');
 await expect(textarea).toBeFocused();
 await expect(textarea).toHaveValue(source);
 await textarea.press('End');await page.keyboard.insertText('!');
 await page.locator('#mobileConfirm').click();
 await expect(textarea).toBeHidden();
 expect((await exportedDocument(page)).elements[0].typography.rules).toEqual(allRules);
 await expect.poll(async()=>page.evaluate(()=>window.drawnText.join(''))).toContain('STRASSE');
});

test('desktop textarea fallback retains the source, blocks panel mutations and keeps the stored settings',async({page})=>{
 const text='"В доме" -- 10 кг; 1/2';
 const before=await seed(page,{text,typography:{enabled:true,rules:allRules}},'/?experimentalTextWysiwyg=0');
 await selectLayer(page);
 await trigger(page).click();
 await edit(page,false);
 const textarea=page.locator('#inlineText');
 await expect(textarea).toHaveValue(text);
 await expect(panel(page)).toBeVisible();
 await expect(master(page)).toBeDisabled();
 await textarea.press('Control+Enter');
 await expect(panel(page)).toBeVisible();
 await expect(master(page)).toBeEnabled();
 expect((await model(page)).typography).toEqual(before.typography);
 await panel(page).locator('[data-typography-close]').click();
 await expect(panel(page)).toBeHidden();
});
