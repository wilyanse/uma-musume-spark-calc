## Verdict: CHANGES_REQUESTED

This is a local integration-readiness audit, not milestone exit approval. Commit 5e7d3e6 passes every TS gate, and the agent→API→web path works end to end on synthetic and fixture data. Two blockers stop real-roster validation (H4) before it can start. Both need a coordinator decision on the fix. Nothing deployed, pushed or committed. HEAD moved to d278c64 during the review, but that commit touches docs and CHANGELOG.md only, so the code I tested is unchanged.

## Blocking

**[B1] An all-`ok`, label-correct capture is never used for training, and resolving reviews can't fix it.**
- Where:
  - `apps/api/src/routes/veterans.ts:91`: the API sets `minConfidence` to the minimum over every field, including `ok` ones.
  - `packages/engine/src/model/fit.ts:30,132`: the engine only trains on rows with `MIN_CONFIDENCE = 0.9` or higher.
  - `agent/src/Uma.Agent.Core/Parsers.cs:519` (card art: confidence is 1 − d/64 but the match is accepted up to d ≤ 10) and `Parsers.cs:295` (spark labels: the vocab score is the confidence and is accepted from 0.85). These are confident readings with confidence below 0.9.
  - `apps/api/src/routes/reviews.ts:250`: resolving a review keeps the old `minConfidence`.
- Reproduced: I assembled the real fixtures 01–07 + 09/10 in C#. The capture has 190 fields, all `ok`, none `low_confidence`, and is uploadable. The weakest fields are `/sparks/5/sparkId` at 0.875 (OCR read "Nimble Navigatc") and `/deck/5/cardId` at 0.8906 (d=7). The API stored `minConfidence` 0.875. The engine then excluded the row: `{reason:'low-confidence', detail:'minConfidence 0.875'}` → `InsufficientDataError (eligible 0)`.
- Resolving a `low_confidence` `/stats/spd` field (confidence 0.3) left the veteran at 0.3, so it stays excluded permanently.
- Why it matters: Windows OCR reports a constant 1.0 (Q-100), so in practice this gate is driven by vocab and dHash scores. A large share of real veterans would silently drop out of training, and the Planner and T15 could have zero eligible rows.
- Fix needed (contract decision, likely 01 §7 erratum or ADR): define the training eligibility signal from field status (any open `low_confidence` → ineligible; `ok`/`corrected` → eligible), or recompute `minConfidence` over accepted fields and on resolve. Add a cross-module test: the fixture capture is ingested and the engine finds it eligible.

**[B2] The agent doesn't build in this environment.**
- Where: `agent/src/Uma.Agent.Core/Uma.Agent.Core.csproj:9` pins SixLabors.ImageSharp 3.1.12, and `agent/Directory.Build.props:4` sets `TreatWarningsAsErrors`.
- What happens: five GHSA advisories published 2026-10-07 (3 high, 2 moderate) affect versions ≤ 4.1.1, with 4.1.2 as the first patched version. With SDK 10.0.103 (picked by `agent/global.json` latestMajor), NU1902/NU1903 become errors. Affected:
  - `agent-gates.sh core-tests` (exit 1);
  - `agent-gates.sh windows-build` ("5 Error(s)");
  - `dotnet publish win-x64`;
  - the `agent-install.md:16-20` steps H4 depends on.
- Not verified: I didn't run GitHub CI. I expect CI's SDK 9 to show the same thing, but that is inferred.
- Fix needed: upgrade to ImageSharp ≥ 4.1.2 (major version; API and licence need review) or add a scoped `NuGetAuditSuppress` per advisory with rationale. Runtime frames come from WGC BGRA bytes, and `Frames.Load` reads PNGs in tests and the OcrRecorder only, so the TIFF/ICC/histogram code paths appear unused, but that needs confirming. Then re-run Core, Portable, the Windows build and publish without `NuGetAudit=false`.

## Should fix / nits

