↻ Resumed session 20261006_200307_ef3cd1 "T10 windows-shell round 2 read-only review" (2 user messages, 34 total messages)
Verdict: CHANGES_REQUESTED

Candidate: 8e0f2451dc6195e4cb5750914b5bab60998869c4
Branch: task/T10-windows-shell
Focused diff: 204de2d..HEAD

Provenance: resumed the same read-only review under the user-approved Sol medium fallback. Earlier source inspection and r2 build/test logs were inherited from the interrupted review; the results reported below were freshly rerun during this continuation. No workers, model CLIs, delegation or orchestration scripts were used.

The worktree was clean at continuation start and review end, with unchanged HEAD. No tracked edits, commits, merges, pushes, deployments, credentials or global configuration changes were made. The parent should save this report.

Blocking

[B1] agent/src/Uma.Agent.Windows/Portable/CapturePipeline.cs:160–171,225–240 — failed enqueue results remain unbounded while capture continues.

The normal frame-retention problem is substantially fixed, but the failure path still has no bound or backpressure. Every completed veteran is sealed and appended to _pending when SQLite enqueue fails. Processing then continues collecting subsequent veterans. MaxLiveSessions and MaxFramesPerSession do not limit those sealed captures and their PNGs.

Independent real-Core probe, with the scratch outbox deliberately made unavailable:

    After 21 veterans:
      Sessions 1, Frames 7, SealedPending 20
      Retained PNG bytes 1,495,160
      Managed heap delta +63.204 MB

    After 41 veterans:
      Sessions 1, Frames 7, SealedPending 40
      Retained PNG bytes 2,990,320
      Managed heap delta +67.509 MB

These are actual retained sealed results, not inferred frame counts. There is no terminating condition in this path. The runbook’s general “memory is bounded within one watch” claim therefore exceeds what the implementation guarantees.

Required fix:
  Pause/refuse further collection when durable enqueue fails, or enforce a bounded sealed-pending capacity with backpressure before accepting additional veterans. Preserve every existing sealed result exactly; do not evict unsaved complete captures. Keep the failure visible until successful retry. Update the bound documentation and add a repeated-enqueue-failure behavioral test.

Positive result: repairing the outbox and retrying did preserve all 40 failed capture IDs, exact serialized capture payload bytes and exact PNG bytes. The retry implementation itself is sound.

[B2] agent/src/Uma.Agent.Windows/Portable/CapturePipeline.cs:178–197,216–226 — the 40-view limit can retain a stale “complete” checklist and upload despite rejected evidence that Core would mark incomplete.

At the limit, a new distinct parsed frame is discarded before Core sees it. No persistent overflow/incomplete state is attached to the collection. Finalize subsequently assembles the earlier evidence and can enqueue it as complete.

Independent comparison against an unmodified real Core coordinator receiving the same evidence:

    LIMIT rejected new unaligned Skills:
      event=Limit
      retained Sessions=1, Frames=40
      shellSkillsComplete=True
      CoreSkillsComplete=False

    LIMIT Stop=Queued
    outboxVeterans=1

The probe used real parsed fixture evidence, the explicitly synthetic whole-list Skills thumb used by the existing completion tests, and a synthetic new unaligned Skills view after reaching 40 retained views. This is a behavioral divergence, not a reflection/count-only assertion.

Required fix:
  Once distinct evidence is rejected because of the cap, fail closed for that collection: persist an overflow/blocker state and refuse finalization/upload until explicit recovery or fresh collection. Alternatively, implement a bounded evidence strategy that preserves Core’s checklist semantics. Do not equate “previously complete” with “complete after ignoring new evidence.” Add a regression asserting that Stop cannot enqueue this scenario.

Should fix

[S1] agent/src/Uma.Agent.Windows/App.cs:182 and Portable/CapturePipeline.cs:181,196 — actionable limit/failure notices are transient or masked.

Every subsequent Skipped/Progress event replaces _notice and clears _error. An unchanged frame can therefore erase the limit or unsaved-capture error on the next poll. Feed also returns finalized in preference to limit, hiding a simultaneous limit event. Eviction does produce a persisted warning log, but per-veteran overflow has no corresponding persistent warning/state.

Keep unsaved-capture failures, evidence-limit blockers and released-collection notices separately from routine frame progress. Clear them through explicit recovery/acknowledgement, not an unchanged poll. Add a portable status-reducer test; WPF execution remains H4.

