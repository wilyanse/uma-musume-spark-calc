## Verdict: PASS

Fresh independent focused review of a2dca38deae1e0f6d4ef0fef1b0ff14798b5a045 on task/T09-agent-core, diff 22a72a6..HEAD.

SF1–SF4 are resolved. No additional blocking regression found in the focused delta or adjacent migration, authentication, acknowledgement, crop-dependency and enqueue-concurrency paths.

Read the full coordinator round-2 report and fix prompt from the main checkout, where those files reside, the worker changelog including Review round2, and the governing contracts/policy. Verification below is my own execution; I did not invoke or rely on the worker-spawned verifier.

HEAD and tracked/untracked worktree cleanliness were verified before and after. No tracked edits, commits, merges, pushes, deployment, credentials access or global configuration changes.

PASS is not H4/M2 completion or merge authority.

## Blocking

None.

## Should fix

None remaining from SF1–SF4 within this focused scope.

### SF1 — resolved

agent/src/Uma.Agent.Core/Session.cs:21–29,113–135

ContentMap.Add is internal. Both session maps expose only public diagnostic getters; coverage properties have private setters. Rows is rebuilt through ReadingOrder into a new array, and Extra is a distinct/sorted snapshot. Neither exposes the backing coverage collections.

My independent probe enumerated both maps’ public surfaces and modified a returned Rows snapshot. Session coverage remained unchanged, and the real fixture collection remained incomplete and diagnostic-only.

The supported state-changing path is CaptureSession.Add(ParsedFrame). Public ParsedFrame and nested evidence remain caller-controlled; synthetic evidence can deliberately represent complete coverage. That is the documented boundary, not a newly imposed hostile-same-process security requirement.

### SF2 — resolved

agent/src/Uma.Agent.Core/Outbox.cs:199–214,251–256

The saved payload/crop hash is compared before both duplicate-return branches. A changed sealed capture cannot be silently swallowed after acknowledgement.

The repository regression covers genuinely reassembled changed veteran content, pending and acknowledged states, and exact duplicates. My additional independent probes challenged:

- Changed agent metadata with the same veteran fingerprint: rejected pending and acknowledged, including after restart.
- Different crop bytes in a freshly assembler-sealed result, with identical capture JSON: rejected pending and acknowledged, including after restart.
- Independently reassembled exact duplicates: AlreadyQueued or AlreadyUploaded as appropriate.
- Existing queued row/retry state: unchanged by rejection or duplicate enqueue.

The guard protects the complete queued payload identity, not just the veteran fingerprint.

### SF3 — resolved

agent/src/Uma.Agent.Core/Frames.cs:22–24,84–89  
agent/src/Uma.Agent.Core/Parsers.cs:127–500  
agent/src/Uma.Agent.Core/Screens.cs:63–65

All ten public frame-taking FrameParser primitives other than ParseAsync guard exact 1920×1080 at entry:

HeaderAsync, SkillsAsync, SparksAsync, DeckAsync, ParentsAsync, CareerAsync, HeldAsync, ListTilesAsync, DetailAsync and static HashMatch.

ActiveTabs is guarded too. ParseAsync and ClassifyAsync retain normalization before calibrated reading.

My independent probe used empty pixel buffers at raw 1280×720, 1600×900 and 2560×1440. All 33 primitive/classifier cases returned NonReferenceFrameException with zero OCR calls. Empty buffers additionally establish that pixel access did not precede refusal.

Native and synthetic oversized ParseAsync regressions passed, including deck/list/detail values and card/LB comparisons. No calibration threshold changed. T11 guidance explicitly requires normalized frames and reference-space OCR coordinates.

Generic frame/crop/hash/template utilities are not raw-client screen-parser entrypoints; this review does not extend their contracts into automatic normalization.

### SF4 — resolved

agent/src/Uma.Agent.Core/Outbox.cs:216–230  
docs/changelog/T09-agent-core.md:318–321

Within the immediate enqueue transaction, an existing outbox group without a captures identity is rejected before inserting a hash or new crop. No identity is guessed or backfilled.

The regression verifies legacy payload bytes, row identity, attempts, error and due time remain unchanged for both exact and different submissions, with no captures/crop_results additions. It also exercises explicit whole-group discard followed by recapture.

My independent probe additionally finished the existing legacy veteran through UploadClient and a valid acknowledgement. Upload succeeded; the old captureId remained fail-closed after restart because no verified original payload hash exists.

Recovery is explicit: pause and back up the database; finish the existing group unchanged, or deliberately mark an item dead and discard its whole group before recapturing. After finishing a legacy group, use a fresh captureId. The delta introduces no automatic overwrite or deletion; pre-existing duplicate migration semantics remain unchanged.

## Nits

- Outbox.cs:403–418 — HTML without Content-Type remains Retrying/unexpected-response rather than AuthRequired/auth-login-page. It does not complete or delete the upload. This is the retained, documented nonblocking classification limitation.
- Session.cs:90–99 — mutable capture/crop/checklist collections are covered by the integrity seal; cosmetic SectionStatus.Detail is intentionally excluded. The added mutation regression passed. The seal is not a cryptographic trust boundary or an immutable snapshot against concurrent same-process mutation.
- docs/changelog/T09-agent-core.md:161–171,327 — all six art-only deck cardIds remain explicitly unverified at H4. Windows OCR, actual game rendering and real Access behaviour remain unverified. This delta does not resolve those uncertainties.

