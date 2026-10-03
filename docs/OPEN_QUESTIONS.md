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

## Q-4 (T04) Roster size claim in 40 §4 does not hold at 2,000 veterans
Context: 40 §4 says the roster "stays < 2 MB at 260–2,000 veterans". A `RosterVeteran` carries ~33 sparks (all three owners), 14 skills, a deck and parents: ~4.7 KB of JSON each. Measured (test/roster-benchmark.test.ts): 260 veterans = 1.23 MB, 2,000 = 9.4 MB. The 2 MB bound holds only up to ~440 veterans.
Assumption taken: the API returns the full roster as specified (ETag/304 keeps repeat reads cheap). The 2,000 case is recorded, not asserted. If it matters, T06/T13 can compress (gzip at the edge already applies) or 40 §9 can add a slim roster projection.
Also: the 10 ms Worker CPU budget (40 §4) is very likely exceeded by a full-roster read at 2,000 veterans (wall-clock in miniflare: ~230 ms; 260 veterans: ~30 ms; not a CPU measurement). Free-tier CPU can't be measured locally; confirm on the first real deploy (H2). Mitigation available: the 304 path is ~1-2 ms and the web should cache by ETag.
Blocking: no

## Q-5 (T03) Missing master-data facts: inheritance turns, card vocab kind
Context: (a) 01 §11 `scenarios.inheritanceTurns` needs the Global turn numbers of the two inspiration events; GameTora only says "first half of April, years 2 and 3". (b) `vocab.json` kinds don't include `card`, but 20 §5 wants "The Brightest Star in Japan!" (a support-card title) to resolve.
Assumption taken: (a) `inheritanceTurns: []` with `extra.inheritanceTurnsVerified:false`. (b) card names/titles go to `vocab-cards.json` (same entry shape, `kind:'card'`), listed in `latest.json`; the schema enum is untouched.
Blocking: no (orchestrator: decide whether to add `card` to the VocabEntry kind enum in `@uma/schema`)

## Q-6 (T03) Card art hash framing
Context: card art hashes are computed from GameTora's full portrait `tex_support_card_<id>.png` (450×600), using one crop box (`art-crop.ts`). Round-1 review showed the earlier 128×128 `support_card_s` thumbnail was a face close-up that did not match tiles. With the portrait, the first tile of screenshot 13 is Hamming 7 from its own card and the nearest of 255. The Hamming distance to accept as a match is still unknown (real captures are scaled/lossy). Round-2 review found that shifting the first tile crop 3 px left selected the wrong card; 5 of 20 tiles had a nearest-neighbor margin of at most 3 bits. T09 must align crop positions precisely and validate on more tiles before relying on automatic matching.
Assumption taken: match by nearest hash with a margin; T09/T15 calibrate the threshold on real captures across more than one tile.
Blocking: no

## Q-7 (T03) Rank names and the ◯ glyph
Context: GameTora's rank table has numeric ids only; badge names are assumed to follow G…SS+, UG…US9. GameTora writes skill circles as U+25CB while the game and spec use U+25EF.
Assumption taken: assumed ladder (checked only at A+ = 13,471 from screenshot 02); skill names use U+25EF and vocab includes both glyphs.
Blocking: no (verify UG/UF… names against a real veteran screenshot)

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

## Q-78 (T07) UI thresholds for empty states are design assumptions
Context: S07 "not enough held-out data" and S06 "import veterans" empty states need minimum counts. No spec gives them.
Assumption taken: held-out check needs at least 10 held-out veterans (reuses the 10 §2 "low data" n < 10 threshold); the planner needs at least 2 veterans (two distinct parents). Both are UI assumptions, not model rules. T13/T06 should replace them with the real minimums (e.g. from the 80/20 split).
Blocking: no

## Q-81 (T05) Exact affinity decomposition for inheritance
Numbering: the orchestrator reserved Q-80–Q-89 for questions raised by the parallel wave's tasks (T05 prompt: "New questions reserve Q-80 through Q-89"), so this ID is intentionally not Q-79.
Context: 50 §3 names `aff(T,P1) + aff(T,P2) + aff(T,P1,GP)…`, while the cited calculator also reports a parent-pair term and race/epithet bonuses. RosterVeteran has no complete legacy race-win or epithet relation data.
Assumption taken: use shared affinity groups (and optional pairwise table) for T–P, P1–P2, and T–P–GP relations; include the P1–P2 term in each parent spark's multiplier; omit unavailable race-win and epithet terms and expose them in `AffinityResult.unsupportedTerms`.
Blocking: no


