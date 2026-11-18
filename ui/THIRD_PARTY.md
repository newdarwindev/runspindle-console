# Third-party inputs

All versions and npm integrity hashes are pinned in package-lock.json. Installation
uses official npm packages without lifecycle scripts. Browser runtime bundles
include React, React DOM, scheduler, Radix Dialog and its Radix helpers, aria-hidden,
react-remove-scroll helpers, use-callback-ref, use-sidecar and tslib as resolved by
the lock. These dependencies retain their upstream MIT licenses (tslib is0BSD) and copyright
notices. The builder fails when any resolved runtime package lacks a license and
ships their exact texts in THIRD_PARTY_LICENSES.txt, alongside retained legal comments. This does not relicense project or
legacy source. Build/test-only dependencies (esbuild, Playwright and TypeScript
community types) are not shipped as application runtime code.

react-remove-scroll-bar2.3.8 omits LICENSE in its npm archive. The MIT
notice is retained under licenses/ from official upstream revision
8ca9ba5ea52de03308fe8ced94f7b159a44d28ff. The npm-reported gitHead
was unavailable upstream and is not claimed as verified:
https://github.com/theKashey/react-remove-scroll-bar/blob/8ca9ba5ea52de03308fe8ced94f7b159a44d28ff/LICENSE
