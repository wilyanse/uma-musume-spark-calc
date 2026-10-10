## Verdict: CHANGES_REQUESTED

That notification is the fresh gate run already in the report: runtime exit 0, core-tests 336/336, windows-build 0 warnings and 0 errors. The full report follows, since this message is the one that gets saved.

Reviewed candidate 3a157d5 (base 55d1aac) read-only. The worktree is clean and HEAD is still 3a157d5. I only deleted ignored bin/obj before the fresh builds.

The fresh gates are green. Byte parity for decode and resampling against ImageSharp 3.1.12 holds in my own independent harness, not just the worker's.

The new decoder path still fails two 64 invariants:
- it returns confidently wrong pixels for corrupt PNGs where it should refuse them;
- on failure paths it leaks unmanaged memory and lets decompressed data grow without limit, while the code and changelog claim the opposite.

Both are fixable inside T16b's scope.

## Blocking

- [B1] agent/src/Uma.Agent.Core/PngCodec.cs:21-46 (with agent/tests/Uma.Agent.Core.Tests/ImageBehaviourTests.cs:218-237) — corrupt PNGs come back as wrong pixels instead of a typed refusal.
  - Cause: StbImageSharp checks neither chunk CRCs nor the zlib Adler-32 checksum.
  - Repro (fresh, scratch `T16b-review1/par corrupt`): flip one bit inside the IDAT payload of a PNG-encoded fixture-13 crop, 3000 trials.
    - New code: 1858 decoded successfully with WRONG pixels, 0 decoded identical, 1142 refused.
    - ImageSharp 3.1.12: refused all 3000.
  - A deliberately broken IHDR CRC (`badcrc`) is also accepted: "OK 4x4". ImageSharp says "CRC Error. PNG IHDR chunk is corrupt!".
  - This is a regression from the old library and breaks 64's "no confident-wrong" rule for the PNG forms that are actually used: fixtures, `--record-ocr` inputs (OcrRecorder.cs:75) and the probes.
  - The fuzz test, and the changelog's "200,000 mutated PNGs produced only ok frames or InvalidDataException" (changelog:166), count wrong-pixel decodes as success. The test asserts only that the byte length is consistent, so it cannot catch this.
  - Required fix:
    - Before decoding, walk the chunk structure in PngCodec: every chunk length must lie within the buffer, every CRC32 must verify, IHDR must be first with length 13, there must be exactly one IHDR, IDAT must be present and IEND last. Corrupt input then becomes InvalidDataException.
    - Also verify the zlib/Adler-32 checksum, or decode through a CRC-checking managed reader.
    - Hjg.Pngcs's own `PngReader` checks CRCs by default and is already a dependency. Using it as the decoder would also drop the `unsafe` StbImageSharp dependency, but any palette, grey, 16-bit or tRNS conversion must keep the 0-byte parity shown below.
    - Add a deterministic regression: single-bit flips in the IHDR, IDAT payload, CRC and Adler bytes must all throw InvalidDataException. Assert that no "successful" decode differs from the source pixels.

- [B2] agent/src/Uma.Agent.Core/PngCodec.cs:26,35-39 (changelog:104 "No unmanaged handles exist") — the decoder's failure paths leak unmanaged memory, and decompressed data is not bounded by the image size.
  - StbImageSharp's Hebron runtime allocates with `Marshal.AllocHGlobal` (source at nuspec commit 125af70, `CRuntime.malloc`/`realloc`).
  - Leak repro (fresh):
    - `leak 1234 30000`: 14 decodes failed with an IOException thrown from `MemoryStream.Seek` inside `stbi__parse_png_file`. Each left a native allocation unfreed ("outstanding stb native allocations 14").
    - `leak2`: a 64×64 IHDR plus a 32 MiB IDAT with a truncated trailing chunk, refused 20 times. Managed heap was 128 MiB but the process working set was 779 MiB (max RSS 917 MB): about 32 MiB is leaked per refusal and never reclaimed.
    - 64 requires native and managed handles to be disposed deterministically, including on failure paths.
  - Unbounded-inflate repro (bounded subprocesses, RSS-killer at 6 GB):
    - a 1×1 IHDR whose IDAT inflates to 256 MiB, 1 GiB or 2 GiB is accepted as "OK 1x1";
    - maximum RSS is 315 MB, 1.11 GB and 1.56 GB respectively;
    - `stbi__zexpand` keeps doubling up to 4 GiB.
    - So the IHDR guard comment ("bounded memory on hostile or huge input") and the changelog's bounded claim are false.
  - Required fix:
    - Validate the chunk layout before calling the decoder, so the library never seeks or reads past the buffer (this removes the IOException leak path).
    - Bound the total inflated size by the IHDR-derived length, `(rowBytes+1)×h`, with interlace overhead allowed. Do this either by pre-inflating with the BCL `ZLibStream` under a counting limit or by switching decoders as in B1.
    - Correct changelog:104 and the PngCodec comment.
    - Add bounded regressions: an inflate bomb is refused without large native growth, and no native allocation remains after a refused decode. StbImageSharp's internal `MemoryStats.Allocations` is reflectable, as my probe shows, or switch decoder.
    - Keep hostile inputs that cause large allocations in bounded subprocesses, not in the xUnit process.

