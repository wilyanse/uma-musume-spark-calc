# T10 — Windows shell

- **Status:** Partial — Windows native execution/H4 pending. Final bounded review round 2 fixes implemented and verified below; independent parent focused re-review pending.
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

## Review round 1 response (fix-1)

Review: coordinator `docs/reviews/T10-review-1.md` of 204de2d (CHANGES_REQUESTED). Fix prompt: coordinator `docs/tasks/T10.fix-1.prompt.md`. Implemented directly by the T10 worker (Opus 5.5 medium) in the existing worktree on top of 204de2d. No reset/clean/rebase/merge, no Core/fixture/layout/master/TS/sibling/main edits, no push/deploy/credentials/global configuration. Tests were written first and run red before each fix (outputs below).

### Evidence corrections (N8, N9)
- **N8.** The earlier milestone evidence files under `~/.hermes/cache/scratch/t10/` (`red-build.txt`, `verify_bundle.py`, `artifact-manifest.json`, publish folders) **expired** with scratch pruning. The text above is left unchanged as the historical record; those paths cannot be reopened. The EXE SHA-256 values quoted above (`845980dc…`, `7b3c572e…`) are **superseded** and are not reproducible identifiers: the reviewer's re-publish of the same commit matched size but not hash (`b9baa2f3…`). The verification scripts are now kept in the repository (`agent/tests/Uma.Agent.Windows.Tests/Tools/`).
- **N9.** The `/private/var/folders/.../T/dotnet8/dotnet` host named above is **superseded**: the reviewer found it incomplete ("No frameworks were found"). This round uses the reviewer-installed runtime, checked before use: `~/.hermes/cache/scratch/T10-review/dotnet8/dotnet --list-runtimes` → `Microsoft.NETCore.App 8.0.31`. Nothing was installed globally.

### Blocking
- **B1 memory bound.** Done in shell code; no Core change and no Q-102 needed.
  - `FrameGate`: after the 2 s refresh, a frame whose dHash is unchanged is re-read only if its SHA-256 content differs from the last processed frame. Byte-identical idle polls (WGC delivers a fresh array each time) are parsed once. The real 02/03 dHash collision is still re-read (the bytes differ; existing test kept).
  - `CapturePipeline` now gives each veteran its own Core `CaptureCoordinator`. Frames are routed with Core's own `Feed` rules (confident outfit/character/rating/stats, continuity incl. popups, ambiguity refused, new veteran needs outfit+character+rating), and already queued veterans still count as candidates exactly as before.
  - A veteran sealed on identity change or Stop is dropped together with its frames. Only its sealed `CaptureResult` is kept until `EnqueueCapture` succeeds, so a failed enqueue retries the exact capture with the same ID. Its identity is remembered: returning to it (header or parent popup) reports `AlreadyQueued` and stores nothing.
  - A parsed frame whose evidence fingerprint (SHA-256 over every parsed field except pixels) equals one already fed to that veteran is not fed again, so moving clocks/animations re-parse but do not accumulate.
  - Fixed bounds: at most `MaxLiveSessions = 2` unqueued veterans (the least recently visited incomplete one is released and reported; it was never uploadable) and `MaxFramesPerSession = 40` distinct views per veteran (beyond that a `Limit` event shows as a tray error; never uploaded). Incomplete veterans are no longer lost on identity change: they stay collectable when the user returns.
  - Upload gates and OCR confidence are unchanged: only Core-sealed `Uploadable` results are enqueued.
  - Runbook: "Stop/Start periodically" removed; documented bounds with measured numbers.

