const {test,expect}=require('@playwright/test');
const base={text:'Привет мир',fontFamily:'SpikeSans',fontSize:20,w:260,h:240,lineHeight:1.15,textRuns:[{start:0,end:6,style:{textColor:'#ff0000'}}]};
async function mount(page,value=base){await page.goto('/tests/spikes/fixture.html');await page.waitForFunction(()=>window.spike);await page.evaluate(async value=>{await spike.ready();spike.mount(value);},value);}
async function text(page){return page.evaluate(()=>spike.readText());}
test('native clicks, typing, word selection, Shift arrows and range boundaries',async({page})=>{
 await mount(page);const host=page.locator('#host');await host.click();await page.keyboard.press('Control+Home');
 await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');await page.keyboard.type('X');expect(await text(page)).toBe('ПрXивет мир');
 await page.keyboard.press('Backspace');expect(await text(page)).toBe(base.text);
 const box=await host.boundingBox();await page.mouse.dblclick(box.x+25,box.y+12);
 expect(await page.evaluate(()=>spike.readSelection())).toEqual({anchor:0,focus:6});
 await page.keyboard.press('ArrowRight');await page.keyboard.press('Shift+ArrowLeft');expect(await page.evaluate(()=>spike.readSelection())).toEqual({anchor:6,focus:5});
 await page.keyboard.type('Q');expect(await text(page)).toBe('ПривеQ мир');
 expect(await host.locator('span').first().evaluate(e=>getComputedStyle(e).color)).toBe('rgb(255, 0, 0)');
});
test('native Enter, consecutive empty lines, Home/End and Backspace',async({page})=>{
 await mount(page);await page.locator('#host').click();await page.keyboard.press('Control+End');
 await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.type('Z');
 expect(await text(page)).toBe(base.text+'\n\nZ');await page.keyboard.press('Home');await page.keyboard.press('Backspace');expect(await text(page)).toBe(base.text+'\nZ');
 await page.keyboard.press('End');
 const endState=await page.evaluate(()=>({selection:spike.readSelection(),text:spike.readText()}));
 await test.info().attach('native-end.json',{body:JSON.stringify(endState),contentType:'application/json'});
 expect(endState.text).toBe(base.text+'\nZ');
 await page.keyboard.press('Control+End');await page.keyboard.press('Backspace');expect(await text(page)).toBe(base.text+'\n');
});
test('UTF-16 mapping, backward selection, span endpoints, Unicode and native deletion',async({page})=>{
 const value={...base,text:'A😀👩‍💻Б\n\nC',textRuns:[{start:1,end:3,style:{fontSize:40}}]};await mount(page,value);
 expect(await page.evaluate(()=>{
  for(let i=0;i<=spike.readText().length;i++)for(const affinity of ['upstream','downstream']){
   const p=spike.offsetToDomPoint(i,affinity);if(spike.domPointToOffset(p.node,p.offset)!==i)return false;
  }
  const h=document.querySelector('#host');let offset=0;
  for(let i=0;i<=h.childNodes.length;i++){
   if(spike.domPointToOffset(h,i)!==offset)return false;
   if(i<h.childNodes.length)offset+=h.childNodes[i].textContent.length;
  }
  spike.setSelection(1,11);if(spike.readSelection().focus!==11)return false;
  spike.setSelection(11,1);return spike.readSelection();
 })).toEqual({anchor:11,focus:1});
 await page.locator('#host').click();await page.keyboard.press('Control+Home');await page.keyboard.press('ArrowRight');await page.keyboard.press('Delete');
 expect(await text(page)).toBe('A👩‍💻Б\n\nC');await page.keyboard.press('Delete');expect(await text(page)).toBe('AБ\n\nC');
});
test('composition guard and noncancelable input contract (synthetic, not real IME)',async({page})=>{
 await mount(page);expect(await page.evaluate(value=>{
 const h=document.querySelector('#host'),node=h.firstChild;
 h.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
 const result=spike.mount(value);
 h.dispatchEvent(new CompositionEvent('compositionupdate',{bubbles:true,data:'文'}));
 h.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,inputType:'insertCompositionText',isComposing:true,cancelable:false,data:'文'}));
 h.firstChild.firstChild.appendData('文');
 h.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',isComposing:true,cancelable:false,data:'文'}));
 const preserved=h.firstChild===node&&spike.readText()==='Привет文 мир';
 // Composing styles are rejected; input DOM is reconciled only after end.
 h.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'文'}));
 const nativeText=spike.readText();spike.mount({...value,text:nativeText});
 return {result,preserved,text:spike.readText(),events:spike.events};
 },base)).toMatchObject({result:false,preserved:true,text:'Привет文 мир',events:expect.arrayContaining([expect.objectContaining({type:'beforeinput',cancelable:false,isComposing:true}),expect.objectContaining({type:'input',cancelable:false,isComposing:true})])});
});
test('measure actual DOM/Canvas grapheme rows and caret geometry',async({page,browser},testInfo)=>{
 await mount(page);const cases=[
  ['plain',{...base}],
  ['mixed-size',{...base,text:'AABBCC',w:65,textRuns:[{start:2,end:4,style:{fontSize:40}}]}],
  ['mixed-family',{...base,text:'alpha beta gamma delta',w:150,textRuns:[{start:3,end:14,style:{fontFamily:'monospace',fontSize:32}}]}],
  ['style-word',{...base,text:'alphaSUPERLONGWORDomega beta',w:120,textRuns:[{start:7,end:15,style:{fontSize:32}}]}],
  ['spaces-3',{...base,text:'alpha   beta gamma',w:75}],
  ['spaces-5',{...base,text:'alpha     beta gamma',w:75}],
  ['unicode',{...base,text:'A😀👩‍💻Б é',w:130,textRuns:[{start:1,end:8,style:{fontSize:32}}]}],
  ['center',{...base,textAlign:'center',w:180}],
  ['right',{...base,textAlign:'right',w:180}],
  ['blank-lines',{...base,text:'A\n\nБ\n',w:100,textRuns:[{start:3,end:4,style:{fontSize:40}}]}],
 ];
 const results=[];
 for(const [name,value] of cases){await page.evaluate(value=>spike.mount(value),value);const result=await page.evaluate(()=>spike.measure());expect(result.text).toBe(value.text);results.push({name,...result,wrapMatches:JSON.stringify(result.domRows)===JSON.stringify(result.canvasRows)});}
 await testInfo.attach('geometry.json',{body:JSON.stringify({browser:browser.version(),results},null,2),contentType:'application/json'});
 console.log(JSON.stringify({browser:testInfo.project.name,version:browser.version(),geometry:results.map(({name,wrapMatches,maxDx,maxDy,maxCaretDx,maxCaretDy,missingCaretRects,domRows,canvasRows})=>({name,wrapMatches,maxDx,maxDy,maxCaretDx,maxCaretDy,missingCaretRects,domRows,canvasRows}))}));
 // This measures the gate; a passed diagnostic test does not mean WYSIWYG passed.
 expect(results.length).toBe(10);
 for(const r of results){expect(Number.isFinite(r.maxDx)).toBe(true);expect(Number.isFinite(r.maxDy)).toBe(true);expect(r.pairs.length).toBeGreaterThan(0);}
 const gatePassed=results.every(r=>r.wrapMatches&&r.maxDx<=2&&r.maxDy<=2&&r.maxCaretDx<=2&&r.maxCaretDy<=2&&r.missingCaretRects===0);
 await testInfo.attach('gate.json',{body:JSON.stringify({gatePassed}),contentType:'application/json'});
});

