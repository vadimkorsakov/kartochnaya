import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, hash } from '../scripts/distribution.mjs';
const base = 'd3d4b1a508d4bcea0778b382631454a1d94db19a';
test('Netlify deterministic manifest/CSP, callback excluded from precache; standalone/ZIP equal initial main', async () => {
  const root = await mkdtemp(join(tmpdir(), 'yandex-netlify-'));
  try {
    for (const pass of ['a', 'b']) await build('all', { outputDirectory: join(root, pass) });
    for (const [name, expected] of [['kartochnaya.html', 'c3a7084fcad2deec6e3ac463932f3d1e8be84f00db283969f93d025f91e32460'], ['kartochnaya-pwa.zip', '9ca3d28e0bfb7b60c4f4597d0505282e61f164b6e51b71949abb9aca14a8b4c7']]) assert.equal(hash(await readFile(join(root, 'a', name))), expected, `${name} unchanged from ${base}`);
    const names = (await readdir(join(root, 'a/netlify'), { recursive: true, withFileTypes: true })).filter(e => e.isFile()).map(e => join(e.parentPath, e.name).slice(join(root, 'a/netlify').length + 1));
    for (const name of names) assert.deepEqual(await readFile(join(root, 'a/netlify', name)), await readFile(join(root, 'b/netlify', name)), name);
    const sw = await readFile(join(root, 'a/netlify/sw.js'), 'utf8');
    assert.doesNotMatch(sw, /yandex-callback/);
    const sums = JSON.parse(await readFile(join(root, 'a/netlify/SHA256SUMS.json')));
    const callback = await readFile(join(root, 'a/netlify/oauth/yandex-callback.html'), 'utf8');
    assert.equal(sums['oauth/yandex-callback.html'], hash(callback));
    const headers = await readFile(join(root, 'a/netlify/_headers'), 'utf8');
    const scriptHash = Buffer.from(hash(callback.match(/<script>([\s\S]*?)<\/script>/)[1]), 'hex').toString('base64');
    assert.ok(headers.includes("script-src 'sha256-" + scriptHash + "'"));
    assert.match(headers, /\/oauth\/yandex-callback.html\n  Cache-Control: no-store\n  Referrer-Policy: no-referrer/);
    assert.doesNotMatch(callback, /indexedDB|serviceWorker|editor\.js|google-drive|<link|src=/);
    for (const [name, expected] of Object.entries(sums)) assert.equal(hash(await readFile(join(root, 'a/netlify', name))), expected);
  } finally { await rm(root, { recursive: true, force: true }); }
});
