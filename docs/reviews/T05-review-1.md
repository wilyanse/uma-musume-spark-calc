# T05 independent review — round 1

Requested reviewer: claude-opus-5-5 / anthropic, medium; profile fallback disabled. Session: 20260930_184837_eae6b9.

## Verdict: CHANGES_REQUESTED

## Blocking
- [B1] packages/engine/src/inheritance/inheritance.ts:79-83, 337-342 — The `Contribution.expectedEffect` doc says a blue spark's stats include its share of the initial blue bonus, and that summing all contributions gives `expectedStatGain`. The code never adds `a.initialBonus` into `stats` (line 337 starts from `zeros()` and only adds `n × p × g`), so both claims are false. With the published Global data, `inheritanceTurns` is `[]` for every scenario and `blueStatGain` is 0. That leaves the initial bonus as the only non-zero stat effect, and every contribution then reports a zero effect. I reproduced this with real master data, two parents with blue 3★ and two injected events: `expectedStatGain [0,0,0,42,0]` but `sum(contributions.stats) [0,0,0,0,0]`. 50 §3 and §7.4 pass `contributions` through to `RankedPair` so the UI can explain a pair, so this output is wrong in practice. No test covers the invariant. Required fix: add `a.initialBonus` to `expectedEffect.stats` (or change the documented contract and add a separate `initialBonus` field on `Contribution`). Add a test asserting Σ contributions.stats == expectedStatGain, including a zero-event scenario.

## Should fix
- [S1] packages/engine/test/inheritance/toy.test.ts:1-160 — The public API that 50 §1 names, `inheritanceExpectation(ctx, outfit, [RosterVeteran, RosterVeteran], scenarioId)`, and the `legacyFromVeteran` adapter are never called by any test. That leaves these paths untested:
  - owner mapping: self → P, parent1/parent2 → GP a/b;
  - grandparent `characterId` from `parents[].slot`;
  - guest grandparents (`isGuest: true`, `matchedVeteranId: null`);
  - the `same-veteran` rejection.
  
  My probe shows they behave correctly today, but nothing guards them. Add RosterVeteran-based tests covering these, plus the P2 = trainee reason.
- [S2] packages/engine/test/inheritance/toy.test.ts:152-159 — The 50k Monte Carlo property test checks only `statGain[0]` of the 1-spark lineage. That mean is dominated by the constant +30 initial bonus, so it is a weak check. It doesn't cover aptitude distributions, `skillHintProb`, other stats, grandparent weights or race/scenario sparks. Compare MC against the closed form for all 5 stats, one aptitude's grade distribution and the hint probabilities, on the 9-spark lineage. In my probe on real data these agree: stats `[4.807,…,48.021]` vs `[4.824,…,48.034]`, hint 0.1283 vs 0.1278.
- [S3] packages/engine/test/inheritance/toy.test.ts:144-150 — The rules-swap test changes only `blueInitialBonus['3']`. That meets the letter of 50 §9 but proves nothing for `activation.*`, `grandparentWeight`, `affinityMultiplier.formula`, `blueStatGain`, `pinkGradeGain`, `whiteHintLevels`, `raceSparkStatGain` or `scenarioSparkEffects`. Parameterise it so a change to each table changes the output.
- [S4] packages/engine/test/inheritance/toy.test.ts — Several paths have no tests at all:
  - the zero-event scenario (`inheritanceTurns: []`, the real Global state) and the `provenance.validated`/`eventsKnown`/`placeholderRules` flags;
  - unknown spark ids → `skipped`;
  - the master-vs-recorded spark type mismatch;
  - missing race/scenario rows → warning and no effect;
  - `ScenarioPlugin` (`statCap`, `inheritanceTurns`, `deckFeatures`, and the `sparkEffects` override/merge path in inheritance.ts:266-269);
  - malformed formulas and `RulesError` on non-integer `pinkGradeGain` or non-finite values;
  - the S cap in `aptitudeDist`. The 9-spark case can reach C+6 but only the 3-spark turf row is checked for summing to 1.
  
  My probes show the formula parser rejects `eval(1)`, `Math.max(1,2)`, `affinity +`, `2*(affinity` and `""`, and `loadContext` rejects fractional pink gain and NaN weight. Encode these as tests.