### Should fix
- **S1.** `WgcFrameSource` drains the free-threaded pool each poll and uses the newest frame, disposing older ones (`FrameDrain.TakeNewest`, at most 8 per poll so a busy producer cannot hold the poll; a throwing drain disposes what it took). Geometry checks run on that newest frame.
- **S2.** Full-frame tiling moved into portable `OcrTiling`: overlap 600 reference px (longest fixture line 493). A line is kept only from a tile that contains its whole box clear of the seam; a seam-cut line no tile holds whole gets its band re-read once at ×2. `WindowsOcrEngine` uses it; every request stays within `MaxImageDimension/2`. Tested on the real line geometry of all 15 committed full-frame recordings with a clipping stand-in that does no OCR; the old algorithm on the same harness split "Account Link" and "To Title Screen" on fixture 13 (red below).
- **S3.** `SettingsStore` catches `JsonException` for the user file only, moves it to `settings.json.bad-<UTC yyyyMMddTHHmmssZ>` (suffix `-1`, `-2`… never overwrites; injected clock), loads shipped defaults (empty address, uploads paused) and exposes `Notice`. App logs the category, shows the notice in a dialog and in the status window. The settings file holds no secrets, so the backup holds none. A malformed bundled `appsettings.json` remains a startup packaging error.
- **S4.** `DropGuard` holds one rule set for Start and Exit: an unsaved complete capture refuses Start and makes Exit ask; an incomplete collection makes both ask. Start also releases the old pipeline before the new watch. Runbook updated.
- **S5.** Refused captures log one numbers-only line per change: `Capture geometry <reason>: texture WxH; [bitmap WxH;] dwm frame WxH at X,Y; client WxH at X,Y` (no titles, process names or tokens). A repeated bitmap-size mismatch now fails closed at the 2 s deadline instead of looping. Runbook §6.1 has an explicit H4 geometry check; failing closed is unchanged.

### Nits
- **N1.** `WindowInfo.ProcessId`; `WindowSelector.Select(..., ownProcessId)` drops the agent's own windows before process or title matching; WGC passes `Environment.ProcessId`.
- **N2.** `ApiAddress.Changes` compares normalised addresses; App uses it for the destination-change prompt.
- **N3.** `UserMessages.For` shows typed messages for known local exceptions (unsupported/non-reference frame, capture unavailable, missing token, argument/validation, incomplete capture) and only a category otherwise. Used by the UI dispatcher (covers RecordLive) and the unhandled UI handler. The Settings dialog refuses control characters in token fields before saving.
- **N4.** Unused `IClock` removed from `UploadService`; callers and tests updated.
- **N5.** The old WGC test is renamed to say what it proves (pre-cancelled call, idempotent dispose). Added native tests: no matching window fails closed with `CaptureUnavailableException`, and a tiled full-frame Windows OCR read of a blank frame invents nothing. They compile here; they run at H4.
- **N6.** `DispatcherUnhandledException` (handled, typed/category message), `TaskScheduler.UnobservedTaskException` (observed) and `AppDomain.UnhandledException` log the category only.
- **N7.** Done rather than deferred: `UploadService.CachedHealth` is refreshed by the serialized upload loop and recovery actions (a failing read in `finally` is logged, not thrown); the 250 ms UI refresh reads the snapshot instead of querying SQLite.

### Files (this round)
Changed: `Portable/{CapturePipeline,FrameGate,Settings,UploadService,Windowing}.cs`, `Native/{WgcFrameSource,WindowsOcrEngine,Interop}.cs`, `App.cs`, `Dialogs.cs`, portable tests `MemoryBoundTests`, `FrameAndWindowTests`, `SettingsAndSecretsTests`, `UploadServiceTests`, native `NativeTests`, runbook, this changelog. Added: `Portable/{OcrTiling,CaptureDiagnostics,DropGuard,UserMessages}.cs`; tests `OcrTilingTests`, `CaptureDrainTests`, `DropGuardTests`, `ReviewRound1Tests`; tools `Tools/{README.md,bundle_probe.py,MemoryProbe/}`. The Tools project is not in the solution and is not shipped.

Changed existing test expectations (behaviour change requested by the review, not relaxed gates): `Frame_gate_reprocesses_a_still_frame_after_the_refresh_interval_and_after_a_resize` now expects a byte-identical refresh to be skipped and a one-byte change with the same dHash to be re-read; settings/upload constructors take the new arguments.

