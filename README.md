# Uma Spark Calc

Import your Uma Musume (Global, Steam) veteran umas and support cards with a Windows screen-capture agent. Then rank parent pairs by the chance that a child meets a Champions Meeting target.

> Status: **specification phase**. Nothing is built yet. Specs are in `docs/specs/`.

## Who reads what
| File | Audience |
|---|---|
| `docs/ARCHITECTURE.md` | Background and design reasoning (specs override it) |
| `AGENTS.md` | Every implementing agent: rules, changelog, definition of done |
| `docs/specs/00-overview.md` | Everyone: features F01–F15, modules, layout, milestones |
| `docs/specs/01-data-contracts.md` | Everyone: **authoritative** payloads, DB schema, API, master data |
| `docs/specs/10-design.md` | Design agent (T07) |
| `docs/specs/20-master-data.md` | Master data agent (T03) |
| `docs/specs/30-capture-agent.md` | Agent tasks (T09, T10, T11, T14) |
| `docs/specs/40-api.md` | API task (T04) |
| `docs/specs/50-engine.md` | Engine tasks (T05, T06, T15) |
| `docs/specs/60-web.md` | Web task (T13) |
| `docs/specs/65-devops.md` | DevOps task (T12) and the human setting up Cloudflare |
| `docs/specs/70-testing-acceptance.md` | QA, golden dataset (T08), acceptance matrix |
| `docs/specs/80-orchestration-plan.md` | Orchestrator: task cards, waves, human checkpoints, status |
| `docs/specs/85-implementation-review.md` | Independent reviewer: per-task and milestone review process |
| `docs/reviews/` | Review reports per task round (`Txx-review-N.md`) |
| `docs/OPEN_QUESTIONS.md` | Open and resolved questions |
| `docs/changelog/` | One change log per task (`Txx-*.md`), plus milestone evidence |
| `docs/reference/screenshots/` | 15 real game screenshots (1920×1080), which are also the agent's test fixtures |
| `spike/ocr/` | OCR feasibility spike (reference only) |

## Credits
Game data is derived from [GameTora](https://gametora.com/umamusume). Uma Musume materials are © Cygames, Inc. This project isn't affiliated with Cygames or GameTora.

## Development quickstart
Requirements: Node ≥ 22.18 (the build runs `.ts` scripts via Node native type stripping, on by default from 22.18), pnpm 11 (`corepack enable`), and for the agent the .NET SDK (9 or 10 works; projects target net8.0).

```
pnpm install
pnpm lint && pnpm typecheck && pnpm test   # recursive over all workspace packages
pnpm build                                  # writes packages/schema/json/*.schema.json
dotnet build agent/Uma.Agent.sln
```

Shared contracts live in `packages/schema` (`@uma/schema`). After editing a schema, run `pnpm build` and commit the regenerated `packages/schema/json/`; a test fails if they drift.
