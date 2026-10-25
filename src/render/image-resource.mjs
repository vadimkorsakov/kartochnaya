// One request/completion per source. Existing ready records from image editing
// remain compatible; resource state lives outside the serializable document.
export function readImageResource(cache, src, createImage, onSettled = () => {}) {
  if (!src) return { state: 'absent', image: null };
  if (!cache.has(src)) {
    const image = createImage(), rec = { image, ready: false, failed: false };
    cache.set(src, rec);
    rec.completion = new Promise(resolve => {
      const settle = ready => {
        rec.ready = ready; rec.failed = !ready;
        resolve(); onSettled(src);
      };
      image.onload = () => settle(true);
      image.onerror = () => settle(false);
      image.src = src;
    });
  }
  const rec = cache.get(src);
  return { state: rec.ready ? 'ready' : rec.failed ? 'error' : 'loading', image: rec.ready ? rec.image : null, completion: rec.completion };
}

export async function prepareImage(read, src) {
  let resource = read(src);
  if (resource.state === 'loading') { await resource.completion; resource = read(src); }
  if (resource.state === 'error') throw new Error('Не удалось прочитать изображение');
  return resource.image;
}
