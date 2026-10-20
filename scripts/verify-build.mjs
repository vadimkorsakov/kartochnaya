import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root, source, dist, inputs, zip, hash } from './distribution.mjs';
const baseline = JSON.parse(await readFile(resolve(root, 'docs/baseline-v045.json')));
for (const [name, expected] of Object.entries(baseline.files)) {
  const bytes = await readFile(resolve(source, name));
  assert.equal(bytes.length, expected.bytes, name);
  assert.equal(hash(bytes), expected.sha256, name);
}
const entries = await inputs();
assert.deepEqual(entries.map(e => e.name), Object.keys(baseline.files).filter(n => n !== 'README.md').sort());
const html = await readFile(resolve(dist, 'kartochnaya.html'));
assert.deepEqual(html, await readFile(resolve(source, 'index.html')));
const archive = await readFile(resolve(dist, 'kartochnaya-pwa.zip'));
assert.deepEqual(archive, zip(entries), 'ZIP must contain exactly the original runtime files and canonical metadata');
for (const [name, bytes] of [['kartochnaya.html', html], ['kartochnaya-pwa.zip', archive]]) console.log(`${hash(bytes)}  ${name}`);
console.log('Verified: 19 unchanged release files; identical HTML; canonical ZIP with 18 runtime files. KF-003 remains.');
