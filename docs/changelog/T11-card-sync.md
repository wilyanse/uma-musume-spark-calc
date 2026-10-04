# T11 — Agent support card sync

- **Status:** Partial. The cross-platform Core work is done and tested. Nothing is wired into the Windows shell yet (T10 calls this API after merge), and nothing has run on real game frames beyond fixtures 13 and 14 (H4).
- **Branch:** task/T11-card-sync (from main 08d4876, which includes the reviewed T06/T09 merge dd16e68)
- **Agent / model:** Claude Opus 5.5 (`claude-opus-5-5`), reasoning medium. No fallback was used.
- **Date:** 2026-10-04

## Summary
`Uma.Agent.Core.Cards` now has three parts:
- **`CardSyncSession`**: a UI-neutral support-card collection for 30 §8. It takes `cards.list` and `cards.detail` frames from `FrameParser.ParseAsync`, reads `Held N`, and de-duplicates scrolled frames relative to their grid position. Ambiguous tiles stay pending with the parser's candidates, and a detail screen resolves them only when bound to an actual pending tile. Duplicates, repeated pages, Held changes, conflicts, unrelated details, out-of-order pages, reset and cancel are all handled deterministically.
- **`OwnedCardsSync`**: the typed 01 §4 body, with wire serialization and a validator kept in parity with the exported schema and `OWNED_CARDS_SYNC_RULES`.
- **`OwnedCardsUploader`**: a real `HttpClient` `PUT /api/v1/owned-cards[?partial=1]` with service-token headers, bounded retry, auth classification, and a strict check of the route's actual `200 {count, partial, syncedAt}` acknowledgement.

On fixture 13 the session collects 20 unique cards with the exact LB list. It stays **partial against Held 208**: this is one screen, not the inventory. Fixture 14 resolves a demoted tile 0 to the same card through the published master.

## Files
Created:
- `agent/src/Uma.Agent.Core/Cards/CardSyncSession.cs`: the session, its state snapshot types, full and partial payload building.
- `agent/src/Uma.Agent.Core/Cards/OwnedCardsSync.cs`: the `OwnedCard`/`OwnedCardsSync`/`OwnedCardsSyncPayload` records, `OwnedCardsSyncJson` and `OwnedCardsSyncValidator`.
- `agent/src/Uma.Agent.Core/Cards/OwnedCardsUploader.cs`: the PUT client, `OwnedCardsRetryPolicy`, `OwnedCardsAck` and the result types.
- `agent/tests/Uma.Agent.Core.Tests/CardsTestKit.cs`: grounded fixture helpers, plus the clearly labelled `Synthetic` sequence builder.
- `agent/tests/Uma.Agent.Core.Tests/CardsFixtureSessionTests.cs`: screenshot- and OCR-grounded tests on fixtures 13/14.
- `agent/tests/Uma.Agent.Core.Tests/CardsSequenceTests.cs`: synthetic sequence tests.
- `agent/tests/Uma.Agent.Core.Tests/CardsContractTests.cs`: schema and rules parity.
- `agent/tests/Uma.Agent.Core.Tests/CardsUploaderTests.cs`: HTTP replay tests against a fake of `owned-cards.ts`.
- `docs/changelog/T11-card-sync.md`: this file.

Modified:
- `docs/OPEN_QUESTIONS.md`: appended Q-150 to Q-153 (from the reserved Q-150..159).

## API for T10 (call after merge; no Windows code was edited)
```csharp
var session = new CardSyncSession(master, layout, clock);          // one per "Capture support cards"
CardFeedResult r = await session.FeedAsync(parser, rawFrame, ct);  // or session.Feed(parsedFrame) if the loop already parsed it
CardSyncState s = session.State;   // Status, HeldCount, Cards, Pending (+Candidates), Conflicts, Segments, Blockers, CanSendFull, PartialConfirmation
session.RequestDetail(pendingId);  // the user clicked a pending tile, then opens that card in game
OwnedCardsSyncPayload p = s.CanSendFull ? session.BuildFull()
                        : session.BuildPartial(s.PartialConfirmation!);   // only after the user confirms PartialConfirmation.Message
var up = new OwnedCardsUploader(new HttpClient(OwnedCardsUploader.CreateHandler()), apiBase, serviceToken /*DPAPI-backed IServiceToken*/, master.Ids["cards"]);
OwnedCardsUploadResult u = await up.SendAsync(p, ct);  // Synced | Invalid | AuthRequired | Rejected | Failed
session.Cancel(); session.Reset();
```
The session ignores non-card screens, so T10 can feed it the same frame stream as the veteran `CaptureCoordinator` while card capture is active.

