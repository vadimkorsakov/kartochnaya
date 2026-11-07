import test from 'node:test';
import assert from 'node:assert/strict';
import {fontDeclarationSize,richTextFont,resolveRichTextStyle,richTextSpans,retainRichTextSizeBase,usesRichTextLayout,supportsHorizontalTextLayout,createRichTextLayoutEngine} from '../src/render/rich-text-layout.mjs';

const base={text:'А😀 Б',fontSize:20,fontWeight:'500',fontStyle:'oblique',textColor:'#123456',letterSpacing:2};
test('explicit keys win within a scope, run aliases override the base, missing keys inherit',()=>{
 assert.equal(resolveRichTextStyle(base,{bold:true}).fontWeight,'700');
 assert.equal(resolveRichTextStyle(base,{bold:false}).fontWeight,'400');
 assert.equal(resolveRichTextStyle(base,{bold:true,fontWeight:'300'}).fontWeight,'300');
 assert.equal(resolveRichTextStyle(base,{italic:false}).fontStyle,'normal');
 assert.equal(resolveRichTextStyle(base,{italic:false,fontStyle:'italic'}).fontStyle,'italic');
 assert.equal(resolveRichTextStyle({...base,bold:true,italic:true}).fontWeight,'500');
 assert.equal(resolveRichTextStyle({...base,bold:true,italic:true}).fontStyle,'oblique');
 assert.deepEqual(resolveRichTextStyle(base,{textColor:'red'}),{fontFamily:'Arial',fontWeight:'500',fontStyle:'oblique',fontSize:20,textColor:'red',letterSpacing:2,underline:false,strikethrough:false});
});
test('render projection repairs UTF-16 ranges without mutating source or unknown properties',()=>{
 const e={...base,textRuns:[{start:2,end:3,style:{fontSize:40,underline:true,baselineShift:'super',fontFeatures:{liga:0}}}]};
 const before=structuredClone(e),spans=richTextSpans(e);
 assert.equal(spans.map(s=>s.text).join(''),e.text);
 assert.equal(spans[1].text,'😀');assert.equal(spans[1].style.fontSize,40);
 // U/S now project as paint styles; unknown extensions remain source-only.
 assert.equal(spans[1].style.underline,true);assert.equal(spans[1].style.baselineShift,undefined);assert.deepEqual(e,before);
 retainRichTextSizeBase(e);assert.equal(e.textRunsBaseFontSize,20);
 e.fontSize=10;assert.equal(richTextSpans(e)[1].style.fontSize,20);
 assert.deepEqual(e.textRuns,before.textRuns);
});
test('plain horizontal text uses the shared painter while specialized modes keep their own geometry',()=>{
 assert.equal(supportsHorizontalTextLayout({...base}),true);
 assert.equal(supportsHorizontalTextLayout({...base,textRuns:[]}),true);
 assert.equal(supportsHorizontalTextLayout({...base,textRuns:[{start:0,end:1,style:{textColor:'red'}}]}),true);
 for(const patch of [{textMode:'vertical'},{textMode:'path'},{textMode:'boundary'},{mobileArcRadius:30},{textAlign:'justify'}])
  assert.equal(supportsHorizontalTextLayout({...base,...patch}),false);
});
test('sparse-run editing predicate continues to distinguish plain layers',()=>{
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

test('obsolete legacy-top metadata cannot change unified Canvas line geometry or cache',()=>{
 const context={measureText(text){return {width:text.length*20,fontBoundingBoxAscent:29,fontBoundingBoxDescent:7}}};
 const engine=createRichTextLayoutEngine(context);
 const source={text:'ABCD\nABCD',w:200,h:120,fontFamily:'Arial',fontSize:32,lineHeight:1.15,textRuns:[{start:1,end:3,style:{textColor:'#11aa33'}}]};
 const before=structuredClone(source),unified=engine.layout(source);
 const imported=engine.layout({...source,textLayoutMode:'legacy-top'});
 assert.strictEqual(imported,unified,'old metadata cannot create a second layout');
 assert.equal(unified.rows[0].baseline,29.4);
 assert.ok(Math.abs(unified.rows[1].baseline-unified.rows[0].baseline-Math.max(32*1.15,36))<1e-10);
 assert.deepEqual(source,before);
});

test('plain and color-only styles preserve the same line metrics in unified layout',()=>{
 const context={measureText(text){
  const size=parseFloat(this.font.match(/([\d.]+)px/)[1]);
  return {width:[...text].length*size*.6,fontBoundingBoxAscent:size*.8,fontBoundingBoxDescent:size*.2};
 }};
 const engine=createRichTextLayoutEngine(context);
 const plain={text:'HHHH HHHH',w:300,h:90,fontFamily:'Arial',fontSize:24,lineHeight:1.2};
 const decorated={...plain,textRuns:[{start:2,end:6,style:{textColor:'#ff0000'}}]};
 const a=engine.layout(plain),b=engine.layout(decorated);
 assert.equal(a.rows[0].baseline,b.rows[0].baseline);
 assert.equal(a.rows[0].height,b.rows[0].height);
 assert.equal(a.rows[0].width,b.rows[0].width);
 assert.equal(a.rows[0].fragments[0].text,'HHHH HHHH');
 assert.equal(b.rows[0].fragments.map(f=>f.text).join(''),'HHHH HHHH');
 assert.equal(a.height,b.height);
});

test('color-only range boundaries retain contextual kerning and wrapping',()=>{
 const context={measureText(text){
  const characters=[...text].length;
  const pairs=(text.match(/AV/g)||[]).length;
  return {width:characters*12-pairs*3,fontBoundingBoxAscent:16,fontBoundingBoxDescent:4};
 }};
 const engine=createRichTextLayoutEngine(context);
 const source={text:'AVATAR',w:70,h:90,fontFamily:'Arial',fontSize:20,lineHeight:1.15};
 const colorOnly={...source,textRuns:[{start:1,end:3,style:{textColor:'#ff2211'}}]};
 const plain=engine.layout(source),styled=engine.layout(colorOnly);
 assert.equal(plain.rows.length,1);
 assert.equal(styled.rows.length,1,'a color boundary must not introduce a wrap');
 assert.equal(styled.rows[0].width,plain.rows[0].width);
 assert.equal(styled.rows[0].baseline,plain.rows[0].baseline);
 assert.deepEqual(styled.rows[0].fragments.map(f=>f.text),['A','VA','TAR']);
 assert.deepEqual(styled.rows[0].fragments.map(f=>f.x),[0,12,33]);
 assert.deepEqual(styled.rows[0].fragments.map(f=>f.width),[12,21,36]);
 assert.equal(styled.rows[0].fragments[1].style.textColor,'#ff2211');
 assert.equal(source.textRuns,undefined,'rendering must not mutate the plain source');
});

test('font declaration shares CSS/Canvas precision without rewriting source or run sizes',()=>{
 const element={text:'АБ',fontSize:28.3125,textRunsBaseFontSize:42,textRuns:[{start:1,end:2,style:{fontSize:59}}]};
 const before=structuredClone(element),spans=richTextSpans(element);
 assert.match(richTextFont(spans[0].style),/28\.3125px/);
 assert.equal(spans[1].style.fontSize,59*28.3125/42);
 for(const part of spans){const painted=fontDeclarationSize(part.style.fontSize);assert.ok(Math.abs(painted-part.style.fontSize)<=part.style.fontSize/128);}
 assert.deepEqual(element,before);
});

test('shared font precision remains representable across size exponents',()=>{
 for(const [source,painted] of [[28.3125,28.25],[39.75,40],[65.5,66],[129,128],[450,448]]){
  const style=resolveRichTextStyle({fontSize:source});assert.equal(fontDeclarationSize(style.fontSize),painted);assert.match(richTextFont(style),new RegExp(' '+source+'px '));assert.equal(style.fontSize,source);
 }
});
