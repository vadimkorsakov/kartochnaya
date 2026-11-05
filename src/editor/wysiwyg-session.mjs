import {richTextSpans, resolveRichTextStyle, richTextFont, usesRichTextLayout, retainRichTextSizeBase} from '../render/rich-text-layout.mjs';
import {replaceText, applyTextStyle} from '../model/rich-text.mjs';
import {recordInlineHistory, moveInlineHistory} from '../model/inline-text-history.mjs';

const ctx = document.createElement('canvas').getContext('2d');
function lineHeight(layer, style) {
 ctx.font=richTextFont(style);const m=ctx.measureText('Mg');
 if(!Number.isFinite(m.fontBoundingBoxAscent)||!Number.isFinite(m.fontBoundingBoxDescent)||!(m.width>0))throw Error('Font metrics unavailable');
 return Math.max(style.fontSize*(layer.lineHeight||1.15),m.fontBoundingBoxAscent+m.fontBoundingBoxDescent)+'px';
}
// CSS inline baselines need not equal Canvas fontBoundingBox baselines.
// Measure the actual inline baseline before positioning any editable glyphs.
function unifiedDOMOffset(base, projection, text) {
 const probe=document.createElement('div'),baseline=document.createElement('span');
 Object.assign(probe.style,{position:'fixed',left:'-100000px',top:'0',visibility:'hidden',padding:'0',margin:'0',border:'0',font:richTextFont(base),fontKerning:'normal',lineHeight:projection.height+'px',letterSpacing:base.letterSpacing+'px',whiteSpace:'break-spaces',width:'max-content'});
 baseline.style.cssText='display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline;line-height:0';
 probe.append(document.createTextNode(text.split('\n')[0]||'Mg'),baseline);document.body.append(probe);
 try {return projection.baseline-(baseline.getBoundingClientRect().bottom-probe.getBoundingClientRect().top);}
 finally {probe.remove();}
}
export function eligibleWysiwyg(e, locked=false, available=()=>true, plainCompatible=()=>false) {
 // Rich inline editing is the desktop default. The explicit =0 switch is
 // retained only for diagnosis and for fallback-focused regression tests.
 // A previous opt-in gate left normal users on plain textarea, making range
 // color/font/size changes invisible until the editor was closed.
 if(new URLSearchParams(location.search).get('experimentalTextWysiwyg')==='0'||matchMedia('(max-width:760px), (pointer:coarse)').matches||/Android|iPhone|iPad|AppleWebKit(?!.*(?:Chrome|Chromium|Edg))/i.test(navigator.userAgent))return false;
 if(locked||e.type!=='text'||(e.textMode&&e.textMode!=='horizontal')||e.rotation||e.textPathId||e.mobileArcRadius||e.text.includes('\r')||(e.textAlign&&e.textAlign!=='left')||(e.verticalAlign&&e.verticalAlign!=='top'))return false;
 if((e.fillType&&e.fillType!=='solid')||e.maskSrc||e.mask||e.layerMaskSrc||e.clipped||e.strokeWidth||(e.effects||[]).some(f=>f.enabled!==false)||e.flipX||e.flipY||(e.blendMode&&!['normal','source-over'].includes(e.blendMode))||(e.opacity??100)!==100||(e.fillOpacity??100)!==100)return false;
 // Auto-fit participates only while Canvas projects a single unwrapped row.
 if(e.autoFontSize&&!plainCompatible(e))return false;
 // Mixed-font/mixed-size hard rows are not enabled until baseline parity holds.
 if(e.text.includes('\n')&&!plainCompatible(e))return false;
 if(!usesRichTextLayout(e)&&!plainCompatible(e))return false;
 try {return [resolveRichTextStyle(e),...richTextSpans(e).map(p=>p.style)].every(s=>available(s.fontFamily)&&document.fonts.check(richTextFont(s))&&!!lineHeight(e,s));}catch{return false;}
}