- [S5] packages/engine/src/context.ts:162-168 — The formula is only test-evaluated at affinity 0. A formula with a pole at a reachable affinity, e.g. `1/(affinity-39)`, passes `loadContext` and then throws `FormulaError` from `planInheritance` (reproduced). A negative multiplier such as `0 - affinity` is silently clamped to p = 0. Surface the error as `RulesError`, or skip and warn per pair, and warn on multipliers < 0.
- [S6] docs/changelog/T05-inheritance.md:5 — "Agent / model: gpt-5.6-luna-900k, medium effort" is a self-identification. The requested model for session 20260930_163135_c56e91 was claude-opus-5-5 via anthropic at medium effort. Profile-level fallback to gpt-5.6-luna-900k is documented, so the model that actually ran is uncertain. Correct the line to record requested claude-opus-5-5 (anthropic, medium) and actual model uncertain (possible fallback to gpt-5.6-luna-900k).
- [S7] docs/OPEN_QUESTIONS.md:48-53 — Three problems with the Q-81 entry:
  - Line 53 is a stray copy of Q-70's line: "Blocking: no (for S03 only; T13 waits on this)".
  - The ID skips ahead: the highest existing is Q-78, so the next should be Q-79.
  - It is inserted between Q-70 and Q-71.
  
  Remove the stray line and fix the ID/placement per the AGENTS.md "next number" format.
