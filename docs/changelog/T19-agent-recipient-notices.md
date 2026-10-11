# T19 — Agent recipient licence/NOTICE delivery

- **Status:** Done (candidate) — pending parent gates and independent review. Not release approval; H4 and actual publication remain human gates.
- **Branch:** task/T19-agent-recipient-notices (base 904385e)
- **Agent / model:** anthropic claude-opus-5-5, reasoning medium; direct implementation, no delegation/model CLI/orch. Continued in the same session after the first process (proc_4369d1c7f9fa) was closed by the agent host (exit -15, agent_close, not a provider failure); that run had produced research and scratch files only, no tracked change.
- **Date:** 2026-10-11

## Summary

The win-x64 self-contained single-file agent now carries every applicable third-party licence/copyright/NOTICE text for what it actually ships. `agent/legal/inventory.json` covers all 12 shipped deps.json libraries (the .NET 8.0.24 and WindowsDesktop 8.0.24 runtime packs, the Windows SDK projection, Microsoft.Data.Sqlite, four SQLitePCLRaw packages, SharpZipLib and Serilog) plus the single-file host. The 15 texts in `agent/legal/notices/` (14 verbatim texts plus `INDEX.txt`) and the inventory are bundled read-only under `legal/` in the EXE.
The supported distribution is one deterministic ZIP: the EXE plus a top-level `LICENSES/` folder. `agent-release.yml` builds it and uploads only that ZIP.
`agent/legal/tools/recipient_notices.py` is a stdlib-only checker. It verifies the final EXE and ZIP bytes against the inventory and the packages and runtime packs of that same restore, and it fails closed on missing, corrupted or stale notices, on dependency or runtime drift, and on bundle files it cannot attribute.

## Files

