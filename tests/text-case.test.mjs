import test from 'node:test';
import assert from 'node:assert/strict';
import {projectTextCase, sourceToDisplay, displayToSource} from '../src/model/text-case.mjs';
import {richTextSpans} from '../src/render/rich-text-layout.mjs';

const project = (text, mode) => projectTextCase(text, [{end:text.length,textCase:mode}]);
test('five case modes retain punctuation, source whitespace and Unicode normalization',()=>{
 const text='пРИмер ТЕКСТА. второе предложение!\n  hELLO wORLD\r\nе\u0308ж';
 for(const [mode,expected] of Object.entries({
  original:text, upper:'ПРИМЕР ТЕКСТА. ВТОРОЕ ПРЕДЛОЖЕНИЕ!\n  HELLO WORLD\r\nЕ\u0308Ж',
  lower:'пример текста. второе предложение!\n  hello world\r\nе\u0308ж',
  title:'Пример Текста. Второе Предложение!\n  Hello World\r\nЕ\u0308ж',
  sentence:'Пример текста. Второе предложение!\n  Hello world\r\nЕ\u0308ж',
 }))assert.equal(project(text,mode).text,expected);
 assert.deepEqual(project(text,'original'),{text,intervals:null});
 assert.deepEqual(project('ABC','upper'),{text:'ABC',intervals:null});
 assert.equal(project('«42дВА» (ÉCOLE) дОБРО-пОЖАЛОВАТЬ don’T, O\'NEIL, ёЖ','title').text,
  '«42Два» (École) Добро-Пожаловать Don’t, O\'neil, Ёж');
});

test('sentence boundaries cover quotes, marker prefixes, RU/EN abbreviations, decimals and hard lines',()=>{
 const text='  «привет. как дела?!» (отлично…) 2. потом 3.14. ещё.\r\n• но это, т. е. тест, т. д. и т. п. дальше!\nв г. москва; А. С. пушкин. dr. wHO!\n… «4) еЩЁ».';
 assert.equal(project(text,'sentence').text,
  '  «Привет. Как дела?!» (Отлично…) 2. Потом 3.14. Ещё.\r\n• Но это, т. е. тест, т. д. и т. п. дальше!\nВ г. москва; а. с. пушкин. Dr. who!\n… «4) Ещё».');
 assert.equal(project('Пример. второе предложение. привет... как дела? отлично!','sentence').text,
  'Пример. Второе предложение. Привет... Как дела? Отлично!');
});

test('word, sentence and sigma context come from the entire source across run and display boundaries',()=>{
 const text='пРИМЕР ТЕКСТА. вТОРОЕ ΣΟΣ';
 const layer={text,textCase:'original',textRuns:[
  {start:2,end:13,style:{textCase:'title'}},
  {start:4,end:5,style:{textColor:'#12aabc'}},
  {start:16,end:text.length,style:{textCase:'sentence'}},
  {start:text.length-2,end:text.length-1,style:{textCase:'original'}},
 ]};
 assert.equal(projectTextCase(text,richTextSpans(layer)).text,'пРимер Текста. второе σΟς');
 assert.equal(project('ΟΣ ΟΣΑ ΟΣ\u0301. ΟΣ','lower').text,'ος οσα ος\u0301. ος');
});

test('length-changing Unicode projection owns all derived UTF-16 positions by source grapheme',()=>{
 const text='ßİﬃ🏳️‍🌈e\u0301Σ';
 const projection=projectTextCase(text,[
  {end:1,textCase:'upper'},{end:2,textCase:'lower'},{end:text.length,textCase:'upper'},
 ]);
 assert.equal(projection.text,'SSi\u0307FFI🏳️‍🌈E\u0301Σ');
 for(const [i,p] of projection.intervals.entries()){
  assert.equal(sourceToDisplay(projection,p.sourceStart),p.displayStart);
  assert.equal(sourceToDisplay(projection,p.sourceEnd),p.displayEnd);
  assert.equal(displayToSource(projection,p.displayStart),p.sourceStart);
  assert.equal(displayToSource(projection,p.displayEnd),p.sourceEnd);
  assert.equal(projection.text.slice(p.displayStart,p.displayEnd),p.projectedText);
  assert.equal(p.sourceStart,projection.intervals[i-1]?.sourceEnd??0);
  for(let j=p.displayStart+1;j<p.displayEnd;j++){
   assert.equal(displayToSource(projection,j),p.sourceStart);
   assert.equal(displayToSource(projection,j,true),p.sourceEnd);
  }
 }
 assert.equal(projection.intervals.length,6);
 assert.deepEqual(projection.intervals[0],{sourceStart:0,sourceEnd:1,displayStart:0,displayEnd:2,projectedText:'SS'});
});
