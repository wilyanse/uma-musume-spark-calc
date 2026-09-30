# T05 — Engine: inheritance and scenarios

- **Status:** Done
- **Branch:** task/T05-inheritance
- **Agent / model:** gpt-5.6-luna-900k, medium effort
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
- `packages/engine/test/inheritance/toy.test.ts` — synthetic 1-, 3-, and 9-spark mechanics, convolution, legality, rule swapping, and 50k-sample property coverage.

Modified:
- `docs/OPEN_QUESTIONS.md` — Q-81, affinity decomposition uncertainty.
- `pnpm-lock.yaml` — workspace graph entry for `@uma/engine`.

## Decisions
- Affinity is data-driven from shared affinity groups plus optional pairwise entries. Triple affinity uses groups containing all three characters. The P1–P2 term is included in each parent source's affinity, matching the smallest interpretation of the cited calculator's parent term; missing race-win and epithet inputs are exposed as unsupported terms. Q-81 records the uncertainty.
- A scenario with `inheritanceTurns: []` performs no event rolls. This is intentional: T03 records Global turn numbers as unknown, so the engine does not invent turns.
- Blue initial bonuses are applied only to parent blue sparks and are constant; grandparents contribute event rolls but not initial bonuses.
- Green and white skill sparks produce hints from the target skill. Race/scenario effects are resolved from the open rule tables; absent table rows are skipped with warnings, never guessed.
- Formula evaluation supports the rules' `affinity` arithmetic grammar through a parser. Arbitrary code evaluation is not used.
- Every output carries provenance and a `validated` flag. `validated` is false for unverified/placeholder rules or unknown scenario events.
- Synthetic fixture values are intentionally marked `source: synthetic fixture`; they are mechanics tests, not game data.

## Deviations from spec
- `Legacy` is an explicit public T05 input because a RosterVeteran can have unmatched/guest parent identities while still carrying parent-owned sparks. `legacyFromVeteran` adapts matched roster veterans; T06 can construct the richer type from its own roster matching.
- The spec's affinity wording does not define whether parent-pair affinity belongs in the total or only in per-source activation affinity. The implementation includes it and documents the assumption in Q-81.
- The published rules' race/scenario open-table shapes are resolved using the T03 export shape (`perStar`, `activation`, `races`, `scenarios`). Unknown/malformed optional rows warn and have zero effect rather than fabricating a value.

## Cross-task edits
- `docs/OPEN_QUESTIONS.md` — required Q-81 assumption record; outside the package Owns list.
- `pnpm-lock.yaml` — pnpm workspace dependency graph for the newly created owned package.

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
