↻ Resumed session 20261004_090305_3d30ec "Independent read-only review of T11 card sync" (1 user message, 49 total messages)
## Verdict: CHANGES_REQUESTED

T11 independent review, round 1. Candidate eb5cd879c343d7d0b67716d139633b91872f8583, base 08d4876, branch task/T11-card-sync.

Provider continuation: GPT-6.1 Sol medium, approved after the prior Opus run encountered HTTP 429. Parent/worker verification and mutation claims were treated as inherited evidence, not independent proof. The native checks and scratch challenges below were freshly executed.

The candidate’s existing suite passes, but independent challenges expose collection, confirmation, mutability and upload-safety defects. No tracked files were edited; no commits, merges, pushes, deployments or credential changes were made. Ending HEAD remains the exact clean candidate.

## Blocking

[B1] agent/src/Uma.Agent.Core/Cards/CardSyncSession.cs:194,345–346,381–394 — Normalization erases known leading holes and breaks subsequent row alignment.

A synthetic edit of fixture 13 makes tile 0’s LB unreadable and changes Held to 19. The session drops tile 0, renumbers positions 1–19 to 0–18, reports CanSendFull=true and builds a 19-card full sync. Refeeding that identical frame then rejects it as “moved by a fraction of a row.”

Required fix: preserve the grid origin and unresolved observed positions when normalizing/merging segments. Distinguish genuinely empty cells from unread occupied cells; known leading/trailing unread tiles must not disappear from completeness checks. Add boundary-hole, repeated-frame and out-of-order regression tests.

[B2] agent/src/Uma.Agent.Core/Cards/CardSyncSession.cs:201,378–379; OwnedCardsSync.cs:11,18–20; OwnedCardsUploader.cs:80–90,152 — Public state/payload boundaries are mutable, and acknowledgement validation uses live caller state rather than the serialized request.

State.Pending[].Candidates exposes the same Candidate[] used internally. Mutating the published array changes internal binding candidates without changing Revision.

Session payload Cards is also an exposed OwnedCard[]. More seriously, an uploader probe supplies a mutable List, sends a serialized 20-card body, removes one entry while the request is in flight, and returns an acknowledgement with count=19. The uploader reports Synced despite sending 20 cards. Retry bytes themselves remained stable in the separate retry probe; the acknowledgement comparison did not.

The public payload record also permits rewriting a partial envelope into a full envelope and changing HeldCount to satisfy validation, bypassing session completeness.

Required fix: defensively copy/freeze ingress and published nested collections. Make session-issued upload envelopes immutable, preserving their validated partial/full provenance. Freeze the expected count/flag alongside the serialized body and use that snapshot for every acknowledgement. Add mutation-before-send, mutation-during-send and partial-to-full boundary tests.

[B3] agent/src/Uma.Agent.Core/Cards/CardSyncSession.cs:27,117–123,137,159–165 — Confirmation and pending handles lack session/generation identity.

Two new sessions can have identical (Revision=1, Cards=20, HeldCount=208) while containing different LB values. Session B accepts session A’s confirmation and builds the changed collection.

Reset also resets _nextPending. An old tile-1 handle for position 0 becomes tile-1 for position 7 after reset; RequestDetail(oldId) returns true and selects the replacement tile.

Required fix: bind confirmations and pending handles to a session/generation identity, plus the relevant immutable state revision/content. Never reuse a stale handle for a different tile. Test replacement sessions, reset/cancel boundaries and stale UI callbacks—not only changes within one session.

[B4] agent/src/Uma.Agent.Core/Cards/CardSyncSession.cs:317–335 — Selecting a pending tile bypasses the candidate identity check.

With fixture 13 tiles 0 and 5 demoted, tile 5’s level synthetically changed to 40, and tile 5 selected, fixture 14 binds Special Week to tile 5 even though its candidates do not contain that card. The resulting partial body contains Special Week with tile 5’s LB=0 rather than tile 0’s LB=2. The automatic branch checks candidate identity; the selected branch does not.

Required fix: apply the documented ID/candidate compatibility checks to selected targets as well. If overriding the candidate set is intentionally supported, expose it as a distinct explicit correction with adequate provenance/confirmation—not ordinary RequestDetail followed by any same-level detail. Unrelated or stale details must not silently resolve the selected tile.

