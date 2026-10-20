import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { compileHTML, sourceRoot, slots } from '../scripts/compile-html.mjs';
import { build, source, hash } from '../scripts/distribution.mjs';

test('each extracted block and the restored HTML retain every original byte', async () => {
  const original = await readFile(resolve(source, 'index.html'));
  let template = original;
  let cursor = 0;
  for (const { opening, closing, file, marker } of slots) {
    const start = original.indexOf(Buffer.from(opening), cursor) + Buffer.byteLength(opening);
    const end = original.indexOf(Buffer.from(closing), start);
    assert.ok(start >= cursor && end >= start, file);
    assert.deepEqual(await readFile(resolve(sourceRoot, file)), original.subarray(start, end), file);
    const position = template.indexOf(Buffer.from(opening)) + Buffer.byteLength(opening);
    template = Buffer.concat([template.subarray(0, position), Buffer.from(marker), template.subarray(position + end - start)]);
    cursor = end + Buffer.byteLength(closing);
  }
  assert.deepEqual(await readFile(resolve(sourceRoot, 'index.template.html')), template);
  assert.deepEqual(await compileHTML(), original);
});

async function temporarySources(run) {
  const directory = await mkdtemp(resolve(tmpdir(), 'kartochnaya-source-'));
  try {
    const sources = resolve(directory, 'src');
    await cp(sourceRoot, sources, { recursive: true });
    await run(sources, resolve(directory, 'dist'));
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('missing, repeated, unexpected, malformed, moved and out-of-order markers fail closed', async () => {
  await temporarySources(async sources => {
    const file = resolve(sources, 'index.template.html');
    const template = await readFile(file, 'utf8');
    const [first, second] = slots.map(slot => slot.marker);
    const invalid = [
      template.replace(first, ''),
      template + first,
      template + '{{KARTOCHNAYA:UNKNOWN}}',
      template + '{{KARTOCHNAYA:UNCLOSED',
      template.replace(first, ' ' + first),
      template.replace(first, second),
    ];
    // Swap both slots without replacing the freshly inserted token.
    invalid.push(template.replace(first, 'SWAP').replace(second, first).replace('SWAP', second));
    for (const value of invalid) {
      await writeFile(file, value);
      await assert.rejects(compileHTML(sources), /marker|original tag/i);
    }
    await writeFile(file, template);
    await rm(resolve(sources, 'editor.js'));
    await assert.rejects(compileHTML(sources), /ENOENT/);
  });
});

function readStoredIndex(archive) {
  let cursor = 0;
  while (archive.readUInt32LE(cursor) === 0x04034b50) {
    assert.equal(archive.readUInt16LE(cursor + 8), 0);
    const size = archive.readUInt32LE(cursor + 18);
    const length = archive.readUInt16LE(cursor + 26);
    const start = cursor + 30 + length + archive.readUInt16LE(cursor + 28);
    const name = archive.subarray(cursor + 30, cursor + 30 + length).toString('utf8');
    if (name === 'index.html') return archive.subarray(start, start + size);
    cursor = start + size;
  }
  throw new Error('No index.html in ZIP');
}

test('both outputs use every src input; two builds and separate targets are identical', async () => {
  await temporarySources(async (sources, outputDirectory) => {
    const options = { sourceDirectory: sources, outputDirectory };
    const outputs = async () => Promise.all(['kartochnaya.html', 'kartochnaya-pwa.zip'].map(name => readFile(resolve(outputDirectory, name))));
    await build('all', options);
    const original = await outputs();
    assert.equal(hash(original[0]), '7d2c286b31ba8e2aa797177e8c7ab359bcbda816fc06bf2f1226dc5b1baec27a');
    assert.equal(hash(original[1]), 'db9b0bd4001d007aa1d62982eccdfb0b8963fd5e070e0f999f55e573348a4a2f');
    await build('all', options);
    assert.deepEqual(await outputs(), original, 'two full builds');
    await build('html', options);
    await build('pwa', options);
    assert.deepEqual(await outputs(), original, 'separate build targets');
    for (const name of ['index.template.html', ...slots.map(slot => slot.file)]) {
      const file = resolve(sources, name);
      const bytes = await readFile(file);
      // Mutate only the temporary copy, never tracked sources or expected hashes.
      await writeFile(file, Buffer.concat([bytes, Buffer.from('\n/* source dependency probe */\n')]));
      await build('all', options);
      const changed = await outputs();
      assert.notDeepEqual(changed[0], original[0], name);
      assert.notDeepEqual(changed[1], original[1], name);
      assert.deepEqual(changed[0], await compileHTML(sources), name);
      assert.deepEqual(readStoredIndex(changed[1]), changed[0], name);
      await writeFile(file, bytes);
    }
    await rm(resolve(sources, 'editor.js'));
    await assert.rejects(build('all', options), /ENOENT/, 'no historical HTML fallback');
  });
});
