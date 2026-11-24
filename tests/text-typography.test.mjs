import test from 'node:test';
import assert from 'node:assert/strict';
import {projectText} from '../src/model/text-projection.mjs';
import {sourceToDisplay, displayToSource, textGraphemes} from '../src/model/text-case.mjs';
import {cleanImportedTypography, normalizeTypography, nbspDefaults, protectedTypographySpans, typographyDefaults} from '../src/model/text-typography.mjs';
import {analyzeProject, prepareProjectImport} from '../src/model/project-integrity.mjs';
import {createRichTextLayoutEngine} from '../src/render/rich-text-layout.mjs';
import {createBackup, readBackup} from '../src/backup/archive.mjs';

const flags = (keys, enabled) => Object.fromEntries(Object.keys(keys).map(key => [key, enabled.includes(key)]));
const config = (keys = Object.keys(typographyDefaults), groups = Object.keys(nbspDefaults)) =>
  normalizeTypography({enabled:true,rules:flags(typographyDefaults,keys),nbspRules:flags(nbspDefaults,groups)});
const project = (source, keys, groups) => projectText(source, [], config(keys, groups)).text;
const nbsp = '\u00a0';

const fixtures = {
  quotes:[['"слово" и “текст”','«слово» и «текст»'],['"Версия 2" и 5"', '«Версия 2» и 5"'],['„стиль“'],['--path="abc 1/2" и "/tmp/текст"'],['"открыто\r\nи закрыто" 5" и «правильно»'],['"«смысл»"', '««смысл»»']],
  nestedQuotes:[['«Он сказал "да"»','«Он сказал „да“»'],['"Фраза “да”"', '"Фраза „да“"'],['«Первый „второй “третий” уровень“»']],
  emDash:[['слово -- слово - слово','слово — слово — слово'],['2020 - 2025; -5 -- -1; 20,5 - 22,5; 2020-2025; ISO-9001; интернет-магазин; --help']],
  minus:[['-25 °C; (-5); +5; x = -8','−25 °C; (−5); +5; x = −8'],['10 - 5; -2020-2025; CLI --n=-15; --n -5; --range="x -5"; vals[-1]; 2026-01-20; 8 800-555-35-35']],
  multiply:[['1080 x 1920; 1080 х 1920; 3 * 4','1080 × 1920; 1080 × 1920; 3 × 4'],['3*4; A x B; 0xFF; v2.0 x 4; 3 x 4K; 3 x 4.2.1']],
  marks:[['(C) (r), (TM).','© ®, ™.'],['x(c) (r)abc; fn(c); name@(tm).com; https://host.test/(c); `(tm)`']],
  fractions:[
    ['1/2, 1/3, 2/3, 1/4, 3/4, 1/5, 2/5, 3/5, 4/5, 1/6, 5/6, 1/7, 1/8, 3/8, 5/8, 7/8, 1/9, 1/10.',
     '½, ⅓, ⅔, ¼, ¾, ⅕, ⅖, ⅗, ⅘, ⅙, ⅚, ⅐, ⅛, ⅜, ⅝, ⅞, ⅑, ⅒.'],
    ['0/3; (7/12), «13/27»; 125/256; 24/11; 11/2; 01/002; 0/2.',
     '↉; (⁷⁄₁₂), «¹³⁄₂₇»; ¹²⁵⁄₂₅₆; ²⁴⁄₁₁; ¹¹⁄₂; ⁰¹⁄₀₀₂; ⁰⁄₂.'],
    ['1/2/2026; 2026/2/1; /tmp/1/2; https://a.test/7/12; user/7/12; 7/12.txt; 1/2a; abc7/12; 1/2.3; 3/4/5; 7/0; 1/000'],
    ['раздел 1/2; §\u00a07/12; №7/12; 1\u202f1/2; 1 1/2; ID: 7/12; `7/12`; e\u03017/12; 7/12\u0301'],
    ['2 x 7/12; 2 х\u00a07/12; 3 / 7/12; 1/2 + 3/4; 1/2 = x; 2 × (7/12); (7/12) - 5'],
    ...[...'+-−±∓×*÷/=≠<>≤≥'].flatMap(sign => ['', ' ', '\u00a0', '\u202f'].map(gap => [sign+gap+'7/12'])),
  ],
  nbsp:[['в доме 20 кг','в\u00a0доме 20\u00a0кг'],['в  доме; в\tдоме; в\r\nдоме; в\u202fдоме']],
  timeColon:[
    ['9.30', '9:30'], ['09.05; на 23.59 и (0.00). «3.14» 00.59…', '09:05; на 23:59 и (0:00). «3:14» 00:59…'],
    ['09.00–18.00; 9.30 - 17.45; 0.00-2.15; 12.05\u00a0–\u202f18.50', '09:00–18:00; 9:30 - 17:45; 0:00-2:15; 12:05\u00a0–\u202f18:50'],
    ['24.00; 25.30; 12.60; 9.5; 12:30; 129.30; 9.301; 09.00 – 24.00; 29.00 – 17.45; 24.11.2026; v2.15; 1.2.3; 12.34.56.78'],
    ['é9.30; ９.30; 9.30é; 9.30\u0301; 9.30..22; 12:09.30; 9.30:41; -9.30; +\u00a09.30; − 9.30'],
    ['12.30 кг; 12.30\u00a0м²; 5.25 ₽; 5.25\u202f%; 7.33°С; 12.30 kg; 5.25 EUR; $ 5.25; USD 5.25; 09.00–18.00 V'],
    ['https://site.test/9.30-17.45; example.test/09.00–18.00; 9.30.test; mail9.30@example.org; C:\\tmp\\9.30; ../9.30; /9.30; file/9.30'],
    ['`9.30 - 17.45`; ```\n9.30–17.45\n```; fn(9.30-17.45); ID: 9.30; sku: 9.30–17.45; № 9.30; foo_09.00-18.00; --value=09.00–18.00'],
  ],
};
for (const [rule, cases] of Object.entries(fixtures)) test(rule, () => {
  for (const [source, expected = source] of cases) {
    assert.equal(project(source, [rule]), expected);
    assert.equal(project(source, []), source);
    assert.equal(project(expected, [rule]), expected);
  }
});