Created:
- `agent/legal/inventory.json` — component → licence/copyright/source revision/nupkg SHA-256/notice files; notice SHA-256 and provenance; graph-only packages with reasons; single-file host build.
- `agent/legal/notices/INDEX.txt` — readable recipient index: component, version, texts, where the files are (ZIP `LICENSES/`, or the bundle's extracted `legal/`), plus the SharpZipLib dates and the SQLCipher/OpenSSL non-applicability.
- `agent/legal/notices/{dotnet-runtime-8.0.24-LICENSE.TXT, dotnet-runtime-8.0.24-THIRD-PARTY-NOTICES.TXT, dotnet-windowsdesktop-8.0.24-LICENSE.TXT, dotnet-wpf-8.0.24-THIRD-PARTY-NOTICES.TXT, dotnet-winforms-8.0.24-THIRD-PARTY-NOTICES.TXT, Microsoft.Windows.SDK.NET.Ref-10.0.19041.57-LICENSE.rtf, CsWinRT-2.2.0.241111.1-LICENSE.txt, Microsoft.Data.Sqlite-10.0.3-LICENSE.txt, Serilog-4.3.0-LICENSE.txt, Serilog.Sinks.File-6.0.0-LICENSE.txt}` — verbatim texts (sources below).
- `agent/legal/tools/recipient_notices.py` — `verify-exe`, `package`, `verify-zip`, `check-legal` and `report`.
- `agent/legal/tools/test_recipient_notices.py` — 31 deterministic regressions on synthetic bundles, package folders and legal directories. No network.
- `docs/changelog/assets/T19/{red-base-publish.log, neg-real-publish.log, neg-sdk-runtime-drift.log, gates-final.log, gates.sh.txt}` — real outputs.
- `docs/changelog/T19-agent-recipient-notices.md` — this report.

Modified / moved:
- `agent/legal/{SharpZipLib-1.4.2-LICENSE.txt, SQLite-3.53.3-LICENSE.md, SQLitePCLRaw-2.1.12-LICENSE.txt, SQLitePCLRaw-2.1.12-NOTICE.txt}` → `agent/legal/notices/` (git rename, bytes unchanged).
- `agent/legal/README.md` — rewritten as the delivery and verification guide. The T16b/T18 inventory, including every hash, is retained verbatim in sections marked "retained".
- `agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj` — one Content ItemGroup (`legal/inventory.json`, `legal/*`) and an `Error` target that stops the build if the inventory or index is missing. No other property, reference or target changed.
- `.github/workflows/agent-release.yml` — after publish: run the notice regressions, then `package` (verify the EXE, write the ZIP, verify the ZIP). The upload step and `gh release create` take only the ZIP, which is re-verified just before the release call. Tag regex, pinned actions, persist-credentials:false, `$env:` (no `${{ }}` in pwsh), permissions, setup-dotnet 8.0.x/9.0.x and timeout are unchanged.
- `.github/tests/workflow_structure.rb` — T19 release assertions: ZIP-only output, artifact and release asset; package after publish; ZIP verified before release; tag validation, persist-credentials and permissions retained. Optional `WORKFLOW_DIR` override so mutated copies can be tested.
- `.github/tests/run.sh` — T19 section with 5 checks: the regressions (warnings as errors), `check-legal`, and three mutated release workflows that must fail (bare-EXE upload, no ZIP verify, no packaging).
- `docs/runbooks/agent-install.md` — the old "release blocker: no licence texts" sentences are replaced by the delivery, ZIP and verification procedure and the H4/publication limits.

## Decisions

- **Inventory comes from the real publish graph, not PackageReferences.** I parsed the base (904385e) publish bundle manifest: 474 entries. Its embedded deps.json, the RuntimeList.xml of each restored runtime pack, and the `project.assets.json` package folder give the shipped set:
  - 447 entries are byte-identical to the NETCore/WindowsDesktop/SDK runtime-pack files (assemblies, natives and satellite resources);
  - 8 are NuGet package assets: Microsoft.Data.Sqlite, three SQLitePCLRaw DLLs plus e_sqlite3.dll, SharpZipLib, Serilog and Serilog.Sinks.File;
  - the rest are first-party DLLs, configuration, app data and the host.
  
  Three deps.json names exist in both the NETCore and WindowsDesktop packs: `Microsoft.VisualBasic.dll`, `System.Drawing.dll` and `WindowsBase.dll`. The verifier accepts a byte match against either pack and records both packs' notices.
- **Single-file host.** `singlefilehost.exe` comes from Microsoft.NETCore.App.Host.win-x64 8.0.24. Its LICENSE and THIRD-PARTY-NOTICES are byte-identical to the runtime pack's. The SDK rewrites the host's headers and resources, so the host bytes are not compared. Its build identity (ProductVersion `8,0,2426,7010 @Commit: b3b35ce…`) is required instead.
- **Runtime versions are not confused.** The publish resolves self-contained runtime packs 8.0.24 (SDK 10.0.103 via global.json 9.0.100 latestMajor; `project.assets.json` downloadDependencies). The tests ran on the shared runtime Microsoft.NETCore.App 8.0.31. The inventory and notices describe 8.0.24 only.
- **Drift is caught against the actual restore, not a frozen host.** `--assets obj/project.assets.json` selects that restore's package folder. The check then requires:
  - deps.json libraries equal to the inventory (new, changed or stale entries fail);
  - runtimeconfig `includedFrameworks` equal to the pack versions;
  - the nupkg SHA-256 of every restored pack and package;
  - the restored packs' LICENSE/THIRD-PARTY-NOTICES equal to the delivered copies;
  - every bundle entry byte-identical to a restored file.
  
  I tested this with a real SDK change (below): SDK 9.0.312 resolves 8.0.25, and the check fails.
- **Graph-only packages need an explicit, reasoned listing.** These deps.json entries ship no file: Microsoft.NET.ILLink.Tasks (listed by SDK 9.0.312), System.Memory 4.5.3 (its `_._` placeholder means the framework copy is used) and System.Security.Cryptography.ProtectedData 8.0.0 (the shipped DLL, 55,568 B, is byte-matched to the WindowsDesktop pack copy). Any unlisted asset-less entry fails, and so does a listed one that starts shipping files.
- **Sources (exact versions):**
  - .NET runtime texts come from the restored runtime pack. They equal dotnet/runtime@b3b35ce apart from CRLF line endings, so I kept the shipped package bytes.
  - The WindowsDesktop pack ships only a LICENSE. I took WPF and WinForms THIRD-PARTY-NOTICES from dotnet/wpf@738c1f8 and dotnet/winforms@464883c, the commits named in dotnet/windowsdesktop@d0e3683 `eng/Version.Details.xml` (d0e3683 is the pack's nuspec commit).
  - Microsoft.Data.Sqlite: dotnet/dotnet@c2435c3 `src/efcore/LICENSE.txt` (the nuspec commit).
  - Serilog: serilog@726e29c `LICENSE`.
  - Serilog.Sinks.File: serilog-sinks-file@c7b9bc3 `LICENSE`.
  - Neither Serilog repository has a NOTICE file at those commits.
  - SharpZipLib and SQLitePCLRaw/SQLite texts are the T16b/T18 verbatim copies; their hashes were re-checked.
  - All upstream texts were re-downloaded and `cmp`-identical when committed.
- **Windows SDK projection.** The package carries no licence file. Its nuspec `licenseUrl` (https://aka.ms/WinSDKLicenseURL) redirects to `sdk_license.rtf`, the Windows 10 SDK licence terms, EULAID WIN10SDK.RTM.AUG_2018. I included it verbatim (SHA-256 dd07eb17…). The SDK REDIST list (learn.microsoft.com/en-us/legal/windows-sdk/redist, "REDIST.TXT UPDATED 10/21/2024") names this package's `lib/net8.0/Microsoft.Windows.SDK.NET.dll` and `WinRT.Runtime.dll` as distributable "as part of your program". WinRT.Runtime's ProductVersion commit 8649ee3 is the CsWinRT tag 2.2.0.241111.1, so I added that MIT LICENSE. Both DLLs' version resources say "(c) Microsoft Corporation".
- **SQLCipher/OpenSSL are not asserted to ship.** The SQLitePCLRaw NOTICE is kept verbatim, and INDEX.txt says its SQLCipher/OpenSSL sections do not apply. The evidence:
  - the shipped e_sqlite3.dll has 0 occurrences of SQLCipher/sqlcipher/OpenSSL/openssl/libcrypto/Zetetic/"Eric Young";
  - its exports `sqlite3_key`, `key_v2`, `rekey` and `rekey_v2` match ericsink/cb `stubs/stubs.c`, which returns SQLITE_ERROR;
  - its compile options list no codec.
- **T16b N7 (SharpZipLib dates).** The upstream LICENSE text is unchanged ("2000-2018"). The inventory and INDEX cite both it and the nuspec's "2000-2022".
- **Serilog.Sinks.File** has no copyright line in its nuspec, assembly or LICENSE. I recorded only its authors and did not invent a copyright line.
- **Embedded plus ZIP.** The embedded `legal/` keeps the single-EXE content model, but the extraction folder is a hidden temp cache. I judge that an ordinary recipient can't reasonably be expected to find it (see Deviations). The ZIP is deterministic: fixed timestamps and member order.
- **Notice entries are uncompressed.** The verifier requires that: the bundle uses no compression, and a compressed entry fails.
- **Python stdlib tool.** It runs locally and on windows-latest (Python is preinstalled, invoked as `python`) with no new runtime or package dependency, and nothing is added to the agent. It is not shipped.

## Deviations from spec

- **67 §2 (single EXE preferred).** The notices are embedded, but the release asset changes from the bare EXE to one ZIP: the EXE plus `LICENSES/`. The runtime-extracted location (`%TEMP%\.net\…\legal\`) exists only after a launch and is not discoverable, so it does not reliably meet "accessible to an ordinary recipient". This is the smallest change that keeps the EXE unchanged in behaviour. The workflow, its structure tests and the runbook all switched to the ZIP; no EXE-only asset is produced. 65 §4 says the workflow "publishes the single-file exe as a release asset"; the EXE is still single-file, now delivered inside the verified ZIP.
- **Host bytes.** The single-file host is identified by its build/version resource rather than by its bytes, because the SDK patches the host image.

## Cross-task edits

- `.github/workflows/agent-release.yml`, `.github/tests/*`, `docs/runbooks/agent-install.md` — owned by T19 per the 67 §Ownership and 80 card. The scope is limited to packaging, verification and recipient text.

## Verification

Environment: `DOTNET_ROOT=/Users/willjose/.hermes/cache/scratch/T16b/dotnet-combo`, `DOTNET_BIN=$DOTNET_ROOT/dotnet`, SDK 10.0.103, test runtime Microsoft.NETCore.App 8.0.31, `TOOLS_DIR=…/scratch/IR1/tools`, `TMPDIR` under `scratch/T19`.
Before the run, every `agent/**/bin` and `obj` was deleted, so the run is fresh. Audit was at the repository defaults (NuGetAudit true, mode all, level low, warnings as errors).
The script is `assets/T19/gates.sh.txt`; full and trimmed logs are in `assets/T19/gates-final.log`. The run used the code at e0244f7; the later commit adds only docs/evidence.

### RED: pre-T19 publish delivers no notices

Base 904385e publish, size 191,575,874 B:

```
$ python3 agent/legal/tools/recipient_notices.py verify-exe <base 904385e publish>/Uma.Agent.Windows.exe --packages ~/.nuget/packages
RECIPIENT NOTICE CHECK FAILED:
  - EXE lacks recipient notice legal/CsWinRT-2.2.0.241111.1-LICENSE.txt
  - EXE lacks recipient notice legal/INDEX.txt
  … (16 "lacks" lines: every notice + inventory.json)
exit=1
$ python3 agent/legal/tools/recipient_notices.py package <base publish exe> red-base.zip …
exit=1  zip_exists=no
```

The base publish's runtime graph passed attribution: the only failures were the missing legal files. That cross-checks the inventory against the untouched base.

### Fresh gates (all exit 0)

```
$ bash .github/scripts/agent-gates.sh runtime        → 10.0.103; Microsoft.NETCore.App 8.0.31 (test runtime)
$ bash .github/scripts/agent-gates.sh core-tests     → Passed!  - Failed: 0, Passed: 420, Skipped: 0, Total: 420
$ bash .github/scripts/agent-gates.sh windows-build  → 0 Warning(s) 0 Error(s)
$ dotnet test …/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release → Passed! - Failed: 0, Passed: 230, Total: 230
$ dotnet build …/Native/Uma.Agent.Windows.Tests.csproj -c Release -p:EnableWindowsTargeting=true → 0 Warning(s) 0 Error(s)
$ dotnet build Uma.Agent.sln -c Release -p:EnableWindowsTargeting=true → 0 Warning(s) 0 Error(s)
$ dotnet publish src/Uma.Agent.Windows/… -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableWindowsTargeting=true -o scratch/T19/final-publish
  → Uma.Agent.Windows.exe 191966038 B (sha256 this publish only: f33b6a8b…49f8)
$ python3 -X dev -W error agent/legal/tools/test_recipient_notices.py → Ran 31 tests … OK
$ python3 agent/legal/tools/recipient_notices.py check-legal → legal inventory ok: 12 components, 15 notice files
$ python3 agent/legal/tools/recipient_notices.py verify-exe …/final-publish/Uma.Agent.Windows.exe --assets agent/src/Uma.Agent.Windows/obj/project.assets.json
  → recipient notices ok: 490 bundle entries, 455 byte-matched to restored packages, 12 inventory components, 16 legal files embedded
$ python3 agent/legal/tools/recipient_notices.py package … final.zip --assets … → release ZIP ok: … sha256 cdc1e461…f52d; EXE + 16 LICENSES files
$ python3 agent/legal/tools/recipient_notices.py verify-zip final.zip --assets … → release ZIP ok: EXE + 16 LICENSES files; 490 bundle entries, 455 byte-matched
$ unzip -l final.zip → Uma.Agent.Windows.exe + 16 LICENSES/* (17 files)
$ python3 …/Tools/bundle_probe.py final-publish/Uma.Agent.Windows.exe <worktree> → matches 15 of 15
$ python3 …/Tools/sqlite_native_probe.py final-publish/Uma.Agent.Windows.exe scratch/T18/sqlitepclraw.lib.e_sqlite3.2.1.12.nupkg
  → e_sqlite3.dll 1978880 PE32+ AMD64 SHA256 b7385d72…1fb2e; Embedded SQLite 3.53.3; source_id 2026-06-26 20:14:12 d4c0e51e…2c62
$ dotnet list <Core|Windows|Core.Tests|Portable.Tests|Native.Tests> package --vulnerable --include-transitive → each "has no vulnerable packages given the current sources"
$ dotnet msbuild Windows -getProperty:… → NuGetAudit true, NuGetAuditMode all, NuGetAuditLevel low, TreatWarningsAsErrors true
$ TOOLS_DIR=… bash .github/tests/run.sh → regression checks: 67 passed, 0 failed (62 before + 5 T19)
$ node .github/scripts/check-config.mjs . → config check ok (structure): MASTER_VERSION=global-20260930
$ recipient_notices.py report final-publish/…exe → runtimepack NETCore 8.0.24 (165 assets), WindowsDesktop 8.0.24 (59), Windows.SDK.NET.Ref 10.0.19041.57 (2), 8 package assets, Microsoft.Data.Sqlite 0, 2 first-party
```

490 entries = the base 474 + 16 legal files. 455 = 447 runtime-pack + 8 package entries. The other 19 are the 15 app data/appsettings files, deps.json, runtimeconfig.json and the 2 first-party DLLs.

### Negative controls on the real artifact

Full output is in `assets/T19/neg-real-publish.log`. Mutations were applied to scratch copies of the final EXE, ZIP or `agent/legal`; each command exited 1:
- 1 bit flipped in the embedded SharpZipLib licence → `EXE notice legal/SharpZipLib-1.4.2-LICENSE.txt is truncated or changed`.
- 1 bit flipped in the bundled `ICSharpCode.SharpZipLib.dll` → `differs from the restored package file(s) …/sharpziplib/1.4.2/lib/net6.0/…`.
- ZIP without `LICENSES/dotnet-runtime-8.0.24-THIRD-PARTY-NOTICES.TXT` → `ZIP lacks …`.
- EXE-only ZIP → `ZIP lacks LICENSES/…` for every text.
- Stale inventory (Serilog.Sinks.File removed) → `shipped dependency Serilog.Sinks.File/6.0.0 has no inventory entry or notices` and the entry is not attributable.
- Repository Serilog licence truncated to 500 B → `notice text changed or truncated` and an EXE/inventory mismatch.

### Real SDK/runtime-patch drift

Full output is in `assets/T19/neg-sdk-runtime-drift.log`. The scratch copy of `agent/` was published with `global.json` = SDK 9.0.312 (rollForward disable) and a separate NUGET_PACKAGES. SDK 9.0.312 resolves runtime packs 8.0.25, and the verifier exits 1. With this candidate's inventory, it reports:
- `shipped runtimepack.Microsoft.NETCore.App.Runtime.win-x64/8.0.25 but inventory covers …/8.0.24`, and the same for WindowsDesktop;
- `stale inventory` for both 8.0.24 packs;
- `runtimeconfig includes Microsoft.NETCore.App 8.0.25`;
- missing 8.0.24 pack and host texts in that restore;
- `single-file host is not build '8,0,2426,7010 …'`;
- 445 runtime entries not attributable.

The earlier run of the same EXE, made before graphOnly existed, also shows the unlisted ILLink/System.Memory/ProtectedData graph entries. That is why graphOnly needs explicit, reasoned entries.

### Synthetic regressions (31)

`test_recipient_notices.py`:
- valid EXE, valid deterministic ZIP, and CLI exit codes, including `--assets` with the wrong package folder and a failed `package` leaving no ZIP;
- EXE with no notices, one missing, truncated, compressed or unexpected;
- repository notice corrupted or deleted;
- INDEX missing a file or version;
- unresolved new dependency, package version drift, runtime-patch drift, restored pack notice drift, restored nupkg hash drift;
- stale component, component without notices, graph-only listed/unlisted/now-shipping/without reason;
- bundle DLL bytes changed, foreign `sqlcipher.dll` entry, wrong host build, non-bundle input;
- ZIP missing a notice, EXE-only, truncated, extra member, or holding an EXE without notices;
- the real inventory is consistent and cites both SharpZipLib dates and the SQLCipher/OpenSSL statement.

## Open questions / follow-ups

- No new OPEN_QUESTIONS entry.
- **H4 (Windows):** I have not verified that the EXE starts, that single-file extraction actually writes `legal\` under `%TEMP%\.net`, native e_sqlite3/WPF loading, WGC, OCR or DPAPI. Cross-target byte inspection is not Windows execution or UI acceptance.
- **Publication:** `agent-release.yml` has not been run on GitHub. No tag, push or release was made. The pwsh `python` steps are checked only by actionlint (YAML/expressions) and the structure tests. That `python` is on PATH on windows-latest is assumed from the hosted image, not verified here. Actual publication remains a human gate.
- **Licence judgement:** the Windows SDK projection is redistributed under Microsoft's SDK distributable-code terms (REDIST list, as above). Those terms include conditions on the distributor, for example requiring end users to accept terms at least as protective and keeping copyright notices. The inventory records the terms; it is not a legal opinion that they are satisfied. Human review is advisable before any public release.
- **Maintenance:** any SDK/runtime patch (CI's `setup-dotnet 8.0.x/9.0.x` plus latestMajor can move it), package bump or SQLite update now fails release packaging until `agent/legal` is re-sourced. That is intended fail-closed behaviour, not a silent pass. Use `recipient_notices.py report`, then update the texts, INDEX and inventory together.
- T16b S8/N6 codec limits stay separate, untouched.
