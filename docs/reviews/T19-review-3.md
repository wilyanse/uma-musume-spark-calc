# T19 independent implementation review, round 3

> Coordinator provenance correction: the raw report below is preserved unchanged.
> Its claim that r3 ran on Sol conflicts with the actual gateway launch log
> `.orch/logs/T19-review-3-resume.log`, which explicitly reports
> `Model restored from session: claude-opus-5-5 (anthropic)`.
> The updated gateway retained the original session route; r3 is attributed to
> restored Opus, not the Sol requested in the continuation text. No reasoning
> level is newly inferred from that log. This correction does not change the
> candidate, review findings or command results. The earlier r2 Sol provenance
> remains historical and is not relabelled.

Candidate: 986c2db971e51c5b770ae0ea642bd68bbd69fd07
Previous candidate: 863b22dce4f5737cdcafa42fc0bc45eb47817bb2
Base: 904385e0575d3b67bc00a223e4c6a77024ebbe9a
Worktree: /Users/willjose/Projects/personal/uma-musume-spark-calc.worktrees/T19-agent-recipient-notices
Branch: task/T19-agent-recipient-notices
Reviewer: same independent session 20261011_114633_cb9f66. Original r1 Opus provenance and r2 Sol provenance are retained. This continuation uses the explicitly approved openai-codex/gpt-6.1-sol medium fallback. No model CLI, delegation, global configuration, credentials, tracked edits or commits were used.

The previous two worker fix rounds are exhausted. No third worker loop is recommended.

## Verdict: PASS

The r2 blocker B4 is fixed correctly. The r2 should-fix S6 and nit N4 are also fixed. The current verifier reads provenance from the exact hash-pinned nupkg archive, enforces it during final EXE/ZIP verification, compares runtimeconfig frameworks as an exact unique set, and ordinary CI now requests the exact SDK plus a separate .NET 8 runtime. I independently recovered the missing toolchain into T19-r3, rebuilt the exact candidate from a clean git archive, and reran the substantive gates rather than relying on the pruned r2 evidence.

This is a technical implementation PASS only. Windows startup/extraction/native execution, game/H4 acceptance, hosted publication, and Microsoft distributor/end-user legal obligations remain human gates. PASS is not release approval.

## Findings and dispositions

### B4 — RESOLVED

Paths: agent/legal/inventory.json:32-60, agent/legal/tools/package_provenance.py:22-60, agent/legal/tools/recipient_notices.py:394-402, docs/changelog/T19-agent-recipient-notices.md:477-499.

The incorrect de078f3eabf87d4dce3e2a311c1d23b9bbd6b1e4 runtime/host provenance is corrected. The current inventory records runtime and host repository commit 1219a42122cf5190c7f512850557e38c422430dc, matching both the exact nupkg nuspec and embedded host/runtime PE identity. WindowsDesktop remains 337963009d48a3016b50172b451b4e80f78791a7.

Independent archive checks, using nupkg bytes rather than extracted metadata:

- Microsoft.NETCore.App.Runtime.win-x64/8.0.31 SHA-256 1504ead20c9a25e4c47ece56b6cd407697ea0cde0148e07e71bebc1e2d841c2f; archive nuspec repository 1219a42122cf5190c7f512850557e38c422430dc.
- Microsoft.NETCore.App.Host.win-x64/8.0.31 SHA-256 d8acca41e27c80fdefa6ccd6dcbd2b76a7cda5900432755351415a39c5571a1c; archive nuspec repository 1219a42122cf5190c7f512850557e38c422430dc.
- Microsoft.WindowsDesktop.App.Runtime.win-x64/8.0.31 SHA-256 f2d14397e990f3c39efb325abd6d6430312a16a3c4596a55fb10b36c8fdcbd33; archive nuspec repository 337963009d48a3016b50172b451b4e80f78791a7.

