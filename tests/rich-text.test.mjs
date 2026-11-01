import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { normalizeRuns, validateRuns, applyTextStyle, removeTextStyle, replaceText, updateText, clearTextFormatting, effectiveTextStyles, effectiveTextStyleAt, splitTextRuns, transformText, createTextEditHistory, editTextWithHistory } from '../src/model/rich-text.mjs';
import { remapCanvasGraph, remapDocumentGraph, selectCanvasGraph } from '../src/model/canvas-graph.mjs';
import { openDatabase, runStoreRequest } from '../src/storage/indexeddb.mjs';
import { createBackup, readBackup } from '../src/backup/archive.mjs';
const run = (start,end,style) => ({start,end,style});
const plain = () => ({id:'text',type:'text',text:'Привет 😀\nмир',fontFamily:'Arial',fontSize:24,textColor:'#000'});
const rich = () => applyTextStyle(plain(),0,6,{fontWeight:'700'});
const canonical = e => assert.equal(validateRuns(e.text,e.textRuns,e),true);

test('plain text stays sparse and unchanged; pure operations do not mutate inputs',()=>{
  const e=plain(),before=structuredClone(e);
  assert.deepEqual(normalizeRuns(e.text),[]);assert.equal(validateRuns(e.text),true);
  assert.equal(updateText(e,e.text),e);assert.equal(updateText(e,'Новый').textRuns,undefined);
  assert.deepEqual(clearTextFormatting(e),e);assert.equal(applyTextStyle(e,1,1,{bold:true}).textRuns,undefined);
  assert.deepEqual(e,before);
});
test('overrides use layer defaults; mixed selections include gaps',()=>{
  let e=rich();e=applyTextStyle(e,9,12,{fontFamily:'Serif',fontSize:40,textColor:'#f00',fontStyle:'italic'});
  assert.equal(e.text,plain().text);assert.equal(e.textRuns.length,2);
  assert.equal(effectiveTextStyleAt(e,0).fontWeight,'700');assert.equal(effectiveTextStyleAt(e,7).fontSize,24);
  assert.equal(effectiveTextStyleAt(e,10).fontSize,40);assert.equal(effectiveTextStyles(e).length,4);canonical(e);
});
test('partial overlap splits, repeated patches are idempotent, null removes a key',()=>{
  let e=applyTextStyle({text:'abcdef'},0,4,{bold:true,textColor:'red'});
  e=applyTextStyle(e,2,6,{italic:true,textColor:'blue'});
  assert.deepEqual(e.textRuns,[run(0,2,{bold:true,textColor:'red'}),run(2,4,{bold:true,italic:true,textColor:'blue'}),run(4,6,{italic:true,textColor:'blue'})]);
  assert.deepEqual(applyTextStyle(e,2,6,{italic:true,textColor:'blue'}),e);
  e=removeTextStyle(e,1,5,['textColor']);assert.equal(e.textRuns[1].style.textColor,undefined);canonical(e);
});
test('identical neighbors merge; base-equal formatting disappears; split is safe',()=>{
  const e=applyTextStyle(applyTextStyle({text:'abcd',fontSize:20},0,2,{bold:true}),2,4,{bold:true});
  assert.deepEqual(e.textRuns,[run(0,4,{bold:true})]);
  assert.deepEqual(splitTextRuns(e,2),{left:[run(0,2,{bold:true})],right:[run(2,4,{bold:true})]});
  assert.equal(applyTextStyle({text:'abc',fontSize:20},0,3,{fontSize:20}).textRuns,undefined);
  assert.equal(clearTextFormatting(e).textRuns,undefined);
});
test('insertions inherit left, or right at start; gaps and range boundaries are deterministic',()=>{
  const e={text:'abcdef',textRuns:[run(1,3,{bold:true}),run(4,6,{italic:true})]};
  assert.deepEqual(replaceText(e,2,2,'XY').textRuns,[run(1,5,{bold:true}),run(6,8,{italic:true})]);
  assert.deepEqual(replaceText(e,3,3,'!').textRuns,[run(1,4,{bold:true}),run(5,7,{italic:true})]);
  assert.deepEqual(replaceText(e,4,4,'!').textRuns,[run(1,3,{bold:true}),run(5,7,{italic:true})]);
  assert.deepEqual(replaceText({text:'ab',textRuns:[run(0,2,{bold:true})]},0,0,'!').textRuns,[run(0,3,{bold:true})]);
});
test('deletions/replacements preserve survivors, shift runs, and merge across removed gaps',()=>{
  const e={text:'aa--bb',textRuns:[run(0,2,{bold:true}),run(4,6,{bold:true})]};
  assert.deepEqual(replaceText(e,2,4).textRuns,[run(0,4,{bold:true})]);
  assert.deepEqual(replaceText(e,1,5,'X').textRuns,[run(0,3,{bold:true})]);
  assert.deepEqual(replaceText(e,0,6),{text:''});
});
test('UTF-16: surrogate boundaries expand selections, snap insertions, preserve Cyrillic/newlines/combining and ZWJ text',()=>{
  const text='Я😀е\u0301\n👩‍💻';
  let e=applyTextStyle({text},2,3,{bold:true});assert.deepEqual(e.textRuns,[run(1,3,{bold:true})]);
  assert.equal(replaceText(e,2,3).text,'Яе\u0301\n👩‍💻');
  assert.equal(replaceText(e,2,2,'!').text,'Я!😀е\u0301\n👩‍💻');
  e=updateText(e,'Я😁е\u0301\n👩‍💻');assert.equal(e.text,'Я😁е\u0301\n👩‍💻');canonical(e);
  assert.equal(updateText(e,text).text,text);assert.equal(effectiveTextStyleAt(e,2).bold,true);
});
test('invalid saved data repairs predictably, last overlapping key wins; no mutation',()=>{
  const runs=[null,{},run(-3,2,{bold:true}),run(1,99,{italic:true}),run(3,2,{bold:true}),run(.5,2,{bold:true}),run(0,NaN,{bold:true}),run(0,1,{lineHeight:2,fontSize:-1,bold:'yes'}),run(1,3,{bold:false})];
  const before=structuredClone(runs), fixed=normalizeRuns('abc',runs);
  assert.deepEqual(fixed,[run(0,1,{bold:true}),run(1,3,{bold:false,italic:true})]);
  assert.equal(validateRuns('abc',runs),false);assert.equal(validateRuns('abc',fixed),true);assert.deepEqual(runs,before);
  assert.deepEqual(normalizeRuns('abc','broken'),[]);assert.deepEqual(normalizeRuns('',runs),[]);
});
test('extensions survive and merge structurally, paragraph properties cannot become character overrides',()=>{
  const style={underline:true,underlineDetails:{color:'red',thickness:2},baselineShift:'super',fontFeatures:{liga:false},future:[1,'a']};
  const e=applyTextStyle({text:'ab'},0,2,style);assert.deepEqual(e.textRuns[0].style,style);
  assert.deepEqual(normalizeRuns('ab',[run(0,1,{fontFeatures:{a:1,b:2}}),run(1,2,{fontFeatures:{b:2,a:1}})]),[run(0,2,{fontFeatures:{a:1,b:2}})]);
  const bad=JSON.parse('{"__proto__":{"polluted":true},"constructor":1,"lineHeight":2}');
  assert.equal(applyTextStyle({text:'ab'},0,2,bad).textRuns,undefined);assert.equal({}.polluted,undefined);
  // Decoration detail uses an extension object; built-in underline is boolean.
  assert.equal(e.textRuns[0].style.baselineShift,'super');
});
test('textarea reconciliation uses selection for repeated characters and supports IME replacement',()=>{
  const e={text:'aaaa',textRuns:[run(1,3,{bold:true})]};
  assert.deepEqual(updateText(e,'aaaaa',{start:1,end:1}).textRuns,[run(2,4,{bold:true})]);
  assert.deepEqual(updateText(e,'aaaaa').textRuns,[run(1,3,{bold:true})]);
  assert.equal(updateText(rich(),'Привет мир',{start:7,end:9}).text,'Привет мир');
  for(const text of ['Привет 👍\nмир','漢字','', '😀😀', 'Привет 😀\nмир!'])canonical(updateText(rich(),text));
});
test('length-changing Unicode transforms retain each original character style',()=>{
  const e={text:'aßя',textRuns:[run(1,2,{bold:true})]};
  const next=transformText(e,c=>c.toUpperCase());assert.equal(next.text,'ASSЯ');assert.deepEqual(next.textRuns,[run(1,3,{bold:true})]);assert.equal(e.text,'aßя');
});
test('JSON, ZIP backup, IndexedDB and document/selection clones preserve sparse fields independently',async()=>{
  const element=rich(),doc={id:'d',projectId:'p',width:320,height:240,elements:[element]},data={projects:[{id:'p',name:'Rich'}],docs:[doc],fonts:[],settings:[]};
  const json=JSON.parse(JSON.stringify(doc));assert.deepEqual(json,doc);
  const restored=(await readBackup((await createBackup(data)).bytes)).data.docs[0];assert.deepEqual(restored,doc);
  const db=await openDatabase({indexedDB:new IDBFactory()});await runStoreRequest(db,'docs','readwrite',s=>s.put(doc));assert.deepEqual(await runStoreRequest(db,'docs','readonly',s=>s.get('d')),doc);db.close();
  let n=0;const gen=()=>`copy-${++n}`;
  for(const copy of [remapDocumentGraph(doc,gen),remapCanvasGraph(selectCanvasGraph(doc,['text']),gen,{selection:true})]){
    assert.deepEqual(copy.elements[0].textRuns,element.textRuns);copy.elements[0].textRuns[0].style.fontWeight='100';assert.equal(element.textRuns[0].style.fontWeight,'700');
  }
});
test('deterministic edit sequence always stays bounded, normalized and serializable',()=>{
  let e=rich();let seed=7;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed};
  for(let i=0;i<150;i++){
    const a=random()%(e.text.length+1),b=random()%(e.text.length+1),start=Math.min(a,b),end=Math.max(a,b);
    e=i%2?replaceText(e,start,end,['Я','😀','\n',''][random()%4]):applyTextStyle(e,start,end,{bold:!!(random()%2)});
    canonical(e);assert.deepEqual(JSON.parse(JSON.stringify(e)),e);
    for(const r of e.textRuns||[]){assert.ok(r.start>=0&&r.end<=e.text.length&&r.start<r.end);}
  }
});

