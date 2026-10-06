↻ Resumed session 20261006_213237_8dfedb "Review T10 failed enqueue backpressure independently" (1 user message, 49 total messages)
Verdict: PASS

Candidate 5c1fc594291eda74a1af2b7cbca8ecfbcb82b12e on task/T10-windows-shell. I reviewed the focused diff 8e0f245..HEAD (23 files, +744/−49).

Provenance: this is one read-only review. It started under the approved Sol medium fallback, Sol hit its usage limit, and I resumed it in the same session on the restored Opus primary. The worktree was clean at the same HEAD at start, at the resume and at the end. I made no tracked edits, commits, merges, pushes or deploys, did not touch main or sibling worktrees, accessed no credentials and changed no global configuration. I ran no model CLI, orchestration script, delegate or spawn. My scratch probe and logs are in /Users/willjose/.hermes/cache/scratch/T10-review/finalfocusedr3/.

Inherited vs fresh: the round-2 review figures and the worker's "Review round 2" changelog outputs are inherited and are not repeated as evidence. Every result below comes from commands I ran in this review. Nothing native was run: WGC, Windows OCR, WPF, DPAPI and launching the single-file EXE all remain H4. The five native tests compile only.

Blocking
None.

Should fix (merge follow-ups, not blocking)

[S1] agent/src/Uma.Agent.Windows/App.cs:187–188 — transient capture errors no longer clear on their own.
- Before this round, the next event replaced `_error`, so a valid frame cleared it. Now `_error` is set when a frame is Unsupported or capture becomes unavailable, and only Stop or Start clears it.
- So after the user fixes a wrong-sized window, or after the game window reappears, the tray stays in Error and Capturing (n/3) is hidden, even though frames are being accepted again.
- This conflicts with the runbook §6.1 H4 step "resize from valid to below-reference/non16:9 then back". It loses no data and does not weaken the upload gate.
- Suggested fix: clear `_error` when a Progress, Queued or AlreadyQueued event arrives. Keep the persistent CaptureNoticeStatus errors as they are.

[S2] agent/src/Uma.Agent.Windows/Portable/CaptureNoticeStatus.cs:31 — routine text is stripped with `Replace` against the full notice messages.
- It works today because the notice copy is fixed shell text.
- It is fragile: any routine message that happens to contain a notice's text gets cut. A structured "primary message plus notices" would be safer.

Nits

[N1] OcrRecorder.cs:165–166: two of the new ShellValidationException messages are lower-case fragments ("options given without --record-ocr"). The other new messages read as full sentences. Cosmetic only.

[N2] MemoryBoundTests.cs:257, 286–291 and EdgeProbe/Program.cs:146–151 read the private `_pending` field by reflection.
- That is acceptable for a test or probe, but it breaks silently if the field is renamed.
- An internal accessor would be cleaner, though `InternalsVisibleTo` may not reach the probe, which compiles the portable sources directly.

Findings by review item

B1, durable-enqueue backpressure: resolved. Verified by fresh probe and by reading the source.
- Source: `ProcessAsync` (CapturePipeline.cs:101) refuses before any geometry, gate or OCR work. `Accept` (127) refuses too. The identity transition (171, 181, 187) refuses before feeding the new frame. `Finalize` (255) and `Flush` (296–306) never seal a second result.
- The cap is `MaxSealedPending = 1`. There is no hidden second holder: a live incomplete collection stays live and is not sealed.
- The fresh probe held a distinct incomplete veteran, then made the complete veteran's enqueue fail against a real unavailable SQLite path. It then tried 100 complete veterans on every screen, plus ProcessAsync, Flush and a cancelled ProcessAsync on each attempt.
  - Retention stayed constant at Sessions 1, Frames 1, SealedPending 1, and it was the same object every time.
  - OCR was called 0 times while paused.
  - The unsaved error could not be dismissed by acknowledgement or by starting fresh.
  - After repairing the outbox, one Flush queued exactly one capture with the same capture ID. The JSON and PNG bytes matched byte for byte, and no duplicate rows were written.
  - A second Flush queued nothing more.
  - The paused frame was re-read as fresh.
  - The earlier incomplete collection then completed and queued.
- A separate probe triggered the failure through ProcessAsync itself. The new identity was refused with 0 frames retained. Re-polling the same frame did not run OCR. After repair, that exact frame (which the gate had already seen) was parsed and accepted.

