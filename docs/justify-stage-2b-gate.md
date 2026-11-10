# Justify Stage 2B: geometry gate stopped

Issue: #139. Base: `7022d89` (main after merge of #138).

Stage 2B is **not implemented**. This draft records the mandatory stop gate:
feeding `layoutJustified()` into the existing contenteditable projection does
not give consistent native caret geometry. No shipping code, eligibility gate,
history, recovery, PNG baseline, or pixel tolerance is changed.

## Reproduce

```sh
npm ci
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  npx playwright test --config=playwright.justify-gate.config.js --project=gate-chromium
npx playwright test --config=playwright.justify-gate.config.js --project=gate-firefox
```

Use the environment's existing Chromium executable path if different. The gate
has no build/server dependency. It routes the real source modules into an
isolated browser page and creates the production `createWysiwygSession()` with
production inline history and `layoutJustified()` from a real Canvas context.
The normal application still correctly rejects justify WYSIWYG; the harness
bypasses only that eligibility entry point to test the proposed projection.

The four cases are plain/rich text, each with shipping projection and a bounded
**test-only** spacing candidate. The candidate sets each source-space span's
`word-spacing` to its shared-layout width minus its native width and adjusts the
following margin accounting. It adds no characters, no custom painter and no
replacement text engine. This source transformation is not shipped.

Fixture: Arial 24 px, frame width 170 px, lineHeight 1.2, source:

```text
AVATAR   To WA 😀 é alpha beta gamma
AV To

Z
```

The rich fixture colors/changes opacity of UTF-16 `[1,2)` and applies bold and
tracking to `[12,14)`. The source includes three consecutive spaces, surrogate
pairs, a combining sequence, soft wraps, explicit LF and an empty row.

## Measured result

Local browser: Debian Chromium **154.0.8037.57**; scale 1. All values below are
CSS px. [Compact raw evidence](justify-stage-2b-gate-measurements.json) includes
source offsets, expected/actual positions and Selection round trips. Full row,
fragment, native Range and keyboard measurements are Playwright JSON attachments.

| Projection | Runs | Max word-origin delta | Max native caret delta | Max fragment-endpoint delta |
| --- | --- | ---: | ---: | ---: |
| shipping | plain | 0.035157 | 2.250000 | 12.085938 |
| shipping | rich | 0.035157 | 2.234375 | 11.476563 |
| spacing candidate | plain | 0.050782 | 2.222657 | 0.453125 |
| spacing candidate | rich | 0.039063 | 2.222657 | 1.781250 |

The diagnostic geometry assertion is 0.1 px, larger than the observed subpixel
origin rounding; this is a new caret assertion, not a change to PNG tolerances.

Decisive examples:

* Plain first stretched space has source offset `[6,7)`. Shared-layout caret
  after it is x=107.627604; a real DOM Selection collapsed at the **end of that
  space's own text node** is x=95.562500 (delta -12.065104). Collapsing at the
  next span's start represents the same source offset but hides this gap.
  Measuring only word positions or only `session.setSelection()` misses it.
* The spacing candidate moves that endpoint to x=107.625000, delta -0.002604.
  Across the first three stretched spaces, candidate endpoint error is at most
  0.023438. This demonstrates that source-space expansion itself has a local fix.
* In plain `To`, offset 10 (between T and o), shared `row.carets` gives
  x=159.312500; the shipping native collapsed Range gives x=157.062500. With
  the spacing candidate it gives x=157.109375. Fixing spaces therefore does
  not reconcile contextual kerning inside text spans.
* With rich runs, the spacing candidate still leaves a fragment-endpoint delta
  of 1.781250. Paint/style boundaries need the same caret contract as word interiors.

For each of the four cases, 91 Home/End/ArrowUp/ArrowDown keyboard probes agree
with the canonical target offsets and Home/End row ownership. Independent
vertical probes reset sticky desired-X through the existing pointerdown handler.
This fixture did not reproduce a vertical navigation offset failure.

Forward/backward selections `[0,6)`, the three spaces `[6,9)`, and a multirow
selection round-trip through real `window.getSelection()` and
`session.readSelection()` with exact original UTF-16 offsets and source text,
including emoji, combining text and LF. Each canonical caret is also checked
against its owning DOM row, covering duplicated soft-wrap offsets and hard LF.
Chromium can omit a collapsed Range rectangle for an empty LF-only row; its
source offset and row ownership are checked, but missing rectangles are **not**
counted as geometric success. Native mouse hit-testing/drag selection and the
visible empty-line caret remain unproven.

## Why stop here

`project()` positions independently shaped native spans at shared glyph origins.
`layoutJustified().carets` uses contextual Canvas prefix advances, while native
caret positions also reflect shaping with following letters. Fragment natural
width, shared logical width and ink origin can also differ at rich boundaries.
Increasing whitespace width reconciles neither of these contracts.

A safe next phase must decide and test one shared contract for caret positions,
contextual shaping across formatting boundaries and affinity. Arbitrarily
splitting every grapheme into a positioned span would change shaping, native
selection and hit-testing; compensating with a new caret/selection renderer is
a substantial contenteditable change, beyond the minimal Stage 2B connection.
The evidence does not prove a rewrite is the only possible solution. It proves
that the simple space-width projection is insufficient; enabling justify now
would fail the requested gate. No unbounded refactor was attempted.

The necessary entry points were reviewed: `mixedTextLayout()`,
`supportsWysiwygProjection()`, `startInlineWysiwyg()`, session `project()`,
`readSelection()`, ArrowUp/ArrowDown and `styleInlineSelection()`. The established
eligibility/fallback root cause was not re-investigated.

## Validation and limits

* `npm run test:unit`: 615 passed.
* `npm run test:source`: 17 passed.
* `npm run build`: passed.
* `npm run build:verify`: passed, including 19 unchanged release files.
* Local Chromium gate: four cases failed the native geometry assertions, as
  documented above. They are not marked expected-failure, skipped or weakened.
* Firefox was attempted locally but could not launch: the configured
  `.cache/ms-playwright/firefox-1555/firefox/firefox` executable is absent.
  It was not installed again. The existing GitHub Actions diagnostics lane
  installs Firefox and now runs this exact gate in both browsers, preserving
  results even if earlier diagnostics fail.

The experiment lives under `tests/experiments/`, excluded from the normal
application matrix and explicitly included by its own config. Its CI step has
no `continue-on-error`: a red result must keep this draft blocked.

Range formatting, alignment switching, input/clipboard/history/persistence,
auto-fit ON/OFF and Canvas↔PNG/live-ink↔PNG regressions for an enabled justify
session were **not** run because the prerequisite failed. This is not a claim
that Stage 2B or the issue is resolved. Existing PNG baselines and ≤1/≤2 channel
tolerances are unchanged. Merge and production deployment are not performed.
