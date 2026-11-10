const {test,expect}=require('@playwright/test');
const fs=require('node:fs/promises'),path=require('node:path');
test.use({serviceWorkers:'block'});
for(const prototype of [false,true])for(const rich of [false,true])test(`justify native caret and Selection geometry prototype=${prototype} rich=${rich}`,async({page},info)=>{
 await page.route('http://gate.test/**',async route=>{
  const file=new URL(route.request().url()).pathname;
  if(file==='/')return route.fulfill({contentType:'text/html',body:'<div id="host" style="position:absolute;left:20px;top:20px;width:170px;height:600px"></div>'});
  if(!/^\/(editor|model|render)\/[\w-]+\.mjs$/.test(file))return route.abort();
  let body=await fs.readFile(path.join(__dirname,'../../src',file),'utf8');
  // Bounded, test-only candidate: expand each source space without adding DOM
  // characters. Keep the shipping projection unchanged until this gate passes.
  if(prototype&&file==='/editor/wysiwyg-session.mjs'){
   body=body.replace('rowNode.append(span);ctx.font=richTextFont(part.style);',`ctx.font=richTextFont(part.style);ctx.letterSpacing=part.style.letterSpacing+'px';
    if(part.text===' ')span.style.wordSpacing=(part.width-ctx.measureText(part.text).width)+'px';
    rowNode.append(span);ctx.font=richTextFont(part.style);`);
   body=body.replace('advance=part.x+ctx.measureText(part.text).width;',"advance=part.x+(part.text===' '?part.width:ctx.measureText(part.text).width);");
  }
  return route.fulfill({contentType:'text/javascript',body});
 });
 await page.goto('http://gate.test/');
 const result=await page.evaluate(async rich=>{
  const {createWysiwygSession}=await import('/editor/wysiwyg-session.mjs');
  const {createRichTextLayoutEngine}=await import('/render/rich-text-layout.mjs');
  const {createInlineHistory}=await import('/model/inline-text-history.mjs');
  const layer={type:'text',text:'AVATAR   To WA 😀 é alpha beta gamma\nAV To\n\nZ',w:170,h:600,fontFamily:'Arial',fontSize:24,lineHeight:1.2,textAlign:'justify',...(rich?{textRuns:[{start:1,end:2,style:{textColor:'#cc2244',fillOpacity:50}},{start:12,end:14,style:{fontWeight:'700',letterSpacing:1}}]}:{})};
  const engine=createRichTextLayoutEngine(document.createElement('canvas').getContext('2d'),document.fonts),layout=e=>engine.layoutJustified(e);
  const host=document.querySelector('#host'),session=createWysiwygSession({host,element:layer,history:createInlineHistory(layer),layout,compatible:()=>true,onChange(){},onRecovery(){},onFallback(){}});
  window.gate={layer,session,layout};session.focus();
  const projection=layout(layer),measurements=[],endpoints=[],words=[];
  for(const [rowIndex,row] of projection.rows.entries())for(const caret of row.carets){
   session.setSelection(caret.offset,caret.offset,rowIndex);
   const selection=session.readSelection(),native=getSelection(),range=native.getRangeAt(0),r=range.getBoundingClientRect();
   // Use native collapsed Range geometry, not a span's visual box.
   measurements.push({row:rowIndex,offset:caret.offset,source:layer.text.slice(caret.offset,caret.offset+2),expected:caret.x,actual:r.x-host.getBoundingClientRect().x,delta:r.x-host.getBoundingClientRect().x-caret.x,hasRect:range.getClientRects().length>0,selection,owner:[...host.children].indexOf(native.focusNode.parentElement.closest('[data-wysiwyg-row]'))});
  }
  for(const [ri,rowNode] of [...host.children].entries())for(const [pi,span] of [...rowNode.children].entries()){
   const part=projection.rows[ri].fragments[pi];if(!part)continue;
   if(part.text.trim())words.push({row:ri,text:part.text,expected:part.x,actual:span.getBoundingClientRect().x-host.getBoundingClientRect().x});
   for(const [edge,index,offset] of [['before',0,part.start],['after',part.text.length,part.end]]){
    getSelection().setBaseAndExtent(span.firstChild,index,span.firstChild,index);
    const range=getSelection().getRangeAt(0),rect=range.getBoundingClientRect(),expected=projection.rows[ri].carets.find(p=>p.offset===offset).x;
    endpoints.push({row:ri,text:part.text,edge,offset,expected,actual:rect.x-host.getBoundingClientRect().x,delta:rect.x-host.getBoundingClientRect().x-expected,hasRect:range.getClientRects().length>0,selection:session.readSelection()});
   }
  }
  const selections=[];
  for(const [anchor,focus] of [[0,6],[6,0],[6,9],[9,6],[2,layer.text.length-1]]){
   session.setSelection(anchor,focus);selections.push({anchor,focus,read:session.readSelection(),text:getSelection().toString(),expected:layer.text.slice(Math.min(anchor,focus),Math.max(anchor,focus))});
  }
  return {projection,measurements,endpoints,words,selections,sourceText:layer.text,text:host.textContent};
 },rich);
 const navigation=[];
 for(const [rowIndex,row] of result.projection.rows.entries()){
  for(const key of ['Home','End']){
   await page.evaluate(({rowIndex,offset})=>{document.querySelector('#host').dispatchEvent(new PointerEvent('pointerdown'));gate.session.setSelection(offset,offset,rowIndex)},{rowIndex,offset:row.start});
   await page.keyboard.press(key);
   navigation.push(await page.evaluate(({rowIndex,key})=>{const c=gate.session.readSelection(),s=getSelection(),owner=[...document.querySelector('#host').children].indexOf(s.focusNode.parentElement.closest('[data-wysiwyg-row]'));return {key,row:rowIndex,selection:c,owner}}, {rowIndex,key}));
  }
  for(const [key,step] of [['ArrowDown',1],['ArrowUp',-1]]){
   const targetIndex=rowIndex+step;if(targetIndex<0||targetIndex>=result.projection.rows.length)continue;
   for(const point of row.carets){
    await page.evaluate(({rowIndex,offset})=>{document.querySelector('#host').dispatchEvent(new PointerEvent('pointerdown'));gate.session.setSelection(offset,offset,rowIndex)},{rowIndex,offset:point.offset});
    await page.keyboard.press(key);
    const target=result.projection.rows[targetIndex];
    const expected=target.carets.reduce((best,p)=>Math.abs(p.x-point.x)<Math.abs(best.x-point.x)?p:best,target.carets[0]).offset;
    navigation.push({key,row:rowIndex,offset:point.offset,expected,selection:await page.evaluate(()=>gate.session.readSelection())});
   }
  }
 }
 result.navigation=navigation;
 await info.attach('native-caret-measurements.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});
 console.log('caret gate',info.project.name,{prototype,rich,maxCaretDelta:Math.max(...result.measurements.filter(p=>p.hasRect).map(p=>Math.abs(p.delta))),maxEndpointDelta:Math.max(...result.endpoints.filter(p=>p.hasRect).map(p=>Math.abs(p.delta))),maxWordOriginDelta:Math.max(...result.words.map(p=>Math.abs(p.actual-p.expected)))});
 expect(result.text).toBe(result.sourceText);
 expect(result.projection.rows.some(r=>r.justification.extraPerSpace>0)).toBe(true);
 for(const n of navigation){
  const expected=n.key==='Home'?result.projection.rows[n.row].start:n.key==='End'?result.projection.rows[n.row].end:n.expected;
  expect.soft(n.selection,JSON.stringify(n)).toEqual({anchor:expected,focus:expected});
  if(n.owner!==undefined)expect.soft(n.owner,JSON.stringify(n)).toBe(n.row);
 }
 for(const w of result.words)expect.soft(Math.abs(w.actual-w.expected),JSON.stringify(w)).toBeLessThanOrEqual(.1);
 for(const s of result.selections){expect(s.read).toEqual({anchor:s.anchor,focus:s.focus});expect(s.text).toBe(s.expected)}
 for(const p of result.endpoints){expect(p.selection).toEqual({anchor:p.offset,focus:p.offset});if(p.hasRect)expect.soft(Math.abs(p.delta),JSON.stringify(p)).toBeLessThanOrEqual(.1)}
 for(const p of result.measurements){expect(p.selection).toEqual({anchor:p.offset,focus:p.offset});expect(p.owner).toBe(p.row);if(p.hasRect)expect.soft(Math.abs(p.delta),JSON.stringify(p)).toBeLessThanOrEqual(.1)}

});