### Red runs (tests first; real output, trimmed)
```
$ dotnet test agent/tests/Uma.Agent.Windows.Tests/Portable -c Release --no-build --filter FullyQualifiedName~MemoryBoundTests -- RunConfiguration.DotNetHostPath=~/.hermes/cache/scratch/T10-review/dotnet8/dotnet
Failed Returning_to_a_queued_veteran_is_reported_and_never_recollected     Assert.DoesNotContain() Failure
Failed Twenty_veterans_in_one_watch_are_queued_and_their_frames_released   Assert.True() Failure
Failed An_incomplete_veteran_keeps_its_evidence_across_another_veteran_and_completes_later  Expected NotUploadable, Actual Progress
Failed Failed_enqueue_keeps_only_the_sealed_result_and_retries_it_exactly  Expected 1, Actual 2
Failed Cosmetic_changes_with_the_same_parsed_evidence_are_not_accumulated  Expected 1, Actual 40
Failed Idle_polls_of_fresh_identical_arrays_parse_once_and_retain_one_frame Expected 1, Actual 15
Failed!  - Failed: 6, Passed: 1, Total: 7
(later added, red before the most-recently-visited ordering:)
Failed The_least_recently_visited_incomplete_veteran_is_the_one_released   Assert.DoesNotContain() Failure
$ dotnet build agent/tests/Uma.Agent.Windows.Tests/Portable -c Release        [S3/N1/N2/N3 tests before code]
error CS0103: The name 'UserMessages' does not exist in the current context
error CS0117: 'ApiAddress' does not contain a definition for 'Changes'
error CS0117: 'WindowInfo' does not contain a definition for 'ProcessId'
error CS1061: 'SettingsStore' does not contain a definition for 'Notice'
error CS1729: 'SettingsStore' does not contain a constructor that takes 3 arguments
error CS1739: The best overload for 'Select' does not have a parameter named 'ownProcessId'
(likewise S1/S5: 'FrameDrain', 'GeometryDiagnostics'; N7: 'CachedHealth'; S4: 'DropGuard' did not exist)
$ [temporary test: verbatim 204de2d tiling loop on fixture 13 line geometry, cap 1300; removed after the run]
Assert.Empty() Failure: ["Account Link [cut] Rect { X = 1172, ...", "To Title Screen [cut] Rect { X = 1158, ...", "Account Link [cut] Rect { X = 1200, ...", "To Title Screen [cut] Rect { X = 1200, ..."]
```

### Final verification (worktree root; real output, trimmed)
```
$ ~/.hermes/cache/scratch/T10-review/dotnet8/dotnet --list-runtimes
Microsoft.NETCore.App 8.0.31 [~/.hermes/cache/scratch/T10-review/dotnet8/shared/Microsoft.NETCore.App]
$ dotnet build agent/Uma.Agent.sln -c Release -p:EnableWindowsTargeting=true --no-incremental
Uma.Agent.Core / Uma.Agent.Windows.Portable.Tests / Uma.Agent.Windows (net8.0-windows10.0.19041.0) / Uma.Agent.Core.Tests / Uma.Agent.Windows.Tests (Native)
Build succeeded.  0 Warning(s)  0 Error(s)
$ dotnet test agent/tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj -c Release --no-build -- RunConfiguration.DotNetHostPath=<dotnet8>/dotnet
Passed!  - Failed: 0, Passed: 166, Skipped: 0, Total: 166 - Uma.Agent.Core.Tests.dll (net8.0)
accuracy-report: overall 747/747 = 100.00%; silent errors 0; stats 40/40   (unchanged Apple Vision replay, not Windows OCR)
$ dotnet test agent/tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release --no-build -- RunConfiguration.DotNetHostPath=<dotnet8>/dotnet
Passed!  - Failed: 0, Passed: 149, Skipped: 0, Total: 149 - Uma.Agent.Windows.Portable.Tests.dll (net8.0)   (was 103)
Native tests (5): compiled only, NOT executed — H4.
$ dotnet publish agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableWindowsTargeting=true -o ~/.hermes/cache/scratch/t10-fix1/publish
exit 0; Uma.Agent.Windows.exe 193079608 B, Uma.Agent.Windows.pdb 41208, Uma.Agent.Core.pdb 85912
$ python3 agent/tests/Uma.Agent.Windows.Tests/Tools/bundle_probe.py <publish>/Uma.Agent.Windows.exe "$PWD"
bundle 6 0 entries 474
matches 15 of 15   (appsettings.json, data/layouts x2, data/master/latest.json + 11 global-20260930 files)
Uma.Agent.Core.dll / Uma.Agent.Windows.dll / Microsoft.Windows.SDK.NET.dll / WinRT.Runtime.dll / e_sqlite3.dll / ProtectedData / Serilog: True
exit 0   (EXE SHA-256 printed for this publish only; not an identifier)
$ <dotnet8>/dotnet agent/tests/Uma.Agent.Windows.Tests/Tools/MemoryProbe/bin/Release/net8.0/MemoryProbe.dll "$PWD"
A idle still view, fresh array every poll, after 240 polls (60s): processed 1 skipped 239; Sessions 1, Frames 1; managed +MB 11.1 (flat from 10 s)
B one-pixel cosmetic change every poll, after 240 polls (60s): processed 30 skipped 210; Frames 1; managed +MB 8.3 (flat)
C 20 veterans: after veteran 5: queued 4, Frames 9, +MB 75.3; after veteran 20: queued 19, Frames 9, +MB 75.3; after Stop: queued 20, outbox veterans 20, Frames 0, +MB 8.9
D worst case, 2 unqueued veterans x 60 distinct views: limit events 40; Sessions 2, Frames 80; +MB 672.0 (bound 2 x 40 x 8.29 MB = 664 MB of frames)
$ [reviewer's retained probe ~/.hermes/cache/scratch/T10-review/probe, rebuilt against this worktree]
before (review): 34.7 / 51.3 / 76.2 MB at 5 / 10 / 15 s
after:  processed 1 skipped 19 / 39 / 59; managed MB 19.4 / 19.4 / 19.4
$ git diff --name-only 08d4876 -- agent/src/Uma.Agent.Core agent/tests/Uma.Agent.Core.Tests agent/tests/fixtures agent/layouts apps docs/reference | wc -l
0
$ git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check
(no output, exit 0)
```
The memory figures are Mac managed heap (`GC.GetTotalMemory` after a full blocking GC), not Windows process memory. The 20-veteran run uses synthetic veterans built from real parsed fixture evidence (Speed changed per veteran) and the synthetic whole-list Skills thumb already used by the tests. H4 must record actual Task Manager memory during the ≥20-veteran import. Probe outputs are kept in `~/.hermes/cache/scratch/t10-fix1/` (scratch, may expire; rerun with the tools).

