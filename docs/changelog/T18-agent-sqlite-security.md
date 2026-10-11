# T18 — Agent native SQLite advisory remediation

- **Status:** Partial — scoped implementation and local gates complete; parent independent review/rerun and H4 remain. No release approval.
- **Branch:** task/T18-agent-sqlite-security (base 6cc73a668ca136c1f40c68301a1ec0586d4f03d5)
- **Agent / model:** user-directed openai-codex/gpt-6.1-sol, medium reasoning; direct implementation, no delegation/model CLI/provider/config changes.
- **Date:** 2026-10-11
- **Code/test/package candidate:** 29f12b805d831414827d56b40283e7259f115e63. Subsequent commit is task evidence/changelog only.

## Summary

The smallest inspected compatible bundle update fixes the actual inherited SQLite engine: Microsoft.Data.Sqlite stays 10.0.3, with a new exact SQLitePCLRaw.bundle_e_sqlite3 2.1.12 reference. Provider/core/native resolve coherently to 2.1.12; loaded SQLite is 3.53.3, not the original vulnerable 3.49.1.
Scoped agent builds now retain all-transitive NuGet audit, enabled with warnings as errors. New native-version, persisted pre-upgrade DB, rollback/reopen and backup regressions pass. Published win-x64 native DLL exactly matches the selected NuGet RID asset. All original 414 Core/230 Portable tests are retained; Core is now 420.
No production database, capture, image, card, settings, schema, transaction or backup code changed.

## Files

Created:
- `agent/tests/Uma.Agent.Core.Tests/SqliteSecurityTests.cs` — six deterministic cases: loaded engine/source ID, pre-upgrade file roundtrip/backup, failed enqueue at all three insertion points, failed crop acknowledgement rollback/unique pending row.
- `agent/tests/fixtures/sqlite/outbox-3.49.1.db` and `README.md` — real pre-fix native-engine file, immutable SHA-256/provenance, no user DB or credentials.
- `agent/tests/Uma.Agent.Windows.Tests/Tools/sqlite_native_probe.py` — exact published native bytes, RID/PE architecture and embedded source proof; not Windows execution.
- `agent/legal/SQLitePCLRaw-2.1.12-{LICENSE,NOTICE}.txt`, `SQLite-3.53.3-LICENSE.md` — verbatim upstream texts, hashes in inventory.
- `docs/changelog/assets/T18/**` — fresh metadata, actual RED, command manifest and unmodified gate outputs (dyld output trimmed to SQLite lines).
- `docs/changelog/T18-agent-sqlite-security.md` — this report.

Modified:
- `agent/src/Uma.Agent.Core/Uma.Agent.Core.csproj` — one exact bundle override, no database provider/SharpZipLib/framework upgrade.
- `agent/Directory.Build.props` — `NuGetAudit=true`, `NuGetAuditMode=all`; existing TreatWarningsAsErrors retained. Effective audit level is low.
- `agent/legal/README.md` — minimal selected package/source/native/licence inventory for T19, not a complete runtime inventory or recipient delivery.
- `docs/runbooks/agent-install.md` — two focused SQLite/audit/native-proof paragraphs; backup procedure unchanged.

## Decisions

### Fresh metadata before selection

Actual queried indexes and downloaded nuspec/assets are retained in `assets/T18/*-versions.json` and `metadata.log`. Advisory/API and releases are saved verbatim. Sources:
- https://api.github.com/advisories/GHSA-2m69-gcr7-jv3q
- https://api.nuget.org/v3-flatcontainer/<package-id>/index.json
- https://api.github.com/repos/ericsink/SQLitePCL.raw/releases?per_page=10

The fresh GHSA says SQLite <3.50.2 is vulnerable; affected native NuGet <=2.1.11; first_patched_version remains null. We did not interpret that null, or absence from an advisory list, as engine proof.

