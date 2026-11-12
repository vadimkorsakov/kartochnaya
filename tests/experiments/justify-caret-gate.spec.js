const {test,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path');
const {isDeepStrictEqual}=require('node:util');
test.use({serviceWorkers:'block'});
test.describe.configure({timeout:240000});
const variants=['B-left-split','C-justify','D-justify-space-fix','D+adapter'];
// Gecko uses 1/60 CSS px; Chromium uses 1/64. Two independently rounded
// native Range coordinates can differ by at most two of the coarser units.
const localRounding=2/60;

async function routes(page){
 await page.route('http://gate.test/**',async route=>{
  const file=new URL(route.request().url()).pathname;
  if(file==='/')return route.fulfill({contentType:'text/html',body:'<div id="host" style="position:absolute;left:20px;top:20px;width:170px;height:600px"></div>'});
  if(!/^\/(editor|model|render)\/[\w-]+\.mjs$/.test(file))return route.abort();
  let body=await fs.readFile(path.join(__dirname,'../../src',file),'utf8');
  const replace=(a,b)=>{if(!body.includes(a))throw Error('Gate source anchor changed: '+a);body=body.replace(a,b)};
  // Test-only controls. Neither source module nor the shipped bundle changes.
  if(file==='/render/rich-text-layout.mjs'){
   replace('function layoutJustified(e) {','function layoutJustified(e, diagnosticNoStretch=false) {');
   replace('const extra = row.softWrap && spaces.length ?', 'const extra = !diagnosticNoStretch && row.softWrap && spaces.length ?');
  }
  if(file==='/editor/wysiwyg-session.mjs'){
   replace('onFallback, onRecovery, available=', 'onFallback, onRecovery, diagnosticSpaceMode=false, diagnosticPointerAdapter=false, diagnosticSchedulePointerTask=fn=>setTimeout(fn,0), diagnosticCancelPointerTask=id=>clearTimeout(id), onPointerDiagnostic=()=>{}, available=');
   const prototype=await fs.readFile(path.join(__dirname,'fixtures/justify-pointer-adapter.js.txt'),'utf8');
   replace("const abort=new AbortController(), listen=(name,fn)=>host.addEventListener(name,fn,{signal:abort.signal});", "const abort=new AbortController(), listen=(name,fn)=>host.addEventListener(name,fn,{signal:abort.signal});\n"+prototype);
   replace('dispose(){abort.abort();',"dispose(){clearPointerGesture('dispose');abort.abort();");
   replace('preserve(){inactive=true;',"preserve(){clearPointerGesture('preserve');inactive=true;");
   replace('function stop(reason){pasteText=',"function stop(reason){clearPointerGesture('recovery');pasteText=");
   replace('function project(value,selection){', "function project(value,selection){pointerEpoch++;clearPointerGesture('project');");
   replace('rowNode.append(span);ctx.font=richTextFont(part.style);',`ctx.font=richTextFont(part.style);ctx.letterSpacing=part.style.letterSpacing+'px';
    if(diagnosticSpaceMode&&part.text===' ')span.style.wordSpacing=(part.width-ctx.measureText(part.text).width)+'px';
    rowNode.append(span);ctx.font=richTextFont(part.style);`);
   replace('advance=part.x+ctx.measureText(part.text).width;',"advance=part.x+(diagnosticSpaceMode&&part.text===' '?part.width:ctx.measureText(part.text).width);");
  }
  return route.fulfill({contentType:'text/javascript',body});
 });
}
async function setup(page,variant,rich,tracking=0,zoom=1,{measure=true,alignment=null,holdTasks=false,blockNotifications=false}={}){
 return page.evaluate(async({variant,rich,tracking,zoom,measure,alignment,holdTasks,blockNotifications})=>{
  window.gate?.session.dispose();window.gate?.observer.abort();const host=document.querySelector('#host');host.replaceChildren();Object.assign(host.style,{transform:`scale(${zoom})`,transformOrigin:'0 0'});
  const {createWysiwygSession}=await import('/editor/wysiwyg-session.mjs');
  const {createRichTextLayoutEngine,richTextFont}=await import('/render/rich-text-layout.mjs');
  const {createInlineHistory}=await import('/model/inline-text-history.mjs');
  const layer={type:'text',text:'AVATAR   To WA 😀 é alpha beta gamma\nAV To\n\nZ',w:170,h:600,fontFamily:'Arial',fontSize:24,lineHeight:1.2,textAlign:alignment||(variant.startsWith('B')?'left':'justify'),letterSpacing:tracking,...(rich?{textRuns:[{start:1,end:2,style:{textColor:'#cc2244',fillOpacity:50}},{start:12,end:14,style:{fontWeight:'700',letterSpacing:1}}]}:{})};
  const ctx=document.createElement('canvas').getContext('2d'),engine=createRichTextLayoutEngine(ctx,document.fonts),segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
  const layout=e=>e.textAlign==='justify'||variant.startsWith('B')?engine.layoutJustified(e,variant.startsWith('B')):engine.layout(e);
  const requestedText=layer.text,requestedRuns=JSON.stringify(layer.textRuns),events=[],recovery=[],fallback=[],heldTasks=[],pointerState={pending:false,blockNotifications},observer=new AbortController();
  const record=(type,event,phase)=>{
   let selection=null;try{selection=window.gate?.session.readSelection()}catch{}
   events.push({type,phase,event:event?.type,x:event?.clientX,y:event?.clientY,detail:event?.detail,shift:event?.shiftKey,selection,trusted:event?.isTrusted,defaultPrevented:event?.defaultPrevented,time:performance.now()});
  };
  for(const type of ['pointerdown','mousedown','pointerup','mouseup','click','selectionchange','beforeinput','input','pointercancel','dragstart','dragend','drop','focusout','compositionstart','compositionend','copy','keydown','keyup']){
   for(const capture of [true,false])document.addEventListener(type,event=>{record(type,event,capture?'capture':'bubble');if(capture&&type==='selectionchange'&&pointerState.blockNotifications)event.stopImmediatePropagation()},{capture,signal:observer.signal});
  }
  const history=createInlineHistory(layer);
  const session=createWysiwygSession({host,element:layer,history,layout,diagnosticSpaceMode:variant.startsWith('D')&&(!alignment||alignment==='justify'),diagnosticPointerAdapter:variant==='D+adapter',diagnosticSchedulePointerTask:holdTasks?fn=>{heldTasks.push({fn,canceled:false});return heldTasks.length-1}:undefined,
   diagnosticCancelPointerTask:holdTasks?id=>{if(heldTasks[id])heldTasks[id].canceled=true}:undefined,
   onPointerDiagnostic:event=>{if(['candidate','pending-click'].includes(event.type))pointerState.pending=true;if(['cancel','correct','already-correct','ignored'].includes(event.type))pointerState.pending=false;events.push({...event,phase:'adapter',time:performance.now()})},compatible:()=>true,onChange(){},onRecovery(reason){recovery.push(reason)},onFallback(...args){fallback.push(args)}});
  window.gate={layer,session,layout,events,observer,recovery,fallback,history,heldTasks,pointerState,clipboardWrites:[]};
  if(!window.pointerCopySpy){const original=DataTransfer.prototype.setData;DataTransfer.prototype.setData=function(type,data){if(window.gate?.copyActive)gate.clipboardWrites.push({type,data});return original.call(this,type,data)};window.pointerCopySpy=true;}session.focus();const projection=layout(layer),origin=host.getBoundingClientRect();
  const caretMeasurements=[],endpoints=[],fragments=[],spaces=[];
  const sample=(offset,rowIndex)=>{
   const native=getSelection(),range=native.getRangeAt(0),r=range.getBoundingClientRect(),owner=[...host.children].indexOf(native.focusNode.parentElement.closest('[data-wysiwyg-row]'));
   return {offset,row:rowIndex,source:layer.text.slice(offset,offset+2),actual:(r.x-origin.x)/zoom,hasRect:range.getClientRects().length>0,selection:session.readSelection(),owner};
  };
  for(const [ri,row] of projection.rows.entries()){
   if(measure&&row.carets){
   for(const point of row.carets){session.setSelection(point.offset,point.offset,ri);caretMeasurements.push({...sample(point.offset,ri),expected:point.x,delta:sample(point.offset,ri).actual-point.x})}
   for(const [pi,span] of [...host.children[ri].children].entries()){
    const p=row.fragments[pi];if(!p)continue;const box=span.getBoundingClientRect();
    fragments.push({row:ri,start:p.start,end:p.end,text:p.text,x:p.x,logicalX:p.logicalX??p.x,width:p.width,actualX:(box.x-origin.x)/zoom,actualWidth:box.width/zoom,cssLetterSpacing:span.style.letterSpacing,cssWordSpacing:span.style.wordSpacing,cssWidth:span.style.width,sourceTracking:p.style.letterSpacing});
    for(const [edge,index,offset] of [['before',0,p.start],['after',p.text.length,p.end]]){
     getSelection().setBaseAndExtent(span.firstChild,index,span.firstChild,index);
     const value=sample(offset,ri),expected=row.carets.find(c=>c.offset===offset).x;
     endpoints.push({...value,start:p.start,end:p.end,text:p.text,edge,expected,delta:value.actual-expected});
    }
   }
   }
   if(!row.carets)continue;
   // Identical source-space probes in all four controls. They are the interior
   // U+0020 offsets eligible for expansion in C/D, including repeated spaces.
   const source=layer.text.slice(row.start,row.end),first=source.search(/\S/u),last=source.search(/\s*$/u);
   if(row.softWrap)for(let i=first+1;i<last;i++)if(source[i]===' '){
    const start=row.start+i,end=start+1,left=row.carets.find(c=>c.offset===start),right=row.carets.find(c=>c.offset===end);
    session.setSelection(start,start,ri);const r=getSelection().getRangeAt(0).getBoundingClientRect();
    const pi=row.fragments.findIndex(p=>p.start<=start&&p.end>=end),part=row.fragments[pi],node=host.children[ri].children[pi].firstChild;
    const ends=[];
    for(const offset of [start,end]){getSelection().setBaseAndExtent(node,offset-part.start,node,offset-part.start);ends.push(sample(offset,ri))}
    spaces.push({row:ri,start,end,x:left.x,right:right.x,width:right.x-left.x,expanded:!!row.justification?.spaces.includes(start)&&row.justification.extraPerSpace>0,y:r.y+r.height/2,nativeBefore:ends[0],nativeAfter:ends[1]});
   }
  }
  const selections=[];
  for(const [anchor,focus] of [[0,6],[6,0],[6,9],[9,6],[2,layer.text.length-1]]){
   session.setSelection(anchor,focus);selections.push({anchor,focus,read:session.readSelection(),text:getSelection().toString(),expected:layer.text.slice(Math.min(anchor,focus),Math.max(anchor,focus))});
  }
  return {variant,rich,tracking,zoom,modelKeys:Object.keys(layer),historySnapshot:JSON.stringify(history.states),sourceRuns:structuredClone(layer.textRuns),sourcePreserved:layer.text===requestedText&&host.textContent===requestedText,runsPreserved:JSON.stringify(layer.textRuns)===requestedRuns,trackingPreserved:layer.letterSpacing===tracking,projection,caretMeasurements,endpoints,fragments,spaces,selections,sourceText:layer.text,text:host.textContent,origin:{x:origin.x,y:origin.y},nativeCanvasCarets:!variant.startsWith('A')};
 },{variant,rich,tracking,zoom,measure,alignment,holdTasks,blockNotifications});
}
async function readMouse(page){return page.evaluate(()=>{
 const host=document.querySelector('#host'),s=getSelection(),node=s.focusNode?.nodeType===3?s.focusNode.parentElement:s.focusNode;
 try{return {clean:gate.session.clean(),domMatchesCanonical:host.textContent===gate.layer.text,selection:gate.session.readSelection(),text:s.toString(),owner:[...host.children].indexOf(node?.closest('[data-wysiwyg-row]'))}}catch(e){return {error:String(e),text:s.toString()}}
})}
const maximum=values=>Math.max(0,...values);
function compare(candidate,control){
 const pairs=[];
 for(const key of ['caretMeasurements','endpoints'])for(const p of candidate[key].filter(p=>p.hasRect)){
  const q=control[key].find(q=>q.hasRect&&q.row===p.row&&q.offset===p.offset&&(key!=='endpoints'||q.start===p.start&&q.end===p.end&&q.edge===p.edge));
  if(q)pairs.push({kind:key,row:p.row,offset:p.offset,text:p.text,edge:p.edge,controlError:q.delta,candidateError:p.delta,signedDifference:p.delta-q.delta,additionalError:Math.max(0,Math.abs(p.delta)-Math.abs(q.delta)),
   // Each paired projection accumulates native span-width and CSS-margin
   // rounding. Two coordinates * two terms * (preceding spans + own edge).
   roundingBound:4*(candidate.fragments.filter(f=>f.row===p.row&&f.start<=p.offset).length+1)/60});
 }
 return {control:control.variant,pairs,maxSignedDifference:maximum(pairs.map(p=>Math.abs(p.signedDifference))),maxAdditionalError:maximum(pairs.map(p=>p.additionalError)),beyondRounding:pairs.filter(p=>p.additionalError>p.roundingBound)};
}
async function settle(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))}
async function clearEvents(page){await settle(page);await page.evaluate(()=>gate.events.length=0)}
async function idle(page){await page.waitForFunction(()=>!gate.pointerState.pending,null,{timeout:1500})}
async function events(page){return page.evaluate(()=>structuredClone(gate.events))}
test('pointer pilot: post-native first-space correction and event ordering',async({page},info)=>{
 await routes(page);await page.goto('http://gate.test/');const result=[];
 for(const variant of ['D-justify-space-fix','D+adapter']){
  const r=await setup(page,variant,false),p=r.spaces.find(p=>p.start===6);await clearEvents(page);
  await page.mouse.click(r.origin.x+.4*p.width+p.x,p.y);
  const immediate=await readMouse(page);await idle(page);await settle(page);const later=await readMouse(page);
  await page.keyboard.type('X');const afterInput=await readMouse(page),model=await page.evaluate(()=>structuredClone(gate.layer));
  result.push({variant,space:p,immediate,later,afterInput,model,events:await events(page)});
 }
 await info.attach('pointer-pilot.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});
 console.log('POINTER_PILOT',JSON.stringify(result.map(r=>({variant:r.variant,immediate:r.immediate.selection,later:r.later.selection,text:r.model.text,corrections:r.events.filter(e=>e.type==='correct').length}))));
 const r=result[1];expect(r.later.selection).toEqual({anchor:6,focus:6});expect(r.model.text).toBe('AVATARX   To WA 😀 é alpha beta gamma\nAV To\n\nZ');expect(r.afterInput.selection).toEqual({anchor:7,focus:7});
 const trace=r.events,clickCapture=trace.findIndex(e=>e.type==='click'&&e.phase==='capture'),clickBubble=trace.findIndex(e=>e.type==='click'&&e.phase==='bubble'),up=trace.findIndex(e=>e.type==='pointerup'&&e.phase==='capture'),input=trace.findIndex(e=>e.type==='beforeinput'&&e.phase==='capture');
 expect(up).toBeGreaterThanOrEqual(0);expect(clickCapture).toBeGreaterThan(up);expect(clickBubble).toBeGreaterThan(clickCapture);expect(input).toBeGreaterThan(clickBubble);
 expect(trace[input].selection).toEqual({anchor:6,focus:6});
 for(const [index,event] of trace.entries())if(event.type==='correct'){expect(['selectionchange','post-click-task','keydown','beforeinput']).toContain(event.event);expect(index).toBeGreaterThan(clickBubble);expect(index).toBeLessThan(input)}
 expect(Object.keys(r.model).some(k=>k.startsWith('__gate')||k.startsWith('diagnostic')||k==='onPointerDiagnostic')).toBe(false);
});

async function take(page){return page.evaluate(()=>{
 const s=getSelection(),host=document.querySelector('#host');let selection=null;try{selection=gate.session.readSelection()}catch{}
 const node=s.focusNode?.nodeType===3?s.focusNode.parentElement:s.focusNode;
 return {owner:[...host.children].indexOf(node?.closest('[data-wysiwyg-row]')),selection,text:s.toString(),clean:gate.session.clean(),modelText:gate.layer.text,runs:structuredClone(gate.layer.textRuns),domText:host.textContent,events:gate.events.splice(0),recovery:[...gate.recovery],fallback:[...gate.fallback]};
})}
const correctionCount=r=>r.events.filter(e=>e.phase==='adapter'&&e.type==='correct').length;
function clickReference(result,space,shot){
 const native=shot.events.findLast(e=>e.type==='click'&&e.phase==='capture');
 if(!native)return {category:'missing-click',ok:false};
 const left=result.origin.x+space.x*result.zoom,right=result.origin.x+space.right*result.zoom,mid=(left+right)/2;
 const inside=native.x>=left&&native.x<=right;
 const expected=Math.abs(native.x-mid)<1e-7?[space.start,space.end]:[native.x<mid?space.start:space.end];
 return {nativeX:native.x,nativeY:native.y,left,right,expected,category:inside&&(space.expanded||result.variant.startsWith('B'))?'eligible':'other',ok:!!shot.selection&&shot.selection.anchor===shot.selection.focus&&expected.includes(shot.selection.focus)&&shot.owner===space.row&&shot.clean&&shot.modelText===result.sourceText&&shot.domText===result.sourceText};
}
async function matrixClicks(page,r){
 await clearEvents(page);const points=[];
 for(const space of r.spaces)for(const fraction of [.2,.3,.4,.45,.5,.55,.6,.7,.8]){
  const requestedX=r.origin.x+(space.x+fraction*space.width)*r.zoom;await page.mouse.click(requestedX,space.y);await idle(page);
  const shot=await take(page),reference=clickReference(r,space,shot);
  points.push({row:space.row,start:space.start,fraction,requestedX,selection:shot.selection,reference,corrections:correctionCount(shot),events:fraction===.4&&space.start===6?shot.events:undefined});
 }
 await settle(page);const stable=await take(page);return {points,stable};
}
async function editing(page,variant,rich,tracking,zoom){
 const results=[];
 for(const [name,fraction,key] of [['arrows',.3,'arrows'],['type-left',.3,'X'],['type-right',.7,'X'],['Backspace',.3,'Backspace'],['Delete',.3,'Delete']]){
  const r=await setup(page,variant,rich,tracking,zoom,{measure:false}),space=r.spaces.find(s=>s.start===6),offset=fraction<.5?6:7;
  await clearEvents(page);await page.mouse.click(r.origin.x+(space.x+fraction*space.width)*zoom,space.y);const click=await take(page),arrows=[];
  let start=offset,end=offset,insert='';
  if(key==='arrows'){for(const [arrow,expected] of [['ArrowRight',offset+1],['ArrowLeft',offset]]){await page.keyboard.press(arrow);arrows.push({expected,...await take(page)})}}
  else if(key==='X'){insert='X';await page.keyboard.type('X')}
  else {if(key==='Backspace')start--;else end++;await page.keyboard.press(key)}
  const final=await take(page),wanted=r.sourceText.slice(0,start)+insert+r.sourceText.slice(end),delta=insert.length-end+start,caret=key==='arrows'?offset:start+insert.length;
  const expectedRuns=r.sourceRuns?.map(run=>({...run,start:run.start>=end?run.start+delta:run.start,end:run.end>=end?run.end+delta:run.end}));
  const ok=arrows.every(p=>p.selection?.anchor===p.expected&&p.selection?.focus===p.expected)&&final.selection?.anchor===caret&&final.selection?.focus===caret&&final.modelText===wanted&&final.domText===wanted&&final.clean&&final.owner===0&&isDeepStrictEqual(final.runs,expectedRuns);
  results.push({name,offset,click,arrows,wanted,caret,final,expectedRuns,ok});
 }
 return results;
}
async function drags(page,r){
 const values=[];const point=(row,offset)=>({x:r.origin.x+r.projection.rows[row].carets.find(p=>p.offset===offset).x*r.zoom,y:r.origin.y+(r.projection.rows[row].y+r.projection.rows[row].height/2)*r.zoom});
 for(const [name,a,b] of [['forward',[0,6],[0,9]],['backward',[0,9],[0,6]],['wrap-forward',[0,6],[1,21]],['wrap-backward',[1,21],[0,6]]]){
  const reset=point(0,0);await page.mouse.click(reset.x,reset.y);await clearEvents(page);
  const from=point(...a),to=point(...b);await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:10});await page.mouse.up();
  const shot=await take(page),wanted=r.sourceText.slice(Math.min(a[1],b[1]),Math.max(a[1],b[1]));
  values.push({name,a,b,wanted,shot,ok:shot.selection?.anchor===a[1]&&shot.selection?.focus===b[1]&&shot.text===wanted&&shot.clean&&shot.owner===b[0]&&correctionCount(shot)===0});
 }
 return values;
}
function geometry(r,b){
 const pair=compare(r,b),local=[];
 for(const p of r.caretMeasurements.filter(p=>p.hasRect)){
  const part=r.fragments.findLast(f=>f.row===p.row&&f.start<=p.offset&&p.offset<=f.end);if(!part?.text.trim())continue;
  const q=b.caretMeasurements.find(q=>q.row===p.row&&q.offset===p.offset),base=b.fragments.find(f=>f.row===part.row&&f.start===part.start&&f.end===part.end);
  if(q&&base)local.push((p.actual-part.actualX)-(q.actual-base.actualX));
 }
 return {additionalVsB:pair.maxAdditionalError,localShape:maximum(local.map(Math.abs)),spaceWidth:maximum(r.spaces.map(s=>Math.abs(s.nativeAfter.actual-s.nativeBefore.actual-s.width))),ok:pair.beyondRounding.length===0&&local.every(x=>Math.abs(x)<=localRounding)&&r.spaces.every(s=>Math.abs(s.nativeAfter.actual-s.nativeBefore.actual-s.width)<=localRounding)};
}
async function outsidePoints(page,r){
 const positions=[];
 for(const [i,row] of r.projection.rows.entries()){
  for(let offset=row.start;offset<row.end;offset++)if(r.sourceText[offset]===' '&&!row.justification?.spaces.includes(offset)){
   const a=row.carets.find(c=>c.offset===offset),b=row.carets.find(c=>c.offset===offset+1);if(a&&b)positions.push({name:row.nextStart>row.end?'before-LF':'unstretched-or-trailing',row:i,offset,x:(a.x+b.x)/2,y:row.y+row.height/2});break;
  }
 }
 positions.push({name:'word',row:0,offset:3,x:r.projection.rows[0].carets.find(c=>c.offset===3).x,y:r.projection.rows[0].height/2});
 const values=[];
 for(const p of positions){await page.mouse.click(r.origin.x,r.origin.y+r.projection.rows[0].height*r.zoom/2);await clearEvents(page);await page.mouse.click(r.origin.x+p.x*r.zoom,r.origin.y+p.y*r.zoom);const shot=await take(page);values.push({position:p,shot})}
 return values;
}
for(const rich of [false,true])test(`pointer matrix: eligible spaces, input and outside controls rich=${rich}`,async({page},info)=>{
 await routes(page);await page.goto('http://gate.test/');const cases=[];
 for(const tracking of [-.5,0,1.25])for(const zoom of [.6,1,1.5]){
  const models=[];
  for(const variant of ['B-left-split','D-justify-space-fix','D+adapter']){
   const r=await setup(page,variant,rich,tracking,zoom);r.clicks=await matrixClicks(page,r);r.outside=await outsidePoints(page,r);
   r.drags=variant.startsWith('D')?await drags(page,r):[];r.historyUnchanged=await page.evaluate(initial=>JSON.stringify(gate.history.states)===initial,r.historySnapshot);
   r.editing=await editing(page,variant,rich,tracking,zoom);models.push(r);
  }
  if(tracking===0&&zoom===1){const r=await setup(page,'C-justify',rich);r.clicks=await matrixClicks(page,r);models.push(r)}
  const base=models[0],native=models[1],adapted=models[2];
  const newOutside=adapted.outside.filter((p,i)=>!isDeepStrictEqual(p.shot.selection,native.outside[i]?.shot.selection)||p.shot.text!==native.outside[i]?.shot.text||correctionCount(p.shot)!==0);
  for(const point of adapted.clicks.points.filter(p=>p.reference.category==='other')){
   const basePoint=native.clicks.points.find(p=>p.row===point.row&&p.start===point.start&&p.fraction===point.fraction);
   if(!basePoint||!isDeepStrictEqual(point.selection,basePoint.selection)||point.corrections)newOutside.push({point,basePoint});
  }
  for(const r of models){
   const g=geometry(r,base),eligible=r.clicks.points.filter(p=>p.reference.category==='eligible');
   r.summary={variant:r.variant,rich,tracking,zoom,eligibleClicks:eligible.length,eligibleErrors:eligible.filter(p=>!p.reference.ok).length,otherClicks:(r.outside?.length||0)+r.clicks.points.filter(p=>p.reference.category==='other').length,newOutsideErrors:r===adapted?newOutside.length:0,dragErrors:r.drags?.filter(p=>!p.ok).length||0,drags:r.drags?.length||0,inputErrors:r.editing?.filter(p=>!p.ok).length||0,inputCases:r.editing?.length||0,additionalVsB:g.additionalVsB,localShape:g.localShape,spaceWidth:g.spaceWidth,geometryOK:g.ok,sourcePreserved:r.sourcePreserved&&r.runsPreserved&&r.trackingPreserved,modelHasDiagnosticFlags:r.modelKeys.some(k=>k.startsWith('__gate')||k.startsWith('diagnostic')||k==='onPointerDiagnostic'),pass:r!==adapted||r.sourcePreserved&&r.runsPreserved&&r.trackingPreserved&&r.historyUnchanged&&r.caretMeasurements.every(p=>p.owner===p.row&&p.selection.anchor===p.offset&&p.selection.focus===p.offset)&&!r.modelKeys.some(k=>k.startsWith('__gate')||k.startsWith('diagnostic')||k==='onPointerDiagnostic')&&isDeepStrictEqual(r.clicks.stable.selection,r.clicks.points.at(-1).selection)&&correctionCount(r.clicks.stable)===0&&eligible.every(p=>p.reference.ok)&&newOutside.length===0&&r.drags.every(p=>p.ok)&&r.editing.every(p=>p.ok)&&g.ok};
  }
  cases.push({rich,tracking,zoom,models,newOutside});
 }
 await info.attach('pointer-matrix.json',{body:JSON.stringify({cases},null,2),contentType:'application/json'});
 console.log('POINTER_MATRIX',JSON.stringify(cases.flatMap(c=>c.models.map(r=>r.summary))));
 expect.soft(cases.flatMap(c=>c.models.filter(r=>r.variant==='C-justify')).every(r=>r.summary.eligibleErrors>0),'C remains negative control').toBe(true);
 expect.soft(cases.flatMap(c=>c.models.filter(r=>r.variant==='D+adapter'&&!r.summary.pass)).map(r=>r.summary),'D+adapter acceptance').toEqual([]);
});

