import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import {createBackup, readBackup} from '../src/backup/archive.mjs';
import {openDatabase, runStoreRequest} from '../src/storage/indexeddb.mjs';
import {applyParagraphListStyle as apply, clearParagraphFormatting, effectiveParagraphStyleAt, normalizeParagraphRuns,
  paragraphListDefaults, paragraphListState, paragraphRangeForSelection, projectParagraphLists} from '../src/model/paragraph-style.mjs';
import {formatListCounter, isEmojiListMarker, listMarkerGroups, listMarkerMaxLength, listMarkerPercent, validateListMarker} from '../src/model/list-presets.mjs';
import {replaceText, updateText} from '../src/model/rich-text.mjs';
import {createRichTextLayoutEngine} from '../src/render/rich-text-layout.mjs';

const range=(start,end=start)=>({start,end});
const starts=paragraphs=>paragraphs.map(p=>p.start);
const markers=layer=>projectParagraphLists(layer.text,layer.paragraphRuns).map(p=>p.marker);
const engine=createRichTextLayoutEngine({measureText(text){
 const size=Number(this.font.match(/([\d.]+)px/)[1]);
 const width=[...text].reduce((width,char)=>width+({'.':.3,I:.25,i:.25,'🔶':1.1}[char]??.5)*size,0);
 return {width,fontBoundingBoxAscent:size*.8,fontBoundingBoxDescent:size*.2};
}});

test('normalize sparse paragraph records, including CRLF and the empty terminal item',()=>{
 const text='😀\r\nß\n';
 assert.deepEqual(normalizeParagraphRuns(text,[
  null,{start:4,style:{listKind:'bogus',listGap:0,listIndent:1001,listMarker:'🔶',listStart:4}},
  {start:1,style:{listKind:'ordered'}},{start:0,style:{listKind:'bullet',listMarker:'•'}},
  {start:6,style:{listKind:'ordered',listStart:5,listCounterStyle:'bad'}},
  {start:99,style:{listKind:'bullet'}},
 ]),[{start:0,style:{listKind:'bullet'}},{start:4,style:{listMarker:'🔶',listGap:0}},
    {start:6,style:{listKind:'ordered',listStart:5}}]);
 assert.deepEqual(normalizeParagraphRuns('',[{start:0,style:{listKind:'bullet'}}]),[{start:0,style:{listKind:'bullet'}}]);
});

test('half-open selection with collapsed selections and blank paragraphs',()=>{
 const text='😀\r\n\nxy\n';
 for(const [selection,expected] of [
  [null,[0,4,5,8]],[range(1,4),[0]],[range(5,2),[0,4]],[range(4),[4]],
  [range(3),[0]],[range(6,8),[5]],[range(8),[8]],
 ])assert.deepEqual(starts(paragraphRangeForSelection(text,selection)),expected);
});

test('kind, marker and counter are independent preferences with Mixed and semantic no-op',()=>{
 const source={text:'ab\ncd\nef',textRuns:[{start:0,end:1,style:{baselineShift:'super',textCase:'upper',underline:true}}]};
 const bullet=apply(source,{listKind:'bullet',listMarker:'🔶',listGap:14},range(1,3));
 assert.deepEqual(markers(bullet),['🔶','','']);
 assert.equal(paragraphListState(bullet).listKind,'mixed');
 assert.equal(paragraphListState(bullet).listGap,'mixed');
 assert.equal(paragraphListState(bullet).listMarker,'mixed');
 assert.equal(apply(bullet,{listKind:'bullet',listMarker:'🔶'},range(0)),bullet);
 const ordered=apply(bullet,{listKind:'ordered',listCounterStyle:'decimal-paren'},range(0));
 const plain=apply(ordered,{listKind:'none'},range(0));
 assert.deepEqual(markers(plain),['','','']);
 assert.deepEqual(markers(apply(plain,{listKind:'bullet'},range(0))),['🔶','','']);
 assert.deepEqual(markers(apply(plain,{listKind:'ordered'},range(0))),['1)','','']);
 assert.equal(ordered.text,source.text);assert.equal(ordered.textRuns,source.textRuns);
 assert.deepEqual(clearParagraphFormatting(ordered),source);
});

