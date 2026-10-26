// Test-only observation. Never invokes editor internals or changes input delivery.
async function installMobilePointerDiagnostics(page) {
  await page.addInitScript(() => {
    const defer = window.setTimeout.bind(window);
    const entries = [], nodes = new WeakMap(), starts = new Map(); let next = 0;
    const types = new Set(['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'click']);
    const node = el => {
      if (!el) return null;
      if (!nodes.has(el)) nodes.set(el, ++next);
      const r = el.getBoundingClientRect?.();
      return { node: nodes.get(el), tag: el.nodeName, id: el.id, action: el.dataset?.mpAction, connected: el.isConnected,
        rect: r && { x: r.x, y: r.y, width: r.width, height: r.height },
        css: el instanceof Element ? { touchAction: getComputedStyle(el).touchAction, pointerEvents: getComputedStyle(el).pointerEvents, transform: getComputedStyle(el).transform } : null };
    };
    const view = () => {
      const s = document.querySelector('#stageScroller'), v = visualViewport;
      return { scroll: [scrollX, scrollY], stage: s && [s.scrollLeft, s.scrollTop], inner: [innerWidth, innerHeight],
        client: [document.documentElement.clientWidth, document.documentElement.clientHeight],
        visual: v && { width: v.width, height: v.height, offsetLeft: v.offsetLeft, offsetTop: v.offsetTop, scale: v.scale },
        done: node(document.querySelector('[data-mp-action="done"]')), plane: node(document.querySelector('[data-mp-plane]')) };
    };
    const add = data => { entries.push({ time: performance.now(), ...data }); if (entries.length > 2000) entries.shift(); };
    window.mobilePointerDiagnostics = { entries, snapshot: view };
    const points = ev => ev.changedTouches ? [...ev.changedTouches].map(t => ({ id: t.identifier, x: t.clientX, y: t.clientY, pageX: t.pageX, pageY: t.pageY, screenX: t.screenX, screenY: t.screenY, target: node(t.target), hit: node(document.elementFromPoint(t.clientX, t.clientY)) })) :
      [{ id: ev.pointerId, x: ev.clientX, y: ev.clientY, pageX: ev.pageX, pageY: ev.pageY, screenX: ev.screenX, screenY: ev.screenY, hit: node(document.elementFromPoint(ev.clientX, ev.clientY)) }];
    const prevented = Event.prototype.preventDefault;
    Event.prototype.preventDefault = function (...args) {
      const before = this.defaultPrevented, result = prevented.apply(this, args);
      if (types.has(this.type)) add({ kind: 'preventDefault', type: this.type, trusted: this.isTrusted, before, after: this.defaultPrevented, cancelable: this.cancelable, target: node(this.target), stack: new Error().stack });
      return result;
    };
    for (const type of types) {
      document.addEventListener(type, ev => {
        const key = ev.pointerId === undefined ? null : ev.pointerId;
        if (type === 'pointerdown') starts.set(key, ev.target);
        const original = starts.get(key);
        add({ kind: 'capture', type, trusted: ev.isTrusted, defaultPrevented: ev.defaultPrevented, cancelable: ev.cancelable, target: node(ev.target), original: node(original), points: points(ev), touches: ev.touches?.length, view: view() });
        // Deferred sampling also runs when editor handlers stop propagation.
        defer(() => add({ kind: 'after-dispatch', type, defaultPrevented: ev.defaultPrevented, target: node(ev.target), original: node(original), points: points(ev), view: view() }), 0);
      }, { capture: true, passive: true });
      document.addEventListener(type, ev => add({ kind: 'bubble', type, defaultPrevented: ev.defaultPrevented, target: node(ev.target) }), { passive: true });
    }
    new MutationObserver(records => {
      const related = records.filter(r => r.target instanceof Element && (r.target.closest('#mobilePropertyUI') || [...r.addedNodes, ...r.removedNodes].some(n => n instanceof Element && (n.id === 'mobilePropertyUI' || n.matches?.('.mp-sheet')))));
      if (related.length) add({ kind: 'mutation', changes: related.map(r => ({ type: r.type, attribute: r.attributeName, oldValue: r.oldValue, target: node(r.target), added: [...r.addedNodes].map(node), removed: [...r.removedNodes].map(node) })), view: view() });
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['style', 'class'] });
    document.addEventListener('scroll', ev => add({ kind: 'scroll', target: node(ev.target), view: view() }), { capture: true, passive: true });
    for (const type of ['resize', 'scroll']) visualViewport?.addEventListener(type, () => add({ kind: 'visualViewport', type, view: view() }));
  });
}
async function attachMobilePointerDiagnostics(page, info) {
  const data = await page.evaluate(() => window.mobilePointerDiagnostics ? { entries: mobilePointerDiagnostics.entries, final: mobilePointerDiagnostics.snapshot() } : null).catch(error => ({ error: error.message }));
  if (data) {
    const path = info.outputPath('mobile-pointer-diagnostics.json');
    await require('node:fs/promises').writeFile(path, JSON.stringify(data, null, 2));
    await info.attach('mobile-pointer-diagnostics', { path, contentType: 'application/json' });
  }
}
module.exports = { installMobilePointerDiagnostics, attachMobilePointerDiagnostics };
