# T10 — Windows shell

- **Status:** Partial — Windows native execution/H4 pending; independent parent-dispatched review pending.
- **Branch:** task/T10-windows-shell
- **Agent / model:** Opus 5.5 medium primary interrupted by HTTP 429 (parent/user report). Existing untracked Windows source and tests inspected and preserved. Explicitly user-approved GPT-6.1 Sol / openai-codex medium continuation; no autonomous fallback switch.
- **Base:** 08d4876 (prompt-only orchestration commit atop dd16e68); no merge/rebase/reset of main or siblings.

## Summary
Real WPF tray shell, HWND Windows Graphics Capture cropped to the physical client area, English Windows.Media.Ocr and DPAPI CurrentUser adapter now compile. Portable shell logic drives reviewed Core sessions/outbox/uploader without changing Core. Support-card capture truthfully remains unavailable until T11 integration. No native execution or actual Windows OCR result is claimed on macOS.

## Files
Created:
- `agent/src/Uma.Agent.Windows/**` — pinned Windows project, bundled read-only data/settings, WPF tray/dialogs, native WGC/OCR/DPAPI, portable pipeline/settings/recording/upload/status logic.
- `agent/tests/Uma.Agent.Windows.Tests/Portable/**` — net8.0 linked-source portable tests against actual Core and read-only recordings/screenshots.
- `agent/tests/Uma.Agent.Windows.Tests/Native/**` — Windows-only DPAPI/OCR/cancellation tests (compile here, execute H4).
- This task changelog.

## Decisions
- Finalize complete sessions on identity change or Stop/Exit, not immediately when checklist becomes complete: allow parent popups to resolve fields first. Only sealed `Uploadable` goes to `EnqueueCapture`; diagnostic/incomplete collections never queue. Enqueue failures retain a sealed result for exact-content retry.
- Time and RNG injected in tests; production IDs use CSPRNG ULIDs. No game facts invented. Core receives the original parser evidence.
- Empty shipped API address (no guessed deployment); HTTPS-only address, no embedded credentials/query/fragment. DPAPI blob separate from address/process/title settings, masked fields, no token values logged.
- Use `UploadClient.CreateHandler()` explicitly; strict native JSON acknowledgement/auth/backoff behavior stays in reviewed Core. Serialize upload/token rotation/dead-item recovery. Confirm Requeue and whole-capture Discard.
- Whole-frame dHash at 4fps maximum, with a 2-second forced reread to catch collisions. Real fixtures 02 and 03 have the same whole-frame dHash: users must dwell >=2 seconds with overlapping scroll views.
- Windows OCR has no confidence score; constant 1 is explicitly not a measured confidence. Core vocab/margin/template/validation gates still apply. Every parser ROI is x2; full-frame recording uses overlapping x2 tiles to obey Windows OCR's image dimension limit.
- WGC free-threaded framepool polled; no callback disposes frame/device. Next/Dispose serialized, Closed callback only sets flag. Drop stale resize frames; check client geometry before/after read; reset device on native failure. System capture border retained.
- WPF owns app startup; `WFAC010` (WinForms startup-DPI analyzer) suppressed narrowly because tray-only WinForms uses the per-monitor-V2 app manifest. `IL3000` suppressed only for extraction-root lookup: IncludeAllContentForSelfExtract extracts assembly/data together; native single-file launch still H4.

## Deviations from spec
- No live endpoint default; appsettings.json address deliberately empty (user direction).
- Full-frame OCR x2 tiled for native MaxImageDimension, rather than silently reducing magnification. Parser ROIs remain x2 reference boxes.
- Tray has additional Checklist and rejected-upload recovery entries; support-card action is an explicit truthful unavailable boundary, not fake sync.
- Status Partial until actual H4. Tests do not claim Windows OCR/capture/DPAPI execution on Mac.

## Cross-task edits
None in this milestone. Core, Cards, master, layouts, fixture recordings/labels, TS, main and siblings untouched. Narrow solution registration and runbook follow in the next milestone.

## Verification
Inherited baseline output (before continuation): Core native .NET 8.0.31: 166 passed, 0 failed. Inherited tests-first build failed with 25 missing-shell-type errors (`~/.hermes/cache/scratch/t10/red-build.txt`); partial tests preceded implementation.

