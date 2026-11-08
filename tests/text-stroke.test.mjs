import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRuns,applyTextStyle,effectiveTextStyleAt,replaceText,validateRuns} from '../src/model/rich-text.mjs';
import {createInlineHistory,recordInlineHistory,moveInlineHistory} from '../src/model/inline-text-history.mjs';
import {createRichTextLayoutEngine,resolveRichTextStyle} from '../src/render/rich-text-layout.mjs';
import {textStrokePadding} from '../src/render/text-stroke.mjs';

test('stroke validation rejects malformed saved values, normalizes HEX, and preserves explicit zero',()=>{
 const text='абвг';
 assert.deepEqual(normalizeRuns(text,[{start:0,end:1,style:{strokeWidth:-1,stroke:'red'}},{start:1,end:2,style:{strokeWidth:'3',stroke:123}},{start:2,end:3,style:{strokeWidth:Infinity,stroke:'#F0A'}},{start:3,end:4,style:{strokeWidth:0}}],{strokeWidth:0}),[
  {start:2,end:3,style:{stroke:'#ff00aa'}},{start:3,end:4,style:{strokeWidth:0}}
 ]);
 const e=applyTextStyle({text,strokeWidth:0},0,1,{strokeWidth:0});
 assert.equal(effectiveTextStyleAt({...e,strokeWidth:6},0).strokeWidth,0);
 assert.equal(resolveRichTextStyle({}).strokeWidth,0);
 assert.equal(resolveRichTextStyle({strokeWidth:6},{strokeWidth:0}).strokeWidth,0);
});
test('range stroke priorities, overlapping edits and JSON normalization are idempotent',()=>{
 const base={text:'Раз два 😀',strokeWidth:4,stroke:'#112233'};
 let e=applyTextStyle(base,0,3,{strokeWidth:2,stroke:'#F00'});
 e=applyTextStyle(e,2,7,{strokeWidth:0});
 assert.equal(effectiveTextStyleAt(e,0).stroke,'#ff0000');
 assert.equal(effectiveTextStyleAt(e,2).strokeWidth,0);
 assert.equal(effectiveTextStyleAt(e,8).strokeWidth,4);
 assert.equal(effectiveTextStyleAt(e,8).stroke,'#112233');
 assert.deepEqual(normalizeRuns(e.text,JSON.parse(JSON.stringify(e.textRuns)),e),e.textRuns);
 assert.deepEqual(applyTextStyle(e,2,7,{strokeWidth:0}),e);
 assert.equal(validateRuns(e.text,e.textRuns,e),true);assert.equal(base.textRuns,undefined);
});
test('UTF-16 replacement inherits stroke and deletion never bisects an emoji',()=>{
 let e=applyTextStyle({text:'f😀i'},0,3,{strokeWidth:3,stroke:'#2266dd'});
 e=replaceText(e,3,3,'Ж');assert.equal(e.text,'f😀Жi');
 assert.equal(effectiveTextStyleAt(e,3).strokeWidth,3);
 e=replaceText(e,2,3,'');assert.equal(e.text,'fЖi');
 assert.deepEqual(e.textRuns,[{start:0,end:2,style:{stroke:'#2266dd',strokeWidth:3}}]);
});
test('session history restores stroke zero, color and UTF-16 backward caret with text',()=>{
 const original={text:'fi😀',strokeWidth:4,stroke:'#111111'},history=createInlineHistory(original);
 const styled=applyTextStyle(original,0,1,{strokeWidth:0,stroke:'#ff0000'});
 recordInlineHistory(history,styled,{start:0,end:1,direction:'backward'});
 const typed=replaceText(styled,1,1,'X');recordInlineHistory(history,typed,{start:2,end:2,direction:'forward'});
 assert.deepEqual(moveInlineHistory(history,-1),{element:styled,caret:{start:0,end:1,direction:'backward'}});
 assert.deepEqual(moveInlineHistory(history,-1).element,original);
 assert.deepEqual(moveInlineHistory(history,1).element,styled);
});
test('stroke paint boundaries preserve wraps, baselines, leading, total advances and following groups',()=>{
 const context={measureText(text){const size=parseFloat(this.font.match(/([\d.]+)px/)[1]);return {width:[...text].length*size*.5,fontBoundingBoxAscent:size*.8,fontBoundingBoxDescent:size*.2};}};
 const engine=createRichTextLayoutEngine(context);
 const base={text:'AV fi Жук 😀\nЕщё строка',w:90,h:300,fontSize:20,lineHeight:1.3};
 const original=engine.layout(base);
 const e=applyTextStyle(base,0,4,{strokeWidth:12,stroke:'#ff0000'}),styled=engine.layout(e);
 const geometry=x=>x.rows.map(({start,end,nextStart,width,y,height,baseline})=>({start,end,nextStart,width,y,height,baseline}));
 assert.deepEqual(geometry(styled),geometry(original));
 assert.deepEqual(engine.layout(applyTextStyle(e,0,4,{strokeWidth:0})).rows.map(r=>r.baseline),original.rows.map(r=>r.baseline));
});
test('stroke padding includes measured italic overhang without affecting layout metrics',()=>{
 const context={measureText(){return {width:30,fontBoundingBoxAscent:30,fontBoundingBoxDescent:8,actualBoundingBoxLeft:18,actualBoundingBoxRight:36,actualBoundingBoxAscent:33,actualBoundingBoxDescent:9};}};
 const e={text:'J',fontSize:36,w:30,h:60,strokeWidth:4},engine=createRichTextLayoutEngine(context),layout=engine.layout(e);
 assert.equal(layout.inkOverflow,18);assert.ok(textStrokePadding(layout)>=22);
 assert.deepEqual(layout.rows.map(r=>[r.width,r.baseline]),engine.layout({...e,strokeWidth:0}).rows.map(r=>[r.width,r.baseline]));
});
test('a new stroke must not reposition an existing color fragment elsewhere in the shaping group',()=>{
 const context={measureText(text){return {width:[...text].length*10-(text.includes('AV')?2:0),fontBoundingBoxAscent:16,fontBoundingBoxDescent:4};}};
 const engine=createRichTextLayoutEngine(context),e=applyTextStyle({text:'AV fi',w:200,h:100,fontSize:20},1,2,{textColor:'#2266dd'});
 const before=engine.layout(e),after=engine.layout(applyTextStyle(e,3,4,{strokeWidth:2,stroke:'#dd2244'}));
 assert.equal(before.rows[0].fragments.find(p=>p.text==='V').x,10);
 assert.equal(after.rows[0].fragments.find(p=>p.text==='V').x,10);
 assert.equal(after.width,before.width);assert.equal(after.rows[0].baseline,before.rows[0].baseline);
});