const groups = {
  shortWords:['в доме', 'в\u00a0доме'],
  particles:['сделал бы', 'сделал\u00a0бы'],
  units:['-25 °C, 20 %, 7 ₽, 5 кг.', '-25\u00a0°C, 20\u00a0%, 7\u00a0₽, 5\u00a0кг.'],
  initials:['А. С. Пушкин', 'А.\u00a0С.\u00a0Пушкин'],
  dates:['24 ноября; 2026 г.; т. д.', '24\u00a0ноября; 2026\u00a0г.; т.\u00a0д.'],
  designations:['§ 3 и № 4, ул. Мира', '§\u00a03 и №\u00a04, ул.\u00a0Мира'],
  dash:['слово — здесь', 'слово\u00a0— здесь'],
};
for (const [group, [source, expected]] of Object.entries(groups)) test(`NBSP ${group} is independent`, () => {
  assert.equal(project(source, ['nbsp'], [group]), expected);
  assert.equal(project(source, ['nbsp'], Object.keys(groups).filter(key => key !== group)), source);
  assert.equal(project(expected, ['nbsp'], [group]), expected);
});

test('combinations are idempotent and preserve deliberate whitespace and protected source', () => {
  const source = '"Он сказал “да”" -- -25 °C; 1080 х 1920; (tm); 1/2; в и на до дома.\r\n👩‍💻 e\u0301\tв  доме\n`"нет" -5 1/2 (r) 10 кг`';
  const visible = '«Он сказал „да“»\u00a0— −25\u00a0°C; 1080 × 1920; ™; ½; в\u00a0и\u00a0на до\u00a0дома.\r\n👩‍💻 e\u0301\tв  доме\n`"нет" -5 1/2 (r) 10 кг`';
  assert.equal(project(source), visible);
  assert.equal(project(visible), visible);
  assert.equal(project('www.example.org/(tm) a-b@example.org 2026/11/24 C:\\tmp\\1/2 ../1/4'), 'www.example.org/(tm) a-b@example.org 2026/11/24 C:\\tmp\\1/2 ../1/4');
  assert.equal(project('«Сказал “да”»', ['quotes']), '«Сказал “да”»');
  const range = '09.00 - 18.00';
  assert.deepEqual(protectedTypographySpans(range), [{start:0,end:range.length}]);
  assert.equal(project(range, ['emDash','nbsp']), range);
  assert.equal(project(range), '09:00 - 18:00');
});