### Remaining
- Everything native (WGC newest-frame drain, geometry numbers on real Windows builds, tiled Windows OCR, DPAPI, WPF Exit/Start prompts, unhandled handlers, single-file extraction) is H4. Status stays **Partial**.
- The T11 support-card adapter stays unavailable until T11 is reviewed and merged. This is the normal integration order, not a permission stop.
- Parent re-review required; the worker does not merge.

## Review round 2

### Provenance and scope

Final bounded fix-2 in the existing clean worktree, starting at `8e0f2451dc6195e4cb5750914b5bab60998869c4`, branch `task/T10-windows-shell`. Read the absolute coordinator `docs/tasks/T10.fix-2.prompt.md` and `docs/reviews/T10-review-2.md` in full, original/fix-1 prompts and governing contracts. Implemented directly under the user's explicitly approved GPT-6.1 Sol medium fallback after Anthropic HTTP 429 (approval/failure provenance is the user and task prompt, not a new provider probe). No model CLI, worker, delegation, orchestration, reset, clean, rebase, merge, main/sibling edit, push, deployment, credential access or global configuration change. No new dependency/service or paid tier.

Changed only Windows shell source, Windows-owned tests/tools, runbook and this changelog. Core/Core tests/Cards/fixtures/layouts/master/TS unchanged. The new retained `Tools/EdgeProbe` copies the independent review's scratch source, with relative project references and regression assertions added; its execution is verification, NOT a newly independent review.

### B1 — durable-enqueue backpressure

- `MaxSealedPending = 1`. First real `UploadOutbox.EnqueueCapture` failure retains the sealed result (same object, ID, timestamp, serialized JSON and PNGs), releases its frames and pauses collection BEFORE accepting the identity-transition frame. Both public `Accept` and `ProcessAsync` refuse all further evidence; paused Process does not run geometry/hash/OCR or mutate the frame gate.
- Flush retries the exact pending result first and returns immediately if retry fails. It finalizes live collections sequentially and stops on the first failure; there is no extra sealing outside capacity and no eviction of unsaved complete data. Other previously collected incomplete/overflow evidence is preserved within the live-session limit.
- Successful durable retry removes only the unsaved notice and resets the frame gate. The currently displayed frame is fresh; an already-queued identity stays frozen, while a new veteran resumes safely. Start remains refused while unsaved; Exit still asks before losing it.
- Behavioral regression attempts 25 complete subsequent veterans, both entry points and repeated failed Flush, against a genuinely unavailable SQLite path. It checks no new frames/OCR, one pending object, exact bytes read back from real repaired SQLite and resumed identity collection. Retained edge probe additionally attempts 41 veterans.
- Bound claims corrected: at most 2 live sessions × 40 reference frames plus one unsaved sealed result. Small queued/overflow identity tombstones grow with distinct identities; this is NOT a constant-total-heap guarantee or a Windows RSS measurement. Unaccepted paused evidence is not saved and must be shown again after repair; existing sealed data is never silently dropped.