test('fill opacity validates strictly, preserves explicit endpoints and resets to inheritance',()=>{
 const base={text:'abcd',fillOpacity:100};
 for(const value of [NaN,Infinity,-Infinity,'50',-1,101,{},true]){
  assert.deepEqual(normalizeRuns(base.text,[{start:0,end:2,style:{fillOpacity:value}}],base),[]);
  const styled=applyTextStyle(base,0,2,{fillOpacity:50});
  assert.deepEqual(applyTextStyle(styled,0,2,{fillOpacity:value}),styled);
 }
 for(const value of [0,50,100]){
  const e=applyTextStyle(base,0,2,{fillOpacity:value});
  assert.deepEqual(e.textRuns,[{start:0,end:2,style:{fillOpacity:value}}]);
  assert.equal(effectiveTextStyleAt({...e,fillOpacity:25},0).fillOpacity,value);
  assert.equal(effectiveTextStyleAt({...e,fillOpacity:25},3).fillOpacity,25);
  assert.equal(applyTextStyle(e,0,2,{fillOpacity:null}).textRuns,undefined);
 }
 assert.equal(resolveRichTextStyle({}).fillOpacity,100);
 assert.equal(resolveRichTextStyle({fillOpacity:50},{fillOpacity:0}).fillOpacity,0);
});
test('opacity overlapping runs, UTF-16 typing/deletion, JSON and Undo/Redo retain sparse inheritance',()=>{
 const base={text:'f😀i AV',fillOpacity:75},history=createInlineHistory(base);
 let e=applyTextStyle(base,0,3,{fillOpacity:0});
 e=applyTextStyle(e,1,4,{fillOpacity:100});
 assert.deepEqual(e.textRuns,[{start:0,end:1,style:{fillOpacity:0}},{start:1,end:4,style:{fillOpacity:100}}]);
 recordInlineHistory(history,e,{start:0,end:4,direction:'backward'});
 const inserted=replaceText(e,3,3,'X');assert.equal(effectiveTextStyleAt(inserted,3).fillOpacity,100);
 const left=replaceText(e,1,1,'Q');assert.equal(effectiveTextStyleAt(left,1).fillOpacity,0);
 const right=replaceText(e,0,0,'Q');assert.equal(effectiveTextStyleAt(right,0).fillOpacity,0);
 const deleted=replaceText(inserted,2,3,'');assert.equal(deleted.text,'fXi AV');
 assert.equal(effectiveTextStyleAt(deleted,1).fillOpacity,100);
 recordInlineHistory(history,deleted,{start:1,end:1,direction:'forward'});
 assert.deepEqual(moveInlineHistory(history,-1),{element:e,caret:{start:0,end:4,direction:'backward'}});
 assert.deepEqual(moveInlineHistory(history,-1).element,base);
 assert.deepEqual(moveInlineHistory(history,1).element,e);
 assert.deepEqual(moveInlineHistory(history,1).element,deleted);
 const json=JSON.parse(JSON.stringify(deleted));assert.deepEqual(normalizeRuns(json.text,json.textRuns,json),deleted.textRuns);
 const reset=applyTextStyle(e,1,3,{fillOpacity:null});assert.equal(effectiveTextStyleAt(reset,1).fillOpacity,75);
});
test('opacity boundaries preserve contextual AV/fi advances, wraps, baselines and neighboring color positions',()=>{
 const context={measureText(text){return {width:[...text].length*10-(text.includes('AV')?2:0)-(text.includes('fi')?1:0),fontBoundingBoxAscent:16,fontBoundingBoxDescent:4};}};
 const engine=createRichTextLayoutEngine(context);
 const base={text:'AV fi 😀\nAV fi wrapped',w:72,h:200,fontSize:20,lineHeight:1.2,underline:true,strikethrough:true};
 const geometry=x=>x.rows.map(({start,end,nextStart,width,y,height,baseline})=>({start,end,nextStart,width,y,height,baseline}));
 for(const [start,end] of [[0,1],[3,4],[3,5],[1,6]]){
  const before=engine.layout(base),after=engine.layout(applyTextStyle(base,start,end,{fillOpacity:0}));
  assert.deepEqual(geometry(after),geometry(before));assert.equal(after.width,before.width);
  assert.ok(after.rows.flatMap(r=>r.decorations).some(r=>r.fillOpacity===0));
 }
 const colored=applyTextStyle(base,1,2,{textColor:'#2266dd'}),before=engine.layout(colored),after=engine.layout(applyTextStyle(colored,3,4,{fillOpacity:50}));
 assert.equal(after.rows[0].fragments.find(p=>p.text==='V').x,before.rows[0].fragments.find(p=>p.text==='V').x);
 for(const fillType of ['gradient','image','none']){
  const plain=engine.layout({...base,fillType}),styled=engine.layout({...applyTextStyle(base,3,4,{fillOpacity:0}),fillType});
  assert.deepEqual(styled.rows.map(r=>r.fragments.map(p=>[p.text,p.x,p.width])),plain.rows.map(r=>r.fragments.map(p=>[p.text,p.x,p.width])));
 }
});
test('shared painter multiplies incoming alpha once per fill/decor fragment and restores independent stroke alpha',async()=>{
 const {paintHorizontalTextPass}=await import('../src/render/text-stroke.mjs');
 const calls=[],stack=[],c={globalAlpha:.8,fillStyle:'#fff',save(){stack.push({globalAlpha:this.globalAlpha,fillStyle:this.fillStyle});},restore(){Object.assign(this,stack.pop());},beginPath(){},rect(){},clip(){},setLineDash(){},fillText(text){calls.push(['fill',text,this.globalAlpha]);},strokeText(text){calls.push(['stroke',text,this.globalAlpha]);},fillRect(x){calls.push(['line',x,this.globalAlpha]);}};
 const style=resolveRichTextStyle({fontSize:20,strokeWidth:3,strokeOpacity:75}),layout={rows:[{y:0,fragments:[0,50,100].map((fillOpacity,i)=>({text:String(i),x:i*20,y:20,style:{...style,fillOpacity}})),decorations:[0,50,100].map((fillOpacity,i)=>({x:i*20,y:22,width:10,height:1,color:'#111',fillOpacity}))}]};
 const e={w:100,h:60,fillOpacity:50,strokeOpacity:75};
 paintHorizontalTextPass(c,e,layout);assert.deepEqual(calls,[['fill','0',0],['fill','1',.4],['fill','2',.8],['line',0,0],['line',20,.4],['line',40,.8]]);
 assert.equal(c.globalAlpha,.8);calls.length=0;
 paintHorizontalTextPass(c,e,layout,'stroke');assert.deepEqual(calls.map(x=>x[2]),[.8*.75,.8*.75,.8*.75]);assert.equal(c.globalAlpha,.8);
 calls.length=0;paintHorizontalTextPass(c,{...e,fillType:'gradient'},layout);assert.ok(calls.every(x=>x[2]===.8));assert.equal(stack.length,0);
});
test('IndexedDB v3 and backup roundtrip retain opacity endpoints, partial alpha and layer inheritance',async()=>{
 const {IDBFactory}=await import('fake-indexeddb');
 const {openDatabase,runStoreRequest}=await import('../src/storage/indexeddb.mjs');
 const {createBackup,readBackup}=await import('../src/backup/archive.mjs');
 const base={id:'text',text:'A😀V fi',fillOpacity:75};
 const element=[0,50,100].reduce((e,fillOpacity,i)=>applyTextStyle(e,i===0?0:i===1?1:3,i===0?1:i===1?3:4,{fillOpacity}),base);
 const doc={id:'d',projectId:'p',width:320,height:240,elements:[element]},data={projects:[{id:'p',name:'Opacity'}],docs:[doc],fonts:[],settings:[]};
 assert.deepEqual((await readBackup((await createBackup(data)).bytes)).data.docs[0],doc);
 const indexedDB=new IDBFactory(),db=await openDatabase({indexedDB});assert.equal(db.version,3);
 await runStoreRequest(db,'docs','readwrite',s=>s.put(doc));db.close();
 const reopened=await openDatabase({indexedDB});
 try{const saved=await runStoreRequest(reopened,'docs','readonly',s=>s.get('d'));assert.deepEqual(saved,doc);assert.deepEqual(normalizeRuns(element.text,saved.elements[0].textRuns,element),element.textRuns);}finally{reopened.close();}
});