Continuation first executable portable run: 94 passed, 4 failed. The failing assertions exposed (1) xUnit culture comparison treats NUL as ignorable, (2) real dHash collision between fixture 02/03, (3) collision test needed injected dwell time, (4) unresolved parents correctly produce 3 review crops, not a single row. Tests corrected to assert actual behavior, not relax Core completeness.

Additional hardening tests were added BEFORE fixes:
```
$ dotnet test agent/tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj --filter FullyQualifiedName~HardeningTests -- RunConfiguration.DotNetHostPath=/private/var/folders/k3/6ph2csn113x6w4jq66qjms1r0000gn/T/dotnet8/dotnet
Failed: 4, Passed: 1, Total: 5
Token_values_are_not_silently_normalized: expected (" id "," secret "), actual ("id","secret")
Token_controls_are_rejected_before_any_trimming: both trailing-control cases did not throw
Data_bundle_public_template_map_is_read_only: Clear did not throw
```
Fixed by preserving exact token values/rejecting controls before normalization, and a read-only shell-owned template map wrapper. No Core edits.

```
$ dotnet test agent/tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj -- RunConfiguration.DotNetHostPath=/private/var/folders/k3/6ph2csn113x6w4jq66qjms1r0000gn/T/dotnet8/dotnet
Passed! Failed: 0, Passed: 103, Skipped: 0, Total: 103
$ dotnet build agent/tests/Uma.Agent.Windows.Tests/Native/Uma.Agent.Windows.Tests.csproj -p:EnableWindowsTargeting=true
Uma.Agent.Windows -> .../bin/Debug/net8.0-windows10.0.19041.0/Uma.Agent.Windows.dll
Uma.Agent.Windows.Tests -> .../Native/bin/Debug/net8.0-windows10.0.19041.0/Uma.Agent.Windows.Tests.dll
Build succeeded. 0 Warning(s), 0 Error(s).
$ dotnet publish agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableWindowsTargeting=true -o /Users/willjose/.hermes/cache/scratch/t10/publish
Uma.Agent.Core -> .../bin/Release/net8.0/Uma.Agent.Core.dll
Uma.Agent.Windows -> .../bin/Release/net8.0-windows10.0.19041.0/win-x64/Uma.Agent.Windows.dll
Uma.Agent.Windows -> /Users/willjose/.hermes/cache/scratch/t10/publish/
(exit 0)
```
Real binary bundle probe (Python struct parsing of .NET v6 bundle manifest, comparing each data payload SHA256 with repository bytes):
```
PE signature: b'MZ' bundle version: 6 0 entries: 474
Bundled layout/template/master/settings match repository bytes: 15
EXE bytes: 193050936 SHA256: 845980dc8815c4dea0230587521567e473d6b8bef8f6ea4cb9b22b40c626a501
Publish files: Uma.Agent.Windows.exe (193050936), Uma.Agent.Windows.pdb (36268), Uma.Agent.Core.pdb (85912)
```
Probe manifest: `/Users/willjose/.hermes/cache/scratch/t10/artifact-manifest.json`. This verifies real cross-target build artifacts, NOT Windows execution.

## Open questions / follow-ups
- T11 shell integration after its parent review/merge: replace `ISupportCardsIntegration` unavailable implementation with a real reviewed adapter and expose actual held/count/progress/partial confirmation. Do not duplicate Cards here.
- H4 native WGC resize/device/window/title/clientarea behavior, real English OCR, DPAPI, single-file content extraction, native test execution and actual Access/upload behavior remain pending.
- Final runbook, solution registration, final Core regression verification and scope checks follow in milestone 2.
- No reviewed merge, push, deployment, credentials or global settings changed.

## Milestone 2 — runbook, solution and final verification

- Added `docs/runbooks/agent-install.md`: publish/install/first-run settings, all tray states, explicit finalization, auth and confirmed dead-item recovery, safe operator-directed legacy recovery, actual Windows recorder procedure, and exact H4 capture-3 then >=20/spot-check-3/labels/six-card-ID checks.
- `agent/Uma.Agent.sln`: registered Windows shell, portable tests and native tests. Retained original CRLF; existing Core project registrations/configurations are unchanged. This is the narrowly allowed solution edit. On Mac test projects individually (solution-wide test now also targets native Windows).
- `docs/OPEN_QUESTIONS.md`: appended Q-100 (unavailable native OCR confidence) and Q-101 (observed whole-frame dHash collision), both nonblocking; original file bytes verified as unchanged prefix. Parent's current explicit Q-100..109 reservation controls despite older T12 reservation text.
- Small shell-only cleanup: reset displayed progress on a fresh watch, dispose WinRT activation factory, avoid normalizing larger frames twice. No changes to Core or T11.
- No ordinary implementation gap is classified as human-blocked. All source/runbook is implemented; platform-native execution is explicitly H4. Independent parent-dispatched review has NOT yet occurred; worker does not merge.

