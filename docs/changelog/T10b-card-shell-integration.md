# T10b — Windows support-card shell integration

- **Status:** Partial (review round 1 fixes applied; awaiting re-review). The shell integration is implemented and portable-tested on macOS. Native WPF/WGC/Windows OCR/DPAPI execution and a real PUT to the deployed API have not run (H4/H2).
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
- **Destination change** (superseded and tightened in Review round 1, B1/S3).
  - A scan is bound to the address configured when it started; sending it after the address changed cancels it and creates a fresh coordinator, so a scan is never carried to another address.
  - A scan started after the change gets a fresh coordinator.
  - The HTTP client is rebuilt from `UploadService.DefaultHandler` (Core `UploadClient.CreateHandler()`, redirects off).
- **Auth and messages.** The token is read per request by Core from the DPAPI-backed `ServiceTokenStore`. Results are fixed text plus counts, categories and the API problem paths (control characters replaced, at most 5 lines). Logs carry the outcome and category only.
- **Still list after a new scan.** The pipeline resets the frame gate once when the controller's `Epoch` changes. Otherwise a byte-identical still list would be skipped for the new scan.
- **Stop/Start watching** keeps the card scan. The controller lives as long as the shell, and Stop/Start only replace the veteran pipeline. Start new scan, Reset and Cancel ask before dropping unsynced cards. Exit asks about unsynced cards or an in-flight send, then `ShutdownAsync` invalidates the scan, cancels the lifetime token, waits for the send and disposes the HTTP client.
- **S1 (T10 r3).** `CaptureStatusModel.Transient` is set by `Unsupported` events and watch-loop capture errors. Originally it was cleared only by Progress, Queued, AlreadyQueued and a recognized card screen; Review round 1 (B2) changed that to every captured-frame result except Unsupported and Failed, Skipped included. `Error` = durable notices first, then the transient error.
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

## Review round 1

Review: `docs/reviews/T10b-review-1.md` (CHANGES_REQUESTED on 6e6a09a). Fix commits on top of 6e6a09a: `139ad6f` (B1, S1, S2, S3, N1 and the regression test file), `86fbc56` (B2), `4030734` (runbook), plus this changelog commit. The B2 regression tests are committed in `139ad6f` with the rest of the round-1 test file, before the B2 fix in `86fbc56`; I did not separately run that intermediate commit. Same model and method as before (Opus 5.5, worked directly, no subagents). The reviewer's scratch probes were read only, not copied or changed. Every new test uses `*.example.test` hosts and `SYNTHETIC-*` credential markers saved through the real `ServiceTokenStore` with the test protector.

### B1: settings changed during a confirmation or retry (fixed)
- **Cause** (as the review found): the address was read once before the modal, and the uploader read the live token on every attempt. Settings saved from the tray during the confirmation or the retry delay therefore sent B's credential to A.
- **Design.** No secret is copied or cached, and Core is unchanged:
  - `ServiceTokenStore.Version` is a nonsecret counter, incremented under the store's file lock on every `Save` and `Clear`.
  - `CardSyncController` captures the normalized address and the token version before the confirmation. After the modal closes it re-reads both under the controller lock. If either changed, the send is refused: `Stale`, "Nothing was sent", no request.
  - `CardSyncController.BoundToken` is the `IServiceToken` handed to the reviewed `OwnedCardsUploader`, which calls `Read()` immediately before building each attempt's request. It throws, so the attempt is never made, unless both the configured address and the token version still match the confirmed ones. It checks before and after reading the store. So no attempt (first or retry) runs after a change, and a new credential never goes to the old address.
  - `SettingsCommit.CommitAsync` is the portable function that the tray's Settings action now calls: save, publish, save the token through `UploadService`, then always `cards.ConfigurationChanged()` in a `finally`.
    - `ConfigurationChanged` cancels a scan whose bound address changed, and resets the per-destination coordinator, last ACK and unknown state.
    - It cancels the in-flight send's own cancellation source if that send's address or token version changed. The send then stops: at the next attempt boundary, or immediately for a cooperative transport.
  - The WPF owner-less MessageBox reentrancy described in the review is covered both ways: the send re-reads after the modal, and Settings tells the controller after saving.
