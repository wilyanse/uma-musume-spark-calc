# Uma Spark Calc: Architecture

> **Superseded in detail by `docs/specs/`.** This document records the design reasoning; where it differs from the specs (e.g. a single Worker serving the static assets instead of separate Pages, ImageSharp instead of OpenCvSharp), the specs win.

Status: accepted · Target: Uma Musume Pretty Derby **Global (Steam, Windows)**

## 1. Goals

1. Read the user's **veteran umas** and **owned support cards** from the running game with **screen capture and OCR**, without reading memory or network traffic.
2. Store them in a hosted database that only the user can access.
3. In a web app, for a chosen **trainee + support deck + two parents**, predict:
   - the **expected stat bonus, aptitude upgrades and skill hints from inheritance events**;
   - the child's **final stats, aptitudes and skills**, as an average with a p10–p90 band;
   - the **probability that the child meets a Champions Meeting (CM) target**.
4. **Rank every legal parent pair** in the roster for a given CM target and deck.
5. Detect each veteran as **Independent** (the in-game independent-training feature) or **Manual** (played by hand), and model them separately.

Non-goals for v1: reading game memory or packets, friend/rental parents, race simulation, and more than one user.

## 2. Key decisions

| Decision | Choice | Why |
|---|---|---|
| Train-mode detection | Epithet "Independent Learner" → independent, else manual | No visible flag exists; the user never changes epithets |
| Capture method | Screen capture (Windows.Graphics.Capture) + OCR + icon template matching | Lowest ToS risk. Accurate enough because OCR text is matched against a closed vocabulary (skill names, character names). |
| Capture agent | **C# / .NET 8, WPF** tray app | Native Windows capture and OCR APIs, and the user already knows C#. |
| OCR | `Windows.Media.Ocr` (built in, free), with Tesseract as a fallback | No install, fast, good on clean game fonts. |
| Icons (stars, grades, spark colours, card art) | OpenCvSharp template matching + colour histograms | These aren't text, so OCR can't read them. |
| Web app | **React + TypeScript (Vite)** on **Cloudflare Pages** | Free hosting. |
| API | **Cloudflare Workers (Hono)** | Free (100k requests/day), same language as the engine. |
| Database | **Cloudflare D1** (SQLite) | Free up to 5 GB. 260 veterans + ~1,800/year is tiny. |
| Image storage | **Cloudflare R2** | Crops of low-confidence fields for the review queue. Free up to 10 GB. |
| Auth | **Cloudflare Access** (email one-time PIN or Google) in front of Pages and the API; a **service token** for the agent | No auth code to write, free for up to 50 users. |
| Calculation engine | TypeScript package, running **in the browser in a Web Worker** | Ranking ~33k pairs is CPU work; doing it client-side keeps the Worker within free-tier CPU limits and makes it instant. |
| Prediction approach | **History-based**: learn from the user's own veterans, plus a modeled inheritance term | This is what the user chose, and it reflects their actual play and the independent-training AI's behaviour. |

**Alternative (all .NET):** Blazor WASM on Azure Static Web Apps (free) + Azure Functions + Azure SQL free offer. It works, but the free SQL offer pauses when idle and has monthly vCore limits. Cloudflare is simpler to keep free.

## 3. System overview

```
┌──────────────────────── Windows PC ────────────────────────┐
│  Uma Musume (Steam)                                         │
│        ▲ clicks (optional)      │ frames                    │
│        │                        ▼                           │
│  ┌─────────────── Capture Agent (C# WPF tray) ───────────┐  │
│  │ WindowCapture → ScreenClassifier → Extractors          │  │
│  │   (OCR, icons, digits) → VocabularyMatcher → Validator │  │
│  │ Navigator (auto or assisted) · ModeDetector (epithet)  │  │
│  │ Local SQLite outbox ──────────────► Uploader (HTTPS)   │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────┬──────────────────────┘
                                       │ CF Access service token
┌──────────────────────── Cloudflare ──▼──────────────────────┐
│  Workers API (Hono) ── D1 (SQLite) ── R2 (field crops)       │
│  Pages: React SPA ── Web Worker: engine (TS)                 │
│  Access: user login (OTP / Google)                           │
└──────────────────────────────────────────────────────────────┘
```

## 4. Capture agent

