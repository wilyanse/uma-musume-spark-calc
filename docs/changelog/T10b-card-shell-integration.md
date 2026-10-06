# T10b — Windows support-card shell integration

- **Status:** Partial. The shell integration is implemented and portable-tested on macOS. Native WPF/WGC/Windows OCR/DPAPI execution and a real PUT to the deployed API have not run (H4/H2).
- **Branch:** task/T10b-card-shell-integration (base a2ae378, merged T10 4d9dc4b + T11 4ee0426)
- **Agent / model:** Claude Opus 5.5 (`claude-opus-5-5`), reasoning medium, worked directly in the worktree. No subagents, model CLIs or orchestration script.
- **Date:** 2026-10-07

## Summary
- The tray's **Capture support cards** now opens a support-card window backed by the reviewed T11 Core API.
- `CapturePipeline` passes classified `cards.list`/`cards.detail` frames, parsed by the existing capture/OCR path, to `CardSyncController`. The controller delegates to `CardSyncSession` and holds one `OwnedCardsUploadCoordinator` per API destination.
- Full and partial syncs are explicit. A partial sync shows a destructive "replaces the ENTIRE list" warning, and No is the default answer.
- A stale scan, revision or destination is refused before any request is built. Only one send runs at a time, and nothing retries in the background.
- T10 r3 S1 is fixed: a transient capture error clears when a valid frame arrives. Durable unsaved/overflow notices are not cleared by this. S2, N1 and N2 are also done (each was small).

## Files
Created:
- `agent/src/Uma.Agent.Windows/Portable/CardSyncController.cs`: portable controller (scan lifecycle, eligibility, confirmations, stale refusal, single in-flight send, result mapping, exit and replace questions) and `CardSyncText`.
- `agent/src/Uma.Agent.Windows/CardSyncWindow.cs`: a thin WPF view. Each button passes back the exact `CardScanView` that was on screen.
- `agent/tests/Uma.Agent.Windows.Tests/Portable/CardShellIntegrationTests.cs`: 32 test methods (38 cases) for wired shell/controller behaviour and S1/S2.
- `docs/changelog/T10b-card-shell-integration.md`: this file.

Modified:
- `agent/src/Uma.Agent.Windows/Portable/CapturePipeline.cs`:
  - `ISupportCardsIntegration` is now `Feed` + `Epoch`, and the old unavailable stub is removed.
  - Card screens go to the controller.
  - A new scan resets the frame gate once.
  - New internal `PendingResults` accessor.
- `agent/src/Uma.Agent.Windows/Portable/CaptureNoticeStatus.cs`:
  - new `CaptureStatusModel` (transient error versus durable notices);
  - notice copy is now stripped as whole lines.
- `agent/src/Uma.Agent.Windows/App.cs`:
  - uses `CaptureStatusModel` for capture-source errors;
  - constructs the controller and passes it to the pipeline;
  - the tray item opens the card window;
  - Exit asks about card state, then shuts down the controller.
- `agent/src/Uma.Agent.Windows/Portable/OcrRecorder.cs`: the CLI validation messages are now full sentences (N1).
- `agent/tests/.../Portable/CapturePipelineTests.cs`: the "unavailable" test is replaced by "card screens without an active scan store nothing".
- `agent/tests/.../Portable/MemoryBoundTests.cs` and `Tools/EdgeProbe/Program.cs`: use `PendingResults` instead of reflecting on `_pending` (N2).
- `docs/runbooks/agent-install.md`: new §3a support-card workflow, transient vs durable errors, the H4 step 7 card checks, troubleshooting, and the integration status.

## Decisions
- **Frames come only from the existing path.** Card frames are parsed once by `CapturePipeline.ProcessAsync` (same gate, normalisation and OCR) and fed with `CardSyncSession.Feed(parsed)`.
  - The `_pending` pause check runs first, so card frames are not read while a veteran capture is unsaved.
  - Card frames never touch veteran sessions, frame retention, `Progress` or the outbox.
  - `confirmedEmptyCells` is never passed, because no verified empty-cell classifier exists (Q-154). So a partly filled last row still blocks full sync, and no empty cells are invented.
- **Scan lifecycle follows Q-154 exactly.**
  - BeginScan: new session, then `BeginGeneration(session)`. Registering the new scan retires the old one, and the old session is cancelled.
  - Reset: `Invalidate`, `Reset`, `BeginGeneration`, with a new handle.
  - Cancel: `Invalidate`, then `Cancel`.
  - The coordinator lives as long as the shell, per destination.
