# Justify Stage 2B: left controls and native interaction

Issue #139; existing draft PR #140; branch `fix/139-justify-wysiwyg`.
Control experiment based on `4449e2f`.

**The earlier requirement for absolute native caret / Canvas prefix equality at
0.1 px was not a valid justify-specific gate.** The production left control also
has a 2.660156 px difference inside `To`. With identical DOM fragmentation, the
CSS space correction adds only 0.003906 px of absolute error in local Chromium.
All candidate mouse clicks and forward/backward drags pass. These measurements
do not establish a need to rebuild contenteditable.

Justify WYSIWYG remains disabled. No editor, painter, history, recovery, document
schema, PNG baseline or Canvas/PNG pixel tolerance changes are made. This is a
diagnostic experiment; #139 is not resolved.

## Four controlled projections

All four preserve the prior fixture exactly: Arial 24px, width 170px, height
600px, lineHeight 1.2, source text and optional sparse runs:

```text
AVATAR   To WA 😀 é alpha beta gamma
AV To

Z
```

Rich runs: `[1,2)` color/opacity, `[12,14)` bold/tracking. Source includes repeated
spaces, soft wraps, explicit LF, an empty row, a surrogate pair and combining text.

* **A-left:** production `engine.layout()` and unchanged production DOM fragments.
* **B-left-split:** `layoutJustified()` with the **extra-per-space calculation
  disabled in a test-only module route**. This retains exactly C/D's source
  fragments, styles, wrapping and natural coordinates, without justification.
* **C-justify:** shared justified layout and original production DOM projection.
* **D-justify-space-fix:** C plus the previously investigated test-only CSS
  `word-spacing = part.width - native measureText(part.text).width` for each
  source-space span; subsequent margin accounting uses that space's logical width.

The ordinary left `layout()` does **not** return `row.carets`. For A only, the
harness adds diagnostic Canvas-prefix references using the same prefix formula
as `layoutJustified()`, while preserving all production fragments/positions.
B/C/D measure the engine's actual `row.carets`. The report marks this distinction;
A's diagnostic prefixes must not be described as a shipped natural-layout API.

Both routed source edits are guarded by test metadata, not applied to shipping
files. The CSS candidate deliberately retains its earlier behavior, including
natural contextual space-width compensation on unstretched rows.

## Local Chromium comparison

