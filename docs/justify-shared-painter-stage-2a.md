# Justify stage 2A: shared display painter

Base: `f3439bd` (main after PR #136). Compatibility was reviewed against
[the stage-1 report](justify-layout-stage-1.md). This stage deliberately adopts
the new semantics for every ordinary horizontal justify layer, including saved
layers. There is no legacy mode, document migration or JSON schema change.

## Rendering and geometry

`supportsHorizontalTextLayout()` now includes justify. `mixedTextLayout()` selects
`layoutJustified()` for it, including font preview. Both `drawTextGlyphs()` and its
late mobile wrapper reach the existing `paintHorizontalTextPass()`. The old active
word splitting and independent gap calculation are removed. The painter itself
is unchanged: editor Canvas, PNG, fills, per-range strokes, dashed/dotted patterns,
opacity and decoration rectangles consume the same prepared fragments. Specialized
arc/path/vertical/boundary geometry is unchanged.

The shared effect-backdrop measurement now receives justified fragment positions;
its whitespace filter excludes hanging trailing spaces from the visible band.
Auto-fit and fit-to-content intentionally measure the engine's natural rows,
not the projected `row.width`. The latter includes retained source spaces after
the last word, and can exceed the frame without visible overflow. Targeted tests
execute the actual application fitting and backdrop functions with real Canvas
metrics. Justify and left produce the same fitted size and content box across
15 text/tracking combinations, including cases with hanging source spaces.

A small stage-1 projection error was isolated: it replaced corrected glyph origins
with logical advances at stroke/opacity boundaries. With 32px serif `AV`, V moved
from x=18.984375 to x=23.109375 (4.125px). The projection now preserves both values
separately, as shared layout already does. Native `AV`/`fi` and synthetic metric
tests cover this; no stroke, WYSIWYG or shaping-system refactor was needed.

## Visible compatibility changes

- Only eligible soft-wrapped rows expand; the last row of **each paragraph**, even
  before LF or blank rows, keeps its natural width.
- Repeated spaces retain their characters and individual advances. Interior
  U+0020 spaces expand equally. Leading/trailing whitespace, tabs and NBSP are
  retained without receiving added advance.
- Shared grapheme wrapping, contextual measurements and native tracking replace
  CSS-probed rows, independent word measurements and manual UTF-16 tracking.
  Existing words can move and some widths/fonts can wrap differently.
- Saved range families, sizes, weight/style, leading/tracking, colors, fill/stroke
  opacity, stroke patterns and decorations now appear through the shared painter;
  the old justify override ignored them. Source text and `textRuns` are unchanged.

The stage-1 legacy comparison remains reproducible using the exact former late
override frozen in `tests/fixtures/justify-stage-1-override.txt`, never imported by
the application. In local Chromium 154 / Arial 20px, paragraph `AA BB\nCC DD` at
200px moves BB from x=173.3203125 to x=31.1328125 (142.1875px). Repeated spaces in
`AA   BB CC` move BB by 10.009765625px. These are accepted compatibility changes,
not new pixel thresholds.

## Editing and validation

`eligibleWysiwyg()` explicitly returns false for justify independently of painter
eligibility. Editing still uses the existing textarea. Closing it restores shared
Canvas rendering. Mobile input and keyboard handlers are unchanged.

`playwright.justify.config.js` runs the saved-layer compatibility checks and new
painter checks in Chromium and Firefox. The existing Actions diagnostics job runs
both and uploads JSON, PNG and screenshot measurements. Coverage includes actual
fill/stroke calls and style state, decoration geometry, Canvas backing pixels vs
PNG, reload/persistence, textarea, document Undo/Redo, zoom/mobile export, Unicode,
paragraph/blank/CRLF cases, negative/positive tracking, boundary wrapping, fitting
and measured backdrop bounds. Existing pixel parity remains max channel delta
<=1 for Canvas/PNG; PNG baselines and WYSIWYG tolerances are untouched.

Local results:

- Plain and mixed-range Canvas/PNG: maximum channel delta **0**, changed channels
  **0**, before and after reopening. Plain has 26 glyph calls; mixed has 28
  fill/stroke calls, including dashed/dotted strokes with .35/.60 opacity.
- Closing textarea and undo/redo: Canvas/PNG delta **0**, 11 glyph calls; the same
  document-space calls survive zoom and mobile viewport/export.
- All eight targeted justify cases pass (seven in the suite run, then the backdrop
  case after adjusting its fixture to actually contain hanging spaces).
- Existing alignment/WYSIWYG regressions: 14 passed, including all nine
  left/center/right × top/middle/bottom pixel checks, mixed tracking, textarea
  fallback, mobile eligibility and live history. Canvas/PNG max delta 0; WYSIWYG
  max delta 2 with no channels above the existing tolerance.
- Unit: 615 passed. Source: 17 passed. Build, build verification and diff checks pass.
- Firefox launch was attempted once; its Playwright executable `firefox-1555` is
  absent locally. No browser reinstall was attempted. Firefox results remain CI's
  responsibility; a local Firefox pass is not claimed.

## Remaining scope

Live justify WYSIWYG, caret/hit-testing projection and selection/history integration
are stage 2B. The textarea continues to use its existing preview behavior. Existing
paint boundaries may decompose ligatures exactly as the shared painter already
allows; this change does not redesign cross-style shaping. Firefox Windows #129
is untouched. Local tests do not certify every OS/font backend or replace the
full GitHub Actions browser matrix. No merge or production deployment is performed.
