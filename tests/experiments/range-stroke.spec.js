// Architecture experiments for #115, NOT acceptance tests for range strokes.
// The shipping editor is deliberately not modified by this feasibility gate.
const {test,expect}=require('@playwright/test');
const {PNG}=require('pngjs');

const width=640,height=180;
function pixels(buffer){return PNG.sync.read(buffer).data;}
function compare(a,b){
 expect(a.length).toBe(b.length);
 let changed=0,above16=0,max=0,ink=0,sum=0;
 for(let i=0;i<a.length;i+=4){
  const d=Math.max(...[0,1,2].map(k=>Math.abs(a[i+k]-b[i+k])));
  if(d)changed++;if(d>16)above16++;max=Math.max(max,d);
  if([0,1,2].some(k=>a[i+k]!==255||b[i+k]!==255)){ink++;sum+=d;}
 }
 return {changed,above16,max,ink,meanMaxChannelOnInk:ink?sum/ink:0};
}
const decode=data=>pixels(Buffer.from(data.split(',')[1],'base64'));
async function setup(page){
 await page.goto('/tests/spikes/fixture.html');
 await page.setContent(`<!doctype html><meta charset="utf-8"><style>
 @font-face{font-family:Probe;src:url('/tests/fixtures/fonts/DejaVuSerif.ttf')}
 body{margin:0;background:white}#stage{position:relative;width:${width}px;height:${height}px;background:white}
 #host{position:absolute;left:32px;top:0;white-space:pre;font:64px Probe;font-kerning:normal;line-height:100px;outline:none;caret-color:transparent}
 #host::selection{background:transparent;color:inherit}#host *::selection{background:transparent;color:inherit}
 #marker{display:inline-block;width:0;height:0;vertical-align:baseline}
 #overlay{position:absolute;left:0;top:0;pointer-events:none}
 #reference{display:none}label{display:block}
 </style><div id="stage"><span id="host" contenteditable="plaintext-only" spellcheck="false"><span id="text"></span><span id="marker"></span></span><canvas id="overlay" width="${width}" height="${height}" aria-hidden="true"></canvas></div>
 <canvas id="reference" width="${width}" height="${height}"></canvas>
 <label>Probe stroke width<input id="width" type="number" value="4" min="0"></label>
 <label>Probe stroke color<input id="color" type="text" value="#e02040"></label>`);
 await page.evaluate(()=>document.fonts.load('64px Probe'));
 await page.evaluate(()=>{
  const host=document.querySelector('#host'),value=document.querySelector('#text');
  const reference=document.querySelector('#reference'),overlay=document.querySelector('#overlay');
  const init=(canvas,white=false)=>{
   const c=canvas.getContext('2d');c.reset();if(white){c.fillStyle='white';c.fillRect(0,0,canvas.width,canvas.height);}
   c.font='64px Probe';c.fontKerning='normal';c.textBaseline='alphabetic';c.fillStyle='#111111';
   c.strokeStyle='#e02040';c.lineJoin='round';c.miterLimit=2;return c;
  };
  const selection=()=>{const s=getSelection(),offset=(node,n)=>{const r=document.createRange();r.setStart(host,0);r.setEnd(node,n);return r.toString().length;};return {anchor:offset(s.anchorNode,s.anchorOffset),focus:offset(s.focusNode,s.focusOffset)};};
  let saved={anchor:0,focus:0};
  window.probe={
   init,reference,overlay,selection,
   mount(text,strokeWidth=0){
    value.textContent=text;host.style.top='0px';host.style.color='#111111';host.style.webkitTextStroke=strokeWidth+'px #e02040';
    host.style.top=(100-document.querySelector('#marker').getBoundingClientRect().top)+'px';
    const c=init(reference,true);init(overlay);c.fillText(text,32,100);c.lineWidth=strokeWidth;if(strokeWidth)c.strokeText(text,32,100);
    return reference.toDataURL();
   },
   paintRange(){
    const start=Math.min(saved.anchor,saved.focus),end=Math.max(saved.anchor,saved.focus),text=value.textContent;
    const w=Number(document.querySelector('#width').value),color=document.querySelector('#color').value;
    const c=init(reference,true),o=init(overlay);c.fillText(text,32,100);
    const x=32+c.measureText(text.slice(0,start)).width;
    for(const ctx of [c,o]){ctx.lineWidth=w;ctx.strokeStyle=color;if(w)ctx.strokeText(text.slice(start,end),x,100);}
    return reference.toDataURL();
   },
   restore(){host.focus();getSelection().setBaseAndExtent(value.firstChild,saved.anchor,value.firstChild,saved.focus);},
   saved(){return saved;},
  };
  for(const field of document.querySelectorAll('input')){
   field.addEventListener('pointerdown',()=>{if(host.contains(getSelection().anchorNode))saved=selection();});
   field.addEventListener('input',()=>probe.paintRange());
  }
 });
}
async function attach(testInfo,name,value){await testInfo.attach(name,{body:JSON.stringify(value,null,2),contentType:'application/json'});}

