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
 assert.deepEqual(resolveRichTextStyle(base,{textColor:'red'}),{fontFamily:'Arial',fontWeight:'500',fontStyle:'oblique',fontSize:20,fillOpacity:100,strokeOpacity:100,strokeStyle:'solid',textColor:'red',letterSpacing:2,lineHeight:1.15,underline:false,strikethrough:false,strokeWidth:0,stroke:'#000000'});
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

test('range leading survives glyph/token coalescing without changing kerning, wraps or x',()=>{
 const context={measureText(text){return {width:text.length*12-(text.match(/AV/g)||[]).length*3,fontBoundingBoxAscent:16,fontBoundingBoxDescent:4}}};
 const engine=createRichTextLayoutEngine(context),base={text:'AVATAR AVATAR AVATAR',fontSize:20,lineHeight:1.2,w:100,h:400};
 const a=engine.layout(base),b=engine.layout({...base,textRuns:[{start:1,end:3,style:{lineHeight:3}}]});
 assert.deepEqual(b.rows.map(r=>[r.start,r.end,r.width,r.fragments.map(p=>[p.text,p.x,p.width])]),a.rows.map(r=>[r.start,r.end,r.width,r.fragments.map(p=>[p.text,p.x,p.width])]));
 assert.equal(b.rows[0].height,40);assert.equal(b.rows[0].baseline,36);
 assert.equal(b.rows[1].height,24);assert.equal(b.rows[1].y-a.rows[1].y,18);
 assert.equal(b.rows[1].baseline-b.rows[0].baseline,24,'first-row leading adds no inter-row gap');
 assert.equal(b.rows[0].fragments.length,1,'lineHeight cannot split glyph painting');
 // Oversized tokens use per-grapheme heights rather than the whole token max.
 const c=engine.layout({...base,w:30,text:'AVATAR',textRuns:[{start:0,end:1,style:{lineHeight:3}}]});
 assert.deepEqual(c.rows.map(r=>r.height),[40,24,44]);
});

test('mixed size/leading uses each source requirement plus max ascent/descent, first baseline centered',()=>{
 const context={measureText(text){const size=parseFloat(this.font.match(/([\d.]+)px/)[1]);return {width:text.length*size/2,fontBoundingBoxAscent:size*.8,fontBoundingBoxDescent:size*.2}}};
 const engine=createRichTextLayoutEngine(context);
 const e={text:'ABCD',fontSize:20,lineHeight:1,w:400,h:400,textRuns:[{start:1,end:2,style:{fontSize:40,lineHeight:1}},{start:2,end:3,style:{lineHeight:4}}]};
 const row=engine.layout(e).rows[0];assert.equal(row.height,80);assert.equal(row.baseline,52);
 assert.ok(row.fragments.every(p=>p.y===52));
 const scaled=engine.layout({...e,fontSize:10,textRunsBaseFontSize:20}).rows[0];assert.equal(scaled.height,40);assert.equal(scaled.baseline,26);
});

test('empty rows use LF leading with legacy font metrics, including terminal LF',()=>{
 const context={measureText(text){return {width:text.length*10,fontBoundingBoxAscent:16,fontBoundingBoxDescent:4}}};
 const engine=createRichTextLayoutEngine(context),base={text:'A\n\n',fontSize:20,lineHeight:1.2,w:100,h:400};
 assert.deepEqual(engine.layout(base).rows.map(r=>r.height),[22,24,26]);
 const legacyMixed={...base,textRuns:[{start:2,end:3,style:{fontSize:40,fontFamily:'serif'}}]};
 assert.deepEqual(engine.layout(legacyMixed).rows.map(r=>r.height),[22,24,26],'existing empty-row font metrics stay unchanged');
 assert.deepEqual(engine.layout({...legacyMixed,textRuns:[{start:2,end:3,style:{fontSize:40,lineHeight:3}}]}).rows.map(r=>r.height),[22,60,62]);
 const rows=engine.layout({...base,textRuns:[{start:2,end:3,style:{lineHeight:3}}]}).rows;
 assert.deepEqual(rows.map(r=>r.height),[22,60,62]);assert.deepEqual(rows.map(r=>r.baseline),[18,78,138]);
 for(const value of [0,-1,NaN,Infinity,'bad'])assert.ok(Number.isFinite(engine.layout({...base,lineHeight:value,textRuns:[{start:0,end:1,style:{lineHeight:value}}]}).height));
});

test('leading boundaries do not split continuous U/S rectangles or introduce fractional seams',()=>{
 const context={measureText(text){return {width:text.length*11.3,fontBoundingBoxAscent:16,fontBoundingBoxDescent:4}}};
 const engine=createRichTextLayoutEngine(context),e={text:'Привет мир',fontSize:20,lineHeight:1.2,w:200,h:200,underline:true,strikethrough:true};
 const a=engine.layout(e).rows[0],b=engine.layout({...e,textRuns:[{start:1,end:4,style:{lineHeight:3}}]}).rows[0];
 assert.equal(a.decorations.length,2);assert.equal(b.decorations.length,2);
 const relative=row=>row.decorations.map(({y,...r})=>({...r,y:y-row.baseline}));
 assert.deepEqual(relative(b),relative(a));
});

