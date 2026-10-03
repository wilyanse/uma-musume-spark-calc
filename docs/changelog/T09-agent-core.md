# T09 — Agent core

- **Status:** Partial. Cross-platform acceptance is met on macOS against the 15 screenshots and recorded OCR. H4 (Windows OCR re-recording and user label verification) is still pending, so do not mark this Done until H4 passes.
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
- **Upload failures:** a crop rejected with 4xx is dead-lettered and its veteran stays queued, so it is never sent without the review crop. 5xx, 408, 429 and transport errors back off exponentially (max 1 h). Credentials come from `IServiceToken` in memory; DPAPI storage is T10's.
- **Native .NET 8:** runtime 8.0.31 installed with the official `dotnet-install.sh --runtime dotnet --channel 8.0 --install-dir $TMPDIR/dotnet8 --no-path`. Tests run through `RunConfiguration.DotNetHostPath`. Global config and the `net8.0` target are unchanged.

## Deviations from spec
- 30 Appendix A: added per-ROI OCR recordings for the deck and card-list levels (Q-91). The full-frame recordings are unchanged and still exercised: without per-ROI files, 708/711 fields are correct, and the 3 misses are flagged, not silent.
- 30 §4: aptitude cells are read with an 8×8 RGB block template plus ±1 px search instead of a raw letter template; ranks are cross-checked against the master rating band (Q-92). The ◯/◎ suffix is decided from pixels (Q-90).
- 30 §5 "complete" checklist: fixture 01 shows only the top of the Skills list (thumb not at the end), so `details.skills` is reported incomplete. The capture is still assembled with the 14 visible skills, because 01 §3 has no missing-skills flag. The tray (T10) should keep asking the user to scroll until the section is complete.

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
- T10: implement `IFrameSource`/`IOcrEngine` on Windows, record OCR in both formats (full frame + per-ROI), drive `CaptureCoordinator.Feed` and show `CaptureSession.Checklist()`, call `UploadOutbox.EnqueueCapture` then `UploadClient.SendNextAsync` in a loop, and provide `IServiceToken` from DPAPI.
- T11: reuse `FrameParser.HeldAsync`, `ListTilesAsync`, `DetailAsync` and `HashMatch`; full sync and dedup are T11's.
- Skills incompleteness is reported only by the checklist (01 §3 has no flag for it).

## H4 — human steps (Windows)
1. On Windows, build T10's shell. For each of the 15 PNGs in `docs/reference/screenshots/`, run `Uma.Agent.Windows --record-ocr` to write `agent/tests/fixtures/ocr/<fixture>.json`. Also write the per-ROI recordings for 05 and 13 (same ROIs as `agent/tests/tools/record_roi_ocr.py`) to `agent/tests/fixtures/ocr-roi/`.
2. Open each `agent/tests/fixtures/labels/<fixture>.json` next to its PNG and confirm or correct every value. Pay particular attention to:
   - star counts, the ◯/◎ suffixes in 01/15, and the clipped rows noted in 03;
   - the deck type icons in 05;
   - guest trainer "Yuuki" in 10;
   - Held 208 and the LB list in 13.
3. Run `dotnet test agent/Uma.Agent.sln` on Windows with .NET 8. The accuracy report must stay ≥ 99% with stats, stars and LB at 100%. If the Windows OCR or capture differs, recalibrate `agent/layouts/global-2026-09.json` and regenerate the templates with `UMA_WRITE_TEMPLATES=1`.
4. Capture 3 real veterans (at least one with a guest parent and one Manual-mode veteran). Scroll each tab until the checklist is complete and confirm the uploads in the web roster. Then import at least 20 veterans and spot-check 3 against the game.
5. Record the result in this changelog under "H4".
