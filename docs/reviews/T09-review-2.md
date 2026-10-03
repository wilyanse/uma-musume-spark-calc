## Verdict: PASS

Candidate 22a72a6f7ed2a088ad1122a8bade91baf8b848f2 on task/T09-agent-core. HEAD matches and the worktree is clean (`git status --porcelain=v1 -uall` prints nothing), both at the start and at the end of the review. I made no tracked edits, commits, merges or pushes.

I found nothing blocking. All of B1–B3, S1–S7 and N1–N3 are resolved, and I found no regression in neighbouring code. My own probes found four API-hardening gaps, listed under Should fix. None of them can be reached through the ordinary pipeline (FrameParser.ParseAsync → CaptureCoordinator.Feed → Assemble → EnqueueCapture → SendAsync). The coordinator may still choose to treat SF1 or SF2 as blocking.

PASS does not mean H4 or M2 is complete, and it does not authorise a merge or dispatching consumers. My evidence has three tiers:
- **Synthetic tests:** bicubic resampling, a forged whole-track thumb, edited readings, and fake HTTP handlers.
- **Apple Vision OCR replay** on the 15 real screenshots.
- **Not verified at all:** Windows OCR, real game rendering at any size, and real Cloudflare Access behaviour.

## Blocking
None.

## Should fix

- **[SF1] `Session.cs` (`public ContentMap<SkillRow> Skills` / `Sparks`) together with `ContentMap.Add(rows, frame, atTop, atEnd, estimate)`:** completeness can be faked through public API without any frame evidence.
  - Probe R1 takes the real 01–07+09+10 session, whose result is not uploadable, and calls `session.Skills.Add([], frame, true, true, 0)`. After that, `Assemble` seals the result and `Uploadable=True` with the 14-skill partial list.
  - The seal does catch changes made after assembly: R3 shows a flipped crop byte and an in-place edit to `Fields[0]` both turn `Uploadable` to False. What it cannot catch is a session whose state was forged before assembly.
  - A forged `ParsedFrame with { Thumb = whole track }` fed through `Feed` also comes out uploadable (R2). That case is acceptable, because `ParsedFrame` is a public record and the tests use exactly this, labelled SYNTHETIC.
  - Required fix: make `ContentMap.Add` internal, or expose read-only views (`Anchored`, `EndSeen`, `Rows`, `FramesRejected`) from the session, so the only way to record a scroll position is `CaptureSession.Add(ParsedFrame)`.

- **[SF2] `Outbox.cs` `EnqueueCapture`, around lines 262–266:** once a capture is uploaded, a changed payload under the same captureId is silently swallowed.
  - The `veteran_id IS NOT NULL` check runs before the payload hash comparison. R4: a second capture, sealed and with a different `wit`, reusing an uploaded captureId returns `AlreadyUploaded` and is never sent.
  - This contradicts the method's own doc ("a different payload under the same captureId is refused") and the audit item for this round.
  - The stored `payload_sha` survives (`CompleteVeteran` only updates `veteran_id`), so the fix is to compare the hash first and throw `InvalidDataException` on a mismatch, then add a test.

- **[SF3] `Parsers.cs:435,443,470` (also the public `DeckAsync`):** these primitives skip `Frames.Normalize`.
  - The changelog hands `HeldAsync`, `ListTilesAsync` and `DetailAsync` to T11 for reuse, but they never normalise the frame. This predates this round and also affects sizes above 1920×1080.
  - R7, on 13 resampled to 1280×720: `ListTilesAsync` returns 20 LB readings, all marked confident, with values `0,0,0,…,1,1,0…` against the native `2,4,4,4,4,0,0,1,0,4,…`. `DeckAsync` on 05 at 1280: LB `0×6` and borrowed `False×6`, all confident.
  - `ParseAsync` refuses these frames correctly, so the ordinary path is safe, but these entry points are the same B2 failure class.
  - Required fix: make them throw unless the frame is already exactly 1920×1080, or make them internal and point T11 at `ParseAsync`.

- **[SF4] `Outbox.cs` constructor migration and legacy rows:** a pending veteran row from round 0 has no `captures` row.
  - R4: enqueueing different sealed content under that captureId returns `Queued`. `INSERT OR IGNORE` keeps the old veteran payload but adds the new crops. Rows: `veteran:3, crop:0`.
  - Low impact, since round-0 databases only exist in development. Fix by backfilling `captures` during migration, or by refusing when an outbox row exists without a `captures` row.

