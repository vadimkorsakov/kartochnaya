export function toLocal(e,p){const dx=p.x-e.x-e.w/2,dy=p.y-e.y-e.h/2,rad=-(e.rotation||0)*Math.PI/180;return {x:dx*Math.cos(rad)-dy*Math.sin(rad)+e.w/2,y:dx*Math.sin(rad)+dy*Math.cos(rad)+e.h/2}}

export function boundsOf(e){const rad=(e.rotation||0)*Math.PI/180,co=Math.cos(rad),si=Math.sin(rad),cx=e.x+e.w/2,cy=e.y+e.h/2;const points=[[-e.w/2,-e.h/2],[e.w/2,-e.h/2],[e.w/2,e.h/2],[-e.w/2,e.h/2]].map(([x,y])=>({x:cx+x*co-y*si,y:cy+x*si+y*co}));return {x:Math.min(...points.map(p=>p.x)),y:Math.min(...points.map(p=>p.y)),right:Math.max(...points.map(p=>p.x)),bottom:Math.max(...points.map(p=>p.y))}}

export function handleCoords(e){return [['nw',0,0],['n',e.w/2,0],['ne',e.w,0],['e',e.w,e.h/2],['se',e.w,e.h],['s',e.w/2,e.h],['sw',0,e.h],['w',0,e.h/2]]}

export function gradientLocalPoint(e,doc){const cx=e.x+e.w/2,cy=e.y+e.h/2,rad=-(e.rotation||0)*Math.PI/180,xx=doc.x-cx,yy=doc.y-cy;return {x:(xx*Math.cos(rad)-yy*Math.sin(rad))+e.w/2,y:(xx*Math.sin(rad)+yy*Math.cos(rad))+e.h/2}}

export function gradientDocPoint(e,p){const cx=e.x+e.w/2,cy=e.y+e.h/2,rad=(e.rotation||0)*Math.PI/180,xx=p.x-e.w/2,yy=p.y-e.h/2;return {x:cx+xx*Math.cos(rad)-yy*Math.sin(rad),y:cy+xx*Math.sin(rad)+yy*Math.cos(rad)}}
