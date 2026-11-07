const {test,expect,openHome,importPayload,records,openLibraryDocument,canvasPoint,exportPNG}=require('./helpers');
const {model}=require('./support/text-interaction');
const fixture=require('./fixtures/visual-text.json');
const surface='#inlineWysiwyg',text='alpha beta gamma delta epsilon zeta eta theta';
const tracking=page=>page.locator('#inspector [data-key=letterSpacing]');
async function seed(page,patch={},second){
 await page.setViewportSize({width:2200,height:1600});
 await page.addInitScript(()=>{
  window.trackingDraws=[];window.trackingExport=[];
  const proto=CanvasRenderingContext2D.prototype,fill=proto.fillText,clear=proto.clearRect;
  proto.clearRect=function(...args){if(this.canvas.id==='canvas')window.trackingDraws=[];return clear.apply(this,args)};
  proto.fillText=function(text,x,y,...args){
   const sample={text,x,y,font:this.font,spacing:this.letterSpacing,width:this.measureText(text).width};
   if(this.canvas.id==='canvas')window.trackingDraws.push(sample);
   else if(window.captureTracking)window.trackingExport.push(sample);
   return fill.call(this,text,x,y,...args);
  };
 });
 await openHome(page);const payload=structuredClone(fixture),e=payload.document.elements[0];
 Object.assign(e,{id:'tracking',name:'Tracking',x:16,y:16,w:210,h:240,fontFamily:'Arial',fontSize:24,lineHeight:1.15,text,textColor:'#000000',fill:'#000000',fillType:'solid',letterSpacing:0,autoFontSize:false},patch);
 if(second)payload.document.elements.push({...structuredClone(e),id:'second',name:'Second',y:300,...second});
 await importPayload(page,payload);const doc=(await records(page,'docs')).find(d=>d.title==='Visual fixed font (импорт)');await openLibraryDocument(page,doc.id);return doc;
}
async function edit(page){const p=await canvasPoint(page,40,30);await page.mouse.dblclick(p.x,p.y);await expect(page.locator(surface)).toBeFocused()}
async function select(page,start,end=start){
 await page.locator(surface).focus();await page.keyboard.press('Control+Home');
 for(let i=0;i<start;i++)await page.keyboard.press('ArrowRight');
 for(let i=start;i<end;i++)await page.keyboard.press('Shift+ArrowRight');
 await range(page,start,end);
}
async function range(page,start,end){
 await page.locator(surface).focus();
 await expect(page.locator('#inlineText')).toBeHidden();await expect(page.locator('#wysiwygRecovery')).toBeHidden();
 expect(await page.locator(surface).evaluate(el=>{
  const s=getSelection(),offset=(node,n)=>{const r=document.createRange();r.setStart(el,0);r.setEnd(node,n);return r.toString().length};
  return [offset(s.anchorNode,s.anchorOffset),offset(s.focusNode,s.focusOffset)];
 })).toEqual([start,end]);
}
async function mixed(page){await expect(tracking(page)).toHaveValue('');await expect(tracking(page)).toHaveAttribute('placeholder','Mixed')}
async function finish(page){await page.locator(surface).focus();await page.keyboard.press('Control+Enter');await expect(page.locator(surface)).toBeHidden()}
const runs=value=>[{start:0,end:10,style:{letterSpacing:value}}];

