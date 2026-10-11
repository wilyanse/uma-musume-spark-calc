T18 independent review, round 1
Candidate a3e1fd3fd2f140f6e7ae5f575a345a99cdf21e2e on task/T18-agent-sqlite-security. Base 6cc73a668ca136c1f40c68301a1ec0586d4f03d5.

Verdict: PASS

Blocking: none.

Should fix: none.

Nits (none of these blocks the merge; no fix round is needed):
- N1 docs/changelog/assets/T18/baseline.log and baseline-native.log: both names suggest a successful baseline, but the files hold the two failed harness runs (exit 150 apphost, and exit 134 AppContext). The stdout of the successful generator run ("baseline engine 3.49.1 … pending 2") is not in a tracked asset. agent/tests/fixtures/sqlite/README.md:18 says the "Generator and real RED output are retained", which is true for the generator and the RED test, but not for the successful generator output. Fix: rename the logs (*-failed-*.log) or add the successful generator stdout. I reproduced it myself (see below), so this is only an evidence gap.
- N2 docs/changelog/assets/T18/baseline-generator.cs.txt:4 and assets/T18/gates.py hard-code absolute local worktree/scratch paths. They are evidence only, so this is acceptable. A one-line note would help: rerunning needs the paths changed.
- N3 agent/tests/Uma.Agent.Core.Tests/SqliteSecurityTests.cs:29-30, agent/tests/Uma.Agent.Windows.Tests/Tools/sqlite_native_probe.py:54,65-66 and the agent/legal/README.md hashes pin 3.53.3, its source ID and the nupkg 2.1.12. This exact-identity pin is intentional and matches spec 66. Any future SQLite bump must update all three places together. One sentence saying so in the runbook would help maintainers.
- N4 docs/changelog/assets/T18/sqlite3533.html and sqlite3534.html are full copies of upstream web pages (the whole asset dir is 316K). Acceptable as retained evidence; optional trim.

Checklist
1. Spec conformance: ok.
   - The selection is from real metadata. I re-fetched the NuGet flat-container indexes: 2.1.12, 2.1.13 and 3.0.0–3.0.5 exist, and lib.e_sqlite3 3.50.3 / 3.53.3 exist.
   - Microsoft.Data.Sqlite(.Core) 10.0.3 stays as it was: MIT, minimum bundle/core 2.1.11.
   - One exact bundle 2.1.12 pin. The restored graph differs from base by exactly the 4 SQLitePCLRaw packages (2.1.11→2.1.12). SharpZipLib 1.4.2 and System.Memory 4.5.3 are unchanged, and this holds on all 7 agent projects. No major-version mixing.
   - The 2.1.13 osx-arm64 and win-x64 natives are byte-identical to 2.1.12 (verified), so not adopting them is justified.
   - Targets net8.0 and net8.0-windows10.0.19041.0 are unchanged. No production .cs, schema, settings, image or card change: the only src diff is one csproj line, plus Directory.Build.props.
2. Correctness: ok.
   - In agent/src, Microsoft.Data.Sqlite is used only by UploadOutbox (Outbox.cs).
   - Settings is atomic JSON (Portable/Settings.cs:108, AtomicFile). Cards have no SQLite store (Q-152).
   - No call path changed. Batteries init goes through Microsoft.Data.Sqlite's bundle discovery; the loaded engine and the full suites prove it works.
3. Test quality: ok.
   - I reproduced the RED at f8ccbf6 in a scratch export: 1 of 6 failed, "GHSA-2m69-gcr7-jv3q: loaded 3.49.1".
   - I rebuilt the fixture from the retained generator against the f8ccbf6 (2.1.11) tree. It is byte-identical, SHA c9faaa28…4c22, and the engine reported 3.49.1. File header SQLITE_VERSION_NUMBER is 3049001, integrity ok, journal_mode delete, user_version 0. The data is synthetic Collect.LowConfidence, with no user data or credentials.
   - The compatibility, rollback and backup tests honestly say they pass on both engines. They exercise real SQLite: unchanged schema, exact payloads, retry state, AlreadyQueued/AlreadyUploaded, rollback at all 3 insertion points, crop_results rollback with a unique-constraint check after reopen, and the online BackupDatabase API.
   - They do not freeze wrong behavior: they assert existing documented semantics.
4. Fabrication check: ok.
   - Every claimed hash, version, source ID, licence and commit was reproduced independently (see below).
   - The changelog's numbers match fresh runs: 420/230, 6/6, bundle 15/15, 62/62, MemoryProbe/EdgeProbe figures, EXE size 191575874.
