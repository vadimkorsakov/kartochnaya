const {test,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path');
test.use({serviceWorkers:'block'});
test.describe.configure({timeout:120000});
const variants=['A-left','B-left-split','C-justify','D-justify-space-fix'];
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
    if(value.__gateSpaceFix&&part.text===' ')span.style.wordSpacing=(part.width-ctx.measureText(part.text).width)+'px';
    rowNode.append(span);ctx.font=richTextFont(part.style);`);
   replace('advance=part.x+ctx.measureText(part.text).width;',"advance=part.x+(value.__gateSpaceFix&&part.text===' '?part.width:ctx.measureText(part.text).width);");
  }
  return route.fulfill({contentType:'text/javascript',body});
 });
}
async function setup(page,variant,rich){
 return page.evaluate(async({variant,rich})=>{
  window.gate?.session.dispose();const host=document.querySelector('#host');host.replaceChildren();
  const {createWysiwygSession}=await import('/editor/wysiwyg-session.mjs');
  const {createRichTextLayoutEngine,richTextFont}=await import('/render/rich-text-layout.mjs');
  const {createInlineHistory}=await import('/model/inline-text-history.mjs');
  const layer={type:'text',text:'AVATAR   To WA 😀 é alpha beta gamma\nAV To\n\nZ',w:170,h:600,fontFamily:'Arial',fontSize:24,lineHeight:1.2,textAlign:variant.startsWith('A')||variant.startsWith('B')?'left':'justify',__gateNoStretch:variant.startsWith('B'),__gateSpaceFix:variant.startsWith('D'),...(rich?{textRuns:[{start:1,end:2,style:{textColor:'#cc2244',fillOpacity:50}},{start:12,end:14,style:{fontWeight:'700',letterSpacing:1}}]}:{})};
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
    fragments.push({row:ri,start:p.start,end:p.end,text:p.text,x:p.x,logicalX:p.logicalX??p.x,width:p.width,actualX:box.x-origin.x,actualWidth:box.width});
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
    spaces.push({row:ri,start,end,x:left.x,right:right.x,width:right.x-left.x,y:r.y+r.height/2});
   }
  }
  const selections=[];
  for(const [anchor,focus] of [[0,6],[6,0],[6,9],[9,6],[2,layer.text.length-1]]){
   session.setSelection(anchor,focus);selections.push({anchor,focus,read:session.readSelection(),text:getSelection().toString(),expected:layer.text.slice(Math.min(anchor,focus),Math.max(anchor,focus))});
  }
  return {variant,rich,projection,caretMeasurements,endpoints,fragments,spaces,selections,sourceText:layer.text,text:host.textContent,origin:{x:origin.x,y:origin.y},nativeCanvasCarets:!variant.startsWith('A')};
 },{variant,rich});
}
async function readMouse(page){return page.evaluate(()=>{
 const host=document.querySelector('#host'),s=getSelection(),node=s.focusNode?.nodeType===3?s.focusNode.parentElement:s.focusNode;
 try{return {clean:gate.session.clean(),domMatchesCanonical:host.textContent===gate.layer.text,selection:gate.session.readSelection(),text:s.toString(),owner:[...host.children].indexOf(node?.closest('[data-wysiwyg-row]'))}}catch(e){return {error:String(e),text:s.toString()}}
})}
async function mouseProbes(page,result){
 const clicks=[],drags=[];
 for(const space of result.spaces)for(const [label,fraction] of [['before',0],['near-middle-left',.4],['middle',.5],['near-middle-right',.6],['after',1]]){
  const x=result.origin.x+space.x+fraction*space.width;
  await page.mouse.click(x,space.y);
  const actual=await readMouse(page),allowed=label==='middle'?[space.start,space.end]:[fraction<.5?space.start:space.end];
  clicks.push({...space,label,x,allowed,...actual,ok:!actual.error&&actual.clean&&actual.domMatchesCanonical&&actual.owner===space.row&&actual.selection.anchor===actual.selection.focus&&allowed.includes(actual.selection.focus)&&actual.text===''});
 }
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
for(const rich of [false,true])test(`left versus justify native geometry and real mouse rich=${rich}`,async({page},info)=>{
 await routes(page);await page.goto('http://gate.test/');const results=[];
 for(const variant of variants){
  const r=await setup(page,variant,rich);r.mouse=await mouseProbes(page,r);r.navigation=await navigationProbes(page,r);results.push(r);
 }
 for(const r of results){
  r.relativeToLeft=compare(r,results[0]);r.relativeToSplitLeft=compare(r,results[1]);
  r.summary={variant:r.variant,rich,maxAbsoluteCaret:maximum(r.caretMeasurements.filter(p=>p.hasRect).map(p=>Math.abs(p.delta))),maxAbsoluteEndpoint:maximum(r.endpoints.filter(p=>p.hasRect).map(p=>Math.abs(p.delta))),additionalVsA:r.relativeToLeft.maxAdditionalError,additionalVsB:r.relativeToSplitLeft.maxAdditionalError,signedDifferenceVsB:r.relativeToSplitLeft.maxSignedDifference,
   stretchedSpaceEndpointError:maximum((r.variant.startsWith('A')?r.caretMeasurements.filter(p=>p.hasRect&&r.spaces.some(s=>s.row===p.row&&(s.start===p.offset||s.end===p.offset))):r.endpoints.filter(p=>p.hasRect&&r.spaces.some(s=>s.start===p.start&&s.end===p.end))).map(p=>Math.abs(p.delta))),clickErrors:r.mouse.clicks.filter(p=>!p.ok).length,clicks:r.mouse.clicks.length,dragErrors:r.mouse.drags.filter(p=>!p.ok).length,drags:r.mouse.drags.length,navigationErrors:r.navigation.filter(p=>!p.ok).length,utf16Preserved:r.text===r.sourceText&&r.selections.every(p=>p.read.anchor===p.anchor&&p.read.focus===p.focus&&p.text===p.expected)};
 }
 await info.attach('left-justify-native-measurements.json',{body:JSON.stringify({localRounding,results},null,2),contentType:'application/json'});
 console.log('LEFT_JUSTIFY_SUMMARY',JSON.stringify(results.map(r=>r.summary)));
 for(const r of results){
  expect.soft(r.summary.utf16Preserved,r.variant+' UTF-16').toBe(true);
  for(const p of r.caretMeasurements){expect.soft(p.selection,r.variant+' source offset').toEqual({anchor:p.offset,focus:p.offset});expect.soft(p.owner,r.variant+' row affinity').toBe(p.row)}
  expect.soft(r.summary.navigationErrors,r.variant+' keyboard').toBe(0);
 }
 const candidate=results[3];
 const structure=r=>r.projection.rows.map(row=>({start:row.start,end:row.end,nextStart:row.nextStart,fragments:row.fragments.map(({start,end,text,style})=>({start,end,text,style}))}));
 for(const r of results.slice(2))expect.soft(structure(r),r.variant+' source/style structure vs B').toEqual(structure(results[1]));
 expect.soft(candidate.relativeToSplitLeft.pairs.length,'complete B/D endpoint and caret pairing').toBe(candidate.caretMeasurements.filter(p=>p.hasRect).length+candidate.endpoints.filter(p=>p.hasRect).length);
 expect.soft(results[2].mouse.clicks.some(p=>!p.ok),'unfixed C must expose real space hit-testing failure').toBe(true);
 const localShapes=[];
 for(const p of candidate.caretMeasurements.filter(p=>p.hasRect)){
  const f=candidate.fragments.findLast(f=>f.row===p.row&&f.start<=p.offset&&p.offset<=f.end);
  if(!f||!f.text.trim())continue;
  const control=results[1],q=control.caretMeasurements.find(q=>q.hasRect&&q.row===p.row&&q.offset===p.offset),g=control.fragments.find(g=>g.row===f.row&&g.start===f.start&&g.end===f.end);
  if(q&&g)localShapes.push({row:p.row,offset:p.offset,text:f.text,difference:(p.actual-f.actualX)-(q.actual-g.actualX)});
 }
 expect.soft(localShapes.length,'nonempty native shaping control').toBeGreaterThan(0);
 await info.attach('native-shaping-translation.json',{body:JSON.stringify({rich,tolerance:localRounding,localShapes}),contentType:'application/json'});
 expect.soft(localShapes.filter(p=>Math.abs(p.difference)>localRounding),'D native shaping vs B after translation').toEqual([]);
 // Native Canvas-prefix equality is NOT required when the left control also
 // differs. C remains a measured negative control, not an expected-failure test.
 expect.soft(candidate.relativeToSplitLeft.beyondRounding,'D additional error vs structurally identical B').toEqual([]);
 expect.soft(candidate.mouse.clicks.filter(p=>!p.ok),'D real space clicks').toEqual([]);
 expect.soft(candidate.mouse.drags.filter(p=>!p.ok),'D real source-range drags').toEqual([]);
});
