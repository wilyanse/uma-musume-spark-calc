# Uma Spark Calc

Import your Uma Musume (Global, Steam) veteran umas and support cards with a Windows screen-capture agent. Then rank parent pairs by the chance that a child meets a Champions Meeting target.

> Status: implementation through T19 is merged locally and independently reviewed; local agent/workspace/browser checks pass. Windows/game acceptance, real-roster calibration, private hosting and human redistribution approval remain pending. **Windows operator / Claude agent: start at [the Windows handoff](docs/runbooks/windows-handoff.md)**, not the task orchestration plan. A GitHub clone may lag local main until publication is authorized.

## Who reads what
| File | Audience |
|---|---|
| `docs/runbooks/windows-handoff.md` | Windows operator: transfer, prerequisites, staged offline/live acceptance |
| `docs/tasks/H4-windows-validation.prompt.md` | Claude agent on Windows: bounded validation role and evidence requirements |
| `docs/reference/windows/H4-REPORT-TEMPLATE.md` | Windows validator: sanitized report to return to the coordinator |
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
Requirements: Node ≥ 22.18 (native type stripping), exact pnpm from `package.json`, and for the agent exact .NET SDK **10.0.401** selected by `agent/global.json`, plus a separate .NET8 test runtime (Desktop Runtime for native Windows/WPF tests). Projects still target net8.0. See the Windows handoff for English OCR, client geometry and actual native acceptance.

```
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test   # recursive over all workspace packages
pnpm --filter web build
pnpm --filter web check:dist
cd agent
dotnet --version                           # must be 10.0.401
dotnet build Uma.Agent.sln                 # Windows; see runbook for non-Windows cross-targeting
```

Shared contracts live in `packages/schema` (`@uma/schema`). Only the owning task may change contracts and regenerate schemas with the scoped schema build. Do not run `pnpm -r build` / root `pnpm build`, regenerate fixtures/master data, or blanket-format the repository during acceptance. For complete publish/test commands, use `docs/runbooks/agent-install.md` and the Windows handoff.
