## Verdict: CHANGES_REQUESTED

I reviewed candidate 62b168fa0cd7ea1f4cae5bf8463e75c697125f18 against base 08d4876. The worktree is still clean at that SHA: `git status --short` shows nothing and `git diff --quiet` passes. I made no tracked edits, no commits and no push. All probes and outputs are kept in /Users/willjose/.hermes/cache/scratch/T13-review/.

Besides the mocks, I ran the production `dist` build in a real Chromium browser. It was served by local `wrangler dev`, which runs the real API routes on local D1 and R2 with `AUTH_DISABLED` on localhost. I seeded it with 58 ingests built from golden roster rows; 54 were accepted and 4 were rejected by the API's parent-spark rule. This is a local run of the real API code. It is not a check against live Cloudflare or Access.

## Blocking

- [B1] apps/web/src/screens/Review.tsx:271-279 and apps/web/src/lib/paths.ts:74. Fixing an `/epithet` review item through the vocabulary search writes the vocabulary ID instead of the epithet text.
  - Reproduced against the real API. Before the fix the veteran had `{"epithet":"Trickster","trainMode":"manual"}`. I searched for "Independent Learner", applied it, and the veteran became `{"epithet":"epithet:independent-learner","trainMode":"manual","modeSource":"epithet"}`.
  - `Veteran.epithet` is free text. The 01 §6 mode rule tests `epithet.trim().toLowerCase() === 'independent learner'`, so the stored value is now corrupt and the train mode stays wrong (an F02/F04 regression).
  - The unit and e2e tests only use numeric candidates, so they miss this.
  - Required fix: for epithet paths (any field whose value is text, not an ID), send `e.text` as the value. Keep sending IDs for character, outfit, skill, spark and scenario paths. Add a test that sends an epithet resolution and checks the exact POST body.

## Should fix

- [S1] apps/web/src/screens/Review.tsx:290-298 together with apps/web/src/app/queries.ts:116-124. A 409 after a concurrent resolve gives the user no message.
  - Reproduced: another request resolved the item first, then I pressed `1` in the UI. The UI got 409, the queue refreshed, and the item was removed. `ItemPanel` is keyed by item id, so it unmounted along with its error, and `[role=alert]` was empty.
  - Move the conflict and stale message to the screen level (for example a toast), so it survives the refresh.
- [S2] apps/web/src/api/http.ts:44 and :58. A 200 response that is not JSON throws a `SyntaxError`, which the UI shows as the generic "Something went wrong". This is what you get from an Access login page or a same-origin HTML redirect; the SPA fallback answers any non-API path with HTML.
  - Check `res.redirected` and the content-type, and show the `error.auth` copy in those cases.
- [S3] apps/web/src/app/queries.ts:63-86 and apps/web/src/screens/Veteran.tsx:186. Mode toggles aren't disabled while a PATCH is pending (only `aria-busy` is set).
  - If you toggle quickly, the first mutation's `onError` can roll the detail back to an out-of-date snapshot, and `onSettled` only invalidates the roster.
  - Disable the toggle while pending, or also invalidate `qk.veteran(id)` in `onSettled`.
- [S4] apps/web/src/lib/paths.ts:69. Every `/sparks/...` path searches all spark vocabulary. That includes `/sparks/n/stars`, and it ignores the slot's spark type, so a fix can store a sparkId whose type doesn't match the recorded type.
  - Search spark vocabulary only for the `sparkId` leaf, filtered by the slot's type.
- [S5] apps/web/e2e/screens.spec.ts:7. `pnpm --filter web e2e` overwrites tracked evidence files in `docs/changelog/assets/T13`.
  - Make the assets directory come from an env var, defaulting to `test-results`.

## Nits

- [N1] apps/web/src/screens/Health.tsx:147 (`≥ 0.9`) and apps/web/src/app/engineErrors.ts:16 ("5 train rows") repeat engine constants. Export them from the engine or read them from the error instead.
- [N2] apps/web/src/screens/Cards.tsx:265-296. The Friend level has no upper bound. The default of LB4 / Lv50 is editable, but it isn't labelled as a default.
- [N3] The main bundle still contains the `fixtureSource` and `loadGolden` code paths in production, and the worker contains `loadGoldenContext`. Production can't reach them, because `loadGolden` is undefined there, and dist contains no fixture JSON.
- [N4] axe still reports moderate `region` (all three screens) and `heading-order` (S06) violations.

## Checklist

1. **Spec conformance:** mostly met. These all work against the real API:
   - Roster ETag: a 200 with no `If-None-Match`, then a 304 that sends the ETag, and the cached roster is kept.
   - Mode PATCH (`modeSource` becomes override).
   - Target POST through the UI, with absent dates omitted.
   - The crop URL `/api/v1/crops/crops/<id>/%2Fstats%2Fspd.png` returns 200.
   - Snapshot 404 → fit → POST 201. After a reload the model is reused: still 1 POST in total.

   Owned cards are treated as an array with a per-row `syncedAt`, and there is no invented held count. There is no invented dismiss call (Q70). Calibration is disabled honestly (T15). Exception: B1.
