Verdict: PASS

T11 final focused independent review r3.
Candidate: 8b1a8da259e625eb8ee91ec8a18d98d0acbe9a92
Branch: task/T11-card-sync
Focus: afe2fad..HEAD, with round-1 regression checks.

Reviewed directly, without delegation, orchestration or model CLIs. Read coordinator-owned round-2 review/fix instructions, prior review, original task prompt, current review rules, governing contracts and worker changelog. Worker probe/mutation claims were supporting material, not independent proof.

Blocking
None found.

Should fix
None.

Nits
None. N2 remains an acceptable equivalent mutant; no production change requested.

Focused findings

R2-B1: fixed.
- Independently reproduced 20-card partial → three failed attempts → collect 25 → successful 25-card partial → stale 20-card retry.
- Observed wire: [20,20,20,25]. The stale retry throws before another request.
- An unchanged current envelope remains retryable, including after bounded failure.
- BeginGeneration(session) explicitly registers the session rather than trusting the first submitted payload. Enforcement includes issuing object, session GUID, instance, scan generation and current revision.
- A different session’s envelope cannot use the fresh generation, even when injected GUID, revision and wire body match. Refusal happens before target binding.
- Retired scan registration is refused; invalidating an old handle does not invalidate its replacement.

Freshness and cancellation gates: verified.
- OwnedCardsUploadCoordinator.cs:72–96 checks freshness before target binding, after semaphore acquisition and during guarded transport calls; lines 98–100 suppress obsolete results.
- OwnedCardsUploader.cs:101–107 checks before and after retry delay, including a delay that ignores cancellation.
- Independent equal-count challenges increased revision from 1 to 2 while keeping 20 collected cards. Before-send, in-flight, retry-delay and queued-send cases all refused the old envelope. HTTP attempts were respectively 0, 1, 1 and 1.
- Reset, Cancel and generation replacement during an in-flight acknowledgement prevented obsolete success publication and subsequent stale sends.
- Watermark advancement is inside the serialized gate and does not roll back after failure.

S1: fixed.
- Later aligned confirmed-empty evidence clears unknown UnreadSlot(null) cells.
- Identified unread slots and pending occupied tiles cannot be erased by an empty declaration.
- Unknown occupancy remains conservative; absent readings do not imply emptiness.

S2: fixed.
- Confirmed-empty evidence over an earlier occupied aligned cell rejects the complete frame.
- Independently challenged a bridge joining two disconnected scroll segments. Rejection preserved revision, capture time, both segments and all prior cards; the subsequent noncontradictory bridge joined normally.
- Existing page-0/page-5 and synthetic20/cell19 regressions also pass.

S3: fixed regression coverage.
- Double-rewrapping a forged body does not reseal it.
- Valid rewraps retain immutable card collections, and caller-list mutation during requests cannot alter retry bytes.
- Independent reseal mutant produced Expected: Invalid / Actual: Synced, demonstrating that the assertion detects laundering rather than an unrelated acknowledgement mismatch.

N1: fixed.
- Coordinator awaits/assertion delegates in the focused safety files are bounded.
- Independently removed semaphore release in scratch. The test failed with its own TimeoutException after 5 seconds; the external execution deadline did not fire.

N2: no action.
- Removing Cancel’s generation increment survived the Cards-filtered mutation run, consistently with cancelled-state rejection and Reset’s separate generation advancement.

Checklist 1–8

1. Spec conformance: verified for the T11 core scope. Fixture13 yields exactly 20 cards with LB [2,4,4,4,4,0,0,1,0,4,0,4,0,4,4,0,0,4,4,0], Held208 and partial status. Fixture14 resolves tile0 through the actual master. Full/partial authorization and wire DTO remain unchanged.

2. Correctness: verified focused fixes and round-1 regressions. Leading-hole geometry, identical refeed, read-only boundaries, sealed content, detail identity, strict acknowledgements, target ownership and bounded retry behavior remain intact.

3. Test quality: fresh native candidate suite passes 302/302; Cards 136/136; fixture-session tests 11/11. Independently authored scratch probes pass 17/17. Restored scratch full suite passes 319/319. Eight independent mutants compiled: seven killed and one expected equivalent survivor. These are not the worker’s mutation totals.

4. Fabrication: no hard-coded fixture answers found in production. Synthetic sequences and fake HTTP are explicitly distinguished from actual screenshot/master parsing. No fixture, label or master regeneration.

