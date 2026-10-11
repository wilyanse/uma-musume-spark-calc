# T19 — Agent recipient licence/NOTICE delivery

- **Status:** Fix-round-1 candidate — independent review 1 was CHANGES_REQUESTED; fixes require parent gates and resumed independent review. Not release approval; H4 and human publication/legal gates remain unresolved.
- **Branch:** task/T19-agent-recipient-notices (base 904385e)
- **Agent / model:** anthropic claude-opus-5-5, reasoning medium; direct implementation, no delegation/model CLI/orch. Continued in the same session after the first process (proc_4369d1c7f9fa) was closed by the agent host (exit -15, agent_close, not a provider failure); that run had produced research and scratch files only, no tracked change.
- **Date:** 2026-10-11

> Historical Opus implementation report through candidate 258f567 follows. Review r1 reproduced a broken supported release path and incorrect Windows native licence attribution. The original 8.0.24 outputs and claims below are retained as historical evidence, not current supported-runtime or approval claims. The appended Review round 1 section supersedes them.

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


## Review round 1

### Provenance and status

Independent coordinator review: `docs/reviews/T19-review-1.md` in the coordinator tree,
reviewed exact candidate `258f567ce13044bbea3d5b6d335a76d4f15d5ee3`, verdict
**CHANGES_REQUESTED**. The coordinator's updated spec67 r1 erratum is authoritative;
no coordinator spec/status/root CHANGELOG was edited. This is worker fix round **1 of 2**,
not an independent approval or merge.

New implementation and runs: **openai-codex/gpt-6.1-sol, reasoning medium**, explicitly
coordinator-approved continuation of **session20261011_103329_5bce0b**. No delegation,
model CLI, provider switch, explicit credential/global-configuration command or recursive orchestration. Original
Opus implementation and independent Opus reviewer provenance above remain unchanged.
Existing reviewer scratch under `scratch/T19-r1` was read, not deleted or overwritten.
Inherited copies of reviewer probes and the broken SDK401 pwsh result are named
`assets/T19/r1/inherited-review-*.log`; they are NOT Sol execution claims.

### Findings and dispositions

- **B1 — fixed in candidate, needs independent verification.** The supported tag path
  was broken already, not hypothetically: SDK10.0.401 resolves patched NETCore,
  WindowsDesktop and host8.0.31, while candidate258f567 covered8.0.24. Sol re-ran the
  original verifier against the reviewer's actual SDK401 artifact: `verify-exe` and
  `package` exited1, no ZIP. The current `agent/global.json` selects exactly10.0.401,
  rollForward=disable, allowPrerelease=false; release setup-dotnet reads that same
  file and pwsh checks resolved `dotnet --version` before publish. All supported
  local publish/build commands enter `agent/` first. The Windows project's scoped
  single-file publish target rejects other SDKs, including an actual root SDK10.0.103
  MSBuild invocation (exit1, "requires SDK10.0.401"). No insecure8.0.24 pin remains
  in the current inventory; old results remain historical in this report/Git.
  Target frameworks, app behavior, package pins and audit defaults are unchanged.
- **B2 — fixed.** Root `.gitattributes` sets `agent/legal/notices/** -text` and
  `agent/legal/inventory.json -text`. Regression creates a disposable real Git repo
  containing only legal bytes and attributes; commits with command-local identity,
  clones with `git -c core.autocrlf=true clone --no-local`, compares every recipient
  byte and runs check-legal. It repeats after removing attributes in that disposable
  repo: conversion must fail hashes. No upstream byte/hash rewriting to dodge CRLF,
  no repo/global Git config change, no main/sibling checkout.
- **B3 — fixed attribution/delivery; legal obligations deliberately unresolved.**
  Added live .NET Library License as verbatim Windows-1252 HTML, locally readable
  in a browser, fetched2026-10-11 from
  https://dotnet.microsoft.com/dotnet_library_license.htm, SHA256
  `0f69be2c8ac44c3980047664c3347ff22cba5842dc9d8b0a88a4f0914645a780`.
  It is explicitly live/unversioned, not a fabricated exact-version source.
  Delivered pinned Microsoft Windows licence-information source maps single-file
  runtime/coreclr and PresentationNative_cor3.dll, vcruntime140_cor3.dll,
  wpfgfx_cor3.dll to that licence; D3DCompiler_47_cor3.dll maps to Windows SDK terms.
  MIT managed texts are retained; PenImc remains in the all-other-files MIT category.
  Verifier/regressions require each named mapping, the single-file mapping, matching
  component notices/labels and actual named WPF native entries. The SDK live page
  was also fetched: same EULAID WIN10SDK.RTM.AUG_2018_en-US as the retained verbatim
  RTF, with URL/date/hash recorded. The SDK projection REDIST list is not treated
  as proof that every D3D distribution condition is met.
  **UNRESOLVED HUMAN PUBLICATION GATE:** responsible human distributor/legal action
  must address Microsoft .NET Library and SDK requirements, including distributor
  and external-end-user agreements at least as protective, indemnity, no standalone
  distribution and retained notices. Delivering files does not satisfy those terms.
  README, recipient INDEX, inventory and install runbook all say this; no terms
  were invented/accepted, and no publication is authorized.
