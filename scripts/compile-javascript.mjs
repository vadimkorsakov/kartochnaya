import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';

export const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
export const gradientModelSlot = {
  marker: '/*{{KARTOCHNAYA:CORE_GRADIENT_MODEL_JS}}*/\n',
  file: 'core/gradient-model.js',
};

// Only this fragment is still restored literally inside the original strict IIFE.
export async function assembleLegacyJavaScript(directory = sourceRoot) {
  const editor = await readFile(resolve(directory, 'editor.js'), 'utf8');
  const { marker, file } = gradientModelSlot;
  const offset = editor.indexOf(marker);
  const before = editor.slice(0, offset);
  const after = editor.slice(offset + marker.length);
  if (offset < 0 || editor.indexOf(marker, offset + marker.length) !== -1
    || !/\nfunction hexAlpha\([^\n]*\n\n$/.test(before)
    || !after.startsWith('function getGradientStop(')) {
    throw new Error('Missing, repeated or moved gradient JavaScript marker');
  }
  const code = before + await readFile(resolve(directory, file), 'utf8') + after;
  if (code.includes('{{KARTOCHNAYA:')) throw new Error('Unexpected JavaScript source marker');
  return code;
}

export function verifyClassicJavaScript(code) {
  if (code.includes('{{KARTOCHNAYA:')) throw new Error('Unresolved JavaScript marker');
  if (/<\/script/i.test(code)) throw new Error('Unsafe inline script closing tag');
  if (/\bimport\s*\(/.test(code)) throw new Error('Dynamic runtime imports are not allowed');
  // Parse as a classic script, so unresolved static imports/exports fail here.
  new vm.Script(code, { filename: 'kartochnaya.bundle.js' });
}

export async function bundleJavaScript(directory = sourceRoot) {
  const result = await build({
    stdin: {
      contents: await assembleLegacyJavaScript(directory),
      resolveDir: resolve(directory), sourcefile: 'editor.js', loader: 'js',
    },
    absWorkingDir: resolve(directory),
    bundle: true, platform: 'browser', format: 'iife', target: 'es2022',
    minify: false, treeShaking: false, sourcemap: false, charset: 'utf8',
    banner: { js: '"use strict";' },
    // esbuild escapes HTML-sensitive sequences inside strings/templates/regexes.
    supported: { 'inline-script': true },
    write: false, metafile: true, logLevel: 'silent',
  });
  if (result.warnings.length) throw new Error(result.warnings.map(w => w.text).join('\n'));
  if (result.outputFiles.length !== 1 || Object.values(result.metafile.outputs).some(o => o.imports.length)) {
    throw new Error('Expected one browser bundle without runtime imports');
  }
  const code = result.outputFiles[0].text;
  verifyClassicJavaScript(code);
  return { code: Buffer.from(code), metafile: result.metafile };
}

export async function compileJavaScript(directory = sourceRoot) {
  return (await bundleJavaScript(directory)).code;
}