## Decisions
- **Placement by accepted art only (Q-153).** A list frame is placed against the collection by its tiles with `Card.Ok` and a known master ID. All of those tiles must agree on one offset, and it must be a whole multiple of the 5 layout columns (`cardsList.columns`). A frame is rejected whole if:
  - a matched card repeats in the frame;
  - the matched tiles disagree on the offset, or the offset is a fraction of a row;
  - a different accepted card lands on a known position;
  - a card would end up at two positions.

  A frame with no accepted tile is ignored. Frames that overlap nothing start a new segment, and a later overlapping frame joins segments.
- **Never a confident-wrong ID.** A tile becomes `PendingTile` (`CardId` null, the parser's top-3 candidates and raw text kept) when its art match isn't accepted or its level wasn't read. Pending tiles are never sent. LB is pixel-read; a tile whose LB reading isn't `Ok` is skipped, which leaves a hole that blocks a full sync.
- **Detail binding.** A `cards.detail` frame resolves a pending tile only when all of these hold:
  - its title+name identity (T09 `DetailAsync`, accepted) is a master card;
  - its level was read;
  - the card isn't already collected or in conflict;
  - exactly one pending tile fits: same ID, or the ID is among its candidates, and its level is unknown or equal.

  If several tiles fit, the user selects one (`RequestDetail`). The request is checked the same way, and it stays active until a matching detail arrives. Unrelated details change nothing (the revision is unchanged).
- **Conflicts.** The same position read with a different LB or level, or a pending/confident disagreement, becomes a `CardConflict` with every observation. It is never sent and it blocks a full sync. A repeat of identical reads is a no-op.
- **Held.** Held is taken from the first confident (`Ok`) read. A different confident Held puts the session into `HeldChanged`: frames are ignored and nothing can be built until `Reset`. A low-confidence Held is not used. Without a Held reading there is no full sync and no partial (`heldCount` is required).
- **Full vs partial.** `CanSendFull` needs all of: Held read, unique collected count == Held, no pending tile, no conflict, one segment and no holes. The segment and hole checks guard against a misread Held matching a gappy scan.

  `BuildPartial` requires the exact `PartialSyncConfirmation` (revision, count, Held) the user saw, so a partial is always an explicit user request and never silently built from a single page. Its `Message` warns that the API replaces the whole list (Q-150).
- **Payload invariants.** Every payload passes `OwnedCardsSyncValidator` against the session's master IDs before it is returned:
  - unique `cardId` matching the schema pattern;
  - LB 0..4, level ≥ 1, confidence in [0, 1] (the minimum of art and level confidence, or detail confidence);
  - UTC `capturedAt` from the injected clock (time of the last change);
  - `masterVersion` = the bundle version.
- **Parity.** The validator's constants and messages are tested against `packages/schema/json/OwnedCardsSync.schema.json` and the `OWNED_CARDS_SYNC_RULES` text in `packages/schema/src/capture.ts`. Serialization reuses T09's `CaptureJson.Options` (camelCase, `Z` timestamps, unmapped members disallowed), and deserialization also requires every property.
- **Uploader.** It validates first, so an invalid payload never reaches the network. Responses are classified as follows:
  - **Success:** only HTTP 200 with a JSON object of exactly `count` (= cards sent), `partial` (= the flag sent) and `syncedAt` (a UTC `Z` string). That is the route's actual response; the route was inspected (`c.json({ count, partial, syncedAt: now })`).
  - **`AuthRequired`, not retried:** 401/403, 3xx, HTML, or an off-origin final URI. It reuses T09's `UploadErrors` categories, and `CreateHandler` disables redirects.
  - **`Rejected`, not retried:** other 4xx. The result carries the problem `errors[]` paths and messages.
  - **Retried:** 5xx, 408, 429, network errors, timeouts and non-ack 200s, up to `MaxAttempts` (default 4) with an injected delay of 2 s·2ⁿ capped at 30 s.

  Caller cancellation propagates. Errors are surfaced as categories, never exception messages or bodies. The secret is read per request into headers only.
- **No durable queue (Q-152).** There is no new outbox kind and no Cards database, because a replayed stale whole-table PUT could overwrite a newer sync. Recovery: keep the session open and rebuild the payload (`BuildFull` is deterministic for an unchanged state; this is tested), then send again, or scan again. Nothing card-related is written to disk.

## Deviations from spec
- 30 §8 "Finish: when the unique card count equals `Held N`": count == Held is required, and the session also requires no pending tiles, conflicts, segments or holes. This is stricter, to avoid sending a confident-wrong whole collection.
- 30 §6 outbox: card syncs are not queued durably (Q-152).

## Cross-task edits
- None. No changes to the T09 parser, outbox, layout, schema, API or Windows shell. `docs/OPEN_QUESTIONS.md` changes are appends only.

## Verification
Environment: SDK 10.0.103 builds `net8.0`. Tests run on the isolated native runtime 8.0.31 through `RunConfiguration.DotNetHostPath`; global config is unchanged.

Baseline before any change (worktree at 08d4876):
```
$ /private/var/folders/k3/6ph2csn113x6w4jq66qjms1r0000gn/T/dotnet8/dotnet --list-runtimes
Microsoft.NETCore.App 8.0.31 [/private/var/folders/k3/6ph2csn113x6w4jq66qjms1r0000gn/T/dotnet8/shared/Microsoft.NETCore.App]
$ cd agent && dotnet build Uma.Agent.sln
    0 Warning(s)
    0 Error(s)
$ dotnet test Uma.Agent.sln --no-build -- RunConfiguration.DotNetHostPath=$D8
Passed!  - Failed:     0, Passed:   166, Skipped:     0, Total:   166, Duration: 7 s - Uma.Agent.Core.Tests.dll (net8.0)
```
Tests first (RED: the new tests were written before `Cards/` existed):
```
$ dotnet build Uma.Agent.sln
error CS0234: The type or namespace name 'Cards' does not exist in the namespace 'Uma.Agent.Core' (are you missing an assembly reference?)
error CS0246: The type or namespace name 'CardSyncSession' could not be found (are you missing a using directive or an assembly reference?)
error CS0246: The type or namespace name 'CardSyncState' could not be found (are you missing a using directive or an assembly reference?)
  (22 errors in total)
```
Probe of the real fixture parse (scratch project in `~/.hermes/cache/scratch/t11/probe`, not committed), trimmed:
```
13-support-card-list cards.list held=208 ok=True raw=208/2556Filters: OFF Held Rarity
0 card:the-brightest-star-in-japan-special-week ok=True dhash d=3 margin=13 ... lb=2 lv=40
...
19 card:party-formation-mayano-top-gun ok=True dhash d=6 margin=9 ... lb=0 lv=30
detail card:the-brightest-star-in-japan-special-week ok=True raw=[The Brightest Star in Japan!] / Special Week ... lv=40 True Lvl 40 / 40
```
GREEN (final, at the commit below):
```
$ dotnet build Uma.Agent.sln
    0 Warning(s)
    0 Error(s)
$ dotnet test Uma.Agent.sln --no-build -- RunConfiguration.DotNetHostPath=$D8
Passed!  - Failed:     0, Passed:   231, Skipped:     0, Total:   231, Duration: 6 s - Uma.Agent.Core.Tests.dll (net8.0)
$ dotnet test Uma.Agent.sln --no-build --filter "FullyQualifiedName~Uma.Agent.Core.Tests.Cards" -- RunConfiguration.DotNetHostPath=$D8
Passed!  - Failed:     0, Passed:    65, Skipped:     0, Total:    65, Duration: 1 s - Uma.Agent.Core.Tests.dll (net8.0)
$ DOTNET_ROLL_FORWARD=Major dotnet test Uma.Agent.sln --no-build      # T09's native-runtime guard still fires under roll-forward
  Failed Uma.Agent.Core.Tests.SchemaTests.Runtime_is_native_net8 [1 ms]
Failed!  - Failed:     1, Passed:   230, Skipped:     0, Total:   231
$ dotnet list src/Uma.Agent.Core package    # no new dependencies (exact pins unchanged)
   > Microsoft.Data.Sqlite      10.0.3      10.0.3
   > SixLabors.ImageSharp       3.1.12      3.1.12
```
Acceptance (30 §10 T11, 70 F03 agent side) is covered by `CardsFixtureSessionTests`:
- `Fixture_13_collects_20_cards_with_the_exact_LB_list_and_stays_partial_against_Held_208`: LB `[2,4,4,4,4,0,0,1,0,4,0,4,0,4,4,0,0,4,4,0]` row-major, 20 unique IDs, levels equal the label, `CanSendFull` false, blocker "20 of 208".
- `Fixture_13_tile_0_resolved_by_detail_14_through_the_actual_master`: tile 0 is demoted, then bound by detail 14 to `card:the-brightest-star-in-japan-special-week`, the same ID as the parser's own art match and the label's `sameCardAs`.
- `Raw_supported_sizes_go_through_ParseAsync_and_unsupported_ones_are_refused`: 2560×1440 gives the same LB list; 1280×720 throws `UnsupportedResolutionException` with no state change. A non-reference `ParsedFrame` throws `NonReferenceFrameException`.

The API's count-mismatch rejection is T04's test (`apps/api/test/other-endpoints.test.ts`) and was not re-run here (no TS files touched). `CardsUploaderTests` replays that route's 422 and 200 shapes. **Those fakes are test evidence of client handling, not live verification.**

Mutation check (`~/.hermes/cache/scratch/t11/mutate.py`): each guard was disabled in turn, the Cards tests were run, and the source was restored. All 12 mutations were killed:
```
full ignores segments/holes: build_errors=0 | Failed!  - Failed:     2, Passed:    64,
pending art accepted blindly: build_errors=0 | Failed!  - Failed:     9, Passed:    57,
no row-alignment check: build_errors=0 | Failed!  - Failed:     1, Passed:    65,
held change ignored: build_errors=0 | Failed!  - Failed:     1, Passed:    65,
detail binds to first fit: build_errors=0 | Failed!  - Failed:     1, Passed:    65,
detail level not checked: build_errors=0 | Failed!  - Failed:     1, Passed:    65,
partial confirmation not checked: build_errors=0 | Failed!  - Failed:     1, Passed:    65,
ack count not checked: build_errors=0 | Failed!  - Failed:     2, Passed:    64,
422 retried: build_errors=0 | Failed!  - Failed:     2, Passed:    64,
partial query dropped: build_errors=0 | Failed!  - Failed:     2, Passed:    64,
held rule skipped: build_errors=0 | Failed!  - Failed:     3, Passed:    63,
conflict merged silently: build_errors=0 | Failed!  - Failed:     1, Passed:    65,
```
The first run found 3 surviving mutations (gap/hole with count == Held, row alignment, detail level). Four tests were added for them (`A_gap_blocks_full_even_when_the_count_equals_Held`, `A_hole_inside_the_scanned_range_blocks_full_even_when_the_count_equals_Held`, `A_frame_shifted_by_part_of_a_row_is_rejected`, `Detail_with_a_different_level_does_not_bind_even_when_the_card_is_a_candidate`); the table above is the re-run.

Test inputs: grounded tests use only the real screenshots 13/14 and their recorded OCR. Where a test needs ambiguity, it demotes a real reading and says so in a comment. Sequence tests use the `Synthetic` builder (made-up inventories over real master IDs, blank frames), which is labelled as not a capture. No capture, label, master or fixture file was created or changed.

## Open questions / follow-ups
- Q-150: a partial PUT replaces the whole owned-cards table. The UI must show `PartialSyncConfirmation.Message`; a merge would need an ADR.
- Q-151: whether Held counts distinct cards is unverified. Check at H4.
- Q-152: there is no durable card queue. Recovery is to rebuild from the open session and resend.
- Q-153: scroll placement relies on accepted art matches. Check scroll behaviour at H4.
- **Pending T10 integration:**
  - add the tray "Capture support cards" mode that feeds frames to `CardSyncSession`;
  - show `State` (progress "n of Held", pending tiles with candidates and a "select then open card" action, conflicts, blockers);
  - "Send" / "Send partial" with the confirmation message;
  - `OwnedCardsUploader` with the DPAPI-backed `IServiceToken` and `CreateHandler()`;
  - surface `AuthRequired` → Settings.
- **Pending H4 (Windows, real game):**
  - a full assisted scroll of the real inventory (Held 208 at fixture time) to completion;
  - a real ambiguous tile resolved via detail;
  - one real PUT against the deployed API (needs H2), checking the web S04 list and `syncedAt`.

  Windows OCR and capture may differ from the Apple Vision recordings (30 App. A). Card art thresholds (Q-6) are calibrated on fixture 13 only.
- Fixture coverage: only one list screen and one detail screen exist. Scrolling, Held change, conflicts and multi-candidate details are proven only on synthetic sequences.