2. **Correctness:** B1, S1, S3, S4. Things I checked and found correct:
   - Cancellation and late results: run ids plus generation-tagged jobs plus terminate/recreate.
   - The stale-results banner, because the run signature includes settings, deck, target, ETag, master version and context.
   - Own-unique and unknown skills are flagged per trainee and dropped for that run only.
   - Legacy v1 is never relabelled; corrupt snapshots are reported as malformed, separately.
   - Insufficient data comes from the engine.
   - Ranked pairs are distinct characters, never the trainee's character, and contain no guests.
3. **Test quality:** the tests are real and deterministic. The real-engine fit/rank runs in Vitest; the browser test cancels a real Worker and reranks. Gaps:
   - No test covers a text-valued resolution (B1) or a 409 that leads to a refresh in the UI.
   - The populated S03 and S04 checks use mock HTTP only.

   The changelog numbers matched my reruns.
4. **Fabrication:** none found. The SYNTHETIC golden context is only used in fixture mode and is labelled. Production uses the published rules verbatim (12 unverified, 2 placeholders, shown in a banner). S07 draws no scatter points and shows transient FitReport aggregates only.
5. **Security:** fetches use `credentials: 'include'` and IDs are URL-encoded. Auth redirect handling is the S2 gap.
6. **Free tier:** OK. The main bundle is 138,767 B gzip -9 JS plus 5,805 B CSS, about 144.6 kB, under 250 kB. The worker is excluded.
7. **Scope:** OK. Changes are in `apps/web/**`, `docs/changelog/**` and `pnpm-lock` with exact pins. The relative import of the engine's golden-context script is declared as a deviation.
8. **Maintainability:** good overall. See S5 and N1.

## Visuals and accessibility

I compared these by eye against the approved H5 design files in `docs/design/screens/`:
- S06 desktop dark: matches the approved layout, components and colours.
- S06 and S01 mobile at 390px: no horizontal overflow; header and body line up; bottom tabs are visible.
- S07: shows the real aggregates and the honest "unavailable" note.

axe found no serious or critical violations on S01, S03 or S06 in either theme.

## Commands run

```
$ pnpm --filter web test
 Test Files  8 passed (8)   Tests  94 passed (94)   EXIT 0
$ pnpm --filter web lint && pnpm --filter web typecheck   → exit 0
$ pnpm --filter web build
dist/assets/engine.worker-CvyqFKaj.js  162.20 kB
dist/assets/index-xZoPOzG9.css          27.38 kB │ gzip:   5.86 kB
dist/assets/index-B-5YzKpV.js          461.20 kB │ gzip: 140.45 kB
find dist -name '*.json' → only dist/master/** (no fixtures)
$ playwright test e2e/zz-review-scratch.spec.ts   (temporary untracked copy; assets redirected to scratch; deleted afterward)
REAL BROWSER 260 ranking: 2096 / 2170 / 2069 / 2077 / 2065 ms
AXE S01/S03/S06 light+dark: serious/critical=0
  3 passed (32.4s)   top pair = 01M1RX152GP86FAQ1WPY0MX60J|01M379DKQ86T9BGV6696R6DWN2
$ wrangler d1 migrations apply --local --persist-to <scratch>; wrangler dev --local :8799 (AUTH_DISABLED, localhost)
$ curl -i /api/v1/roster -H 'If-None-Match: <etag>' → HTTP/1.1 304 Not Modified
$ node probe.mjs / probe-etag.mjs   (prod dist + local real API)
roster requests ["200 inm=-","304 inm=\"d356994a…\""]
resolveAfterTypingInSearch 0
epithetBefore {"epithet":"Trickster","trainMode":"manual","modeSource":"epithet"}
epithetAfter  {"epithet":"epithet:independent-learner","trainMode":"manual","modeSource":"epithet"}
resolveReqs [... ".../01M47XS301PX1S4FKWCM199A6X/resolve 409"]   alertAfter409 []
patchReqs ["PATCH /api/v1/veterans/01M47XS98AZXNH88HGQTFG5ARN 200"]  modeLabel "Train mode (overridden)"
snapshotPosts1 ["POST /api/v1/model-snapshots 201"]  snapshotPosts2 (after reload) same single POST → reuse
pageErrors []
$ git status --short → (empty); HEAD 62b168fa0cd7ea1f4cae5bf8463e75c697125f18
```

The wrangler dev server is stopped. Ignored or generated outputs (`apps/web/dist`) remain, which is acceptable.

session_id: 20261006_135905_9c797a