The final `verify-exe`, `package`, and `verify-zip` call `package_provenance.check_record` for the runtime, WindowsDesktop and host archives. The dedicated positive/negative controls verify 3 actual archives and reject 9 wrong-commit/source/missing-repository mutations. The historical r1 incorrect evidence is retained and explicitly marked superseded; it is not overwritten or presented as corrected historical output.

Disposition: fixed, independently verified.

### S6 — RESOLVED

Paths: agent/legal/tools/verification_safety.py:110-119, agent/legal/tools/recipient_notices.py:327-339, agent/legal/tools/test_review_r2.py:73-103, agent/legal/tools/real_artifact_controls.py:82-94.

`validate_rc` now rejects duplicate framework names and returns the unique framework map. The verifier derives the actual Core/Desktop framework-pack set from the published deps graph and inventoried runtime packs, excluding the Windows SDK projection runtimepack. It requires exact name/version map equality.

Fresh real-artifact semantic mutations, made by changing only valid runtimeconfig JSON and padding back to the original payload length, now fail:

- Missing Microsoft.WindowsDesktop.App: exit 1, `runtimeconfig includedFrameworks differs from actual framework runtime packs`.
- Duplicate Microsoft.NETCore.App: exit 1, `runtimeconfig.json duplicate includedFramework name`.

Synthetic r2 tests additionally cover extra framework, wrong version and missing expected framework. The current valid artifact passes.

Disposition: fixed, independently verified.

### N4 — RESOLVED

Paths: .github/workflows/ci.yml:86-90, .github/tests/workflow_structure.rb:117-123 and corresponding mutations in the workflow regression tests.

Ordinary CI now reads `agent/global.json` for exact SDK 10.0.401 with roll-forward disabled and separately installs `dotnet-version: 8.0.x` for the net8 test runtime. The stale SDK9/latestMajor comment and installer assertion are gone. Structural mutations reject missing global-json-file, an alternate global-json-file and missing 8.0.x runtime input. setup-dotnet v6 accepts both inputs; its action source appends the global.json version in addition to dotnet-version.

The release workflow remains exact through global.json plus the PowerShell `dotnet --version` guard. No hosted action execution is claimed.

Disposition: fixed, independently verified structurally and through the full local workflow suite.

## Original r1 dispositions remain resolved

- B1: exact SDK10.0.401/global.json alignment, runtime8.0.31 inventory and local `cd agent` workflow remain correct. Root SDK10.0.103 single-file invocation is rejected by the csproj guard.
- B2: `.gitattributes` preserves legal/inventory bytes under autocrlf. The strict r1 suite runs a real disposable Git clone with autocrlf=true and a negative clone without attributes.
- B3: Windows .NET Library License and Windows SDK terms are delivered, mapped to actual shipped runtime/native files, and explicitly remain an unresolved human publication/legal gate.
- S1: stable host PE sections and all original resource leaves are compared against the restored host. Real code and both ProductVersion/resource mutations fail.
- S2: bounded parser/JSON/inventory/PE/resource diagnostics fail with `RECIPIENT NOTICE CHECK FAILED` and no traceback. R2 semantic checks now close the remaining runtimeconfig gap.
- S3: no tracked pyc/cache remains; `.gitignore` covers Python caches.
- S4: authoritative SDK RTF remains verbatim; derived readable text is hash-pinned and reproducibly rendered.
- S5: actual YAML-extracted PowerShell build/release bodies run under real PowerShell with mocked dotnet/gh and real verifier/assets; failures stop before gh.
- N1: command-local legal-byte-aware diff checks are clean.
- N2: extraction path is explicitly expected/H4-unverified.
- N3: supported local commands enter `agent/` so global.json applies.

## Checklist 1–8

