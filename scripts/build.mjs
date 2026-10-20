import { build } from './distribution.mjs';
const kind = process.argv[2] || 'all';
if (!['all', 'html', 'pwa'].includes(kind)) throw new Error(`Unknown target: ${kind}`);
await build(kind);
console.log(`Built: ${kind}`);
