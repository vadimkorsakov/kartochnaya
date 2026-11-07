import {richTextSpans, resolveRichTextStyle, richTextFont, retainRichTextSizeBase} from '../render/rich-text-layout.mjs';
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
export function eligibleWysiwyg(e, locked=false, available=()=>true, compatible=()=>false) {
 // Rich inline editing is the desktop default. The explicit =0 switch is
 // retained only for diagnosis and for fallback-focused regression tests.
 // A previous opt-in gate left normal users on plain textarea, making range
 // color/font/size changes invisible until the editor was closed.
 if(new URLSearchParams(location.search).get('experimentalTextWysiwyg')==='0'||matchMedia('(max-width:760px), (pointer:coarse)').matches||/Android|iPhone|iPad|AppleWebKit(?!.*(?:Chrome|Chromium|Edg))/i.test(navigator.userAgent))return false;
 if(locked||e.type!=='text'||(e.textMode&&e.textMode!=='horizontal')||e.rotation||e.textPathId||e.mobileArcRadius||e.text.includes('\r')||(e.textAlign&&e.textAlign!=='left')||(e.verticalAlign&&e.verticalAlign!=='top'))return false;
 if((e.fillType&&e.fillType!=='solid')||e.maskSrc||e.mask||e.layerMaskSrc||e.clipped||e.strokeWidth||(e.effects||[]).some(f=>f.enabled!==false)||e.flipX||e.flipY||(e.blendMode&&!['normal','source-over'].includes(e.blendMode))||(e.opacity??100)!==100||(e.fillOpacity??100)!==100)return false;
 // Supported paint semantics apply equally to plain and sparse-rich text.
 // Geometry is supplied by the shared row layout, never a CSS parity guess.
 if(!compatible(e))return false;
 try {return [resolveRichTextStyle(e),...richTextSpans(e).map(p=>p.style)].every(s=>available(s.fontFamily)&&document.fonts.check(richTextFont(s))&&!!lineHeight(e,s));}catch{return false;}
}

