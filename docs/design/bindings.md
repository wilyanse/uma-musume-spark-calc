# Bindings

Every displayed value maps to a contract field (`01-data-contracts.md`, "01 §n"), a master-data field (01 §11), an engine output (`50-engine.md`, "50 §n"), or is **derived** on the client (the derivation is stated). Every action maps to an API endpoint (01 §3/§4/§8/§9) or an engine call. Items with no contract are listed as **GAP → Q-nn** and are in `docs/OPEN_QUESTIONS.md`; none is invented.

Conventions: `RV` = `RosterVeteran` (01 §9). `M.x` = master-data file `x.json` (01 §11). Names shown for IDs are resolved through master data (`characterId` → `M.characters.name`, `outfitId` → `M.outfits.title`, `skillId`/`sparkId` → `M.skills/sparks.name`, `cardId` → `M.cards.name/title`). "Client" means computed in the browser from already-loaded data.

## Global shell

| Element | Source |
|---|---|
| Nav rail / bottom tabs, current item | Router path (60 §2). |
| Review badge count | Client: `GET /api/v1/review-items?status=open` → `.length`. |
| Rail footer "Master data {v}" | `GET /api/v1/health` → `masterVersion` (or `/master/latest.json` → `version`). |
| Rail footer "Model: {kind}" | `GET /api/v1/model-snapshots?kind=training-v1` → `kind`. |
| Illustrative-data footer | Prototype only. Not rendered in the app. |

## S01 Roster (F05, F02)

| Element | Source |
|---|---|
| Loads the list | `GET /api/v1/roster` (ETag) → `RV[]`. |
| Portrait | Avatar placeholder from `M.characters.name` initials. Art: **GAP → Q-73**. |
| Name + outfit | `RV.characterId`, `RV.outfitId` → `M.characters.name`, `M.outfits.title`. |
| Rank badge | `RV.rank`. |
| Rating | `RV.rating`. |
| Spd/Sta/Pow/Gut/Wit | `RV.stats.{spd,sta,pow,gut,wit}`. |
| Mode badge | `RV.trainMode`. |
| Mode override icon | `RV.modeSource === 'override'`. |
| Spark summary (blue / pink / green) | `RV.sparks` where `owner==='self'`, one per `type` in {blue,pink,green}; name via `M.sparks`, stars = `RV.sparks[].stars`. (01 §3 guarantees exactly one blue and one pink, at most one green.) |
| Scenario | `RV.scenarioId` → `M.scenarios.name`. |
| Acquired | `RV.career.dateAcquired`. |
| Last import | Client: max of `RV.capturedAt`. |
| Filter: character | options from `M.characters`; matches `RV.characterId`. |
| Filter: mode | `RV.trainMode`. |
| Filter: scenario | `RV.scenarioId`. |
| Filter: has spark X, stars ≥ N | Client: any `RV.sparks[]` (any owner) with `sparkId===X && stars>=N`. Option list from `M.sparks`. |
| Filter: rating range | `RV.rating`. |
| Sort by column, pagination, "Showing n of N" | Client, over the already-loaded roster (60 §3). |
| Row link → S02 | Route `/veterans/:id`, `RV.id`. |
| Columns button | Client (visible-columns preference, local storage). |
| Reset | Client (clears filters). |
| Empty state | Client: `roster.length === 0`. |
| Error / loading | Query state of `GET /api/v1/roster`. |

## S02 Veteran detail (F05, F02)

Loads `GET /api/v1/veterans/:id` → `RV` + `fields[]` (`CaptureField`).