test('native HTML clipboard paste is plain text',async({page})=>{
 await mount(page);
 await page.evaluate(()=>{const source=document.createElement('div');source.id='source';source.contentEditable='true';source.style.marginTop='40px';const b=document.createElement('b');b.textContent='PASTE';source.append(b);document.body.append(source);});
 await page.locator('#source').click();await page.keyboard.press('Control+a');await page.keyboard.press('Control+c');
 await page.locator('#host').click();await page.keyboard.press('Control+End');await page.keyboard.press('Control+v');
 await expect.poll(()=>text(page)).toBe(base.text+'PASTE');
 expect(await page.locator('#host b,#host [class],#host [onclick]').count()).toBe(0);
});
test('real clicks after zoom/rotation, logical range survives style projection',async({page})=>{
 const value={...base,text:'abcdef',textRuns:[{start:0,end:3,style:{textColor:'red'}}]};await mount(page,value);
 for(const zoom of [.5,1,2])for(const angle of [0,30]){
  const point=await page.evaluate(({value,zoom,angle})=>{
   spike.mount(value);const h=document.querySelector('#host');
   const a=spike.offsetToDomPoint(1),b=spike.offsetToDomPoint(2,'upstream'),r=document.createRange();r.setStart(a.node,a.offset);r.setEnd(b.node,b.offset);
   const rect=r.getBoundingClientRect(),origin=h.getBoundingClientRect(),x=rect.left-origin.left+rect.width*.25,y=rect.top-origin.top+rect.height/2;
   const m=new DOMMatrix().scale(zoom).rotate(angle);h.style.transform=m.toString();const p=m.transformPoint({x,y});
   return {x:h.offsetLeft+p.x,y:h.offsetTop+p.y};
  },{value,zoom,angle});
  await page.mouse.click(point.x,point.y);expect(await page.evaluate(()=>spike.readSelection())).toEqual({anchor:1,focus:1});
 }
 await page.keyboard.press('Shift+ArrowRight');const selected=await page.evaluate(()=>spike.readSelection());
 await page.evaluate(value=>spike.mount({...value,textRuns:[{start:0,end:3,style:{fontSize:32}}]}),value);
 expect(await page.evaluate(()=>spike.readSelection())).toEqual(selected);
});
