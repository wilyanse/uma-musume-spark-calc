# Master data sources

Fetch date: 2026-09-30 (GameTora site "last updated 2026-09-28"; manifest 280 keys). Build: `global-20260930`.
Credit: data © GameTora (gametora.com/umamusume), game materials © Cygames, Inc. GameTora is not affiliated with the developers and
publishes no terms page (404 on 2026-09-29); robots.txt allows the pages used. Fetching: ≤ 1 request/s, User-Agent
`uma-spark-calc/0.1 (+https://github.com/wilyanse/uma-musume-spark-calc)`. Raw JSON is cached in `.cache/` (gitignored).

## How the data is found
The pages are a Next.js static export whose `__NEXT_DATA__` is empty; the client loads JSON through a manifest:
1. `https://gametora.com/data/manifests/umamusume.json` maps a key to a content hash (found via page chunk `3162-*.js`).
2. Each file is `https://gametora.com/data/umamusume/<key>.<hash>.json`.
`src/fetch.ts` refreshes the manifest and downloads only files whose hash isn't cached.

## Files used
| Key | Used for |
|---|---|
| `characters` | characters; Global = `playable_en` true (68). Name field is `en_name` in older builds, `name_en` in newer (both handled). |
| `character-cards` | outfits (Global = has `release_en`; 107): title (`title_en_gl`), aptitudes, stat_bonus (growth %), unique + innate skills |
| `support-cards` | support cards (Global = has `release_en`; 255): title, type, rarity, hint + event skills |
| `skills` | skills (Global = has `name_en`, not `unreleased:["en"]`; 623). Names exact incl. ◎ / ○ variants |
| `factors` | sparks: `blue` (5), `pink` (10), `other` type 3 = green (per outfit), `skill` / `race` / `scenario` = white; names from `name_en_gl` (the Global name) |
| `scenarios`, `static/scenarios` | scenarios (Global = has `start_en`; 4), stat cap = `hard_caps[0]` |
| `nicknames` | epithets (`name_en_gl`, e.g. "Independent Learner") for OCR vocab |
| `en/db-files/single_mode_rank` | ranks → min rating (98 rows, Global copy) |
| `en/db-files/succession_relation`, `…_member` | affinity groups (relation_type → points; members = char ids), Global copy |
| images (hashed in memory only) | `https://gametora.com/images/umamusume/supports/support_card_s_<support_id>.png`, `…/characters/icons/chr_icon_<char_id>.png`, `https://media.gametora.com/umamusume/characters/veteran_icon/<card_id>_01.png` |

Pages read for rules: `https://gametora.com/umamusume/legacies`, `https://gametora.com/umamusume/compatibility` and its chunk
`https://gametora.com/_next/static/chunks/2464-2e90db37675bc47e.js`.

## Per-field sources for rules.json (all `verified:false`)
| Field | Value | Source |
|---|---|---|
| activation.blue / pink / green / white (1★,2★,3★) | .7/.8/.9, .01/.03/.05, .05/.10/.15, .03/.06/.09 | GameTora compatibility calculator code: the per-spark base copy-rate table. `white` is the skill-spark table. |
| affinityMultiplier | `1 + affinity/100`, `min(rate, 1)` | same code |
| grandparentWeight | 1 | same code applies the same table to every legacy and sub-legacy; no extra weight found. Assumption. |
| blueInitialBonus | 5 / 12 / 21 | GameTora legacies article (additive across parents and grandparents) |
| pinkGradeGain | 1/1/1 | contract value from 01 §12, not independently confirmed |
| blueStatGain, whiteHintLevels | 0 (UNKNOWN) | no cited source found; placeholders for T15 calibration (Q-3) |
| raceSparkStatGain | per-star stat array + per-race stat types/hint skill; activation .01/.02/.03 | `factors.race[].effects`; calculator code |
| scenarioSparkEffects | per scenario stat type + per-star array | `factors.scenario[].effects` joined to `static/scenarios` |
Affinity symbols in the calculator: total > 50 ⇒ ◯, > 150 ⇒ ◎ (recorded here for the engine; not used by T03).

## Gaps
- **Inheritance turn numbers** per scenario: not published; `scenarios.json.inheritanceTurns` is `[]` and `extra.inheritanceTurnsVerified:false` (Q-4).
- **Rank names**: `single_mode_rank` has numeric ids only. Names G…UG…US9 are an assumed ladder (98 rows = 18 + 8×10); verified only at one point (13,471 → A+, screenshot 02). Q-6.
- **Circle glyph**: GameTora writes `○` (U+25CB); the game/spec use `◯` (U+25EF). Skill names use `◯`; vocab carries both. Q-6.
- **Card ↔ character `characterId`** is omitted for the 5 cards of non-playable/JP-only characters (guest/friend cards such as Tazuna).
- **Card art hashes** come from GameTora's square 128×128 thumbnails, not the in-game portrait tile: thresholds need calibration on real captures (Q-5).
- **Card vocab**: `vocab.json` can't hold card names (schema enum); they are in `vocab-cards.json` (Q-4).
- Dropped on Global (logged at build time in `.cache/gaps.txt`): 21 white skill sparks whose target skill isn't released on Global, the Grandmasters scenario spark, one event skill (Straight Course ○, id 202992) on 5 cards; 10 scenarios without a Global start date.
- Secondary sources (community master.mdb dumps) were **not** used.
