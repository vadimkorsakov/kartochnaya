// Packaging boundary: a future compiler can provide inputs here without changing
// archive writing or verification. Stage 1 reads release bytes without transforms.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const source = resolve(root, 'kartochnaya v0.45');
export const dist = resolve(root, 'dist');
export const hash = data => createHash('sha256').update(data).digest('hex');
export async function inputs() {
  const names = ['index.html', 'manifest.webmanifest', 'sw.js', 'icon.svg', 'icon-192.png', 'icon-512.png'];
  for (const entry of await readdir(resolve(source, 'tool-icons'), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.png')) throw new Error(`Unexpected tool resource: ${entry.name}`);
    names.push(`tool-icons/${entry.name}`);
  }
  names.sort(); // Code-unit order, independent of locale and filesystem order.
  return Promise.all(names.map(async name => ({ name, data: await readFile(resolve(source, name)) })));
}

// ZIP 2.0, STORE method: no compressor or platform-dependent metadata.
// UTF-8 names; DOS epoch 1980-01-01; no extra fields/comments/permissions.
export function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  if (entries.length >= 65535) throw new Error('ZIP64 is not supported');
  for (const { name, data } of entries) {
    const filename = Buffer.from(name, 'utf8');
    if (filename.length > 65535 || data.length > 0xffffffff) throw new Error('ZIP64 is not supported');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(20, 4);
    header.copy(directory, 6, 4, 30);
    directory.writeUInt32LE(offset, 42);
    local.push(header, filename, data);
    central.push(directory, filename);
    offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central);
  if (offset + directory.length > 0xffffffff) throw new Error('ZIP64 is not supported');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
export async function build(kind = 'all') {
  await mkdir(dist, { recursive: true });
  if (kind === 'all' || kind === 'html') await writeFile(resolve(dist, 'kartochnaya.html'), await readFile(resolve(source, 'index.html')));
  if (kind === 'all' || kind === 'pwa') await writeFile(resolve(dist, 'kartochnaya-pwa.zip'), zip(await inputs()));
}
