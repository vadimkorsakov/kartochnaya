import { createBackup, sha256 } from '../../backup/archive.mjs';
import { validBackupName, signedEndpoint } from './oauth.mjs';

export const MAX_CLOUD_BYTES = 256 * 1024 * 1024;
export const ANDROID_CLOUD_BYTES = 128 * 1024 * 1024;
export const MAX_LIST_ITEMS = 1000;
export const UNCERTAIN = 'Загрузка не подтверждена. Файл мог сохраниться на Диске. Обнови список копий';
const endpoint = (path, suffix = '', params = {}) => 'https://cloud-api.yandex.net/v1/disk/resources' + suffix + '?' + new URLSearchParams({ path, ...params });
async function json(res) {
  if (!res.ok) throw Error(`Яндекс Диск: HTTP ${res.status}. Операция отклонена.`);
  try { const body = await res.json(); if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error(); return body; }
  catch { throw Error('Яндекс Диск вернул некорректные метаданные.'); }
}
function folderPath(path) {
  return typeof path === 'string' && (path === 'app:/' || /^disk:\/[^\\\u0000-\u001f]+$/.test(path) && !path.split('/').some(p => !p || p === '.' || p === '..'));
}
function fileMetadata(file, root) {
  if (!file || file.type !== 'file' || !validBackupName(file.name) || !Number.isSafeInteger(file.size) || file.size <= 0) return null;
  if (file.path !== 'app:/' + file.name && file.path !== root.replace(/\/$/, '') + '/' + file.name) return null;
  if (typeof file.created !== 'string' || !Number.isFinite(Date.parse(file.created))) return null;
  if (file.sha256 !== undefined && (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(file.sha256))) return null;
  // Explicit projection: never retain arbitrary API fields, user data or URLs.
  return { name: file.name, path: file.path, size: file.size, created: file.created, type: 'file', available: true, ...(file.sha256 ? { sha256: file.sha256.toLowerCase() } : {}) };
}
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(Error('Операция отменена.')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
// No database/global editor access; snapshot and preference readers are injected.
export function createYandexClient(oauth) {
  let generation = -1, accountId = null;
  const attempted = new WeakSet();
  function reset() { generation = -1; accountId = null; }
  async function identity(op) {
    op.check();
    const current = oauth.view().generation;
    if (generation !== current) { generation = current; accountId = null; }
    let id = null;
    try {
      const body = await json(await op.request('https://login.yandex.ru/info'));
      if (typeof body.id === 'string' && body.id.length > 0 && body.id.length <= 200) id = body.id;
    } catch { op.check(); }
    op.check();
    if (accountId !== null && id !== accountId) {
      reset(); oauth.disconnect('Аккаунт не подтверждён. Подключи Яндекс повторно.');
      throw Error('Аккаунт изменился или не подтверждён. Подключи Яндекс повторно.');
    }
    accountId = id; // Unknown identity is never replaced with a previous session's ID.
  }
  async function root(op) {
    const body = await json(await op.request(endpoint('app:/'))); op.check();
    if (body.type !== 'dir' || !folderPath(body.path)) throw Error('Папка приложения не подтверждена.');
    return body.path;
  }
  async function list({ signal } = {}) {
    return oauth.operation(async op => {
      await identity(op);
      const files = new Map(); let scanned = 0, truncated = false;
      while (scanned < MAX_LIST_ITEMS) {
        const limit = Math.min(100, MAX_LIST_ITEMS - scanned);
        const body = await json(await op.request(endpoint('app:/', '', { limit: String(limit), offset: String(scanned) }))); op.check();
        const page = body._embedded;
        if (body.type !== 'dir' || !folderPath(body.path) || !page || !Array.isArray(page.items) || page.items.length > limit || !Number.isSafeInteger(page.total) || page.total < 0 || page.offset !== scanned || page.limit !== limit) throw Error('Некорректная пагинация Яндекс Диска.');
        for (const row of page.items) { const file = fileMetadata(row, body.path); if (file) files.set(file.name, file); }
        scanned += page.items.length;
        if (scanned >= page.total) break;
        if (!page.items.length) throw Error('Неполный список Яндекс Диска. Обнови список.');
        truncated = scanned >= MAX_LIST_ITEMS;
      }
      await identity(op); op.check();
      return { files: [...files.values()].sort((a, b) => Date.parse(b.created) - Date.parse(a.created) || b.name.localeCompare(a.name)), truncated };
    }, { signal });
  }
  async function upload(op, backup, rootPath, progress) {
    op.check();
    if (attempted.has(backup)) throw Error('Этот архив уже отправлялся. Обнови список; новая загрузка требует нового явного действия.');
    const digest = await sha256(backup.bytes); op.check();
    const path = 'app:/' + backup.filename;
    const link = await json(await op.request(endpoint(path, '/upload', { overwrite: 'false' }))); op.check();
    if (link.method !== 'PUT' || link.templated !== undefined && link.templated !== false) throw Error('Ошибка контракта ссылки загрузки.');
    const href = signedEndpoint(link.href);
    attempted.add(backup); progress('Загружаем ZIP… Можно отменить передачу.');
    try {
      const res = await op.request(href, { method: 'PUT', headers: { 'Content-Type': 'application/zip' }, body: backup.bytes }, false);
      if (![201, 202].includes(res.status)) throw Error();
    } catch { throw Error(UNCERTAIN); }
    progress('Проверяем метаданные загруженного ZIP…');
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        op.check();
        const response = await op.request(endpoint(path));
        if (response.status === 404 && attempt < 3) { await delay(500 * (attempt + 1), op.signal); continue; }
        const file = fileMetadata(await json(response), rootPath); op.check();
        if (!file || file.name !== backup.filename || file.size !== backup.bytes.byteLength) throw Error('Размер, имя или тип файла не совпадает.');
        if (file.sha256 && file.sha256 !== digest) throw Error('SHA-256 файла не совпадает.');
        await identity(op); op.check();
        return { file, verification: file.sha256 ? 'sha256' : 'size' };
      }
    } catch (error) { throw Error(UNCERTAIN + '. ' + error.message); }
    throw Error(UNCERTAIN);
  }
  async function create({ snapshot, preferences, progress = () => {}, signal, maxBytes = MAX_CLOUD_BYTES }) {
    return oauth.operation(async op => {
      await identity(op); const rootPath = await root(op);
      progress('Подтверждаем сохранения и читаем снимок IndexedDB…');
      const data = await snapshot(); op.check();
      progress('Создаём полный ZIP рабочего пространства…');
      const backup = await createBackup(data, { preferences: preferences() }); op.check();
      if (!Number.isFinite(maxBytes) || maxBytes <= 0 || backup.bytes.byteLength > Math.min(maxBytes, MAX_CLOUD_BYTES)) throw Error(`ZIP превышает предел облачной загрузки (${Math.floor(Math.min(maxBytes, MAX_CLOUD_BYTES) / 1024 / 1024)} МиБ). Используй локальный ZIP.`);
      await identity(op); op.check(); // Preparation may outlive the OAuth session.
      return upload(op, backup, rootPath, progress);
    }, { signal, timeoutMs: 900000 });
  }
  return { list, create, reset };
}
