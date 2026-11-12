# Justify Stage 2B: eligible-space pointer adapter prototype

Existing Draft PR #140, issue #139; base `7bcf6f2`. Previous CSS-only D/E/F
results are retained in their reports, raw data and the base commit. They are
not rerun here. Production justify eligibility remains disabled.

## Scope and implementation boundary

The prototype is a **test-only fixture injected inside the existing
`createWysiwygSession()` closure** by a Playwright module route. No `src/` file
changes. Diagnostic options are session constructor options, not document fields;
the current fixture creates no `__gate*` model properties. The B no-stretch
control is a routed function argument, also not a model flag.

D's established source-space `word-spacing` compensation supplies geometry.
The adapter reuses `layout(layer).rows`, `row.justification.spaces`, `row.carets`,
original U+0020 UTF-16 offsets and the existing `setSelection()`/DOM-point mapping.
It never calculates independent text positions, inserts service characters,
replaces text runs, records history or paints a caret/selection itself.

Only a primary trusted mouse gesture inside an **actually expanded U+0020** can
be corrected. Coordinate conversion uses the real host bounding rectangle and
computed CSS width/height, including transform/zoom. Rotation/skew or nonpositive
scale is rejected. The midpoint of the two shared caret advances selects `start`
or `start+1`; source row affinity is passed to `setSelection()`.

Outside these intervals, including ordinary words, hanging/trailing spaces,
spaces in terminal/pre-LF rows and left/center/right, Selection is native.
The adapter does not prevent default, stop propagation, capture the pointer or
intercept native drag/drop. There is no own range model.

## Event ordering, one post-native task and invalidation

The trace disproved the initial synchronous-click assumption: with an existing
range, Chromium can still report the OLD Selection at `pointerup`, click capture
and click bubble; native placement happens afterward, before Selectionchange.
The initial synchronous draft was therefore replaced before publication.

The prototype uses this explicit sequence:

1. `pointerdown`: validate eligible source interval; save epoch/key, coordinates,
   pointer id and (for Shift) original native anchor. No Selection write.
2. Document `pointerup`: only mark the same stationary host gesture completed.
   No Selection write and no unconditional pointerup correction.
3. Trusted host `click`, detail 1: confirm the stationary eligible click and queue
   **one cancellable zero-delay task**. Do not assume native Selection is final
   inside this event. A trusted post-click Selectionchange may consume the same
   token earlier, after native placement.
4. The task or Selectionchange handler rechecks model/rows/host rect, clean phase,
   source interval, focus, composition and epoch, then calls existing
   `setSelection()` once if correction is needed. Token identity makes later
   duplicate/cancelled callbacks inert. Existing correct positions are unchanged.
5. The guard installed **before existing host keydown/beforeinput handlers**
   consumes a completed-click token synchronously if user input wins task
   scheduling. Input while the mouse is still down cancels it instead. Composing
   input/key 229 cancels it. Thus the next real input cannot use the wrong source
   boundary just because notifications or the zero-delay task were delayed.

The pilot asserts `pointerup < click capture < click bubble < correction/input`,
settled source position, and the caret seen before actual X insertion. Immediate
read-only telemetry may observe the pre-task native position; that observation
is not mislabelled a confirmed adapted result. Matrix clicks wait for the bounded
pending token to drain, then check source positions; input probes deliberately
send keys without this wait.

The race test deliberately withholds both Selectionchange delivery and the
scheduled task, types real X, then releases cancelled callbacks after focus moves
to another input. It also releases the newest callback before an obsolete one for
rapid left/right clicks. These are fault-injection tests of scheduling, not a
production Selectionchange blocker. No stale caret or focus restoration is allowed.

Any pointer movement **during the gesture** cancels the candidate, conservatively
protecting drag-selection. Post-click hover movement does not undo a completed
click. Native dragstart, pointercancel, focusout/window blur, composition, project,
recovery, preserve and dispose cancel the token and its task. Text/style/layout/
host-rect changes are rechecked before application, including callbacks already
queued when cancellation happened. There is no deferred work without an eligible
completed mouse click.

Shift keeps the original anchor source offset and original connected native DOM
point. Existing `setSelection(anchor, focus, row)` sets the confirmed source focus;
then the native anchor point is retained via native Selection. This prevents the
existing mapper from moving an upstream soft-wrap anchor to a downstream leaf.
Saved source selection/history semantics are unchanged; detached anchors cancel.
Word double-clicks are untouched; native selected-text drag/drop is disarmed by
movement/dragstart and compared with baseline D rather than reimplemented.

## Addressed tests

* Initial Chromium first-space pilot: original `AVATAR   To WA`, Arial 24px,
  frame 170px, `[6,7)`, click at 40%, offset 6, then immediate X at position 6.
* Main matrix: plain/rich × tracking −0.5/0/+1.25 × zoom 60/100/150%, for B, D,
  D+adapter; C-unfixed remains a measured negative control at tracking 0/zoom 100.
  All eligible spaces receive 20/30/40/45/50/55/60/70/80% clicks, including each
  of three adjacent spaces and the first/last eligible space of each row.
* **Actual native `MouseEvent.clientX/Y`** are recorded, separately from requested
  Playwright coordinates. Expected side uses that actual point and shared source
  interval; quantized browser coordinates are not misreported as adapter errors.
  Points outside the interval are classified separately and not corrected.
* Unstretched/trailing/pre-LF spaces and words are real-click controls. D+adapter
  must match D's native Selection there, with zero correction calls.
