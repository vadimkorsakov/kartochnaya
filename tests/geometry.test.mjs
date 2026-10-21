import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as geometry from '../src/core/geometry.mjs';

const { toLocal, boundsOf, handleCoords, gradientLocalPoint, gradientDocPoint } = geometry;
const element = (overrides = {}) => ({ x:10, y:20, w:80, h:40, rotation:0, ...overrides });
// Absolute 1e-10 px tolerance is only for independently expected irrational values
// and trigonometric residue at cardinal angles. Historical comparisons are exact.
function near(actual, expected) {
  assert.deepEqual(Object.keys(actual), Object.keys(expected));
  for (const key of Object.keys(expected)) assert.ok(Math.abs(actual[key]-expected[key]) < 1e-10,
    `${key}: ${actual[key]} versus ${expected[key]}`);
}

for (const [label, e, p, expected] of [
  ['zero/offset/non-square', element(), {x:30,y:30}, {x:20,y:10}],
  ['90 degrees', element({rotation:90}), {x:50,y:60}, {x:60,y:20}],
  ['180 degrees', element({rotation:180}), {x:70,y:50}, {x:20,y:10}],
  ['270 degrees', element({rotation:270}), {x:50,y:20}, {x:60,y:20}],
  ['45 degrees', element({rotation:45}), {x:50+10*Math.SQRT2,y:40+10*Math.SQRT2}, {x:60,y:20}],
  ['negative angle', element({rotation:-90}), {x:50,y:20}, {x:60,y:20}],
  ['over 360', element({rotation:450}), {x:50,y:60}, {x:60,y:20}],
  ['document origin', element({x:0,y:0}), {x:5,y:7}, {x:5,y:7}],
  ['rotated center', element({rotation:37}), {x:50,y:40}, {x:40,y:20}],
  ['boundary', element(), {x:90,y:60}, {x:80,y:40}],
  ['outside', element(), {x:-10,y:80}, {x:-20,y:60}],
  ['fractional', element({x:.25,y:-.5,w:2.5,h:1.5}), {x:1,y:.25}, {x:.75,y:.75}],
  ['zero size', element({w:0,h:0,rotation:90}), {x:10,y:25}, {x:5,y:0}],
  ['negative size', element({w:-80,h:-40}), {x:0,y:0}, {x:-10,y:-20}],
]) test('toLocal: '+label, () => near(toLocal(e,p),expected));

for (const [label, e, expected] of [
  ['unrotated horizontal', element(), {x:10,y:20,right:90,bottom:60}],
  ['square', element({w:40,h:40}), {x:10,y:20,right:50,bottom:60}],
  ['vertical', element({w:20,h:80}), {x:10,y:20,right:30,bottom:100}],
  ['90 degrees', element({rotation:90}), {x:30,y:0,right:70,bottom:80}],
  ['45 degree square', element({w:40,h:40,rotation:45}), {x:30-20*Math.SQRT2,y:40-20*Math.SQRT2,right:30+20*Math.SQRT2,bottom:40+20*Math.SQRT2}],
  ['30 degree rectangle', element({rotation:30}), {x:40-20*Math.sqrt(3),y:20-10*Math.sqrt(3),right:60+20*Math.sqrt(3),bottom:60+10*Math.sqrt(3)}],
  ['negative coordinates', element({x:-100,y:-50}), {x:-100,y:-50,right:-20,bottom:-10}],
  ['fractions', element({x:.25,y:-.5,w:2.5,h:1.5}), {x:.25,y:-.5,right:2.75,bottom:1}],
  ['negative sizes', element({w:-80,h:-40}), {x:-70,y:-20,right:10,bottom:20}],
  ['zero sizes', element({w:0,h:0,rotation:45}), {x:10,y:20,right:10,bottom:20}],
  ['zero width rotated', element({w:0,h:40,rotation:90}), {x:-10,y:40,right:30,bottom:40}],
]) test('boundsOf: '+label, () => near(boundsOf(e), expected));

