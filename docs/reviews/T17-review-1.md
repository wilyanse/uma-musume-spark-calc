↻ Resumed session 20261010_043638_cf20c5 "T17 capture eligibility independent review round 1" (1 user message, 16 total messages)
Verdict: PASS

T17 independent review, round 1
Candidate: 4df13698706ab913b230636a8ae4993eb390bd17
Base: 439764a
Reviewer provenance: Opus → GPT-6.1 Sol, authorized medium fallback following the parent-confirmed Opus HTTP 429. Same review session retained.

This is local implementation approval for T17, not milestone, deployment, native Windows, real-roster, or game-mechanics acceptance. No blocking findings. Two nonblocking follow-ups are below.

Blocking

None.

Should fix

[S1] packages/engine/test/model/eligibility.test.ts:121–143; apps/web/test/t17-eligibility.test.ts:57–66 — Retain an explicit status-aware calibration regression.

The new committed tests exercise prepareRow, fit populations, and worker fit, but do not directly assert the changed population through calibrateRules. The existing calibration/browser tests use unchanged legacy fixtures.

Production calibration correctly calls prepareRow at packages/engine/src/calibrate/index.ts:399. I independently exercised that real call path with six scratch cases: accepted low score, corrected low score, unresolved high score, absent legacy flag, malformed flag, and unread parent sparks. All assertions passed, with raw inputs unchanged. This is therefore a regression-coverage follow-up, not a demonstrated correctness defect.

Suggestion: retain this matrix in the engine calibration tests, including calibration’s additional matched-or-guest restriction.

Nits

[N1] docs/adr/0003-capture-status-training-eligibility.md:12 — The parenthetical “PATCH and resolve return detail” is inaccurate.

PATCH returns veteran detail, but resolve returns a ReviewItem: apps/api/src/routes/reviews.ts:278–281. The new flag becomes observable through a subsequent roster/detail read, which the tests correctly perform. Adjust the ADR description; do not expand the resolve response contract merely to match this sentence.

Substantive findings

API derivation and write-path coverage

  apps/api/src/db/veterans.ts:452–455 derives the flag with EXISTS over every current capture_fields row having status low_confidence. It does not filter by review-item status or numeric confidence.

  Both roster and detail use that SELECT. PATCH reloads detail through the same assembly path. There is no migration or duplicated materialized flag.

  The new API tests reach real routes, local D1 with real migrations, runtime schemas, and actual engine source—not a mocked eligibility function. The retained C# fixture payload is ingested against the published master IDs before engine preparation.

  Tests cover partial resolution, last-field correction, dismissed-but-unresolved fields, re-ingest, index retirement, owner-block deletion/remapping, PATCH, conditional GET after correction, and hook-injected concurrent PATCH/re-ingest conflicts.

  Correcting a 0.3 field leaves both its field confidence and veteran minConfidence at 0.3. Re-ingest may replace provenance with the newly captured scores; correction does not inflate history.

  Ingest acknowledgements and resolve responses retain their existing authoritative contracts. Not adding hasLowConfidence to those response types is consistent with “where applicable”; roster/detail expose the derived veteran metadata.

Schema and engine

  packages/schema/src/api.ts:72 adds an optional, noncoercing boolean. The exported JSON schema also makes it optional and boolean-only. The committed export equals the generated contract in the independently passing schema tests; Ajv/zod flag parity is exercised.

  packages/engine/src/model/fit.ts:141–151 implements the intended confidence-only branch:
    true excludes even at a high score;
    false passes at a low score;
    absent/undefined retains the legacy 0.9 gate;
    malformed supplied values exclude rather than coerce.

  Other preparation checks remain after that branch. New tests independently retain unknown scenario/outfit/card, deck-size, missing-parent, unread-parent-sparks, illegal-lineage, bad-date, and nonfinite-stat exclusions. Guest/unmatched lineage is not reclassified to manufacture eligibility.

  Calibration uses the same preparation gate and retains its additional matched-or-guest population requirement. My scratch calibration probe confirmed this extension rather than relying solely on fit tests.

Cache and worker provenance

  capture-status-v1 is separate from the effective rules fingerprint and training-v2 statistical semantics. No golden data, numeric rules, acceptance thresholds, or snapshot kinds were retuned.

  Base FitRecord v2 loads with unknown/null policy and forces refit; the new v3 record binds the actual reported policy. Browser-local envelope v1 similarly parses with null policy, cannot match the current expectation, and is replaced by a v2 envelope after successful local refit.

  The tests deliberately hold roster identity, ETag, master, and context constant while changing only policy provenance. They assert one fit/store followed by reuse.

  apps/web/src/app/engine.ts:161–214 keeps the overridden path ahead of all snapshot API reads. Both base and local paths reject a fit reporting the wrong eligibility policy before storage. rulesApply also checks the candidate’s policy before committing its envelope.

  apps/web/src/workers/engine.api.ts:511–523 refuses missing/mismatched context identity and missing/mismatched eligibility policy before ranking. It does not guess provenance from the snapshot kind or rules version.

  Roster content identity includes the flag, with an explicit new regression test.

Evidence integrity

  The retained API fixture is byte-identical to /Users/willjose/.hermes/cache/scratch/IR1/mcqueen-agent.json. It has 190 fields, all status ok, raw minimum 0.875. It is screenshot-fixture C# assembly evidence, not a Windows import or a real roster.

  Historical RED logs in scratch/T17 match the changelog’s qualified counts:
    schema: 3 failed, 150 passed;
    engine: 21 failed, 1 passed;
    API: 12 failed;
    web: 8 failed, 1 passed.

  I inspected those retained logs; I did not independently recreate historical RED states or rerun the mutation experiment. The blanket “all tests failed” characterization is not used as review evidence.

