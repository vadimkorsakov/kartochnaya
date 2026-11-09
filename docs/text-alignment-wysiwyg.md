# Desktop text alignment WYSIWYG — #131

Based on `origin/main` at `76c34d3`. Horizontal desktop text now opens in the
live editor with left, center or right alignment. Existing inspector buttons
change the whole layer through `applyLayerStyle({textAlign}, {key:'textAlign',
final:true})`, including when a forward/backward range or a collapsed caret is
active. Horizontal buttons bypass the generic formatting fallback and retain
editor focus; the editable host is not replaced.

The shared layout retains `row.x` before assigning fragment coordinates. Empty
LF rows and the final empty row use that same origin for the editable placeholder
and vertical caret navigation. Nonempty fragments continue to use the existing
`x`, baseline and height projection. There is no CSS centering or second wrapping
algorithm. Canvas and PNG painting are unchanged.

Alignment changes preserve font size, auto-fit, textRuns and size reference
metadata. They create confirmed style history steps, so in-session Undo/Redo
restores the layer and UTF-16 selection direction. Settled changes also use the
existing document history. A session returning to its complete original model
remains a no-op on close, as before.

## Browser checks

Linux, Playwright 1.64.1, Chromium 156.0.8078.4 and Firefox 157.0. Targeted tests
are in `tests/text-alignment-wysiwyg.spec.js`; the two-browser config is
`playwright.alignment.config.js`. All 58 cases passed in two complementary runs
(24 input/history/geometry/touch cases and 34 paint/plain/fallback cases).

Coverage includes initial center/right opening; typed input, Delete, Backspace,
Enter, copying/pasting emoji; UTF-16 forward/backward ranges; all three alignment
transitions and Undo/Redo; continued typing; unchanged mixed runs; no fabricated
runs for plain text; auto-fit on/off; LF and empty rows; soft wraps; mixed font
families, sizes and tracking; Home/End on each visual row; widths 0.05 px below
and above the independently measured wrap boundary.

Measured DOM fragment boxes and independently probed inline baselines were
compared with actual shipping Canvas draw calls. PNG export produced the same
text draw calls and coordinates. Maximum absolute errors, in document pixels:

| Browser | X | Fragment width | Baseline |
| --- | ---: | ---: | ---: |
| Chromium | 0.025391 | 0.018279 | 0.015625 |
| Firefox | 0.008414 | 0.000341 | 0.000039 |

Geometry assertions retain the strict 0.25 px bound; native nonempty row
Home/End caret positions retain a 0.75 px bound. Empty rows are checked by their
positioned fragment boxes and source selection; Gecko can omit empty Range
rectangles.

Real raster comparisons cover center/right × solid/dashed/dotted with mixed
Georgia/Arial, bold/italic, underline/strikethrough, fill opacity, stroke width
and stroke opacity. These paint cases activate the existing Canvas ink overlay.
The live overlay is composited over the document background and compared with
the actual exported PNG, alongside the closed display Canvas. Native DOM-only
text is checked geometrically above; this does not claim identical browser DOM
and Canvas antialiasing.

| Browser | Canvas ↔ PNG max channel difference | Live overlay ↔ PNG max | Pixels over 2 |
| --- | ---: | ---: | ---: |
| Chromium | 0 | 2 | 0 |
| Firefox | 0 | 2 | 0 |

Across the six paint cases, differing live pixels range from 298–404 in Chromium
and 322–429 in Firefox, with the channel bounds above. The existing raster limits
remain Canvas ≤1 and overlay ≤2; no reference PNG was changed. JSON measurements,
actual editor screenshots and live/export PNGs are attached by the tests.
The GitHub workflow runs the two-browser alignment config and retains its
measurement artifacts.

## Regression and build results

- 23 existing Chromium scenarios passed across the targeted regression run and
  the updated plain-justify case: eligibility/opt-out, LF, near-width layout,
  Canvas/PNG alignment and selected-text tracking with auto-fit on/off.
- 3 existing Firefox scenarios passed: input/history/persistence, UTF-16 emoji
  and backward selection with font/size controls.
- `npm run test:unit`: 610 passed.
- `npm run test:source`: 17 passed.
- `npm run build`, `npm run build:verify`, `git diff --check`: passed.

Reproduce the focused alignment suite with
`npx playwright test --config=playwright.alignment.config.js`.
The full Playwright matrix is left to GitHub Actions.

## Scope

Justify, vertical/path text, rotation, vertical middle/bottom, masks, effects,
unsupported blend modes and mobile/coarse-pointer editing retain fallback.
`?experimentalTextWysiwyg=0` still forces textarea. The range stroke mechanism
is unchanged. Green Linux tests do not resolve the Firefox Windows issue #129.

Cloud Firefox required execution outside the agent sandbox: within the sandbox
it exited with “Could not find profile folder”. Proxy variables and TLS settings
were preserved. No merge or production deployment is part of this change.
