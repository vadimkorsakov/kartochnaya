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
test('compare break-spaces with metric line-height (diagnostic, not gate assertion)',async({page,browser},testInfo)=>{
 await mount(page);const {cases}=require('./cases.cjs');const results=[];
 for(const geometry of ['original','font-metrics'])for(const [name,value] of cases){
  const appliedMetrics=await page.evaluate(({value,geometry})=>{spike.mount(value);document.querySelector('#host').style.whiteSpace='break-spaces';return geometry==='font-metrics'?spike.applyMetricLineHeight():null;},{value,geometry});
  const result=await page.evaluate(()=>spike.measure());expect(result.text).toBe(value.text);expect(result.unmatchedGlyphs).toBe(0);
  for(const key of ['maxDx','maxDy','maxCaretDx','maxCaretDy'])expect(Number.isFinite(result[key])).toBe(true);
  results.push({name,whiteSpace:'break-spaces',geometry,appliedMetrics,...result,wrapMatches:JSON.stringify(result.domLines)===JSON.stringify(result.canvasLines)});
 }
 const after=results.filter(r=>r.geometry==='font-metrics');
 for(const r of after){
  const before=results.find(b=>b.geometry==='original'&&b.name===r.name);
  expect(r.canvasMetrics).toEqual(before.canvasMetrics);
  expect(r.canvasLines).toEqual(before.canvasLines);
  expect(r.caretRowProbes).toHaveLength(r.canvasLines.length);
  expect(r.appliedMetrics.every(m=>parseFloat(m.computed)===m.height)).toBe(true);
 }
 for(const r of after.filter(r=>r.name!=='lone-CR'))expect(r.wrapMatches,r.name).toBe(true);
 const repro=after.find(r=>r.name==='spaces-5');expect(repro.domLines[0]).toEqual({start:0,end:8,nextStart:8,softWrap:true});
 const gate0APassed=after.every(r=>r.wrapMatches);
 const emptyRowsVerified=after.every(r=>r.caretRowProbes.filter(p=>p.empty).every(p=>p.affinities.every(a=>a.rects.length>0&&a.deltas.every(d=>d.dx<=2&&d.dy<=2))));
 const geometryWithinTolerance=r=>r.maxDx<=2&&r.maxDy<=2&&r.maxCaretDx<=2&&r.maxCaretDy<=2&&r.missingCaretRects===0;
 const hardRowCaretsVerified=after.filter(r=>r.wrapMatches).every(r=>r.caretRowProbes.filter((p,i)=>!i||!r.canvasLines[i-1].softWrap).every(p=>p.affinities.every(a=>a.rects.length>0&&a.deltas.every(d=>d.dx<=2&&d.dy<=2))));
 const gate0BPassed=emptyRowsVerified&&hardRowCaretsVerified&&after.filter(r=>r.wrapMatches).every(geometryWithinTolerance);
 const gatePassed=gate0APassed&&gate0BPassed;
 const comparison=['original','font-metrics'].map(geometry=>{
  const all=results.filter(r=>r.geometry===geometry),matching=all.filter(r=>r.wrapMatches);
  const maximum=rows=>Object.fromEntries(['maxDx','maxDy','maxCaretDx','maxCaretDy'].map(key=>[key,Math.max(0,...rows.map(r=>r[key]))]));
  const emptyProbes=all.flatMap(r=>r.caretRowProbes.filter(p=>p.empty).flatMap(p=>p.affinities));
  return {geometry,lineMatches:matching.length,total:all.length,all:maximum(all),matching:maximum(matching),emptyProbes:emptyProbes.length,missingEmptyRects:emptyProbes.filter(a=>!a.rects.length).length,inaccurateEmptyRects:emptyProbes.filter(a=>a.deltas.some(d=>d.dx>2||d.dy>2)).length};
 });
 await testInfo.attach('geometry.json',{body:JSON.stringify({browser:browser.version(),results},null,2),contentType:'application/json'});
 await testInfo.attach('gate.json',{body:JSON.stringify({diagnosticsExecuted:true,gate0APassed,gatePassed,emptyRowsVerified,hardRowCaretsVerified,gate0BPassed,comparison,scope:'metric CSS matrix; empty-row probes include both affinities; native editing remains original CSS only',mismatches:after.filter(r=>!r.wrapMatches).map(r=>({name:r.name,dom:r.domLines,canvas:r.canvasLines}))},null,2),contentType:'application/json'});
 console.log(JSON.stringify({browser:testInfo.project.name,version:browser.version(),diagnosticsExecuted:true,gate0APassed,gatePassed,mismatches:after.filter(r=>!r.wrapMatches).map(r=>r.name)}));
});

