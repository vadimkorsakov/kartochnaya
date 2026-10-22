# Offline preparation failure / investigation after PR #15

Base: `main` at `bed43f0010cf7eaab0c4147c43d361ba0a8d0798`.

## Evidence and remaining blocker

Production could not be downloaded from this environment: the HTTPS proxy rejects
`https://kartochnaya.netlify.app/index.html` with `CONNECT tunnel failed, response 403`.
That is a proxy denial, not an HTTP response from Netlify. No production HTML bytes
were obtained, so neither its first difference nor the source of the modification
is established. Pretty URLs, minification, Forms, analytics and injected snippets
are **not diagnosed** by this PR. No speculative hosting configuration is changed.
The root cause of the HTML mismatch remains open.

To compare bytes from a network with production access, use the artifact from the
**same deployed commit** (a newer build has different inline PWA code):

```sh
mkdir -p work
curl --fail --compressed --max-time 30 -D work/production.headers \
  -o work/production.html https://kartochnaya.netlify.app/index.html
node scripts/compare-netlify-html.mjs dist/netlify/index.html work/production.html
```

The script reports the first different byte (zero based), both lengths, and local
hex/UTF-8 context. Preserve headers and the body. Do not infer the cause merely
from different hashes; inspect the inserted, removed or rewritten bytes first.

## Confirmed runtime defect and fix

`navigator.serviceWorker.ready` never rejects when first installation fails.
The existing statechange handler had no failure branch and no deadline. Thus an
HTML SHA-256 failure can remove the candidate cache/registration while leaving the
initial “Подготовка…” label forever.

Preparation now watches registration/worker state with cleanup, rejects redundant
workers, and limits registration, update checks and activation waiting to 30
seconds per stage. The existing status message exchange retains its 10 second
deadline. Errors expose “Повторить подготовку”; duplicate clicks are guarded.
Retry registers/checks the worker again without reloading or deleting caches or
registrations. Activation of a waiting update still requires the existing save
barrier and explicit “Обновить” action.

All resource SHA-256 checks, candidate cache cleanup, old cache retention, and
offline fetch handling are unchanged. No changes to IndexedDB, projects,
autosave, ZIP backups or historical HTML/PWA distributions.

## Regression coverage

- Initial HTML altered after hash generation: installation fails visibly, the
  retry succeeds after restoring bytes, an unrelated cache survives, and an
  offline reload works. This simulates mutation; it does **not** identify the
  production transformation.
- A registration promise that never resolves reaches the deadline and offers retry.
- Unit cases: redundant install, stalled install, active/waiting worker, late
  updatefound and activation.
- Existing Netlify suite covers exact bytes/hashes, verified precache, offline
  editing, persistence/export/import, controlled updates and failed update safety.

Firefox binary installation was attempted but all Playwright download endpoints
were denied by the network proxy with 403. Firefox runtime behavior and actual
production behavior after a future deploy must still be verified. This PR should
remain draft until the production byte comparison and hosting fix are completed.

Final regression run: **7/7 Chromium Netlify tests passed** (34.8 seconds),
**4/4 runtime unit cases passed**. `build:verify` verified all 19 historical release
files and current HTML/ZIP packaging. `verify-reproducible.mjs` confirmed identical
independent HTML, ZIP and Netlify checksum-manifest builds. The unchanged standalone
HTML SHA-256 is `1a22c29f6a76b5cf490b3f0fbaef200f09eadda96255d769d04e2dabef26eecf`;
the unchanged PWA ZIP SHA-256 is
`095e962ca44b990bca7ad5714dc86dfcee8505700545ab06f233c7a34e822cac`.
