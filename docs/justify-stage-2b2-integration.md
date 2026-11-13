# Stage 2B.2 — live alignment and complete range formatting

Issue #143; parent #139 remains open. Continues #142, with the pointer mechanism
qualified in #140. Branch starts at current `origin/main` `15f3808`.

## Session and pointer ownership

The source-space adapter's host/document/window listeners are installed once for
the supported WYSIWYG session lifetime, using the existing AbortController.
`stretchedHit()` still requires the **current** `textAlign === 'justify'` and a
positive `extraPerSpace` on a source U+0020. Sessions opened left/center/right can
therefore acquire and release the correction without replacing the editor.
`project()` already advances the pointer epoch and cancels pending tasks before
changing rows, including alignment, Undo/Redo and recovery. Queued callbacks still
check token identity. `dispose()` and `preserve()` retain their existing cleanup.
Native Selection, Shift anchor DOM affinity, source UTF-16 offsets and textRuns
remain the existing contracts. There is no new hit-testing or shaping algorithm.

## Desktop integration

`alignBar('text')` includes “По ширине” with an equal-line icon and the existing
button dimensions/style. All typography alignment controls have labels and
`aria-pressed`, synchronized in place after session changes and history travel.
Space/Enter retain native button activation instead of entering the hand tool.

The inspector click handler passes the bar's scope to `alignPicked()`. Typography
changes text alignment on each unlocked text layer; multi-selection does not move
frames. The object alignment bar has no Justify command. Live alignment uses
`applyLayerStyle()` and its existing inline history/projection, including vertical
alignment. No font-size fitting, tracking or line-height changes are introduced.
Without `experimentalJustifyWysiwyg=1`, selecting Justify in an ordinary live
session first hands confirmed text and selection to textarea, then records the
alignment in inline history. Range-style fallback guards remain in force.

The existing built-in font variant select now includes italic variants, exposing
fontStyle through the same range formatting route as fontWeight. Uploaded fonts
continue to offer only their declared variants. No new typography panel is added.

## Application qualification

`tests/justify-wysiwyg.spec.js` continues to exercise actual shipped bundles:

- left → justify → left → justify gate, 40% [6,7) click and immediate X;
- alignment transition matrix with backward ranges, exact model preservation,
  Undo/Redo, all vertical anchors, paragraph-final LF rows and IndexedDB reload;
- mouse and keyboard controls, unflagged textarea handoff, multi-selection,
  pending-token invalidation, native drags and Shift anchor at 60/100/150% from
  both initially left and initially justify sessions;
- range fontFamily, fontWeight/fontStyle via fontVariant, fontSize,
  letterSpacing, lineHeight, textColor, fillOpacity, stroke, strokeWidth,
  strokeOpacity, solid/dashed/dotted strokeStyle, underline and strikethrough;
- sparse run boundaries and unchanged neighbors, changed live ink before closing,
  three previews per numeric/color operation with one Undo, same-property repeats,
  font-size auto-fit on/off, Mixed, Escape cancellation and collapsed-range guard;
- multiple source spaces, cross-row backward UTF-16 ranges with emoji, combining
  marks and ZWJ; rapid clicks and keyboard movement/deletion/newlines;
- JSON export/import in a fresh context, saved document reopening and strict
  Canvas/PNG <=1 / live ink/PNG <=2 comparisons, without changing baselines.

Actual local and CI counts and pixel measurements are recorded in PR #144.
The existing alignment CI lane runs the expanded suite in Chromium and Firefox.

## Default-enable boundary

Justify WYSIWYG remains opt-in. `experimentalTextWysiwyg=0` still wins. Mobile,
unsupported fonts/modes, rotation, text paths, masks and effects keep their
existing eligibility/fallback contracts. IndexedDB v3 and document data formats,
`applyTextStyle`, shared layout and painters are unchanged. Synthetic composition
and pointercancel tests check cancellation contracts only; they do not qualify
real OS IME. Windows Firefox #129, hardware mouse jitter, real OS IME/recovery and
platform drag/drop still require manual qualification before default enablement.
No merge, production deployment or closure of #139 is included.