[B5] agent/src/Uma.Agent.Core/Cards/OwnedCardsUploader.cs:77–99; CardSyncSession.cs:130; docs/changelog/T11-card-sync.md:79 — In-memory retries can replay an older whole-table replacement after a newer sync.

A deterministic fake-handler sequence produced replacements 19 → 20 → 19. The newer session succeeded while the older request was waiting to retry; cancelling the older CardSyncSession did not invalidate its already-built payload or retry. Both calls returned Synced, leaving the older 19-card table.

Avoiding a durable queue does not eliminate this hazard. The integration/recovery contract currently does not require serialization and stale-session invalidation.

Required fix: define and exercise an ordering/invalidation contract for whole-table sends. Serialize sends for the same target and reject/cancel stale generations before subsequent attempts. Wire session replacement/reset/cancel to that lifecycle, or provide an explicit tested caller-owned coordinator contract for T10. Do not imply that rebuilding/resending an old session is always safe. No new durable queue or API schema change is required.

[B6] agent/src/Uma.Agent.Core/Cards/OwnedCardsUploader.cs:143–153 — The “exact” acknowledgement accepts duplicate keys and non-ISO timestamps.

Both of these replayed responses returned Synced:

    {"count":20,"count":20,"partial":true,"syncedAt":"2026-10-03T00:00:00.000Z"}
    {"count":20,"partial":true,"syncedAt":"October 3, 2026 00:00:00Z"}

The key loop checks names but not uniqueness; DateTimeOffset.TryParse accepts formats beyond the documented ISO UTC timestamp.

Required fix: require exactly three uniquely named properties, strict count/boolean types, and the documented ISO UTC timestamp syntax. Add duplicate-key and permissive-date-parser cases.

## Should fix

[S1] agent/src/Uma.Agent.Core/Cards/OwnedCardsUploader.cs:119–126 — Every HTML response is classified as an authentication failure before transient status handling. A replayed HTML 502 returned AuthRequired after one attempt instead of bounded retry. Distinguish an Access login response from a generic HTML gateway error; otherwise ordinary outages send users to Settings.

[S2] agent/tests/Uma.Agent.Core.Tests/CardsFixtureSessionTests.cs:123–133 — The selected-unrelated-detail test uses a card already collected elsewhere, so the earlier “already collected” guard masks the selected-target identity defect. Add an unrelated, uncollected same-level card case.

[S3] agent/tests/Uma.Agent.Core.Tests/CardsContractTests.cs:63–84 — Consider graceful invalid results for malformed public DTOs, including null Cards/items/body, rather than treating null Cards as an empty collection or throwing during validation. Keep wire shape validation distinct from business-rule validation.

## Nits

None.

## Checklist

1. Spec conformance: Issues B1–B6. Fixture 13 independently produced 20 master-known cards and exact LB sequence:
   [2,4,4,4,4,0,0,1,0,4,0,4,0,4,4,0,0,4,4,0].
   Held=208, CanSendFull=false, blocker “20 of 208 cards collected.” Fixture 14 resolved tile 0’s identity through the actual published master. T10 integration remains permitted pending work, not completed work.

2. Correctness: Issues above. Existing tests cover ordinary overlap, disconnected segments, bridging, out-of-order pages, duplicates, interior holes, conflicts, Held changes, reset/cancel and ambiguity. Independent probes expose boundary-hole loss, stale handles, selected-detail misbinding and stale replacement replay.

3. Test quality: Existing 231/231 tests and 65/65 Cards tests pass freshly. Six additional required-safety assertions fail against unmodified candidate production in scratch. Independent mutation checks killed ambiguity, interior-hole and confirmation-comparison mutations; removing the automatic detail candidate guard survived all 65 existing Cards tests. Worker mutation claims were not adopted as proof.

4. Fabrication: No hard-coded fixture answers found in Cards production. Grounded coverage uses existing PNGs and recorded OCR; demotions, altered Held/LB/levels, mutable-state challenges and sequence/retry scenarios are explicitly synthetic. Q-151 remains unverified: this review does not establish whether Held counts distinct cards or copies.