// Canonical layer + the editor's existing session history own all confirmed data.
// Unknown DOM remains on screen until explicit recovery; it is never persisted.
export function createWysiwygSession({host, element, history, onChange, onFallback, onRecovery, available=()=>true, compatible=()=>false, layout=()=>null, fit=()=>false}) {
 let layer=element, composing=false, fallback=null, pasteText=null, confirmedHTML, inactive=false;
 const safe={phase:'confirmed', deferred:false};
 let savedSelection=null, preview=null, verticalX=null;
 const abort=new AbortController(), listen=(name,fn)=>host.addEventListener(name,fn,{signal:abort.signal});
 function selectionInside(){const s=getSelection();return host.contains(s.anchorNode)&&host.contains(s.focusNode);}
 function stop(reason){pasteText=null;fallback=reason;safe.phase='recovery-required';if(!inactive)onRecovery(reason);}
 function project(value,selection){
  verticalX=null;
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
  // Canvas owns wrapping, per-row ascent/descent and fragment advances.
  // Position source spans at those coordinates; CSS must never reflow them.
  // Soft wraps add no characters. Only source LF occupies a UTF-16 offset.
  const projection=layout(value);
  if(!projection?.rows?.length)throw Error('Text layout unavailable');
  const nodes=[];
  for(const row of projection.rows){
   const rowNode=document.createElement('span');rowNode.dataset.wysiwygRow='';
   Object.assign(rowNode.style,{position:'absolute',display:'inline-block',left:'0px',top:row.y+'px',height:row.height+'px',whiteSpace:'pre',fontSize:'0px',lineHeight:'0px'});
   // CSS backgrounds contain no DOM nodes or characters, so native Selection,
   // UTF-16 indexing and confirmedHTML validation keep their existing contract.
   Object.assign(rowNode.style, {width:value.w+'px',
    backgroundImage:row.decorations.map(r=>`linear-gradient(${r.color}, ${r.color})`).join(','),
    backgroundPosition:row.decorations.map(r=>`${r.x}px ${r.y-row.y}px`).join(','),
    backgroundSize:row.decorations.map(r=>`${r.width}px ${r.height}px`).join(','),backgroundRepeat:'no-repeat'});
   nodes.push(rowNode);let advance=0;
   const parts=row.fragments.length?row.fragments:[{text:'',style:base,x:0}];
   for(let i=0;i<parts.length;i++){
    const part=parts[i],span=document.createElement('span');span.dataset.wysiwygFragment='';
    const offset=unifiedDOMOffset(part.style,{height:row.height,baseline:row.baseline-row.y},part.text);
    span.append(document.createTextNode(part.text));
    // Source newlines live with their preceding row, including empty rows.
    if(i===parts.length-1&&row.nextStart>row.end)span.firstChild.data+=value.text.slice(row.end,row.nextStart);
    Object.assign(span.style,{position:'relative',display:'inline-block',verticalAlign:'top',marginLeft:part.x-advance+'px',top:offset+'px',height:row.height+'px',
     font:richTextFont(part.style),fontKerning:'normal',lineHeight:row.height+'px',letterSpacing:part.style.letterSpacing+'px',
     color:part.style.textColor,whiteSpace:'pre',overflowWrap:'normal'});
    rowNode.append(span);ctx.font=richTextFont(part.style);ctx.letterSpacing=part.style.letterSpacing+'px';ctx.fontKerning='normal';advance=part.x+ctx.measureText(part.text).width;
   }
  }
  const next=structuredClone(value);
  // The browser can blur contenteditable while replaceChildren invalidates
  // its current Range, particularly when a trailing LF gains a caret sentinel.
  // Capture ownership BEFORE the DOM change and restore it only for a session
  // that already owned focus. Inspector/color fields must keep their focus.
  for(const key of Object.keys(element))delete element[key];Object.assign(element,next);layer=element;
  Object.assign(host.style,{font:richTextFont(base),fontKerning:'normal',lineHeight:heights[0],letterSpacing:base.letterSpacing+'px'});
  host.replaceChildren(...nodes);
  if(!host.childNodes.length)host.append(document.createTextNode(''));
  if(!layer.text||layer.text.endsWith('\n')){const br=document.createElement('br');br.dataset.caretSentinel='';nodes.at(-1).lastChild.append(br);}
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
 function clean(){try{return !composing&&!fallback&&!safe.deferred&&host.innerHTML===confirmedHTML&&readText()===layer.text;}catch{return false;}}
 const caret=c=>({start:Math.min(c.anchor,c.focus),end:Math.max(c.anchor,c.focus),direction:c.anchor>c.focus?'backward':'forward'});
 function commit(value,before,after){
  // Fit the next snapshot before history and DOM are committed: all renderers
  // and Undo/Redo must use the same canonical fontSize.
  if(value.autoFontSize)fit(value);
  const origin=structuredClone(layer);
  project(value,after);
  recordInlineHistory(history,origin,caret(before));
  const previousIndex=history.index;
  recordInlineHistory(history,value,caret(after));
  // A confirmed input is distinct while editing, but adjacent inputs can be
  // grouped into one document-history step when the session closes.
  if(history.index!==previousIndex)history.states[history.index].action='input';
  onChange();
 }
 function travel(direction){finishPreview();if(!clean()){stop('История недоступна до восстановления ввода');return;}const previousIndex=history.index,state=moveInlineHistory(history,direction);if(state){try{project(state.element,state.caret);onChange();}catch{history.index=previousIndex;stop('Шрифт или проекция недоступны для истории');}}}
 function requestFallback(reason){
  if(!clean()){stop('Нужно восстановить подтверждённый ввод');return false;}
  finishPreview();
  let selection;try{selection=rememberSelection();}catch{stop('Не удалось сохранить выделение');return false;}
  onFallback(selection,reason);return true;
 }
 function finishPreview(){
  if(!preview)return;
  const previousIndex=history.index;
  recordInlineHistory(history,layer,caret(preview.selection));
  // Only a completed, non-no-op style preview becomes a separate action.
  if(history.index!==previousIndex)history.states[history.index].action='style';
  preview=null;onChange();
 }
 function applyStyle(patch,{key,final=false,range=true}={}){
  if(!clean()||safe.phase!=='confirmed'||inactive){stop('Нужно восстановить подтверждённый ввод');return true;}
  let selection;try{selection=rememberSelection();}catch{return false;}
  if(range&&selection.anchor===selection.focus)return false;
  if(preview&&(preview.key!==key||preview.selection.anchor!==selection.anchor||preview.selection.focus!==selection.focus))finishPreview();
  const origin=preview?.element||structuredClone(layer);
  if(!compatible(origin))return false;
  let next=range?applyTextStyle(origin,Math.min(selection.anchor,selection.focus),Math.max(selection.anchor,selection.focus),patch):structuredClone(origin);
  if(!range){
   if(['underline','strikethrough'].includes(key))next=applyTextStyle(next,0,next.text.length,{[key]:null});
   retainRichTextSizeBase(next);Object.assign(next,patch);
  }
  if(key==='fontSize')next.autoFontSize=false;
  retainRichTextSizeBase(next);
  if(next.autoFontSize&&!['underline','strikethrough'].includes(key))fit(next);
  if(!compatible(next))return false;
  // project preflights fonts and metrics; a failure leaves layer/history intact.
  try{project(next,selection);}catch{return false;}
  if(!preview){recordInlineHistory(history,origin,caret(selection));preview={key,element:origin,selection};}
  if(final)finishPreview();else onChange();
  return true;
 }
 // Positioned row/fragment boxes introduce duplicate native caret stops and
// browser-dependent vertical affinity. Navigate canonical grapheme offsets
// and shared visual rows; native Selection still paints and owns the caret.
const applyRangeStyle=(patch,options)=>applyStyle(patch,options);
const applyLayerStyle=(patch,options)=>applyStyle(patch,{...options,range:false});
const graphemes=new Intl.Segmenter(undefined,{granularity:'grapheme'});
listen('pointerdown',()=>{verticalX=null;});
listen('keydown',event=>{
 if(composing||event.isComposing||event.altKey||!clean())return;
 const key=event.key,modified=event.ctrlKey||event.metaKey,vertical=['ArrowUp','ArrowDown'].includes(key);
 if(!['ArrowLeft','ArrowRight','Home','End','ArrowUp','ArrowDown'].includes(key)||(modified&&key.startsWith('Arrow')))return;
 finishPreview();let c;try{c=readSelection();}catch{return;}
 const rows=layout(layer).rows,rowNodes=[...host.querySelectorAll('[data-wysiwyg-row]')];
 const focusNode=getSelection().focusNode;
 let rowIndex=rowNodes.indexOf((focusNode.nodeType===3?focusNode.parentElement:focusNode).closest('[data-wysiwyg-row]'));
 if(rowIndex<0)rowIndex=Math.max(0,rows.findLastIndex(r=>r.start<=c.focus));
 const row=rows[rowIndex],boundaries=[...graphemes.segment(layer.text)].map(p=>p.index).concat(layer.text.length);
 let next=c.focus,targetRow=null;
 if(vertical){
  const xAt=(row,offset)=>{
   const part=row.fragments.findLast(p=>p.start<=offset)||row.fragments[0];if(!part)return 0;
   ctx.font=richTextFont(part.style);ctx.letterSpacing=part.style.letterSpacing+'px';ctx.fontKerning='normal';
   return part.x+ctx.measureText(layer.text.slice(part.start,Math.min(offset,part.end))).width;
  };
  if(verticalX===null)verticalX=xAt(row,c.focus);
  targetRow=Math.max(0,Math.min(rows.length-1,rowIndex+(key==='ArrowUp'?-1:1)));
  const target=rows[targetRow],points=boundaries.filter(i=>i>=target.start&&i<=target.end);
  next=points.reduce((best,i)=>Math.abs(xAt(target,i)-verticalX)<Math.abs(xAt(target,best)-verticalX)?i:best,points[0]??target.start);
 }else{
  verticalX=null;
  if(key==='Home'||key==='End'){
   next=modified?(key==='Home'?0:layer.text.length):(key==='Home'?row.start:row.end);
   targetRow=modified?(key==='Home'?0:rows.length-1):rowIndex;
  }else if(!event.shiftKey&&c.anchor!==c.focus)next=key==='ArrowLeft'?Math.min(c.anchor,c.focus):Math.max(c.anchor,c.focus);
  else next=key==='ArrowLeft'?(boundaries.findLast(i=>i<c.focus)??0):(boundaries.find(i=>i>c.focus)??layer.text.length);
 }
 event.preventDefault();setSelection(event.shiftKey?c.anchor:next,next,targetRow);
});
listen('paste',e=>{pasteText=e.clipboardData?.getData('text/plain')??null;});
// Serialize canonical source intervals, independent of visual row boxes.
// Cancel native cut before it can merge rows or send deleteByCut to fallback.
for(const type of ['copy','cut'])listen(type,event=>{
 if(!clean()||!selectionInside()||!event.clipboardData)return;
 let selection;try{selection=readSelection();}catch{return;}
 const start=Math.min(selection.anchor,selection.focus),end=Math.max(selection.anchor,selection.focus);
 if(start===end)return;
 event.clipboardData.setData('text/plain',layer.text.slice(start,end));event.preventDefault();
 if(type==='cut'){
  finishPreview();
  try{commit(replaceText(layer,start,end,''),selection,{anchor:start,focus:start});}
  catch{stop('Text projection unavailable');}
 }
});
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
function offsetToDomPoint(offset,rowIndex=null){
 const map=index();if(!Number.isInteger(offset)||offset<0||offset>map.text.length)throw Error('Invalid UTF-16 offset');
 // Keep the selection anchored in a live text node whenever possible.
 // The host-level point before a trailing <br> can be normalised by Chromium
 // to the start of contenteditable after a controlled Enter, losing the caret.
 const preferred=rowIndex===null?null:host.querySelectorAll('[data-wysiwyg-row]')[rowIndex];
 const leaves=[...map.leaves].reverse().filter(p=>!preferred||preferred.contains(p.node));
 const leaf=leaves.find(p=>offset>=p.start&&offset<=p.end);
 if(leaf)return {node:leaf.node,offset:offset-leaf.start};
 const sentinel=host.querySelector('br[data-caret-sentinel]');
 if(sentinel&&offset===map.text.length)return {node:sentinel.parentNode,offset:[...sentinel.parentNode.childNodes].indexOf(sentinel)};
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
function setSelection(anchor,focus=anchor,rowIndex=null){const c={anchor,focus};if(!validSelection(c))throw Error('Invalid selection');const a=offsetToDomPoint(anchor,anchor===focus?rowIndex:null),f=offsetToDomPoint(focus,rowIndex);getSelection().setBaseAndExtent(a.node,a.offset,f.node,f.offset);savedSelection=c;}
listen('focusout',()=>{if(selectionInside()&&clean()){try{savedSelection=readSelection();}catch{}}});
listen('focus',()=>{if(validSelection(savedSelection)&&clean())setSelection(savedSelection.anchor,savedSelection.focus);});
listen('beforeinput',e=>{
 finishPreview();
 if(inactive){if(e.cancelable&&!composing&&!e.isComposing)e.preventDefault();return;}
 {
  if(safe.phase==='recovery-required'){if(e.cancelable&&!composing&&!e.isComposing)e.preventDefault();return;}
  if(composing||e.isComposing){safe.deferred=true;safe.phase='composing';return;}
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

 if(composing||e.isComposing){stop('composition requires fallback');return;}
 if(!e.cancelable){stop('noncancelable beforeinput requires fallback');return;}
 if(!selectionInside()){stop('selection outside host');return;}
 if(layer.text.includes('\r')){stop('legacy CR requires fallback');return;}
 let selection;
 try{if(readText()!==layer.text||host.innerHTML!==confirmedHTML){stop('DOM differs from canonical state');return;}selection=readSelection();}
 catch{stop('unsupported DOM');return;}
 let start=Math.min(selection.anchor,selection.focus),end=Math.max(selection.anchor,selection.focus);
 // replaceText expands surrogate boundaries; refuse a split-pair caret rather
 // than restoring an offset inconsistent with the required min(anchor,focus)+1.
 const split=i=>i>0&&i<layer.text.length&&/[\uD800-\uDBFF]/.test(layer.text[i-1])&&/[\uDC00-\uDFFF]/.test(layer.text[i]);
 if(split(start)||split(end)){stop('selection splits surrogate pair');return;}
 if(e.inputType==='insertLineBreak'){
  e.preventDefault();
  const next=replaceText(layer,start,end,'\n');
  commit(next,selection,{anchor:start+1,focus:start+1});

  safe.phase='confirmed';
  if(!compatible(layer))requestFallback('Текст вышел за пределы поддерживаемых строк');
  // A canceled controlled operation needs no native reconciliation.
  return;
 }
 if(!['insertText','insertFromPaste','deleteContentBackward','deleteContentForward'].includes(e.inputType)){
  stop('unsupported inputType: '+e.inputType);return;
 }
 const data=e.inputType==='insertFromPaste'?(e.dataTransfer?.getData('text/plain')??pasteText):e.data;
 pasteText=null;
 if(e.inputType==='insertFromPaste'&&data===null){stop('paste without plaintext context');return;}
 // Geometry and source intervals belong to the model. Letting the native
 // editor merge positioned row boxes makes visual boundaries into deletion
 // stops and can generate unsupported DIV/BR markup (especially Firefox).
 // Confirm supported intents before replacing DOM; never infer canonical rich
 // text from browser-generated markup or persist an unconfirmed composition.
 e.preventDefault();
 if(e.inputType.startsWith('delete')&&start===end){
  const points=[...graphemes.segment(layer.text)].map(p=>p.index).concat(layer.text.length);
  if(e.inputType==='deleteContentBackward')start=points.findLast(i=>i<start)??0;
  else end=points.find(i=>i>end)??layer.text.length;
 }
 // Match native textarea/plaintext newline semantics for Windows clipboard.
 const inserted=e.inputType.startsWith('delete')?'':typeof data==='string'?data.replace(/\r\n?/g,'\n'):data;
 if(typeof inserted!=='string'){stop('input without plaintext context');return;}
 try{
  commit(replaceText(layer,start,end,inserted),selection,{anchor:start+inserted.length,focus:start+inserted.length});
  safe.phase='confirmed';
 }catch{stop('Text projection unavailable');}
});
listen('input',()=>{
 if(inactive||composing||safe.deferred)return;
 // Canceled controlled intents may still be followed by a redundant input.
 // Any actual DOM mutation without a confirmed intent remains recoverable.
 try{if(readText()!==layer.text||host.innerHTML!==confirmedHTML)stop('input without beforeinput context');}
 catch{stop('unsupported native DOM');}
});

 host.contentEditable='plaintext-only';host.classList.remove('hidden');
 const initial={anchor:layer.text.length,focus:layer.text.length};project(structuredClone(layer),initial);recordInlineHistory(history,layer,caret(initial));
 return {get composing(){return composing;},travel,readSelection,rememberSelection,setSelection,requestFallback,clean,applyRangeStyle,applyLayerStyle,finishPreview,
  preserve(){inactive=true;if(!composing)host.contentEditable='false';},
  focus(){host.focus({preventScroll:true});},
  recover(){if(composing)return false;fallback=null;safe.deferred=false;safe.phase='confirmed';project(structuredClone(layer),{anchor:layer.text.length,focus:layer.text.length});onChange();return true;},
  dispose(){abort.abort();host.classList.add('hidden');}
 };
}