const leadingContext={measureText(text){return {width:text.length*10,fontBoundingBoxAscent:16,fontBoundingBoxDescent:4}}};
test('A/B/C: middle leading shifts B and C equally, end leading shifts only C',()=>{
 const engine=createRichTextLayoutEngine(leadingContext),e={text:'A\nB\nC',fontSize:20,lineHeight:1.2,w:100,h:200};
 const a=engine.layout(e),b=engine.layout({...e,textRuns:[{start:2,end:3,style:{lineHeight:2.2}}]});
 assert.deepEqual(a.rows.map(r=>r.baseline),[18,42,66]);
 assert.deepEqual(b.rows.map(r=>r.baseline),[18,62,86]);
 assert.equal(b.rows[2].baseline-b.rows[1].baseline,24);
 assert.equal(b.height-a.height,20);
 assert.deepEqual(engine.layout({...e,textRuns:[{start:4,end:5,style:{lineHeight:2.2}}]}).rows.map(r=>r.baseline),[18,42,86]);
});

test('first-row half-leading is block padding: no extra gap after it; uniform rhythm stays unchanged',()=>{
 const engine=createRichTextLayoutEngine(leadingContext),e={text:'A\nB\nC',fontSize:20,lineHeight:1.2,w:100,h:200};
 const first=engine.layout({...e,textRuns:[{start:0,end:1,style:{lineHeight:2.2}}]});
 assert.deepEqual(first.rows.map(r=>r.baseline),[28,52,76]);assert.equal(first.height,92);
 for(const lineHeight of [1,1.2,2.2,3]){
  const h=20*lineHeight,padding=(h-20)/2,layout=engine.layout({...e,lineHeight});
  assert.deepEqual(layout.rows.map(r=>r.baseline),[16+padding,16+padding+h,16+padding+2*h]);
  assert.equal(layout.height,3*h);
  assert.equal(engine.layout({...e,text:'A',lineHeight}).height,h);
 }
});

test('soft-wrap middle/end fragment and empty LF own the preceding interval, retaining source offsets',()=>{
 const engine=createRichTextLayoutEngine(leadingContext);
 for(const e of [{text:'ABCDEFGH',w:20},{text:'A\n\nC\nD',w:100},{text:'A\r\n\r\nC\r\nD',w:100}]){
  const source={...e,fontSize:20,lineHeight:1.2,h:300},before=engine.layout(source);
  assert.equal(before.rows.length,4);
  for(const index of [1,2,3]){
   const row=before.rows[index],start=row.start,end=start+1;
   const after=engine.layout({...source,textRuns:[{start,end,style:{lineHeight:2.2}}]});
   assert.deepEqual(after.rows.map(r=>r.baseline),before.rows.map((r,i)=>r.baseline+(i>=index?20:0)));
   assert.deepEqual(after.rows.map(r=>[r.start,r.end,r.nextStart,r.softWrap,r.width]),before.rows.map(r=>[r.start,r.end,r.nextStart,r.softWrap,r.width]));
  }
 }
 // LF on a nonempty row cannot change its leading; the blank terminal row inherits it.
 const e={text:'A\n',w:100,h:200,fontSize:20,lineHeight:1.2};
 assert.deepEqual(engine.layout({...e,textRuns:[{start:1,end:2,style:{lineHeight:3}}]}).rows.map(r=>r.baseline),[18,78]);
});

test('mixed families/sizes reserve previous descent plus current ascent, never previous leading',()=>{
 const context={measureText(text){
  const size=parseFloat(this.font.match(/([\d.]+)px/)[1]),deep=this.font.includes('Deep'),tall=this.font.includes('Tall');
  return {width:text.length*size/2,fontBoundingBoxAscent:size*(deep ? .7 : tall ? .95 : .8),fontBoundingBoxDescent:size*(deep ? .5 : tall ? .1 : .2)};
 }};
 const engine=createRichTextLayoutEngine(context),e={text:'A\nBC\nD\nE',fontSize:20,lineHeight:1.2,w:200,h:400,textRuns:[
  {start:0,end:1,style:{fontSize:40,fontFamily:'Deep',lineHeight:.5}},
  {start:2,end:3,style:{fontSize:30,fontFamily:'Tall',lineHeight:.5}},
 ]};
 const layout=engine.layout(e);assert.deepEqual(layout.rows.map(r=>r.baseline),[28,76.5,100.5,124.5]);
 for(let i=0;i<layout.rows.length;i++){
  const row=layout.rows[i],parts=row.fragments.map(p=>{context.font=richTextFont(p.style);return context.measureText(p.text)});
  const top=row.baseline-Math.max(...parts.map(m=>m.fontBoundingBoxAscent)),bottom=row.baseline+Math.max(...parts.map(m=>m.fontBoundingBoxDescent));
  assert.ok(top>=row.y);assert.ok(bottom<=row.y+row.height);
  if(i)assert.ok(top>=layout.rows[i-1].y+layout.rows[i-1].height,'adjacent font bounds do not intersect');
  assert.ok(row.fragments.every(p=>p.y===row.baseline));
 }
 const changed=engine.layout({...e,textRuns:[...e.textRuns,{start:3,end:4,style:{lineHeight:4}}]});
 assert.deepEqual(changed.rows.map(r=>r.baseline),[28,108,132,156]);
});

