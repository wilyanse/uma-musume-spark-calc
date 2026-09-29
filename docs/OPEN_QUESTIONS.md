# Open questions

Agents append entries here (format in `AGENTS.md`). The orchestrator moves answered ones to **Resolved**.

## Open

## Q-1 (spec) Can grandparent portraits be tapped to open a Sparks popup?
Context: a candidate parent's own parents are the child's grandparents. Their *sparks* are visible on the candidate's Inspiration tab, but their *character identity* (needed for affinity) shows only as a portrait on Career Info.
Assumption taken: identify grandparent characters by matching the portrait against master-data character icons (30-capture-agent §6.4). If tapping works, that becomes the fallback.
Blocking: no (human checkpoint H3)

## Q-2 (spec) What does the Veteran List screen look like?
Context: auto-navigation (F13) needs the veteran list layout and its sort/scroll behaviour. No screenshot yet.
Assumption taken: F13 is deferred to milestone M5; assisted mode doesn't need it.
Blocking: no for M1–M4 (human checkpoint H3)

## Q-3 (spec) Global inheritance constants
Context: activation base rates, stat gain per star, initial blue-spark bonus, race-spark stat gains and affinity point tables for Global aren't verified.
Assumption taken: T03 sources community-documented values into `rules.json` with `verified:false` and citations. T15 calibrates them against the user's roster.
Blocking: no

## Q-70 (T07) No endpoint to dismiss a review item
Context: S03 has a "Dismiss" action (spec 10 §3). 01 §9 only defines `POST /review-items/:id/resolve`; the D1 `review_items.status` CHECK allows `dismissed`.
Assumption taken: the design keeps the action and expects `POST /api/v1/review-items/:id/dismiss` (no body) → `204`, or a `status` field on the resolve call. Needs a 01 §9 decision (T01/T04).
Blocking: no (for S03 only; T13 waits on this)

## Q-71 (T07) Response shape of `GET /api/v1/owned-cards`
Context: S04 shows the last sync time and "Held n / 255". 01 §4 defines the PUT body only; the GET response isn't specified.
Assumption taken: GET returns `{ syncedAt, heldCount, cards: [{cardId, lb, level, confidence}] }`.
Blocking: no

## Q-72 (T07) `CmTarget` has no timestamps
Context: S05 lists "updated <date>". `cm_targets` has `created_at`/`updated_at` columns but `CmTarget` (01 §10) has no such fields.
Assumption taken: the API adds read-only `createdAt`/`updatedAt` (ISO UTC) to the response. If not, the design drops the date.
Blocking: no

## Q-73 (T07) Portrait / card art source
Context: no game art is stored (20-master-data §4: hashes only), so the design uses initials placeholders for characters and a hatched block for cards.
Assumption taken: v1 ships placeholders. A later task may add user-supplied art. The slot sizes stay fixed.
Blocking: no

## Q-74 (T07) S07 scatter plots need held-out predicted/actual points
Context: `ModelSnapshot.params.holdout` (01 §13) holds only `mae` and `coverage80`. Spec 10 §3 requires a predicted-vs-actual scatter per stat.
Assumption taken: 01 §13 gains `holdout.points: Record<StatKey, {predicted:number, actual:number}[]>` (≤ 60 rows each). Needs a contract change (T01 owner + ADR).
Blocking: no (only S07 charts)

## Q-75 (T07) `CalibrationReport` shape and storing rule overrides
Context: S07 shows the calibration result and an "Apply suggested multipliers" action. 50 §8 names `CalibrationReport` but 01 doesn't define it, and there's no place to persist applied multipliers.
Assumption taken: `CalibrationReport = {multipliers: Record<string, number>, aptitudeLogLik: number, skillBrier: number, ranAt: string}`. Applied multipliers are stored locally (browser) as rule overrides until a contract exists.
Blocking: no

## Q-76 (T07) Per-skill sample size for "low data"
Context: spec 10 §2 wants n shown on every prediction and "low data" at n < 10. The snapshot stores Beta `{a,b}` per skill, not the count of observations.
Assumption taken: n = `a + b − (a0 + b0)`, with the prior from the `'*'` entry. Better to store `n` explicitly in `skillAcquire`.
Blocking: no

## Q-77 (T07) Where the draft deck and planner settings persist
Context: S04's deck builder and S06's settings have no API contract (`owned_cards` and `cm_targets` only).
Assumption taken: browser local storage, single device. No server storage.
Blocking: no

## Resolved
- R-1: parents can't be the same character as each other or as the trainee. (user, 2026-09-29)
- R-2: train mode is detected from the epithet: "Independent Learner" means independent, anything else means manual. The user never changes epithets. (user, 2026-09-29)
- R-3: community master data (e.g. GameTora) is acceptable, after checking terms. (user, 2026-09-29)
- R-4: the capture agent runs on the user's Windows PC. Everything else is built and tested on macOS. (user, 2026-09-29)
- R-5: game client is Global (English) on Steam, 1920×1080 reference resolution. (user, 2026-09-29)