Final real commands (repository root):
```
$ dotnet build agent/Uma.Agent.sln -c Release -p:EnableWindowsTargeting=true
Uma.Agent.Core -> .../bin/Release/net8.0/Uma.Agent.Core.dll
Uma.Agent.Core.Tests -> .../bin/Release/net8.0/Uma.Agent.Core.Tests.dll
Uma.Agent.Windows -> .../bin/Release/net8.0-windows10.0.19041.0/Uma.Agent.Windows.dll
Uma.Agent.Windows.Portable.Tests -> .../Portable/bin/Release/net8.0/Uma.Agent.Windows.Portable.Tests.dll
Uma.Agent.Windows.Tests -> .../Native/bin/Release/net8.0-windows10.0.19041.0/Uma.Agent.Windows.Tests.dll
Build succeeded. 0 Warning(s), 0 Error(s).
$ dotnet test agent/tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj -c Release --no-build -- RunConfiguration.DotNetHostPath=/private/var/folders/k3/6ph2csn113x6w4jq66qjms1r0000gn/T/dotnet8/dotnet
Passed! Failed: 0, Passed: 166, Skipped: 0, Total: 166, Duration: 5 s
$ dotnet test agent/tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release --no-build -- RunConfiguration.DotNetHostPath=/private/var/folders/k3/6ph2csn113x6w4jq66qjms1r0000gn/T/dotnet8/dotnet
Passed! Failed: 0, Passed: 103, Skipped: 0, Total: 103, Duration: 3 s
$ dotnet publish agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableWindowsTargeting=true -o /Users/willjose/.hermes/cache/scratch/t10/publish-final
Uma.Agent.Windows -> .../bin/Release/net8.0-windows10.0.19041.0/win-x64/Uma.Agent.Windows.dll
Uma.Agent.Windows -> /Users/willjose/.hermes/cache/scratch/t10/publish-final/
(exit 0)
$ python3 /Users/willjose/.hermes/cache/scratch/t10/verify_bundle.py /Users/willjose/.hermes/cache/scratch/t10/publish-final/Uma.Agent.Windows.exe "$PWD"
PE: AMD64; bundle version: 6 0 entries: 474
Bundled layout/template/master/settings byte matches: 15
EXE bytes: 193050936 SHA256: 7b3c572e83c75744617f93f23efd211ce699100f3167246e084f721f8ada5f89
Publish files: Uma.Agent.Windows.exe (193050936), Uma.Agent.Windows.pdb (36300), Uma.Agent.Core.pdb (85912)
$ dotnet list agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj package
Serilog Requested 4.3.0 Resolved 4.3.0
Serilog.Sinks.File Requested 6.0.0 Resolved 6.0.0
System.Security.Cryptography.ProtectedData Requested 8.0.0 Resolved 8.0.0
```
Windows SDK C#/WinRT reference is explicitly pinned `WindowsSdkPackageVersion=10.0.19041.57`. Core dependencies unchanged. No TS touched, so no TS build/master refresh/golden generation was run.

Read back real Core accuracy report at `agent/tests/Uma.Agent.Core.Tests/bin/Release/net8.0/accuracy-report.txt`:
```
overall: 747/747 = 100.00%
wrong but confident (silent errors): 0; correct but flagged low_confidence: 3
stats 40/40; stars 120/120; lb 26/26
```
These are unchanged Apple Vision fixture replay results, not actual Windows OCR/game evidence.

Scope checks:
```
$ git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check
(no output, exit 0; an extra blank line from solution newline preservation was caught and removed first)
$ python3 /Users/willjose/.hermes/cache/scratch/t10/verify_protected.py "$PWD"
Protected Core/tests/fixtures/layouts/master/golden files match base bytes: 93
OPEN_QUESTIONS original bytes preserved; append-only verified
```
Both native and portable test projects compile; the 3 native test cases are **not executed** on Mac. H4 remains full native API/UX/capture/extraction tests plus all recordings, label/deck identity confirmation, actual Access/upload recovery and real roster checks described in the runbook. Parent gate A and independent review must precede any merge. Final status **Partial**, not Done.