// Canonical layer + the editor's existing session history own all confirmed data.
// Unknown DOM remains on screen until explicit recovery; it is never persisted.
export function createWysiwygSession({host, element, history, onChange, onFallback, onRecovery, available=()=>true, plainCompatible=()=>false, layout=()=>null, fit=()=>false}) {
 const startedPlain=!usesRichTextLayout(element);
 let layer=element, composing=false, pending=null, fallback=null, pasteText=null, confirmedHTML, inactive=false;
 const safe={phase:'confirmed', deferred:false};
 let savedSelection=null, preview=null;
 const abort=new AbortController(), listen=(name,fn)=>host.addEventListener(name,fn,{signal:abort.signal});
 function selectionInside(){const s=getSelection();return host.contains(s.anchorNode)&&host.contains(s.focusNode);}
 function stop(reason){pending=null;pasteText=null;fallback=reason;safe.phase='recovery-required';if(!inactive)onRecovery(reason);}
 function project(value,selection){
  // Probe measurements also attach temporary DOM nodes. Capture the owner
  // before any measurement, not just before replaceChildren: the browser can
  // reset its contenteditable Range while those probes are attached.
  const hadFocus=document.activeElement===host;
  if(selection?.start!==undefined)selection={anchor:selection.direction==='backward'?selection.end:selection.start,focus:selection.direction==='backward'?selection.start:selection.end};
  // Prepare every metric and node before touching the canonical layer or DOM.
  const base=resolveRichTextStyle(value),spans=richTextSpans(value);
  const styles=[base,...spans.map(p=>p.style)];
  for(const style of styles)if(!available(style.fontFamily)||!document.fonts.check(richTextFont(style)))throw Error('Font unavailable');
  const heights=styles.map(style=>lineHeight(value,style));
  // A plain layer stays in the unified Canvas coordinate system even after
  // its first sparse color/size override. Do not persist a compatibility mode.
  // The same one-row Canvas baseline must apply both before and after the
  // first style override, including a later reopen with saved textRuns. Using
  // startedPlain here made the DOM jump by the font baseline offset on reopen.
  const projection=layout(value);
  const firstRow=projection?.rows?.length===1?projection.rows[0]:null;
  const hardRows=projection?.rows?.length>1&&plainCompatible(value)?projection.rows:null;
  const offset=firstRow?unifiedDOMOffset(base,{height:firstRow.height,baseline:firstRow.baseline},value.text):0;
  const makeSpan=(text,style,height,top)=>{
   const span=document.createElement('span');span.textContent=text;
   Object.assign(span.style,{font:richTextFont(style),lineHeight:height+'px',letterSpacing:style.letterSpacing+'px',color:style.textColor});
   if(top!==null)Object.assign(span.style,{position:'relative',top:top+'px'});
   return span;
  };
  // The real newline remains part of a text node, not a generated <br>.
  // Each Canvas hard row gets its own baseline correction. This preserves
  // UTF-16 Selection across boundaries and avoids duplicate native breaks.
  const nodes=hardRows?hardRows.flatMap(row=>{
   const text=value.text.slice(row.start,row.end),top=unifiedDOMOffset(base,
    {height:row.height,baseline:row.baseline-row.y},text||'Mg');
   const output=[];
   for(const part of spans){
    const start=Math.max(row.start,part.start),end=Math.min(row.nextStart,part.end);
    if(end>start)output.push(makeSpan(value.text.slice(start,end),part.style,row.height,top));
   }
   return output;
  }):spans.map((part,i)=>makeSpan(part.text,part.style,
   parseFloat(heights[i+1]),firstRow?offset:null));
  const next=structuredClone(value);
  // The browser can blur contenteditable while replaceChildren invalidates
  // its current Range, particularly when a trailing LF gains a caret sentinel.
  // Capture ownership BEFORE the DOM change and restore it only for a session
  // that already owned focus. Inspector/color fields must keep their focus.
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
  if(hadFocus){
   if(document.activeElement!==host)host.focus({preventScroll:true});
   setSelection(selection.anchor,selection.focus);
  }
 }
 function clean(){try{return !composing&&!pending&&!fallback&&!safe.deferred&&host.innerHTML===confirmedHTML&&readText()===layer.text;}catch{return false;}}
 const caret=c=>({start:Math.min(c.anchor,c.focus),end:Math.max(c.anchor,c.focus),direction:c.anchor>c.focus?'backward':'forward'});
 function commit(value,before,after){
  // Fit the next snapshot before history and DOM are committed: all renderers
  // and Undo/Redo must use the same canonical fontSize.
  if(value.autoFontSize)fit(value);
  recordInlineHistory(history,layer,caret(before));
  recordInlineHistory(history,value,caret(after));
  project(value,after);onChange();
 }
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
  if(startedPlain&&!plainCompatible(origin))return false;
  const next=applyTextStyle(origin,Math.min(selection.anchor,selection.focus),Math.max(selection.anchor,selection.focus),patch);
  retainRichTextSizeBase(next);
  if(next.autoFontSize)fit(next);
  if((startedPlain||next.autoFontSize||origin.text.includes('\n'))&&!plainCompatible(next))return false;
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
 // Keep the selection anchored in a live text node whenever possible.
 // The host-level point before a trailing <br> can be normalised by Chromium
 // to the start of contenteditable after a controlled Enter, losing the caret.
 const leaves=[...map.leaves].reverse();
 const leaf=leaves.find(p=>offset>=p.start&&offset<=p.end);
 if(leaf)return {node:leaf.node,offset:offset-leaf.start};
 const sentinel=host.querySelector(':scope > br[data-caret-sentinel]');
 if(sentinel&&offset===map.text.length)return {node:host,offset:[...host.childNodes].indexOf(sentinel)};
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
  if((startedPlain||layer.autoFontSize||layer.text.includes('\n'))&&!plainCompatible(layer))requestFallback('Текст вышел за пределы поддерживаемых строк');
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
  if((startedPlain||layer.autoFontSize||layer.text.includes('\n'))&&!plainCompatible(layer))requestFallback('Текст вышел за пределы поддерживаемых строк');
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
