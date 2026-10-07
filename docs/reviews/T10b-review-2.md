↻ Resumed session 20261007_053143_a7e22f "T10b card shell integration review round 2" (1 user message, 35 total messages)
T10b review round 2 verdict: PASS

The round-1 fixes hold. No Blocking or Should-fix findings remain. There are 3 nits, all non-blocking, and native Windows behaviour plus the live PUT are still unverified.

Candidate: 838f640aab4a4add808a1c0c9e76dde45cf2158c on task/T10b-card-shell-integration (base a2ae378, round-1 fixes on top of 6e6a09a).
Provenance: fresh independent reviewer, Opus 5.5 medium, read-only. I worked directly: no subworkers, delegation, model CLI or orchestration.
Worktree: HEAD was 838f640 with an empty `git status --porcelain=v1 -uall` (0 lines) at the start and at the end.
Scratch: every build and probe ran in a separate clone of the exact candidate at /Users/willjose/.hermes/cache/scratch/T10b-review-r2/repo. I added only two untracked probe files there (listed under Probes). The round-1 probe file was copied, not changed.

Blocking
None.

Should fix
None.

Nits
- N-a, App.cs:306 (native, unverified). If tray Exit is answered Yes while the card send confirmation is still open, Exit closes the card window, which owns that MessageBox, and then ShutdownAsync waits for the pending send. The portable logic is safe: probe F9 shows Cancelled, 0 requests, shutdown completed, no hang. Whether the owned MessageBox is dismissed or left orphaned can only be seen on WPF. Add it to H4 step 7(j).
- N-b, CardReviewRound1Tests.cs:404–416. `App_Settings_and_Exit_use_the_card_guards` only checks that certain source strings appear. That is acceptable without WPF, but it is brittle and is not runtime proof of the App wiring.
- N-c, provenance. The changelog's mutation results (lines ~155, 241, 316) are worker-run and self-reported. I did not re-run them. My verdict rests on the probes below, not on mutation counts.

B1 (settings change during confirmation or retry): resolved
How the fix works:
- Token version (Secrets.cs:53, 84): a counter goes up on every Save and Clear, inside the same lock as the file write. Reads take that lock too, so a version and the token file always match. It only ever increases within a run, and it is in memory, which is enough because the controller lives for one run.
- Before the confirmation: the token version is read at CardSyncController.cs:339.
- After the confirmation: the address is re-read and compared (CardSyncController.cs:373), and so is the token version (:379), under the lock. A drift means nothing is sent.
- Before every attempt: `BoundToken.Check` (:481–499) runs immediately before and after reading the credential on each attempt, so Core's retries are covered.
- Settings notifies the real controller: `SettingsCommit` always calls `ConfigurationChanged` in a `finally`, even if a step fails part-way (SettingsCommit.cs:22). `ConfigurationChanged` (:228) cancels the in-flight send outside the lock.
- An address change cancels the scan. A token-only change keeps it for a freshly confirmed resend (auth repair).
- Uncertainty is stated honestly: "a request already received by the server cannot be undone". The design never claims the client can undo a received request.

Inherited round-1 probes, re-run against this candidate:
- P1: Stale, 0 requests.
- P1b: Stale, requests = a.example.test with the OLD secret only.
- P2: Stale, the single first attempt to A with the OLD secret.
- P3: Stale, 0 requests.

Fresh probes (ReviewProbesR2):
- F1, A→B+token→A+new token while the modal is open, through the real SettingsCommit: Stale, the scan is cancelled, 0 requests.
- F2, address-only A→B→A that silently returns to the original settings: Synced to A with the OLD token. The configuration ended up consistent, and no new credential went to A.
- F3, A→B→A with tokens during the retry delay: Stale, exactly 1 request (A, OLD token), web list marked UNKNOWN, scan cancelled.
- F4, 150 races of a concurrent token Save against the send, run 3 times: newTokenNotConfirmed = 0 every run. The new token appeared on the wire only when it was saved before the prompt (9 cases, which is correct), and no single send ever mixed tokens across its attempts.
- F5, first scan started with no destination: NotConfigured. After configuring A the scan is kept. A→B during the modal gives Stale. The re-confirmed resend went to B with B's token. Nothing reached A.
- F6, transport that ignores cancellation, Settings changed mid-request, then a late 200:
  - Same address: Stale, no lastSync recorded, UNKNOWN set, scan kept.
  - Moved address: Stale, scan cancelled, UNKNOWN not carried over to B.
  - Both cases: exactly 1 request.
- F7, auth repair: 503 then 403 gives AuthRequired with UNKNOWN set (an earlier attempt may have landed). After a token-only repair, the re-confirmed resend is Synced with the new token on A and UNKNOWN clears.

B2 (transient capture error after the same still frame): resolved
CaptureNoticeStatus.cs:65 now clears the transient error on every event except Unsupported and Failed. This is consistent with CapturePipeline.cs:105–115: geometry is validated before the frame gate, and a paused pipeline returns Failed before it looks at the frame.
- F11, event matrix: Unsupported and Failed keep the error; Progress, NotUploadable, Ignored, CardScreen, Skipped, Queued, AlreadyQueued and Limit clear it.
- F12, real pipeline: Progress, then a 1920×1200 frame (Unsupported, error set), then the identical frame three times (Skipped ×3) leaves no error.
- Inherited P8a: Skipped ×4, tray = Capturing. P7 and P8b: error cleared.
- The worker's test `A_skipped_frame_clears_only_the_transient_error_never_a_durable_notice` passes: the unsaved and overflow durable notices persist.

