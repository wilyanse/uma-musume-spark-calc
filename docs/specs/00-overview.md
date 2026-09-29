# 00 — Overview

Uma Spark Calc imports the user's Uma Musume (Global, Steam) **veteran umas** and **support cards** by screen capture + OCR, stores them in a private hosted app, and ranks **parent pairs** by the probability that the child meets a **Champions Meeting (CM) target** (minimum stats, required aptitudes, required skills), given a trainee, a support deck and a training mode.

Background and reasoning are in `docs/ARCHITECTURE.md`. Where this spec pack and ARCHITECTURE.md differ, **the specs win**.

## 1. Feature catalog (stable IDs)

| ID | Feature | Milestone |
|---|---|---|
| F01 | Veteran capture (assisted): header, stats, aptitudes, skills, own + parent sparks, deck, scenario, date, parents | M2 |
| F02 | Train-mode detection from epithet ("Independent Learner" → independent, else manual) + manual override | M2 |
| F03 | Support card sync: owned cards, LB, level | M4 |
| F04 | Low-confidence review queue (crop + candidates, one-click fix) | M2 |
| F05 | Roster: filter, sort, veteran detail with lineage | M1 |
| F06 | Master data: characters, outfits, skills, sparks, support cards, affinity, scenarios, rules | M1 |
| F07 | Inheritance expectation: stat gains, aptitude upgrades, skill hints (mean + distribution) | M3 |
| F08 | History-based training model per (scenario, mode) with card effects | M3 |
| F09 | Child prediction: stats (mean, p10–p90), aptitudes, skill probabilities | M3 |
| F10 | CM targets: create, edit, save presets | M3 |
| F11 | Parent-pair ranking for a (trainee, deck, mode, target) | M3 |
| F12 | Model health: calibration charts, sample counts, rules fit | M4 |
| F13 | Auto-navigation of the veteran list (opt-in) | M5 |
| F14 | Deck suggestion from owned cards | M5 |
| F15 | Private hosting: single-user login, agent service token | M1 |

## 2. Modules

| Module | Folder | Spec | Tech | Depends on |
|---|---|---|---|---|
| Shared contracts | `packages/schema` | 01 | TS + zod → JSON Schema | — |
| Master data | `packages/master-data` | 20 | TS build scripts → static JSON | schema |
| Engine | `packages/engine` | 50 | TS, pure, no DOM | schema, master-data (types) |
| API | `apps/api` | 40 | Cloudflare Worker (Hono) + D1 + R2 | schema |
| Web | `apps/web` | 10, 60 | React + Vite, engine in a Web Worker | schema, engine |
| Capture agent core | `agent/src/Uma.Agent.Core` | 30 | .NET 8, cross-platform, testable on macOS | schema (JSON Schema) |
| Capture agent Windows | `agent/src/Uma.Agent.Windows` | 30 | .NET 8 WPF, WGC, Windows.Media.Ocr | Agent.Core |
| DevOps | `.github/`, `apps/api/wrangler.jsonc`, `docs/runbooks/` | 65 | GitHub Actions, Wrangler | api, web |

## 3. Repository layout
```
/AGENTS.md  /CHANGELOG.md  /README.md
/package.json  /pnpm-workspace.yaml  /tsconfig.base.json
/packages/schema        zod schemas, JSON Schema export (schema/*.json)
/packages/master-data   source adapters, build script, output → apps/web/public/master/<version>/
/packages/engine        inheritance, model, predict, rank, scenarios/
/apps/api               Worker: src/, migrations/, wrangler.jsonc
/apps/web               React SPA: src/, public/master/
/agent/Uma.Agent.sln
/agent/src/Uma.Agent.Core         layouts, classifiers, parsers, assembler, outbox, uploader
/agent/src/Uma.Agent.Windows      capture, OCR, input, tray UI
/agent/tests/Uma.Agent.Core.Tests fixtures from docs/reference/screenshots + labels
/agent/layouts/*.json             versioned layout profiles
/docs/specs  /docs/adr  /docs/changelog  /docs/reference  /docs/runbooks
/spike/ocr                        feasibility spike (reference only, not built)
```

## 4. Runtime topology
```
Windows PC: Uma.Agent.Windows ──HTTPS + CF Access service token──► Worker "uma-spark-calc"
                                                                     ├─ /api/*  Hono → D1, R2
Browser ──CF Access login (email OTP)──────────────────────────────► └─ /*      static SPA + /master/<v>/*.json
                                                                        SPA runs engine in a Web Worker
```
It's **one Worker** with static assets. Static asset requests are free and don't count against the Worker request quota. Master data is static JSON, not D1.

## 5. Milestones and exit criteria

| M | Scope | Exit criteria |
|---|---|---|
| M1 Foundations | T01–T04, T07, T12 | Monorepo builds; master data v1 published as JSON; API ingests a fixture veteran into local D1; roster shows it; deploy workflow works against a preview (or documented as blocked on H2). |
| M2 Capture | T09–T11 | Agent Core parses all 15 fixture screenshots to the labelled ground truth (≥ 99% field accuracy, 100% on stats); the Windows build compiles; human run H4 imports ≥ 20 real veterans. |
| M3 Prediction | T05, T06, T08, T13 | Golden dataset: planted best pair ranks #1; card effects recovered within tolerance; planner screen returns ranked pairs for 260 synthetic veterans in < 5 s. |
| M4 Quality | T15, F03, F12 | Rules calibrated on the real roster; model health page live; support card sync works. |
| M5 Convenience | T14, F13, F14 | Auto-navigation and deck suggestions. |

## 6. Non-goals (v1)
Reading game memory or network traffic; friend/rental parents as candidates; race simulation; multiple users; mobile clients; JP server.

## 7. Glossary
- **Veteran**: a finished trained uma saved in the roster.
- **Spark / factor**: an inheritable trait with 1–3 stars. Types: **blue** (stat), **pink** (aptitude), **green** (unique skill), **white** (skill, race or scenario).
- **Legacy / parent**: a veteran used as a parent. Its own parents are the child's **grandparents**.
- **Affinity (compatibility)**: points from shared relation groups between trainee, parents and grandparents. It raises the chance that sparks activate.
- **Inheritance event**: fixed turns in a career when sparks roll to activate.
- **Train mode**: `independent` (the in-game independent-training feature) or `manual` (played by hand).
- **LB**: limit break, 0–4, shown as 4 diamonds.
