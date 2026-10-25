/*! fflate 0.8.2 — bundled dependency
MIT License

Copyright (c) 2023 Arjun Barrett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
import { zip, unzip } from 'fflate';
import { analyzeProject } from '../model/project-integrity.mjs';

export const FORMAT = 'kartochnaya-backup-v1';
export const STORES = ['projects', 'docs', 'fonts', 'settings'];
export const DATA_PATHS = [...STORES, 'preferences'].map(name => `data/${name}.json`);
const PATHS = ['manifest.json', ...DATA_PATHS];
// Several live copies (UTF-16 JSON, IDB records, UTF-8 and ZIP) coexist. Bound
// declared expansion BEFORE decompression; this is not the old 50 MiB JSON cap.
export const MAX_EXPANDED_BYTES = 512 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const fail = message => { throw new Error(message); };
export const PREFERENCE_KEYS = ['kartochnaya-layer-width', 'kartochnaya-ink-v1', 'kartochnaya-shapes-v1'];
export function readPreferences(storage) {
  const result = {};
  for (const key of PREFERENCE_KEYS) { const value = storage.getItem(key); if (value !== null) result[key] = value; }
  return result;
}
export async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) fail('SHA-256 недоступен в этом браузере');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
}
export function projectItems(data) {
  return data.projects.map(project => ({ project, documents: data.docs.filter(doc => doc.projectId === project.id) }));
}
export function inspectData(data) {
  for (const name of STORES) if (!Array.isArray(data[name])) fail(`Некорректные записи: ${name}`);
  if (!object(data.preferences) || Object.entries(data.preferences).some(([k, v]) => !PREFERENCE_KEYS.includes(k) || typeof v !== 'string')) fail('Недопустимые настройки localStorage');
  const ids = (records, field) => {
    const found = new Set();
    for (const rec of records) {
      if (!object(rec) || typeof rec[field] !== 'string' || !rec[field] || found.has(rec[field])) fail(`Некорректный или повторный ${field}`);
      found.add(rec[field]);
    }
    return found;
  };
  for (const font of data.fonts) if (font?.data && (typeof font.data !== 'string' || !/^data:[a-z0-9.+/-]*(?:;[a-z0-9=.-]+)*;base64,[a-z0-9+/]*={0,2}$/i.test(font.data))) fail('Шрифт должен быть встроен в архив как Data URL');
  const projects = ids(data.projects, 'id'); ids(data.docs, 'id'); ids(data.fonts, 'id'); ids(data.settings, 'key');
  for (const doc of data.docs) if (!projects.has(doc.projectId)) fail('Документ без проекта: ' + doc.id);
  const warnings = [];
  for (const item of projectItems(data)) {
    const diagnostic = analyzeProject(item.project, item.documents);
    if (diagnostic.errors.length) fail('Повреждённый проект: ' + diagnostic.errors[0].code);
    warnings.push(...diagnostic.warnings.map(x => `${item.project.name || item.project.id}: ${x.code} (${x.path})`));
  }
  return warnings;
}
export function selectSnapshot(snapshot, selectedIds = null) {
  for (const name of STORES) if (!Array.isArray(snapshot[name])) fail('Снимок базы не подтверждён');
  if (selectedIds === null) return { ...snapshot };
  if (!Array.isArray(selectedIds) || !selectedIds.length || new Set(selectedIds).size !== selectedIds.length) fail('Выбери проекты');
  const ids = new Set(selectedIds), projects = snapshot.projects.filter(p => ids.has(p.id));
  if (projects.length !== ids.size) fail('Список проектов изменился; повтори выбор');
  return { ...snapshot, projects, docs: snapshot.docs.filter(d => ids.has(d.projectId)) };
}
export async function createBackup(snapshot, { selectedIds = null, preferences = {}, appVersion = '0.45', now = new Date(), backupId = crypto.randomUUID() } = {}) {
  const data = { ...selectSnapshot(snapshot, selectedIds), preferences };
  inspectData(data);
  const entries = {}, files = []; let total = 0;
  for (const path of DATA_PATHS) {
    const name = path.slice(5, -5), bytes = encoder.encode(JSON.stringify(data[name]));
    total += bytes.length;
    if (total > MAX_EXPANDED_BYTES) fail('Для ZIP требуется слишком много памяти (свыше 512 МиБ данных). Уменьши объём ресурсов и шрифтов или создай несколько выборочных ZIP-копий');
    files.push({ path, bytes: bytes.length, sha256: await sha256(bytes) }); entries[path] = bytes;
  }
  const manifest = {
    format: FORMAT, formatVersion: 1, minReaderVersion: 1, backupId, createdAt: now.toISOString(), appVersion,
    scope: selectedIds === null ? 'workspace' : 'selected-projects', projectIds: data.projects.map(p => p.id),
    counts: Object.fromEntries([...STORES, 'preferences'].map(k => [k, Array.isArray(data[k]) ? data[k].length : Object.keys(data[k]).length])),
    globals: { fonts: 'included', settings: 'included-not-restored', preferences: 'included-not-restored', shapeCatalog: 'included-in-settings-or-preferences-not-restored' },
    requiredFeatures: [], extensions: {}, files,
  };
  entries['manifest.json'] = encoder.encode(JSON.stringify(manifest));
  // STORE avoids recompressing already encoded images, works offline and keeps
  // large backups readable without a high compression-ratio exception.
  const bytes = await new Promise((resolve, reject) => zip(entries, { level: 0 }, (error, result) => error ? reject(error) : resolve(result)));
  const filename = `kartochnaya-${manifest.createdAt.replace(/[:.]/g, '-')}-${backupId}.zip`;
  return { bytes, manifest, filename };
}

// Check the central directory AND local headers before the library allocates
// decompressed buffers. A strict six-file allowlist excludes zip-slip, aliases,
// duplicates, directories, symlinks, encryption, split volumes and ZIP64.
export function inspectContainer(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 22 || bytes.length > MAX_EXPANDED_BYTES + 1024 * 1024) fail('Некорректный ZIP или слишком большой архив для памяти браузера');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = p => view.getUint16(p, true), u32 = p => view.getUint32(p, true);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && u32(end) !== 0x06054b50) end--;
  if (end < 0 || u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== bytes.length) fail('Повреждённый ZIP: нет конца каталога');
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== PATHS.length || u16(end + 10) !== PATHS.length) fail('Неподдерживаемый состав ZIP');
  const start = u32(end + 16), size = u32(end + 12);
  if (start + size !== end) fail('Повреждённый каталог ZIP');
  const seen = new Set(), entries = []; let p = start, total = 0, localEnd = 0;
  for (let i = 0; i < PATHS.length; i++) {
    if (p + 46 > end || u32(p) !== 0x02014b50) fail('Повреждённая запись ZIP');
    const flags = u16(p + 8), method = u16(p + 10), packed = u32(p + 20), expanded = u32(p + 24), length = u16(p + 28), extra = u16(p + 30), comment = u16(p + 32), offset = u32(p + 42);
    if (p + 46 + length + extra + comment > end) fail('Повреждённый путь ZIP');
    const path = decoder.decode(bytes.subarray(p + 46, p + 46 + length));
    if (!PATHS.includes(path) || seen.has(path)) fail('Недопустимый или повторный путь ZIP: ' + path);
    seen.add(path);
    if (flags & ~0x808 || ![0, 8].includes(method) || u16(p + 34) || ((u32(p + 38) >>> 16) & 0xf000) === 0xa000) fail('Неподдерживаемые свойства ZIP');
    total += expanded;
    if (total > MAX_EXPANDED_BYTES || (path === 'manifest.json' && expanded > MAX_MANIFEST_BYTES) || (expanded > 1024 * 1024 && expanded > Math.max(1, packed) * 10000)) fail('Небезопасный объём распаковки ZIP');
    if (offset !== localEnd || offset + 30 > start || u32(offset) !== 0x04034b50 || u16(offset + 6) !== flags || u16(offset + 8) !== method) fail('Повреждённый локальный заголовок ZIP');
    const localLength = u16(offset + 26), localExtra = u16(offset + 28), content = offset + 30 + localLength + localExtra;
    if (content + packed > start || decoder.decode(bytes.subarray(offset + 30, offset + 30 + localLength)) !== path) fail('Несовпадение путей ZIP');
    if (!(flags & 8) && (u32(offset + 14) !== u32(p + 16) || u32(offset + 18) !== packed || u32(offset + 22) !== expanded)) fail('Несовпадение размеров ZIP');
    if (flags & 8) {
      const d = content + packed, signed = d + 4 <= start && u32(d) === 0x08074b50, q = d + (signed ? 4 : 0);
      if (q + 12 > start || u32(q) !== u32(p + 16) || u32(q + 4) !== packed || u32(q + 8) !== expanded) fail('Повреждённый дескриптор ZIP');
      localEnd = q + 12;
    } else localEnd = content + packed;
    if (method === 0 && packed !== expanded) fail('Неверный размер STORE');
    // Reject ZIP64 extras even where sentinel fields have been forged.
    for (let at = p + 46 + length; at < p + 46 + length + extra;) {
      if (at + 4 > p + 46 + length + extra || u16(at) === 1) fail('ZIP64 не поддерживается');
      at += 4 + u16(at + 2); if (at > p + 46 + length + extra) fail('Повреждённые дополнительные поля ZIP');
    }
    entries.push({ path, bytes: expanded, crc: u32(p + 16) }); p += 46 + length + extra + comment;
  }
  if (p !== end || localEnd !== start) fail('Лишние данные ZIP');
  return entries;
}
function validateManifest(m, entries) {
  if (!object(m) || m.format !== FORMAT || m.formatVersion !== 1 || m.minReaderVersion !== 1) fail('Неизвестная версия формата ZIP');
  if (typeof m.backupId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(m.backupId) || typeof m.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(m.createdAt) || !Number.isFinite(Date.parse(m.createdAt)) || typeof m.appVersion !== 'string') fail('Некорректные метаданные ZIP');
  if (!['workspace', 'selected-projects'].includes(m.scope) || !Array.isArray(m.projectIds) || new Set(m.projectIds).size !== m.projectIds.length || m.projectIds.some(x => typeof x !== 'string') || !object(m.counts) || !object(m.globals) || !object(m.extensions) || !Array.isArray(m.requiredFeatures) || m.requiredFeatures.length) fail('Неподдерживаемая схема манифеста');
  if (!Array.isArray(m.files) || m.files.length !== DATA_PATHS.length || new Set(m.files.map(f => f?.path)).size !== DATA_PATHS.length) fail('Неполный список файлов манифеста');
  for (const f of m.files) if (!object(f) || !DATA_PATHS.includes(f.path) || !Number.isSafeInteger(f.bytes) || f.bytes < 0 || !/^[a-f0-9]{64}$/.test(f.sha256) || entries.find(e => e.path === f.path)?.bytes !== f.bytes) fail('Размер или описание файла не совпадает с ZIP');
}
export async function readBackup(bytes) {
  const entries = inspectContainer(bytes);
  const files = await new Promise((resolve, reject) => unzip(bytes, (error, result) => error ? reject(error) : resolve(result)));
  const parse = path => { try { return JSON.parse(decoder.decode(files[path])); } catch { fail('Повреждённый JSON: ' + path); } };
  for (const entry of entries) if (crc32(files[entry.path]) !== entry.crc) fail('CRC ZIP не совпадает: ' + entry.path);
  const manifest = parse('manifest.json'); validateManifest(manifest, entries);
  const data = {};
  for (const f of manifest.files) {
    if (files[f.path]?.length !== f.bytes || await sha256(files[f.path]) !== f.sha256) fail('SHA-256 не совпадает: ' + f.path);
    data[f.path.slice(5, -5)] = parse(f.path);
  }
  const warnings = inspectData(data);
  if (manifest.projectIds.length !== data.projects.length || manifest.projectIds.some(id => !data.projects.some(p => p.id === id))) fail('Список проектов не совпадает');
  for (const k of [...STORES, 'preferences']) if (manifest.counts[k] !== (Array.isArray(data[k]) ? data[k].length : Object.keys(data[k]).length)) fail('Количество записей не совпадает: ' + k);
  if (manifest.appVersion !== '0.45') warnings.push('Архив создан другой версией приложения: ' + manifest.appVersion);
  return { manifest, data, warnings, archiveBytes: bytes.length };
}

const crcTable = Uint32Array.from({ length: 256 }, (_, i) => { let c = i; for (let n = 0; n < 8; n++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(bytes) { let c = 0xffffffff; for (const value of bytes) c = crcTable[(c ^ value) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
