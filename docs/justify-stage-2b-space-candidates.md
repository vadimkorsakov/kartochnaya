# Justify Stage 2B: bounded source-space CSS candidates

Historical CSS-only phase at `7bcf6f2`: no shared CSS-only winner.
Current continuation: [D + narrow pointer adapter](justify-stage-2b-pointer-adapter.md).
The active CI qualifier evaluates that adapter; E/F measurements below are preserved.

Continuation of Draft PR #140 / issue #139, based on `c7c0d07`. The established
left/native shaping baseline is reused, not reinvestigated. Production justify
WYSIWYG remains disabled. This phase changes only the experiment, its report and
CI qualification; no editor/painter/history/Selection system is replaced.

## Candidates and scope

The existing fixture, 170×600 frame, Arial 24px, source text, sparse rich runs,
soft wraps, LF and Unicode are preserved. A-left, B-left-split, C-unfixed and
D-word-spacing remain controls. There are exactly two new CSS variants:

* **E-letter-spacing:** on a span containing exactly one source U+0020, use
  `baseTracking + targetAdvance - naturalAdvance` as CSS letter-spacing.
  `naturalAdvance` is measured with the part's actual font, normal kerning and
  **existing user tracking**; `targetAdvance` is `part.width` from the shared
  justified layout. Following-margin accounting uses that target advance.
* **F-explicit-width:** retain the production span's `display:inline-block` and
  set its CSS width to `part.width`, with the same following-margin accounting.
  No text-node replacement, NBSP, zero-width character, noneditable span or
  Selection adapter is added.

D keeps its prior word-spacing formula. All CSS modifications are test-only
module routes guarded by fixture metadata. Canonical layer/run tracking is never
replaced with the computed CSS compensation. The route affects only a one-space
part, never the letters in `To`/`AVATAR`, tabs, LF, emoji or combining sequences.

The gate measures the **actual collapsed DOM Range** on each side of each source
space after applying CSS. It does not assume a CSS declaration produces the
intended native width. Source text/runs and tracking are snapshotted before
session projection; actual input also checks expected shifted sparse runs by
semantic object equality, not JSON property order.

## Tests and actual user actions

1. A single-space pilot measures B/D/E/F at original `[6,7)` and sends real mouse
   clicks at 0%, 20%, 30%, **40%**, 45%, 50%, 55%, 60%, 70%, 80%, 100%. It records
   native endpoints, click coordinates, selected source offset, and distances to
   both native endpoints. Exact midpoint ties may choose either adjacent offset;
   all other fractions require the specified source side.
2. The full addressed matrix runs all A–F in plain and rich. Every eligible
   interior space (including three consecutive spaces) gets the same 11 clicks.
   The original 91 Home/End/Up/Down probes per variant/fixture remain.
3. Four independent real pointer drags select `[6,9)` in both directions and
   `[6,21)` across the soft wrap in both directions, including the emoji and
   combining text. Existing selections are cleared by a real click before each
   gesture so this exercises selection, not native text drag/drop.
4. B/D/E/F each undergo five independent real-click editing cases: Right/Left
   after the 40% click, typing X after left/right clicks, Backspace at the left
   boundary, Delete at the left boundary. Each action starts from a fresh fixture.
   Source text, desired caret offset, native Selection, clean DOM/model agreement,
   sparse run shifts/styles and canonical tracking are checked.
5. Additional first-space/editing cases use existing layer tracking **−0.5** and
   **+1.25**, with the same rich runs. These are data cases, not more CSS variants.

Initial narrow Chromium pilot: E matches target native width and all 11 clicks;
F expands only the box, leaving its native Range at 6.65625px versus a target
18.729167px, with four bad clicks. F still runs through the complete matrix so
its rejection also includes actual input and offsets, not merely visual boxes.

## Local Chromium evidence

Debian Chromium 154.0.8037.57. Corrected addressed gate: **4 passed**. One earlier
full attempt compared rich style objects by JSON key order; after demonstrating
identical values and ranges, that harness comparison was changed to
`isDeepStrictEqual` and only the addressed gate was rerun. No geometry threshold,
source-offset expectation, unit/build command or full local Playwright matrix
was changed/run to obtain this result.

[Compact local measurements, including the exact pilot coordinates/distances](justify-stage-2b-css-candidates-chromium.json).
Each row below aggregates the plain/rich matrix, the two tracking cases and the
single-space pilot: 165 clicks, 8 drags and 20 editing cases per B/D/E/F.

