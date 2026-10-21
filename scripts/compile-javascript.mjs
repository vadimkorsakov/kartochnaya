import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';

export const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
export function verifyClassicJavaScript(code) {
  if (code.includes('{{KARTOCHNAYA:')) throw new Error('Unresolved JavaScript marker');
  if (/<\/script/i.test(code)) throw new Error('Unsafe inline script closing tag');
  if (/\bimport\s*\(/.test(code)) throw new Error('Dynamic runtime imports are not allowed');
  // Parse as a classic script, so unresolved static imports/exports fail here.
  new vm.Script(code, { filename: 'kartochnaya.bundle.js' });
}

export async function bundleJavaScript(directory = sourceRoot) {
  const result = await build({
    entryPoints: ['editor.js'],
    absWorkingDir: resolve(directory),
    nodePaths: [fileURLToPath(new URL('../node_modules/', import.meta.url))],
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
  // Check original inputs too: esbuild can omit comments containing stale markers.
  for (const file of Object.keys(result.metafile.inputs)) {
    if ((await readFile(resolve(directory, file), 'utf8')).includes('{{KARTOCHNAYA:')) {
      throw new Error('Unresolved JavaScript source marker');
    }
  }
  const code = result.outputFiles[0].text;
  verifyClassicJavaScript(code);
  return { code: Buffer.from(code), metafile: result.metafile };
}

export async function compileJavaScript(directory = sourceRoot) {
  return (await bundleJavaScript(directory)).code;
}
