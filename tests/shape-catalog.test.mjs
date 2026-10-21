import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateShapeCatalog as validate } from '../src/core/shape-catalog.mjs';

const shape = (overrides = {}) => ({ id: 'a', d: 'M0 0L10 10Z', ...overrides });
const catalog = (...shapes) => [{ name: 'Group', shapes }];
const one = overrides => validate(catalog(shape(overrides)))[0].shapes[0];
const bad = (input, message) => assert.throws(() => validate(input), { name: 'Error', message });
const contourError = id => 'Некорректный контур: ' + id;

test('empty catalog', () => assert.deepEqual(validate([]), []));
test('minimal category and default shape name', () => assert.deepEqual(validate(catalog(shape())), [{name:'Group',shapes:[{id:'a',name:'Фигура',d:'M0 0L10 10Z'}]}]));
test('category and shape order', () => assert.deepEqual(validate([{name:'B',shapes:[shape({id:'z'}),shape({id:'b'})]},{name:'A',shapes:[shape({id:'c'})]}]).map(g=>[g.name,g.shapes.map(s=>s.id)]), [['B',['z','b']],['A',['c']]]));
for (const [label, input] of [['null',null],['object',{}],['string','[]'],['undefined',undefined]]) test('reject top level '+label, () => bad(input,'Некорректный каталог фигур'));
test('300 categories accepted', () => assert.equal(validate(Array.from({length:300},()=>({name:'G'}))).length,300));
test('301 categories rejected before category errors', () => bad(Array(301).fill(null),'Некорректный каталог фигур'));
for (const name of ['', '  ', undefined, 0]) test('empty category '+String(name), () => bad([{name}],'Группа без названия'));
test('category trimming then truncation and coercion', () => assert.deepEqual(validate([{name:' '+ 'x'.repeat(101)+' '},{name:12}]).map(g=>g.name),['x'.repeat(100),'12']));
test('duplicate normalized category names accepted', () => assert.deepEqual(validate([{name:' G '},{name:'G'}]),[{name:'G',shapes:[]},{name:'G',shapes:[]}]));
test('missing/non-array shapes become empty', () => { for(const shapes of [undefined,null,{},'bad']) assert.deepEqual(validate([{name:'G',shapes}]),[{name:'G',shapes:[]}]); });
test('1500 shapes retained and invalid tail ignored', () => { const shapes=Array.from({length:1500},(_,i)=>shape({id:String(i)})); shapes.push(null); assert.equal(validate(catalog(...shapes))[0].shapes.length,1500); });
for (const id of [undefined,'',0,false,null]) test('missing/falsy id '+String(id), () => bad(catalog(shape({id})),contourError('')));
test('non-string IDs and paths use String', () => assert.deepEqual(one({id:42,d:123}),{id:'42',name:'Фигура',d:'123'}));
test('ID whitespace is retained', () => assert.equal(one({id:'  '}).id,'  '));
test('long id truncated before output', () => assert.equal(one({id:'a'.repeat(101)}).id,'a'.repeat(100)));
test('duplicates within a category', () => bad(catalog(shape(),shape()),contourError('a')));
test('duplicates across categories after coercion', () => bad([{name:'A',shapes:[shape({id:42})]},{name:'B',shapes:[shape({id:'42'})]}],contourError('42')));
test('uniqueness uses truncated ID', () => bad(catalog(shape({id:'x'.repeat(100)+'a'}),shape({id:'x'.repeat(100)+'b'})),contourError('x'.repeat(100))));
for (const [label,d] of [
 ['commands','MmZzLlHhVvCcSsQqTtAa'],['sequential','M0 0L1 1Z'],['fractions','M.5 1.25L0.001 4'],['negative','M-1 -2L-3 -4'],['exponents','M1e-3 2E+4'],['whitespace',' \t\n0,1 +2 -3 '],['not a parser','eE.,+-'],['whitespace only','   '],
]) test('path accepts '+label, () => assert.equal(one({d}).d,d));
for (const d of ['',undefined,'M0 0X1','M0 0<','Infinity','M0\u00a01R']) test('path rejects '+String(d), () => bad(catalog(shape({d})),contourError('a')));
test('main path truncates at 160000 before character validation', () => assert.equal(one({d:'M'.repeat(160000)+'<'}).d,'M'.repeat(160000)));
test('name default uses falsiness, coerces and truncates without trim', () => { for(const name of [null,undefined,'',0,false]) assert.equal(one({name}).name,'Фигура'); assert.equal(one({name:42}).name,'42'); assert.equal(one({name:' x '}).name,' x '); assert.equal(one({name:'x'.repeat(101)}).name,'x'.repeat(100)); });
test('optional strings absent for falsy values', () => { for(const value of ['',0,false,null,undefined]) { const out=one({mode:value,lineStyle:value,capStart:value,capEnd:value}); assert.deepEqual(Object.keys(out),['id','name','d']); } });
test('optional strings coerced/truncated in fixed key order', () => { const out=one({capEnd:42,capStart:true,lineStyle:'x'.repeat(21),mode:' arbitrary '}); assert.deepEqual(out,{id:'a',name:'Фигура',d:'M0 0L10 10Z',mode:' arbitrary ',lineStyle:'x'.repeat(20),capStart:'true',capEnd:'42'}); assert.deepEqual(Object.keys(out),['id','name','d','mode','lineStyle','capStart','capEnd']); });
test('outlineCaps excludes null/undefined but Boolean-coerces other values', () => { for(const value of [null,undefined]) assert.equal(Object.hasOwn(one({outlineCaps:value}),'outlineCaps'),false); for(const [value,expected] of [[false,false],[0,false],['',false],['false',true],[[],true],[{},true]]) assert.equal(one({outlineCaps:value}).outlineCaps,expected); });
test('unknown properties discarded at all levels', () => assert.deepEqual(validate([{name:'G',extra:1,shapes:[shape({extra:2,parts:[{d:'M0 0',extra:3}]})]}]),[{name:'G',shapes:[{id:'a',name:'Фигура',d:'M0 0L10 10Z',parts:[{d:'M0 0',matrix:[1,0,0,1,0,0]}]}]}]));
test('non-array parts omitted; empty array retained', () => { for(const parts of [undefined,null,{},'bad']) assert.equal(Object.hasOwn(one({parts}),'parts'),false); assert.deepEqual(one({parts:[]}).parts,[]); });
test('parts preserve order, paths, default matrices and observable key order', () => {
  const result = validate(catalog(shape({parts:[{d:'M1 2'},{d:'M3 4',matrix:{}}]})));
  assert.deepEqual(result[0].shapes[0].parts,[{d:'M1 2',matrix:[1,0,0,1,0,0]},{d:'M3 4',matrix:[1,0,0,1,0,0]}]);
  assert.deepEqual(Object.keys(result[0]), ['name','shapes']);
  assert.deepEqual(Object.keys(result[0].shapes[0]), ['id','name','d','parts']);
  assert.deepEqual(Object.keys(result[0].shapes[0].parts[0]), ['d','matrix']);
});
test('500 parts retained and invalid tail ignored', () => assert.equal(one({parts:[...Array.from({length:500},()=>({d:'M0 0'})),null]}).parts.length,500));
for(const d of ['',undefined,'M0<','M'.repeat(160001)]) test('invalid part path '+String(d).slice(0,24), () => bad(catalog(shape({parts:[{d}]})),'Неверный SVG path'));
test('part path length boundary accepted', () => assert.equal(one({parts:[{d:'M'.repeat(160000)}]}).parts[0].d.length,160000));
test('part path coercion', () => assert.equal(one({parts:[{d:12}]}).parts[0].d,'12'));
test('six matrix components Number-coerce without rounding', () => assert.deepEqual(one({parts:[{d:'M0',matrix:['1','0',null,true,'2.123456789','-3']}]}).parts[0].matrix,[1,0,0,1,2.123456789,-3]));
test('matrix absolute boundary inclusive', () => assert.deepEqual(one({parts:[{d:'M0',matrix:[1e7,-1e7,0,1,0,0]}]}).parts[0].matrix,[1e7,-1e7,0,1,0,0]));
for(const [label,matrix] of [['empty',[]],['short',[1,0,0,1,0]],['long',[1,0,0,1,0,0,0]],['NaN',[1,0,NaN,1,0,0]],['Infinity',[1,0,Infinity,1,0,0]],['-Infinity',[1,0,-Infinity,1,0,0]],['too large',[1e7+1,0,0,1,0,0]],['too negative',[-1e7-1,0,0,1,0,0]],['non-number',['bad',0,0,1,0,0]]]) test('matrix rejects '+label, () => bad(catalog(shape({parts:[{d:'M0',matrix}]})),'Неверное SVG преобразование'));
test('part path error precedes matrix error', () => bad(catalog(shape({parts:[{d:'<',matrix:[]}]})),'Неверный SVG path'));
test('shape error precedes part error', () => bad(catalog(shape({id:'',parts:[null]})),contourError('')));
test('null category, shape and part retain native TypeError', () => { for(const input of [[null],[{name:'G',shapes:[null]}],catalog(shape({parts:[null]}))]) assert.throws(()=>validate(input),TypeError); });
test('input stays unchanged; calls return fresh independent nested objects', async () => { const input=JSON.parse(await readFile(new URL('./fixtures/shape-catalog-input.json',import.meta.url))); const before=structuredClone(input); const first=validate(input); const second=validate(input); assert.deepEqual(input,before); assert.deepEqual(first,second); assert.notEqual(first[0].shapes[1].parts[0].matrix,input[0].shapes[1].parts[0].matrix); first[0].shapes[1].parts[0].matrix[0]=99; assert.deepEqual(validate(input),second); });
test('synthetic JSON matches independently captured stage 7 output', async () => { const read=name=>readFile(new URL('./fixtures/shape-catalog-'+name+'.json',import.meta.url),'utf8').then(JSON.parse); assert.deepEqual(validate(await read('input')),await read('expected')); });
