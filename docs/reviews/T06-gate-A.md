# T06 — Orchestrator gate A

Candidate: `8e0a27aae4c8a83001dd8cf0eb9a71561721b953`, branch `task/T06-training-prediction`. This is parent verification, not the independent review verdict. Scope includes declared minimal context/export/test/bench plumbing and authorized T05b reference follow-ups. Task worktree stayed clean.

## Workspace verification

Run from the task worktree; every command exited 0:
```
pnpm install --frozen-lockfile
pnpm -r lint
pnpm -r typecheck
pnpm -r test
pnpm --filter web build
pnpm exec tsc -p docs/reference/model-semantics/tsconfig.json
pnpm exec eslint docs/reference/model-semantics
node --test 'docs/reference/model-semantics/test/*.test.ts'
pnpm exec prettier --check packages/engine/src packages/engine/test/model packages/engine/test/predict packages/engine/test/rank packages/engine/bench packages/engine/package.json packages/engine/tsconfig.json packages/engine/vitest.config.ts docs/reference/model-semantics docs/changelog/T06-training-prediction.md
git diff --check main...HEAD
git status --short
```
Real trimmed output:
```
Already up to date
Done in 295ms using pnpm v11.22.0
packages/schema test: Tests 149 passed (149)
packages/master-data test: Tests 82 passed (82)
apps/web test: Tests 5 passed (5)
apps/api test: Tests 111 passed (111)
packages/engine test: Tests 215 passed (215)
✓ 146 modules transformed.
✓ built in 105ms
ℹ tests 23
ℹ pass 23
ℹ fail 0
All matched files use Prettier code style!
```
All workspace lint/typecheck jobs reported Done. Evidence lint/typecheck, diff check and final status had no output. The web shell still does not import the production engine; this web build is not proof of complete web integration.

## Node 22 acceptance

The worker measured Node 25.9.0. Parent obtained the official Node **22.18.0 darwin-arm64** archive into scratch, without modifying global runtime or repository dependencies. An initial `npm exec --yes --package=node@22.18.0 -- node --version` timed out after 180s; direct download from `https://nodejs.org/dist/v22.18.0/` succeeded. Archive SHA256 checked against official `SHASUMS256.txt`: `2c12913cba67af77ded8a399df3fd91c2e7f8628c7079da40bb9ff33bf00dfc0`.

From task `packages/engine`:
```
/Users/willjose/.hermes/cache/scratch/node-v22.18.0-darwin-arm64/bin/node ../../node_modules/vitest/vitest.mjs run
/Users/willjose/.hermes/cache/scratch/node-v22.18.0-darwin-arm64/bin/node ../../node_modules/vitest/vitest.mjs bench --run --reporter verbose
```
Both exited 0. Real output:
```
Test Files 15 passed (15)
Tests 215 passed (215)
[T06 bench] rankPairs legal pairs 32667, #1 01M1RX152GP86FAQ1WPY0MX60J|01M379DKQ86T9BGV6696R6DWN2; samples 5, mean 3405.6 ms, min 3370.4 ms, max 3433.0 ms; node v22.18.0 darwin/arm64
[T06 bench] fit+rank legal pairs 32667; samples 5, mean 3669.2 ms, min 3604.5 ms, max 3772.0 ms
Test Files 1 passed (1)
Tests 2 passed (2)
```
Each benchmark performs one warmup and five measured iterations. Both slowest measured runs are below 5000ms. Vitest warned about module export getter overhead; this is a tool caveat, not a browser timing result.

Parent also ran `pnpm --filter @uma/engine bench --reporter verbose` on the active Node 25.9.0: ranking mean 2966.4ms / max 2986.4ms; fit+rank mean 3085.3ms / max 3100.4ms; both tests passed.

## Retained evidence and unchanged inputs

Both commands ran twice, each exit 0:
```
node docs/reference/model-semantics/probes/q123-covariance.ts --splits 40 --write
node docs/reference/model-semantics/probes/q124-skills.ts --write
```
The final SHA256 values matched the pre-run committed files exactly:
- q123: `3eaaf67d23f239962893c31b72a4822aac8dbcbdf57a71c6f94922631503d08b`
- q124: `c21ed3f85c9524d47037acc9714bb3adf725601b4e5087f972a574e75ec9b5e9`

`git diff --exit-code main...HEAD -- packages/engine/test/golden apps/web/fixtures apps/web/public/master packages/master-data` exited 0 with no output. No recursive build, golden generation, master-data refresh, push or deployment.
