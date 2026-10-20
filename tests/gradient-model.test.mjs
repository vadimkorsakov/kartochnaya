import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import { clamp } from '../src/core/primitives.mjs';
import { rgbHex, hexRgb, normalizeHex } from '../src/core/colors.mjs';

const fragment = await readFile(new URL('../src/core/gradient-model.js', import.meta.url), 'utf8');
function model() {
  return vm.runInNewContext(`(()=>{'use strict';let serial=0;const uid=()=> 'id-'+ ++serial;
    ${fragment}
    return {gradientStops,gradientGeometry,gradientSample,addGradientStop};})()`,
    { clamp, rgbHex, hexRgb, normalizeHex });
}
const plain = value => structuredClone(value);
function element() { return {gradientStops:[{id:'a',pos:0,color:'#000000',alpha:0},{id:'b',pos:100,color:'#ffffff',alpha:100}]}; }
function check(name, fn) { test(name, () => fn(model())); }
for (const input of [undefined, null, [], [{id:'old',pos:25}], 'invalid']) {
  check(`stops replaces insufficient array: ${JSON.stringify(input)}`, m => {
    const e={gradientStops:input}; const result=m.gradientStops(e);
    assert.equal(result,e.gradientStops); assert.notEqual(result,input);
    assert.deepEqual(plain(result),[{id:'id-1',pos:0,color:'#ab92fb',alpha:100},{id:'id-2',pos:100,color:'#fb8c67',alpha:100}]);
    if(Array.isArray(input)) assert.equal(input.length, input[0] ? 1 : 0);
  });
}
check('stops defaults use legacy fill fields and clamp alpha',m=>{
  const e={fill:'#ABC',fill2:'123456',fillAlpha1:-1,fillAlpha2:200};
  assert.deepEqual(plain(m.gradientStops(e)).map(s=>[s.color,s.alpha]),[['#aabbcc',0],['#123456',100]]);
});
check('stops preserves array and object references while sorting and normalizing',m=>{
  const a={id:'keep',pos:120,color:'#ABC',alpha:-4},b={pos:-2,color:'bad',alpha:101};const array=[a,b],e={gradientStops:array};
  assert.equal(m.gradientStops(e),array);assert.equal(array[0],b);assert.equal(array[1],a);
  assert.deepEqual(a,{id:'keep',pos:100,color:'#AABBCC',alpha:0});
  assert.deepEqual(b,{id:'id-1',pos:0,color:'#ffffff',alpha:100});
});
check('stops defaults missing/null fields and converts numeric strings',m=>{
  const e={gradientStops:[{}, {id:'b',pos:'25',color:'#123456',alpha:'40'}]};
  assert.deepEqual(plain(m.gradientStops(e)),[{id:'id-1',pos:0,color:'#ffffff',alpha:100},{id:'b',pos:25,color:'#123456',alpha:40}]);
});
check('stops retains NaN from invalid numbers',m=>{
  const e=element();Object.assign(e.gradientStops[0],{pos:'bad',alpha:'bad'});m.gradientStops(e);
  assert.ok(Number.isNaN(e.gradientStops[0].pos));assert.ok(Number.isNaN(e.gradientStops[0].alpha));
});
check('stops stable ties preserve input order',m=>{
  const e=element(); e.gradientStops[0].pos=100; const array=e.gradientStops;
  assert.equal(m.gradientStops(e),array);assert.deepEqual(array.map(s=>s.id),['a','b']);
});
check('stops repeat keeps references and generates no extra ids',m=>{
  const e={};const array=m.gradientStops(e),first=array[0];m.gradientStops(e);
  assert.equal(e.gradientStops,array);assert.equal(array[0],first);assert.equal(m.addGradientStop(e).id,'id-3');
});
check('stops replaces falsy ids but preserves truthy ids',m=>{
  const e=element();e.gradientStops[0].id=0;e.gradientStops[1].id=42;m.gradientStops(e);
  assert.equal(e.gradientStops[0].id,'id-1');assert.equal(e.gradientStops[1].id,42);
});
for (const [angle,a,b] of [[0,[50,25-Math.hypot(100,50)/2],[50,25+Math.hypot(100,50)/2]], [90,[50-Math.hypot(100,50)/2,25],[50+Math.hypot(100,50)/2,25]], [180,[50,25+Math.hypot(100,50)/2],[50,25-Math.hypot(100,50)/2]], [270,[50+Math.hypot(100,50)/2,25],[50-Math.hypot(100,50)/2,25]]]) {
  check(`geometry angle ${angle} writes normalized coordinates`,m=>{
    const e={w:100,h:50,gradientAngle:angle},g=m.gradientGeometry(e);
    for(const [p,expected] of [[g.a,a],[g.b,b]]) { assert.ok(Math.abs(p.x-expected[0])<1e-10);assert.ok(Math.abs(p.y-expected[1])<1e-10); }
    assert.equal(e.gradientStart.x*e.w,g.a.x);assert.equal(e.gradientEnd.y*e.h,g.b.y);
  });
}
check('geometry default angle and non-square diagonal length',m=>{
  const e={w:300,h:400},g=m.gradientGeometry(e);assert.ok(Math.abs(g.a.x+100)<1e-10);assert.ok(Math.abs(g.b.x-400)<1e-10);assert.ok(Math.abs(g.a.y-200)<1e-10);
});
check('geometry diagonal square has fixed endpoints',m=>{
  const g=m.gradientGeometry({w:100,h:100,gradientAngle:45});assert.ok(Math.abs(g.a.x)<1e-10);assert.ok(Math.abs(g.a.y)<1e-10);assert.ok(Math.abs(g.b.x-100)<1e-10);assert.ok(Math.abs(g.b.y-100)<1e-10);
});
check('geometry preserves existing coordinates and repeat references',m=>{
  const start={x:-1,y:2},end={x:3,y:4},e={w:30,h:20,gradientStart:start,gradientEnd:end};
  assert.deepEqual(plain(m.gradientGeometry(e)),{a:{x:-30,y:40},b:{x:90,y:80}});m.gradientGeometry(e);assert.equal(e.gradientStart,start);assert.equal(e.gradientEnd,end);
});
check('geometry one missing endpoint recreates both',m=>{
  const start={x:7,y:8},e={w:10,h:20,gradientStart:start};m.gradientGeometry(e);assert.notEqual(e.gradientStart,start);assert.ok(e.gradientEnd);
});
check('geometry zero dimensions writes center and returns zeros',m=>{
  const e={w:0,h:0};assert.deepEqual(plain(m.gradientGeometry(e)),{a:{x:0,y:0},b:{x:0,y:0}});assert.deepEqual(plain(e.gradientStart),{x:.5,y:.5});
});
check('geometry incomplete existing points remain incomplete',m=>{
  const e={w:10,h:20,gradientStart:{x:.2},gradientEnd:{y:.8}},g=m.gradientGeometry(e);
  assert.equal(g.a.x,2);assert.ok(Number.isNaN(g.a.y));assert.ok(Number.isNaN(g.b.x));assert.equal(g.b.y,16);assert.equal('y' in e.gradientStart,false);
});
check('geometry missing size propagates NaN',m=>{const e={w:10};const g=m.gradientGeometry(e);assert.ok(Number.isNaN(g.a.x));assert.ok(Number.isNaN(e.gradientEnd.y));});
for(const [pos,color,alpha] of [[-10,'#000000',0],[0,'#000000',0],[25,'#404040',25],[50,'#808080',50],[75,'#bfbfbf',75],[100,'#ffffff',100],[110,'#ffffff',100]]) {
  check(`sample fixed RGB and alpha at ${pos}`,m=>assert.deepEqual(plain(m.gradientSample(element(),pos)),{color,alpha}));
}
check('sample uses surrounding points among multiple stops',m=>{
  const e=element();e.gradientStops.splice(1,0,{id:'c',pos:50,color:'#ff0000',alpha:80});
  assert.deepEqual(plain(m.gradientSample(e,25)),{color:'#800000',alpha:40});assert.deepEqual(plain(m.gradientSample(e,75)),{color:'#ff8080',alpha:90});
});
check('sample tied first position returns first point',m=>{
  const e=element();e.gradientStops[1].pos=0;assert.deepEqual(plain(m.gradientSample(e,0)),{color:'#000000',alpha:0});
});
check('sample equal internal positions selects first matching segment',m=>{
  const e=element();e.gradientStops.splice(1,0,{id:'c',pos:50,color:'#ff0000',alpha:30},{id:'d',pos:50,color:'#0000ff',alpha:60});
  assert.deepEqual(plain(m.gradientSample(e,50)),{color:'#ff0000',alpha:30});
});
check('sample indirectly creates stops and sorts the original array',m=>{
  const e={};m.gradientSample(e,50);assert.equal(e.gradientStops.length,2);const array=e.gradientStops;array.reverse();m.gradientSample(e,50);assert.equal(e.gradientStops,array);assert.equal(array[0].pos,0);
});
for(const [pos,expected,color] of [[undefined,50,'#808080'],[0,0,'#000000'],[100,100,'#ffffff'],[-1,0,'#000000'],[101,100,'#ffffff'],[.4,0,'#010101'],[49.6,50,'#7e7e7e']]) {
  check(`add stop at ${pos} keeps references, samples before rounding, sorts`,m=>{
    const e=element(),array=e.gradientStops,old=[...array],s=pos===undefined?m.addGradientStop(e):m.addGradientStop(e,pos);
    assert.equal(e.gradientStops,array);assert.equal(s,array.find(x=>x.id==='id-1'));assert.equal(s.pos,expected);assert.equal(s.color,color);assert.equal(s.alpha,Math.round(pos===undefined?50:Math.max(0,Math.min(100,pos))));
    assert.ok(old.every(x=>array.includes(x)));assert.deepEqual(array.map(x=>x.pos),[...array.map(x=>x.pos)].sort((a,b)=>a-b));
  });
}
check('add initializes defaults before generating new id',m=>{
  const e={};const s=m.addGradientStop(e);assert.equal(s.id,'id-3');assert.equal(e.gradientStops[1],s);
});
check('stops null entry throws after earlier points have been normalized',m=>{
  const first={pos:'20',color:'#ABC'},e={gradientStops:[first,null]};
  assert.throws(()=>m.gradientStops(e),{name:'TypeError'});
  assert.deepEqual(first,{id:'id-1',pos:20,color:'#AABBCC',alpha:100});assert.equal(e.gradientStops[1],null);
});
check('stops null numeric fields use defaults while empty strings become zero',m=>{
  const e={gradientStops:[{pos:null,alpha:null},{pos:'',alpha:''}]};m.gradientStops(e);
  assert.equal(e.gradientStops[0].alpha,100);assert.equal(e.gradientStops[1].alpha,0);assert.ok(e.gradientStops.every(s=>s.pos===0));
});
check('geometry repeated after resize scales stored coordinates without regeneration',m=>{
  const e={w:100,h:100};m.gradientGeometry(e);const start=e.gradientStart,end=e.gradientEnd;e.w=200;e.h=50;
  const g=m.gradientGeometry(e);assert.equal(e.gradientStart,start);assert.equal(e.gradientEnd,end);assert.equal(g.a.x,start.x*200);assert.equal(g.b.y,end.y*50);
});
check('geometry one zero dimension uses denominator one',m=>{
  const e={w:0,h:100,gradientAngle:90},g=m.gradientGeometry(e);assert.equal(e.gradientStart.x,-49.5);assert.equal(e.gradientEnd.x,50.5);assert.equal(g.a.x,-0);assert.equal(g.b.x,0);
});
check('sample alpha stays fractional and add rounds it',m=>{
  const e=element();e.gradientStops[1].alpha=3;
  assert.deepEqual(plain(m.gradientSample(e,50)),{color:'#808080',alpha:1.5});assert.equal(m.addGradientStop(e,50).alpha,2);
});
check('add tied position preserves existing point order and objects',m=>{
  const e=element(),first=e.gradientStops[0],s=m.addGradientStop(e,0);assert.equal(e.gradientStops[0],first);assert.equal(e.gradientStops[1],s);
});
check('stops repeated normalization lowercases a previously expanded short uppercase HEX',m=>{
  const e=element(),array=e.gradientStops;array[0].color='#ABC';m.gradientStops(e);assert.equal(array[0].color,'#AABBCC');
  assert.equal(m.gradientStops(e),array);assert.equal(array[0].color,'#aabbcc');assert.equal(array[0].id,'a');
});
check('geometry invalid angle persists NaN coordinates instead of substituting a default',m=>{
  const e={w:100,h:50,gradientAngle:'invalid'};m.gradientGeometry(e);assert.ok(Number.isNaN(e.gradientStart.x));assert.ok(Number.isNaN(e.gradientEnd.y));
});