1. Spec conformance: PASS. Current exact SDK/runtime, archive-derived inventory, embedded legal files, visible ZIP, drift/missing/corruption controls, provenance enforcement and CI/local alignment satisfy the scoped technical requirements. Human legal/publication/H4 gates remain outside technical PASS.
2. Correctness: PASS. Exact runtime/framework set, graph/package/native/satellite attribution, host sections/resources, malformed input and ZIP/EXE mutation paths were exercised.
3. Test quality: PASS. 31 + 21 + 13 strict Python tests, actual archive provenance positives/negatives, real artifact semantic mutations, real Git autocrlf controls, actual PowerShell harness and workflow76/76 are meaningful and deterministic. No synthetic-only claim is used for the key r2 controls.
4. Fabrication/evidence: PASS. The false r1 provenance is explicitly superseded. Fresh exact archive reads, fresh runtime/native/package hashes and source-byte comparisons agree with current inventory. No game facts, fixtures, master or golden data were changed.
5. Security: PASS within scope. All-transitive audits for all five .NET projects report no vulnerable packages; NuGetAudit=true, mode=all, level=low and TreatWarningsAsErrors=true remain active. No suppression, secret or application auth change was introduced.
6. Free-tier constraints: PASS. No service, paid runtime feature or production dependency was added. Tooling is build/test-only.
7. Scope: PASS. Changes are limited to the T19 legal/provenance/verifier/workflow/runbook/changelog scope and the coordinator-authorized exact SDK/CI byte-preservation edits. No production image, DB, capture, schema, master, golden, UI or fixture refresh occurred.
8. Maintainability: PASS. Provenance, parser safety, licensing map, rendering and workflow controls are separated, bounded and documented. The remaining limitations are explicit rather than hidden.

## Fresh toolchain recovery and environment

Previous scratch toolchains were genuinely absent. I recovered these into `/Users/willjose/.hermes/cache/scratch/T19-r3` only:

- SDK 10.0.401 osx-arm64 from https://builds.dotnet.microsoft.com/dotnet/Sdk/10.0.401/dotnet-sdk-10.0.401-osx-arm64.tar.gz. SHA-512 verified as 69f64eb00dc045398755c440b152225d544301a345a146a16e86a56a0c52b7c94b2c331520e976dbb821f18d31930aafbd25bb85961e3517e0665414ce0cbcff.
- .NET runtime 8.0.31 osx-arm64 from https://builds.dotnet.microsoft.com/dotnet/Runtime/8.0.31/dotnet-runtime-8.0.31-osx-arm64.tar.gz. SHA-512 verified as 1963d2ab3798efdc2b33034ef57d4252849a066a2313ce62a574e556d19e5e981afe13c9545eb6d59437849723e1c8350f10f8068bcfa6b7a2815a07263bb8b3.
- PowerShell 7.6.6 osx-arm64 from the official GitHub release. SHA-256 verified as 6df833d094ebac1c1a74340d7b3437f4aaf5e03ce640484a1c4359f3ce8b3db1.
- actionlint 1.7.12 and age/age-keygen 1.3.2 recovered with the committed `.github/scripts/install-tool.sh` into the scratch tools directory.
- sqlitepclraw.lib.e_sqlite3 2.1.12 from NuGet. SHA-256 verified as 4a22c02ffcf489792903cf263def9fce27739716883f965f0b5eeff1637430ac.
- NuGet packages were restored into the isolated scratch path with SDK10.0.401 and no global install/configuration change.

The candidate was exported with `git archive` to a clean scratch tree before build. No old parent EXE/ZIP or old pruned package cache was used for the positive artifact. A base904385e archive was separately exported and published only to reconstruct the historical no-notices negative input for the PowerShell harness; this is fresh reproduction, not inherited base evidence.

## Fresh commands and real output

Worktree-independent clean export:

    git -C /Users/willjose/Projects/personal/uma-musume-spark-calc.worktrees/T19-agent-recipient-notices archive 986c2db971e51c5b770ae0ea642bd68bbd69fd07 | tar -x -C /Users/willjose/.hermes/cache/scratch/T19-r3/src