- [S8] packages/engine/src/inheritance/legality.ts:18 — The `constructor(readonly reasons…)` parameter property is not erasable TypeScript. Plain `node` in strip-only mode rejects the package: `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, reproduced on Node 25.9. Other packages run `.ts` directly (`node src/build.ts`), and T08 golden-data scripts or benches may too. Use an explicit field assignment.

## Nits
- [N1] packages/engine/src/inheritance/inheritance.ts:353-355 — If one activation carries the same skillId twice (e.g. a race row listing a duplicate hint), its miss factor is multiplied in twice. Dedupe hints per activation.
- [N2] packages/engine/src/inheritance/inheritance.ts:271-276 — The initial blue bonus is parents-only, which follows 50 §3. The cited source quoted in rules.json (`blueInitialBonus.source`) says it is "additive over every legacy and sub-legacy". The engine is correct to follow the spec, but record the conflict for T15/Q-3.
- [N3] packages/engine/test/inheritance/toy.test.ts:55,77,82,129 — The toy master is built with `as never` casts and never validated against the `@uma/schema` master schemas, so fixture typos would go unnoticed. The `{ ...({…}) } as never` on line 129 is noise.
- [N4] packages/engine/test/inheritance/toy.test.ts:134 — `toEqual` on computed floats (`48.1152`, `30.7072`) is brittle. Use per-element `toBeCloseTo`. I checked the values by hand and they are correct.
- [N5] packages/engine/src/scenarios/index.ts:18 — `sparkEffects` takes `{spark, stars}` and may return `undefined`, a small signature deviation from 50 §2 that the changelog doesn't mention. List it under Deviations.
- [N6] docs/changelog/T05-inheritance.md:62-83 — The Verification block paraphrases rather than pasting output: per-package results are merged onto one line each, and it includes "(done; the final full lint above also passed)". The counts match my re-run.

## Checklist
1 Spec conformance: issues (B1). Otherwise the 50 §3 closed form, per-source affinity, the grandparent weight, the parents-only initial bonus, the aptitude convolution with S cap, `skillHintProb`, legality and `sampleInheritance` are all present. The 50 §9 T05 items are each met, if minimally: I checked the 1/3/9-spark expectations by hand, including affinity 19 → p 0.812 → 49.488 and the 9-spark vector and covariance 95.338. The 01 §11 `affinity(a,b)` / `affinity(a,b,c)` over groups plus optional pairs matches the schema and T03's groups-only published file. The P1–P2 term and per-source multiplier are an assumption (Q-81, not verified game fact), which is acceptable since it is declared.
2 Correctness: issues (B1, S5, N1). With real master data, the probe gave MC vs exact agreement on stats, hints and aptitudes; missing sparks were skipped; guest and trainee-character grandparents were handled; the zero-event path works.
3 Test quality: issues (S1–S4, N3, N4). The 7 tests are real and deterministic (seeded mulberry32), with no tautologies or skips, but coverage is thin. The changelog counts match my re-run: schema 146, master-data 82, web 5, api 86, engine 7.
4 Fabrication: ok. All constants come from `rules` via `ctx.tables`, and I found no hard-coded game numbers in src. The fixture values are labelled "synthetic fixture". UNKNOWN placeholders surface as `placeholderRules` and `validated:false`. The model metadata issue is in S6.
5 Security: ok. The formula has its own parser with no eval/`new Function`, and only the `affinity` identifier is accepted. The package has no network access or secrets and no routes.
6 Free-tier: ok (pure client-side engine, no services).
7 Scope: ok. Only `packages/engine/**`, plus `docs/OPEN_QUESTIONS.md` and `pnpm-lock.yaml`, both declared as cross-task edits. Nothing under `src/model|predict|rank`.
8 Maintainability: issues (S7, S8, N5). Structure is clear, strict TS, zod pinned at 4.6.5, and `@uma/master-data` is used for types only.

## Commands run
$ git diff --stat main...HEAD
 docs/OPEN_QUESTIONS.md | 6 + ; docs/changelog/T05-inheritance.md | 87 ; packages/engine/{package.json,tsconfig.json,vitest.config.ts,src/{context,formula,index,rng,types}.ts,src/inheritance/{affinity,inheritance,legality}.ts,src/scenarios/index.ts,test/inheritance/toy.test.ts} ; pnpm-lock.yaml | 12 +
 16 files changed, 1423 insertions(+)

$ pnpm install --frozen-lockfile
Already up to date
Done in 284ms using pnpm v11.22.0

$ pnpm -r lint
packages/engine lint$ eslint src test vitest.config.ts
packages/engine lint: Done   (schema, master-data, api, web: Done)

$ pnpm -r typecheck
packages/engine typecheck$ tsc -p tsconfig.json
packages/engine typecheck: Done   (others: Done)

$ pnpm -r test
packages/schema: 146 passed; packages/master-data: Test Files 3 passed (3) Tests 82 passed (82)
apps/web: Test Files 1 passed (1) Tests 5 passed (5); apps/api: Test Files 8 passed (8) Tests 86 passed (86)
packages/engine test: Test Files 1 passed (1) Tests 7 passed (7)

$ git status --short
(empty — no tracked changes; probes lived in ~/.hermes/cache/scratch/t05probe)

$ node --experimental-transform-types probe.mts   # real global-20260930 bundle, public inheritanceExpectation with RosterVeterans (guest GP)
unverified 12 placeholders [ 'blueStatGain', 'whiteHintLevels' ]
legacy true 2 [ [ true, 1 ], [ true, 2 ] ]
real result [ 0, 0, 0, 42, 0 ] [] false false [ {spark:does-not-exist, GP1b}, {spark:does-not-exist, GP2b} ] 1
affinity 87 T-P1=19 T-P2=23 P1-P2=20 T-P1-GP1a=9 T-P1-GP1b=0 T-P2-GP2a=15 T-P2-GP2b=1
same vet: illegal parent pair: same-veteran, same-parent-character
MC stats [ 4.807, 0, 0, 48.021, 0 ] exact [ 4.824, 0, 0, 48.034, 0 ]
MC hints { 'skill:nakayama-racecourse-2': 0.12828 } exact 0.12777821063757744
MC apt dirt { G: 41381, F: 8039, E: 562, D: 18 } exact { G: 0.8281, F: 0.1599, E: 0.0116, D: 0.00037 }
formula "affinity +" / "eval(1)" / "1/affinity" / "Math.max(1,2)" / "2*(affinity" / "": load RulesError
formula "1/(affinity-5)": accepted
bad rejected RulesError (pinkGradeGain 0.5); bad rejected RulesError (grandparentWeight NaN)

$ node probe.mts
SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript parameter property is not supported in strip-only mode (legality.ts:18)

$ node --experimental-transform-types b1.mts
expectedStatGain [ 0, 0, 0, 42, 0 ] sum(contributions.stats) [ 0, 0, 0, 0, 0 ]
runtime FormulaError formula "1/(affinity-39)" is not finite at affinity=39
negative mult p [ 0, 0 ]