- **S3 (decided).** The scan is bound to the address at `BeginScan`, as the docs said. A scan begun under A and sent after a change to B is cancelled, with no prompt and no request (P3). A scan started with no valid address adopts the address at its first confirmed send.
- **Auth repair is kept.** A token-only change keeps the scan (the same scan is still current), but a confirmation or send that spanned the change is refused or stopped. The user sends the same scan again with a fresh confirmation, and it goes to the same host with the new token. Tested both after a 403 and after a change during the confirmation.
- **Limitation (unchanged and stated):** a request already received by the server cannot be undone. `ConfigurationChanged` stops later attempts; it cannot recall one in flight.

### B2: the same still frame did not clear a transient error (fixed)
- `CaptureStatusModel.Apply` now clears `Transient` for every event except `Unsupported` (which sets it) and `Failed`. `CapturePipeline` validates geometry before the frame gate and the parser, so Skipped, Ignored, NotUploadable, Limit, CardScreen, Progress, Queued and AlreadyQueued all prove the captured frame had valid geometry.
- `Failed` is excluded because a paused pipeline returns it before looking at the frame.
- Durable notices are untouched: `Error` still puts `Notices.Error` first, so unsaved and overflow notices keep their precedence.
- I chose this over resetting the gate on Unsupported because resetting the gate would re-parse, and could re-retain, a still veteran frame after every resize flicker.
- The old test asserting "an unchanged poll proves nothing" had the wrong premise. It now asserts that Unsupported and Failed keep the error, and runs as a theory over all 8 clearing kinds.
- The new wired tests use a real pipeline whose gate already holds a valid frame:
  - P8a: McQueen frame, then 1280×720 (Unsupported, tray Error), then the byte-identical frame, which is `Skipped`, error null and tray Capturing;
  - P7: window unavailable, then the same frame (Skipped), and the error clears;
  - P8b: window unavailable, then a valid blank screen (Ignored), and the error clears;
  - durable notices survive a Skipped event.

### S1: drop authority (fixed)
- `Reset` and `Cancel` now require the handle **and** the revision the user was asked about.
- The new `BeginScanReplacing(seen)` does the same for Start new scan, where null means "there was no scan".
- `ReplaceQuestion(view)` builds the question from that same view.
- `CardSyncWindow` takes the view at the click, asks about it and passes it back. If the controller refuses, nothing is dropped and the window shows "The scan changed while you were deciding … choose again".
- Test: 5 cards were shown, 8 existed at Yes → Reset, Cancel and Start are all refused and the 8 cards are kept. Asked again, the question says "8 collected", and Start then succeeds.
- Cancellation and in-flight behaviour are unchanged: the existing Reset/Cancel-during-send tests still pass, because they pass a fresh view.

### S2: web list unknown (fixed)
- The controller keeps `RemoteUnknown` separate from `LastSync`, which stays as history.
- It is set when the web list may have changed without a valid acknowledgement for the current scan:
  - `Failed`;
  - `AuthRequired` or `Rejected` after more than one attempt (earlier transient attempts may have reached the API);
  - any stop or exception after at least one attempt read the credential, which covers a stale 200, a changed scan, changed Settings and Exit.
- It is not set for a first-attempt auth refusal, a local `Invalid`, or a refusal before transport. It is cleared by the next acknowledged sync.
- It is only recorded for the address that is still configured. A destination change clears both `LastSync` and `RemoteUnknown`, because they describe the old destination's list.
- `CardSyncText` shows "Web app card list: UNKNOWN …", labels the last ACK "historical only, may no longer be the web list", and no longer says "(an earlier collection…)" in that state. `SyncedCurrent` is false while the list is unknown.
- A stale 200 is still never recorded as `LastSync` or reported as Synced.
- Tests: P10 (acknowledged 8 cards, then an ambiguous 5-card send → UNKNOWN, with the 8 shown as historical) and P5 (an old ACK after a newer scan → Stale, LastSync null, UNKNOWN).

### N1: exit (fixed)
- `HoldSendsForExit()` is taken at the start of `ExitAsync`, before any question, with `using`, so cancelling Exit restores sending.
- While the hold is active:
  - a new send is refused with no prompt and no request;
  - a send whose confirmation was already open is refused after Yes;
  - the window disables the send buttons (`SendsHeld`).
