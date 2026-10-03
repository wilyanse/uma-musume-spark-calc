## Verdict: CHANGES_REQUESTED

Candidate 28c2fff, branch task/T09-agent-core. HEAD matches and the worktree is clean: `git status --porcelain` printed nothing (bin/obj are ignored). The diff touches only `agent/**`, `docs/OPEN_QUESTIONS.md` (Q-90..92) and the T09 changelog. No TS producer or master files changed.

I reproduced the numbers: build has 0 warnings and 0 errors, 83/83 tests pass, and the accuracy report gives 711/711 (708/711 with full-frame OCR only, and all 3 misses are flagged).

Each of the 15 labels matches the real PNG, checked by looking at the screenshots directly, not at OCR or parser output. That includes the ◯/◎ suffixes in 01 and 15, the stars, the 13 LB/levels, Held 208 and guest "Yuuki".

The changes are requested because probes against the public APIs, outside the tests' happy paths, show three problems:
- An incomplete capture can be queued for upload.
- Downscaled 16:9 frames produce wrong values marked confident.
- The uploader can silently lose a veteran.

## Blocking

- [B1] `agent/src/Uma.Agent.Core/Session.cs:131,139-297` and `Outbox.cs:94-103` — An incomplete capture can be queued and uploaded. `IsComplete` exists but nothing uses it. `Assemble` and `UploadOutbox.EnqueueCapture` ignore the checklist, which goes against 30 §5 ("complete when … captured. When it completes: assemble").
  - P1: fixtures 01–07 + 09 + 10, with `details.skills` INCOMPLETE. A capture with 14 skills and 0 low_confidence fields is produced, and `EnqueueCapture` accepts it (outbox: `veteran`).
  - P2: no Skills frame at all. A capture with `skills=0`, no errors and no flags is produced.
  - P3: if the scroll thumb isn't detected (`Thumb=null`), `AtTop` and `AtEnd` both return true, so a top-only Skills frame is reported "complete".
  - Skills aren't part of the fingerprint, so a truncated list goes out as `ok` data. The contract has no way to say "skills incomplete", which is a reason to refuse the upload, not a UI concern.
  - Required fix:
    - `EnqueueCapture` (or a `TryComplete` gate that returns the capture) must refuse unless every checklist section is complete.
    - `Assemble` must error when the Skills map was never anchored.
    - A missing thumb on a scrollable details tab must count as unknown, not as top/end, unless the content provably fits.
    - Keep the 30 §10 acceptance ("01–07 assembles a valid capture") as an explicit non-uploadable/diagnostic result.
    - Add an OPEN_QUESTION for the conflict between that acceptance item and the §5 completeness rule, plus the missing contract flag (an ADR is needed to add one).
    - Add tests: the outbox rejects an incomplete capture; a missing Skills tab gives no capture.

- [B2] `Frames.cs:56-64`, `Vision.cs:79-85,127-141`, `Parsers.cs:341-350,355-360` — Scaling other 16:9 sizes gives confident wrong values. The only scaling test upscales fixture 15 to 2560×1440. I downscaled the real fixtures (bicubic, so this is not real game rendering) and replayed them through `FrameParser`:
  - At 1600×900 and 1280×720, Corner Recovery ◯ was accepted as `skill:corner-recovery-2` (the "Corner Recovery ×" entry) and Medium Corners ◯ as `skill:medium-corners` (◎), both with Ok=True. The glyph centre-luma thresholds of 207/214 don't hold after resampling (measured luma 164–187).
  - At 1280×720, deck slot 6 came out as borrowed=false and LB=0, both Ok=True. The label is borrowed=true, LB=4, and LB must be 100%.
  - LB, borrowed and pill colour are always `Ok=true`, confidence 1, with no margin.
  - Required fix: either calibrate scale-aware thresholds and make them fail closed with a near-threshold uncertainty band (low_confidence plus a crop), or declare sizes below 1920×1080 unsupported (refuse, like non-16:9) and record an OPEN_QUESTION. Add tests at 1280×720 and 1600×900 asserting no confident-wrong fields.