## Should fix

- [S1] docs/changelog/T16b-image-library-migration.md:73,242 and docs/runbooks/agent-install.md:25 — licence delivery is a real obligation, not an optional About screen.
  - Hjg.Pngcs is Apache-2.0. Section 4(a) requires that recipients of the Object form receive a copy of the licence.
  - The published single-file EXE embeds Hjg.Pngcs.dll, and `agent-release.yml` uploads only that EXE to a GitHub release.
  - In the fresh publish, the bundle contains "Apache License" 0 times, "LICENSE-2.0" 0 times and "Permission is hereby granted" 0 times. That the nupkg contains license.txt does not reach the recipient.
  - StbImageSharp is "Unlicense OR MIT"; choosing the Unlicense branch removes its notice duty, so record that choice explicitly.
  - Judgement: this gap is not new with T16b. Serilog, Serilog.Sinks.File and SQLitePCLRaw (all Apache-2.0), plus MIT components such as Microsoft.Data.Sqlite.Core, ProtectedData and the self-contained .NET runtime, are already shipped the same way. ImageSharp 3.1.12 was too, under Apache via the split licence. No tag exists (`git tag -l` is empty) and nothing is distributed by merging.
  - So this blocks any `agent-v*` release, not this local merge.
  - Required:
    - correct the changelog wording;
    - record the Unlicense election;
    - add a release-blocking follow-up covering ALL bundled third-party licences, either a THIRD-PARTY-NOTICES file shipped as a release asset or embedded and shown by the agent. The T10/T12 packaging owner can do this, or T16b with a declared cross-task edit if the orchestrator prefers.
- [S2] agent/src/Uma.Agent.Core/PngCodec.cs:56 / changelog:102,113-120 — review crops are encoded with less compression than ImageSharp's BestCompression.
  - Hjg.Pngcs maps CompLevel 9 to `CompressionLevel.Optimal`, not `SmallestSize` (ZlibOutputStreamMs.initStream).
  - In my fresh comparison of 600 random rectangles across the 15 fixtures:
    - 566 crops had the same dimensions as the old CropPng replica, with 0 pixel differences;
    - 34 (5.7%) took one extra ×0.7 step, e.g. 1187×159 became 831×111;
    - 0 exceeded 60 KiB; the largest was 61,387 B.
  - The contract still holds, but large low-confidence review crops lose about 30% linear resolution more often than the worker's "12/600" sample suggests.
  - Consider writing the IDAT stream with `SmallestSize`, or document this measured rate.
- [S3] changelog:241 — the SQLitePCLRaw.lib.e_sqlite3 2.1.11 advisory GHSA-2m69-gcr7-jv3q is still High and unchanged.
  - I confirmed it fresh for both Core and Windows.
  - It is visible only as prose in the changelog follow-ups, and gates pass only because `NuGetAuditMode` defaults to direct.
  - The orchestrator should give it a tracked OPEN_QUESTIONS or task entry on main so the deferral isn't lost. I am not asking for a fix inside T16b.
- [S4] Added-dependency security: StbImageSharp is an automatic C-to-C# translation that uses unsafe pointers.
  - Upstream C stb_image has a CVE history: CVE-2023-45662/45663/45664/45666/45667, mostly GIF paths and `stbi__getn`.
  - GHSA and OSV return 0 advisories for both NuGet packages (fresh). The C CVEs are not mapped onto the port, so "no advisories" is weak evidence.
  - Signature gating keeps the non-PNG decoders unreachable, which is good. B1 or B2 pre-validation, or a switch to the safe managed Pngcs reader, would reduce this risk further. Record the residual risk.

## Nits

- [N1] ImageBehaviourTests.cs:213 — `GC.GetAllocatedBytesForCurrentThread` cannot see StbImageSharp's unmanaged allocations. The guard runs before the decoder, so the test passes for the right reason, but the stated rationale overclaims.
- [N2] PngCodec.cs:56-67 — `PngWriter` is not IDisposable. If an exception occurred before `End()`, the internal `DeflateStream` (a native zlib handle) would only be released by its finalizer. Inputs are validated beforehand, so the risk is low. A try/finally that closes it would make cleanup deterministic.
- [N3] Resampler.cs provenance:
  - Kernel construction (`center`, tolerant Ceiling/Floor, normalisation only when sum>0) and `Cubic` follow ImageSharp's `ResizeKernelMap.BuildKernel` and `BicubicResampler.GetValue` (scratch isrc) nearly line for line, with different structure and names.
  - The formula is the textbook Keys kernel and the doc comment cites the source of the conventions. This is acceptable, but say "conventions mirrored from" rather than implying independent derivation.
  - Maintainability is fine: 129 lines, bounded ring of rows, checked arithmetic.