Inspected choices:
- Original Microsoft.Data.Sqlite/Core 10.0.3: MIT; net8.0 Microsoft.Data.Sqlite.dll; bundle/core minimum 2.1.11. Kept unchanged.
- Bundle 2.1.12: Apache-2.0; netstandard2.0 batteries; provider.e_sqlite3/native minimum 2.1.12. Provider -> core 2.1.12 -> existing System.Memory 4.5.3. Native package has osx-arm64/win-x64 and other RID assets, no dependencies; net8 buildTransitive target only adds a static native reference when RID is browser-wasm. No key/runtime product.
- Bundle/native 2.1.13: inspected; the osx-arm64 and win-x64 native assets are byte-identical to 2.1.12, both SQLite 3.53.3. No native security improvement demonstrated for these target RIDs.
- Bundle 3.0.5: actual nuspec changes graph to SQLitePCLRaw.config.e_sqlite3 3.0.5 + SQLite 3.53.4; no bundle assembly. Not adopted because the same-line maintenance bundle already satisfies this scope without a major/package-family migration.

Selected ONE bundle 2.1.12 direct pin, rather than four redundant references or a Microsoft.Data.Sqlite upgrade. Actual fresh graphs show bundle/provider/core/lib all 2.1.12 on Core/Windows/test targets. The normal NuGet restore resolves the bundle's dependency minimums to these precise versions; no mixed SQLitePCLRaw major was introduced. All other packages are unchanged.
The upstream v2.1.12 release prose names native 3.53.3, while downloaded bundle nuspec names native package 2.1.12: actual package metadata/graph and engine bytes, not prose or numeric-major alignment, determine the result.

### Loaded and published native proof

macOS SQL through Microsoft.Data.Sqlite (real test process):
`SQLite 3.53.3; sqlite_source_id() = 2026-06-26 20:14:12 d4c0e51e4aeb96955b99185ab9cde75c339e2c29c3f3f12428d364a10d782c62`.
This equals the authoritative https://sqlite.org/releaselog/3_53_3.html source identity (saved). 3.53.4 exists and its release log was inspected, but latest-version adoption is not a prerequisite for the specifically fixed advisory; this is not a universal bug-free claim.

DYLD_PRINT_LIBRARIES in the actual test host records loading:
`agent/tests/Uma.Agent.Core.Tests/bin/Release/net8.0/runtimes/osx-arm64/native/libe_sqlite3.dylib`.
File is Mach-O arm64, byte-identical to the downloaded native nupkg asset, SHA-256
`09fe20a6c050912a7944b2f2f2981debe31679f7919f523c87251ae8cf0f2daa`.
OS frameworks also load their system SQLite for unrelated runtime purposes; that is not claimed to be this provider's engine. The provider's actual SQL source/version is asserted separately. No system SQLite install/configuration was used.

Publish assets target `net8.0-windows10.0.19041/win-x64` selects `SQLitePCLRaw.lib.e_sqlite3/2.1.12` and `runtimes/win-x64/native/e_sqlite3.dll`. The single-file native entry (1978880 bytes) is exactly the downloaded package asset, PE32+ AMD64 machine 0x8664, SHA-256
`b7385d722c83fb52142a00477a726723745916d22a555711ee89834c1111fb2e`.
It embeds SQLite 3.53.3 and the same source ID. No inference of Windows execution: Native tests were compiled only; actual execution remains H4.

### Database compatibility, rather than an invented Store API

Inspected actual UploadOutbox definitions/usages, SettingsStore, capture pipeline, existing outbox/upload robustness tests and card shell tests before edits. There is no SQLite SettingsStore or card table: settings are atomic JSON; support-card scans/uploads are memory-only, intentionally without a durable outbox (Q-152). No imaginary card/settings SQLite storage was introduced.

