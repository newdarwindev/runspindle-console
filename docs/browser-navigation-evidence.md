# Actual offline browser history: partial Console #10

Based on merged Console `f94dd48d00c9b34bd7b0bbf7a9a0c0a1ecedb072`.
This extends the existing real-DOM harness to the existing navigator, browser
History adapter and stream coordinator. No production navigation semantics change.
Canonical synthetic catalog and observations are reused; the transport's
subscription, snapshot and passive-open functions remain explicit test doubles.
The DOM, focus, pushState/popstate and Back/Forward are actual browser behavior.

## Bounded reproduction

```
RUNSPINDLE_DOM_BROWSER=google-chrome python3 tools/check_projection_dom.py
```

No HTTP server, live backend, credentials, provider, installation or sandbox bypass.
Each scenario has its own disposable browser profile and a 25-second process
limit. The harness permits three seconds of virtual browser time for bounded
asynchronous History navigation. Polling and popstate waits are separately bounded.
Test cleanup disposes the navigator and removes its owned DOM in finally.

## Observed results

Google Chrome 157.0.8103.38 with standard sandbox passed 13 actual-browser
navigation assertions:

- Initial task selection and next-task selection succeed.
- Repeated selected-button click creates no extra history or subscription.
- Unrelated history state and current URL remain unchanged.
- Actual Back/Forward restore selected task identity, aria-current and focus.
- Popstate does not create replacement history entries.
- Navigation has an accessible name; no passive view is opened.
- Back to unselected history clears old identity and observation without a new
  subscription; no task retains aria-current.
- After disposal, actual Forward creates no subscription; every prior subscription
  was closed and owned DOM is absent.

A deliberate replacement of the adapter's popstate event name must fail with the
specific `history_navigation_timeout` result. It did. A missing DOM receipt,
syntax/process failure or arbitrary assertion failure cannot satisfy this mutant.
Existing 59 projection DOM assertions passed; unsafe-text and reflow mutants
remained detected. The added assertions execute in Chrome, not the Node DOM double.

Full Node suite: 89 passed, zero skips (Node v24.21.0). Full Python suite: 116 passed
(Python 3.14.8), using the existing exact Tether pin
`670989839a0fccbcf2014d01609778ae6e4df424`. Scaffold and diff checks passed.
Pinned static tooling is unavailable on this executor; aggregate hygiene and CI
remain unqualified, not silently passed.

## Remaining scope

No manual keyboard/assistive-technology testing, screenshots, visual baselines,
contrast or browser-zoom acceptance. Browser virtual time and synthetic immediate
snapshots do not qualify live transport behavior. Existing deterministic tests
cover deferred/reordered observations separately. No native desktop, takeover,
backend, control permission or deployment qualification is added. Console #10 and
its parent remain open.

Independent source review found no concrete blockers; reviewer syntax/whitespace
checks and 16 focused navigation/retry tests passed. The reviewer did not rerun
Chrome. Scripted History traversal is not native browser-toolbar activation.

## Input SHA-256

- `test/navigation-browser.assertions.js`: `800c03c4e89d313762baa37a79264ee2251b813293bcba63e27577f775315c75`
- `tools/check_projection_dom.py`: `053b961267036ab484f23eef2253b889ab552b73cc843f0e6efd8d135d050656`
