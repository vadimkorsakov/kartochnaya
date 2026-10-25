import { createDriveSession, CLIENT_ID_KEY, validClientId } from './session.mjs';
import { createDriveClient, prepareDriveBackup } from './client.mjs';
export const ACCOUNTS_KEY = 'kartochnaya-cloud-accounts-v1';
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id);

// Durable metadata only. Each runtime record owns its client, session and operation.
export function createDriveAccounts({ storage, sessionFactory = createDriveSession, clientFactory = createDriveClient, prepareBackup = prepareDriveBackup, changed = () => {} } = {}) {
  const accounts = new Map();
  let clientId = '', candidate = null, targetId = null, batch = false, message = '';
  let archive = null, archiveVersion = 0, invalidationMessage = '';
  const staleArchive = () => Error('Сеанс исходного Google-аккаунта или выбранный ZIP изменился. Скачай и проверь архив заново.');
  function clearArchive(reason = staleArchive()) {
    archiveVersion++;
    const previous = archive; archive = null;
    if (previous) {
      previous.result = previous.account.verified = null;
      if (previous.transferred) invalidationMessage = reason.message;
      previous.controller.abort(reason);
    }
  }
  function checkArchive(lease = archive) {
    const a = lease?.account, state = a?.session.view();
    if (!lease || archive !== lease || lease.controller.signal.aborted || accounts.get(a.id) !== a || a.session !== lease.session ||
        state.status !== 'connected' || state.generation !== lease.generation || state.accountId !== lease.accountId ||
        a.id !== lease.accountId || Date.now() >= state.expiresAt || (!lease.transferred && a.verified !== lease.result)) throw staleArchive();
  }
  const notify = () => {
    if (archive) { try { checkArchive(); } catch (error) { clearArchive(error); } }
    changed();
  };
  // A single memory owner across all accounts. After handoff the lease retains
  // identity only; the local ZIP UI owns and releases the large buffer.
  async function downloadArchive(id, fileId, maxBytes) {
    return task(id, async (op, a) => {
      const version = archiveVersion, session = a.session, state = session.view();
      a.result = 'Скачиваем ZIP и проверяем SHA-256…'; notify();
      const result = await a.client.download(op, fileId, maxBytes); op.check();
      if (version !== archiveVersion || accounts.get(id) !== a || a.session !== session || session.view().generation !== state.generation) throw staleArchive();
      a.verified = result;
      archive = { account: a, session, generation: state.generation, accountId: state.accountId, result, controller: new AbortController(), transferred: false };
      checkArchive();
      a.result = 'ZIP проверен. Можно сохранить его на устройство или открыть восстановление.';
    });
  }
  function takeArchive(id) {
    checkArchive();
    const lease = archive;
    if (lease.account.id !== id || lease.account.operation || lease.transferred) throw staleArchive();
    const bytes = lease.result.bytes;
    lease.result = lease.account.verified = null; lease.transferred = true;
    return { bytes, signal: lease.controller.signal, check: () => checkArchive(lease) };
  }
  function persist() {
    storage.setItem(ACCOUNTS_KEY, JSON.stringify([...accounts.values()].map(a => ({ provider: 'google-drive', id: a.id, name: a.name, clientId }))));
  }
  function makeSession(id = null, callback = notify) { const session = sessionFactory({ expectedId: id, changed: callback }); session.configure(clientId); return session; }
  function record(id, name) {
    const a = { provider: 'google-drive', id, name, session: null, client: clientFactory(), operation: null, result: '', verified: null };
    a.session = makeSession(id, () => {
      if (a.session?.view().status !== 'connected') { a.client.reset(); a.verified = null; }
      notify();
    });
    return a;
  }
  function reload() {
    const value = storage.getItem(CLIENT_ID_KEY) || '';
    const nextClientId = validClientId(value) ? value : '';
    const rows = JSON.parse(storage.getItem(ACCOUNTS_KEY) || '[]');
    if (!Array.isArray(rows)) throw Error('Некорректный реестр Google-аккаунтов.');
    cancelAuthorization();
    if (nextClientId !== clientId) { for (const a of accounts.values()) disconnect(a.id); clientId = nextClientId; for (const a of accounts.values()) a.session.configure(clientId); }
    const ids = new Set();
    for (const row of rows) {
      if (row?.provider !== 'google-drive' || !validId(row.id) || typeof row.name !== 'string') continue;
      ids.add(row.id);
      if (!accounts.has(row.id)) accounts.set(row.id, record(row.id, row.name.slice(0, 512)));
    }
    for (const id of accounts.keys()) if (!ids.has(id)) { disconnect(id); accounts.delete(id); }
    notify();
  }
  function configure(value) {
    if (value && !validClientId(value)) throw Error('Некорректный Client ID.');
    if (value) storage.setItem(CLIENT_ID_KEY, value); else storage.removeItem(CLIENT_ID_KEY);
    cancelAuthorization();
    for (const a of accounts.values()) disconnect(a.id);
    clientId = value;
    for (const a of accounts.values()) a.session.configure(clientId);
    persist(); notify();
  }
  function cancelAuthorization() { const old = candidate; candidate = null; targetId = null; old?.disconnect(); }
  function authorize(id = null) {
    message = '';
    if (id && accounts.get(id)?.operation) throw Error('Дождись завершения операции аккаунта.');
    if (id && !accounts.has(id)) throw Error('Аккаунт удалён из списка.');
    if (id && archive?.account === accounts.get(id)) clearArchive();
    if (!candidate || targetId !== id) {
      cancelAuthorization(); targetId = id;
      let owner = null, pending;
      pending = makeSession(id, () => {
        if (owner && owner.session === pending && owner.session.view().status !== 'connected') { owner.client.reset(); owner.verified = null; }
        if (candidate === pending && pending?.view().status === 'connected') {
          const session = candidate, view = session.view(), existing = accounts.get(view.accountId);
          // Duplicate additions leave the existing live session and operations intact.
          if (existing && !id) { if (archive?.account === existing) clearArchive(); cancelAuthorization(); existing.result = 'Этот аккаунт уже добавлен. Используй его строку для подключения.'; notify(); return; }
          const a = existing || record(view.accountId, view.account);
          const previous = a.session, previousName = a.name;
          a.name = view.account; a.session = session; accounts.set(a.id, a);
          try { persist(); }
          catch { a.session = previous; a.name = previousName; if (!existing) accounts.delete(a.id); message = 'Не удалось сохранить список аккаунтов. Разреши локальное хранилище и подключи повторно.'; cancelAuthorization(); notify(); return; }
          owner = a; candidate = null; targetId = null; previous.disconnect(); a.client.reset(); a.verified = null; a.result = '';
        }
        notify();
      });
      candidate = pending;
    }
    if (candidate.view().ready) candidate.connect(); else return candidate.prepare();
  }
  function disconnect(id) {
    const a = accounts.get(id); if (!a) return;
    if (candidate && targetId === id) cancelAuthorization();
    if (archive?.account === a) clearArchive();
    a.operation?.abort(); a.session.disconnect(); a.client.reset(); a.verified = null; notify();
  }
  function remove(id) {
    const a = accounts.get(id); if (!a) return;
    disconnect(id); accounts.delete(id);
    try { persist(); } catch (error) { accounts.set(id, a); notify(); throw error; }
    notify();
  }
  async function task(id, action) {
    const a = accounts.get(id);
    if (!a || a.operation || a.session.view().status !== 'connected') throw Error('Подключи аккаунт и дождись завершения его операции.');
    clearArchive(); invalidationMessage = ''; message = '';
    const controller = new AbortController(); a.operation = controller; a.verified = null; a.result = 'Обращаемся к Google Drive…'; notify();
    try { return await a.session.withDriveOperation(op => action(op, a), { signal: controller.signal }); }
    catch (error) { a.result = error instanceof RangeError ? 'Недостаточно памяти для ZIP. Используй компьютер.' : error.message; a.folderUnavailable = error.code === 'folder_unavailable'; throw error; }
    finally { a.operation = null; notify(); }
  }
  async function createCopies(ids, options) {
    if (batch) throw Error('Создание общей копии уже выполняется.');
    const selected = [...new Set(ids)].map(id => accounts.get(id));
    if (!selected.length || selected.some(a => !a || a.operation || a.session.view().status !== 'connected')) throw Error('Подключи все выбранные аккаунты.');
    batch = true; clearArchive();
    let backup;
    // Reserve all recipients before snapshot creation, so another operation cannot intervene.
    const reservations = selected.map(a => { clearArchive(); invalidationMessage = ''; message = '';
    const controller = new AbortController(); a.operation = controller; a.verified = null; a.result = 'Ожидаем общий ZIP…'; return { a, controller, session: a.session }; });
    notify();
    try {
      backup = await prepareBackup({ ...options, preparing: message => { for (const { a } of reservations) a.result = message; notify(); } });
      const results = [];
      for (const { a, controller, session } of reservations) {
        try {
          if (accounts.get(a.id) !== a || controller.signal.aborted || a.session !== session) throw Error('Операция аккаунта отменена.');
          await session.withDriveOperation(op => a.client.upload(op, backup, progress => { a.result = `Загрузка: ${Math.round(progress.confirmed / progress.total * 100)}%`; notify(); }), { signal: controller.signal });
          a.result = 'Резервная копия сохранена в Google Drive. Обнови список копий.'; results.push({ id: a.id, saved: true });
        } catch (error) { a.result = error.message + ' Проверь список копий перед отдельным повтором.'; results.push({ id: a.id, saved: false }); }
        finally { a.operation = null; notify(); }
      }
      return results;
    } catch (error) { for (const { a } of reservations) a.result = 'Общий ZIP не создан: ' + error.message; throw error; }
    finally { backup = null; for (const { a } of reservations) a.operation = null; batch = false; notify(); }
  }
  return { clearArchive, checkArchive, downloadArchive, takeArchive, reload, configure, authorize, cancelAuthorization, disconnect, remove, task, createCopies,
    list: () => [...accounts.values()], get: id => accounts.get(id),
    view: () => ({ clientId, batch, message: message || invalidationMessage, authorization: candidate?.view() || null, targetId }),
    networkChanged() { candidate?.networkChanged(); for (const a of accounts.values()) a.session.networkChanged(); notify(); },
    checkExpiry() { candidate?.checkExpiry(); for (const a of accounts.values()) a.session.checkExpiry(); },
    close() { cancelAuthorization(); for (const a of accounts.values()) disconnect(a.id); },
  };
}
