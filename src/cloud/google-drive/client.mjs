import { createBackup, readBackup, inspectContainer, sha256, FORMAT } from '../../backup/archive.mjs';
import { driveEndpoint } from './session.mjs';

export const FOLDER_NAME = 'КАРТОЧНАЯ — резервные копии';
export const APP = 'kartochnaya-v045';
export const CHUNK_BYTES = 8 * 1024 * 1024;
export const MAX_CLOUD_BYTES = 256 * 1024 * 1024;
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,size,createdTime,parents,trashed,appProperties';
const marked = (file, kind) => file?.appProperties?.application === APP && file.appProperties.kind === kind && !file.trashed;
const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id);
const query = params => '?' + new URLSearchParams(params);
const folderError = () => Object.assign(Error('Папка копий удалена или недоступна. Можно явно создать новую папку; старые файлы переноситься не будут.'), { code: 'folder_unavailable' });
const uncertain = () => Error('Результат загрузки не подтверждён. Архив мог сохраниться. Обнови список копий перед новой загрузкой; автоматического повтора всего ZIP нет.');
function http(res) {
  if (!res.ok) throw Error(res.status === 403 ? 'Drive API запретил доступ (403). Проверь разрешения аккаунта и квоту.' : res.status === 429 ? 'Превышена квота Drive API (429). Повтори позже.' : 'Ошибка Drive API (' + res.status + '). Повтори позже.');
  return res;
}
async function json(res) {
  http(res);
  try { const value = await res.json(); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; }
  catch { throw Error('Не удалось прочитать подтверждение Drive API.'); }
}
function validFolder(f) { return validId(f?.id) && marked(f, 'backup-folder') && f.name === FOLDER_NAME && f.mimeType === FOLDER_MIME; }
function validBackup(f, folder) {
  return validId(f?.id) && marked(f, 'backup') && f.mimeType === 'application/zip' && Array.isArray(f.parents) && f.parents.includes(folder) && f.appProperties.scope === 'workspace' && f.appProperties.format === FORMAT && typeof f.name === 'string' && /^\d+$/.test(String(f.size)) && Number.isSafeInteger(Number(f.size)) && Number(f.size) > 0;
}
export function safeFilename(name) {
  const stem = String(name).normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 180).replace(/\.zip$/i, '');
  return 'kartochnaya-' + (stem || 'backup') + '.zip';
}
export function createDriveClient() {
  let folderId = null;
  async function metadata(op, id) { if (!validId(id)) throw Error('Недопустимый ID файла'); const file = await json(await op.request(API + '/' + id + query({ fields: FIELDS }))); op.check(); return file; }
  async function pages(op, params, visit) {
    let pageToken = '', count = 0; const seen = new Set();
    do {
      op.check();
      const result = await json(await op.request(API + query({ ...params, fields: 'nextPageToken,files(' + FIELDS + ')', pageSize: '100', ...(pageToken ? { pageToken } : {}) })));
      op.check();
      if (!Array.isArray(result.files)) throw Error('Некорректный список Drive API');
      visit(result.files); pageToken = result.nextPageToken || '';
      if (typeof pageToken !== 'string' || seen.has(pageToken) || ++count > 100) throw Error('Список Drive слишком большой или пагинация повреждена.');
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
  }
  async function folder(op, create = false) {
    if (folderId) {
      const response = await op.request(API + '/' + folderId + query({ fields: FIELDS }));
      if ([403, 404].includes(response.status)) throw folderError();
      const f = await json(response); if (!validFolder(f)) throw folderError(); return folderId;
    }
    let found = null;
    await pages(op, { q: `trashed = false and mimeType = '${FOLDER_MIME}' and name = '${FOLDER_NAME}' and appProperties has { key='application' and value='${APP}' } and appProperties has { key='kind' and value='backup-folder' }`, orderBy: 'createdTime' }, files => { found ||= files.find(validFolder); });
    if (found) { folderId = found.id; return folderId; }
    if (!create) return null;
    const made = await json(await op.request(API + query({ fields: FIELDS }), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME, appProperties: { application: APP, kind: 'backup-folder' } }) }));
    op.check();
    if (!validFolder(made)) throw Error('Создание папки не подтверждено Drive API.');
    folderId = made.id; return folderId;
  }
  async function list(op) {
    const id = await folder(op); if (!id) return [];
    const files = [];
    await pages(op, { q: `'${id}' in parents and trashed = false and mimeType = 'application/zip' and appProperties has { key='application' and value='${APP}' } and appProperties has { key='kind' and value='backup' }`, orderBy: 'createdTime desc' }, rows => {
      for (const f of rows) if (validBackup(f, id) && !files.some(x => x.id === f.id)) files.push(f);
    });
    return files.sort((a, b) => String(b.createdTime || '').localeCompare(String(a.createdTime || '')));
  }
  async function upload(op, backup, progress = () => {}) {
    op.check(); inspectContainer(backup.bytes);
    if (backup.manifest.scope !== 'workspace' || backup.manifest.format !== FORMAT) throw Error('Разрешены только полные ZIP рабочего пространства.');
    const digest = await sha256(backup.bytes); op.check();
    const parent = await folder(op, true), size = backup.bytes.byteLength;
    const properties = { application: APP, kind: 'backup', backupId: backup.manifest.backupId, format: FORMAT, scope: 'workspace', sha256: digest };
    const initial = http(await op.request(UPLOAD, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': 'application/zip', 'X-Upload-Content-Length': String(size) }, body: JSON.stringify({ name: backup.filename, mimeType: 'application/zip', parents: [parent], appProperties: properties }) }));
    // Never expose or persist this capability URL. No arbitrary-host Bearer.
    const location = initial.headers.get('Location');
    let url;
    try { url = driveEndpoint(location, 'PUT'); } catch { throw Error('Drive вернул недопустимый адрес сеанса загрузки.'); }
    let confirmed = 0, sent = 0, stalls = 0;
    const report = () => progress({ sent, confirmed, total: size });
    function incomplete(res, max) {
      const range = res.headers.get('Range');
      const match = range && /^bytes=0-(\d+)$/.exec(range);
      const next = range === null ? 0 : match ? Number(match[1]) + 1 : NaN;
      if (!Number.isSafeInteger(next) || next < confirmed || next > max || next > size) throw uncertain();
      if (next === confirmed) { if (++stalls > 3) throw uncertain(); } else stalls = 0;
      confirmed = next; report();
    }
    async function probe() {
      for (let attempt = 0; attempt < 3; attempt++) {
        op.check();
        let res;
        try {
          res = await op.request(url, { method: 'PUT', headers: { 'Content-Range': `bytes */${size}` }, body: new Uint8Array(0) });
        } catch { op.check(); }
        if (res) {
          if ([200, 201, 308].includes(res.status)) return res;
          if (res.status !== 429 && res.status < 500) { http(res); throw uncertain(); }
        }
        if (attempt < 2) await new Promise((resolve, reject) => {
          const done = () => { clearTimeout(timer); op.signal.removeEventListener('abort', abort); resolve(); };
          const abort = () => { clearTimeout(timer); reject(uncertain()); };
          const timer = setTimeout(done, 1000 * (attempt + 1)); op.signal.addEventListener('abort', abort, { once: true });
        });
      }
      throw uncertain();
    }
    let result;
    while (!result) {
      op.check();
      const end = Math.min(confirmed + CHUNK_BYTES, size);
      let res;
      try {
        if (confirmed === size) res = await probe();
        else {
          sent = Math.max(sent, end); report();
          res = await op.request(url, { method: 'PUT', headers: { 'Content-Type': 'application/zip', 'Content-Range': `bytes ${confirmed}-${end - 1}/${size}` }, body: backup.bytes.subarray(confirmed, end) });
        }
      } catch { op.check(); res = await probe(); }
      if (res.status === 429 || res.status >= 500) res = await probe();
      if (res.status === 308) { incomplete(res, sent); continue; }
      if (![200, 201].includes(res.status)) { http(res); throw uncertain(); }
      try { result = await json(res); if (!validId(result.id)) throw Error(); }
      catch { result = null; const status = await probe(); if (status.status === 308) { incomplete(status, sent); continue; } try { result = await json(status); if (!validId(result.id)) throw Error(); } catch { throw uncertain(); } }
    }
    const file = await metadata(op, result.id); op.check();
    if (file.id !== result.id || !validBackup(file, parent) || Number(file.size) !== size || file.name !== backup.filename || Object.entries(properties).some(([k, v]) => file.appProperties[k] !== v)) throw uncertain();
    confirmed = size; report(); return file;
  }
  async function create(op, { snapshot, preferences, progress, preparing = () => {} }) {
    preparing('Подтверждаем сохранения и читаем согласованный снимок…');
    const data = await snapshot(); op.check();
    preparing('Создаём полный ZIP и проверяем SHA-256…');
    const backup = await createBackup(data, { preferences: preferences() }); op.check();
    return upload(op, backup, progress);
  }
  async function download(op, id, maxBytes = MAX_CLOUD_BYTES) {
    const parent = await folder(op); if (!parent) throw folderError();
    const file = await metadata(op, id);
    if (file.id !== id || !validBackup(file, parent)) throw Error('Файл не является допустимой копией КАРТОЧНОЙ в папке приложения.');
    const size = Number(file.size);
    if (size > maxBytes) throw Error('Архив превышает бюджет памяти этого устройства. Скачай и проверь его на компьютере с большим объёмом памяти.');
    const res = http(await op.request(API + '/' + id + '?alt=media'));
    const length = res.headers.get('Content-Length');
    if (length !== null && Number(length) !== size) { await res.body?.cancel(); throw Error('Размер скачивания не совпадает с metadata.'); }
    if (!res.body?.getReader) throw Error('Браузер не поддерживает ограниченное потоковое скачивание.');
    let bytes;
    try { bytes = new Uint8Array(size); } catch { await res.body.cancel(); throw Error('Недостаточно памяти для ZIP. Освободи память или используй компьютер.'); }
    const reader = res.body.getReader(); let offset = 0;
    try {
      while (true) {
        op.check(); const { done, value } = await reader.read(); if (done) break;
        if (value.length > size - offset) throw Error('Содержимое превышает допустимый размер ZIP.');
        bytes.set(value, offset); offset += value.length;
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    if (offset !== size) throw Error('ZIP скачан не полностью.');
    op.check();
    if (file.appProperties.sha256 && await sha256(bytes) !== file.appProperties.sha256) throw Error('SHA-256 облачного ZIP не совпадает.');
    const verified = await readBackup(bytes); op.check();
    if (verified.manifest.scope !== 'workspace' || (file.appProperties.backupId && verified.manifest.backupId !== file.appProperties.backupId)) throw Error('Манифест ZIP не совпадает с metadata.');
    return { bytes, filename: safeFilename(file.name), createdAt: verified.manifest.createdAt, projects: verified.data.projects.length, warnings: verified.warnings };
  }
  return { create, upload, list, download, reset() { folderId = null; }, newFolder() { folderId = null; } };
}