- **Trusted snapshot = `CardScanView(handle, state)`.** The UI returns the view it showed. The controller refuses it before any prompt if the handle is not the current one or the session revision moved.
  - After the modal confirmation, it checks again, builds the payload with Core's `BuildFull`/`BuildPartial(view.State.PartialConfirmation)`, and checks again that the revision is unchanged. Revisions only grow, so the built body is the snapshot that was confirmed.
  - The coordinator then re-checks before every attempt and after each retry delay.
- **Destructive confirmation.**
  - Partial: title "DESTRUCTIVE: replace the ENTIRE owned-card list?"; the body includes Core's exact `PartialSyncConfirmation.Message`, "does NOT merge" and the destination.
  - Full: also asks, because it replaces the list too.
  - Partial is refused when full is possible. Full is refused, with Core's blockers, unless `CanSendFull`.
- **Retry: the smallest safe behaviour.** The only retries are Core's bounded attempts inside one user-initiated send (production default 4 attempts, 2 s doubling, at most 30 s).
  - After `Failed`/`AuthRequired`, the user re-sends from the same unchanged scan, and partial asks again. Nothing is queued or retried automatically, and nothing is written to disk.
  - The result text says the list "may or may not" have been replaced and that a received request can't be undone.
  - Veteran outbox records are not used for cards.
- **Single in-flight send.** A second Send while one is in flight, or while its confirmation is open, returns `Busy` with no prompt and no request. The WPF buttons are also disabled while sending.
- **Destination change.**
  - Sending a scan registered under an earlier address cancels that scan and creates a fresh coordinator, so the confirmed scan is never carried to the new address.
  - A scan started after the change gets a fresh coordinator.
  - The HTTP client is rebuilt from `UploadService.DefaultHandler` (Core `UploadClient.CreateHandler()`, redirects off).
- **Auth and messages.** The token is read per request by Core from the DPAPI-backed `ServiceTokenStore`. Results are fixed text plus counts, categories and the API problem paths (control characters replaced, at most 5 lines). Logs carry the outcome and category only.
- **Still list after a new scan.** The pipeline resets the frame gate once when the controller's `Epoch` changes. Otherwise a byte-identical still list would be skipped for the new scan.
- **Stop/Start watching** keeps the card scan. The controller lives as long as the shell, and Stop/Start only replace the veteran pipeline. Start new scan, Reset and Cancel ask before dropping unsynced cards. Exit asks about unsynced cards or an in-flight send, then `ShutdownAsync` invalidates the scan, cancels the lifetime token, waits for the send and disposes the HTTP client.
- **S1 (T10 r3).** `CaptureStatusModel.Transient` is set by `Unsupported` events and watch-loop capture errors. It is cleared by Progress, Queued, AlreadyQueued and a recognized card screen, and by Start/Stop. A Skipped poll does not clear it. `Error` = durable notices first, then the transient error.
- **S2.** Notice copy is removed from routine text only as whole lines. N1 and N2 were each a few lines, so they were done rather than deferred.

## Deviations from spec
- 30 §8 "Finish: when the unique card count equals Held N, send": sending stays explicit (button plus confirmation), not automatic. A whole-table replacement should not happen silently.
- 30 §6 outbox: card syncs are not queued durably (unchanged from Q-152).

## Cross-task edits
- None. Core, Core Cards, Core tests, contracts/schema, master, layouts, fixtures and labels are unchanged: `git diff --name-only a2ae378 HEAD -- agent/src/Uma.Agent.Core agent/tests/Uma.Agent.Core.Tests agent/tests/fixtures agent/layouts apps packages docs/reference docs/specs | wc -l` → `0`. The edits to T10-owned Windows files are within T10b's ownership (80 §T10b). `docs/OPEN_QUESTIONS.md` is unchanged and no new question was needed.

## Verification
Environment: system SDK `dotnet --version` → `10.0.103`. Test host (runtime only): `/Users/willjose/.hermes/cache/scratch/T10-review/dotnet8/dotnet --list-runtimes` → `Microsoft.NETCore.App 8.0.31`. No build or test was invoked with that host.

Baseline at a2ae378, before any change:
```
$ dotnet build agent/Uma.Agent.sln -c Release -p:EnableWindowsTargeting=true
Build succeeded.  0 Warning(s)  0 Error(s)
$ dotnet test agent/tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj -c Release --no-build -- RunConfiguration.DotNetHostPath=$D8
Passed!  - Failed:     0, Passed:   302, Skipped:     0, Total:   302
$ dotnet test agent/tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release --no-build -- RunConfiguration.DotNetHostPath=$D8
Passed!  - Failed:     0, Passed:   157, Skipped:     0, Total:   157
```
During development, the first wired run failed 2 of 191:
- the Exit test's transport stub ignored cancellation;
- a re-scan of the same still fixture frame was skipped by the frame gate. This was a real shell bug, fixed with the `Epoch` gate reset.

