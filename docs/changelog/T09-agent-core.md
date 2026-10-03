# T09 — Agent core

- **Status:** Partial (review round 1 fixes committed; see "Review round 1"). Cross-platform acceptance is met on macOS against the 15 screenshots and recorded OCR. H4 (Windows OCR re-recording and user label verification) is still pending, so do not mark this Done until H4 passes.
- **Branch:** task/T09-agent-core
- **Agent / model:** this continuation (commits `0dee2e7`, `6bbf5e1`, `285dbe4` and the changelog commit) was launched as Opus 5.5 / anthropic, medium reasoning. The session does not expose the actual model or effort, so this is the launch setting, not a verified identity. Earlier attribution is unchanged: `b518d7b` is the interrupted Opus run plus the Sol retry; `fe534dd` is the Sol continuation (`gpt-6-sol` / `openai-codex`, medium) that wrote the serializer, schema, outbox and unverified labels.
- **Date:** 2026-10-03

## Summary
`Uma.Agent.Core` now has:
- **Screen classification:** an anchor dHash, OCR of the title and active-tab colour together decide the screen. It also checks the guest trainer, scales other 16:9 sizes and rejects other aspect ratios.
- **Parsers for every screen:** header, rank and grade templates cut from real fixture crops, skills (including the ◯/◎ glyph), sparks (stars, pill colour, owner blocks), deck (LB, art dHash, level, borrowed), parents (portrait dHash, guest flag), career rows, Sparks popups, plus card-list and card-detail primitives.
- **Capture flow:** a `CaptureSession` and `CaptureCoordinator` that align scrolled frames in content space and deduplicate them, track identity, keep a section checklist and flag missing blocks. An assembler emits a validated, fingerprinted `VeteranCapture` with crops for low-confidence fields. The outbox and uploader attach `cropKey`s before sending the veteran.

All 15 labels were rewritten from screenshot inspection. Per-fixture tests and the accuracy report give 711/711 labelled fields correct, with 0 wrong values marked confident. 83 tests pass on a native .NET 8.0.31 runtime.

## Files
Created (this continuation):
- `agent/src/Uma.Agent.Core/Screens.cs` — `ScreenClassifier` (anchor + title + active tab + guest trainer), `ScreenId`.
- `agent/src/Uma.Agent.Core/Parsers.cs` — `FrameParser`: every screen parser, `Reading` provenance records, `HashMatch` (dHash with jitter search and a best/runner-up margin).
- `agent/src/Uma.Agent.Core/Vision.cs` — star strips, pill colour, LB diamonds, scroll thumb and content offset, skill pill borders, ◯/◎ glyph, reading order.
- `agent/src/Uma.Agent.Core/Templates.cs` — `TemplateSet`: block-feature nearest-template matcher with distance and margin; rebuilds templates from their source crops.
- `agent/src/Uma.Agent.Core/Vocab.cs` — `VocabIndex`: 30 §4 normalisation and matching (margin against the best *different* ID; glyph-aware).
- `agent/src/Uma.Agent.Core/Session.cs` — `ContentMap` (scroll alignment and dedup), `CaptureSession` (checklist, assembler, parent popup resolution, crops ≤ 60 KB), `CaptureCoordinator` (identity switching).
- `agent/layouts/templates/global-2026-09.json` — 8 grade templates and 2 rank templates. Each records its source fixture and ROI.
- `agent/tests/fixtures/ocr-roi/{05,13}-*.json` — per-ROI OCR recordings of the deck and card-list `Lvl N` text (Q-91).
- `agent/tests/Uma.Agent.Core.Tests/{FixtureEnv,FixtureTests,SessionTests,UploadPipelineTests,ClassifierAndPrimitiveTests}.cs`.

Preserved and committed from the interrupted run (`0dee2e7`), then inspected and extended: `Frames.cs`, `Layout.cs`, `MasterData.cs`, `Ocr.cs`, `agent/tests/tools/record-roi-ocr.swift`, `agent/tests/tools/record_roi_ocr.py`.

Modified:
- `agent/layouts/global-2026-09.json` — full calibrated layout: families, tabs, header, skills, glyph, sparks, career, card list, LB.
- `agent/src/Uma.Agent.Core/Parsing.cs` — validator requires `deck[i].slot == i+1` and `parents[i].slot == i+1` in addition to the shared sorted-set rule. The old OCR-keyword classifier was removed.
- `agent/src/Uma.Agent.Core/Outbox.cs` — `EnqueueCapture` (validates; crops must belong to `low_confidence` fields), dead-lettering of 4xx responses other than 408/429, `Snapshot`.
- `agent/src/Uma.Agent.Core/{TextFingerprint,PixelAlgorithms,Contracts}.cs` — removed the superseded `TextMatcher`, `MasterCatalog`, `Match<T>` and old star/LB helpers (replaced by `VocabIndex` and `Vision`).
- `agent/tests/fixtures/labels/*.json` (15) — rewritten in one comparable shape from visual inspection of the PNGs.
- `agent/tests/Uma.Agent.Core.Tests/{CoreTests,SerializationTests}.cs` — dropped the keyword-classifier test; reversed deck/parents now assert the index rule.
- `docs/OPEN_QUESTIONS.md` — Q-90, Q-91, Q-92.

## Decisions
- **Classification:** the "Sparks" and "Featured Cards" title bars are only dHash distance 4 apart. The anchor therefore selects candidate families, and OCR of the title must score ≥ 0.85 against the family title. Details tabs require exactly one active (green) tab segment; anything else is `unknown` and ignored.
- **No fixture knowledge in production:** every value is layout geometry, a colour or threshold, master data, or a template cut from a recorded crop. Templates are regenerated from their source crops in a test (`UMA_WRITE_TEMPLATES=1` rewrites them). A word-boundary grep of `agent/src` and the layout for fixture names and values finds none (Verification).
- **Uncertainty is kept, never resolved silently:**
  - dHash, template and vocab matches need both an absolute threshold and a best/runner-up margin.
  - An uncertain value is emitted as `low_confidence` with its top-3 candidates and a PNG crop.
  - The spark pill colour must agree with the master type of the matched label.
  - Several header frames must agree.
  - An unaligned scroll frame is held back, never bridged.