5. Security: no credentials or live endpoint used. In-memory token handling and existing redirect/auth/off-host replay regressions remain intact. Provenance is an enforced ordinary public-API safety boundary, not a claim of protection against hostile code inside the process.

6. Free-tier constraints: no new runtime service, paid dependency or durable queue. Inspected the unchanged API route: DELETE plus optional INSERT in one D1 batch, then {count, partial, syncedAt}. No live quota or Worker CPU claim.

7. Scope: eight changed paths in afe2fad..HEAD, confined to Cards production/tests and T11 documentation. Both focused and original-base CRLF-aware diff checks pass. No shared schema/API/T09/Windows/fixture/master edits in the reviewed change.

8. Maintainability: the public coordinator provides enforceable session/snapshot checks, not merely documented stale-retry advice. Q-154 and Review round2 describe the implemented lifecycle and recovery accurately. Direct uploader calls remain transport-only; the reviewed ordering guarantee belongs to the coordinator entrypoint.

Commands and real results

In the candidate’s agent directory:

    dotnet --version
    10.0.103

    /Users/willjose/.hermes/cache/scratch/t11-fix1/dotnet8/dotnet --list-runtimes
    Microsoft.NETCore.App 8.0.31

    dotnet build Uma.Agent.sln
    Build succeeded.
    0 Warning(s)
    0 Error(s)

    dotnet test Uma.Agent.sln --no-build -- RunConfiguration.DotNetHostPath=/Users/willjose/.hermes/cache/scratch/t11-fix1/dotnet8/dotnet
    Passed: 302, Failed: 0, Skipped: 0, Total: 302

    dotnet test Uma.Agent.sln --no-build --filter FullyQualifiedName~Uma.Agent.Core.Tests.Cards -- RunConfiguration.DotNetHostPath=…
    Passed: 136, Failed: 0, Skipped: 0, Total: 136

    dotnet test Uma.Agent.sln --no-build --filter FullyQualifiedName~CardsFixtureSessionTests -- RunConfiguration.DotNetHostPath=…
    Passed: 11, Failed: 0, Skipped: 0, Total: 11

In the exact-candidate scratch archive:

    dotnet test Uma.Agent.sln --no-build --filter FullyQualifiedName~CardsFreshR3Probes --logger 'console;verbosity=detailed' -- RunConfiguration.DotNetHostPath=…
    Total tests: 17
    Passed: 17
    wire=[20,20,20,25]

    python3 /Users/willjose/.hermes/cache/scratch/t11-review-r3/mutations.py
    Seven KILLED; Cancel-generation equivalent SURVIVED.
    Restored all scratch Cards sources byte-identical: True

    dotnet build Uma.Agent.sln
    0 Warning(s), 0 Error(s)

    dotnet test Uma.Agent.sln --no-build -- RunConfiguration.DotNetHostPath=…
    Passed: 319, Failed: 0, Skipped: 0, Total: 319

Final verification:

    git -c core.whitespace=cr-at-eol diff --check afe2fad..HEAD
    exit 0, no output

    git -c core.whitespace=cr-at-eol diff --check 08d4876..HEAD
    exit 0, no output

    git status --porcelain=v1
    no output

    git rev-parse HEAD
    8b1a8da259e625eb8ee91ec8a18d98d0acbe9a92

Scratch evidence retained:
    /Users/willjose/.hermes/cache/scratch/t11-review-r3/

Includes fresh runnable probes, detailed outputs, exact mutation edits/results, restoration hashes and verification script. Every scratch Cards production source was compared against the exact candidate git blob after restoration.

Limits and remaining integration

All HTTP evidence is fake-handler replay, not a live API/database observation. Serialization prevents local overlapping coordinated sends and stale retries; it cannot undo a PUT already received by the server or guarantee remote ordering after an ambiguous transport failure. The unchanged API has no server-side revision/CAS contract, and the documentation does not pretend otherwise.

T10 shell wiring, H4 real-game scroll/empty-cell/Held validation and a deployed live PUT remain pending. This PASS does not close those integration or milestone checks.

No tracked edits, commits, merges, pushes, deployments or global configuration changes were made. Final HEAD is clean and unchanged. No remaining blocker requires parent takeover or escalation; no further worker fix loop is requested.

session_id: 20261006_211923_8d0ed1
