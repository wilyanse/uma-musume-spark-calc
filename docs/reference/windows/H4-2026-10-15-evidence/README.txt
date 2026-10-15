H4 Windows validation evidence, 2026-10-15 (sanitized text copy)
Report: ../H4-2026-10-15-report.md

Contents: test results (TRX), build/test/publish logs, strict Python suite and recipient ZIP logs,
real Windows OCR recordings (windows-ocr/ocr 15 + ocr-roi 2), new-OCR accuracy report,
tray status/geometry timeline, agent log, artifact and screenshot hash lists.

Sanitization: user-profile paths replaced with %USERPROFILE%; guest trainer name replaced with
[REDACTED-TRAINER]. windows-ocr/ocr/10-sparks-popup-guest-parent.json is therefore a REDACTED copy:
do not use it for accuracy runs; the unredacted original stays on the validation machine.

Not included: screenshots (kept off git; sharing copies exist locally), EXE/ZIP binaries (hashes in
run2-lf-worktree/sha256.txt), settings, service token, outbox DB.
These OCR files are evidence only. They are NOT fixture replacements for agent/tests/fixtures/.
Running `pnpm format` (prettier --write .) would reformat the .json files here; avoid it, or add
this folder to .prettierignore.
