// Appended only to an in-memory compileHTML() response intercepted by Playwright.
// No source eligibility change, query flag, shipped hook, or alternate text model.
const bridge=String.raw`
window.mobileM0={
 state(){return {element:clone(active()),caret:clone(app.inlineCaret),zoom:app.zoom,live:!!app.wysiwyg,clean:app.wysiwyg?.clean(),history:app.inlineSession?{index:app.inlineSession.index,length:app.inlineSession.states.length}:null}},
 rows(){return mixedTextLayout(active()).rows},
 select(start,end,direction='forward'){
  if(app.wysiwyg){app.wysiwyg.focus();app.wysiwyg.setSelection(direction==='backward'?end:start,direction==='backward'?start:end)}
  else{$('#inlineText').focus();$('#inlineText').setSelectionRange(start,end,direction)}rememberInlineCaret();
 },
 startCandidate(){
  if(app.wysiwyg)throw Error('Already mounted');
  const e=active();if(!app.editingId||!supportsWysiwygProjection(e))throw Error('Unsupported fixture');
  app.inlineSession=createInlineHistory(e);startInlineWysiwyg(e);$('#inlineText').classList.add('hidden');positionInlineText();paint();app.wysiwyg.focus();
 },
 drawPreview(){
  const e=active(),edit=$('#inlineText');let ink=$('#mobileM0Ink');
  if(!ink){ink=document.createElement('canvas');ink.id='mobileM0Ink';edit.before(ink)}
  ink.width=e.w;ink.height=e.h;
  Object.assign(ink.style,{position:'absolute',pointerEvents:'none',zIndex:'7'});
  for(const k of ['left','top','width','height','transform','transformOrigin'])ink.style[k]=edit.style[k];
  const ctx=ink.getContext('2d');paintHorizontalTextPass(ctx,e,mixedTextLayout(e),'fill');paintHorizontalTextPass(ctx,e,mixedTextLayout(e),'stroke');
  edit.style.setProperty('--v41-text-color','transparent');
 },
 // Obtain target points from the same painter fragments; do not move native caret.
 targets(){
  const e=active(),edit=$('#inlineText'),r=edit.getBoundingClientRect(),stage=$('#stageScroller').getBoundingClientRect(),out=[];
  const ctx=document.createElement('canvas').getContext('2d');
  for(const row of mixedTextLayout(e).rows)for(const p of row.fragments){
   ctx.font=richTextFont(p.style);ctx.letterSpacing=p.style.letterSpacing+'px';ctx.fontKerning='normal';
   for(const {segment,index} of new Intl.Segmenter('ru',{granularity:'grapheme'}).segment(p.text)){
    if(!/\S/u.test(segment))continue;
    const x=r.left+(p.x+ctx.measureText(p.text.slice(0,index)).width+.1)*app.zoom;
    const y=r.top+(row.baseline-p.style.fontSize*.35)*app.zoom;
    if(x>stage.left+2&&x<stage.right-2&&y>stage.top+2&&y<Math.min(stage.bottom,r.bottom)-2)out.push({x,y,expected:p.start+index});
   }
  }return out.slice(0,48);
 }
};`;
let html;
async function install(page){
 if(!html){const {compileHTML}=await import('../../scripts/compile-html.mjs');html=await compileHTML(undefined,{transformEditor:source=>{const end=source.lastIndexOf('})();');if(end<0)throw Error('Editor closure missing');return source.slice(0,end)+bridge+'\n'+source.slice(end)}})}
 await page.route('http://127.0.0.1:4173/',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html}));
}
const text='Привет красное крупное слово и обычный русский текст для проверки переносов и каретки.  Два пробела сохранены.\nВторой абзац: семья 👨‍👩‍👧‍👦 и emoji 😀 рядом с буквами. Здесь выделяем несколько слов и строк.\n\nПоследний абзац содержит длинное предложение для проверки выравнивания по ширине и растянутых пробелов.\n';
function patch(align='left'){
 const run=(word,style)=>({start:text.indexOf(word),end:text.indexOf(word)+word.length,style});
 return {text,textAlign:align,x:16,y:16,w:288,h:400,fontFamily:'Arial',fontSize:18,lineHeight:1.25,letterSpacing:0,verticalAlign:'top',rotation:0,autoFontSize:false,fillType:'solid',fill:'#000000',textColor:'#000000',textRunsBaseFontSize:18,
  textRuns:[run('красное',{textColor:'#ff0000',underline:true}),run('крупное',{fontSize:34}),run('обычный',{strikethrough:true}),run('Второй',{fontSize:22})]};
}
module.exports={install,patch};
