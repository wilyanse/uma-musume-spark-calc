# Components

Build from these in T02/T13. All colours, spacing, radii and type sizes come from `tokens.json` (CSS variables in `tokens.css`; dots become dashes, e.g. `spark.blue.bg` → `--spark-blue-bg`). The reference implementation of each component is the CSS class in `app.css`, used by the prototypes in `screens/`.

State legend: **D** default · **H** hover · **F** focus (2 px `focus` ring, 2 px offset, always visible) · **X** disabled · **L** loading · **E** empty · **Err** error. A cell of "n/a" means the state doesn't apply.

## Atoms

| Component (`class`) | Purpose | D | H | F | X | L | E | Err |
|---|---|---|---|---|---|---|---|---|
| **SparkPill** (`.spark.blue\|pink\|green\|white`) | One spark: glyph (● ♥ ▲ ◇) + name + ★ count (1–3, off stars dimmed). Colour is never the only cue: the glyph, a screen-reader "blue spark:" prefix and a `title` carry the type. Props: `type, name, stars, lowConfidence?` | tinted `spark.<t>.bg`, border `spark.<t>`, label `spark.<t>.fg` | n/a (not interactive) | when wrapped in a link (low-confidence) | n/a | skeleton pill (same size, `surface2`) | n/a | n/a |
| **Stars** (`.stars`) | ★ ×3 with `aria-label="n of 3 stars"` | `star` filled, `star.off` empty | n/a | n/a | n/a | n/a | n/a | n/a |
| **GradeBadge** (`.grade.g-S…G`) | Aptitude/stat grade letter, coloured like the game (S gold, A orange, B pink, C green, D blue, E purple, F indigo, G grey), letter colour `grade.X.on`. `lg` size for headers. `ghost` = dashed outline for "target grade" in before→after | fill `grade.X` | n/a | n/a | n/a | grey `G`-style block | "—" (no badge) | n/a |
| **LbDiamonds** (`.lb`) | LB 0–4 as ◆ (filled `spark.blue`) / ◇-dim (`star.off`) + "LBn" text | as described | n/a | n/a | n/a | n/a | n/a | n/a |
| **RankBadge** (`.rank`) | Overall rank letter (A+, SS…) | `accent.soft` bg, `accent` border | n/a | n/a | n/a | n/a | "—" | n/a |
| **ModeBadge** (`.mode.independent\|manual`) | Train mode. `✎` icon with `aria-label="Manually overridden"` when `modeSource='override'` | Independent = `accent.soft`; Manual = `surface2` + border | tooltip explains source | n/a | n/a | n/a | n/a | n/a |
| **TypeChip** (`.type-chip`) | Support card type: 3-letter code + word (SPD Speed…) so type isn't colour-only | `surface2` | n/a | n/a | n/a | n/a | n/a | n/a |
| **Tag** (`.tag.ok\|warn\|err\|neutral`) | Status text: verified / unverified / low data / Guest / bottleneck / in range | soft bg + strong fg | n/a | n/a | n/a | n/a | n/a | n/a |
| **Avatar** (`.avatar`) | Portrait placeholder: initials on `surface2`, round. No game art is stored (see Q-73); a future image slot keeps the same size (32 px table, 72 px header) | initials | n/a | n/a | n/a | shimmer-free flat fill | initials | n/a |
| **LowConfidence** (`.lowconf`) | Dotted `warn` underline on any value whose `CaptureField.status='low_confidence'`; link to S03 | dotted underline | underline solid, `cursor:help` | ring | n/a | n/a | n/a | n/a |
| **Button** (`.btn`, `.primary`, `.danger`, `.sm`) | Actions | outline; primary = `accent` fill | `row.hover` bg / brightness | ring | 50 % opacity, `aria-disabled`, no pointer | label + inline spinner, width preserved, `aria-busy` | n/a | danger variant for destructive |
| **Kbd** (`.kbd`) | Keyboard hint (1/2/3, D, J, K) | boxed mono | n/a | n/a | n/a | n/a | n/a | n/a |
| **Input / Select** (`.input`) | Text, number, select | 1 px `border` | border `text` at 40 % | ring | 50 % opacity | n/a | placeholder in `muted` | border + text `danger`, message below with `aria-describedby` |
| **SegmentedControl** (`.seg`) | Radio group (mode, style, surface). Real `<input type=radio>` inside labels | checked = `accent.soft` | `row.hover` | ring on checked item | 50 % | n/a | n/a | n/a |
| **Chip** (`.chip`, `.chip.sel`) | Removable skill chip; `sel` for required skills | `surface2` | n/a | ring on ✕ button | n/a | n/a | n/a | n/a |
| **Kpi** (`.kpi`) | Big number + caption (S07) | value + caption | n/a | n/a | n/a | "—" placeholder | "—" | `danger` value with caption "unavailable" |

## Data visualisation