| Element | Source |
|---|---|
| Portrait | Placeholder. **GAP → Q-73**. |
| Outfit title, name | `RV.outfitId`, `RV.characterId` via master data. |
| Rank badge, rating | `RV.rank`, `RV.rating`. |
| Epithet chip | `RV.epithet`. |
| Mode toggle (value) | `RV.trainMode`; helper text "detected from epithet" when `RV.modeSource==='epithet'`, "overridden" when `'override'`. |
| Mode toggle (action) | `PATCH /api/v1/veterans/:id {trainMode}` (optimistic; 60 §3). |
| Low-confidence banner and count | Client: `fields.filter(f => f.status==='low_confidence').length`. |
| Stat strip values | `RV.stats.*`. Bar length = value ÷ scenario stat cap (`M.scenarios.statCap` of `RV.scenarioId`), clamped. |
| Dotted underline on a value | `fields[].status==='low_confidence'` where `path` matches the value (e.g. `/stats/gut`). Links to S03 for that item. |
| Aptitude grid (Turf, Dirt, Sprint, Mile, Medium, Long, Front, Pace, Late, End) | `RV.aptitudes.{turf,dirt,sprint,mile,medium,long,front,pace,late,end}` (grade enum G–S). |
| Skills tab: names | `RV.skills[].skillId` → `M.skills.name`. |
| Skills tab: "Lvl n" | `RV.skills[].level` (only present for unique skills). |
| Skills tab: highlighted row | `M.skills.rarity === 'unique'` for that `skillId`. |
| Sparks tab: three groups | `RV.sparks` grouped by `owner` = `self`, `parent1`, `parent2`. Group header names from `RV.parents[slot].characterId`. |
| Spark pill | `sparkId` → `M.sparks.name`, `type`, `stars`. |
| "No sparks were read" state | Group empty (01 §3 allows empty parent groups when flagged). |
| Deck tab tiles | `RV.deck[]` (6): `cardId` → `M.cards.name/title/type/rarity`; `lb`; `level`. |
| Friend flag | `RV.deck[].borrowed`. |
| Lineage: parent name, outfit | `RV.parents[].characterId`, `.outfitId` (nullable: show "—"). |
| Lineage: Guest badge, trainer | `RV.parents[].isGuest`, `.guestTrainer`. |
| Lineage: "Matched in roster" + link | `RV.parents[].matchedVeteranId` non-null → route `/veterans/{matchedVeteranId}`. |
| Career: scenario, races, wins, fans, acquired | `RV.scenarioId`, `RV.career.{races,wins,fans,dateAcquired}` (`fans` nullable → "—"). |
| Delete (action) | `DELETE /api/v1/veterans/:id` (204), then route to `/roster`. |
| Back button | Router. |

## S03 Review queue (F04)

Loads `GET /api/v1/review-items?status=open` → `ReviewItem[]` (`{id, veteranId, path, status, createdAt, resolvedAt, field, cropKey}`).

| Element | Source |
|---|---|
| Open count / "resolved this week" | Client: open list length; `GET …?status=resolved` filtered on `resolvedAt` within 7 days. |
| List row: veteran name | `ReviewItem.veteranId` → roster `RV` → character name (roster is already cached). |
| List row: field path (human) | Client: humanise `ReviewItem.path` (e.g. `/sparks/4/sparkId` → "Sparks · Self · white #5"). |
| List row: OCR text | `ReviewItem.field.rawText`. |
| Crop image | `GET /api/v1/crops/:key` with `ReviewItem.cropKey`. |
| Crop dimensions caption | Client: natural size of the loaded image. |
| Raw OCR text | `ReviewItem.field.rawText`. |
| Field path | `ReviewItem.path`. |
| Confidence tag | `ReviewItem.field.confidence`. |
| Candidates (value, score) | `ReviewItem.field.candidates[]` (top 3: `value`, `score`); label of `value` via master data by field kind. |
| Candidate kind text ("white · race") | `M.sparks.type` / target kind of the candidate value. |
| Search box | Client: search over `M.vocab` (`vocab.json`, `text`, `kind`). |
| Apply (action) / keys 1, 2, 3 | `POST /api/v1/review-items/:id/resolve {value}`; `409` shows `error.conflict`. Invalidates roster and review queries (60 §3). |
| Dismiss (action) / key D | **GAP → Q-70**: 01 §9 defines no dismiss endpoint (the D1 `status` allows `dismissed`). |
| J / K | Client (selection). |
| Empty / error | Query state. |

