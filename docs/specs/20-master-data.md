# 20 — Master data

Owner task: **T03**. Package: `packages/master-data`. Output: `apps/web/public/master/<version>/*.json`, in the shapes of 01 §11.

## 1. Sources and licensing
- **Primary source: GameTora** (`gametora.com/umamusume`, Global server data). It states that game materials are © Cygames and that it isn't affiliated. It publishes no terms page (a 404 on 2026-09-29), and robots.txt allows the relevant pages.
  - **Rules:** fetch at most 1 request/second with a descriptive User-Agent. Cache raw responses in `packages/master-data/.cache/` (gitignored). Commit only the derived JSON. Credit GameTora in `README.md` and in the app footer.
- The pages are a Next.js static export. First look for the JSON data files the pages load (inspect the network requests or `_next/data/<buildId>/…json`). Parse HTML only as a fallback. Record the exact URLs used in `packages/master-data/SOURCES.md`.
- If a field is only on the JP server or can't be found, leave it out and log it in `SOURCES.md` → *Gaps*. Never fabricate it.
- **Secondary sources** (only to fill gaps, cited per field): the community umamusume databases on GitHub, e.g. the master.mdb-derived dumps. Use them only if their licence allows, and record the licence in `SOURCES.md`.

## 2. Entities to build (all Global-only)
1. Characters (+ aliases as shown in game, e.g. "T.M. Opera O").
2. Outfits: title in brackets exactly as in game (e.g. `Frontline Elegance`), base aptitudes, stat growth %, unique skill, innate skills.
3. Skills: names **exactly as in game**, including the `◯` / `◎` suffixes as separate variants ("Medium Corners ◯"). Screenshot evidence shows the ◯ variants.
4. Sparks: every blue (5 stats), pink (10 aptitudes), green (one per unique skill), and white spark (skill, race such as "Japan Cup", scenario such as "URA Finale" / "Unity Cup").
5. Support cards: name, title, type, rarity, hint skills, event skills, art (§4).
6. Affinity (compatibility) relation groups.
7. Scenarios available on Global, with stat cap and inheritance turns.
8. Ranks → minimum rating.
9. Epithets: at least "Independent Learner", plus any others found; used only for OCR vocab.
10. `rules.json` (01 §12): fill from cited community documentation with `verified:false`. Include a `source` URL for each value.

## 3. Build
- `pnpm --filter master-data build` runs fetch (cached) → normalise → validate against the zod schemas → write the versioned folder + `latest.json` with sha256 hashes.
- Version string: `global-YYYYMMDD` (the build date), plus `-N` if built twice in a day.
- `vocab.json` is generated from all names and aliases.
- Deterministic output: stable sort by ID, 2-space JSON, LF line endings.

## 4. Card art hashes (for agent card identification)
- For each support card, download its art thumbnail **in memory only**. Compute a **64-bit dHash** (9×8 greyscale) as a hex string and store it in `cards.json.artHashes`. **Never commit images.**
- The hash must match the agent's tile crop, whose ROI is the art region without the frame, LB diamonds or level text. Both sides use the same crop proportions, defined in `packages/master-data/src/art-crop.ts` and mirrored in `agent/layouts/*.json` → `cardArtCrop`.
- Also compute a hash per **character icon** (for parent and grandparent identification from portraits on Career Info) into `characters.json.iconHashes`.

## 5. Acceptance
- Zod validation passes for all files, and there are no dangling ID references (a test checks every reference).
- Each of these names from the screenshots resolves through `vocab.json`: Mejiro McQueen, Frontline Elegance, The Duty of Dignity Calls, Straightaway Adept, Corner Recovery ◯, Pace Chaser Straightaways ◯, Front Runner Savvy ◯, Kawasaki Kinen, JBC Classic, Keeping the Lead, Uma Stan, My True Strength, Shooting Star, NHK Mile C., Barcarole of Blessings, Ignited Spirit WIT, Ignited Spirit: Stamina +, Unity Cup, Triumphant Pulse, KEEP IT REAL., Victory Cheer!, Tokai Teio, Beyond the Horizon, Special Week, The Brightest Star in Japan!, Independent Learner, The Beginning: URA Finale.
- `SOURCES.md` lists the URLs, the fetch date, gaps and the per-field sources for rules.json.
