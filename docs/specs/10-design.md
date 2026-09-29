# 10 — Design (web app)

Owner task: **T07**. The design agent delivers repo-local artifacts. Implementers build from them, so there's no Figma.

## 1. Deliverables (`docs/design/`)
| File | Content |
|---|---|
| `tokens.json` | Colours (light + dark), spacing scale, radii, type scale, shadows. Named semantically: `bg`, `surface`, `text`, `muted`, `accent`, `danger`, `warn`, `ok`, plus spark colours `spark.blue/pink/green/white` and grade colours `grade.G…S`. |
| `screens/*.html` | Static, browser-openable prototypes, one per screen (S01–S07). Plain HTML+CSS using `tokens.css` generated from tokens.json. No framework. |
| `screens/*.png` | Exports at 1440×900 (desktop, light + dark) and 390×844 (mobile, light). |
| `manifest.json` | `{screen, theme, viewport, file}` for every PNG. Must list exactly 7 screens × (2 desktop + 1 mobile) = 21 images. |
| `components.md` | Components with their states (default, hover, focus, disabled, loading, empty, error). |
| `bindings.md` | For each screen: every displayed value → a field in `01-data-contracts.md` or an engine output in `50-engine.md`. Every action → API endpoint or engine call. |
| `copy.md` | All UI strings, empty-state text and error messages. |
| `index.html` | Gallery linking every screen and PNG. |

Label illustrative data as such. Use real names from the screenshots in `docs/reference/screenshots/` for realism.

## 2. Principles
- **Dense and scannable:** a power-user tool. Tables beat cards on desktop.
- **Game-native visual cues:** spark pills use the game's colours (blue/pink/green/white) with ★ counts. Grade letters are coloured like the game's (see screenshot 01).
- **Show uncertainty:** every prediction shows the mean, a p10–p90 bar and the sample size *n*. Say "low data" when n < 10.
- **Explain rankings:** every ranked pair can expand into why: spark contributions, affinity and which requirement is the bottleneck.

## 3. Screens
| ID | Screen | Features | Key content |
|---|---|---|---|
| S01 | Roster | F05, F02 | Filter bar (character, mode, scenario, has-spark X with ★≥N, rating range). Table: portrait placeholder, name + outfit, rank, rating, 5 stats, mode badge (Independent/Manual, with an override icon when overridden), blue/pink/green spark summary, date. Row → S02. |
| S02 | Veteran detail | F05, F02 | Header like the game (name, outfit, rank, rating, epithet, mode toggle). Stats + aptitude grid. Tabs: Skills, Sparks (self / parent1 / parent2 groups), Deck (6 cards + LB diamonds + Friends flag), Lineage (parents linked when `matchedVeteranId`, guest badge). Low-confidence fields get a dotted underline and link to S03. |
| S03 | Review queue | F04 | List of open items: crop image, raw OCR text, top-3 candidate buttons, free-text search over the vocab, "Dismiss". Keyboard: 1/2/3 to pick, D to dismiss, J/K to navigate. |
| S04 | Support cards | F03 | Grid of owned cards (name, type icon, rarity, LB diamonds, level), last sync time, filter by type/LB. Deck builder: 6 slots (5 owned + 1 borrowed "Friend" slot chosen from all master cards). |
| S05 | CM targets | F10 | List + editor: course, style, min stats (5 inputs), min aptitudes (grade pickers), required skills (vocab autocomplete chips), optional skills with weights. |
| S06 | Planner | F09, F11 | Left: trainee (outfit picker), deck (from S04), mode (Independent/Manual), target (from S05), optional "lock parent 1". Right: ranked pairs table (rank, parent1, parent2, P(meet target), expected stat surplus, affinity, bottleneck). Expanding a row shows the predicted stat bars (mean + p10–p90 vs the target line), aptitude before→after with the probability of reaching the target grade, a per-required-skill probability list, and the spark contribution list. Progress bar while ranking. |
| S07 | Model health | F12 | Sample counts per (scenario, mode); predicted-vs-actual scatter per stat on held-out data; MAE table; 80% interval coverage; the rules table with verified/unverified badges and the calibration result. |

Navigation: left rail on desktop (Roster, Review (badge count), Cards, Targets, Planner, Health), bottom tabs on mobile (Roster, Planner, Targets, More).

## 4. Accessibility and quality bar
WCAG 2.2 AA contrast for text in both themes (4.5:1 body, 3:1 large text/UI). Spark colours never carry meaning alone, so always pair them with a type label or icon. Every control is keyboard-reachable with a visible focus ring. Tables use `<th scope>`.

## 5. Acceptance (T07)
- All files in §1 exist. `manifest.json` lists exactly 21 PNGs, and a script (`docs/design/verify.mjs`) checks that every file exists with the stated dimensions and every token pair in `contrast-pairs` passes AA. Its output goes in the changelog.
- `bindings.md` maps every S01–S07 element to a contract field, engine output or action, with no unmapped items. Anything missing from the contracts goes to `OPEN_QUESTIONS.md` instead of being invented.
- **Human checkpoint H5:** the user approves the design before T13 starts building screens S03–S07. S01/S02 can start on the tokens.