B2, overflow upload guard: resolved. Verified by fresh probe against an unmodified Core coordinator.
- The probe built a complete collection (3/3 tabs) of 40 views, then sent a new unaligned Skills view.
  - The pipeline returned a Limit event, and every displayed checklist section became incomplete. Core's Skills section also became incomplete.
  - Stop wrote 0 outbox rows.
- The blocker survives returning to the earlier identity, ProcessAsync polls, eviction (the overflowed identity is kept as a blocked record, so returning still yields Limit) and repeated Stop.
- A separate complete collection was still queued (1 veteran). Recovery requires an explicit fresh pipeline after Start confirmation; that rule is in the source and the runbook.

Evidence fingerprint: the fingerprint is not relaxed. In the probe these all stayed as separate retained frames:
- null thumb vs whole-list thumb
- a change to header epithet raw text
- a row's OCR confidence, candidates or crop box
- a parent's guest flag
- the Legacy heading position
- the popup guest trainer's raw text

Core completeness logic is untouched; there is no Core diff. The real fixture 02/03 dHash-collision test still passes in the portable suite.

S1 (round 2), persistent notices: resolved.
- Routine Skipped and Progress events do not erase the unsaved or overflow notices.
- When a capture is queued at the same moment as an overflow, the queued event still carries the overflow notice, so it stays visible.
- Acknowledgement clears only the released-collection warning, and a new release brings it back.
- Starting fresh refuses while a capture is unsaved, and Start only clears notices after the user confirms dropping the collection. Exit uses the same DropGuard.
- New issue found: the transient `_error` regression, filed as should-fix S1 above.

S2 (round 2), safe messages: resolved.
- I passed a synthetic marker containing control characters through ArgumentException, ArgumentNullException, ArgumentOutOfRangeException, IOException, HttpRequestException, AggregateException and InvalidOperationException. Every one displays as its category only.
- An unknown command option shows a fixed message that includes "--help" and does not echo the input.
- A token containing control characters gets a fixed "single-line" message.
- Credentials with surrounding whitespace are stored and read back exactly, with no trimming.
- `ShellValidationException` has an internal constructor. Startup, the UI dispatcher and the unhandled-exception handler all use `UserMessages.For`, and logs carry the category only.

N1 (round 2), longest line attribution: resolved.
- Scanning all fixture OCR files (661 lines), the longest is 493 px in 14-support-card-detail.json: "Increases initial Friendship Gauge when beginning a Career".
- The OcrTiling comment and the runbook now say fixture 14. The fixture-13 seam test is unchanged and passing.

Checklist 1–8
1. Spec conformance: ok. It cross-target builds, the runbook is complete, and status stays Partial until H4. The T11 support-card boundary is truthfully "unavailable"; T11 is merged on coordinator main but not on this task's base, so integration is still pending and there is no duplicate Cards code.
2. Correctness: ok apart from should-fix S1. B1 and B2 hold on every public entry point.
3. Test quality: ok. There are real behavioural tests (157 portable) plus the retained probes, and the worker's quoted numbers match my reruns. Minor: the reflection noted in N2.
4. Fabrication: ok. Synthetic mutations are labelled, no Windows results are claimed, and EXE hashes are described as per-publish only.
5. Security: ok. Messages are category-only, no secrets are in the repo, and there is no credential normalisation.
6. Free tier: ok. No new service.
7. Scope: ok. Nothing outside the Windows source/tests, the runbook and the T10 changelog changed. Paths under Core, Core tests, Cards, fixtures, layouts, apps, packages and docs/reference have 0 changes. Both CRLF-aware diff checks are clean.
8. Maintainability: ok. Dependencies stay pinned and the probes are reproducible from the repository. Notes are S2 and N2.