for (const [label, e, expected] of [
  ['horizontal/order', element(), [['nw',0,0],['n',40,0],['ne',80,0],['e',80,20],['se',80,40],['s',40,40],['sw',0,40],['w',0,20]]],
  ['vertical', element({w:20,h:80}), [['nw',0,0],['n',10,0],['ne',20,0],['e',20,40],['se',20,80],['s',10,80],['sw',0,80],['w',0,40]]],
  ['fractions', element({w:.5,h:1.5}), [['nw',0,0],['n',.25,0],['ne',.5,0],['e',.5,.75],['se',.5,1.5],['s',.25,1.5],['sw',0,1.5],['w',0,.75]]],
  ['zero', element({w:0,h:0}), [['nw',0,0],['n',0,0],['ne',0,0],['e',0,0],['se',0,0],['s',0,0],['sw',0,0],['w',0,0]]],
  ['negative', element({w:-20,h:-10}), [['nw',0,0],['n',-10,0],['ne',-20,0],['e',-20,-5],['se',-20,-10],['s',-10,-10],['sw',0,-10],['w',0,-5]]],
  ['position and rotation ignored', {w:2,h:4,x:NaN,y:Infinity,rotation:45}, [['nw',0,0],['n',1,0],['ne',2,0],['e',2,2],['se',2,4],['s',1,4],['sw',0,4],['w',0,2]]],
]) test('handleCoords: '+label, () => {
  const actual = handleCoords(e);
  assert.equal(actual.length,8);
  assert.ok(actual.every(row=>Array.isArray(row) && row.length===3));
  assert.deepEqual(actual,expected);
});

for (const [label, e, p, expected] of [
  ['zero/offset', element(), {x:30,y:30}, {x:20,y:10}],
  ['45 degrees', element({rotation:45}), {x:50+10*Math.SQRT2,y:40+10*Math.SQRT2}, {x:60,y:20}],
  ['90 degrees', element({rotation:90}), {x:50,y:60}, {x:60,y:20}],
  ['negative angle', element({rotation:-90}), {x:50,y:20}, {x:60,y:20}],
  ['center', element({rotation:73}), {x:50,y:40}, {x:40,y:20}],
  ['edge', element(), {x:10,y:60}, {x:0,y:40}],
  ['arbitrary outside', element(), {x:-7,y:111}, {x:-17,y:91}],
  ['non-square rotated edge', element({rotation:90}), {x:70,y:80}, {x:80,y:0}],
  ['fractions', element({x:.25,y:-.5,w:2.5,h:1.5}), {x:1,y:.25}, {x:.75,y:.75}],
]) test('gradientLocalPoint: '+label, () => near(gradientLocalPoint(e,p),expected));

for (const [label, e, p, expected] of [
  ['zero/offset', element(), {x:20,y:10}, {x:30,y:30}],
  ['45 degrees', element({rotation:45}), {x:60,y:20}, {x:50+10*Math.SQRT2,y:40+10*Math.SQRT2}],
  ['90 degrees', element({rotation:90}), {x:60,y:20}, {x:50,y:60}],
  ['180 degrees', element({rotation:180}), {x:20,y:10}, {x:70,y:50}],
  ['negative angle', element({rotation:-90}), {x:60,y:20}, {x:50,y:20}],
  ['non-square edge', element({rotation:90}), {x:80,y:0}, {x:70,y:80}],
  ['fractions', element({x:.25,y:-.5,w:2.5,h:1.5}), {x:.75,y:.75}, {x:1,y:.25}],
]) test('gradientDocPoint: '+label, () => near(gradientDocPoint(e,p),expected));

test('gradient transforms: round trips in both directions at multiple angles', () => {
  for (const rotation of [0,45,90,180,270,-37,450]) {
    const e=element({rotation,x:-.25,y:10.125,w:81.5,h:39.75});
    for (const p of [{x:0,y:0},{x:19.25,y:-7.125},{x:400,y:301}]) {
      near(gradientLocalPoint(e,gradientDocPoint(e,p)),p);
      near(gradientDocPoint(e,gradientLocalPoint(e,p)),p);
    }
  }
});

