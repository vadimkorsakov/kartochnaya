import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root, source, dist, inputs, zip, hash } from './distribution.mjs';
import { compileHTML } from './compile-html.mjs';
import { verifyClassicJavaScript } from './compile-javascript.mjs';
const baseline = JSON.parse(await readFile(resolve(root, 'docs/baseline-v045.json')));
const historicalFiles = (await readdir(source, { recursive: true, withFileTypes: true }))
  .filter(e => e.isFile()).map(e => resolve(e.parentPath, e.name).slice(source.length + 1)).sort();
assert.equal(historicalFiles.length, 19);
assert.deepEqual(historicalFiles, Object.keys(baseline.files).sort());
for (const [name, expected] of Object.entries(baseline.files)) {
  const bytes = await readFile(resolve(source, name));
  assert.equal(bytes.length, expected.bytes, name);
  assert.equal(hash(bytes), expected.sha256, name);
}
const entries = await inputs();
assert.deepEqual(entries.map(e => e.name), Object.keys(baseline.files).filter(n => n !== 'README.md').sort());
const html = await readFile(resolve(dist, 'kartochnaya.html'));
assert.deepEqual(html, await compileHTML(), 'Built HTML must come from current src/');
assert.deepEqual(html, await compileHTML(), 'Independent repeated compilation must be deterministic');
const text = html.toString('utf8');
assert.equal((text.match(/<script\b/gi) || []).length, 1);
assert.equal((text.match(/<\/script\s*>/gi) || []).length, 1);
assert.doesNotMatch(text, /<script\b[^>]*(?:\bsrc\s*=|\btype\s*=\s*["']module)/i);
assert.doesNotMatch(text, /\{\{KARTOCHNAYA:/);
const script = text.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(script, 'One ordinary inline script is required');
verifyClassicJavaScript(script[1]);
const archive = await readFile(resolve(dist, 'kartochnaya-pwa.zip'));
assert.deepEqual(archive, zip(entries), 'ZIP must contain current HTML, historical assets and canonical metadata');
assert.deepEqual(archive, zip(await inputs()), 'Repeated ZIP assembly must be deterministic');
// Independently inspect actual archive entries, rather than only trusting the writer.
let offset = 0;
const packaged = new Map();
while (archive.readUInt32LE(offset) === 0x04034b50) {
  assert.equal(archive.readUInt16LE(offset + 8), 0, 'ZIP STORE method');
  const size = archive.readUInt32LE(offset + 18), length = archive.readUInt16LE(offset + 26);
  const start = offset + 30 + length + archive.readUInt16LE(offset + 28);
  const name = archive.subarray(offset + 30, offset + 30 + length).toString('utf8');
  assert.ok(!packaged.has(name), 'No duplicate ZIP entries');
  packaged.set(name, archive.subarray(start, start + size));
  offset = start + size;
}
assert.deepEqual([...packaged.keys()], entries.map(e => e.name));
assert.deepEqual(packaged.get('index.html'), html, 'Packaged HTML equals standalone HTML byte for byte');
for (const [name, data] of packaged) {
  if (name === 'index.html') continue;
  assert.equal(data.length, baseline.files[name].bytes, name);
  assert.equal(hash(data), baseline.files[name].sha256, name);
}
for (const [name, bytes] of [['kartochnaya.html', html], ['kartochnaya-pwa.zip', archive]]) console.log(`${hash(bytes)}  ${name}`);
console.log('Verified: 19 unchanged release files; current bundled classic script; deterministic HTML/ZIP; 18 ZIP entries, 17 unchanged PWA assets. KF-003 remains.');
