// A distribution-only transform: the HTML/PWA ZIP compiler path stays byte-identical.
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { compileHTML } from './compile-html.mjs';
import { inputs, hash } from './distribution.mjs';

export async function buildNetlify({ sourceDirectory, outputDirectory }) {
  const runtime = await readFile(new URL('../src/pwa/runtime.mjs', import.meta.url), 'utf8');
  const hook = await readFile(new URL('../src/pwa/editor-hook.js', import.meta.url), 'utf8');
  let html = (await compileHTML(sourceDirectory, { transformEditor(editor) {
    const registration = "if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});";
    if (!editor.includes(registration) || !editor.endsWith('})();\n')) throw Error('Netlify editor hook no longer matches');
    return "import { installYandexUI } from './cloud/yandex-disk/ui.mjs';\nimport { installGoogleDriveUI } from './cloud/google-drive/ui.mjs';\n" + editor.replace(registration, '').slice(0, -6) + runtime.replaceAll('export function ', 'function ') + '\n' + hook + '\ninstallGoogleDriveUI({snapshot:zipSavedSnapshot,download:downloadBlob,backupUI:zipBackupUI});\ninstallYandexUI({snapshot:zipSavedSnapshot,download:downloadBlob,backupUI:zipBackupUI});\n})();\n';
  } })).toString('utf8');
  if (!html.includes('</head>')) throw Error('Missing head');
  html = html.replace('</head>', '<link rel="manifest" href="./manifest.webmanifest">\n<link rel="icon" href="./icon.svg" type="image/svg+xml">\n</head>');
  const entries = (await inputs(Buffer.from(html))).filter(x => x.name !== 'sw.js');
  // Explicit stable identity on this origin. No accounts, URLs with user IDs or tokens.
  const manifest = entries.find(x => x.name === 'manifest.webmanifest');
  manifest.data = Buffer.from(JSON.stringify({ ...JSON.parse(manifest.data), id: '/', start_url: '/', scope: '/' }, null, 2) + '\n');
  const files = entries.map(({ name, data }) => ({ url: './' + name, sha256: hash(data) }));
  const template = await readFile(new URL('../src/pwa/sw.js', import.meta.url), 'utf8');
  const version = hash(JSON.stringify(files) + template);
  entries.push({ name: 'sw.js', data: Buffer.from(template.replace('__BUILD_VERSION__', version).replace('__BUILD_FILES__', JSON.stringify(files))) });
  // Callback is checksummed but deliberately added AFTER the precache manifest.
  entries.push({ name: 'oauth/yandex-callback.html', data: await readFile(new URL('../src/oauth/yandex-callback.html', import.meta.url)) });
  entries.push({ name: '_headers', data: Buffer.from(`/oauth/yandex-callback.html\n  Cache-Control: no-store\n  Referrer-Policy: no-referrer\n  Content-Security-Policy: default-src 'none'; script-src 'sha256-__CALLBACK_HASH__'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'\n/sw.js\n  Cache-Control: no-cache\n  Content-Type: text/javascript; charset=utf-8\n/index.html\n  Cache-Control: no-cache\n/\n  Cache-Control: no-cache\n/manifest.webmanifest\n  Cache-Control: no-cache\n  Content-Type: application/manifest+json\n`) });
  const callbackScript = entries.find(e => e.name === 'oauth/yandex-callback.html').data.toString('utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  const cspHash = Buffer.from(hash(callbackScript), 'hex').toString('base64');
  const headers = entries.find(e => e.name === '_headers');
  headers.data = Buffer.from(headers.data.toString('utf8').replace('__CALLBACK_HASH__', cspHash));
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const sums = Object.fromEntries(entries.map(({ name, data }) => [name, hash(data)]));
  entries.push({ name: 'SHA256SUMS.json', data: Buffer.from(JSON.stringify(sums, null, 2) + '\n') });
  await rm(outputDirectory, { recursive: true, force: true });
  for (const { name, data } of entries) {
    const filename = resolve(outputDirectory, name);
    await mkdir(dirname(filename), { recursive: true });
    await writeFile(filename, data);
  }
}