- [B3] `agent/src/Uma.Agent.Core/Outbox.cs:150-165,154` — The uploader can lose a capture silently or strand it permanently.
  - P8b: crop OK, then the veteran POST returns `200 text/html`. This is what Cloudflare Access gives when the default `HttpClient` follows its 302 to the login page. `outbox.Complete` deletes the veteran without the API ever ingesting it, so the outbox ends up empty.
  - P8a: a 401 (rotated or invalid service token) dead-letters the crop permanently. The veteran is then blocked forever, and there is no API to requeue or discard dead rows.
  - Required fix:
    - Treat only 201 or 200 with a JSON `{veteranId, created}` body as success.
    - Treat 3xx/401/403 as a retryable "auth" state, not dead-lettered and not completed, and expose it so T10 can show the Error state.
    - Add `Requeue` and `Discard` for dead items.
    - Add tests for the HTML-200, redirect and 401 cases.

## Should fix

- [S1] `Session.cs:219-220` — One unreadable parent spark label aborts the whole capture (P5: `/sparks/25/sparkId: not captured`, capture null), because `Emit` records an error before `partial = true`. The intended behaviour, per the comment and T01b, is to drop the block and add the `/sparks/<owner>` flag.
- [S2] `Session.cs:223-224` — When stars read as 0 (P7), the field value is 0 but the veteran entry is clamped to 1. The value and the payload disagree. Emit the clamped value with candidates [1,2,3].
- [S3] `Outbox.cs:39-49,94-103` — Calling `EnqueueCapture` twice (P9) creates duplicate veteran and crop rows. Add a unique index on (capture_id, kind, path) or make enqueue idempotent.
- [S4] `labels/05…json` "unresolved" — Deck card identity is art-only and isn't labelled. Type and rarity agreement doesn't prove which card it is.
  - The pipeline emits all six cardIds as `ok` (dHash d=2–7, margin 11–15).
  - The visible icons match: speed, stamina, stamina, speed, power, group, all SSR.
  - Still, the 6 IDs are unverified. Label the visible character per tile and assert 13's tile 0 against 14's resolved card. Add a "confirm 6 deck cardIds" item to H4 step 2.
- [S5] `Parsers.cs:18` — The identity key is outfit|name|rating. Two veterans with the same outfit and rating would merge their skills and sparks. Add stats to the key, or detect conflicting headers and split.
- [S6] `FixtureTests` comparer — It never asserts the labelled `scroll` flags, that career fields are absent on 05 and 07, or that popups have no header. I checked all of these manually with P13 and they match; they should be asserted.
- [S7] `Session.cs:265` — `/parents/i/outfitId` is emitted as `ok`, confidence 1, with a null value. That is misleading provenance.

## Nits

- [N1] `TextFingerprint.cs` uses the default `JsonSerializer` encoder, which escapes `+` and non-ASCII. That's safe only because IDs are lower-kebab; a comment or test would help. The shared vectors pass.
- [N2] `Microsoft.Data.Sqlite 10.0.3` on net8.0 works (it ships a net8.0 lib), but 8.0.x would match the LTS runtime. All dependencies are pinned exactly.
- [N3] The `Runtime_is_native_net8` guard is portable (Major==8) and fails on roll-forward, as documented.

## Checklist

1. Spec conformance: issues (B1; §2 scaling B2).
   - Met: screen IDs, schema, fingerprint vectors, Q-110 pointers, slot order, the `/sparks/<owner>` flag, F02 (01 → independent, 15 → manual), 30 §10 T11 LB list.
2. Correctness: issues (B1–B3, S1, S2, S5).
   - Met: scroll alignment refuses to bridge gaps (P4 fails closed), unrelated popups 08/11 don't resolve parents, guest popup 10 resolves trainer Yuuki.
3. Test quality: the tests are real and deterministic, with labels grounded in screenshots. But scaling covers upscale only, the uploader tests cover only 503/422, and nothing gates on completeness (S6).
4. Fabrication: ok. Labels match the PNGs. The grep for fixture values in `src`/layout finds nothing (rc=1). Templates rebuild byte-for-byte from their recorded source crops. The changelog output matches what I reproduced.
5. Security: SQL is fully parameterised. No secrets in the DB (the test checks this) or the repo. Errors are stored as category only. Auth/redirect handling: B3.
6. Free-tier: n/a for the agent. It does one POST per veteran plus crops of 60 KB or less.
7. Scope: ok. Only `agent/**`, the declared OPEN_QUESTIONS edit and the changelog. The solution was registered by an earlier run.
8. Maintainability: reasonable. All constants live in the layout file, with templates carrying their provenance. Dense one-line code in TextFingerprint/Contracts.