[S2] agent/src/Uma.Agent.Windows/Portable/UserMessages.cs:13–14 — the typed-message allowlist includes every ArgumentException.

ArgumentException is a framework-wide type, not proof that its message is shell-owned or safe. The new unhandled UI handler also uses this helper.

Fresh probe:

    MESSAGE ArgumentException reflects marker=True

The marker was synthetic; no real secret was used. Logs still record categories only. Narrow this to shell-owned validation exceptions or explicitly constructed safe messages, and category-filter arbitrary ArgumentException instances. Add the sensitive-marker case to the tests.

Nits

[N1] agent/src/Uma.Agent.Windows/Portable/OcrTiling.cs:10–11 and docs/runbooks/agent-install.md:66 — the longest recorded line is attributed to fixture 13 incorrectly.

The actual 493-reference-pixel line is in 14-support-card-detail.json:

    Increases initial Friendship Gauge when beginning a Career

Fixture 13 remains the relevant old-seam regression. Correct the attribution; the 600-pixel overlap choice itself is unaffected.

Round-1 fixes and additional checks

B1 normal capture path:
  Fresh execution reproduced the idle/cosmetic dedup and per-veteran frame release improvements:
    Still view, 240 fresh-array polls: processed 1, skipped 239, retained 1 frame; +11.1 MB, flat.
    Cosmetic pixel changes, 240 polls: processed 30, retained 1 frame; +8.3 MB, flat.
    Twenty synthetic veterans from real fixture evidence: +75.2 MB at veterans 5, 10, 15 and 20; 9 current frames.
    After Stop: 20 outbox veterans, 0 retained frames; +8.9 MB.
    Two sessions at the frame cap: 80 frames; measured +672.0 MB.

  These are Mac managed-heap measurements, not Windows RSS or Task Manager measurements. The 672 MB scenario measures bounded live-frame retention; it does not cover B1’s unbounded failed-enqueue accumulation.

Identity and evidence:
  Real 02/03 dHash-collision regression passed.
  Returning queued identity, queued-parent-popup guard, incomplete-veteran resume, parent-popup ownership and frame-release tests passed.
  Independent same-character/different-stat probe produced two sessions, matching Core; an ambiguous partial header was ignored by both.
  A synthetic epithet-only change stays within Core’s existing identity definition and is surfaced as /epithet low_confidence, not deduplicated away. This is Core-equivalent behavior, not proof of a stronger mode-based identity distinction.
  Independent missing-thumb → whole-list-thumb probe changed Skills completeness False → True and retained two evidence frames. Thumb/end evidence is included in the fingerprint.

S1/S5 capture drain and geometry:
  Portable tests and independent probe verified an eight-frame bounded drain, disposal of older frames and retention of the newest.
  Fresh source inspection confirmed geometry checks use that selected frame and surface-copy completion is awaited before disposal.
  Numeric diagnostics use fixed reasons and geometry values, not titles/tokens. The runbook includes the explicit H4 geometry check.
  Actual WGC execution was not performed.

S2 OCR:
  Fresh portable suite passed the actual fixture-line-geometry tests, including fixture 13, all-fixture whole-line ownership, native-dimension caps and synthetic long-line band reread.
  Independent tiled-recognizer cancellation probe propagated cancellation on call 2.
  Reference-coordinate mapping and await-before-bitmap-disposal were source-inspected.
  These are geometry/contract tests, not actual Windows OCR evidence.

S3 settings:
  Independent malformed-settings probe produced two unique backups at injected time, preserved the first backup, loaded defaults, refused uploads and exposed a notice.
  Token storage remains separate from settings; the recovery path does not decrypt or copy the DPAPI token into the backup.

S4:
  Start and Exit now use the same DropGuard rules. Unsaved complete captures refuse Start and prompt on Exit; incomplete collections prompt for both. Portable tests passed; actual WPF confirmations remain H4.

N1–N9:
  Own-PID exclusion, normalized destination comparison, control-character validation, unused-clock removal, truthful native-test names, category-only exception logging, cached health and serialized upload/token/recovery paths were inspected.
  Auth recovery, rejected-item recovery and in-flight upload cancellation tests passed.
  N3’s broad ArgumentException handling remains S2 above.
  Retained bundle tooling works. Historical expired evidence and nonreproducible EXE hashes are identified as such.
  The isolated .NET 8.0.31 host exists and was used.
  Five native tests compiled; none were executed.

