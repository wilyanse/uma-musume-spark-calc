# Windows handoff preparation

## Summary
Prepared a bounded Claude/operator handoff for native Windows validation of the already reviewed T19 application, staged independently from hosted/live acceptance. Corrected stale README instructions that claimed nothing was built, permitted arbitrary SDK9/10, and recommended recursive builds. No application code, contracts, fixtures, master data, dependencies or credentials changed.

## Files
- `docs/runbooks/windows-handoff.md`: operator checklist, current-source transfer, native build/test/package commands, fresh real-OCR evidence, human/game/live checkpoints and privacy.
- `docs/tasks/H4-windows-validation.prompt.md`: Claude validation role, boundaries and report requirements.
- `docs/reference/windows/H4-REPORT-TEMPLATE.md`: structured PASS/FAIL/BLOCKED/NOT RUN evidence report.
- `README.md`: discoverable handoff links and corrected current SDK/build/status guidance.

## Decisions and limits
- Local main was206 commits ahead of origin at initial preparation. A normal GitHub clone is not presumed current; prepare a standalone Git bundle for private transfer without an unauthorized push. Bundle contains repository source/history, not .gitignored local credentials or build output; this is not a claim of a full historical secret audit. No EXE distribution/legal approval is implied.
- Claude runs offline checks first and asks the human for game operation, installation/consent, account/billing/legal decisions and real sends. Missing H2 does not block native fixture validation.
- Actual Windows OCR goes to a fresh external folder. Only a separate same-SHA validation checkout may substitute the new OCR recordings for an uncommitted accuracy run; labels/screenshots/templates/master/thresholds stay unchanged.
- All agent dotnet commands use agent/global.json via agent/ cwd. PowerShell checks native exit codes explicitly. No production bypass, pnpm recursive build, fixture regeneration or automatic game input.
- New native execution/GUI/Windows OCR tests cannot run on this Mac. H4/M2 cannot be signed off by this preparation.

## Verification

Actual command:
```
/Users/willjose/.hermes/cache/scratch/T19-r3/pwsh/pwsh -NoProfile -File /Users/willjose/.hermes/cache/scratch/windows-handoff-check/parse.ps1 -Handoff docs/runbooks/windows-handoff.md
```
Actual output: `PowerShell syntax: 5 blocks parsed, no errors. Commands NOT executed; no Windows acceptance implied.` Exit0.

`git diff --check`: exit0, no diagnostics. Programmatic handoff-file/reference checks: `Handoff files present; referenced existing file checks: 7 paths; missing: []`, exit0. These are syntax/reference checks, not target-Windows execution or H4 acceptance. Application tests were not rerun for these documentation-only changes; prior actual merged verification remains in `docs/reviews/T19-merged-verification.md`.

## Follow-ups
User receives the standalone bundle (or separately authorizes publication), clones on Windows, gives Claude the prompt path, completes offline/native/game observations and returns sanitized report/TRX/OCR/screenshots. Coordinator reviews real evidence, scopes native bug fixes if required and advances real-roster calibration only when inputs exist. H2/cloud, H3/navigation screenshots and Microsoft human distribution obligations remain separate.