Restore and audited builds:

    (cd scratch/T19-r3/src/agent; DOTNET_ROOT=scratch/T19-r3/sdk401 NUGET_PACKAGES=scratch/T19-r3/nuget dotnet restore --locked-mode)
    Restored all five projects; exit 0.

    dotnet test agent/tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj -c Release
    Passed! Failed 0, Passed 420, Skipped 0, Total 420; exit 0.

    dotnet test agent/tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release
    Passed! Failed 0, Passed 230, Skipped 0, Total 230; exit 0.

    dotnet build agent/tests/Uma.Agent.Windows.Tests/Native/Uma.Agent.Windows.Tests.csproj -c Release -p:EnableWindowsTargeting=true
    0 Warning(s), 0 Error(s); exit 0.

    dotnet build agent/Uma.Agent.sln -c Release -p:EnableWindowsTargeting=true
    0 Warning(s), 0 Error(s); exit 0.

    dotnet publish agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableWindowsTargeting=true -o publish
    SDK10.0.401, runtime packs8.0.31; exit 0; EXE191769388 bytes.

Strict legal/provenance/package gates:

    python3 -X dev -W error agent/legal/tools/test_recipient_notices.py
    Ran31 tests; OK; exit 0.
    python3 -X dev -W error agent/legal/tools/test_review_r1.py
    Ran21 tests; OK; exit 0.
    python3 -X dev -W error agent/legal/tools/test_review_r2.py
    Ran13 tests; OK; exit 0.
    python3 -X dev -W error agent/legal/tools/package_provenance.py --packages scratch/T19-r3/nuget
    archive provenance: 3 required archives verified; exit 0.
    python3 -X dev -W error agent/legal/tools/package_provenance_controls.py --packages scratch/T19-r3/nuget
    actual archive controls: 3 positives, 9 negatives; all expected; exit 0.
    python3 agent/legal/tools/recipient_notices.py check-legal
    legal inventory ok: 12 components, 19 notice files; exit 0.
    python3 agent/legal/tools/recipient_notices.py verify-exe publish/Uma.Agent.Windows.exe --assets agent/src/Uma.Agent.Windows/obj/project.assets.json
    recipient notices ok: 494 bundle entries, 455 byte-matched, 12 components, 20 legal files embedded; exit 0.
    python3 agent/legal/tools/recipient_notices.py package publish/Uma.Agent.Windows.exe release/t19.zip --assets agent/src/Uma.Agent.Windows/obj/project.assets.json
    release ZIP ok: EXE + 20 LICENSES files; 494 entries, 455 byte-matched; exit 0.
    python3 agent/legal/tools/recipient_notices.py verify-zip release/t19.zip --assets agent/src/Uma.Agent.Windows/obj/project.assets.json
    release ZIP ok: EXE + 20 LICENSES files; 494 entries, 455 byte-matched; exit 0.

Actual artifact checks:

    bundle_probe.py publish/Uma.Agent.Windows.exe scratch/T19-r3/src
    matches 15 of 15; exit 0.

    sqlite_native_probe.py publish/Uma.Agent.Windows.exe scratch/T19-r3/sqlitepclraw.lib.e_sqlite3.2.1.12.nupkg
    PE32+ AMD64, SQLite3.53.3, exact package asset, SHA-256 b7385d722c83fb52142a00477a726723745916d22a555711ee89834c1111fb2e; exit 0.

    real_artifact_controls.py ...
    valid exit 0; 16 real negatives exit 1 with expected diagnostics and no traceback; 0 unexpected results.

    workflow_pwsh_controls.py --pwsh scratch/T19-r3/pwsh/pwsh --exe fresh.exe --assets fresh.assets --baseline-exe reconstructed-base.exe
    Seven scenarios passed: valid, tamper-before-release, bad-tag, wrong-sdk, publish-failure, no-python, baseline-no-notices; no publication; exit 0.

    TOOLS_DIR=scratch/T19-r3/tools PWSH=scratch/T19-r3/pwsh/pwsh T19_RECIPIENT_EXE=fresh.exe T19_RECIPIENT_ASSETS=fresh.assets bash .github/tests/run.sh
    actionlint and all workflow checks passed; `regression checks: 76 passed, 0 failed`; exit 0.