S1 (drop confirmations): resolved
Reset, Cancel and BeginScanReplacing now require the same scan and the same revision (`SameAsSeenLocked`, :167). The window asks with the current view and reports "changed while asking" if it moved (CardSyncWindow.cs:48–81).
- Inherited P4: the 5-card answer is refused when 8 cards exist.
- F8: evidence that conflicts but keeps the same count (level change, revision 1→2, 5 conflicts) is refused by Reset, Cancel and Start.

S2 (remote list state): resolved
A failure, a bad ACK, a stale 200, or a stopped send that already read the credential now marks the web list UNKNOWN for the still-configured destination. The last ACK is kept, labelled "historical only".
- Inherited P5: Stale, lastSync null.
- Inherited P10: Failed, with the historical 8-card line.

S3 (initial scan binding): resolved
A scan is bound to its destination at BeginScan. An unconfigured scan adopts the address once, at its first confirmed send. Runbook §3a.9 matches this.

N1 (Exit vs sends): resolved
The Exit hold blocks the start of a send (:308), and a confirmation answered while Exit is open (:372). The window buttons are disabled while it is held. Disposing the hold is idempotent and uses `using`, so a failing Exit cannot leave it permanent.
- F10: an exception thrown inside nested holds releases them; the send then Syncs.
- F9: Exit and shutdown during the confirmation give Cancelled, 0 requests, no deadlock.
- The Exit text distinguishes "waiting for confirmation, nothing sent" from "being sent" (worker's N1 test passes).

Preserved from round 1 (inherited probes)
- One send in flight. P6: 200 shutdown-vs-send races with no request lacking a result, no hang.
- P11: cancel and reset during a send give Stale with 1 request.
- P9: retention stays at Sessions 1, Frames 1.
- Core revision and snapshot authority is unchanged, and Core itself is not touched.

Checklist (85 §3)
1. Spec conformance: OK. The T10 r3 S1 done-when item now holds.
2. Correctness: OK, per B1/B2/S1–S3/N1 above.
3. Test quality: OK. The 510-line regression file uses real Core types, the real pipeline with a primed frame gate, the real ServiceTokenStore and SettingsCommit. The App wiring is a static check (N-b).
4. Fabrication: none found. Native and live checks stay labelled not run.
5. Security: OK. No new credential reached the old host in any probe, and no secret appears in logs or messages (asserted).
6. Free tier: not affected.
7. Scope: OK. 0 files under Core, Core tests, fixtures, layouts, apps, packages, reference, specs or OPEN_QUESTIONS.
8. Maintainability and docs: OK. Runbook §3a.6–9, troubleshooting and H4 7(h)–(j) match the behaviour.

Commands (system SDK; D8 = /Users/willjose/.hermes/cache/scratch/T10-review/dotnet8/dotnet)
```
$ dotnet --version
10.0.103
$ dotnet build agent/Uma.Agent.sln -c Release -p:EnableWindowsTargeting=true --no-incremental
Core, Windows (net8.0-windows10.0.19041.0), Core.Tests, Portable.Tests, Windows.Tests (Native) built; 0 Warning(s) 0 Error(s)
$ dotnet test agent/tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj -c Release --no-build -- RunConfiguration.DotNetHostPath=$D8
Passed! - Failed: 0, Passed: 302, Total: 302
$ dotnet test agent/tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release --no-build -- RunConfiguration.DotNetHostPath=$D8   (candidate, before adding probes)
Passed! - Failed: 0, Passed: 225, Total: 225
$ dotnet test ... --filter FullyQualifiedName~ReviewProbes   (inherited + fresh)
all pass after the F4 measurement fix; outputs as quoted above
$ EdgeProbe (built with 0 Warning(s) 0 Error(s); run with $D8 against the scratch repo root)
... MESSAGE ArgumentException reflects marker=False; ASSERTIONS passed
$ git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check a2ae378 HEAD
(no output) exit 0
```

About the F4 fix: its first version counted a token that was saved before the prompt opened as a violation. That is legitimate, because the user confirmed with that token current, and it produced "Actual: 6". I changed only how the probe classifies requests, not the candidate, and three re-runs gave 0 violations.

Probes (runnable, scratch only)
- Fresh: /Users/willjose/.hermes/cache/scratch/T10b-review-r2/repo/agent/tests/Uma.Agent.Windows.Tests/Portable/ReviewProbesR2.cs (F1–F12).
- Inherited: ReviewProbesR1Inherited.cs in the same folder, a renamed copy of the round-1 ReviewProbes.cs. The original at T10b-review-r1 is unchanged.
- Full probe log: /Users/willjose/.hermes/cache/scratch/T10b-review-r2/probes.log

Not verified on this Mac
WPF tray and modal reentrancy (including N-a), WGC, Windows OCR, DPAPI, the single-file executable, the 5 native tests (compiled only, not run), and a live Access-protected PUT. These remain H4 (runbook §6 step 7 (a)–(j)) and H2. T10b status should stay Partial until they are done.

session_id: 20261007_053143_a7e22f
