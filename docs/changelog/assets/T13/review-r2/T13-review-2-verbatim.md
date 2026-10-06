Verdict: CHANGES_REQUESTED. Nothing is blocking. One should-fix remains: S2 still misreports a cross-origin auth redirect as a network failure. Everything else from round 1 is fixed, and I checked it against the real API code running locally, not just the mocks.

The worktree was clean at 7e61ccb0bbc0182dffe564dc9f0b80e716823c95 at the start and still is. I made no tracked edits or commits. All real-API checks ran on local `wrangler dev` (localhost, fresh local D1/R2, AUTH_DISABLED) with the production `dist`, seeded with 14 SYNTHETIC golden rows (all returned 201). Nothing was checked against live Cloudflare or Access; H4 is still pending.

Should fix:
- **S2-r2** (`apps/web/src/api/http.ts:19-26, :74/:80/:89`; `errors.ts:21, :27-28`; `test/http-auth.test.ts:14-20`):
  - **What happens.** I pointed a 302 from `/api/v1/roster` at a real HTML login server on another origin, which is how an Access redirect to `<team>.cloudflareaccess.com` looks. The browser followed it (the server logged 2 GETs), CORS rejected the response, and the UI showed "Couldn't reach the server…" instead of the auth message.
  - **What works.** A same-origin redirect and an HTML 200 do show the auth message.
  - **Why the tests miss it.** The unit test fakes a readable, redirected cross-origin 200 response, which a real browser never gives to page code. The comment at http.ts:20 and the changelog's S2 claim overstate what is handled.
  - **Fix.** Call fetch with `redirect: 'manual'`, treat an `opaqueredirect` response as an auth error, replace the impossible mock, add a Playwright test with a 302 to another origin, and correct the comments and changelog.

Nits:
- **Review.tsx:75-76:** `isPending` only turns true one tick after the first `mutate`. Two `1` keydowns fired in the same task sent two requests (200, then 409), and the user saw the stale alert instead of "Fixed". A realistic fast double press sent only one request. A `useRef` guard would close the gap.
- **Veteran.tsx:137-138:** the mode toggle has the same one-tick gap. It is only cosmetic, because both caches are refetched when the request settles.

Verified against the real local API:
- **B1:**
  - Fixing the epithet through the search stores the text, not the vocabulary ID. Trickster → Independent Learner switched the veteran to independent mode; Independent Learner → Trickster switched one back to manual.
  - A veteran with a manual override kept manual / override after the epithet fix.
  - The stored resolved values are plain text, with no `epithet:` IDs.
- **S1:**
  - **409.** I resolved an item out-of-band, then pressed `1` in the UI. The screen-level alert stayed after the queue refreshed, and resolving the next item successfully cleared it.
  - **404.** I deleted the veteran out-of-band, then pressed `1`. The alert appeared and "Dismiss message" cleared it.
- **S2 cases that work:**

  | Response | What the UI shows |
  |---|---|
  | Same-origin 302 or 200 HTML | auth message |
  | 502 HTML | generic message |
  | 200 JSON that doesn't parse | malformed-response message |
  | 500 problem+json | generic message |

  No response body leaked into the page, and the roster ETag still returns 304.
- **S3:**
  - With the real PATCH delayed 1.5 s, both radios were disabled and exactly one PATCH was sent, through both keyboard and click.
  - With an injected 500, the UI rolled back to the server state and showed the "reverted" alert.
- **S4:**
  - A white spark slot lists only white sparks, and a blue slot only blue ones. Applying blue Speed stored the correct spark through the API.
  - Stars has no search box and only accepts 1–3.
- **S5:** A plain e2e run left every tracked file under `docs/changelog/assets/T13` unchanged (same SHA-1 and timestamps). Its output went to the ignored `test-results/e2e-assets`.
- **N1:** The minimum-confidence threshold and the insufficient-data requirement both come from the engine; nothing is copied or invented.
- **N2:** The 1–50 Friend level limit and the LB4 / Lv50 defaults come from the approved S04 design and are labelled as UI defaults, not game facts.
- **N3:** The production build has no fixture code or data (`check:dist` exit 0). A fixture build contains them, and running the production check against it fails as it should.
- **N4:** axe reports zero violations of any severity on S01, S03 and S06 in both themes. The S06 detail headings look the same as before.

Reruns (all match the changelog):
- **Lint and typecheck:** pass across the workspace.
- **Tests:** schema 149, master-data 82, API 111, engine 240, web 113.
- **Build:** main bundle 139,621 B gzip -9.
- **e2e:** 7/7 passed. Ranking 260 veterans in the browser took 2045–2322 ms, and the top pair is the planted golden pair.

The API, packages and lockfile are untouched in this diff, and `git diff --check` passes. The wrangler server and my test login server are stopped.

Files are in /Users/willjose/.hermes/cache/scratch/T13-review-r2/:
- T13-review-2.md — the full report
- probe2.mts, probe3.mts, probe4.mts, probe5.mts
- seed2.mts, seed-race.mts
- the logs

session_id: 20261006_195222_fc4b41