## Nits

- `UploadClient` accepts `application/problem+json` and `text/plain` bodies as long as they parse to the strict acknowledgement shape (R6). That is harmless, because the strict schema, the ULID check and the status/created agreement still apply.
- An HTML 200 response with no Content-Type is classed `unexpected-response` rather than `auth-login-page`. It still never deletes the row, so the only effect is that the tray state differs.
- `CaptureResult.Checklist` and `Crops` are mutable `List<>`s behind `IReadOnlyList`. The seal covers everything except `SectionStatus.Detail`, which is cosmetic.
- Deck tiles 3, 5 and 6 are matched to cards by art only. My vision check of tile 5 (main figure has black hair, a red bow and a red scarf) cannot confirm `card:dazzling-day-in-the-snow-marvelous-sunday`. This is correctly listed under H4 step 2; please keep it emphasised there.

## Per-item resolution

- **B1: resolved.**
  - `AtTop(null)` and `AtEnd(null)` now return false (`Vision.cs:814-815`).
  - The checklist requires `FramesRejected == 0`, 6/6 deck tiles and 2/2 parents. `Assemble` errors when `!Skills.Anchored`.
  - `Uploadable` requires the seal plus a fully complete checklist. `EnqueueCapture` throws `IncompleteCaptureException` before writing anything.
  - Probes: real 01–07 has blocker `details.skills: 14 skills; top seen, end not reached` but still produces a valid capture (diagnostic only, R9). An unaligned 04 keeps the section incomplete. A parent block made unreadable after full coverage is uploadable with only `/sparks/parent2` (tested).
  - The only "complete" collection is the named SYNTHETIC whole-track thumb. It is never presented as screenshot evidence, and the real 01 is always tested as incomplete.
  - Remaining gap: SF1.
- **B2: resolved for the ordinary path.**
  - `Frames.Normalize` throws `UnsupportedResolutionException` before classification. Both `FrameParser` and `ScreenClassifier` call it.
  - At 2560×1440 the result is identical to native (sparks in the test; LB and cards for 13 in R7). 3840×2160 is accepted. 1920×1200 and 1280×800 are rejected as non-16:9.
  - No thresholds changed.
  - Q-94 is recorded under "Deviations from spec", with future calibration on real captures and no claim of spec compliance. It is a coordinator-approved deviation pending real calibration.
  - Remaining gap: SF3.
- **B3: resolved.** I checked against the actual API code.
  - `veterans.ts:160` returns `c.json(body, created ? 201 : 200)`. `IngestResponse` is a strict object `{veteranId: Ulid, created, reviewItemIds?: Ulid[]}`, using the same ULID regex as `primitives.ts:21`. `crops.ts:42` returns `{cropKey}` with status 200.
  - R6 matrix:
    - Accepted: 201 with `created:true`; 201 with `reviewItemIds: []`.
    - Retried, row kept: 200 with `created:true`, an extra key, a lowercase ULID, `[]`, `null`, a body that isn't JSON at all, and 500.
    - Dead-lettered (Rejected): 418 and 422.
    - `AuthRequired`, never dead-lettered: 301, 308, a followed redirect ending off-origin, and HTML 200.
  - Backoff is capped at 1 h. `Health().AuthRequired` is exposed. `RetryAuthNow` exists, and `ClearAuth` runs on success. `CreateHandler().AllowAutoRedirect` is False.
  - Only error categories are persisted. The test greps the database file for the body, nonce, host and secret.
  - Requeue and Discard: `Requeue(unknown)` returns false and `Discard` on a non-dead row returns 0. Discard removes the whole capture group (rows, `crop_results`, and the `captures` row while pending).
  - Race R5: discarding a dead crop while another crop is in flight, then a late `CompleteCrop`, then re-enqueue. The result is `crop:/sparks/3, veteran`. The crop the server already saved is not re-sent, and no veteran is ever sent without its crops (`Next()` dependency).
  - A cancellation through `ct` rethrows without touching the row.