test('list markers accept one visible extended grapheme and preserve its exact Unicode value',()=>{
 const glyphs=['•','◆','☑','➤','✔️','☑︎','💠','🔻','🦊','🔥','👍🏽','🇳🇱','🧑‍💻','👨‍👩‍👧‍👦',
  '🏳️‍🌈','#⃣','e\u0301','漢','<','"','&','🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}'];
 const source={text:'😀\nStraße',textRuns:[{start:3,end:9,style:{textCase:'upper',baselineShift:'super'}}]};
 for(const glyph of glyphs){
  assert.equal(validateListMarker(glyph),true,JSON.stringify(glyph));
  const marked=apply(source,{listKind:'bullet',listMarker:glyph},range(3));
  assert.deepEqual(markers(marked),['',glyph]);
  assert.equal(marked.text,source.text);
  assert.equal(marked.textRuns,source.textRuns);
  assert.equal(marked.paragraphRuns[0].start,3);
 }
 const overlong='👨‍'.repeat(11)+'👩';
 assert.ok(overlong.length>listMarkerMaxLength);
 const marked=apply(source,{listKind:'bullet',listMarker:'🦊'},range(3));
 for(const invalid of [undefined,null,2,{},'', ' ', '\u00a0','🔻 ', '\n','\r','\t','\u0000','\u0085',
  '\u202e➤','\u2066','\u200e','\u200b','\u200c','\u200d','\ufe0f','\u{e0100}','🏽','\u0301','\ud800','\uffff',
  'A\u{e0067}','🦊🔥','➤➤',overlong,'<svg>','<img src=x>','&lt;']){
  assert.equal(validateListMarker(invalid),false,JSON.stringify(invalid));
  assert.equal(apply(marked,{listMarker:invalid},range(3)),marked);
  assert.deepEqual(normalizeParagraphRuns(source.text,[{start:3,style:{listKind:'bullet',listMarker:invalid}}]),
   [{start:3,style:{listKind:'bullet'}}]);
 }
});

test('custom emoji Auto, text presentation, inherited ink and opacity use the shared layout',()=>{
 const base={text:'Straße one two three four five\nSecond',fontSize:30,w:180,h:360,textAlign:'justify',
  textColor:'#234567',strokeOpacity:60,fillOpacity:90,textRuns:[{start:0,end:6,style:{
   textCase:'upper',baselineShift:'sub',underline:true,underlineDetails:{style:'wavy'}}}]};
 const patch={listKind:'bullet',listMarkerScale:'auto',listMarkerColor:'#aabbcc',listMarkerOpacity:30,
  listIndent:12,listGap:9,listItemSpacing:5};
 for(const glyph of ['➤','✔','✔︎','©','⌚︎','☑︎','✍']){
  assert.equal(isEmojiListMarker(glyph),false,glyph);
  const row=engine.layoutJustified(apply(base,{...patch,listMarker:glyph})).rows[0];
  assert.equal(row.marker.style.textColor,patch.listMarkerColor);
  assert.equal(row.marker.style.fontSize,30);
 }
 for(const glyph of ['✔️','🦊','👍🏽','🇳🇱','👨‍👩‍👧‍👦','🏳️‍🌈','#⃣']){
  assert.equal(isEmojiListMarker(glyph),true,glyph);
  const layer=apply(base,{...patch,listMarker:glyph});
  const view=engine.layoutJustified(layer);
  const [first,continuation]=view.rows;
  assert.equal(first.marker.style.textColor,base.textColor);
  assert.equal(first.marker.style.fillOpacity,30);
  assert.equal(first.marker.style.strokeOpacity,18);
  assert.equal(first.marker.style.fontSize,21);
  assert.equal(first.marker.text,glyph);
  assert.equal(first.marker.columnX,12);
  assert.equal(first.x,first.marker.columnX+first.paragraph.markerColumnWidth+9);
  assert.ok(first.softWrap);
  assert.equal(first.x,continuation.x);
  assert.equal(continuation.marker,undefined);
  assert.ok(first.decorations.some(decoration=>decoration.advanced));
  assert.equal(view.caseProjection.text,base.text.replace('Straße','STRASSE'));
  assert.equal(engine.layoutJustified(apply(layer,{listMarkerScale:140})).rows[0].marker.style.fontSize,42);
 }
});