### B2 — persistent fail-closed overflow

- Rejecting any new distinct evidence at the view cap sets a sticky per-collection overflow blocker. Repeated/older evidence cannot clear it. Finalize/Flush/Stop/identity transition refuse that veteran even if its prior Core checklist was complete. Public Accept and Process enforce the same rule.
- Displayed checklist sections become incomplete (0/3); underlying Core evidence and completeness rules are not edited. Evicting its frames keeps a lightweight blocked identity, so returning later cannot silently start an uploadable collection. Flush reports those tombstones too, forcing the existing confirmation on explicit fresh Start. Only a newly constructed pipeline after the confirmed fresh scan drops them; Stop or polling never does.
- Tests compare actual Core receiving 40 complete views then new unaligned Skills: both displayed shell Skills and Core are incomplete, shell Stop writes zero outbox rows. Return, unchanged Process polls, eviction, repeated Stop, fresh-pipeline recovery and another legitimate complete collection are exercised. Other collections remain independently saveable; released incomplete collections retain warnings.

### S1 — persistent portable notice reducer

- Pipeline events include authoritative snapshots of distinct unsaved/overflow/released notices, separate from routine progress. Queued or NotUploadable primary events cannot mask simultaneous limit/release notices. Routine Skipped/Progress events cannot erase them.
- `CaptureNoticeStatus` drives WPF status/error display. Unsaved clears only after durable retry; overflow only after explicit fresh scan; released warnings have their own acknowledgement menu. A new release revokes the earlier acknowledgement. StartFresh refuses to dismiss unsaved data.
- Portable behavioral tests cover persistence, unrelated-notice preservation, simultaneous queue/limit, acknowledgement and refusing fresh state while unsaved. An immediate-ack regression found duplicate warning copy in routine text; fixed by separating that copy and removing Stop's duplicate historical warning text. WPF native UI behavior remains H4, not claimed executed here.

### S2 — safe validation message ownership

- Arbitrary framework `ArgumentException` (including null/out-of-range), IO/HTTP/aggregate and other generic exceptions now show categories only through `UserMessages.For`. Startup now uses that same boundary instead of its former ArgumentException/IOException message passthrough; UI dispatcher and unhandled UI already use it. Logs remain category-only.
- Internal-constructor shell-owned `ShellValidationException` replaces legitimate shell validation throws. Its copy is fixed shell text; unknown options and invalid URI schemes no longer echo user input. Token single-line/required, HTTPS/process settings, frame-size and recorder-option messages remain actionable. Exact-type validation tests now expect the owned type; the old broad ArgumentException allowlist test was removed and replaced with marker regressions.
- Synthetic sensitive-marker tests cover all generic display categories, unknown command options, token controls and an arbitrary URI scheme. No actual secret used or accessed.

### N1 — fixture attribution correction

`OcrTiling` comment and runbook now attribute the 493-reference-pixel longest recorded line to `14-support-card-detail.json`: “Increases initial Friendship Gauge when beginning a Career”. Fixture 13 remains the old-seam regression. The fix-1 prompt's “fixture13 longestline493” attribution was incorrect; this correction supersedes that historical attribution without rewriting prompts or claiming new OCR evidence. Overlap remains 600; no OCR recording/fixture was changed.

### Tests-first red → green (actual output)

All commands below ran from `/Users/willjose/Projects/personal/uma-musume-spark-calc.worktrees/T10-windows-shell`.

For test execution set `DOTNET_ROOT=/Users/willjose/.hermes/cache/scratch/T10-review/dotnet8`; `<host>` below denotes the exact absolute `/Users/willjose/.hermes/cache/scratch/T10-review/dotnet8/dotnet`.

