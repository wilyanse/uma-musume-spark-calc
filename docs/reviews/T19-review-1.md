# T19 independent implementation review, round 1

Candidate 258f567ce13044bbea3d5b6d335a76d4f15d5ee3 on task/T19-agent-recipient-notices (base 904385e0575d3b67bc00a223e4c6a77024ebbe9a). Fresh read-only reviewer session (Opus), with no implementer context. All builds and probes ran on a `git archive` export of the exact candidate, or on copies of it, under /Users/willjose/.hermes/cache/scratch/T19-r1. The worktree was not modified (checked at the end).

## Verdict: CHANGES_REQUESTED

The local gates I reproduced pass. The verifier is well built and catches real byte-level tampering. However, the only supported release path (agent-release.yml on windows-latest) fails today for two independent reasons that I reproduced, and the delivered texts state the wrong licence for part of the shipped Windows runtime. These are not inherited assumptions: each has a fresh repro or a re-fetched authoritative source below.

## Blocking

- [B1] agent/legal/inventory.json:31-60 (runtime packs and host pinned to 8.0.24), together with .github/workflows/agent-release.yml:21-25 and agent/global.json — the inventory is already stale for the SDK that the release workflow resolves.
  - **What CI resolves.** agent/global.json asks for 9.0.100 with rollForward latestMajor. The windows-latest image (Windows Server 2025, image 20260925/20261004 readmes) preinstalls .NET SDKs up to 10.0.401, and setup-dotnet adds 9.0.x.
  - **Fresh repro.** I published the exact candidate with the official SDK 10.0.401 (SHA-512 verified against the dotnet release metadata), using an isolated NUGET_PACKAGES. It resolves runtime packs 8.0.31. `verify-exe` and `package` exit 1 with no ZIP written. A real PowerShell run of the extracted release step on that EXE throws "recipient notice packaging failed (1)" (scenario D below).
  - **What this means.** Every agent-v* tag fails at packaging today. Failing closed is the correct design. But the Done-when needs the final supported release artifact to deliver the notices, and spec 67 §4 says "do not freeze one host SDK's runtime provenance while CI can resolve another… No stale inventory".
  - **The inventory version is also eight months old.** 8.0.24 was released 2026-02-10 (SDK 10.0.103). Patches 8.0.25 through 8.0.31 are all marked security releases in the official 8.0 releases.json. A release that matched this inventory would ship a runtime missing seven security updates.
  - **The changelog understates this.** It says CI "can move it" and tests only 9.0.312→8.0.25. It does not say that the supported release path is broken right now.
  - **Smaller related gap.** The runbook's local `dotnet publish` (agent-install.md:20) runs from the repository root. agent/global.json is therefore not consulted, so the local SDK choice is also host-dependent.
  - **Required fix.** Make the local and CI resolutions deterministic and matching, and make the inventory follow them. Two options:
    - (a) Re-source agent/legal for the runtime that the supported path actually resolves (currently 8.0.31 packs and host, plus a re-fetched WPF/WinForms TPN for that windowsdesktop commit). Pin the release SDK, for example an exact global.json version or a setup-dotnet exact SDK, so CI cannot drift silently between review and tag. Re-run the fresh gates with that SDK.
    - (b) If an SDK/global.json change is outside T19's Owns, record a coordinator-approved cross-task edit or an explicit OPEN_QUESTION.

    In both cases, state plainly that the release path is currently non-functional until this is done. Pinning back to 8.0.24 is not acceptable for security reasons.

