// Preserve the template/CSS bytes; embed one bundled classic browser script.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { crc32, inflateSync } from 'node:zlib';

import { compileJavaScript, sourceRoot } from './compile-javascript.mjs';
export { compileJavaScript, sourceRoot } from './compile-javascript.mjs';

export const slots = [
  { marker: '{{KARTOCHNAYA:LEGACY_01_CSS}}', file: 'styles/legacy-01.css', opening: '<style>', closing: '</style>' },
  { marker: '{{KARTOCHNAYA:LEGACY_02_CSS}}', file: 'styles/legacy-02.css', opening: '<style id="v044-fixes">', closing: '</style>' },
  { marker: '{{KARTOCHNAYA:EDITOR_JS}}', file: 'editor.js', opening: '<script>', closing: '</script>' },
];

const iconNames = new Set(['text', 'brush', 'shapes', 'pen', 'select', 'move',
  'hand', 'assets', 'photo', 'undo', 'redo', 'history']);

function validatePNG(bytes) {
  if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw Error('Invalid PNG signature');
  const imageData = [];
  let offset = 8, ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    if (end > bytes.length) throw Error('Truncated PNG chunk');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw Error('Invalid PNG chunk CRC');
    if (offset === 8 && (type !== 'IHDR' || length !== 13
      || !bytes.readUInt32BE(offset + 8) || !bytes.readUInt32BE(offset + 12))) throw Error('Invalid PNG header');
    if (type === 'IDAT') imageData.push(bytes.subarray(offset + 8, end - 4));
    offset = end;
    if (type === 'IEND') {
      if (length !== 0 || offset !== bytes.length) throw Error('Invalid PNG end');
      ended = true;
      break;
    }
  }
  if (!ended || !imageData.length) throw Error('Incomplete PNG');
  if (!inflateSync(Buffer.concat(imageData)).length) throw Error('Empty PNG image data');
}

async function embedIcons(template, directory) {
  const text = template.toString('utf8');
  const pattern = /__KARTOCHNAYA_ICON_([A-Z]+)__/g;
  const replacements = new Map();
  // First occurrence order is stable; read repeated images only once per build.
  for (const [marker, identifier] of text.matchAll(pattern)) {
    if (replacements.has(marker)) continue;
    const name = identifier.toLowerCase();
    if (!iconNames.has(name)) throw Error(`Unknown inline icon marker: ${marker}`);
    const file = resolve(directory, 'assets/inline-icons', `${name}.png`);
    let bytes;
    try {
      bytes = await readFile(file);
      validatePNG(bytes);
    } catch (cause) {
      throw new Error(`Invalid inline icon ${name}: ${cause.message}`, { cause });
    }
    replacements.set(marker, `data:image/png;base64,${bytes.toString('base64')}`);
  }
  const expanded = text.replace(pattern, marker => replacements.get(marker));
  if (expanded.includes('__KARTOCHNAYA_ICON')) throw Error('Malformed or unresolved inline icon marker');
  return Buffer.from(expanded);
}

export async function compileHTML(directory = sourceRoot, options = {}) {
  const template = await embedIcons(await readFile(resolve(directory, 'index.template.html')), directory);
  const chunks = [];
  let cursor = 0;
  for (const { marker, file, opening, closing } of slots) {
    const token = Buffer.from(marker);
    const offset = template.indexOf(token);
    if (offset < cursor || template.indexOf(token, offset + token.length) !== -1) {
      throw new Error(`Missing, repeated or out-of-order marker: ${marker}`);
    }
    if (!template.subarray(offset - Buffer.byteLength(opening), offset).equals(Buffer.from(opening))
      || !template.subarray(offset + token.length, offset + token.length + Buffer.byteLength(closing)).equals(Buffer.from(closing))) {
      throw new Error(`Marker must occupy its original tag: ${marker}`);
    }
    const literal = template.subarray(cursor, offset);
    if (literal.includes(Buffer.from('{{KARTOCHNAYA:'))) throw new Error('Unexpected source marker');
    chunks.push(literal, file === 'editor.js' ? await compileJavaScript(directory, options) : await readFile(resolve(directory, file)));
    cursor = offset + token.length;
  }
  const tail = template.subarray(cursor);
  if (tail.includes(Buffer.from('{{KARTOCHNAYA:'))) throw new Error('Unexpected source marker');
  return Buffer.concat([...chunks, tail]);
}
