# Changelog

The orchestrator adds one line per merged task. Details are in `docs/changelog/Txx-*.md`.

## Unreleased
- T18: native SQLite advisory remediation via exact SQLitePCLRaw bundle2.1.12; actual engine3.53.3 and published x64 DLL verified; independent PASS r1, merged Core420/Portable230/bundle15/15/regression62 passed with all-transitive audit. Native H4 and recipient-notice T19 remain gates.
- T16b: key-free image processing with calibrated resampling, checksum/stream-end validation and bounded PNG input; independent PASS r3, merged Core414/Portable230, audited Release cross-build/publish and regression62 pass. SQLite remediation, recipient notices and native/live acceptance remain separate.
- T17: user-approved capture-status training eligibility, preserved raw scores, conservative legacy fallback and policy-bound model refits; independent PASS r2, merged engine360/web239/browser18 and full workspace/build checks pass. Native licensing and live/real-roster acceptance remain.
- T15c: explicit fit-before-commit browser-local rule application, fingerprint-bound model reuse/ranking, reset and cross-tab guards; independent PASS r2, merged web229/browser18 and production checks pass. Real-roster/native/cloud validation remains.
- T15b: read-only S07 calibration through real Worker/Comlink with cancellation, stale-input guards and truthful diagnostics; independent PASS r1, merged web164/browser16 and production build checks pass. Explicit apply/refit and real-roster validation remain.
- T15: engine calibration reports with train-design/fold identification guards, truthful likelihoods and deterministic synthetic evidence; independent PASS r4, merged engine329/workspace/build checks pass. Real-roster calibration and browser consumer remain pending.
- T10b: reviewed support-card capture/sync integration with destructive confirmation, settings/token-bound attempts and stale/drop/exit guards; PASS r2, merged Core302/portable225 and workspace checks green. Native Windows/H4 and live PUT remain.
- T13: seven web screens and real Comlink engine integration; independent PASS r3, merged web124/browser14 checks green, real-browser ranking <5s. Live Cloudflare/Access and real imports remain pending.
- T10: bounded Windows capture shell, durable-enqueue backpressure and overflow upload guards; independent PASS r3, merged cross-target build and Core302/portable157 tests pass. Native H4 and card-shell integration remain pending.
- T11: support-card collection and whole-table sync with session/revision freshness guards; independent PASS r3, merged native tests 302/302. T10 wiring, real-game H4 and live PUT remain pending.
- T09: screen/OCR parsers, completeness-gated assembly and durable acknowledged uploads; independent review PASS r3 after two fix rounds. Native .NET8 tests 166/166; H4 Windows/real-game and six art-only deck identities remain unverified.
- T06: training-v2 model fitting, child prediction, target scoring and legal-pair ranking; review CHANGES_REQUESTED r1 → PASS r2, merged checks green. Node22 benchmark passes; browser timing and retained-sample re-score validation follow-ups remain.
- T05b: accepted model-statistical semantics, reproducible covariance/skill evidence and legacy-compatible training-v2 snapshots; independent review PASS r1. Q-123/Q-124 resolved, unblocking T06; nonblocking reference follow-ups carried into T06.
- Specs, architecture and OCR feasibility spike (initial commit).
- T01: pnpm monorepo, `@uma/schema` zod contracts + JSON Schema export, fingerprint + 7 cross-language vectors, empty .NET solution. Review PASS r1.
- T02: Hono Worker skeleton (health, D1/R2/assets bindings) + React/Vite SPA skeleton (routes, Comlink engine worker stub, fixture switch). Review PASS r1.
- T01b: contract hardening: per-owner spark flag, ULID ids, unique card sync, ajv-validated JSON Schemas, `checkMasterIds`, `CAPTURE_RULES` / `OWNED_CARDS_SYNC_RULES` descriptors. Review CHANGES_REQUESTED r1 → PASS r2.
- T07: seven screen prototypes, design tokens, bindings and 21 exports; review CHANGES_REQUESTED r1 → PASS r2. Human design approval received.
- T04: API core (ingest, roster, reviews, targets, owned cards, history); review CHANGES_REQUESTED r1 → PASS r2. Concurrent review-resolution follow-up remains.
- T03: Global master-data bundle, stable IDs, card-art hashes and deterministic offline build; review CHANGES_REQUESTED r1 → PASS r2. Crop-alignment calibration remains.
- T05: inheritance engine, scenario plugins, affinity/legality, exact expectations and seeded sampling; review CHANGES_REQUESTED r1 → PASS r2. Engine outputs remain validated:false until Global inheritance turns and rules are verified.
- T12: CI, trusted serialized deploy, encrypted D1 backups, agent release and Cloudflare runbooks; review CHANGES_REQUESTED r1 → PASS r2. Real deployment, backup restore and Worker CPU remain H2 checks.
- T04b: guarded concurrent review corrections, owner-block/skill index remapping and retirement, slot-order and correctable-path rules; review CHANGES_REQUESTED r1, r2 → PASS r3 (r2/r3 fixes by orchestrator). Retired audit rows are hidden from GET.
- T08: deterministic 260-veteran golden dataset, planted effects/best/trap pairs, calibration variant and non-leaking feasibility tests; review CHANGES_REQUESTED r1/r2 → PASS r3. Q-123 covariance semantics must be resolved before T06.
