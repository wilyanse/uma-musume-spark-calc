# 85 — Implementation review

Every task gets an **independent code review** before merge, separate from the orchestrator's verification gate (80 §1).

## 1. Roles
| Role | Model | Access | Output |
|---|---|---|---|
| Worker | Opus 5.5 medium first; GPT-6 Sol medium fallback | its task worktree, read/write | code + `docs/changelog/Txx-*.md` |
| **Reviewer** | Opus 5.5 medium first; GPT-6 Sol medium fallback, fresh session with no worker context | the task worktree, **read-only** (may run tests/builds, must not edit tracked files or commit) | `docs/reviews/Txx-review-<round>.md`, written by the orchestrator from the reviewer's final message |
| Orchestrator | Hermes | everything | re-runs verification, merges, pushes after user review |

## 2. Per-task flow
1. The worker finishes (status Done or Partial) and commits on `task/Txx-*`.
2. **Orchestrator gate A:** changelog present; `git diff main...task/Txx` only touches **Owns** paths (or declared cross-task edits); re-run the task's verification commands. If A fails, the task goes back to the worker *before* review.
3. **Reviewer** runs on the diff `main...task/Txx` with: AGENTS.md, 00, 01, 85, the task card, the spec sections from the card, and the worker's changelog.
4. The verdict is `PASS` or `CHANGES_REQUESTED`.
   - `PASS`: merge (`--no-ff`); should-fix items go to the changelog follow-ups.
   - `CHANGES_REQUESTED`: blocking findings go back to the worker (a new session in the same worktree, given the review file). Then round 2 is a focused re-review of the fix diff only.
   - After 2 rounds, the orchestrator fixes it itself or escalates to the user.

## 3. Review checklist (the reviewer must address each)
1. **Spec conformance**: every "Done when" item and each relevant 01 contract field, name, enum and status code.
2. **Correctness**: logic bugs, edge cases (empty roster, guest parents, ◯ variants, LB 0, stat cap), off-by-one errors, numeric stability.
3. **Test quality**: do the tests assert real behaviour? No tautologies, no skipped tests without a reason, no snapshots that just freeze wrong output, deterministic seeds. Does the changelog's verification output match what running the commands produces?
4. **Fabrication check**: no invented game constants (they must be in `rules.json` with `verified:false` + source); no fake output in the changelog; no hard-coded fixture answers inside production code.
5. **Security**: auth on every non-health route, no secrets in the repo, no `AUTH_DISABLED` path in production, input validation, SQL parameterisation.
6. **Free-tier constraints**: D1 statements per request, Worker CPU, no paid features (65 §1).
7. **Scope**: nothing outside Owns without a declared cross-task edit; no unrelated refactors.
8. **Maintainability**: clear structure, no dead code, types strict, pinned dependencies.

## 4. Findings format
```
## Verdict: PASS | CHANGES_REQUESTED
## Blocking
- [B1] path:line — problem — required fix
## Should fix
- [S1] path:line — problem — suggestion
## Nits
- [N1] …
## Checklist
1 Spec conformance: ok | issues (refs)
… (1–8)
## Commands run
$ cmd
<trimmed real output>
```
`CHANGES_REQUESTED` requires at least one blocking finding. Blocking = violates spec/contract, incorrect behaviour, security issue, broken or fake tests, or scope violation.

## 5. Milestone integration review
At each milestone exit the reviewer (same model) reviews merged `main` for cross-module consistency:
- fingerprint parity between TS and C#;
- the web uses the API types generated from `@uma/schema`;
- master-data IDs match between agent vocab, API validation and engine;
- the full test suite is green.

The result goes in `docs/changelog/M<n>-evidence.md`.

## 6. User visibility
At the end of each wave the orchestrator reports: tasks merged, review verdicts and rounds, open should-fix items, new open questions, and any human action needed. Pushing to `origin main` happens after that report.