for(const autoFontSize of [false,true])test(`tracking Mixed range input, steppers, history and rendered persistence; auto-fit ${autoFontSize}`,async({page})=>{
 const doc=await seed(page,{autoFontSize});await edit(page);const field=tracking(page);
 expect(await page.locator(surface+' [data-wysiwyg-row]').count()).toBeGreaterThan(1);
 await select(page,0,5);await field.fill('2');await field.press('Tab');await range(page,0,5);
 expect((await model(page)).textRuns).toEqual([{start:0,end:5,style:{letterSpacing:2}}]);
 await finish(page);await mixed(page);await edit(page);
 for(const [start,end,value] of [[0,5,'2'],[6,10,'0'],[2,2,'2'],[5,5,'0'],[text.length,text.length,'0']]){
  await select(page,start,end);await expect(field).toHaveValue(value);
 }
 await select(page,0,10);await mixed(page);const initial=await model(page);
 expect(initial.textRuns).toEqual([{start:0,end:5,style:{letterSpacing:2}}]);
 await field.fill('');expect(await model(page)).toEqual(initial);
 // Actual typing emits intermediate input events and one finalized change.
 await field.pressSequentially('3');await expect(field).toBeFocused();await expect(field).toHaveValue('3');
 await field.press('Tab');await range(page,0,10);expect((await model(page)).textRuns).toEqual(runs(3));
 await page.locator(surface).focus();await page.keyboard.press('Control+z');expect(await model(page)).toEqual(initial);await mixed(page);
 const plus=field.locator('xpath=..').locator('[data-num-direction=up]');
 await plus.click();await range(page,0,10);await expect(field).toHaveValue('2.5');expect((await model(page)).textRuns).toEqual(runs(2.5));
 await plus.click();await range(page,0,10);await expect(field).toHaveValue('3');
 await page.keyboard.press('Control+z');expect((await model(page)).textRuns).toEqual(runs(2.5));
 await page.keyboard.press('Control+z');expect(await model(page)).toEqual(initial);
 await page.keyboard.press('Control+Shift+z');expect((await model(page)).textRuns).toEqual(runs(2.5));
 await field.focus();await field.press('ArrowUp');await field.press('Tab');await range(page,0,10);expect((await model(page)).textRuns).toEqual(runs(3));
 await field.focus();await field.press('ArrowDown');await field.press('Tab');await range(page,0,10);expect((await model(page)).textRuns).toEqual(runs(2.5));
 await expect(page.locator(surface+' [data-wysiwyg-fragment]').first()).toHaveCSS('letter-spacing','2.5px');
 const geometry=await page.locator(surface+' [data-wysiwyg-fragment]').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,width:n.getBoundingClientRect().width/(n.closest('#inlineWysiwyg').getBoundingClientRect().width/parseFloat(n.closest('#inlineWysiwyg').style.width))})));
 const changed=await model(page);expect(changed.autoFontSize).toBe(autoFontSize);await finish(page);await mixed(page);
 await page.locator('#undoBtn').click();expect((await model(page)).textRuns).toEqual(runs(3));
 await page.locator('#redoBtn').click();expect(await model(page)).toEqual(changed);
 const canvas=await page.evaluate(()=>window.trackingDraws);
 expect(canvas.some(d=>d.spacing==='2.5px')).toBe(true);
 expect(canvas.map(d=>d.text)).toEqual(geometry.map(d=>d.text));
 for(let i=0;i<canvas.length;i++)expect(Math.abs(canvas[i].width-geometry[i].width)).toBeLessThan(.1);
 await page.evaluate(()=>{window.captureTracking=true;window.trackingExport=[]});const png=await exportPNG(page);
 expect(png.image.width).toBe(doc.width);expect(png.image.data.some((v,i)=>i%4===0&&v<100)).toBe(true);
 expect((await page.evaluate(()=>window.trackingExport)).slice(-canvas.length)).toEqual(canvas);
 await expect.poll(async()=>((await records(page,'docs')).find(d=>d.id===doc.id)).elements[0]).toEqual(changed);
 await page.reload();await openLibraryDocument(page,doc.id);expect(await model(page)).toEqual(changed);
 await page.locator('#layers .layer-name').filter({hasText:/^Tracking$/}).click();await mixed(page);
 await edit(page);await select(page,0,10);await expect(field).toHaveValue('2.5');await finish(page);
});

for(const spacing of [.3,1])test(`tracking effective uniform runs, fractional tolerance and multiple layers: ${spacing}`,async({page})=>{
 await seed(page,{letterSpacing:9,textRuns:[{start:0,end:5,style:{letterSpacing:.1+.2}},{start:5,end:text.length,style:{letterSpacing:.3}}]}, {letterSpacing:spacing,textRuns:undefined});
 await page.locator('#layers .layer-name').filter({hasText:/^Tracking$/}).click();await expect(tracking(page)).toHaveValue('0.3');
 await page.locator('#layers .layer-name').filter({hasText:/^Second$/}).click({modifiers:['Shift']});
 await expect(page.locator('#inspector .ins-object-title')).toContainText('Выбрано 2');
 if(spacing===.3)await expect(tracking(page)).toHaveValue('0.3');else await mixed(page);
});


test('fractional Mixed steppers continue from range start; Regular Bold Regular and size stay live',async({page})=>{
 await seed(page,{textRuns:[{start:0,end:5,style:{letterSpacing:2.2}}]});await edit(page);await select(page,0,10);await mixed(page);
 const field=tracking(page),step=direction=>field.locator('xpath=..').locator(`[data-num-direction=${direction}]`);
 for(const expected of [2.7,3.2]){await step('up').click();await range(page,0,10);await expect(field).toHaveValue(String(expected));expect((await model(page)).textRuns).toEqual(runs(expected))}
 await page.keyboard.press('Control+z');await page.keyboard.press('Control+z');await mixed(page);
 await step('down').click();await range(page,0,10);await expect(field).toHaveValue('1.7');expect((await model(page)).textRuns).toEqual(runs(1.7));
 const variant=page.locator('#inspector [data-key=fontVariant]');
 for(const value of ['700:normal','400:normal']){await variant.selectOption(value);await range(page,0,10);await expect(variant).toHaveValue(value)}
 const size=page.locator('#inspector [data-key=fontSize]');
 await size.locator('xpath=..').locator('[data-num-direction=up]').click();await range(page,0,10);await expect(size).toHaveValue('25');
 const changed=await model(page);expect(changed.textRuns).toEqual([{start:0,end:10,style:{fontSize:25,letterSpacing:1.7}}]);
 await finish(page);await expect(size).toHaveValue('');await edit(page);await select(page,0,10);await expect(size).toHaveValue('25');await expect(variant).toHaveValue('400:normal');await finish(page);
});


test('collapsed tracking input and stepper preserve whole-layer behavior',async({page})=>{
 await seed(page);await edit(page);await select(page,2);
 const field=tracking(page);await field.fill('');expect((await model(page)).letterSpacing).toBe(0);
 await field.fill('1.5');await field.press('Tab');await range(page,2,2);
 expect((await model(page)).letterSpacing).toBe(1.5);expect((await model(page)).textRuns).toBeUndefined();
 await field.locator('xpath=..').locator('[data-num-direction=up]').click();await range(page,2,2);
 expect((await model(page)).letterSpacing).toBe(2);expect((await model(page)).textRuns).toBeUndefined();await finish(page);await expect(field).toHaveValue('2');
});