```
<host> --list-runtimes
Microsoft.NETCore.App 8.0.31

dotnet test agent/tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release --filter 'FullyQualifiedName~Repeated_failed_enqueue|FullyQualifiedName~Previously_complete_at_cap|FullyQualifiedName~ReviewRound2SecurityTests' -- RunConfiguration.DotNetHostPath=<host>
Failed: 4, Passed: 0, Total: 4
B1 Expected (0,0,1), Actual (1,1,1)
B2 Expected Not 3, Actual 3
S2 Framework_exception_messages_are_never_displayed: synthetic marker displayed
S2 Unknown_command_option_does_not_echo_user_input: synthetic marker displayed

dotnet build agent/tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release
Build FAILED: CS0246 CaptureNotice missing (new reducer tests/API before implementation)

dotnet test agent/tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release --filter FullyQualifiedName~Immediate_acknowledgement -- RunConfiguration.DotNetHostPath=<host>
Failed: 1, Passed: 0, Total: 1
Assert.DoesNotContain: released remained in routine text after acknowledgement
```

First full green attempt had 153 passes and 2 failures: the historical broad ArgumentException expectation, and a test expecting new progress from the ORIGINAL already-queued veteran after repair. Corrected those expectations without relaxing upload gates: generic exceptions must be category-only; recovery re-parses that frame but still reports AlreadyQueued, then a different-stat veteran collects successfully. Final suite below includes the immediate-ack fix.

### Final actual verification

```
dotnet build agent/Uma.Agent.sln -c Release -p:EnableWindowsTargeting=true --no-incremental
Build succeeded. 0 Warning(s), 0 Error(s).
Core, Core.Tests, Windows, Windows.Portable.Tests and Windows.Native.Tests compiled.

dotnet test agent/tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj -c Release --no-build -- RunConfiguration.DotNetHostPath=<host>
Passed! Failed: 0, Passed: 166, Skipped: 0, Total: 166

dotnet test agent/tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release --no-build -- RunConfiguration.DotNetHostPath=<host>
Passed! Failed: 0, Passed: 157, Skipped: 0, Total: 157
Native tests (5) compile only: NOT executed on Mac.

dotnet build agent/tests/Uma.Agent.Windows.Tests/Tools/MemoryProbe -c Release
<host> agent/tests/Uma.Agent.Windows.Tests/Tools/MemoryProbe/bin/Release/net8.0/MemoryProbe.dll "$PWD"
exit 0
Still 240 polls: processed 1, skipped 239, retained 1 frame; managed +11.1 MB (flat)
Cosmetic 240 polls: processed 30, skipped 210, retained 1 frame; managed +8.3 MB (flat)
20 synthetic veterans: +75.3 MB at veterans 5/10/15/20, current 9 frames
After Stop: 20 outbox veterans, 0 frames, +8.9 MB
Two capped collections: 80 retained frames, 40 limit events, +672.0 MB

dotnet build /Users/willjose/.hermes/cache/scratch/T10-review/r2/edge-probe/EdgeProbe.csproj -c Release
<host> /Users/willjose/.hermes/cache/scratch/T10-review/r2/edge-probe/bin/Release/net8.0/EdgeProbe.dll "$PWD"
exit 0; original reviewer probe: 1 pending result, 0 frames after 21/41 attempted veterans;
74,758 retained PNG bytes; exact IDs/payload/PNGs; Stop overflow outbox 0; sensitive marker False.
Its historical failedIDs output counts repeated failure events, not distinct capture IDs.

dotnet build agent/tests/Uma.Agent.Windows.Tests/Tools/EdgeProbe -c Release
<host> agent/tests/Uma.Agent.Windows.Tests/Tools/EdgeProbe/bin/Release/net8.0/EdgeProbe.dll "$PWD"
Build succeeded. 0 Warning(s), 0 Error(s). Exit 0.
LIMIT event=Limit; Frames=40; shellSkillsComplete=False; CoreSkillsComplete=False
LIMIT Stop=NotUploadable; outboxVeterans=0
QUEUEFAIL veterans=21: Sessions=0 Frames=0 SealedPending=1; managed+MB=9.500; distinctFailedIDs=1; retainedPngBytes=74758
QUEUEFAIL veterans=41: Sessions=0 Frames=0 SealedPending=1; managed+MB=9.505; distinctFailedIDs=1; retainedPngBytes=74758
RETRY queued=1; oldCapturePayloadsExact=True; oldIDsPreserved=True; pending=0; oldCropBytesExact=True
BACKPRESSURE failed retry blocked; ProcessAsync blocked; exact retry; new identity resumed; notices verified
MESSAGE ArgumentException reflects marker=False
ASSERTIONS passed

dotnet publish agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableWindowsTargeting=true -o /Users/willjose/.hermes/cache/scratch/t10-fix2/publish-final
exit 0; EXE 193083704 bytes
python3 agent/tests/Uma.Agent.Windows.Tests/Tools/bundle_probe.py /Users/willjose/.hermes/cache/scratch/t10-fix2/publish-final/Uma.Agent.Windows.exe "$PWD"
bundle 6 0 entries 474; matches 15 of 15; all 7 key assemblies/native libraries True; exit 0
SHA256 this publish only: 4af2d9d2d3f2ca295d24b979c653cd255dfd46059b8df2caed6f7eff57d6eb9d
```

