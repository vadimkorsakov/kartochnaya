import test from 'node:test';
import assert from 'node:assert/strict';
import {applyTextStyle,normalizeRuns,replaceText} from '../src/model/rich-text.mjs';
import {resolveRichTextStyle,richTextSpans,createRichTextLayoutEngine} from '../src/render/rich-text-layout.mjs';
import {createInlineHistory,recordInlineHistory,moveInlineHistory} from '../src/model/inline-text-history.mjs';
import {textDecorationRects} from '../src/render/text-decorations.mjs';
const base={text:'А😀Б\nПривет мир',fontSize:20,fontFamily:'Arial',w:70,h:200};
const engine=createRichTextLayoutEngine({measureText(text){return {width:[...text].length*12-(text.match(/AV/g)||[]).length*3,fontBoundingBoxAscent:16,fontBoundingBoxDescent:4}}});
test('legacy inheritance, explicit false and canonical layer precedence survive normalization and edits',()=>{
 for(const [key,legacy] of [['underline','mobileUnderline'],['strikethrough','mobileStrike']]){
  const source={...base,[legacy]:true};
  assert.equal(resolveRichTextStyle(source)[key],true);
  assert.equal(resolveRichTextStyle({...source,[key]:false})[key],false);
  const off=applyTextStyle(source,1,2,{[key]:false});
  assert.deepEqual(off.textRuns,[{start:1,end:3,style:{[key]:false}}]);
  assert.deepEqual(normalizeRuns(off.text,off.textRuns,off),off.textRuns);
  assert.equal(richTextSpans(off)[1].style[key],false);
  assert.equal(replaceText(off,1,3,'X').textRuns[0].style[key],false);
  const on=applyTextStyle(off,1,3,{[key]:true});assert.equal(on.textRuns,undefined);
  assert.equal(on[legacy],true);assert.equal(source.textRuns,undefined);
 }
});
test('overlapping U/S, removing only U, JSON and session Undo/Redo use existing booleans',()=>{
 const history=createInlineHistory(base);
 const u=applyTextStyle(base,1,10,{underline:true});recordInlineHistory(history,u,{start:1,end:10,direction:'backward'});
 const both=applyTextStyle(u,3,7,{strikethrough:true});recordInlineHistory(history,both);
 const strike=applyTextStyle(both,1,10,{underline:false});recordInlineHistory(history,strike);
 assert.ok(richTextSpans(strike).every(p=>!p.style.underline));
 assert.equal(richTextSpans(strike).find(p=>p.start===3).style.strikethrough,true);
 assert.deepEqual(JSON.parse(JSON.stringify(both)),both);
 assert.deepEqual(moveInlineHistory(history,-1).element,both);
 assert.deepEqual(moveInlineHistory(history,-1).element,u);
 assert.deepEqual(moveInlineHistory(history,1).element,both);
});
test('decoration-only splits preserve glyph painting, ligatures, kerning, row metrics and wraps exactly',()=>{
 for(const text of ['AVATAR AVATAR','Привет 😀 мир\n\nЕщё слова\n','office ffi AV']){
  const source={...base,text};const plain=engine.layout(source);
  let styled=applyTextStyle(source,1,text.length-1,{underline:true});styled=applyTextStyle(styled,3,8,{strikethrough:true});
  const decorated=engine.layout(styled);
  const geometry=layout=>layout.rows.map(({decorations,fragments,...row})=>({...row,fragments:fragments.map(({style,...p})=>({...p,style:Object.fromEntries(Object.entries(style).filter(([k])=>!['underline','strikethrough'].includes(k)))}))}));
  assert.deepEqual(geometry(decorated),geometry(plain));
  assert.ok(decorated.rows.some(r=>r.decorations.length));
  for(const row of decorated.rows)for(const rect of row.decorations){assert.ok(rect.start>=row.start&&rect.end<=row.end);assert.ok(rect.width>0);assert.ok(!text.slice(rect.start,rect.end).includes('\n'));}
 }
});
test('rectangles follow range color, size and alphabetic baseline, never details extensions',()=>{
 assert.deepEqual(textDecorationRects({x:10,y:40,width:50},{fontSize:38,textColor:'#cc2244',underline:true,strikethrough:true,underlineDetails:{color:'blue',thickness:99}}),[
  {kind:'underline',x:10,y:42.8,width:50,height:2,color:'#cc2244'},
  {kind:'strikethrough',x:10,y:27.22,width:50,height:2,color:'#cc2244'},
 ]);
 const e={...base,textRuns:[{start:1,end:3,style:{underline:true,fontSize:38,textColor:'#cc2244'}}]};
 const rows=engine.layout(e).rows,rect=rows.flatMap(r=>r.decorations)[0];
 assert.equal(rect.color,'#cc2244');assert.equal(rect.height,2);assert.equal(rect.start,1);assert.equal(rect.end,3);
});

test('combining and ZWJ clusters retain the same first-character ownership for glyphs and lines',()=>{
 const source={...base,text:'X👩‍💻Y'};
 assert.equal(engine.layout(applyTextStyle(source,3,4,{underline:true})).rows.flatMap(r=>r.decorations).length,0);
 const rects=engine.layout(applyTextStyle(source,1,3,{underline:true})).rows.flatMap(r=>r.decorations);
 assert.equal(rects.length,1);assert.equal(rects[0].start,1);assert.equal(rects[0].end,6);
});

test('IndexedDB v3 and backup JSON retain both booleans, false overrides, legacy fields and details',async()=>{
 const {IDBFactory}=await import('fake-indexeddb');
 const {openDatabase,runStoreRequest}=await import('../src/storage/indexeddb.mjs');
 const {createBackup,readBackup}=await import('../src/backup/archive.mjs');
 const e={...base,id:'text',mobileUnderline:true,mobileStrike:true,textRuns:[{start:1,end:3,style:{underline:false,strikethrough:true,underlineDetails:{color:'blue'}}}]};
 const doc={id:'d',projectId:'p',width:320,height:240,elements:[e]},data={projects:[{id:'p',name:'Decorations'}],docs:[doc],fonts:[],settings:[]};
 const restored=(await readBackup((await createBackup(data)).bytes)).data.docs[0];assert.deepEqual(restored,doc);
 const db=await openDatabase({indexedDB:new IDBFactory()});assert.equal(db.version,3);
 try{await runStoreRequest(db,'docs','readwrite',s=>s.put(doc));assert.deepEqual(await runStoreRequest(db,'docs','readonly',s=>s.get('d')),doc)}finally{db.close()}
});