Final candidate (the `$D8` path is the one above):
```
$ dotnet build agent/Uma.Agent.sln -c Release -p:EnableWindowsTargeting=true --no-incremental
Uma.Agent.Core, Uma.Agent.Windows (net8.0-windows10.0.19041.0), Uma.Agent.Windows.Portable.Tests, Uma.Agent.Core.Tests, Uma.Agent.Windows.Tests (Native) -> built
Build succeeded.  0 Warning(s)  0 Error(s)
$ dotnet test agent/tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj -c Release --no-build -- RunConfiguration.DotNetHostPath=$D8
Passed!  - Failed:     0, Passed:   302, Skipped:     0, Total:   302, Duration: 5 s
$ dotnet test agent/tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release --no-build -- RunConfiguration.DotNetHostPath=$D8
Passed!  - Failed:     0, Passed:   195, Skipped:     0, Total:   195, Duration: 6 s
$ (same) --filter "FullyQualifiedName~CardShellIntegrationTests|FullyQualifiedName~CaptureStatusRecoveryTests"
Passed!  - Failed:     0, Passed:    38, Skipped:     0, Total:    38
$ dotnet build agent/tests/Uma.Agent.Windows.Tests/Tools/EdgeProbe -c Release && $D8 .../EdgeProbe.dll "$PWD"
LIMIT Stop=NotUploadable; outboxVeterans=0
QUEUEFAIL veterans=41; retained=RetainedEvidence { Sessions = 0, Frames = 0, SealedPending = 1 }; ... distinctFailedIDs=1
RETRY queued=1; oldCapturePayloadsExact=True; oldIDsPreserved=True; pending=0; oldCropBytesExact=True
ASSERTIONS passed
$ dotnet build agent/tests/Uma.Agent.Windows.Tests/Tools/MemoryProbe -c Release && $D8 .../MemoryProbe.dll "$PWD"
C after veteran 20: retained { Sessions = 1, Frames = 9, SealedPending = 0 }; after Stop: outbox veterans 20, Frames 0, managed +11.2 MB
D worst case: limit events 40; Sessions 2, Frames 80; managed +672.0 MB (bound 664 MB of frames)
$ dotnet publish agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableWindowsTargeting=true -o ~/.hermes/cache/scratch/t10b/publish
exit 0
$ python3 agent/tests/Uma.Agent.Windows.Tests/Tools/bundle_probe.py <publish>/Uma.Agent.Windows.exe "$PWD"
bundle 6 0 entries 474; MATCH appsettings.json, layouts, templates ...; e_sqlite3.dll/ProtectedData/Serilog True
$ git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check a2ae378
(no output, exit 0)
```
The veteran bounds are unchanged: memory, backpressure, overflow and the EdgeProbe assertions match T10's merged figures. Every existing T10 portable test still passes; one card-screen test was replaced as described under Files.

What the portable tests exercise, through the real `CapturePipeline`, the real Core Cards session, coordinator and uploader, real fixtures 13/14 with recorded OCR, and a scripted fake HTTP handler:
- **Parsing delegation:**
  - fixture 13 → 20 cards, LB `[2,4,4,4,4,0,0,1,0,4,0,4,0,4,4,0,0,4,4,0]`, Held 208, `CanSendFull=false`, blocker "20 of 208", no veteran retention or outbox rows;
  - a demoted fixture-13 tile is resolved by the real fixture-14 detail;
  - the pending-tile selection view.
- **Eligibility:** full is refused on fixture 13 with no prompt and no request; partial is refused when full is possible; a SYNTHETIC complete Held-5 scan sends full without `?partial=1`.
- **Destructive confirmation:**
  - cancel → no request and no LastSync;
  - the title and body contain DESTRUCTIVE/ENTIRE, Core's exact message, "does NOT merge" and the destination;
  - a confirmed partial is one PUT `/api/v1/owned-cards?partial=1` with the service-token headers and a valid body.
- **Stale refusal:**
  - an older revision is refused before the prompt;
  - a frame arriving during the open confirmation is refused after it (the next send asks "Send 6 of 10");
  - a full view whose confidence changed during the confirmation is refused;
  - views of a replaced, reset or cancelled scan are refused (theory ×3), and an old view can't reset or cancel the replacement;
  - a frame during the retry delay stops the second attempt.
