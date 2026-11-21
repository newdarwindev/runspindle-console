# Console SRC-010 visual reference

[Reference HTML](reference.html) and [paired contact sheet](generated/contact-sheet.png) cover the reviewed
[Console vision document](../../product/vision.html). The editable reference uses
new text and inline CSS drawn from the public disposition map. It presents immutable
output feedback, gold eligibility and serving approval as separate decisions. Proposed
workflow and unavailable measurement labels appear in the reference.

The canonical captures use the exact reviewed HTML introduced in
`4737f8a37d5cd837ec52377adefd687ebd597383`. The canonical document, navigation
targets and MIT notice remain bound by the existing
[SRC-010 static integrity record](../../product/SRC-010-validation.md).
The [scenario map](scenarios.json) binds every selected section, asset
disposition and unavailable material to its reference and canonical counterpart.

| Review subject | Result |
| --- | --- |
| Responsive layout | Paired full-page PNGs at 320, 390, 768 and 1440 CSS px. Native 200% zoom at 640 and 1440 DIP produced 320 and 720 CSS px with DPR 2. |
| Reading and navigation | Each render passed heading and landmark assertions, stage order, named links, forward/reverse Tab, visible focus and Enter on Skip to content. Desktop also activated Overview with Enter. |
| Workflow | The [reference workflow](generated/reference-workflow.png) is an ordered, captioned text figure. The [canonical workflow](generated/canonical-workflow.png) is an ordered list. The selected SRC-010 source had no separate figure asset. |
| Focus and hover | Paired desktop captures show first keyboard focus and Overview hovered. The reviewed document has no disclosure state. |
| Long text and negative states | Paired long-heading screenshots at 320 CSS px. Historical material exclusions and missing measurements remain explicit. Removing either page's scope label deliberately fails its browser check. |
| Visual comparison | The PNGs and the contact sheet are local review candidates. The reference cards and canonical text have different geometry. Pixel-overlay acceptance and owner baseline disposition are pending. |
| Other acceptance | Physical-keyboard and assistive-technology operator review, compatibility across renderers, and runtime acceptance are pending or out of this static evidence. Issue #2 retains its acceptance gate. |

The [capture record](generated/evidence.json) lists actual viewport and bitmap
dimensions, source and font digests, minimum sampled contrast, accessibility
snapshot digests, mutation outcomes and all PNG hashes. Keyboard evidence comes
from scripted input through Chrome.

Two fresh captures produced byte-identical evidence and all 21 PNGs.

## Reproduce locally

Use the recorded arm64 macOS build, installed Chrome and Node, and the existing
offline Console UI cache pinned by `ui/package-lock.json`. The capture launches
sandboxed Chrome with disposable profiles, blocks non-allowlisted requests, waits
for fonts and decoded pixels, fixes DPR and locale, and suppresses animation and
carets. Both documents are static and require no clock or random seed.

From the repository root, choose an output path that does not yet exist.

```sh
node docs/visual/vision/capture.cjs \
  --browser "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --playwright "$PWD/ui/node_modules/playwright" \
  --output /private/tmp/runspindle-vision-capture
diff -rq docs/visual/vision/generated /private/tmp/runspindle-vision-capture
```

Keep the candidate PNGs separate from a fresh capture while reviewing changes.
The capture removes its browser profiles and contact-sheet scratch files. Delete
the disposable output directory after review. Repository source and other
evidence remain outside that directory.