- **Spark owners:** assigned by block order (gap > 70 px or the "Legacy Origin" heading) after scroll alignment in content space. A block that is partial (end not reached) or breaks the blue/pink/green shape is not sent for a parent; it is replaced by the `/sparks/<owner>` low-confidence flag (T01b, Q-110). A bad self block is an error, so no capture is produced.
- **Parents:** identity comes from the portrait dHash (charIconCrop, ±2 px search, distance ≤ 10, margin ≥ 4). A Sparks popup resolves a parent's outfit and guest trainer only when its spark list equals that parent's block, or (without a block) the guest flag agrees and the popup character is among the portrait candidates. An unrelated popup is ignored. Without a popup, `outfitId` is null, and a guest's `guestTrainer` is null with a `low_confidence` field.
- **Deck card identity is art-only.** The labels record what is visible (SSR badge, type icon, borrowed band); tests require the accepted card to match the visible type and rarity. All six matches have Hamming 2–7 with a runner-up margin ≥ 13 (probe output below).
- **Q-110 parity:** `/trainMode` is sent as `ok` provenance only. Low-confidence paths are leaf pointers (`/sparks/<n>/sparkId`, `/stats/x`, `/aptitudes/x`, …) or `/sparks/<owner>`. The assembler emits deck and parents in slot order.
- **Upload failures** (revised in review round 1, see below): a crop rejected with 4xx (other than 401/403/408/429) is dead-lettered and its veteran stays queued, so it is never sent without the review crop; `Requeue`/`Discard` recover dead items. 401/403/3xx/HTML login pages are a retryable auth state. 5xx, 408, 429, transport errors and unacknowledged responses back off exponentially (max 1 h). Credentials come from `IServiceToken` in memory; DPAPI storage is T10's.
- **Native .NET 8:** runtime 8.0.31 installed with the official `dotnet-install.sh --runtime dotnet --channel 8.0 --install-dir $TMPDIR/dotnet8 --no-path`. Tests run through `RunConfiguration.DotNetHostPath`. Global config and the `net8.0` target are unchanged.

## Deviations from spec
- 30 Appendix A: added per-ROI OCR recordings for the deck and card-list levels (Q-91). The full-frame recordings are unchanged and still exercised: without per-ROI files, 708/711 fields are correct, and the 3 misses are flagged, not silent.
- 30 §4: aptitude cells are read with an 8×8 RGB block template plus ±1 px search instead of a raw letter template; ranks are cross-checked against the master rating band (Q-92). The ◯/◎ suffix is decided from pixels (Q-90).
- 30 §5 "complete" checklist: fixture 01 shows only the top of the Skills list (thumb not at the end), so `details.skills` is reported incomplete. Since review round 1 the 01–07 capture is still assembled (30 §10) but is diagnostic only: the outbox refuses it (Q-93).
- 30 §2 scaling: 16:9 frames below 1920×1080 are refused with `UnsupportedResolutionException` instead of being scaled (review round 1, Q-94).

## Cross-task edits
- `docs/OPEN_QUESTIONS.md` — appended reserved Q-90..92 (T09 range).
- `agent/Uma.Agent.sln` — registered by the earlier run (unchanged here).

## Verification
Native .NET 8 runtime (isolated, `$TMPDIR/dotnet8`):
```
$ $TMPDIR/dotnet8/dotnet --list-runtimes
Microsoft.NETCore.App 8.0.31 [/private/var/folders/k3/6ph2csn113x6w4jq66qjms1r0000gn/T/dotnet8/shared/Microsoft.NETCore.App]
$ cd agent && dotnet build Uma.Agent.sln
    0 Warning(s)
    0 Error(s)
$ dotnet test Uma.Agent.sln --no-build -- RunConfiguration.DotNetHostPath=$TMPDIR/dotnet8/dotnet
Passed!  - Failed:     0, Passed:    83, Skipped:     0, Total:    83, Duration: 1 s - Uma.Agent.Core.Tests.dll (net8.0)
```
For contrast, the default host has no .NET 8 runtime, and roll-forward runs on .NET 10, where the native-runtime guard test correctly fails:
```
$ dotnet test Uma.Agent.sln --no-build
Framework: 'Microsoft.NETCore.App', version '8.0.0' (arm64)
Test Run Aborted.
$ DOTNET_ROLL_FORWARD=Major dotnet test Uma.Agent.sln --no-build
  Failed Uma.Agent.Core.Tests.SchemaTests.Runtime_is_native_net8 [1 ms]
Failed!  - Failed:     1, Passed:    82, Skipped:     0, Total:    83
```
Accuracy report (written by `FixtureTests.Accuracy_report_meets_acceptance` to `bin/Debug/net8.0/accuracy-report.txt`). The denominator is every labelled field of the 15 fixtures:
```
T09 fixture accuracy (roi-ocr (per-ROI recording, full-frame fallback))
overall: 711/711 = 100.00%
wrong but confident (silent errors): 0; correct but flagged low_confidence: 3
  aptitude 80/80  borrowed 6/6  cardLevel 21/21  cardVisible 6/6  career 7/7  deckLevel 6/6  epithet 8/8
  held 1/1  identity 27/27  lb 26/26  owner 26/26  parent 10/10  rank 8/8  rating 8/8  screen 15/15
  skill 28/28  skillLevel 28/28  spark 120/120  sparkType 120/120  stars 120/120  stats 40/40
  01 49/49 · 02 77/77 · 03 69/69 · 04 66/66 · 05 51/51 · 06 26/26 · 07 21/21 · 08 49/49 · 09 34/34 (1 low-conf)
  10 50/50 · 11 67/67 (2 low-conf) · 12 58/58 · 13 42/42 · 14 3/3 · 15 49/49
Full-frame recordings only: 708/711; misses = 05 deck/3/level, 13 cards/1/level, 13 cards/6/level, all flagged low_confidence.
```
The 3 low-confidence fields are correct values whose OCR line had confidence 0.3 (`Head- On warar`, `RampUP1`, `• Up-Temposa5`). They go to review rather than being trusted.

