import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectCanvasResources,prepareCanvasResources,ExportResourceError} from '../src/render/export-resources.mjs';
import {readImageResource} from '../src/render/image-resource.mjs';
import {createFontResources,selectCustomFont} from '../src/render/font-resource.mjs';
const options={isVisible:(e,d)=>e.visible!==false&&!d.groups?.some(g=>g.id===e.groupId&&g.visible===false),hasEffect:t=>['noise','glass','backgroundBlur','gaussianBlur'].includes(t)};
const collect=elements=>collectCanvasResources({elements,groups:[{id:'hidden',visible:false}]},options);
const base={id:'one',visible:true,type:'rect',fillType:'image',imageSrc:'shared'};
test('collector reads renderer dependencies, deduplicates and leaves frozen input unchanged',()=>{
 const elements=[Object.freeze({...base,layerMaskSrc:'layer',effects:[Object.freeze({type:'noise',maskSrc:'fx'})]}),Object.freeze({...base,id:'two'}),Object.freeze({type:'raster',rasterSrc:'raster'}),Object.freeze({type:'text',fontFamily:'Custom',fontWeight:700,fontStyle:'italic',text:'abc',fillType:'image',imageSrc:'text-image'})];
 const before=JSON.stringify(elements),deps=collect(Object.freeze(elements));
 assert.deepEqual(deps.images.map(x=>x.src),['layer','fx','shared','raster','text-image']);assert.equal(deps.fonts[0].weight,'700');assert.equal(deps.fonts[0].style,'italic');assert.equal(JSON.stringify(elements),before);
});
test('collector excludes hidden groups/layers, disabled/unknown effects and unused fill sources',()=>{
 const deps=collect([{...base,visible:false},{...base,groupId:'hidden'},{...base,fillType:'solid',effects:[{type:'noise',enabled:false,maskSrc:'disabled'},{type:'unknown',maskSrc:'unknown'}]},{type:'raster',rasterSrc:'r',imageSrc:'unused',fillType:'image'},{type:'path',pathClosed:false,fillType:'image',imageSrc:'open'},{type:'vector',vectorLine:true,fillType:'image',imageSrc:'line'}]);
 assert.deepEqual(deps.images.map(x=>x.src),['r']);
});
test('region uses backdrop and only first background effect, text requirements share a variant',()=>{
 const deps=collect([{...base,isFxRegion:true,layerMaskSrc:'region',effects:[{type:'glass',maskSrc:'first'},{type:'backgroundBlur',maskSrc:'unused'},{type:'noise',maskSrc:'noise'}]},{type:'text',text:'a'},{type:'text',text:'b'}]);
 assert.deepEqual(deps.images.map(x=>x.src),['region','first','noise']);assert.deepEqual(deps.fonts,[{family:'Arial',weight:'400',style:'normal',text:'ab'}]);
});
function images(){const cache=new Map(),created=[];return {created,read:src=>readImageResource(cache,src,()=>{const image={};created.push(image);return image;})};}
test('coordinator and live reader share one loading image; hot repeats use no new request',async()=>{
 const i=images();i.read('shared');const deps=collect([base,{...base,id:'two'}]);
 const a=prepareCanvasResources(deps,{readImage:i.read}),b=prepareCanvasResources(deps,{readImage:i.read});assert.equal(i.created.length,1);i.created[0].onload();assert.deepEqual(await a,{ready:true,images:1,fonts:0});await b;await prepareCanvasResources(deps,{readImage:i.read});assert.equal(i.created.length,1);
});
test('failed or non-confirmed images reject with dependency details',async()=>{
 const i=images(),deps=collect([base]),wait=prepareCanvasResources(deps,{readImage:i.read});i.created[0].onerror();
 await assert.rejects(wait,e=>e instanceof ExportResourceError&&e.resource.src==='shared'&&e.resource.layer==='one');
 await assert.rejects(prepareCanvasResources(deps,{readImage:()=>({state:'loading'})}),/подтверждения/);
 await assert.rejects(prepareCanvasResources(deps,{readImage:()=>({state:'absent'})}),/ошибка загрузки/);
});
test('total timeout releases operation without poisoning shared image or blocking a later export',async()=>{
 const i=images(),deps=collect([base]);await assert.rejects(prepareCanvasResources(deps,{readImage:i.read,timeoutMs:5}),/таймаут/);
 i.created[0].onload();await prepareCanvasResources(deps,{readImage:i.read});assert.equal(i.created.length,1);
});
test('abort before and during preparation does not start extra requests',async()=>{
 const i=images(),deps=collect([base]),before=new AbortController();before.abort(new Error('cancelled'));
 await assert.rejects(prepareCanvasResources(deps,{readImage:i.read,signal:before.signal}),/cancelled/);assert.equal(i.created.length,0);
 const during=new AbortController(),wait=prepareCanvasResources(deps,{readImage:i.read,signal:during.signal});during.abort(new Error('cancelled'));
 await assert.rejects(wait,/cancelled/);assert.equal(i.created.length,1);
});
test('font is awaited, failure is explicit and stalled FontFace hits the same deadline',async()=>{
 const deps=collect([{type:'text',fontFamily:'Custom'}]);let finish;
 const ready=prepareCanvasResources(deps,{prepareFont:()=>new Promise(r=>finish=r)});finish();assert.equal((await ready).fonts,1);
 await assert.rejects(prepareCanvasResources(deps,{prepareFont:()=>Promise.reject(new Error('bad face'))}),e=>e.resource.kind==='font'&&e.resource.family==='Custom');
 await assert.rejects(prepareCanvasResources(deps,{prepareFont:()=>new Promise(()=>{}),timeoutMs:5}),/таймаут/);
});
const regular={family:'Custom',name:'Legacy-Regular',weight:400,style:'normal',data:'regular'},bold={family:'Custom',name:'Legacy-Bold',weight:700,style:'italic',data:'bold'};
test('custom font matching honors family, weight, style and legacy alias',()=>{
 assert.equal(selectCustomFont({family:'CUSTOM',weight:700,style:'italic'},[regular,bold]).record,bold);
 assert.equal(selectCustomFont({family:'Custom',weight:500,style:'normal'},[regular,bold]).record,regular);
 const old=selectCustomFont({family:'Legacy-Bold',weight:700,style:'italic'},[regular,bold]);assert.equal(old.record,bold);assert.equal(old.weight,'400');assert.equal(old.style,'normal');
 assert.equal(selectCustomFont({family:'Arial'},[regular,bold]),null);
});
function fontLoader(){
 const created=[],registered=new Set();
 const fontSet={add:f=>registered.add(f),load:async css=>[...registered].filter(f=>css.includes(f.family))};
 const loader=createFontResources({fontSet,createFace:(family,source,meta)=>{const f={family,source,...meta,status:'unloaded',load(){this.status=source.includes('bad')?'error':'loaded';return this.status==='error'?Promise.reject(new Error('bad font')):Promise.resolve(this);}};created.push(f);return f;}});
 return {loader,created,registered,fontSet};
}
test('one FontFace lifecycle is reused by startup, export and legacy registration',async()=>{
 const {loader,created,registered}=fontLoader();await loader.load(bold);assert.equal(created.length,2);assert.equal(registered.size,2);
 await loader.ensure({family:'Custom',weight:700,style:'italic',text:'abc'},[regular,bold]);assert.equal(created.length,2);
 await loader.ensure({family:'Legacy-Bold',weight:400,style:'normal'},[bold]);assert.equal(created.length,2);
});
test('prepare is reusable and does not register before an import transaction succeeds',async()=>{
 const {loader,created,registered}=fontLoader();const faces=await loader.prepare(bold);assert.equal(registered.size,0);loader.register(faces);await loader.load(bold);assert.equal(created.length,2);assert.equal(registered.size,2);
});
test('exact failed custom variant rejects, but an unrelated failed variant cannot block regular',async()=>{
 const {loader,created}=fontLoader(),bad={...bold,data:'bad'};
 await assert.rejects(loader.load(bad));const count=created.length;
 await assert.rejects(loader.ensure({family:'Custom',weight:700,style:'italic'},[regular,bad]));assert.equal(created.length,count);
 await loader.ensure({family:'Custom',weight:400,style:'normal'},[regular,bad]);
});
test('system names permit FontFaceSet empty result; a custom face must actually match',async()=>{
 const {loader,fontSet,created}=fontLoader();fontSet.load=async()=>[];
 await loader.ensure({family:'System font'},[bold]);assert.equal(created.length,0);
 await assert.rejects(loader.ensure({family:'Custom',weight:700,style:'italic'},[bold]),/не выбран/);
});
test('brush fallbacks still prepare an image fill; completed ink bypasses it',()=>{
 const brush={...base,inkTool:'brush',inkPoints:[{x:0,y:0}]};
 assert.deepEqual(collect([brush]).images.map(x=>x.src),['shared']);
 assert.deepEqual(collect([{...brush,inkProfile:'marker'}]).images.map(x=>x.src),['shared']);
 assert.deepEqual(collect([{...brush,inkProfile:'marker',inkPoints:[{},{}]}]).images,[]);
 assert.deepEqual(collect([{...brush,type:'text',inkProfile:'spray'}]).images.map(x=>x.src),['shared']);
});
test('a region text backdrop measures its font; a text layer without glyph paint needs no font',()=>{
 const hasEffect=t=>t==='textBackdrop';
 const dependencies=collectCanvasResources({elements:[{type:'text',fillType:'none',fontFamily:'Unused'},{type:'text',isFxRegion:true,fillType:'image',imageSrc:'unused',fontFamily:'Required',effects:[{type:'textBackdrop',maskSrc:'mask'}]}]}, {...options,hasEffect});
 assert.deepEqual(dependencies.images.map(x=>x.src),['mask']);assert.deepEqual(dependencies.fonts.map(x=>x.family),['Required']);
});
