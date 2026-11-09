import {richTextFont} from './rich-text-layout.mjs';

export const hasHorizontalTextStroke = layout => layout.rows.some(row=>row.fragments.some(p=>p.style.strokeWidth>0));
export const textStrokePadding = layout => Math.ceil(Math.max(0,...layout.rows.flatMap(row=>row.fragments.map(p=>p.style.strokeWidth)))+(layout.inkOverflow||0))+2;

// Shared horizontal glyph painter: Canvas, export and the editable projection
// must issue the same whole-fragment calls for BOTH fill and stroke. Formatting
// may split a ligature at a paint boundary; it never draws code points singly.
export function paintHorizontalTextPass(c,e,layout,method='fill') {
 const stroke=hasHorizontalTextStroke(layout),pad=stroke?textStrokePadding(layout):0;
 c.save();
 c.textAlign='left';c.textBaseline='alphabetic';c.fontKerning='normal';
 const solid=(e.fillType||'solid')==='solid';
 c.beginPath();c.rect(-pad,-pad,e.w+pad*2,e.h+pad*2);c.clip();
 for(const row of layout.rows){
  if(row.y>e.h)break;
  for(const part of row.fragments){
   const s=part.style;
   if(method==='stroke'&&!(s.strokeWidth>0))continue;
   // Assign text state inside its saved scope. Chromium's save() can clear
   // the letterSpacing getter even while retaining its measured advance.
   c.save();c.font=richTextFont(s);c.letterSpacing=s.letterSpacing+'px';
   if(method==='stroke'){
    c.lineWidth=s.strokeWidth;c.strokeStyle=s.stroke;
    c.globalAlpha*=Math.max(0,Math.min(1,(s.strokeOpacity??e.strokeOpacity??100)/100));
    c.lineJoin='round';c.miterLimit=2;c.lineCap='butt';
    const strokeStyle=s.strokeStyle??e.strokeStyle??'solid';
    c.setLineDash(strokeStyle==='dashed'?[Math.max(3,s.strokeWidth*4),Math.max(2,s.strokeWidth*2)]:
     strokeStyle==='dotted'?[Math.max(1,s.strokeWidth*.12),Math.max(2,s.strokeWidth*2)]:[]);
    if(strokeStyle==='dotted')c.lineCap='round';
    c.strokeText(part.text,part.x,part.y);
   }else{
    if(solid){c.fillStyle=s.textColor;c.globalAlpha*=Math.max(0,Math.min(1,(s.fillOpacity??e.fillOpacity??100)/100));}
    c.fillText(part.text,part.x,part.y);
   }
   c.restore();
  }
  if(method==='fill')for(const rect of row.decorations){
   c.save();
   if(solid){c.fillStyle=rect.color;c.globalAlpha*=Math.max(0,Math.min(1,(rect.fillOpacity??e.fillOpacity??100)/100));}
   c.fillRect(rect.x,rect.y,rect.width,rect.height);c.restore();
  }
 }
 c.restore();
}