A scratch harness used unchanged UploadOutbox + the existing sealed `Collect.LowConfidence()` result on actual SQLite 3.49.1 BEFORE the pin. It saved /stats/gut, backed off /sparks/3/sparkId and left its veteran pending with the verified capture hash. The Skills whole-list coverage and two uncertain readings are explicitly synthetic test inputs, not game facts. Baseline file SHA-256 is c9faaa288e8a6573293b7550e9df70c39b8b545196917ee97e46115f84a24c22, 86016 bytes.
The new test copies this frozen file, asserts unchanged schema, exact payload/crop bytes, stable retry IDs/attempts/error/due timestamp, AlreadyQueued/AlreadyUploaded behavior, preserved fingerprint/veteran/field confidence/status, both crop keys, reopen after writes and SQLite BackupDatabase/restore compatibility. New failure tests verify capture-hash/outbox rollback at every insertion point and crop_results rollback when deletion fails, followed by reopen/unique-constraint/retry success. These compatibility cases passed on the old engine too; the security expectation is the meaningful failing-before change.
Existing full suites additionally preserve legacy DB duplicate migration, concurrent enqueue, pending/sealed capture recovery, upload authentication/retry/dead-letter behavior, card provenance/cancellation/destructive-partial policies, atomic settings/secret roundtrips and malformed-settings recovery. EdgeProbe confirms exact failed-enqueue payload/ID/crop retention and settings backup preservation. No fixture/threshold/PNG behavior was changed.

### Audit and legal boundaries

Effective properties read from all five Core/Windows/Core.Tests/Portable/Native projects:
`NuGetAudit=true; NuGetAuditMode=all; NuGetAuditLevel=low; TreatWarningsAsErrors=true`.
Fresh forced/no-http-cache restores and --vulnerable --include-transitive reports show no reported vulnerabilities for these project package graphs, from https://api.nuget.org/v3/index.json. Fresh GitHub affects queries for selected bundle/native/core/provider and SQLite@3.53.3 returned []. This is current feed/package evidence, NOT blanket runtime/application security approval. No unrelated advisory blocked this pin; no outside-scope upgrade or suppression was applied. Existing Windows WFAC010 suppression is pre-existing and untouched.

All four SQLitePCLRaw nuspecs identify Apache-2.0, copyright 2014-2024 SourceGear, LLC. The verified upstream v2.1.12 tag resolves to ca835d21508bff43121c65081035840ac5006c4c; nuspecs do not claim a source commit. Licence and NOTICE copies match that reference; native SQLite is public domain. Repository-wide NOTICE includes optional SQLCipher/OpenSSL sections and is retained verbatim, not evidence those components ship. Full hashes and obligations are in agent/legal/README.md. T19 must deliver applicable copyright/licence/NOTICE texts to recipients alongside other bundled/runtime notices. Nothing in this task packages those texts into the EXE or authorizes distribution.

## Deviations from spec

None in implementation scope. Acceptance is partial because independent parent review/rerun and native Windows H4 execution are not performed by this direct worker. No self-approval, merge, push or deployment.

## Cross-task edits

`agent/Directory.Build.props`, `agent/legal/**`, `docs/runbooks/agent-install.md` and the SQLite-native verification tool are explicitly within scoped66 ownership despite their shared build/packaging locations. No TS/schema/master/golden/.github production/image/threshold edits; no root CHANGELOG/status-plan edits.

## Verification

Process-scoped environment, no global changes:
```sh
export DOTNET_ROOT=/Users/willjose/.hermes/cache/scratch/T16b/dotnet-combo
export DOTNET_BIN=$DOTNET_ROOT/dotnet
export TOOLS_DIR=/Users/willjose/.hermes/cache/scratch/IR1/tools
D=$DOTNET_BIN
S=/Users/willjose/.hermes/cache/scratch/T18
```
SDK 10.0.103, native test runtime Microsoft.NETCore.App 8.0.31 verified first. Existing scratch age v1.3.2/actionlint 1.7.12 verified first; no repair/install needed.

