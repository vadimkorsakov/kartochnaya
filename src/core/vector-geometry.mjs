// New vector layers use the real SVG artwork bounds rather than the
// 0..100 thumbnail viewBox. Existing documents without vectorViewBox remain
// untouched and keep their previous rendering and element geometry.
const svgNS='http://www.w3.org/2000/svg';
const round4=n=>Math.round(n*10000)/10000;

export function measureVectorArtwork(spec,doc=document){
 if(!spec?.d)return null;
 const svg=doc.createElementNS(svgNS,'svg');
 svg.setAttribute('width','100');
 svg.setAttribute('height','100');
 svg.setAttribute('viewBox','0 0 100 100');
 svg.style.cssText='position:fixed;left:-10000px;top:-10000px;visibility:hidden;pointer-events:none;overflow:visible';
 const group=doc.createElementNS(svgNS,'g');
 const parts=spec.parts?.length?spec.parts:[{d:spec.d}];
 for(const part of parts){
  if(!part.d)continue;
  const path=doc.createElementNS(svgNS,'path');
  path.setAttribute('d',part.d);
  if(part.matrix)path.setAttribute('transform','matrix('+part.matrix.join(' ')+')');
  group.appendChild(path);
 }
 svg.appendChild(group);
 (doc.body||doc.documentElement).appendChild(svg);
 try{
  const box=group.getBBox();
  if(![box.x,box.y,box.width,box.height].every(Number.isFinite))return null;
  if(box.width<=.001||box.height<=.001)return null;
  return {x:box.x,y:box.y,w:box.width,h:box.height};
 }catch{return null}
 finally{svg.remove()}
}

// Keep the *painted* shape in its previous document position/size while
// shrinking its element box to the occupied pixels of the SVG artwork.
// Path2D will then map source viewBox -> new w/h via vectorPathTransform.
export function tightVectorPlacement(element,box){
 if(!box||![element.x,element.y,element.w,element.h,box.x,box.y,box.w,box.h].every(Number.isFinite))return null;
 if(box.w<=.001||box.h<=.001||element.w<=0||element.h<=0)return null;
 const x=element.x+element.w*box.x/100;
 const y=element.y+element.h*box.y/100;
 const w=element.w*box.w/100;
 const h=element.h*box.h/100;
 if(w<.01||h<.01)return null;
 return {x:round4(x),y:round4(y),w:round4(w),h:round4(h),
  vectorViewBox:{x:round4(box.x),y:round4(box.y),w:round4(box.w),h:round4(box.h)}};
}

export function vectorPathTransform(box,w,h){
 if(!box)return [Math.max(.01,w/100),0,0,Math.max(.01,h/100),0,0];
 const sx=w/box.w,sy=h/box.h;
 return [sx,0,0,sy,-box.x*sx,-box.y*sy];
}

// Sampled SVG contour points (text-on-path, boundary text) use the same
// local frame as Path2D, including the viewBox translation for new vectors.
export function vectorPointInFrame(box,x,y){
 if(!box)return {x:x/100,y:y/100};
 return {x:(x-box.x)/box.w,y:(y-box.y)/box.h};
}
