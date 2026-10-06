# T11 — Agent support card sync

- **Status:** Partial. The cross-platform Core work is done and tested. Nothing is wired into the Windows shell yet (T10 calls this API after merge), and nothing has run on real game frames beyond fixtures 13 and 14 (H4).
- **Branch:** task/T11-card-sync (from main 08d4876, which includes the reviewed T06/T09 merge dd16e68)
- **Agent / model:** original candidate: Claude Opus 5.5 (`claude-opus-5-5`), reasoning medium. Review round 1: started on GPT-6.1 Sol (`gpt-6.1-sol`, `openai-codex`, medium), interrupted by a Sol usage limit, then continued on Claude Opus 5.5 medium. Details in *Review round 1 → Provenance*.
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
- `agent/src/Uma.Agent.Core/Cards/OwnedCardsUploadCoordinator.cs` (review round 1): caller-owned ordering/invalidation for whole-table sends.
- `agent/tests/Uma.Agent.Core.Tests/CardsSessionSafetyTests.cs`, `CardsUploadSafetyTests.cs` (review round 1): B1–B6/S1–S3 regressions.
- `docs/changelog/T11-card-sync.md`: this file.

Modified:
- `docs/OPEN_QUESTIONS.md`: appended Q-150 to Q-153, and Q-154 for the review round 1 amendments (all from the reserved Q-150..159).

## API for T10 (call after merge; no Windows code was edited)
```csharp
// Keep ONE coordinator per API target/account across all session/uploader replacements.
var coordinator = new OwnedCardsUploadCoordinator();             // shell lifetime, NOT per scan/send
var session = new CardSyncSession(master, layout, clock);          // one per "Capture support cards"
var generation = coordinator.BeginGeneration(session);           // explicitly register current scan before any send
CardFeedResult r = await session.FeedAsync(parser, rawFrame, ct);  // or session.Feed(parsedFrame) if the loop already parsed it
CardSyncState s = session.State;   // Status, HeldCount, Cards, Pending (+Candidates), Conflicts, Segments, Blockers, CanSendFull, PartialConfirmation
session.RequestDetail(pendingId);  // the user clicked a pending tile, then opens that card in game
OwnedCardsSyncPayload p = s.CanSendFull ? session.BuildFull()
                        : session.BuildPartial(s.PartialConfirmation!);   // only after the user confirms PartialConfirmation.Message
var up = new OwnedCardsUploader(new HttpClient(OwnedCardsUploader.CreateHandler()), apiBase, serviceToken /*DPAPI-backed IServiceToken*/, master.Ids["cards"]);
OwnedCardsUploadResult u = await coordinator.SendAsync(generation, up, p, ct);
coordinator.Invalidate(generation); session.Cancel();              // same action; invalidate first
// Reset: Invalidate(generation), session.Reset(), then BeginGeneration(session).
// Replacement: construct newSession, then BeginGeneration(newSession); old scan is retired.
// Retry only the same current snapshot revision on the existing handle. Changed scan: rebuild and reconfirm partial.
// Every UI callback retains its originating session AND generation, never the current replacement's handle.
```
The session ignores non-card screens, so T10 can feed it the same frame stream as the veteran `CaptureCoordinator` while card capture is active.

## Decisions
- **Placement by accepted art only (Q-153).** A list frame is placed against the collection by its tiles with `Card.Ok` and a known master ID. All of those tiles must agree on one offset, and it must be a whole multiple of the 5 layout columns (`cardsList.columns`). A frame is rejected whole if:
  - a matched card repeats in the frame;
  - the matched tiles disagree on the offset, or the offset is a fraction of a row;
  - a different accepted card lands on a known position;
  - a card would end up at two positions.

  A frame with no accepted tile is ignored. Frames that overlap nothing start a new segment, and a later overlapping frame joins segments.
