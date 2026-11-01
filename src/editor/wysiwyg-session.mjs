import {richTextSpans, resolveRichTextStyle, richTextFont, usesRichTextLayout, retainRichTextSizeBase} from '../render/rich-text-layout.mjs';
import {replaceText, applyTextStyle} from '../model/rich-text.mjs';
import {recordInlineHistory, moveInlineHistory} from '../model/inline-text-history.mjs';

const ctx = document.createElement('canvas').getContext('2d');
function lineHeight(layer, style) {
 ctx.font=richTextFont(style);const m=ctx.measureText('Mg');
 if(!Number.isFinite(m.fontBoundingBoxAscent)||!Number.isFinite(m.fontBoundingBoxDescent)||!(m.width>0))throw Error('Font metrics unavailable');
 return Math.max(style.fontSize*(layer.lineHeight||1.15),m.fontBoundingBoxAscent+m.fontBoundingBoxDescent)+'px';
}
export function eligibleWysiwyg(e, locked=false, available=()=>true, plainCompatible=()=>false) {
 if(new URLSearchParams(location.search).get('experimentalTextWysiwyg')!=='1'||matchMedia('(max-width:760px), (pointer:coarse)').matches||/Android|iPhone|iPad|AppleWebKit(?!.*(?:Chrome|Chromium|Edg))/i.test(navigator.userAgent))return false;
 if(locked||e.type!=='text'||(e.textMode&&e.textMode!=='horizontal')||e.autoFontSize||e.rotation||e.textPathId||e.mobileArcRadius||e.text.includes('\r')||(e.textAlign&&e.textAlign!=='left')||(e.verticalAlign&&e.verticalAlign!=='top'))return false;
 if((e.fillType&&e.fillType!=='solid')||e.maskSrc||e.mask||e.layerMaskSrc||e.clipped||e.strokeWidth||(e.effects||[]).some(f=>f.enabled!==false)||e.flipX||e.flipY||(e.blendMode&&!['normal','source-over'].includes(e.blendMode))||(e.opacity??100)!==100||(e.fillOpacity??100)!==100)return false;
 if(!usesRichTextLayout(e)&&!plainCompatible(e))return false;
 try {return [resolveRichTextStyle(e),...richTextSpans(e).map(p=>p.style)].every(s=>available(s.fontFamily)&&document.fonts.check(richTextFont(s))&&!!lineHeight(e,s));}catch{return false;}
}

