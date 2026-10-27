import test from 'node:test';
import assert from 'node:assert/strict';
import { planLayerGroup } from '../src/model/group-plan.mjs';

const layer = (id, extra = {}) => ({ id, x: 10, y: 20, rotation: 30, ...extra });
const doc = (elements, groups = []) => ({ elements, groups });
const plan = (d, els, groups = []) => planLayerGroup(d, els, groups, 'new');
const ids = p => p.elements.map(e => e.id);

test('all selections move stably to the uppermost selected position, without mutation', () => {
  const d = doc('ABCDEFG'.split('').map(id => layer(id))), original = structuredClone(d);
  for (let mask = 1; mask < 128; mask++) {
    const selected = d.elements.filter((_, i) => mask & 1 << i).map(e => e.id);
    if (selected.length < 2) continue;
    const result = plan(d, selected), top = d.elements.findLastIndex(e => selected.includes(e.id));
    const remaining = d.elements.filter(e => !selected.includes(e.id));
    const at = d.elements.slice(0, top + 1).filter(e => !selected.includes(e.id)).length;
    const expected = remaining.map(e => e.id); expected.splice(at, 0, ...selected);
    assert.deepEqual(ids(result), expected);
    assert.equal(new Set(result.elements).size, d.elements.length);
    result.elements.forEach(e => assert.equal(e, d.elements.find(x => x.id === e.id)));
  }
  assert.deepEqual(d, original);
  assert.deepEqual(ids(plan(d, ['B','C'])), 'ABCDEFG'.split(''));
});

test('nested roots are deduplicated; selected folder contents stay contiguous', () => {
  const groups = [{id:'parent'}, {id:'one',parentId:'parent'}, {id:'inner',parentId:'one'}, {id:'two',parentId:'parent'}];
  const d = doc([layer('A',{groupId:'inner'}),layer('B',{groupId:'one'}),layer('gap',{groupId:'parent'}),layer('C',{groupId:'two'})],groups);
  const p = plan(d, ['A','B','C'], ['one','inner','two']);
  assert.deepEqual(ids(p), ['gap','A','B','C']);
  assert.deepEqual(p.roots.map(g => g.id), ['one','two']);
  assert.deepEqual(p.leaves, []); assert.equal(p.parentId,'parent');
});

for (const explicit of [false,true]) test(`whole clipping chain retains base and optional clipBaseId=${explicit}`, () => {
  const d = doc([layer('A'),layer('clip',{clipped:true,...(explicit?{clipBaseId:'A'}:{})}),layer('gap'),layer('C')]);
  assert.deepEqual(ids(plan(d,['A','clip','C'])), ['gap','A','clip','C']);
  for (const selected of [['A','C'],['clip','C']]) {
    const before = structuredClone(d);
    assert.throws(() => plan(d,selected), /обтравочную/); assert.deepEqual(d,before);
  }
});

test('unselected chains may remain outside; regrouping may not capture or heal them', () => {
  const d = doc([layer('A'),layer('base'),layer('clip',{clipped:true,clipBaseId:'base'}),layer('C')]);
  assert.deepEqual(ids(plan(d,['A','C'])), ['base','clip','A','C']);
  assert.deepEqual(ids(plan(doc([layer('orphan',{clipped:true}),layer('base'),layer('C')]),['orphan','C'])), ['base','orphan','C']);
});

test('clipping inside nested folders, masks and boundary links are untouched', () => {
  const d = doc([layer('A',{groupId:'inner',layerMaskSrc:'mask',custom:{keep:true}}),layer('text',{groupId:'inner',clipped:true,clipBaseId:'A',pathBoundary:{sourceId:'A'}}),layer('gap'),layer('C')],[{id:'outer',collapsed:true,visible:false,locked:true},{id:'inner',parentId:'outer'}]);
  const original = structuredClone(d), p = plan(d,['C'],['outer']);
  assert.deepEqual(ids(p),['gap','A','text','C']); assert.equal(p.elements[1],d.elements[0]); assert.deepEqual(d,original);
});

test('effect regions cannot be crossed; unaffected regions retain their backdrop', () => {
  assert.throws(() => plan(doc([layer('A'),layer('FX',{isFxRegion:true}),layer('C')]), ['A','C']), /эффекта/);
  const d = doc([layer('FX',{isFxRegion:true}),layer('A'),layer('gap'),layer('C')]);
  assert.deepEqual(ids(plan(d,['A','C'])), ['FX','gap','A','C']);
});

test('invalid parents, cycles, split folders and duplicate IDs reject without mutation', () => {
  const cases = [
    doc([layer('A',{groupId:'g'}),layer('B')],[{id:'g'}]),
    doc([layer('A',{groupId:'g'}),layer('B')],[{id:'g',parentId:'g'}]),
    doc([layer('A',{groupId:'missing'}),layer('B')]),
    doc([layer('A'),layer('A')]),
    doc([layer('A',{groupId:'g'}),layer('gap'),layer('B',{groupId:'g'})],[{id:'g'}]),
  ];
  for (const d of cases) { const before=structuredClone(d); assert.throws(()=>plan(d,['A','B'])); assert.deepEqual(d,before); }
  assert.throws(()=>planLayerGroup(doc([layer('A'),layer('B')]),['A','B'],[],'A'),/идентификаторов/);
});
