import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { compileHTML, compileJavaScript, sourceRoot, slots } from '../scripts/compile-html.mjs';
import { bundleJavaScript, verifyClassicJavaScript } from '../scripts/compile-javascript.mjs';
import { build, root, source, hash } from '../scripts/distribution.mjs';
import * as primitives from '../src/core/primitives.mjs';
import * as colors from '../src/core/colors.mjs';
import * as gradients from '../src/core/gradient-model.mjs';
import * as catalog from '../src/core/shape-catalog.mjs';
import * as geometry from '../src/core/geometry.mjs';
import * as storage from '../src/storage/indexeddb.mjs';

const geometryNames = ['toLocal', 'boundsOf', 'handleCoords', 'gradientLocalPoint', 'gradientDocPoint'];
const primitiveNames = ['html', 'clamp', 'fmt'];
const colorNames = ['rgbHex', 'hexRgb', 'hsvRGB', 'rgbHSV', 'rgbHSL', 'hslRGB', 'normalizeHex', 'cpFormatValues'];
const gradientNames = ['gradientStops', 'gradientGeometry', 'gradientSample', 'addGradientStop'];
const inputs = ['index.template.html', 'styles/legacy-01.css', 'styles/legacy-02.css',
  'backup/archive.mjs', 'backup/instances.mjs', 'backup/replace.mjs', 'backup/storage.mjs', 'backup/ui.mjs', 'storage/indexeddb.mjs', 'model/project-integrity.mjs', 'editor.js', 'core/primitives.mjs', 'core/colors.mjs', 'core/gradient-model.mjs', 'core/shape-catalog.mjs', 'core/geometry.mjs'];
const read = name => readFile(resolve(sourceRoot, name), 'utf8');
const slice = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));

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

test('template and CSS retain original bytes; only the script has a new build contract', async () => {
  const original = await readFile(resolve(source, 'index.html'), 'utf8');
  let template = original;
  for (const { opening, closing, file, marker } of slots) {
    const start = template.indexOf(opening) + opening.length;
    const end = template.indexOf(closing, start);
    if (file !== 'editor.js') assert.equal(await read(file), template.slice(start, end));
    template = template.slice(0, start) + marker + template.slice(end);
  }
  assert.equal(await read('index.template.html'), template);
});