## S04 Support cards (F03)

Loads `GET /api/v1/owned-cards`.

| Element | Source |
|---|---|
| Tile: name, title, type, rarity | `OwnedCard.cardId` → `M.cards.name/title/type/rarity`. |
| Tile: LB diamonds | `owned_cards.lb` (`cards[].lb`). |
| Tile: level | `cards[].level`. |
| Last sync time | `owned_cards.synced_at`. **GAP → Q-71**: the GET response shape isn't defined in 01. |
| "Held n / 255" | `OwnedCardsSync.heldCount` (01 §4). Same gap, Q-71. |
| Count "Showing n of N" | Client. |
| Filters: type, LB, rarity, search | Client over `cards[]` + master data (`M.cards.type`, `.rarity`, `.name`). |
| Add to deck / remove / clear (actions) | Client state (deck draft). Persistence **GAP → Q-77**. |
| Deck slot rows 1–5 | Client deck draft: `{cardId, lb, level}` from owned cards, `borrowed:false`. |
| Slot 6 Friend | Client: any `M.cards` entry (search all cards); `borrowed:true`, LB via select (0–4), level. Shape matches `RV.deck[]`/`DeckSlot` (01 §3). |
| "Use in planner" (action) | Client: sets `PlanInput.deck` (50 §1) and routes to `/planner`. |

## S05 CM targets (F10)

Loads `GET /api/v1/cm-targets` → `CmTarget[]` (01 §10).

| Element | Source |
|---|---|
| List: name | `CmTarget.name`. |
| List: surface · distance · meters | `CmTarget.course.{surface, distance, meters}`. |
| List: updated date | `cm_targets.updated_at`. **GAP → Q-72**: `CmTarget` has no timestamp field. |
| Name input | `CmTarget.name`. |
| Surface / distance / meters / notes | `CmTarget.course.{surface,distance,meters,notes}`. |
| Running style | `CmTarget.style`. |
| Minimum stats ×5 | `CmTarget.minStats.{spd,sta,pow,gut,wit}` (optional). |
| Minimum aptitudes ×10 | `CmTarget.minAptitudes.{turf,…,end}` (optional; "—" = absent). |
| Required skill chips | `CmTarget.requiredSkills[]` → `M.skills.name`. |
| Optional skill chips + weight | `CmTarget.optionalSkills[].{skillId,weight}`. |
| Skill autocomplete | Client: `M.vocab` (kind `skill`). |
| Stat weights ×5 | `CmTarget.statWeights.*` (optional, default 1). |
| New target (action) | Client (blank form); Save → `POST /api/v1/cm-targets`. |
| Save target (action) | `PUT /api/v1/cm-targets/:id`. |
| Save as new (action) | `POST /api/v1/cm-targets`. |
| Delete (action) | `DELETE /api/v1/cm-targets/:id`. |
| Validation messages | Client, mirroring `CmTarget` schema (stats 1–2000 ints, weight > 0, no duplicate skills). |

## S06 Planner (F09, F11)

`PlanInput = {traineeOutfitId, deck[6], trainMode, scenarioId, lockParent1?}` (50 §1). Ranking = `rankPairs(ctx, model, input, roster, target, opts, onProgress)` (50 §7) in the Web Worker.

