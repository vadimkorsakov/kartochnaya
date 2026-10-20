// Preserve the template/CSS bytes; embed one bundled classic browser script.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { compileJavaScript, sourceRoot } from './compile-javascript.mjs';
export { compileJavaScript, sourceRoot } from './compile-javascript.mjs';

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
