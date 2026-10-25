import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { remapCanvasGraph, remapDocumentGraph, selectCanvasGraph, canvasGraphIds } from '../src/model/canvas-graph.mjs';
import { analyzeProject } from '../src/model/project-integrity.mjs';
const fixture = JSON.parse(await readFile(new URL('./fixtures/canvas-graph.json', import.meta.url)));
const source = fixture.documents[0];
const generator = () => { let n=0; return () => 'new-'+(++n); };
function links(canvas) {
  const [shape,text] = canvas.elements;
  assert.equal(text.pathBoundary.sourceId,shape.id);assert.equal(text.clipBaseId,shape.id);
  const group=canvas.groups.find(g=>g.id===shape.groupId);
  assert.equal(text.groupId,group.id);assert.equal(canvas.groups.find(g=>g.id===group.parentId).name,'Outer');
  assert.deepEqual(group.custom,{keep:1});
}
test('full clone preserves graph, fields, optional absence and immutable source',()=>{
  const before=structuredClone(source), result=remapCanvasGraph(source,generator());links(result);
  assert.deepEqual(source,before);assert.equal(result.elements[2].isTitleLayer,true);
  assert.equal(result.groups[0].parentId,undefined);
  result.elements.forEach((e,i)=>{const {id,groupId,clipBaseId,pathBoundary,...rest}=e;const {id:a,groupId:b,clipBaseId:c,pathBoundary:d,...old}=source.elements[i];assert.deepEqual(rest,old);});
});
test('two slides allocate per canvas, active root is remapped once, source untouched',()=>{
  const card=fixture.documents[1],before=structuredClone(card),doc=remapDocumentGraph(card,generator());
  links(doc);doc.slides.forEach(links);assert.deepEqual(doc.elements,doc.slides[1].elements);assert.deepEqual(doc.groups,doc.slides[1].groups);
  const ids=doc.slides.flatMap(s=>[s.id,...s.elements.map(e=>e.id),...s.groups.map(g=>g.id)]);assert.equal(new Set(ids).size,ids.length);
  assert.deepEqual(card,before);assert.deepEqual(analyzeProject(fixture.project,[doc]).warnings,[]);
});
test('selection copies nested and empty groups while preserving metadata',()=>{
  const canvas=structuredClone(source);canvas.groups.push({id:'empty',parentId:'inner',name:'Empty',locked:true});
  const selection=selectCanvasGraph(canvas,['shape-original','text-original'],['outer']);
  const result=remapCanvasGraph(selection,generator(),{selection:true});links(result);
  assert.equal(result.groups.find(g=>g.name==='Empty').parentId,result.groups.find(g=>g.name==='Inner').id);
});
test('selection redirects copied targets and preserves available external references',()=>{
  for(const ids of [['shape-original','text-original'],['text-original']]){
    const result=remapCanvasGraph(selectCanvasGraph(source,ids),generator(),{selection:true,availableElementIds:source.elements.map(e=>e.id),availableGroupIds:source.groups.map(g=>g.id)});
    const text=result.elements.find(e=>e.pathBoundary),shape=result.elements.find(e=>e.type==='rect');
    assert.equal(text.pathBoundary.sourceId,shape?.id||'shape-original');assert.equal(text.clipBaseId,shape?.id||'shape-original');assert.equal(text.groupId,'inner');
  }
});
test('unavailable partial references detach safely, retaining fallback and geometry',()=>{
  const selection=selectCanvasGraph(source,['text-original']);const result=remapCanvasGraph(selection,generator(),{selection:true});const text=result.elements[0];
  assert.equal(text.pathBoundary.sourceId,null);assert.deepEqual(text.pathBoundary.fallback,selection.elements[0].pathBoundary.fallback);
  assert.equal(text.clipped,false);assert.equal(text.clipBaseId,undefined);assert.equal(text.groupId,null);
  for(const key of ['x','y','w','h','rotation'])assert.equal(text[key],selection.elements[0][key]);
});
test('partial title copy clears title ownership; full clone preserves it',()=>{
  const selection=selectCanvasGraph(source,['title']);assert.equal(remapCanvasGraph(selection,generator(),{selection:true}).elements[0].isTitleLayer,false);
  assert.equal(remapCanvasGraph(selection,generator()).elements[0].isTitleLayer,true);
});
test('legacy absent optional lists stay absent; historical damage is not silently repaired',()=>{
  const legacy={elements:[{id:'a',pathBoundary:{sourceId:'missing',fallback:{points:[]}},groupId:'lost',clipBaseId:'lost-base'}]};
  const result=remapCanvasGraph(legacy,generator());assert.equal(result.groups,undefined);assert.equal(result.elements[0].groupId,'lost');assert.equal(result.elements[0].pathBoundary.sourceId,'missing');assert.equal(result.elements[0].clipBaseId,'lost-base');
});
test('colliding generators, duplicate source IDs and accidental link healing fail without mutation',()=>{
  const before=structuredClone(source);
  for(const id of [...canvasGraphIds(source),'reserved',''])assert.throws(()=>remapCanvasGraph(source,()=>id,{reservedIds:['reserved']}));
  assert.throws(()=>remapCanvasGraph({elements:[{id:'a'},{id:'a'}]},generator()));
  assert.throws(()=>remapCanvasGraph({elements:[{id:'a',clipBaseId:'missing'}]},()=> 'missing'));
  assert.deepEqual(source,before);
});
test('root and active-slide divergence is copied without dropping either representation',()=>{
  const card=structuredClone(fixture.documents[1]);card.slides[1].elements[0].name='Historical slide value';delete card.groups;
  const result=remapDocumentGraph(card,generator());
  assert.equal(result.groups,undefined);assert.equal(result.slides[1].groups.length,2);
  assert.equal(result.elements[0].id,result.slides[1].elements[0].id);
  assert.equal(result.elements[0].name,'Source rectangle');assert.equal(result.slides[1].elements[0].name,'Historical slide value');
});
test('full clone retains historical boundary sourceLast for identical rendering',()=>{
  const canvas=structuredClone(source);canvas.elements[1].pathBoundary.sourceLast={x:10,y:15,w:180,h:90,rotation:4};
  const result=remapCanvasGraph(canvas,generator());assert.deepEqual(result.elements[1].pathBoundary.sourceLast,canvas.elements[1].pathBoundary.sourceLast);
});
test('legacy clipping without clipBaseId captures the existing base only in the selected copy',()=>{
  const canvas=structuredClone(source);delete canvas.elements[1].clipBaseId;
  const result=selectCanvasGraph(canvas,['text-original']);assert.equal(result.elements[0].clipBaseId,'shape-original');assert.equal(canvas.elements[1].clipBaseId,undefined);
  const copied=remapCanvasGraph(result,generator(),{selection:true,availableElementIds:['shape-original'],availableGroupIds:['inner']});assert.equal(copied.elements[0].clipBaseId,'shape-original');
});