RED retained at f8ccbf62416ecb6cc9625250a4fd5bc7c8731b9d, before package/props fix:
```
$ $D test agent/tests/Uma.Agent.Core.Tests -c Release --filter FullyQualifiedName~SqliteSecurityTests --logger 'console;verbosity=detailed'
Test Run Failed. Total tests: 6, Passed: 5, Failed: 1
GHSA-2m69-gcr7-jv3q: loaded 3.49.1
Actually loaded SQLite 3.49.1; source_id 2025-02-18 13:38:58 873d4e274b4988d260ba8354a9718324a1c26187a4ab4c1cc0227c03d0f10e70
$ $D restore agent/src/Uma.Agent.Core/Uma.Agent.Core.csproj --force --no-http-cache -p:NuGetAuditMode=all
error NU1903: Warning As Error: Package 'SQLitePCLRaw.lib.e_sqlite3' 2.1.11 has a known high severity vulnerability, https://github.com/advisories/GHSA-2m69-gcr7-jv3q
Failed to restore .../Uma.Agent.Core.csproj (in 135 ms). [exit 1]
```

Fresh candidate gate runner: `python3 /Users/willjose/.hermes/cache/scratch/T18/gates.py` -> exit 0, ALL GATES COMPLETED. Retained copy `assets/T18/gates.py`; `assets/T18/gates/commands.json` enumerates ALL 40 exact expanded commands/environment overrides and real exit codes; each corresponding .log is the actual output (dyld trimmed, full scratch log preserved). No bin/obj deletion, git clean/reset, or --no-build. Explicit --no-incremental builds rebuilt Core/test, Windows/Portable/Native/solution/tools; subsequent normal tests were never used after a failed build.