test('accepted boundary: fi fill and stroke split together only at a different stroke style',async({page,browserName},testInfo)=>{
 await setup(page);const results=[];
 for(const partial of [false,true]){
  await page.evaluate(()=>probe.mount('fi'));
  const reference=await page.evaluate(partial=>{
   const c=probe.init(probe.reference,true),o=probe.init(probe.overlay);
   const parts=partial?['f','i']:['fi'],host=document.querySelector('#text');
   host.replaceChildren();host.style.color='transparent';let x=32;const draws=[];
   for(const [index,text] of parts.entries()){
    const span=document.createElement('span');span.style.display='inline-block';span.textContent=text;host.append(span);
    draws.push({text,x,index});
    x+=c.measureText(text).width;
   }
   for(const ctx of [c,o]){
    for(const part of draws)ctx.fillText(part.text,part.x,100);
    ctx.lineWidth=4;ctx.strokeText(draws[0].text,draws[0].x,100);
   }
   return probe.reference.toDataURL();
  },partial);
  const actual=await page.locator('#stage').screenshot();
  const metric=compare(pixels(actual),decode(reference));results.push({partial,...metric});
  // Transparent Canvas compositing onto the page can round one channel by one
  // level in Gecko. Bound both the magnitude and number of affected pixels.
  await attach(testInfo,'accepted-boundary-'+partial+'.json',{browserName,partial,...metric});
  expect(metric.max).toBeLessThanOrEqual(1);expect(metric.changed).toBeLessThanOrEqual(2);
  expect(await page.locator('#text').textContent()).toBe('fi');
  await testInfo.attach(partial?'split-fill-and-stroke.png':'whole-ligature.png',{body:actual,contentType:'image/png'});
 }
 await attach(testInfo,'accepted-boundary.json',{browserName,results});
});

test('feasibility: characterize native CSS stroke against current round-join Canvas with an exact fill control',async({page,browserName,browser},testInfo)=>{
 await setup(page);const results=[];
 for(const text of ['AV','fi','Обводка','AV fi 😀'])for(const strokeWidth of [0,1,4,12]){
  const reference=await page.evaluate(({text,strokeWidth})=>probe.mount(text,strokeWidth),{text,strokeWidth});
  const dom=await page.locator('#stage').screenshot();
  results.push({text,strokeWidth,...compare(pixels(dom),decode(reference))});
  if(text==='AV'&&strokeWidth===4){
   await testInfo.attach('css-AV-4.png',{body:dom,contentType:'image/png'});
   await testInfo.attach('canvas-AV-4.png',{body:Buffer.from(reference.split(',')[1],'base64'),contentType:'image/png'});
  }
 }
 await attach(testInfo,'css-measurements.json',{browserName,version:browser.version(),results});
 // This test documents a rejected candidate. It does NOT approve its error.
 const controls=results.filter(r=>r.strokeWidth===0);
 for(const control of controls)expect(control.above16).toBe(0);
 if(browserName==='chromium')expect(results.find(r=>r.text==='AV'&&r.strokeWidth===4).above16).toBeGreaterThan(0);
 else expect(results.find(r=>r.text==='AV'&&r.strokeWidth===4).changed).toBe(0);
});

test('feasibility: correcting advances repairs AV placement but does not recover a split fi ligature',async({page,browserName,browser},testInfo)=>{
 await setup(page);
 const samples=await page.evaluate(()=>{
  const make=()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=180;return {canvas,c:probe.init(canvas,true)};};
  return ['AV','fi'].map(text=>{
   const full=make(),split=make(),corrected=make();full.c.fillText(text,32,100);
   const advance=full.c.measureText(text).width,left=full.c.measureText(text[0]).width,right=full.c.measureText(text[1]).width;
   split.c.fillText(text[0],32,100);split.c.fillText(text[1],32+left,100);
   corrected.c.fillText(text[0],32,100);corrected.c.fillText(text[1],32+advance-right,100);
   return {text,advance,separateAdvance:left+right,full:full.canvas.toDataURL(),split:split.canvas.toDataURL(),corrected:corrected.canvas.toDataURL()};
  });
 });
 const results=samples.map(({full,split,corrected,...r})=>({...r,split:compare(decode(full),decode(split)),corrected:compare(decode(full),decode(corrected))}));
 await attach(testInfo,'shaping-measurements.json',{browserName,version:browser.version(),results});
 for(const sample of samples)if(sample.text==='fi')for(const key of ['full','split','corrected'])await testInfo.attach('fi-'+key+'.png',{body:Buffer.from(sample[key].split(',')[1],'base64'),contentType:'image/png'});
 expect(results[0].advance).toBeLessThan(results[0].separateAdvance);
 expect(results[0].split.above16).toBeGreaterThan(0);
 expect(results[0].corrected.above16).toBe(0);
 expect(results[1].corrected.above16).toBeGreaterThan(0);
});

