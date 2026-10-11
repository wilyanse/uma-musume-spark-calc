# Agent third-party licence/NOTICE delivery (T19)

This folder is what the published win-x64 agent delivers to recipients, plus the
tooling that proves it. It is technical licence evidence, not a legal opinion.

- `notices/` — the recipient texts, verbatim (except the marked derived SDK rendering) from the exact package or upstream
  revision recorded in `inventory.json`, plus `notices/INDEX.txt` (the readable
  component → version → text index for an ordinary recipient).
- `inventory.json` — machine-readable inventory: every shipped deps.json library
  (runtime packs included) with licence, copyright, source revision, exact
  `.nupkg` SHA-256 and notice files; notice SHA-256/provenance; graph-only
  packages that ship no file (with reasons); and the single-file host build.
- `tools/recipient_notices.py` — stdlib-only verifier/packager. It checks the
  final EXE/ZIP bytes, not project items. `tools/test_recipient_notices.py` —
  deterministic synthetic regressions (valid, missing, corrupted, stale/drift).

## How notices reach a recipient

1. Embedded: `Uma.Agent.Windows.csproj` bundles `notices/*` and `inventory.json`
   as uncompressed content under `legal/` inside the single-file EXE; .NET
   is expected to extract it with the other content (`IncludeAllContentForSelfExtract`) to
   `%TEMP%\.net\Uma.Agent.Windows\<bundle id>\legal\` (H4-unverified).
2. Release ZIP: because that extraction folder is a hidden runtime cache, the
   release asset is one ZIP `uma-agent-<tag>-win-x64.zip` holding the EXE and a
   top-level `LICENSES/` folder with the same files. `agent-release.yml` uploads
   only this verified ZIP; no EXE-only asset is produced.

## Verification (local and CI use the same commands)

```sh
cd agent
dotnet --version # must be exactly 10.0.401 (rollForward disable)
dotnet publish src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -c Release -r win-x64 --self-contained true \
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o ../agent-publish
cd ..
python3 agent/legal/tools/test_recipient_notices.py
python3 agent/legal/tools/test_review_r1.py
python3 agent/legal/tools/recipient_notices.py package agent-publish/Uma.Agent.Windows.exe uma-agent-win-x64.zip \
  --assets agent/src/Uma.Agent.Windows/obj/project.assets.json
python3 agent/legal/tools/recipient_notices.py verify-zip uma-agent-win-x64.zip \
  --assets agent/src/Uma.Agent.Windows/obj/project.assets.json
