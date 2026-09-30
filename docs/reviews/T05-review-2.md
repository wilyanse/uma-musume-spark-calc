# T05 independent review — round 2

Reviewer session: 20260930_191826_66f13a. Reviewed commit: 2854dbf.

## Verdict: PASS

Reviewed commit 2854dbf on task/T05-inheritance. Fix diff 926e488..2854dbf, plus a skim of main...HEAD. Reviewer: requested claude-opus-5-5 (anthropic), medium effort, unrelated profile fallback disabled.

## Blocking
(none)

## Should fix
- [S1] packages/engine/src/inheritance/inheritance.ts:251, 283-286, 210-219, 301 — Plugin output is only partly validated. `mergeEffect` checks stats (5 finite numbers) and aptitude gains (non-negative integers). It does not check:
  - `inheritanceTurns()`: I probed a plugin returning `[NaN]` and `[1,1]`. Both were accepted, and `events: [NaN]` flowed into the result, where n = events.length hides it.
  - Plugin hints: an unknown `skillId: 'nope'` with `level: NaN` was accepted and produced `skillHintProb.nope = 0.063`.

  Plugins are caller-supplied code, not data, so this does not block. `provenance.validated` stayed false in these probes, but only because the published rules are unverified. With verified rules, a bad plugin would pass as validated. Suggestion: in `planInheritance`, require turns to be distinct finite integers, and hint skills to exist in `ctx.skills` with finite levels. Otherwise throw `RangeError` or warn.
- [S2] packages/engine/src/context.ts:192 — The formula is fail-fast only at affinity 0. After that it is checked at each source's affinity when `planInheritance` runs. The changelog already declares this: T06 must catch `RulesError` per pair, or treat it as fatal for the rules file. Carry this into the T06 card and follow-ups so ranking doesn't abort halfway through a roster.

## Nits
- [N1] docs/OPEN_QUESTIONS.md:93-94 — No blank line between the Q-81 "Blocking: no" line and "## Resolved". Every other entry is followed by a blank line.
- [N2] packages/engine/test/inheritance/roster.test.ts:157-161 — The try/catch that asserts `reasons` does not use `expect.assertions`. The `toThrow` on line 156 guards it in practice, so this is cosmetic.
- [N3] packages/engine/test/inheritance/monte-carlo.test.ts:60 — The stat-mean tolerance is `min(5σ/√N, 1%·mean)`. For stats with a small mean and high variance, the 1% term can sit below the sampling noise. Deterministic seeds make that a latent flake risk if seeds or fixtures change, not a current failure. A short comment would help.

## Checklist
1 Spec conformance: ok. The 50 §3 closed form, per-source affinity, grandparent weight, S-capped convolution, `skillHintProb`, contributions and legality are all present.
   - B1 fixed (inheritance.ts:289-295, 359-364). The initial bonus goes into `expected` once (via `plan.initialStatBonus`) and into each parent blue contribution once. Grandparents get zeros, and the parents-only rule from 50 §3 is kept.
   - `Contribution.initialBonus` is an additive field beyond the 50 §3 minimum and is declared under Deviations. No shared @uma/schema contract is affected: `git diff main...HEAD -- packages/schema packages/master-data apps` is empty.
   - The source/spec conflict over grandparent initial bonuses is documented for Q-3/T15 (changelog Decisions, inheritance.ts:287-288).
   - The Q-81 affinity decomposition is still an assumption. Q-81 is kept as orchestrator-reserved, and the stray Q-70 line is removed.
   - All 50 §9 T05 items are met.
2 Correctness: ok, apart from S1.
   - B1: the sum invariant holds for 1/3/9 sparks, with events and with zero events (toy.test.ts:69-88), and on published data (roster.test.ts:119-152).
   - N1: hints are deduped per activation (inheritance.ts:222-227, 301), and independent activations still combine (edge-cases.test.ts:327-331).
   - S5: poles and negative multipliers at the real affinity (16) now raise `RulesError`, and `FormulaError` no longer leaks (context.ts:177-199; edge-cases.test.ts:244-273). Zero is allowed; negative is not clamped.
   - Guest/unmatched grandparents and ordering by `parents[].slot` are correct (inheritance.ts:133-141).
