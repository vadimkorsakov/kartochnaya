# Stage 2B.1 — experimental justify in the application

Issue #141. Based on `7022d89` (current main), independently of diagnostic PR
#140. Ports the accepted `db36b39` mechanism described in that PR's
`docs/justify-stage-2b-pointer-adapter.md` and pointer fixture.

## Enable and fallback

Append `?experimentalJustifyWysiwyg=1` to the Deploy Preview URL (or
`&experimentalJustifyWysiwyg=1` when there is already a query). This is a URL
switch, never a document property. `experimentalTextWysiwyg=0` overrides it.
The existing desktop/font/effect/rotation/mask/horizontal-layout eligibility
checks still apply. Without the switch, justify retains textarea editing.

Textarea justify commands on a selected range now refuse with an explicit toast
instead of applying the requested word's formatting to the entire layer. Color,
font and decoration commands share this guard. Collapsed selections and ordinary
whole-layer commands retain their behavior. No rich range is fabricated for an
unsupported textarea mode.

## Production integration

- `mixedTextLayout()` supplies the existing `layoutJustified()` result to the
  session and its projection compatibility check. Canvas painting, wrapping,
  document schema and textRuns algorithms are unchanged.
- Only expanded source U+0020 fragments receive D's word-spacing compensation;
  their expanded advance positions the next DOM fragment. Source text is intact.
- Pointer hit testing uses shared `row.carets` and `row.justification.spaces`,
  real host geometry and the source-space midpoint. Ordinary text stays native.
- A stationary primary mouse click completes a token at click, not pointerup.
  One cancellable task or trusted Selectionchange confirms native placement.
  Earlier keydown/beforeinput guards consume the token before real editing.
- Tokens revalidate text/style/layout/host geometry and epoch. Projection,
  recovery, preserve, disposal, outside pointerdown, focus loss, pointercancel,
  movement, dragstart and composition invalidate pending work. Public session
  selection writes also cancel it. Queued callbacks check token identity.
- Shift correction retains the connected native anchor DOM point, including
  soft-wrap affinity. The adapter does not capture pointers, prevent native
  mouse events or implement drag/drop.
- Eligible justify sessions use the existing inline history and range-style
  commands. Color and decoration render immediately and remain sparse runs.
  Opening the color button preserves host focus, while numeric/HEX inputs may
  own focus and the session retains its source selection.

## Addressed app-level qualification

`tests/justify-wysiwyg.spec.js` imports a normal document and edits the shipped
application bundles. It does not route-replace production modules or modify the
schema. Covers the first [6,7) space at 40%, immediate X/Backspace/Delete,
60/100/150% zoom, real multi-row drag and native-anchor Shift-click, double-click
word selection, range color/underline, unchanged neighbors, live reprojection,
inspector ownership, Undo/Redo, IndexedDB save/reload, left/center/right controls,
opt-out and unsupported/mobile fallback. Canvas/PNG <=1 and live-ink/PNG <=2
use the existing thresholds and unchanged baselines.

Fault injection withholds the adapter task and Selectionchange delivery to
exercise input winning the race and stale callbacks after inspector focus, zoom,
close, pointercancel, transform changes and composition. Composition/pointercancel
in these tests are synthetic and do not qualify a real OS IME.

The existing alignment CI lane now includes this small suite in both Chromium
and Firefox and preserves its normal artifacts. Firefox is qualified in GitHub
Actions when there is no local executable. See the PR for actual run results;
prototype PR #140 results are not integration results.

## Remaining default-enable boundary

This remains opt-in. Real OS IME/recovery, hardware mouse jitter (any gesture
movement deliberately cancels correction), platform/native drag/drop and broader
browser/platform qualification remain outside this bounded integration. Existing
unsupported WYSIWYG modes remain unsupported; Windows Firefox #129 is unchanged.
Issue #139 remains open. No merge or production deployment is part of this work.
