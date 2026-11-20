import {resolveUnderlineDetails} from '../model/rich-text.mjs';
import {glyphFontSize} from './text-baseline-shift.mjs';

// Decoration intervals are in document space. Pattern geometry is painted
// downstream, after Justify has expanded the source spaces.
export function textDecorationRects(part, style, kind) {
  const size = glyphFontSize(style);
  const thickness = Math.max(1, size / 19);
  if (!(part.width > 0)) return [];
  const rect = (kind, offset, height, color) => ({
    kind, x:part.x, y:part.y + offset - height / 2, width:part.width, height, color,
  });
  const result = [];
  if (style.underline && kind !== 'strikethrough') {
    const details = resolveUnderlineDetails(style.underlineDetails);
    const advanced = Object.keys(details).length > 0;
    const underline = rect('underline',
      typeof details.offset === 'number' ? details.offset : size * .1,
      typeof details.thickness === 'number' ? details.thickness : thickness,
      details.color && details.color !== 'inherit' ? details.color : style.textColor);
    if (advanced) Object.assign(underline, {advanced, style:details.style ?? 'solid',
      fillOpacity:typeof details.opacity === 'number' ? details.opacity : style.fillOpacity});
    result.push(underline);
  }
  if (style.strikethrough && kind !== 'underline') result.push(rect('strikethrough', -size * .31, thickness, style.textColor));
  return result;
}

// Join matching paint across glyph boundaries and carry phase across changes
// in color, baseline or thickness within one continuous pattern on this row.
function underlinePatterns(decorations) {
  const underlines = decorations.filter(d => d.kind === 'underline'), result = [];
  for (const d of underlines) {
    const previous = result.at(-1);
    const adjacent = previous?.end === d.start;
    const style = d.style ?? 'solid';
    if (adjacent && Math.abs(previous.x + previous.width - d.x) < 1e-6 && previous.style === style && (d.advanced || previous.advanced) && previous.y === d.y &&
        previous.height === d.height && previous.color === d.color && previous.fillOpacity === d.fillOpacity) {
      previous.width = d.x + d.width - previous.x;
      previous.end = d.end;
    } else {
      const continuous = adjacent && previous.style === style;
      const phase = continuous ? (previous.phase + previous.width / previous.period) % 1 : 0;
      result.push({...d, style, phase, continuation:continuous, period:Math.max(2,d.height * (style === 'wavy' ? 4 : 2.5))});
    }
  }
  return result;
}

function paintPattern(c, d, next, clipLeft, clipRight) {
  const {x,y,width,height,phase,period} = d;
  const left = Math.max(0, clipLeft - x), right = Math.min(width, clipRight - x);
  if (!(right > left) || !Number.isFinite(period)) return;
  const center = y + height / 2;
  c.beginPath();
  c.rect(x + left, center - height * 2, right - left, height * 4);
  c.clip();
  c.beginPath();
  if (d.style === 'dotted') {
    const isolated = !d.continuation && !next?.continuation, radius = Math.min(height / 2, isolated ? width / 2 : height / 2);
    if (isolated && width < period) {
      c.arc(x + width / 2, center, radius, 0, Math.PI * 2);
    } else {
      const origin = (.5 - phase) * period;
      const first = origin + Math.ceil((left - radius - origin) / period) * period;
      for (let at = first; at < right + radius; at += period) {
        c.moveTo(x + at + radius, center);
        c.arc(x + at, center, radius, 0, Math.PI * 2);
      }
    }
    c.fill();
  } else {
    const amplitude = height * .75, quarter = period / 4;
    const origin = -phase * period;
    const start = origin + (Math.floor((left - origin) / quarter) - 1) * quarter;
    const end = right + quarter;
    const angle = at => (at - origin) / period * Math.PI * 2;
    const wave = at => center + amplitude * Math.sin(angle(at));
    const slope = at => amplitude * Math.PI * 2 / period * Math.cos(angle(at));
    c.moveTo(x + start,wave(start));
    for (let at = start; at < end; at += quarter) {
      const after = at + quarter, handle = quarter / 3;
      c.bezierCurveTo(x + at + handle,wave(at) + slope(at) * handle,
        x + after - handle,wave(after) - slope(after) * handle,x + after,wave(after));
    }
    c.lineWidth = height;
    c.lineCap = 'butt';
    c.strokeStyle = c.fillStyle;
    c.setLineDash([]);
    c.stroke();
  }
}

export function paintTextDecorations(c, decorations, solid, opacity = 100, clipLeft = -Infinity, clipRight = Infinity) {
  const advanced = decorations.some(d => d.advanced);
  const underlines = advanced ? underlinePatterns(decorations) : [];
  const paint = advanced ? [...underlines, ...decorations.filter(d => d.kind !== 'underline')] : decorations;
  for (const [i,d] of paint.entries()) {
    c.save();
    if (solid) {
      c.fillStyle = d.color;
      c.globalAlpha *= Math.max(0, Math.min(1, (d.fillOpacity ?? opacity) / 100));
    }
    if (d.style === 'dotted' || d.style === 'wavy') paintPattern(c,d,underlines[i+1],clipLeft,clipRight);
    else c.fillRect(d.x,d.y,d.width,d.height);
    c.restore();
  }
}
