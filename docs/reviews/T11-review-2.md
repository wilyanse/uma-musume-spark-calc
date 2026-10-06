Verdict: CHANGES_REQUESTED

Candidate afe2fad6a8ec2c12423a59b9401a715303468ec5 on task/T11-card-sync. I reviewed eb5cd879..afe2fad plus regressions, working directly with no other agents, CLIs or orchestration. HEAD and status were the same at the start and the end: afe2fad, clean. Nothing tracked was edited. All HTTP evidence below comes from fake-handler replay. Nothing touched a live API.

Five of the six round-1 findings and all three should-fixes now hold under independent attack. One blocking hole remains in B5: an older envelope can still overwrite a newer sync within the same generation.

Blocking

[R2-B1] agent/src/Uma.Agent.Core/Cards/OwnedCardsUploadCoordinator.cs:52–75; OwnedCardsSync.cs:29; docs/OPEN_QUESTIONS.md:214; docs/changelog/T11-card-sync.md:86
The coordinator only checks which generation a send belongs to. It never checks which snapshot the payload was built from, so an older payload can overwrite a newer one.
- Probe 1 (synthetic session, one generation): build a 20-card partial; it fails after the bounded retries. Scan on and build a 25-card partial; it syncs. A stale UI retry then resends the retained 20-card envelope, and it also syncs.
  - Wire: [20,20,20,25,20]. The remote table ends at 20 cards: older-over-newer.
- Probe 2: a payload built by a replaced or old session, sent under a brand-new generation, returns Synced. The rule "never start a new generation to resend an old scan" exists only in documentation.
- The docs say retrying "a still-current generation" is safe. That is not true for an older retained envelope.

Required fix:
- Put the issuing session's identity, instance, generation and revision into the internal OwnedCardsProvenance.
- Bind each coordinator generation to one session the first time it is used.
- Refuse a payload from another session, or one with a lower revision than the last payload sent in that generation. Equivalently, require the envelope to match the session's current state at send time.
- Add tests for the 20→25→20 resend and for an old session's payload under a new generation.
- Correct Q-154 and the changelog recovery text.

Should fix

[S1] CardSyncSession.cs:222–229. Once a cell is recorded as unknown occupancy (no reading, no confirmation), a later frame that confirms the same cell empty cannot clear it. Probe: an 18-card inventory fed once without confirmation, then again with EmptyCells, stays at "2 tiles … not read" permanently until Reset. Fix: let a confirmed-empty cell remove an UnreadSlot that has no card ID at that aligned position.

[S2] CardSyncSession.cs:222–227. A frame that marks a cell empty where an earlier frame read a card at the same aligned position is accepted. The card stays and CanSendFull remains true. Probe: Synthetic(20), page 0, then the same page with cell 19 confirmed empty. That contradiction suggests misalignment or a classifier error. Reject the frame, as the code already does for a cell that has a reading.

[S3] Test gap in agent/tests/Uma.Agent.Core.Tests/CardsUploadSafetyTests.cs:132–150. The mutant "seal reset on rewrap" (OwnedCardsSync.cs:47 always reseals) survived all 116 Cards tests. Under it, rewrapping a forged body a second time launders it into a valid envelope; HEAD correctly refuses this. Add a double-rewrap assertion.

Nits

[N1] CardsUploadSafetyTests.cs:200, 202, 212, 213, 227, 237 have unbounded coordinator awaits, despite the changelog's "all coordinator waits are bounded." A never-release mutant hung the suite and was only caught by an external hang timeout. Add WaitAsync(Bound).

[N2] The Cancel generation++ in CardSyncSession.cs:156 survived mutation. Cancelled state already blocks RequestDetail and BuildPartial, and Reset increments the generation anyway, so this looks like an equivalent mutant. No action needed.

Checklist

1. Spec conformance.
   - Fixture 13 still gives exactly 20 cards with LB [2,4,4,4,4,0,0,1,0,4,0,4,0,4,4,0,0,4,4,0], Held 208, partial.
   - Fixture 14 still resolves tile 0 through the actual master. All 11 CardsFixtureSessionTests pass, and that file is unchanged since eb5cd87.
   - Full sync still needs count == Held plus no holes, segments, pending tiles or conflicts. Partial still needs an explicit confirmation that carries session identity; its Message states the whole table will be replaced.
   - No durable queue.