- **[S1]** The golden fixture's `matchedVeteranId` doesn't match what the API produces. Re-ingesting all 260 golden veterans through the API gives 269 matched parents versus 277 in the fixture; 8 differ and none points at the wrong veteran. The API leaves those 8 NULL because 1–6 candidates qualify, which follows 40 §4 ("exactly one"). Fixture-mode lineage is therefore slightly richer than real API data; document it in `truth.json`.
- **[S2]** `Parsers.cs:387` hard-codes 0.9 for a non-guest `isGuest` field. That sits exactly on the engine threshold, so any change on either side flips eligibility. Fold this into the B1 decision.
- **[N1]** With published rules (`inheritanceTurns: []`, blue gain 0/0/0), ranking the golden target gives pMeet 0 for every pair (medium aptitude passRate 0). This is expected (Q-3/Q-5), not a bug, but it means real-roster ranking only gives useful answers once Q-5 is resolved.

## Checklist (85 §3/§5)
1. **Spec conformance**: ok except the B1 semantics (01 §7 / 50 §4 `min_confidence` is underspecified across agent → API → engine).
2. **Correctness**:
   - Ingest is idempotent (201 then 200).
   - A train-mode override survives re-ingest.
   - Fingerprint mismatch and bad body return 422; owned-cards count mismatch returns 422.
   - Review resolve recomputes the fingerprint.
   - Roster ETag returns 304.
   - Ranking excludes the trainee's character (2 veterans) and evaluates 33,175 legal pairs.
   - B1 is the exception.
   - Planner mean vs sampled variance: only checked through the engine tests and the rank probe, not probed separately.
3. **Tests**: real, deterministic, green (counts below).
4. **Fabrication**: none found. Rules keep `verified:false` and the placeholders are labelled.
5. **Security**:
   - Health is public.
   - `AUTH_DISABLED` on a non-local host fails closed (500 "Server misconfigured").
   - `check-config --require-provisioned` fails only on the H2 placeholders.
   - Dependency advisories: B2.
6. **Free tier**: the 2,000-veteran CPU budget is still unmeasurable locally (Q-4, H2).
7. **Scope**: n/a.
8. **Maintainability**: ok.

85 §5 items:
- TS/C# fingerprint parity: the 7 shared vectors pass in both suites. On top of that, the C# fingerprint of a real-fixture capture was accepted by the TS API's server-side recompute.
- Web uses `@uma/schema` types: yes.
- Master IDs: the agent capture against `global-20260930` passed both C# `CaptureValidation` and the API `checkMasterIds`.
- Full suite: green, with B2 caveat.

## Commands run (real output, trimmed)
```
$ pnpm -r lint / typecheck / test      → exit 0; schema 149, master-data 82, api 111, engine 329, web 229
$ pnpm --filter web build && check:dist → index gzip 184.80 kB (gzip -9: 182,534 B); "check-dist: OK — no fixture code"
$ TOOLS_DIR=… bash .github/tests/run.sh → regression checks: 62 passed, 0 failed
$ node .github/scripts/check-config.mjs .                      → ok (structure), MASTER_VERSION=global-20260930
$ node .github/scripts/check-config.mjs . --require-provisioned → placeholder database_id / ACCESS_TEAM_DOMAIN (H2)
$ bash .github/scripts/agent-gates.sh core-tests → error NU1903 … ImageSharp 3.1.12 … (exit 1)          [B2]
$ dotnet build {Core.Tests, Portable.Tests, Windows (EnableWindowsTargeting), Native.Tests} -c Release -p:NuGetAudit=false → 0 Warning(s) 0 Error(s) each
$ dotnet test Core.Tests / Portable.Tests --no-build -- RunConfiguration.DotNetHostPath=<scratch 8.0.31>
  → Passed 302/302 ; Passed 225/225   (fresh rerun at this commit; audit disabled only to get past B2)
$ dotnet publish Windows -r win-x64 --self-contained -p:PublishSingleFile=true -p:NuGetAudit=false → Uma.Agent.Windows.exe 193 MB (cross-target only, not run)
```
Environment: SDK 9.0.312 and 10.0.103 (10 selected), installed runtimes 9/10 only. The .NET 8.0.31 runtime is a fresh scratch install at `~/.hermes/cache/scratch/IR1/dotnet8`; the historical T10-review path no longer exists. Native Windows tests and WGC/OCR were not run (Windows-only).