test('actual mobile case/list commands keep legacy text output and rich ranges on round trips',async()=>{
  const {readFile}=await import('node:fs/promises'),vm=await import('node:vm');
  const source=await readFile(new URL('../src/editor.js',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('function mobileV36Format(key)'),source.indexOf('function mobileV36ApplyEffect(type)'));
  for(const formatted of [false,true]){
    const e={text:'aß я\nhello. мир ΣΟΣ',...(formatted?{textRuns:[run(1,2,{bold:true}),run(5,10,{italic:true})]}:{})};
    const raw=e.text,rawRuns=structuredClone(e.textRuns);
    const context={active:()=>e,clone:structuredClone,transformText,replaceText,
      setTextValue:(e,value)=>{const next=updateText(e,value);e.text=next.text;if(next.textRuns)e.textRuns=next.textRuns;else delete e.textRuns},
      restoreTextRuns:(e,runs)=>{if(runs===undefined)delete e.textRuns;else e.textRuns=structuredClone(runs)},mobileV36Commit(){},mobileV36Render(){}};
    vm.createContext(context);vm.runInContext(body,context);
    context.mobileV36Format('case');assert.equal(e.text,raw.toLocaleUpperCase('ru-RU'));canonical(e);
    if(formatted)assert.deepEqual(e.textRuns[0],run(1,3,{bold:true}));
    context.mobileV36Format('case');assert.equal(e.text,raw.toLocaleLowerCase('ru-RU'));canonical(e);
    if(formatted)assert.deepEqual(e.textRuns,rawRuns);
    context.mobileV36Format('case');assert.equal(e.text,raw.toLocaleLowerCase('ru-RU').replace(/(^|[.!?]\s*|\n)([а-яёa-z])/g,(_,a,b)=>a+b.toLocaleUpperCase('ru-RU')));canonical(e);
    const before=e.text,beforeRuns=structuredClone(e.textRuns);
    context.mobileV36Format('bullet');assert.equal(e.text,'• '+before.replaceAll('\n','\n• '));canonical(e);
    context.mobileV36Format('number');assert.equal(e.text,before.split('\n').map((l,i)=>`${i+1}. ${l}`).join('\n'));canonical(e);
    context.mobileV36Format('number');assert.equal(e.text,before);assert.deepEqual(e.textRuns,beforeRuns);
    if(!formatted)assert.equal(e.textRuns,undefined);
  }
});


test('native textarea undo/redo restores deleted formatting, grouped edits and branching',()=>{
  const initial=rich();let element=initial,history=createTextEditHistory(element);
  const edit=(text,inputType)=>{const next=editTextWithHistory(element,history,text,{inputType});element=next.element;history=next.history;canonical(element)};
  edit('');assert.equal(element.textRuns,undefined);
  edit(initial.text,'historyUndo');assert.deepEqual(element,initial);
  edit('','historyRedo');assert.equal(element.textRuns,undefined);
  edit(initial.text,'historyUndo');
  edit(initial.text+'a');edit(initial.text+'ab');
  edit(initial.text,'historyUndo');assert.deepEqual(element,initial);
  edit(initial.text+'ab','historyRedo');assert.equal(element.text,initial.text+'ab');
  edit(initial.text,'historyUndo');edit('Новое');assert.equal(history.states.at(-1).text,'Новое');assert.equal(history.states.some(s=>s.text===initial.text+'ab'),false);
  assert.deepEqual(initial,rich());
});

test('resizing the base to a stored run size must not discard that run during text edits',()=>{
  const e={text:'aB',fontSize:40,textRunsBaseFontSize:20,textRuns:[run(1,2,{fontSize:40})]},before=structuredClone(e);
  assert.deepEqual(normalizeRuns(e.text,e.textRuns,e),e.textRuns);
  assert.deepEqual(updateText(e,'aB!').textRuns,[run(1,3,{fontSize:40})]);
  assert.deepEqual(applyTextStyle(e,0,1,{textColor:'red'}).textRuns,[run(0,1,{textColor:'red'}),run(1,2,{fontSize:40})]);
  assert.deepEqual(e,before);
  const cleared=clearTextFormatting({...e,textLayoutMode:'legacy-top'});assert.equal(cleared.textLayoutMode,undefined);assert.equal(cleared.textRunsBaseFontSize,undefined);assert.equal(cleared.fontSize,40);
  assert.deepEqual(applyTextStyle(cleared,0,1,{fontSize:20}).textRuns,[run(0,1,{fontSize:20})]);
});

test('base-equal explicit styles and aliases keep their render priority through normalization and edits',()=>{
  const e={text:'AB',fontWeight:'400',fontStyle:'normal',textRuns:[run(0,2,{fontWeight:'400',bold:true,fontStyle:'normal',italic:true})]};
  assert.deepEqual(normalizeRuns(e.text,e.textRuns,e),e.textRuns);
  assert.deepEqual(updateText(e,'AB!').textRuns,[run(0,3,e.textRuns[0].style)]);
  const aliases={text:'AB',fontWeight:'400',bold:true,fontStyle:'normal',italic:true,textRuns:[run(0,2,{bold:true,italic:true})]};
  assert.deepEqual(normalizeRuns(aliases.text,aliases.textRuns,aliases),aliases.textRuns);
  assert.deepEqual(updateText(aliases,'AB!').textRuns,[run(0,3,{bold:true,italic:true})]);
});