- `ExitQuestion` now distinguishes "waiting for your confirmation; nothing has been sent" from "is being sent … cannot undo".
- The window shows "Waiting for your confirmation… nothing has been sent yet" instead of "Sending…" while the modal is open.

### N2
This was a provenance note, not an implementation demand. The new mutation results below are again worker-run and self-reported; they are not an independent review.

### Cross-task edits (round 1)
None outside T10b ownership. `ServiceTokenStore` (`Portable/Secrets.cs`, a T10 Windows shell file) gained only the nonsecret `Version` counter. Core, Core tests, fixtures, layouts, contracts, master data, apps and packages are unchanged:
- `git diff --name-only a2ae378 -- agent/src/Uma.Agent.Core agent/tests/Uma.Agent.Core.Tests agent/tests/fixtures agent/layouts apps packages docs/reference docs/specs docs/OPEN_QUESTIONS.md | wc -l` → `0`.

### Verification (round 1)
Red: the new `CardReviewRound1Tests.cs` (13 tests at that point) against the unchanged candidate source (only the test file added; full output in `~/.hermes/cache/scratch/t10b-fix1/red.txt`):
```
$ dotnet test agent/tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release --no-build --filter "FullyQualifiedName~CardReviewRound1Tests" -- RunConfiguration.DotNetHostPath=$D8
Failed P1b_bound_scan_settings_moved_to_B_while_confirmation_open_sends_nothing_more [129 ms]
Failed P2t_token_only_change_during_the_retry_delay_stops_before_the_next_attempt [5 ms]
Failed P1_unsent_scan_settings_moved_to_B_with_new_token_while_confirmation_open_sends_nothing [13 ms]
Failed P2_settings_moved_to_B_during_the_retry_delay_stops_before_the_next_attempt [7 ms]
Failed P4_reset_confirmed_for_5_cards_is_refused_when_8_exist_and_keeps_them [6 ms]
Failed P3_a_scan_started_under_A_is_cancelled_when_the_address_moves_to_B_before_any_send [5 ms]
Failed P10_ambiguous_5_card_send_after_an_acknowledged_8_card_sync_marks_the_web_list_unknown [6 ms]
Failed P8a_resize_then_the_byte_identical_valid_frame_returns_to_Capturing [214 ms]
Failed P8b_window_unavailable_then_a_valid_non_capture_screen_clears_the_error [23 ms]
Failed P1t_token_only_change_while_confirmation_open_sends_nothing [4 ms]
Failed P7_window_unavailable_then_the_same_frame_clears_the_error [63 ms]
Failed N1_exit_question_while_the_send_confirmation_is_open_says_nothing_was_sent [4 ms]
Failed P5_old_acknowledgement_after_a_newer_scan_is_not_success_and_marks_the_web_list_unknown [9 ms]
Failed!  - Failed:    13, Passed:     0, Skipped:     0, Total:    13, Duration: 494 ms - Uma.Agent.Windows.Portable.Tests.dll (net8.0)
```
Selected assertion messages from that red run:
- P1, P1b, P2, P1t, P2t and P3: `Expected: Stale  Actual: Synced`.
- P8a: `Assert.Null() Failure … "game client area 1280x720 is below 1920x1080: make"…`.
- P7: `Actual: "SYNTHETIC window minimized"`.
- P4: `Assert.Null() Failure: Value is not null` (the reset was accepted).
- P10, P5 and N1: `Assert.Contains() Failure: Sub-string not found`.

