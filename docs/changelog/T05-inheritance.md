# T05 — Engine: inheritance and scenarios

- **Status:** Done
- **Branch:** task/T05-inheritance
- **Agent / model:** initial implementation (session 20260930_163135_c56e91): requested claude-opus-5-5 (anthropic), medium effort; the model that actually ran is uncertain (profile-level fallback to gpt-5.6-luna-900k was enabled, and the earlier line here was an unverified self-identification). Review round 1 fix: requested claude-opus-5-5 (anthropic), medium effort, profile fallback disabled.
- **Date:** 2026-09-30

## Summary
Implemented the pure TypeScript T05 engine package: validated rule/context loading, seeded RNG, data-driven scenario plugins, affinity calculation, legality checks, exact inheritance expectations, aptitude convolution, skill-hint probabilities, covariance, and seeded Monte Carlo sampling.
The public inheritance/context/result types are exported for T06/T08. Published Global data is treated honestly: its `inheritanceTurns: []`, `verified:false` rules, and UNKNOWN zero placeholders are surfaced in provenance rather than presented as validated game predictions.

## Files
Created:
- `packages/engine/package.json` — workspace package and scripts.
- `packages/engine/tsconfig.json`, `packages/engine/vitest.config.ts` — strict TS/Vitest configuration.
- `packages/engine/src/index.ts` — public T05 API and types.
- `packages/engine/src/context.ts` — `loadContext`, resolved rule tables, provenance, and master indexes.
- `packages/engine/src/formula.ts` — small data formula parser; no `eval` or `new Function`.
- `packages/engine/src/rng.ts` — deterministic `mulberry32` and string seed helper.
- `packages/engine/src/types.ts` — public inheritance/planner/variance/sampling types.
- `packages/engine/src/scenarios/index.ts` — `ScenarioPlugin`, `DefaultScenario`, and plugin registry.
- `packages/engine/src/inheritance/{affinity,legality,inheritance}.ts` — affinity, legality, exact closed form, and sampling.
- `packages/engine/test/inheritance/toy.test.ts` — synthetic 1-, 3-, and 9-spark hand-computed mechanics and the contribution-sum invariant.
- Review round 1: `packages/engine/test/inheritance/{fixtures,roster,monte-carlo,rules-mutation,edge-cases}.test.ts` (fixtures.ts is a helper, not a test), `packages/engine/scripts/{published-bundle,smoke}.ts` (read-only published-bundle loader + plain-node smoke run).

Modified:
- `docs/OPEN_QUESTIONS.md` — Q-81, affinity decomposition uncertainty (moved to the end of Open in review round 1).
- `pnpm-lock.yaml` — workspace graph entry for `@uma/engine`.

## Decisions
- Affinity is data-driven from shared affinity groups plus optional pairwise entries. Triple affinity uses groups containing all three characters. The P1–P2 term is included in each parent source's affinity, matching the smallest interpretation of the cited calculator's parent term; missing race-win and epithet inputs are exposed as unsupported terms. Q-81 records the uncertainty.
- A scenario with `inheritanceTurns: []` performs no event rolls. This is intentional: T03 records Global turn numbers as unknown, so the engine does not invent turns.
- Blue initial bonuses are applied only to parent blue sparks and are constant; grandparents contribute event rolls but not initial bonuses. Each parent blue spark's `Contribution` carries its `initialBonus`, and it is included once in `expectedEffect.stats`, so Σ contributions.stats = `expectedStatGain`.
- Source/spec conflict (N2, for Q-3/T15): `rules.json` `blueInitialBonus.source` cites GameTora as "additive over every legacy and sub-legacy", i.e. grandparents would also give the bonus. 50 §3 says "the parents' (not grandparents') blue sparks". The spec is authoritative, so the engine keeps parents-only; T15 calibration (or a spec change) should settle it. If grandparents do contribute, the change is local to `planInheritance` (the `from === 'P1' || 'P2'` check).
- Green and white skill sparks produce hints from the target skill. Race/scenario effects are resolved from the open rule tables; absent table rows are skipped with warnings, never guessed.
- Formula evaluation supports the rules' `affinity` arithmetic grammar through a parser. Arbitrary code evaluation is not used.
- Every output carries provenance and a `validated` flag. `validated` is false for unverified/placeholder rules or unknown scenario events.
- Synthetic fixture values are intentionally marked `source: synthetic fixture`; they are mechanics tests, not game data.

