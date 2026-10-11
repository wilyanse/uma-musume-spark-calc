# T19 independent implementation review — round 2

## Verdict: CHANGES_REQUESTED

Candidate: 863b22dce4f5737cdcafa42fc0bc45eb47817bb2
Fix comparison: 258f567ce13044bbea3d5b6d335a76d4f15d5ee3..863b22dce4f5737cdcafa42fc0bc45eb47817bb2
Original base: 904385e0575d3b67bc00a223e4c6a77024ebbe9a
Assigned worktree: /Users/willjose/Projects/personal/uma-musume-spark-calc.worktrees/T19-agent-recipient-notices
Branch: task/T19-agent-recipient-notices
Reviewer: SAME independent session20261011_114633_cb9f66. Original round1 provenance remains Opus. Round2 is the explicitly coordinator-approved openai-codex/gpt-6.1-sol medium continuation. No model CLI, delegation, credential work or global configuration changes.
Worker fix rounds consumed:1 of maximum2.

The original three blockers are substantively fixed, and every normal gate was independently rerun successfully. A new blocking source-provenance/evidence defect remains in the recipient inventory. No new licence text or package upgrade is needed to fix it. One additional verifier consistency issue is nonblocking within recipient-delivery scope.

## Blocking — new

[B4] Medium / acceptance-blocking — agent/legal/inventory.json:32,42,203,207; docs/changelog/T19-agent-recipient-notices.md:295-302; docs/changelog/assets/T19/r1/sol-provenance-fidelity.log:8-9,30.

Problem: incorrect exact-version runtime/host source provenance, including incorrectly recorded nuspec evidence.

The candidate says the runtime source and the 8.0.31 host nuspec repository commit are de078f3eabf87d4dce3e2a311c1d23b9bbd6b1e4, and explicitly claims that this differs from the embedded PE commit1219a42122cf5190c7f512850557e38c422430dc. It does not.

I read the nuspec INSIDE both exact hash-pinned archives, then freshly downloaded both archives again from NuGet to rule out an altered extracted cache. Both contain:

    <repository type="git" url="https://github.com/dotnet/runtime" commit="1219a42122cf5190c7f512850557e38c422430dc" />

Fresh downloads match the inventory's hashes:
- Host: d8acca41e27c80fdefa6ccd6dcbd2b76a7cda5900432755351415a39c5571a1c
- Runtime: 1504ead20c9a25e4c47ece56b6cd407697ea0cde0148e07e71bebc1e2d841c2f

LICENSE.TXT and THIRD-PARTY-NOTICES.TXT at the candidate's de078f3… token both return HTTP404. At actual1219a421… both are retrievable and match the delivered package texts after CRLF/LF normalization. The recipient inventory embeds the wrong source, and the worker evidence presents the wrong nuspec value as an observed result. This violates spec67 §1's exact provenance requirement and checklist4's truthful evidence requirement. No allegation about intent is made; the asserted archive result is not what the archive contains.

Required fix:
1. Correct current runtime/host source references to the actual repository commit, and remove the false statement that these nuspec and embedded-runtime commits differ. Do not alter package pins or verbatim licence text bytes.
2. Correct/re-source the provenance evidence and explain the correction in the changelog. Preserve historical evidence honestly; do not replace it with an invented successful command.
3. Add an executable assertion that reads the repository commit from the nuspec inside each exact hash-pinned runtime/host nupkg and compares it to the inventory. Copying inventory metadata into a log is not independent provenance verification.
4. Re-publish/repackage after changing inventory bytes, because inventory.json is embedded and present in the recipient ZIP. Re-run final EXE/ZIP verification and the focused source/negative controls.

This is a narrow metadata/evidence blocker, not a new legal-choice, dependency-upgrade or application-behavior request. All delivered licence text bytes themselves were freshly verified.

## Should fix — new

[S6] Medium, nonblocking within recipient-delivery scope — agent/legal/tools/recipient_notices.py:326-335 and verification_safety.py:110-115.

Problem: runtimeconfig includedFrameworks consistency is checked in only one direction, despite the tool's documented claim that it equals the inventory's runtime-pack versions. validate_rc permits missing expected frameworks and duplicate names. The verifier only checks the entries that remain.

