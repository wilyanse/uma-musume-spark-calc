# Model-semantics evidence (T05b, ADR-0002)

Executable evidence for `docs/adr/0002-model-statistical-semantics.md`: the Q-123 covariance
estimator and the Q-124 skill-acquisition likelihood. This is **reference code, not the production
engine**. T06 re-implements the same rules in `packages/engine/src/`. Nothing here is imported by
a workspace package, and nothing here changes golden data, master data or engine source.

## Layout

| Path                        | What                                                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/linalg.ts`             | Deterministic cyclic Jacobi eigen-decomposition, PSD flooring, typed `NumericError`                                                                   |
| `src/covariance.ts`         | Q-123 estimator Σ_N (OOF, uncentred, same-weighted C̄ subtraction, PSD), Gaussian coverage, holdout bias, Box–Muller MVN draws                         |
| `src/skills.ts`             | Q-124 exposure-aware posterior (tanh-sinh quadrature, moment-matched Beta), global prior, brute-force cross-check                                     |
| `src/synthetic.ts`          | SYNTHETIC skill fixtures (known θ), naive baselines, repeated-sampling check                                                                          |
| `src/golden.ts`             | Adapter to the committed T08 golden files via the T08 test-only helpers (`packages/engine/scripts/golden-diagnostic.ts`)                              |
| `src/output.ts`             | Writes results as Prettier-formatted JSON so reruns are byte-identical                                                                                |
| `probes/q123-covariance.ts` | Golden Q-123 probe: stored split, rejected option A, no-leakage, MC-vs-Gaussian variance, small samples, fold sensitivity, optional robustness splits |
| `probes/q124-skills.ts`     | Q-124 probe: synthetic examples + golden reliability and best-pair/trap feasibility for four skill estimators                                         |
| `test/*.test.ts`            | `node:test` diagnostic tests (synthetic, seeded)                                                                                                      |
| `results/*.json`            | Compact machine-readable output of the two probes (committed)                                                                                         |

## Commands (repo root, Node ≥ 22.18; uses only existing workspace dev dependencies)

```sh
node --test 'docs/reference/model-semantics/test/*.test.ts'
node docs/reference/model-semantics/probes/q123-covariance.ts --splits 40 --write   # ~16 s
node docs/reference/model-semantics/probes/q124-skills.ts --write                   # ~4 s
./node_modules/.bin/tsc -p docs/reference/model-semantics/tsconfig.json
./node_modules/.bin/eslint docs/reference/model-semantics
```

Both probes are deterministic: every RNG is `mulberry32(seedFromString(label))` with the label in
the output, and running them twice gives byte-identical `results/*.json` (sha256 in the T05b
changelog).

## Information rules

- Estimators read only what T06 will have: roster rows of the **train** split, the recorded
  lineage, and the T05 closed form (`expectationFromPlan`: `statGainCov`, `skillHintProb`).
- The holdout is used only for evaluation (MAE/coverage/bias/reliability). The no-leakage check
  perturbs holdout y and asserts bit-identical λ, β and Σ_N.
- Planted values from `truth.json` appear only in blocks labelled `ORACLE` (and the Q-122 card
  recovery check, which is the 50 §9 acceptance itself). They never feed an estimator.
- Synthetic parameters (`src/synthetic.ts`, tests, probe part A) are labelled SYNTHETIC. They are
  not game facts.