| Component | Purpose | Notes / states |
|---|---|---|
| **RangeBar** (`.rb`) | One stat prediction: `mean` marker (`bar.mean`), p10–p90 span (`bar.range`), dashed `target.line` at the minimum. Always followed by text `mean (p10–p90) / target`, so the chart is not the only carrier of the numbers. D: as drawn. L: flat `surface2` track. E: hidden with "No requirement" if the target has no min for that stat. Err: "Prediction failed" tag. |
| **ProbabilityBar** (`.pmeet`) | P(meet target) as a 64 px bar + percentage. Shows "low data" `Tag` when the sample size behind the number is < 10. |
| **ProgressBar** (`.progress`) | Ranking progress, `role=progressbar` with `aria-valuenow`. L: determinate while `onProgress` fires. Err: `danger` bar + retry button. |
| **Scatter** (`.scatter`) | SVG predicted-vs-actual with y=x dashed line, one per stat (S07). E: "Not enough held-out data (needs ≥ 10)". Err: card with retry. |
| **StatStrip** (`.stat5`) | Five stats with a thin bar to the 2000 cap; low-confidence stat gets `LowConfidence`. |
| **AptitudeGrid** (`.aptrow`) | Track / Distance / Style rows of label + `GradeBadge` cells, same grouping as the game. |

## Composite

| Component | Purpose | D | H | F | X | L | E | Err |
|---|---|---|---|---|---|---|---|---|
| **DataTable** (`table`) | Sortable dense table; `<th scope="col">` and `<th scope="row">` for the row header; `aria-sort` on the active column; sticky header. Row click/Enter opens detail. | as drawn | `row.hover` | row link ring | n/a | 8 skeleton rows | see per-screen copy | banner above table + retry, previous data stays visible |
| **FilterBar** (`.filters`) | Wrapping row of labelled controls + Reset | as drawn | n/a | per control | n/a | controls disabled while master data loads | n/a | n/a |
| **Panel** (`.panel`) | Titled surface with header row | as drawn | n/a | n/a | n/a | header + skeleton body | see copy | banner |
| **Banner** (`.banner.warn`) | Inline notice, `role=status` (or `alert` for errors) | as drawn | n/a | n/a | n/a | n/a | n/a | `danger.soft` variant |
| **Tabs** (`.tabset`) | Skills / Sparks / Deck / Lineage on S02. Keyboard: ←/→ moves between tabs, `role=tablist/tab/tabpanel` in the real build (the prototype uses radios for no-JS switching) | selected has `accent` underline | `text` colour | ring around tab | n/a | panel skeleton | see copy | panel error with retry |
| **CardTile** (`.cardtile`) | Support card: art placeholder, rarity, name, title, TypeChip, LbDiamonds, level. `friend` = dashed `accent` border; `sel` = `accent` outline for "in deck" | as drawn | `row.hover` | ring | greyed if already in deck and adding | skeleton tile | n/a | n/a |
| **DeckSlot** (row in the deck builder) | Slot number, card, LB, level, remove ✕. Slot 6 is the borrowed Friend slot (dashed) with a searchable all-cards picker | as drawn | n/a | ring | n/a | n/a | "Empty slot" dashed row | n/a |
| **ReviewQueueItem** (`.queue a`) | Veteran name, field path, raw OCR text; `aria-current` for selection | as drawn | `row.hover` | ring | n/a | skeleton | see copy | n/a |
| **CandidateButton** (`.cand`) | One candidate: value, kind, score, key hint (1/2/3). Top candidate has `accent` border | as drawn | `row.hover` | ring | X while resolving | spinner | "No candidates" | inline error on 409 |
| **CropImage** (`.crop`) | The uploaded crop, scaled to fit, on a checker background | image | n/a | n/a | n/a | skeleton | "No crop stored for this field" | "Crop failed to load" + retry |
| **SkillChipInput** | Autocomplete over `vocab.json` (kind `skill`); Enter adds a chip, Backspace removes the last | as drawn | option `row.hover` | ring | X | n/a | "No skills match" | n/a |
| **PairDetail** (`.detail`) | Expanded row on S06: stat RangeBars, aptitude before→after, per-skill probabilities (+ bottleneck tag), spark contributions, affinity breakdown | as drawn | n/a | n/a | n/a | skeleton while the Monte Carlo runs for that pair | n/a | "Couldn't compute details" + retry |
| **NavRail** (`.rail`) | Desktop left rail: Roster, Review (badge = open count), Cards, Targets, Planner, Health; footer shows master version and model kind | `aria-current=page` = `accent.soft` | `row.hover` | ring | n/a | badge hidden | badge hidden when 0 | badge hidden |
| **BottomTabs** (`.tabs-bottom`) | Mobile: Roster, Planner, Targets, More (More leads to Review, Cards, Health). Badge on More | selected = `accent.soft` | n/a | ring | n/a | n/a | n/a | n/a |

## Layout rules
- Breakpoint: ≤ 720 px switches to the mobile layout (rail → bottom tabs, tables hide low-priority columns via `.hm`, splits stack).
- Density: table rows 40–56 px; body text 14 px, tables 12.5 px.
- Both themes: `prefers-color-scheme` by default, with `data-theme="light|dark"` on `<html>` as an explicit override (used by the PNG export).
- Focus ring: 2 px `focus` outline, 2 px offset, on every interactive element. Never removed.