Checklist 1–8

1. Spec conformance: issues B1/B2. Cross-target build, tray/source contracts, runbook and truthful T11-unavailable boundary are present. H4 remains pending.
2. Correctness: issues B1/B2; notice handling S1. Normal dedup, release, identity routing and exact retry checks passed.
3. Test quality: existing 166 Core and 149 portable tests pass and assert meaningful behavior. They miss repeated failed enqueues and complete-before-overflow invalidation; independent probes exposed both.
4. Fabrication: no invented game facts or fabricated Windows results found. Synthetic probe mutations and the synthetic Skills thumb are explicitly identified.
5. Security: HTTPS/no-redirect and separate DPAPI-token design remain intact; logs use categories. S2 needs a narrower safe-message boundary.
6. Free-tier constraints: no new service, paid product or cloud dependency introduced.
7. Scope: clean. No Core, Core-test, Cards, fixture, layout, master, app or TS-package changes against the task base. Both CRLF-aware diff checks passed.
8. Maintainability: retained probes are reproducible and dependencies remain pinned. Address the failure/overflow state model, S1/S2 and N1.

Commands and actual results

All project commands ran from:
  /Users/willjose/Projects/personal/uma-musume-spark-calc.worktrees/T10-windows-shell

Runtime discovery:

    /Users/willjose/.hermes/cache/scratch/T10-review/dotnet8/dotnet --list-runtimes
    Microsoft.NETCore.App 8.0.31

Fresh Release build:

    dotnet build agent/Uma.Agent.sln -c Release -p:EnableWindowsTargeting=true --no-incremental
    Build succeeded.
    0 Warning(s)
    0 Error(s)

Fresh tests, with DOTNET_ROOT set to the isolated runtime directory and this argument:

    -- RunConfiguration.DotNetHostPath=/Users/willjose/.hermes/cache/scratch/T10-review/dotnet8/dotnet

    dotnet test agent/tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj -c Release --no-build
    Passed: 166, Failed: 0, Skipped: 0

    dotnet test agent/tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release --no-build
    Passed: 149, Failed: 0, Skipped: 0

Retained memory tool:

    dotnet build agent/tests/Uma.Agent.Windows.Tests/Tools/MemoryProbe -c Release
    <isolated-host> agent/tests/Uma.Agent.Windows.Tests/Tools/MemoryProbe/bin/Release/net8.0/MemoryProbe.dll "$PWD"
    Exit 0; measured results above.

Independent scratch edge probe:

    dotnet build /Users/willjose/.hermes/cache/scratch/T10-review/r2/edge-probe/EdgeProbe.csproj -c Release
    <isolated-host> /Users/willjose/.hermes/cache/scratch/T10-review/r2/edge-probe/bin/Release/net8.0/EdgeProbe.dll "$PWD"
    Exit 0; reproduced B1/B2 and exact retry, identity, thumb, cancellation, settings and drain results above.

Fresh publish and retained bundle parser:

    dotnet publish agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableWindowsTargeting=true -o /Users/willjose/.hermes/cache/scratch/T10-review/r2/sol-publish

    python3 agent/tests/Uma.Agent.Windows.Tests/Tools/bundle_probe.py /Users/willjose/.hermes/cache/scratch/T10-review/r2/sol-publish/Uma.Agent.Windows.exe "$PWD"

    bundle 6 0 entries 474
    matches 15 of 15
    All seven listed key assemblies/native libraries present.
    EXE size: 193079608 bytes.
    Both commands exit 0.

Git checks:

    git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check 204de2d..HEAD
    git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check 08d4876..HEAD
    No output; exit 0.

    git status --porcelain=v1
    No output.

    git rev-parse HEAD
    8e0f2451dc6195e4cb5750914b5bab60998869c4

Evidence retained

  /Users/willjose/.hermes/cache/scratch/T10-review/r2/

Contains inherited logs separately from fresh sol-build/core/portable/memory/publish/bundle logs, the published bundle, and edge-probe source/build/output. The initial scratch-probe scaffolding compile error was corrected only in scratch; the final probe build and execution succeeded.

Windows WGC/OCR/DPAPI/WPF, native single-file launch and live Access/upload validation remain H4. T11 integration remains truthfully unavailable within the approved scope. Neither limitation was used as a substitute for the portable checks above.

session_id: 20261006_200307_ef3cd1
