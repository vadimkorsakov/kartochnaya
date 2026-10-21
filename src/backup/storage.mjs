import { runStoreTransaction } from '../storage/indexeddb.mjs';
import { STORES } from './archive.mjs';

export async function readWorkspaceSnapshot(db) {
  const snapshot = {};
  let timer;
  try { await runStoreTransaction(db, STORES, 'readonly', store => {
    timer = setTimeout(() => { try { store(STORES[0]).transaction.abort(); } catch {} }, 30000);
    for (const name of STORES) {
      const request = store(name).getAll();
      request.onsuccess = () => { snapshot[name] = request.result; };
    }
  }); } finally { clearTimeout(timer); }
  return snapshot;
}

// Track the original promise; both branches consume it, never leave a rejecting
// finally() derivative unobserved. Failure of a non-document write is sticky:
// only a reload/reconciliation can prove that in-memory globals match storage.
export function createWorkspaceBarrier() {
  const pending = new Set(); let writeFailure = null;
  function track(promise, { store, write = false } = {}) {
    pending.add(promise);
    promise.then(() => pending.delete(promise), error => {
      pending.delete(promise); if (write && store !== 'docs') writeFailure = error;
    });
    return promise;
  }
  async function drain() {
    while (pending.size) await Promise.allSettled([...pending]);
    if (writeFailure) throw new Error('Есть неподтверждённая запись. Экспортируй JSON и проверь хранилище: ' + writeFailure.message);
  }
  return { track, drain };
}