// Native candidate diagnostic: passing execution never implies canonical safety.
test('terminal BR native editing and metric soft-wrap (Gate 0B/2 diagnostic)',async({page,browser},testInfo)=>{
 whiteSpace='break-spaces';
 const results=[];
 const fresh=async source=>{
  const value={...base,text:source,textRuns:[]};await mount(page,value);
  await page.evaluate(value=>{spike.mount(value,{terminalBr:true});spike.applyMetricLineHeight();spike.events.length=0;},value);
  return value;
 };
 const snapshot=()=>page.evaluate(()=>({text:spike.readText(),selection:spike.readSelection(),html:document.querySelector('#host').innerHTML,events:[...spike.events]}));
 const target=async(row,method)=>{
  if(method==='click'){
   const p=await page.evaluate(row=>{const h=document.querySelector('#host'),r=h.getBoundingClientRect();return {x:r.left+1,y:r.top+(row+.5)*parseFloat(getComputedStyle(h).lineHeight)};},row);
   await page.mouse.click(p.x,p.y);
  }else {await page.locator('#host').focus();await page.keyboard.press('Control+End');}
 };
 const compareGlyph=async(value,expected,offset)=>{
  // Capture the new glyph Range BEFORE synchronising the Canvas model.
  const glyph=await page.evaluate(()=>{
   const i=spike.readText().indexOf('Z'),a=spike.offsetToDomPoint(i),b=spike.offsetToDomPoint(i+1,'upstream'),r=document.createRange(),h=document.querySelector('#host').getBoundingClientRect();r.setStart(a.node,a.offset);r.setEnd(b.node,b.offset);const box=r.getBoundingClientRect();return {x:box.x-h.x,y:box.y-h.y};
  });
  const projected=await page.evaluate(value=>{spike.mount(value,{terminalBr:true});spike.applyMetricLineHeight();return spike.measure();},{...value,text:expected});
  expect(projected.text).toBe(expected);expect(projected.maxDy).toBeLessThanOrEqual(2);expect(projected.domLines).toEqual(projected.canvasLines);
  const expectedGlyph=projected.pairs.find(p=>p.start===offset-1).canvas;
  const geometry={glyph,expected:{x:expectedGlyph.x,y:expectedGlyph.top},dx:Math.abs(glyph.x-expectedGlyph.x),dy:Math.abs(glyph.y-expectedGlyph.top)};
  return {geometry,projectedMaxDy:projected.maxDy};
 };
 const scenarios=[['A\n\nБ',1,'A\nZ\nБ',3],['A\n',1,'A\nZ',3],['A\n\nБ\n',3,'A\n\nБ\nZ',6],['\n\n',1,'\nZ\n',2],['\n\n',2,'\n\nZ',3]];
 for(const [source,row,expected,offset] of scenarios)for(const method of ['click','ctrl-end','restore','text-end-restore','br-restore']){
  // Ctrl+End is meaningful only for the terminal row; middle rows use clicks.
  if((method==='ctrl-end'||method==='text-end-restore'||method==='br-restore')&&row!==source.split('\n').length-1)continue;
  if((method==='text-end-restore'||method==='br-restore')&&!source.endsWith('\n'))continue;
  const value=await fresh(source);
  const mapping=await page.evaluate(()=>{
   const h=document.querySelector('#host'),br=h.querySelector('br');
   for(let i=0;i<=spike.readText().length;i++)for(const affinity of ['upstream','downstream']){const p=spike.offsetToDomPoint(i,affinity);if(spike.domPointToOffset(p.node,p.offset)!==i)throw Error('UTF-16 round trip');}
   let n=0;for(let i=0;i<=h.childNodes.length;i++){if(spike.domPointToOffset(h,i)!==n)throw Error('host boundary');if(i<h.childNodes.length)n+=h.childNodes[i].textContent.length;}
   const endpoints=['upstream','downstream'].map(affinity=>{const p=spike.offsetToDomPoint(spike.readText().length,affinity),r=document.createRange();r.setStart(p.node,p.offset);r.collapse(true);return {affinity,node:p.node.nodeName,offset:p.offset,rects:[...r.getClientRects()].map(r=>({x:r.x-h.getBoundingClientRect().x,y:r.y-h.getBoundingClientRect().y}))};});
   return {endpoints,sentinel:!!br,baseStyle:!br||getComputedStyle(br).fontSize===getComputedStyle(h).fontSize};
  });
  expect(mapping.sentinel).toBe(source.endsWith('\n'));expect(mapping.baseStyle).toBe(true);
  await target(row,method.includes('restore')?'click':method);
  if(method==='text-end-restore'||method==='br-restore')await page.evaluate(method=>{const p=spike.offsetToDomPoint(spike.readText().length,method==='text-end-restore'?'upstream':'downstream');getSelection().setBaseAndExtent(p.node,p.offset,p.node,p.offset);},method);
  const before=await snapshot();
  if(method.includes('restore')){
   await page.evaluate(value=>{const saved=spike.readSelection();spike.mount(value,{terminalBr:true});spike.applyMetricLineHeight();spike.setSelection(saved.anchor,saved.focus);},value);
   expect((await snapshot()).selection).toEqual(before.selection);
  }
  await page.keyboard.type('Z');const after=await snapshot();
  const {geometry,projectedMaxDy}=await compareGlyph(value,expected,offset);
  const passed=after.text===expected&&after.selection.anchor===offset&&after.selection.focus===offset&&geometry.dx<=2&&geometry.dy<=2;
  results.push({source,method,expected,offset,before,after,mapping,geometry,passed,projectedMaxDy});
 }
 // Observe input synchronously: no following character may conceal a service LF.
 for(const source of ['A','A\n']){
  await fresh(source);await page.locator('#host').focus();await page.keyboard.press('Control+End');await page.keyboard.press('Enter');
  const enter=await snapshot();
  expect(enter.events.map(e=>[e.type,e.inputType])).toEqual([['beforeinput','insertLineBreak'],['input','insertLineBreak']]);
  expect(enter.events[1].text).toBe(enter.text);
  await page.keyboard.type('Z');const after=await snapshot();
  const {geometry,projectedMaxDy}=await compareGlyph({...base,textRuns:[]},source+'\nZ',source.length+2);
  results.push({source,method:'Enter',geometry,projectedMaxDy,expected:source+'\n',enter,after,passed:enter.text===source+'\n'&&after.text===source+'\nZ'&&after.selection.anchor===source.length+2&&after.selection.focus===source.length+2&&geometry.dx<=2&&geometry.dy<=2});
 }
 // Fresh control without the opt-in marker, under the same metric CSS.
 await mount(page,{...base,text:'A\n',textRuns:[]});await page.evaluate(()=>spike.applyMetricLineHeight());
 await target(1,'click');await page.keyboard.type('Z');const withoutSentinel=await snapshot();
 // The BR inherits host style even after a large formatted surrogate pair.
 const mixed={...base,text:'A😀\n',textRuns:[{start:1,end:4,style:{fontSize:40}}]};
 await fresh(mixed.text);
 expect(await page.evaluate(value=>{
  spike.mount(value,{terminalBr:true});const metrics=spike.applyMetricLineHeight(),h=document.querySelector('#host'),br=h.lastChild;
  for(let i=0;i<=value.text.length;i++)for(const affinity of ['upstream','downstream']){const p=spike.offsetToDomPoint(i,affinity);if(spike.domPointToOffset(p.node,p.offset)!==i)throw Error('surrogate mapping');}
  return {text:spike.readText(),brSize:getComputedStyle(br).fontSize,hostSize:getComputedStyle(h).fontSize,lastSpanSize:getComputedStyle(br.previousSibling).fontSize,metrics:metrics.length,spans:h.querySelectorAll('span').length};
 },mixed)).toEqual({text:mixed.text,brSize:'20px',hostSize:'20px',lastSpanSize:'40px',metrics:3,spans:2});
 // Existing spaces-5 soft-wrap under the metric geometry; native clipboard only.
 const wrap={...base,text:'alpha     beta gamma',w:75,textRuns:[]};
 await fresh(wrap.text);await page.evaluate(value=>{spike.mount(value,{terminalBr:true});spike.applyMetricLineHeight();},wrap);
 const points=await page.evaluate(()=>{const m=spike.measure(),h=document.querySelector('#host').getBoundingClientRect();return [m.pairs.filter(p=>p.dom.row===0).at(-1).dom,m.pairs.find(p=>p.dom.row===1).dom].map((d,i)=>({x:h.x+(i?d.x+.2:d.endX-.2),y:h.y+(d.top+d.bottom)/2}));});
 const actions=[];
 for(const p of points){await page.mouse.click(p.x,p.y);actions.push(await snapshot());expect((await snapshot()).selection.focus).toBe(8);}
 await page.keyboard.press('Control+Home');for(let i=0;i<8;i++)await page.keyboard.press('ArrowRight');
 for(const [key,offset] of [['ArrowDown',15],['ArrowUp',8]]){await page.keyboard.press(key);expect((await snapshot()).selection.focus).toBe(offset);actions.push(await snapshot());}
 await page.keyboard.press('Control+a');await page.keyboard.press('Control+c');await page.keyboard.press('Control+End');await page.keyboard.press('Control+v');expect(await text(page)).toBe(wrap.text+wrap.text);
 for(const key of ['Backspace','Delete']){
  await page.evaluate(value=>{spike.mount(value,{terminalBr:true});spike.applyMetricLineHeight();},wrap);await page.locator('#host').focus();await page.keyboard.press('Control+Home');for(let i=0;i<8;i++)await page.keyboard.press('ArrowRight');await page.keyboard.press(key);
  expect(await text(page)).toBe(key==='Backspace'?wrap.text.slice(0,7)+wrap.text.slice(8):wrap.text.slice(0,8)+wrap.text.slice(9));
 }
 await testInfo.attach('native-caret.json',{body:JSON.stringify({browser:browser.version(),withoutSentinel,results,softWrap:{passed:true,actions},gate0B2Passed:results.every(r=>r.passed)},null,2),contentType:'application/json'});
 // Pin the canonical blocker rather than silently labelling diagnostic execution PASS as gate PASS.
 const enter=results.find(r=>r.source==='A'&&r.method==='Enter');
 const chromium=testInfo.project.name.startsWith('chromium');
 expect(enter.enter.text).toBe(chromium?'A\n\n':'A\n');expect(enter.passed).toBe(!chromium);
 for(const result of results.filter(r=>r.method!=='Enter'||r.source!=='A'))expect(result.passed,JSON.stringify({source:result.source,method:result.method})).toBe(true);
});