async function copySelected(page){
 await page.evaluate(()=>{gate.copyActive=true;gate.clipboardWrites.length=0});await page.keyboard.press('Control+c');
 return page.evaluate(()=>{gate.copyActive=false;return {writes:structuredClone(gate.clipboardWrites),selection:gate.session.readSelection(),text:getSelection().toString()}});
}
async function gestures(page,variant,rich,zoom){
 let r=await setup(page,variant,rich,0,zoom,{measure:false});const p=r.spaces.find(s=>s.start===6),shifts=[];
 for(const [name,anchor,fraction,focus,anchorRow] of [['forward',0,.7,7,null],['backward-across-wrap',21,.3,6,null],['upstream-soft-wrap-anchor',r.projection.rows[0].end,.3,6,0]]){
  await page.evaluate(({anchor,anchorRow})=>{gate.session.setSelection(anchor,anchor,anchorRow);const s=getSelection();gate.originalAnchor={node:s.anchorNode,offset:s.anchorOffset}},{anchor,anchorRow});await clearEvents(page);
  await page.keyboard.down('Shift');await page.mouse.click(r.origin.x+(p.x+p.width*fraction)*zoom,p.y);await page.keyboard.up('Shift');await idle(page);
  const immediate=await take(page);const nativeAnchorPreserved=await page.evaluate(()=>getSelection().anchorNode===gate.originalAnchor.node&&getSelection().anchorOffset===gate.originalAnchor.offset);await settle(page);const stable=await take(page),copy=await copySelected(page),wanted=r.sourceText.slice(Math.min(anchor,focus),Math.max(anchor,focus));
  shifts.push({name,anchor,focus,nativeAnchorPreserved,wanted,immediate,stable,copy,ok:nativeAnchorPreserved&&immediate.selection?.anchor===anchor&&immediate.selection?.focus===focus&&isDeepStrictEqual(immediate.selection,stable.selection)&&immediate.text===wanted&&copy.writes.some(w=>w.type==='text/plain'&&w.data===wanted)&&stable.clean});
 }
 r=await setup(page,variant,rich,0,zoom,{measure:false});await clearEvents(page);
 await page.mouse.dblclick(r.origin.x+10*zoom,r.origin.y+r.projection.rows[0].height*zoom/2);await idle(page);const double=await take(page);
 // First perform a real selection gesture, then begin dragging inside it.
 r=await setup(page,variant,rich,0,zoom,{measure:false});
 const point=(row,offset)=>({x:r.origin.x+r.projection.rows[row].carets.find(p=>p.offset===offset).x*zoom,y:r.origin.y+(r.projection.rows[row].y+r.projection.rows[row].height/2)*zoom});
 await page.mouse.click(r.origin.x,r.origin.y+r.projection.rows[0].height*zoom/2);
 const a=point(0,6),b=point(0,9);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:10});await page.mouse.up();
 const selected=await take(page);await clearEvents(page);
 const from=r.spaces.find(s=>s.start===6),to=point(1,21);await page.mouse.move(r.origin.x+(from.x+from.width*.4)*zoom,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:16});await page.mouse.up();
 await settle(page);const dnd=await take(page);
 return {variant,rich,zoom,shifts,double,selected,dnd};
}
test('pointer gestures: Shift anchors, word double-click, native selected-text DnD and copy',async({page},info)=>{
 await routes(page);await page.goto('http://gate.test/');const cases=[];
 for(const rich of [false,true])for(const zoom of [.6,1,1.5]){
  const baseline=await gestures(page,'D-justify-space-fix',rich,zoom),adapted=await gestures(page,'D+adapter',rich,zoom);
  const types=r=>r.events.filter(e=>['dragstart','drop','dragend'].includes(e.type)&&e.phase==='capture').map(e=>e.type);
  const state=r=>({selection:r.selection,text:r.text,modelText:r.modelText,domText:r.domText,clean:r.clean,runs:r.runs});
  const errors=[];
  if(adapted.shifts.some(p=>!p.ok))errors.push('Shift/copy/source direction');
  if(!isDeepStrictEqual(state(baseline.double),state(adapted.double))||correctionCount(adapted.double))errors.push('word double-click intercepted');
  if(!isDeepStrictEqual(state(baseline.dnd),state(adapted.dnd))||!isDeepStrictEqual(types(baseline.dnd),types(adapted.dnd))||correctionCount(adapted.dnd))errors.push('selected-text DnD changed');
  cases.push({rich,zoom,baseline,adapted,errors});
 }
 await info.attach('pointer-gestures.json',{body:JSON.stringify({cases},null,2),contentType:'application/json'});
 console.log('POINTER_GESTURES',JSON.stringify(cases.map(({rich,zoom,errors,adapted})=>({rich,zoom,errors,nativeDnD:adapted.dnd.events.some(e=>e.type==='dragstart'),shifts:adapted.shifts.map(p=>p.ok)}))));
 expect(cases.filter(c=>c.errors.length).map(({rich,zoom,errors})=>({rich,zoom,errors}))).toEqual([]);
});