- **S1 — fixed with byte proof, not relabelled string search.** Parse bounded AMD64
  PE sections and compare every stable original host section to restored
  singlefilehost.exe. Parse resource directories/type/name/language and compare
  **all original resource-leaf bytes**, including the embedded runtime/minidump
  image containing both ProductVersion copies. SDK-patched `.data` and the resource
  directory/app-added resources are not compared wholesale. Actual0x2000 code-byte
  and both real ProductVersion tamper controls now fail; original candidate passed
  all three (retained Sol RED). The inventory ProductVersion is also checked against
  the restored original host (regression for incorrect metadata). This is technical
  attribution, not signing/authenticity or full application-integrity proof.
- **S2 — fixed.** File/JSON/bundle/PE/resource/inventory bounds and shape checks;
  bounded strings/counts/offsets, safe paths, duplicate JSON-key rejection and useful
  Failure diagnostics. Real EXE header->EOF-3, truncated EXE, deps/runtimeconfig JSON,
  missing deps, and malformed/missing-field/wrong-type inventory controls require
  exit1, named Failure diagnostics and no traceback. Original candidate traceback
  paths are retained as RED; deterministic synthetic controls cover the same bounds.
- **S3 — fixed.** Removed only the tracked CPython3.14 `.pyc`; root `.gitignore`
  excludes `__pycache__/` and `*.py[cod]`. No unrelated cache/file deletion.
- **S4 — fixed.** Authoritative RTF is unchanged. Added marked derived UTF-8 SDK
  wording, source/output hashes and stdlib `render_sdk_license.py`; INDEX names both.
  check-legal regenerates and requires exact derived bytes. Independently compared
  with `textutil -convert txt -stdout`: all wording characters equal after removing
  whitespace. Metadata/formatting/generated list labels are omitted, not licence
  wording; original RTF remains authoritative. Exact method/hash/source evidence is
  `assets/T19/r1/sol-provenance-fidelity.log`.
- **S5 — fixed within stated execution limits.** Retained structural assertions and
  label them structural (they do not prove invocation). Added retained
  `.github/tests/workflow_pwsh_controls.py`: Ruby parses YAML; real pwsh executes
  extracted build/release bodies, dotnet/gh are in-process mocks, real Python
  verifies actual EXE/ZIP and restored assets. Workspace names contain spaces.
  Controls cover valid build/create, post-build ZIP tamper, malicious tag, wrong SDK,
  publish error, unavailable Python, and original no-notices EXE. No real gh/network
  call or credential is used. `.github/tests/run.sh` runs executed controls when
  PWSH/T19_RECIPIENT_EXE/T19_RECIPIENT_ASSETS are supplied; otherwise explicitly skips
  this optional real-artifact harness. Release itself runs both legal test suites.
  GitHub-hosted actions/upload-artifact/publication are NOT exercised by mocks.
- **N1 — fixed authored whitespace.** Removed authored trailing spaces from this
  report and prior real-negative log. Verbatim upstream CRLF/HTML/RTF bytes are
  untouched. Full base..HEAD checks use command-local upstream whitespace policy,
  plus strict authored-path and authored INDEX/derived-render checks (commands below).
- **N2 — fixed.** INDEX, README and runbook call the extraction path expected and
  H4-unverified, not observed Windows behavior.
- **N3 — fixed with B1.** Local build/publish examples select global.json by entering
  agent, matching the release path, rather than root latest-installed SDK selection.

### Files / cross-task edits / decisions