5. Security: ok.
   - GHSA-2m69-gcr7-jv3q (CVE-2025-6965, fixed in 3.50.2) is resolved by the loaded 3.53.3.
   - The sqlite.org CVE table lists nothing fixed after 3.53.2.
   - GitHub advisories for the bundle, provider, core, Microsoft.Data.Sqlite(.Core) and System.Memory: none. The only SharpZipLib entries are <1.3.3, which does not affect the 1.4.2 we use.
   - NuGetAuditMode=all is load-bearing. With the base props (mode=direct), a transitive-only 2.1.11 graph restores with exit 0. With the candidate props, the same graph fails NU1903.
   - No suppression added. The only NoWarn (WFAC010) is pre-existing and unrelated.
6. Free-tier / paid: ok. No key, account, service or paid dependency. Apache-2.0/MIT/public-domain only.
7. Scope: ok. Edits are limited to props, the Core csproj, a new test, the fixture, a probe tool, agent/legal, a runbook paragraph, and the changelog and its assets. No TS, schema, master, golden, .github or image changes.
8. Maintainability: ok, apart from the nits. The pins are exact, no dead code, warnings are errors.

Commands run (fresh unless marked inherited)
Environment: DOTNET_ROOT=/Users/willjose/.hermes/cache/scratch/T16b/dotnet-combo, D=$DOTNET_ROOT/dotnet, R=/Users/willjose/.hermes/cache/scratch/T18-r1.

$ bash .github/scripts/agent-gates.sh runtime
Microsoft.NETCore.App 8.0.31 [...]  (also 9.0.14 and 10.0.3)

$ for 7 projects (Core, Windows, Core.Tests, Portable, Native, EdgeProbe, MemoryProbe):
    $D restore <p> --force --no-http-cache -p:EnableWindowsTargeting=true
    $D list <p> package --vulnerable --include-transitive
    $D msbuild <p> -getProperty:NuGetAudit,…
all exit 0. Output: "has no vulnerable packages given the current sources" for all 7, and
{"NuGetAudit":"true","NuGetAuditMode":"all","NuGetAuditLevel":"low","TreatWarningsAsErrors":"true"}
project.assets.json for every target, including net8.0-windows10.0.19041/win-x64: bundle, core, lib and provider are all 2.1.12. Source is api.nuget.org only.

$ curl NuGet nupkgs; shasum -a 256
bundle a9a06e6b…54e1, provider df2b3271…7595, core af069041…dca5, lib 4a22c02f…30ac
These equal agent/legal/README.md, ~/.nuget/packages, and the worker's /Users/willjose/.hermes/cache/scratch/T18 nupkg (cmp identical).
Nuspecs: Apache-2.0, "Copyright 2014-2024 SourceGear, LLC". The bundle's netstandard2.0 group depends on provider.e_sqlite3 2.1.12 and lib 2.1.12. Provider depends on core 2.1.12. Core depends on System.Memory 4.5.3.
The lib's buildTransitive/net8.0 target only acts when RID == browser-wasm.

$ native assets from the nupkg
2.1.11 osx-arm64 bea55731…, source 2025-02-18 … 873d4e27…
2.1.11 win-x64 4dcbb2ad…, same source
2.1.12 osx-arm64 09fe20a6…, source 2026-06-26 20:14:12 d4c0e51e…2c62
2.1.12 win-x64 b7385d72…, same source
2.1.13: both assets have the same hashes as 2.1.12.

$ curl api.github.com/advisories/GHSA-2m69-gcr7-jv3q
high CVE-2025-6965; SQLitePCLRaw.lib.e_sqlite3 (+.android/.ios) <= 2.1.11; first_patched None

$ sqlite.org/releaselog/3_53_3.html
SQLITE_SOURCE_ID 2026-06-26 20:14:12 d4c0e51e…2c62 (matches)
3.53.4 exists (2026-07-24), described as "Fixes for problems … mostly coming from AIs".
cves.html: newest fixes are 3.53.2 (CVE-2026-11822/11824), which 3.53.3 includes.

$ GitHub tag v2.1.12 → commit ca835d21…
raw LICENSE.TXT, NOTICE.TXT and sqlite version-3.53.3/LICENSE.md: cmp identical to the agent/legal copies.

