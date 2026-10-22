/* Netlify only. No runtime caching and no access to IndexedDB. */
const VERSION = '__BUILD_VERSION__';
const FILES = __BUILD_FILES__;
const PREFIX = 'kartochnaya-netlify-';
const CACHE = PREFIX + VERSION;
const absolute = path => new URL(path, self.registration.scope).href;
const MARKER = absolute('./__offline_complete__');
const urls = new Set(FILES.map(file => absolute(file.url)));
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
async function complete() {
  const cache = await caches.open(CACHE);
  if (!(await cache.match(MARKER))) return false;
  for (const file of FILES) if (!(await cache.match(absolute(file.url)))) return false;
  return true;
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      for (const file of FILES) {
        const url = absolute(file.url);
        const response = await fetch(new Request(url, { cache: 'no-store', credentials: 'same-origin', redirect: 'error' }));
        if (!response.ok || await digest(await response.clone().arrayBuffer()) !== file.sha256) throw Error('Incomplete deployment: ' + file.url);
        await cache.put(url, response);
      }
      await cache.put(MARKER, new Response(VERSION));
      if (!await complete()) throw Error('Incomplete offline cache');
    } catch (error) {
      await caches.delete(CACHE); // Only the candidate, never the working version.
      throw error;
    }
  })());
  // A new deployment waits. Only the user's update button calls skipWaiting.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    if (!await complete()) throw Error('Cannot activate an incomplete cache');
    const previous = (await caches.keys()).filter(key => key.startsWith(PREFIX) && key !== CACHE);
    // Keep one prior complete version as well as the current version.
    await Promise.all(previous.slice(0, -1).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'OFFLINE_STATUS') event.waitUntil(complete().then(ready => event.ports[0]?.postMessage({ ready, version: VERSION })));
  if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(complete().then(ready => { if (ready) return self.skipWaiting(); }));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  let key = url.href;
  if (event.request.mode === 'navigate' && (url.pathname === new URL(self.registration.scope).pathname || url.pathname === new URL('./index.html', self.registration.scope).pathname)) key = absolute('./index.html');
  if (!urls.has(key)) return; // No external requests, tokens or user data in Cache Storage.
  event.respondWith((async () => {
    const cached = await (await caches.open(CACHE)).match(key);
    return cached || new Response('Офлайн-копия недоступна. Подключитесь к сети.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});
