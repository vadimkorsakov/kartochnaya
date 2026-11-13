// Test-only instrumentation: no hook, counter or diagnostic flag ships to users.
const {execFileSync}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const cache=new Map();
const references={pr144:'a07c1a60cca9d53a1a199c1572000f4395b86942',pr147:'cecc9f16aca98471aa90e580a018f3912f27142a'};
async function applicationHTML(ref='current',instrument=false){
 const key=ref+instrument;if(cache.has(key))return cache.get(key);
 const promise=(async()=>{
  let root=path.resolve(__dirname,'../src');
  if(ref!=='current'){
   const dir=path.resolve(__dirname,'../work/profile-'+ref);await fs.mkdir(dir,{recursive:true});
   execFileSync('tar',['-x','-C',dir],{input:execFileSync('git',['archive',references[ref],'src'],{maxBuffer:16*1024*1024})});root=path.join(dir,'src');
  }
  const {compileHTML}=await import('../scripts/compile-html.mjs');
  let html=(await compileHTML(root,instrument?{transformEditor:s=>{
   const i=s.lastIndexOf('})();');if(i<0)throw Error('Editor instrumentation insertion missing');
   const wrappers=['paint','mixedTextLayout','refreshPickerVisual','updatePickerColor','cpLiveColor','positionInlineText','supportsWysiwygProjection'];
   return s.slice(0,i)+wrappers.map(n=>`${n}=window.__measure('${n}',${n});`).join('\n')+'\n'+s.slice(i);
  }}:{})).toString();
  if(instrument){
   const replace=(from,to)=>{if(!html.includes(from))throw Error('Missing profile hook '+from);html=html.replace(from,to)};
   replace('function createWysiwygSession(', 'paintHorizontalTextPass=window.__measure("inkPass",paintHorizontalTextPass);\n function createWysiwygSession(');
   replace('let layer = element,','layout=window.__measure("sessionLayout",layout);\n let layer = element,');
   replace('host.contentEditable = "plaintext-only";','project=window.__measure("project",project);syncOverlay=window.__measure("syncOverlay",syncOverlay);\n host.contentEditable = "plaintext-only";');
   replace('return { layout, layoutJustified, invalidate };','layout=window.__measure("layout",layout);layoutJustified=window.__measure("layoutJustified",layoutJustified);return { layout,layoutJustified,invalidate };');
   replace('function createWysiwygSession(', 'lineHeight=window.__measure("lineHeight",lineHeight);unifiedDOMOffset=window.__measure("baseline",unifiedDOMOffset);\n function createWysiwygSession(');
  }
  return html;
 })();cache.set(key,promise);return promise;
}
async function instrumentPage(page,ref){
 const html=await applicationHTML(ref,true);
 await page.addInitScript(()=>{
  window.__metrics={};window.__enabled=false;
  window.__measure=(name,fn)=>function(...args){if(!window.__enabled)return fn.apply(this,args);if(name==='refreshPickerVisual'&&args[0]===false)(window.__metrics.refreshPickerVisualFalse??=[]).push(0);const t=performance.now();try{return fn.apply(this,args)}finally{(window.__metrics[name]??=[]).push(performance.now()-t)}};
  const append=Element.prototype.append;Element.prototype.append=function(...args){if(window.__enabled&&this===document.body&&args.some(n=>n.style?.left==='-100000px'))(window.__metrics.baselineProbe??=[]).push(0);return append.apply(this,args)};
  const original=Element.prototype.replaceChildren;Element.prototype.replaceChildren=function(...args){if(this.id==='inlineWysiwyg'&&window.__enabled)(window.__metrics.replaceChildren??=[]).push(0);return original.apply(this,args)};
  const rect=Element.prototype.getBoundingClientRect;Element.prototype.getBoundingClientRect=function(...args){if(window.__enabled)(window.__metrics.getBoundingClientRect??=[]).push(0);return rect.apply(this,args)};
  const measure=CanvasRenderingContext2D.prototype.measureText;CanvasRenderingContext2D.prototype.measureText=window.__measure('measureText',measure);
  window.__longTasks=[];
  if(PerformanceObserver.supportedEntryTypes.includes('longtask'))new PerformanceObserver(list=>{if(window.__enabled)window.__longTasks.push(...list.getEntries().filter(e=>e.startTime>=window.__profileStart).map(e=>({start:e.startTime,duration:e.duration})))}).observe({type:'longtask'});
 });
 await page.route(/\/(?:index\.html)?(?:\?.*)?$/,route=>route.fulfill({body:html,contentType:'text/html'}));
}
module.exports={applicationHTML,instrumentPage,references};
