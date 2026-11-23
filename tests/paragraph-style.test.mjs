import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import {createBackup, readBackup} from '../src/backup/archive.mjs';
import {openDatabase, runStoreRequest} from '../src/storage/indexeddb.mjs';
import {applyParagraphListStyle as apply, clearParagraphFormatting, effectiveParagraphStyleAt, normalizeParagraphRuns,
  paragraphListState, paragraphRangeForSelection, projectParagraphLists} from '../src/model/paragraph-style.mjs';
import {formatListCounter, listMarkerGroups} from '../src/model/list-presets.mjs';
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
 const after=apply(before,{listKind:'bullet',listMarker:'🟠'},range(10));
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
