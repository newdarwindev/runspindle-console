# SRC-010 validation record

## Scope and acceptance

The selected standalone vision page has a complete section, style and navigation
disposition map in `SRC-010-lift.json`. This is a reviewed static-document
adaptation, not a faithful historical rendering or an executable console feature.
MIT notice retained in `LICENSE-SRC-010.txt`. Source revision and original hashes
remain in the restricted mapping; only cleared metadata and resulting artifact
hashes are public. No unselected presentation or linked PDF was imported.

Acceptance remains **incomplete**. Do not close Console issue 2 or mark the
selected source fully migrated until the visual requirements below pass on these
exact artifact bytes. No product runtime, live behavior or deployment is qualified.

## Reproducible dependency-free checks

From the Console repository root, with Python 3 and the existing Node test tools.
The full suite also needs the exact Tether checkout specified by
`dependencies/tether-snapshot.json`, as in the existing validation workflow.
Point `RUNSPINDLE_RETAINED_TETHER` at that pre-provisioned checkout; the tests do
not fetch it or fall back to a different revision:

```
export RUNSPINDLE_RETAINED_TETHER="$PWD/local/retained-tether"
python3 tools/check_vision.py
python3 tools/check_vision.py --output /tmp/runspindle-vision-build
python3 -m unittest discover -s tests -v
python3 -O -m unittest discover -s tests -v
python3 tools/check_scaffold.py
python3 tools/check_artifacts.py
python3 tools/validate.py
git diff --check
git rev-parse HEAD HEAD^{tree}
sha256sum docs/product/vision.html docs/product/LICENSE-SRC-010.txt
```

The copy command refuses any existing destination. It packages the existing static
files without rewriting their bytes. The checker verifies all local page/anchor
links, an exact allowlist of public evidence links, seven workflow stages,
source/notice attribution, complete inventory, no scripts/forms/remote assets,
privacy patterns and forbidden historical links. Regression tests deliberately
break those boundaries. These are static checks, not a browser or network audit.
External link paths correspond to tracked public repository files; no claim of
future URL availability is made. Final commit/tree IDs and command results are
recorded in the change receipt; `artifacts.json` contains file hashes.

## Required browser review: blocked, not passed

The available sandboxed Chromium launch failed before loading a page because its
process socket could not be created (`Operation not permitted`). The existing
managed browser also rejected the local file URL because its policy permits only
HTTP/HTTPS. No browser security policy was disabled, no software installed, and no
artifact hosted externally to bypass that restriction.

Not run:

- Desktop rendering at 1280 × 900 and narrow/mobile rendering at 375 × 812 and
  320 × 640, including every section, long link wrapping and the complete footer.
- Tab/Shift+Tab through every link, visible focus, Enter activation, skip-link
  focus to main content, and absence of keyboard traps.
- Actual 200% browser zoom at desktop width and narrow reflow with no clipped
  text, controls or horizontal page overflow. CSS zoom is not a substitute.

When an authorized browser can load the unchanged local bundle, record browser
version, viewport/zoom, screenshots and observed results, then update this record
and the specific SRC-010 manifest/provenance status. CSS inspection alone is not
a pass. Do not relabel other product pages or runtime UI accessibility as tested.
