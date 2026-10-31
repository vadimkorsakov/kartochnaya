// Test-only candidate; never imported by the editor or persisted as HTML.
import {richTextSpans,resolveRichTextStyle,richTextFont,createRichTextLayoutEngine} from '../../src/render/rich-text-layout.mjs';
import {replaceText} from '../../src/model/rich-text.mjs';
import {createInlineHistory,recordInlineHistory,moveInlineHistory} from '../../src/model/inline-text-history.mjs';
const host=document.querySelector('#host');
const textarea=document.querySelector('#fallback');
const ctx=document.createElement('canvas').getContext('2d');
const engine=createRichTextLayoutEngine(ctx,document.fonts);
let composing=false,layer,nativeTrace=false,controlledEnter=false,terminalMarker=false,metricLineHeight=false,pending=null,fallback=null,pasteText=null;
let history=null,sessionSelection=null;
let safe=null,confirmedHTML=null;
export const historyState=()=>history?{length:history.states.length,index:history.index}:null;
export const applications=[];
export const controlledState=()=>({value:structuredClone(layer),fallback,applications:[...applications]});
function trace(){try{return {html:host.innerHTML,text:readText(),selection:selectionInside()?readSelection():null};}catch{return {html:host.innerHTML,unsupported:true};}}
function selectionInside(){const s=getSelection();return host.contains(s.anchorNode)&&host.contains(s.focusNode);}
export const events=[];
for(const name of ['beforeinput','input','compositionstart','compositionupdate','compositionend'])host.addEventListener(name,e=>{
 events.push({type:name,inputType:e.inputType,cancelable:e.cancelable,isComposing:e.isComposing,...(nativeTrace?{data:e.data,...trace()}:{})});
 if(name==='compositionstart')composing=true;
 if(name==='compositionend')composing=false;
 if(safe&&name==='compositionstart'){safe.phase='composing';safe.deferred=true;}
 if(safe&&name==='compositionend'){
  safe.phase='pending';
  const session=safe;
  // A timer cannot prove the absence of a later final input. This spike has
  // no verified IME reconciliation contract: preserve the host for recovery.
  setTimeout(()=>{if(safe===session&&safe.deferred&&!composing)stop('composition outcome has no verified input contract');},0);
 }
});
// Opt-in stateful projection. Unknown operations stop reconciliation until an
// explicit mount; the canonical value remains available for a textarea fallback.
function stop(reason){pending=null;pasteText=null;fallback=reason;if(safe){safe.phase='recovery-required';safe.reason=reason;}}
host.addEventListener('paste',e=>{
 if(controlledEnter)pasteText=e.clipboardData?.getData('text/plain')??null;
});
function project(value,selection){
 if(safe?.mode==='textarea'){
  layer=structuredClone(value);textarea.value=layer.text;setTextareaSelection(selection);
  safe.selection=selection;return;
 }
 const savedSafe=safe;
 const metric=metricLineHeight,savedHistory=history,savedSessionSelection=sessionSelection;
 mount(value,{terminalBr:terminalMarker,controlledEnter:true});
 history=savedHistory;sessionSelection=savedSessionSelection;safe=savedSafe;
 if(safe)safe.selection=selection;
 if(metric)applyMetricLineHeight();
 setSelection(selection.anchor,selection.focus);
}
// Only confirmed operations update history. Refresh the preceding state's caret
// at commit time, so cursor movement alone neither records nor prunes Redo.
function commit(value,before,after){
 if(history){recordInlineHistory(history,layer,before);recordInlineHistory(history,value,after);}
 project(value,after);
}
function travel(direction){
 if(fallback||composing||pending||safe?.phase==='recovery-required')return;
 if(safe?.mode==='textarea'){
  if(textarea.value!==layer.text){stop('unconfirmed textarea');return;}
  const state=moveInlineHistory(history,direction);if(state)project(state.element,state.caret);return;
 }
 try{
  if(readText()!==layer.text||(safe&&host.innerHTML!==confirmedHTML)){stop('DOM differs from canonical state');return;}
  if(safe){if(!selectionInside())throw Error('selection outside host');readSelection();}
 }
 catch{stop('unsupported DOM');return;}
 const state=moveInlineHistory(history,direction);
 if(state)project(state.element,state.caret);
}
export function cancel(){
 if(!history||composing||(safe&&layer.text.includes('\r')))return false;
 pending=null;
 const original=history.states[0].element,selection=sessionSelection;
 project(original,selection);
 history=createInlineHistory(original);recordInlineHistory(history,original,selection);
 if(safe){safe.phase='confirmed';safe.reason=null;safe.deferred=false;safe.replayNeeded=null;safe.selection=selection;fallback=null;}
 return true;
}
function historyKey(e){
 if(!history)return;
 if(e.key==='Escape'){e.preventDefault();cancel();return;}
 const key=e.key.toLowerCase();
 if(e.ctrlKey&&!e.altKey&&!e.metaKey&&(key==='z'||key==='y')){
  // Cancel the browser default even at history boundaries and after fallback.
  // Consequently this key cannot also produce native history beforeinput.
  e.preventDefault();travel(key==='y'||e.shiftKey?1:-1);
 }
}
host.addEventListener('keydown',historyKey,{capture:true});
textarea.addEventListener('keydown',historyKey,{capture:true});
host.addEventListener('beforeinput',e=>{
 if(safe){
  if(safe.mode!=='wysiwyg'||safe.phase==='recovery-required'){if(e.cancelable&&!composing&&!e.isComposing)e.preventDefault();return;}
  if(composing||e.isComposing){safe.deferred=true;safe.phase='composing';return;}
  if(pending){if(e.cancelable)e.preventDefault();stop('overlapping beforeinput');return;}
  if(!['insertLineBreak','insertText','insertFromPaste','deleteContentBackward','deleteContentForward','historyUndo','historyRedo'].includes(e.inputType)){
   if(e.cancelable){e.preventDefault();safe.replayNeeded={inputType:e.inputType,data:e.data};requestFallback('canceled unsupported intent');}
   else stop('noncancelable unsupported intent');
   return;
  }
 }
 if(history&&['historyUndo','historyRedo'].includes(e.inputType)){
  if(!e.cancelable){stop('noncancelable history requires fallback');return;}
  e.preventDefault();
  if(!e.isComposing)travel(e.inputType==='historyUndo'?-1:1);
  return;
 }
 if(!controlledEnter||fallback)return;
 pending=null;
 if(composing||e.isComposing){stop('composition requires fallback');return;}
 if(!e.cancelable){stop('noncancelable beforeinput requires fallback');return;}
 if(!selectionInside()){stop('selection outside host');return;}
 if(layer.text.includes('\r')){stop('legacy CR requires fallback');return;}
 let selection;
 try{if(readText()!==layer.text||(safe&&host.innerHTML!==confirmedHTML)){stop('DOM differs from canonical state');return;}selection=readSelection();}
 catch{stop('unsupported DOM');return;}
 const start=Math.min(selection.anchor,selection.focus),end=Math.max(selection.anchor,selection.focus);
 // replaceText expands surrogate boundaries; refuse a split-pair caret rather
 // than restoring an offset inconsistent with the required min(anchor,focus)+1.
 const split=i=>i>0&&i<layer.text.length&&/[\uD800-\uDBFF]/.test(layer.text[i-1])&&/[\uDC00-\uDFFF]/.test(layer.text[i]);
 if(split(start)||split(end)){stop('selection splits surrogate pair');return;}
 if(e.inputType==='insertLineBreak'){
  e.preventDefault();
  const next=replaceText(layer,start,end,'\n');
  commit(next,selection,{anchor:start+1,focus:start+1});
  applications.push({inputType:e.inputType,start,end,text:next.text});
  if(safe)safe.phase='confirmed';
  // A canceled operation has no pending native edit, even if an input is sent.
  return;
 }
 if(!['insertText','insertFromPaste','deleteContentBackward','deleteContentForward'].includes(e.inputType)){
  stop('unsupported inputType: '+e.inputType);return;
 }
 const data=e.inputType==='insertFromPaste'?(e.dataTransfer?.getData('text/plain')??pasteText):e.data;
 pasteText=null;
 if(e.inputType==='insertFromPaste'&&data===null){stop('paste without plaintext context');return;}
 pending={value:layer,selection,start,end,inputType:e.inputType,data};
 if(safe)safe.phase='pending';
});
host.addEventListener('input',e=>{
 if(safe&&(safe.mode!=='wysiwyg'||composing||e.isComposing||safe.deferred))return;
 if(!controlledEnter||fallback)return;
 const previous=pending;pending=null;
 if(composing||e.isComposing){stop('composition requires fallback');return;}
 // Never reapply a controlled Enter from input. No pending transaction means
 // no native reconciliation (including a stray duplicate input event).
 if(!previous){
  try{if(readText()!==layer.text)stop('input without beforeinput context');}catch{stop('unsupported native DOM');}
  return;
 }
 if(previous.inputType!==e.inputType){stop('input context mismatch');return;}
 try{
  const text=readText(),selection=readSelection(),old=previous.value.text;
  let {start,end}=previous;
  if(e.inputType.startsWith('delete')&&start===end){
   const removed=old.length-text.length;
   if(removed<0){stop('unsupported native deletion');return;}
   if(e.inputType==='deleteContentBackward')start-=removed;else end+=removed;
  }
  const insertedEnd=text.length-(old.length-end);
  if(start<0||end>old.length||insertedEnd<start||old.slice(0,start)!==text.slice(0,start)||old.slice(end)!==text.slice(insertedEnd)){
   stop('native edit outside previous selection');return;
  }
  const inserted=text.slice(start,insertedEnd);
  if((['insertText','insertFromPaste'].includes(e.inputType)&&inserted!==previous.data)||(e.inputType.startsWith('delete')&&inserted!=='')){
   stop('native edit differs from input context');return;
  }
  const next=replaceText(previous.value,start,end,inserted);
  if(next.text!==text){stop('native UTF-16 edit mismatch');return;}
  commit(next,previous.selection,selection);
  applications.push({inputType:e.inputType,start,end,text:next.text});
  if(safe)safe.phase='confirmed';
 }catch{stop('unsupported native DOM or selection');}
});
// Safe fallback owns no text model or history: all confirmed data stays in
// layer + the existing inline history. Recovery never projects unverified DOM.
function textareaSelection(){
 const a=textarea.selectionStart,f=textarea.selectionEnd;
 return textarea.selectionDirection==='backward'?{anchor:f,focus:a}:{anchor:a,focus:f};
}
function setTextareaSelection({anchor,focus}){
 textarea.setSelectionRange(Math.min(anchor,focus),Math.max(anchor,focus),anchor>focus?'backward':'forward');
}
export function fallbackState(){
 return safe?{...structuredClone(safe),pending:!!pending,composing,
  confirmed:{value:structuredClone(layer),selection:structuredClone(safe.selection),history:structuredClone(history)},
  textarea:{value:textarea.value,selection:textareaSelection(),hidden:textarea.hidden,readOnly:textarea.readOnly},
  host:{html:host.innerHTML,hidden:host.hidden,focused:document.activeElement===host}}:null;
}
export function requestFallback(reason='explicit request'){
 if(!safe)throw Error('safeFallback is opt-in');
 if(safe.mode==='textarea'||safe.phase==='recovery-required')return fallbackState();
 if(composing||safe.phase==='composing'){safe.deferred=true;safe.phase='composing';return fallbackState();}
 if(safe.deferred){stop('composition outcome has no verified input contract');return fallbackState();}
 if(pending){stop('pending browser operation');return fallbackState();}
 let selection;
 try{
  if(readText()!==layer.text||host.innerHTML!==confirmedHTML)throw Error('unconfirmed DOM');
  if(!selectionInside())throw Error('selection outside host');
  selection=readSelection();
 }catch(error){stop(error.message);return fallbackState();}
 safe.phase='fallback-ready';safe.selection=selection;safe.reason=reason;safe.deferred=false;
 textarea.value=layer.text;
 if(textarea.value!==layer.text){stop('textarea value normalization');return fallbackState();}
 setTextareaSelection(selection);
 host.contentEditable='false';host.hidden=true;textarea.hidden=false;
 safe.mode='textarea';safe.switches++;textarea.focus();
 return fallbackState();
}
textarea.addEventListener('paste',e=>{pasteText=e.clipboardData?.getData('text/plain')??null;});
for(const name of ['compositionstart','compositionend'])textarea.addEventListener(name,()=>{
 composing=name==='compositionstart';
 if(safe)stop('textarea composition requires recovery; native text preserved');
});
textarea.addEventListener('beforeinput',e=>{
 if(!safe||safe.mode!=='textarea')return;
 if(composing||e.isComposing){stop('textarea composition requires recovery');return;}
 if(!e.cancelable){stop('noncancelable textarea operation');return;}
 e.preventDefault();
 if(safe.phase==='recovery-required')return;
 if(textarea.value!==layer.text){stop('unconfirmed textarea');return;}
 if(['historyUndo','historyRedo'].includes(e.inputType)){travel(e.inputType==='historyUndo'?-1:1);return;}
 let inserted;
 if(e.inputType==='insertText')inserted=e.data;
 if(['insertLineBreak','insertParagraph'].includes(e.inputType))inserted='\n';
 if(e.inputType==='insertFromPaste')inserted=e.dataTransfer?.getData('text/plain')??pasteText;
 pasteText=null;
 const before=textareaSelection();let start=Math.min(before.anchor,before.focus),end=Math.max(before.anchor,before.focus);
 const split=i=>i>0&&i<layer.text.length&&/[\uD800-\uDBFF]/.test(layer.text[i-1])&&/[\uDC00-\uDFFF]/.test(layer.text[i]);
 if(split(start)||split(end)){safe.replayNeeded={inputType:e.inputType};return;}
 if(['deleteContentBackward','deleteContentForward'].includes(e.inputType)){
  inserted='';
  if(start===end){
   if(e.inputType==='deleteContentBackward'){start=Math.max(0,start-1);if(split(start))start--;}
   else {end=Math.min(layer.text.length,end+1);if(split(end))end++;}
  }
 }
 if(typeof inserted!=='string'||inserted.includes('\r')){safe.replayNeeded={inputType:e.inputType,data:e.data};return;}
 const next=replaceText(layer,start,end,inserted),caret=start+inserted.length;
 commit(next,before,{anchor:caret,focus:caret});safe.phase='confirmed';
 applications.push({inputType:e.inputType,start,end,text:next.text});
});
textarea.addEventListener('input',()=>{
 if(safe&&textarea.value!==layer.text)stop('textarea input without verified contract');
});
// A deliberately restricted candidate grammar: Text/span and BR only. Unknown
// block DOM fails explicitly instead of silently corrupting canonical offsets.
function index(){
 let text='';const points=new Map(),leaves=[];
 function visit(node){
  const start=text.length;
  if(node.nodeType===3){text+=node.data;leaves.push({node,start,end:text.length});return;}
  if(node!==host&&!['SPAN','BR'].includes(node.nodeName))throw Error('Unsupported native DOM: '+node.nodeName);
  const offsets=[text.length];
  if(node.nodeName==='BR'){
   if(node.hasAttribute('data-caret-sentinel')){points.set(node,offsets);return;}
   // A sole or final BR after another BR is the browser's empty-line sentinel.
   if(node.nextSibling || (node.previousSibling && node.previousSibling.nodeName!=='BR' && !text.endsWith('\n')))text+='\n';
  }else for(const child of node.childNodes){visit(child);offsets.push(text.length);}
  points.set(node,offsets);
 }
 visit(host);return {text,points,leaves};
}
export const readText=()=>index().text;
export function domPointToOffset(node,offset){
 const map=index();
 if(node.nodeType===3){const leaf=map.leaves.find(p=>p.node===node);if(leaf&&offset>=0&&offset<=node.length)return leaf.start+offset;}
 else {const offsets=map.points.get(node);if(offsets&&offset>=0&&offset<offsets.length)return offsets[offset];}
 throw Error('Point outside candidate surface');
}
export function offsetToDomPoint(offset,affinity='downstream'){
 const map=index();if(!Number.isInteger(offset)||offset<0||offset>map.text.length)throw Error('Invalid UTF-16 offset');
 // Prefer the structural end position for the final empty row. Upstream
 // deliberately retains the text-node endpoint for affinity diagnostics.
 const sentinel=host.querySelector(':scope > br[data-caret-sentinel]');
 if(sentinel&&offset===map.text.length&&affinity==='downstream')return {node:host,offset:[...host.childNodes].indexOf(sentinel)};
 const leaves=affinity==='downstream'?[...map.leaves].reverse():map.leaves;
 const leaf=leaves.find(p=>offset>=p.start&&offset<=p.end);
 if(leaf)return {node:leaf.node,offset:offset-leaf.start};
 for(const [node,offsets] of map.points){const i=offsets.indexOf(offset);if(i>=0)return {node,offset:i};}
 throw Error('Unmapped offset');
}
export function readSelection(){const s=getSelection();return {anchor:domPointToOffset(s.anchorNode,s.anchorOffset),focus:domPointToOffset(s.focusNode,s.focusOffset)};}
export function setSelection(anchor,focus=anchor){const a=offsetToDomPoint(anchor),f=offsetToDomPoint(focus);getSelection().setBaseAndExtent(a.node,a.offset,f.node,f.offset);}
export function mount(value,{terminalBr=false,controlledEnter:controlled=false,controlledHistory=false,safeFallback=false,selection:initialSelection=null}={}){
 if(composing)return false;
 let saved=null;try{if(selectionInside())saved=readSelection();}catch{/* Explicit mount can recover unsupported DOM. */}
 history=null;sessionSelection=null;safe=null;
 host.hidden=false;host.contentEditable=safeFallback&&value.text.includes('\r')?'false':'plaintext-only';textarea.hidden=true;textarea.readOnly=false;
 controlledEnter=controlled;terminalMarker=terminalBr;pending=null;fallback=null;pasteText=null;metricLineHeight=false;
 nativeTrace=terminalBr||controlled;
 layer=structuredClone(value);
 if(safeFallback){
  if(!controlled||!controlledHistory)throw Error('safeFallback requires controlledEnter and controlledHistory');
  safe={mode:'wysiwyg',phase:'confirmed',reason:null,replayNeeded:null,deferred:false,switches:0,selection:initialSelection||saved||{anchor:layer.text.length,focus:layer.text.length}};
  if(layer.text.includes('\r')){
   // Native textarea normalizes CR/CRLF. Keep the exact model and caret,
   // expose the incompatibility, and refuse editing instead of a lossy handoff.
   history=createInlineHistory(layer);sessionSelection=structuredClone(safe.selection);recordInlineHistory(history,layer,sessionSelection);
   host.replaceChildren();host.contentEditable='false';host.hidden=true;
   textarea.value=layer.text;textarea.readOnly=true;textarea.hidden=false;
   stop('preflight: textarea normalizes CR/CRLF; exact value/UTF-16 handoff blocked');
   return true;
  }
 }
 const base=resolveRichTextStyle(layer);
 Object.assign(host.style,{width:layer.w+'px',height:layer.h+'px',font:richTextFont(base),lineHeight:String(layer.lineHeight||1.15),letterSpacing:base.letterSpacing+'px',textAlign:layer.textAlign||'left',transform:''});
 host.replaceChildren(...richTextSpans(layer).map(p=>{const el=document.createElement('span');el.textContent=p.text;Object.assign(el.style,{font:richTextFont(p.style),lineHeight:String(layer.lineHeight||1.15),letterSpacing:p.style.letterSpacing+'px',color:p.style.textColor});return el;}));
 if(!host.childNodes.length)host.append(document.createTextNode(''));
 if(terminalBr&&layer.text.endsWith('\n')){const br=document.createElement('br');br.dataset.caretSentinel='';host.append(br);}
 if(initialSelection)saved=initialSelection;
 if(saved)setSelection(Math.min(saved.anchor,readText().length),Math.min(saved.focus,readText().length));
 if(controlled&&controlledHistory){
  if(!saved)setSelection(layer.text.length);
  sessionSelection=readSelection();
  history=createInlineHistory(layer);recordInlineHistory(history,layer,sessionSelection);
 }
 confirmedHTML=host.innerHTML;
 if(safe)safe.selection=readSelection();
 return true;
}
export async function ready(){await Promise.all(['20px SpikeSans','700 20px SpikeSans','20px SpikeSerif'].map(font=>document.fonts.load(font)));await document.fonts.ready;}
// Diagnostic CSS only: preserve the mounted text, spans and Canvas engine.
export function applyMetricLineHeight(){
 if(safe&&(composing||safe.phase==='recovery-required'||host.innerHTML!==confirmedHTML))return [];
 metricLineHeight=true;
 const styles=[resolveRichTextStyle(layer),...richTextSpans(layer).map(p=>p.style)];
 const elements=[host,...host.querySelectorAll(':scope > span')];
 const metrics=elements.map((element,i)=>{
  const style=styles[i];ctx.font=richTextFont(style);
  const m=ctx.measureText('Mg'),ascent=m.fontBoundingBoxAscent,descent=m.fontBoundingBoxDescent;
  if(!Number.isFinite(ascent)||!Number.isFinite(descent))throw Error('Font bounding metrics unavailable');
  const height=Math.max(style.fontSize*(layer.lineHeight||1.15),ascent+descent);
  element.style.lineHeight=height+'px';
  return {font:ctx.font,fontSize:style.fontSize,ascent,descent,height,computed:getComputedStyle(element).lineHeight};
 });
 confirmedHTML=host.innerHTML;
 return metrics;
}
export function measure(){
 const layout=engine.layout(layer),origin=host.getBoundingClientRect(),dom=[],canvas=[];

 for(const [rowIndex,row] of layout.rows.entries())for(const part of row.fragments){
  ctx.font=richTextFont(part.style);ctx.fontKerning='normal';ctx.letterSpacing=part.style.letterSpacing+'px';
  for(const {segment,index:sourceIndex} of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(layer.text.slice(part.start,part.end))){
   if(segment==='\r')continue;
   const index=sourceIndex;
   const prefix=layer.text.slice(part.start,part.start+index).replaceAll('\r',''),end=prefix+segment,m=ctx.measureText(segment);
   canvas.push({start:part.start+index,end:part.start+index+segment.length,row:rowIndex,x:part.x+ctx.measureText(prefix).width,endX:part.x+ctx.measureText(end).width,top:part.y-(m.fontBoundingBoxAscent??m.actualBoundingBoxAscent),baseline:part.y,ascent:m.fontBoundingBoxAscent??m.actualBoundingBoxAscent});
  }

 }
 for(const {segment,index} of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(layer.text)){
  const a=offsetToDomPoint(index),b=offsetToDomPoint(index+segment.length,'upstream'),range=document.createRange();range.setStart(a.node,a.offset);range.setEnd(b.node,b.offset);
  const r=range.getBoundingClientRect();
  const css=getComputedStyle(a.node.nodeType===3?a.node.parentElement:a.node);
  ctx.font=richTextFont({fontFamily:css.fontFamily,fontStyle:css.fontStyle,fontWeight:css.fontWeight,fontSize:parseFloat(css.fontSize)});
  const metric=ctx.measureText(segment);const domBaseline=r.top-origin.top+(metric.fontBoundingBoxAscent??metric.actualBoundingBoxAscent);
  const caret=document.createRange();caret.setStart(a.node,a.offset);caret.collapse(true);const cr=caret.getClientRects()[0];
  caret.setStart(b.node,b.offset);caret.collapse(true);const er=caret.getClientRects()[0];
  dom.push({baseline:domBaseline,hardBreak:/^[\r\n]+$/.test(segment),start:index,end:index+segment.length,x:r.left-origin.left,endX:r.right-origin.left,top:r.top-origin.top,bottom:r.bottom-origin.top,caret:cr?{x:cr.left-origin.left,y:cr.top-origin.top}:null,endCaret:er?{x:er.left-origin.left,y:er.top-origin.top}:null});
 }
 // Glyph boxes can overlap across rows when CSS line-height is smaller
 // than font bounds. Infer native baselines from Range top + font ascent;
 // interval intersection would falsely merge those lines.
 let row=-1,baseline=-Infinity;
 for(const p of dom){if(Math.abs(p.baseline-baseline)>.25){row++;baseline=p.baseline;}p.row=row;}
 const glyphs=dom.filter(p=>!p.hardBreak);
 // Match by source intervals: ignored legacy CR must not shift all later pairs.
 const pairs=glyphs.flatMap(d=>{const c=canvas.find(c=>c.start===d.start&&c.end===d.end);return c?[{start:d.start,dom:d,canvas:c,dx:Math.abs(d.x-c.x),dy:Math.abs(d.top-c.top)}]:[];});
 // A soft-wrap offset has two legitimate visual positions. Compare a
 // collapsed native Range with both logical neighbours instead of treating
 // browser affinity as a geometry error. Keep the raw rects in pairs.
 const carets=pairs.flatMap(p=>[
  p.dom.caret&&{offset:p.dom.start,...p.dom.caret},
  p.dom.endCaret&&{offset:p.dom.end,...p.dom.endCaret},
 ].filter(Boolean).map(caret=>{
  const candidates=canvas.flatMap(c=>[
   c.start===caret.offset&&{x:c.x,y:c.top},c.end===caret.offset&&{x:c.endX,y:c.top},
  ].filter(Boolean));
  return candidates.map(c=>({dx:Math.abs(caret.x-c.x),dy:Math.abs(caret.y-c.y)}))
   .sort((a,b)=>Math.hypot(a.dx,a.dy)-Math.hypot(b.dx,b.dy))[0];
 }));
 const domRows=dom.reduce((rows,p)=>{rows[p.row]??=[];if(!p.hardBreak)rows[p.row].push([p.start,p.end]);return rows;},[]);
 if(/[\r\n]$/.test(layer.text))domRows.push([]);
 if(!domRows.length)domRows.push([]);
 // Explicit source intervals include empty rows and hard-break ownership.
 const domLines=[];let start=0;
 for(const entries of domRows){
  const end=entries.length?entries.at(-1)[1]:start;
  const hard=dom.find(p=>p.hardBreak&&p.start===end);
  const nextStart=hard?.end??end;
  domLines.push({start,end,nextStart,softWrap:!hard&&domLines.length<domRows.length-1});start=nextStart;
 }
 const canvasLines=layout.rows.map(({start,end,nextStart,softWrap})=>({start,end,nextStart,softWrap}));
 const rowProbes=domLines.map(line=>{
  const p=offsetToDomPoint(line.start),r=document.createRange();r.setStart(p.node,p.offset);r.collapse(true);
  return {offset:line.start,rects:[...r.getClientRects()].map(r=>({x:r.left-origin.left,y:r.top-origin.top,height:r.height}))};
 });
 // Probe every Canvas row in both DOM affinities, including empty/trailing
 // rows. Keep missing rects and wrong-row affinity; never substitute neighbours.
 const caretRowProbes=layout.rows.map((row,rowIndex)=>{
  const empty=row.start===row.end;
  const style=row.fragments[0]?.style||resolveRichTextStyle(layer);
  ctx.font=richTextFont(style);const m=ctx.measureText('Mg');
  const expected={x:row.fragments[0]?.x??(layer.textAlign==='center'?layer.w/2:layer.textAlign==='right'?layer.w:0),y:row.baseline-m.fontBoundingBoxAscent};
  const affinities=['upstream','downstream'].map(affinity=>{
   const p=offsetToDomPoint(row.start,affinity),r=document.createRange();r.setStart(p.node,p.offset);r.collapse(true);
   const rects=[...r.getClientRects()].map(r=>({x:r.left-origin.left,y:r.top-origin.top,height:r.height}));
   return {affinity,rects,deltas:rects.map(r=>({dx:Math.abs(r.x-expected.x),dy:Math.abs(r.y-expected.y)}))};
  });
  return {row:rowIndex,offset:row.start,empty,expected,affinities};
 });
 const css=getComputedStyle(host);ctx.font=css.font;const metrics=ctx.measureText('Mg');
 return {caretRowProbes,cssMetrics:{font:css.font,lineHeight:css.lineHeight,ascent:metrics.fontBoundingBoxAscent??metrics.actualBoundingBoxAscent,descent:metrics.fontBoundingBoxDescent??metrics.actualBoundingBoxDescent},rowProbes,unmatchedGlyphs:glyphs.length-pairs.length,text:readText(),domLines,canvasLines,domMetrics:dom,canvasMetrics:layout.rows,maxCaretDx:Math.max(0,...carets.map(p=>p.dx)),maxCaretDy:Math.max(0,...carets.map(p=>p.dy)),missingCaretRects:pairs.length*2-carets.length,domRows,canvasRows:layout.rows.map(row=>canvas.filter(p=>p.row===layout.rows.indexOf(row)).map(p=>[p.start,p.end])),maxDx:Math.max(0,...pairs.map(p=>p.dx)),maxDy:Math.max(0,...pairs.map(p=>p.dy)),pairs};
}
