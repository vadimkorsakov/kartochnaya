const {test,expect}=require('@playwright/test');
const base={text:'Привет мир',fontFamily:'SpikeSans',fontSize:20,w:260,h:240,lineHeight:1.15,textRuns:[{start:0,end:6,style:{textColor:'#ff0000'}}]};
let whiteSpace='break-spaces';
async function mount(page,value=base){await page.goto('/tests/spikes/fixture.html');await page.waitForFunction(()=>window.spike);await page.evaluate(async value=>{await spike.ready();spike.mount(value.value);document.querySelector('#host').style.whiteSpace=value.whiteSpace;},{value,whiteSpace});}
async function text(page){return page.evaluate(()=>spike.readText());}
for(const mode of ['pre-wrap','break-spaces'])test.describe(mode,()=>{
 test.beforeEach(()=>{whiteSpace=mode;});
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
 const offset=test.info().project.name.startsWith('firefox')?10:12;expect(endState.selection).toEqual({anchor:offset,focus:offset});
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

test('soft-wrap mouse affinity, arrows, Home/End, delete, multiline copy/paste',async({page},testInfo)=>{
 const value={...base,text:'alpha     beta gamma',w:75};await mount(page,value);
 const host=page.locator('#host');const actions=[];
 const record=async name=>{const state=await page.evaluate(()=>({text:spike.readText(),selection:spike.readSelection()}));actions.push({name,...state});expect(state.text).toBe(value.text);return state.selection;};
 const points=await page.evaluate(()=>{
  const m=spike.measure(),h=document.querySelector('#host').getBoundingClientRect();
  const first=m.pairs.filter(p=>p.dom.row===0).at(-1).dom;
  const second=m.pairs.find(p=>p.dom.row===1).dom;
  return [{x:h.left+first.endX-.2,y:h.top+(first.top+first.bottom)/2},{x:h.left+second.x+.2,y:h.top+(second.top+second.bottom)/2}];
 });
 for(const [i,p] of points.entries()){await page.mouse.click(p.x,p.y);const selected=await record('mouse-'+i);if(mode==='break-spaces')expect(selected).toEqual({anchor:8,focus:8});else{expect([8,10]).toContain(selected.focus);expect(selected.anchor).toBe(selected.focus);}}
 await page.keyboard.press('Control+Home');
 for(let i=0;i<8;i++)await page.keyboard.press('ArrowRight');
 expect(await record('eight-right')).toEqual({anchor:8,focus:8});
 await page.keyboard.press('ArrowDown');expect(await record('down')).toEqual({anchor:15,focus:15});await page.keyboard.press('ArrowUp');expect(await record('up')).toEqual({anchor:8,focus:8});
 await page.keyboard.press('End');const end=await record('End');
 const expectedEnd=mode==='pre-wrap'?10:testInfo.project.name.startsWith('chromium')?15:8;expect(end).toEqual({anchor:expectedEnd,focus:expectedEnd});
 await page.keyboard.press('Home');const home=await record('Home');const expectedHome=expectedEnd===15?8:0;expect(home).toEqual({anchor:expectedHome,focus:expectedHome});
 await page.keyboard.press('Control+Home');await page.keyboard.press('Shift+ArrowDown');
 const selected=await record('shift-down');expect(selected.focus).toBeGreaterThan(0);
 await page.keyboard.press('ArrowRight'); // Collapse selection before starting a new drag (avoid native drag/drop).
 await page.mouse.move(points[0].x-25,points[0].y);await page.mouse.down();await page.mouse.move(points[1].x+35,points[1].y,{steps:8});await page.mouse.up();
 const drag=await record('multiline-drag');expect(drag.anchor).not.toBe(drag.focus);
 await page.keyboard.press('Control+a');await page.keyboard.press('Control+c');await page.keyboard.press('Control+End');await page.keyboard.press('Control+v');
 await expect.poll(()=>text(page)).toBe(value.text+value.text);
 for(const key of ['Backspace','Delete']){
  await page.evaluate(value=>spike.mount(value),value);await host.click();await page.keyboard.press('Control+Home');
  for(let i=0;i<8;i++)await page.keyboard.press('ArrowRight');await page.keyboard.press(key);
  expect(await text(page)).toBe(key==='Backspace'?value.text.slice(0,7)+value.text.slice(8):value.text.slice(0,8)+value.text.slice(9));
 }
 await page.evaluate(value=>spike.mount(value),value);
 expect(await page.evaluate(()=>{for(let i=0;i<=spike.readText().length;i++)for(const a of ['upstream','downstream']){const p=spike.offsetToDomPoint(i,a);if(spike.domPointToOffset(p.node,p.offset)!==i)return false;}return true;})).toBe(true);
 await testInfo.attach('soft-wrap-native.json',{body:JSON.stringify({whiteSpace,actions},null,2),contentType:'application/json'});
});

});
test('compare every logical line before/after break-spaces (diagnostic, not gate assertion)',async({page,browser},testInfo)=>{
 await mount(page);const {cases}=require('./cases.cjs');const results=[];
 for(const whiteSpace of ['pre-wrap','break-spaces'])for(const [name,value] of cases){
  await page.evaluate(({value,whiteSpace})=>{spike.mount(value);document.querySelector('#host').style.whiteSpace=whiteSpace;},{value,whiteSpace});
  const result=await page.evaluate(()=>spike.measure());expect(result.text).toBe(value.text);expect(result.unmatchedGlyphs).toBe(0);
  for(const key of ['maxDx','maxDy','maxCaretDx','maxCaretDy'])expect(Number.isFinite(result[key])).toBe(true);
  results.push({name,whiteSpace,...result,wrapMatches:JSON.stringify(result.domLines)===JSON.stringify(result.canvasLines)});
 }
 const after=results.filter(r=>r.whiteSpace==='break-spaces');
 for(const r of after.filter(r=>r.name!=='lone-CR'))expect(r.wrapMatches,r.name).toBe(true);
 const repro=after.find(r=>r.name==='spaces-5');expect(repro.domLines[0]).toEqual({start:0,end:8,nextStart:8,softWrap:true});
 const gate0APassed=after.every(r=>r.wrapMatches);
 const gatePassed=gate0APassed&&after.every(r=>r.maxDx<=2&&r.maxDy<=2&&r.maxCaretDx<=2&&r.maxCaretDy<=2&&r.missingCaretRects===0);
 await testInfo.attach('geometry.json',{body:JSON.stringify({browser:browser.version(),results},null,2),contentType:'application/json'});
 await testInfo.attach('gate.json',{body:JSON.stringify({diagnosticsExecuted:true,gate0APassed,gatePassed,scope:'logical line boundaries only; native editing is tested separately',mismatches:after.filter(r=>!r.wrapMatches).map(r=>({name:r.name,dom:r.domLines,canvas:r.canvasLines}))},null,2),contentType:'application/json'});
 console.log(JSON.stringify({browser:testInfo.project.name,version:browser.version(),diagnosticsExecuted:true,gate0APassed,gatePassed,mismatches:after.filter(r=>!r.wrapMatches).map(r=>r.name)}));
});
