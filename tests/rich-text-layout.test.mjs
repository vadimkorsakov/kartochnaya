import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveRichTextStyle,richTextSpans,retainRichTextSizeBase,usesRichTextLayout,createRichTextLayoutEngine,LEGACY_TOP_LAYOUT,legacyTopProjection} from '../src/render/rich-text-layout.mjs';

const base={text:'А😀 Б',fontSize:20,fontWeight:'500',fontStyle:'oblique',textColor:'#123456',letterSpacing:2};
test('explicit keys win within a scope, run aliases override the base, missing keys inherit',()=>{
 assert.equal(resolveRichTextStyle(base,{bold:true}).fontWeight,'700');
 assert.equal(resolveRichTextStyle(base,{bold:false}).fontWeight,'400');
 assert.equal(resolveRichTextStyle(base,{bold:true,fontWeight:'300'}).fontWeight,'300');
 assert.equal(resolveRichTextStyle(base,{italic:false}).fontStyle,'normal');
 assert.equal(resolveRichTextStyle(base,{italic:false,fontStyle:'italic'}).fontStyle,'italic');
 assert.equal(resolveRichTextStyle({...base,bold:true,italic:true}).fontWeight,'500');
 assert.equal(resolveRichTextStyle({...base,bold:true,italic:true}).fontStyle,'oblique');
 assert.deepEqual(resolveRichTextStyle(base,{textColor:'red'}),{fontFamily:'Arial',fontWeight:'500',fontStyle:'oblique',fontSize:20,textColor:'red',letterSpacing:2});
});
test('render projection repairs UTF-16 ranges without mutating source or unknown properties',()=>{
 const e={...base,textRuns:[{start:2,end:3,style:{fontSize:40,underline:true,baselineShift:'super',fontFeatures:{liga:0}}}]};
 const before=structuredClone(e),spans=richTextSpans(e);
 assert.equal(spans.map(s=>s.text).join(''),e.text);
 assert.equal(spans[1].text,'😀');assert.equal(spans[1].style.fontSize,40);
 assert.equal(spans[1].style.underline,undefined);assert.deepEqual(e,before);
 retainRichTextSizeBase(e);assert.equal(e.textRunsBaseFontSize,20);
 e.fontSize=10;assert.equal(richTextSpans(e)[1].style.fontSize,20);
 assert.deepEqual(e.textRuns,before.textRuns);
});
test('plain, vertical, path, boundary, arc and justified text retain legacy dispatch',()=>{
 for(const patch of [{textRuns:undefined},{textRuns:[]},{textMode:'vertical'},{textMode:'path'},{textMode:'boundary'},{mobileArcRadius:30},{textAlign:'justify'}])
  assert.equal(usesRichTextLayout({...base,textRuns:[{start:0,end:1,style:{bold:true}}],...patch}),false);
});
test('bounded measurement cache reuses layouts and invalidates on font completion/error',()=>{
 let calls=0;const events={};
 const context={measureText(text){calls++;const size=parseFloat(this.font.match(/([\d.]+)px/)[1]);return {width:[...text].length*size/2,fontBoundingBoxAscent:size*.8,fontBoundingBoxDescent:size*.2}}};
 const fontSet={size:0,addEventListener:(name,fn)=>events[name]=fn},engine=createRichTextLayoutEngine(context,fontSet);
 const e={...base,w:80,h:200,textRuns:[{start:1,end:3,style:{fontSize:40}}]};
 const first=engine.layout(e),count=calls;assert.equal(engine.layout(e),first);assert.equal(calls,count);
 assert.equal(first.rows.flatMap(r=>r.fragments).map(p=>p.text).join(''),base.text);
 const next=engine.layout({...e,w:40});assert.notEqual(next,first);
 assert.ok(next.rows.length>first.rows.length);
 for(const patch of [{fontFamily:'Georgia'},{fontSize:32}]){const before=calls;assert.notEqual(engine.layout({...e,...patch}),first);assert.ok(calls>before)}
 fontSet.size++;assert.notEqual(engine.layout(e),first);
 for(const name of ['loadingdone','loadingerror']){events[name]();const before=calls;assert.notEqual(engine.layout(e),first);assert.ok(calls>before)}
});

test('source intervals preserve UTF-16, hard/soft wraps, empty rows and CR compatibility',()=>{
 const context={measureText(text){return {width:[...text].length*10,fontBoundingBoxAscent:16,fontBoundingBoxDescent:4}}};
 const engine=createRichTextLayoutEngine(context);
 for(const text of ['', '\n', '\n\n', 'A😀👩‍💻Б\n\nC\n', 'AB\r\nC\rD\r', 'alpha     beta']){
  const rows=engine.layout({text,w:35,h:100,fontSize:20,textRuns:[{start:1,end:3,style:{textColor:'red'}}]}).rows;
  assert.equal(rows[0].start,0);assert.equal(rows.at(-1).nextStart,text.length);
  const boundaries=new Set([0,text.length,...Array.from(new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text),p=>p.index)]);
  for(let i=0;i<rows.length;i++){
   const row=rows[i];assert.ok(row.start<=row.end&&row.end<=row.nextStart);
   if(i+1<rows.length)assert.equal(row.nextStart,rows[i+1].start);
   assert.equal(row.softWrap,i+1<rows.length&&row.end===row.nextStart);
   if(row.nextStart>row.end)assert.match(text.slice(row.end,row.nextStart),/^\r?\n$/);
   for(const p of row.fragments){assert.ok(p.start>=row.start&&p.end<=row.end);assert.ok(boundaries.has(p.start)&&boundaries.has(p.end));assert.equal(p.text,text.slice(p.start,p.end).replaceAll('\r',''));}
  }
 }
});