for (const [name, fn] of Object.entries(geometry)) test(name+': immutable inputs, independent fresh results and unusual values', () => {
  const e=Object.freeze(element({rotation:37,extra:Object.freeze({keep:true})}));
  const p=Object.freeze({x:12.25,y:-1.5});
  const before=structuredClone([e,p]);
  const first=fn(e,p), second=fn(e,p);
  assert.deepEqual(first,second);
  assert.notEqual(first,second);
  if (Array.isArray(first)) {
    for (let i=0;i<8;i++) assert.notEqual(first[i],second[i]);
    first[0][1]=999;
  } else first.x=999;
  fn(element({x:-100,rotation:-91}),{x:-500,y:22});
  assert.deepEqual(fn(e,p),second);
  assert.deepEqual([e,p],before);
  if (name!=='handleCoords') {
    for (const rotation of [undefined,null,NaN,false,'',0]) assert.deepEqual(fn(element({rotation}),p),fn(element(),p));
    const missing=fn({},{});
    assert.deepEqual(Object.keys(missing),name==='boundsOf'?['x','y','right','bottom']:['x','y']);
    assert.ok(Object.values(missing).every(Number.isNaN));
    assert.ok(Object.values(fn(element({rotation:Infinity}),p)).every(Number.isNaN));
  } else {
    assert.deepEqual(fn({}).map(row=>row[0]),['nw','n','ne','e','se','s','sw','w']);
    assert.equal(fn({})[2][1],undefined);
    assert.ok(Number.isNaN(fn({})[1][1]));
  }
  assert.throws(()=>fn(null,p),TypeError);
  if (!['handleCoords','boundsOf'].includes(name)) assert.throws(()=>fn(e,null),TypeError);
});

// Compile the real historical declarations, never a hand-written old formula.
// The historical file itself is guarded by the immutable 19-file manifest test.
const historicalHTML=await readFile(new URL('../kartochnaya v0.45/index.html',import.meta.url),'utf8');
const historical={};
for (const name of Object.keys(geometry)) {
  const declarations=[...historicalHTML.matchAll(new RegExp('^function '+name+'\\([^\\n]*','gm'))];
  assert.equal(declarations.length,1,name);
  historical[name]=vm.runInNewContext('('+declarations[0][0]+')',Object.create(null));
}
function observation(fn,args) {
  const copy=structuredClone(args);
  try { return {result:structuredClone(fn(...copy)),after:copy}; }
  catch (error) { return {error:{name:error.name,message:error.message},after:copy}; }
}
for (const [name, fn] of Object.entries(geometry)) test(name+': exact historical differential including special values and exceptions', () => {
  let cases=0, exceptions=0;
  function compare(args) {
    const original=observation(historical[name],args);
    assert.deepEqual(observation(fn,args),original,`${name} case ${cases++}`);
    if (original.error) exceptions++;
  }
  for (const rotation of [undefined,0,45,90,180,270,-45,450,37.125,NaN,Infinity,'90',false])
    for (const [w,h] of [[80,40],[0,0],[-80,40],[80,-40],[.125,19.75]])
      for (const [x,y] of [[0,0],[10,-20],[-.125,.375],[1e15,-1e15]])
        for (const p of [{x:0,y:0},{x:50,y:40},{x:-100,y:300},{x:.125,y:-.375},{x:Infinity,y:NaN}])
          compare([{x,y,w,h,rotation},p]);
  for (const e of [null,undefined,{}, {x:NaN,y:Infinity,w:-0,h:0},
    {x:'10',y:'20',w:'80',h:'40',rotation:'45'}, {x:1n,y:0,w:2,h:3},
    {x:0,y:0,w:Infinity,h:-Infinity,rotation:90}])
      for (const p of [undefined,null,{}, {x:NaN,y:-Infinity},{x:1n,y:0}]) compare([e,p]);
  assert.equal(cases,1335);
  assert.ok(exceptions>0,'Native exceptions were compared too');
});

test('geometry is a standalone leaf without DOM, app, global bridges or initialization calls', async () => {
  const code=await readFile(new URL('../src/core/geometry.mjs',import.meta.url),'utf8');
  assert.deepEqual(Object.keys(geometry).sort(),['toLocal','boundsOf','handleCoords','gradientLocalPoint','gradientDocPoint'].sort());
  assert.doesNotMatch(code,/\b(?:import|app|document|window|globalThis|Canvas|indexedDB)\b/);
  const declarations=code.replaceAll('export function','function');
  const sandbox=Object.create(null);
  for (const key of ['app','document','window','indexedDB']) Object.defineProperty(sandbox,key,{get(){throw new Error('Forbidden '+key);}});
  vm.runInNewContext(declarations,sandbox);
  for (const name of Object.keys(geometry)) assert.deepEqual(observation(sandbox[name],[element(),{x:30,y:40}]),observation(geometry[name],[element(),{x:30,y:40}]));
});