test('stroke opacity validates strictly, preserves explicit endpoints and resets to inheritance',()=>{
 const base={text:'abcd',strokeOpacity:100};
 for(const value of [NaN,Infinity,-Infinity,'50',-1,101,{},true]){
  assert.deepEqual(normalizeRuns(base.text,[{start:0,end:2,style:{strokeOpacity:value}}],base),[]);
  const styled=applyTextStyle(base,0,2,{strokeOpacity:50});
  assert.deepEqual(applyTextStyle(styled,0,2,{strokeOpacity:value}),styled);
 }
 for(const value of [0,40,100]){
  const e=applyTextStyle(base,0,2,{strokeOpacity:value});
  assert.deepEqual(e.textRuns,[{start:0,end:2,style:{strokeOpacity:value}}]);
  assert.equal(effectiveTextStyleAt({...e,strokeOpacity:25},0).strokeOpacity,value);
  assert.equal(effectiveTextStyleAt({...e,strokeOpacity:25},3).strokeOpacity,25);
  assert.equal(applyTextStyle(e,0,2,{strokeOpacity:null}).textRuns,undefined);
 }
 for(const strokeOpacity of [0,100]){
  const e=applyTextStyle({...base,strokeOpacity},0,2,{strokeOpacity});
  assert.deepEqual(normalizeRuns(e.text,e.textRuns,e),[{start:0,end:2,style:{strokeOpacity}}]);
 }
 assert.equal(resolveRichTextStyle({}).strokeOpacity,100);
 assert.equal(resolveRichTextStyle({strokeOpacity:50},{strokeOpacity:0}).strokeOpacity,0);
});
test('stroke opacity overlapping runs, UTF-16 typing/deletion, JSON and Undo/Redo retain sparse inheritance',()=>{
 const base={text:'f😀i AV',strokeOpacity:75},history=createInlineHistory(base);
 let e=applyTextStyle(base,0,3,{strokeOpacity:0});
 e=applyTextStyle(e,1,4,{strokeOpacity:100});
 assert.deepEqual(e.textRuns,[{start:0,end:1,style:{strokeOpacity:0}},{start:1,end:4,style:{strokeOpacity:100}}]);
 recordInlineHistory(history,e,{start:0,end:4,direction:'backward'});
 const inserted=replaceText(e,3,3,'X');assert.equal(effectiveTextStyleAt(inserted,3).strokeOpacity,100);
 const left=replaceText(e,1,1,'Q');assert.equal(effectiveTextStyleAt(left,1).strokeOpacity,0);
 const right=replaceText(e,0,0,'Q');assert.equal(effectiveTextStyleAt(right,0).strokeOpacity,0);
 const deleted=replaceText(inserted,2,3,'');assert.equal(deleted.text,'fXi AV');
 assert.equal(effectiveTextStyleAt(deleted,1).strokeOpacity,100);
 recordInlineHistory(history,deleted,{start:1,end:1,direction:'forward'});
 assert.deepEqual(moveInlineHistory(history,-1),{element:e,caret:{start:0,end:4,direction:'backward'}});
 assert.deepEqual(moveInlineHistory(history,-1).element,base);
 assert.deepEqual(moveInlineHistory(history,1).element,e);
 assert.deepEqual(moveInlineHistory(history,1).element,deleted);
 const json=JSON.parse(JSON.stringify(deleted));assert.deepEqual(normalizeRuns(json.text,json.textRuns,json),deleted.textRuns);
 const reset=applyTextStyle(e,1,3,{strokeOpacity:null});assert.equal(effectiveTextStyleAt(reset,1).strokeOpacity,75);
});