2. Correctness.
   - B1 holds. Round-1 case (fixture 13, tile 0 LB unread, Held 19): positions 1–19 kept, CanSendFull=false, identical refeed Collected with revision unchanged.
   - B1 more broadly: a fully unread tile 19 is blocked; whole unread leading and trailing rows are blocked; a one-row scroll aligns. Unknown occupancy is never treated as empty.
   - B2 holds: published-state copies can't affect the session; edited rewraps (LB, capturedAt, masterVersion, Held, partial→full) are Invalid with no request sent; retry bytes are identical across 3 attempts.
   - B3 holds: Reset without Cancel invalidates the confirmation (same 19-card count, different LB) and the old handle (…-8-0-1 vs …-8-1-1).
   - B4 holds: selected unrelated and uncollected same-level details are refused; a matching candidate at the wrong level is refused.
   - B6 holds: refused "２０２６…", lowercase "z", ".Z", 2e0, "2", "false", null syncedAt, extra or case-changed keys, array root, 0000-02-29. Accepted \u005A (JSON-equivalent to Z) and 8-digit fractional seconds (allowed by the schema pattern).
   - S1 holds: generic HTML 502/520/503 retries 3 times then fails; Access sign-in HTML 200 gives AuthRequired after 1 attempt; HTML 404 is Rejected.
   - S3 holds: null DTO, null Cards and null items are Invalid with no network call; Deserialize throws JsonException for null or missing fields.
   - B5 is still open (R2-B1).

3. Test quality.
   - Built 0 warnings, 0 errors. Tests 282/282; Cards 116/116.
   - Mutants (my own, on a scratch copy restored byte-identical afterwards): of 35 run in total, 31 were killed, counting the hang one, and 4 survived. The 4 survivors: seal-reset (S3 above), Cancel generation (N2), a no-op control, and one "B2 published candidates aliased" that the worker had already declared equivalent.
   - The worker's mutation claims were not used as proof.
   - One of my 34 probes failed, and the fault was mine: my expectation was wrong. Inventory position 0 is only ever seen unread, so the session correctly reports 39/40 with 1 hole.

4. Fabrication. No hard-coded answers. Edits to fixtures 13/14 are labelled synthetic. Nothing was regenerated.

5. Security. Secret kept in memory only; Cards code doesn't touch the filesystem; redirect, off-host and Access-page handling intact. The authorization weakness is R2-B1.

6. Free tier. No new service. The route inspected is DELETE plus optional INSERT in one D1 batch, returning {count, partial, syncedAt} via toISOString().

7. Scope. 13 paths since 08d4876, all in Cards, Cards tests, an appended OPEN_QUESTIONS entry and the changelog. diff --check (CRLF-aware) exits 0 for both eb5cd879..HEAD and 08d4876..HEAD.

8. Maintainability. The Q-154 ordering contract needs the R2-B1 correction. Remaining T10/H4 items are integration and real-game checks, not ordinary bugs; the exception is R2-B1, which must not be pushed to T10.

Commands run (in the worktree, then a scratch git-archive copy):

    $ D8=/Users/willjose/.hermes/cache/scratch/t11-fix1/dotnet8/dotnet; $D8 --list-runtimes
    Microsoft.NETCore.App 8.0.31 [.../t11-fix1/dotnet8/shared/Microsoft.NETCore.App]
    $ dotnet --version
    10.0.103
    $ dotnet build Uma.Agent.sln
    0 Warning(s)  0 Error(s)
    $ dotnet test Uma.Agent.sln --no-build -- RunConfiguration.DotNetHostPath=$D8
    Passed!  - Failed: 0, Passed: 282, Total: 282
    $ ... --filter "FullyQualifiedName~Uma.Agent.Core.Tests.Cards"
    Passed!  - Failed: 0, Passed: 116, Total: 116
    $ git -c core.whitespace=cr-at-eol diff --check eb5cd879..HEAD; and 08d4876..HEAD
    exit 0 for both
    $ git status --porcelain=v1; git rev-parse HEAD
    (clean) afe2fad6a8ec2c12423a59b9401a715303468ec5

No global install, TypeScript build, master refresh or fixture overwrite.

Probe sources, outputs and mutation results are in /Users/willjose/.hermes/cache/scratch/t11-review-r2/ (README.txt explains each file).

session_id: 20261006_193601_3b1949