| Element | Source |
|---|---|
| Trainee (outfit) picker | Options `M.outfits` (title + character name); value → `PlanInput.traineeOutfitId`. |
| Support deck chips | `PlanInput.deck[]` from S04 draft (`cardId`, `lb`, `borrowed`). |
| Train mode | `PlanInput.trainMode`. |
| Scenario | `PlanInput.scenarioId`; options `M.scenarios`. |
| CM target select | `GET /api/v1/cm-targets` → the `CmTarget` passed to `rankPairs`. |
| Lock parent 1 | `PlanInput.lockParent1` (a roster `RV.id`). |
| Model line (kind, n, coverage) | `ModelSnapshot.kind`, `.nSamples`, `.params.holdout.coverage80` (01 §13). |
| Model fit if missing/stale | `fitTrainingModel` then `POST /api/v1/model-snapshots`; otherwise `GET /api/v1/model-snapshots?kind=training-v1` (60 §3). |
| Rank pairs (action) | `rankPairs(...)`. Cancel = abort the worker (60 §3). |
| Progress bar / "done of total" | `onProgress` callbacks (50 §7.5, every 1,000 pairs). |
| "Ranked N pairs in x s" | Client: total pairs = count of legal pairs (from `rankPairs` progress total); elapsed = client timer. |
| Table: rank | Index in `RankedPair[]`. |
| Table: parent 1 / parent 2 names | `RankedPair.parents[0|1]` → `RV` → `M.characters.name`. |
| P(meet target) | `RankedPair.pMeet` (50 §6). |
| Stat surplus | `RankedPair.surplus`. |
| Affinity | `RankedPair.affinity.total` (50 §3). |
| Bottleneck | `RankedPair.bottleneck` (50 §6). |
| Expand (action) | Client toggle; data is already in `RankedPair`. |
| Detail: stat bars (mean, p10–p90) | `RankedPair.prediction` per-stat `mean`, `p10`, `p90` (50 §5). |
| Detail: target line | `CmTarget.minStats.*`. |
| Detail: stat cap note | `M.scenarios.statCap`; sample count = `opts.samples`. |
| Detail: "model n" | `ModelSnapshot.nSamples`. |
| Detail: aptitude before → after | Before: `M.outfits.aptitudes` of the trainee; after/probability: `prediction` per-aptitude grade probabilities (50 §5); target grade: `CmTarget.minAptitudes`. |
| Detail: per-skill probability | `prediction` per-skill acquisition probability (50 §5) for `CmTarget.requiredSkills` and optional skills. |
| Detail: per-skill "n" and "low data" | **GAP → Q-76**: the snapshot holds Beta `{a,b}`, not a sample count. |
| Detail: bottleneck tag | `RankedPair.bottleneck` equals that requirement. |
| Detail: spark contributions | `RankedPair.contributions[]` `{sparkId, from, type, stars, p, expectedEffect}` (50 §3). |
| Detail: affinity breakdown | `RankedPair.affinity.breakdown` (50 §3). |
| Low-data warning (scenario · mode) | Client: count of `RV` with the same `scenarioId` and `trainMode` < 10. |
| Empty states | Client: roster size, `target` missing, deck incomplete, `rankPairs` returns `[]`. |

## S07 Model health (F12)

Loads `GET /api/v1/model-snapshots?kind=training-v1` → `ModelSnapshot` (01 §13).

| Element | Source |
|---|---|
| Training rows | `ModelSnapshot.nSamples`. |
| 80% coverage + range tag | `params.holdout.coverage80`; range 0.72–0.88 from 50 §9 (client constant). |
| Model kind, fitted date, master version | `kind`, `trainedAt`, `masterVersion`. |
| Sample counts per (scenario, mode) | Client: group `RV[]` by `scenarioId`, `trainMode` (`GET /api/v1/roster`). |
| "low data" tag | Client: count < 10. |
| MAE table | `params.holdout.mae.{spd,…,wit}`. |
| σ column | `params.perStat.{spd,…,wit}.sigma`. |
| Scatter plots (points) | **GAP → Q-74**: the snapshot stores only aggregate MAE and coverage, not held-out predicted/actual pairs. |
| Rules table: rule, value, verified, source | `rules.json` (01 §12): each entry's value fields, `verified`, `source`. |
| Calibration: multiplier, log-likelihood, Brier | `CalibrationReport` from `calibrateRules` (50 §8). **GAP → Q-75**: no contract for its fields. |
| Refit model (action) | `fitTrainingModel` then `POST /api/v1/model-snapshots`. |
| Run calibration (action) | `calibrateRules(ctx, roster)` (50 §8) in the worker. |
| Apply suggested multipliers (action) | **GAP → Q-75**: no contract for storing rule overrides. |
| Dismiss (calibration) | Client (hides the report). |