test('normalized configuration is sparse at layer level, boolean-only and deterministic', () => {
  for (const input of [undefined,null,[],{},'on',{enabled:'yes'},{enabled:true,rules:[]},
    {enabled:true,rules:{quotes:1}},{enabled:true,rules:{timeColon:1}},{enabled:true,nbspRules:{units:'off'}}])
    assert.equal(normalizeTypography(input), undefined);
  const normalized = normalizeTypography({enabled:false,rules:{nestedQuotes:false,unknown:true},nbspRules:{unknown:true}});
  assert.deepEqual(normalized, {enabled:false,rules:{...typographyDefaults,nestedQuotes:false},nbspRules:{...nbspDefaults}});
  assert.deepEqual(projectText('"да" -5 (tm)',[],normalized), {text:'"да" -5 (tm)',intervals:null});
  assert.deepEqual(normalizeTypography({enabled:true}).rules, typographyDefaults);
});

test('old eight-rule settings do not opt into time display', () => {
  const legacy = {enabled:true,rules:{quotes:true,nestedQuotes:true,emDash:true,minus:true,multiply:true,marks:true,fractions:true,nbsp:true}};
  const normalized = normalizeTypography(legacy);
  assert.deepEqual(normalized.rules, {...legacy.rules,timeColon:false});
  assert.equal(projectText('7/12 в 09.05', [], normalized).text, '⁷⁄₁₂ в 09.05');
  assert.equal(normalizeTypography({enabled:true}).rules.timeColon, false);
});

test('contiguous monotonic UTF-16 coverage with contractions, expansion, CRLF and emoji', () => {
  const source = '1/2ß (tm) 👩‍💻 e\u0301\r\n--';
  const typed = projectText(source, [{end:source.length,textCase:'upper'}], config(['marks','fractions']));
  // A source fraction attached to text is protected. Use a separate adjacent
  // punctuation-delimited contraction and an expansion with no shared spaces.
  assert.equal(typed.text, '1/2SS ™ 👩‍💻 E\u0301\r\n--');
  const mixed = '(tm)ß 1/2 👩‍💻 e\u0301\r\n--';
  const projection = projectText(mixed,[{end:mixed.length,textCase:'upper'}],config());
  // Marks immediately adjacent to a word are excluded by the token rule.
  assert.equal(projection.text, '(TM)SS ½ 👩‍💻 E\u0301\r\n--');
  const adjacent = projectText('ß-- ß', [{end:5,textCase:'upper'}], config(['emDash']));
  assert.equal(adjacent.text, 'SS-- SS');
  const sample = 'ß (tm) 1/2 👩‍💻 e\u0301\r\nß';
  const view = projectText(sample,[{end:sample.length,textCase:'upper'}],config());
  const boundaries = new Set(Array.from(textGraphemes.segment(sample), x=>x.index).concat(sample.length));
  let end = 0, displayEnd = 0;
  for (const interval of view.intervals) {
    assert.equal(interval.sourceStart,end);
    assert.equal(interval.displayStart,displayEnd);
    assert.ok(interval.sourceEnd>end && interval.displayEnd>displayEnd);
    assert.ok(boundaries.has(end) && boundaries.has(interval.sourceEnd));
    assert.equal(view.text.slice(displayEnd,interval.displayEnd),interval.projectedText);
    assert.equal(displayToSource(view,sourceToDisplay(view,end)),end);
    for (let i = end+1; i<interval.sourceEnd; i++) {
      assert.equal(sourceToDisplay(view,i),displayEnd);
      assert.equal(sourceToDisplay(view,i,true),interval.displayEnd);
    }
    for (let i = displayEnd+1; i<interval.displayEnd; i++) {
      assert.equal(displayToSource(view,i),end);
      assert.equal(displayToSource(view,i,true),interval.sourceEnd);
    }
    end = interval.sourceEnd;
    displayEnd = interval.displayEnd;
  }
  assert.equal(end,sample.length);
  assert.equal(displayEnd,view.text.length);
  assert.equal(view.text,'SS ™ ½ 👩‍💻 E\u0301\r\nSS');
});