// Canonical layer + the editor's existing session history own all confirmed data.
// Unknown DOM remains on screen until explicit recovery; it is never persisted.
export function createWysiwygSession({host, element, history, onChange, onFallback, onRecovery, available=()=>true, plainCompatible=()=>false}) {
 const startedPlain=!usesRichTextLayout(element);
 let layer=element, composing=false, pending=null, fallback=null, pasteText=null, confirmedHTML, inactive=false;
 const safe={phase:'confirmed', deferred:false};
 let savedSelection=null, preview=null;
 const abort=new AbortController(), listen=(name,fn)=>host.addEventListener(name,fn,{signal:abort.signal});
 function selectionInside(){const s=getSelection();return host.contains(s.anchorNode)&&host.contains(s.focusNode);}
 function stop(reason){pending=null;pasteText=null;fallback=reason;safe.phase='recovery-required';if(!inactive)onRecovery(reason);}
 function project(value,selection){
  if(selection?.start!==undefined)selection={anchor:selection.direction==='backward'?selection.end:selection.start,focus:selection.direction==='backward'?selection.start:selection.end};
  // Prepare every metric and node before touching the canonical layer or DOM.
  const base=resolveRichTextStyle(value),spans=richTextSpans(value);
  const styles=[base,...spans.map(p=>p.style)];
  for(const style of styles)if(!available(style.fontFamily)||!document.fonts.check(richTextFont(style)))throw Error('Font unavailable');
  const heights=styles.map(style=>lineHeight(value,style));
  const nodes=spans.map((p,i)=>{const span=document.createElement('span');span.textContent=p.text;Object.assign(span.style,{font:richTextFont(p.style),lineHeight:heights[i+1],letterSpacing:p.style.letterSpacing+'px',color:p.style.textColor});return span;});
  const next=structuredClone(value);
  for(const key of Object.keys(element))delete element[key];Object.assign(element,next);layer=element;
  Object.assign(host.style,{font:richTextFont(base),lineHeight:heights[0],letterSpacing:base.letterSpacing+'px'});
  host.replaceChildren(...nodes);
  if(!host.childNodes.length)host.append(document.createTextNode(''));
  if(!layer.text||layer.text.endsWith('\n')){const br=document.createElement('br');br.dataset.caretSentinel='';host.append(br);}
  confirmedHTML=host.innerHTML;
  // setBaseAndExtent focuses contenteditable in Chromium and would blur a
  // numeric/HEX input (emitting change in the middle of its input callback).
  // Keep the range in UTF-16 while a panel owns focus; restore on host focus.
  savedSelection={...selection};
  if(document.activeElement===host)setSelection(selection.anchor,selection.focus);
 }
 function clean(){try{return !composing&&!pending&&!fallback&&!safe.deferred&&host.innerHTML===confirmedHTML&&readText()===layer.text;}catch{return false;}}
 const caret=c=>({start:Math.min(c.anchor,c.focus),end:Math.max(c.anchor,c.focus),direction:c.anchor>c.focus?'backward':'forward'});
 function commit(value,before,after){recordInlineHistory(history,layer,caret(before));recordInlineHistory(history,value,caret(after));project(value,after);onChange();}
 function travel(direction){finishPreview();if(!clean()){stop('История недоступна до восстановления ввода');return;}const state=moveInlineHistory(history,direction);if(state){project(state.element,state.caret);onChange();}}
 function requestFallback(reason){
  if(!clean()){stop('Нужно восстановить подтверждённый ввод');return false;}
  finishPreview();
  let selection;try{selection=rememberSelection();}catch{stop('Не удалось сохранить выделение');return false;}
  onFallback(selection,reason);return true;
 }
 function finishPreview(){
  if(!preview)return;
  recordInlineHistory(history,layer,caret(preview.selection));preview=null;onChange();
 }
 function applyRangeStyle(patch,{key,final=false}={}){
  if(!clean()||safe.phase!=='confirmed'||inactive){stop('Нужно восстановить подтверждённый ввод');return true;}
  let selection;try{selection=rememberSelection();}catch{return false;}
  if(selection.anchor===selection.focus)return false;
  if(preview&&(preview.key!==key||preview.selection.anchor!==selection.anchor||preview.selection.focus!==selection.focus))finishPreview();
  const origin=preview?.element||structuredClone(layer);
  if(startedPlain&&!usesRichTextLayout(origin)&&!plainCompatible(origin))return false;
  const next=applyTextStyle(origin,Math.min(selection.anchor,selection.focus),Math.max(selection.anchor,selection.focus),patch);
  retainRichTextSizeBase(next);
  // project preflights fonts and metrics; a failure leaves layer/history intact.
  try{project(next,selection);}catch{return false;}
  if(!preview){recordInlineHistory(history,origin,caret(selection));preview={key,element:origin,selection};}
  if(final)finishPreview();else onChange();
  return true;
 }
 listen('paste',e=>{pasteText=e.clipboardData?.getData('text/plain')??null;});
 listen('compositionstart',()=>{composing=true;safe.deferred=true;safe.phase='composing';onRecovery('IME: завершите композицию, затем восстановите подтверждённый текст');});
 listen('compositionend',()=>{composing=false;if(inactive)host.contentEditable='false';stop('Результат IME требует явного восстановления');});
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
const readText=()=>index().text;
function domPointToOffset(node,offset){
 const map=index();
 if(node.nodeType===3){const leaf=map.leaves.find(p=>p.node===node);if(leaf&&offset>=0&&offset<=node.length)return leaf.start+offset;}
 else {const offsets=map.points.get(node);if(offsets&&offset>=0&&offset<offsets.length)return offsets[offset];}
 throw Error('Point outside candidate surface');
}
function offsetToDomPoint(offset){
 const map=index();if(!Number.isInteger(offset)||offset<0||offset>map.text.length)throw Error('Invalid UTF-16 offset');
 // Prefer the structural end position for the final empty row.
 const sentinel=host.querySelector(':scope > br[data-caret-sentinel]');
 if(sentinel&&offset===map.text.length)return {node:host,offset:[...host.childNodes].indexOf(sentinel)};
 const leaves=[...map.leaves].reverse();
 const leaf=leaves.find(p=>offset>=p.start&&offset<=p.end);
 if(leaf)return {node:leaf.node,offset:offset-leaf.start};
 for(const [node,offsets] of map.points){const i=offsets.indexOf(offset);if(i>=0)return {node,offset:i};}
 throw Error('Unmapped offset');
}
function validSelection(c,text=layer.text){
 const split=i=>i>0&&i<text.length&&/[\uD800-\uDBFF]/.test(text[i-1])&&/[\uDC00-\uDFFF]/.test(text[i]);
 return c&&[c.anchor,c.focus].every(i=>Number.isInteger(i)&&i>=0&&i<=text.length&&!split(i));
}
function readSelection(){const s=getSelection();const c={anchor:domPointToOffset(s.anchorNode,s.anchorOffset),focus:domPointToOffset(s.focusNode,s.focusOffset)};if(!validSelection(c,index().text))throw Error('Invalid selection');return c;}
function rememberSelection(){
 // Only this host may update its saved UTF-16 selection. Never inspect panel
 // input selection, even if the browser retains a DOM range in the host.
 if(document.activeElement===host&&clean())savedSelection=readSelection();
 if(!validSelection(savedSelection))throw Error('No confirmed selection');
 return {...savedSelection};
}
function setSelection(anchor,focus=anchor){const c={anchor,focus};if(!validSelection(c))throw Error('Invalid selection');const a=offsetToDomPoint(anchor),f=offsetToDomPoint(focus);getSelection().setBaseAndExtent(a.node,a.offset,f.node,f.offset);savedSelection=c;}
listen('focusout',()=>{if(selectionInside()&&clean()){try{savedSelection=readSelection();}catch{}}});
listen('focus',()=>{if(validSelection(savedSelection)&&clean())setSelection(savedSelection.anchor,savedSelection.focus);});
listen('beforeinput',e=>{
 finishPreview();
 if(inactive){if(e.cancelable&&!composing&&!e.isComposing)e.preventDefault();return;}
 {
  if(safe.phase==='recovery-required'){if(e.cancelable&&!composing&&!e.isComposing)e.preventDefault();return;}
  if(composing||e.isComposing){safe.deferred=true;safe.phase='composing';return;}
  if(pending){if(e.cancelable)e.preventDefault();stop('overlapping beforeinput');return;}
  if(!['insertLineBreak','insertText','insertFromPaste','deleteContentBackward','deleteContentForward','historyUndo','historyRedo'].includes(e.inputType)){
   if(e.cancelable){e.preventDefault();requestFallback('canceled unsupported intent');}
   else stop('noncancelable unsupported intent');
   return;
  }
 }
 if(['historyUndo','historyRedo'].includes(e.inputType)){
  if(!e.cancelable){stop('noncancelable history requires fallback');return;}
  e.preventDefault();
  if(!e.isComposing)travel(e.inputType==='historyUndo'?-1:1);
  return;
 }
 if(fallback)return;
 pending=null;
 if(composing||e.isComposing){stop('composition requires fallback');return;}
 if(!e.cancelable){stop('noncancelable beforeinput requires fallback');return;}
 if(!selectionInside()){stop('selection outside host');return;}
 if(layer.text.includes('\r')){stop('legacy CR requires fallback');return;}
 let selection;
 try{if(readText()!==layer.text||host.innerHTML!==confirmedHTML){stop('DOM differs from canonical state');return;}selection=readSelection();}
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

  safe.phase='confirmed';
  if(startedPlain&&!usesRichTextLayout(layer)&&!plainCompatible(layer))requestFallback('Изменилась раскладка обычного текста');
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
 safe.phase='pending';
});
listen('input',e=>{
 if(inactive||composing||e.isComposing||safe.deferred)return;
 if(fallback)return;
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

  safe.phase='confirmed';
  if(startedPlain&&!usesRichTextLayout(layer)&&!plainCompatible(layer))requestFallback('Изменилась раскладка обычного текста');
 }catch{stop('unsupported native DOM or selection');}
});

 host.contentEditable='plaintext-only';host.classList.remove('hidden');
 const initial={anchor:layer.text.length,focus:layer.text.length};project(structuredClone(layer),initial);recordInlineHistory(history,layer,caret(initial));
 return {get composing(){return composing;},travel,readSelection,rememberSelection,setSelection,requestFallback,clean,applyRangeStyle,finishPreview,
  preserve(){inactive=true;pending=null;if(!composing)host.contentEditable='false';},
  focus(){host.focus({preventScroll:true});},
  recover(){if(composing)return false;pending=null;fallback=null;safe.deferred=false;safe.phase='confirmed';project(structuredClone(layer),{anchor:layer.text.length,focus:layer.text.length});onChange();return true;},
  dispose(){abort.abort();host.classList.add('hidden');}
 };
}
