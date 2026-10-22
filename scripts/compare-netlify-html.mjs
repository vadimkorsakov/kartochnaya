// Compare saved, decoded HTTP response bytes with the matching deploy artifact.
import { readFile } from 'node:fs/promises';
const [expectedPath, actualPath] = process.argv.slice(2);
if (!expectedPath || !actualPath) throw Error('Usage: node scripts/compare-netlify-html.mjs dist/netlify/index.html work/production.html');
const [expected, actual] = await Promise.all([readFile(expectedPath), readFile(actualPath)]);
let offset = 0;
while (offset < Math.min(expected.length, actual.length) && expected[offset] === actual[offset]) offset++;
if (expected.equals(actual)) {
  console.log(`Identical: ${expected.length} bytes`);
} else {
  const context = bytes => {
    const start = Math.max(0, offset - 60), end = Math.min(bytes.length, offset + 180);
    return { start, hex: bytes.subarray(start, end).toString('hex'), utf8: bytes.subarray(start, end).toString('utf8') };
  };
  console.log(JSON.stringify({ firstDifferentByte: offset, expectedLength: expected.length, actualLength: actual.length, expected: context(expected), actual: context(actual) }, null, 2));
  process.exitCode = 1;
}
