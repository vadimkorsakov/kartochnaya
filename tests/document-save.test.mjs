import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { indexedDB } from 'fake-indexeddb';
import { runStoreRequest } from '../src/storage/indexeddb.mjs';

// Exercise the actual editor functions without exposing production internals.
const source=await readFile(new URL('../src/editor.js',import.meta.url),'utf8');
const saving=source.slice(source.indexOf('const documentSaves='),source.indexOf('function add(type)'));
const A={id:'x',projectId:'p',text:'A'}, B={...A,text:'B'}, C={...A,text:'C'};
async function harness(){
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(crypto.randomUUID(),3);r.onupgradeneeded=()=>r.result.createObjectStore('docs',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 const calls=[],gates=[],status={textContent:''};let hold=false,fail=false;
 const app={db,docs:[],doc:structuredClone(A)};
 const ctx=vm.createContext({app,JSON,Map,Promise,clone:structuredClone,clearTimeout,setTimeout,replacementSealed:false,deletingProjectId:null,deletedProjectIds:new Set(),boundarySyncDoc(){},syncCurrentSlide(){},syncAutoCardTitle(){},toast(){},$:()=>status,
 dbOp:async(store,mode,fn)=>{calls.push(structuredClone(app.doc));if(hold)await new Promise(resolve=>gates.push(resolve));if(fail)throw Error('injected');return runStoreRequest(db,store,mode,fn)}});
 vm.runInContext(saving+';globalThis.api={saveState,saveDocumentSnapshot,flushSave,saveSoon,refreshSaveStatus};',ctx);
 const api=ctx.api;
 return {ctx,app,api,calls,gates,status,hold:()=>hold=true,releaseReverse:()=>{hold=false;gates.splice(0).reverse().forEach(f=>f())},release:()=>{hold=false;gates.splice(0).forEach(f=>f())},fail:v=>fail=v,read:()=>runStoreRequest(db,'docs','readonly',s=>s.get('x'))};
}
test('confirmed identical snapshots cause no second transaction',async()=>{const h=await harness();assert.equal(await h.api.saveDocumentSnapshot(A),true);assert.equal(await h.api.flushSave(),true);assert.equal(h.calls.length,1);assert.deepEqual(await h.read(),A)});
test('A → A pending snapshot deduplicates and waits for confirmation',async()=>{const h=await harness();h.hold();const a=h.api.saveDocumentSnapshot(A),b=h.api.saveDocumentSnapshot(A);assert.equal(h.app.docs.length,0);assert.equal(h.calls.length,1);h.release();assert.equal(await a,true);assert.equal(await b,true);assert.deepEqual(await h.read(),A)});
test('A → B → C writes serialize even if upstream async work could finish backwards',async()=>{const h=await harness();h.hold();const a=h.api.saveDocumentSnapshot(A),b=h.api.saveDocumentSnapshot(B),c=h.api.saveDocumentSnapshot(C);await new Promise(r=>setImmediate(r));assert.equal(h.calls.length,1);h.release();await Promise.all([a,b,c]);assert.deepEqual(await h.read(),C);assert.deepEqual(h.app.docs[0],C)});
test('A confirmation cannot confirm edited B; explicit flush saves B',async()=>{const h=await harness();h.hold();const a=h.api.flushSave();h.app.doc=structuredClone(B);h.api.saveState('x').revision++;h.release();assert.equal(await a,false);h.api.refreshSaveStatus();assert.equal(h.status.textContent,'Сохраняем…');assert.equal(await h.api.flushSave(),true);assert.deepEqual(await h.read(),B)});
test('A → B → A must persist A after the outstanding B',async()=>{const h=await harness();await h.api.saveDocumentSnapshot(A);h.hold();const b=h.api.saveDocumentSnapshot(B),a=h.api.saveDocumentSnapshot(A);h.release();await Promise.all([b,a]);assert.deepEqual(await h.read(),A);assert.deepEqual(h.app.docs[0],A)});
test('failure retains confirmed memory and explicit retry succeeds',async()=>{const h=await harness();await h.api.saveDocumentSnapshot(A);h.app.doc=structuredClone(B);h.fail(true);assert.equal(await h.api.flushSave(),false);h.api.refreshSaveStatus();assert.match(h.status.textContent,/Ошибка/);assert.deepEqual(h.app.docs[0],A);assert.deepEqual(await h.read(),A);h.fail(false);assert.equal(await h.api.flushSave(),true);assert.deepEqual(await h.read(),B)});
test('saveSoon preserves an observable error until successful retry',async()=>{const h=await harness();h.fail(true);await h.api.flushSave();h.api.saveSoon();clearTimeout(h.app.saveTimer);assert.ok(h.api.saveState('x').error)});
test('old X confirmation cannot replace active Y status',async()=>{const h=await harness();h.hold();const a=h.api.flushSave();h.app.doc={id:'y',projectId:'p',text:'Y'};h.api.refreshSaveStatus();h.release();assert.equal(await a,false);assert.equal(h.status.textContent,'Сохраняем…');assert.deepEqual(h.app.docs[0],A)});
test('queued write rechecks deletion / workspace seals before issuing transaction',async()=>{for(const flag of ['deletingProjectId','replacementSealed']){const h=await harness();h.hold();const a=h.api.saveDocumentSnapshot(A),b=h.api.saveDocumentSnapshot(B);h.ctx[flag]=flag==='deletingProjectId'?'p':true;h.release();await a;assert.equal(await b,false);assert.equal(h.calls.length,1);assert.deepEqual(await h.read(),A)}});
test('reverse upstream releases cannot leave IndexedDB older than confirmed memory',async()=>{const h=await harness();h.hold();const a=h.api.saveDocumentSnapshot(A),b=h.api.saveDocumentSnapshot(B),c=h.api.saveDocumentSnapshot(C);h.releaseReverse();await Promise.all([a,b,c]);assert.deepEqual(await h.read(),C);assert.deepEqual(h.app.docs[0],C)});
