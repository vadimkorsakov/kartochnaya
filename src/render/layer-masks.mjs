// Content + target dimensions determine a persisted mask. Historical layer IDs,
// active documents and draft revisions are deliberately absent from this cache.
export const maskKey = (src, d) => JSON.stringify([src, d.width, d.height]);

export function createLayerMasks({ createCanvas, readImage, limit = 8 }) {
  const ready = new Map(), drafts = new WeakMap();
  function canvas(d) { return createCanvas(d.width, d.height); }
  function alpha(source, d) {
    const out = canvas(d), c = out.getContext('2d', { willReadFrequently: true });
    c.drawImage(source, 0, 0, d.width, d.height);
    const data = c.getImageData(0, 0, d.width, d.height), pixels = data.data;
    for (let i = 0; i < pixels.length; i += 4) {
      const brightness = Math.round(.2126*pixels[i] + .7152*pixels[i+1] + .0722*pixels[i+2]);
      pixels[i] = pixels[i+1] = pixels[i+2] = 255;
      pixels[i+3] = Math.round(brightness*pixels[i+3]/255);
    }
    c.putImageData(data, 0, 0); return out;
  }
  function remember(src, d, source) {
    // Own an immutable copy: painting a draft must never change another canvas's
    // persisted mask, even if both documents use identical PNG bytes and IDs.
    const copy = canvas(d); copy.getContext('2d').drawImage(source, 0, 0, d.width, d.height);
    const result = { state: 'ready', canvas: copy, alpha: null };
    const key = maskKey(src, d); ready.delete(key); ready.set(key, result);
    while (ready.size > limit) ready.delete(ready.keys().next().value);
    return result;
  }
  function read(src, d) {
    if (!src) return { state: 'absent', canvas: null, alpha: null };
    const key = maskKey(src, d);
    if (ready.has(key)) {
      const result = ready.get(key); ready.delete(key); ready.set(key, result); return result;
    }
    const resource = readImage(src);
    if (resource.state !== 'ready') return { state: resource.state, canvas: null, alpha: null };
    return remember(src, d, resource.image);
  }
  return {
    read, remember,
    alpha(src, d) {
      const result = read(src, d);
      if (result.state !== 'ready') return null;
      return result.alpha ||= alpha(result.canvas, d);
    },
    editable(src, d) {
      const result = read(src, d);
      if (result.state !== 'ready' && result.state !== 'absent') return null;
      const out = canvas(d), c = out.getContext('2d');
      if (result.canvas) c.drawImage(result.canvas, 0, 0);
      else { c.fillStyle = '#ffffff'; c.fillRect(0, 0, d.width, d.height); }
      return out;
    },
    draft(source, version, d) {
      const key = JSON.stringify([version, d.width, d.height]), old = drafts.get(source);
      if (old?.key === key) return old.alpha;
      const result = alpha(source, d); drafts.set(source, { key, alpha: result }); return result;
    },
  };
}
