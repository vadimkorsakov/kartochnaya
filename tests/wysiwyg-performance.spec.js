const {test,expect}=require('./helpers');
const {seed,edit,select,zoom,model}=require('./wysiwyg-fixture.cjs');
const {instrumentPage}=require('./wysiwyg-profile.cjs');
test.use({serviceWorkers:'block'});
const paragraph='Команда готовит новый выпуск редактора: дизайнер проверяет длинные предложения, а инженер сравнивает Canvas и PNG при масштабе 80%. Здесь есть  2 пробела, API v3, UTF-16 и обычная кириллица — всё должно оставаться на своих местах.';
const text=Array.from({length:5},(_,i)=>paragraph+' Абзац '+(i+1)+'.').join('\n\n');
const stats=values=>{const sorted=[...values].sort((a,b)=>a-b),at=p=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))]??0;return {count:values.length,total:values.reduce((a,b)=>a+b,0),p50:at(.5),p95:at(.95),max:sorted.at(-1)??0}};
for(const [ref,url,live] of [['pr144','/?experimentalJustifyWysiwyg=1',true],['pr147','/',true],['current','/',true],['current','/?experimentalTextWysiwyg=0',false]])test(`palette profile ${ref} live=${live}`,async({page,browserName},info)=>{
 test.setTimeout(120000);await instrumentPage(page,ref);
 await seed(page,{text,w:600,h:1100,fontSize:20,textAlign:'justify',strokeWidth:1,textRuns:[{start:0,end:7,style:{textColor:'#b02030'}},{start:50,end:90,style:{fontWeight:'700'}},{start:140,end:170,style:{fontSize:22}}]},url,{width:640,height:1200});
 await edit(page,live);await zoom(page,80);
 if(live)await select(page,7,0);else await page.locator('#inlineText').evaluate(e=>e.setSelectionRange(0,7,'backward'));
 await page.locator('#inspector [data-fill-open=fill]').click();
 await page.evaluate(()=>{
  window.__metrics={};window.__longTasks=[];window.__events=[];window.__frames=[];window.__profileStart=performance.now();window.__enabled=true;
  const starts=new WeakMap();
  for(const type of ['input','change','pointerdown','pointermove','pointerup']){
   document.addEventListener(type,e=>{if(e.target.closest('#fillPopover'))starts.set(e,performance.now())},true);
   document.addEventListener(type,e=>{const t=starts.get(e);if(t===undefined)return;window.__events.push({type,ms:performance.now()-t});requestAnimationFrame(()=>window.__frames.push(performance.now()-t))});
  }
 });
 // Controlled, identical DOM input/change dispatches guarantee equal action
 // counts across revisions. Real trusted pointer gestures follow below.
 await page.locator('#fillPopover').evaluate(async p=>{
  const frame=()=>new Promise(r=>requestAnimationFrame(()=>r()));
  const input=async(el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));await frame()};
  const change=el=>el.dispatchEvent(new Event('change',{bubbles:true}));
  const hex=p.querySelector('[data-cp-part="0"]');hex.focus();
  for(const value of ['#2','#22','#224','#2244','#22446','#224466'])await input(hex,value);change(hex);
  const hue=p.querySelector('#cpHue');hue.focus();
  for(let i=0;i<50;i++)await input(hue,20+i*5);change(hue);
  const alpha=p.querySelector('#cpAlpha');alpha.focus();for(let i=0;i<10;i++)await input(alpha,90-i*3);change(alpha);
  const finalHex=p.querySelector('[data-cp-part="0"]');finalHex.focus();
  for(const color of ['#cc2244','#22aa55','#5544cc','#aa5511','#336677','#112233'])await input(finalHex,color);change(finalHex);
 });
 // Also profile a trusted high-frequency pointer gesture in the actual palette.
 const square=await page.locator('#cpSquare').boundingBox();await page.mouse.move(square.x+10,square.y+10);await page.mouse.down();await page.mouse.move(square.x+square.width-10,square.y+square.height-10,{steps:12});await page.mouse.up();
 await page.locator('#fillPopover [data-fill-close]').click();
 for(const key of ['underline','strikethrough'])await page.locator(`#inspector [data-text-decoration=${key}]`).click();
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const raw=await page.evaluate(()=>{window.__enabled=false;return {metrics:window.__metrics,events:window.__events,frames:window.__frames,longTasks:window.__longTasks,longTaskSupported:PerformanceObserver.supportedEntryTypes.includes('longtask')}});
 const result={ref,url,browserName,textLength:text.length,metrics:Object.fromEntries(Object.entries(raw.metrics).map(([k,v])=>[k,stats(v)])),events:stats(raw.events.map(e=>e.ms)),inputs:stats(raw.events.filter(e=>e.type==='input').map(e=>e.ms)),pointer:stats(raw.events.filter(e=>e.type.startsWith('pointer')).map(e=>e.ms)),nextAnimationFrame:stats(raw.frames),longTasks:raw.longTasks,longTaskSupported:raw.longTaskSupported,handlersOver50ms:raw.events.filter(e=>e.ms>=50).length,notes:'Inclusive timings; nested costs overlap. Next rAF is a frame opportunity, not a physical display timestamp. Firefox longtask API may be unavailable. Text=0 keeps legacy range-formatting refusal semantics.'};
 await info.attach('profile.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});console.log('WYSIWYG_PROFILE',JSON.stringify({...result,longTasks:{count:raw.longTasks.length,total:raw.longTasks.reduce((n,e)=>n+e.duration,0),max:Math.max(0,...raw.longTasks.map(e=>e.duration))}}));
 expect(result.inputs.count).toBe(72);
 if(ref==='current'&&live){
  expect(result.metrics.baselineProbe?.count??0).toBeLessThan(result.metrics.project.count);
  expect(result.metrics.baseline.count).toBeGreaterThan(10*(result.metrics.baselineProbe?.count??1));
  expect(result.metrics.refreshPickerVisualFalse.count).toBeLessThanOrEqual(result.metrics.cpLiveColor.count+10);
 }

 if(live){await expect(page.locator('#wysiwygRecovery')).toBeHidden();await page.locator('#inlineWysiwyg').focus();expect(await page.evaluate(()=>getSelection().toString())).toBe('Команда');const changed=await model(page);expect(changed.text).toBe(text);expect(changed.textRuns.some(r=>r.style.underline)).toBe(true);expect(changed.textRuns.some(r=>r.style.strikethrough)).toBe(true)}
});