All heap figures are Mac managed heap after blocking GC, not Windows Task Manager/RSS. Probes replay actual fixture OCR and pixels with explicitly synthetic distinct-stat veterans/whole-list Skills thumb/unaligned evidence; they are not real game imports or native OCR results. Repeated-failure heap includes the probe's own inputs/event/ID bookkeeping, so the supported bound is retained frames/results, not an absolute heap plateau. Source/tools remain reproducible; raw logs and final published bundle are in `/Users/willjose/.hermes/cache/scratch/t10-fix2/` (scratch may expire). Earlier EXE hashes remain historical and are not reproducible identifiers.

### Focused parent re-review handoff

Implementer focused self-check covered transition-before-feed backpressure, sequential Flush, cap invalidation, identity tombstones/ambiguity, displayed checklist and persistent notices, validation callers and startup/unhandled display paths. That is NOT independent review. Parent must independently review `8e0f245..HEAD` against B1/B2/S1/S2/N1, rerun the retained edge/portable checks and record a verdict before any merge. No reviewer was spawned in this direct-only round. If a blocker remains after this final bounded round, parent takes over/escalates; do not launch a third worker fix round.

### Scope checks (actual output)

```
git diff --name-only 08d4876 -- agent/src/Uma.Agent.Core agent/tests/Uma.Agent.Core.Tests agent/src/Uma.Agent.Cards agent/tests/fixtures agent/layouts apps packages docs/reference
(no output; protected paths changed: 0)
```
A programmatic `git status --porcelain=v1 --untracked-files=all` scope check verified all 23 changed/new files are in Windows source/tests/tools, the runbook or task changelog. The initial whitespace check caught one added blank EOF line in this section; it was removed before the final check/commit.

Status stays Partial: H4 WGC/OCR/DPAPI/WPF/native single-file/actual Access-upload validation and reviewed T11 integration remain pending. No merge/push/deploy performed.

## Coordinator final review and local merge
Independent r3 PASS is preserved at `docs/reviews/T10-review-3.md`. The same read-only session continued on Opus medium after Sol's usage limit; no review budget reset. Local merge followed approval. Native tests were compiled only, not run.

Merged verification (actual output):
```
dotnet build agent/Uma.Agent.sln -c Release -p:EnableWindowsTargeting=true --no-incremental
Build succeeded. 0 Warning(s) 0 Error(s)
dotnet test agent/tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj -c Release --no-build -- RunConfiguration.DotNetHostPath=/Users/willjose/.hermes/cache/scratch/T10-review/dotnet8/dotnet
Passed! Failed: 0, Passed: 302, Skipped: 0, Total: 302
dotnet test agent/tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release --no-build -- RunConfiguration.DotNetHostPath=/Users/willjose/.hermes/cache/scratch/T10-review/dotnet8/dotnet
Passed! Failed: 0, Passed: 157, Skipped: 0, Total: 157
```
Initial attempts to invoke `build`/`test` directly with the runtime-only .NET8 host failed with `No .NET SDKs were found`; corrected by system SDK plus explicit test host above. Integration task T10b carries transient capture-error recovery (r3 S1), persistent-notice structure (S2), validation-message cosmetics (N1) and reflection-test fragility (N2). H4 and live Access remain unverified. No push/deploy.
