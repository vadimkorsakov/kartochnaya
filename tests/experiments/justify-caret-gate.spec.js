const {test,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path');
const {isDeepStrictEqual}=require('node:util');
test.use({serviceWorkers:'block'});
test.describe.configure({timeout:180000});
const variants=['A-left','B-left-split','C-justify','D-justify-space-fix','E-letter-spacing','F-explicit-width'];
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
  if(file==='/render/rich-text-layout.mjs')replace('const extra = row.softWrap && spaces.length ?', 'const extra = !e.__gateNoStretch && row.softWrap && spaces.length ?');
  if(file==='/editor/wysiwyg-session.mjs'){
   replace('rowNode.append(span);ctx.font=richTextFont(part.style);',`ctx.font=richTextFont(part.style);ctx.letterSpacing=part.style.letterSpacing+'px';
    if(value.__gateSpaceFix&&part.text===' '){
     const natural=ctx.measureText(part.text).width;
     if(value.__gateSpaceFix==='word')span.style.wordSpacing=(part.width-natural)+'px';
     if(value.__gateSpaceFix==='letter')span.style.letterSpacing=(part.style.letterSpacing+part.width-natural)+'px';
     if(value.__gateSpaceFix==='width')span.style.width=part.width+'px';
    }
    rowNode.append(span);ctx.font=richTextFont(part.style);`);
   replace('advance=part.x+ctx.measureText(part.text).width;',"advance=part.x+(value.__gateSpaceFix&&part.text===' '?part.width:ctx.measureText(part.text).width);");
  }
  return route.fulfill({contentType:'text/javascript',body});
 });
}
async function setup(page,variant,rich,tracking=0){
 return page.evaluate(async({variant,rich,tracking})=>{
  window.gate?.session.dispose();const host=document.querySelector('#host');host.replaceChildren();
  const {createWysiwygSession}=await import('/editor/wysiwyg-session.mjs');
  const {createRichTextLayoutEngine,richTextFont}=await import('/render/rich-text-layout.mjs');
  const {createInlineHistory}=await import('/model/inline-text-history.mjs');
  const layer={type:'text',text:'AVATAR   To WA 😀 é alpha beta gamma\nAV To\n\nZ',w:170,h:600,fontFamily:'Arial',fontSize:24,lineHeight:1.2,textAlign:variant.startsWith('A')||variant.startsWith('B')?'left':'justify',__gateNoStretch:variant.startsWith('B'),letterSpacing:tracking,__gateSpaceFix:variant.startsWith('D')?'word':variant.startsWith('E')?'letter':variant.startsWith('F')?'width':false,...(rich?{textRuns:[{start:1,end:2,style:{textColor:'#cc2244',fillOpacity:50}},{start:12,end:14,style:{fontWeight:'700',letterSpacing:1}}]}:{})};
  const ctx=document.createElement('canvas').getContext('2d'),engine=createRichTextLayoutEngine(ctx,document.fonts),segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
  const layout=e=>{
   if(!variant.startsWith('A'))return engine.layoutJustified(e);
   const natural=engine.layout(e);
   // A keeps the exact production fragments. Natural layout has NO row.carets;
   // these diagnostic prefixes mirror the justified reference, not native carets.
   return {...natural,rows:natural.rows.map(row=>{
    const points=[];
    for(const p of row.fragments){
     ctx.font=richTextFont(p.style);ctx.fontKerning='normal';ctx.letterSpacing=p.style.letterSpacing+'px';
     for(const {index} of segmenter.segment(p.text))points.push({offset:p.start+index,x:(p.logicalX??p.x)+ctx.measureText(p.text.slice(0,index)).width});
     points.push({offset:p.end,x:(p.logicalX??p.x)+p.width});
    }
    return {...row,carets:points.length?[...new Map(points.map(p=>[p.offset,p])).values()]:[{offset:row.start,x:row.x}]};
   })};
  };
  const requestedText=layer.text,requestedRuns=JSON.stringify(layer.textRuns);
  const session=createWysiwygSession({host,element:layer,history:createInlineHistory(layer),layout,compatible:()=>true,onChange(){},onRecovery(){},onFallback(){}});
  window.gate={layer,session,layout};session.focus();const projection=layout(layer),origin=host.getBoundingClientRect();
  const caretMeasurements=[],endpoints=[],fragments=[],spaces=[];
  const sample=(offset,rowIndex)=>{
   const native=getSelection(),range=native.getRangeAt(0),r=range.getBoundingClientRect(),owner=[...host.children].indexOf(native.focusNode.parentElement.closest('[data-wysiwyg-row]'));
   return {offset,row:rowIndex,source:layer.text.slice(offset,offset+2),actual:r.x-origin.x,hasRect:range.getClientRects().length>0,selection:session.readSelection(),owner};
  };
  for(const [ri,row] of projection.rows.entries()){
   for(const point of row.carets){session.setSelection(point.offset,point.offset,ri);caretMeasurements.push({...sample(point.offset,ri),expected:point.x,delta:sample(point.offset,ri).actual-point.x})}
   for(const [pi,span] of [...host.children[ri].children].entries()){
    const p=row.fragments[pi];if(!p)continue;const box=span.getBoundingClientRect();
    fragments.push({row:ri,start:p.start,end:p.end,text:p.text,x:p.x,logicalX:p.logicalX??p.x,width:p.width,actualX:box.x-origin.x,actualWidth:box.width,cssLetterSpacing:span.style.letterSpacing,cssWordSpacing:span.style.wordSpacing,cssWidth:span.style.width,sourceTracking:p.style.letterSpacing});
    for(const [edge,index,offset] of [['before',0,p.start],['after',p.text.length,p.end]]){
     getSelection().setBaseAndExtent(span.firstChild,index,span.firstChild,index);
     const value=sample(offset,ri),expected=row.carets.find(c=>c.offset===offset).x;
     endpoints.push({...value,start:p.start,end:p.end,text:p.text,edge,expected,delta:value.actual-expected});
    }
   }
   // Identical source-space probes in all four controls. They are the interior
   // U+0020 offsets eligible for expansion in C/D, including repeated spaces.
   const source=layer.text.slice(row.start,row.end),first=source.search(/\S/u),last=source.search(/\s*$/u);
   if(row.softWrap)for(let i=first+1;i<last;i++)if(source[i]===' '){
    const start=row.start+i,end=start+1,left=row.carets.find(c=>c.offset===start),right=row.carets.find(c=>c.offset===end);
    session.setSelection(start,start,ri);const r=getSelection().getRangeAt(0).getBoundingClientRect();
    const pi=row.fragments.findIndex(p=>p.start<=start&&p.end>=end),part=row.fragments[pi],node=host.children[ri].children[pi].firstChild;
    const ends=[];
    for(const offset of [start,end]){getSelection().setBaseAndExtent(node,offset-part.start,node,offset-part.start);ends.push(sample(offset,ri))}
    spaces.push({row:ri,start,end,x:left.x,right:right.x,width:right.x-left.x,y:r.y+r.height/2,nativeBefore:ends[0],nativeAfter:ends[1]});
   }
  }
  const selections=[];
  for(const [anchor,focus] of [[0,6],[6,0],[6,9],[9,6],[2,layer.text.length-1]]){
   session.setSelection(anchor,focus);selections.push({anchor,focus,read:session.readSelection(),text:getSelection().toString(),expected:layer.text.slice(Math.min(anchor,focus),Math.max(anchor,focus))});
  }
  return {variant,rich,tracking,sourceRuns:structuredClone(layer.textRuns),sourcePreserved:layer.text===requestedText&&host.textContent===requestedText,runsPreserved:JSON.stringify(layer.textRuns)===requestedRuns,trackingPreserved:layer.letterSpacing===tracking,projection,caretMeasurements,endpoints,fragments,spaces,selections,sourceText:layer.text,text:host.textContent,origin:{x:origin.x,y:origin.y},nativeCanvasCarets:!variant.startsWith('A')};
 },{variant,rich,tracking});
}
async function readMouse(page){return page.evaluate(()=>{
 const host=document.querySelector('#host'),s=getSelection(),node=s.focusNode?.nodeType===3?s.focusNode.parentElement:s.focusNode;
 try{return {clean:gate.session.clean(),domMatchesCanonical:host.textContent===gate.layer.text,selection:gate.session.readSelection(),text:s.toString(),owner:[...host.children].indexOf(node?.closest('[data-wysiwyg-row]'))}}catch(e){return {error:String(e),text:s.toString()}}
})}
const clickFractions=[0,.2,.3,.4,.45,.5,.55,.6,.7,.8,1];
async function clickSpaces(page,result){
 const clicks=[];
 for(const space of result.spaces)for(const fraction of clickFractions){
  const x=result.origin.x+space.x+fraction*space.width;
  await page.mouse.click(x,space.y);
  const actual=await readMouse(page),allowed=fraction===.5?[space.start,space.end]:[fraction<.5?space.start:space.end];
  clicks.push({...space,fraction,x,allowed,...actual,distanceBefore:Math.abs(x-result.origin.x-space.nativeBefore.actual),distanceAfter:Math.abs(x-result.origin.x-space.nativeAfter.actual),ok:!actual.error&&actual.clean&&actual.domMatchesCanonical&&actual.owner===space.row&&actual.selection.anchor===actual.selection.focus&&allowed.includes(actual.selection.focus)&&actual.text===''});
 }
 return clicks;
}
async function mouseProbes(page,result){
 const clicks=await clickSpaces(page,result),drags=[];
 // Coordinates come from the layout, never setSelection or caret hit APIs.
 // Real pointer drags include spaces, a soft wrap, surrogate + combining text.
 const point=(row,offset)=>{
  const c=result.projection.rows[row].carets.find(c=>c.offset===offset);
  return {x:result.origin.x+c.x,y:result.origin.y+result.projection.rows[row].y+result.projection.rows[row].height/2};
 };
 for(const [name,a,b] of [['spaces-forward',[0,6],[0,9]],['spaces-backward',[0,9],[0,6]],['wrap-forward',[0,6],[1,21]],['wrap-backward',[1,21],[0,6]]]){
  // Clear the preceding native range by an actual click outside that range.
  // Starting a new pointer gesture inside it would exercise text drag/drop.
  const reset=point(0,0);await page.mouse.click(reset.x,reset.y);
  const from=point(...a),to=point(...b);await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:16});await page.mouse.up();
  const actual=await readMouse(page),expectedText=result.sourceText.slice(Math.min(a[1],b[1]),Math.max(a[1],b[1]));
  drags.push({name,from:a,to:b,expectedText,...actual,ok:!actual.error&&actual.clean&&actual.domMatchesCanonical&&actual.selection.anchor===a[1]&&actual.selection.focus===b[1]&&actual.text===expectedText&&actual.owner===b[0]});
 }
 return {clicks,drags};
}
async function navigationProbes(page,result){
 const navigation=[];
 for(const [rowIndex,row] of result.projection.rows.entries()){
  for(const [key,targetIndex] of [['Home',rowIndex],['End',rowIndex],['ArrowDown',rowIndex+1],['ArrowUp',rowIndex-1]]){
   if(targetIndex<0||targetIndex>=result.projection.rows.length)continue;
   for(const point of key==='Home'||key==='End'?[row.carets[0]]:row.carets){
    await page.evaluate(({rowIndex,offset})=>{document.querySelector('#host').dispatchEvent(new PointerEvent('pointerdown'));gate.session.focus();gate.session.setSelection(offset,offset,rowIndex)},{rowIndex,offset:point.offset});
    await page.keyboard.press(key);const target=result.projection.rows[targetIndex];
    const expected=key==='Home'?row.start:key==='End'?row.end:target.carets.reduce((best,p)=>Math.abs(p.x-point.x)<Math.abs(best.x-point.x)?p:best,target.carets[0]).offset;
    const actual=await readMouse(page);navigation.push({key,row:rowIndex,offset:point.offset,expected,targetRow:targetIndex,...actual,ok:!actual.error&&actual.selection.anchor===expected&&actual.selection.focus===expected&&actual.owner===targetIndex});
   }
  }
 }
 return navigation;
}
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
test('single-space pilot: B D E F at the Firefox counterexample',async({page},info)=>{
 await routes(page);await page.goto('http://gate.test/');const result=[];
 for(const variant of variants.filter(v=>!v.startsWith('A')&&!v.startsWith('C'))){
  const r=await setup(page,variant,false);r.spaces=r.spaces.filter(s=>s.start===6);
  const mouse=await clickSpaces(page,r);result.push({variant,space:r.spaces[0],clicks:mouse,fragments:r.fragments.filter(p=>p.start>=6&&p.end<=9)});
 }
 await info.attach('single-space-pilot.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});
 console.log('SPACE_PILOT',JSON.stringify(result.map(r=>({variant:r.variant,rangeWidth:r.space.nativeAfter.actual-r.space.nativeBefore.actual,targetWidth:r.space.width,clickErrors:r.clicks.filter(p=>!p.ok).length,at40:r.clicks.find(p=>p.fraction===.4)?.selection}))));
 expect(result.every(r=>r.space.start===6&&r.space.end===7)).toBe(true);
});

function candidateGeometry(candidate,control){
 const relative=compare(candidate,control),localShapes=[],wordOrigins=[];
 for(const p of candidate.caretMeasurements.filter(p=>p.hasRect)){
  const f=candidate.fragments.findLast(f=>f.row===p.row&&f.start<=p.offset&&p.offset<=f.end);
  if(!f||!f.text.trim())continue;
  const q=control.caretMeasurements.find(q=>q.hasRect&&q.row===p.row&&q.offset===p.offset),g=control.fragments.find(g=>g.row===f.row&&g.start===f.start&&g.end===f.end);
  if(q&&g)localShapes.push({row:p.row,offset:p.offset,text:f.text,difference:(p.actual-f.actualX)-(q.actual-g.actualX)});
 }
 for(const f of candidate.fragments.filter(f=>f.text.trim())){
  const g=control.fragments.find(g=>g.row===f.row&&g.start===f.start&&g.end===f.end);
  if(g)wordOrigins.push({row:f.row,text:f.text,start:f.start,difference:(f.actualX-f.x)-(g.actualX-g.x),bound:4*(candidate.fragments.filter(p=>p.row===f.row&&p.start<=f.start).length+1)/60});
 }
 const sourceSpaces=candidate.spaces.map(p=>({row:p.row,start:p.start,target:p.width,actual:p.nativeAfter.actual-p.nativeBefore.actual,error:Math.abs(p.nativeAfter.actual-p.nativeBefore.actual-p.width)}));
 return {relative,localShapes,wordOrigins,sourceSpaces,
  completePairs:relative.pairs.length===candidate.caretMeasurements.filter(p=>p.hasRect).length+candidate.endpoints.filter(p=>p.hasRect).length,
  affinity:candidate.caretMeasurements.every(p=>p.owner===p.row&&p.selection.anchor===p.offset&&p.selection.focus===p.offset),
  ok:relative.beyondRounding.length===0&&localShapes.length>0&&localShapes.every(p=>Math.abs(p.difference)<=localRounding)&&wordOrigins.every(p=>Math.abs(p.difference)<=p.bound)&&sourceSpaces.every(p=>p.error<=localRounding)};
}
function runStructure(result){return result.projection.rows.map(row=>({start:row.start,end:row.end,nextStart:row.nextStart,fragments:row.fragments.map(({start,end,text,style})=>({start,end,text,style}))}))}
async function editingProbes(page,variant,rich,tracking=0){
 const results=[];
 for(const [name,fraction,operation] of [['arrows',.4,'arrows'],['type-left',.4,'type'],['type-right',.6,'type'],['Backspace',.4,'delete-back'],['Delete',.4,'delete-forward']]){
  const initial=await setup(page,variant,rich,tracking),space=initial.spaces.find(p=>p.start===6),offset=fraction<.5?6:7;
  await page.mouse.click(initial.origin.x+space.x+fraction*space.width,space.y);
  const click=await readMouse(page),arrowStates=[];
  let start=offset,end=offset,insert='';
  if(operation==='arrows'){
   for(const [key,expected] of [['ArrowRight',offset+1],['ArrowLeft',offset]]){await page.keyboard.press(key);arrowStates.push({key,expected,...await readMouse(page)})}
  }else if(operation==='type'){insert='X';await page.keyboard.type(insert)}
  else if(operation==='delete-back'){start--;await page.keyboard.press('Backspace')}
  else {end++;await page.keyboard.press('Delete')}
  const expectedText=initial.sourceText.slice(0,start)+insert+initial.sourceText.slice(end),delta=insert.length-(end-start),expectedOffset=operation==='arrows'?offset:start+insert.length;
  // Edits are deliberately outside every sparse run in this fixture; ranges
  // after the edit shift, earlier ranges keep their exact original style.
  const expectedRuns=initial.sourceRuns?.map(run=>({...run,start:run.start>=end?run.start+delta:run.start,end:run.end>=end?run.end+delta:run.end}));
  const final=await readMouse(page),model=await page.evaluate(()=>structuredClone(gate.layer));
  const exactUTF16=final.selection?.anchor===expectedOffset&&final.selection?.focus===expectedOffset;
  const runsPreserved=isDeepStrictEqual(model.textRuns,expectedRuns),trackingPreserved=model.letterSpacing===tracking;
  results.push({name,offset,click,arrowStates,expectedText,actualText:model.text,domText:await page.locator('#host').textContent(),expectedOffset,final,expectedRuns,actualRuns:model.textRuns,runsPreserved,trackingPreserved,exactUTF16,
   ok:click.selection?.anchor===offset&&click.selection?.focus===offset&&arrowStates.every(p=>p.selection?.anchor===p.expected&&p.selection?.focus===p.expected)&&model.text===expectedText&&final.clean&&final.domMatchesCanonical&&exactUTF16&&runsPreserved&&trackingPreserved});
 }
 return results;
}
function summarize(r,control){
 const geometry=candidateGeometry(r,control);
 const sourceOK=r.sourcePreserved&&r.runsPreserved&&r.trackingPreserved&&r.text===r.sourceText&&r.selections.every(p=>p.read.anchor===p.anchor&&p.read.focus===p.focus&&p.text===p.expected);
 const structureOK=JSON.stringify(runStructure(r))===JSON.stringify(runStructure(control));
 const clicks=r.mouse.clicks,drags=r.mouse.drags,editing=r.editing||[];
 const summary={variant:r.variant,rich:r.rich,tracking:r.tracking,maxAbsolute:maximum([...r.caretMeasurements,...r.endpoints].filter(p=>p.hasRect).map(p=>Math.abs(p.delta))),additionalVsB:geometry.relative.maxAdditionalError,
  maxSpaceWidthError:maximum(geometry.sourceSpaces.map(p=>p.error)),maxLocalShapeDifference:maximum(geometry.localShapes.map(p=>Math.abs(p.difference))),maxWordOriginDifference:maximum(geometry.wordOrigins.map(p=>Math.abs(p.difference))),
  clickErrors:clicks.filter(p=>!p.ok).length,clicks:clicks.length,dragErrors:drags.filter(p=>!p.ok).length,drags:drags.length,navigationErrors:r.navigation.filter(p=>!p.ok).length,navigationCases:r.navigation.length,
  inputErrors:editing.filter(p=>!p.ok).length,inputCases:editing.length,utf16Preserved:sourceOK&&editing.every(p=>p.exactUTF16),runsPreserved:r.runsPreserved&&editing.every(p=>p.runsPreserved),geometryOK:geometry.ok&&geometry.completePairs&&geometry.affinity,structureOK};
 summary.pass=summary.geometryOK&&structureOK&&sourceOK&&summary.clickErrors===0&&summary.dragErrors===0&&summary.navigationErrors===0&&summary.inputErrors===0;
 return {summary,geometry};
}
for(const rich of [false,true])test(`CSS candidates geometry, real mouse and input rich=${rich}`,async({page},info)=>{
 await routes(page);await page.goto('http://gate.test/');const results=[];
 for(const variant of variants){
  const r=await setup(page,variant,rich);r.mouse=await mouseProbes(page,r);r.navigation=await navigationProbes(page,r);
  // B and all CSS candidates also undergo independent real-click editing.
  r.editing=!variant.startsWith('A')&&!variant.startsWith('C')?await editingProbes(page,variant,rich):[];results.push(r);
 }
 for(const r of results)Object.assign(r,summarize(r,results[1]));
 const winners=results.filter(r=>/^[EF]-/.test(r.variant)&&r.summary.pass).map(r=>r.variant);
 await info.attach('css-candidates-measurements.json',{body:JSON.stringify({localRounding,results,winners},null,2),contentType:'application/json'});
 console.log('CSS_CANDIDATES_SUMMARY',JSON.stringify({rich,rows:results.map(r=>r.summary),winners}));
 for(const r of results.slice(0,2))expect.soft(r.sourcePreserved&&r.runsPreserved&&r.trackingPreserved,r.variant+' unchanged source/style').toBe(true);
 expect.soft(results[2].mouse.clicks.some(p=>!p.ok),'C remains a live negative control').toBe(true);
 expect.soft(winners,'at least one complete E/F candidate').not.toEqual([]);
});

test('CSS candidates preserve positive and negative user tracking',async({page},info)=>{
 await routes(page);await page.goto('http://gate.test/');const results=[];
 for(const tracking of [-.5,1.25])for(const variant of variants.filter(v=>!v.startsWith('A')&&!v.startsWith('C'))){
  const r=await setup(page,variant,true,tracking);r.spaces=r.spaces.filter(s=>s.start===6);r.mouse={clicks:await clickSpaces(page,r),drags:[]};r.navigation=[];
  r.editing=await editingProbes(page,variant,true,tracking);results.push(r);
 }
 for(const r of results)Object.assign(r,summarize(r,results.find(p=>p.tracking===r.tracking&&p.variant.startsWith('B'))));
 const winners=variants.filter(v=>/^[EF]-/.test(v)&&results.filter(r=>r.variant===v).every(r=>r.summary.pass));
 await info.attach('css-candidates-tracking.json',{body:JSON.stringify({localRounding,results,winners},null,2),contentType:'application/json'});
 console.log('CSS_TRACKING_SUMMARY',JSON.stringify({rows:results.map(r=>r.summary),winners}));
 expect.soft(winners,'one E/F candidate retains user tracking and input').not.toEqual([]);
});