async function cancellation(page,variant,kind){
 const r=await setup(page,variant,true,0,1,{measure:false}),p=r.spaces.find(p=>p.start===6);await clearEvents(page);
 const x=r.origin.x+p.x+p.width*.4;await page.mouse.move(x,p.y);await page.mouse.down();
 if(kind==='pointercancel')await page.evaluate(()=>document.querySelector('#host').dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:1,pointerType:'mouse'})));
 if(kind==='blur')await page.evaluate(()=>{let panel=document.querySelector('#panel');if(!panel){panel=document.createElement('input');panel.id='panel';panel.style.cssText='position:absolute;left:700px;top:20px';document.body.append(panel)}panel.focus()});
 if(kind==='layout')await page.evaluate(()=>gate.session.applyLayerStyle({letterSpacing:.5},{key:'letterSpacing',final:true}));
 if(kind==='transform')await page.locator('#host').evaluate(h=>h.style.transform='scale(1.5)');
 if(kind==='input')await page.keyboard.type('X');
 if(kind==='composition')await page.locator('#host').dispatchEvent('compositionstart',{data:''});
 await page.mouse.up();await settle(page);let shot=await take(page);
 if(kind==='composition'){await page.locator('#host').dispatchEvent('compositionend',{data:''});await page.evaluate(()=>gate.session.recover());await settle(page);const recovered=await take(page);shot={...recovered,events:[...shot.events,...recovered.events]}}
 const panelValue=kind==='blur'?await page.locator('#panel').inputValue():null;
 return {kind,variant,shot,panelValue};
}
test('pointer cancellation: no stale correction after cancel, blur, IME, layout, transform or early input',async({page},info)=>{
 await routes(page);await page.goto('http://gate.test/');const cases=[];
 for(const kind of ['pointercancel','blur','composition','layout','transform','input']){
  const baseline=await cancellation(page,'D-justify-space-fix',kind),adapted=await cancellation(page,'D+adapter',kind);
  const state=r=>({selection:r.shot.selection,modelText:r.shot.modelText,domText:r.shot.domText,clean:r.shot.clean,runs:r.shot.runs,panel:r.panelValue});
  cases.push({kind,baseline,adapted,ok:correctionCount(adapted.shot)===0&&isDeepStrictEqual(state(baseline),state(adapted))});
 }
 for(const kind of ['pointercancel','blur','composition','layout','transform']){
  const baseline=await afterClickCancellation(page,'D-justify-space-fix',kind),adapted=await afterClickCancellation(page,'D+adapter',kind);
  const state=r=>({selection:r.shot.selection,modelText:r.shot.modelText,domText:r.shot.domText,clean:r.shot.clean,runs:r.shot.runs});
  cases.push({kind,phase:'after-click',baseline,adapted,ok:correctionCount(adapted.shot)===0&&isDeepStrictEqual(state(baseline),state(adapted))});
 }
 await info.attach('pointer-cancellation.json',{body:JSON.stringify({cases},null,2),contentType:'application/json'});
 console.log('POINTER_CANCEL',JSON.stringify(cases.map(({kind,ok})=>({kind,ok}))));expect(cases.filter(c=>!c.ok).map(c=>c.kind)).toEqual([]);
});