## Q-110 (T04b) API/schema field-path parity for T09
Context: Q-110 was reserved for T04b by the orchestrator while parallel tasks use other number ranges; it is deliberately not renumbered Q-8. The shared `CaptureField.path` schema accepts any syntactically valid JSON pointer. The API requires `low_confidence` paths (which create correctable review items) to resolve safely: `/trainMode`, unsafe/unresolvable pointers, whole arrays or array elements (`/sparks`, `/sparks/25`, `/skills/2`, etc.), and `/sparks/<n>/owner`, `/deck/<n>/slot` and `/parents/<n>/slot` are rejected at ingest and resolve. Leaf corrections remain allowed, including the OCR-matched spark label `/sparks/<n>/sparkId`; they cannot reorder arrays, and duplicate `owner|sparkId` corrections are rejected. `deck` and `parents` must be sent in slot order (`slot == index + 1`) because their review paths are indices while D1 reloads them by slot. `/sparks/<owner>` is the explicit owner-block correction with review/field remapping and invalidation of removed targets. A same-fingerprint re-ingest can also reorder sparks (sorted in the fingerprint) or skills (not fingerprinted); ingest retires old index-based items whose spark owner/ID or skill ID changes at their index before replacing child rows, and creates fresh items for new low-confidence fields. `ok`/`corrected` paths, even an unsafe pointer such as `/__proto__/polluted`, are provenance only: accepted as data but never applied to a veteran, and never open review items. Removed-spark closed review rows retain their historical scalar value and path internally but cannot be joined safely to current field metadata; the GET contract has no historical field snapshot, so those retired rows are omitted from GET results.
Assumption taken: keep shared contracts unchanged; T09 must mirror the low-confidence correctability rules, continue emitting valid provenance pointers, and not treat an omitted retired closed item as an active correction.
Blocking: no


