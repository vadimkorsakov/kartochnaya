import { createBackup, readBackup, readPreferences, PREFERENCE_KEYS, STORES } from './archive.mjs';
import { runStoreTransaction } from '../storage/indexeddb.mjs';

const encode = value => JSON.stringify(value);

// Validation finishes before opening the destructive transaction. The four reads
// and all clears/puts share its lock: another writer cannot enter the check/clear gap.
export async function replaceWorkspace(db, bytes, expected, checkPreferences = () => {}) {
  const { manifest, data } = await readBackup(bytes);
  if (manifest.scope !== 'workspace') throw Error('Для замены нужен полный архив workspace');
  if (!expected || STORES.some(name => !Array.isArray(expected[name]))) throw Error('Нет страховочного снимка');
  await runStoreTransaction(db, STORES, 'readwrite', store => {
    checkPreferences();
    let remaining = STORES.length;
    for (const name of STORES) {
      const request = store(name).getAll();
      request.onsuccess = () => {
        try {
          if (encode(request.result) !== encode(expected[name])) { store(name).transaction.abort(); return; }
          if (--remaining) return;
          // No await, normalization, ID remapping, timestamps or generated defaults.
          for (const target of STORES) {
            store(target).clear();
            for (const record of data[target]) store(target).put(record);
          }
        } catch { store(name).transaction.abort(); }
      };
    }
  });
  return data.preferences;
}

export function applyWorkspacePreferences(storage, preferences) {
  const failures = [];
  for (const key of PREFERENCE_KEYS) {
    try {
      if (Object.hasOwn(preferences, key)) storage.setItem(key, preferences[key]);
      else storage.removeItem(key);
    } catch { failures.push(key); }
  }
  return failures;
}

// Only this session's protected snapshot authorizes replacement. Packaging an
// optional recovery file neither grants nor invalidates that authority.
export function createReplacementSession({ begin, end, db, storage, download, stop, reload }) {
  let state = 'idle', expected, preferences, preparing, releasing;
  const release = () => releasing ||= (async () => {
    state = 'cancelling'; expected = preferences = null;
    try { await end(); } finally { state = 'idle'; releasing = null; }
  })();
  const cancel = async () => {
    if (state === 'committed') return;
    if (state === 'committing' || state === 'packaging') throw Error('Дождись завершения операции');
    if (state === 'preparing' || state === 'cancelling') {
      state = 'cancelling';
      await preparing?.catch(() => {});
    }
    if (state !== 'idle') await release();
  };
  return {
    committed: () => state === 'committed',
    prepare() {
      if (state !== 'idle') return Promise.reject(Error('Операция уже начата'));
      state = 'preparing';
      preparing = (async () => { try {
        expected = await begin(); preferences = readPreferences(storage);
        if (state !== 'preparing') throw Error('Подготовка отменена');
        if (!expected || STORES.some(name => !Array.isArray(expected[name]))) throw Error('Контрольный снимок не подтверждён');
        state = 'ready';
        // Do not expose mutable references to the session's comparison proof.
        return Object.fromEntries(STORES.map(name => [name, expected[name].length]));
      } catch (error) { await release(); throw error; } })();
      return preparing;
    },
    async downloadSafety() {
      if (state !== 'ready') throw Error('Сначала подготовь замену');
      state = 'packaging';
      try {
        const safety = await createBackup(expected, { preferences });
        await download(new Blob([safety.bytes], { type: 'application/zip' }), safety.filename);
      } finally { state = 'ready'; }
    },
    async commit(bytes) {
      if (state !== 'ready') throw Error('Замена не подготовлена');
      state = 'committing';
      let restored;
      try {
        const checkPreferences = () => {
          if (encode(readPreferences(storage)) !== encode(preferences)) throw Error('Настройки изменились. Подготовь замену заново');
        };
        checkPreferences();
        // Recheck after asynchronous ZIP validation, before queuing any writes.
        restored = await replaceWorkspace(db(), bytes, expected, checkPreferences);
      } catch (error) { await release(); throw error; }
      state = 'committed';
      expected = preferences = null;
      // From here no recovery write to IndexedDB is permitted, even if storage
      // or navigation fails. The stopped editor remains locked until reload.
      stop();
      const failures = applyWorkspacePreferences(storage, restored);
      reload(failures);
      return failures;
    },
    cancel,
  };
}