test('pointer scope: left center right retain native Selection',async({page},info)=>{
 await routes(page);await page.goto('http://gate.test/');const cases=[];
 for(const alignment of ['left','center','right']){
  const values=[];
  for(const variant of ['D-justify-space-fix','D+adapter']){
   await setup(page,variant,true,0,1,{measure:false,alignment});
   const point=await page.evaluate(()=>{gate.session.setSelection(6,6,0);const a=getSelection().getRangeAt(0).getBoundingClientRect();gate.session.setSelection(7,7,0);const b=getSelection().getRangeAt(0).getBoundingClientRect();return {x:a.x+(b.x-a.x)*.3,y:a.y+a.height/2}});
   await clearEvents(page);await page.mouse.click(point.x,point.y);values.push({variant,shot:await take(page)});
  }
  const [b,a]=values;cases.push({alignment,values,ok:correctionCount(a.shot)===0&&isDeepStrictEqual(a.shot.selection,b.shot.selection)&&a.shot.text===b.shot.text&&a.shot.modelText===b.shot.modelText});
 }
 await info.attach('pointer-nonjustify.json',{body:JSON.stringify({cases},null,2),contentType:'application/json'});expect(cases.filter(c=>!c.ok).map(c=>c.alignment)).toEqual([]);
});

async function afterClickCancellation(page,variant,kind){
 await setup(page,variant,true,0,1,{measure:false,holdTasks:true,blockNotifications:true});
 const point=await page.evaluate(()=>{const row=gate.layout(gate.layer).rows[0],a=row.carets.find(c=>c.offset===6),b=row.carets.find(c=>c.offset===7);return {x:20+a.x+(b.x-a.x)*.4,y:20+row.height/2}});
 await clearEvents(page);
 await page.evaluate(kind=>document.addEventListener('click',()=>{
  const host=document.querySelector('#host');
  if(kind==='pointercancel')host.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:1,pointerType:'mouse'}));
  if(kind==='blur'){let p=document.querySelector('#panel');if(!p){p=document.createElement('input');p.id='panel';p.style.cssText='position:absolute;left:700px;top:20px';document.body.append(p)}p.focus()}
  if(kind==='layout')gate.session.applyLayerStyle({letterSpacing:.5},{key:'letterSpacing',final:true});
  if(kind==='transform')host.style.transform='scale(1.5)';
  if(kind==='composition')host.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));
 },{once:true}),kind);
 await page.mouse.click(point.x,point.y);await settle(page);
 if(kind==='composition')await page.evaluate(()=>{document.querySelector('#host').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:''}));gate.session.recover()});
 await page.evaluate(()=>{for(const task of gate.heldTasks)task.fn();gate.pointerState.blockNotifications=false});await settle(page);
 return {kind,phase:'after-click',variant,shot:await take(page)};
}
test('pointer deferred races: withheld Selectionchange/task cannot race immediate input or late focus',async({page},info)=>{
 await routes(page);await page.goto('http://gate.test/');
 const r=await setup(page,'D+adapter',true,0,1,{measure:false,holdTasks:true,blockNotifications:true}),p=r.spaces.find(p=>p.start===6);
 await clearEvents(page);await page.mouse.click(r.origin.x+p.x+p.width*.4,p.y);
 const pending=await page.evaluate(()=>gate.pointerState.pending);
 // A real keyboard action preempts both deliberately withheld async paths.
 await page.keyboard.type('X');const typed=await take(page);
 await page.evaluate(()=>{const panel=document.createElement('input');panel.id='racePanel';document.body.append(panel);panel.focus();for(const task of gate.heldTasks)task.fn();gate.pointerState.blockNotifications=false});
 await settle(page);const released=await take(page),focus=await page.evaluate(()=>document.activeElement.id);
 const wanted=r.sourceText.slice(0,6)+'X'+r.sourceText.slice(6);
 const inputCompletion=typed.events.some(e=>e.phase==='adapter'&&['correct','already-correct'].includes(e.type)&&['keydown','beforeinput'].includes(e.event));
 const ok=pending&&inputCompletion&&typed.modelText===wanted&&typed.selection?.anchor===7&&typed.selection?.focus===7&&typed.clean&&released.modelText===wanted&&correctionCount(released)===0&&focus==='racePanel';
 const rapidFixture=await setup(page,'D+adapter',false,0,1,{measure:false,holdTasks:true,blockNotifications:true}),space=rapidFixture.spaces.find(s=>s.start===6);
 await clearEvents(page);
 await page.mouse.click(rapidFixture.origin.x+space.x+space.width*.3,space.y);
 await page.mouse.click(rapidFixture.origin.x+space.x+space.width*.7,space.y);
 // Release the newest callback, then an obsolete/cancelled callback: the first
 // click must never overwrite the second one's source choice.
 await page.evaluate(()=>{for(const task of [...gate.heldTasks].reverse())task.fn();gate.pointerState.blockNotifications=false});await settle(page);
 const rapid=await take(page),rapidOK=rapid.selection?.anchor===7&&rapid.selection?.focus===7&&rapid.modelText===rapidFixture.sourceText&&rapid.clean;
 const accepted=ok&&rapidOK;
 await info.attach('pointer-race.json',{body:JSON.stringify({pending,inputCompletion,typed,released,focus,wanted,rapid,rapidOK,ok:accepted},null,2),contentType:'application/json'});expect(accepted).toBe(true);
});