## Deviations from spec
- `Legacy` is an explicit public T05 input because a RosterVeteran can have unmatched/guest parent identities while still carrying parent-owned sparks. `legacyFromVeteran` adapts matched roster veterans; T06 can construct the richer type from its own roster matching.
- The spec's affinity wording does not define whether parent-pair affinity belongs in the total or only in per-source activation affinity. The implementation includes it and documents the assumption in Q-81.
- `ScenarioPlugin.sparkEffects` (N5): 50 §2 writes `sparkEffects?(spark, ctx): Partial<Effect>`. Here it is `sparkEffects?({spark, stars}, ctx): Partial<Effect> | undefined`: the effect depends on the star count, and `undefined` means "keep the rules-driven default effect". An object replaces the default (missing fields = no effect).
- `loadContext(master, rules, options?)`: an optional third argument (`{plugins}`) injects scenario plugins by id before the built-in registry. The two-argument 50 §1 call is unchanged.
- `Contribution` gains `initialBonus: StatVector` (beyond 50 §3's field list) so the UI can show the career-start part of a spark's effect separately; it is also included in `expectedEffect.stats`.
- `EngineContext.affinityMultiplier` throws `RulesError` (not `FormulaError`) when the formula is non-finite or negative at the affinity it is evaluated at; `planInheritance` therefore throws `RulesError` for such a pair. A zero multiplier is allowed (p = 0).
- The published rules' race/scenario open-table shapes are resolved using the T03 export shape (`perStar`, `activation`, `races`, `scenarios`). Unknown/malformed optional rows warn and have zero effect rather than fabricating a value.

## Cross-task edits
- `docs/OPEN_QUESTIONS.md` — required Q-81 assumption record; outside the package Owns list.
- `pnpm-lock.yaml` — pnpm workspace dependency graph for the newly created owned package.
- Review round 1: no new cross-task edits. `docs/OPEN_QUESTIONS.md` is edited again (S7). The engine tests and smoke script read `apps/web/public/master/` read-only; nothing there is written.

## Verification
```
$ pnpm install --frozen-lockfile
Progress: resolved 377, reused 250, downloaded 1, added 0, done
Done in 6.3s using pnpm v11.22.0

$ pnpm -r lint && pnpm -r typecheck && pnpm -r test
Scope: 5 of 6 workspace projects
packages/schema lint: Done
packages/master-data lint: Done
apps/api lint: Done
apps/web lint: Done
packages/engine lint: Done
packages/schema typecheck: Done
packages/master-data typecheck: Done
apps/web typecheck: Done
apps/api typecheck: Done
packages/engine typecheck: Done
packages/schema test:  Test Files 4 passed (4)  Tests 146 passed (146)
packages/master-data test:  Test Files 3 passed (3)  Tests 82 passed (82)
apps/web test:  Test Files 1 passed (1)  Tests 5 passed (5)
apps/api test:  Test Files 8 passed (8)  Tests 86 passed (86)
packages/engine test:  Test Files 1 passed (1)  Tests 7 passed (7)

$ pnpm --filter @uma/engine lint
$ eslint src test vitest.config.ts
(done; the final full lint above also passed)

$ pnpm --filter @uma/engine typecheck && pnpm --filter @uma/engine test
$ tsc -p tsconfig.json
$ vitest run
Test Files 1 passed (1)
Tests 7 passed (7)
```

Tests include independent hand-computed expectations for 1, 3, and 9 sparks, aptitude probability normalization, illegal-pair rejection, rules substitution, and seeded 50,000-sample means within the requested 1% tolerance. No `pnpm -r build` was run, avoiding the published-master-data refresh.

## Open questions / follow-ups
- Q-81: Exact affinity decomposition (non-blocking); parent-pair inclusion and unavailable race/epithet terms are explicit in the result.
- Follow-up: T06 should use `Legacy` matching data for guest/unmatched parent records and consume the exported variance/sampling/legality types.
- Follow-up: T15 can calibrate the rules currently marked unverified/placeholders; the engine intentionally does not turn those outputs into validated game predictions.

## Review round 1
Review: `docs/reviews/T05-review-1.md` (CHANGES_REQUESTED). Fix run: requested claude-opus-5-5 (anthropic), medium effort, profile fallback disabled.

### Dispositions
- **B1 — fixed.** `expectationFromPlan` now starts each contribution's `expectedEffect.stats` from the activation's `initialBonus` (added once; `expectedStatGain` still gets it once through `plan.initialStatBonus`). `Contribution` also exposes `initialBonus` separately. Grandparent blue sparks get zeros. Tests: `toy.test.ts` "B1: Σ contributions.stats == expectedStatGain for 1/3/9 sparks and zero events" (synthetic rules, two-event and zero-event scenarios, component-wise `toBeCloseTo(…, 9)`, grandparent `initialBonus` all zero); "a grandparent blue spark rolls but gets no initial bonus"; `roster.test.ts` on the published Global bundle with zero events (`[21,0,5,0,0]`, the reviewer's failing case) and with synthetic injected turns. Reverting the fix makes 6 tests fail (checked by hand, then restored).
- **S1 — fixed.** `roster.test.ts` uses schema-valid `RosterVeteran`s (built through `RosterVeteran.parse`) and the published bundle: `legacyFromVeteran` maps self → legacy, parent1/parent2 → grandparents by `parents[].slot` (swapped array order gives the same legacy); a guest, unmatched (`matchedVeteranId: null`) grandparent keeps its character and sparks; `inheritanceExpectation` attributes P1/P2/GP1a/GP1b/GP2b; same veteran → `['same-veteran','same-parent-character']`; trainee character as P1 → `parent1-is-trainee-character` and as P2 → `parent2-is-trainee-character`; `inheritanceExpectation` equals `planInheritance(legacyFromVeteran…)`.
- **S2 — fixed.** `monte-carlo.test.ts`: 50,000 seeded draws per case on (a) a rich lineage where all six sources and all six activation kinds roll, all five stats move, turf/dirt get pink steps with the S cap, and three skills are hinted, (b) the 9-spark lineage, (c) 3 events with an unknown grandparent character. The constant initial bonus is subtracted before comparing means. Tolerances (documented in the file header): mean error ≤ min(5σ/√N, 1% of the exact mean) with σ² from the exact covariance diagonal; variance within 5%; every aptitude-grade and hint probability within 5√(p(1−p)/N); exact zeros (stats nothing moves, unreachable grades) must be exactly 0 in the samples.
- **S3 — fixed.** `rules-mutation.test.ts` mutates each table the engine reads (17 cases: the four `activation` tables, race/scenario activation, `grandparentWeight`, the affinity formula, `blueStatGain`, `blueInitialBonus`, `pinkGradeGain`, `whiteHintLevels`, race `perStar`/`stats`/`hintSkillIds`, scenario `perStar`/`stats`). Each case lists the observables that must change; all other observables must be identical. A guard test checks that every top-level rules key is covered, and a direction test checks signs. No engine formula is re-implemented in the assertions.
- **S4 — fixed.** `edge-cases.test.ts` covers: zero events (no rolls, zero covariance, hints 0, `eventsKnown:false`, `validated:false`, the warning text, and samples equal to the initial bonus); `validated` flipping on `verified:false` or an `UNKNOWN` source; unknown spark ids → `skipped` + warning and no bonus; recorded-vs-master type mismatch → master used + warning; race/scenario sparks with no rules row → warning and no effect; missing race `perStar`/`activation` and scenario `activation` → fallback warnings (exact list asserted); unreadable open tables (including a NaN inside `perStar`) → warning and zero effect, never NaN; `DefaultScenario` `statCap`/`inheritanceTurns`/`deckFeatures`; an injected plugin overriding `statCap`, turns, `deckFeatures` and `sparkEffects` (replace path and `undefined` fallback); a non-finite plugin effect → `RangeError`; fractional/negative `pinkGradeGain`, NaN weight, ∞ gain and schema-invalid rules → `RulesError`; 10 malformed formulas plus the empty formula; the S cap for a turf-A trainee (closed form and samples); normalisation of every aptitude distribution. To test a real plugin, `loadContext` gained an optional `{plugins}` argument (see Deviations).
- **S5 — fixed.** `EngineContext.affinityMultiplier` wraps the parsed formula: a non-finite value (pole) or a negative value at the affinity being evaluated throws `RulesError`. `FormulaError` no longer escapes `planInheritance`. It is still evaluated at 0 on load, so formulas that are already invalid there fail early. Tests use the lineage's actual P1 affinity (16): `1/(16-affinity)` loads, then `planInheritance` throws `RulesError` with the message asserted (not a `FormulaError`). `1 - affinity/10` loads (value 1 at 0, 0 at 10 is allowed) and then fails at affinity 16 with "is negative (-0.6000000000000001) at affinity=16". No `eval`/`new Function` (grep in Verification).
- **S6 — fixed.** The header now records the requested model (claude-opus-5-5, anthropic, medium) for session 20260930_163135_c56e91, says the model that actually ran is uncertain (possible profile fallback to gpt-5.6-luna-900k), and records this fix run's request (Opus 5.5 medium, fallback disabled).
- **S7 — fixed as directed.** The orchestrator's T05 prompt reserved Q-80–Q-89 for this parallel wave, so the ID stays **Q-81** (not Q-79). This reason is written into the entry. The stray "Blocking: no (for S03 only; T13 waits on this)" line under Q-81 is removed. Q-70 keeps its own original Blocking line (unchanged). The Q-81 entry moved from between Q-70 and Q-71 to the end of Open, after Q-78. `git diff main -- docs/OPEN_QUESTIONS.md` is now a pure 6-line append.
- **S8 — fixed.** The `IllegalPairError` parameter property is replaced by an explicit `readonly reasons` field assignment. The engine tsconfig sets `erasableSyntaxOnly: true`, so `tsc` rejects any future non-erasable syntax (enums, parameter properties, namespaces). The whole public API now imports and runs under plain `node` with no flag: `scripts/smoke.ts` (`pnpm --filter @uma/engine smoke`) loads the published bundle, runs `inheritanceExpectation`, `planInheritance`, `sampleInheritance` and the same-veteran rejection, and checks the B1 invariant.
- **N1 — fixed.** Hints are deduplicated per activation (same skill id → one entry, highest level), for both rules-driven effects and plugin effects. The toy rules have a `race-dup` row listing hint 9001 twice. The test checks one hint entry, closed form `1 − (1 − p)^2`, and MC agreement within 5σ over 50k draws. A second test checks that distinct activations still combine.
- **N2 — documented.** See Decisions: the `blueInitialBonus` source says "additive over every legacy and sub-legacy", but 50 §3 says parents only. The engine keeps the authoritative parents-only behaviour. The source comment in `planInheritance` points to it. Left for Q-3/T15.
- **N3 — fixed.** Toy fixtures live in `test/inheritance/fixtures.ts` and go through `CharactersFile`, `OutfitsFile`, `SkillsFile`, `SparksFile`, `AffinityFile`, `ScenariosFile` and `Rules` from `@uma/schema`. The published bundle is parsed with the same file schemas. All `as never` casts are gone (`grep -rn "as never" packages/engine` → none).
- **N4 — fixed.** Computed floats use `toBeCloseTo` per element (`expectVectorClose`). `toEqual` stays only on integer-valued or exactly representable results (initial bonuses, zero-event vectors).
- **N5 — documented** under Deviations (`sparkEffects({spark, stars}, ctx) → Partial<Effect> | undefined`), and in the `ScenarioPlugin` doc comment.
- **N6 — fixed.** The Verification output below is pasted from the actual runs (lines trimmed, nothing merged or paraphrased). Note: `(…)` marks removed lines.

### Verification (review round 1)
All commands were run from the worktree root on Node v25.9.0 / pnpm 11.22.0. `pnpm -r build` was not run.
```
$ pnpm install --frozen-lockfile
Scope: all 6 workspace projects
Already up to date
Done in 273ms using pnpm v11.22.0

$ pnpm -r lint
Scope: 5 of 6 workspace projects
packages/schema lint$ eslint .
packages/schema lint: Done
packages/master-data lint$ eslint src test vitest.config.ts
apps/web lint$ eslint .
apps/api lint$ eslint .
apps/web lint: Done
packages/master-data lint: Done
apps/api lint: Done
packages/engine lint$ eslint src test scripts vitest.config.ts
packages/engine lint: Done

$ pnpm -r typecheck
Scope: 5 of 6 workspace projects
packages/schema typecheck$ tsc -p tsconfig.json
packages/schema typecheck: Done
apps/api typecheck$ tsc -p tsconfig.json
packages/master-data typecheck$ tsc -p tsconfig.json
apps/web typecheck$ tsc -p tsconfig.json
packages/master-data typecheck: Done
apps/web typecheck: Done
apps/api typecheck: Done
packages/engine typecheck$ tsc -p tsconfig.json
packages/engine typecheck: Done

$ pnpm -r test
packages/schema test$ vitest run
packages/schema test:  Test Files  4 passed (4)
packages/schema test:       Tests  146 passed (146)
packages/schema test: Done
apps/web test$ vitest run
apps/api test$ vitest run
packages/master-data test$ vitest run
packages/master-data test:  Test Files  3 passed (3)
packages/master-data test:       Tests  82 passed (82)
packages/master-data test: Done
apps/web test:  Test Files  1 passed (1)
apps/web test:       Tests  5 passed (5)
apps/web test: Done
apps/api test:  Test Files  8 passed (8)
apps/api test:       Tests  86 passed (86)
apps/api test: Done
packages/engine test$ vitest run
packages/engine test:  Test Files  5 passed (5)
packages/engine test:       Tests  74 passed (74)
packages/engine test: Done

$ node -e "import('./packages/engine/src/index.ts').then(m => { console.log(typeof m.inheritanceExpectation, typeof m.loadContext, typeof m.IllegalPairError); console.log(Object.keys(m).length, 'exports') })"
function function function
23 exports

$ node packages/engine/scripts/smoke.ts        # plain node, no --experimental-transform-types
master global-20260930 rules rules-1 validated false eventsKnown false
placeholderRules blueStatGain,whiteHintLevels
affinity total 173 perSource {"P1":113,"P2":87,"GP1a":21,"GP1b":32,"GP2a":18,"GP2b":18}
expectedStatGain [21,0,5,0,0] sum(contributions.stats) [21,0,5,0,0]
contributions P1:spark:speed P1:spark:turf P2:spark:power P2:spark:medium GP1a:spark:stamina GP1a:spark:mile
sample [21,0,5,0,0]
same veteran -> same-veteran,same-parent-character
smoke ok

$ grep -rn "eval\|new Function" packages/engine/src
packages/engine/src/context.ts:63:   * `affinityMultiplier.formula`, parsed (never `eval`ed). Throws `RulesError` when the formula is
packages/engine/src/formula.ts:3: * not code, and no `eval`/`new Function` is needed.
packages/engine/src/formula.ts:103:function evaluate(n: Node, affinity: number): number {
(… only the AST `evaluate` helper and comments match)
```
Engine test list (`npx vitest run --reporter=verbose` in `packages/engine`, trimmed to names):
```
✓ toy.test.ts > … > computes affinity from shared groups, pairwise entries, and triples
✓ toy.test.ts > … > 1-spark lineage: affinity 19, p 0.812, initial bonus 30
✓ toy.test.ts > … > 3-spark lineage: exact aptitude and hint probabilities
✓ toy.test.ts > … > 9-spark lineage: stats, covariance and race/scenario effects
✓ toy.test.ts > … > B1: Σ contributions.stats == expectedStatGain for 1/3/9 sparks and zero events
✓ toy.test.ts > … > a grandparent blue spark rolls but gets no initial bonus
✓ toy.test.ts > … > rejects illegal pairs before scoring
✓ rules-mutation.test.ts > … > covers every rule key the engine reads
✓ rules-mutation.test.ts > … > activation.blue | activation.pink | activation.green | activation.white | raceSparkStatGain.activation | scenarioSparkEffects.activation | grandparentWeight | affinityMultiplier.formula | blueStatGain | blueInitialBonus | pinkGradeGain | whiteHintLevels | raceSparkStatGain.perStar | raceSparkStatGain.races[].stats | raceSparkStatGain.races[].hintSkillIds | scenarioSparkEffects.scenarios[].perStar | scenarioSparkEffects.scenarios[].stats   (17 separate tests, joined here for length)
✓ rules-mutation.test.ts > … > directions: lower activation/weight lowers the expectation; higher bonus raises it
✓ roster.test.ts > legacyFromVeteran (S1) > maps self -> legacy sparks, parent1/parent2 -> grandparents by parent slot
✓ roster.test.ts > legacyFromVeteran (S1) > uses parents[].slot, not array order
✓ roster.test.ts > legacyFromVeteran (S1) > keeps a guest, unmatched grandparent: its character and sparks are used
✓ roster.test.ts > inheritanceExpectation with RosterVeterans (S1, B1) > attributes self -> P, parent1 -> GPxa, parent2 -> GPxb
✓ roster.test.ts > … > published data, zero events: only the parents' initial blue bonus, attributed per spark
✓ roster.test.ts > … > published data + synthetic injected turns: race spark stats roll, sum invariant holds
✓ roster.test.ts > … > rejects the same veteran as both parents
✓ roster.test.ts > … > rejects a parent of the trainee's character in either slot
✓ roster.test.ts > … > equals planInheritance over legacyFromVeteran
✓ monte-carlo.test.ts > … > rich lineage: all five stats, turf/dirt with the S cap, three hints, GP/race/scenario effects
✓ monte-carlo.test.ts > … > 9-spark lineage from the hand-computed test
✓ monte-carlo.test.ts > … > 3 events with an unknown grandparent character
✓ edge-cases.test.ts > zero events and provenance (S4) > (2 tests)
✓ edge-cases.test.ts > unknown and mismatched sparks (S4) > (2 tests)
✓ edge-cases.test.ts > missing optional rule rows (S4) > (4 tests)
✓ edge-cases.test.ts > scenario plugins (S4, N5) > (3 tests)
✓ edge-cases.test.ts > malformed rules (S4) and the affinity formula (S5) > (20 tests: 5 malformed-rules cases, 10 malformed formulas, empty formula, grammar, pole at 0, pole at actual affinity 16, negative at actual affinity 16)
✓ edge-cases.test.ts > aptitude distribution: S cap and normalisation (S4) > (2 tests)
✓ edge-cases.test.ts > duplicate hints within one activation (N1) > (2 tests)
✓ edge-cases.test.ts > legacy with unknown grandparent character > rolls the grandparent's sparks with affinity 0
```
Regression check (run by hand, source restored afterwards; `git diff` confirmed no leftover change):
```
# contribution stats started from zeros() again (pre-B1):          Tests  6 failed | 68 passed (74)
# per-activation hint dedupe removed (pre-N1):                      Tests  4 failed | 70 passed (74)
# negative-multiplier check disabled (pre-S5):                      Tests  1 failed | 73 passed (74)
```

### Remaining limitations
- Published Global data still gives `inheritanceTurns: []` for every scenario, so real-data outputs are the parents' initial blue bonus only (`eventsKnown:false`, `validated:false`). Event-driven real-data behaviour is tested only with synthetic injected turns. Q-5 and Q-3 are unchanged.
- The parents-only initial bonus (spec) conflicts with the cited source (every legacy and sub-legacy); left to Q-3/T15 (N2).
- Q-81 (affinity decomposition, race-win/epithet terms unsupported) is still an assumption, not a verified game fact.
- The negative-multiplier and pole checks run at the affinities that actually occur. A formula that is only invalid at affinities no pair reaches is accepted. Rules that are invalid at the affinity of some pair make `planInheritance` throw for that pair, so T06 should catch `RulesError` per pair (or treat it as fatal for the rules file).
- T06 (model/predict/rank) is not implemented here, by design.
