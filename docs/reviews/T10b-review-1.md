Verdict: CHANGES_REQUESTED

Candidate: 6e6a09a3e416e22885afce16ef44cb4fb830572f on task/T10b-card-shell-integration (base a2ae378). Provenance: independent reviewer, Opus 5.5 medium, read-only, working directly with no subworkers.

The worktree was at that HEAD with an empty `git status --porcelain` at both start and end. Every build and probe ran in a separate scratch clone of the exact candidate: `/Users/willjose/.hermes/cache/scratch/T10b-review-r1/repo`. My only addition there is `agent/tests/Uma.Agent.Windows.Tests/Portable/ReviewProbes.cs`, with synthetic markers and `*.example.test` hosts only.

## Blocking

[B1] Changing the API destination or token while a confirmation is open, or during a retry, sends to the old address using the new credentials. The runbook says this cannot happen.
- Where:
  - `agent/src/Uma.Agent.Windows/Portable/CardSyncController.cs:221–226`: the address is read once, before the modal confirmation.
  - `:243`: after the confirmation, `_boundAddress` is compared with that same pre-modal `destination`. Settings are never read again.
  - `:263`: the uploader reads the token from `_tokens` on every attempt.
  - `App.cs:257–266`: `Settings()` never tells the card controller anything.
- How it can happen: the WPF `MessageBox` without an owner takes the active window as its owner, so the card window is disabled. The tray `NotifyIcon` menu is not, and `Dispatch` is not busy because card actions do not go through it. So Settings can be opened and saved while the partial "replace ENTIRE list" box is open, or while a send is in its retry delay. This comes from reading the source; I could not run WPF.
- Probes (all reproducible):
  - P1, unsent scan: the prompt showed A; settings were changed to B plus a new token while it was open; then Yes.
    `P1 status=Synced; prompt shows a=True; requests=a.example.test secret=SYNTHETIC-NEW-SECRET-FOR-B`
  - P1b, after a first sync bound A: same steps.
    `P1b status=Synced; requests=a.example.test secret=SYNTHETIC-OLD-SECRET | a.example.test secret=SYNTHETIC-NEW-SECRET-FOR-B`
    The "destination changed → cancel" path does not fire.
  - P2, Settings changed during the 503 retry delay:
    `P2 status=Synced; requests=a.example.test secret=SYNTHETIC-OLD-SECRET | a.example.test secret=SYNTHETIC-NEW-SECRET-FOR-B`
- Impact: B's Access credential is sent to a host the user just moved away from, and a destructive whole-list PUT is replaced on a destination that is no longer configured. Runbook §3a.6 (line 100: "or the API address changes before the request is built, nothing is sent") and changelog line 64 are false for these paths.
- Required fix:
  - Re-read and parse `ApiBaseUrl` after the confirmation, inside the lock, and refuse as Stale if it differs from the confirmed `destination`.
  - Bind the send to the destination and token configuration at confirmation time. Re-check on every attempt, for example through a guard or a settings version the controller can see, so a retry never runs after a destination change.
  - Either have `Settings()` invalidate the card scan and in-flight send when the address changes, or refuse Settings while a card confirmation or send is active.
  - Add portable tests P1, P1b and P2, and correct runbook §3a.6/§3a.9 and the changelog.

[B2] The T10 r3 S1 fix (a done-when item) does not recover when the restored frame is the same still screen. That is exactly the runbook H4 case "resize then back".
- Where:
  - `CaptureNoticeStatus.cs:61–62`: only Progress, Queued, AlreadyQueued and CardScreen clear the transient error.
  - `CapturePipeline.cs:111–114`: an Unsupported frame returns before the frame gate, so the gate still holds the last good frame. The restored, byte-identical frame is then always `Skipped`.
- Note: geometry is validated before the gate (lines 106–111). A Skipped result therefore proves the frame was captured and its geometry is valid. The test comment at `CardShellIntegrationTests.cs:677` ("an unchanged poll proves nothing") has this the wrong way round.
- Probes:
  - P8a, real pipeline, fixture 01 → 1280×720 → fixture 01 four times:
    `resize->Unsupported, restore-same->Skipped ×4; tray=Error; error=game client area 1280x720 is below 1920x1080…`
  - P7, window-unavailable error, then the same frame: `Skipped; Error still=SYNTHETIC window minimized`
  - P8b, unavailable error, then a valid non-capture screen: `Ignored; error still=…`
- So the tray stays in Error until the screen content changes, the same symptom T10 r3 S1 described. The existing wired test only passes because it uses a fresh pipeline whose gate is empty.
- Required fix: treat any ProcessAsync result other than Unsupported (Skipped, Ignored, NotUploadable included) as proof the capture source recovered. Or reset the gate on Unsupported. Durable notices must keep their precedence. Add a wired test: valid frame → resize → the same valid frame → Capturing.

## Should fix

[S1] Reset/Cancel/Start confirmations can drop cards collected while the question is open.
- `CardSyncWindow.cs:63–64 and 69–70` capture `_shown` before `Confirm`. `Reset` and `Cancel` (`CardSyncController.cs:143, 158`) check the handle only, not the revision.
- P4: the question said "5 collected…"; 8 cards existed when the user said Yes, and Reset dropped all 8.
- Suggestion: pass the revision the user saw and refuse or re-ask if it moved, or re-ask with current counts.

[S2] The last-sync line is not accurate after an ambiguous or discarded-stale outcome.
- `CardSyncController.cs:285` records only acknowledgements for the current scan.
  - P5: the old scan's PUT received a valid 200 after a newer scan started, so the server now holds those cards. The result is Stale (correct: Core's guard), but no record says the server list changed.
  - P10: an earlier 8-card sync, then a 5-card send that got an unexpected 200. The window still says "Last acknowledged sync: 8 card(s)… (an earlier collection)" although the server may hold 5.