test('vertical alignment uses the same block height without changing baseline intervals',()=>{
 const engine=createRichTextLayoutEngine(leadingContext),e={text:'A\nB\nC',fontSize:20,lineHeight:1.2,w:100,h:200,textRuns:[{start:2,end:3,style:{lineHeight:2.2}}]};
 const top=engine.layout(e);assert.equal(top.height,92);
 for(const [verticalAlign,offset] of [['middle',54],['bottom',108]]){
  const aligned=engine.layout({...e,verticalAlign});assert.equal(aligned.height,92);
  assert.deepEqual(aligned.rows.map(r=>r.baseline),top.rows.map(r=>r.baseline+offset));
  assert.deepEqual(aligned.rows.map(r=>r.y),top.rows.map(r=>r.y+offset));
 }
});

test('stroke opacity is paint-only, preserves contextual shaping and does not split un-stroked ligatures',()=>{
 const context={measureText(text){return {width:[...text].length*10-(text.includes('AV')?2:0)-(text.includes('fi')?1:0),fontBoundingBoxAscent:16,fontBoundingBoxDescent:4};}};
 const engine=createRichTextLayoutEngine(context);
 const base={text:'AV fi 😀\nAV fi wrapped',w:72,h:200,fontSize:20,lineHeight:1.2,strokeWidth:3,underline:true,strikethrough:true};
 const geometry=x=>x.rows.map(({start,end,nextStart,width,y,height,baseline})=>({start,end,nextStart,width,y,height,baseline}));
 for(const [start,end] of [[0,1],[3,4],[3,5],[1,6]]){
  const before=engine.layout(base),after=engine.layout({...base,textRuns:[{start,end,style:{strokeOpacity:40}}]});
  assert.deepEqual(geometry(after),geometry(before));
  assert.ok(after.rows.flatMap(r=>r.fragments).some(p=>p.style.strokeOpacity===40));
  assert.ok(after.rows.flatMap(r=>r.decorations).every(r=>r.fillOpacity===100));
 }
 const av=engine.layout({...base,textRuns:[{start:0,end:1,style:{strokeOpacity:0}}]});assert.equal(av.rows[0].fragments[1].x,8);
 const plain=engine.layout({...base,strokeWidth:0}),invisible=engine.layout({...base,strokeWidth:0,textRuns:[{start:3,end:4,style:{strokeOpacity:0}}]});
 assert.deepEqual(invisible.rows.map(r=>r.fragments.map(p=>[p.text,p.x,p.width])),plain.rows.map(r=>r.fragments.map(p=>[p.text,p.x,p.width])));
});

test('stroke style is paint-only, preserves contextual shaping and does not split un-stroked ligatures',()=>{
 const context={measureText(text){return {width:[...text].length*10-(text.includes('AV')?2:0)-(text.includes('fi')?1:0),fontBoundingBoxAscent:16,fontBoundingBoxDescent:4};}};
 const engine=createRichTextLayoutEngine(context);
 const base={text:'AV fi 😀\nAV fi wrapped',w:72,h:200,fontSize:20,lineHeight:1.2,strokeWidth:3,underline:true,strikethrough:true};
 const geometry=x=>x.rows.map(({start,end,nextStart,width,y,height,baseline})=>({start,end,nextStart,width,y,height,baseline}));
 for(const [start,end] of [[0,1],[3,4],[3,5],[1,6]]){
  const before=engine.layout(base),after=engine.layout({...base,textRuns:[{start,end,style:{strokeStyle:'dashed'}}]});
  assert.deepEqual(geometry(after),geometry(before));
  assert.ok(after.rows.flatMap(r=>r.fragments).some(p=>p.style.strokeStyle==='dashed'));
  assert.ok(after.rows.flatMap(r=>r.decorations).every(r=>r.fillOpacity===100));
 }
 const av=engine.layout({...base,textRuns:[{start:0,end:1,style:{strokeStyle:'dotted'}}]});assert.equal(av.rows[0].fragments[1].x,8);
 const plain=engine.layout({...base,strokeWidth:0}),invisible=engine.layout({...base,strokeWidth:0,textRuns:[{start:3,end:4,style:{strokeStyle:'dotted'}}]});
 assert.deepEqual(invisible.rows.map(r=>r.fragments.map(p=>[p.text,p.x,p.width])),plain.rows.map(r=>r.fragments.map(p=>[p.text,p.x,p.width])));
});