- **S1: resolved.** An unreadable parent label drops the block with only `/sparks/<owner>` and no leaf error. An unreadable self label is fatal.
- **S2: resolved.** The field value equals the clamped payload, and candidates are {1,2,3} plus a crop. Probe P7 (worker's adaptation of the round-1 probe) shows value 1 = payload 1.
- **S3: resolved, except SF2 and SF4.**
  - Unique index on `IFNULL(path, '')`. The migration keeps the oldest duplicate row and its attempts.
  - Enqueue runs inside `BEGIN IMMEDIATE`. In the 8-way concurrent test one call inserts and seven return AlreadyQueued.
  - A crash mid-enqueue rolls back, so there is no transient partial queue.
  - Enqueuing the same content again leaves retry state unchanged. A changed payload while still pending is refused.
- **S4: resolved.**
  - Independent vision on the 05 tiles: 1 (orange hair, ear ornament, green robe) matches Matikanefukukitaru; 2 (long brown hair, white knit top) matches Super Creek; 4 (messy brown hair, oversized sleeves, light trails) matches Agnes Tachyon. Tiles 3 and 6 are group art and 5 is not confidently identifiable, so null is honest.
  - 13 tile 0 shows a guts flame icon, SSR, Lvl 40 and Special Week art. That matches 14: "[The Brightest Star in Japan!] Special Week", Lvl 40/40, guts.
  - No titles were invented. The test checks that the art match equals the title+name resolution, both confident.
  - H4 step 2 lists all six cardIds with the art-only caveat.
- **S5: resolved.**
  - Routing uses the confident outfit, character and rating plus the 5 stats. A noisy header continues only the current session, is ignored after leaving the screen (`AmbiguousIdentity`), and a returning veteran resumes the right session.
  - R8 confirms continuity by design: a header with every stat unreadable joins the session it immediately follows.
- **S6: resolved.**
  - New assertions: 16 scroll fields and 15 absence fields (7 popup/card headers, 3 career rows on 05, 5 on 07).
  - The mutation test fails on a wrong `atEnd`, a phantom career row, a stray header and a swapped deck character.
  - The retained `red-comparer.txt` shows it failing against the old comparer.
- **S7: resolved.**
  - `/parents/i/outfitId` is now `low_confidence` with confidence 0, a null value and the portrait crop. The guest trainer also gets a crop.
  - The pointer resolves to the null leaf. The API's `locate` uses `Object.hasOwn`, and `correctionTarget` passes it (not an array, not a fixed leaf).
- **N1: done** (comment plus the `Canonical_inputs_need_no_escaping` test).
- **N2: kept at 10.0.3** (it has a net8 lib).
- **N3: retained.**
- **Q-93 and Q-94** are correctly recorded. Q-93 covers the §10 diagnostic assembly versus the §5 upload rule and the missing contract flag, with no change to the shared contract: the diff touches only `agent/**`, `OPEN_QUESTIONS.md` and the changelog. Neither ID is used in other worktrees.
- **Denominator:** 711 → 747 is +36 = absence 15 + scroll 16 + cardVisible 5 (three deck characters plus 13 tile 0's type and character). Every pre-existing category total is unchanged, so this is not denominator gaming.
- **Tests first:** `t09fix/red-round1-stubs.txt` shows Total 123, Passed 86, Failed 37, across 26 distinct test methods (some are theories). The failures are assertion failures, not compile errors.

## Checklist

1. **Spec conformance:** met. The §2 and §5 deviations are explicit (Q-94, Q-93), and fixtures 01–07 still pass the §10 acceptance as a diagnostic capture.
2. **Correctness:** met on the ordinary path. SF2 and SF4 are edge cases in enqueue idempotency.
3. **Test quality:** real red/green evidence, mutation-checked comparer, and synthetic inputs labelled as such. Gaps: no test for the public-API bypass (SF1), for post-upload changed content (SF2), or for primitives on raw frames (SF3).
4. **Fabrication:** none found. Labels match the PNGs under my vision check, no titles were invented, and the changelog numbers match what I reproduced.
5. **Security:** SQL is parameterised. Only error categories are stored, with no raw bodies or secrets. Redirects are disabled in the handler factory, and HTML or off-origin responses fail closed.
6. **Free-tier:** n/a.
7. **Scope:** ok. Only agent code plus the declared docs; no schema, spec, master data or TS changes.
8. **Maintainability:** acceptable. Outbox/Session code is dense, but the docs are accurate apart from the `EnqueueCapture` doc (SF2).

## Commands run
```
$ git status --porcelain=v1 -uall; git rev-parse HEAD
(empty)
22a72a6f7ed2a088ad1122a8bade91baf8b848f2
$ git log --oneline 28c2fff..HEAD
22a72a6 T09: review r1 changelog, Q-93/Q-94
ccfc1b2 T09: review r1 — visible deck characters, 13↔14 card identity, ...
f130301 T09: review r1 — completeness gate, sub-1080 refusal, upload ...
$ git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check 28c2fff..HEAD; echo $?
0
$ git diff --name-only 28c2fff..HEAD | grep -v '^agent/'
docs/OPEN_QUESTIONS.md
docs/changelog/T09-agent-core.md
$ grep -rnwiE "mcqueen|special week|...|yuuki" agent/src agent/layouts/global-2026-09.json; echo $?
1
$ cd agent && dotnet build Uma.Agent.sln
    0 Warning(s)
    0 Error(s)
$ dotnet test Uma.Agent.sln --no-build -- RunConfiguration.DotNetHostPath=/private/var/folders/k3/6ph2csn113x6w4jq66qjms1r0000gn/T/dotnet8/dotnet
Passed!  - Failed: 0, Passed: 127, Skipped: 0, Total: 127 - Uma.Agent.Core.Tests.dll (net8.0)
$ head tests/.../bin/Debug/net8.0/accuracy-report.txt
overall: 747/747 = 100.00%
wrong but confident (silent errors): 0; correct but flagged low_confidence: 3
  absence 15/15 ... cardVisible 11/11 ... scroll 16/16 ... (all other categories unchanged from 711)
$ grep -E "Total tests|Passed:|Failed:" ~/.hermes/cache/scratch/t09fix/red-round1-stubs.txt
Total tests: 123 / Passed: 86 / Failed: 37
$ DOTNET_ROOT=$TMPDIR/dotnet8 $TMPDIR/dotnet8/dotnet out/Probe.dll   # ~/.hermes/cache/scratch/t09r2/probe/
R1 real 01-07: uploadable before=False; after public Skills.Add([],top:true,end:true) uploadable=True skills=14
R2 forged thumb via Feed: uploadable=True
R3 sealed uploadable=True crops=1; flip crop byte → False; mutate Fields[0] → False; edit checklist Detail → True
R4 different (sealed) content, same captureId after upload: uploadable=True enqueue=AlreadyUploaded
   legacy DB pending veteran + enqueue different content: Queued; rows=veteran:3,crop:0
R5 discard dead /sparks/3 → removed 3; late CompleteCrop → rows=0; re-enqueue=Queued rows=crop:/sparks/3,veteran
R6 201 created:true → Uploaded vid=01K7B33MXGVZV6TZRJZDHB99YF; 200 created:true → Retrying/unexpected-response
   201 extra key / lowercase ulid / [] / null → Retrying; 418,422 → Rejected dead; 500 → Retrying
   301,308 → AuthRequired/auth (Health.AuthRequired=True); followed off-origin 201 → AuthRequired/auth-login-page
   200 text/html → AuthRequired/auth-login-page; 200 no-CT html → Retrying/unexpected-response
   CreateHandler AllowAutoRedirect=False
R7 ParseAsync 1280: UnsupportedResolutionException (...make the game window at least 1920x1080...)
   ListTilesAsync 1280 direct: 20 tiles, confident lb=20; lb 0,0,0,...,1,1,0 vs native 2,4,4,4,4,0,0,1,0,4,...
   DeckAsync 1280 direct: lb=0,0,0,0,0,0 borrowed=False×6 (all confident)
   2560 ParseAsync 13: lb-equal=True card-equal=True; 3840x2160: CardsList
R8 all-stats-unreadable header right after A joins A: True; sessions=1
R9 real 01-07 blockers: details.skills: 14 skills; top seen, end not reached; 0 unaligned frame(s); capture=True
```
Vision checks: I looked directly at the PNGs (05 deck crop at (270,510)–(850,650), the full 13 screen, 13 tile 0 crop, and the full 14 screen) to check the labels.

The probe source and output are kept at `/Users/willjose/.hermes/cache/scratch/t09r2/probe/{Program.cs,Probe.csproj,probe-r2.txt}`. Its SQLite databases went under $TMPDIR. I did not touch the earlier `t09probe/` or `t09probe-r1/`, regenerate any evidence, refresh master data, or run a pnpm build.

At the end the worktree is still clean at 22a72a6f7ed2a088ad1122a8bade91baf8b848f2.

session_id: 20261003_234744_39155c
