// Geometry is derived from the resolved nominal size in document pixels.
const indexScale = .65;
const subOffset = .18;
const superOffset = -.35;

export const glyphFontSize = ({fontSize, baselineShift}) =>
  baselineShift === 'sub' || baselineShift === 'super' ? fontSize * indexScale : fontSize;

export const baselineOffset = ({fontSize, baselineShift}) =>
  fontSize * (baselineShift === 'sub' ? subOffset : baselineShift === 'super' ? superOffset : 0);