| Chromium | Max added geometry vs B, px | Max native space-width error, px | Click errors | Drag errors | Editing errors | Exact target UTF-16 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| B-left-split | 0 | 1.312500 | 2/165 | 0/8 | 0/20 | yes |
| D-word-spacing | 0.019531 | 0.014445 | 0/165 | 0/8 | 0/20 | yes |
| E-letter-spacing | 0.019531 | 0.014445 | 0/165 | 0/8 | 0/20 | yes |
| F-explicit-width | 45.398438 | 13.312500 | 47/165 | 0/8 | 16/20 | no |

E preserves both rich styles and canonical tracking in every input case; all 182
of its ordinary keyboard probes pass. After subtracting measured DOM fragment
origins, E's local caret-shaping difference from B is **0**. Maximum following-word
origin difference from B is **0.019531px**, including nonzero tracking.

B's two midpoint-side mismatches are inherited natural shaping around `[14,15)`;
they are recorded separately. They do not excuse any new candidate mismatch at
the expanded first space. B is a structural control, not a candidate expected to
force native prefixes into standalone logical space widths.

F does not add DOM characters or lose sparse styles, but it fails native source
position selection and input. “No” in its target UTF-16 column means incorrect
chosen offsets, not malformed Unicode. Its largest extra error occurs with
positive tracking/soft-wrap geometry; raw row/offset/error evidence is retained.

## Geometry and qualification contract

The established shared layout/native shaping contract remains intact:

* No absolute 0.1px equality to Canvas prefixes is imposed inside shaped words.
* Every candidate is paired with B at the same row, source offset, fragment and
  style. Both native sides of a source boundary are measured.
* Translation-normalized native shape agreement and the actual native
  single-space advance must agree within **2/60 CSS px**, from two rounded
  coordinates on Gecko's 1/60 grid (Chromium uses 1/64).
* Global extra-error and word-origin checks retain the existing bound derived
  from preceding CSS margin/native span-width rounding, not arbitrary pixels.
* All required clicks, drags, editing, row affinity, original source text/runs,
  user tracking, and absence of added DOM text must pass. Failing variants remain
  measured; they are not marked expected-failure or skipped.
* A candidate qualifies only if it passes plain, rich and both tracking cases
  **in both Chromium and Firefox**. `scripts/justify-css-summary.cjs` computes
  this intersection from real Playwright results and writes JSON/Markdown CI
  artifacts. Chromium-only results deliberately do not qualify cross-browser.

Canvas/PNG max channel delta <=1 and live-ink <=2 remain untouched. Production
paint code, PNG baselines and IME/mobile/effect eligibility gates are unchanged.

## Firefox CI verdict and stop rule

The local Firefox executable is absent and was not reinstalled. One meaningful
commit triggers the existing GitHub Actions run. The addressed experiment runs
first; full actual measurements, an aggregate B/D/E/F table and the shared winner
(or NONE) are uploaded as `justify-stage-2b-caret-gate`. The final CI verdict and
artifact link are added to the **existing Draft PR body**, without an empty
rerun commit. This document's local E result is not a premature Firefox pass.

At an early gate stop, the old spike-summary step now runs only if its input
exists, preventing a secondary missing-file error from obscuring the CSS verdict.

If neither E nor F qualifies in both browsers, stop with the first-space native
endpoints, pointer coordinates/distances and wrong source offsets. The only
proposed next phase is a bounded adapter for pointer-origin/caret placement
**inside expanded U+0020 spans only**, using existing session Selection APIs and
leaving normal text and native drag Selection in place. It is not implemented
here and requires its own click/drag/Shift/recovery validation; replacing native
Selection wholesale is out of scope.

## Minimal production integration plan if E qualifies

1. Introduce the one-space CSS advance compensation in existing session
   `project()`, after font/tracking measurement and before committing DOM. Reuse
   the shared part advance and the current rendering/layout engine; recompute
   after edits/font/tracking/wrap changes rather than storing a constant.
2. Account for the same target width in the following fragment margin. Preserve
   original source text nodes, run styles, row affinity, native Selection,
   history/recovery and the common Canvas ink overlay.
3. Port the winning real-pointer/input/negative-tracking checks to the shipping
   projection before separately wiring justify eligibility, mixed layout,
   inline history, range-formatting guards and live alignment behavior.
4. Run the required Stage 2B integration/export/history checks with the original
   pixel tolerances and existing unsupported-mode/IME restrictions before making
   justify WYSIWYG available. This experiment does not perform that wiring.

Draft PR #140 remains open; issue #139 is not closed. No merge, production deploy
or production WYSIWYG enablement is performed in this diagnostic phase.
