import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInlineHistory, recordInlineHistory, moveInlineHistory } from '../src/model/inline-text-history.mjs';

test('format previews settle once, undo restores the full layer, new typing truncates redo', () => {
 const layer={text:'Я😀',fontSize:12,textRunsBaseFontSize:24,autoFontSize:true};
 const history=createInlineHistory(layer),caret={start:1,end:3,direction:'forward'};
 const formatted={...layer,fontSize:10,textRuns:[{start:1,end:3,style:{fontSize:48}}]};
 recordInlineHistory(history,formatted,caret);
 recordInlineHistory(history,formatted,caret);
 assert.equal(history.states.length,2);
 assert.deepEqual(moveInlineHistory(history,-1).element,layer);
 assert.deepEqual(moveInlineHistory(history,1),{element:formatted,caret});
 formatted.textRuns[0].style.fontSize=100;
 assert.equal(history.states[1].element.textRuns[0].style.fontSize,48);
 moveInlineHistory(history,-1);
 recordInlineHistory(history,{...layer,text:'Я'},caret);
 assert.equal(moveInlineHistory(history,1),null);
 assert.deepEqual(history.states[0].element,layer);
});

import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {applyTextStyle} from '../src/model/rich-text.mjs';
import {richTextSpans,resolveRichTextStyle,retainRichTextSizeBase} from '../src/render/rich-text-layout.mjs';
import {mobileTextStyle} from '../src/editor/mobile-text-style.mjs';

test('mobile query includes default gaps, LF, aliases, reference sizes and all intersecting spans',()=>{
 const element={text:'Первое Второе\n😀 хвост',fontFamily:'Arial',fontWeight:'400',fontStyle:'normal',fontSize:24,textRunsBaseFontSize:12,textColor:'#000',letterSpacing:0,lineHeight:1.15,
  textRuns:[{start:7,end:13,style:{fontFamily:'Georgia',fontSize:18,bold:true,italic:true,textColor:'#ff0000',letterSpacing:2,lineHeight:2,underline:true,strikethrough:true,strokeWidth:2,stroke:'#f00'}}]};
 const range={kind:'range',start:0,end:14};
 for(const key of ['fontFamily','fontVariant','bold','italic','fontSize','textColor','underline','strikethrough','letterSpacing','lineHeight','strokeWidth','stroke'])assert.equal(mobileTextStyle(element,range,key).kind,'mixed',key);
 assert.deepEqual(mobileTextStyle(element,{...range,start:7,end:13},'fontSize'),{kind:'value',value:36});
 assert.deepEqual(mobileTextStyle(element,{...range,start:13,end:14},'fontFamily'),{kind:'value',value:'Arial'});
 assert.equal(mobileTextStyle(element,{kind:'unsupported',reason:'stale'},'fontSize').kind,'unsupported');
 const uniform={...element,textRuns:[{start:7,end:13,style:{textColor:'#000000'}}]};
 assert.deepEqual(mobileTextStyle(uniform,range,'textColor'),{kind:'value',value:'#000000'});
 assert.deepEqual(mobileTextStyle(uniform,range,'fontVariant'),{kind:'value',value:'400:normal'});
});

async function gestureHarness(){
 const source=await readFile(new URL('../src/editor.js',import.meta.url),'utf8');
 const e={id:'one',type:'text',text:'Первое Второе\n😀',fontSize:24,fontWeight:'400',autoFontSize:false,textRuns:[{start:7,end:13,style:{fontSize:36,underline:true}}]};
 const doc={id:'doc',type:'card',activeSlideIndex:0,elements:[e],slides:[{elements:[structuredClone(e)]}]};
 const session=createInlineHistory(e),app={doc,inlineSession:session,editingId:e.id,inlineCaret:{start:0,end:6,direction:'backward'}};
 const editor={value:e.text},context={app,Intl,Set,document:{activeElement:null},mobileV36State:{tool:null},mobileV36Small:()=>true,active:()=>app.doc.elements[0],$:()=>editor,isLayerLocked:e=>e.locked,supportsHorizontalTextLayout:()=>true,
  clone:structuredClone,applyTextStyle,retainRichTextSizeBase,mobileTextStyle,autoFitTextFont:()=>{},positionInlineText:()=>{},restoreInlineCaret:()=>{},updateHistoryButtons:()=>{},paint:()=>{},toast:()=>{},syncCurrentSlide:()=>{doc.slides[0].elements=structuredClone(doc.elements)},
  restoreTextRuns:(e,r)=>{if(r?.length)e.textRuns=structuredClone(r);else delete e.textRuns},
  saveSoon:()=>{},recordInlineSession:()=>{if(!vm.runInContext('mobileTextGesture',context))recordInlineHistory(session,e,app.inlineCaret)}};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('let mobileTextGesture=null'),source.indexOf('function inlineStyleRange()')),context);
 vm.runInContext('mobileTextSession={doc:app.doc,element:active(),text:active().text,revision:1,caret:{...app.inlineCaret}};mobileTextPanelOwner={doc:app.doc,element:active(),session:mobileTextSession,revision:1}',context);
 const preview=(key,value,final=false)=>context.mobileTextPreviewGesture(key,value,final,context.mobileTextTarget(key));
 return {context,preview,e,doc,session,app,run:code=>vm.runInContext(code,context)};
}