Fresh real-EXE semantic mutations (valid JSON, payload padded to original length; no licence/DLL bytes changed):
- Remove Microsoft.WindowsDesktop.App from includedFrameworks → verify-exe exit0,494 entries/455 matches.
- Replace both frameworks with two copies of Microsoft.NETCore.App8.0.31 → exit0, same success result.

Required follow-up: compare unique {framework-name: version} sets with the actual Core/Desktop framework-pack set; exclude the Windows SDK projection runtimepack, which is not an includedFramework. Reject duplicates and missing expected frameworks. Add these real-artifact semantic controls alongside syntactically malformed JSON. The current valid artifact still delivers the correct terms, so this is not elevated to a second recipient-notice blocker.

## Nits — new

[N4] Low — .github/workflows/ci.yml:86-91.
The ordinary .NET CI job's comment still says SDK9.0.100/latestMajor, and its setup-dotnet installs only8.0.x/9.0.x even though agent/global.json now requires exactly10.0.401 with roll-forward disabled. Release correctly installs from global.json. Ordinary CI relies on10.0.401 remaining preinstalled on ubuntu-latest. No current hosted-CI failure is claimed or invented. Update the comment and, under coordinator-approved scope, explicitly install the same SDK plus the separate net8 test runtime. The structural test also retains the legacy ordinary-CI installer assertion. This is separate from the fixed supported release path.

## EACH original finding: independent disposition

### B1 — RESOLVED, with separate new source-provenance B4

- agent/global.json requires10.0.401, rollForward disable, allowPrerelease false. Release setup-dotnet reads that file; the actual pwsh script checks resolved SDK before publish.
- Fresh clean-export publish uses runtime/host8.0.31 and packages successfully. Core420/Portable230 pass on separately available shared8.0.31. Windows, Native and full solution cross-build with0 warnings/errors.
- Live dotnet --version from assigned worktree agent/:10.0.401. The actual RequireRecipientPublishSdk csproj target rejects root SDK10.0.103 with exit1 and its named error.
- The README/runbook now enter agent/ before dotnet. No insecure8.0.24 pin remains in the current inventory. Future package/runtime drift is intentional fail-closed maintenance, not a broken current release path. The full coordinator spec67 erratum explicitly authorizes the minimal alignment.

### B2 — RESOLVED

