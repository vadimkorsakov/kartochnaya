function gradientStops(e){
 if(!Array.isArray(e.gradientStops)||e.gradientStops.length<2){
  e.gradientStops=[{id:uid(),pos:0,color:normalizeHex(e.fill)||'#ab92fb',alpha:clamp(Number(e.fillAlpha1??100),0,100)},
                   {id:uid(),pos:100,color:normalizeHex(e.fill2)||'#fb8c67',alpha:clamp(Number(e.fillAlpha2??100),0,100)}];
 }
 for(const st of e.gradientStops){if(!st.id)st.id=uid();st.pos=clamp(Number(st.pos??0),0,100);st.color=normalizeHex(st.color)||'#ffffff';st.alpha=clamp(Number(st.alpha??100),0,100)}
 return e.gradientStops.sort((a,b)=>a.pos-b.pos);
}
function gradientGeometry(e){
 if(!e.gradientStart||!e.gradientEnd){
  const rad=(Number(e.gradientAngle??90))*Math.PI/180,L=Math.hypot(e.w,e.h)/2,dx=Math.sin(rad)*L,dy=Math.cos(rad)*L;
  e.gradientStart={x:.5-dx/Math.max(e.w,1),y:.5-dy/Math.max(e.h,1)};
  e.gradientEnd={x:.5+dx/Math.max(e.w,1),y:.5+dy/Math.max(e.h,1)};
 }
 return {a:{x:e.gradientStart.x*e.w,y:e.gradientStart.y*e.h},b:{x:e.gradientEnd.x*e.w,y:e.gradientEnd.y*e.h}};
}
function gradientSample(e,pos){
 const stops=gradientStops(e),p=clamp(pos,0,100);let l=stops[0],r=stops[stops.length-1];
 for(let i=0;i<stops.length-1;i++)if(p>=stops[i].pos&&p<=stops[i+1].pos){l=stops[i];r=stops[i+1];break}
 if(p<=l.pos)return {color:l.color,alpha:l.alpha};if(p>=r.pos)return {color:r.color,alpha:r.alpha};
 const t=(p-l.pos)/Math.max(.001,r.pos-l.pos),rgb1=hexRgb(l.color),rgb2=hexRgb(r.color);
 return {color:rgbHex(...rgb1.map((n,i)=>n+(rgb2[i]-n)*t)),alpha:l.alpha+(r.alpha-l.alpha)*t};
}
function addGradientStop(e,pos=50){
 const v=gradientSample(e,pos),stop={id:uid(),pos:Math.round(clamp(pos,0,100)),color:v.color,alpha:Math.round(v.alpha)};
 gradientStops(e).push(stop);gradientStops(e);return stop;
}