test('actual range lifecycle: 50 previews, save barrier, idempotent finish, exact Undo/Redo, independent gestures',async()=>{
 const {context:c,preview,e,doc,session}=await gestureHarness(),before=structuredClone(e);
 for(let i=0;i<50;i++)preview('fontSize',25+i);
 assert.equal(session.states.length,1);assert.equal(e.textRuns[0].style.fontSize,74);
 const confirmed=c.mobileTextConfirmedDocument(doc);assert.deepEqual(confirmed.elements,[before]);assert.deepEqual(confirmed.slides[0].elements,[before]);
 c.mobileTextFinishGesture();c.mobileTextFinishGesture();preview('fontSize',74,true);
 assert.equal(session.states.length,2);const after=structuredClone(e);
 assert.deepEqual(moveInlineHistory(session,-1).element,before);assert.deepEqual(moveInlineHistory(session,1).element,after);
 preview('fontSize',90);preview('fontSize',100,true);assert.equal(session.states.length,3);
 assert.deepEqual(moveInlineHistory(session,-1).element,after);
});

for(const interruption of ['cancel','locked','revision','composition','range','document','session','element'])test(`actual gesture rollback: ${interruption}`,async()=>{
 const {context:c,preview,e,doc,session,app,run}=await gestureHarness(),before=structuredClone(e);
 preview('letterSpacing',2);preview('letterSpacing',3);assert.notDeepEqual(e,before);
 if(interruption==='locked')e.locked=true;
 if(interruption==='revision')run('mobileTextSession.revision++');
 if(interruption==='composition')run('mobileTextSession.composing=true');
 if(interruption==='range')run('mobileTextSession.caret.end=7');
 if(interruption==='document')app.doc={...doc};
 if(interruption==='session')app.inlineSession=createInlineHistory(e);
 if(interruption==='element')app.doc.elements=[{...e}];
 if(interruption==='cancel')c.mobileTextCancelGesture();else c.mobileTextFinishGesture();
 if(interruption==='locked')delete e.locked;
 assert.deepEqual(e,before);assert.equal(session.states.length,1);assert.equal(session.formatted,false);
});

test('no-op, invalid numeric/HEX and returning to original preview create no history',async()=>{
 for(const [key,value] of [['fontSize',24],['fontSize',''],['fontSize',501],['fontSize',NaN],['letterSpacing','Смешано'],['textColor','Mixed']]){
  const {preview,session}=await gestureHarness();preview(key,value,true);assert.equal(session.states.length,1,`${key} ${value}`);
 }
 const {preview,context:c,e,session}=await gestureHarness(),before=structuredClone(e);
 preview('fontSize',50);preview('fontSize',24);c.mobileTextFinishGesture();assert.deepEqual(e,before);assert.equal(session.states.length,1);
 preview('fontSize',50);preview('fontSize','',true);assert.deepEqual(e,before);assert.equal(session.states.length,1);
});

test('font-size previews retain reference units and unselected neighbors; failed preview restores the origin',async()=>{
 const {context:c,preview,e,session}=await gestureHarness();e.textRunsBaseFontSize=12;
 session.states[0].element=structuredClone(e);const before=structuredClone(e);
 for(let i=30;i<=60;i++)preview('fontSize',i);
 assert.equal(e.textRuns.find(r=>r.start===0).style.fontSize,30);
 assert.deepEqual(e.textRuns.find(r=>r.start===7),before.textRuns[0]);
 c.mobileTextCancelGesture();assert.deepEqual(e,before);assert.equal(session.states.length,1);
 preview('letterSpacing',2);c.autoFitTextFont=()=>{throw Error('injected fit failure')};preview('letterSpacing',3);
 assert.deepEqual(e,before);assert.equal(session.states.length,1);
});

test('composition/beforeinput rollback can preserve the native selection without restoring offsets',async()=>{
 const {context:c,preview,e}=await gestureHarness(),before=structuredClone(e);let restored=0;
 c.restoreInlineCaret=()=>restored++;preview('letterSpacing',2);restored=0;
 c.mobileTextCancelGesture(false);assert.deepEqual(e,before);assert.equal(restored,0);
});

for(const key of ['letterSpacing','lineHeight','strokeWidth','textColor','stroke'])test(`shared range transaction settles ${key} once`,async()=>{
 const {context:c,preview,session,e}=await gestureHarness(),before=structuredClone(e);
 for(let i=0;i<30;i++)preview(key,key==='textColor'||key==='stroke'?'#123456':key==='lineHeight'?1.2+i*.01:1+i*.1);
 assert.equal(session.states.length,1);c.mobileTextFinishGesture();assert.equal(session.states.length,2);
 const result=structuredClone(e);assert.deepEqual(moveInlineHistory(session,-1).element,before);assert.deepEqual(moveInlineHistory(session,1).element,result);
});

test('mobile U/S query is scoped to a range; collapsed caret retains existing whole-layer Mixed toggle',async()=>{
 const source=await readFile(new URL('../src/editor.js',import.meta.url),'utf8');
 const element={id:'one',type:'text',text:'Первое Второе',mobileUnderline:true,textRuns:[{start:0,end:6,style:{underline:false}}]};
 let target={kind:'layer'},small=true;
 const c={start:10,end:10},context={app:{editingId:'one',inlineCaret:c},mobileV36Small:()=>small,active:()=>element,picked:()=>[element],richTextSpans,resolveRichTextStyle,mobileTextTarget:()=>target,mobileV36Style:key=>mobileTextStyle(element,target,key)};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function textDecorationState('),source.indexOf('function decorationButton(')),context);
 assert.equal(context.textDecorationState('underline'),'mixed');
 target={kind:'range',start:0,end:6};assert.equal(context.textDecorationState('underline'),false);
 target={kind:'range',start:0,end:13};assert.equal(context.textDecorationState('underline'),'mixed');
 target={kind:'unsupported'};assert.equal(context.textDecorationState('underline'),false);
 small=false;target={kind:'layer'};assert.equal(context.textDecorationState('underline'),'mixed');
});
