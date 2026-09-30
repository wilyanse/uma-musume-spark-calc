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

## Q-4 (T03) Missing master-data facts: inheritance turns, card vocab kind
Context: (a) 01 §11 `scenarios.inheritanceTurns` needs the Global turn numbers of the two inspiration events; GameTora only says "first half of April, years 2 and 3". (b) `vocab.json` kinds don't include `card`, but 20 §5 wants "The Brightest Star in Japan!" (a support-card title) to resolve.
Assumption taken: (a) `inheritanceTurns: []` with `extra.inheritanceTurnsVerified:false`. (b) card names/titles go to `vocab-cards.json` (same entry shape, `kind:'card'`), listed in `latest.json`; the schema enum is untouched.
Blocking: no (orchestrator: decide whether to add `card` to the VocabEntry kind enum in `@uma/schema`)

## Q-5 (T03) Card art hash framing
Context: card art hashes are computed from GameTora's 128×128 art thumbnails; the in-game list tile is portrait with badge, LB diamonds and level text. Framing differs, so Hamming thresholds are unknown.
Assumption taken: one shared crop box (`art-crop.ts`); the agent should match by nearest hash and T09/T15 calibrate the threshold on real captures.
Blocking: no

## Q-6 (T03) Rank names and the ◯ glyph
Context: GameTora's rank table has numeric ids only; badge names are assumed to follow G…SS+, UG…US9. GameTora writes skill circles as U+25CB while the game and spec use U+25EF.
Assumption taken: assumed ladder (checked only at A+ = 13,471 from screenshot 02); skill names use U+25EF and vocab includes both glyphs.
Blocking: no (verify UG/UF… names against a real veteran screenshot)

## Resolved
- R-1: parents can't be the same character as each other or as the trainee. (user, 2026-09-29)
- R-2: train mode is detected from the epithet: "Independent Learner" means independent, anything else means manual. The user never changes epithets. (user, 2026-09-29)
- R-3: community master data (e.g. GameTora) is acceptable, after checking terms. (user, 2026-09-29)
- R-4: the capture agent runs on the user's Windows PC. Everything else is built and tested on macOS. (user, 2026-09-29)
- R-5: game client is Global (English) on Steam, 1920×1080 reference resolution. (user, 2026-09-29)