- [N4] StbImageSharp's `stbi__g_failure_reason` is a non-thread-static global, so concurrent decodes can report each other's inner messages. The outer exception type is unaffected.

## Checklist

1. Spec conformance — issues (B1, B2).
   - Met:
     - ImageSharp removed (no source/csproj/bundle hits; `Core_has_no_SixLabors_dependency`);
     - exact pins, net8 lib, no build targets or native assets;
     - straight top-down BGRA;
     - alpha, colour under alpha=0, RGB, grey, grey-alpha, palette, 16-bit, tRNS and Adam7 decode with 0 differing bytes against ImageSharp;
     - typed refusals for too-small and non-16:9 frames;
     - OCR rounding and scale==1;
     - ≤60 KiB crops with real dimensions;
     - no-key audited Release, solution build and publish.
   - Not met: "no confident-wrong" for PNG decode, and deterministic native disposal on failure paths. H4 remains (see Scope gaps).
2. Correctness — the resampler is correct and byte-exact: no diffs at 1-pixel, extreme-aspect, tiny-alpha and binary-alpha sizes, normalising back, or OCR sizes. The decoder has B1/B2. IHDR guard checked: duplicate IHDR, wrong IHDR length, chunk length over the limit and missing palette are all refused with InvalidDataException; truncated and short IDAT are now refused where ImageSharp silently zero-filled, an improvement.
3. Test quality — the new hash expectations come from the old library. I re-ran 92d59e2 under ImageSharp myself (diagnostic, see Commands): Core 28/30 passed with only the 2 intended REDs, Portable 5/5. Old resize-helper swaps do not weaken assertions, since parity is byte-exact (ImageSharp's default `Resize` sampler is also Bicubic). Weak spot: the fuzz test cannot detect wrong pixels (B1).
4. Fabrication — the changelog's gate outputs match my fresh runs. Inaccurate claims: changelog:104 (no unmanaged), the PngCodec.cs:26 "bounded memory" comment, changelog:166 (fuzz "ok" includes corrupt decodes) and changelog:73 (licence "travels"). Parity is measured on macOS arm64 only, and the changelog says so.
5. Security — B1, B2, S3, S4. No secrets, credentials or suppressions; audit and warnings-as-errors unchanged.
6. Free tier — n/a, no change. The crop ≤60 KB R2 contract holds.
7. Scope — ok. Only the declared cross-task edits are present (30 erratum, runbook paragraph, test helper swaps). No changes to schema, API, engine, web, master, golden, fixtures, layouts, workflows or props.
8. Maintainability — pins exact; the Resampler is clear. Issues: an unsafe auto-ported decoder used only for PNG (S4) and a misleading comment (B2).

## Commands run

All "fresh" runs used candidate 3a157d5 with bin/obj deleted first. Environment: `DOTNET_ROOT=…/T16b/dotnet-combo` (SDK 10.0.103 + 8.0.31), scoped per process. Audit default, warnings-as-errors on.

Fresh gates:
```
$ bash .github/scripts/agent-gates.sh runtime → EXIT 0 (lists Microsoft.NETCore.App 8.0.31 … 10.0.3)
$ bash .github/scripts/agent-gates.sh core-tests
Passed!  - Failed: 0, Passed: 336, Skipped: 0, Total: 336 - Uma.Agent.Core.Tests.dll (net8.0)   EXIT 0
$ bash .github/scripts/agent-gates.sh windows-build → 0 Warning(s) 0 Error(s) EXIT 0
$ dotnet test …/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release
Passed!  - Failed: 0, Passed: 230, Skipped: 0, Total: 230   EXIT 0
$ dotnet build …/Native/Uma.Agent.Windows.Tests.csproj -c Release -p:EnableWindowsTargeting=true → 0 Warning(s) 0 Error(s)
$ dotnet build Uma.Agent.sln -c Release -p:EnableWindowsTargeting=true → 0 Warning(s) 0 Error(s)
$ dotnet publish … -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableWindowsTargeting=true → EXIT 0
  Uma.Agent.Windows.exe 191285045 B; cmp with parent publish → IDENTICAL
$ python3 …/Tools/bundle_probe.py <exe> . → matches 15 of 15; StbImageSharp.dll/Hjg.Pngcs.dll/e_sqlite3.dll present
$ grep -c -a in exe: "Apache License" 0, "LICENSE-2.0" 0, "Permission is hereby granted" 0, "SixLabors" 0, "libSkiaSharp" 0
$ dotnet list Core package --include-transitive → Hjg.Pngcs 1.1.5, Microsoft.Data.Sqlite 10.0.3, StbImageSharp 2.30.16; transitive SQLitePCLRaw.* 2.1.11, System.Memory 4.5.3
$ dotnet list Core|Windows package --vulnerable --include-transitive → SQLitePCLRaw.lib.e_sqlite3 2.1.11 High GHSA-2m69-gcr7-jv3q (both)
$ MemoryProbe.dll → A idle 240 polls processed 1 skipped 239 +MB 8.7; C 20 veterans +MB 77.8 flat; D Frames 80 +MB 671.9 (bound 664)
$ EdgeProbe.dll → DRAIN bounded=8; oldDisposed=True; OCR tile cancellation propagated; ASSERTIONS passed
$ TOOLS_DIR=…/IR1/tools bash .github/tests/run.sh → regression checks: 62 passed, 0 failed
$ node .github/scripts/check-config.mjs . → config check ok
$ git diff --check 55d1aac..HEAD → clean; git status → clean, HEAD 3a157d5
```

Fresh package and provenance checks:
```
nupkg sha256: stbimagesharp 7bc69c8f…ca849b, hjg.pngcs 4e34e2d4…f9c2b2 (match changelog)
nuspec: StbImageSharp "Unlicense OR MIT", commit 125af70 (lib net8.0/netstandard2.0/net471, no build/); Hjg.Pngcs "Apache-2.0", commit b4a13cc, license.txt only (no NOTICE)
GHSA API affects=StbImageSharp/Hjg.Pngcs → 0; OSV → {}
```

Diagnostic run at 92d59e2 under old ImageSharp (Debug, `-p:NuGetAudit=false`; not gate evidence):
```
Core ImageBehaviourTests: Failed 2 (Core_has_no_SixLabors_dependency; Loading_a_non_image… Actual SixLabors…UnknownImageFormatException), Passed 28
Portable OcrUpscaleBehaviourTests: Passed 5/5
```

Fresh independent parity harness (scratch, old = ImageSharp 3.1.12 compared against the candidate's built Core.dll; macOS arm64 only):
```
resample cases 165x4 kinds (opaque/randalpha/tinyalpha/binalpha, incl 1x1, 4000x2→13x1, 2x4000→1x13, 1920x1080→1x1): 0 diff bytes all
fixture resamples 120 (15 × 2560x1440,1280x720,3840x2160,2600x1462,600x338,37x21 + normalize back): 0 diffs
decode rgba8/rgba16/rgb8/gray8/gray1/graya8/pal8/rgba8-adam7: diffbytes 0; new encode → ImageSharp decode diff 0 (ct 6, depth 8, non-interlaced)
crops: same-dim 566 (0 pixel diffs), diff-dim 34 (all one ×0.7 step), over60KiB 0, maxLen 61387
```

Fresh hostile and leak probes (separate bounded subprocesses):
```
dupihdr/ihdrlen/trunc/short/chunklenhuge/ct3nopal/badct → InvalidDataException (inner: multiple IHDR / bad IHDR len / bad codelengths / not enough pixels / IDAT size limit / no PLTE / bad ctype)
badcrc → OK 4x4 (ImageSharp: CRC Error)      extra → OK 4x4 (ImageSharp also OK)
bomb1x1_256M → OK 1x1, maxRSS 315 MB; bomb1x1_1G → OK, 1.11 GB; bomb1x1_2G → OK, 1.56 GB   (ImageSharp 256M: maxRSS 51 MB)
maxdecl_full 7680x4320 → OK, maxRSS 442 MB
corrupt (1-bit IDAT flips ×3000): new ok-WRONG 1858, refused 1142; ImageSharp refused 3000
leak 30000 mutations: refusals IOException=14 → outstanding stb native allocations 14
leak2 (32 MiB IDAT, refused ×20): managed 128 MiB, process WS 779 MiB, maxRSS 917 MB
```

Inherited and not re-run: the worker's 90-case parity table, its 645-crop layout comparison and its 200k fuzz. My numbers above are independent replacements for those, not confirmations.

Scope gaps:
- Native Windows execution of the EXE, WGC/Windows.Media.Ocr, `--record-ocr` on Windows and x64 numeric parity are all H4. The cross-compile and publish here are packaging evidence only.
- The TS workspace was not run; no TS paths were touched.
- No synthetic, game or deployment proof is claimed.

session_id: 20261010_080715_e1d1fc