Direct archive attribution:

    455 actual bundle entries matched directly to members of exact hash-pinned nupkg archives; BAD=[]
    ProtectedData.dll matched the WindowsDesktop archive copy.
    e_sqlite3.dll text occurrences: sqlcipher0, openssl0, libcrypto0, zetetic0.

Framework semantic negatives:

    missing WindowsDesktop includedFrameworks -> exit 1, `differs from actual framework runtime packs`.
    duplicate Core includedFramework -> exit 1, `duplicate includedFramework name`.

Exact source/terms checks:

    Fresh archive reads report all three required repository commits from inside the archive nuspecs: runtime/host1219a421..., WindowsDesktop337963009...
    All fetched current notice texts byte-match committed copies. SDK RTF-derived wording matches independent macOS textutil after whitespace removal.
    Windows SDK live licence and REDIST pages were fetched and retained only as scratch evidence; the REDIST list is not treated as legal authorization.

Full real logs and scripts are in:

- /Users/willjose/.hermes/cache/scratch/T19-r3/core.log
- /Users/willjose/.hermes/cache/scratch/T19-r3/portable.log
- /Users/willjose/.hermes/cache/scratch/T19-r3/native.log
- /Users/willjose/.hermes/cache/scratch/T19-r3/solution.log
- /Users/willjose/.hermes/cache/scratch/T19-r3/publish.log
- /Users/willjose/.hermes/cache/scratch/T19-r3/test31.log
- /Users/willjose/.hermes/cache/scratch/T19-r3/test21.log
- /Users/willjose/.hermes/cache/scratch/T19-r3/test13.log
- /Users/willjose/.hermes/cache/scratch/T19-r3/prov.log
- /Users/willjose/.hermes/cache/scratch/T19-r3/provctrl.log
- /Users/willjose/.hermes/cache/scratch/T19-r3/real-controls.log
- /Users/willjose/.hermes/cache/scratch/T19-r3/pwsh.log
- /Users/willjose/.hermes/cache/scratch/T19-r3/workflow.log

## Fresh versus inherited

Fresh in r3: toolchain recovery with URL/hash verification; clean exact-candidate archive; restore, Core420, Portable230, native and solution cross-builds; SDK401/runtime8.0.31 self-contained publish; strict31/21/13 suites; exact archive provenance positives/negatives; final EXE/ZIP checks; native/data checks; real artifact malformed/tamper/semantic controls; reconstructed-base negative; executed seven-scenario PowerShell harness; workflow regression76/76 including actionlint; direct archive attribution; current source/licence byte checks; diff checks.

Inherited only: r1 Opus review findings/provenance, r2 Sol review provenance and requirements, the historical old incorrect provenance log as explicitly superseded, prior source-code analysis of SQLite key/rekey stubs, and the task's unchanged H4/legal/publication limitations. Previous pruned SDK/NuGet/PWSH/native tools were not assumed or used. Parent's claimed r2 30-gate result was not relied on; this report contains fresh r3 execution.

## Remaining limits and human gates

- No Windows startup, legal extraction, WPF/D3D/e_sqlite3 runtime loading, WGC/OCR/DPAPI, game capture/import or UI validation. Cross-target build and byte inspection are not H4 execution.
- No real hosted GitHub workflow, setup-dotnet action, upload-artifact or gh release. No tag, push, deploy or publication occurred. Local PowerShell harness uses mocks for dotnet/gh and real verifier/assets.
- Microsoft .NET Library License and Windows SDK distributor/end-user terms remain an explicit unresolved human gate, including agreement, indemnity, non-standalone distribution and notice requirements. Delivered files and technical PASS do not satisfy those terms or authorize release.
- No unrelated upgrade, application dependency, audit suppression, fixture/master/golden refresh or production image/DB/capture change occurred.

## End state

Final worktree verification:

    git rev-parse HEAD
    986c2db971e51c5b770ae0ea642bd68bbd69fd07
    git symbolic-ref --short HEAD
    task/T19-agent-recipient-notices
    git status --porcelain
    (no output)

No tracked edits, commits, push, tag, deployment, release or global configuration change was made by this review.
