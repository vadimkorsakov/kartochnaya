import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { build, hash } from '../scripts/distribution.mjs';
test('current HTML/ZIP/Netlify builds are deterministic; callback isolated from standalone/ZIP and precache', async () => {
  const root = await mkdtemp(join(tmpdir(), 'yandex-netlify-'));
  try {
    for (const pass of ['a', 'b']) await build('all', { outputDirectory: join(root, pass) });
    for (const name of ['kartochnaya.html', 'kartochnaya-pwa.zip']) assert.deepEqual(await readFile(join(root, 'a', name)), await readFile(join(root, 'b', name)), name);
    const html = await readFile(join(root, 'a/kartochnaya.html'));
    assert.doesNotMatch(html.toString('utf8'), /yandex-callback|yandexCard|kartochnaya-yandex|<script\b[^>]*(?:\bsrc\s*=|\btype\s*=\s*["']module)/i);
    const archive = unzipSync(await readFile(join(root, 'a/kartochnaya-pwa.zip')));
    assert.deepEqual(Buffer.from(archive['index.html']), html, 'ZIP embeds the current standalone HTML');
    assert.ok(!Object.keys(archive).some(name => /^(?:oauth\/|cloud\/yandex-disk\/)/.test(name)), 'OAuth callback and Yandex modules are Netlify-only');
    const listFiles = async directory => (await readdir(directory, { recursive: true, withFileTypes: true })).filter(e => e.isFile()).map(e => join(e.parentPath, e.name).slice(directory.length + 1)).sort();
    const names = await listFiles(join(root, 'a/netlify'));
    assert.deepEqual(names, await listFiles(join(root, 'b/netlify')), 'Independent Netlify builds contain the same files');
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
