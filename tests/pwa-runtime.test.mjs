import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForOfflineWorker } from '../src/pwa/runtime.mjs';

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