Checklist — 85 §3

1. Spec conformance: OK.
   Spec 63, authoritative 01/50 errata, ADR-0003, and the T17 task card align with the implemented status policy and compatibility boundary. N1 is a documentation correction only.

2. Correctness: OK.
   Status derivation, raw-score preservation, legacy fallback, malformed-flag refusal, lineage exclusions, policy invalidation, and worker rank guards were reviewed and exercised.

3. Test quality: OK, with S1.
   Independent full-suite and browser reruns passed. The API-to-engine regression uses real modules. Cache orchestration tests explicitly use mock data sources/fake clients, while worker tests use the real engine in-process; these are not mislabeled as real-browser migration proof.

4. Fabrication check: OK.
   No production fixture answers or invented game constants found. Frozen master/golden/agent paths have no diff from the base. Historical evidence and synthetic data are distinguished from new execution.

5. Security: OK within T17 scope.
   No authentication, deployment configuration, dependency, or credential changes. The new SQL is a fixed read expression; supplied flags are strictly validated. Existing security tests passed in the API rerun.

6. Free-tier constraints: Local budgets OK; live CPU remains unverified.
   Create/re-ingest remain 15 statements; roster 6; owner-remap resolve 24; PATCH 7; stale resolve 24. Local timing is not Cloudflare CPU evidence. H2/Q-4 remain open.

7. Scope: OK.
   Changes are focused and cross-task edits declared. No .NET, dependency/lockfile, migration, master, or existing golden/web fixture changes. T16’s dependency/licence blocker remains separate.

8. Maintainability: OK.
   One shared derived SELECT, one confidence gate, explicit policy provenance, and conservative old-record parsing. Lint and strict typechecking passed.

Commands run — independent reviewer execution

Working directory:
  /Users/willjose/Projects/personal/uma-musume-spark-calc.worktrees/T17-capture-eligibility

$ pnpm -r test
  Exit 0.
  schema:      153 passed
  master-data: 82 passed
  API:         123 passed
  engine:      351 passed
  web:         239 passed

Full test log:
  /Users/willjose/.hermes/cache/scratch/T17-review1-tests.log

$ pnpm -r lint
  Exit 0; all five workspace projects completed.

$ pnpm -r typecheck
  Exit 0; all five workspace projects completed.

$ pnpm --filter web build
  Exit 0.
  index-CVqjKgHu.js: 616.17 kB; gzip 185.13 kB.
  engine.worker-apb7wW2d.js: 193.51 kB.
  Vite retained its nonblocking >500 kB chunk warning.

$ pnpm --filter web check:dist
  Exit 0.
  fixtureFiles: []
  check-dist: OK — no fixture code or data in the production build.

$ pnpm --filter web e2e
  Exit 0; 18 passed (1.6m).
  Real-browser synthetic calibration selected ×1.32.
  Candidate fit/apply completed; Planner ranked under the override.
  Recalibration selected ×1.00.
  Cancel/fault/cross-tab/reload/reset workflow passed.
  Health/Planner both-theme axe outputs reported serious/critical=0 and all=0.
  Production-placeholder checks used explicitly mocked HTTP, not deployment.

$ node /Users/willjose/.hermes/cache/scratch/T17-review1-calibration.mjs
  Exit 0.
  accepted-low 0.875: included
  corrected-low 0.3: included
  unresolved-high 0.99: low-confidence exclusion
  legacy-low 0.875: low-confidence exclusion
  malformed "false": low-confidence exclusion
  unread-parent with false/0.3: parent-sparks-unread exclusion
  “6 calibration status/legacy/malformed/lineage assertions passed; inputs unchanged”

  The first probe attempt exited 1 because prepareRow is not exported from the public engine index. I corrected only the scratch import to model/fit.ts; no candidate edit was needed.

$ pnpm --filter api exec vitest run test/ingest.test.ts test/roster-benchmark.test.ts --reporter=verbose
  Exit 0; 24 passed.
  statements: create=15 re-ingest=15 roster=6
  statements: resolve(owner+remap)=24 patch=7
  statements: stale resolve=24
  260 rows: 1,233,181 bytes; first request 32.0 ms.
  2,000 rows: 9,486,001 bytes; first request 234.0 ms.
  Conditional roster requests: 2.0 ms locally.
  These are Miniflare timings, not production CPU measurements.

$ git diff --check 439764a..HEAD
  Exit 0.

$ git diff --quiet 439764a HEAD -- apps/web/public packages/engine/test/golden apps/web/fixtures packages/master-data agent
  Exit 0; frozen paths unchanged.

$ git status --porcelain=v1
  No output; clean tracked candidate.

$ git rev-parse HEAD
  4df13698706ab913b230636a8ae4993eb390bd17

Remaining acceptance

H2 live Cloudflare CPU/provisioning and H4 native capture/real-roster acceptance remain pending. Published placeholder inheritance rules still cannot establish meaningful calibrated game mechanics. T16 is independently blocked and was neither changed nor treated as a T17 defect.

No tracked edits, commits, pushes, deployment, credentials, global configuration changes, delegation, subworkers, model CLIs, recursive builds, or master/golden refresh were performed. Parent writes the final review file.

session_id: 20261010_043638_cf20c5