- **Never a confident-wrong ID.** A tile becomes `PendingTile` (`CardId` null, the parser's top-3 candidates and raw text kept) when its art match isn't accepted or its level wasn't read. Pending tiles are never sent. LB is pixel-read; an unread occupied tile is retained as an unresolved slot (including boundaries), never skipped. A cell lacking both accepted identity and readable level has unknown occupancy, not proof of emptiness.
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
  - **`AuthRequired`, not retried:** 401/403, 3xx, recognizable Access sign-in HTML, or an off-origin final URI. Generic HTML gateway errors retry boundedly and HTML success is never an acknowledgement. It reuses T09's `UploadErrors` categories, and `CreateHandler` disables redirects.
  - **`Rejected`, not retried:** other 4xx. The result carries the problem `errors[]` paths and messages.
  - **Retried:** 5xx, 408, 429, network errors, timeouts and non-ack 200s, up to `MaxAttempts` (default 4) with an injected delay of 2 s·2ⁿ capped at 30 s.

  Caller cancellation propagates. Errors are surfaced as categories, never exception messages or bodies. The secret is read per request into headers only.
- **No durable queue (Q-152).** There is no new outbox kind and no Cards database, because a replayed stale whole-table PUT could overwrite a newer sync. Recovery: retry only the registered current session generation AND its unchanged current snapshot revision, on the existing coordinator handle. `BeginGeneration(session)` explicitly registers the scan before first send. The coordinator refuses old revisions, foreign/replaced sessions and retired scan registrations; reset/cancel also revoke envelopes through the session freshness check. If collection content changes, build a new payload and reconfirm partial. Never create a fresh generation to replay an older envelope. On app exit, scan again. Cancellation cannot retract already-applied writes or guarantee remote ordering after ambiguous transport failure (no API generation/CAS contract). Nothing card-related is written to disk.

## Deviations from spec
- 30 §8 "Finish: when the unique card count equals `Held N`": count == Held is required, and the session also requires no pending tiles, conflicts, segments or holes. This is stricter, to avoid sending a confident-wrong whole collection.
- 30 §6 outbox: card syncs are not queued durably (Q-152).

## Cross-task edits
- None. No changes to the T09 parser, outbox, layout, schema, API or Windows shell. `docs/OPEN_QUESTIONS.md` changes were initially appends only; round2 corrects the T11-owned Q-154 safety contract in place, as requested.

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
GREEN (original candidate eb5cd87; superseded by *Review round 1 → Verification*):
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

Mutation check on the original candidate (`~/.hermes/cache/scratch/t11/mutate.py`, since pruned; round 1 below re-ran its own): each guard was disabled in turn, the Cards tests were run, and the source was restored. All 12 mutations were killed:
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
- Q-152: there is no durable card queue. Recovery requires the explicitly registered current session and unchanged snapshot revision, not merely a current coordinator handle; otherwise rebuild/reconfirm or scan again.
- Q-153: scroll placement relies on accepted art matches. Check scroll behaviour at H4.
- **Pending T10 integration:**
  - add the tray "Capture support cards" mode that feeds frames to `CardSyncSession`;
  - show `State` (progress "n of Held", pending tiles with candidates and a "select then open card" action, conflicts, blockers);
  - "Send" / "Send partial" with the confirmation message;
  - `OwnedCardsUploader` with the DPAPI-backed `IServiceToken` and `CreateHandler()`, ALWAYS routed through the persistent `OwnedCardsUploadCoordinator`;
  - surface `AuthRequired` → Settings.
- **Pending H4 (Windows, real game):**
  - a full assisted scroll of the real inventory (Held 208 at fixture time) to completion;
  - a real ambiguous tile resolved via detail;
  - one real PUT against the deployed API (needs H2), checking the web S04 list and `syncedAt`.

  Windows OCR and capture may differ from the Apple Vision recordings (30 App. A). Card art thresholds (Q-6) are calibrated on fixture 13 only.
- Fixture coverage: only one list screen and one detail screen exist. Scrolling, Held change, conflicts and multi-candidate details are proven only on synthetic sequences.

## Review round 1
Response to `docs/reviews/T11-review-1.md` (CHANGES_REQUESTED on eb5cd87) and `docs/tasks/T11.fix-1.prompt.md`. All of B1–B6 and S1–S3 were initially reported fixed in this branch; round2 identified the remaining B5 same-generation snapshot hole and corrects it below. No ordinary bug is deferred to T10 or H4. Scope is unchanged: Cards production, Cards tests, an appended open question and this changelog. No shared contract, API, schema, T09, Windows, master or fixture file was edited.

### Provenance
- Fix commits 37dab8a, db27046 and 00954be: started on GPT-6.1 Sol (`gpt-6.1-sol`, `openai-codex`, medium). A Sol usage limit interrupted that run, and it continued on Claude Opus 5.5 (`claude-opus-5-5`) medium. This is as recorded by that run; it ended without a final report, leaving the Q-154 and changelog edits uncommitted.
- Completion pass (this section, two added regression tests, final commit): Claude Opus 5.5 (`claude-opus-5-5`, provider `anthropic`). Worked directly in this worktree, with no sub-agents or orchestration scripts. The inherited uncommitted Q-154 and changelog edits were kept and completed. Before anything else, all three fix commits were read in full against the review.

### Findings
- **B1 (boundary holes and grid origin).** `UnreadSlot` keeps every occupied cell with no accepted identity or no readable LB, boundaries included. Holes now count unread slots. `Normalize` shifts only by whole rows (`floor(first/columns)·columns`), so the grid column and the leading or trailing unread cells survive. A cell with no reading is unknown occupancy. Only `Feed(parsed, confirmedEmptyCells)` declares a cell empty, and a frame that "empties" a cell with a reading is rejected. Detail binding also refuses a card already located at an unread-LB tile. Tests:
  - `Unread_occupied_boundaries_block_full_and_repeated_frames_keep_origin(0|19)`: the review's case, with Held=19 and a leading or trailing unread LB. Full sync stays blocked, and an identical refeed is a no-op instead of a fraction-of-a-row rejection.
  - `No_reading_is_unknown_occupancy_not_proof_of_empty`, `Empty_boundary_cells_require_explicit_confirmation_and_cannot_hide_a_read_card`.
  - `Normalization_keeps_the_grid_column_when_the_first_observed_cell_is_not_column_zero`.
  - `Boundary_holes_survive_out_of_order_disconnected_pages_and_bridges(false|true)`.
  - `Reading_boundary_LB_later_resolves_the_hole_but_empty_cells_do_not_create_holes`.
  - `Detail_cannot_bind_a_card_already_located_at_another_unread_LB_tile(false|true)`.
  - The existing sequence tests now pass the synthetic inventory's explicit empty cells (`Synthetic.EmptyCells`) instead of relying on missing readings.
- **B2 (mutability and envelope provenance).** The design:
  - `OwnedCardsSync.Cards` is copied into a read-only wrapper on construction and on `with`.
  - Ingress candidates and every published nested list (cards, pending, candidates, conflicts, observations, blockers) are frozen copies.
  - `OwnedCardsSyncPayload` has no public constructor or setters. Its non-wire seal (`OwnedCardsProvenance`) survives record copies; round2 adds issuing session object, GUID, instance, scan generation and snapshot revision. Rewrapping an edited body, upgrading partial to full, or changing Held is `Invalid` before any network call.
  - The wire DTO shape and serialization are unchanged, and the serialized bytes contain no provenance.
  - The uploader takes its JSON, expected count and expected partial flag once, before the first await, and uses that snapshot for every attempt and acknowledgement check.

  Tests: `Dto_copies_ingress_and_with_assigned_lists`, `Mutation_during_request_cannot_change_ack_expectations` (the review's 20 sent → list mutated → count=19 ack now gives `Failed`), `Constructor_freezes_cards_before_send_and_retry_snapshot_stays_identical`, `Session_envelope_cannot_be_upgraded_or_have_Held_rewritten`, `Caller_candidates_and_published_nested_lists_cannot_mutate_binding_without_revision` and `Published_conflicts_and_payload_cards_are_frozen`. This is ordinary public-API safety, not a defence against hostile code in the same process.
- **B3 (session and generation identity).** `PartialSyncConfirmation` carries an injected-or-random session GUID, a process-unique session instance and a generation, alongside revision, count and Held. Its public constructor creates an unauthorized confirmation. Pending handles are `tile-{session}-{instance}-{generation}-{n}`. `Reset` and `Cancel` advance the generation, so a stale handle or confirmation never matches the replacement. Tests:
  - `Confirmation_cannot_authorize_a_different_session_even_with_equal_counts_and_revision`: the review's two sessions with the same revision and count but different LB.
  - `Pending_handles_are_not_reused_between_sessions_reset_or_cancel`.
  - `Injected_identity_cannot_collide_and_confirmations_have_no_rewritable_revision`: a deterministic injected GUID used by two sessions.
  - New in this pass: `Reset_alone_never_reuses_a_pending_handle_for_a_different_tile`.
- **B4 (selected target identity).** A selected tile now goes through the same `FitsIdentity` check as the automatic path (same ID, or the ID is among its candidates), plus the level check and the "matched to another tile" check. Manual override of the candidate set is out of scope and not exposed. Test: `Unrelated_uncollected_same_level_detail_cannot_bind_selected_or_automatic_tile(false|true)`.
- **B5 (ordering of whole-table writes).** New `OwnedCardsUploadCoordinator`, owned by the caller (T10). Keep one per API target for the shell's lifetime. How it behaves:
  - `BeginGeneration(session)` explicitly binds the scan and cancels the previous generation (round2 replaces the original parameterless API). `Invalidate(g)` cancels only `g`, so a stale cancel callback can't kill its replacement.
  - `SendAsync(g, uploader, payload)` refuses a non-current generation before doing anything, and binds the target URI on first use. A replacement uploader for another target is refused.
  - Sends are serialized through completion, retries included. The uploader runs on a token linked to the generation, and a success that completes after replacement is never published.

  It has no durable queue and changes no API. The limits are documented truthfully in the class XML docs, the API section above and Q-154: cancellation cannot undo a PUT the server already received, and without an API generation/CAS check, remote order after an ambiguous transport failure is not guaranteed. Tests:
  - `Newest_replacement_forbids_old_retry_19_20_19`: the review's deterministic sequence. The wire now sees only [19, 20]: the old retry is cancelled, the old generation can't resend, and the newest wins.
  - `Replacement_waits_for_noncooperative_inflight_request_then_sends_newest`: max concurrency 1, including across a replacement uploader.
  - `Invalidation_stops_retries_even_when_delay_ignores_cancellation`.
  - `A_success_that_completes_after_replacement_is_never_published`.
  - `Auth_repair_reuses_coordinator_and_never_resurrects_stale_generation`, `Auth_repair_for_still_current_generation_is_allowed`.
  - `Coordinator_rejects_foreign_generation_and_changed_target`.
  - New in this pass: `Stale_generation_send_is_refused_before_it_can_bind_the_coordinator_target`.

  The round-1 bounded-wait claim was incomplete: review round2 N1 found six unbounded coordinator awaits. Round2 adds `WaitAsync(Bound)` to all such awaits and assertion delegates; the never-release mutant is checked against the test deadline itself.
- **B6 (strict acknowledgement).** The acknowledgement must have exactly three uniquely named properties, an Int32 JSON-number `count`, a JSON-boolean `partial`, and a `syncedAt` string matching the exported `IsoUtc` schema pattern (`OwnedCardsSyncJson.IsoUtcPattern`, asserted equal to `capturedAt.pattern` in `OwnedCardsSync.schema.json`). It is parsed only after that match. The route's real `syncedAt` is `Date.prototype.toISOString()` (`apps/api/src/http.ts` `nowIso`), which matches. `OwnedCardsSyncJson.Deserialize` uses the same uniqueness, type and timestamp rules. Tests: `Duplicate_keys_and_non_ISO_dates_are_not_acknowledgements` (both review payloads), `Every_ack_key_is_unique_and_types_are_strict`, `Strict_ack_accepts_schema_ISO_UTC_forms`, `Strict_ack_refuses_invalid_calendar_and_non_schema_UTC_forms` and the extended `Deserialize_is_strict`.
- **S1 (HTML responses).** 3xx, 401/403 and off-origin responses are still `AuthRequired`. Below 500, HTML counts as auth only when it is recognisably the Cloudflare Access sign-in page ("Cloudflare Access" and "Sign in"). Any other HTML follows its status: a 502 is retried within the bound, and an HTML 200 is never an acknowledgement (retried, then `Failed`). Tests: `Generic_HTML_502_retries_not_auth`, `Generic_HTML_has_bounded_retry_not_auth(200|502)`, `HTML_success_with_JSON_ack_bytes_is_never_acknowledged`. The existing Access-login and redirect replay tests still pass.
- **S2.** Covered by the B4 test: tile 5's candidates exclude Special Week and Special Week is not collected anywhere, so the "already collected" guard cannot mask the identity guard. The automatic variant removes tile 0 so ambiguity cannot mask it either.
- **S3 (malformed public DTOs).** `OwnedCardsSyncValidator.ValidateSchema` (shape and range) is separate from `Validate` (adds the duplicate, master-ID and held-count business rules). A null body, null `Cards` or a null item gives `Invalid`/`invalid-schema` with no request sent. Null `Cards` is no longer treated as empty, and nothing throws NullReferenceException. Tests: `Shape_validation_is_separate_from_business_validation`, `Malformed_public_DTOs_are_invalid_without_network`.

### Commits
- 37dab8a: fixed the reviewed collection and whole-table upload safety (B1–B6, S1–S3, plus the new coordinator and safety test files).
- db27046: killed the surviving boundary-origin and obsolete-success mutants, and bounded the coordinator waits.
- 00954be: refused detail binding over an unread-LB located card, and made JSON number types strict.
- Final commit (this pass): two regression tests that kill the surviving mutants found below, Q-154 and this section.

### Verification (completion pass, exact output)
The isolated host named in the prompt (`/private/var/folders/.../T/dotnet8`) had been partly pruned by macOS temp cleanup: 72 files, no `.deps.json`, and `--list-runtimes` printed nothing, so the test host aborted ("Test Run Aborted", framework 8.0.0 not found). The same official runtime was re-extracted into the scratch dir. No global install or config change was made, and the old directory was left untouched.
```
$ curl -sSL -o rt.tgz https://builds.dotnet.microsoft.com/dotnet/Runtime/8.0.31/dotnet-runtime-8.0.31-osx-arm64.tar.gz
$ shasum -a 512 rt.tgz      # equals the sha512 in the official 8.0 releases.json
1963d2ab3798efdc2b33034ef57d4252849a066a2313ce62a574e556d19e5e981afe13c9545eb6d59437849723e1c8350f10f8068bcfa6b7a2815a07263bb8b3
$ D8=/Users/willjose/.hermes/cache/scratch/t11-fix1/dotnet8/dotnet
$ $D8 --list-runtimes
Microsoft.NETCore.App 8.0.31 [/Users/willjose/.hermes/cache/scratch/t11-fix1/dotnet8/shared/Microsoft.NETCore.App]
$ dotnet --version
10.0.103
```
Inherited HEAD 00954be before this pass's test additions: `Passed!  - Failed: 0, Passed: 280, Skipped: 0, Total: 280` (Cards: 114).

Independent mutation pass (`/Users/willjose/.hermes/cache/scratch/t11-fix1/mutations.py`) on a `git archive HEAD` copy, never the worktree. One mutant per finding guard; each was compiled under TreatWarningsAsErrors, the Cards tests were run, and the source was restored. Of the first 24, 19 were killed, 2 didn't compile (re-expressed in the next run), and 3 survived:
```
SURVIVED B2 published candidates aliased
SURVIVED B3 reset keeps generation
SURVIVED B5 stale generation accepted
```
- *B3 reset keeps generation* was a real gap. With no `Cancel`, `Reset` reused handle `tile-…-1-0-1` for a different tile. The new test `Reset_alone_never_reuses_a_pending_handle_for_a_different_tile` fails on that mutant (`Assert.NotEqual() Failure: Strings are equal … "tile-ed649402197843b68677dd7a1dd46244-1-0-1"`, `Failed: 1`) and passes on HEAD production.
- *B5 stale generation accepted*: with the up-front check removed, the token check still stopped the send, but a stale callback could first pin the coordinator to its own uploader's target and so break the current generation's send. The new test `Stale_generation_send_is_refused_before_it_can_bind_the_coordinator_target` fails on that mutant (`System.ArgumentException : Uploader must address the coordinator's same target`, `Failed: 1`) and passes on HEAD production.
- *B2 published candidates aliased* is an equivalent mutant, so it is not a test gap. The snapshot's `p.Candidates` is already the read-only wrapper frozen on ingress or merge, so dropping the second `Freeze` changes no behaviour. The mutation-refusal assertions in `Caller_candidates_and_published_nested_lists_cannot_mutate_binding_without_revision` still hold.

Re-run with the new tests (`mutations-output-2.txt`): every guard mutant is killed except the equivalent one above. The re-expressed provenance mutant (`B2 envelope provenance ignored`) and the selected-identity mutant (`B4 selected target identity check removed`) are both KILLED (`Failed: 1`). The stale-generation mutant was confirmed killed separately (output above).

Final, at the commit below (worktree tree identical):
```
$ cd agent && dotnet build Uma.Agent.sln
Build succeeded.
    0 Warning(s)
    0 Error(s)
$ dotnet test Uma.Agent.sln --no-build -- RunConfiguration.DotNetHostPath=$D8
Passed!  - Failed:     0, Passed:   282, Skipped:     0, Total:   282, Duration: 6 s - Uma.Agent.Core.Tests.dll (net8.0)
$ dotnet test Uma.Agent.sln --no-build --filter "FullyQualifiedName~Uma.Agent.Core.Tests.Cards" -- RunConfiguration.DotNetHostPath=$D8
Passed!  - Failed:     0, Passed:   116, Skipped:     0, Total:   116, Duration: 1 s - Uma.Agent.Core.Tests.dll (net8.0)
$ DOTNET_ROLL_FORWARD=Major dotnet test Uma.Agent.sln --no-build      # native-runtime guard still fires
  Failed Uma.Agent.Core.Tests.SchemaTests.Runtime_is_native_net8 [< 1 ms]
Failed!  - Failed:     1, Passed:   281, Skipped:     0, Total:   282
$ dotnet list src/Uma.Agent.Core package     # unchanged pins
   > Microsoft.Data.Sqlite      10.0.3      10.0.3
   > SixLabors.ImageSharp       3.1.12      3.1.12
$ git -c core.whitespace=cr-at-eol diff --check 08d4876      # no output, exit 0
```
Fixture identity is unchanged: `CardsFixtureSessionTests.cs` has no diff since eb5cd87, and all 11 of its tests pass. These include `Fixture_13_collects_20_cards_with_the_exact_LB_list_and_stays_partial_against_Held_208` (20 unique cards, LB `[2,4,4,4,4,0,0,1,0,4,0,4,0,4,4,0,0,4,4,0]`, Held 208, partial) and `Fixture_13_tile_0_resolved_by_detail_14_through_the_actual_master`. No evidence, master or fixture was regenerated, and pnpm was not run. The diff from 08d4876 touches only `agent/src/Uma.Agent.Core/Cards/*`, `agent/tests/Uma.Agent.Core.Tests/Cards*`, `docs/OPEN_QUESTIONS.md` (append only) and this file.

HTTP behaviour is fake-handler replay of the inspected route (`apps/api/src/routes/owned-cards.ts`: DELETE plus optional INSERT in one D1 batch, then `c.json({ count, partial, syncedAt: now })`). This is not live verification. The review's scratch probes (`~/.hermes/cache/scratch/t11-review-r1/`) had been pruned before this pass and could not be re-run as-is; the review's six failed guard scenarios are re-expressed as the regression tests named above.

### Remaining (not done here)
- T10: one `OwnedCardsUploadCoordinator` per target, generation lifecycle on scan create, replace, reset and cancel, UI callbacks bound to their own session and generation, and verified empty cells (or accept that a partly filled last row blocks full sync through `FeedAsync`).
- H4 (Windows, real game): Q-151 (Held distinct vs copies), real scroll behaviour and empty-last-row handling (Q-153/Q-154), a real ambiguous detail, and one live PUT against the deployed API (needs H2).
- This branch does not complete M2 or the independent re-review of round 1; the parent runs that review.

## Review round2

### Provenance and tests-first milestone
- Implemented directly with GPT-6.1 Sol (`gpt-6.1-sol`, `openai-codex`), approved medium fallback. The user reported a preceding Anthropic HTTP 429; this run did not observe or independently verify that provider response. No worker/model CLI, orchestration script or subagent was used. Initial inspection found clean HEAD `afe2fad6a8ec2c12423a59b9401a715303468ec5`; no inherited dirty work existed.
- Governing inputs: coordinator-owned absolute `docs/tasks/T11.fix-2.prompt.md`, `docs/reviews/T11-review-2.md`, original prompt, round-1 review, AGENTS and specs 00/01/30/70/80. Retained reviewer probe source/output inspected without editing the originals.
- Native runtime discovered intact at `/Users/willjose/.hermes/cache/scratch/t11-fix1/dotnet8/dotnet`: `Microsoft.NETCore.App 8.0.31`. No install or global change.
- Baseline: `cd agent && dotnet build Uma.Agent.sln && dotnet test Uma.Agent.sln --no-build -- RunConfiguration.DotNetHostPath=/Users/willjose/.hermes/cache/scratch/t11-fix1/dotnet8/dotnet` returned `0 Warning(s)`, `0 Error(s)` and `Passed! - Failed: 0, Passed: 282, Skipped: 0, Total: 282`.
- RED, before any production edits: added `CardsReviewRound2SafetyTests.cs` against the existing parameterless generation API. `dotnet test Uma.Agent.sln --filter FullyQualifiedName~CardsReviewRound2SafetyTests -- RunConfiguration.DotNetHostPath=/Users/willjose/.hermes/cache/scratch/t11-fix1/dotnet8/dotnet` returned `Failed! - Failed: 12, Passed: 2, Skipped: 0, Total: 14`. Missing stale-send exceptions and accepted contradictory frames were actual assertion failures. The double-rewrap and identical-current-payload controls passed on existing production. The tests' generation calls will migrate to explicit session registration with the fix.

### Findings and implementation milestone
- R2-B1: `BeginGeneration(CardSyncSession)` is the only registration API. Its handle binds the actual issuing session object and immutable GUID/instance/scan-generation identity before any send, never the first submitted envelope. Retired scan identities cannot be re-registered; Reset creates a genuinely new scan identity. `OwnedCardsProvenance` additionally seals the immutable snapshot revision, body and partial flag. Record copies/rewraps preserve that original seal. No wire DTO field changed.
- R2-B1: freshness is checked before target binding, again after the serialized gate wait, before/after each retry delay and before publishing the result. The per-generation revision watermark advances monotonically inside the serialized gate before the uploader's first await; failure does not roll it back. Identical unchanged-current payload retries are allowed. Concurrent Feed changes prevent another old HTTP attempt or obsolete UI success, without pretending an already-received HTTP request can be undone. Direct uploader calls are transport-only; T10 must use the actual tested public coordinator API above.
- S1: aligned explicit-empty evidence removes only `UnreadSlot(null)` on the frame's transactional clone. Synthetic18 initially has two unknown trailing holes, then explicit empty confirmation clears both; it can build a full 18-card payload. Unknown occupancy elsewhere still blocks full sync. Scroll/out-of-order tests preserve row/column positions.
- S2: explicit emptiness at a previously occupied aligned position rejects the whole frame without changing revision, capture time, cards or prior payload. Synthetic20 empty-cell19 and both page0/page5 offsets are exercised. A previously valid full snapshot stays valid but the contradictory frame adds no new authorization. Confident false-empty classification is an optional T10/H4 integration risk; core contradiction rejection is fixed here, not deferred.
- S3: double-rewrap forged-body regression added, with an unchanged valid double-rewrap and immutable caller-list control. Production already preserved the seal; the regression targets the review's reseal mutant.
- N1: all coordinator await/assertion-delegate paths in `CardsUploadSafetyTests` now use `WaitAsync(Bound)`; rendezvous waits and all new safety-test waits are bounded too. Existing coordinator tests migrated from fabricated unissued DTOs to actual synthetic session-issued envelopes, preserving their count/ordering assertions.
- N2: no production change requested. Cancel's generation increment mutant is equivalent while cancelled state and Reset generation advancement remain; retain the current implementation.
- Additional boundaries: parameterless API absent; retired scan registration refused; reset with an identical wire body cannot authorize an old envelope; reused injected GUID with equal body/revision cannot alias an instance; queued envelopes revalidated after gate entry; pre-cancelled calls cannot bind target; unissued/edited bodies cannot provide snapshot authority.
- GREEN: `cd agent && dotnet build Uma.Agent.sln && dotnet test Uma.Agent.sln --no-build -- RunConfiguration.DotNetHostPath=/Users/willjose/.hermes/cache/scratch/t11-fix1/dotnet8/dotnet` returned `Build succeeded. 0 Warning(s) 0 Error(s)` and `Passed! - Failed: 0, Passed: 302, Skipped: 0, Total: 302`. An intermediate new-test build failed on xUnit2031 (Assert.Single filtered with Where); the assertion was changed to its predicate overload, and the command above was rerun successfully.
- Scope: four Cards production files, new Cards round2 tests, CardsUploadSafetyTests, T11-owned Q-154 correction and this changelog only. Shared schema/API/T09/Windows/master/fixtures remain unchanged. Parent independent re-review is still mandatory; no merge/push/deploy. This final fix budget is exhausted after candidate handoff: escalate any remaining blocking review findings rather than silently starting another fix round.

### Final verification and retained evidence
```
$ cd agent
$ dotnet build Uma.Agent.sln
Build succeeded.
    0 Warning(s)
    0 Error(s)
$ dotnet test Uma.Agent.sln --no-build -- RunConfiguration.DotNetHostPath=/Users/willjose/.hermes/cache/scratch/t11-fix1/dotnet8/dotnet
Passed!  - Failed:     0, Passed:   302, Skipped:     0, Total:   302, Duration: 7 s
$ dotnet test Uma.Agent.sln --no-build --filter FullyQualifiedName~Uma.Agent.Core.Tests.Cards -- RunConfiguration.DotNetHostPath=/Users/willjose/.hermes/cache/scratch/t11-fix1/dotnet8/dotnet
Passed!  - Failed:     0, Passed:   136, Skipped:     0, Total:   136, Duration: 1 s
$ dotnet test Uma.Agent.sln --no-build --filter FullyQualifiedName~CardsFixtureSessionTests -- RunConfiguration.DotNetHostPath=/Users/willjose/.hermes/cache/scratch/t11-fix1/dotnet8/dotnet
Passed!  - Failed:     0, Passed:    11, Skipped:     0, Total:    11, Duration: 1 s
```

Retained runnable copy and evidence: `/Users/willjose/.hermes/cache/scratch/t11-fix2/`, documented in `README.txt`. Created using `mkdir -p .../copy && git archive HEAD | tar -x -C .../copy` at implementation milestone `4cfc584`, then copied the final test refinements. Production restored byte-identical to the worktree after all mutations; hashes in `restored-source-sha256.json`. Original reviewer sources were left untouched.

Adapted `copy/agent/tests/Uma.Agent.Core.Tests/CardsReviewR2Probes.cs` uses explicit session registration and bounded waits, moves collect25 until after the failed20 send, adds safety assertions, and corrects the reviewer's acknowledged wrong expected-full assertion (position0 is only seen unread: 39/40 plus a hole). Other observational probes are retained as observations, not misrepresented as new strict guard assertions.
```
$ cd /Users/willjose/.hermes/cache/scratch/t11-fix2/copy/agent
$ dotnet test Uma.Agent.sln --filter FullyQualifiedName~CardsReviewR2Probes --logger 'console;verbosity=detailed' -- RunConfiguration.DotNetHostPath=/Users/willjose/.hermes/cache/scratch/t11-fix1/dotnet8/dotnet
Test Run Successful.
Total tests: 34
     Passed: 34
OBS older=Failed newer=Synced stale-resend=REFUSED; wire=[20,20,20,25] -> final remote table 25 cards
OBS stale session payload with new generation: REFUSED; no request sent
OBS Collected then confirmed Collected: canFull=True blockers=
OBS confirmed-empty over earlier read card: Rejected an explicitly empty cell contradicts an earlier occupied reading; frame not used cards=20 canFull=True
$ dotnet build Uma.Agent.sln
Build succeeded.
    0 Warning(s)
    0 Error(s)
$ dotnet test Uma.Agent.sln --no-build -- RunConfiguration.DotNetHostPath=/Users/willjose/.hermes/cache/scratch/t11-fix1/dotnet8/dotnet
Passed!  - Failed:     0, Passed:   336, Skipped:     0, Total:   336, Duration: 7 s
$ dotnet test Uma.Agent.sln --no-build --filter FullyQualifiedName~CardsReviewRound2SafetyTests --logger 'console;verbosity=detailed' -- RunConfiguration.DotNetHostPath=/Users/willjose/.hermes/cache/scratch/t11-fix1/dotnet8/dotnet
Test Run Successful.
Total tests: 20
     Passed: 20
wire=[20,20,20,25]; final remote=25; stale20 refused
old session -> refused before target binding; current -> Synced; wire=[20]
identical current payload: Failed(3), Synced(1); all four wire bodies identical
inflight update: wire=[20,25]; final remote=25
```
The “remote” values here mean the simulated fake-handler wire's final replacement, not a live API/database observation. The 336 total is the 302 candidate tests plus 34 adapted retained probes, not a changed production baseline. Actual logs: `probe-output.txt` and `safety-wire-output.txt`.

Targeted mutation verification used one scratch-source edit at a time, then `dotnet build Uma.Agent.sln -nologo -v q` (all compiled) and `dotnet test Uma.Agent.sln --no-build --filter FullyQualifiedName~<filter> -- RunConfiguration.DotNetHostPath=/Users/willjose/.hermes/cache/scratch/t11-fix1/dotnet8/dotnet`. Exact old/new/filter and results are in `mutations.json`; full output in `mutant-*.txt`. Nine unique mutants: eight killed, one expected equivalent survivor.
- Seal reset on rewrap: `Double_rewrap_never_reseals` failed, `Expected: Invalid`, `Actual: Synced`, `Failed: 1, Passed: 0, Total: 1`. The test fake now acknowledges the sent query flag for both forged full and valid partial; the first mutation trial killed it as `Actual: Failed` because the fake ACK had the wrong flag, so that initial output is not used as the final proof. Confirmed output: `mutant-seal-reset-double-rewrap-confirmed.txt`.
- Serial gate never released: `Identical_current_payload_can_retry` failed with `System.TimeoutException : The operation has timed out.`, `Failed: 1, Passed: 0, Total: 1, Duration: 5 s`. The test-owned `WaitAsync(Bound)` fired. The foreground tool's 45-second external deadline was supporting only and did not fire; no hang polling or process kill was used.
- Session revision guard removed: `CardsReviewRound2SafetyTests` returned `Failed: 4, Passed: 16, Total: 20`.
- Issuing-session binding removed: old-session/fresh-generation guard returned `Failed: 1, Passed: 0, Total: 1`.
- Post-delay freshness guard removed: delay-update test returned `Expected: 1`, `Actual: 2`, `Failed: 1, Passed: 0, Total: 1` (the stale second HTTP attempt was observed).
- Unknown empty cell not cleared: clearing test returned `Expected: True`, `Actual: False`, `Failed: 1, Passed: 0, Total: 1`.
- Earlier occupied/empty contradiction ignored: synthetic20/cell19 test returned `Expected: Rejected`, `Actual: Collected`, `Failed: 1, Passed: 0, Total: 1`.
- Watermark not advanced: 20→25 regression checks the watermark before the first HTTP await and after bounded failure; mutant returned `Expected: 1`, `Actual: -1`, `Failed: 1, Passed: 0, Total: 1`.
- N2 Cancel generation increment removed: `Passed! - Failed: 0, Passed: 170, Skipped: 0, Total: 170` (136 Cards tests plus 34 scratch probes). Expected equivalent survivor; no production change.

Fixture13/14 identities, exact 20 LB sequence, Held208 partial status and real-master detail resolution remain covered by the unchanged 11 fixture-session tests. `git diff eb5cd87 -- agent/tests/Uma.Agent.Core.Tests/CardsFixtureSessionTests.cs` produced no output. No fixture/master/label generation or TS build was run.

`git -c core.whitespace=cr-at-eol diff --check afe2fad` and `git -c core.whitespace=cr-at-eol diff --check 08d4876` both returned no output, exit0 before final documentation commit. Eight changed paths since the reviewed candidate, all within the stated ownership. Milestones: `bf5b9d0` tests-first RED; `4cfc584` implementation GREEN; final verification/test-refinement/documentation commit follows.

Known limits and gate: HTTP already received by a server cannot be undone, and a timed-out HTTP request may still apply later. The unchanged API has no server-side revision/CAS check, so absolute remote ordering after ambiguous in-flight failure is not claimed. Explicit session registration still requires T10 to choose the actual current UI session and keep one coordinator per target/account; the core now enforces the registered instance/generation/revision, rather than trusting a stale-envelope retry rule only in docs. T10 shell wiring, H4 real-game classifier/scroll validation and live API verification remain pending. Parent independent re-review must approve this clean committed candidate before any merge; escalate remaining blockers after this final fix budget.

## Coordinator merge verification

Independent final review PASS: `docs/reviews/T11-review-3.md`, reviewer session `20261006_211923_8d0ed1`, candidate `8b1a8da259e625eb8ee91ec8a18d98d0acbe9a92`. Merged locally as `4ee0426b6ca5b87d2914cf356498fddfae3225b6`. No push/deployment.

```
$ dotnet build agent/Uma.Agent.sln
Build succeeded. 0 Warning(s), 0 Error(s).
$ dotnet test agent/Uma.Agent.sln --no-build -- RunConfiguration.DotNetHostPath=/Users/willjose/.hermes/cache/scratch/t11-fix1/dotnet8/dotnet
Passed! Failed: 0, Passed: 302, Skipped: 0, Total: 302
$ pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm --filter web build
All lint/typecheck projects Done. Tests: schema149, master-data82, API111, engine240, web5 passed.
Vite: 146 modules transformed; built in112ms. Exit0.
```

These are merged-main checks before T13 merge; web5 is the existing skeleton, not the unmerged T13 screen suite. No remaining review findings; T10 coordinator wiring, H4 real-game/empty-cell/Held validation and deployed live PUT remain pending.