What this does and doesn't establish: all of the above was tested on macOS with Apple Vision OCR replay. The 1280/1600 results come from synthetic bicubic resampling, not real game rendering. Windows OCR, real-game capture and the user's label check remain H4 and haven't been done. PASS on a later round would still not mean H4/M2 is complete or that merging is authorised.

## Commands run

```
$ git rev-parse HEAD; git status --porcelain=v1 -uall
28c2fff531e645f70612547329d3409b2fe419f7
(empty)
$ git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check main...HEAD; echo $?
0
$ git diff main...HEAD --name-only | grep -v '^agent/'
docs/OPEN_QUESTIONS.md
docs/changelog/T09-agent-core.md
$ cd agent && dotnet build Uma.Agent.sln
    0 Warning(s)
    0 Error(s)
$ dotnet test Uma.Agent.sln --no-build -- RunConfiguration.DotNetHostPath=/private/var/folders/k3/6ph2csn113x6w4jq66qjms1r0000gn/T/dotnet8/dotnet
Total tests: 83   Passed: 83
$ head bin/Debug/net8.0/accuracy-report.txt
overall: 711/711 = 100.00%
wrong but confident (silent errors): 0; correct but flagged low_confidence: 3
$ (Full_frame test, detailed)  overall: 708/711 = 99.58%
 WRONG 05 deck/3/level: expected 50, got null, confident=False
 WRONG 13 cards/1/level ... WRONG 13 cards/6/level (both confident=False)
$ dotnet test Uma.Agent.sln --no-build          # default host
Test Run Aborted.
```

Probe source: `/Users/willjose/.hermes/cache/scratch/t09probe/{Probe.csproj,Program.cs}`. It references the built `Uma.Agent.Core.dll`, reads only, and was run with the isolated .NET 8.0.31 host (`DOTNET_ROOT=$TMPDIR/dotnet8 $TMPDIR/dotnet8/dotnet bin/Debug/net8.0/Probe.dll`; `SZW`/`SZH` set the P12 size).

```
== P1 01-07+09+10: details.skills: INCOMPLETE — 14 skills; top seen, end not reached
   capture=PRODUCED errors=[]  skills=14 lowconf=[]
   EnqueueCapture accepted INCOMPLETE capture; outbox rows: veteran
== P2 no skills frame: details.skills: INCOMPLETE — 0 skills; top missing → capture=PRODUCED skills=0 errors=[]
== P3 01 with thumb=null: details.skills: complete — 14 skills; top seen, end seen
== P4 03 with thumb=null: capture=null errors=[self spark block violates the blue/pink/green shape]
== P5 04 one unreadable label: capture=null errors=[/sparks/25/sparkId: not captured]
== P7 stars=0: field value=0 status=low_confidence; veteran stars=1
== P8a 401 every request: [crop dead=True err=HTTP 401, veteran dead=False attempts=0]
== P8b veteran gets 200 text/html: outbox after = []
== P9 double enqueue rows: veteran,veteran
== P10 2560x1440 sparks sameAsNative=True; 1920x1200: UnsupportedAspectRatioException
### 1600x900
   skill[1] skill:corner-recovery-2/True native skill:corner-recovery/True
   skill[6] skill:medium-corners/True native skill:medium-corners-2/True
### 1280x720
   02 [6] spark:medium ok=False (flagged); 04 [6..8] ok=False (flagged)
   skill[1] skill:corner-recovery-2/True; skill[6] skill:medium-corners/True
   05 deck lb [4,4,4,4,4,0] ; borrowed slot6 False/True
== P14 glyph luma 1920: Corner Recovery Single/221.8 ... 1280: Corner Recovery Double/164.2
== P13 scroll flags/heading/career on all 15 match labels (01 top/!end … 04 !top/end; 07 career all null)
== P11 portraits: special-week 0.875 vs 0.797 | tm-opera-o 0.875 vs 0.797
```

Vision checks: I loaded all 15 PNGs and zoomed into the header, skills, sparks, deck, career, popups, card list and card detail. Every label value matched what is on screen. Deck art identities beyond type, rarity and character appearance can't be confirmed visually (S4).

session_id: 20261003_223612_966133
