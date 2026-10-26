import test from 'node:test';
import assert from 'node:assert/strict';
import { installNetlifyPWA, waitForOfflineWorker } from '../src/pwa/runtime.mjs';

function registration(state) {
  const registration = new EventTarget();
  registration.installing = Object.assign(new EventTarget(), { state });
  return registration;
}

test('failed install rejects even though serviceWorker.ready would remain pending', async () => {
  const reg = registration('installing');
  const pending = waitForOfflineWorker(reg);
  reg.installing.state = 'redundant';
  reg.installing.dispatchEvent(new Event('statechange'));
  await assert.rejects(pending, /SHA-256/);
});

test('stalled installation times out', async () => {
  await assert.rejects(waitForOfflineWorker(registration('installing'), 10), /30 секунд/);
});

test('active and waiting workers finish without waiting for controllerchange', async () => {
  await waitForOfflineWorker(Object.assign(new EventTarget(), { active: { state: 'activated' } }));
  await waitForOfflineWorker(Object.assign(new EventTarget(), { waiting: { state: 'installed' } }));
});

test('activation and late updatefound are observed', async () => {
  const reg = new EventTarget();
  const pending = waitForOfflineWorker(reg);
  const worker = Object.assign(new EventTarget(), { state: 'installing' });
  reg.installing = worker;
  reg.dispatchEvent(new Event('updatefound'));
  reg.installing = null; reg.active = worker; worker.state = 'activated';
  worker.dispatchEvent(new Event('statechange'));
  await pending;
});

// A small DOM/worker harness keeps state transitions independent of the browser.
function runtime(t, reg) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const nodes = [];
  class Element extends EventTarget {
    constructor() { super(); this.dataset = {}; this.style = { setProperty() {} }; this.hidden = false; }
    append(...children) { nodes.push(...children); }
    setAttribute(name, value) { this[name] = String(value); }
    contains() { return false; }
    remove() { this.removed = true; }
  }
  const tabs = new Element();
  const document = Object.assign(new EventTarget(), {
    createElement: () => new Element(), body: new Element(), head: new Element(), documentElement: new Element(),
    getElementById: id => id === 'documentTabs' ? tabs : nodes.find(node => node.id === id),
  });
  const serviceWorker = Object.assign(new EventTarget(), { register: t.mock.fn(async () => reg) });
  const reload = t.mock.fn(), prepare = t.mock.fn(async () => {}), resume = t.mock.fn();
  for (const [key, value] of Object.entries({ document, navigator: { serviceWorker, onLine: true }, window: new EventTarget(), location: { reload } })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => old ? Object.defineProperty(globalThis, key, old) : delete globalThis[key]);
  }
  installNetlifyPWA({ prepare, resume });
  return { get: id => document.getElementById(id), serviceWorker, reload, prepare, resume };
}
function worker(ready, version = 'old') {
  return Object.assign(new EventTarget(), { state: 'activated', postMessage(message, ports) {
    if (message.type === 'OFFLINE_STATUS') ports[0].postMessage({ ready, version });
  } });
}
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };

test('first success is confirmed by worker and automatically collapses; reopening does not register again', async t => {
  const reg = registration('installing'), ui = runtime(t, reg);
  await settle();
  assert.notEqual(ui.get('pwaStatus').dataset.offlineReady, 'true');
  reg.active = worker(true); reg.installing.state = 'activated';
  const installing = reg.installing; reg.installing = null;
  installing.dispatchEvent(new Event('statechange'));
  await settle();
  assert.equal(ui.get('pwaStatus').dataset.offlineReady, 'true');
  assert.equal(ui.get('pwaStatus').hidden, false);
  ui.serviceWorker.dispatchEvent(new Event('controllerchange'));
  await settle();
  assert.equal(ui.get('pwaMessage').textContent, 'Офлайн-копия готова');
  t.mock.timers.tick(4001);
  assert.equal(ui.get('pwaStatus').hidden, true);
  ui.get('pwaToggle').onclick();
  assert.equal(ui.get('pwaStatus').hidden, false);
  assert.equal(ui.serviceWorker.register.mock.callCount(), 1);
});

test('redundant candidate without confirmed previous copy is an initial install failure', async t => {
  const reg = Object.assign(new EventTarget(), { active: worker(false) }), ui = runtime(t, reg);
  await settle();
  reg.installing = worker(false); reg.installing.state = 'installing';
  reg.dispatchEvent(new Event('updatefound'));
  reg.installing.state = 'redundant'; reg.installing.dispatchEvent(new Event('statechange'));
  await settle();
  assert.equal(ui.get('pwaStatus').dataset.offlineReady, 'false');
  assert.match(ui.get('pwaMessage').textContent, /подготовить/);
  assert.doesNotMatch(ui.get('pwaDetails').textContent, /Прежняя рабочая копия сохранена/);
  ui.get('pwaClose').onclick(); ui.get('pwaToggle').onclick(); ui.get('pwaDetailsToggle').onclick();
  assert.equal(ui.get('pwaDetails').hidden, false);
  assert.equal(ui.get('pwaRetry').hidden, false);
});

test('normal ready session stays compact and failed update preserves confirmed readiness', async t => {
  const reg = Object.assign(new EventTarget(), { active: worker(true) }), ui = runtime(t, reg);
  await settle();
  assert.equal(ui.get('pwaStatus').hidden, true);
  reg.installing = worker(false); reg.dispatchEvent(new Event('updatefound'));
  reg.installing.state = 'redundant'; reg.installing.dispatchEvent(new Event('statechange'));
  await settle();
  assert.equal(ui.get('pwaStatus').dataset.offlineReady, 'true');
  assert.equal(ui.get('pwaStatus').dataset.version, 'old');
  assert.match(ui.get('pwaDetails').textContent, /Прежняя рабочая копия сохранена/);
});

test('candidate already installing at registration confirms old copy before reporting failure', async t => {
  const reg = registration('installing'); reg.active = worker(true);
  const ui = runtime(t, reg);
  await settle();
  reg.installing.state = 'redundant'; reg.installing.dispatchEvent(new Event('statechange'));
  await settle();
  assert.equal(ui.get('pwaStatus').dataset.offlineReady, 'true');
  assert.match(ui.get('pwaDetails').textContent, /Прежняя рабочая копия сохранена/);
});

test('waiting update requires explicit click and failed save postpones activation and reload', async t => {
  const waiting = worker(true, 'next'); waiting.state = 'installed';
  const post = t.mock.method(waiting, 'postMessage');
  const reg = Object.assign(new EventTarget(), { active: worker(true), waiting }), ui = runtime(t, reg);
  await settle();
  assert.equal(ui.get('pwaUpdate').hidden, false);
  assert.equal(ui.prepare.mock.callCount(), 0);
  ui.prepare.mock.mockImplementation(async () => { throw Error('IndexedDB save failed'); });
  await ui.get('pwaUpdate').onclick();
  assert.match(ui.get('pwaMessage').textContent, /Обновление отложено/);
  assert.equal(post.mock.calls.some(call => call.arguments[0].type === 'ACTIVATE_UPDATE'), false);
  assert.equal(ui.reload.mock.callCount(), 0);
  assert.equal(ui.resume.mock.callCount(), 1);
});