McQueen assembly (`SessionTests.Fixtures_01_to_07_with_parent_popups_assemble_the_McQueen_capture`, fixtures 01–07 + 09 + 10):
```
details.skills: INCOMPLETE — 14 skills; top seen, end not reached
details.inspiration: complete — 3/3 blocks; top seen, end seen; 0 unaligned frame(s)
details.career.deck: complete — 6 tiles
details.career.parents: complete — 2 parents
details.career.block: complete — date,fans,races,scenario,wins
fingerprint a0fbe2ae6c6940891c087bfbfb106365a845b099564da1c3074bd310c1761d4a; fields 190, low_confidence 0, crops 0
```
The test asserts:
- character, outfit, A+/13471, Independent Learner → `independent`, stats and the 10 aptitudes;
- 14 skills (unique skill level 5);
- sparks 10 self / 10 parent1 / 15 parent2, equal to the label-built list;
- six deck entries in slots 1–6, LB 4, Lvl 50, slot 6 borrowed, each card's type equal to the visible icon;
- parent 1 Special Week (Special Dreamer), parent 2 T.M. Opera O (New Year, Same Radiance!), guest, trainer "Yuuki";
- `scenario:ura-finale`, career 22/22/649,560/2026-09-29;
- the fingerprint equals the hash of the label-built veteran;
- the payload passes the shared JSON Schema, CAPTURE_RULES and master-ID validation.

Other session and upload tests:
- out-of-order and duplicate frames give the same fingerprint;
- a header change (fixture 15 inserted mid-session) starts a separate Teio session, and returning resumes McQueen;
- a missing parent2 block or an unalignable frame yields the `/sparks/parent2` flag, and the held frame aligns once the gap frame arrives;
- unrelated popups (08, 11) don't resolve parents;
- missing sections produce no capture;
- simulated ambiguous stat and grade readings come out as `low_confidence` with candidates and crops;
- the final `POST /api/v1/veterans` body carries `cropKey` exactly on the low-confidence fields after a 503 retry and an outbox restart;
- a 422 on a crop dead-letters it and the veteran is never posted;
- secrets never reach the SQLite file.

Calibration probes (scratch Python against the PNGs; reproducible from the layout constants):
```
deck art dHash (nearest, runner-up): t0 2/20 · t1 3/21 · t2 6/19 · t3 5/20 · t4 7/20 · t5 7/21  (Hamming)
parent portrait, ±2 px search: Special Week 8 vs 13 · T.M. Opera O 8 vs 13
anchor dHash vs families: details 0 on 01–07,15; sparks 0 on 08–12 (cards.detail 4 → title OCR required)
fixture 13 LB: [2,4,4,4,4 | 0,0,1,0,4 | 0,4,0,4,4 | 0,0,4,4,0]  (= 30 §10 T11 list)
```
Scope and secret check:
```
$ git diff fe534dd --stat -- . ':!agent' ':!docs/changelog/T09-agent-core.md'
 docs/OPEN_QUESTIONS.md | 15 +
$ grep -rnwiE "mcqueen|special week|special-week|opera|teio|oguri|13471|13,471|649560|yuuki" --exclude-dir=bin --exclude-dir=obj agent/src agent/layouts/global-2026-09.json
(no matches; rc=1. The only earlier hit was a doc-comment example "13,471" in Ocr.cs, changed to "1,234")
```

## Acceptance status (30 §10 T09, 70 F01/F02, 01 §3/§5/§6/§8)
- One test per fixture asserting the full parsed output against its label: **met** (`FixtureTests.Fixture_parses_to_its_label`, 15 cases).
- ≥ 99% overall; stats, spark stars and LB 100%: **met** (711/711; stats 40/40, stars 120/120, LB 26/26).
- McQueen capture from 01–07 with 3 spark blocks, 6 deck cards, 2 parents (parent 2 guest T.M. Opera O), URA Finale, and a fingerprint equal to the shared algorithm: **met**. Shared vectors pass in `ContractParityTests`.
- Missing parent block flagged with `/sparks/<owner>`: **met**.
- F02 McQueen → independent, Teio (15) → manual: **met** (the epithet is parsed in both).
- Flat aptitude JSON, schema parity, master-ID validation, Q-110 path safety, slot order: **met** (Serialization, Schema and ContractParity tests).
- Crop upload, `cropKey` persistence and attachment, retry/restart, final-body assertions: **met**.
- Labels written from the screenshots and **checked by the user at H4**: written; **user check pending**.

## Open questions / follow-ups
- Q-90 (◯/◎ by pixels), Q-91 (per-ROI OCR recordings), Q-92 (rank templates only A+/UG3). Existing: Q-5, Q-6 (art hash threshold now calibrated on 6 deck tiles + 20 list tiles at Mac capture scale), Q-7, Q-110.
- T10: implement `IFrameSource`/`IOcrEngine` on Windows, record OCR in both formats (full frame + per-ROI), drive `CaptureCoordinator.Feed` and show `CaptureSession.Checklist()`; enqueue only when `CaptureResult.Uploadable` (otherwise show `Blockers`); call `UploadClient.SendAsync` in a loop and map `UploadOutcome`/`UploadOutbox.Health()` to the tray states (AuthRequired → Error + Settings; Rejected/dead → list with Requeue/Discard); build the HttpClient with `UploadClient.CreateHandler()` (no auto-redirect) and call `RetryAuthNow()` after the token is saved; catch `UnsupportedFrameException` and show its message; provide `IServiceToken` from DPAPI.
- T11: reuse `FrameParser.HeldAsync`, `ListTilesAsync`, `DetailAsync` and `HashMatch` **only with an already-normalized exactly 1920×1080 frame and reference-space OCR coordinates**. Use `ParseAsync` for arbitrary supported client sizes (or `Frames.Normalize` before a primitive); raw smaller/larger dimensions throw `NonReferenceFrameException` at primitive entry. Full sync and dedup are T11's.
- Skills incompleteness: the checklist reports it and the outbox refuses the capture (Q-93); a contract flag needs an ADR.
- Q-93 (01–07 diagnostic vs §5 completeness, no skills-incomplete flag), Q-94 (sub-1080 refusal, future calibration) added in review round 1.