- Coordinator-authorized cross-task edits only: `agent/global.json` exact SDK patch
  selection; root `.gitattributes` legal byte preservation; root `.gitignore` Python
  cache exclusion. Existing task-owned csproj adds only a single-file SDK guard.
  Release setup/action inputs change only SDK resolution; action SHAs/tag regex,
  `$env:` trust boundaries, persist-credentials:false, permissions and audit stay.
- Current runtime/host licences re-sourced from exact8.0.31 nupkgs, hash-pinned and
  byte-compared to restored packages. Runtime/host nuspec commit
  `de078f3eabf87d4dce3e2a311c1d23b9bbd6b1e4`; WindowsDesktop nuspec commit
  `337963009d48a3016b50172b451b4e80f78791a7`. Its Version.Details selects WPF
  `27c84022a86fcaa600315f4686cde97874615a24`, WinForms
  `f4ddf3475a1269429508fe203cdfc4e21c3599d1`; freshly fetched TPNs record those URLs.
  The actual embedded host/runtime PE ProductVersion is
  `8,0,3126,42015 @Commit: 1219a42122cf5190c7f512850557e38c422430dc`, distinct from
  the nuspec repository commit. Both are recorded honestly, not equated.
- New legal tools: `verification_safety.py`, `windows_licensing.py`,
  `render_sdk_license.py`, `test_review_r1.py`, `real_artifact_controls.py`;
  updated existing verifier/tests. All build/test tools are stdlib-only and not
  shipped; no new runtime dependency. New/moved current notice files and provenance
  are enumerated completely in inventory and `sol-provenance-fidelity.log`.
- Updated README, INDEX, install runbook, workflow/tests and this task report;
  evidence under `docs/changelog/assets/T19/r1/`. No application capture/image/DB/
  SQLite/data/schema/master/golden/About edit or fixture regeneration.
- Existing ZIP-only accessibility deviation is retained: EXE embeds20 legal files;
  the one supported recipient ZIP pairs it inseparably with readable LICENSES.
  No bare-EXE-only asset, no optional licence download. Native extraction remains H4.
- Intermediate Sol preflight gates are preserved at scratch/T19/r1/gates: real
  controls caught an incorrect provisional host ProductVersion metadata string,
  and the config gate script had an incorrect path. Actual original-host bytes
  supplied the corrected ProductVersion (now explicitly verified); gate script
  uses `.github/scripts/check-config.mjs`. Fresh final export/gates below do not
  reuse preflight bin/obj. Intermediate successes are not final candidate evidence.

### Fresh Sol verification

Toolchain: `DOTNET_ROOT=/Users/willjose/.hermes/cache/scratch/T19-r1/sdk401`,
SDK10.0.401; `NUGET_PACKAGES=.../T19-r1/nuget401`; CLI_HOME and TMPDIR beneath
scratch/T19/r1. SDK download initially listed only shared10.0.12 runtimes.
Copied **only isolated** shared/Microsoft.NETCore.App/8.0.31 from the already
available T16b/dotnet-combo into that scratch SDK root for test execution, then
confirmed `--list-runtimes`. No global .NET installation/config repair.

SDK first-run in the preliminary isolated CLI_HOME printed "Installed an ASP.NET
Core HTTPS development certificate" despite no explicit certificate command. No
certificate/key was inspected/exported, no trust or cleanup command was run (which
could affect unrelated user certificates). Final gate environment explicitly sets
`DOTNET_GENERATE_ASPNET_CERTIFICATE=false`. Parent should note this incidental SDK
first-run output; its system-store effect was not verified. No real credentials
were provided or used by release mocks.

Fresh source export: tracked/current scoped files only, no bin/obj; output at
`scratch/T19/r1/fresh-final`. SHA256 source manifest retained in scratch and compared
against final implementation paths before commit. Full commands are in
`assets/T19/r1/sol-gates-final.sh.txt`; real command/result/status logs follow below.

The final fresh run completed with **27 of27 step exits0**, `ALLDONE failures=0`.
All commands and outputs (not just summaries) are preserved in
`assets/T19/r1/sol-gates-final.log`. Representative real outputs:

