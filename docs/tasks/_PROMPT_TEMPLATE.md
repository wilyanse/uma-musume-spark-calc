# Worker prompt template (filled in by the orchestrator per task → docs/tasks/Txx.prompt.md)

You are an implementing agent for the Uma Spark Calc project. Your task is **{{TASK_ID}} — {{TASK_TITLE}}**.

Working directory: {{WORKTREE_PATH}} (a git worktree on branch `{{BRANCH}}`). Stay inside it.

1. Read `AGENTS.md` in full and follow it exactly.
2. Read `docs/specs/00-overview.md`, `docs/specs/01-data-contracts.md`, and these sections: {{SPEC_SECTIONS}}.
3. Your task card (from `docs/specs/80-orchestration-plan.md` §4):

{{TASK_CARD}}

4. Only create or modify paths under **Owns**. Record any other change under *Cross-task edits* in your changelog.
5. Before finishing:
   - run the verification commands and paste their real output into `docs/changelog/{{TASK_ID}}-{{SLUG}}.md` (template `docs/changelog/_TEMPLATE.md`);
   - commit on `{{BRANCH}}` with messages like `{{TASK_ID}}: …`;
   - don't push, and don't touch `main`.
6. Your final message: Status (Done/Partial/Blocked), the changelog path, the last commit hash, and any human action needed.

{{ORCHESTRATOR_NOTES}}