## H4 — human steps (Windows)
1. On Windows, build T10's shell. For each of the 15 PNGs in `docs/reference/screenshots/`, run `Uma.Agent.Windows --record-ocr` to write `agent/tests/fixtures/ocr/<fixture>.json`. Also write the per-ROI recordings for 05 and 13 (same ROIs as `agent/tests/tools/record_roi_ocr.py`) to `agent/tests/fixtures/ocr-roi/`.
2. Open each `agent/tests/fixtures/labels/<fixture>.json` next to its PNG and confirm or correct every value. Pay particular attention to:
   - star counts, the ◯/◎ suffixes in 01/15, and the clipped rows noted in 03;
   - the deck type icons and `visibleCharacter` entries in 05 (tiles 1, 2, 4: Matikanefukukitaru, Super Creek, Agnes Tachyon; tiles 3, 5, 6 are null);
   - **confirm the 6 deck cardIds** the pipeline matched on 05. Identity is art-only (no title on the tile), so these are not label-verified: `card:touching-sleeves-is-good-luck-matikanefukukitaru`, `card:piece-of-mind-super-creek`, `card:winning-dream-silence-suzuka`, `card:q-0-agnes-tachyon`, `card:dazzling-day-in-the-snow-marvelous-sunday`, `card:esteemed-and-adored-the-throne-s-assemblage` (open each card in game, or compare with the card list);
   - 13 tile 0 = the card opened in 14 (`sameCardAs`);
   - guest trainer "Yuuki" in 10;
   - Held 208 and the LB list in 13.
3. Run `dotnet test agent/Uma.Agent.sln` on Windows with .NET 8. The accuracy report must stay ≥ 99% with stats, stars and LB at 100%. If the Windows OCR or capture differs, recalibrate `agent/layouts/global-2026-09.json` and regenerate the templates with `UMA_WRITE_TEMPLATES=1`.
4. Capture 3 real veterans (at least one with a guest parent and one Manual-mode veteran). Scroll each tab until the checklist is complete and confirm the uploads in the web roster. Then import at least 20 veterans and spot-check 3 against the game.
5. Record the result in this changelog under "H4".

## Review round 1
Review: `docs/reviews/T09-review-1.md` (CHANGES_REQUESTED on `28c2fff`). Fix commits: `f130301` (B1–B3, S1–S3, S5, S7), `ccfc1b2` (S4, S6, N1), and this changelog/Q commit. Model: launched as Opus 5.5 / anthropic, medium reasoning (launch setting; the session does not expose the actual model).

### Tests first (real red → green)
New tests were written before the fixes, against stubs that added the new API surface with the **old behaviour** (so failures are assertion failures, not compile errors). Saved run: `~/.hermes/cache/scratch/t09fix/red-round1-stubs.txt`.
```
$ dotnet test Uma.Agent.sln --no-build --logger "console;verbosity=normal" -- RunConfiguration.DotNetHostPath=$TMPDIR/dotnet8/dotnet
     Passed: 86
     Failed: 37
B1_real_01_to_07_is_a_diagnostic_capture_that_the_outbox_refuses => Assert.False() Failure Expected: False Actual: True
B1_no_skills_frame_gives_no_capture => Assert.Null() Failure: Value is not null ... VeteranCapture { ...
B1_missing_scroll_thumb_is_unknown_position_not_top_and_end => Assert.False() Failure Expected: False Actual: True
B1_unaligned_pending_frames_keep_the_section_incomplete => Assert.False() Failure Expected: False Actual: True
B1_a_tampered_or_hand_built_result_is_refused => Assert.Throws() Failure: No exception was thrown
B2_sub_1080_16x9_frames_are_refused_before_any_reading(w: 1280, h: 720) => Assert.Throws() Failure: No exception was thrown
B2_sub_1080_16x9_frames_are_refused_before_any_reading(w: 1600, h: 900) => (same)
Unacknowledged_success_never_deletes_the_veteran(kind: "html200"|"json200-empty"|...|"204"|"202") => Assert.Single() Failure: The collection was empty   (8 cases)
Auth_failures_are_retryable_auth_state_not_dead_letters(code: 401|403|302|307) => Expected: AuthRequired Actual: Uploaded
The_shell_http_handler_never_follows_redirects => Assert.False() Failure Expected: False Actual: True
Dead_crop_can_be_requeued_by_stable_id_and_then_uploads => Assert.True() Failure Expected: True Actual: False
Discarding_a_dead_crop_discards_its_whole_capture_... => Expected: 2 Actual: 0
Repeated_enqueue_is_idempotent_and_keeps_retry_state => Expected: AlreadyQueued Actual: Queued
Concurrent_enqueue_from_two_outboxes_inserts_once => Expected: 1 Actual: 8
A_crash_mid_enqueue_leaves_nothing_and_a_retry_succeeds => Assert.Throws() Failure: No exception was thrown
Null_path_rows_are_unique_and_an_existing_database_with_duplicates_is_migrated => Expected: 2 Actual: 4
S1_one_unreadable_parent_label_drops_that_block_with_the_owner_flag => Collection: ["/sparks/25/sparkId: not captured"]
S2_uncertain_star_count_field_value_equals_the_payload_and_lists_candidates => Expected: 1 Actual: 0
S5_same_outfit_and_rating_with_different_stats_never_mix => Assert.NotSame() Failure: Values are the same instance
S7_unresolved_parent_outfit_is_not_reported_as_confident => Expected: low_confidence Actual: ok
... (37 total; full list in the saved run)
```
S6 assertions passed first time (the reviewer had checked the values manually in P13), so a mutation test was added and run against the pre-change comparer (`git show HEAD:…/FixtureEnv.cs`), where it failed: `Assert.Contains() Failure: Item not found in collection / Collection: [] / Not found: "scroll/atEnd"`. With the new comparer it passes.