### 4.1 Pipeline
1. **WindowCapture**: attach to the game window with `Windows.Graphics.Capture`, then normalise frames to a reference resolution (1920×1080 client area). Every region of interest (ROI) is defined in normalised coordinates, so any 16:9 size works.
2. **ScreenClassifier**: identify which screen or tab is showing (veteran list, veteran detail tabs, support card list, card detail) using perceptual hashes of stable UI anchors.
3. **Extractors**, per screen, each driven by a **layout profile** (JSON, versioned):
   - `TextField`: OCR, then fuzzy match against master data (Levenshtein/Jaro-Winkler with a threshold). Used for skill, character and factor names.
   - `NumberField`: digit-only OCR plus a range check (stats 1–2000).
   - `GradeField`: aptitude letter G–S by template match.
   - `StarField`: spark star count (1–3) by template match.
   - `ColorField`: spark type (blue, pink, green, white) by hue.
   - `CardArtField`: identify a support card by the image hash of its art thumbnail against master data art.
   - `LimitBreakField`: count filled limit-break diamonds.
4. **Validator**: cross-field checks (for example, stats within the scenario cap, factor counts, parents different from the veteran) and a **confidence** score per field. Fields below the threshold get their crop uploaded to R2 and go into the **review queue**.
5. **Outbox**: every record goes to local SQLite first, so an offline upload loses nothing. It is retried idempotently.

### 4.2 Navigation modes
- **Assisted (default, safest):** the user clicks through screens. The agent detects changes, captures each tab and shows a checklist of which tabs it has captured for the current veteran.
- **Auto:** the agent clicks through the veteran list with `SendInput`, using randomised human-like delays. It is faster for the first import of 260 veterans. It is also input automation, which the ToS may treat differently from passive screen reading, so it stays off unless enabled.

### 4.3 What is captured per veteran (confirmed from Global screenshots, 1920×1080)
Everything lives in the **Umamusume Details** popup (left panel, x≈256–856). The header is always visible:

| Region | Data | Method |
|---|---|---|
| Header | `[Outfit]` + character name, rank badge (A+ etc.), rating (13,471), epithet (e.g. "Independent Learner") | OCR + vocab; rank by template |
| Stat row | Speed/Stamina/Power/Guts/Wit values + grade letters | Digit OCR at fixed ROIs + grade template |
| Aptitude grid | Turf/Dirt, Sprint/Mile/Medium/Long, Front/Pace/Late/End | Grade letter template match (OCR misses the coloured letters) |
| **Skills** tab | Acquired skills in a 2-column list; unique skill shows `Lvl N` | OCR + vocab; scroll until the list repeats |
| **Inspiration** tab | Own sparks, then **Legacy Origin** = the two parents' sparks (portrait + pills) | OCR name, pill colour for type, gold star count; scroll 2–3 pages |
| **Career Info** tab | 6 support cards (art, `Lvl`, LB diamonds, `Friends` = borrowed), Legacy 1/2 portraits with **Guest** badge, Career Record, **Career Scenario**, Date Acquired, race history | Card by art hash; LB by diamond count; OCR for text |
| Parent **Sparks** popup (tap a legacy portrait) | Parent's name + outfit; for guests, also the guest trainer | OCR; only needed to identify the parent character |

Spark pill type comes from colour: blue = stat, pink = aptitude, green = unique skill, grey/white = skill, race or scenario.

We don't need grandparents' sparks for a veteran. When a veteran is used as a parent, its own parents become the child's grandparents, and the Inspiration tab already lists their sparks.

### 4.3.1 Spike results (see `spike/ocr/`)
Apple Vision OCR (a stand-in for Windows OCR) and colour-based star counting on the 12 provided screenshots:
- **Text: effectively 100% after vocabulary matching.** Skill, spark and race names, stats, rating, scenario and date all read correctly. Consistent noise to strip: `]` read as `l`, `◯` suffixes read as `O`/`®`/`@`, stat icons read as `•`/`L`/`T`, and a leading `)` on pills. Vocabulary matching removes all of it.
- **Stars:** the gold-pixel ratio in 3 cells under each pill gives a clean split (a filled cell reads ≈0.2, an empty one 0.0). The counts matched every pill checked. Filter out gold UI elsewhere (avatar ring, trainer badge) by restricting to strips 10–15 px tall inside the pill column.
- **Not readable by OCR:** aptitude/stat grade letters (coloured glyphs), support card identity and LB, parent identity (portrait only). These need template/image matching, as planned.
- **Guest parents exist:** Legacy 2 in the sample is a borrowed **Guest** uma. Its sparks are still stored on the veteran, so the lineage stays complete even though that parent isn't in the roster.

