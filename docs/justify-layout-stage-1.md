# Justify stage 1: opt-in layout and compatibility

Base: `6dd79e4` (main after #134). `layoutJustified(e)` is an explicit experimental
method of `createRichTextLayoutEngine`; no application call site uses it.
`supportsHorizontalTextLayout`, WYSIWYG eligibility and the late legacy
`drawTextGlyphs` override in `src/editor.js` are unchanged. There is no document
migration, schema change or persisted layout flag.

## Layout contract

The method projects `layout({...e, textAlign:'left'})`, using the same cached
measurements, rows, grapheme ownership, wrapping, baselines and vertical alignment.
It never changes the source object or `textRuns`. Existing `layout()` behavior,
including left/center/right, is unchanged.

Only a soft-wrapped row with interior U+0020 spaces can expand. Each eligible
ordinary space gets `max(0, frameWidth - naturalContentWidth) / spaceCount`.
Repeated spaces retain their characters and each receives an equal extra advance.
Leading/trailing whitespace, tabs and NBSP do not receive expansion. A row without
an eligible space is untouched. Hard-break rows and the terminal row stay natural:
**the last row of every paragraph is not justified**, even before an empty row.
This is proposed stage-1 semantics, not a compatibility decision for saved files.

Fragments split at whole whitespace graphemes, keeping whole words within each
existing style fragment. Coordinates and widths include the added advance;
`justification` records `naturalWidth`, `contentWidth`, `extraPerSpace` and source
UTF-16 offsets of expanded spaces. The last word's logical right edge reaches the
frame. Original trailing spaces hang beyond it; consequently `row.width` (the full
source advance) may exceed the frame while `justification.contentWidth` equals it.
This distinction must be preserved by future fitting and hit-testing consumers.
No negative gap is introduced to force a fit, and overlong words are not squeezed.

`row.carets` contains `{offset,x}` at grapheme boundaries, including empty rows.
Offsets stay in original UTF-16 coordinates, including the legacy handling of CRs.
At a soft wrap, the row owns caret affinity; LF remains in `[end,nextStart)` as in
shared layout. This is geometry for future hit testing, not a live editor bridge.
Contextual prefix advances and the existing per-run metrics are retained.
Range styles remain on fragments (families, sizes, weight/style, tracking, leading,
fill and stroke properties). Decorations project the same added advances.
No run model, stroke painter or editor-history contract changes in this stage.

## Actual legacy behavior

The active implementation is the late `drawTextGlyphs` override near line 5007,
not the earlier fallback. It obtains CSS-probed `wrapLines()` rows, trims trailing
whitespace, splits on `\s+`, filters blanks and paints each word separately.
It collapses all whitespace between words, including repeated spaces and tabs.
Only the final row of the **entire text**, or a one-word row, avoids expansion.
An explicit final LF therefore makes the preceding paragraph expand. Blank rows
consume a line interval but paint nothing. Long-word wrapping uses the CSS probe.
Legacy word advances add `(word.length-1)*tracking` in UTF-16 units; its gap uses
an independently measured space. The override inherits Canvas tracking/kerning
state rather than setting them itself. Shared layout uses native tracking and
contextual measurements, including shaping across adjacent style boundaries.

## Measured comparison

`tests/justify-layout.spec.js` executes the actual source of the shipping
`wrapLines` and late override in Chromium, then imports the actual shared modules.
No copied legacy spacing formula is used. Fresh Canvas contexts, Arial 20 px,
lineHeight 1.2, native tracking initially 0; source tracking is 0 except
`positive` (+2) and `negative` (-1). The browser test attaches full-precision JSON
and writes `work/justify-measurements.json` for inspection. Browser-specific font
metrics are evidence, not new pixel tolerances or PNG baselines.

Notation: `word@row:x`, rows numbered from 1, x in document px. Maximum delta
compares corresponding painted words. Baselines are not subtracted directly:
legacy uses `top`, shared layout uses `alphabetic`.

| Case | Frame px | Legacy word coordinates | Experimental word coordinates | Max abs Δx px |
| --- | ---: | --- | --- | ---: |
| single | 200.0000000 | Hello@1:0.0000 | Hello@1:0.0000 | 0.0000 |
| words | 200.0000000 | AA@1:0.0000; BB@1:32.2363; CC@1:64.4727 | AA@1:0.0000; BB@1:31.1328; CC@1:63.3691 | 1.1035 |
| spaces | 200.0000000 | AA@1:0.0000; BB@1:32.2363; CC@1:64.4727 | AA@1:0.0000; BB@1:42.2461; CC@1:74.4824 | 10.0098 |
| paragraphs | 200.0000000 | AA@1:0.0000; BB@1:173.3203; CC@2:0.0000; DD@2:34.4434 | AA@1:0.0000; BB@1:31.1328; CC@2:0.0000; DD@2:34.4434 | 142.1875 |
| blank | 200.0000000 | AA@1:0.0000; BB@1:173.3203; CC@3:0.0000; DD@3:171.1133 | AA@1:0.0000; BB@1:31.1328; CC@3:0.0000; DD@3:34.4434 | 142.1875 |
| long | 65.0000000 | ABCD@1:0.0000; EFGHI@2:0.0000; JKLM@3:0.0000; NO@4:0.0000 | ABCD@1:0.0000; EFGHI@2:0.0000; JKLM@3:0.0000; NO@4:0.0000 | 0.0000 |
| wrap | 100.0000000 | AA@1:0.0000; BB@1:35.5566; CC@1:71.1133; DD@2:0.0000; EE@2:34.4434 | AA@1:0.0000; BB@1:35.0049; CC@1:71.1133; DD@2:0.0000; EE@2:34.4434 | 0.5518 |
| below | 92.1558594 | AA@1:0.0000; BB@1:65.4762; CC@2:0.0000 | AA@1:0.0000; BB@1:65.4762; CC@2:0.0000 | 0.0000 |
| boundary | 92.2558594 | AA@1:0.0000; BB@1:32.2363; CC@1:64.4727 | AA@1:0.0000; BB@1:31.1328; CC@1:63.3691 | 1.1035 |
| above | 92.3558594 | AA@1:0.0000; BB@1:32.2363; CC@1:64.4727 | AA@1:0.0000; BB@1:31.1328; CC@1:63.3691 | 1.1035 |
| positive | 100.0000000 | AA@1:0.0000; BB@1:71.3203; CC@2:0.0000; DD@2:69.1133; EE@3:0.0000 | AA@1:0.0000; BB@1:69.3203; CC@2:0.0000; DD@2:67.1133; EE@3:0.0000 | 2.0000 |
| negative | 100.0000000 | AA@1:0.0000; BB@1:36.0566; CC@1:72.1133; DD@2:0.0000; EE@2:33.4434 | AA@1:0.0000; BB@1:36.0049; CC@1:73.1133; DD@2:0.0000; EE@2:31.4434 | 2.0000 |

Inputs: single=`Hello`; words=`AA BB CC`; spaces=`AA   BB CC`;
paragraphs=`AA BB\nCC DD`; blank=`AA BB\n\nCC DD\n`;
long=`ABCDEFGHIJKLMNO`; wrap/positive/negative=`AA BB CC DD EE`;
below/boundary/above=`AA BB CC`. The measured boundary is the native full-string
advance, with ±0.1 px neighbors. Below it there are two rows; at/above it one.
The representative cases keep corresponding word row indices, but do not prove
that the CSS probe and shared breaker agree for every Unicode sequence or width.
Unit tests separately prove that the projection never changes the shared wraps.

Reasons for the differences:

- Paragraph and blank cases differ by up to 142.1875 px: legacy justifies paragraph
  ends unless they are the very last row. Experimental layout keeps them natural.
- Repeated spaces shift BB by +10.0098 px and CC by +10.0098 px: original spaces
  remain, combined with contextual shaping; legacy collapses them.
- Even a terminal plain row differs by 1.1035 px: legacy measures words and gaps
  independently; shared layout retains contextual whole-string advances. On the
  first soft-wrap row BB differs by -0.5518 px while the last word meets the edge.
- Tracking +2 shifts the last word of eligible rows by -2 px relative to legacy;
  tracking -1 shifts CC by +1 px and terminal EE by -2 px. Legacy's manual UTF-16
  tracking and separate space measure differ from native shared measurements.
- One-word and long-word rows have matching x origins in this matrix. Blank rows
  have no word coordinates; their line intervals and source offsets remain.

## Compatibility and stage 2

Saved documents still render through the unmodified legacy path. The integration
test imports a saved justify layer (including sparse runs), observes actual
Canvas calls, compares the same word calls on PNG export, and verifies textarea
fallback. It does not claim experimental pixel parity. Existing PNG references
and parity thresholds are untouched.

Unconditionally enabling the shared painter would visibly move old words and may
change wraps outside this sample; range formatting currently ignored by legacy
would also become visible. Do not remove the eligibility guard as a migration.
Stage 2 requires an explicit compatibility decision (for example, opt-in per
layer/version with old layers retaining legacy geometry), then range-style
Canvas/PNG proof, shaping/caret/hanging-space tests, and only then WYSIWYG
projection, selection and history integration. Test reused Canvas state, more
Unicode break opportunities and multiple browser/font backends before activation.
All combinations of range fill/stroke/decorations are not visually certified here.

## Validation

- Targeted layout units, including a matrix of widths, negative/positive tracking,
  CR/LF, emoji, combining/ZWJ sequences, source/runs, caret offsets, paragraph ends,
  trailing spaces, and mixed metric/paint styles.
- Targeted Chromium compatibility and saved-document Canvas/PNG/fallback tests.
- Existing text-alignment WYSIWYG browser tests for left/center/right regression.
- Final required unit/source/build/verify and whitespace checks; see PR for results.
