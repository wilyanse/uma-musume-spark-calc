# AGENTS.md — rules for every implementing agent

You are implementing one task (`Txx`) from `docs/specs/80-orchestration-plan.md`. Read, in order:
1. This file.
2. `docs/specs/00-overview.md` (features, modules, repo layout).
3. `docs/specs/01-data-contracts.md` (**authoritative**: wins over any other spec).
4. The spec sections listed for your task in `docs/specs/80-orchestration-plan.md`.
5. `docs/OPEN_QUESTIONS.md` (don't re-ask what's already answered there).

## Scope
- Do **only** your task. Don't refactor or "improve" files owned by other tasks. If you must touch one to unblock yourself, keep the change minimal and list it under *Cross-task edits* in your changelog.
- Don't change `docs/specs/01-data-contracts.md` or `packages/schema` unless your task owns them. If a contract is wrong or missing, write it in `docs/OPEN_QUESTIONS.md` (format below), take the smallest reasonable assumption, flag it in your changelog, and carry on.
- **Never guess game facts.** If a mechanic, rate or value isn't in the specs or in a cited source, put it in a data file with `"verified": false` and a `source` note, and add it to `OPEN_QUESTIONS.md`.

## Git
- Work only in the worktree and branch you were given (`task/Txx-<slug>`). Never commit to `main`, never push, never rewrite history. The orchestrator reviews, merges and pushes.
- Make small commits with messages like `Txx: <imperative summary>`.
- Never commit secrets, `.env*`, `.dev.vars`, tokens, game screenshots outside `docs/reference/screenshots/`, or downloaded game art (store hashes only; see 20-master-data §4).

## Changelog (required)
Every task writes **one** file: `docs/changelog/Txx-<slug>.md`, using `docs/changelog/_TEMPLATE.md`. It must contain:
- **Summary**: 2–5 lines on what now exists.
- **Files**: created and modified paths.
- **Decisions**: every choice the specs left open, with the reason.
- **Deviations**: anything done differently from the spec, and why.
- **Verification**: the exact commands you ran and their **real** output (trimmed). Never write "tests pass" without the command output.
- **Open questions / follow-ups**: IDs added to `OPEN_QUESTIONS.md`, and known gaps.

Don't edit the root `CHANGELOG.md`; the orchestrator adds one line per merged task.

## Definition of done
1. Every acceptance item for your task in its spec, and in `70-testing-acceptance.md`, is met and demonstrated in the changelog *Verification* section.
2. `pnpm -r lint && pnpm -r typecheck && pnpm -r test` passes for the TS packages you touched. `dotnet build` / `dotnet test` passes for the .NET projects you touched.
3. No `TODO` without a matching entry in your changelog's follow-ups.
4. The changelog file is written and committed on your branch.

## Stack rules
- Node ≥ 22 and **pnpm workspaces**. Pin exact dependency versions (no `^`). TypeScript `strict: true`, ESM only.
- Tests: Vitest for TS, xUnit for .NET. Tests are deterministic: seed every RNG and inject time.
- .NET: `net8.0` for cross-platform projects, `net8.0-windows10.0.19041.0` for Windows-only projects. On macOS/Linux, build Windows projects with `-p:EnableWindowsTargeting=true`; they can't run there.
- No new runtime service, paid tier or cloud product beyond `docs/specs/65-devops.md`. The free-tier limits in that spec are hard constraints.

## Open question format (`docs/OPEN_QUESTIONS.md`)
```
## Q-<next number> (<Txx>) <short title>
Context: …
Assumption taken: …
Blocking: yes|no
```

## Review
An independent reviewer checks your branch against `docs/specs/85-implementation-review.md` §3. If you receive a review file, fix every **Blocking** item, answer each one in your changelog under a new `## Review round N` section, and re-run verification.

## When you're blocked
If you can't continue (missing account, secret, screenshot, or a Windows-only check), stop. Write the changelog with status `Blocked` and the exact human action needed, then finish.