Representative commands/real outputs (all exit 0 unless noted above):
```
$ bash .github/scripts/agent-gates.sh runtime
10.0.103; Microsoft.NETCore.App 8.0.31 present
$ $D restore <each exact project in commands.json> --force --no-http-cache -p:EnableWindowsTargeting=true
Restored ... [all five projects; audit properties from retained agent props]
$ $D list <each same project> package --vulnerable --include-transitive --format json
sources: [https://api.nuget.org/v3/index.json]; projects returned, no vulnerable package entries [all five]
$ $D msbuild <each same project> -p:EnableWindowsTargeting=true -getProperty:NuGetAudit,NuGetAuditMode,NuGetAuditLevel,TreatWarningsAsErrors
true / all / low / true
$ $D build agent/tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj -c Release --no-incremental
Build succeeded. 0 Warning(s), 0 Error(s)
$ bash .github/scripts/agent-gates.sh core-tests
Passed! - Failed: 0, Passed: 420, Skipped: 0, Total: 420, Duration: 47 s
$ $D test agent/tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj -c Release --filter FullyQualifiedName~SqliteSecurityTests --logger 'console;verbosity=detailed'
Test Run Successful. Total tests: 6, Passed: 6; Actually loaded SQLite 3.53.3 [full source_id above]
$ $D build agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -c Release --no-incremental -p:EnableWindowsTargeting=true
Build succeeded. 0 Warning(s), 0 Error(s)
$ bash .github/scripts/agent-gates.sh windows-build
Build succeeded. 0 Warning(s), 0 Error(s)
$ $D build agent/tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release --no-incremental
Build succeeded. 0 Warning(s), 0 Error(s)
$ $D test agent/tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release
Passed! - Failed: 0, Passed: 230, Skipped: 0, Total: 230, Duration: 8 s
$ $D build agent/tests/Uma.Agent.Windows.Tests/Native/Uma.Agent.Windows.Tests.csproj -c Release --no-incremental -p:EnableWindowsTargeting=true
Build succeeded. 0 Warning(s), 0 Error(s)
$ $D build agent/Uma.Agent.sln -c Release --no-incremental -p:EnableWindowsTargeting=true
Build succeeded. 0 Warning(s), 0 Error(s)
$ $D publish agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableWindowsTargeting=true -o $S/publish
exit 0; actual EXE 191575874 bytes
$ python3 agent/tests/Uma.Agent.Windows.Tests/Tools/bundle_probe.py $S/publish/Uma.Agent.Windows.exe <exact task worktree>
bundle 6 0 entries 474; matches 15 of 15
$ python3 agent/tests/Uma.Agent.Windows.Tests/Tools/sqlite_native_probe.py $S/publish/Uma.Agent.Windows.exe $S/sqlitepclraw.lib.e_sqlite3.2.1.12.nupkg
runtimes/win-x64/native/e_sqlite3.dll size 1978880 PE32+ AMD64 (0x8664)
SHA256 b7385d722c83fb52142a00477a726723745916d22a555711ee89834c1111fb2e
Embedded SQLite 3.53.3; source_id [exact above]; Exact native package asset matches published bundle
$ TOOLS_DIR=$TOOLS_DIR bash .github/tests/run.sh
regression checks: 62 passed, 0 failed
$ node .github/scripts/check-config.mjs .
config check ok (structure): MASTER_VERSION=global-20260930
$ $D build agent/tests/Uma.Agent.Windows.Tests/Tools/MemoryProbe -c Release --no-incremental
$ $D build agent/tests/Uma.Agent.Windows.Tests/Tools/EdgeProbe -c Release --no-incremental
each Build succeeded. 0 Warning(s), 0 Error(s)
$ $D agent/tests/Uma.Agent.Windows.Tests/Tools/MemoryProbe/bin/Release/net8.0/MemoryProbe.dll <exact task worktree>
idle 240 polls: processed 1 skipped 239, +MB 9.2; changing still +MB 8.3
20 veterans: +MB 75.8; after Stop 0 sessions/frames, +MB 9.4; worst 80 frames +MB 672.0 (664 MB frame bound)
$ $D agent/tests/Uma.Agent.Windows.Tests/Tools/EdgeProbe/bin/Release/net8.0/EdgeProbe.dll <exact task worktree>
RETRY queued=1; oldCapturePayloadsExact=True; oldIDsPreserved=True; oldCropBytesExact=True
SETTINGS backups=2; firstPreserved=True; uploadsAllowed=False; notice=True
DRAIN bounded=8; oldDisposed=True; newestAlive=True; OCR tile cancellation propagated; calls=2; ASSERTIONS passed
$ DYLD_PRINT_LIBRARIES=1 $D test agent/tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj -c Release --filter FullyQualifiedName~Loaded_native_engine --logger 'console;verbosity=detailed'
actual test host loads .../runtimes/osx-arm64/native/libe_sqlite3.dylib; Passed 1, loaded SQLite 3.53.3
```
The metadata download script and fetched official SQLite release logs are retained. Initial scratch baseline `dotnet run` exited 150 because its apphost resolved the global .NET location without net8; direct DLL invocation then exited 134 because FixtureEnv's relative AppContext base pointed at scratch. Logs are retained. Corrected only the scratch generator's AppContext base; fresh build + direct inspected dotnet DLL execution succeeded and reported the 3.49.1 baseline above. Neither failed harness invocation is presented as test/gate success; no runtime/global repair or audit suppression occurred.

## Open questions / follow-ups

- No new contract/game question or human dependency selection was necessary.
- Parent must perform fresh independent read-only review and same-candidate rerun before local merge. No worker review/fix rounds used yet; maximum two bounded fix rounds remain under parent control. This worker did not launch a reviewer because delegation/model CLIs were explicitly forbidden.
- H4: actual Windows Native suite, single-file startup/extraction, loaded x64 engine, WGC/OCR/DPAPI/game imports and real field accuracy remain human gates. Cross-build/hash proof is not their substitute.
- T19 remains a release blocker: complete applicable bundled/runtime licence/NOTICE delivery to recipients, including this inventory. No release/push/deploy performed.
- T16b S8 Deflate back-reference conformance and N6 internal null consistency remain explicitly deferred to their separate codec follow-up; N7 licence-metadata dates belong to T19. No image changes or universal strict-RFC1951/security claim.
- TS workspace/browser/golden generation not run: none touched, no pnpm recursive build/master/golden refresh. Existing agent contract/fingerprint/card/image/field tests remain in the full executed suites.
