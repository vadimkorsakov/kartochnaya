import { createBackup, readBackup, readPreferences, PREFERENCE_KEYS, sha256, STORES } from './archive.mjs';
import { runStoreTransaction } from '../storage/indexeddb.mjs';

const encode = value => JSON.stringify(value);

// Validation finishes before opening the destructive transaction. The four reads
// and all clears/puts share its lock: another writer cannot enter the check/clear gap.
export async function replaceWorkspace(db, bytes, expected) {
  const { manifest, data } = await readBackup(bytes);
  if (manifest.scope !== 'workspace') throw Error('Для замены нужен полный архив workspace');
  if (!expected || STORES.some(name => !Array.isArray(expected[name]))) throw Error('Нет страховочного снимка');
  await runStoreTransaction(db, STORES, 'readwrite', store => {
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

// A session owns the safety proof; neither a checkbox nor an arbitrary caller's
// "verified" flag can authorize replacement. Any pre-commit error invalidates it.
export function createReplacementSession({ begin, end, db, storage, download, stop, reload }) {
  let state = 'idle', expected, preferences, safetyHash;
  const cancel = async () => {
    if (state === 'committed') return;
    state = 'idle'; expected = preferences = safetyHash = null;
    await end();
  };
  return {
    committed: () => state === 'committed',
    async prepare() {
      if (state !== 'idle') throw Error('Операция уже начата');
      state = 'preparing';
      try {
        expected = await begin(); preferences = readPreferences(storage);
        const safety = await createBackup(expected, { preferences });
        await readBackup(safety.bytes);
        safetyHash = await sha256(safety.bytes);
        download(new Blob([safety.bytes], { type: 'application/zip' }), safety.filename);
        state = 'waiting';
        return expected;
      } catch (error) { await cancel(); throw error; }
    },
    async verify(bytes) {
      if (state !== 'waiting' && state !== 'verified') throw Error('Сначала создай страховочный ZIP');
      state = 'waiting';
      try {
        const result = await readBackup(bytes);
        if (result.manifest.scope !== 'workspace' || await sha256(bytes) !== safetyHash) throw Error('Выбранный страховочный ZIP не совпадает с только что созданным');
        state = 'verified';
      } catch (error) { await cancel(); throw error; }
    },
    async commit(bytes) {
      if (state !== 'verified') throw Error('Страховочный ZIP не проверен');
      state = 'committing';
      let restored;
      try {
        if (encode(readPreferences(storage)) !== encode(preferences)) throw Error('Настройки изменились. Создай новую страховочную копию');
        restored = await replaceWorkspace(db(), bytes, expected);
      } catch (error) { await cancel(); throw error; }
      state = 'committed';
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
