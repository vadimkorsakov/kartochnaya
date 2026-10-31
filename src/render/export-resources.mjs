import { usesRichTextLayout, richTextSpans } from './rich-text-layout.mjs';

// Reads only the canvas passed by the caller. Cache ownership stays with the
// renderer's image reader and the existing FontFace loader.
export function collectCanvasResources(doc, { isVisible, hasEffect }) {
  const images=new Map(), fonts=new Map();
  const image=(src,kind,layer)=>{if(src&&!images.has(src))images.set(src,{src,kind,layer:layer.id});};
  for(const e of doc.elements||[]) {
    if(!isVisible(e,doc))continue;
    image(e.layerMaskSrc,'layerMask',e);
    const effects=(e.effects||[]).filter(f=>f.enabled!==false&&hasEffect(f.type));
    let background=false;
    for(const f of effects) {
      if(['backgroundBlur','glass'].includes(f.type)||(e.isFxRegion&&f.type==='gaussianBlur')) {
        if(background)continue;
        background=true;
      }
      if(f.type!=='textBackdrop'||e.type==='text')image(f.maskSrc,'effectMask',e);
    }
    const region=e.isFxRegion&&effects.length;
    const backdropText=(!e.textMode||e.textMode==='horizontal')&&effects.some(f=>f.type==='textBackdrop');
    const profile=e.inkProfile||'round';
    const paintsInk=e.inkTool==='brush'&&e.inkPoints?.length&&profile!=='round'
      &&(['dashed','dotted','spray'].includes(profile)||e.inkPoints.length>=2);
    if(!region&&e.type==='raster')image(e.rasterSrc,'raster',e);
    else if(!region&&(e.type==='text'||!paintsInk)&&e.fillType==='image'
      &&!(e.type==='path'&&!e.pathClosed)&&!(e.type==='vector'&&e.vectorLine))image(e.imageSrc,'image',e);
    if(e.type==='text'&&((!region&&(e.fillType!=='none'||Number(e.strokeWidth)>0))||backdropText)) {
      const spans=usesRichTextLayout(e)?richTextSpans(e):[{text:String(e.text||''),style:e}];
      for(const {text,style} of spans){
        const font={family:style.fontFamily||'Arial',weight:String(style.fontWeight||'400'),style:style.fontStyle||'normal',text};
        const key=JSON.stringify([font.family,font.weight,font.style]);
        if(fonts.has(key))fonts.get(key).text+=font.text;
        else fonts.set(key,font);
      }
    }
  }
  return {images:[...images.values()],fonts:[...fonts.values()]};
}

export class ExportResourceError extends Error {
  constructor(resource,reason) {
    const label=resource.kind==='font'?'шрифт':resource.kind==='layerMask'?'маску':resource.kind==='effectMask'?'маску эффекта':'изображение';
    super(`Не удалось прочитать ${label} для PNG (${reason})`);
    this.name='ExportResourceError';this.resource=resource;this.reason=reason;
  }
}

// One deadline for the entire canvas, including fonts. Cancelling a waiter never
// cancels or poisons a shared Image/FontFace still needed by the live editor.
export async function prepareCanvasResources(dependencies, {readImage,prepareFont,timeoutMs=15000,signal}) {
  const controller=new AbortController();
  const abort=()=>controller.abort(signal.reason||new Error('Подготовка PNG отменена'));
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  let pending;
  const timer=setTimeout(()=>controller.abort(new ExportResourceError(pending||{kind:'image'},'таймаут подготовки')),timeoutMs);
  const wait=promise=>new Promise((resolve,reject)=>{
    const stop=()=>{cleanup();reject(controller.signal.reason);};
    const cleanup=()=>controller.signal.removeEventListener('abort',stop);
    if(controller.signal.aborted){reject(controller.signal.reason);return;}
    controller.signal.addEventListener('abort',stop,{once:true});
    Promise.resolve(promise).then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
  });
  try {
    // Bounded work: sequential image waits also avoid an unbounded decode burst
    // for an inactive slide. Already loading resources retain their one request.
    for(const resource of dependencies.images) {
      pending=resource;if(controller.signal.aborted)throw controller.signal.reason;
      let state=readImage(resource.src);
      if(state.state==='loading') {
        if(!state.completion)throw new ExportResourceError(resource,'нет подтверждения загрузки');
        await wait(state.completion);state=readImage(resource.src);
      }
      if(state.state!=='ready'||!state.image)throw new ExportResourceError(resource,'ошибка загрузки');
    }
    for(const font of dependencies.fonts) {
      pending={kind:'font',...font};if(controller.signal.aborted)throw controller.signal.reason;
      try{await wait(prepareFont(font));}catch(error){if(controller.signal.aborted)throw controller.signal.reason;throw new ExportResourceError(pending,'ошибка загрузки');}
    }
    return {ready:true,images:dependencies.images.length,fonts:dependencies.fonts.length};
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
