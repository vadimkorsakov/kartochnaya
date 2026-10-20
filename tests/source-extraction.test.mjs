import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { compileHTML, compileJavaScript, sourceRoot, slots } from '../scripts/compile-html.mjs';
import { assembleLegacyJavaScript, bundleJavaScript, gradientModelSlot, verifyClassicJavaScript } from '../scripts/compile-javascript.mjs';
import { build, root, source, hash } from '../scripts/distribution.mjs';
import * as primitives from '../src/core/primitives.mjs';
import * as colors from '../src/core/colors.mjs';

const primitiveNames = ['html', 'clamp', 'fmt'];
const colorNames = ['rgbHex', 'hexRgb', 'hsvRGB', 'rgbHSV', 'rgbHSL', 'hslRGB', 'normalizeHex', 'cpFormatValues'];
const gradientNames = ['gradientStops', 'gradientGeometry', 'gradientSample', 'addGradientStop'];
const inputs = ['index.template.html', 'styles/legacy-01.css', 'styles/legacy-02.css',
  'editor.js', 'core/primitives.mjs', 'core/colors.mjs', 'core/gradient-model.js'];
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
  const assembled = await assembleLegacyJavaScript();
  assert.equal(assembled.replace(/^import [^\n]+;\n/gm, ''), script.replace(prim, '').replace(color, ''));
  assert.equal(await read('core/gradient-model.js'), slice(script, 'function gradientStops(e)', 'function getGradientStop('));
  // This protects uid/clone, duplicate function declarations, async init() position,
  // wrapper captures/assignments and ALL keyboard, mobile and pointer handlers.
});

test('real imports/exports resolve once; the browser bundle is one classic script with no runtime imports', async () => {
  assert.deepEqual(Object.keys(primitives).sort(), [...primitiveNames].sort());
  assert.deepEqual(Object.keys(colors).sort(), [...colorNames].sort());
  const { code, metafile } = await bundleJavaScript();
  assert.deepEqual(Object.keys(metafile.inputs).sort(), ['core/colors.mjs', 'core/primitives.mjs', 'editor.js']);
  assert.equal(metafile.inputs['core/colors.mjs'].imports[0].path, 'core/primitives.mjs');
  assert.deepEqual(metafile.inputs['editor.js'].imports.map(i => i.path), ['core/primitives.mjs', 'core/colors.mjs']);
  assert.ok(Object.values(metafile.inputs).every(i => i.format === 'esm'));
  assert.equal(Object.keys(metafile.outputs).length, 1);
  assert.deepEqual(Object.values(metafile.outputs)[0].imports, []);
  const js = code.toString();
  verifyClassicJavaScript(js);
  assert.doesNotMatch(js, /^\s*(?:import|export)\s|\bimport\s*\(|\b(?:window|globalThis)\.(?:html|clamp|fmt|rgbHex|hexRgb|hsvRGB|rgbHSV|rgbHSL|hslRGB|normalizeHex|cpFormatValues)\s*=/m);
  assert.doesNotMatch(js, /\{\{KARTOCHNAYA:|sourceMappingURL=/);
  const editor = await read('editor.js');
  for (const name of [...primitiveNames, ...colorNames, ...gradientNames]) {
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

test('missing, malformed, repeated and moved HTML/legacy markers fail closed', async () => {
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
    const { marker } = gradientModelSlot;
    for (const invalid of [editor.replace(marker, ''), editor + marker,
      editor.replace(marker, marker.trimEnd()), editor.replace(marker, ' ' + marker),
      editor.replace(marker, '').concat(marker), editor.replace('\n\n' + marker, '\n' + marker),
      editor + '{{KARTOCHNAYA:UNKNOWN}}', editor + '{{KARTOCHNAYA:UNCLOSED']) {
      await writeFile(entry, invalid);
      await assert.rejects(compileHTML(sources), /marker/i);
    }
    await writeFile(entry, editor);
    await writeFile(resolve(sources, gradientModelSlot.file), '{{KARTOCHNAYA:UNRESOLVED}}');
    await assert.rejects(compileHTML(sources), /marker/i);
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
      'index.template.html': s => s.replace('Карточная · v0.45', 'Source dependency probe'),
      'styles/legacy-01.css': s => s + '\n.source-probe{color:#123456}\n',
      'styles/legacy-02.css': s => s + '\n.source-probe{width:123px}\n',
      'editor.js': s => s.replace("'id-'+Date.now()", "'source-probe-'+Date.now()"),
      'core/primitives.mjs': s => s.replace('Math.max(a,x)', 'Math.max(a,x+1)'),
      'core/colors.mjs': s => s.replace("return '#'+", "return '#source-probe'+"),
      'core/gradient-model.js': s => s.replace('pos=50', 'pos=51'),
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
      editor.replace('./core/colors.mjs', './core/missing.mjs'), editor + '\nconst = broken;',
      editor + '\nimport("https://example.com/runtime.js");',
      editor + '\nimport(globalThis.runtimeModule);']) {
      await writeFile(file, invalid);
      await assert.rejects(build('all', options));
    }
  });
});

test('HTML-sensitive JavaScript strings are escaped safely without changing their value', async () => {
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
