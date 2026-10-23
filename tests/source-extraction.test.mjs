import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { compileHTML, compileJavaScript, sourceRoot, slots } from '../scripts/compile-html.mjs';
import { bundleJavaScript, verifyClassicJavaScript } from '../scripts/compile-javascript.mjs';
import { build, root, source, hash } from '../scripts/distribution.mjs';

const geometryNames = ['toLocal', 'boundsOf', 'handleCoords', 'gradientLocalPoint', 'gradientDocPoint'];
const primitiveNames = ['html', 'clamp', 'fmt'];
const colorNames = ['rgbHex', 'hexRgb', 'hsvRGB', 'rgbHSV', 'rgbHSL', 'hslRGB', 'normalizeHex', 'cpFormatValues'];
const gradientNames = ['gradientStops', 'gradientGeometry', 'gradientSample', 'addGradientStop'];
// Required subsystem entry points, not an exhaustive inventory of the source tree.
const inputs = ['index.template.html', 'styles/legacy-01.css', 'styles/legacy-02.css',
  'backup/archive.mjs', 'backup/instances.mjs', 'backup/replace.mjs', 'backup/storage.mjs', 'backup/ui.mjs', 'storage/indexeddb.mjs', 'model/project-integrity.mjs', 'editor.js', 'core/primitives.mjs', 'core/colors.mjs', 'core/gradient-model.mjs', 'core/shape-catalog.mjs', 'core/geometry.mjs'];

async function temporarySources(run) {
  const directory = await mkdtemp(resolve(tmpdir(), 'kartochnaya-source-'));
  try {
    const sources = resolve(directory, 'src');
    await cp(sourceRoot, sources, { recursive: true });
    await run(sources, resolve(directory, 'dist'));
  } finally { await rm(directory, { recursive: true, force: true }); }
}

// Historical guarantees are independent of the generated distributions.
test('19 historical files, manifest and original PNG baselines remain immutable', async () => {
  const manifest = await readFile(resolve(root, 'docs/baseline-v045.json'));
  assert.equal(hash(manifest), 'f8e56df275b46d7251767becfbb714144768094f63719bf7031c84770d026b62');
  const baseline = JSON.parse(manifest);
  const names = (await readdir(source, { recursive: true, withFileTypes: true }))
    .filter(e => e.isFile()).map(e => resolve(e.parentPath, e.name).slice(source.length + 1)).sort();
  assert.equal(names.length, 19);
  assert.deepEqual(names, Object.keys(baseline.files).sort());
  for (const [name, expected] of Object.entries(baseline.files)) {
    const bytes = await readFile(resolve(source, name));
    assert.deepEqual({ bytes: bytes.length, sha256: hash(bytes) }, expected, name);
  }
  for (const [name, expected] of Object.entries({
    blank: 'af64319d161e99a8dffdcbd28e4a5775593302671f592509e9b5113042855a97',
    shapes: 'd6c1f51e80a39c25724e6affd8cef38594488bbf6cf090d0d18945186eab7b5e',
    text: '852ca611ec6d83b53053fb5d7bddaf0906519ed800ee868042b314cb0a338e3b',
  })) assert.equal(hash(await readFile(resolve(root, `tests/baselines/${name}-320x240.png`))), expected);
});

