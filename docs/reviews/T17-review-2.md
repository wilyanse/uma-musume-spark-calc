↻ Resumed session 20261010_043638_cf20c5 "T17 capture eligibility independent review round 1" (2 user messages, 78 total messages)
Verdict: PASS

T17 focused independent review, round 2
Reviewer session: 20261010_043638_cf20c5
Reviewer provenance: approved GPT-6.1 Sol medium continuation after coordinator-confirmed Opus HTTP 429.
Prior reviewed candidate: 4df13698706ab913b230636a8ae4993eb390bd17
Current candidate: b0d371159c96904195010f7d023e955a20028c75

Blocking: None.
Should fix: None outstanding from round 1.
Nits: None outstanding from round 1.

S1 and N1 are resolved. The round-1 PASS remains valid, with the requested calibration regression coverage now retained. This is local T17 approval—not native, real-roster, deployed, or game-mechanics acceptance.

Focused findings

S1 — Resolved
  packages/engine/test/calibrate/capture-eligibility.test.ts:28–54,58–98

  All nine cases call the actual calibrateRules implementation against cloned, unchanged synthetic roster data and the real published context. There is no mocked report, fabricated context, planted calibration answer, or fixture rewrite.

  Coverage now includes:
    accepted 0.875 and corrected 0.3 admitted;
    unresolved 0.99 excluded;
    absent legacy flag at 0.875 excluded;
    absent legacy flag at 0.9 admitted;
    malformed string flag excluded;
    unread parent sparks excluded despite false/0.3;
    unmatched non-guest and missing matched parents rejected by calibration’s additional matched-or-guest restriction.

  Assertions inspect the actual population row, exclusion reason/detail, and membership or absence in the returned train/holdout split. The two additional lineage cases also prove that prepareRow succeeds before calibration rejects them, distinguishing calibration’s extra restriction from the shared confidence gate.

  The population-accounting assertion is supplementary consistency checking, not the sole evidence: each case independently asserts the target row’s expected inclusion or exclusion.

  Every case checks whole-roster immutability and preservation of the raw score. The “corrected” case deliberately supplies the derived false flag; it does not pretend to perform a correction. Actual correction and field-score preservation remain covered by the inherited API integration tests.

  Deterministic conventions are preserved: injected clock, report ID and timer through helpers; explicit split/CV/bootstrap seeds; bootstrap disabled; three-point grid; bounded existing timeout. Published placeholder rules remain nonidentifiable.

N1 — Resolved
  docs/adr/0003-capture-status-training-eligibility.md:12

  The ADR now accurately distinguishes PATCH’s detail response from resolve’s ReviewItem response and explains that updated veteran metadata is observed through subsequent roster/detail reads. No API response shape changed.

Evidence wording — Accurate
  docs/changelog/T17-capture-eligibility.md:168–237

  The append preserves the historical implementation provenance and records the authorized Opus → Sol continuation separately.

  The numeric-only gate experiment is explicitly labeled mutation testing against already-correct code, not a newly reconstructed TDD RED. I inspected its retained log: eight failures and one pass, with legacy 0.9 passing. The log and explanation agree, including the legacy-low failure arising from the detail assertion. I did not independently repeat that mutation or edit production code.

Scope verification

The complete round-2 diff contains only:
  docs/adr/0003-capture-status-training-eligibility.md
  docs/changelog/T17-capture-eligibility.md
  packages/engine/test/calibrate/capture-eligibility.test.ts

No production implementation changed since round 1. Schema, API, engine production, web production, lockfile, agent, published master, and existing golden/web fixtures remain unchanged.

Checklist — 85 §3

1. Spec conformance: OK.
   S1 now retains direct calibration population coverage under the approved status policy. N1 matches the existing response contract.

2. Correctness: OK.
   Nine independently rerun cases demonstrate the intended confidence branches and preservation of calibration’s additional lineage restriction. Production correctness conclusions are inherited from round 1.

3. Test quality: OK.
   Real calibration calls, deterministic inputs, explicit population/split assertions, exact exclusions, and input-immutability checks. No fake-context or report tautology found.

4. Fabrication check: OK.
   Synthetic inputs are labeled. No game constants or acceptance data changed. Mutation evidence is accurately qualified and matches the inspected logs.

5. Security: OK, inherited.
   No security-sensitive production changes in this diff.

6. Free-tier constraints: OK, inherited local evidence.
   No API/query changes. H2 production CPU measurement remains pending.

7. Scope: OK.
   Only the requested test retention, ADR correction, and changelog append changed.

8. Maintainability: OK.
   Tests follow existing calibration helpers and timeout conventions. Engine lint and strict typechecking independently passed.

Commands run — new independent round-2 execution

Working directory:
  /Users/willjose/Projects/personal/uma-musume-spark-calc.worktrees/T17-capture-eligibility

$ git rev-parse HEAD
  b0d371159c96904195010f7d023e955a20028c75

$ git status --porcelain=v1
  No output; clean candidate.

$ git diff --stat 4df13698706ab913b230636a8ae4993eb390bd17..HEAD
  3 files changed, 171 insertions(+), 1 deletion(-).

$ pnpm --filter @uma/engine exec vitest run test/calibrate/capture-eligibility.test.ts --reporter=verbose
  Exit 0.
  Test Files 1 passed (1).
  Tests 9 passed (9).
  Duration 1.32s.
  All nine named status/legacy/malformed/lineage cases passed.

$ pnpm --filter @uma/engine lint
  Exit 0.
  eslint src test scripts bench vitest.config.ts

$ pnpm --filter @uma/engine typecheck
  Exit 0.
  tsc -p tsconfig.json

$ git diff --quiet 4df13698706ab913b230636a8ae4993eb390bd17 HEAD -- packages/engine/src packages/schema apps/api apps/web/src pnpm-lock.yaml
  Exit 0; listed production/schema/API paths unchanged from round 1.

$ git diff --quiet 439764a HEAD -- apps/web/public packages/engine/test/golden apps/web/fixtures packages/master-data agent
  Exit 0; frozen paths unchanged from the task base.

$ git diff --check 4df13698706ab913b230636a8ae4993eb390bd17..HEAD
  Exit 0.

$ git diff --check 439764a..HEAD
  Exit 0.

$ git status --porcelain=v1
  No output after verification.

Inherited versus new evidence

New independent evidence:
  Focused nine-test rerun, engine lint/typecheck, complete follow-up diff inspection, unchanged-production/frozen-path checks, and clean-tree/diff checks.

Inspected historical evidence:
  Retained mutation log reports 8 failed / 1 passed; green and restored logs report 9 passed. These are inspected implementation logs, not reviewer-executed mutation results.

Parent-reported exact-candidate evidence, not rerun in this focused review:
  Full lint/typecheck/tests: schema153/master82/API123/engine360/web239.
  Scoped production build: 185.13 kB gzip.
  Production fixture exclusion and browser18 passed.
  Real-browser Worker/Comlink synthetic ×1.32 apply → rank → recalibrate ×1.00, reload/reset, cancellation/fault/cross-tab and both-theme axe checks preserved.

Round-1 independent full-suite and browser evidence remains applicable to unchanged production paths. Redundant full gates were not required for this test-and-documentation-only follow-up.

H2 live Cloudflare CPU/provisioning and H4 Windows/real-roster acceptance remain pending. T16’s separate licensing blocker is unchanged and is not a T17 blocker.

No tracked edits, commits, pushes, deployment, configuration/credential changes, subworkers, delegation, model CLIs, recursive builds, or master/golden refresh were performed. Parent saves the final report.

session_id: 20261010_043638_cf20c5
