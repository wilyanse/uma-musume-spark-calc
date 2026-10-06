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
Blocking: no — resolved by accepted ADR-0002 after T05b review PASS and verified local merge `3f64d39`.
Accepted resolution (T05b): ADR-0002 §2, reproduced with retained code in `docs/reference/model-semantics/` (the adviser's deleted-probe numbers are not relied on).
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
Blocking: no — resolved by accepted ADR-0002 after T05b review PASS and verified local merge `3f64d39`.
Accepted resolution (T05b): ADR-0002 §3, the exposure-aware likelihood.
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

## Q-140 (T06) Is a non-matched parent with no recorded sparks "known"?
Context: 50 §4 trains on rows with "both parents known (a guest counts as known because its sparks are on the child)". 01 §3 allows a `parent*` owner block to be empty when the tab couldn't be read (then flagged `low_confidence`). A guest or unmatched parent with an empty block has an unknown lineage, so E[inh] and Var[inh] for the row would silently omit that parent. On the golden data such rows are all low-confidence and already excluded.
Assumption taken: a guest/unmatched parent (or a `matchedVeteranId` absent from the supplied roster) with zero recorded sparks makes the row ineligible (`parent-sparks-unread` in the fit report). A matched parent always uses the matched roster record. A missing matched record falls back to the recorded sparks (`matched-missing`).
Blocking: no

## Q-141 (T06) A snapshot cannot tell which rules it was fitted with
Context: ADR-0002 §2.11 requires a refit after any `rules.json` change (including applied T15 multipliers) or master-data change. 01 §13 stores `masterVersion` but no rules version or hash, so `predictChild`/`rankPairs` can detect a master change but not a rules change.
Assumption taken: prediction throws `RefitRequiredError` (`master-version-mismatch`) when `snapshot.masterVersion` differs from the context; rules changes cannot be detected from the snapshot. The caller (T13/T15) must refit after applying rule overrides. A contract change (e.g. a `rulesVersion` field) would need an ADR.
Blocking: no

## Q-142 (T06) The trainee's own unique skill as a target or prediction skill
Context: ADR-0002 §3 and 50 §4 exclude the trainee outfit's own `uniqueSkillId` from the skill fit, because there is no acquisition decision to learn for it. The model therefore has no estimate for it. Before T06 review round 1, a `CmTarget` that required (or weighted as optional) that skill, or an explicit `PredictOptions.skills` list naming it, silently got pHinted = 0, P(acquire) = 0 and pMeet = 0, so ranking fell back to surplus order without any signal. The golden roster happens to record the own unique skill on all 260 veterans, but that is SYNTHETIC data (Q-120) and no cited source in the repo states a real-game possession rule; promoting it to "acquired with certainty" would invent a game rule.
Assumption taken: such a request is unsupported. `predictChild` (target or `PredictOptions.skills`), `rankPairs`/`rankPairsDetailed` (including an empty roster or a lock with no legal partner) and the advanced helpers `skillClosedForm`/`simulate`/`gaussianScore` throw `ModelInputError` with `code: 'own-unique-skill'`. This does not claim the skill is impossible to own. Another outfit's unique skill (e.g. an inherited unique hint) is an ordinary candidate and is not rejected for its rarity. Default predictions never select the own unique skill. T13 (S05 target form) should drop the trainee's own unique skill from the selectable target skills for that trainee, or show the error reason ("not modelled for this trainee") rather than a 0% result. Changing this needs a cited game rule and a model decision.
Blocking: no

## Q-90 (T09) Single vs double circle skill suffix is not readable by OCR
Context: Apple Vision reads both `◯` and `◎` skill suffixes as `O`/`®`, but they are different skills (e.g. `skill:long-corners` ◎ vs `skill:long-corners-2` ◯). On fixtures 01 and 15 the glyph centre luma separates them (double ≤ 207, single ≥ 214).
Assumption taken: Core classifies the glyph from pixels (`circleGlyph` in the layout); an in-between centre is `Unknown`, which keeps both IDs as candidates and the field `low_confidence`. Windows OCR may behave differently; re-check at H4.
Blocking: no

## Q-91 (T09) Per-ROI OCR recordings for deck and card-list levels
Context: the full-frame Apple Vision recording (30 Appendix A) merges the `Lvl N` text of the Career Info deck and card list with neighbouring art (`X0 Lvl 50`, `566 Lvl 50`) or misses tiles. 30 §7 says the Windows adapter OCRs ROI crops upscaled ×2.
Assumption taken: `agent/tests/fixtures/ocr-roi/{05,13}*.json` hold per-ROI recordings made the way the adapter reads (`agent/tests/tools/record_roi_ocr.py`); `FixtureOcrEngine` uses an exact ROI recording when present, else the full-frame one. With full-frame only, 3 of 711 labelled fields are unread (flagged, never wrong-and-confident). T10's `--record-ocr` should also record per-ROI output.
Blocking: no

## Q-92 (T09) Rank badge templates exist only for A+ and UG3
Context: rank badges are template-matched (30 §4); the fixtures only show A+ (01–07) and UG3 (15). Q-7: the rank ladder is unverified.
Assumption taken: an accepted template must also agree with the master `ranks.json` rating band, else `low_confidence`. An unseen badge is never labelled by template: the rating band is proposed as a `low_confidence` value with a crop. Add badge crops from H4 captures to `agent/layouts/templates/global-2026-09.json`.
Blocking: no

## Q-93 (T09) "01–07 assembles a valid capture" vs the §5 completeness rule; no "skills incomplete" flag
Context: 30 §10 says fixtures 01–07 assemble a valid `VeteranCapture`. 30 §5 says a session is complete only when Skills, Inspiration (all 3 blocks) and Career Info are captured, and only then is the capture written to the outbox. Fixture 01 shows only the top of the Skills list (its scroll thumb is not at the end) and no fixture shows the end, so 01–07 is not complete under §5. 01 §3 has a `/sparks/<owner>` flag for a missing parent block but nothing for a truncated skills list: a partial list would be stored as ordinary `ok` data. Skills aren't fingerprinted, so a later complete re-capture would silently update them, but until then the roster and model would see a wrong list. A related gap: with a missing scroll thumb Core cannot tell "content fits, no scrollbar" from "thumb not detected", so it treats both as unknown position.
Assumption taken: the assembler still produces the 01–07 capture (it validates against the schema, CAPTURE_RULES and master IDs, satisfying §10), but marks it diagnostic: `CaptureResult.Uploadable` is false and `UploadOutbox.EnqueueCapture` throws `IncompleteCaptureException`. Only a sealed result with every checklist section complete (top and end seen with a detected thumb, no unaligned frames, 3 spark blocks, 6 deck tiles, 2 parents, career rows) and no errors is queued. A parent block that is unreadable after a full top-to-end scroll is still uploadable with its `/sparks/<owner>` flag (01 §3). No short list without a scrollbar is accepted until a fixture shows one. Adding a "skills incomplete" flag needs an ADR and a contract change (01 §3, schema, API); it is not done here.
Blocking: no

## Q-94 (T09) 16:9 sizes below 1920×1080 are refused, not scaled
Context: 30 §2 says the agent scales other 16:9 sizes linearly. Bicubic downsampling of the real fixtures to 1600×900 and 1280×720 (a probe only: resampling is not how the game renders at those sizes) gave confident-wrong values: the ◯/◎ glyph centre luma crossed its thresholds (`skill:corner-recovery-2` instead of `skill:corner-recovery`, `skill:medium-corners` instead of `-2`), and deck slot 6 lost its borrowed band and LB. The thresholds were calibrated on 1920×1080 captures only and have no real lower-resolution evidence to recalibrate against.
Assumption taken: Core refuses 16:9 frames below 1920×1080 with `UnsupportedResolutionException` (an `UnsupportedFrameException`, like `UnsupportedAspectRatioException`), before any reading; T10 shows "make the game window at least 1920×1080". Larger 16:9 sizes are still downscaled to reference space (2560×1440 tested), and non-16:9 sizes are still rejected. Supporting smaller windows needs real captures at those sizes, scale-aware thresholds with an uncertainty band, and fixture tests; thresholds are not retuned on synthetic resampling.
Blocking: no

## Q-150 (T11) A partial owned-cards sync still replaces the whole table
Context: 01 §4 says the API "replaces the table atomically" and accepts a count mismatch with `?partial=1`. The route (`apps/api/src/routes/owned-cards.ts`) runs `DELETE FROM owned_cards` then inserts the body for partial syncs as well. So a "Send partial" of one scanned page (e.g. fixture 13: 20 of Held 208) leaves the web app with only those 20 cards. 30 §8 offers "Send partial" without saying whether it merges.
Assumption taken: no API or contract change. The agent never sends a partial on its own: `CardSyncSession.BuildPartial` needs the user's explicit `PartialSyncConfirmation` for the exact current state, and its `Message` says the list will be replaced by these N cards. A merge mode would need an ADR and a 01 §4 change.
Blocking: no

## Q-151 (T11) Does `Held N/255` count distinct cards?
Context: 30 §8 completes the sync "when the unique card count equals `Held N`". No fixture or cited source in the repo says whether the game's Held counter counts distinct support cards or copies. Fixture 13 shows 20 distinct cards with Held 208, which does not decide it.
Assumption taken: follow 30 §8: a full sync requires the distinct collected count to equal Held. If Held counts copies, a full sync never becomes possible and the user can only send partial. Check at H4 with a real full scroll.
Blocking: no (verify at H4)

## Q-152 (T11) Card sync has no durable queue
Context: 30 §6 puts veteran uploads in the SQLite outbox. T09's outbox accepts only `crop` and `veteran` kinds. The owned-cards PUT is a whole-table replace, so a stale queued sync replayed later could overwrite a newer one.
Assumption taken: no durable card queue and no new outbox kind. `OwnedCardsUploader` sends straight from the in-memory `CardSyncSession` with bounded retry: at most 4 attempts, backoff 2 s doubling and capped at 30 s. Nothing reaches disk: no payload, token or response. Recovery after `Failed`/`AuthRequired`/app exit: rebuild from the still-open session (`BuildFull`/`BuildPartial` give the same body) and send again, or scan again. The last API-acknowledged list remains on the server until a later sync succeeds.
Blocking: no

## Q-153 (T11) Scroll placement depends on accepted art matches
Context: 30 §8 de-duplicates assisted scrolling by (cardId, lb, level, grid position relative to the previous frame). With no auto-scroll (T14), the scroll offset can't be known apart from the tiles themselves.
Assumption taken: a frame is placed only by its accepted art matches, and its offset must be a whole number of rows and agree across those tiles. A frame with no accepted tile is ignored. A frame that contradicts what was seen is rejected whole. Unconnected parts and holes block a full sync even when the count equals Held. The 5×4 grid and per-tile thresholds are T09's, calibrated on fixture 13 only. Re-check scroll behaviour on Windows at H4.
Blocking: no

## Q-154 (T11) Review round 1 amendments to Q-150, Q-152 and Q-153
Context: The T11 round-1 review (B1–B6) showed boundary tiles erased during normalization, mutable confirmations/envelopes, and stale in-memory whole-table retries. This entry narrows the T11-owned assumptions of Q-150/Q-152/Q-153. No API or shared-contract change.
Assumption taken:
- Q-150: a partial confirmation is bound to session identity, instance, generation and revision. The shell shows `PartialSyncConfirmation.Message` and calls `BuildPartial` only after the user accepts. Session-issued envelopes are immutable and cannot be rewritten into a full send or a different Held.
- Q-152 (corrected after review round2): T10 keeps ONE `OwnedCardsUploadCoordinator` per API target/account for the shell's lifetime, across session and uploader replacement. Create the current session, then call the public `BeginGeneration(session)` before first send. No parameterless or implicit payload binding exists. On reset: `Invalidate(g)`, `session.Reset()`, then `BeginGeneration(session)`; on replacement: construct the new session and register it (registration retires/cancels the previous scan); on cancel: `Invalidate(g)` and `session.Cancel()`. Send/auth repair uses the existing handle and only its registered session's unchanged current snapshot revision. Session-issued provenance carries immutable issuing session object, GUID, instance, scan generation and revision, preserved on body copies/rewraps. Send checks all of these before target binding, after entering the serialized gate and before every retry; the gate's revision watermark never decreases and accepts an identical current payload after bounded failure. Older envelopes and envelopes from a reset/cancelled/replaced session are refused even under a fresh handle; retired scans cannot be re-registered without Reset. If collection content changes, rebuild and reconfirm partial, never wrap an old body as current. `CardSyncSession.Reset/Cancel` revokes an already-built envelope for subsequent coordinated sends/attempts even if the caller forgets Invalidate. No durable queue: after an app exit, scan again. Cancellation/current-revision checks cannot undo a PUT the server already received; remote order after an ambiguous transport failure is not guaranteed (the API has no generation/CAS check).
- Q-153: placement keeps the row/grid origin and every unread occupied cell, boundaries included. A cell with neither accepted art nor a read level is unknown occupancy, not empty. `Feed(parsed, confirmedEmptyCells)` accepts only caller-verified empty indices and rejects a frame where such a cell has a reading or contradicts earlier aligned occupied evidence. A later confirmed-empty cell clears an aligned unknown `UnreadSlot` with no accepted ID; it never erases a known card, pending tile or conflict. Placement/emptiness is transactional even across scroll offsets and segment joins; remaining internal gaps remain holes. Nothing infers emptiness from missing readings. A falsely confident empty classifier is still an H4/integration risk, not a core excuse for accepting contradictions. `FeedAsync` stays conservative because the T09 parser has no empty-cell classifier, so a partly filled last row blocks a full sync until T10/H4 provides verified emptiness.
- Q-151 is unchanged (Held distinct vs copies, H4).
Blocking: no (verify the empty-last-row behaviour at H4)

## Resolved
- R-1: parents can't be the same character as each other or as the trainee. (user, 2026-09-29)
- R-2: train mode is detected from the epithet: "Independent Learner" means independent, anything else means manual. The user never changes epithets. (user, 2026-09-29)
- R-3: community master data (e.g. GameTora) is acceptable, after checking terms. (user, 2026-09-29)
- R-4: the capture agent runs on the user's Windows PC. Everything else is built and tested on macOS. (user, 2026-09-29)
- R-5: game client is Global (English) on Steam, 1920×1080 reference resolution. (user, 2026-09-29)

## Q-100 (T10) Windows.Media.Ocr exposes no confidence score
Context: T09 recorded Apple Vision lines carry measured OCR confidence; Windows.Media.Ocr returns text and word boxes, but no confidence. Core gates text/digit readings at 0.3/0.5 in addition to vocab scores/margins and pixel/template validation. The shell cannot invent measured Windows confidence.
Assumption taken: document and record constant 1.0 for native OCR lines as a compatibility sentinel (not a measured probability); retain all other Core validation/matching gates unchanged. English Windows recording/accuracy and ambiguous glyph/digit checks are explicit H4. A future confidence estimator or conservative review policy needs evidence and coordinator/Core ownership, not guessed numbers here.
Blocking: no (implementation complete; native accuracy remains H4)

## Q-101 (T10) Whole-frame dHash collides between real scroll views
Context: real screenshot fixtures 02 and 03 both hash to e8c989d1c1e1c1d1 across the full frame. Strictly skipping every equal dHash could miss necessary scroll evidence even though the screenshots differ.
Assumption taken: keep 4fps maximum polling and unchanged dHash skipping, but force reread after two seconds using injected time. In assisted mode require dwell >=2 seconds per overlapping view; never fabricate end-thumb coverage or bridge gaps. A real collision regression demonstrates the refresh behavior. Exact-content hashing could be a future performance/correctness alternative after Windows measurements.
Blocking: no