// Apply these same contracts to the real tree and to independently modified copies.
async function assertSourceContracts(directory = sourceRoot) {
  for (const [file, names] of [
    ['core/primitives.mjs', primitiveNames], ['core/colors.mjs', colorNames],
    ['core/geometry.mjs', geometryNames], ['core/shape-catalog.mjs', ['validateShapeCatalog']],
    ['core/gradient-model.mjs', ['createGradientModel']],
    ['storage/indexeddb.mjs', ['openDatabase', 'runStoreRequest', 'runStoreTransaction']],
    ['model/project-integrity.mjs', ['analyzeProject', 'prepareProjectImport']],
  ]) {
    const api = await import(pathToFileURL(resolve(directory, file)).href);
    for (const name of names) assert.equal(typeof api[name], 'function', `${file}: required API ${name}`);
    if (file === 'core/gradient-model.mjs') {
      const model = api.createGradientModel(() => 'test');
      for (const name of gradientNames) assert.equal(typeof model[name], 'function', name);
    }
  }
  const { code, metafile } = await bundleJavaScript(directory);
  const [output] = Object.values(metafile.outputs);
  assert.equal(Object.keys(metafile.outputs).length, 1);
  assert.deepEqual(output.imports, []);
  assert.deepEqual(output.exports, []);
  assert.equal(output.entryPoint, 'editor.js');
  assert.ok(code.length > 0);
  for (const file of inputs.filter(name => /\.(?:mjs|js)$/.test(name))) {
    assert.ok(metafile.inputs[file], `Required build input: ${file}`);
    // A public entry point can become a zero-byte re-export facade.
  }
  // Walk the actual esbuild graph. New nodes and intermediate imports are allowed;
  // unresolved/external edges and cycles are not part of the standalone contract.
  const complete = new Set(), active = new Set();
  function visit(file) {
    assert.ok(!active.has(file), `Circular dependency: ${[...active, file].join(' -> ')}`);
    if (complete.has(file)) return;
    const input = metafile.inputs[file];
    assert.ok(input, `Unresolved build input: ${file}`);
    assert.equal(input.format, 'esm', `Real ESM input: ${file}`);
    active.add(file);
    for (const edge of input.imports) {
      assert.ok(!edge.external, `External dependency: ${edge.path}`);
      assert.equal(edge.kind, 'import-statement', `Static ESM dependency: ${edge.path}`);
      visit(edge.path);
    }
    active.delete(file);
    complete.add(file);
  }
  for (const file of Object.keys(metafile.inputs)) visit(file);
  const js = code.toString();
  verifyClassicJavaScript(js);
  assert.doesNotMatch(js, /\{\{KARTOCHNAYA:|sourceMappingURL=/);
  assert.doesNotMatch(js, /\b(?:window|globalThis)\.(?:app|html|clamp|fmt|rgbHex|hexRgb|hsvRGB|rgbHSV|rgbHSL|hslRGB|normalizeHex|cpFormatValues|validateShapeCatalog|createGradientModel)\s*=/);
  await assertHTMLContract(directory, js);
  return { code, metafile };
}

async function assertHTMLContract(directory, js) {
  const template = await readFile(resolve(directory, 'index.template.html'), 'utf8');
  assert.match(template, /^\s*<!doctype html>/i);
  let previous = -1;
  for (const tag of ['<html\\b[^>]*>', '<head\\b[^>]*>', '</head>', '<body\\b[^>]*>', '</body>', '</html>']) {
    const matches = [...template.matchAll(new RegExp(tag, 'gi'))];
    assert.equal(matches.length, 1, `One ${tag}`);
    assert.ok(matches[0].index > previous, `Document tag order: ${tag}`);
    previous = matches[0].index;
  }
  let expected = template, cursor = -1;
  for (const { marker, opening, closing, file } of slots) {
    const offset = template.indexOf(marker);
    assert.ok(offset > cursor, `Ordered marker: ${marker}`);
    assert.equal(template.indexOf(marker, offset + marker.length), -1, `Unique marker: ${marker}`);
    assert.equal(template.slice(offset - opening.length, offset), opening);
    assert.equal(template.slice(offset + marker.length, offset + marker.length + closing.length), closing);
    const container = file === 'editor.js' ? 'body' : 'head';
    assert.ok(offset > template.indexOf(`<${container}`) && offset < template.indexOf(`</${container}>`), marker);
    const content = file === 'editor.js' ? js : await readFile(resolve(directory, file), 'utf8');
    // Use a callback so CSS containing $& is embedded literally too.
    expected = expected.replace(marker, () => content);
    cursor = offset;
  }
  for (const name of await readdir(resolve(directory, 'assets/inline-icons'))) {
    const bytes = await readFile(resolve(directory, 'assets/inline-icons', name));
    expected = expected.replaceAll(`__KARTOCHNAYA_ICON_${name.slice(0, -4).toUpperCase()}__`,
      `data:image/png;base64,${bytes.toString('base64')}`);
  }
  const html = (await compileHTML(directory)).toString();
  assert.equal(html, expected, 'Current PNGs, CSS and bundled JavaScript fill the template');
  assert.doesNotMatch(html, /\{\{KARTOCHNAYA:/);
  assert.equal((html.match(/<script\b/gi) || []).length, 1);
  assert.equal((html.match(/<\/script\s*>/gi) || []).length, 1);
  assert.doesNotMatch(html, /<script\b[^>]*(?:\bsrc\s*=|\btype\s*=\s*["']module)/i);
}

test('inline icons: all 19 occurrences embed the exact bytes of 12 shared source PNGs', async () => {
  const template = await readFile(resolve(sourceRoot, 'index.template.html'), 'utf8');
  const markers = [...template.matchAll(/__KARTOCHNAYA_ICON_([A-Z]+)__/g)];
  assert.equal(markers.length, 19);
  assert.equal(new Set(markers.map(m => m[1])).size, 12);
  assert.doesNotMatch(template, /data:image\/png;base64,/);
  const names = await readdir(resolve(sourceRoot, 'assets/inline-icons'));
  assert.deepEqual(names.sort(), [...new Set(markers.map(m => `${m[1].toLowerCase()}.png`))].sort());
  const html = (await compileHTML()).toString();
  const urls = [...html.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)];
  assert.equal(urls.length, 19);
  for (const [index, marker] of markers.entries()) {
    const original = await readFile(resolve(sourceRoot, 'assets/inline-icons', `${marker[1].toLowerCase()}.png`));
    assert.equal(original.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const decoded = PNG.sync.read(original, { checkCRC: true });
    assert.ok(decoded.width > 0 && decoded.height > 0);
    assert.deepEqual(Buffer.from(urls[index][1], 'base64'), original);
  }
  const sourceImages = [...template.matchAll(/<img\b[^>]*>/g)].map(m => m[0]);
  const builtImages = [...html.split('<script>')[0].matchAll(/<img\b[^>]*>/g)].map(m => m[0]);
  assert.deepEqual(builtImages.map(tag => tag.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/, '[ICON]')),
    sourceImages.map(tag => tag.replace(/__KARTOCHNAYA_ICON_[A-Z]+__/, '[ICON]')),
    'Image markup and attributes are preserved');
  assert.doesNotMatch(html, /__KARTOCHNAYA_ICON|(?:src|href)=["'][^"']*assets\/inline-icons/);
  for (const tag of builtImages.filter(tag => tag.includes('dock-image-icon'))) {
    assert.match(tag, /src="data:image\/png;base64,/,'Icons require no HTTP requests');
  }
});

test('inline icons: missing and corrupt PNGs reject the actual build in temporary sources', async () => {
  await temporarySources(async (sources, outputDirectory) => {
    const file = resolve(sources, 'assets/inline-icons/text.png'), original = await readFile(file);
    await rm(file);
    await assert.rejects(build('all', { sourceDirectory: sources, outputDirectory }), /Invalid inline icon text:.*ENOENT/);
    const badSignature = Buffer.from(original); badSignature[0] = 0;
    const badCRC = Buffer.from(original); badCRC[40] ^= 1;
    for (const bytes of [Buffer.alloc(0), badSignature, original.subarray(0, 8), original.subarray(0, -1), badCRC]) {
      await writeFile(file, bytes);
      await assert.rejects(build('all', { sourceDirectory: sources, outputDirectory }), /Invalid inline icon text:/);
      await assert.rejects(readFile(resolve(outputDirectory, 'kartochnaya.html')), /ENOENT/);
    }
  });
});

test('inline icons: unknown, malformed and unresolved markers reject compilation', async () => {
  await temporarySources(async sources => {
    const file = resolve(sources, 'index.template.html'), template = await readFile(file, 'utf8');
    for (const marker of ['__KARTOCHNAYA_ICON_UNKNOWN__', '__KARTOCHNAYA_ICON_text__',
      '__KARTOCHNAYA_ICON_TEXT_', '__KARTOCHNAYA_ICON_', '__KARTOCHNAYA_ICON_../TEXT__']) {
      await writeFile(file, template.replace('__KARTOCHNAYA_ICON_TEXT__', marker));
      await assert.rejects(compileHTML(sources), /inline icon marker/);
    }
  });
});

test('required APIs and subsystems survive in a standalone classic bundle with an acyclic ESM graph', async () => {
  await assertSourceContracts();
});

test('A: a different valid function implementation passes current source contracts', async () => {
  await temporarySources(async sources => {
    const file = resolve(sources, 'core/primitives.mjs');
    const original = await readFile(file, 'utf8');
    const replacement = `export function html(value) {
      const entities = new Map([['&', '&amp;'], ['<', '&lt;'], ['>', '&gt;'], ['"', '&quot;'], ["'", '&#39;']]);
      return String(value ?? '').replace(/[&<>"']/g, character => entities.get(character));
    }
    export function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }
    export function fmt(value) { const scaled = Number(value) * 100; return Math.round(scaled) / 100; }
    export const implementationProbe = true;
    `;
    assert.notEqual(replacement, original);
    await writeFile(file, replacement);
    await assertSourceContracts(sources);
    const api = await import(pathToFileURL(file).href);
    assert.equal(api.html('<&'), '&lt;&amp;');
    assert.equal(api.clamp(12, 0, 10), 10);
    assert.equal(api.fmt(1.234), 1.23);
    assert.notEqual(hash(await compileJavaScript(sources)), hash(await compileJavaScript()));
  });
});

test('B: an additional module, indirect imports, relocated functions and extra exports are allowed', async () => {
  await temporarySources(async sources => {
    const geometry = resolve(sources, 'core/geometry.mjs');
    await cp(geometry, resolve(sources, 'core/geometry-implementation.mjs'));
    await writeFile(geometry, "export * from './geometry-implementation.mjs';\nexport { sourceProbe } from './source-probe.mjs';\n");
    await writeFile(resolve(sources, 'core/source-probe.mjs'), "export function sourceProbe() { return 'module-extension-probe'; }\n");
    const entry = resolve(sources, 'editor.js');
    await writeFile(entry, await readFile(entry, 'utf8') + "\nimport { sourceProbe } from './core/source-probe.mjs';\nconsole.log(sourceProbe());\n");
    const { code, metafile } = await assertSourceContracts(sources);
    assert.ok(metafile.inputs['core/source-probe.mjs']);
    assert.ok(metafile.inputs['core/geometry-implementation.mjs']);
    assert.ok(code.includes('module-extension-probe'));
  });
});

test('real circular dependencies are rejected using the esbuild graph', async () => {
  await temporarySources(async sources => {
    const file = resolve(sources, 'core/primitives.mjs');
    await writeFile(file, await readFile(file, 'utf8') + "\nimport './cycle-probe.mjs';\n");
    await writeFile(resolve(sources, 'core/cycle-probe.mjs'), "import './primitives.mjs';\nexport const cycleProbe = true;\n");
    await assert.rejects(assertSourceContracts(sources), /Circular dependency/);
  });
});

test('missing, malformed, repeated and moved HTML markers and all stale JS markers fail closed', async () => {
  await temporarySources(async sources => {
    const file = resolve(sources, 'index.template.html'), template = await readFile(file, 'utf8');
    const [first, second] = slots.map(s => s.marker);
    for (const invalid of [template.replace(first, ''), template + first, template + '{{KARTOCHNAYA:UNKNOWN}}',
      template + '{{KARTOCHNAYA:UNCLOSED', template.replace(first, ' ' + first),
      template.replace(first, 'SWAP').replace(second, first).replace('SWAP', second)]) {
      await writeFile(file, invalid);
      await assert.rejects(compileHTML(sources), /marker|original tag/i);
    }
    await writeFile(file, template);
    const entry = resolve(sources, 'editor.js'), editor = await readFile(entry, 'utf8');
    for (const invalid of [editor + '\n/*{{KARTOCHNAYA:CORE_GRADIENT_MODEL_JS}}*/',
      editor + '\n// {{KARTOCHNAYA:UNKNOWN}}', editor + '\n// {{KARTOCHNAYA:UNCLOSED']) {
      await writeFile(entry, invalid);
      await assert.rejects(compileHTML(sources), /marker/i);
    }
    await writeFile(entry, editor);
    for (const name of ['storage/indexeddb.mjs', 'model/project-integrity.mjs', 'core/primitives.mjs', 'core/colors.mjs', 'core/gradient-model.mjs', 'core/shape-catalog.mjs', 'core/geometry.mjs']) {
      const file = resolve(sources, name), code = await readFile(file, 'utf8');
      await writeFile(file, code + '\n// {{KARTOCHNAYA:UNRESOLVED}}');
      await assert.rejects(compileHTML(sources), /marker/i);
      await writeFile(file, code);
    }
  });
});

test('D: independent builds of unchanged sources have identical HTML, ZIP and Netlify hashes', async () => {
  await temporarySources(async (sources, outputDirectory) => {
    const options = { sourceDirectory: sources, outputDirectory };
    const outputs = () => Promise.all(['kartochnaya.html', 'kartochnaya-pwa.zip', 'netlify/SHA256SUMS.json']
      .map(async name => hash(await readFile(resolve(outputDirectory, name)))));
    await build('all', options);
    const first = await outputs();
    await build('all', options);
    assert.deepEqual(await outputs(), first);
    await build('html', options); await build('pwa', options);
    assert.deepEqual(await outputs(), first);
  });
});

test('current HTML and CSS edits are accepted and propagate to built HTML', async () => {
  await temporarySources(async sources => {
    const template = resolve(sources, 'index.template.html');
    await writeFile(template, (await readFile(template, 'utf8')).replace('</head>', '<meta name="source-probe" content="T3">\n</head>'));
    for (const { file } of slots.filter(s => s.file.endsWith('.css'))) {
      const path = resolve(sources, file);
      await writeFile(path, await readFile(path, 'utf8') + '\n.source-probe::after{content:"$&";color:#123456}\n');
    }
    await assertSourceContracts(sources);
    assert.ok((await compileHTML(sources)).includes('source-probe'));
  });
});

test('C: every missing component, bad import/export or syntax error rejects the actual build without historical fallback', async () => {
  await temporarySources(async (sources, outputDirectory) => {
    const options = { sourceDirectory: sources, outputDirectory };
    for (const name of inputs) {
      const file = resolve(sources, name), bytes = await readFile(file);
      await rm(file);
      await assert.rejects(build('all', options), /ENOENT|Could not resolve/);
      await assert.rejects(readFile(resolve(outputDirectory, 'kartochnaya.html')), /ENOENT/);
      await writeFile(file, bytes);
    }
    const file = resolve(sources, 'editor.js'), editor = await readFile(file, 'utf8');
    for (const suffix of [
      "import './missing-module.mjs';",
      "import { absentExport } from './core/primitives.mjs'; console.log(absentExport);",
      "import { missingGeometry } from './core/geometry.mjs'; console.log(missingGeometry);",
      "import { missingFactory } from './core/gradient-model.mjs'; console.log(missingFactory);",
      'const = broken;', 'import("https://example.com/runtime.js");', 'import(globalThis.runtimeModule);',
    ]) {
      await writeFile(file, editor + '\n' + suffix);
      await assert.rejects(build('all', options));
      await assert.rejects(readFile(resolve(outputDirectory, 'kartochnaya.html')), /ENOENT/);
    }
    await writeFile(file, editor);
    await rejectMissingExports(sources, outputDirectory, 'core/gradient-model.mjs', ['createGradientModel']);
    const moduleFile = resolve(sources, 'core/gradient-model.mjs'), module = await readFile(moduleFile, 'utf8');
    for (const suffix of ['const = broken;', "import './missing-colors.mjs';",
      "import { missingClamp } from './primitives.mjs'; console.log(missingClamp);"]) {
      await writeFile(moduleFile, module + '\n' + suffix);
      await assert.rejects(build('all', options));
    }
  });
});

test('a failed rebuild rejects instead of substituting previously built HTML', async () => {
  await temporarySources(async (sources, outputDirectory) => {
    const options = { sourceDirectory: sources, outputDirectory };
    await build('all', options);
    const names = ['kartochnaya.html', 'kartochnaya-pwa.zip', 'netlify/SHA256SUMS.json'];
    const outputs = () => Promise.all(names.map(name => readFile(resolve(outputDirectory, name))));
    const previous = await outputs();
    await writeFile(resolve(sources, 'editor.js'), "import './missing-module.mjs';\n");
    await assert.rejects(compileHTML(sources), /Could not resolve/);
    await assert.rejects(build('all', options), /Could not resolve/);
    assert.deepEqual(await outputs(), previous, 'Failure leaves the last good artifacts untouched');
  });
});

test('HTML-sensitive JavaScript strings are escaped safely without changing their value', async () => {
  assert.throws(() => verifyClassicJavaScript('/* </ScRiPt> */'), /Unsafe inline script/);
  await temporarySources(async sources => {
    const file = resolve(sources, 'editor.js');
    const payload = '</ScRiPt><script><!--';
    await writeFile(file, await readFile(file, 'utf8') + '\nconsole.log(' + JSON.stringify(payload) + ');\n');
    const js = (await compileJavaScript(sources)).toString();
    assert.doesNotMatch(js, /<\/script/i);
    const html = (await compileHTML(sources)).toString();
    assert.equal((html.match(/<\/script\s*>/gi) || []).length, 1);
    // Execute only the emitted probe, without stubbing or patching the application.
    const line = js.split('\n').find(s => s.includes('console.log(') && s.includes('ScRiPt'));
    const { default: vm } = await import('node:vm');
    let actual;
    vm.runInNewContext(line, { console: { log: value => { actual = value; } } });
    assert.equal(actual, payload);
  });
});
// Hide a real public export behind a facade, independently of declaration syntax
// or function location. The implementation and its dependencies are still compiled.
async function rejectMissingExports(sources, outputDirectory, name, required) {
  const file = resolve(sources, name), code = await readFile(file, 'utf8');
  const api = await import(pathToFileURL(file).href);
  const implementation = file + '.implementation.mjs';
  await writeFile(implementation, code);
  try {
    for (const missing of required) {
      assert.equal(typeof api[missing], 'function', missing);
      const remaining = Object.keys(api).filter(key => key !== missing).join(', ');
      await writeFile(file, `export { ${remaining} } from './${implementation.split('/').at(-1)}';\n`);
      await assert.rejects(build('all', { sourceDirectory: sources, outputDirectory }), /No matching export/);
      await assert.rejects(readFile(resolve(outputDirectory, 'kartochnaya.html')), /ENOENT/);
    }
  } finally {
    await writeFile(file, code);
    await rm(implementation);
  }
}

test('shape catalog missing export and syntax errors fail the actual build', async () => {
  await temporarySources(async (sources, outputDirectory) => {
    await rejectMissingExports(sources, outputDirectory, 'core/shape-catalog.mjs', ['validateShapeCatalog']);
    const file = resolve(sources, 'core/shape-catalog.mjs');
    await writeFile(file, await readFile(file, 'utf8') + '\nconst = broken;');
    await assert.rejects(build('all', { sourceDirectory: sources, outputDirectory }));
    await assert.rejects(readFile(resolve(outputDirectory, 'kartochnaya.html')), /ENOENT/);
  });
});

test('geometry missing export, syntax error and stale marker fail the actual build', async () => {
  await temporarySources(async (sources, outputDirectory) => {
    await rejectMissingExports(sources, outputDirectory, 'core/geometry.mjs', geometryNames);
    const file = resolve(sources, 'core/geometry.mjs'), code = await readFile(file, 'utf8');
    for (const suffix of ['\nconst = broken;', '\n// {{KARTOCHNAYA:UNRESOLVED}}']) {
      await writeFile(file, code + suffix);
      await assert.rejects(build('all', { sourceDirectory: sources, outputDirectory }));
      await assert.rejects(readFile(resolve(outputDirectory, 'kartochnaya.html')), /ENOENT/);
    }
  });
});

test('storage missing exports, malformed source and stale marker fail the real build', async () => {
  await temporarySources(async (sources, outputDirectory) => {
    await rejectMissingExports(sources, outputDirectory, 'storage/indexeddb.mjs', ['openDatabase', 'runStoreRequest', 'runStoreTransaction']);
    const file = resolve(sources, 'storage/indexeddb.mjs'), code = await readFile(file, 'utf8');
    for (const suffix of ['\nconst = broken;', '\n// {{KARTOCHNAYA:UNRESOLVED}}']) {
      await writeFile(file, code + suffix);
      await assert.rejects(build('all', { sourceDirectory: sources, outputDirectory }));
      await assert.rejects(readFile(resolve(outputDirectory, 'kartochnaya.html')), /ENOENT/);
    }
  });
});