3 Test quality: ok. There are 74 tests across 5 files.
   - The expectations are independent: hand-computed values, and the rules-mutation test asserts which observables change and which stay put, without re-implementing formulas.
   - The MC checks use 50k seeded draws on the rich, 9-spark and 3-event lineages. They cover all moving stats with the constant bonus subtracted, variances, every grade of each chosen aptitude (including S-capped and exact-zero grades) and every hint, with a justified 5σ tolerance.
   - A coverage guard checks that every top-level rules key is mutated.
   - The published-data tests assert `validated:false`, `eventsKnown:false` and `placeholderRules` rather than presenting placeholders as facts.
   - The worker's 6/4/1 fix-revert failure counts were not rerun, because tracked files are read-only here. By inspection, `expectContributionsSumToExpected` in several tests would catch a B1 revert, and edge-cases:309 would catch a dedupe revert.
   - The changelog output matches my runs: 146/82/5/86/74 tests, and the smoke output is identical.
4 Fabrication: ok. There are no game constants in src. Fixtures are marked `synthetic fixture` and go through the @uma/schema file schemas. The published bundle is read-only and schema-parsed. Model attribution is corrected honestly: Opus requested, actual model uncertain.
5 Security: ok. The formula has its own parser, and grep finds no `eval(` or `new Function` in src. Only `affinity` is accepted as an identifier. There are no routes or secrets. The plugin injection is an in-process API with no data path to it.
6 Free-tier: ok (pure client-side engine, no services).
7 Scope: ok. The diff covers packages/engine/** (with no model/predict/rank), plus the declared edits to docs/OPEN_QUESTIONS.md (a pure append) and pnpm-lock.yaml. The scripts read `apps/web/public/master` without writing it. `git status` is clean.
8 Maintainability: ok.
   - S8: the parameter property is removed (legality.ts:18-23), and `erasableSyntaxOnly: true` in tsconfig guards against regressions.
   - Plain-node import and smoke work with no flag on Node 25.9 and Node 24.14. Project `engines` is node >=22.18, the release where type stripping became unflagged, and the scripts use only erasable syntax and `import.meta.dirname` (Node ≥20.11). I did not test 22.18 itself because it is not installed.
   - N5 (the ScenarioPlugin deviation) is documented, and `loadContext`'s optional third argument is backward-compatible with the 2-argument §1 call.

## Commands run
$ git rev-parse --short HEAD && git status --short
2854dbf
(empty)

$ git diff --stat 926e488..2854dbf
 18 files changed, 1419 insertions(+), 173 deletions(-)

$ pnpm install --frozen-lockfile
Already up to date
Done in 290ms using pnpm v11.22.0

$ (cd packages/engine && pnpm lint && pnpm typecheck && pnpm exec vitest run)
$ eslint src test scripts vitest.config.ts
$ tsc -p tsconfig.json
 Test Files  5 passed (5)
      Tests  74 passed (74)

$ pnpm -r lint | grep -c Done ; pnpm -r typecheck | grep -c Done
5
5
$ pnpm -r test
packages/schema test:       Tests  146 passed (146)
packages/master-data test:       Tests  82 passed (82)
apps/web test:       Tests  5 passed (5)
apps/api test:       Tests  86 passed (86)
packages/engine test:       Tests  74 passed (74)

$ node packages/engine/scripts/smoke.ts          # Node v25.9.0, no transform flag
master global-20260930 rules rules-1 validated false eventsKnown false
placeholderRules blueStatGain,whiteHintLevels
affinity total 173 perSource {"P1":113,"P2":87,"GP1a":21,"GP1b":32,"GP2a":18,"GP2b":18}
expectedStatGain [21,0,5,0,0] sum(contributions.stats) [21,0,5,0,0]
sample [21,0,5,0,0]
same veteran -> same-veteran,same-parent-character
smoke ok

$ ~/.nvm/versions/node/v24.14.0/bin/node packages/engine/scripts/smoke.ts
sample [21,0,5,0,0]
same veteran -> same-veteran,same-parent-character
smoke ok
$ ~/.nvm/versions/node/v24.14.0/bin/node -e "import('./src/index.ts').then(m=>console.log(Object.keys(m).length,'exports'))"
23 exports

$ node ~/.hermes/cache/scratch/t05r2/probe.mts   # published bundle, injected plugins (S1)
{"turns":[null]} OK events [ NaN ] hints {} validated false
{"turns":[1,1]} OK events [ 1, 1 ] hints {} validated false
{"hints":[{"skillId":"nope","level":null}]} OK events [ 1, 2 ] hints {"nope":0.06297600000000003} validated false
{"apt":{"turf":0.5}} threw RangeError spark:arima-kinen: aptitude gain for turf must be a non-negative integer, got 0.5

$ git diff main...HEAD --stat -- packages/schema packages/master-data apps
(empty)

$ grep -rn "eval(\|new Function" packages/engine/src
(only doc-comment matches; no code)

$ git status --short | wc -l
0
