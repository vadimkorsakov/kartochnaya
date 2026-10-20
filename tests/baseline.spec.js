const { test, expect } = require('@playwright/test');
const { readFile, readdir } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const path = require('node:path');
const baseline = require('../docs/baseline-v045.json');

test('release files and HTML control characteristics match the original v0.45', async () => {
  const root = path.join(__dirname, '..', baseline.applicationRoot);
  const actualFiles = (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort();
  expect(actualFiles).toEqual(Object.keys(baseline.files).sort());
  for (const [name, expected] of Object.entries(baseline.files)) {
    const bytes = await readFile(path.join(root, name));
    expect({ bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, name)
      .toEqual(expected);
  }
  const html = await readFile(path.join(root, 'index.html'));
  expect({
    bytes: html.length,
    newlineCount: [...html].filter(byte => byte === 10).length,
    styleBlocks: (html.toString().match(/<style\b/g) || []).length,
    scriptBlocks: (html.toString().match(/<script\b/g) || []).length,
    staticManifestLinks: (html.toString().match(/<link\b[^>]*rel=["']manifest["']/g) || []).length,
  }).toEqual(baseline.html);
});
