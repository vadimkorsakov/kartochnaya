import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveRichTextStyle,richTextSpans,retainRichTextSizeBase,usesRichTextLayout,createRichTextLayoutEngine} from '../src/render/rich-text-layout.mjs';

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
 const engine=createRichTextLayoutEngine(context,{size:0,addEventListener:(name,fn)=>events[name]=fn});
 const e={...base,w:80,h:200,textRuns:[{start:1,end:3,style:{fontSize:40}}]};
 const first=engine.layout(e),count=calls;assert.equal(engine.layout(e),first);assert.equal(calls,count);
 assert.equal(first.rows.flatMap(r=>r.fragments).map(p=>p.text).join(''),base.text);
 const next=engine.layout({...e,w:40});assert.notEqual(next,first);
 assert.ok(next.rows.length>first.rows.length);
 for(const name of ['loadingdone','loadingerror']){events[name]();const before=calls;assert.notEqual(engine.layout(e),first);assert.ok(calls>before)}
});