test('do not consume incompatible run boundaries or partial graphemes', () => {
  const source='½\r\n1/2 (tm) e\u0301';
  assert.equal(projectText(source, [], config(), [5,9]).text,source);
  assert.equal(projectText('(tm)\u0301', [], config()).text,'(tm)\u0301');
  assert.equal(projectText('1/2 -- word',[],config(),[1]).text,'1/2\u00a0— word');
  assert.equal(projectText('7/12 9.30',[],config(),[2,6,7]).text,'7/12 9:30');
});

test('equal-length fraction is atomic and time preserves each source boundary', () => {
  const view = projectText('7/12; 9.30', [], config());
  assert.equal(view.text, '⁷⁄₁₂; 9:30');
  assert.deepEqual(view.intervals[0], {
    sourceStart:0,sourceEnd:4,displayStart:0,displayEnd:4,projectedText:'⁷⁄₁₂',atomic:true,
  });
  for (const offset of [1,2,3]) for (const map of [sourceToDisplay,displayToSource]) {
    assert.equal(map(view,offset), 0);
    assert.equal(map(view,offset,true), 4);
  }
  for (let offset=4; offset<=view.text.length; offset++) {
    assert.equal(sourceToDisplay(view,offset), offset);
    assert.equal(displayToSource(view,offset), offset);
  }
});

const engine = createRichTextLayoutEngine({measureText(text) {
  const size = Number(this.font.match(/([\d.]+)px/)[1]);
  return {width:Array.from(text).length*size/2,fontBoundingBoxAscent:size*.8,fontBoundingBoxDescent:size*.2};
}});
const rowText = row => row.fragments.map(part=>part.text).join('');
test('layout wraps glued intervals as a unit in fixed and auto sizes, justifies ordinary spaces only', () => {
  const text='раз два 10 кг далее строка\nв доме';
  const layer={w:61,h:260,fontSize:20,text,typography:config(),textAlign:'justify'};
  for (const autoFontSize of [false,true]) {
    const view=engine.layoutJustified({...layer,autoFontSize});
    assert.ok(view.rows.some(row=>rowText(row).includes('10'+nbsp+'кг')));
    assert.ok(view.rows.some(row=>rowText(row)==='в'+nbsp+'доме'));
    for (const row of view.rows) {
      if (row.hiddenSeparator) assert.match(text.slice(row.hiddenSeparator.start,row.hiddenSeparator.end),/^ +$/u);
      for (const offset of row.justification.spaces) assert.notEqual(view.caseProjection.text[offset],nbsp);
    }
  }
  assert.ok(engine.layout({...layer,w:20}).rows.some(row=>rowText(row)==='10'+nbsp+'кг'));
  const fixed={...layer,text:'в доме',w:40,h:100};
  assert.equal(engine.fitFontSize(fixed,20),13.3);
  assert.ok(engine.layout({...fixed,typography:undefined}).rows.length>1);
  const auto={...fixed,autoFontSize:true,textAlign:'left'};
  assert.equal(engine.displaySample(auto).fontSize,13.3);
  const restored={...auto,typography:{...auto.typography,enabled:false}};
  assert.equal(engine.displaySample(restored).fontSize,20);
  assert.equal(auto.fontSize,20);
});