```

`--assets` makes the check use the package folder of that very restore, so the
runtime packs the SDK actually resolved are compared, not a frozen host copy.
It fails closed when: a notice is missing, truncated, changed, compressed or
extra; the EXE's deps.json has a library/version not in the inventory, or the
inventory lists one the publish no longer ships (stale); runtimeconfig
frameworks differ from the inventoried runtime packs; any bundle entry is not
byte-identical to a file in the restored package/pack; a restored `.nupkg` hash
differs; a restored pack's LICENSE/THIRD-PARTY-NOTICES differs from the
delivered copy; or the single-file host is a different build.

On a dependency or runtime change (for example a future SDK resolving runtime
a version other than 8.0.31), the check fails. Run `recipient_notices.py report <exe>` to list the
new graph, fetch the exact new texts from the new packages/upstream revisions,
update `notices/`, `INDEX.txt` and `inventory.json` together, and re-run. Never
edit hashes to match without re-sourcing the texts.

## Inventory notes

- Current supported publish: SDK **10.0.401**, selected by `cd agent` and
  `agent/global.json` (`rollForward: disable`, no prerelease), resolves self-contained
  NETCore/WindowsDesktop/host **8.0.31**. Release setup-dotnet reads the same global.json
  and the pwsh step verifies `dotnet --version` before publish. The Windows project
  rejects a single-file publish from another SDK, including root invocation bypass.
  Target frameworks and unrelated dependencies are unchanged.
- Historical only: candidate 258f567 and the original changelog/gates used SDK
  10.0.103 and packs 8.0.24; review r1 proved CI selected 10.0.401/8.0.31 and could
  not package that stale inventory. 8.0.24 is not a supported current distribution.
  Historical hashes/results are preserved in Git and the original evidence.
- Test runtime is separately installed/copied in isolated scratch: 8.0.31. SDK
  10.0.401's downloaded distribution contains 10.0.12 shared runtimes, not .NET 8.
  Do not claim its installation alone enables native net8 test execution.
- WPF/WinForms texts freshly fetched from dotnet/wpf@27c84022 and
  dotnet/winforms@f4ddf347, as named by windowsdesktop@33796300
  `eng/Version.Details.xml`; the WindowsDesktop pack itself ships only LICENSE.
- Windows native terms: Microsoft's pinned `license-information-windows.md` maps
  coreclr / runtime included in single-file, PresentationNative_cor3.dll,
  vcruntime140_cor3.dll and wpfgfx_cor3.dll to the **.NET Library License**.
  D3DCompiler_47_cor3.dll maps to **Windows SDK terms**. Remaining files (including
  PenImc_cor3.dll and managed runtime code) retain MIT texts. The verifier checks
  those named mappings and that the four WPF exception natives actually ship.
- `notices/dotnet-Library-LICENSE.html` is the verbatim Windows-1252 HTML live page
  fetched from https://dotnet.microsoft.com/dotnet_library_license.htm on 2026-10-11;
  SHA-256 0f69be2c8ac44c3980047664c3347ff22cba5842dc9d8b0a88a4f0914645a780.
  It is not a versioned source. It opens locally in a browser without network.
- **UNRESOLVED HUMAN PUBLICATION GATE:** Microsoft .NET Library and Windows SDK
  terms impose distributor/external end-user agreements at least as protective,
  indemnity, non-standalone distribution and notice-retention requirements. File
  delivery, tests and technical inventory do not satisfy or approve these obligations.
  A responsible human must assess/implement applicable distributor and end-user
  terms before public distribution. This task does not invent or accept terms.
- `Windows-SDK-LICENSE-derived.txt` is accessible UTF-8 wording alongside the
  authoritative verbatim RTF. Regenerate exactly with
  `python3 agent/legal/tools/render_sdk_license.py agent/legal/notices/Microsoft.Windows.SDK.NET.Ref-10.0.19041.57-LICENSE.rtf agent/legal/notices/Windows-SDK-LICENSE-derived.txt`.
  Stdlib parser omits formatting/metadata/generated labels, not wording; check-legal
  reproduces bytes. Independent macOS `textutil -convert txt -stdout` comparison
  matched every wording character after removing whitespace. Source/output hashes
  and the reproducible method are recorded in inventory (no RTF byte conversion).
- Host proof compares restored singlefilehost.exe's stable PE sections (.text,
  .rdata, .pdata, _RDATA, .reloc) and **all original parsed resource leaves** at
  type/name/language paths, including embedded runtime images with both version
  copies. .data (SDK path/offset patch) and the resource directory/app-added
  resources are not compared wholesale. This is stronger than string search, not
  a signature/authenticity guarantee or complete final-EXE integrity proof.
- Parser/JSON/inventory bounds and schema checks give Failure diagnostics for
  malformed headers/strings/graphs/missing deps. Real-artifact controls test host
  code and both version copies, malformed JSON/header, notice/native tampering.
- `.gitattributes` preserves legal bytes under autocrlf=true. The r1 regression
  commits only legal data in a disposable Git repository, clones with autocrlf=true,
  verifies byte equality and check-legal, then repeats without attributes and
  requires the hash failures. No repo/global config change is used.
- Windows SDK projection (Microsoft.Windows.SDK.NET.dll, WinRT.Runtime.dll):
  the package has no licence file; its nuspec `licenseUrl` resolves to the
  Windows 10 SDK licence terms (copied verbatim, RTF). The Windows SDK REDIST
  list (https://learn.microsoft.com/en-us/legal/windows-sdk/redist, updated
  2024-10-21) lists this package's lib/net8.0 files as distributable "as part
  of your program". WinRT.Runtime.dll is C#/WinRT 2.2.0.241111.1 (MIT); its
  ProductVersion commit 8649ee3 is that upstream tag.
- SQLitePCLRaw NOTICE is the upstream repository-wide file. Its SQLCipher and
  OpenSSL sections are not shipped: the published e_sqlite3.dll contains no
  SQLCipher/OpenSSL/libcrypto strings, and its `sqlite3_key`/`rekey` exports
  correspond to ericsink/cb `stubs/stubs.c`, which return SQLITE_ERROR.
- SharpZipLib (T16b N7): the verbatim upstream LICENSE.txt says 2000-2018; the
  1.4.2 nuspec says 2000-2022. The text is unchanged and INDEX.txt cites both.
- Serilog.Sinks.File 6.0.0 states no copyright line anywhere (nuspec, assembly,
  LICENSE); only its authors "Serilog Contributors" are recorded. Neither Serilog
  repository has a NOTICE file at the packaged commits.
- Graph-only packages (no shipped file): Microsoft.NET.ILLink.Tasks,
  System.Memory 4.5.3, System.Security.Cryptography.ProtectedData 8.0.0 (the
  shipped ProtectedData.dll is the WindowsDesktop runtime pack copy).

## T16b SharpZipLib inventory (retained)

SharpZipLib 1.4.2 (assembly ICSharpCode.SharpZipLib), MIT, copyright SharpZipLib Contributors.
Exact package SHA-256: fe0895aa2930a2b1b65caa9f37db8bca35125ebdf9cc1b99d855f6afc5ff5946.
Source: https://github.com/icsharpcode/SharpZipLib/tree/33f64eb0f28cdd2b084cb822fcc224c7c5aba553
Licence copy: notices/SharpZipLib-1.4.2-LICENSE.txt, verbatim from upstream v1.4.2 LICENSE.txt.
Package: https://api.nuget.org/v3-flatcontainer/sharpziplib/1.4.2/sharpziplib.1.4.2.nupkg

## T18 SQLite pins and native engine (retained)

Microsoft.Data.Sqlite / Microsoft.Data.Sqlite.Core remain 10.0.3 (MIT).
The added exact reference SQLitePCLRaw.bundle_e_sqlite3 2.1.12 resolves the
provider.e_sqlite3, core and lib.e_sqlite3 packages to 2.1.12 on both targets.
Nuspecs identify these four packages as Apache-2.0, copyright
`Copyright 2014-2024 SourceGear, LLC`. Native SQLite itself is public domain,
not relicensed Apache-2.0; the native package metadata is Apache-2.0.
No key, paid service or custom initialization is needed.

Actual NuGet package SHA-256 (https://api.nuget.org/v3-flatcontainer/):
- sqlitepclraw.bundle_e_sqlite3.2.1.12.nupkg: a9a06e6b5a313f6ef3675f91997d012adeffe8aa9e1ffd69ed46a4e685b054e1
- sqlitepclraw.provider.e_sqlite3.2.1.12.nupkg: df2b3271992e5d719186c4671e3cf4f8658097c154cbcd41494ab594c5997595
- sqlitepclraw.core.2.1.12.nupkg: af06904138ffa6dc95a599133d64d254716d6facc7543a6b3b910793dae9dca5
- sqlitepclraw.lib.e_sqlite3.2.1.12.nupkg: 4a22c02ffcf489792903cf263def9fce27739716883f965f0b5eeff1637430ac

Source reference: https://github.com/ericsink/SQLitePCL.raw/tree/ca835d21508bff43121c65081035840ac5006c4c
(v2.1.12 tag resolved through GitHub API; nuspecs specify repository but no commit).
Retained verbatim upstream LICENSE.TXT and NOTICE.TXT (now under notices/):
- SQLitePCLRaw-2.1.12-LICENSE.txt: cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30
- SQLitePCLRaw-2.1.12-NOTICE.txt: 485b276b3d2bfaa26df348e1e5c84df3648981e09b88531a6a53006f0705c24b

Loaded engine and both inspected native assets: SQLite 3.53.3, source ID
`2026-06-26 20:14:12 d4c0e51e4aeb96955b99185ab9cde75c339e2c29c3f3f12428d364a10d782c62`.
Upstream release/source identity: https://sqlite.org/releaselog/3_53_3.html
SQLite-3.53.3-LICENSE.md is verbatim from
https://github.com/sqlite/sqlite/blob/version-3.53.3/LICENSE.md
(SHA-256 ee6af51062b30d532991face5164136ae6f84e265ecf8abe89dc69dac45ca1e7).
- runtimes/osx-arm64/native/libe_sqlite3.dylib: 09fe20a6c050912a7944b2f2f2981debe31679f7919f523c87251ae8cf0f2daa
- runtimes/win-x64/native/e_sqlite3.dll: b7385d722c83fb52142a00477a726723745916d22a555711ee89834c1111fb2e

`sqlite_native_probe.py` and `SqliteSecurityTests.cs` pin the same identity; a
future SQLite update must change them and `inventory.json` together.

Byte inspection is not Windows execution: single-file extraction, startup and
native use remain H4. Implementing T19 does not approve any release.
