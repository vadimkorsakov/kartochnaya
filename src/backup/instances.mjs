// Cooperating instances hold shared Web Locks for their entire live state.
// An exclusive lock also prevents newly opened instances from loading old data.
// Older releases do not participate; the UI explicitly requires closing them.
export function createInstanceGuard(locks = globalThis.navigator?.locks) {
  const name = 'kartochnaya-workspace-v1';
  let release, lifetime, held = false, exclusive = false;
  function shared() {
    if (!locks) return Promise.resolve();
    return new Promise((resolve, reject) => {
      lifetime = locks.request(name, { mode: 'shared' }, async () => {
        held = true; resolve();
        await new Promise(done => { release = done; }); held = false;
      }).catch(reject);
    });
  }
  const ready = shared();
  return {
    ready,
    async acquire() {
      if (!locks) throw Error('Браузер не поддерживает Web Locks. Полная замена недоступна');
      await ready;
      // Serialize upgrades BEFORE releasing our shared lock. Concurrent upgraders
      // must retain their shared locks; otherwise a losing window could rejoin
      // with stale memory after another window has committed its replacement.
      await locks.request(name + '-replace-intent', { ifAvailable: true }, async intent => {
        if (!intent) throw Error('Другое окно уже начинает замену. Закрой остальные окна и повтори');
        release();
        await lifetime;
        const acquired = await new Promise((resolve, reject) => {
          lifetime = locks.request(name, { mode: 'exclusive', ifAvailable: true }, async lock => {
            if (!lock) { resolve(false); return; }
            held = exclusive = true; resolve(true);
            await new Promise(done => { release = done; }); held = exclusive = false;
          }).catch(reject);
        });
        if (!acquired) { await shared(); throw Error('Обнаружено другое активное окно КАРТОЧНОЙ. Закрой остальные окна и повтори'); }
      });
    },
    async release() { if (exclusive) { release(); await lifetime; await shared(); } },
    writable() { return !locks || held; },
  };
}