test('continuous hue keeps intermediate ink, final value and one gesture undo',async({page},info)=>{
 await seed(page,{text:'Команда проверяет цвет',strokeWidth:1,textRuns:[{start:0,end:7,style:{textColor:'#b02030'}}]});await edit(page);await select(page,7,0);const before=await model(page);
 await page.locator('#inspector [data-fill-open=fill]').click();
 const inks=await page.locator('#cpHue').evaluate(async hue=>{
  const inks=new Set();hue.focus();
  for(let i=0;i<50;i++){
   hue.value=20+i*5;hue.dispatchEvent(new Event('input',{bubbles:true}));
   await new Promise(r=>requestAnimationFrame(r));
   inks.add(document.querySelector('[data-text-stroke-overlay]').toDataURL());
  }
  return inks.size;
 });
 expect(inks).toBeGreaterThan(20);const lastPreview=await model(page);
 await page.locator('#cpHue').dispatchEvent('change');
 await page.locator('#fillPopover [data-fill-close]').click();await page.locator('#inlineWysiwyg').focus();
 expect(await model(page)).toEqual(lastPreview);expect(await page.evaluate(()=>getSelection().toString())).toBe('Команда');
 await page.keyboard.press('Control+z');expect(await model(page)).toEqual(before);
 await page.keyboard.press('Control+Shift+z');expect(await model(page)).toEqual(lastPreview);
 await zoom(page,80);await page.locator('#inlineWysiwyg').focus();expect(await model(page)).toEqual(lastPreview);
 await page.keyboard.press('Control+Enter');await expect(page.locator('#inlineWysiwyg')).toBeHidden();expect(await model(page)).toEqual(lastPreview);
});

test('baseline cache invalidates on metric and font lifecycle changes',async({page})=>{
 await instrumentPage(page,'current');await seed(page,{text:'Команда проверяет метрики',w:280,h:200});await edit(page);await select(page,7,0);
 for(const [key,value] of [['fontSize','29'],['letterSpacing','2'],['lineHeight','1.8'],['strokeWidth','3']]){
  await page.evaluate(()=>{window.__enabled=true;window.__metrics={}});
  const field=page.locator(`#inspector [data-key=${key}]`);await field.fill(value);await field.press('Tab');
  const m=await page.evaluate(()=>{window.__enabled=false;return window.__metrics});
  expect(m.mixedTextLayout.length).toBeGreaterThan(0);
  if(['fontSize','letterSpacing','lineHeight'].includes(key))expect(m.baselineProbe.length).toBeGreaterThan(0);
  await expect(page.locator('#wysiwygRecovery')).toBeHidden();
 }
 await page.locator('#inlineWysiwyg').focus();await select(page,7,0);
 await page.evaluate(()=>{document.fonts.dispatchEvent(new Event('loadingdone'));window.__metrics={};window.__enabled=true});
 await page.locator('#inspector [data-text-decoration=underline]').click();
 expect(await page.evaluate(()=>window.__metrics.baselineProbe.length)).toBeGreaterThan(0);
 await page.keyboard.press('Control+Enter');
 const width=page.locator('#inspector [data-key=w]');await width.fill('160');await width.press('Tab');
 await edit(page);expect(await page.locator('#inlineWysiwyg').evaluate(h=>parseFloat(h.style.width))).toBe(160);
});