- .gitattributes sets -text for agent/legal/notices/** and agent/legal/inventory.json. Both authored LF and upstream CRLF bytes remain exact.
- Fresh strict21-test suite runs a genuine Git autocrlf=true clone, compares every notice byte and runs check-legal. Its negative removes ONLY .gitattributes in a disposable repository, creates another real Git clone and requires changed-text failures. This is not a synthetic CRLF replacement tautology.
- No assigned-repo or global Git config/identity was modified. Disposable test-repository commits are part of the retained regression, not changes to the assigned branch.

### B3 — RESOLVED for scoped technical attribution/delivery, NOT legal authorization

- Freshly fetched Library HTML is byte-identical, SHA2560f69be2c8ac44c3980047664c3347ff22cba5842dc9d8b0a88a4f0914645a780. It declares Windows-1252 and inline styling and can be opened locally without developer tools/network. It is honestly recorded as a live, unversioned page.
- Pinned Microsoft licence-information files byte-match upstream. INDEX/inventory attribute the single-file runtime/coreclr, PresentationNative_cor3.dll, vcruntime140_cor3.dll and wpfgfx_cor3.dll to Library terms; D3DCompiler_47_cor3.dll to Windows SDK terms. Other managed/PenImc files retain MIT texts.
- I inspected actual shipped natives and exact archive bytes, not package names. Missing/mislabelled native-map regressions reject omitted terms and MIT-only labels; required native presence is checked.
- Library and SDK distributor/external-end-user agreement, indemnity, non-standalone distribution, retained notices and SDK-specific obligations remain explicitly UNRESOLVED HUMAN PUBLICATION GATE in README, INDEX, inventory and runbook. An accessible copy meets scoped technical text-delivery requirements; file delivery does NOT fulfill those obligations or approve publication.

### S1 — RESOLVED within the correctly documented bounds

- Fully reviewed bounded PE section/resource parsing and host comparison. All original stable PE sections and every original resource leaf at type/name/language paths must match restored singlefilehost.exe. Embedded runtime resource images contain both ProductVersion copies.
- Fresh retained real controls reject0x2000 code mutation and each individual ProductVersion/resource mutation. My additional simultaneous mutation of BOTH copies fails with the original runtime resource-leaf mismatch. Wrong PE machine also fails.
- SDK-patched .data, new application resources and resource-directory layout are deliberately not compared wholesale. This is technical provenance, not full EXE-integrity, signing or authenticity verification. No stronger guarantee is inferred.

### S2 — RESOLVED for original diagnostic/bounds failures; S6 is a new semantic gap

- Reviewed the complete new JSON/inventory/deps/runtimeconfig shape handling; file/JSON/string/count bounds; duplicate JSON-key rejection; safe paths; PE section/resource offsets, count and traversal depth; negative compressed sizes; and bundle ranges.
- Real header->EOF-3, truncated EXE, bad deps/config JSON, missing deps and malformed/wrong-shape/missing-field inventory all exit1 with RECIPIENT NOTICE CHECK FAILED and no traceback.
- Additional endless-varint, negative-csize, wrong-machine, resource and satellite mutations fail with useful diagnostic output. Original r1 raw traceback reproducers are not merely relabelled as tests.

### S3 — RESOLVED

No tracked .pyc/__pycache__ remains. .gitignore covers __pycache__/ and *.py[cod]; git check-ignore confirms it. No tracked test-generated cache was altered.

### S4 — RESOLVED

Original RTF byte-matches upstream. Marked derived UTF-8 wording is included/indexed/hash-pinned, and check-legal regenerates it exactly. Independent `textutil -convert txt -stdout` conversion matches all derived wording after whitespace removal. Formatting/generated list labels are deliberately omitted; original RTF stays authoritative. Upstream typos are preserved rather than silently repaired.

### S5 — RESOLVED within native/hosted limits

The structural mutation checks remain honestly described as structural. The new retained workflow_pwsh_controls.py actually YAML-extracts both step bodies and runs them in real PowerShell7.6.6, with dotnet/gh mocks and real Python/verifier/EXE/assets. Workspace paths have spaces. All7 scenarios pass (including original no-notice EXE), and the full workflow suite with executed pwsh enabled passes69/69. The harness requires the right failure reason, no gh after failure, and exact ZIP-only gh argv. Its unavailable-Python control throws from a mock; it is not observation of Windows runner PATH. No real upload-artifact/setup-dotnet/gh action is claimed.

### N1 — RESOLVED

All three documented legal-byte-aware full-range diff checks exit0. Verbatim upstream CRLF/HTML/RTF remains intact while authored paths and INDEX/derived text meet strict whitespace rules. This is not an unqualified claim that default git diff --check passes on upstream verbatim whitespace.

### N2 — RESOLVED

INDEX:15-18, README:21-22 and runbook say expected/H4-unverified extraction rather than claiming observed Windows execution.

### N3 — RESOLVED

Supported README/runbook dotnet commands enter agent/ and return to root before Python packaging. The scoped csproj single-file guard rejects another root-selected SDK. The full supported local distribution procedure includes packaging/verification; a raw dotnet-publish EXE alone is not a supported recipient distribution.

## Checklist1–8

1. Spec conformance: ISSUE B4 — exact source/provenance evidence remains inaccurate. Other original notice/accessibility/SDK/runtime/fail-closed requirements reproduce. Full coordinator spec67 erratum was read and applied. Contract/game/API/schema fields are untouched.
2. Correctness: substantive fix is good; S6 is the remaining semantic runtimeconfig gap. Original bounds/host/malformed-input failures corrected. Managed/native/satellite assets match exact nupkg archive bytes; final notice bytes are embedded and visibly ZIP-delivered.
3. Test quality:31+21 deterministic tests pass under -X dev -W error, true Git positive/negative clones,15 meaningful real-artifact controls, actual pwsh execution. B4 illustrates why an inventory-to-log copy is not an independent source assertion. Add nuspec checks and S6 missing/duplicate framework tests.
4. Fabrication/evidence: ISSUE B4 — purported nuspec commit contradicts the exact archive and404s upstream. No assertion about intent. All licence byte/source fetch results were independently reproduced; no invented game constants, production fixture/golden refresh or application answers.
5. Security: audit all/low/warnings-as-errors retained;5 all-transitive audits report no vulnerabilities. Native/package/hash controls and tag/trust/no-secret-argv boundaries remain. No new API/auth/app-code change or suppression. No inferred legal release permission.
6. Free tier: no cloud/runtime service/paid feature or application dependency added. Python stdlib/Ruby/Git/PowerShell are build/test tools, not new runtime dependencies. Cloudflare constraints unchanged.
7. Scope: T19 plus explicit erratum-authorized SDK/runtime alignment/.gitattributes/.gitignore. No production image/DB/capture/master/schema/UI/About/refactor/fixture regeneration. The new synthetic PE host belongs to verifier tests, not game/master/golden fixtures.
8. Maintainability: useful separated parser/PE/licensing/render modules, generated cache removed, deterministic SDK and byte rules. New actual-host tests are meaningful. B4 source assertion, S6 set equality and N4 ordinary-CI assumptions remain follow-ups.

## Fresh commands and actual trimmed output

All build/test/probe output is under /Users/willjose/.hermes/cache/scratch/T19-r2. Fresh git archive export to src had no bin/obj and the exact candidate/global.json. Source/diffs were reviewed directly in the assigned worktree. The live SDK selection/guard was also checked there. Parent publish/ZIP was NOT reused.

Exact runnable gate script: /Users/willjose/.hermes/cache/scratch/T19-r2/gates.sh
Full per-command stdout/status logs: /Users/willjose/.hermes/cache/scratch/T19-r2/gates/*.log
Summary: /Users/willjose/.hermes/cache/scratch/T19-r2/gates-summary.log

Environment exported by that script:
    DOTNET_ROOT=/Users/willjose/.hermes/cache/scratch/T19-r1/sdk401
    DOTNET_BIN=$DOTNET_ROOT/dotnet
    NUGET_PACKAGES=/Users/willjose/.hermes/cache/scratch/T19-r1/nuget401
    DOTNET_CLI_HOME=/Users/willjose/.hermes/cache/scratch/T19-r2/dotnethome
    TMPDIR=/Users/willjose/.hermes/cache/scratch/T19-r2/tmp
    DOTNET_CLI_TELEMETRY_OPTOUT=1
    PYTHONDONTWRITEBYTECODE=1
    DOTNET_GENERATE_ASPNET_CERTIFICATE=false

$ git -C /Users/willjose/Projects/personal/uma-musume-spark-calc.worktrees/T19-agent-recipient-notices archive 863b22dce4f5737cdcafa42fc0bc45eb47817bb2 | tar -x -C /Users/willjose/.hermes/cache/scratch/T19-r2/src
$ bash /Users/willjose/.hermes/cache/scratch/T19-r2/gates.sh > /Users/willjose/.hermes/cache/scratch/T19-r2/gates-summary.log 2>&1
27 of27 per-step logs end exit=0; ALLDONE failures=0.

Commands below run from scratch/T19-r2/src; dotnet subprocesses enter agent/. D=$DOTNET_BIN.

$ bash .github/scripts/agent-gates.sh runtime
10.0.401
Microsoft.NETCore.App8.0.31 and10.0.12 (isolated root); exit0
$ bash .github/scripts/agent-gates.sh core-tests
Passed! - Failed:0, Passed:420, Skipped:0, Total:420; exit0
$ bash .github/scripts/agent-gates.sh windows-build
0 Warning(s),0 Error(s); exit0
$ (cd agent; $D test tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release)
Passed! - Failed:0, Passed:230, Skipped:0, Total:230; exit0
$ (cd agent; $D build tests/Uma.Agent.Windows.Tests/Native/Uma.Agent.Windows.Tests.csproj -c Release -p:EnableWindowsTargeting=true)
0 Warning(s),0 Error(s); exit0
$ (cd agent; $D build Uma.Agent.sln -c Release -p:EnableWindowsTargeting=true)
0 Warning(s),0 Error(s); exit0
$ (cd agent; $D publish src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableWindowsTargeting=true -o ../publish)
Uma.Agent.Windows -> scratch/T19-r2/src/publish/; exit0
$ python3 -X dev -W error agent/legal/tools/test_recipient_notices.py
Ran31 tests in0.341s; OK; exit0
$ python3 -X dev -W error agent/legal/tools/test_review_r1.py
Ran21 tests in1.059s; OK; exit0 (real Git autocrlf positive/negative included)
$ python3 agent/legal/tools/recipient_notices.py check-legal
legal inventory ok:12 components,19 notice files; exit0
$ python3 agent/legal/tools/recipient_notices.py verify-exe publish/Uma.Agent.Windows.exe --assets agent/src/Uma.Agent.Windows/obj/project.assets.json
recipient notices ok:494 bundle entries,455 byte-matched to restored packages,12 inventory components,20 legal files embedded; exit0
$ python3 agent/legal/tools/recipient_notices.py package publish/Uma.Agent.Windows.exe release/uma-agent-agent-v0.0.0-win-x64.zip --assets agent/src/Uma.Agent.Windows/obj/project.assets.json
release ZIP ok: sha256 c38e6ca6e2018861537800511b086d4a1aa68b7739d000377fb6fa95d18381a5; EXE+20 LICENSES files;494 entries,455 byte-matched; exit0
$ python3 agent/legal/tools/recipient_notices.py verify-zip release/uma-agent-agent-v0.0.0-win-x64.zip --assets agent/src/Uma.Agent.Windows/obj/project.assets.json
release ZIP ok: EXE+20 LICENSES files;494 entries,455 byte-matched; exit0
$ unzip -l release/uma-agent-agent-v0.0.0-win-x64.zip
EXE191769388 bytes;192228925 total uncompressed bytes;21 files; exit0
$ python3 agent/tests/Uma.Agent.Windows.Tests/Tools/bundle_probe.py publish/Uma.Agent.Windows.exe /Users/willjose/.hermes/cache/scratch/T19-r2/src
matches15 of15; exit0
$ python3 agent/tests/Uma.Agent.Windows.Tests/Tools/sqlite_native_probe.py publish/Uma.Agent.Windows.exe /Users/willjose/.hermes/cache/scratch/T18/sqlitepclraw.lib.e_sqlite3.2.1.12.nupkg
bundle6.0 entries494
package SHA2564a22c02ffcf489792903cf263def9fce27739716883f965f0b5eeff1637430ac
e_sqlite3.dll1978880 bytes, PE32+AMD64(0x8664)
SHA256 b7385d722c83fb52142a00477a726723745916d22a555711ee89834c1111fb2e
SQLite3.53.3; source_id2026-06-26 20:14:12 d4c0e51e4aeb96955b99185ab9cde75c339e2c29c3f3f12428d364a10d782c62
Exact native package asset matches published bundle; Windows execution remains H4; exit0

All-transitive audits (each command executed separately from agent/):
$ $D list src/Uma.Agent.Core/Uma.Agent.Core.csproj package --vulnerable --include-transitive
$ $D list src/Uma.Agent.Windows/Uma.Agent.Windows.csproj package --vulnerable --include-transitive
$ $D list tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj package --vulnerable --include-transitive
$ $D list tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj package --vulnerable --include-transitive
$ $D list tests/Uma.Agent.Windows.Tests/Native/Uma.Agent.Windows.Tests.csproj package --vulnerable --include-transitive
Each project: "has no vulnerable packages given the current sources." Each exit0.
$ $D msbuild src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -getProperty:NuGetAudit -getProperty:NuGetAuditMode -getProperty:NuGetAuditLevel -getProperty:TreatWarningsAsErrors -p:EnableWindowsTargeting=true
NuGetAudit=true,Mode=all,Level=low,TreatWarningsAsErrors=true; exit0

$ python3 agent/legal/tools/recipient_notices.py report publish/Uma.Agent.Windows.exe
NETCore8.0.31:165 graph assets; WindowsDesktop8.0.31:59; SDK projection10.0.19041.57:2;8 package assets;2 first-party assets. Microsoft.Data.Sqlite aggregate:0 assets. exit0.
$ python3 agent/legal/tools/real_artifact_controls.py publish/Uma.Agent.Windows.exe --packages /Users/willjose/.hermes/cache/scratch/T19-r1/nuget401
valid exit0; host-code-byte, each host-version-copy, header-near-eof, truncated-real-exe, malformed deps/config, missing-deps, INDEX/e_sqlite3/D3DCompiler tamper, missing-deps-field/wrong-type/malformed inventory each exit1 with correct diagnostic/no traceback.
real artifact controls:0 unexpected result(s);1 positive+14 negatives; driver exit0.
$ python3 .github/tests/workflow_pwsh_controls.py --pwsh /Users/willjose/.hermes/cache/scratch/T19-r1/pwsh/pwsh --exe /Users/willjose/.hermes/cache/scratch/T19-r2/src/publish/Uma.Agent.Windows.exe --assets /Users/willjose/.hermes/cache/scratch/T19-r2/src/agent/src/Uma.Agent.Windows/obj/project.assets.json --baseline-exe /Users/willjose/.hermes/cache/scratch/T19/base-publish/Uma.Agent.Windows.exe --logs /Users/willjose/.hermes/cache/scratch/T19-r2/pwsh-logs
valid build0/create0; tamper-before-release build0/create1; bad-tag/wrong-sdk/publish-failure/no-python/baseline-no-notices build1/createNone.7 passed; no publication; driver exit0.
$ TOOLS_DIR=/Users/willjose/.hermes/cache/scratch/IR1/tools PWSH=/Users/willjose/.hermes/cache/scratch/T19-r1/pwsh/pwsh T19_RECIPIENT_EXE=/Users/willjose/.hermes/cache/scratch/T19-r2/src/publish/Uma.Agent.Windows.exe T19_RECIPIENT_ASSETS=/Users/willjose/.hermes/cache/scratch/T19-r2/src/agent/src/Uma.Agent.Windows/obj/project.assets.json bash .github/tests/run.sh
regression checks:69 passed,0 failed (actual pwsh enabled, not skipped); exit0
$ node .github/scripts/check-config.mjs .
config check ok(structure):MASTER_VERSION=global-20260930; exit0

## Additional independent probes and source checks

Exact retained reviewer scripts and logs:
- /Users/willjose/.hermes/cache/scratch/T19-r2/additional_probes.py
- /Users/willjose/.hermes/cache/scratch/T19-r2/additional-probes.log
- /Users/willjose/.hermes/cache/scratch/T19-r2/provenance_probe.py
- /Users/willjose/.hermes/cache/scratch/T19-r2/provenance.log
- /Users/willjose/.hermes/cache/scratch/T19-r2/archive-attribution.log

$ PYTHONDONTWRITEBYTECODE=1 python3 /Users/willjose/.hermes/cache/scratch/T19-r2/additional_probes.py > /Users/willjose/.hermes/cache/scratch/T19-r2/additional-probes.log 2>&1
Real-EXE results:
- missing WindowsDesktop runtimeconfig:exit0 (S6)
- duplicate Core includedFramework:exit0 (S6)
- both host ProductVersion/resource copies corrupted:exit1, "host PE resource (10,'MINIDUMP_EMBEDDED_AUXILIARY_PROVIDER',0) differs"
- negative compressed entry size:exit1,"bundle entry out of range:appsettings.json"
- endless manifest varint:exit1,"invalid bundle string length"
- wrong PE machine:exit1,"host must be bounded AMD64 PE"
- ja/PresentationFramework.resources.dll bit flip:exit1,"differs from the restored package file(s)"
- real deps Serilog4.3.0→4.3.1:exit1,"dependency/runtime version drift", stale inventory and unattributable DLL
No tracebacks in those results. The probe driver reports results, not an assertion that S6 is green.

$ python3 /Users/willjose/.hermes/cache/scratch/T19-r2/provenance_probe.py > /Users/willjose/.hermes/cache/scratch/T19-r2/provenance.log 2>&1
Driver exit0 means the diagnostic collection completed, NOT an all-green provenance verdict. Actual output:
- All14 upstream fetchable recipient sources MATCH their delivered bytes (WPF, WinForms, SDK RTF, CsWinRT, efcore, Serilog2, SharpZipLib, SQLitePCLRaw2, SQLite, Library HTML, Microsoft licence-information2).
- All12 component nupkgs plus host match inventory SHA256.
- Both fresh NuGet runtime/host downloads name repository commit1219a42122cf5190c7f512850557e38c422430dc, not the claimed de078f3… (B4).
- Runtime LICENSE/TPN at1219a421…:normalized matchTrue; at de078f3…:HTTP404 for both.
- WindowsDesktop337963009d48a3016b50172b451b4e80f78791a7 Version.Details.xml identifies WPF27c84022a86fcaa600315f4686cde97874615a24 and WinForms f4ddf3475a1269429508fe203cdfc4e21c3599d1. Their fetched notices match.
- SDK live licence HTML SHA2562dc27de28d82f4d0d2f471899c818a5e9787de21061774390204170d4207d77d; EULAID matches retained RTF.
- REDIST HTML SHA256657057477d3dff1e580f3795ebb2170346cece3f25a96fcd74e5f944021fda31; SDK projection lib/net8 files listed. REDIST is not proof that human distribution obligations have been performed.
- TEXTUTIL_WORDING_MATCH True for the complete derived SDK rendering.

I additionally compared the actual bundle assets directly with zipfile members of the exact hash-pinned nupkgs, using RuntimeList/deps paths, rather than trusting extracted cache bytes:
    DIRECT_NUPKG_ARCHIVE_MATCH455 BAD[]
    PROTECTEDDATA_SOURCE:WindowsDesktop8.0.31 nupkg
    SQLCIPHER_OPENSSL_TEXT_OCCURRENCES:{sqlcipher:0,openssl:0,libcrypto:0,zetetic:0}
This includes the runtime satellite/native assets, projection DLLs and8 package binaries. Graph asset counts165/59 are not all satellite bundle entries and must not be confused with455 actual file matches. Microsoft.Data.Sqlite is an aggregate; Core ships the DLL. ProtectedData's direct package name does not make its binary ship: the DLL is the WindowsDesktop copy. The broad repository NOTICE's SQLCipher/OpenSSL sections are explicitly marked nonapplicable, not used as evidence that those optional builds ship. Native identity and string absence were freshly verified; prior source-code key/rekey-stub analysis remains inherited.

SDK guard (actual assigned-worktree source):
$ (cd <assigned worktree>/agent; DOTNET_ROOT=<sdk401> DOTNET_CLI_HOME=<r2 scratch> DOTNET_GENERATE_ASPNET_CERTIFICATE=false <sdk401>/dotnet --version)
10.0.401
$ (cd <assigned worktree>; DOTNET_ROOT=/Users/willjose/.hermes/cache/scratch/T16b/dotnet-combo DOTNET_CLI_HOME=<r2 scratch> DOTNET_GENERATE_ASPNET_CERTIFICATE=false <T16b/dotnet-combo>/dotnet msbuild agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -t:RequireRecipientPublishSdk -p:PublishSingleFile=true)
SDK10.0.103; MSBuild18.0.11+c2435c3e0
Uma.Agent.Windows.csproj(57,5): error:T19 recipient packaging requires SDK10.0.401. Run dotnet publish from agent/ with its exact global.json; root SDK bypass is unsupported.
root_wrong_sdk_exit=1

Whitespace/cache checks (assigned worktree):
$ git -c core.whitespace=-blank-at-eol,-blank-at-eof,cr-at-eol diff --check 904385e..HEAD
exit0
$ git -c core.whitespace=cr-at-eol diff --check 904385e..HEAD -- . ':!agent/legal/notices/**'
exit0
$ git -c core.whitespace=cr-at-eol diff --check 904385e..HEAD -- agent/legal/notices/INDEX.txt agent/legal/notices/Windows-SDK-LICENSE-derived.txt
exit0
$ git ls-files '*__pycache__*' '*.pyc'
(no output)
$ git check-ignore agent/legal/tools/__pycache__/x.pyc
agent/legal/tools/__pycache__/x.pyc

## Actual PowerShell/release artifact assessment

Current YAML build/create bodies execute in real PowerShell with workspace paths containing spaces. `$exe[0].FullName` is evaluated into a single full-path argument, not passed literally or split. Native-command failures are checked before emitting zip=. The sequence is:
1. Enter agent/, verify SDK, publish self-contained single-file win-x64.
2. Return to root, run31-test suite and21-test suite.
3. Package EXE+notices:verify EXE→write ZIP→verify ZIP.
4. Only zip= is written; upload-artifact input is steps.build.outputs.zip with if-no-files-found:error.
5. Create step re-verifies ZIP before `gh release create TAG ZIP --verify-tag --generate-notes`.
The retained harness asserts exact ZIP-only gh argv, appropriate named failure diagnostics, no gh after tamper/build failure, and no build output after failure. It strips GH_TOKEN rather than borrowing a real credential. No upload-artifact or actual GitHub action was executed.

Fresh reviewer EXE:/Users/willjose/.hermes/cache/scratch/T19-r2/src/publish/Uma.Agent.Windows.exe
Fresh reviewer ZIP:/Users/willjose/.hermes/cache/scratch/T19-r2/src/release/uma-agent-agent-v0.0.0-win-x64.zip
21 ZIP files = EXE+20 LICENSES entries (19 notice files including INDEX, plus inventory).
494 bundle entries;455 exact third-party archive matches;20 embedded legal files. Data15/15, native SQLite exact2.1.12 PE/hash/identity match.
ZIP SHA256c38e6ca6e2018861537800511b086d4a1aa68b7739d000377fb6fa95d18381a5 is for this publish only, not a reproducible-build assertion. The one ZIP with visible LICENSES is the justified minimal deviation from bare-single-EXE asset; no optional legal download/About UI.

## Fresh versus inherited

Fresh round2:all27 normal gates,31+21 strict suites, clean publish/final ZIP, data/native/identity/hash/audits,15 retained real-artifact controls, seven-scenario executed YAML/pwsh harness,69/69 workflow regressions, real Git autocrlf positive/negative clones, legal-byte-aware diff checks,14 upstream byte fetches, new authoritative NuGet runtime/host downloads,455 bundle assets compared directly to archives, independent SDK wording conversion, extra semantic/host/parser/satellite/deps mutations, and live worktree SDK guard.

Inherited:original Opus r1 review/evidence/provenance; original baseline EXE used only as negative control (base904385e was not rebuilt); availability of SDK/PWSH/native package from prior scratch; prior key/rekey-stub source analysis. Parent's fix1 publish and ZIP were NOT reused. The worker's claim of a distinct runtime/host source commit is independently disproved by B4, not assumed true. Old8.0.24 results remain historical only.

## Remaining native/legal/publication limits

- No Windows startup, actual legal extraction, WPF/D3D/e_sqlite3 loading, WGC/OCR/DPAPI, game captures/import or UI verification. Native tests cross-build but cannot run on macOS. H4 remains a human gate.
- No real GitHub workflow/runner, setup-dotnet download action, upload-artifact or gh release. No tag/push/deployment. Actual hosted Windows Python/Git availability is not established by local mocks; missing interpreter fails closed. No hosted output is invented.
- Microsoft Library and SDK distributor/end-user agreements, indemnities and other obligations are explicitly unresolved HUMAN publication gates. Technical file delivery does not accept/fulfill them; neither an eventual PASS nor green tests authorize release.
- No paid runtime feature/service/new application dependency/audit suppression/unrelated upgrade, and no production image/DB/capture/schema/master/golden fixture changes. T16b S8/N6 remain separate.
- Fix round1 of2 is consumed. B4 can be corrected narrowly; republishing is required to carry corrected inventory bytes.

## Worktree end state

The worktree was clean at exact863b22dce4f5737cdcafa42fc0bc45eb47817bb2 throughout the checks. Final live HEAD/status/branch readback is performed immediately after saving this report; any discrepancy is reported before returning the verdict. No tracked review/changelog edits, commits, main changes or external publication occurred.
