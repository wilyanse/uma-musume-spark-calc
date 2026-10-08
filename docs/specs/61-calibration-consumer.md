# 61 — Browser calibration diagnostics (T15b)

## Scope and dependency
T15b delivers the S07 Run calibration/report workflow using reviewed T15, not rule application. Depends on merged T13/T15. F12/M4 real-roster verification remains H4; this task can exercise synthetic and published contexts now. Explicit apply/refit is a separate T15c task: there is no approved persisted override contract, and snapshots lack a rule-context fingerprint suitable for safe reuse. Do not invent an API or silently persist overridden snapshots under the published context.

Authoritative 01 and ADR-0002 win. Existing approved S07 tokens/layout/bindings apply, reconciled here to actual producer exports. `CalibrationReport` is engine-local, not shared API schema. Fetching snapshots remains training-v2-first as implemented, with legacy display/refit safeguards; the old design binding's training-v1-only fetch is superseded.

## Ownership
`apps/web/src/screens/Health.tsx`, focused calibration components/hooks/helpers, worker engine.api/client plumbing, associated web unit/browser tests and T15b evidence. Minimal test-double interface updates elsewhere allowed and declared. No engine production/schema/API/master/golden changes; no dependency additions without need. Existing model-fit/ranking semantics remain unchanged.

## Worker boundary
Add typed calibration call using actual `calibrateRules` and `CalibrationReport` exports. Only worker executes calibration. Inject valid time/report-id through serializable arguments following existing fit conventions; no function parameters across Comlink. Use actual context already configured (published production, synthetic golden only fixture build). Main-thread imports of engine are type-only. Client job must use existing cancellation/generation mechanism: termination cancels synchronous calculation, late completion cannot overwrite a newer result; reconfigure after recreation.

Calibration is read-only: no mutation of active context, snapshot, persisted fit record, query caches for model/roster, or backend writes. Report stays in this tab/UI session and is dismissed explicitly. No fake progress percentages (engine has no progress callback): show indeterminate running status and Cancel.

## S07 states and provenance
Enable Run calibration when roster and context are ready, even without a model snapshot. Guard same-tick double clicks/refit conflicts, not only disabled attributes. Calibration/refit have one shared active-job authority; route unmount cancels only the owned current job. Capture run provenance: context kind, master/rules versions, roster revision/ETag plus content identity as needed. Roster/master/context changes mark old report stale or clear it, invalidate in-flight authority and refuse late responses. Never relabel stale diagnostics as current. A cancelled/crashed/typed-error result has accessible text and a retry path; retry calls real worker.

Empty/insufficient/partial/nonidentifiable reports are successful diagnostic outcomes, not generic exceptions. Published zero-placeholder rules normally cannot recommend a multiplier; show reasons, never synthetic success in production.

## Report display
Use actual report fields, not prototype names. Show population used/excluded and split train/holdout counts, context/version/synthetic provenance, report status, warnings and unsupported/notCalibrated rules. Report "complete" means checks available, not verified mechanics or milestone acceptance.

Stats: current and no-inheritance MAE, selected/train-CV multiplier and `holdoutMaeOfTrainCvSelection`, confidence availability and conditional bootstrap interval, boundary/ties/disagreement reasons, and identification basis/saturation/confounded stats/fold failures. Selection authority is `stats.status` and nonidentifiable reasons, NOT `stats.identification.status` alone: raw rank diagnostic can say identified while selection is blocked. 'Identified' means numerically non-collinear, not well-determined. Null metrics display unavailable, never 0; no call to toFixed on null.

Aptitudes: fullLikelihood state and null full log-likelihood when any impossible observation; conditionalLogLik labelled conditional with possibleCells denominator, not presented as full fit. Impossible below/above/unreachable and invalidObserved counts; all-degenerate uninformative status visible even with finite diagnostic likelihood. Skills: actual likelihood/Brier status and scored-cell denominators; no cells => unavailable, no perfect zero. q counted once by producer; consumer does not recompute probabilities.

Suggested multipliers, when present, may be displayed as unverified proposals only. Apply is absent or disabled with explicit 'rule override/apply-and-refit integration not yet available' explanation. No local override write, engine context change, model store or automatic refit. Dismiss clears report only. Refit remains functional and unaffected.

## Acceptance and verification
- Test first. Worker real-call regression validates synthetic planted x1.3 suggestion within [1.2,1.4] and production placeholder nonidentifiability/null likelihood; never fabricate engine responses as evidence. Seed/inject inputs/time and retain existing golden fixtures unchanged.
- Client cancellation/supersession/crash/reconfigure tests, including calibration versus fit/rank overlap and late replies.
- Health tests: no-snapshot run, loading/running/empty/errors/cancel/retry/dismiss, insufficient/partial/nonidentifiable, zero/null/impossible/invalid fields, fold gate despite raw identified, unavailable confidence, synthetic label, stale source and same-tick action guards. Fake UI fixtures permitted for specific render branches, clearly distinguished from real worker evidence.
- Actual Playwright Comlink workflow: Health → calibration → report, production-placeholder unavailable path and fixture synthetic result; run/cancel/retry/navigation and stale authority exercised. Serious/critical axe violations zero for Health both themes. Capture desktop/mobile light/dark evidence in docs/changelog/assets/T15b. Fixture report must not depend on truth latent coefficients.
- `pnpm -r lint && pnpm -r typecheck && pnpm -r test`, scoped web build, check:dist (no fixture leakage), browser tests pass. Main gzip <=250kB excluding worker; report actual sizes. No `pnpm -r build`, master/golden refresh, deployment or publication.
- Required task changelog with exact real command outputs, decisions, cross-task edits, remaining T15c/H4/Q3/Q5. Clean candidate and fresh independent review before local merge. At most two bounded worker fix rounds.