Browser: Debian Chromium 154.0.8037.57, scale 1. Units: CSS px.
[Compact evidence](justify-stage-2b-control-measurements.json) stores examples,
source offsets, mismatches and paired deltas. Full measurements remain Playwright
attachments. The [initial report's raw data](justify-stage-2b-gate-measurements.json)
is retained as historical evidence, not as the current acceptance contract.

“Absolute” includes collapsed Range positions on **both DOM sides** of fragment
boundaries, so that setting Selection at the next word cannot hide a space gap.
“Extra vs B” is `max(0, |candidate error| - |B error|)` at paired source offsets,
rows and (for fragment endpoints) identical source fragments. A and B's structural
differences are reported separately; they are not attributed to stretching.

| Projection | Runs | Max absolute | Extra vs A | Extra vs B | Space endpoint error | Click mismatches / 30 | Drag errors / 4 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A left | plain | 2.660156 | 0 | 1.320313 | 1.332031 | 1 | 0 |
| B left split | plain | 2.222656 | 0.429688 | 0 | 1.324219 | 1 | 0 |
| C justify | plain | 12.085938 | 0.429688* | 12.082031 | 12.085938 | 6 | 0 |
| D corrected | plain | 2.222656 | 0.429688* | 0.003906 | 0.048299 | 0 | 0 |
| A left | rich | 2.660156 | 0 | 0.453125 | 0.417969 | 0 | 0 |
| B left split | rich | 2.222656 | 0.429688 | 0 | 0.039429 | 0 | 0 |
| C justify | rich | 11.476563 | 0.429688* | 11.457031 | 11.476563 | 6 | 0 |
| D corrected | rich | 2.222656 | 0.429688* | 0.003906 | 0.033976 | 0 | 0 |

\* A has no individual space fragments, so A/C and A/D endpoint pairing covers
only fragments with matching source intervals; it cannot reveal the internal
space-end gap. B/C and B/D are the complete structural comparisons. The 0.429688
increase vs A occurs at offset 43, the visible end before LF in `AV To`, and also
exists in B with **no stretching**. It must not be called new justify error.

The full maximum **signed error change** D−B is 1.313924 px (plain) / 1.777344 px
(rich). This larger number is not hidden: it comes from **reducing** inherited
space-end error through contextual width compensation. The maximum *increase*
in absolute error is only 0.003906 px. Both numbers are in the raw evidence.

For 34 paired nonblank native caret points per rich/plain fixture, subtracting
the measured DOM fragment origin gives **exactly 0** D−B difference. Thus the
residual inside words is native shaping shared by the control, not stretched
space displacement.

The plain A/B click mismatch is a 40%/60%-of-Canvas-space threshold probe at
source space `[14,15)` after `WA`: shaping shifts the native midpoint from the
Canvas-prefix midpoint. It returns an adjacent, valid source boundary, not a
corrupted UTF-16 offset. It remains reported, not skipped. C additionally chooses
the wrong boundary near the first half of every expanded space. D has no such
mismatch in either fixture.

## Real pointer and keyboard coverage

No mouse probe calls `setSelection`, `setBaseAndExtent`, `caretPositionFromPoint`
or `caretRangeFromPoint` to choose its source interval. Playwright sends real
pointer events to shared-layout coordinates:

* 30 clicks per variant/fixture: both boundaries, 40%, 50% and 60% of each of six
  eligible spaces, including the three consecutive spaces. Exact midpoint ties
  may choose either adjacent offset; the 40% and 60% probes are strict.
* Four drags: `[6,9)` forward and backward (exactly three spaces), and `[6,21)`
  across a soft wrap forward and backward (including emoji and combining text).
  Anchor/focus direction, source text, row owner, clean session and DOM/model
  agreement are checked, not just the visible highlight.
* Each independent drag first clears the previous range by a real click at
  source offset 0. An initial harness attempt omitted this and could start native
  text drag/drop inside the previous selection; that run was discarded and the
  corrected **addressed gate only** was rerun. It is not evidence of an editor bug.
* Existing 91 Home/End/ArrowUp/ArrowDown probes per variant/fixture are preserved.
  No keyboard or source-row affinity mismatch occurred locally.
* Programmatic Selection round trips cover forward/backward ranges, repeated
  spaces, Unicode and LF; all source UTF-16 offsets are exact. Source text remains
  unchanged and native mouse ranges also match their exact source substrings.

Empty LF-only rows can have no native Range rectangle. Such a missing rectangle
is recorded and only its source offset/owner is asserted; it is not counted as a
zero-pixel measurement. This does not certify the visible empty-line caret.

## Corrected geometry contract

1. Canvas/PNG glyph origins, logical advances and source intervals remain owned
   by the shared engine. Existing max channel delta <=1 and live-ink <=2 are
   unchanged; no PNG baseline is updated.
2. A native caret inside a shaped word need not equal `measureText(prefix)`.
   A measures offset 10 in `To` at x=120.468750 versus prefix x=123.128906
   (−2.660156 px); the same effect is present before LF. Absolute prefix error
   alone is not a new justify defect and does not mandate a contenteditable rewrite.
3. Compare D to B using the same source offset, row affinity, style and DOM
   fragment. After measured fragment translation is removed, native shaping must
   agree within **2/60 CSS px**: two independent rounded native coordinates at
   Gecko's coarser 1/60 grid (Chromium uses 1/64). Observed local difference: 0.
4. Report signed error changes and increases in absolute error separately.
   Global position rounding is bounded per paired point by
   `4 * (preceding fragment count + 1) / 60`: two projections, each with native
   span-width and CSS-margin rounding. The gate also checks the much stricter
   translation-normalized shape contract; this is not an arbitrary multi-pixel
   allowance for caret errors. Observed D-vs-B absolute-error increase: 1/256 px.
5. All real pointer offsets/text/directions and row ownership must be correct.
   Correcting geometric metrics cannot excuse a failed real mouse interaction.
   C's additional mouse/space errors remain the negative control.

## Result and limits

Corrected local Chromium gate: **2 passed** (each test runs all A/B/C/D controls).
D: **60/60 clicks**, **8/8 drags**, **182/182 keyboard probes**, exact UTF-16.
Across all eight control/fixture combinations, keyboard probes total 728.
There were no unit/build reruns for this test-only continuation; only syntax,
diff checks and the addressed browser gate were used. Production code is unchanged.

Firefox executable is absent locally and was not reinstalled. The existing CI
lane runs this same matrix in Chromium and Firefox, now **before** the legacy
long diagnostic suites, and uploads full JSON/trace artifacts. Actual Firefox
results and the final comparative CI table are added to the existing PR body
once that commit's automatic run finishes; no empty rerun commit is needed.

A plausible safe local implementation is to expand source-space spans and account
for their logical width while retaining the shared painter/history/selection
system, validated against the structural left control. This experiment supports
that route in Chromium. It does not yet implement eligibility, range formatting,
alignment switching, recovery or export integration, and does not certify all
fonts/platforms/rotations/IME. Firefox is a separate required browser result.
