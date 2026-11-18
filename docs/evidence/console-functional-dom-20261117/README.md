# Actual DOM functional check, without screenshots

This is the exact standalone runner source and receipt from the bounded Strix run
of Console source `ce4d1202a92df7a2eb414e9187430e00721e6b5f`. It imports the
repository's shared browser assertions unchanged, serves only intercepted local
JavaScript modules at a synthetic origin, and denies other page requests. It
performs no screenshot, baseline, pixel comparison, live provider or control call.
The returned two control requests and one passive admission belong to the mock
server. The capability assertion remains `canExecute: false`.

67 shared actual-DOM assertions passed. Before/after source revision and clean
checkout were checked. Chromium sandbox was enabled and the owned launch command
was checked for absence of sandbox-disable switches. Browser context closed,
owned profile processes were absent, and the disposable profile was removed.
Zero unexpected intercepted page requests is not an OS-wide packet capture or
claim that all browser internals were network-isolated.

## Exact-machine reproduction

Use the recorded Node, Playwright and Chromium installations and a separate clean
checkout of the recorded commit at `/tmp/console-dom-functional-20261117`.
The runner intentionally records its exact original machine paths rather than
pretending to be a portable product entrypoint. Reproduce its observed invocation:

```sh
cp docs/evidence/console-functional-dom-20261117/runner.cjs.source /tmp/console-functional-dom-check-20261117.cjs
node /tmp/console-functional-dom-check-20261117.cjs
```

The receipt contains the runner digest, loaded source-module digests, Node and
browser executable hashes, and Playwright version/package-manifest hash. It does
not claim a complete browser or Playwright distribution closure, visual approval,
or general accessibility certification. The standalone runner is retained as
source evidence, not an additional production module.