5. Security: Service-token headers and no-redirect handler are present; redirect/auth HTML/off-host handling is covered by replay tests. No Cards persistence or new credential storage was introduced. B2/B3/B5 affect destructive-write authorization/order. No credentials or deployed endpoint were used.

6. Free-tier constraints: No new runtime service, paid dependency or durable queue. Inspected the real owned-cards route: partial and full both replace the entire table using DELETE plus optional INSERT in a D1 batch. No live Worker CPU/quota claim is made.

7. Scope: Exact ten-file diff: three Cards production files, five Cards test/helper files, appended OPEN_QUESTIONS and worker changelog. No T09 parser/outbox/schema, Windows shell, master or fixture edits.

8. Maintainability: Dependencies unchanged; build has zero warnings/errors. Public “immutable” snapshots and payload provenance need correction. Recovery and integration documentation must state serialization/invalidation responsibilities. H4, M2 exit, Windows integration and a live deployed PUT are not completed by this review.

## Commands run

Candidate worktree, freshly rerun:

    $ D8=/private/var/folders/k3/6ph2csn113x6w4jq66qjms1r0000gn/T/dotnet8/dotnet
    $ $D8 --list-runtimes
    Microsoft.NETCore.App 8.0.31 [.../dotnet8/shared/Microsoft.NETCore.App]

    $ dotnet --version
    10.0.103

    $ dotnet build Uma.Agent.sln
    Build succeeded.
        0 Warning(s)
        0 Error(s)

    $ dotnet test Uma.Agent.sln --no-build -- RunConfiguration.DotNetHostPath=$D8
    Passed! - Failed: 0, Passed: 231, Skipped: 0, Total: 231

    $ dotnet test Uma.Agent.sln --no-build --filter "FullyQualifiedName~Uma.Agent.Core.Tests.Cards" -- RunConfiguration.DotNetHostPath=$D8
    Passed! - Failed: 0, Passed: 65, Skipped: 0, Total: 65

Independent scratch copy created from git archive of the exact candidate; production files were verified byte-identical after restoring scratch mutations:

    $ dotnet build Uma.Agent.sln
    Build succeeded.
        0 Warning(s)
        0 Error(s)

    $ dotnet test Uma.Agent.sln --no-build --filter "FullyQualifiedName~CardsReviewProbes|FullyQualifiedName~CardsReviewRequiredGuards" --logger "console;verbosity=detailed" -- RunConfiguration.DotNetHostPath=$D8
    Test Run Failed.
    Total tests: 21
         Passed: 15
         Failed: 6

The 15 successful observational probes record behavior; they are not assertions that the safety defects are acceptable. The six failed guard assertions cover leading-hole completeness, cross-session confirmation, stale pending handles, candidate aliasing, selected unrelated details and acknowledgement/count drift.

    $ python3 /Users/willjose/.hermes/cache/scratch/t11-review-r1/mutations.py
    automatic detail candidate guard removed: build_exit=0 test_exit=0
    Passed! - Failed: 0, Passed: 65
    multiple-detail ambiguity guard disabled: build_exit=0 test_exit=1
    Failed! - Failed: 1, Passed: 64
    known holes no longer block full: build_exit=0 test_exit=1
    Failed! - Failed: 1, Passed: 64
    partial revision comparison disabled: build_exit=0 test_exit=1
    Failed! - Failed: 1, Passed: 64
    Restored scratch source.

An earlier scratch mutation experiment included compile-rejected mutations; those are excluded from the behavioral mutation conclusions above.

Final candidate checks:

    $ git -c core.whitespace=cr-at-eol diff --check 08d4876..HEAD
    [no output; success]

    $ git status --porcelain=v1
    [no output; clean]

    $ git rev-parse HEAD
    eb5cd879c343d7d0b67716d139633b91872f8583

    $ git branch --show-current
    task/T11-card-sync

Retained evidence:
    /Users/willjose/.hermes/cache/scratch/t11-review-r1/

Includes scratch probe sources, six required-guard assertions, fresh-probe-output.txt, final-native-output.txt, mutations.py and mutations.json. HTTP results are fake-handler replay evidence only; no live API sync or Windows/game session was performed.

session_id: 20261004_090305_3d30ec
