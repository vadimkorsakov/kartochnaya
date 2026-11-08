import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRuns,applyTextStyle,effectiveTextStyleAt,replaceText,validateRuns} from '../src/model/rich-text.mjs';
import {createInlineHistory,recordInlineHistory,moveInlineHistory} from '../src/model/inline-text-history.mjs';
import {createRichTextLayoutEngine,resolveRichTextStyle} from '../src/render/rich-text-layout.mjs';
import {textStrokePadding} from '../src/render/text-stroke.mjs';

test('stroke validation rejects malformed saved values, normalizes HEX, and preserves explicit zero',()=>{
 const text='абвг';
 assert.deepEqual(normalizeRuns(text,[{start:0,end:1,style:{strokeWidth:-1,stroke:'red'}},{start:1,end:2,style:{strokeWidth:'3',stroke:123}},{start:2,end:3,style:{strokeWidth:Infinity,stroke:'#F0A'}},{start:3,end:4,style:{strokeWidth:0}}],{strokeWidth:0}),[
  {start:2,end:3,style:{stroke:'#ff00aa'}},{start:3,end:4,style:{strokeWidth:0}}
 ]);
 const e=applyTextStyle({text,strokeWidth:0},0,1,{strokeWidth:0});
 assert.equal(effectiveTextStyleAt({...e,strokeWidth:6},0).strokeWidth,0);
 assert.equal(resolveRichTextStyle({}).strokeWidth,0);
 assert.equal(resolveRichTextStyle({strokeWidth:6},{strokeWidth:0}).strokeWidth,0);
});
test('range stroke priorities, overlapping edits and JSON normalization are idempotent',()=>{
 const base={text:'Раз два 😀',strokeWidth:4,stroke:'#112233'};
 let e=applyTextStyle(base,0,3,{strokeWidth:2,stroke:'#F00'});
 e=applyTextStyle(e,2,7,{strokeWidth:0});
 assert.equal(effectiveTextStyleAt(e,0).stroke,'#ff0000');
 assert.equal(effectiveTextStyleAt(e,2).strokeWidth,0);
 assert.equal(effectiveTextStyleAt(e,8).strokeWidth,4);
 assert.equal(effectiveTextStyleAt(e,8).stroke,'#112233');
 assert.deepEqual(normalizeRuns(e.text,JSON.parse(JSON.stringify(e.textRuns)),e),e.textRuns);
 assert.deepEqual(applyTextStyle(e,2,7,{strokeWidth:0}),e);
 assert.equal(validateRuns(e.text,e.textRuns,e),true);assert.equal(base.textRuns,undefined);
});
test('UTF-16 replacement inherits stroke and deletion never bisects an emoji',()=>{
 let e=applyTextStyle({text:'f😀i'},0,3,{strokeWidth:3,stroke:'#2266dd'});
 e=replaceText(e,3,3,'Ж');assert.equal(e.text,'f😀Жi');
 assert.equal(effectiveTextStyleAt(e,3).strokeWidth,3);
 e=replaceText(e,2,3,'');assert.equal(e.text,'fЖi');
 assert.deepEqual(e.textRuns,[{start:0,end:2,style:{stroke:'#2266dd',strokeWidth:3}}]);
});
test('session history restores stroke zero, color and UTF-16 backward caret with text',()=>{
 const original={text:'fi😀',strokeWidth:4,stroke:'#111111'},history=createInlineHistory(original);
 const styled=applyTextStyle(original,0,1,{strokeWidth:0,stroke:'#ff0000'});
 recordInlineHistory(history,styled,{start:0,end:1,direction:'backward'});
 const typed=replaceText(styled,1,1,'X');recordInlineHistory(history,typed,{start:2,end:2,direction:'forward'});
 assert.deepEqual(moveInlineHistory(history,-1),{element:styled,caret:{start:0,end:1,direction:'backward'}});
 assert.deepEqual(moveInlineHistory(history,-1).element,original);
 assert.deepEqual(moveInlineHistory(history,1).element,styled);
});
test('stroke paint boundaries preserve wraps, baselines, leading, total advances and following groups',()=>{
 const context={measureText(text){const size=parseFloat(this.font.match(/([\d.]+)px/)[1]);return {width:[...text].length*size*.5,fontBoundingBoxAscent:size*.8,fontBoundingBoxDescent:size*.2};}};
 const engine=createRichTextLayoutEngine(context);
 const base={text:'AV fi Жук 😀\nЕщё строка',w:90,h:300,fontSize:20,lineHeight:1.3};
 const original=engine.layout(base);
 const e=applyTextStyle(base,0,4,{strokeWidth:12,stroke:'#ff0000'}),styled=engine.layout(e);
 const geometry=x=>x.rows.map(({start,end,nextStart,width,y,height,baseline})=>({start,end,nextStart,width,y,height,baseline}));
 assert.deepEqual(geometry(styled),geometry(original));
 assert.deepEqual(engine.layout(applyTextStyle(e,0,4,{strokeWidth:0})).rows.map(r=>r.baseline),original.rows.map(r=>r.baseline));
});
test('stroke padding includes measured italic overhang without affecting layout metrics',()=>{
 const context={measureText(){return {width:30,fontBoundingBoxAscent:30,fontBoundingBoxDescent:8,actualBoundingBoxLeft:18,actualBoundingBoxRight:36,actualBoundingBoxAscent:33,actualBoundingBoxDescent:9};}};
 const e={text:'J',fontSize:36,w:30,h:60,strokeWidth:4},engine=createRichTextLayoutEngine(context),layout=engine.layout(e);
 assert.equal(layout.inkOverflow,18);assert.ok(textStrokePadding(layout)>=22);
 assert.deepEqual(layout.rows.map(r=>[r.width,r.baseline]),engine.layout({...e,strokeWidth:0}).rows.map(r=>[r.width,r.baseline]));
});
