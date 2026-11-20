# Task workspace browser evidence

The built Console now links to a task workspace that uses the existing
navigation, stream projection, and read-only renderer. The source is the
canonical synthetic catalog and fixed local snapshots. A bare history entry
opens the first catalog task. An explicit unknown key clears the projection.

## Reproduce

From a checkout with the locked UI dependencies and a sandboxed Chrome:

```sh
output=$(mktemp -d)
node ui/build.mjs "$output/build"
node ui/check-task-browser.cjs "$output/build" /path/to/chrome
```

The check runs the bundled HTML in fresh offline browser profiles. It exercises
the visible task links and buttons with real DOM and keyboard input. It verifies
the selected task and focus after Back and Forward, one history entry for a
repeated selection, Unknown after restoring an invalid key, literal rendering
of hostile markup, and zero attempted non-file page requests. A disposable copy
with nowrap forced on the observation fails the horizontal clipping assertion.

## Observed local run

- Base commit `535149999717dd774c4cf7e79ac06566806e89fd`
- macOS arm64, Google Chrome 158.0.8127.36, Playwright 1.58.2, Node 26.13.0
- Desktop 1280 CSS pixels at 100% and 640 CSS pixels at native 200%. Outer width
  stayed 1280 and device pixel ratio changed from 1 to 2.
- Tablet and mobile layout checks passed at 768 and 390 CSS pixels respectively.
- All four browser cases passed, and the clipping mutation failed as expected.
- 157 Node tests passed with the pinned Tether source and Python 3.13.18 for
  exporter subprocesses. Python discovery ran 127 tests with 6 skips. The
  scaffold and static-quality checks passed.

| Tested input | SHA-256 |
| --- | --- |
| Chrome Framework | `947b51bdb64056a2f38b301e88eb4654efe5a8196571c082407745be1e7906b2` |
| UI lockfile | `f36b50ed68610fcf49f1363569acc468cd9d1f88d4d3c068dd6fdcc29914aa51` |
| Browser check | `4ae2b157d64616316dac6311698cae4f805bd017d276d965e42274d019440554` |
| Generated `tasks.js` | `8e190b013746cd3964f04b8bbecb7ca55cfea5878f98bd515cf666cb1dd2246e` |
| Generated `tasks.html` | `142af07384afe99de568f893c794fa78284944e2804a9f1c242e0fa8920957fb` |
| Generated stylesheet | `7989a6321b71e47b99db6303a89d853f09f5b6365b43cd59825441b40df790c2` |

This evidence covers synthetic task navigation for Console issue #10 and its
parent #3. Runtime stream integration, authenticated acceptance and delivery
receipts, independent visual-baseline review, and live fleet acceptance remain
open.
