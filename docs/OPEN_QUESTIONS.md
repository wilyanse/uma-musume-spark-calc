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

## Resolved
- R-1: parents can't be the same character as each other or as the trainee. (user, 2026-09-29)
- R-2: train mode is detected from the epithet: "Independent Learner" means independent, anything else means manual. The user never changes epithets. (user, 2026-09-29)
- R-3: community master data (e.g. GameTora) is acceptable, after checking terms. (user, 2026-09-29)
- R-4: the capture agent runs on the user's Windows PC. Everything else is built and tested on macOS. (user, 2026-09-29)
- R-5: game client is Global (English) on Steam, 1920×1080 reference resolution. (user, 2026-09-29)
