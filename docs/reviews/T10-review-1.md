## Verdict: CHANGES_REQUESTED

Reviewed candidate 204de2d576ebbd988e5253e919ef6cdaa68726cc (base 08d4876) in a fresh, read-only session. The worktree was clean at the start and end, HEAD did not change, and I made no tracked edits, commits or pushes. One blocking finding: memory grows without limit during normal assisted capture. I measured it on the Mac against the real Core code.

Evidence levels used below:
- Compile: real cross-target build and publish on the Mac.
- Portable: real tests on net8.0 against the real Core, fixtures and SQLite.
- Native/H4: nothing was run on Windows. The WGC, OCR, DPAPI and WPF findings come from reading the source and API contracts.

## Blocking

[B1] agent/src/Uma.Agent.Windows/Portable/CapturePipeline.cs:54,62,101 and Portable/FrameGate.cs:22. Problem: memory grows without limit while watching.
- Every frame the gate lets through goes to `CaptureCoordinator.Feed`. Core's `CaptureSession.Add` keeps the full 1920×1080 frame (8.3 MB) as evidence (Core Session.cs:129 `_headers.Add((p.Header, p.Frame))`, plus the content maps and popups).
- T10's forced 2-second re-read sends identical still frames back into the session. The runbook tells users to dwell at least 2 s on every view, which makes this happen on every view.
- Sessions that were already queued are never released. `Flush` filters them out, but `_coordinator.Sessions`, `_identity` and `_pending` keep them, so their frames stay in memory for the whole watch.
- Measured: probe/Program.cs replays fixture 02 as a fresh array every 250 ms, like WGC delivers frames. Managed memory went up 34.7 MB at 5 s, 51.3 MB at 10 s and 76.2 MB at 15 s (8 frames processed, 52 skipped). That is about 4 MB/s while the user just sits on a view.
- H4 asks for at least 20 veterans in one watch. At roughly 60 retained frames per veteran that is about 0.5 GB per veteran, so several GB in total.
- The runbook's "Stop/Start periodically" works around the problem rather than fixing it.

Required fix, in shell code without touching Core:
1. When a forced re-read happens after the 2 s timer, skip it if the frame bytes are identical to the last processed frame. Use a content hash: fixtures 02 and 03 differ in bytes, so the Q-101 dHash collision is still handled.
2. Limit forced re-reads that keep producing the same parsed evidence.
3. Once a session is queued on an identity change, drop it from the pipeline. One way: rebuild the coordinator after queueing, keeping a guard so a returning frame of a queued identity is ignored or reported AlreadyQueued, not re-collected.
4. Add a deterministic portable test that runs N idle polls and N veterans and asserts a fixed bound on retained sessions/frames.

If Core ownership is really needed, append a question to OPEN_QUESTIONS (Q-102), but the shell-side limits are still required.

## Should fix

[S1] Native/WgcFrameSource.cs:50. The free-threaded pool has 2 buffers and is polled every 250 ms, and only one frame is taken per poll. That frame is the oldest one queued, captured right after the previous release, so it is up to one poll interval old. Fix: drain with `TryGetNextFrame` until it returns null, keep the newest frame and dispose the others. Then run the before/after geometry check on that newest frame.

[S2] Native/WindowsOcrEngine.cs:49-64. The full-frame recorder tiles with an overlap of 100 reference px (cap is 1300 when `MaxImageDimension` is 2600).
- In the real fixtures, 6 lines on screen 13 cross the 1200–1300 overlap. "To Title Screen" [1158..1328] crosses both tile edges, so each tile reads only part of it, and each part is kept by centre-ownership. The recorded `ocr/13` would then hold split text that no real per-ROI read produces.
- Fix: make the overlap at least as long as the longest expected line (the fixtures reach 493 px). Or keep a line only from a tile whose interior fully contains its box; if none does, re-read that line's band once at ×2.
- Add a test using fixture line geometry.

[S3] Portable/Settings.cs:79-83 with App.cs:95,105-109. A malformed `settings.json` throws `JsonException` during startup.
- Probe results: "{not json" and "" both throw. `null`, null fields and `http://` all fall back safely and uploads stay refused.
- The `JsonException` lands in the generic message "Check the bundled data, local file permissions and English Windows OCR", and the app exits. The user cannot recover from the UI.
- Fix: catch `JsonException`, keep a backup of the bad file (`settings.json.bad-<ts>`), load the defaults and show an actionable message. Add a test.

[S4] App.cs:253-256. Exit asks for confirmation only when there is a Failed (not saved) result. An incomplete in-memory collection (NotUploadable) is dropped silently on Exit, while Start asks before dropping the same thing (App.cs:147). Make Exit ask the same question; the runbook text at line 161 should match.

[S5] Native/WgcFrameSource.cs:65-67. If the WGC content size never equals `DWMWA_EXTENDED_FRAME_BOUNDS` on some Windows 10 builds, every poll fails closed with "window is resizing", and the cause can't be seen. Log the frame/texture/client dimensions as numbers only (no titles), and add an explicit H4 check to runbook §6.1. Failing closed is correct; this is only about diagnosis.