test('marker preferences are sparse, individually mixed, and retained through type changes and text edits',()=>{
 const source={text:'ab\ncd',textColor:'#123456',fillOpacity:72};
 const legacy=apply(source,{listKind:'bullet',listMarker:'🔴'});
 const options={useAutoMarkerScale:true};
 assert.equal(apply(legacy,{listKind:'bullet',listMarker:'🔴'},null,options),legacy);
 assert.equal(paragraphListState(legacy).listMarkerScale,null);
 assert.equal(listMarkerPercent(effectiveParagraphStyleAt(legacy,0)),100);
 const auto=apply(legacy,{listMarker:'🔶'},range(0),options);
 assert.equal(paragraphListState(auto).listMarkerScale,'mixed');
 assert.equal(listMarkerPercent(effectiveParagraphStyleAt(auto,0)),60);
 const newBullet=apply(source,{listKind:'bullet'},null,options);
 assert.equal(paragraphListState(newBullet).listMarkerScale,'auto');
 assert.equal(listMarkerPercent(effectiveParagraphStyleAt(newBullet,0)),100);
 const manual=apply(auto,{listMarkerScale:68,listMarkerColor:'#AA0022',listMarkerOpacity:0},range(0));
 const state=paragraphListState(manual);
 for(const key of ['listMarkerScale','listMarkerColor','listMarkerOpacity'])assert.equal(state[key],'mixed');
 const edited=replaceText(manual,1,1,'\nN');
 const changed=apply(edited,{listKind:'ordered',listCounterStyle:'decimal-paren'},range(2),options);
 const style=effectiveParagraphStyleAt(changed,2);
 assert.equal(style.listMarkerScale,68);
 assert.equal(style.listMarkerColor,'#aa0022');
 assert.equal(style.listMarkerOpacity,0);
 assert.equal(changed.textColor,source.textColor);
 assert.equal(changed.fillOpacity,source.fillOpacity);
 assert.equal(apply(changed,{listMarkerColor:'#AA0022',listMarkerOpacity:0},range(2)),changed);
 const reset=apply(changed,{listMarkerColor:'inherit',listMarkerOpacity:'inherit'},range(2));
 assert.equal(effectiveParagraphStyleAt(reset,2).listMarkerOpacity,'inherit');
 assert.deepEqual(clearParagraphFormatting(manual),source);
 for(const value of [undefined,Infinity,NaN,-1,29,201,'60','AUTO']){
  const invalid=apply(source,{listMarkerScale:value,listMarkerOpacity:101,listMarkerColor:'#123'});
  assert.equal(invalid,source);
 }
});

test('item spacing is sparse and finite, and a kind filter edits only matching paragraphs in one result',()=>{
 const text='Title\nOne\nPlain\nTwo\nFive\nEnd';
 const source={text};
 const one=text.indexOf('One'),two=text.indexOf('Two'),five=text.indexOf('Five');
 const bullet={onlyKind:'bullet'},ordered={onlyKind:'ordered'};
 const listed=apply(apply(apply(source,{listKind:'bullet'},range(one)),{listKind:'bullet',listItemSpacing:19.5},range(two)),
  {listKind:'ordered',listItemSpacing:26},range(five));
 assert.equal(paragraphListDefaults.listItemSpacing,0);
 assert.equal(effectiveParagraphStyleAt(listed,one).listItemSpacing,0);
 assert.equal(paragraphListState(listed,null,bullet).listItemSpacing,'mixed');
 assert.equal(paragraphListState(listed,null,ordered).listItemSpacing,26);
 assert.equal(paragraphListState(listed,range(0),bullet),null);
 assert.equal(apply(listed,{listItemSpacing:5},range(0),bullet),listed);
 for(const listItemSpacing of [0,undefined,Infinity,-Infinity,NaN,-.5,1000.01,'20']){
  assert.equal(apply(listed,{listItemSpacing},range(one)),listed);
 }
 const changed=apply(listed,{listItemSpacing:1000,listGap:17},range(text.length,1),bullet);
 assert.deepEqual(changed.paragraphRuns,[
  {start:one,style:{listKind:'bullet',listGap:17,listItemSpacing:1000}},
  {start:two,style:{listKind:'bullet',listGap:17,listItemSpacing:1000}},
  listed.paragraphRuns[2],
 ]);
 assert.equal(changed.text,text);
 assert.equal(apply(changed,{listItemSpacing:1000,listGap:17},null,bullet),changed);
 const restart=apply(apply(changed,{listKind:'ordered'},range(one)),{listStart:9},null,ordered);
 assert.deepEqual(projectParagraphLists(text,restart.paragraphRuns).map(p=>p.marker),['','9.','','•','9.','']);
 const split=replaceText(changed,one+1,one+1,'\n');
 assert.equal(effectiveParagraphStyleAt(split,one+2).listItemSpacing,1000);
 assert.deepEqual(replaceText(split,one+1,one+2,''),changed);
 assert.deepEqual(clearParagraphFormatting(changed),source);
});