test('shared fragments preserve completed source intervals in mixed style and justify', () => {
  const text='ß (tm) 1/2 в городе\nвторая строка';
  const style={color:'#fff',underline:true,baselineShift:'super',strokeWidth:1};
  const layer={text,textCase:'upper',w:90,h:300,fontSize:20,typography:config(),autoFontSize:true,textAlign:'justify',
    textRuns:[{start:2,end:6,style},{start:8,end:10,style}],
    paragraphRuns:[{start:0,style:{listKind:'bullet',listMarker:'◆'}}]};
  const before=structuredClone(layer);
  const view=engine.layoutJustified(layer);
  assert.equal(view.caseProjection.text,'SS ™ 1/2 В\u00a0ГОРОДЕ\nВТОРАЯ СТРОКА');
  assert.equal(view.rows[0].marker.text,'◆');
  assert.ok(view.rows.flatMap(row=>row.carets).every(caret=>caret.offset!==3 && caret.offset!==4 && caret.offset!==5));
  assert.deepEqual(layer,before);
  assert.equal(engine.layout({...layer,textMode:'vertical'}).caseProjection,undefined);
});

test('oversized fractions wrap intact and expose only edge carets at fixed size and auto-fit', () => {
  const text = 'до 125/256 после';
  const layer = {text,w:45,h:160,fontSize:20,typography:config(),textAlign:'justify'};
  for (const autoFontSize of [false,true]) {
    const view = engine.layoutJustified({...layer,autoFontSize});
    assert.ok(view.rows.some(row=>rowText(row).includes('¹²⁵⁄₂₅₆')));
    assert.ok(view.rows.flatMap(row=>row.carets).every(({offset})=>offset<=3 || offset>=10));
  }
});

test('JSON import and ZIP preserve source and valid settings, invalid configs stay inactive', async () => {
  const canonical={id:'layer',type:'text',text:'"да" 7/12; 9.30',textRuns:[{start:0,end:4,style:{underline:true}}],typography:config()};
  const malformed={...canonical,id:'bad',typography:{enabled:true,rules:{quotes:'true'}}};
  const malformedTime={...canonical,id:'bad-time',typography:{enabled:true,rules:{timeColon:'true'}}};
  const legacy=structuredClone({...canonical,id:'old'});
  delete legacy.typography.rules.timeColon;
  const document={id:'doc',projectId:'p',width:320,height:240,elements:[canonical,malformed,legacy,malformedTime]};
  const project={id:'p',name:'T5'};
  const data={docs:[document],projects:[project],fonts:[],settings:[]};
  const restored=await readBackup((await createBackup(data)).bytes);
  assert.deepEqual(restored.data.docs,[document]);
  assert.ok(restored.warnings.some(w=>w.includes('invalid-typography')));
  assert.ok(analyzeProject(project,[document]).warnings.some(w=>w.code==='invalid-typography'));
  const plan=prepareProjectImport([{project,documents:[document]}],{generateId:(()=>{let i=0;return()=>String(++i)})(),now:1});
  assert.deepEqual(plan.documents[0].elements[0],canonical);
  assert.equal(plan.documents[0].elements[1].typography,undefined);
  assert.equal(plan.documents[0].elements[1].text,canonical.text);
  assert.equal(plan.documents[0].elements[2].typography.rules.timeColon,false);
  assert.equal(plan.documents[0].elements[2].text,canonical.text);
  assert.equal(plan.documents[0].elements[3].typography,undefined);
  const copy={elements:[],slides:[{elements:[structuredClone(malformed)]}]};
  assert.equal(cleanImportedTypography(copy),1);
  assert.equal(copy.slides[0].elements[0].typography,undefined);
});

test('long mixed source retains complete projection and reuse across layout sizes', () => {
  const text='Слово -- (tm) 1/2 и 10 кг Straße 👩‍💻\r\n'.repeat(500);
  const e={text,textCase:'upper',w:520,h:10000,fontSize:20,typography:config()};
  const first=engine.layout(e).caseProjection;
  const second=engine.layout({...e,fontSize:18}).caseProjection;
  assert.equal(first,second);
  assert.equal(first.intervals.at(-1).sourceEnd,text.length);
  assert.equal((first.text.match(/™/gu)||[]).length,500);
});