$ $D build Core.Tests -c Release --no-incremental
Build succeeded. 0 Warning(s), 0 Error(s)
$ bash .github/scripts/agent-gates.sh core-tests
Passed! - Failed: 0, Passed: 420, Skipped: 0, Total: 420
$ $D test Core.Tests -c Release --no-build --filter ~SqliteSecurityTests (detailed)
6/6 passed; "Actually loaded SQLite 3.53.3; source_id 2026-06-26 20:14:12 d4c0e51e…2c62"
$ DYLD_PRINT_LIBRARIES=1 … --filter ~Loaded_native_engine
dyld loaded …/Uma.Agent.Core.Tests/bin/Release/net8.0/runtimes/osx-arm64/native/libe_sqlite3.dylib, Mach-O arm64, sha 09fe20a6… (matches the package). /usr/lib/libsqlite3.dylib is also loaded by OS frameworks; the SQL-reported identity proves which engine the provider uses.
$ $D build Portable -c Release --no-incremental
0 warnings / 0 errors
$ $D test Portable -c Release
Passed: 230 / 230
$ $D build Windows, Native and agent/Uma.Agent.sln each -c Release --no-incremental -p:EnableWindowsTargeting=true
each 0 Warning(s), 0 Error(s)
$ agent-gates.sh windows-build
0/0
$ $D publish Windows -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableWindowsTargeting=true -o $R/publish
exit 0, no warnings, EXE 191575874 bytes
$ python3 …/bundle_probe.py $R/publish/Uma.Agent.Windows.exe <worktree>
matches 15 of 15
$ python3 …/sqlite_native_probe.py $R/publish/Uma.Agent.Windows.exe <fresh nupkg>
runtimes/win-x64/native/e_sqlite3.dll size 1978880 PE32+ AMD64 (0x8664) SHA256 b7385d722c83fb52142a00477a726723745916d22a555711ee89834c1111fb2e; Embedded SQLite 3.53.3
The same probe on the parent publish, /Users/willjose/.hermes/cache/scratch/T18-parent-publish: pass.
Negative controls:
- Probe against the 2.1.11 nupkg → "AssertionError: unexpected native package pin"
- Probe against an EXE copy with one byte flipped in the source ID → "published DLL differs from exact NuGet RID asset"

RED reproduction: git archive f8ccbf6 → $R/red, then $D test … ~SqliteSecurityTests
exit 1; Failed Loaded_native_engine… "GHSA-2m69-gcr7-jv3q: loaded 3.49.1"; Passed: 5

Fixture provenance: baseline-generator.cs.txt (only the AppContext path changed) built against the $R/red tree
"baseline engine 3.49.1 2025-02-18 … 873d4e27…; capture 01K7B33MXGVZV6TZRJZDHB99YE fingerprint a0fbe2ae…; pending 2"
regen.db SHA c9faaa28…4c22, the same as the tracked fixture.

Audit enforcement controls (git archive HEAD → $R/neg):
- Bundle pinned back to 2.1.11 → restore exit 1, NU1903 high GHSA-2m69-gcr7-jv3q
- Bundle reference removed (transitive-only 2.1.11) → restore exit 1, NU1903
- Same, with the NuGetAudit lines removed from props (the base props) → mode "direct", restore exit 0, graph shows lib 2.1.11. This proves the props change is necessary.

$ TOOLS_DIR=… bash .github/tests/run.sh
regression checks: 62 passed, 0 failed
$ node .github/scripts/check-config.mjs .
config check ok (structure): MASTER_VERSION=global-20260930
$ MemoryProbe and EdgeProbe: build --no-incremental 0/0, then run
Memory: +MB 75.8 / 9.4 after Stop / 672.0 vs the 664 MB frame bound (same as the changelog)
Edge: "DRAIN bounded=8 …", "ASSERTIONS passed"

End state: git rev-parse HEAD = a3e1fd3fd2f140f6e7ae5f575a345a99cdf21e2e. Porcelain (including untracked) is empty, diff and cached diff are clean. Only ignored bin/obj build outputs changed.

Inherited vs fresh evidence
- Fresh in this review: everything above, including the Windows win-x64 restore/audit, the solution cross-build and the publish probe.
- Inherited, not re-run here:
  - the parent's own publish, beyond probing its EXE
  - the worker's metadata.log, releases.json and red-audit.log as artifacts. Their content was re-derived by my independent queries, so they are not relied on.

Remaining native/release limits (not T18 defects)
- H4: no Windows execution. Native tests were compiled, not run. Single-file extraction and loading of e_sqlite3.dll, WGC/OCR/DPAPI, and the x64 engine at runtime are unverified. The PE/hash/embedded-ID match is byte inspection only.
- macOS proof covers osx-arm64 only. osx-x64 and other RIDs were not executed.
- T19 still blocks any agent-v release: recipients must actually receive the licence/NOTICE texts. agent/legal is an inventory only, and it says so.
- Advisory state is current-feed evidence (GitHub/NuGet/sqlite.org as of today), not a guarantee that 3.53.3 is free of bugs. 3.53.4 exists with unspecified AI-reported fixes and no CVE listed. Consider it in a future maintenance bump.