test('marker scale changes layout while independent paint keeps marker and caret geometry',()=>{
 const base={text:'Long list item wraps on a narrow frame\nBeta',fontSize:30,w:155,h:350,fillOpacity:78,
  textColor:'#193754',strokeOpacity:50,strokeWidth:1};
 const legacy=apply(base,{listKind:'bullet',listMarker:'🔴'});
 const auto=apply(legacy,{listMarkerScale:'auto'});
 const manual=apply(legacy,{listMarkerScale:170});
 const oldMarker=engine.layout(legacy).rows[0].marker,autoMarker=engine.layout(auto).rows[0].marker;
 assert.equal(oldMarker.style.fontSize,30);
 assert.equal(autoMarker.style.fontSize,18);
 assert.ok(autoMarker.width<oldMarker.width);
 assert.equal(engine.layout(manual).rows[0].marker.style.fontSize,51);
 const emoji=apply(auto,{listMarkerColor:'#cc0000',listMarkerOpacity:0});
 const paintedEmoji=engine.layout(emoji).rows[0].marker;
 assert.equal(paintedEmoji.style.textColor,base.textColor);
 assert.equal(paintedEmoji.style.fillOpacity,0);
 assert.equal(paintedEmoji.style.strokeOpacity,0);
 const number=apply(base,{listKind:'ordered',listStart:9,listMarkerScale:135});
 const red=apply(number,{listMarkerColor:'#cc0000',listMarkerOpacity:0},range(0));
 const before=engine.layout(number),after=engine.layout(red);
 const rows=layout=>layout.rows.map(({x,y,start,end,marker,fragments})=>({x,y,start,end,marker:marker&&{
  text:marker.text,x:marker.x,y:marker.y,width:marker.width,columnX:marker.columnX,
 },fragments}));
 assert.deepEqual(rows(after),rows(before));
 assert.equal(after.inkOverflow,before.inkOverflow);
 assert.equal(after.rows[0].marker.style.textColor,'#cc0000');
 assert.equal(after.rows[0].fragments[0].style.textColor,base.textColor);
 const ten=after.rows.find(row=>row.marker?.text==='10.');
 assert.ok(ten.marker.width>after.rows[0].marker.width);
 assert.equal(ten.x,after.rows[0].x);
 assert.equal(engine.layout({...red,fillType:'gradient'}).rows[0].marker.style.fillOpacity,78);
});

test('counter formats, compatible runs, manual restart, and renumber after source replacement',()=>{
 assert.ok(listMarkerGroups.flatMap(group=>group.markers).length>=20);
 for(const [n,style,marker] of [[9,'decimal-dot','9.'],[10,'decimal-paren','10)'],[3,'decimal-padded-dot','03.'],
  [26,'latin-lower-dot','z.'],[27,'latin-upper-dot','AA.'],[18,'roman-lower-dot','xviii.'],[19,'roman-upper-dot','XIX.'],
  [4000,'roman-upper-dot','4000.']])assert.equal(formatListCounter(n,style),marker);
 const ordered=apply({text:'A\nB\nC\nD'},{listKind:'ordered',listStart:5});
 assert.deepEqual(markers(ordered),['5.','6.','7.','8.']);
 const split=replaceText(ordered,1,1,'\nN');
 assert.deepEqual(markers(split),['5.','6.','7.','8.','9.']);
 assert.equal(effectiveParagraphStyleAt(split,2).listStart,null);
 assert.deepEqual(replaceText(split,2,4),ordered);
 const three=apply(ordered,{listKind:'none'},range(2));
 const roman=apply(three,{listCounterStyle:'roman-lower-dot',listStart:18},range(4));
 assert.deepEqual(markers(roman),['5.','','xviii.','1.']);
 assert.deepEqual(markers(updateText(roman,'B\nC\nD',range(0,2))),['','xviii.','1.']);
 assert.deepEqual(markers(replaceText(ordered,1,2,'')),['5.','6.','7.']);
});

