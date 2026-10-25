import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readImageResource, prepareImage } from '../src/render/image-resource.mjs';
import { createLayerMasks, maskKey } from '../src/render/layer-masks.mjs';

// Minimal in-memory Canvas port for lifecycle/unit contracts. Browser tests use
// the real Canvas compositor and exported PNG pixels, without this adapter.
function canvas(width, height, rgba=[255,255,255,255]) {
  const data = new Uint8ClampedArray(width*height*4);
  for(let i=0;i<data.length;i+=4)data.set(rgba,i);
  const out={width,height,data};
  out.getContext=()=>({
    drawImage(source,x,y,w=source.width,h=source.height) {
      for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++) {
        const from=(Math.floor(yy/h*source.height)*source.width+Math.floor(xx/w*source.width))*4;
        data.set(source.data.subarray(from,from+4),((yy+y)*width+xx+x)*4);
      }
    },
    getImageData:()=>({data:data.slice(),width,height}),
    putImageData:image=>data.set(image.data),
    fillRect:()=>{for(let i=0;i<data.length;i+=4)data.set([255,255,255,255],i);},
  });
  return out;
}
const small=Object.freeze({width:2,height:1}),large=Object.freeze({width:4,height:2});
function images() {
  const cache=new Map(),created=[],settled=[];
  const read=src=>readImageResource(cache,src,()=>{const image={};created.push(image);return image;},src=>settled.push(src));
  return {cache,created,settled,read};
}

test('image states: absent, loading, ready; concurrent preparation shares request and completion',async()=>{
  const i=images();assert.equal(i.read('').state,'absent');assert.equal(i.created.length,0);
  const first=i.read('mask');assert.equal(first.state,'loading');
  assert.equal(i.read('mask').completion,first.completion);
  const a=prepareImage(i.read,'mask'),b=prepareImage(i.read,'mask');
  assert.equal(i.created.length,1);assert.deepEqual(i.settled,[]);
  i.created[0].onload();assert.equal(await a,i.created[0]);assert.equal(await b,i.created[0]);
  assert.equal(i.read('mask').state,'ready');assert.deepEqual(i.settled,['mask']);
});
test('failed image settles waiters, stays error, does not retry on every render',async()=>{
  const i=images(),wait=prepareImage(i.read,'broken');i.created[0].onerror();
  await assert.rejects(wait,/прочитать/);assert.equal(i.read('broken').state,'error');
  await assert.rejects(prepareImage(i.read,'broken'));assert.equal(i.created.length,1);assert.deepEqual(i.settled,['broken']);
});
test('ready image records installed by existing image editing remain readable',async()=>{
  const i=images(),image={};i.cache.set('edited',{image,ready:true});
  assert.equal(await prepareImage(i.read,'edited'),image);assert.equal(i.created.length,0);
});
test('alpha cache never retains a pending placeholder; completion works without global invalidation',()=>{
  const i=images(),m=createLayerMasks({createCanvas:canvas,readImage:i.read});
  assert.equal(m.read('mask',small).state,'loading');assert.equal(m.alpha('mask',small),null);
  Object.assign(i.created[0],canvas(1,1,[0,0,0,255]));i.created[0].onload();
  assert.deepEqual([...m.alpha('mask',small).data],[255,255,255,0,255,255,255,0]);
});
test('absent and failed masks stay distinct; only absent masks have a white editable starting canvas',()=>{
  const i=images(),m=createLayerMasks({createCanvas:canvas,readImage:i.read});
  assert.equal(m.read('',small).state,'absent');assert.equal(m.alpha('',small),null);
  assert.deepEqual([...m.editable('',small).data],[255,255,255,255,255,255,255,255]);
  assert.equal(m.editable('broken',small),null);i.created[0].onerror();
  assert.equal(m.read('broken',small).state,'error');assert.equal(m.editable('broken',small),null);assert.equal(m.alpha('broken',small),null);
});
for(const [rgba,expected] of [[[0,0,0,255],0],[[255,255,255,255],255],[[255,255,255,128],128],[[128,128,128,255],128],[[128,128,128,128],64],[[255,255,255,0],0]])test(`luminance times alpha: ${rgba}`,()=>{
  const m=createLayerMasks({createCanvas:canvas,readImage:()=>({state:'ready',image:canvas(1,1,rgba)})});
  assert.equal(m.alpha('source',small).data[3],expected);
});
test('same source and historical ID at different target sizes have independent complete alpha images',()=>{
  const a=Object.freeze({...small,id:'same'}),b=Object.freeze({...large,id:'same'});
  const m=createLayerMasks({createCanvas:canvas,readImage:()=>({state:'ready',image:canvas(1,1)})});
  const x=m.alpha('source',a),y=m.alpha('source',b);
  assert.notEqual(x,y);assert.equal(y.width,4);assert.equal(y.height,2);assert.equal(y.data.at(-1),255);
  assert.equal(m.alpha('source',a),x);assert.notEqual(maskKey('source',a),maskKey('source',b));
  assert.notEqual(maskKey('source',a),maskKey('replacement',a));
});
test('changed source, returning to old source and resizing never return stale pixels',()=>{
  const m=createLayerMasks({createCanvas:canvas,readImage:src=>({state:'ready',image:canvas(1,1,src==='black'?[0,0,0,255]:[255,255,255,255])})});
  const old=m.alpha('black',small);assert.equal(old.data[3],0);assert.equal(m.alpha('white',small).data[3],255);
  assert.equal(m.alpha('black',small),old);assert.equal(m.alpha('black',large).data.at(-1),0);
});
test('editable copies and remember do not alias saved masks or another document using identical PNG',()=>{
  const m=createLayerMasks({createCanvas:canvas,readImage:()=>({state:'ready',image:canvas(1,1)})});
  const saved=m.alpha('source',small),edit=m.editable('source',small);edit.data[0]=0;
  assert.equal(m.read('source',small).canvas.data[0],255);assert.equal(m.alpha('source',small),saved);
  m.remember('new PNG',small,edit);edit.data[0]=255;assert.equal(m.read('new PNG',small).canvas.data[0],0);
  assert.equal(m.alpha('source',small).data[3],255);
});
test('draft identity, version and dimensions isolate reused IDs and revise alpha without clearing persisted masks',()=>{
  const m=createLayerMasks({createCanvas:canvas,readImage:()=>({state:'ready',image:canvas(1,1)})});
  const a=canvas(2,1),b=canvas(2,1,[0,0,0,255]),saved=m.alpha('saved',small),first=m.draft(a,0,small);
  assert.equal(m.draft(a,0,small),first);assert.equal(m.draft(b,0,small).data[3],0);
  a.data[0]=a.data[1]=a.data[2]=0;assert.equal(m.draft(a,1,small).data[3],0);
  assert.equal(m.draft(a,1,large).width,4);assert.equal(m.alpha('saved',small),saved);
});
test('bounded LRU evicts old entries without clearing masks still in use',()=>{
  let reads=0;const m=createLayerMasks({limit:2,createCanvas:canvas,readImage:()=>{reads++;return {state:'ready',image:canvas(1,1)};}});
  const a=m.alpha('a',small);m.alpha('b',small);assert.equal(m.alpha('a',small),a);
  m.alpha('c',small);assert.equal(m.alpha('a',small),a);assert.equal(reads,3);m.alpha('b',small);assert.equal(reads,4);
});
