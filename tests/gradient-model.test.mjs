import test from 'node:test';
import assert from 'node:assert/strict';
import { createGradientModel } from '../src/core/gradient-model.mjs';

function model() {
  let serial = 0;
  return createGradientModel(() => 'id-' + ++serial);
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

test('factory instances keep independent injected uid sequences when interleaved', () => {
  let a = 0, b = 0;
  const first = createGradientModel(() => 'a-' + ++a);
  const second = createGradientModel(() => 'b-' + ++b);
  const x = {}, y = {};
  assert.equal(a, 0); assert.equal(b, 0);
  first.gradientStops(x); second.gradientStops(y);
  assert.equal(first.addGradientStop(x).id, 'a-3');
  assert.equal(second.addGradientStop(y).id, 'b-3');
  assert.equal(first.addGradientStop(x).id, 'a-4');
  assert.deepEqual([a, b], [4, 3]);
  assert.notEqual(first.gradientStops, second.gradientStops);
});

test('injected uid sees two initial stops generated before assignment and the new stop before push', () => {
  const e = {}, calls = [];
  const m = createGradientModel(() => {
    calls.push(e.gradientStops?.map(s => ({...s})) ?? null);
    return 'call-' + calls.length;
  });
  const stop = m.addGradientStop(e);
  assert.deepEqual(calls, [null, null, [
    {id:'call-1',pos:0,color:'#ab92fb',alpha:100},
    {id:'call-2',pos:100,color:'#fb8c67',alpha:100},
  ]]);
  assert.equal(stop.id, 'call-3');
  assert.deepEqual(e.gradientStops.map(s => s.id), ['call-1', 'call-3', 'call-2']);
});

test('factory, geometry, normalized reads and sampling do not request ids', () => {
  const m = createGradientModel(() => { throw new Error('Unexpected uid call'); });
  const e = {...element(),w:100,h:50};
  m.gradientGeometry(e); m.gradientGeometry(e);
  m.gradientStops(e); m.gradientStops(e);
  assert.deepEqual(m.gradientSample(e,25), {color:'#404040',alpha:25});
});

test('instances do not share arrays, stop objects or geometry state', () => {
  const first = model(), second = model(), x = {w:20,h:10}, y = {w:20,h:10};
  first.gradientStops(x); second.gradientStops(y);
  first.gradientGeometry(x); second.gradientGeometry(y);
  assert.notEqual(x.gradientStops, y.gradientStops);
  assert.notEqual(x.gradientStops[0], y.gradientStops[0]);
  assert.notEqual(x.gradientStart, y.gradientStart);
  x.gradientStops[0].color = '#123456'; x.gradientStart.x = 99;
  assert.equal(y.gradientStops[0].color, '#ab92fb');
  assert.notEqual(y.gradientStart.x, 99);
});

test('production imports normalize HEX, clamp values and interpolate RGB without supplied math helpers', () => {
  const m = model(), e = {fill:'#ABC',fill2:'#000000',fillAlpha1:-20,fillAlpha2:200};
  m.gradientStops(e);
  assert.deepEqual(e.gradientStops.map(s => [s.color,s.alpha]), [['#aabbcc',0],['#000000',100]]);
  assert.deepEqual(m.gradientSample(e,25), {color:'#808c99',alpha:25});
  assert.deepEqual(m.gradientSample(e,150), {color:'#000000',alpha:100});
});

// Canvas reads use the same effective defaults without normalizing stored records.
for (const input of [
  { w:100,h:50 },
  { w:100,h:50,fill:'#ABC',fill2:'#123456',fillAlpha1:-10,fillAlpha2:150,gradientStart:{x:7,y:8} },
  { w:100,h:50,gradientStops:[{pos:'100',color:'#fff',alpha:70},{pos:'0',color:'#000',alpha:20}],gradientStart:{x:0},gradientEnd:{x:1,y:.8} },
]) test('pure gradient reads preserve frozen partial input: ' + JSON.stringify(input), async () => {
  const { readGradientStops, readGradientGeometry } = await import('../src/core/gradient-model.mjs');
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  const e=freeze(structuredClone(input)),before=JSON.stringify(e);
  for(let i=0;i<10;i++) {
    const stops=readGradientStops(e),g=readGradientGeometry(e);
    assert.equal(stops.length,2);assert.ok(stops[0].pos<=stops[1].pos);
    assert.ok(stops.every(s=>s.alpha>=0&&s.alpha<=100&&!s.id));
    assert.ok([g.a.x,g.a.y,g.b.x,g.b.y].every(Number.isFinite));
    stops[0].color='#ff0000';g.a.x=200;
  }
  assert.equal(JSON.stringify(e),before);
});

test('pure gradient defaults, colors and alpha match legacy normalization without consuming IDs', async () => {
  const { readGradientStops, readGradientGeometry } = await import('../src/core/gradient-model.mjs');
  let serial=0;const m=createGradientModel(()=>`edit-${++serial}`);
  for(const input of [
    {w:100,h:50},
    {w:0,h:0,fill:'#ABC',fillAlpha1:20,fillAlpha2:80},
    {w:100,h:50,gradientAngle:45,gradientStart:{x:7,y:8}},
    {w:100,h:50,gradientStart:{x:.1,y:.3},gradientEnd:{x:.8,y:.6},gradientStops:[{pos:100,color:'#ffffff',alpha:80},{pos:0,color:'#000000',alpha:20}]},
  ]) {
    const original=structuredClone(input),stops=readGradientStops(original),g=readGradientGeometry(original);
    const before=serial;readGradientStops(original);readGradientGeometry(original);assert.equal(serial,before);
    const edited=structuredClone(input);
    assert.deepEqual(stops.map(({pos,color,alpha})=>({pos,color,alpha})),m.gradientStops(edited).map(({pos,color,alpha})=>({pos,color,alpha})));
    assert.deepEqual(g,m.gradientGeometry(edited));assert.deepEqual(original,input);
  }
  const e={w:20,h:10};for(let i=0;i<10;i++){readGradientStops(e);readGradientGeometry(e);}
  const before=serial;m.gradientStops(e);const added=m.addGradientStop(e,50);
  assert.equal(serial,before+3);assert.equal(added.id,`edit-${serial}`);
  assert.equal(new Set(e.gradientStops.map(s=>s.id)).size,3);
  assert.deepEqual(e.gradientStops.map(s=>s.pos),[0,50,100]);
});

test('pure gradient stops sort a detached array and keep existing IDs and fractional alpha', async () => {
  const { readGradientStops } = await import('../src/core/gradient-model.mjs');
  const e={gradientStops:[{id:'last',pos:150,color:'#fff',alpha:80.5},{id:'first',pos:-1,color:'#000',alpha:20.5}]};
  const before=structuredClone(e),stops=readGradientStops(e);
  assert.notEqual(stops,e.gradientStops);assert.notEqual(stops[0],e.gradientStops[1]);
  assert.deepEqual(stops,[{id:'first',pos:0,color:'#000000',alpha:20.5},{id:'last',pos:100,color:'#ffffff',alpha:80.5}]);assert.deepEqual(e,before);
});