### 4.4 Identity and deduplication
The game doesn't show a stable veteran ID. Fingerprint = hash(character, outfit, stats, aptitudes, sorted own sparks, parent characters). If a fingerprint already exists, upsert; otherwise insert. Changes to favourite or lock status don't alter the fingerprint.

### 4.5 Independent vs Manual tagging
**Detected automatically from the epithet** (confirmed: the user never changes epithets manually).
- Epithet (OCR'd from the header, below the name) == **"Independent Learner"** → `independent`.
- Any other epithet (e.g. "Monarch" on the manually trained Tokai Teio) → `manual`.
- The web app keeps a manual override per veteran and per batch in case an epithet is changed in future.
- Batch tagging at capture time is no longer needed and becomes an optional override.
- The optional classifier is dropped; the epithet is sufficient.

### 4.6 Support cards
**Support Card List** screen: a 5-column grid, `Held N/255` counter, sortable by rarity. Each tile shows the rarity badge, type icon (top right), **4 LB diamonds** (cyan = filled, grey = empty) and `Lvl N`.
- **Card identity:** hash the art and match it against master data art. The type icon is a cheap filter before matching. The tile has no name.
- **LB:** sample 4 fixed diamond centres per tile and check each for cyan. Spike result: **every tile on the first screen correct (20/20)**, including the 6-card deck on Career Info, where the Friends card sits higher.
- **Level:** OCR `Lvl N` (it reads correctly; the diamonds become junk characters before it, which are stripped).
- **Low confidence → detail popup:** open the **Featured Cards** popup (`[Title]` + character, `Lvl 40 / 40`, unique perk, support effects). The text there names the card exactly.
- **Scrolling:** scroll the grid and stop when `Held` has been accounted for. A full sync replaces the owned-cards table.

## 5. Data model (D1)

**Master data** (seeded, versioned per game patch):
`characters`, `outfits` (base aptitudes, growth-rate bonuses), `skills`, `factors` (id, type, target), `support_cards` (type, rarity, hint skills, event skills), `affinity_groups` + `affinity_members` (for compatibility), `scenarios` (plugin id, stat caps, inheritance turns).

**User data:**
```
veterans(id, fingerprint UNIQUE, character_id, outfit_id, scenario_id,
         train_mode ENUM(independent, manual, unknown), rank, rating, epithet,
         spd, sta, pow, gut, wit, apt_* ×10, date_acquired, races, wins,
         captured_at, batch_id, confidence)
veteran_parents(veteran_id, slot 1|2, character_id, outfit_id, is_guest,
         guest_trainer, matched_veteran_id NULL)       -- links to own roster when the fingerprint matches
veteran_skills(veteran_id, skill_id, level)
veteran_factors(veteran_id, owner ENUM(self, parent1, parent2), factor_id, stars)
veteran_deck(veteran_id, slot, card_id, lb, borrowed)
owned_cards(card_id, lb, level, updated_at)
capture_batches(id, started_at, mode_override NULL, agent_version, layout_version)
review_items(id, veteran_id, field, ocr_text, candidates JSON, crop_key, status)
cm_targets(id, name, track, distance, surface, style, min_stats JSON,
           required_aptitudes JSON, required_skills JSON, weights JSON)
rules_versions(id, json, created_at)                    -- inheritance rule parameters
model_snapshots(id, trained_at, params JSON)            -- fitted history model
```

## 6. Calculation engine (TypeScript, `packages/engine`)

### 6.1 Scenario plugins
```ts
interface ScenarioPlugin {
  id: string; name: string;
  statCap: number;
  inheritanceTurns: number[];          // turns when inheritance events fire
  featureExtractor(deck: Deck): number[]; // scenario-specific deck features
  scenarioFactors: FactorId[];          // e.g. scenario white sparks
}
```
Adding a new Global scenario means one plugin plus its master data rows.

### 6.2 Inheritance model (rules are data, not code)
Each inheritance event rolls every spark from **parent1, parent2 and the four grandparents**:

```
P(activate) = base[type][stars] × (1 + affinity / 100)     // parameters in rules_versions
blue  → +statGain[stars] to that stat
pink  → +1 grade to that aptitude (capped)
white/green → skill hint (level by stars)
```
Also: **affinity** is computed from shared affinity groups between trainee, parents and grandparents; the **initial stat bonus** comes from parents' blue sparks at the start of the career.

The expected values are exact sums over sparks. For p10/p90 the engine uses Monte Carlo (about 2,000 samples).

> ⚠️ I'm not certain of the exact base rates and stat gains for Global. They start from community-documented values in a `rules.json`, then get **calibrated against the user's own data**: each veteran with captured parents is a labelled example of "these sparks → this outcome". The calibration job reports how well the rules fit.

### 6.3 Training-outcome model (history-based)
For each veteran with known parents: `residual = final_stats − expected_inheritance_bonus`. This is what training alone produced.

Fit a **hierarchical ridge regression** (or empirical Bayes shrinkage) per stat:
```
residual_stat ~ scenario + train_mode + trainee growth bonuses
              + Σ card effects (card_id × LB, pooled toward card type/rarity)
              + recency weight (recent runs weigh more; skill improves)
```
- Pooling lets unseen decks borrow strength from similar cards, which matters with 260 samples.
- The residual covariance across the 5 stats gives realistic joint bands.
- Refit runs in a Web Worker after each sync, with the snapshot saved to `model_snapshots`.

**Skills:** `P(child has skill S) = P(hint available) × P(acquired | hint, train_mode)`, where
- hint sources are the deck's hint and event skills, parent and grandparent white/green sparks (via 6.2), and the trainee's innate skills;
- the acquire rate is learned from history per mode (the independent-training AI's picks aren't controllable, so its rates matter).

**Aptitudes:** base aptitude of the trainee's outfit + the expected pink-spark upgrades from 6.2.

### 6.4 CM target scoring
```
score = P(all min stats met ∧ all required aptitudes ∧ all required skills)
```
This is estimated by sampling the joint prediction. Secondary sort is the weighted expected surplus over the minimums.

### 6.5 Ranking parent pairs
1. Enumerate the legal pairs among the veterans. With 260 that's C(260,2) ≈ 33.7k. Legality (confirmed): the two parents are different characters, and neither is the trainee's character. Parents come from the user's roster only; guest/rental parents are out of scope for v1.
2. **Fast pass:** closed-form expected score for every pair (no sampling).
3. **Precise pass:** Monte Carlo on the top 100.
4. Return the top N with their breakdown: the spark contributions, affinity and which requirement is the bottleneck.

Optional: a "suggest deck" mode that ranks decks from `owned_cards` against the chosen parents with the same method.

## 7. Web app screens
1. **Roster**: filterable veteran table (character, sparks, stars, mode, scenario), mode override, detail with lineage.
2. **Review queue**: crop image, OCR text and top-3 vocabulary candidates, one-click fix.
3. **Support cards**: owned cards and LB, deck builder.
4. **CM Targets**: define the course, minimum stats, aptitudes and required skills. Save presets per CM.
5. **Planner**: pick trainee + deck (+ optional fixed parent) → ranked pairs → drill-down showing expected inheritance, predicted stats with p10–p90 bars, per-skill probability and overall P(meet target).
6. **Model health**: calibration charts (predicted vs actual on held-out veterans), sample counts per mode and scenario.

## 8. Repository layout
```
/agent            C# .NET 8 WPF capture agent (+ /agent.Tests with fixture screenshots)
/agent/layouts    versioned layout profiles (ROIs per screen, per game UI version)
/web              React + Vite SPA
/api              Cloudflare Worker (Hono) + D1 migrations
/packages/engine  TS inheritance + prediction + ranking (pure, unit-tested)
/packages/schema  JSON Schemas shared by agent and API (C# types generated)
/data/master      master data build scripts + seed SQL
/docs
```

## 9. Risks
| Risk | Mitigation |
|---|---|
| OCR errors | Closed-vocabulary matching, validator, review queue, regression tests on fixture screenshots |
| Game UI updates move elements | Layout profiles are data. Detection of an unknown screen stops capture instead of storing bad data |
| Unknown or incorrect inheritance numbers | Rules as data + calibration on the user's history |
| Small samples per deck | Hierarchical pooling; the UI shows the sample count and interval width |
| Master data for Global | Build from community datamined sources; confirm licence and terms; version per patch |
| ToS | Passive screen reading by default; auto-clicking is opt-in |
| Free-tier limits | Engine runs client-side; D1/R2 usage is well under the limits at this scale |

## 10. Delivery phases
0. ~~Spike: OCR real screenshots, go/no-go~~ **Done → go.** Next: port to Windows.Media.Ocr and build a labelled fixture set of about 20 veterans.
1. **Master data + schema + API + roster UI** (manual JSON import).
2. **Capture agent, assisted mode** + review queue + epithet-based mode detection. Import all 260.
3. **Engine:** inheritance expectations → history model → CM scoring → pair ranking.
4. **Calibration + model health** page.
5. Support card OCR, auto-navigation, deck suggestions.
