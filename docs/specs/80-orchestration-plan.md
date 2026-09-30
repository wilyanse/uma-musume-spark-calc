# 80 — Orchestration plan

## 1. How orchestration works
- **Orchestrator:** Hermes in the main checkout `~/Projects/personal/uma-musume-spark-calc`, on `main`. It creates worktrees, dispatches workers, reviews diffs, runs the verification commands itself, merges into local `main` and adds one line to `CHANGELOG.md`. **Pushing** to `origin main` happens at the end of each wave, after the user has reviewed the wave summary (the user reviews before anything is published).
- **Workers:** Claude **Opus 5.5**, reasoning **medium**, first; **GPT-6 Sol**, reasoning **medium** via `openai-codex`, fallback if Opus is unavailable or provider-blocked (user direction). Preserve partial work when switching; record the reason and actual model. Each task runs in its own git worktree at `../uma-musume-spark-calc.worktrees/Txx-<slug>` on branch `task/Txx-<slug>`, created from the current `main`. Launch:
  ```
  hermes chat --oneshot -Q --provider anthropic -m claude-opus-5-5 --reasoning medium \
    --query-file docs/tasks/Txx.prompt.md        # run with workdir = the task worktree
  ```
  The prompt file contains the task card from §4 plus: "Read AGENTS.md first. Write docs/changelog/Txx-<slug>.md. Commit on your branch. Don't push."
- **Parallelism:** at most **4** workers at a time. Tasks in the same wave with no `Needs` between them run in parallel.
- **Review gate per task:** orchestrator gate A (changelog, scope, re-run verification), then an **independent reviewer** (Opus 5.5 medium first, GPT-6 Sol medium fallback, fresh read-only session) per `85-implementation-review.md`. A task merges (`--no-ff`) only on reviewer `PASS` + a green re-run. `CHANGES_REQUESTED` goes back to the worker, for at most 2 rounds; after that the orchestrator fixes it or escalates.
- **Pinned launch policy:** `scripts/orch.sh` uses `--ignore-user-config` with explicit provider/model/medium effort so the profile's unrelated fallback cannot run. On failure, preserve logs and partial work, probe Opus first, then explicitly retry with `ORCH_PROVIDER=openai-codex ORCH_MODEL=gpt-6-sol` if needed. Never infer actual model from initial session metadata alone after fallback.
- **Status:** tracked in §5 of this file and updated by the orchestrator only.

