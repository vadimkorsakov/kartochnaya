// Byte-preserving assembly: no decoding, formatting, normalization or runtime imports.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
export const javascriptSlot = { marker: '/*{{KARTOCHNAYA:CORE_PRIMITIVES_JS}}*/\n', file: 'core/primitives.js', before: 'const clone=', after: 'const types=' };
export const colorsSlot = { marker: '/*{{KARTOCHNAYA:CORE_COLORS_JS}}*/\n', file: 'core/colors.js', before: 'function syncTextFill(', after: 'function currentPickerKey(' };
export const javascriptSlots = [javascriptSlot, colorsSlot];

// Literal fragments restored at their original positions inside the same IIFE.
export async function compileJavaScript(directory = sourceRoot) {
  const editor = await readFile(resolve(directory, 'editor.js'));
  const chunks = [];
  let cursor = 0;
  for (const { marker, file, before, after } of javascriptSlots) {
    const token = Buffer.from(marker);
    const offset = editor.indexOf(token);
    if (offset < cursor || editor.indexOf(token, offset + token.length) !== -1) {
      throw new Error(`Missing, repeated or out-of-order JavaScript marker: ${marker.trimEnd()}`);
    }
    const previousLine = editor.lastIndexOf(10, offset - 2) + 1;
    if (editor[offset - 1] !== 10
      || !editor.subarray(previousLine, previousLine + Buffer.byteLength(before)).equals(Buffer.from(before))
      || !editor.subarray(offset + token.length, offset + token.length + Buffer.byteLength(after)).equals(Buffer.from(after))) {
      throw new Error(`JavaScript marker must occupy its original position: ${marker.trimEnd()}`);
    }
    const literal = editor.subarray(cursor, offset);
    const fragment = await readFile(resolve(directory, file));
    if ([literal, fragment].some(bytes => bytes.includes(Buffer.from('{{KARTOCHNAYA:')))) {
      throw new Error('Unexpected JavaScript source marker');
    }
    chunks.push(literal, fragment);
    cursor = offset + token.length;
  }
  const tail = editor.subarray(cursor);
  if (tail.includes(Buffer.from('{{KARTOCHNAYA:'))) throw new Error('Unexpected JavaScript source marker');
  return Buffer.concat([...chunks, tail]);
}

export const slots = [
  { marker: '{{KARTOCHNAYA:LEGACY_01_CSS}}', file: 'styles/legacy-01.css', opening: '<style>', closing: '</style>' },
  { marker: '{{KARTOCHNAYA:LEGACY_02_CSS}}', file: 'styles/legacy-02.css', opening: '<style id="v044-fixes">', closing: '</style>' },
  { marker: '{{KARTOCHNAYA:EDITOR_JS}}', file: 'editor.js', opening: '<script>', closing: '</script>' },
];

export async function compileHTML(directory = sourceRoot) {
  const template = await readFile(resolve(directory, 'index.template.html'));
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
    chunks.push(literal, file === 'editor.js' ? await compileJavaScript(directory) : await readFile(resolve(directory, file)));
    cursor = offset + token.length;
  }
  const tail = template.subarray(cursor);
  if (tail.includes(Buffer.from('{{KARTOCHNAYA:'))) throw new Error('Unexpected source marker');
  return Buffer.concat([...chunks, tail]);
}