## Checklist

1. Spec conformance: PASS for the focused delta. Shared capture fields, validation, fingerprint and acknowledgement contracts remain unchanged. Q-93 diagnostic assembly and Q-94 sub-reference refusal remain explicit approved deviations; H4/M2 remain open.

2. Correctness: PASS. SF1–SF4 were independently challenged. Adjacent crop-before-veteran dependency, dead-letter recovery, migration, restart, atomic rollback and concurrent enqueue regressions passed. The changes do not alter upload scheduling or acknowledgement parsing.

3. Test quality: PASS. Read retained red evidence showing 38 tests: 2 passed, 36 assertion failures. Final independent native suite passed 166/166, including the additional seal mutation test. Synthetic coverage/resampling is labelled honestly. My separate probes add empty-buffer early-refusal, same-fingerprint metadata conflict, resealed crop conflict and legacy finish-existing assertions.

4. Fabrication check: PASS for the delta. No labels, OCR recordings, templates, master data, game constants or production fixture answers were added or changed. Reproduced accuracy was 747/747; fallback was 744/747 with no confident-wrong values. No fresh visual revalidation of unchanged labels is claimed.

5. Security: PASS for the delta. New SQL values are parameterized; immediate transactions serialize identity checks and writes. Existing auth failure, redirect handling, strict acknowledgement, sensitive-response nonpersistence and crop attachment tests passed. No credentials accessed or requested.

6. Free-tier constraints: Unaffected. Local SQLite/parser changes add no cloud service, paid feature or new Worker/D1 request path.

7. Scope: PASS. Seven changed files total: five production core files, one regression test file and the changelog. No shared-contract/spec, master-data or evidence edits. No master refresh or pnpm recursive build.

8. Maintainability: PASS. One dimension guard is reused across the calibrated public surface; typed errors give actionable normalization guidance. Identity rejection is ordered clearly before duplicate returns. Dependencies are unchanged.

## Commands run

Worktree: /Users/willjose/Projects/personal/uma-musume-spark-calc.worktrees/T09-agent-core

$ git status --short; git rev-parse HEAD
    [status empty]
    a2dca38deae1e0f6d4ef0fef1b0ff14798b5a045

From agent/, with TMPDIR=/Users/willjose/.hermes/cache/scratch/t09-final-focused:

$ dotnet build Uma.Agent.sln
    Build succeeded.
    0 Warning(s)
    0 Error(s)
    exit 0

$ dotnet test Uma.Agent.sln --no-build --logger 'console;verbosity=normal' -- RunConfiguration.DotNetHostPath=/private/var/folders/k3/6ph2csn113x6w4jq66qjms1r0000gn/T/dotnet8/dotnet
    Test Run Successful.
    Total tests: 166
         Passed: 166
    exit 0

Read the resulting accuracy-report.txt:
    overall: 747/747 = 100.00%
    wrong but confident (silent errors): 0
    correct but flagged low_confidence: 3
    stats 40/40; stars 120/120; LB 26/26

$ dotnet test Uma.Agent.sln --no-build --filter FullyQualifiedName~Full_frame_replay_accuracy --logger 'console;verbosity=detailed' -- RunConfiguration.DotNetHostPath=/private/var/folders/k3/6ph2csn113x6w4jq66qjms1r0000gn/T/dotnet8/dotnet
    overall: 744/747 = 99.60%
    wrong but confident (silent errors): 0
    correct but flagged low_confidence: 5
    Same three incorrect level readings, all confident=False.
    Total tests: 1
         Passed: 1
    exit 0

From scratch/t09-final-focused/probe/:

$ dotnet build Probe.csproj -o out
    Build succeeded.
    0 Warning(s)
    0 Error(s)
    exit 0

$ /private/var/folders/k3/6ph2csn113x6w4jq66qjms1r0000gn/T/dotnet8/dotnet out/Probe.dll
    SF1 Rows snapshot edits leave coverage unchanged; real session diagnostic-only
    SF3 empty-buffer typed refusals=33; OCR calls=0
    SF2 restart acknowledged=False: changed metadata SAME fingerprint rejected; exact duplicate=AlreadyQueued; state preserved
    SF2 restart acknowledged=True: changed metadata SAME fingerprint rejected; exact duplicate=AlreadyUploaded; state preserved
    SF2 changed resealed crop bytes rejected pending/acknowledged/restart; exact crop duplicate accepted
    SF4 legacy exact/different refused; payload/retries/hash/crops unchanged; finish-existing via uploader succeeds; old ID fail-closed after restart
    Independent assertions completed
    exit 0

The initial scratch probe build had a reviewer-only CS0136 variable-name collision; corrected in scratch and rerun successfully. Initial failure and final outputs are retained.

$ git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check 22a72a6..HEAD
    [empty]
    exit 0

$ git status --porcelain=v1 -uall; git rev-parse HEAD; git branch --show-current
    [status empty]
    a2dca38deae1e0f6d4ef0fef1b0ff14798b5a045
    task/T09-agent-core

Independent source, build/test/probe outputs and final Git command records:
    /Users/willjose/.hermes/cache/scratch/t09-final-focused/

Original t09r2/probe/ and worker t09fix-r2/ artifacts were read-only.

session_id: 20261004_004900_9ca28a