test('feasibility: clipping a whole shaped pair cuts selected ink or includes its neighbor',async({page,browserName,browser},testInfo)=>{
 await setup(page);
 const samples=await page.evaluate(()=>{
  const make=()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=180;const c=probe.init(canvas,true);c.lineWidth=12;c.fillText('AV',32,100);return {canvas,c};};
  // The outline of A itself is unchanged by AV kerning, so a standalone
  // strokeText(A) provides an independent reference for A's uncut contour.
  const reference=make();reference.c.strokeText('A',32,100);
  const edge=32+reference.c.measureText('A').width;
  return [0,6,12].map(padding=>{
   const candidate=make();candidate.c.beginPath();candidate.c.rect(0,0,edge+padding,180);candidate.c.clip();candidate.c.strokeText('AV',32,100);
   return {padding,edge,reference:reference.canvas.toDataURL(),candidate:candidate.canvas.toDataURL()};
  });
 });
 const results=samples.map(({reference,candidate,...r})=>({...r,...compare(decode(reference),decode(candidate))}));
 await attach(testInfo,'clip-measurements.json',{browserName,version:browser.version(),text:'AV',selected:'A',strokeWidth:12,results});
 for(const result of results)expect(result.above16).toBeGreaterThan(0);
 await testInfo.attach('clip-reference-A.png',{body:Buffer.from(samples[0].reference.split(',')[1],'base64'),contentType:'image/png'});
 for(const sample of samples)await testInfo.attach('clip-padding-'+sample.padding+'.png',{body:Buffer.from(sample.candidate.split(',')[1],'base64'),contentType:'image/png'});
});

test('feasibility: sibling Canvas overlay preserves backward UTF-16 selection for a whole word and matches its downloaded PNG',async({page,browserName,browser},testInfo)=>{
 await setup(page);
 const text='AV fi Жук 😀';await page.evaluate(text=>probe.mount(text),text);
 await page.locator('#host').focus();await page.keyboard.press('Control+Home');
 // Select the whole ligature backward with native keyboard events.
 for(let i=0;i<5;i++)await page.keyboard.press('ArrowRight');
 for(let i=0;i<2;i++)await page.keyboard.press('Shift+ArrowLeft');
 expect(await page.evaluate(()=>probe.selection())).toEqual({anchor:5,focus:3});
 const before=await page.locator('#host').innerHTML();
 await page.locator('#width').click();await page.locator('#width').fill('8');
 await page.locator('#color').click();await page.locator('#color').fill('#2266dd');
 const reference=await page.evaluate(()=>probe.reference.toDataURL());
 const live=await page.locator('#stage').screenshot();
 const parity=compare(pixels(live),decode(reference));
 expect(parity.above16).toBe(0);
 expect(await page.locator('#host').innerHTML()).toBe(before);
 expect(await page.locator('#overlay').evaluate(el=>getComputedStyle(el).pointerEvents)).toBe('none');
 await page.evaluate(()=>probe.restore());
 expect(await page.evaluate(()=>probe.selection())).toEqual({anchor:5,focus:3});
 // Capture while inspector owns focus; Selection highlight is deliberately
 // transparent in this isolated fixture so it does not enter the ink metric.
 const downloading=page.waitForEvent('download');
 await page.evaluate(()=>{const a=document.createElement('a');a.download='stroke-probe.png';a.href=probe.reference.toDataURL();a.click();});
 const download=await downloading,path=testInfo.outputPath('stroke-probe.png');await download.saveAs(path);
 const exported=pixels(require('node:fs').readFileSync(path));
 const png=compare(decode(reference),exported);expect(png.changed).toBe(0);
 await testInfo.attach('whole-word-live.png',{body:live,contentType:'image/png'});
 await testInfo.attach('whole-word-export.png',{path,contentType:'image/png'});
 await attach(testInfo,'overlay-measurements.json',{browserName,version:browser.version(),text,selection:{anchor:5,focus:3},parity,png});
 // This proves only a whitespace-delimited, single-line word. It does not
 // establish glyph ownership for partial ligatures or shipping-editor parity.
});