test('module function bodies and ALL remaining legacy statements retain their historical order and bytes', async () => {
  const original = await readFile(resolve(source, 'index.html'), 'utf8');
  const script = slice(original, '<script>', '</script>').slice('<script>'.length);
  const prim = slice(script, 'const html=', 'const types=');
  const color = slice(script, 'function rgbHex(', 'function currentPickerKey(');
  assert.equal(await read('core/primitives.mjs'), prim + '\nexport { html, clamp, fmt };\n');
  assert.equal(await read('core/colors.mjs'), "import { clamp } from './primitives.mjs';\n\n" + color
    + '\nexport { rgbHex, hexRgb, hsvRGB, rgbHSV, rgbHSL, hslRGB, normalizeHex, cpFormatValues };\n');
  const gradient = slice(script, 'function gradientStops(e)', 'function getGradientStop(');
  assert.equal(await read('core/gradient-model.mjs'),
    "import { clamp } from './primitives.mjs';\nimport { normalizeHex, hexRgb, rgbHex } from './colors.mjs';\n\n"
    + 'export function createGradientModel(uid) {\n' + gradient
    + '\n return { gradientStops, gradientGeometry, gradientSample, addGradientStop };\n}\n');
  const validator = slice(script, 'function validateShapeCatalog(input){', 'function applyShapeCatalog(');
  assert.equal(await read('core/shape-catalog.mjs'), 'export ' + validator);
  const geometryFunctions = geometryNames.map(name => {
    const matches = [...script.matchAll(new RegExp('^function ' + name + '\\([^\\n]*\\n', 'gm'))];
    assert.equal(matches.length, 1, name);
    return matches[0][0];
  });
  assert.equal(await read('core/geometry.mjs'), geometryFunctions.map(f => 'export ' + f).join('\n'));
  const binding = 'const { gradientStops, gradientGeometry, gradientSample, addGradientStop } = createGradientModel(uid);\n';
  const editor = await restoreZipChanges(await read('editor.js'));
  assert.equal(editor.split(binding).length, 2);
  // Only uid's declaration precedes the factory; it cannot be used before initialization.
  assert.match(editor, /const uid=[^\n]+;\nconst \{ gradientStops, gradientGeometry, gradientSample, addGradientStop \} = createGradientModel\(uid\);/);
  const restored = await restorePersistenceChanges(await restoreIntegrityChanges(editor));
  assert.equal(restored.replace(/^import [^\n]+;\n/gm, '').replace(binding, ''),
    geometryFunctions.reduce((s, f) => s.replace(f, ''),
      script.replace(prim, '').replace(color, '').replace(gradient, '').replace(validator, '')));
  assert.doesNotMatch(editor, /\{\{KARTOCHNAYA:/);
  await assert.rejects(read('core/gradient-model.js'), /ENOENT/);
  const compiler = await readFile(resolve(root, 'scripts/compile-javascript.mjs'), 'utf8');
  assert.doesNotMatch(compiler, /assembleLegacyJavaScript|gradientModelSlot|CORE_GRADIENT_MODEL_JS|gradient-model\.js/);
  // This protects uid/clone, duplicate function declarations, async init() position,
  // wrapper captures/assignments and ALL keyboard, mobile and pointer handlers.
});

test('real imports/exports resolve once; the browser bundle is one classic script with no runtime imports', async () => {
  assert.deepEqual(Object.keys(primitives).sort(), [...primitiveNames].sort());
  assert.deepEqual(Object.keys(colors).sort(), [...colorNames].sort());
  assert.deepEqual(Object.keys(geometry).sort(), [...geometryNames].sort());
  assert.match(await read('editor.js'), /import \{ toLocal, boundsOf, handleCoords, gradientLocalPoint, gradientDocPoint \} from '\.\/core\/geometry\.mjs';/);
  assert.doesNotMatch(await read('core/geometry.mjs'), /\b(?:app|document|window|globalThis|indexedDB|import)\b/);
  assert.deepEqual(Object.keys(storage).sort(), ['openDatabase', 'runStoreRequest', 'runStoreTransaction']);
  assert.match(await read('editor.js'), /import \{ openDatabase, runStoreRequest, runStoreTransaction \} from '\.\/storage\/indexeddb\.mjs';/);
  assert.deepEqual(Object.keys(catalog), ['validateShapeCatalog']);
  assert.match(await read('editor.js'), /import \{ validateShapeCatalog \} from '\.\/core\/shape-catalog\.mjs';/);
  assert.deepEqual(Object.keys(gradients), ['createGradientModel']);
  assert.deepEqual(Object.keys(gradients.createGradientModel(() => 'test')).sort(), [...gradientNames].sort());
  const { code, metafile } = await bundleJavaScript();
  assert.deepEqual(Object.keys(metafile.inputs).sort(), ['../node_modules/fflate/esm/browser.js', 'backup/archive.mjs', 'backup/instances.mjs', 'backup/replace.mjs', 'backup/storage.mjs', 'backup/ui.mjs', 'core/colors.mjs', 'core/geometry.mjs', 'core/gradient-model.mjs', 'core/primitives.mjs', 'core/shape-catalog.mjs', 'editor.js', 'model/project-integrity.mjs', 'storage/indexeddb.mjs']);
  assert.equal(metafile.inputs['core/colors.mjs'].imports[0].path, 'core/primitives.mjs');
  assert.deepEqual(metafile.inputs['editor.js'].imports.map(i => i.path), ['backup/replace.mjs', 'backup/instances.mjs', 'backup/ui.mjs', 'backup/storage.mjs', 'storage/indexeddb.mjs', 'model/project-integrity.mjs', 'core/geometry.mjs', 'core/shape-catalog.mjs', 'core/primitives.mjs', 'core/colors.mjs', 'core/gradient-model.mjs']);
  assert.deepEqual(metafile.inputs['core/geometry.mjs'].imports, []);
  assert.deepEqual(metafile.inputs['storage/indexeddb.mjs'].imports, []); // Leaf; no import cycle or app dependency.
  assert.ok(Object.values(metafile.outputs)[0].inputs['storage/indexeddb.mjs'].bytesInOutput > 0);
  assert.doesNotMatch(await read('storage/indexeddb.mjs'), /\bapp\b|deleteDatabase/);
  assert.ok(Object.values(metafile.outputs)[0].inputs['core/geometry.mjs'].bytesInOutput > 0);
  for (const name of geometryNames) {
    assert.doesNotMatch(await read('editor.js'), new RegExp('function ' + name + '\\('));
    // Unused gradientDocPoint may be omitted if tree shaking is enabled later.
    const count = [...code.toString().matchAll(new RegExp('function ' + name + '\\(', 'g'))].length;
    if (name === 'gradientDocPoint') assert.ok(count <= 1, name);
    else assert.equal(count, 1, name);
  }
  assert.deepEqual(metafile.inputs['core/shape-catalog.mjs'].imports, []); // Leaf module cannot create a cycle.
  assert.deepEqual(metafile.inputs['core/gradient-model.mjs'].imports.map(i => i.path), ['core/primitives.mjs', 'core/colors.mjs']);
  assert.ok(Object.values(metafile.inputs).every(i => i.format === 'esm'));
  assert.equal(Object.keys(metafile.outputs).length, 1);
  assert.ok(Object.values(metafile.outputs)[0].inputs['core/shape-catalog.mjs'].bytesInOutput > 0);
  assert.deepEqual(Object.values(metafile.outputs)[0].imports, []);
  const js = code.toString();
  verifyClassicJavaScript(js);
  assert.doesNotMatch(js, /^\s*(?:import|export)\s|\bimport\s*\(|\b(?:window|globalThis)\.(?:html|clamp|fmt|rgbHex|hexRgb|hsvRGB|rgbHSV|rgbHSL|hslRGB|normalizeHex|cpFormatValues|validateShapeCatalog)\s*=/m);
  assert.doesNotMatch(js, /\{\{KARTOCHNAYA:|sourceMappingURL=/);
  const editor = await restoreZipChanges(await read('editor.js'));
  for (const name of [...primitiveNames, ...colorNames, ...gradientNames, 'createGradientModel', 'validateShapeCatalog']) {
    assert.equal([...js.matchAll(new RegExp(`(?:function|var|const) ${name}(?:\\s*[=(])`, 'g'))].length, 1, name);
    assert.doesNotMatch(editor, new RegExp(`(?:function|const) ${name}[=(]`));
  }
  for (const name of ['fitCanvas', 'applyZoom', 'renderSlideStrip', 'changeSlide']) {
    assert.equal([...js.matchAll(new RegExp(`function ${name}\\(`, 'g'))].length, 2, name);
  }
  const html = (await compileHTML()).toString();
  assert.equal((html.match(/<script\b/gi) || []).length, 1);
  assert.equal((html.match(/<\/script\s*>/gi) || []).length, 1);
  assert.ok(html.includes('<script>' + js + '</script>'));
  assert.doesNotMatch(html, /<script\b[^>]*(?:\bsrc\s*=|\btype\s*=\s*["']module)/i);
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

test('each real source participates through meaningful code changes; all targets are deterministic', async () => {
  await temporarySources(async (sources, outputDirectory) => {
    const options = { sourceDirectory: sources, outputDirectory };
    const outputs = () => Promise.all(['kartochnaya.html', 'kartochnaya-pwa.zip'].map(n => readFile(resolve(outputDirectory, n))));
    await build('all', options);
    const original = await outputs();
    await build('all', options);
    assert.deepEqual(await outputs(), original);
    await build('html', options); await build('pwa', options);
    assert.deepEqual(await outputs(), original);
    const probes = {
      'backup/archive.mjs': s => s.replace('512 * 1024 * 1024', '513 * 1024 * 1024'),
      'backup/instances.mjs': s => s.replace('kartochnaya-workspace-v1', 'workspace-source-probe'),
      'backup/replace.mjs': s => s.replace('Нет страховочного снимка', 'Source replacement probe'),
      'backup/storage.mjs': s => s.replace('Есть неподтверждённая запись', 'Source storage probe'),
      'backup/ui.mjs': s => s.replace('Локальные ZIP-копии', 'Source ZIP UI probe'),
      'index.template.html': s => s.replace('Карточная · v0.45', 'Source dependency probe'),
      'styles/legacy-01.css': s => s + '\n.source-probe{color:#123456}\n',
      'styles/legacy-02.css': s => s + '\n.source-probe{width:123px}\n',
      'storage/indexeddb.mjs': s => s.replace("'IndexedDB is unavailable'", "'Storage dependency probe'"),
      'model/project-integrity.mjs': s => s.replace('maxDocuments = 5000', 'maxDocuments = 4999'),
      'editor.js': s => s.replace("'id-'+Date.now()", "'source-probe-'+Date.now()"),
      'core/primitives.mjs': s => s.replace('Math.max(a,x)', 'Math.max(a,x+1)'),
      'core/colors.mjs': s => s.replace("return '#'+", "return '#source-probe'+"),
      'core/gradient-model.mjs': s => s.replace('pos=50', 'pos=51'),
      'core/geometry.mjs': s => s.replace('dx=p.x-e.x-e.w/2', 'dx=p.x-e.x-e.w/2+1'),
      'core/shape-catalog.mjs': s => s.replace('input.length>300', 'input.length>299'),
    };
    for (const name of inputs) {
      const file = resolve(sources, name), text = await readFile(file, 'utf8');
      const changedSource = probes[name](text);
      assert.notEqual(changedSource, text, name);
      await writeFile(file, changedSource);
      await build('all', options);
      const changed = await outputs();
      assert.notDeepEqual(changed[0], original[0], name);
      assert.notDeepEqual(changed[1], original[1], name);
      assert.deepEqual(changed[0], await compileHTML(sources), name);
      await writeFile(file, text);
    }
  });
});

test('every missing component, bad import/export or syntax error rejects the actual build without historical fallback', async () => {
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
    for (const invalid of [editor.replace('{ html,', '{ absentExport,'),
      editor.replace('./core/geometry.mjs', './core/missing-geometry.mjs'),
      editor.replace('{ toLocal,', '{ missingGeometry,'),
      editor.replace('./core/colors.mjs', './core/missing.mjs'),
      editor.replace('./core/shape-catalog.mjs', './core/missing-shape.mjs'),
      editor.replace('./core/gradient-model.mjs', './core/missing-gradient.mjs'),
      editor.replace('import { createGradientModel }', 'import { missingFactory }'), editor + '\nconst = broken;',
      editor + '\nimport("https://example.com/runtime.js");',
      editor + '\nimport(globalThis.runtimeModule);']) {
      await writeFile(file, invalid);
      await assert.rejects(build('all', options));
    }
    await writeFile(file, editor);
    const moduleFile = resolve(sources, 'core/gradient-model.mjs'), module = await readFile(moduleFile, 'utf8');
    for (const invalid of [module.replace('export function', 'function'),
      module.replace('createGradientModel(uid)', 'wrongFactory(uid)'), module + '\nconst = broken;',
      module.replace('./colors.mjs', './missing-colors.mjs'), module.replace('{ clamp }', '{ missingClamp }')]) {
      await writeFile(moduleFile, invalid);
      await assert.rejects(build('all', options));
    }
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

test('shape catalog missing export and syntax errors fail the actual build', async () => {
  await temporarySources(async (sources, outputDirectory) => {
    const file = resolve(sources, 'core/shape-catalog.mjs'), code = await readFile(file, 'utf8');
    for (const invalid of [code.replace('export function', 'function'), code + '\nconst = broken;']) {
      await writeFile(file, invalid);
      await assert.rejects(build('all', { sourceDirectory: sources, outputDirectory }));
      await assert.rejects(readFile(resolve(outputDirectory, 'kartochnaya.html')), /ENOENT/);
    }
  });
});


test('geometry missing export, syntax error and stale marker fail the actual build', async () => {
  await temporarySources(async (sources, outputDirectory) => {
    const file = resolve(sources, 'core/geometry.mjs'), code = await readFile(file, 'utf8');
    for (const invalid of [code.replace('export function toLocal', 'function toLocal'),
      code + '\nconst = broken;', code + '\n// {{KARTOCHNAYA:UNRESOLVED}}']) {
      await writeFile(file, invalid);
      await assert.rejects(build('all', { sourceDirectory: sources, outputDirectory }));
      await assert.rejects(readFile(resolve(outputDirectory, 'kartochnaya.html')), /ENOENT/);
    }
  });
});

test('storage missing exports, malformed source and stale marker fail the real build', async () => {
  await temporarySources(async (sources, outputDirectory) => {
    const file = resolve(sources, 'storage/indexeddb.mjs'), code = await readFile(file, 'utf8');
    for (const invalid of [code.replace('export function runStoreRequest', 'function runStoreRequest'),
      code.replace('export function openDatabase', 'function openDatabase'), code.replace('export function runStoreTransaction', 'function runStoreTransaction'), code + '\nconst = broken;',
      code + '\n// {{KARTOCHNAYA:UNRESOLVED}}']) {
      await writeFile(file, invalid);
      await assert.rejects(build('all', { sourceDirectory: sources, outputDirectory }));
      await assert.rejects(readFile(resolve(outputDirectory, 'kartochnaya.html')), /ENOENT/);
    }
  });
});

// An exact, reviewed persistence-only diff is reversed before the historical byte check.
// Both changed blocks and every byte outside them are protected; there is no regex exclusion.
async function restorePersistenceChanges(editor) {
  const bytes = await readFile(resolve(root, 'tests/fixtures/persistence-editor-diff.json'));
  assert.equal(hash(bytes), '1dd650e3da92a1b62edd01cce310e6005141d076ec3b4f814b03f9124e480054');
  const manifest = JSON.parse(bytes);
  const lines = editor.split(/(?<=\n)/);
  for (const block of [...manifest.blocks].reverse()) {
    const actual = lines.slice(block.newLine, block.newLine + block.afterLines).join('');
    assert.equal(hash(actual), block.afterSHA256, 'Only reviewed persistence blocks may change: ' + block.scope);
    lines.splice(block.newLine, block.afterLines, ...block.before);
  }
  const restored = lines.join('');
  assert.equal(hash(restored), manifest.baseSHA256);
  assert.equal(manifest.baseSHA256, '9d7f0452f0f0309157e975f46de6e7697f696c5ccdccd6353136668fc0bd6d8b');
  return restored;
}

test('persistence diff guard rejects changes both inside and outside reviewed blocks', async () => {
  const editor = await restoreZipChanges(await read('editor.js'));
  await assert.rejects(restorePersistenceChanges((await restoreIntegrityChanges(editor)).replace("'Сохранено на этом устройстве'", "'Unreviewed status'")));
  await assert.rejects(restorePersistenceChanges((await restoreIntegrityChanges(editor)).replace('function paint()', 'function unexpectedPaint()')));
});

// Stage 10's exact manifest remains immutable. Undo only the seven reviewed stage 11
// integration blocks before applying that older manifest and the historical check.
async function restoreIntegrityChanges(editor) {
  const bytes = await readFile(resolve(root, 'tests/fixtures/project-integrity-editor-diff.json'));
  assert.equal(hash(bytes), 'a44e6c84f99771441ad4ae69c3c88ee1f31aa596ab7f858a14a3c3bd353fad9c');
  const manifest = JSON.parse(bytes), lines = editor.split(/(?<=\n)/);
  for (const block of [...manifest.blocks].reverse()) {
    assert.equal(hash(lines.slice(block.newLine, block.newLine + block.afterLines).join('')), block.afterSHA256, block.scope);
    lines.splice(block.newLine, block.afterLines, ...block.before);
  }
  assert.equal(hash(lines.join('')), manifest.baseSHA256);
  assert.equal(manifest.baseSHA256, 'b6f5e464a8ed982c7ece776007f079087c28a3ffc3ab12bef6d6ea67aad4253a');
  return lines.join('');
}
test('project integrity guard rejects edits within and outside every integration block; old storage API bytes stay fixed', async () => {
  const editor = await restoreZipChanges(await read('editor.js'));
  for (const [from, to] of [
    ['runStoreTransaction }', 'unreviewedTransaction }'],
    ['deletedProjectIds.has(rec.projectId)', 'false'],
    ['deletedProjectIds.has(p.id)', 'false'],
    ['const plan=prepareProjectImport', 'const plan=unreviewedImport'],
    ['doc.projectId===plan.projects[0].id', 'true'],
    ['JSON.parse(await file.text())', 'JSON.parse(await file.unreviewed())'],
    ["projects.delete(id);", "projects.delete('wrong');"],
    ['payload.projects,5000)', 'payload.projects,5001)'],
    ['function paint()', 'function changedPaint()'],
  ]) { assert.ok(editor.includes(from), from); await assert.rejects(restoreIntegrityChanges(editor.replace(from, to))); }
  const storage = await read('storage/indexeddb.mjs');
  assert.equal(hash(storage.slice(0, storage.indexOf('\n// The callback queues'))), '9b0a0b1799fd46f46f932c3b5224752c97d29100374d633065a181318cab9dc5');
  assert.doesNotMatch(await read('model/project-integrity.mjs'), /\b(?:app|window|globalThis|indexedDB|localStorage|fetch|document)\s*[.(]/);
});

async function restoreWorkspaceChanges(editor) {
  const bytes = await readFile(resolve(root, 'tests/fixtures/workspace-replace-editor-diff.json'));
  assert.equal(hash(bytes), '7273ab89151d10b1abc2110d73afeb37bba5520e47a85ff281121cfa544036ec');
  const manifest = JSON.parse(bytes), lines = editor.split(/(?<=\n)/);
  for (const block of [...manifest.blocks].reverse()) {
    assert.equal(hash(lines.slice(block.newLine, block.newLine + block.afterLines).join('')), block.afterSHA256, block.scope);
    lines.splice(block.newLine, block.afterLines, ...block.before);
  }
  assert.equal(hash(lines.join('')), manifest.baseSHA256);
  return lines.join('');
}
async function restoreZipChanges(editor) {
  editor = await restoreWorkspaceChanges(editor);
  const bytes = await readFile(resolve(root, 'tests/fixtures/zip-backup-editor-diff.json'));
  assert.equal(hash(bytes), '0ee6ed882b0e47a3795bead9707ebed2e2025cc67b46d95b143f79d08eb2891c');
  const manifest = JSON.parse(bytes), lines = editor.split(/(?<=\n)/);
  for (const block of [...manifest.blocks].reverse()) {
    assert.equal(hash(lines.slice(block.newLine, block.newLine + block.afterLines).join('')), block.afterSHA256, block.scope);
    lines.splice(block.newLine, block.afterLines, ...block.before);
  }
  assert.equal(hash(lines.join('')), manifest.baseSHA256);
  assert.equal(manifest.baseSHA256, '9f081b02ce62bf13f8371b9a6477339212ca82c9beab769b408f4a460fc49124');
  return lines.join('');
}
test('ZIP diff guard rejects edits inside and outside every approved block', async () => {
  const editor = await read('editor.js');
  const manifest = JSON.parse(await readFile(resolve(root, 'tests/fixtures/zip-backup-editor-diff.json')));
  for (const b of manifest.blocks) {
    const lines = editor.split(/(?<=\n)/); lines[b.newLine] += 'unreviewed';
    await assert.rejects(restoreZipChanges(lines.join('')));
  }
  await assert.rejects(restoreZipChanges(editor.replace('function paint()', 'function unreviewedPaint()')));
});