### Responses
- **B1 — fixed.** `CaptureResult.Uploadable` is true only for a result the assembler sealed (SHA-256 over capture JSON, crops and checklist) with every checklist section complete and no errors. `UploadOutbox.EnqueueCapture` throws `IncompleteCaptureException` otherwise, including for a tampered or hand-built result. A checklist section is complete only when top and end were both seen with a detected thumb and no frame is unaligned. `Assemble` errors when the Skills map was never anchored (no capture). `Vision.AtTop/AtEnd(null)` are now false: a missing thumb is an unknown position. 01–07 (+09/10) still assembles a schema/CAPTURE_RULES/master-valid capture (30 §10) but it is diagnostic and refused by the outbox; the §10/§5 conflict and the missing "skills incomplete" contract flag are Q-93. Contract-valid parent omissions are reconciled rather than blocked: when the Inspiration tab was covered top to end, an unrepresentable parent block is dropped with its `/sparks/<owner>` flag and the result **is** uploadable (`B1_fully_scrolled_inspiration_with_an_unreadable_parent_block_is_uploadable_with_the_owner_flag`); an end frame that cannot be aligned does not count as coverage (`B1_an_end_frame_with_no_readable_label_cannot_prove_coverage`). Only one test input fakes an end: `Collect.SyntheticWholeSkillsList()` replaces 01's detected thumb with a whole-track thumb so the "genuinely complete collection" path can be tested. It is named and documented as SYNTHETIC; no label or screenshot claims it, and the real 01 is always tested as incomplete. Tests: partial skills, absent skills, missing thumb (skills and mid-list inspiration), unaligned pending frames, complete collection → `Queued`, enqueue gate, tamper/hand-built refusal.
- **B2 — fixed (conservative).** `Frames.Normalize` throws `UnsupportedResolutionException` (new base `UnsupportedFrameException`, shared with `UnsupportedAspectRatioException`) for 16:9 frames below 1920×1080, before classification or any reading. Its message tells the user to enlarge the window. 2560×1440 still parses identically to native; non-16:9 sizes are still rejected. No threshold was changed. Tests downsample real fixtures 01, 02, 05 to 1280×720 and 1600×900 (bicubic, labelled as a probe, not game rendering) and assert refusal from both `FrameParser` and `ScreenClassifier`. Deviation from 30 §2 recorded; future calibration on real lower-resolution captures is Q-94.
- **B3 — fixed.** Authoritative shape checked: 01 §3 and `apps/api/src/routes/veterans.ts` answer `201 {veteranId, created: true}` or `200 {veteranId, created: false}` (+ optional `reviewItemIds`), `packages/schema` `IngestResponse` is a strict object with ULIDs; crops answer `200 {cropKey}`. `UploadClient.SendAsync` only completes a veteran on exactly that (status/created agreement, ULID, no extra keys) and stores the `veteranId` (`UploadedVeteranId`). HTML 200, empty/wrong-shape/malformed JSON, 201 with `created:false`, 202 and 204 never delete the row (retry with backoff, category `unexpected-response` or `auth-login-page`). 3xx, 401 and 403 return `UploadOutcome.AuthRequired`: never dead-lettered, every pending item held with the bounded (≤ 1 h) backoff, `OutboxHealth.AuthRequired` for T10, cleared by the next success; `RetryAuthNow()` after the user fixes the token. A followed redirect that ends off-origin or on HTML still fails closed. `UploadClient.CreateHandler()` returns a handler with `AllowAutoRedirect = false` and the class doc states the shell requirement. `Requeue(id)` restores a dead item by its stable row id; `Discard(id)` removes a dead item together with its whole capture (crops and veteran), so a veteran is never uploaded without a needed crop. Only categories are persisted; a test greps the DB file for the HTML body, nonce, login host and secret. Tests: HTML 200, 302/307, 401/403, malformed JSON (several shapes), valid 201/200 acknowledgements, restart + token rotation recovery, dead requeue, dead discard.
- **S1 — fixed.** An unreadable parent label drops that parent's block and emits `/sparks/<owner>` (no leaf error, capture produced); an unreadable self label is fatal.
- **S2 — fixed.** `/sparks/i/stars` value equals the payload (clamped 1..3); an unclear count is `low_confidence` with candidates [clamped value, the other two counts] and a crop.
- **S3 — fixed.** New unique index on `(capture_id, kind, IFNULL(path,''))` (NULL veteran path included). The constructor migrates round-0 databases in one transaction, keeping the oldest row (and its retry state) of any duplicates. A `captures` table records the payload hash per captureId. `EnqueueCapture` runs in one `BEGIN IMMEDIATE` transaction and returns `Queued`/`AlreadyQueued`/`AlreadyUploaded`. It skips crops already saved by the API, refuses a different payload under the same captureId, and never resets retry state. Tests: repeated, cross-instance and 8-way concurrent enqueue, simulated crash mid-enqueue (rollback, then retry succeeds), enqueue after a saved crop and after a finished upload, legacy DB with duplicate rows.
- **S4 — fixed.** Re-inspected the 05 tiles and 13/14 pixels (zoomed crops). Label 05 now records `visibleCharacter` only where one main figure is clearly identifiable: tile 1 Matikanefukukitaru, tile 2 Super Creek, tile 4 Agnes Tachyon. Tiles 3, 5 and 6 (group art / not confidently identified) are null, with a description in `visibleArt`. No card titles were added (they aren't visible). Label 13 tile 0 gains `type: guts`, `visibleCharacter: Special Week` and `sameCardAs: 14-support-card-detail` (same art, guts icon, SSR, Lvl 40). The comparer asserts the matched card's character on labelled tiles. A new test asserts 13 tile 0's art match equals 14's title+name resolution, both confident. H4 step 2 now lists the six matched deck cardIds for explicit confirmation, with the art-only caveat.
- **S5 — fixed.** Session routing uses confident header values: outfit, character, rating and the five stats. A frame joins a session only without a conflicting confident value. Continuity (consecutive details/popup frames) disambiguates a noisy header; outside continuity several compatible sessions is ambiguous and the frame is ignored (`AmbiguousIdentity`). A new session needs outfit, character and rating read confidently. Tests: same outfit/rating with different stats splits; noisy header continues only the current session and is ignored after leaving; returning resumes the right session.
- **S6 — fixed.** The fixture comparer now asserts the labelled `scroll.atTop/atEnd` (16 fields), the absence of unlabelled career rows on 05 and 07, and no header on popups/card screens (15 absence fields). The mutation test proves these fail on wrong parses.
- **S7 — fixed.** An unresolved parent outfit is emitted as `low_confidence`, confidence 0, value null, with the parent portrait crop. The pointer `/parents/i/outfitId` resolves to the null leaf, so it passes the API's correctability rule (`correctionTarget`: not an array/element, not a fixed leaf) and our `CorrectablePath`. With matching popups it stays `ok`. A missing guest trainer now also gets a crop.
- **N1 — done.** Comment on `Fingerprint` explaining the default encoder escaping and why it is safe only for lower-kebab IDs. Test `Canonical_inputs_need_no_escaping` checks every character/outfit/spark/scenario ID against the kebab pattern, documents `"a+b"` → `"a\u002Bb"`, and asserts the McQueen canonical string is plain ASCII with no `\u`.
- **N2 — kept.** `Microsoft.Data.Sqlite` stays pinned at 10.0.3: no change is needed, and it is net8-compatible. `Microsoft.Data.Sqlite.Core 10.0.3` ships a `lib/net8.0` asset (`~/.nuget/packages/microsoft.data.sqlite.core/10.0.3/lib/{net8.0,netstandard2.0}`), and the full suite runs on the native 8.0.31 runtime below. `dotnet list package`: `Microsoft.Data.Sqlite 10.0.3`, `SixLabors.ImageSharp 3.1.12`.
- **N3 — retained.** `SchemaTests.Runtime_is_native_net8` (`Environment.Version.Major == 8`) is unchanged and still fails under roll-forward (output below).

### Verification (round 1)
```
$ $TMPDIR/dotnet8/dotnet --list-runtimes
Microsoft.NETCore.App 8.0.31 [/private/var/folders/k3/6ph2csn113x6w4jq66qjms1r0000gn/T/dotnet8/shared/Microsoft.NETCore.App]
$ cd agent && dotnet build Uma.Agent.sln
    0 Warning(s)
    0 Error(s)
$ dotnet test Uma.Agent.sln --no-build -- RunConfiguration.DotNetHostPath=$TMPDIR/dotnet8/dotnet
Passed!  - Failed:     0, Passed:   127, Skipped:     0, Total:   127, Duration: 2 s - Uma.Agent.Core.Tests.dll (net8.0)
$ (per class, --filter FullyQualifiedName~Tests.<Class>.)
CompletenessTests 19 · UploadRobustnessTests 22 · UploadPipelineTests 3 · OutboxTests 4 · SessionTests 10 · FixtureTests 20
ContractParityTests 4 · SchemaTests 12 · SerializationTests 17 · CoreTests 4 · ClassifierAndPrimitiveTests 10 · ImageTests 2   (all Failed: 0)
$ dotnet test Uma.Agent.sln --no-build                       # default host, no .NET 8 runtime
Framework: 'Microsoft.NETCore.App', version '8.0.0' (arm64)
Test Run Aborted.
$ DOTNET_ROLL_FORWARD=Major dotnet test Uma.Agent.sln --no-build
  Failed Uma.Agent.Core.Tests.SchemaTests.Runtime_is_native_net8 [3 ms]
Failed!  - Failed:     1, Passed:   126, Skipped:     0, Total:   127
```
Accuracy report (all 15 fixtures; the denominator grew from 711 to 747 with the new scroll, absence and visible-character fields):
```
overall: 747/747 = 100.00%
wrong but confident (silent errors): 0; correct but flagged low_confidence: 3
  absence 15/15  aptitude 80/80  borrowed 6/6  cardLevel 21/21  cardVisible 11/11  career 7/7  deckLevel 6/6  epithet 8/8
  held 1/1  identity 27/27  lb 26/26  owner 26/26  parent 10/10  rank 8/8  rating 8/8  screen 15/15  scroll 16/16
  skill 28/28  skillLevel 28/28  spark 120/120  sparkType 120/120  stars 120/120  stats 40/40
Full-frame recordings only: overall: 744/747 = 99.60%; silent errors 0;
  WRONG 05 deck/3/level, 13 cards/1/level, 13 cards/6/level (all confident=False, as before)
```
The upload tests run against the shared schema (`CaptureSchema.Validate`), CAPTURE_RULES/master-ID validation and the shared fingerprint vectors (`ContractParityTests`), all included in the 127.

Reviewer probes re-run on the fixed build (copy adapted to the new API: `~/.hermes/cache/scratch/t09probe-r1/`; the reviewer's `t09probe/` is untouched):
```
== P1 01-07+09+10: details.skills: INCOMPLETE — 14 skills; top seen, end not reached
   capture=PRODUCED errors=[]  →  EnqueueCapture refused: capture is not complete; keep capturing: details.skills: ...
== P2 no skills frame: capture=null errors=[Skills tab not captured (the top of the list was not seen with a detectable scroll bar)]
== P3 01 with thumb=null: details.skills: INCOMPLETE — 0 skills; top missing ... 1 unaligned frame(s); capture=null
== P4 03 with thumb=null: details.inspiration: INCOMPLETE — 2/3 blocks (held back, not merged as top)
== P5 04 one unreadable label: capture=PRODUCED errors=[] lowconf=[/sparks/parent2]
== P7 stars=0: field value=1 status=low_confidence; veteran stars=1
== P8a 401 every request: [crop dead=False attempts=6 err=auth, veteran dead=False attempts=0]
== P8b veteran gets 200 text/html: [veteran dead=False attempts=5 err=auth-login-page]
== P9 enqueue of the incomplete P1 result: refused (IncompleteCaptureException) ×2, no rows
== P10 1280x720: UnsupportedResolutionException ... 2560x1440: sameAsNative=True; 1920x1200: UnsupportedAspectRatioException
== P12/P14 at 1280x720 and 1600x900: UnsupportedResolutionException (nothing read)
```
Scope and hygiene:
```
$ git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check main...HEAD; echo $?
0
$ git diff main...HEAD --name-only | grep -v '^agent/'
docs/OPEN_QUESTIONS.md
docs/changelog/T09-agent-core.md
$ grep -rnwiE "mcqueen|special week|special-week|opera|teio|oguri|13471|13,471|649560|yuuki" --exclude-dir=bin --exclude-dir=obj agent/src agent/layouts/global-2026-09.json; echo $?
1
```
Q IDs: `grep -rnE "Q-9[3-9]"` over the main checkout and every sibling worktree's `docs/` found no Q-93..99 headings in use, so Q-93 and Q-94 were taken from the reserved range. No schema, spec, master data, golden or TS files changed; no pnpm build was run.

### Remaining after T10 (H4)
Not ordinary coding gaps; they need Windows or the user:
- Windows OCR re-recording (full frame + per-ROI) and the accuracy run on Windows .NET 8 (H4 steps 1, 3).
- User check of all 15 labels, including the new `visibleCharacter`/`sameCardAs` entries, and confirmation of the six deck cardIds listed in H4 step 2.
- Real-game capture of 3 veterans through T10, with complete checklists and acknowledged uploads (step 4). This also exercises the real Access redirect/401 behaviour against `CreateHandler()`.
- Real captures below 1920×1080 if smaller windows should ever be supported (Q-94), and a contract decision on a skills-incomplete flag (Q-93).

## Review round2

### Verdict and model provenance
Independent review `docs/reviews/T09-review-2.md` returned **PASS** on `22a72a6f7ed2a088ad1122a8bade91baf8b848f2` for the ordinary pipeline. The coordinator nevertheless **held merge pending SF1–SF4**: published T11 primitive reuse was unsafe (SF3), and post-upload identity reuse contradicted the enqueue contract (SF2). All four are resolved in this bounded fix round; this worker has not merged or pushed.

The original Opus 5.5 / medium launch failed HTTP 429 before edits. Continuation used the explicitly approved **GPT-6.1 Sol / medium fallback (openai-codex)** on the existing branch and clean candidate, not a restarted/recreated worktree. No fallback was chosen autonomously. The fresh read-only independent verifier also reported model `gpt-6.1-sol` and PASS (report below).

### Tests first: actual red → green
`ReviewRound2Tests.cs` was added before production changes. Against the unchanged candidate it compiled with zero warnings/errors, then produced **38 cases: 2 passed, 36 failed** (assertion failures, not compile stubs). SF1 public-Add reflection assertion failed; SF2 uploaded changed-content assertion failed; all 30 parser size/method refusal assertions and all 3 ActiveTabs assertions failed; SF4 legacy-conflict assertion failed. The pending SF2 case and native/upscale regression already passed. Retained evidence: `/Users/willjose/.hermes/cache/scratch/t09fix-r2/{build-red.txt,red.txt}`.

```text
$ cd agent
$ dotnet build Uma.Agent.sln
Build succeeded.
    0 Warning(s)
    0 Error(s)
$ dotnet test Uma.Agent.sln --no-build --filter FullyQualifiedName~ReviewRound2Tests --logger 'console;verbosity=normal' -- RunConfiguration.DotNetHostPath=/private/var/folders/k3/6ph2csn113x6w4jq66qjms1r0000gn/T/dotnet8/dotnet
Total tests: 38
     Passed: 2
     Failed: 36
SF1: Assert.Null() Failure: Value is not null (public Add method)
SF2 uploaded: Assert.Throws() Failure: No exception was thrown
SF3: Assert.IsAssignableFrom() Failure: Value is null / incompatible IndexOutOfRangeException
SF4: Assert.Throws() Failure: No exception was thrown
```
After fixes the full suite passed 165/165. One additional retained-seal mutation regression (no production change) brought the final suite to **166/166**, round2 class **39/39**. It tests in-place field/crop/list/checklist edits and explicitly permits cosmetic Detail edits.

### Responses to every new finding
- **SF1 — fixed.** `ContentMap<T>.Add` is internal. Public Skills/Sparks still expose diagnostic properties, with no public setters or public map mutation; Rows/Extra are snapshots rather than the backing collections. Traced all repository callers: the production map writes are exclusively inside `CaptureSession.Add(ParsedFrame)`; existing tests already use session/coordinator APIs, so no broad friend-assembly or mutable-state exposure was added. Regression checks both generic maps' public surface, real Skills top-only evidence, and the clearly named SYNTHETIC whole-track frame through session Add. Public ParsedFrame edits are intentionally not a security boundary. The seal is an integrity guard, not cryptographic trust against hostile code in the same process; this limit and the cosmetic Detail exclusion are now documented in CaptureResult.
- **SF2 — fixed.** The saved payload/crop hash is compared **before** AlreadyUploaded and AlreadyQueued. A different sealed capture under a saved captureId throws InvalidDataException for both pending and acknowledged states; an independently reassembled exact duplicate returns the corresponding duplicate result without new rows. Tests use an assembler-sealed SYNTHETIC wit change, not a broken seal, and verify unchanged rows plus restart behavior.
- **SF3 — fixed together across the public parser surface.** Exactly 1920×1080 is required at entry to HeaderAsync, SkillsAsync, SparksAsync, DeckAsync, ParentsAsync, CareerAsync, HeldAsync, ListTilesAsync, DetailAsync, and static HashMatch. Same-class classifier ActiveTabs is also guarded. `NonReferenceFrameException : UnsupportedFrameException` includes dimensions and directs the caller to ParseAsync or prior normalization; no OCR/pixel access happens first. Reflection enumerates every public FrameParser frame-taking method other than ParseAsync, testing raw 1280×720, 1600×900, 2560×1440 (30 cases) and zero OCR calls. Native deck/list/detail inputs retain correct values, and ParseAsync resampling of synthetic 2560×1440 remains supported (including cards and LB); existing tests still exercise sub-1080 refusal and aspect-ratio refusal. Methods without a frame (AssignOwners, Blocks, OutfitTitles, Vocab) do not need a dimension check; frame utility/template/hash algorithms accepting explicit crops are not calibrated screen-parser entrypoints. ParseAsync/ClassifyAsync already normalize. T11 reuse guidance above now explicitly requires normalized frames and reference-space OCR boxes/ROIs; no silent primitive scaling and no calibration threshold changes.
- **SF4 — fixed, fail closed.** Within the same BEGIN IMMEDIATE enqueue transaction, if no captures identity exists but any outbox row does, InvalidDataException is raised **before** inserting a captures hash or any crop. No legacy identity/hash is guessed or backfilled. Regression seeds an old valid veteran payload with attempts=3 and a different new sealed crop-bearing capture; both different and identical new submissions refuse, preserving old payload bytes, row identity, retries/error/due time, and zero added captures/crop_results. Existing duplicate migration (oldest row retained), retry, concurrency and rollback tests still pass. Independent probes combine legacy duplicates with the refusal and additionally exercise finish-existing recovery.

### Explicit legacy recovery (preserve user data)
Pause the uploader and back up the complete SQLite database (with its WAL/SHM if present) before operator-directed recovery. Do not edit/replace the legacy payload or automatically add new crops. Either resume uploading the **existing** pending group unchanged, or explicitly mark a chosen pending item dead (`Dead(item, category)`) and use `Discard(id)` to remove its **whole capture group**, then recapture. The discard regression verifies a new complete group queues only after that explicit removal. Finishing a legacy upload stores veteranId but has no verified payload/crop hash; that old captureId remains fail-closed for enqueue even after acknowledgement. A new capture must use a fresh captureId. No automatic overwrite or data deletion was introduced; duplicate cleanup retains the already-existing round1 migration semantics.

### Nits and limits retained
- Omitted Content-Type HTML remains the **nonblocking** `Retrying / unexpected-response` category rather than `AuthRequired / auth-login-page`. It never completes/deletes the queued veteran, persists no body, and remains retryable. Kept unchanged to avoid expanding bounded production behavior. The retained replay confirms this. Real Access behavior remains H4.
- `text/plain` or `application/problem+json` acknowledgements remain harmless if they satisfy the exact strict veteran acknowledgement schema, ULID, and status/created agreement. No relaxed acknowledgement shape was added.
- The mutable-list seal regression and replay confirm crop-byte, crop-list, field-list, section-name and Complete edits invalidate Uploadable; cosmetic Detail alone does not. No claim of a hostile-same-process trust boundary.
- **H4: all six art-only deck cardIds remain unverified**, prominently retained in H4 step 2 (including tiles 3, 5, 6). No titles or screenshot labels were invented/changed in this round. Windows OCR, actual game rendering, real Access and real veteran imports still need the existing H4 steps after T10.

### Final real verification
Logs, new/adapted probe sources and output are retained under `/Users/willjose/.hermes/cache/scratch/t09fix-r2/`. No original `t09r2/probe/` source/project/output was modified (SHA-256 preservation checked against `original-probe-hashes.json`). Build uses the installed SDK; tests use the explicit isolated native .NET 8 runtime (not roll-forward).

```text
$ /private/var/folders/k3/6ph2csn113x6w4jq66qjms1r0000gn/T/dotnet8/dotnet --list-runtimes
Microsoft.NETCore.App 8.0.31 [/private/var/folders/k3/6ph2csn113x6w4jq66qjms1r0000gn/T/dotnet8/shared/Microsoft.NETCore.App]
$ TMPDIR=/Users/willjose/.hermes/cache/scratch/t09fix-r2 dotnet build Uma.Agent.sln
Build succeeded.
    0 Warning(s)
    0 Error(s)
$ TMPDIR=/Users/willjose/.hermes/cache/scratch/t09fix-r2 dotnet test Uma.Agent.sln --no-build --logger 'console;verbosity=normal' -- RunConfiguration.DotNetHostPath=/private/var/folders/k3/6ph2csn113x6w4jq66qjms1r0000gn/T/dotnet8/dotnet
[xUnit.net] ... (64-bit .NET 8.0.31)
Test Run Successful.
Total tests: 166
     Passed: 166
```
Focused commands were the same native test command with `--filter FullyQualifiedName~Tests.<Class>.` (without the verbose logger). Every command exited 0 with Failed=0, Skipped=0: ReviewRound2Tests 39, CompletenessTests 19, UploadRobustnessTests 22, UploadPipelineTests 3, OutboxTests 4, ContractParityTests 4, SchemaTests 12, SerializationTests 17. This covers the shared fingerprint vectors, JSON Schema/CAPTURE_RULES, upload acknowledgements/crop attachment/auth, migration and completeness; unchanged classes also ran in the full suite.

Accuracy remains **747/747 = 100.00%**, confident-wrong=0, correct-but-low-confidence=3; stats 40/40, stars 120/120, LB 26/26. Full-frame fallback, from the explicit command below, remains **744/747 = 99.60%**, confident-wrong=0, with exactly the same three flagged misses (05 deck/3/level, 13 cards/1/level, 13 cards/6/level).
```text
$ TMPDIR=/Users/willjose/.hermes/cache/scratch/t09fix-r2 dotnet test Uma.Agent.sln --no-build --filter FullyQualifiedName~Full_frame_replay_accuracy --logger 'console;verbosity=detailed' -- RunConfiguration.DotNetHostPath=/private/var/folders/k3/6ph2csn113x6w4jq66qjms1r0000gn/T/dotnet8/dotnet
overall: 744/747 = 99.60%
wrong but confident (silent errors): 0; correct but flagged low_confidence: 5
Passed! (1 test)
```
Adapted retained reviewer replay (only unavailable Add replaced by reflection, raw primitive calls wrapped to show refusal so execution continues; original files read-only):
```text
$ cd /Users/willjose/.hermes/cache/scratch/t09fix-r2/reviewer-replay
$ dotnet build Probe.csproj -o out
Build succeeded. 0 Warning(s), 0 Error(s)
$ TMPDIR=/Users/willjose/.hermes/cache/scratch/t09fix-r2/reviewer-replay /private/var/folders/k3/6ph2csn113x6w4jq66qjms1r0000gn/T/dotnet8/dotnet out/Probe.dll
R1 public Skills.Add available=False
R1 real 01-07: uploadable before=False; after public-mutator absence check uploadable=False skills=14
R3 crop byte -> False; Fields[0] -> False; cosmetic Detail -> True; restored -> True
R4 changed sealed content after upload -> InvalidDataException
   legacy pending + new sealed content -> InvalidDataException; rows=veteran:3
R7 raw ListTilesAsync / DeckAsync / HeldAsync 1280 -> NonReferenceFrameException
   2560 ParseAsync screen=CardsList lb-equal=True card-equal=True
```
Full R1–R9 output, including the late-crop/discard race and acknowledgement matrix, is `reviewer-replay/replay-final.txt`; exact refusal messages include actionable normalized-frame or legacy-recovery guidance.

### Fresh focused independent verification before coordinator merge
Read-only separate verifier verdict **PASS**, no blocking findings: `/Users/willjose/.hermes/cache/scratch/t09fix-r2/independent/report.md`. Its scratch-only build had 0 warnings/errors; native suite passed 165/165, all then-existing 38 round2 cases, accuracy 747/747 and fallback 744/747. Independent empty-buffer probes verify all 30 raw primitives refuse before pixel/OCR access, uploaded/pending changed sealed content refuses, and legacy rows/hash/crops remain unchanged (plus finish-existing recovery). The extra retained-seal test added afterwards does not change production code and passes in the worker's final 166/166 run. Final independent delta verification also passed **166/166** on native .NET 8.0.31 (`independent/final-delta.md`), with no product blockers; it caught an added blank line at this changelog's EOF (diff-check exit 2), which the worker removed before rerunning the clean whitespace gate. No merger action has been taken; coordinator retains that decision.

### Scope / deviations / remaining work
Modified only `agent/src/Uma.Agent.Core/{Frames,Outbox,Parsers,Screens,Session}.cs`, added `agent/tests/Uma.Agent.Core.Tests/ReviewRound2Tests.cs`, and updated this changelog. No new functionality, dependencies, calibration, shared contracts/specs, master bundle, labels/OCR/templates/golden evidence, sibling worktrees, global configuration or credentials changed. No master refresh, pnpm build, deploy, push, history rewrite or main merge. Q-93 and Q-94 remain the existing documented deviations; no new Q or spec edit. H4 is unchanged and is not claimed complete.

```text
$ git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check
(no output; exit 0)
```
