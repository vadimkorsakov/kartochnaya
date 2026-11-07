// Document-space rectangles, shared by Canvas/PNG and DOM backgrounds.
// The legacy offsets/thickness are retained; each range uses its own font size
// and effective text color. Details extensions intentionally do not paint.
export function textDecorationRects(part, style) {
  const thickness = Math.max(1, style.fontSize / 19);
  return [['underline', .1], ['strikethrough', -.31]]
    .filter(([key]) => style[key] && part.width > 0)
    .map(([kind, offset]) => ({kind, x:part.x,
      y:part.y + style.fontSize * offset - thickness / 2,
      width:part.width, height:thickness, color:style.textColor}));
}