```text
$ bash .github/scripts/agent-gates.sh runtime
10.0.401
Microsoft.NETCore.App 8.0.31 [isolated scratch SDK/shared/Microsoft.NETCore.App]
# SDK's original shared10.0.12 runtime is also present; it was not used as native8 evidence.
$ bash .github/scripts/agent-gates.sh core-tests
Passed! - Failed: 0, Passed: 420, Skipped: 0, Total: 420
$ bash .github/scripts/agent-gates.sh windows-build
Build succeeded. 0 Warning(s) 0 Error(s)
$ (cd agent; dotnet test tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release)
Passed! - Failed: 0, Passed: 230, Skipped: 0, Total: 230
$ (cd agent; dotnet build tests/Uma.Agent.Windows.Tests/Native/Uma.Agent.Windows.Tests.csproj -c Release -p:EnableWindowsTargeting=true)
Build succeeded. 0 Warning(s) 0 Error(s)
$ (cd agent; dotnet build Uma.Agent.sln -c Release -p:EnableWindowsTargeting=true)
Build succeeded. 0 Warning(s) 0 Error(s)
$ (cd agent; dotnet publish src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableWindowsTargeting=true -o ../publish)
Uma.Agent.Windows -> scratch/T19/r1/fresh-final/publish/ ; exit=0
$ python3 -X dev -W error agent/legal/tools/test_recipient_notices.py
Ran 31 tests ... OK
$ python3 -X dev -W error agent/legal/tools/test_review_r1.py
Ran 21 tests ... OK (includes real Git autocrlf checkout and no-attributes negative)
$ python3 agent/legal/tools/recipient_notices.py check-legal
legal inventory ok: 12 components, 19 notice files
$ python3 agent/legal/tools/recipient_notices.py verify-exe publish/Uma.Agent.Windows.exe --assets agent/src/Uma.Agent.Windows/obj/project.assets.json
recipient notices ok: 494 bundle entries, 455 byte-matched to restored packages, 12 inventory components, 20 legal files embedded
$ python3 agent/legal/tools/recipient_notices.py package publish/Uma.Agent.Windows.exe release/uma-agent-agent-v0.0.0-win-x64.zip --assets agent/src/Uma.Agent.Windows/obj/project.assets.json
release ZIP ok: ... sha256 d7f37b284f1d5e8c7def2ac4247dbebdd071283c9202e49f9aefc7059f3f0857; EXE + 20 LICENSES files; 494 bundle entries, 455 byte-matched
$ python3 agent/legal/tools/recipient_notices.py verify-zip release/uma-agent-agent-v0.0.0-win-x64.zip --assets agent/src/Uma.Agent.Windows/obj/project.assets.json
release ZIP ok: EXE + 20 LICENSES files; 494 bundle entries, 455 byte-matched
$ python3 agent/tests/Uma.Agent.Windows.Tests/Tools/bundle_probe.py publish/Uma.Agent.Windows.exe <fresh-final root>
matches 15 of 15
$ python3 agent/tests/Uma.Agent.Windows.Tests/Tools/sqlite_native_probe.py publish/Uma.Agent.Windows.exe <scratch/T18/sqlitepclraw.lib.e_sqlite3.2.1.12.nupkg>
bundle6 0 entries494
SQLite3.53.3, e_sqlite3.dll1978880 bytes, PE32+ AMD64; exact package asset matches
SHA256 b7385d722c83fb52142a00477a726723745916d22a555711ee89834c1111fb2e
$ (cd agent; dotnet list <each of Core, Windows, Core.Tests, Portable.Tests, Native.Tests> package --vulnerable --include-transitive)
Each of5 projects: has no vulnerable packages given the current sources
$ (cd agent; dotnet msbuild src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -getProperty:NuGetAudit -getProperty:NuGetAuditMode -getProperty:NuGetAuditLevel -getProperty:TreatWarningsAsErrors -p:EnableWindowsTargeting=true)
NuGetAudit=true, NuGetAuditMode=all, NuGetAuditLevel=low, TreatWarningsAsErrors=true
$ python3 agent/legal/tools/recipient_notices.py report publish/Uma.Agent.Windows.exe
NETCore runtime8.0.31 (165 graph assets), WindowsDesktop runtime8.0.31 (59), SDK projection10.0.19041.57 (2); unchanged application/package graph
$ python3 agent/legal/tools/real_artifact_controls.py publish/Uma.Agent.Windows.exe --packages <T19-r1/nuget401>
valid: exit=0 expected=0 PASS
host-code-byte: exit=1 expected=1 PASS (stable PE .text differs)
host-version-copy-0: exit=1 expected=1 PASS (parsed original resource leaf differs)
host-version-copy-1: exit=1 expected=1 PASS (same)
header-near-eof / truncated-real-exe / malformed.deps.json / malformed.runtimeconfig.json / missing-deps: exit=1 expected=1 PASS
INDEX/e_sqlite3/D3DCompiler tamper: exit=1 expected=1 PASS
missing-deps-field / wrong-type / malformed JSON inventory: exit=1 expected=1 PASS
real artifact controls: 0 unexpected result(s) (1 positive + 14 negatives, no traceback)
$ python3 .github/tests/workflow_pwsh_controls.py --pwsh <T19-r1/pwsh/pwsh> --exe <fresh-final exe> --assets <fresh-final assets.json> --baseline-exe <T19/base-publish exe> --logs <scratch/T19/r1/pwsh-logs-final>
valid: build=0 create=0 PASS
tamper-before-release: build=0 create=1 PASS (no gh call)
bad-tag / wrong-sdk / publish-failure / no-python / baseline-no-notices: build=1 create=None PASS
YAML-extracted pwsh controls: 7 passed; dotnet/gh mocked, Python verifier real; no publication
$ TOOLS_DIR=<scratch/IR1/tools> PWSH=<scratch/T19-r1/pwsh/pwsh> T19_RECIPIENT_EXE=<fresh-final exe> T19_RECIPIENT_ASSETS=<fresh-final assets.json> bash .github/tests/run.sh
regression checks: 69 passed, 0 failed (executed pwsh controls enabled, not skipped)
$ node .github/scripts/check-config.mjs .
config check ok (structure): MASTER_VERSION=global-20260930
```

