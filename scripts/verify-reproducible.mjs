import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { build, hash } from './distribution.mjs';
const directory = await mkdtemp(join(tmpdir(), 'kartochnaya-reproducible-'));
try {
  for (const pass of ['first', 'second']) await build('all', { outputDirectory: join(directory, pass) });
  for (const name of ['kartochnaya.html', 'kartochnaya-pwa.zip', 'netlify/SHA256SUMS.json']) {
    const a = await readFile(join(directory, 'first', name)), b = await readFile(join(directory, 'second', name));
    assert.deepEqual(a, b, name); console.log(`${name}: ${a.length} bytes; SHA-256 ${hash(a)}; byte-identical independent builds`);
  }
} finally { await rm(directory, { recursive: true, force: true }); }