## 2. Waves
| Wave | Tasks (parallel) | Starts when |
|---|---|---|
| W1 | T01 | specs committed |
| W2 | T02, T03, T07 | T01 merged |
| W3 | T04, T05, T09 | T02 merged (T05 and T09 also need T03's first cut of the schemas; T03 publishes the types early, see T03) |
| W4 | T08, T10, T11, T12 | T05 merged (T08); T09 merged (T10, T11); T04 merged (T12) |
| W5 | T06 | T08 merged |
| W5b | T13 | T06 merged + H5 design approval |
| W6 | T15, T14 | M3 exit; H4 real-roster import (T15); Q-2 answered (T14) |

## 3. Human checkpoints
| ID | When | What the user does | Unblocks |
|---|---|---|---|
| H1 | now | Review the spec pack, then tell the orchestrator to make the initial commit + push | everything |
| H2 | during W3–W4 | Create a free Cloudflare account; follow `docs/runbooks/cloudflare-setup.md` (from T12); add the GitHub secrets | real deploy |
| H3 | anytime before W6 | Screenshots: Veteran List screen (scroll top + middle); a Career Info tab where a grandparent portrait is tapped (if tapping opens anything) | T14, Q-1 |
| H4 | after T10 | On Windows: build/run the agent, record OCR for the 15 fixture screens (`--record-ocr`), check the T09 labels, then import ≥ 20 real veterans and spot-check 3 in the web app | M2 exit, T15 |
| H5 | Approved 2026-09-30 | User approved `docs/design/index.html`, including Planner and Model Health | T13 (still requires T04 and T06) |

## 4. Task cards
Each card lists: **Spec** sections · **Owns** (paths the task may create/modify) · **Needs** · **Done when** (in addition to AGENTS.md DoD).

### T01 — Monorepo and shared contracts
- Spec: 00 §3, 01 (all), AGENTS stack rules.
- Owns: root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.editorconfig`, `.gitignore`, `eslint.config.js`, `.prettierrc`, `packages/schema/**`, `agent/Uma.Agent.sln` (empty solution + `Directory.Build.props`), `README.md` (dev quickstart section only).
- Needs: nothing.
- Done when:
  - `packages/schema` exports zod schemas and TS types for every contract in 01. `pnpm --filter schema build` writes `json/*.schema.json`.
  - `src/fingerprint.ts` exists, with ≥ 5 hand-built vectors in `test/fingerprint.vectors.json`, including a guest parent, a ◯ skill and a sparks-order permutation that yields the same hash.
  - `pnpm -r lint && pnpm -r typecheck && pnpm -r test` passes.

### T01b — Contract hardening (from T01 review)
- Spec: 01 §1, §3, §4; `docs/reviews/T01-review-1.md` (S2–S8, N4, N5, N6, N8, N9, N10).
- Owns: `packages/schema/**`, `package.json` (engines only), `.editorconfig`, `eslint.config.js`, `README.md` (the Node version note).
- Needs: T01.
- Done when:
  - **S3:** a missing parent-spark block must be excused by a field with path exactly `/sparks/<owner>` (e.g. `/sparks/parent2`) and status `low_confidence`. Update 01-conformant tests.
  - **S4:** `CmTarget.id` and `ModelSnapshot.id` are ULIDs.
  - **S5:** `OwnedCardsSync.cards` has unique `cardId`s and uses `CardId`.
  - **S6:** `engines.node` is `>=22.18`, with a README note.
  - **S7:** validate the captures against the exported JSON Schema with pinned ajv (2020 draft).
  - **N5:** strict ULID regex `^[0-7][0-9A-HJKMNP-TV-Z]{25}$`.
  - **S2:** export `checkMasterIds(veteran, masterIndex)` → list of unknown IDs, and test it.
  - **S8:** add the exported `CAPTURE_RULES` descriptor listing the cross-field rules for T09 to mirror.
  - N6, N8, N9, N10 fixed.
  - The vectors file keeps the same hashes (canonical form unchanged). S1 stays as is: ◯ can't appear in IDs, so rename that vector `skill-collision-suffix` and correct its note.

### T02 — App skeletons
- Spec: 40 §1–2, 60 §1, 65 §2.
- Owns: `apps/api/**` (skeleton only: Hono app, `/api/v1/health`, `wrangler.jsonc` with bindings, empty migrations folder, vitest-pool-workers config), `apps/web/**` (skeleton: Vite React TS, router with placeholder routes from 60 §2, worker + Comlink wiring calling a stub, fixture-mode switch).
- Needs: T01.
- Done when: `pnpm --filter api test` hits health in miniflare; `pnpm --filter web build` passes; `wrangler dev` serves the SPA and `/api/v1/health` together (record curl output).

### T03 — Master data
- Spec: 20 (all), 01 §11–12.
- Owns: `packages/master-data/**`, `apps/web/public/master/**`, `docs/OPEN_QUESTIONS.md` (append only).
- Needs: T01. **First step:** commit the master-data TS types that re-export `@uma/schema` shapes, so T05 and T09 can start against them.
- Done when: 20 §5. The output JSON is committed; the cache is gitignored; `SOURCES.md` is complete.

### T04 — API core
- Spec: 01 §3–10, 40 (all), 65 §6.
- Owns: `apps/api/src/**`, `apps/api/migrations/**`, `apps/api/test/**`.
- Needs: T01, T02.
- Done when: 40 §5.

### T04b — API review consistency hardening
- Spec: 01 §3–9, 40 §4–5, `docs/reviews/T04-review-2.md` S1–S2 and nits; T04 review round 1 follow-ups.
- Owns: `apps/api/src/**`, `apps/api/test/**`, `apps/api/migrations/**` only if an additive migration is required; `docs/OPEN_QUESTIONS.md` (append only).
- Needs: T04.
- Done when:
  - Concurrent corrections of one veteran cannot silently lose updates: atomically guard the loaded revision, return 409 on a stale correction, and do not mark its review resolved.
  - Resolve versus deletion never resurrects a veteran or leaves orphaned children; concurrent PATCH/ingest versus resolve preserve override and field consistency. Deterministic race tests demonstrate this.
  - `ok` provenance `/trainMode` is accepted by ingest; correctability restrictions apply to low-confidence review fields only. Unsafe pointers remain rejected for corrections. Document the remaining API/schema validation gap for T09; do not edit shared contracts.
  - Spark owner replacements cannot leave existing open index-based review paths targeting different sparks; test length changes and stale review handling.
  - Fix review r2 N1–N3 misleading comments/assertions; record all remaining review follow-ups explicitly.
  - Full TS lint/typecheck/tests pass; ingest remains <=15 statements and every invocation remains within the D1 statement budget. No deployment or production config edits.

### T05 — Engine: inheritance and scenarios
- Spec: 50 §1–3, §9 (T05), 01 §11–12.
- Owns: `packages/engine/**` (except `src/model/**`, `src/predict/**` and `src/rank/**`, which are reserved for T06), `packages/engine/test/inheritance/**`.
- Needs: T01, T03 (types; it can use a local toy master fixture for tests).
- Done when: 50 §9 T05.

### T06 — Engine: training model, prediction, scoring, ranking
- Spec: 50 §4–7, §9 (T06), 01 §10, §13.
- Owns: `packages/engine/src/{model,predict,rank,linalg.ts}/**`, `packages/engine/test/{model,predict,rank}/**`, `packages/engine/bench/**`.
- Needs: T05, T08.
- Done when: 50 §9 T06 on the golden dataset; the bench result is in the changelog.

### T07 — Design
- Spec: 10 (all).
- Owns: `docs/design/**`.
- Needs: T01 (for contract field names).
- Done when: 10 §5; the H5 request is written in the changelog.

### T08 — Golden dataset
- Spec: 70 §2, 50 §9.
- Owns: `packages/engine/test/golden/**`, `packages/engine/scripts/golden.ts`, `apps/web/fixtures/**`.
- Needs: T03, T05.
- Done when: the generation is deterministic (running it twice gives a byte-identical sha256, recorded); the roster validates against the schema; the truth file documents every planted parameter.

### T09 — Agent core
- Spec: 30 §1–6, §10 (T09), App. A; 01 §3, §5, §6.
- Owns: `agent/src/Uma.Agent.Core/**`, `agent/tests/**`, `agent/layouts/**`.
- Needs: T01 (fingerprint vectors, JSON Schemas), T03 (`vocab.json`, `iconHashes`, `artHashes`). If T03 isn't done, use a vocab stub built from the fixture OCR files and mark the card/portrait identification tests `Skip` with a reason.
- Done when: 30 §10 T09; label files for all 15 fixtures are written from the screenshots, and the changelog asks the user to verify them (H4).

### T10 — Agent Windows shell
- Spec: 30 §2, §6, §7, §10 (T10).
- Owns: `agent/src/Uma.Agent.Windows/**`, `docs/runbooks/agent-install.md`.
- Needs: T09.
- Done when: it compiles with `EnableWindowsTargeting` on macOS; the runbook is complete. Status is `Partial` until H4.

### T11 — Agent support card sync
- Spec: 30 §8, §10 (T11); 01 §4.
- Owns: `agent/src/Uma.Agent.Core/Cards/**`, `agent/tests/**/Cards*`.
- Needs: T09.
- Done when: 30 §10 T11.

### T12 — DevOps
- Spec: 65 (all).
- Owns: `.github/**`, `apps/api/wrangler.jsonc` (production env section), `docs/runbooks/cloudflare-setup.md`, `docs/runbooks/backup.md`.
- Needs: T02, T04.
- Done when: 65 §7.

### T13 — Web screens
- Spec: 60 (all), 10 (the approved design), `docs/design/bindings.md`.
- Owns: `apps/web/src/**`, `apps/web/e2e/**`, `docs/changelog/assets/T13/**`.
- Needs: T02, T04 (API types), T06, H5.
- Done when: 60 §4.

### T14 — Auto-navigation and deck suggestion (M5)
- Spec: 30 §9, F13, F14.
- Needs: H3/Q-2, T10, T06. Write a detailed spec addendum at `docs/specs/31-auto-navigation.md` first, and wait for orchestrator approval.

### T15 — Rules calibration (M4)
- Spec: 50 §8, §9 (T15).
- Owns: `packages/engine/src/calibrate/**`, `packages/engine/test/calibrate/**`.
- Needs: T06, T08; the real-roster run needs H4.
- Done when: the golden check passes; a real-roster report is attached once H4 is done.

## 5. Status
| Task | Status | Branch | Changelog | Review |
|---|---|---|---|---|
| T01 | Merged | task/T01-monorepo-contracts | T01-monorepo-contracts.md | PASS r1 (8 should-fix → T01b) |
| T01b | Merged | task/T01b-contract-hardening | T01b-contract-hardening.md | CHANGES_REQUESTED r1 → PASS r2 |
| T02 | Merged | task/T02-app-skeletons | T02-app-skeletons.md | PASS r1 |
| T03 | Merged locally | task/T03-master-data | T03-master-data.md | PASS r2 |
| T04 | Merged locally | task/T04-api-core | T04-api-core.md | PASS r2; follow-ups in T04b |
| T04b | Resumed review fixes (Sol medium fallback after Opus 429) | task/T04b-api-consistency | T04b-api-consistency.md | CHANGES_REQUESTED r1 |
| T05 | Review passed; awaiting local integration | task/T05-inheritance | T05-inheritance.md | PASS r2; plugin validation and per-pair RulesError follow-ups |
| T06 | Not started | | | |
| T07 | Merged; H5 approved | task/T07-design | T07-design.md | CHANGES_REQUESTED r1 → PASS r2 |
| T08 | Not started | | | |
| T09 | Resumed; partial work preserved (Sol medium fallback after Opus 429) | task/T09-agent-core | T09-agent-core.md | Pending |
| T10 | Not started | | | |
| T11 | Not started | | | |
| T12 | Resumed review fixes (Sol medium fallback after Opus 429); deployment waits for H2 | task/T12-devops | T12-devops.md | CHANGES_REQUESTED r1 |
| T13 | Not started | | | |
| T14 | Not started | | | |
| T15 | Not started | | | |