test('wide ordered columns, hanging indents, alignment, justify, fit metrics and T1/T2/T3 share layout',()=>{
 const text=['Straße one two three four five',...Array(11).fill('x')].join('\n');
 const layer=apply({text,w:125,h:500,fontSize:20,textColor:'#223344',strokeWidth:2,fillOpacity:72,
  textRuns:[{start:0,end:6,style:{textCase:'upper',fontSize:22,baselineShift:'super',underline:true,
   underlineDetails:{style:'wavy'},textColor:'#aa0011'}}]},{listKind:'ordered',listGap:9,listIndent:4});
 for(const textAlign of ['left','center','right','justify']){
  const e={...layer,textAlign,verticalAlign:'bottom'};
  const view=textAlign==='justify'?engine.layoutJustified(e):engine.layout(e);
  const first=view.rows[0],last=view.rows.at(-1);
  assert.ok(first.softWrap);
  assert.equal(first.marker.text,'1.');assert.equal(last.marker.text,'12.');
  assert.equal(first.x,last.x);
  for(const row of view.rows.slice(0,first.paragraph.lastRow+1))assert.equal(row.x,first.x);
  assert.equal(first.marker.columnX+first.paragraph.markerColumnWidth+9,first.x);
  assert.ok(first.marker.width<last.marker.width);
  assert.equal(first.marker.style.textColor,'#223344');assert.equal(first.marker.style.strokeWidth,2);
  assert.equal(first.marker.style.fillOpacity,72);assert.equal(first.marker.style.baselineShift,'normal');
  assert.equal(first.marker.y,first.baseline);assert.equal(first.fragments[0].text,'STRASSE');
  assert.ok(first.fragments[0].y<first.baseline);assert.ok(first.decorations.some(d=>d.advanced));
  assert.equal(view.caseProjection.text,text.replace('Straße','STRASSE'));
  assert.ok(first.y>0);
  if(textAlign==='justify'){
   assert.ok(view.rows.some(r=>r.justification.extraPerSpace>0));
   assert.ok(view.rows.every(r=>!r.marker||!r.justification.spaces.includes(r.start)));
  }
 }
 const bullet=apply({text:'one',w:150,h:100,fontSize:20},{listKind:'bullet'});
 const defaultBullet=engine.layout(bullet),wide=engine.layout(apply(bullet,{listMarker:'🔶'}));
 assert.equal(defaultBullet.rows.length,1);
 assert.ok(wide.rows[0].x>defaultBullet.rows[0].x);
 assert.ok(wide.width>defaultBullet.width);
 assert.ok(engine.layout({...layer,fontSize:10}).height<engine.layout(layer).height);
 assert.equal(engine.layout({...bullet,textMode:'vertical'}).rows[0].marker,undefined);
});

test('JSON, ZIP and IndexedDB v3 keep formatted records, canonical text and legacy fields',async()=>{
 const before={id:'layer',type:'text',text:'• Keep 😀\nCurrent!',mobileList:'bullet',
  mobileListRawText:'Stale',mobileListRawTextRuns:[{start:0,end:1,style:{bold:true}}],
  textRuns:[{start:7,end:9,style:{baselineShift:'sub',textCase:'upper',underline:true}}]};
 const after=apply(before,{listKind:'bullet',listMarker:'🟠',listMarkerScale:'auto',
  listMarkerColor:'#2676ba',listMarkerOpacity:0,listItemSpacing:35.5},range(10));
 assert.deepEqual({...after,paragraphRuns:undefined},{...before,paragraphRuns:undefined});
 assert.deepEqual(markers(before),['','']);
 const doc={id:'doc',projectId:'project',width:300,height:200,elements:[after]};
 const serialized=JSON.parse(JSON.stringify(doc));
 const archive=await createBackup({docs:[serialized],projects:[{id:'project'}],fonts:[],settings:[]});
 const {data}=await readBackup(archive.bytes);
 const db=await openDatabase({indexedDB:new IDBFactory()});
 try{
  await runStoreRequest(db,'docs','readwrite',store=>store.put(data.docs[0]));
  assert.deepEqual(await runStoreRequest(db,'docs','readonly',store=>store.get('doc')),doc);
 }finally{db.close();}
});