- [B2] agent/legal/notices/* (12 LF files plus inventory.json), with no .gitattributes anywhere in the repository — on a Windows checkout with Git's default core.autocrlf=true, the notices are rewritten to CRLF and the whole notice chain fails.
  - **Why the runner is affected.** On a Windows runner, actions/checkout performs a git checkout with the image's Git for Windows, whose installer defaults to "CRLFAlways" (core.autocrlf=true). The runner-images Install-Git.ps1 does not override that. actions/checkout issue #135 ("Windows - Line endings & conversion") is still open.
  - **Fresh repro.** I ran `git -c core.autocrlf=true checkout` of the candidate's agent/legal.
    - `check-legal` exits 1 with 10 "notice text changed or truncated" lines: INDEX, Microsoft.Data.Sqlite, SQLite, SQLitePCLRaw LICENSE/NOTICE, Serilog, Serilog.Sinks.File, SharpZipLib, WinForms TPN and WPF TPN.
    - `test_recipient_notices.py` reports FAILED (failures=1), from RealInventoryTests.
  - **Effect.** The csproj embeds the converted bytes, so the EXE-vs-inventory check also fails. Both the CI release and any default Windows developer checkout fail closed. Windows is the agent's only target platform.
  - **Not verified on GitHub.** I did not run this on a hosted runner. It is the documented default behaviour, and I reproduced the same Git setting locally.
  - **Required fix.** Add a `.gitattributes` entry that makes agent/legal byte-exact, for example `agent/legal/notices/** -text` and `agent/legal/inventory.json -text` (or `binary`). Add a regression that checks out or renormalises with autocrlf=true and still passes `check-legal`.

- [B3] agent/legal/notices/INDEX.txt:21-27 and agent/legal/inventory.json:37,51 ("licence": "MIT") — the stated licence is wrong for part of the shipped Windows runtime.
  - **What Microsoft says applies.** I re-fetched dotnet/core license-information-windows.md (last changed 6c25b9da, 2024-11-25) and license-information.md. On Windows, product distributions and runtime packs are under the .NET Library License (https://dotnet.microsoft.com/dotnet_library_license.htm; fetched page sha256 0f69be2c…a780). That page explicitly covers:
    - "coreclr.dll and .NET runtimes included in binaries published as single-file", which is exactly this artifact;
    - PresentationNative_cor3.dll, vcruntime140_cor3.dll and wpfgfx_cor3.dll (all three confirmed shipped in the bundle);
    - D3DCompiler_47_cor3.dll (shipped; its version resource reads "Direct3D HLSL Compiler for Redistribution", Windows 10.0.22621.3233), which is under the Windows SDK License instead.
  - **What T19 delivers instead.** It labels both runtimes as MIT, from the nuspec licence expression, and delivers only the MIT texts. The .NET Library License text is absent. INDEX does not attribute D3DCompiler to the Windows SDK terms, although the SDK RTF happens to be included for the projection.
  - **Why it matters.** The .NET Library License carries distributor conditions: no standalone distribution, end users must agree to terms at least as protective, indemnify Microsoft, do not remove notices. The Windows SDK terms carry similar conditions. These are exactly the "Microsoft distribution conditions" that the task asked to be assessed. The current inventory hides them behind an MIT label.
  - **Required fix.**
    - Add the .NET Library License verbatim, with its fetch URL, date and SHA-256, and mark it as a live page because it has no versioned source.
    - Attribute the single-file runtime and those WPF natives to it, and attribute D3DCompiler_47_cor3.dll to the Windows SDK licence. Keep the MIT texts for the MIT-licensed managed parts.
    - Record in the README, changelog and runbook that both Microsoft terms impose distributor and end-user-agreement obligations that file delivery alone does not satisfy. That remains an unresolved human legal gate before any public release.
    - Add a verifier/inventory check that these named native entries map to the correct licence, so it cannot silently regress.

## Should fix

- [S1] agent/legal/tools/recipient_notices.py:365-368 — the single-file host identity check is weak. It only searches the pre-bundle region for the UTF-16 ProductVersion string, and that string occurs twice.
  - On the real EXE, flipping a host code byte at offset 0x2000, or one character of the commit hash in the second occurrence, still gives exit 0 ("recipient notices ok"). Altering one digit of the first occurrence also passed.
  - The documented deviation ("identity instead of bytes") is reasonable, but the changelog's "its build identity … is required" overstates what is checked.
  - Suggestion: compare the host's non-patched PE sections (for example .text/.rdata) with the restored singlefilehost.exe, or at least require an exact VS_VERSIONINFO parse. Add a real-artifact negative regression for it.

- [S2] agent/legal/tools/recipient_notices.py:144-180, 270, 302, 130 — malformed real artifacts and metadata escape as Python tracebacks instead of the documented "all problems printed" Failure. Real-artifact probes:
  - a header offset pointing near EOF gives struct.error;
  - corrupted deps.json or runtimeconfig gives JSONDecodeError;
  - an inventory component missing "deps" gives a KeyError in check-legal.

  The exit code is still 1, so the check still fails closed. But the diagnostics are lost, and the varint/entry parser has no bounds checks. Suggestion: convert parse errors to Failure (bounds-check `p` before each read and validate inventory schema fields) and add regressions built from real-EXE mutations.

- [S3] agent/legal/tools/__pycache__/recipient_notices.cpython-314.pyc — a CPython 3.14 bytecode cache is committed (added in e0244f7). It is a generated artifact and it is not ignored. Suggestion: remove it and add `__pycache__/` to .gitignore.

- [S4] agent/legal/notices/Microsoft.Windows.SDK.NET.Ref-10.0.19041.57-LICENSE.rtf — the recipient copy is accessible only as raw RTF.
  - Windows 11 24H2 removed WordPad. Without Word, an ordinary recipient opening this file in Notepad sees 1,137 lines of RTF control words.
  - Keeping the verbatim RTF is correct. Suggestion: also deliver a plain-text rendering, clearly marked as derived from the verbatim RTF and hash-pinned like the other texts, and mention it in INDEX.

- [S5] .github/tests/run.sh:52-59 — the three "mutated release workflow" checks only delete or replace the exact strings that workflow_structure.rb greps for. They show that the structure test detects its own literals, not that the release step actually runs or packages. That is acceptable as a structural guard, but the changelog should not present them as invocation evidence.
  - Suggestion: keep them, and add an executed check of the YAML-extracted pwsh bodies with mocked dotnet/gh where pwsh is available (as in my harness below), or state the limit.

## Nits

- [N1] docs/changelog/T19-agent-recipient-notices.md:40,50 and docs/changelog/assets/T19/neg-real-publish.log — `git diff --check base..HEAD` exits 2.
  - Apart from the expected CRLF in verbatim upstream texts, there is trailing whitespace in the changelog (two `+  ` lines) and in the log.
  - The parent's "diff check clean" was not reproduced as an exit-0 full-range check.
- [N2] agent/legal/notices/INDEX.txt:14-16 — the extraction path is stated as fact (`%TEMP%\.net\Uma.Agent.Windows\<bundle id>\legal\`), but it is H4-unverified. Mark it "expected".
- [N3] docs/runbooks/agent-install.md:20 — the local publish runs from the repository root, so agent/global.json does not apply (see B1). Use `cd agent` or pass the SDK explicitly, matching CI.

## Checklist

1. **Spec conformance: issues.**
   - B1: the supported release path cannot produce the artifact, and the inventory is stale against the CI-resolved runtime.
   - B3: the licence is inaccurate for the Windows runtime natives.
   - Met: the graph-derived inventory, embedded legal/ plus ZIP, verbatim texts, SQLCipher/OpenSSL non-applicability (the shipped e_sqlite3 has no codec strings, per the native probe and the T18 identity), T16b N7 dates, and RED-before proof (fresh scenario F: the base EXE without notices is refused by the actual pwsh release step).
2. **Correctness: issues.**
   - B2: CRLF checkout breaks the chain.
   - S1: weak host identity.
   - S2: traceback paths.
   - Correct, as I verified on the real artifact: bundle parsing, byte attribution for 455/490 entries, rejection of compressed entries, deps/runtimeconfig drift, and ZIP CRC, extra-member and case checks.
3. **Test quality: mostly ok.**
   - The 31 synthetic regressions are deterministic and assert real behaviour.
   - Real-artifact controls are meaningful: 1-bit flips in e_sqlite3, D3DCompiler, a ja/ satellite and INDEX all fail; ZIP truncation, tamper and traversal all fail.
   - There is no regression for the CRLF checkout (B2) or the host bytes (S1). The workflow mutations are structural only (S5).
4. **Fabrication check: ok.**
   - All 11 upstream-fetched texts were re-downloaded and are `cmp`-identical: WPF/WinForms TPN at 738c1f8/464883c (these SHAs confirmed in windowsdesktop@d0e3683 eng/Version.Details.xml), efcore LICENSE, Serilog ×2, CsWinRT (tag 2.2.0.241111.1 → 8649ee3, equal to the WinRT.Runtime ProductVersion), the SDK RTF (via aka.ms redirect), SharpZipLib, SQLitePCLRaw LICENSE/NOTICE and SQLite LICENSE.md.
   - The pack texts match the restored nupkgs.
   - Changelog gate outputs match what I reproduced: counts and the native hash.
   - B3 is a mislabel, not invented text.
5. **Security: ok, with a note.**
   - Unchanged: the tag regex (fresh scenario C rejects `agent-v1.2.3;whoami` before any command), `$env:` only, persist-credentials:false, contents:write, pinned actions. The GH_TOKEN is not in arguments, audit is not suppressed, and the all-transitive audit is clean.
   - Note: the inventoried runtime is seven security patch releases old (B1).
6. **Free-tier constraints: ok.** There is no new service. Python is the preinstalled 3.12 on windows-latest (per the image readme; not executed on GitHub).
7. **Scope: ok.** The changes are within the T19 Owns. The B1 fix may need a declared cross-task edit to global.json or the setup-dotnet pin.
8. **Maintainability: issues.**
   - S3: committed .pyc.
   - S2: error handling.
   - Otherwise the stdlib-only tool is clear, the inventory is well structured, the graphOnly entries have explicit reasons, and pinned versions are kept.

## Commands run (fresh unless marked inherited)

Toolchain: DOTNET_ROOT=/Users/willjose/.hermes/cache/scratch/T16b/dotnet-combo (SDK 10.0.103, test runtime 8.0.31), python3 3.9.6 (macOS), PowerShell 7.6.6 osx-arm64 (official release, SHA-256 6df833d0… verified), and SDK 10.0.401 osx-arm64 (SHA-512 verified). Scripts: scratch/T19-r1/gates.sh, sdk401-publish.sh, pwsh-harness.sh, probes.py. Logs: scratch/T19-r1/gates/*.log, sdk401.log, harness/*.log, probes.log.

```
$ git archive 258f567… | tar -x -C scratch/T19-r1/src ; bash gates.sh   (fresh export: no bin/obj)
01-runtime  10.0.103; Microsoft.NETCore.App 8.0.31 …                      exit=0
02-core-tests  Passed!  - Failed: 0, Passed: 420, Skipped: 0, Total: 420  exit=0
03-windows-build  0 Warning(s) 0 Error(s)                                  exit=0
04-portable-tests Passed!  - Failed: 0, Passed: 230, Skipped: 0, Total: 230 exit=0
05-native-build / 06-solution-build  0 Warning(s) 0 Error(s)               exit=0
07-publish  Uma.Agent.Windows.exe 191966038                                exit=0
08 python3 -X dev -W error test_recipient_notices.py  Ran 31 tests … OK    exit=0
09 check-legal  legal inventory ok: 12 components, 15 notice files         exit=0
10 verify-exe  recipient notices ok: 490 bundle entries, 455 byte-matched to restored packages, 12 inventory components, 16 legal files embedded
11 package  release ZIP ok: … sha256 7aba8b3a…1f05; EXE + 16 LICENSES files; 490 bundle entries, 455 byte-matched
12 verify-zip  release ZIP ok …                                            exit=0
13 unzip -l  192356837  17 files
14 bundle_probe  … sha256 (this publish only) d083c070…   (data 15/15)     exit=0
15 sqlite_native_probe  e_sqlite3.dll 1978880 PE32+ AMD64 SHA256 b7385d722c83fb52142a00477a726723745916d22a555711ee89834c1111fb2e; Embedded SQLite 3.53.3; Exact native package asset matches
16 dotnet list <5 projects> package --vulnerable --include-transitive  → each "has no vulnerable packages given the current sources"
17 NuGetAudit true / Mode all / Level low / TreatWarningsAsErrors true
18 TOOLS_DIR=… bash .github/tests/run.sh  → regression checks: 67 passed, 0 failed
19 report  NETCore 8.0.24 (165), WindowsDesktop 8.0.24 (59), Windows.SDK.NET.Ref 10.0.19041.57 (2), 8 package assets, 2 first-party
```

B1: windows-latest SDK resolution.

```
$ (SDK 10.0.401, NUGET_PACKAGES=scratch/T19-r1/nuget401) dotnet publish … -o ../publish   → publish_exit=0
$ recipient_notices.py verify-exe publish/Uma.Agent.Windows.exe --assets …/project.assets.json
RECIPIENT NOTICE CHECK FAILED:
  - shipped runtimepack.Microsoft.NETCore.App.Runtime.win-x64/8.0.31 but inventory covers …/8.0.24 (dependency/runtime version drift; update agent/legal)
  - shipped runtimepack.Microsoft.WindowsDesktop.App.Runtime.win-x64/8.0.31 but inventory covers …/8.0.24
  - stale inventory: … 8.0.24 is not in the published graph (×2)
  - runtimeconfig includes Microsoft.NETCore.App 8.0.31; inventory runtime pack version 8.0.24  (and WindowsDesktop)
  - EXE entry … is not attributable … (runtime entries) ; restored 8.0.24 packs/host not found ; single-file host is not build '8,0,2426,7010 …'
verify_exit=1
package_exit=1 zip_exists=no
windows-latest readmes (runner-images main): Windows2025-VS2026 image 20260925.250.1 / Windows2025 20261004.281.1: ".NET Core SDK: … 10.0.401"; Python 3.12.10; PowerShell 7.6.6
dotnet 8.0 releases.json: 8.0.24 2026-02-10 … 8.0.25–8.0.31 each security=True
sdk 10.0.401 BundledVersions.props: LatestRuntimeFrameworkVersion="8.0.31"
```

B2: CRLF checkout.

```
$ git -c core.autocrlf=true clone --no-checkout <worktree> crlf && git -c core.autocrlf=true checkout 258f567 -- agent/legal
$ git ls-files --eol … → i/lf w/crlf agent/legal/inventory.json, …/Serilog-4.3.0-LICENSE.txt
$ python3 agent/legal/tools/recipient_notices.py check-legal
RECIPIENT NOTICE CHECK FAILED:
  - notice text changed or truncated: INDEX.txt sha256 18b410a3… inventory 23ce1c68…
  … (10 notices) …
exit=1
$ python3 agent/legal/tools/test_recipient_notices.py → Ran 31 tests … FAILED (failures=1)
Git for Windows install.iss: default ReplayChoice('CRLF Option','CRLFAlways') → core.autocrlf true; runner-images Install-Git.ps1 sets no CRLF option; actions/checkout#135 open.
```

B3: licence source (re-fetched).

```
$ curl raw.githubusercontent.com/dotnet/core/main/license-information-windows.md
"The following binaries are licensed with the .NET Library License … coreclr.dll and .NET runtimes included in binaries published as single-file … PresentationNative_cor3.dll … vcruntime140_cor3.dll … wpfgfx_cor3.dll"
"… Windows SDK License: D3DCompiler_47_cor3.dll (used by WPF)"
$ curl dotnet.microsoft.com/dotnet_library_license.htm → "ii. Distribution Requirements … use the Distributable Code in your applications and not as a standalone distribution; require distributors and external end users to agree to terms that protect it at least as much as this agreement; and indemnify, defend, and hold harmless Microsoft …"
bundle entries present: D3DCompiler_47_cor3.dll, PenImc_cor3.dll, PresentationNative_cor3.dll, vcruntime140_cor3.dll, wpfgfx_cor3.dll (DiaSymReader/msquic not shipped)
grep -i "library license|D3DCompiler|wpfgfx|vcruntime" agent/legal docs/changelog/T19* → no matches
```

Actual release PowerShell. The pwsh bodies of the `build` and "Create GitHub release" steps were extracted verbatim from the candidate YAML with Ruby's YAML parser. They ran under real pwsh 7.6.6 with mocked `dotnet` (copies a given EXE to -o), mocked `gh` (logs argv only, no network) and `python`→python3. The workspace path contains a space.

```
A-valid: build exit=0; GITHUB_OUTPUT zip=…/ws with spaces/release/uma-agent-agent-v1.2.3-win-x64.zip (17 files); create exit=0
  mock| python argc=1 [agent/legal/tools/test_recipient_notices.py]
  mock| python argc=6 [recipient_notices.py] [package] […/ws with spaces/publish/Uma.Agent.Windows.exe] […zip] [--assets] [agent/src/…/project.assets.json]
  mock| python argc=5 [recipient_notices.py] [verify-zip] […zip] [--assets] […]
  mock| gh argc=6 [release] [create] [agent-v1.2.3] […zip] [--verify-tag] [--generate-notes]
B-zip-tampered-before-release (Serilog licence truncated in ZIP after build): create exit=1 "release ZIP verification failed (1)"; no gh call
C-bad-tag 'agent-v1.2.3;whoami': build exit=1 "Unexpected tag format"; no dotnet/python call
D-ci-sdk-10.0.401-runtime-8.0.31: build exit=1 "recipient notice packaging failed (1)"; no zip output, no release
E-no-python: build exit=1 "The term 'python' is not recognized…" after publish; no output
F-base-exe-without-notices (T19 RED base publish): build exit=1 "recipient notice packaging failed (1)"
```

So `$exe[0].FullName` evaluates to a single argument even with spaces. The order is publish → regressions → package (verify EXE → ZIP → verify ZIP) → output zip= only → upload → verify-zip → gh with the ZIP only. A failed packaging step emits no output, so upload-artifact would hit if-no-files-found: error. Not executed: the real GitHub runner, actions/upload-artifact, and real gh.

Real-artifact mutation probes (probes.py on copies of the fresh EXE/ZIP):

```
EXE truncated to 60%                     exit=1 | bundle header offset out of range
bundle header offset -> EOF-3            exit=1 TRACEBACK struct.error            (S2)
deps.json / runtimeconfig first byte     exit=1 TRACEBACK JSONDecodeError         (S2)
embedded INDEX.txt 1 char flipped        exit=1 | EXE notice legal/INDEX.txt is truncated or changed
embedded e_sqlite3.dll 1 bit             exit=1 | differs from the restored package file(s)
embedded D3DCompiler_47_cor3.dll 1 bit   exit=1 | differs …
embedded ja/PresentationFramework.resources.dll 1 bit  exit=1 | differs …
host ProductVersion digit altered        exit=0                                    (S1)
host code byte 0x2000 flipped            exit=0 recipient notices ok …             (S1)
ZIP zero bytes / truncated 50%           exit=1 | not a readable ZIP
ZIP 1 byte flipped mid-archive           exit=1 | ZIP CRC failure in Uma.Agent.Windows.exe
ZIP extra member ../evil.txt             exit=1 | unexpected member
ZIP LICENSES/ renamed licenses/          exit=1 | ZIP lacks LICENSES/…
inventory.json malformed                 exit=1 | cannot read inventory …
inventory component lacks "deps"         exit=1 TRACEBACK KeyError                 (S2)
one LF notice converted to CRLF          exit=1 | notice text changed or truncated: Serilog-4.3.0-LICENSE.txt
```

Provenance (fresh):
- curl + cmp → IDENTICAL for all 11 upstream texts.
- aka.ms/WinSDKLicenseURL → Location sdk_license.rtf.
- The learn.microsoft.com Windows SDK licence carries EULAID:WIN10SDK.RTM.AUG_2018_en-US and lists Microsoft.Windows.SDK.NET.Ref files, including ./lib/net8.0/WinRT.Runtime.dll, as REDIST ("REDIST.TXT UPDATED 10/21/2024").
- The pack LICENSE/TPN SHA-256 prefixes (d7a68596…, b60b2912…, a8988666…) match the inventory.
- The nuspec repository commits match the inventory sources.
- WinRT.Runtime ProductVersion is 2.2.0.48161+8649ee3…, and the CsWinRT tag ref 2.2.0.241111.1 points to 8649ee3….

End state:

```
$ git -C <worktree> rev-parse HEAD → 258f567ce13044bbea3d5b6d335a76d4f15d5ee3 ; git status --porcelain | wc -l → 0
$ git diff --check base..HEAD → exit 2 (CRLF in verbatim upstream texts, expected; plus trailing spaces in changelog lines 40/50 and neg-real-publish.log, N1)
```

## Inherited vs fresh

- **Fresh:** every result above. The parent's gate numbers (31 tests, 12 components/15 notices, Core 420, Portable 230, 0-warning builds, 490/455, 17-file ZIP, data 15/15, native hash b7385d72…, 67/67 regressions, clean audit) were reproduced independently on a clean export, except "diff check clean" (see N1).
- **Inherited, not re-run:**
  - the worker's SDK 9.0.312→8.0.25 drift log (I ran the stronger 10.0.401→8.0.31 case instead);
  - the worker's claim that e_sqlite3 contains no SQLCipher/OpenSSL strings and that the key/rekey exports are stubs (I relied on the T18-reviewed identity and the native probe here);
  - the parent's scratch publish and ZIP, which I did not use.

## Remaining limits, not resolved by this review

- **H4:** I did not verify Windows startup, single-file extraction of legal/ to %TEMP%\.net, native e_sqlite3/WPF/D3D load, WGC, OCR, DPAPI or UI. Cross-target byte inspection is not execution.
- **Publication:** there was no GitHub run, tag, upload-artifact or real gh. The behaviour of Python, Git CRLF and the SDK on the hosted runner is inferred from the published image readmes and tool defaults, plus local reproduction. It was not observed on a runner.
- **Legal:** the Microsoft .NET Library License and Windows SDK terms impose distributor obligations: end-user agreement at least as protective, indemnity, no standalone distribution, keep notices. Delivering the files does not satisfy these. They remain a human legal gate, and nothing here is release approval. Apache-2.0 and MIT delivery for the packages looks technically complete. SQLite is public domain.
- **Fix rounds:** none of the worker's fix rounds have been used yet (0 of 2).