test('IndexedDB v3 and backup roundtrip retain stroke opacity endpoints, partial alpha and layer inheritance',async()=>{
 const {IDBFactory}=await import('fake-indexeddb');
 const {openDatabase,runStoreRequest}=await import('../src/storage/indexeddb.mjs');
 const {createBackup,readBackup}=await import('../src/backup/archive.mjs');
 const base={id:'text',text:'A😀V fi',strokeOpacity:75};
 const element=[0,40,100].reduce((e,strokeOpacity,i)=>applyTextStyle(e,i===0?0:i===1?1:3,i===0?1:i===1?3:4,{strokeOpacity}),base);
 const doc={id:'d',projectId:'p',width:320,height:240,elements:[element]},data={projects:[{id:'p',name:'Opacity'}],docs:[doc],fonts:[],settings:[]};
 assert.deepEqual((await readBackup((await createBackup(data)).bytes)).data.docs[0],doc);
 const indexedDB=new IDBFactory(),db=await openDatabase({indexedDB});assert.equal(db.version,3);
 await runStoreRequest(db,'docs','readwrite',s=>s.put(doc));db.close();
 const reopened=await openDatabase({indexedDB});
 try{const saved=await runStoreRequest(reopened,'docs','readonly',s=>s.get('d'));assert.deepEqual(saved,doc);assert.deepEqual(normalizeRuns(element.text,saved.elements[0].textRuns,element),element.textRuns);}finally{reopened.close();}
});
test('stroke alpha multiplies incoming alpha once, restores state and leaves fill/decorations independent',async()=>{
 const {paintHorizontalTextPass}=await import('../src/render/text-stroke.mjs');
 const calls=[],stack=[],c={globalAlpha:.8,save(){stack.push(this.globalAlpha);},restore(){this.globalAlpha=stack.pop();},beginPath(){},rect(){},clip(){},setLineDash(){},fillText(text){calls.push(['fill',text,this.globalAlpha]);},strokeText(text){calls.push(['stroke',text,this.globalAlpha]);},fillRect(){calls.push(['line',this.globalAlpha]);}};
 const style=resolveRichTextStyle({fontSize:20,strokeWidth:3,fillOpacity:40}),layout={rows:[{y:0,fragments:[0,40,100].map((strokeOpacity,i)=>({text:String(i),x:i*20,y:20,style:{...style,strokeOpacity}})),decorations:[{x:0,y:22,width:60,height:1,color:'#111',fillOpacity:40}]}]};
 const e={w:100,h:60,fillOpacity:40,strokeOpacity:25};
 paintHorizontalTextPass(c,e,layout,'stroke');assert.deepEqual(calls.map(x=>x[2]),[0,.8*.4,.8]);assert.equal(c.globalAlpha,.8);
 calls.length=0;paintHorizontalTextPass(c,e,layout);assert.deepEqual(calls,[['fill','0',.8*.4],['fill','1',.8*.4],['fill','2',.8*.4],['line',.8*.4]]);assert.equal(c.globalAlpha,.8);assert.equal(stack.length,0);
 const decorated=applyTextStyle({text:'abcd'},0,4,{underline:true,strokeWidth:4,stroke:'#112233',fillOpacity:0,textColor:'#224466',fontFeatures:{liga:0}});
 const patched=applyTextStyle(decorated,1,3,{strokeOpacity:40});assert.equal(effectiveTextStyleAt(patched,1).fillOpacity,0);assert.equal(effectiveTextStyleAt(patched,1).underline,true);
 assert.deepEqual(applyTextStyle(patched,1,3,{strokeOpacity:null}),decorated);
});