## Q-120 (T08) Synthetic inheritance inputs in the golden dataset
Context: published Global `rules.json` has `blueStatGain` = 0/0/0 (UNKNOWN placeholder, Q-3) and every scenario has `inheritanceTurns: []` (Q-5). With those values the golden data would have no event-driven inheritance and the 70 §2 ×1.3 calibration variant would equal the base roster.
Assumption taken: the golden generator injects, for the golden data only, synthetic `blueStatGain` 10/20/30 per activation (`verified:false`, source SYNTHETIC) and four synthetic inheritance events `[19, 31, 43, 55]` per scenario through a scenario plugin (`loadGoldenContext`), increased from two during review round 2. Both are labelled SYNTHETIC in `truth.json` and are not game facts; every other rule is used verbatim from `rules.json`. When Q-3/Q-5 are answered, regenerate the dataset.
Blocking: no
## Q-121 (T08) CmTarget id vs the `golden-cm-1` key
Context: 70 §2 calls the target `golden-cm-1`, but 01 §10/§1 make `CmTarget.id` a ULID (user data).
Assumption taken: `targets.json[0].id` is the fixed ULID `01KGQZ0000G01DENCM00000001`, `name` is `golden-cm-1`, and `truth.json.golden.{targetId,targetName}` link the two. Consumers should look the target up by name.
Blocking: no
## Q-122 (T08) What "recovers the planted card effects within ±15%" means under card id + type pooling
Context: 50 §4 gives every deck card an id feature and a type-pool feature, both `(1 + lb/4)`. Each type feature is exactly the sum of the id features of that type, so the design is rank-deficient: β_id[card] and β_type[type] are not separately identified, and only the ridge penalties decide how a card's effect is split between them. 50 §9 does not say which coefficient must be within ±15% of the planted effect.
Assumption taken: the estimand is the card's effective contribution per unit of `(1 + lb/4)`, which is β_id[card] + β_type[type(card)] (the quantity that enters every prediction). It must be within ±15% of the planted `perUnit` for every planted card and every stat with a non-zero effect. The golden data plants no type-level effect, so `perUnit` is also the true effective contribution. No oracle adjustment is applied. `truth.trainingModel.cardEffectEstimand` records this, and `packages/engine/test/golden/planted.test.ts` checks it with a test-only 50 §4 fit (train split only, E[inheritance] from the recorded lineage, recency weights, grouped ridge). The data contracts are unchanged.
Update (T08 review round 2, N3): the β_id/β_type split is penalty-determined, so the independent check that type pooling does not bleed into other cards is the 14 zero-effect cards: their effective contribution β_id + β_type must stay near 0. On the final data (`node packages/engine/test/golden/diagnostics.ts`), max |zero-card| is 2.50 at the CV λ and at λ 0.1/0.1, 2.32–2.69 at λ 0.1/1, 1/0.1 and 1/1, 5.09 at 1/10 and 6.04 at 0.1/10, against a smallest planted effect of 40. `planted.test.ts` asserts < 8 at every tested λ.
Blocking: no
## Q-123 (T08) Which variance definition T06 uses for the 80% holdout interval
Context: 50 §4 defines `residualCov` as the weighted covariance of the holdout residuals, and 50 §5/§7 add Var[inh] for prediction. Read literally, adding Var[inh] counts the inheritance-sampling variance twice, because the holdout residuals of y = stat − E[inh] already contain it. On the golden data the pooled 80% coverage depends on the definition: train sandwich 0.8417, literal holdout residualCov 0.7917, residualCov + Var[inh] 0.9000 (outside 0.72–0.88), residualCov − mean Var[inh] + per-row Var[inh] 0.7292, train plug-in without leverage 0.7208 (`truth.holdout.coverageDiagnostic.variants`).
Assumption taken: the golden data is checked with the train-residual sandwich interval and with the literal holdout residualCov, both inside the band. T06 should not add Var[inh] on top of a residualCov that already contains it, and should not use an uncorrected train plug-in variance (its margin is 0.0008). T08 changes no spec. The retune exposed the existing variance double-count by moving residualCov + Var[inh] coverage from 0.8292 to 0.9000. The orchestrator must decide covariance semantics and record explicit spec errata before dispatching T06.
Blocking: yes for T06 dispatch; no for T08 merge
Proposed resolution (T05b, pending independent review and orchestrator transition): ADR-0002 §2, reproduced with retained code in `docs/reference/model-semantics/` (the adviser's deleted-probe numbers are not relied on).
- `residualCov` becomes the non-inheritance Σ_N:
  - computed from recency-weighted, uncentred 5-fold OOF train residuals, minus the same-weighted mean engine `statGainCov`;
  - symmetrised and floored to PSD by deterministic Jacobi.
- Inheritance is added once at prediction.
- `training-v2` carries the meaning; `training-v1` is legacy.
- Stored split: Gaussian 0.8292, seeded MC 0.8292–0.8417, card recovery worst 4.65%.
- Robustness (40 splits, diagnostic): mean 0.7885, p5 0.745, 39/40 in band.
- The holdout perturbation leaves λ, β and Σ_N bit-identical.

## Q-124 (T06) Latent skill-hint activation counted twice
Context: 50 §4 treats a skill as hinted whenever a parent/grandparent spark could provide it. For lineage-only opportunities, the resulting acquired/eligible rate already includes hint activation probability. 50 §5 then multiplies by (or samples) that probability again. Q-123's adviser identified this contradiction; see `docs/reviews/Q123-variance-advice.md` §7.
Assumption taken: T05b must specify and probe a coherent observable-data estimator before T06. Do not treat potential hints as observed activations or compare marginal rates to conditional acquisition probabilities. Keep the original golden data and acceptance thresholds unchanged; record the decision in ADR-0002.
Blocking: yes for T06 dispatch
Proposed resolution (T05b, pending independent review and orchestrator transition): ADR-0002 §3, the exposure-aware likelihood.
- For each row and candidate skill: q = 1 for deck hint/event or innate, otherwise the recorded-lineage `skillHintProb`; then y ~ Bernoulli(q·θ) with θ = P(acquired | actually hinted).
- Beta prior; the non-conjugate posterior is computed by deterministic tanh-sinh quadrature and stored as a moment-matched Beta {a, b}.
- Prediction multiplies availability exactly once.
- On synthetic data with known θ it is unbiased (the naive rate is biased by about −0.29).
- On the golden holdout it is as reliable as the conservative q = 1-only alternative and better than the literal double count. The golden best pair ranks #1 and the trap has pMeet 0 under all variants, so the golden test does not discriminate between them.
- Dropping the extra activation draw was rejected: on lineage-only holdout cells it predicts 128.9 acquisitions against 57 observed.

## Q-130 (T05b) Is a deck hint/event or innate skill certainly available?
Context: ADR-0002 §3 sets the availability q = 1 when a skill is in a deck card's `hintSkillIds`/`eventSkillIds` or the outfit's `innateSkillIds` (the existing 50 §4 approximation). In game a card's hint may never trigger in a career, so the fitted θ for those skills is a per-deck-exposure rate, not a per-actual-hint rate. No cited source gives per-card hint probabilities.
Assumption taken: q = 1 for these sources (unverified). If master data later provides hint probabilities, they replace q in the same likelihood without a contract change beyond a snapshot refit.
Blocking: no

## Q-131 (T05b) Acquired skills with no observable source
Context: under ADR-0002 §3 a non-unique acquired skill with no deck/innate/lineage source has q = 0, which is a contradiction. The golden data has none (0 train and 0 holdout cells). Real rosters may have some, from master-data gaps (e.g. scenario or race-reward skills, unknown event skills), OCR errors or unmatched parents with unread sparks.
Assumption taken: such cells are excluded from the likelihood and counted per (mode, skill) in T06 fit diagnostics. They are never treated as observed hints. Review the counts on the real roster (T15/H4) before adding a source class.
Blocking: no

## Resolved
- R-1: parents can't be the same character as each other or as the trainee. (user, 2026-09-29)
- R-2: train mode is detected from the epithet: "Independent Learner" means independent, anything else means manual. The user never changes epithets. (user, 2026-09-29)
- R-3: community master data (e.g. GameTora) is acceptable, after checking terms. (user, 2026-09-29)
- R-4: the capture agent runs on the user's Windows PC. Everything else is built and tested on macOS. (user, 2026-09-29)
- R-5: game client is Global (English) on Steam, 1920×1080 reference resolution. (user, 2026-09-29)
