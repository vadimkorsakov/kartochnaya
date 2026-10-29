// Separate instrumented build, never shipped. Exposes measurements only, no app access.
const { readFile } = require('node:fs/promises');
const path = require('node:path');

async function diagnosticHTML(sourceFile) {
  const { compileHTML } = await import('../scripts/compile-html.mjs');
  const source = sourceFile ? await readFile(sourceFile, 'utf8') : null;
  return compileHTML(undefined, { transformEditor(text) {
    text = source || text;
    const end = text.lastIndexOf('})();');
    if (end < 0) throw Error('Editor closure not found');
    return text.slice(0, end) + `
    const audit = window.brushAudit = { calls: {}, times: {}, pending: 0, maxPending: 0, frames: 0, canvases: 0 };
    function measure(name, fn) { return function(...args) {
      const start = performance.now();
      audit.calls[name] = (audit.calls[name] || 0) + 1;
      try { return fn.apply(this, args); }
      finally { (audit.times[name] ||= []).push(performance.now() - start); }
    }; }
    paint = measure('paint', paint);
    paintDocument = measure('paintDocument', paintDocument);
    inkOverlay = measure('inkOverlay', inkOverlay);
    inkMove = measure('inkMove', inkMove);
    inkEnd = measure('inkEnd', inkEnd);
    paintMaskedBase = measure('paintMaskedBase', paintMaskedBase);
    const create = document.createElement.bind(document);
    document.createElement = function(tag, ...args) { if(tag === 'canvas') audit.canvases++; return create(tag, ...args); };
    const proto = CanvasRenderingContext2D.prototype;
    proto.drawImage = measure('drawImage', proto.drawImage);
    HTMLCanvasElement.prototype.toDataURL = measure('toDataURL', HTMLCanvasElement.prototype.toDataURL);
    const raf = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window), owned = new Set();
    window.requestAnimationFrame = function(fn) {
      if(fn.name !== 'renderInkPreview') return raf(fn);
      const id = raf(function(time) { owned.delete(id); audit.pending--; audit.frames++; measure('previewFrame', fn)(time); });
      owned.add(id); audit.pending++; audit.maxPending = Math.max(audit.maxPending, audit.pending); return id;
    };
    window.cancelAnimationFrame = function(id) { if(owned.delete(id)) audit.pending--; return cancel(id); };
    ` + text.slice(end);
  } });
}

async function instrument(page, sourceFile) {
  const html = await diagnosticHTML(sourceFile);
  await page.route('**/index.html', route => route.fulfill({ body: html, contentType: 'text/html' }));
  return html;
}
async function reset(page) {
  await page.evaluate(() => {
    const a = window.brushAudit;
    a.calls = {}; a.times = {}; a.frames = 0; a.maxPending = a.pending; a.canvases = 0;
  });
}
async function snapshot(page) {
  return page.evaluate(() => {
    const preview = document.querySelector('#inkPreview');
    return { ...structuredClone(window.brushAudit), preview: preview ? { width: preview.width, height: preview.height, rgbaBytes: preview.width * preview.height * 4 } : null };
  });
}

function fixture(width = 1080) {
  const layer = (id, extra = {}) => ({ id, name: id, type: 'rect', x: width * .08, y: width * .1, w: width * .8, h: width * .75, rotation: 0, visible: true, opacity: 100, fillType: 'solid', fill: '#4b67b4', fillOpacity: 100, strokeWidth: 0, ...extra });
  return { format: 'kartochnaya-project-v1', project: { id: 'brush-project', name: 'Brush diagnostics', resources: [], resourceFolders: [] }, fonts: [], documents: [{ id: 'brush-doc', projectId: 'brush-project', title: 'Brush diagnostics', type: 'template', width, height: width, background: '#ffffff', backgroundAlpha: 100, groups: [], rulers: [], palette: [], createdAt: 1, updatedAt: 1, elements: [
    layer('base'), layer('blur', { x: width * .2, y: width * .2, w: width * .4, h: width * .4, fill: '#ffcc44', effects: [{ id: 'blur-fx', type: 'gaussianBlur', enabled: true, radius: 8 }] }),
    layer('pixels', { x: width * .5, y: width * .5, w: width * .3, h: width * .3, fill: '#ee4477', effects: [{ id: 'pixel-fx', type: 'pixelate', enabled: true, blockSize: 24 }] }),
  ] }] };
}

// Dispatch all samples in each batch synchronously; rAF may combine draws but
// must retain the intervening trajectory. A real pointerdown establishes capture.
async function moves(page, { count = 360, batches = 36, width = 1080, progress = false } = {}) {
  return page.locator('#canvas').evaluate(async (canvas, { count, batches, width, progress }) => {
    const durations = [], gaps = [], work = []; let previous = performance.now();
    for (let batch = 0; batch < batches; batch++) {
      const previewCount = window.brushAudit?.times.previewFrame?.length || 0;
      await new Promise(requestAnimationFrame);
      const previewMs = (window.brushAudit?.times.previewFrame || []).slice(previewCount).reduce((sum, time) => sum + time, 0);
      const start = performance.now(); gaps.push(start - previous);
      for (let i = Math.floor(batch * count / batches); i < Math.floor((batch + 1) * count / batches); i++) {
        const t = i / (count - 1), rect = canvas.getBoundingClientRect();
        const x = width * (.12 + .76 * t), y = width * (.5 + .22 * Math.sin(t * Math.PI * 8));
        canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: rect.left + x / width * rect.width, clientY: rect.top + y / width * rect.height }));
      }
      durations.push(performance.now() - start); previous = start;
      work.push(durations.at(-1) + previewMs);
      if (progress) console.log('BRUSH_PROGRESS ' + JSON.stringify({ points: Math.floor((batch + 1) * count / batches), batches: batch + 1, batchMs: durations.at(-1), compositions: window.brushAudit.calls.paint || 0 }));
    }
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    return { durations, gaps, work };
  }, { count, batches, width, progress });
}
module.exports = { diagnosticHTML, instrument, reset, snapshot, fixture, moves };
