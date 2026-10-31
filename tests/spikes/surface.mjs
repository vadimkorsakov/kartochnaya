// Test-only candidate; never imported by the editor or persisted as HTML.
import {richTextSpans,resolveRichTextStyle,richTextFont,createRichTextLayoutEngine} from '../../src/render/rich-text-layout.mjs';
const host=document.querySelector('#host');
const ctx=document.createElement('canvas').getContext('2d');
const engine=createRichTextLayoutEngine(ctx,document.fonts);
let composing=false,layer;
export const events=[];
for(const name of ['beforeinput','input','compositionstart','compositionupdate','compositionend'])host.addEventListener(name,e=>{
 events.push({type:name,inputType:e.inputType,cancelable:e.cancelable,isComposing:e.isComposing});
 if(name==='compositionstart')composing=true;
 if(name==='compositionend')composing=false;
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
 const leaves=affinity==='downstream'?[...map.leaves].reverse():map.leaves;
 const leaf=leaves.find(p=>offset>=p.start&&offset<=p.end);
 if(leaf)return {node:leaf.node,offset:offset-leaf.start};
 for(const [node,offsets] of map.points){const i=offsets.indexOf(offset);if(i>=0)return {node,offset:i};}
 throw Error('Unmapped offset');
}
export function readSelection(){const s=getSelection();return {anchor:domPointToOffset(s.anchorNode,s.anchorOffset),focus:domPointToOffset(s.focusNode,s.focusOffset)};}
export function setSelection(anchor,focus=anchor){const a=offsetToDomPoint(anchor),f=offsetToDomPoint(focus);getSelection().setBaseAndExtent(a.node,a.offset,f.node,f.offset);}
export function mount(value){
 if(composing)return false;
 const saved=host.contains(getSelection().anchorNode)?readSelection():null;
 layer=structuredClone(value);const base=resolveRichTextStyle(layer);
 Object.assign(host.style,{width:layer.w+'px',height:layer.h+'px',font:richTextFont(base),lineHeight:String(layer.lineHeight||1.15),letterSpacing:base.letterSpacing+'px',textAlign:layer.textAlign||'left',transform:''});
 host.replaceChildren(...richTextSpans(layer).map(p=>{const el=document.createElement('span');el.textContent=p.text;Object.assign(el.style,{font:richTextFont(p.style),lineHeight:String(layer.lineHeight||1.15),letterSpacing:p.style.letterSpacing+'px',color:p.style.textColor});return el;}));
 if(!host.childNodes.length)host.append(document.createTextNode(''));
 if(saved)setSelection(Math.min(saved.anchor,readText().length),Math.min(saved.focus,readText().length));
 return true;
}
export async function ready(){await Promise.all(['20px SpikeSans','700 20px SpikeSans','20px SpikeSerif'].map(font=>document.fonts.load(font)));await document.fonts.ready;}
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
 const css=getComputedStyle(host);ctx.font=css.font;const metrics=ctx.measureText('Mg');
 return {cssMetrics:{font:css.font,lineHeight:css.lineHeight,ascent:metrics.fontBoundingBoxAscent??metrics.actualBoundingBoxAscent,descent:metrics.fontBoundingBoxDescent??metrics.actualBoundingBoxDescent},rowProbes,unmatchedGlyphs:glyphs.length-pairs.length,text:readText(),domLines,canvasLines,domMetrics:dom,canvasMetrics:layout.rows,maxCaretDx:Math.max(0,...carets.map(p=>p.dx)),maxCaretDy:Math.max(0,...carets.map(p=>p.dy)),missingCaretRects:pairs.length*2-carets.length,domRows,canvasRows:layout.rows.map(row=>canvas.filter(p=>p.row===layout.rows.indexOf(row)).map(p=>[p.start,p.end])),maxDx:Math.max(0,...pairs.map(p=>p.dx)),maxDy:Math.max(0,...pairs.map(p=>p.dy)),pairs};
}