test('controlled Enter canonical UTF-16 projection (Gate 0B/3 limited smoke)',async({page,browser},testInfo)=>{
 whiteSpace='break-spaces';
 const results=[];
 const fresh=async(text,anchor=text.length,focus=anchor,textRuns=[])=>{
  const value={...base,text,textRuns};await mount(page,value);
  await page.evaluate(({value,anchor,focus})=>{
   spike.mount(value,{terminalBr:true,controlledEnter:true});spike.applyMetricLineHeight();
   document.querySelector('#host').focus();spike.setSelection(anchor,focus);spike.events.length=0;spike.applications.length=0;
  },{value,anchor,focus});
 };
 const snapshot=()=>page.evaluate(()=>{
  const s=getSelection(),h=document.querySelector('#host');
  return {text:spike.readText(),selection:h.contains(s.anchorNode)&&h.contains(s.focusNode)?spike.readSelection():null,...spike.controlledState(),events:[...spike.events]};
 });
 const check=async(expected,offset)=>{
  const state=await snapshot();
  expect(state.fallback).toBeNull();expect(state.text).toBe(expected);expect(state.value.text).toBe(expected);
  expect(state.selection).toEqual({anchor:offset,focus:offset});
  expect(await page.evaluate(()=>{
   const state=spike.controlledState(),saved=spike.readSelection();
   for(let i=0;i<=state.value.text.length;i++)for(const affinity of ['upstream','downstream']){
    const p=spike.offsetToDomPoint(i,affinity);getSelection().setBaseAndExtent(p.node,p.offset,p.node,p.offset);
    if(spike.readSelection().anchor!==i||spike.readSelection().focus!==i)return false;
   }
   spike.setSelection(saved.anchor,saved.focus);
   const h=document.querySelector('#host');
   return !!h.querySelector(':scope > br[data-caret-sentinel]')===state.value.text.endsWith('\n')&&getComputedStyle(h).lineHeight==='24px';
  })).toBe(true);
  results.push({expected,offset,state});return state;
 };
 // Every Enter is asserted immediately, before a following letter or remount.
 for(const [source,anchor,focus,expected,caret] of [
  ['A',1,1,'A\n',2],['A\n',2,2,'A\n\n',3],['AB',1,1,'A\nB',2],
  ['AB',0,2,'\n',1],['A😀B',1,3,'A\nB',2],['AB',2,0,'\n',1],
 ]){
  await fresh(source,anchor,focus);
  if(anchor===focus&&anchor===source.length)await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');const enter=await check(expected,caret);
  expect(enter.applications).toHaveLength(1);
  expect(enter.events.filter(e=>e.type==='input')).toHaveLength(0);
  // Even a duplicate input cannot execute the canceled operation again.
  await page.evaluate(()=>document.querySelector('#host').dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertLineBreak'})));
  expect((await snapshot()).applications).toHaveLength(1);
  if(anchor===focus&&anchor===source.length){await page.keyboard.type('Z');await check(expected+'Z',caret+1);}
 }
 await fresh('A');
 for(let i=1;i<=3;i++){await page.keyboard.press('Enter');await check('A'+'\n'.repeat(i),1+i);}
 await page.keyboard.type('Z');await check('A\n\n\nZ',5);
 for(const [source,offset,key,expected,caret] of [
  ['A\nB',2,'Backspace','AB',1],['A\nB',1,'Delete','AB',1],
  ['A\n\n',3,'Backspace','A\n',2],['A\n',1,'Delete','A',1],
 ]){await fresh(source,offset);await page.keyboard.press(key);await check(expected,caret);}
 // Native paste into the final empty row; retain actual clipboard behavior.
 await fresh('A');await page.keyboard.press('Enter');await check('A\n',2);
 await page.evaluate(()=>{const e=document.createElement('div');e.id='paste-source';e.contentEditable='true';e.innerHTML='<b>P</b><br>Q';document.body.append(e);});
 await page.locator('#paste-source').click();await page.keyboard.press('Control+a');await page.keyboard.press('Control+c');
 await page.locator('#host').focus();await page.evaluate(()=>spike.setSelection(2));await page.keyboard.press('Control+v');
 await check('A\nP\nQ',5);expect(await page.locator('#host b').count()).toBe(0);
 // Use the existing model itself as the formatting oracle, including inherited
 // styles on LF/Z and the shifted right-hand run after emoji replacement.
 const runs=[{start:0,end:3,style:{textColor:'#ff0000',fontWeight:'700'}},{start:3,end:4,style:{fontSize:40}}];
 await fresh('A😀B',1,3,runs);
 const expected=await page.evaluate(async()=>{const {replaceText}=await import('/src/model/rich-text.mjs');const initial=spike.controlledState().value;return replaceText(replaceText(initial,1,3,'\n'),2,2,'Z');});
 await page.keyboard.press('Enter');await check('A\nB',2);await page.keyboard.type('Z');const styled=await check('A\nZB',3);
 expect(styled.value).toEqual(expected);
 expect(await page.locator('#host span').evaluateAll(es=>es.map(e=>({text:e.textContent,color:getComputedStyle(e).color,size:getComputedStyle(e).fontSize})))).toEqual([
  {text:'A\nZ',color:'rgb(255, 0, 0)',size:'20px'},{text:'B',color:'rgb(0, 0, 0)',size:'40px'},
 ]);
 // Fail closed: no cancellation, canonical mutation or DOM rebuild in guards.
 const guards=[];
 for(const kind of ['composition','isComposing','noncancelable','unsupported','outside','split-pair']){
  await fresh('A😀B',1);
  guards.push(await page.evaluate(kind=>{
   const h=document.querySelector('#host');
   if(kind==='composition')h.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
   if(kind==='unsupported'){const b=document.createElement('div');b.textContent='X';h.append(b);}
   if(kind==='outside'){const t=document.body.appendChild(document.createTextNode('outside'));getSelection().setBaseAndExtent(t,0,t,0);}
   if(kind==='split-pair')spike.setSelection(2);
   const node=h.firstChild,html=h.innerHTML,before=spike.controlledState().value;
   const e=new InputEvent('beforeinput',{bubbles:true,inputType:'insertLineBreak',cancelable:kind!=='noncancelable',isComposing:kind==='isComposing'});h.dispatchEvent(e);
   const state=spike.controlledState();
   if(kind==='composition')h.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));
   return {kind,prevented:e.defaultPrevented,preserved:h.firstChild===node&&html===h.innerHTML&&JSON.stringify(before)===JSON.stringify(state.value),fallback:state.fallback};
  },kind));
 }
 for(const guard of guards){expect(guard.prevented).toBe(false);expect(guard.preserved).toBe(true);expect(guard.fallback).toBeTruthy();}
 // Explicit DOM recreation preserves both directions and every UTF-16 offset,
 // including the inside-pair offsets that may be mapped but cannot be edited.
 await fresh('A😀B\n',1,4,runs);
 expect(await page.evaluate(()=>{
  const value=spike.controlledState().value;
  for(let i=0;i<=value.text.length;i++)for(const [anchor,focus] of [[i,0],[0,i]]){
   spike.setSelection(anchor,focus);const old=document.querySelector('#host').firstChild;
   spike.mount(value,{terminalBr:true,controlledEnter:true});spike.applyMetricLineHeight();
   if(old===document.querySelector('#host').firstChild||JSON.stringify(spike.readSelection())!==JSON.stringify({anchor,focus}))return false;
  }
  return true;
 })).toBe(true);
 // Native history is intentionally not repaired. Observe Ctrl+Z and mark the
 // unsupported history transaction for future editor-history integration.
 await fresh('A');await page.keyboard.type('X');await check('AX',2);await page.keyboard.press('Enter');await check('AX\n',3);
 await page.keyboard.press('Control+z');const undo=await snapshot();
 await page.keyboard.press('Control+Shift+z');const redo=await snapshot();
 expect(undo.applications.filter(a=>a.inputType==='insertLineBreak')).toHaveLength(1);
 expect(redo.applications.filter(a=>a.inputType==='insertLineBreak')).toHaveLength(1);
 await testInfo.attach('controlled-enter.json',{body:JSON.stringify({browser:browser.version(),passed:true,results,guards,undo,redo,historyIntegrated:false},null,2),contentType:'application/json'});
});