Commands and actual output (all run from the worktree root)

    $ git status --porcelain=v1; git rev-parse HEAD
    (empty) 5c1fc594291eda74a1af2b7cbca8ecfbcb82b12e      [same at start, resume and end]
    $ /Users/willjose/.hermes/cache/scratch/T10-review/dotnet8/dotnet --list-runtimes
    Microsoft.NETCore.App 8.0.31
    $ dotnet build agent/Uma.Agent.sln -c Release -p:EnableWindowsTargeting=true --no-incremental
    Build succeeded. 0 Warning(s) 0 Error(s)   (Core, Windows, Core.Tests, Portable.Tests, Native tests)
    $ DOTNET_ROOT=<dotnet8> dotnet test agent/tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj -c Release --no-build -- RunConfiguration.DotNetHostPath=<dotnet8>/dotnet
    Passed! Failed: 0, Passed: 166, Skipped: 0, Total: 166
    $ (same) agent/tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj
    Passed! Failed: 0, Passed: 157, Skipped: 0, Total: 157
    $ dotnet build Tools/EdgeProbe -c Release && <dotnet8>/dotnet .../EdgeProbe.dll "$PWD"
    LIMIT event=Limit; Frames=40; shellSkillsComplete=False; CoreSkillsComplete=False
    LIMIT Stop=NotUploadable; outboxVeterans=0
    QUEUEFAIL veterans=21; Sessions=0 Frames=0 SealedPending=1; managed+MB=9.529; distinctFailedIDs=1; failedEvents=140; retainedPngBytes=74758
    QUEUEFAIL veterans=41; ... managed+MB=9.533; distinctFailedIDs=1; failedEvents=280; retainedPngBytes=74758
    RETRY queued=1; oldCapturePayloadsExact=True; oldIDsPreserved=True; pending=0; oldCropBytesExact=True
    THUMB null->whole: complete=False->True; frames=2
    IDENTITY ... sessions=2; CoreSessions=2; ambiguousShell=Ignored; CoreIgnored=True
    MESSAGE ArgumentException reflects marker=False
    ASSERTIONS passed
    $ dotnet build Tools/MemoryProbe -c Release && <dotnet8>/dotnet .../MemoryProbe.dll "$PWD"
    A idle 240 polls: processed 1 skipped 239; Frames 1; +11.1 MB (flat 10–60 s)
    B cosmetic 240 polls: processed 30; Frames 1; +8.3 MB (flat)
    C 20 veterans: Frames 9, +75.3 MB at 5/10/15/20; after Stop: outbox 20, Frames 0, +8.9 MB
    D 2 x 60 distinct views: limit events 40; Sessions 2, Frames 80; +672.0 MB (bound 664 MB of frames)
    $ dotnet build <scratch>/finalfocusedr3/independent/Independent.csproj -c Release && <dotnet8>/dotnet .../Independent.dll "$PWD"
    B1 independent: 100 veterans + Accept/Process/Flush/cancel; bound 1 incomplete frame + 1 sealed; exact JSON/PNGs/ID once; retained collection completes; paused frame fresh PASS
    B1 Process-triggered identity transition: refused before collection, same gate-observed frame accepted fresh after repair PASS
    B2/S1 independent: complete40+unaligned Skills -> Stop0; return/eviction/polls sticky; combined Queue+Overflow visible; other capture saved PASS
    Fingerprint independent: ... retained distinctly PASS
    S2 independent: framework categories/control marker safe; owned option/token actionable; exact whitespace credentials preserved PASS
    INDEPENDENT ASSERTIONS=1346 PASS
    $ dotnet publish agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableWindowsTargeting=true -o <scratch>/finalfocusedr3/publish
    $ python3 agent/tests/Uma.Agent.Windows.Tests/Tools/bundle_probe.py <publish>/Uma.Agent.Windows.exe "$PWD"
    bundle 6 0 entries 474; matches 15 of 15; all 7 key assemblies/native libs True
    (the EXE SHA-256 printed is for this publish only and is not a reproducible identifier)
    $ python fixture OCR scan: longest line (493, '14-support-card-detail.json', 'Increases initial Friendship Gauge when beginning a Career'); 661 lines
    $ git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check 8e0f245..HEAD   -> exit 0, no output
    $ (same) 08d4876..HEAD                                                                                  -> exit 0, no output
    $ git diff --name-only 08d4876..HEAD -- <Core/Core.Tests/Cards/fixtures/layouts/apps/packages/docs/reference> | wc -l   -> 0
    $ git diff --name-only 8e0f245..HEAD outside Windows src/tests, runbook, T10 changelog | wc -l                          -> 0

Memory bounds: idle, cosmetic-dedup and 20-veteran runs stay flat. The worst case of 2 × 40 frames is about 672 MB of Mac managed heap, which matches the documented bound. The failed-enqueue path is now capped at one sealed result. These are Mac managed-heap figures, not Windows RSS; H4 must record Task Manager memory.

Still pending (truthfully): H4 on real Windows (WGC, English Windows OCR re-recording, DPAPI, WPF prompts, single-file launch, real Access/upload, ≥20-veteran import) and the T11 adapter integration. Status stays Partial. No blockers remain, so no parent takeover or escalation is needed. S1 and S2 should go into the changelog follow-ups at merge. The parent saves this report.

session_id: 20261006_213237_8dfedb