- **Duplicate in flight:** returns `Busy`, with no prompt and one request.
- **Auth:** 401/403/302 are not retried, point to Settings and hide the HTML marker; the user re-sends the same scan, with identical bytes, after repair.
- **Bad ACK:** count 19 → 3 bounded attempts, `Failed` with "unexpected-response"/"may or may not", and no further request after 50 ms.
- **Network:** `HttpRequestException` carrying a marker and the secret → category only, and the secret is absent from the message and the logs.
- **422:** not retried; sanitized paths are shown.
- **Freshness after a newer sync:** a failed 5-card send, then an 8-card send synced, then a stale resend of the 5-card view is refused with no request; `SyncedCurrent` becomes false after a newer frame.
- **Destination change:** handled both at send time and for a new scan.
- **Stop/Start/Exit:** Stop/Start keeps the scan and adds no veteran DropGuard prompt. Replace/Exit ask about unsynced cards. Exit during a send cancels it after one request, and every later call is refused.
- **Veteran safeguards:**
  - card screens in the middle of fixtures 01–07 keep the same veteran session, retention and completeness result;
  - card frames are not fed while an unsaved veteran pauses the pipeline;
  - the source has no `UploadOutbox`/`Enqueue`/`File.` use.
- **S1:** Progress/Queued/AlreadyQueued clear transient errors and a Skipped poll does not. Durable notices keep precedence and survive recovery. The wired pipeline goes 1280×720 → Error, then a real fixture frame → Capturing.
- **S2:** a routine line that merely contains notice text is kept.

Mutation check on a scratch copy (`~/.hermes/cache/scratch/t10b/mut`, scripts `mutate.py`, `mutate2.py`, `mutate3.py`, outputs `mutations*.txt`): one mutant at a time, build, full portable suite, restore. The worktree was never mutated.
```
KILLED stale view check removed            | Failed: 2
KILLED partial confirmation skipped        | Failed: 7
KILLED full eligibility skipped            | Failed: 1
KILLED in-flight guard removed             | Failed: 1
KILLED handle identity not checked         | Failed: 3   (after adding the "replaced, reset or cancelled" message assertion)
KILLED scan epoch gate reset removed       | Failed: 3
KILLED card frames not fed                 | Failed: 28
KILLED transient not cleared on progress   | Failed: 3
KILLED transient overrides durable         | Failed: 1
KILLED S2 substring strip restored         | Failed: 1
KILLED destination rebind skipped          | Failed: 1
KILLED lastSync not recorded               | Failed: 3
KILLED exit question ignores unsynced      | Failed: 1
KILLED shutdown does not cancel lifetime   | Failed: 1
KILLED post-confirm AND post-build checks removed | Failed: 1
SURVIVED post-confirm stale recheck removed (alone)
SURVIVED post-build revision check removed (alone)
```
The two single survivors are redundant guards: each covers the other, as the combined kill shows. Both are kept as defence in depth.

No TypeScript was touched, so pnpm lint/typecheck/test was not run. The scope is `agent/src/Uma.Agent.Windows/**`, `agent/tests/Uma.Agent.Windows.Tests/**` and docs (runbook, this changelog).

**Not verified (cannot run on Mac):** WPF window/tray behaviour, WGC capture, Windows OCR on real card screens, DPAPI, single-file launch, the native test project (compiled only), and a real PUT to the deployed API with Access. All HTTP evidence is fake-handler replay of the inspected route shape, not a live API.

## Open questions / follow-ups
- No new questions. Q-150 (partial replaces the whole list), Q-151 (Held distinct vs copies), Q-152 (no durable card queue), Q-153 (scroll placement) and Q-154 (no empty-cell classifier, so a partly filled last row blocks full sync) remain open for H4.
- Follow-up (H4/H2, human, Windows): runbook §6 step 7 (a)–(g):
  - a real full inventory scroll and whether full sync becomes available;
  - a real ambiguous tile resolved through the detail screen;
  - a cancelled partial confirmation;
  - one confirmed live PUT, checked against the web S04 list and `syncedAt`;
  - wrong-token auth handling;
  - a scroll during an open confirmation;
  - Exit prompts;
  - Task Manager memory.
- Follow-up: there is no server-side revision/CAS. A request already received cannot be undone, and remote ordering after an ambiguous failure is not guaranteed (an API/ADR change would be needed).
- Independent coordinator review is required before merge. This branch is not merged, pushed or deployed.