Green, on the final source (`$D8` = `/Users/willjose/.hermes/cache/scratch/T10-review/dotnet8/dotnet`, used as the test host only):
```
$ dotnet --version
10.0.103
$ dotnet build agent/Uma.Agent.sln -c Release -p:EnableWindowsTargeting=true --no-incremental
Uma.Agent.Core, Uma.Agent.Windows (net8.0-windows10.0.19041.0), Uma.Agent.Windows.Portable.Tests, Uma.Agent.Core.Tests, Uma.Agent.Windows.Tests (Native) -> built
Build succeeded.  0 Warning(s)  0 Error(s)
$ dotnet test agent/tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj -c Release --no-build -- RunConfiguration.DotNetHostPath=$D8
Passed!  - Failed:     0, Passed:   302, Skipped:     0, Total:   302
$ dotnet test agent/tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release --no-build -- RunConfiguration.DotNetHostPath=$D8
Passed!  - Failed:     0, Passed:   225, Skipped:     0, Total:   225
$ (same) --filter "FullyQualifiedName~CardReviewRound1Tests|FullyQualifiedName~CardShellIntegrationTests|FullyQualifiedName~CaptureStatusRecoveryTests"
Passed!  - Failed:     0, Passed:    68, Skipped:     0, Total:    68
$ (same) --filter "FullyQualifiedName~CardReviewRound1Tests"
Passed!  - Failed:     0, Passed:    25, Skipped:     0, Total:    25
$ dotnet build agent/tests/Uma.Agent.Windows.Tests/Tools/EdgeProbe -c Release && $D8 .../EdgeProbe.dll "$PWD"
0 Warning(s) 0 Error(s)
LIMIT Stop=NotUploadable; outboxVeterans=0
QUEUEFAIL veterans=41; retained=RetainedEvidence { Sessions = 0, Frames = 0, SealedPending = 1 }; ... distinctFailedIDs=1
RETRY queued=1; oldCapturePayloadsExact=True; oldIDsPreserved=True; pending=0; oldCropBytesExact=True
ASSERTIONS passed
$ git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check a2ae378
(no output, exit 0)
```
The portable count went from 195 to 225:
- 25 new `CardReviewRound1Tests` cases;
- 5 more cases in the S1-recovery theory, which now has 8 clearing kinds (CardScreen, Skipped, Ignored, NotUploadable and Limit added).

The 25 `CardReviewRound1Tests` cases:
- B1:
  - P1, P1b, P2, plus the token-only variants P1t and P2t;
  - P3 (S3);
  - the real `SettingsCommit` saved while the confirmation is open;
  - `SettingsCommit` during an in-flight request: theory with the address moved or the token only, a cooperative transport, one request, and "cannot be undone";
  - unchanged settings keep the scan;
  - auth repair after a 403, and re-confirmation after a token change during the confirmation;
  - the old destination's history is not shown for B;
  - a static check that `App.cs` and `CardSyncWindow.cs` call these guards (WPF cannot run here).
- B2: P8a, P7, P8b, and durable notices surviving a Skipped event.
- S1: P4 (Reset and Cancel), and Start 5→8.
- S2: P10 and P5.
- N1: the Exit question text, the hold with restore, and a send confirmed during Exit sends nothing.

Self-reported mutation check: script `~/.hermes/cache/scratch/t10b-fix1/mutate.py`, output `mutations.txt`. One mutant at a time in the worktree; each was built, run against the round-1 and recovery filters (36 tests), then the file was restored byte-for-byte. `git status` afterwards showed only the intended uncommitted changes.
```
M1 BoundToken.Check no-op: Failed!  - Failed:     2, Passed:    34, Skipped:     0, Total:    36, Duration: 443 ms - Uma.Agent.Windows.Portable.Tests.dll (net8.0)
M2 ConfigurationChanged no-op: Failed!  - Failed:     3, Passed:    33, Skipped:     0, Total:    36, Duration: 10 s - Uma.Agent.Windows.Portable.Tests.dll (net8.0)
M3 post-confirm config re-read removed: Failed!  - Failed:     1, Passed:    35, Skipped:     0, Total:    36, Duration: 441 ms - Uma.Agent.Windows.Portable.Tests.dll (net8.0)
M4 transient clears only on old kinds: Failed!  - Failed:     8, Passed:    28, Skipped:     0, Total:    36, Duration: 412 ms - Uma.Agent.Windows.Portable.Tests.dll (net8.0)
M5 handle-only authority: Failed!  - Failed:     2, Passed:    34, Skipped:     0, Total:    36, Duration: 494 ms - Uma.Agent.Windows.Portable.Tests.dll (net8.0)
M6 no remote-unknown on Failed: Failed!  - Failed:     2, Passed:    34, Skipped:     0, Total:    36, Duration: 406 ms - Uma.Agent.Windows.Portable.Tests.dll (net8.0)
M7 exit hold ignored: Failed!  - Failed:     1, Passed:    35, Skipped:     0, Total:    36, Duration: 410 ms - Uma.Agent.Windows.Portable.Tests.dll (net8.0)
M8 S3 scan destination ignored: Failed!  - Failed:     1, Passed:    35, Skipped:     0, Total:    36, Duration: 408 ms - Uma.Agent.Windows.Portable.Tests.dll (net8.0)
```
All 8 were killed. An earlier draft of M3 survived because nothing distinguished "refused after the modal" from "stopped by `BoundToken` before the first attempt". The token-only confirmation test now asserts the "Nothing was sent" message, no unknown state and a kept scan, and it kills M3. In the first run, M1 (the check replaced by an empty statement) failed to build; I did not investigate why. It was rewritten as `if (false && …)`, which builds and is killed.