## Integration probes
All synthetic or fixture data, local only: `wrangler dev --local` with `AUTH_DISABLED` on localhost, real migrations, real `web/dist` and published master. No credentials, no network writes. Probe code is in `~/.hermes/cache/scratch/IR1/` (`probe/`, `probe2/`, `golden-ingest.ts`, `probe-elig.ts`, `rank-probe.ts`).

- **Agent veteran path:** a real-fixture C# capture (fingerprint `a0fbe2ae…`) through POST → 201, then 200 on repeat. Roster shows McQueen as independent/epithet, Special Week unmatched, Opera O guest, 35 sparks, URA Finale.
- **Crop and review path:** C# `UploadOutbox` + `UploadClient` sent the crop, then the veteran (both Uploaded). Review item `/stats/gut` → crop GET 200 (80×36 PNG) → resolve 560 → new fingerprint. PATCH manual → re-ingest keeps the override.
- **Card sync:** fixture 13 through `CardSyncSession`, explicit partial confirmation, coordinator PUT → `Synced ack Count=20 Partial=True`. GET returns 20 rows with the expected LB list. The web Cards screen shows "Showing 20 of 20".
- **Synthetic golden roster:** all 260 POSTed through the real API → 260×201. Health "Refit model" in the browser fitted training-v2 on 192 train / 48 holdout with coverage 0.85 and POSTed the server snapshot (base context). Ranking against the API roster took 1,611 ms for 33,175 pairs.
- **Engine eligibility on the real-fixture roster rows:** both rows excluded, `low-confidence 0.875` (B1).

## Remaining acceptance

**Implemented and verified locally:**
- schema/fingerprint parity;
- API ingest/review/override/ETag/owned-cards;
- the agent Core assembly, outbox and card uploader against the real local API;
- web against the real local API (Roster, Cards, Health fit, Review);
- the published-rules calibration no-op path;
- T15c browser-local apply (synthetic, per the parent's evidence; I didn't re-run Playwright);
- production fixture exclusion;
- the auth fail-closed configuration;
- the backup workflow regression tests.

**Local code gaps:**
- B1 (eligibility semantics);
- B2 (ImageSharp advisories break builds).

**Blocked on human action:**

- **H4 (Windows plus the game):**
  - Build and run the agent, after B2.
  - `--record-ocr` the 15 fixture screens, including per-ROI recordings (Q-91), and check the T09 labels.
  - Import at least 20 real veterans, recording Task Manager memory; meaningful only after B1.
  - Spot-check 3 veterans in the web app.
  - Collect at least 6 deck-art identities from real art only, to calibrate the Q-6 Hamming threshold.
  - Settle Q-151 (Held = distinct cards?) with one full card scroll.
  - Check the ◯/◎ glyph separation (Q-90) and capture rank badge templates (Q-92).

- **H2 (Cloudflare):**
  - Set up the account, D1/R2, the Access app with a one-time-PIN policy and the `uma-agent` service token, and the API token / GitHub environment secrets.
  - Replace the placeholder `database_id` and `ACCESS_TEAM_DOMAIN`.
  - Run a live upload with the service token.
  - Do one backup → restore drill.
  - Measure free-tier CPU on `/roster` at the real roster size (Q-4).

- **H3:**
  - Veteran List screenshots (top and middle).
  - Tapping a grandparent portrait on Career Info.
  - These unblock Q-1/Q-2 and T14. T14 stays deferred.

- **Not obtainable from the user's roster:** a usable, genuinely calibrated blue-gain factor. Published `blueStatGain` is 0/0/0 and `inheritanceTurns` is empty, so calibration cannot identify a multiplier (Q-3/Q-5/Q-157). That needs cited game constants, never invented ones. Pink/aptitude checks stay uninformative for the same reason.

## Smallest path to real-roster validation
1. Coordinator fixes B2, then B1, each with a test.
2. User does H2 provisioning.
3. User follows the H4 runbook: OCR re-record, label check, 20+ imports, 3 spot-checks.
4. Coordinator confirms on Health that the "Training rows" count is at least 6 and matches the imported count.
5. A Q-3/Q-5 sourced constants update is still needed before any calibrated rules factor or real ranking signal means anything.