## Nits

- [N1] Portable/Windowing.cs:40 and Native/Interop.cs:32-47: the title fallback doesn't exclude the agent's own process or window (status title "Uma Spark Calc — assisted capture"). Exclude `Environment.ProcessId`.
- [N2] App.cs:221: the address-change check compares the raw `_settings.ApiBaseUrl` with the un-normalised dialog text, so a trailing-slash difference triggers a false "change destination" prompt. Compare the normalised `ApiAddress` forms.
- [N3] App.cs:244-245 and 134: in RecordLive, an unsupported client size or a token with control characters (Dialogs.cs doesn't pre-check this) ends in the generic "check file permissions" message. Show the typed messages instead.
- [N4] Portable/UploadService.cs:28: the `IClock` parameter is unused.
- [N5] Native/NativeTests.cs:23-29: the WGC test cancels before the gate, so it tests no WGC behaviour. Say so in its name, or add a real "no matching window → CaptureUnavailable" test.
- [N6] App.cs has no `DispatcherUnhandledException` / `TaskScheduler.UnobservedTaskException` handlers. Add ones that log the category only.
- [N7] App.cs:195 (`Refresh`) calls `_uploader.Health()`, which runs SQLite queries on the UI thread every 250 ms. Acceptable, but cache it from the upload loop instead.
- [N8] Changelog evidence paths (`~/.hermes/cache/scratch/t10/red-build.txt`, `verify_bundle.py`, `artifact-manifest.json`) no longer exist; the scratch folder was pruned. My re-publish matches the EXE size (193050936) and the PDB size, but the SHA256 differs (b9baa2f3… vs 7b3c572e…). Don't quote the EXE hash as a reproducible identifier.
- [N9] The parent-supplied .NET 8 host is incomplete: 66 of the framework DLLs and "No frameworks were found", so the test run aborted. I installed a fresh .NET 8.0.31 runtime into review scratch (details under Commands).

## Checklist

1 Spec conformance: ok, apart from B1. Covered:
- Tray states and menu, with the support-cards boundary truthfully unavailable (no duplicate Cards code).
- HWND client-area WGC; 16:9 ≥1080 normalised by Core `ParseAsync`; smaller or non-16:9 frames rejected before dHash/OCR.
- 4 fps loop with whole-frame dHash skipping.
- English OCR on ×2 ROI crops with the digits filter.
- DPAPI CurrentUser, Serilog under %LOCALAPPDATA%, single-file publish, runbook complete. Status is Partial until H4.

2 Correctness: issues B1, S1–S5.
- Verified correct by reading: cancellation/disposal ordering (`Stop` awaits the worker before `Flush`; the OCR/WGC operation is awaited before its bitmap or surface is disposed; `Next` and `Dispose` are serialised; the `Closed` callback only sets a flag; device failures `Reset`).
- WinRT/COM checked against the published ABIs: the GUIDs for `IGraphicsCaptureItemInterop` and the `GraphicsCaptureItem` and `IDXGIDevice` IIDs; `D3D11_SDK_VERSION` 7, `HARDWARE` 1 / `WARP` 5, `BGRA_SUPPORT` 0x20. The `FromAbi` calls AddRef and every raw pointer is Released, so refcounts balance.
- Native execution of all of the above: H4.

3 Test quality: real tests on real Core, fixtures and SQLite with injected clocks and seeded ULIDs.
- The 02/03 dHash collision is genuinely asserted against the real fixture images.
- The complete→queued path uses a labelled synthetic whole-list thumb (no screenshot shows the end of a Skills list) and runs through `Accept`, not `ProcessAsync`.
- `SourceGuardTests` are only string checks. I didn't rely on them: I checked the no-redirect handler, the HTTPS refusal, logs carrying categories only and the confirmations directly in the code and tests.
- There is no memory-bound test (B1).

4 Fabrication: ok.
- No game facts invented. Constant OCR confidence 1.0 is documented as a sentinel (Q-100), not a measurement.
- The recorder only writes what the engine returns, refuses to overwrite by default, and its format matches the committed fixtures, including the ROI plan for 05/13 (tested).
- No Windows results are claimed.

5 Security: ok.
- Token: DPAPI CurrentUser blob only, exact values kept, control characters rejected, never shown in the dialog.
- Logs carry the exception type or category only, including exception paths.
- HTTPS-only with no userinfo, query or fragment. `UploadClient.CreateHandler` with no automatic redirects, verified on the actual handler object.
- Requeue and Discard both require confirmation; Discard removes the whole capture group.
- No input injection, process-memory or network-inspection APIs. Release runs `asInvoker`.
- Remaining gap: S3.

6 Free-tier / paid products: ok. No new service or paid product.

7 Scope: ok. The changes are limited to Windows/**, Windows.Tests/**, the runbook, the changelog, the solution file (additions only, CRLF kept) and two questions appended to OPEN_QUESTIONS (Q-100/101, within the reserved range, 0 lines removed). Core, fixtures, layouts, master and TS are untouched. `diff --check` is clean.

8 Maintainability: ok, with nits N4–N7. Pins are exact: Serilog 4.3.0, Serilog.Sinks.File 6.0.0, ProtectedData 8.0.0, `WindowsSdkPackageVersion` 10.0.19041.57, xunit 2.9.3, Test.Sdk 17.14.1.

## Commands run (worktree root; real, trimmed output)

```
$ git status --short; git rev-parse HEAD
(clean) 204de2d576ebbd988e5253e919ef6cdaa68726cc        [same at start and end]

$ dotnet build agent/Uma.Agent.sln -c Release -p:EnableWindowsTargeting=true
Uma.Agent.Core / Portable.Tests / Uma.Agent.Windows (net8.0-windows10.0.19041.0) / Core.Tests / Uma.Agent.Windows.Tests (Native) built
Build succeeded.  0 Warning(s)  0 Error(s)

$ dotnet test agent/tests/Uma.Agent.Core.Tests/... -c Release --no-build -- RunConfiguration.DotNetHostPath=/private/var/folders/k3/.../T/dotnet8/dotnet
Testhost ... Framework 'Microsoft.NETCore.App' 8.0.0 ... No frameworks were found.  Test Run Aborted.
(supplied host incomplete; installed fresh runtime:)
$ dotnet-install.sh --runtime dotnet --version 8.0.31 --install-dir ~/.hermes/cache/scratch/T10-review/dotnet8 --no-path
Microsoft.NETCore.App 8.0.31

$ dotnet test agent/tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj -c Release --no-build -- RunConfiguration.DotNetHostPath=<review>/dotnet8/dotnet
Passed!  - Failed: 0, Passed: 166, Skipped: 0, Total: 166 - Uma.Agent.Core.Tests.dll (net8.0)
$ dotnet test agent/tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release --no-build -- RunConfiguration.DotNetHostPath=<review>/dotnet8/dotnet
Passed!  - Failed: 0, Passed: 103, Skipped: 0, Total: 103 - Uma.Agent.Windows.Portable.Tests.dll (net8.0)
(Native tests: compiled only; NOT executed — H4)

$ dotnet publish agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableWindowsTargeting=true -o <review>/publish
Uma.Agent.Windows -> <review>/publish/   (Uma.Agent.Windows.exe 193050936 B, .pdb 36300, Core.pdb 85912)
$ python3 <review>/bundle_probe.py <review>/publish/Uma.Agent.Windows.exe <worktree>     [independent .NET bundle-manifest parser]
bundle 6 0 entries 474
MATCH appsettings.json, data/layouts/{global-2026-09, templates/global-2026-09}.json, data/master/latest.json + 11 global-20260930 files
matches 15 of 15
Uma.Agent.Core.dll / Uma.Agent.Windows.dll / Microsoft.Windows.SDK.NET.dll / WinRT.Runtime.dll / e_sqlite3.dll / ProtectedData / Serilog: True
sha256 b9baa2f394ab6206f219335921092134fda3329e3785d76f48f123164e18eadf

$ <review>/dotnet8/dotnet probe/bin/Release/net8.0/probe.dll <worktree>     [B1: real Core + pipeline, fresh frame array per 250 ms poll]
baseline managed MB 9.8
after 20 polls (5s idle on one still view): processed 3 skipped 17; managed MB 34.7
after 40 polls (10s idle on one still view): processed 5 skipped 35; managed MB 51.3
after 60 polls (15s idle on one still view): processed 8 skipped 52; managed MB 76.2

$ <review>/dotnet8/dotnet probe2/bin/Release/net8.0/probe2.dll     [S3]
[{not json] -> THROWS JsonException
[] -> THROWS JsonException
[null] -> defaults; uploadAllowed=False
[{"apiBaseUrl":"http://evil/","processName":"x"}] -> loaded; uploadAllowed=False

$ python (fixture OCR geometry vs 1200–1300 tile overlap)     [S2]
661 lines, 6 cross the overlap (all fixture 13), e.g. 'To Title Screen' [1158,973,170,25]
largest parser ROI right edge 860 (no parser ROI crosses the seam); longest fixture line 493 px

$ git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check 08d4876..HEAD
(no output, exit 0)
$ git diff --name-only 08d4876..HEAD | grep -vE '<Owns|sln|runbook|changelog|OPEN_QUESTIONS>'
(none)   OPEN_QUESTIONS removed lines: 0   sln removed lines: 0
```

The parent's results (0 warnings/errors, Core 166/166, portable 103/103, CRLF-aware diffcheck clean) reproduce independently. All Windows-native behaviour (WGC cropping, DPI, minimise, real English OCR, DPAPI, single-file extraction, tray UX, Access/upload) is still H4. Nothing here is native evidence, and "H4 pending" in the changelog is not evidence either.

Review scratch kept in ~/.hermes/cache/scratch/T10-review:
- build.log, core.log, portable.log
- bundle_probe.py
- probe/ (B1 memory probe)
- probe2/ (S3 settings probe)
- publish/
- dotnet8/ (the fresh .NET 8 runtime)

session_id: 20261006_135311_0a03b7