No TypeScript was touched, so pnpm was not run. Not run on this Mac: the WPF tray, modals and owner-less MessageBox reentrancy, WGC, Windows OCR, DPAPI, the single-file executable and a live PUT with Access.

### Known limitations after round 1
- A request that the server already received cannot be recalled. Neither a Settings change nor Exit undoes it, and there is still no server-side revision/CAS (inherited from T11).
- `RemoteUnknown` is in memory only. A restart forgets it, along with the scan and the last ACK (Q-152).
- `ServiceTokenStore.Version` is per process. A token file changed by another process would not bump it, but the agent is single-instance (a named mutex) and the token is written only by its own Settings action.
- The `App.cs` wiring is checked statically. The behaviour behind it (`SettingsCommit`, `HoldSendsForExit`, `BeginScanReplacing`) runs in portable tests.
- H4 has new runbook checks §6 step 7 (h)–(j): Settings during an open confirmation or a slow send, cards arriving during a drop question, and Exit during a send confirmation. These must run on Windows. H2 (live PUT) is unchanged.

## Open questions / follow-ups
- No new questions. Q-150 (partial replaces the whole list), Q-151 (Held distinct vs copies), Q-152 (no durable card queue), Q-153 (scroll placement) and Q-154 (no empty-cell classifier, so a partly filled last row blocks full sync) remain open for H4.
- Follow-up (H4/H2, human, Windows): runbook §6 step 7 (a)–(j), including the round 1 checks (h)–(j):
  - a real full inventory scroll and whether full sync becomes available;
  - a real ambiguous tile resolved through the detail screen;
  - a cancelled partial confirmation;
  - one confirmed live PUT, checked against the web S04 list and `syncedAt`;
  - wrong-token auth handling;
  - a scroll during an open confirmation;
  - Exit prompts;
  - Settings saved during an open confirmation or a slow send; cards arriving during a drop question; Exit during a send confirmation (round 1);
  - Task Manager memory.
- Follow-up: there is no server-side revision/CAS. A request already received cannot be undone, and remote ordering after an ambiguous failure is not guaranteed (an API/ADR change would be needed).
- Independent review r2 PASS on code candidate `838f640aab4a4add808a1c0c9e76dde45cf2158c`, following same-session Opus continuation after lifecycle interruption. Parent report: `docs/reviews/T10b-review-2.md`. No Blocking or Should-fix findings remain. This record is a coordinator-only documentation addition after code approval; local merge and merged verification follow separately. Nothing pushed/deployed.

## Review round 2 — coordinator disposition
- N-a: Windows-only Exit while send confirmation remains open may leave an owned MessageBox orphaned. Portable probe returned Cancelled, zero requests and completed shutdown; this does not verify WPF. Carry explicitly into H4 §6 step7(j), checking modal dismissal/orphaning and no hang.
- N-b: source-string App wiring assertions are brittle and not runtime proof. Retain portable behavior tests; verify actual tray Settings and Exit guards during H4 rather than presenting static checks as native evidence.
- N-c: mutation counts remain worker self-reports. Approval rests on the independent reviewer’s retained fresh/inherited regression probes and actual build/tests, not those counts.
- Native tests compile only; WGC/OCR/WPF/DPAPI/single-file execution and live Access PUT remain H4/H2. Task remains Partial for these human checks.