test('legacy-top opts in per layer and cannot collide with the old rich cache entry',()=>{
 const stack=[];
 const context={textBaseline:'alphabetic',save(){stack.push({font:this.font,textBaseline:this.textBaseline,letterSpacing:this.letterSpacing})},restore(){Object.assign(this,stack.pop())},measureText(text){return {width:text.length*20,fontBoundingBoxAscent:29,fontBoundingBoxDescent:7,actualBoundingBoxAscent:this.textBaseline==='top'?-2.828125:22,actualBoundingBoxDescent:this.textBaseline==='top'?24.828125:0}}};
 const engine=createRichTextLayoutEngine(context),source={text:'ABCD\nABCD',w:200,h:120,fontFamily:'Arial',fontSize:32,lineHeight:1.15,textRuns:[{start:1,end:3,style:{textColor:'#11aa33'}}]},before=structuredClone(source);
 const old=engine.layout(source),marked=engine.layout({...source,textLayoutMode:LEGACY_TOP_LAYOUT});
 assert.equal(old.rows[0].baseline,29.4);assert.equal(marked.rows[0].baseline,24.828125);
 assert.equal(marked.rows[1].baseline-marked.rows[0].baseline,32*1.15);
 assert.equal(engine.layout(source),old);assert.equal(engine.layout({...source,textLayoutMode:LEGACY_TOP_LAYOUT}),marked);assert.deepEqual(source,before);
});

test('legacy projection uses metrics at any family, size, weight, style and line height',()=>{
 const stack=[];let fault={};
 const context={textBaseline:'alphabetic',save(){stack.push({font:this.font,textBaseline:this.textBaseline,letterSpacing:this.letterSpacing})},restore(){Object.assign(this,stack.pop())},measureText(text){
  const size=Number(this.font.match(/([\d.]+)px/)[1]),top=this.textBaseline==='top';
  return {width:text.length*size/2,fontBoundingBoxAscent:size*.75,fontBoundingBoxDescent:size*.2,
   actualBoundingBoxAscent:top?0:size*.7,actualBoundingBoxDescent:top?size*.7:0,...(typeof fault==='function'?fault(text,top):fault)};
 }};
 for(const fontFamily of ['Any Available Face','Georgia','Arial'])for(const fontSize of [24,32,40])for(const lineHeight of [1,1.15,1.3]){
  const e={text:'ABCD\nABCD',fontFamily,fontSize,fontWeight:'700',fontStyle:'italic',lineHeight},before=structuredClone(e);
  const p=legacyTopProjection(context,e);assert.ok(p);assert.equal(p.height,fontSize*lineHeight);assert.ok(Math.abs(p.baseline-fontSize*.7)<1e-10);assert.deepEqual(e,before);
  assert.equal(legacyTopProjection(context,{...e,textRuns:[{start:1,end:3,style:{textColor:'red'}}]}),null);
  assert.ok(legacyTopProjection(context,{...e,textLayoutMode:LEGACY_TOP_LAYOUT,textRuns:[{start:1,end:3,style:{textColor:'red'}}]}));
  assert.equal(legacyTopProjection(context,{...e,textLayoutMode:LEGACY_TOP_LAYOUT,textRuns:[{start:1,end:3,style:{fontSize:fontSize+1}}]}),null);
 }
 const e={text:'ABCD',fontSize:32,lineHeight:1.15};
 for(const invalid of [{width:NaN},{fontBoundingBoxAscent:Infinity},{fontBoundingBoxDescent:-1},{fontBoundingBoxAscent:50},{actualBoundingBoxDescent:99}]){fault=invalid;assert.equal(legacyTopProjection(context,e),null)}
 fault={};assert.equal(legacyTopProjection(context,{...e,text:'ABCD\n'}),null);
 fault=(text,top)=>text==='EFGH'?{actualBoundingBoxAscent:top?0:23.4,actualBoundingBoxDescent:top?23.4:0}:{};
 assert.equal(legacyTopProjection(context,{...e,text:'ABCD\nEFGH'}),null);
 // A naturally matching row needs no marker; an existing marker remains valid.
 fault={fontBoundingBoxAscent:22.4,fontBoundingBoxDescent:9.6};
 assert.equal(legacyTopProjection(context,{...e,lineHeight:1}),null);
 assert.ok(legacyTopProjection(context,{...e,lineHeight:1,textLayoutMode:LEGACY_TOP_LAYOUT}));
 // The actual source rows take precedence over a slightly different Mg sample.
 fault=text=>text==='Mg'?{fontBoundingBoxAscent:23.2,fontBoundingBoxDescent:8.8}:{fontBoundingBoxAscent:22.8,fontBoundingBoxDescent:9.2};
 assert.equal(legacyTopProjection(context,{...e,lineHeight:1}),null);
 assert.equal(context.textBaseline,'alphabetic');
});