- The result messages do say "may or may not" and "cannot be undone".
- Suggestion: after Failed, or after a Stale result that followed a request, mark the server state unknown in `CardSyncText`.

[S3] Destination binding for an unsent first scan differs from the docs.
- `_boundAddress` starts null and only binds on the first send. P3: a scan started under A with settings changed to B before any send went to B without being cancelled (`P3 status=Synced; requests=b.example.test`).
- This is acceptable on its own, because the confirmation shows B and the token is consistent. But runbook §3a.9 (line 103) and changelog line 64 say a scan registered under an old address is cancelled. Align the docs, or bind the destination in BeginScan.

## Nits

- [N1] An Exit confirmation (`App.cs:301–303`) can be open while the card window, if no window is active, still accepts Send. That send is then cancelled by ShutdownAsync after its request may already have left. The Exit text also says "is being sent" while it may only be waiting for the confirmation.
- [N2] The changelog's mutation results came from the worker's scratch copy. I did not re-run them, so they are self-reported.

## Checklist (85 §3)

1. Spec conformance: issues. Delegation of list/detail parsing into Core is real (`CapturePipeline.CardScreen` → `CardSyncSession.Feed`, then `BuildFull`/`BuildPartial`, then `OwnedCardsUploadCoordinator.SendAsync`). Fixture 13 → 20 cards, the LB pattern, Held 208, partial only. The synthetic full scan is labelled synthetic. No `confirmedEmptyCells` are passed. The S1 done-when item fails (B2).
2. Correctness: B1, B2, S1–S3. Verified OK:
   - one send in flight;
   - stale revision before the prompt and after the confirmation;
   - reset/cancel during a 503 attempt (P11: Stale, 1 request, no retry);
   - 200 shutdown-vs-send races (P6: no hang or exception, no request without a result);
   - an old ACK after a newer scan does not publish success (P5);
   - repeated BeginScan on a still veteran frame does not grow retention (P9: Sessions 1, Frames 1).
   - Lock order is controller → coordinator → session, and nothing takes them in reverse.
3. Test quality: the tests are real and use the actual Core types, fixtures and a fake handler. Gaps: no destination or token change during the confirmation or retry, and no same-frame recovery (the S1 test's premise is wrong). The worker's counts match my reruns.
4. Fabrication: none found. Native WPF/WGC/OCR/DPAPI and the live PUT are correctly marked not run in the runbook and changelog.
5. Security: B1 sends a credential to an origin that is no longer configured. Logs carry the outcome and category only, and secrets are never shown or logged (confirmed by the tests and source).
6. Free tier: not affected.
7. Scope: OK. 0 files under Core, Core tests, fixtures, layouts, apps, packages, specs, reference or OPEN_QUESTIONS; no TypeScript.
8. Maintainability: OK. N1/N2 from T10 r3 are done, and the S2 whole-line strip is correct.

Veteran safeguards are preserved:
- card frames are not read while a veteran is unsaved;
- card frames create no veteran retention or outbox rows;
- EdgeProbe passed: `LIMIT Stop=NotUploadable; outboxVeterans=0`, `QUEUEFAIL veterans=41; retained … SealedPending = 1 …`, `RETRY … oldIDsPreserved=True …`, `ASSERTIONS passed`.

There is no server CAS, as disclosed; the client cannot undo a received PUT. That is inherited from T11 and not a regression.

## Commands run (scratch clone at 6e6a09a; D8 = `/Users/willjose/.hermes/cache/scratch/T10-review/dotnet8/dotnet`)

```
$ dotnet --version
10.0.103
$ dotnet build agent/Uma.Agent.sln -c Release -p:EnableWindowsTargeting=true --no-incremental
Core, Windows (net8.0-windows10.0.19041.0), Core.Tests, Portable.Tests, Windows.Tests (Native) built; 0 Warning(s) 0 Error(s)
$ dotnet test agent/tests/Uma.Agent.Core.Tests/... -c Release --no-build -- RunConfiguration.DotNetHostPath=$D8
Passed! - Failed: 0, Passed: 302, Total: 302
$ dotnet test agent/tests/Uma.Agent.Windows.Tests/Portable/... (candidate, before adding probes)
Passed! - Failed: 0, Passed: 195, Total: 195
$ (same, with ReviewProbes.cs added)
Passed! - Failed: 0, Passed: 208, Total: 208   (probes print findings; they do not assert on them)
$ git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check a2ae378 6e6a09a
(no output) exit 0
$ git diff --name-only a2ae378 6e6a09a -- <Core/CoreTests/fixtures/layouts/apps/packages/reference/specs/OPEN_QUESTIONS> | wc -l
0
$ EdgeProbe build + run with $D8
0 Warning(s) 0 Error(s); LIMIT …; QUEUEFAIL veterans=41 …; RETRY …; ASSERTIONS passed
```

The native project has 5 tests; they were compiled but not run. Not run on this Mac: WPF tray and modals (the reentrancy above comes from reading the source), WGC, Windows OCR, DPAPI, the single-file executable, and a live deployed PUT.

## Remaining human checks

- H4 (Windows): runbook §6 step 7 (a)–(g). Add one check: Settings must be blocked or invalidate the card send while a card confirmation or send is open (B1).
- H2: one confirmed live PUT with Access.

Status should stay Partial. Two fix rounds remain available for B1 and B2.

session_id: 20261007_044907_661d74
