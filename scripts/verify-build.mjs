import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root, source, dist, inputs, zip, hash } from './distribution.mjs';
import { compileHTML } from './compile-html.mjs';
const baseline = JSON.parse(await readFile(resolve(root, 'docs/baseline-v045.json')));
for (const [name, expected] of Object.entries(baseline.files)) {
  const bytes = await readFile(resolve(source, name));
  assert.equal(bytes.length, expected.bytes, name);
  assert.equal(hash(bytes), expected.sha256, name);
}
const entries = await inputs();
assert.deepEqual(entries.map(e => e.name), Object.keys(baseline.files).filter(n => n !== 'README.md').sort());
const html = await readFile(resolve(dist, 'kartochnaya.html'));
assert.deepEqual(html, await compileHTML(), 'Built HTML must come from current src/');
assert.deepEqual(html, await readFile(resolve(source, 'index.html')));
const archive = await readFile(resolve(dist, 'kartochnaya-pwa.zip'));
assert.equal(hash(html), '7d2c286b31ba8e2aa797177e8c7ab359bcbda816fc06bf2f1226dc5b1baec27a', 'Stage 1 HTML SHA-256');
assert.equal(hash(archive), 'db9b0bd4001d007aa1d62982eccdfb0b8963fd5e070e0f999f55e573348a4a2f', 'Stage 1 ZIP SHA-256');
assert.deepEqual(archive, zip(entries), 'ZIP must contain exactly the original runtime files and canonical metadata');
for (const [name, bytes] of [['kartochnaya.html', html], ['kartochnaya-pwa.zip', archive]]) console.log(`${hash(bytes)}  ${name}`);
console.log('Verified: 19 unchanged release files; identical HTML; canonical ZIP with 18 runtime files. KF-003 remains.');
