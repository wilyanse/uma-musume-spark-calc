Verdict: PASS

Blocking
None. The cross-origin authentication-boundary defect that held round 2 is fixed. Both same-task submission gaps are closed.

Should fix
None required for this focused diff.

Nits
- apps/web/scripts/review-r2-server.ts:53 — The “problem” scenario serves application/json, not application/problem+json. The generic-error behavior is correct; I independently tested the actual problem+json MIME type against the production bundle. Consider correcting this test response header.
- apps/web/test/review-fix2.test.tsx:29–54, 159–177 — Consider retaining tests where the old request settles while the new screen/panel request is still pending. Existing tests cover navigation and late settlement, but not that precise overlap. My independent production-browser probes passed it for both screens.

Scope and repository state
Reviewed 7e61ccb..6d9a8f72fa0ae148e58f8f395e109d2e9a8bc9de on task/T13-web-screens.

Initial and final:
  HEAD: 6d9a8f72fa0ae148e58f8f395e109d2e9a8bc9de
  git status --short: empty
  git diff --check: exit 0, no output

No tracked edits, commits, delegation, model CLIs, main/sibling changes, deployment, credential access or global configuration changes. Builds and browser runs wrote generated/ignored outputs; independent probe sources and logs remain in scratch.

Checklist

1. Spec conformance: PASS for the focused fixes.
   All 14 fetch-backed DataSource operations use the shared request path with credentials: 'include' and redirect: 'manual'. This covers GET, POST, PATCH, PUT and DELETE. cropUrl remains URL construction, not a fetch.

   Production wiring actually selects httpSource; the browser transport tests serve the built production dist. These are not tests of an unreachable mock adapter.

   Conditional roster requests preserve If-None-Match, cached object identity and populated UI after 304. Existing 204 DELETE behavior passes.

   Abort behavior was not expanded: DataSource exposes no AbortSignal parameter before or after this diff. The existing fetch AbortError → NetworkError mapping remains tested and unchanged. This is not evidence of signal propagation.

2. Correctness: PASS.
   Opaque redirects are classified before accessing headers or body. Real Chromium received opaqueredirect/status 0 for cross-origin and same-origin 302 responses. Both produced authentication copy, not network copy; redirect-target hits remained zero.

   Independently verified response categories:
     HTML 200/401/403 → authentication copy
     HTML 502 → generic copy
     JSON 500 → generic copy
     Actual application/problem+json 500 → generic copy
     Invalid JSON 200 → distinct malformed-response copy
     Destroyed server socket / genuine fetch TypeError → network copy

   No SECRET test-body content appeared in the UI.

   Review and Veteran acquire their refs synchronously before mutateAsync. Same-task duplicate dispatches send once; success/error settlement permits the next submission. Genuine 404/409 messages remain visible, including after queue removal.

   Additional production-browser probes verified:
     Review: old 409 settlement while a new screen request is pending neither paints an error nor unlocks that request.
     Veteran: old 500 settlement while another veteran’s request is pending does not unlock the new panel.

   Hook-level rollback and detail/roster/review cache invalidations are preserved. Prior epithet-text, mode-rule/override and spark-type/numeric regressions remain unchanged and green.

3. Test quality: PASS.
   Independently reran workspace gates, production build, distribution check and all 14 browser tests. Inspected retained test/server/probe sources rather than accepting worker logs.

   Provenance is appropriately separated:
     Controlled local HTTP servers: real browser transport and production bundle.
     Playwright route interception / mock DataSource: UI regression tests.
     SYNTHETIC fixtures: real engine/Comlink Worker ranking and cancellation.
     Retained wrangler probes: prior local real-API evidence, not rerun here.

   My scratch probe initially failed on two locator/readiness mistakes; those logs remain retained. After fixing only scratch harness code, both overlap checks passed.

4. Fabrication: PASS.
   No new runtime game facts or hard-coded production fixture answers in the focused diff. Production distribution scanning found no fixture files or fixture-context markers.

   The contradictory round-2 report is preserved byte-for-byte:
     SHA-256: 5f3235430310a2989b51f8f9f99274871602e78197fb9129af078b7f35dc8f08

   All 128 published T13 evidence files retained identical SHA-256 hashes and nanosecond mtimes after my runs.

5. Security: PASS for the focused boundary change.
   Manual redirects prevent automatic login-target requests. Opaque responses are not inspected for Location, headers or body. Authentication copy is actionable without displaying login/error bodies.

   Live Cloudflare/Access remains explicitly unverified. Local no-follow results are not a deployed Access verification.

6. Free-tier constraints: PASS for changed web scope.
   Actual gzip-9 sizes, worker excluded:
     Main JS: 139,748 B
     CSS:       5,786 B
     Total:   145,534 B — below 250,000 B

   No new service or changed API/D1 behavior. Real-browser 260-veteran ranking measurements were 2213, 2303, 2177, 2119 and 2334 ms. All remained below 5 seconds; the planted golden pair remained first. Real Worker cancellation/recreation passed.

7. Scope: PASS.
   No focused changes to apps/api, packages, lockfile, root/web package manifests, published master data or fixtures. Source changes are web-only; documentation/evidence changes are task-local.

   Confirmed 15b5bb1..HEAD only changes the four evidence-log files described by the parent’s whitespace cleanup.

8. Maintainability: PASS.
   Redirect handling is centralized. Submission guards are small and preserve existing mutation hooks. Keyed Veteran detail panels isolate request lifetimes; Review screen feedback is protected after unmount. Lint and strict typechecking pass.

Commands and actual results

From the assigned worktree:

  pnpm -r lint
    All five projects Done; exit 0.

  pnpm -r typecheck
    All five projects Done; exit 0.

  pnpm -r test
    schema:      149 passed
    master-data:  82 passed
    API:         111 passed
    engine:      240 passed
    web:         124 passed, 11 files
    exit 0.

  pnpm --filter web build
    engine.worker-oeCLiUZV.js: 161.69 kB
    index-BTZ17_Gg.css:         27.38 kB
    index-CcI4i0Jq.js:         464.78 kB
    exit 0.

  pnpm --filter web check:dist
    fixtureFiles: []
    All fixture-code marker matches: []
    check-dist: OK
    exit 0.

  pnpm --filter web e2e
    Cross-origin 302: auth=true, targetHits=0
    Same-origin 302: auth=true, targetHits=0
    ETag/304, error categories, duplicate submissions, rollback/retry passed.
    Ten axe reports: zero violations of any severity.
    Real Worker ranking/cancellation passed.
    14 passed (54.3s); exit 0.

  node /Users/willjose/.hermes/cache/scratch/T13-finalfocusedr3/late-settle.mjs
    Review overlap: sends=2; old settlement did not unlock/paint new screen.
    Veteran overlap: sends=2; old settlement did not unlock new panel.
    exit 0.

  node /Users/willjose/.hermes/cache/scratch/T13-finalfocusedr3/problem-json.mjs
    HTTP 500 application/problem+json observed twice.
    generic=true; secretBodiesInUI=false.
    exit 0.

Evidence and reproducible scratch sources:
  /Users/willjose/.hermes/cache/scratch/T13-finalfocusedr3/

The focused candidate passes independent review. Deployment/Access verification remains a separate pending human/environment gate; no additional worker fix loop is required.

session_id: 20261006_212901_a0e634