These are cross-target builds and byte/manifest checks, not Windows execution.
494 entries retain455 restored third-party assets and19 first-party/config/data
entries, plus20 legal entries. The current ZIP has21 files (EXE+20 LICENSES entries).

Real artifacts for this fresh publish only (not reproducible-build claims):
- EXE: `/Users/willjose/.hermes/cache/scratch/T19/r1/fresh-final/publish/Uma.Agent.Windows.exe`, 191769388 bytes, SHA256 `1692371a26950164dc5b703df4aa59392fa9a07bafbb36da9341b0fd32f041cd`.
- ZIP: `/Users/willjose/.hermes/cache/scratch/T19/r1/fresh-final/release/uma-agent-agent-v0.0.0-win-x64.zip`, 73774333 bytes, SHA256 `d7f37b284f1d5e8c7def2ac4247dbebdd071283c9202e49f9aefc7059f3f0857`.

Before recording evidence, the final exported-source SHA256 manifest matched all
**200 implementation paths** under agent/, .github/, .gitattributes and .gitignore
against the assigned worktree. Only task changelog/evidence was added afterward.
Implementation commits: `fc73252` (controls/hardening/cache removal), `1be9f17`
(patched runtime/native terms/byte attributes), `57d4beb` (SDK release/harness/runbook).

Final full-range diff-check policy (command-local, no config change):

```sh
git -c core.whitespace=-blank-at-eol,-blank-at-eof,cr-at-eol diff --check 904385e0575d3b67bc00a223e4c6a77024ebbe9a..HEAD
git -c core.whitespace=cr-at-eol diff --check 904385e0575d3b67bc00a223e4c6a77024ebbe9a..HEAD -- . ':!agent/legal/notices/**'
git -c core.whitespace=cr-at-eol diff --check 904385e0575d3b67bc00a223e4c6a77024ebbe9a..HEAD -- agent/legal/notices/INDEX.txt agent/legal/notices/Windows-SDK-LICENSE-derived.txt
```

First command checks the full range with upstream byte-preserving policy; the
other two require strict authored whitespace, including INDEX/derived text, while
excluding only upstream verbatim texts. No blanket authored-whitespace waiver.

### Remaining gates / follow-ups

- Parent must run same-candidate gates and resume independent reviewer. Worker
  dispositions are not independent approval; no merge/release-readiness claim.
- Windows/H4: expected legal extraction path, published EXE startup, actual
  e_sqlite3/WPF/D3D native load/use, WGC/OCR/DPAPI/UI remain unverified here.
- Human Microsoft distributor/end-user legal gate remains **unresolved**, as above.
- Actual GitHub runner, setup/download actions, upload-artifact and real gh publication
  were not run. Python/Git availability on hosted Windows remains an environment
  assumption beyond the successful local actual-pwsh/mock and autocrlf reproductions.
- No tag/push/deploy/release, global SDK config repair, capture/image/SQLite/data
  runtime-code change or master/golden/fixture regeneration was performed.
- T16b S8/N6 codec limits remain separate. No coordinator OPEN_QUESTIONS/status edit.