* Real forward/backward `[6,9)` and `[6,21)` drags cover source spaces, soft wrap,
  surrogate/combining text and source row affinity. No drag can trigger click correction.
* Five independent real-click editing probes per data case: Right/Left, X at the
  left/right side, Backspace, Delete. Source text, exact desired UTF-16 caret,
  clean DOM/model, shifted rich runs and unchanged user tracking are checked.
* Shift forward/backward across rows and an **upstream soft-wrap native anchor**
  check source offsets, original DOM anchor identity, direction and actual Ctrl+C
  handler payload. Double-click and selected-text native drag/drop are compared
  with D at all three zooms and both rich/plain fixtures.
* Pointercancel, blur, composition, layout change, host-transform change and
  input while pointer is still down test invalidation against D. Pointercancel/
  composition events in these lifecycle probes are deliberately synthetic;
  pointer and keyboard actions themselves are real browser actions. This does
  not claim real OS IME support.
* Native left/center/right sessions with the diagnostic adapter option enabled
  must retain exactly their baseline behavior and show zero corrections.

The geometry contract is unchanged: ordinary native-vs-prefix kerning differences
are not justify defects; local shape/space advance uses the established 2/60 CSS
px rounding bound and global rounding is paired against B. Canvas/PNG <=1,
live-ink <=2 and PNG baselines are not changed or relaxed.

## Local Chromium results

Final post-native addressed run: **7 passed**. The strengthened rapid-callback
race was then rerun alone: **1 passed**. Earlier local synchronous/anchor probes
were development diagnostics, not the final qualification. No unit/build/full
local Playwright matrix or browser installation. Statistics below come from the
final full addressed measurement. CI always reads one fresh unmodified report.

| Chromium | Paired-space errors | New outside errors vs D | Input errors | Drag errors | Max extra geometry vs B |
| --- | ---: | ---: | ---: | ---: | ---: |
| B-left-split | 115/965 | control | 0/90 | control | 0 |
| D-word-spacing | 37/972 | control | 0/90 | 0/72 | 0.019539px |
| D+adapter | **0/972** | **0/90** | **0/90** | **0/72** | **0.019539px** |

For D+adapter, each zoom separately has zero eligible/input/drag failures. All
18 Shift/copy probes preserve exact ranges and native anchor affinity; six real
selected-text drag/drop gestures are observed with baseline parity, no interception.
All 11 before/after-click cancellation cases, the withheld-notification/task race
and three nonjustify alignments pass. Pointer-only
operations leave existing inline history states unchanged. DOM source/runs and
UTF-16 mapping remain intact, with no diagnostic model keys.

B is a **paired natural source-space control**, not an expanded-space session.
Its smaller intervals can classify some requested fractional pixels outside the
interval after native coordinate quantization; actual inside/outside counts are
retained. D has additional midpoint-side mismatches under the denser actual-event,
zoom/tracking contract; this extends the earlier 100%-zoom CSS-only probe and
does not invalidate the earlier reported test scope. Controls are not required to
satisfy D+adapter's acceptance criterion or used to excuse any new eligible error.

## CI qualification and stopping boundary

The local Firefox executable is absent; it is not reinstalled. One meaningful
commit runs the existing CI lane, which now calls
`scripts/justify-pointer-summary.cjs` instead of the obsolete CSS-only qualifier.
It requires all seven tests, all 18 data cases, gestures, 11 cancellations, the
withheld-task/input race and nonjustify
scope **in both Chromium and Firefox**. A missing browser or a real adapter failure
keeps the checks red. Historical E/F rejection does not determine this verdict.

The same `justify-stage-2b-caret-gate` artifact preserves full matrix data,
event-order traces, cancellation cases and new `justify-pointer-summary.json/.md`.
Final Firefox measurements/verdict are added to the existing PR body without an
empty commit or second run. No cross-browser success is asserted in advance.

If this prototype fails in Firefox, stop with the precise event/anchor/focus/row
counterexample. Do not extend mapping to other characters or rewrite contenteditable.
If it passes, stop after the production integration plan below; do not enable
full justify WYSIWYG in this phase.

## Exact bounded production integration plan, contingent on gate success

1. Port D's source-space CSS advance accounting and the small pointer block into
   the existing session with only justified/eligible desktop sessions enabled.
   Keep source model schema clean; prototype options/telemetry are not production
   model fields. Share the existing layout result rather than duplicating layout.
2. Register the completed-click token, post-native Selectionchange/task path and
   input guard before the existing session keyboard/beforeinput listeners. Preserve
   AbortController cleanup, task cancellation/identity, Shift native anchor and
   epoch/model/rect/focus/IME invalidations. Validate application-level capture
   handlers/formatting controls before porting this beyond the isolated harness.
3. Port these real native-coordinate/zoom/source interval regressions to the
   shipping projection. Validate actual application event listeners and focus
   ownership, font/viewport changes, borders/ancestor transforms, hardware mouse
   jitter, multi-click selection, task prioritization, formatting-panel ownership,
   native drag/drop fallback and real IME platforms.
   Any movement currently cancels the prototype: jitter tolerance is a separate
   production usability decision, not silently widened in this gate.
4. Only in a separate Stage 2B integration wire mixedTextLayout/justify eligibility,
   inline history/range guards, alignment and export/history/recovery checks with
   the existing unsupported-mode limits and original pixel tolerances. Existing
   native unsupported drop/IME fallback is preserved, not redesigned here.

Draft PR #140 stays open. Issue #139 stays unresolved. No merge, production deploy
or production justify enablement occurs in this experiment.
