# T16b — License-key-free image-library migration (integration B2)

- **Status:** Done (implementation, macOS gates and cross-target packaging). Native Windows execution remains H4.
- **Branch:** task/T16b-image-library-migration (base 55d1aac)
- **Agent / model:** claude-opus-5-5, medium (direct implementation, no sub-agents)
- **Date:** 2026-10-10

## Summary
- SixLabors.ImageSharp is gone from every agent project, test and published output. In its place:
  - **StbImageSharp 2.30.16** decodes PNG (MIT OR Unlicense, managed, has a net8.0 lib).
  - **Hjg.Pngcs 1.1.5** encodes PNG (Apache-2.0, managed, net8.0 lib; zlib comes from the BCL `DeflateStream`).
  - A small Core `Resampler` (129 lines) reproduces the ImageSharp 3.1.12 `KnownResamplers.Bicubic` convention.
- Neither package has an MSBuild target, native asset or licence check, and nothing needs a key.
- With audit and warnings-as-errors unchanged, the following now pass on a fresh build of the candidate:
  - the normal audited Release `agent-gates.sh core-tests` (336/336) and `windows-build`;
  - Portable tests (230/230), the Native test cross-build and the solution build;
  - the runbook's win-x64 self-contained single-file publish.
- Frame semantics hold: straight, top-down, tightly packed BGRA. Across all 15 real fixtures, PNG decode and bicubic resampling are **byte-identical** to the pre-migration build. Thresholds, labels, fixtures, master data and golden data are untouched.

## Files
Created:
- `agent/src/Uma.Agent.Core/PngCodec.cs`: PNG decode/encode to straight BGRA.
  - Signature and IHDR size guard: at most 16384 px per side and 7680×4320 pixels, checked before the decoder allocates.
  - Any decoder failure becomes `InvalidDataException`.
- `agent/src/Uma.Agent.Core/Resampler.cs`: separable Keys a=−0.5 bicubic with premultiplied-alpha accumulation, pixel-centre mapping and area-widened downscale support. Its working set is a bounded ring of rows.
- `agent/tests/Uma.Agent.Core.Tests/ImageBehaviourTests.cs`: 34 regression cases (described under Verification).
- `agent/tests/Uma.Agent.Windows.Tests/Portable/OcrUpscaleBehaviourTests.cs`: 5 regressions covering OCR upscale geometry, rounding and pixels.
- `docs/changelog/T16b-image-library-migration.md`: this file.

Modified:
- `agent/src/Uma.Agent.Core/Uma.Agent.Core.csproj`: drops `SixLabors.ImageSharp 3.1.12` and adds exact pins `StbImageSharp 2.30.16` and `Hjg.Pngcs 1.1.5`. The SQLite pin is unchanged.
- `agent/src/Uma.Agent.Core/Frames.cs`:
  - `Load` now goes through `PngCodec` (reads the whole file, then releases the handle).
  - `Normalize` now goes through `Resampler`.
  - `ToImage`/`FromImage` are removed: they exposed ImageSharp types, and no caller remains outside tests.
- `agent/src/Uma.Agent.Core/Session.cs`: `CropPng` keeps the same clamp, the same ×0.7 loop with `(int)` truncation, the same ≤60 KiB / scale<0.05 exit and the same default bicubic. It now calls `Resampler` and `PngCodec.Encode`.
- `agent/src/Uma.Agent.Windows/Portable/OcrGeometry.cs`: `Upscale` keeps the same reference guard, the `Math.Round` sizes, the bicubic resampling and the scale==1 exact crop.
- Tests that only built synthetic resized frames now use `Resampler.Resize` with the same sizes and kernel. Their assertions, labels and thresholds are unchanged. Files:
  - `ReviewRound2Tests.cs`, `CompletenessTests.cs`, `ClassifierAndPrimitiveTests.cs`, `CardsFixtureSessionTests.cs`
  - `ImageTests.cs` (`Frames.Load` + `Frames.Crop`, same offsets)
  - Portable `CapturePipelineTests.cs` and `OcrRecordingTests.cs` (a blank 1280×720 PNG via `PngCodec.Encode`)
- `docs/specs/30-capture-agent.md` §1: a narrow erratum (ImageSharp mandate → key-free managed libraries), authorized by 64.
- `docs/runbooks/agent-install.md` §1: one paragraph stating that no image-library licence key, file or environment variable is needed, and that `e_sqlite3.dll` is the only bundled native library.

## Library selection (actual NuGet/source metadata, fetched 2026-10-10; nupkgs downloaded to scratch only)
| Candidate | Version / date | Licence | net8 / Release build assets | Native | Advisories | Outcome |
|---|---|---|---|---|---|---|
| SixLabors.ImageSharp (original) | 3.1.12 / 2025-10-29 | Six Labors Split License 1.0 | lib net6.0, `.props` only | none | **5 GHSAs** (GHSA-gwg2-r3hj-4w44, -wmxv-xphr-5c9g, -j3p4-wp97-rph4, -j9gm-c75j-xc9q, -jjfr-hcj7-qf5w) | removed |
| SixLabors.ImageSharp 4.1.2/4.1.3 | 2026-10 | same text; **build-time key check** (T16 inspected the `SixLabors_ValidateLicense` target) | Release build fails without a key | none | patched | ruled out by the user's decision |
| **StbImageSharp** | **2.30.16** / 2026-08-08; repo pushed 2026-08-08, not archived | `Unlicense OR MIT` (nuspec expression) | `lib/net8.0`, no build/buildTransitive | none | none on NuGet or the GitHub Advisory API | **chosen: decode** |
| **Hjg.Pngcs** | **1.1.5** / 2025-12-08 (net8/net9 retarget); upstream PNGJ port | `Apache-2.0` (nuspec, `license.txt`) | `lib/net8.0`, no build assets; zlib = BCL `DeflateStream` | none | none | **chosen: encode** |
| StbImageWriteSharp | 1.16.7 / 2022-06-29 | no SPDX expression; `PackageLicenseUrl` = "Public Domain" | netstandard2.0 only | none | none | rejected: no machine-readable licence, older; PNG 37–40% larger than ImageSharp (would change crop sizes much more) |
| SkiaSharp | 4.153.1 / 2026-09-30 | MIT (+ THIRD-PARTY-NOTICES for libpng/zlib/etc.) | lib net6.0 (no net8 folder); deps `NativeAssets.macOS`/`Win32` (osx universal dylib; win-x64/x86/arm64 dll) | **yes** (~10 MB per RID) | 2.88.0–2.88.5 had GHSA-j7hp-h8jx-5ppr; 4.153.1 none | rejected (see below) |
| PhotoSauce.MagicScaler | 0.15.0 / 2024-12-05 | MIT | lib net8.0 | none (codecs are separate/Windows WIC) | none | rejected: no portable PNG codec without extra plugins; its CatmullRom differs from the calibrated output (≤1 LSB, 599–11,391 bytes per frame) |
| BigGustave | 1.0.6 / 2021-05-01 | Unlicense | netstandard2.0 | none | none | not pursued: last release 2021 |

Why SkiaSharp was rejected, although it qualifies under 64's conditions:
- It adds an unmanaged image codec stack: native code to patch, plus a Windows/macOS native load path that cannot be exercised on Windows here (H4).
- Its decode gives premultiplied RGBA, which needs conversion.
- On fixtures 05 and 13 its CatmullRom does **not** match the calibrated bicubic:
  - 2560×1440: max 1–6 LSB;
  - 1280×720 downscale: max 73–82 LSB, mean 0.58–1.34.
- Native packaging was inspected, not adopted (`runtimes/win-x64/native/libSkiaSharp.dll` PE32+ x86-64; `runtimes/osx/native/libSkiaSharp.dylib` universal).

Licences for the record:
- Original:
  - ImageSharp 3.1.12 is under the Six Labors Split License 1.0 (sha256 `fdb7f24d…`, per T16).
  - The 4.x line keeps the same text but enforces a key at build time.
- New:
  - StbImageSharp is `Unlicense OR MIT` (https://licenses.nuget.org/Unlicense%20OR%20MIT; repo https://github.com/StbSharp/StbImageSharp, nuspec commit 125af70c).
  - Hjg.Pngcs is `Apache-2.0` (https://licenses.nuget.org/Apache-2.0; https://github.com/henrikstengaard/pngcs, nuspec commit b4a13ccf).
  - Both are permissive, need no account, key or paid tier, and run no install/build-time scripts.
  - Apache-2.0 attribution: Hjg.Pngcs's licence travels inside the nupkg. A user-facing NOTICE/about screen does not exist in the agent today, so adding one is a follow-up for the release packaging owner.

Pins and integrity:
- Downloaded nupkg sha256:
  - `stbimagesharp.2.30.16.nupkg` 7bc69c8f…849b
  - `hjg.pngcs.1.1.5.nupkg` 4e34e2d4…b2
- `project.assets.json` sha512:
  - StbImageSharp `qg1i+NHi…EG/lw==`
  - Hjg.Pngcs `ZWE63GTV…HPB0Q==`

Rejected-candidate nupkg sha256 (scratch):
- skiasharp 9cf0fa68…4816
- nativeassets.win32 c27b0433…e1ae
- nativeassets.macos da896749…c9

## Decisions
- **Decode: StbImageSharp, encode: Hjg.Pngcs, resample: our own code.**
  - No maintained key-free managed package offers all three with ImageSharp-compatible bicubic.
  - The resampler is not a codec: about 70 lines of kernel/convolution with the conventions taken from the ImageSharp 3.1.12 sources (`ResizeKernelMap.BuildKernel`, `BicubicResampler.GetValue`, premultiply / un-premultiply, `(v*255+0.5)` clamp). I read those to pin the semantics; no Six Labors code was copied.
  - This is the only way I found to keep the calibrated parser inputs byte-identical without a native dependency.
  - No PNG codec was hand-written.
- **Byte-exact parity, not "close enough".**
  - My first prototype premultiplied as `c/255·a/255`, which gave 1-LSB differences on 41–9,410 bytes per fixture frame.
  - Matching ImageSharp's `(c·(1/255))·(a·(1/255))` order gave **0 differing bytes** on all 90 measured fixture resamples (below). No threshold had to absorb a change.
- **PNG decode policy:**
  - Only PNG is accepted; there is a signature check.
  - IHDR is checked against the decode limits before the decoder allocates. The limits are 16384 px per side and an 8K 16:9 client area; the largest real input is the 1920×1080 fixtures and `--record-ocr` screenshots.
  - Any decoder failure (`InvalidOperationException`, `IOException`, …) becomes `InvalidDataException`, never a library-specific type.
  - `Frames.Load` reads the whole file first, so no handle is held during decode or after failure. That is tested with exclusive re-open.
- **PNG encode:** RGBA8 colour type 6 at compression level 9, the highest the API exposes. Filter choice uses the library default, which is adaptive with Paeth preference. `FILTER_AGGRESSIVE` measured larger.
- **Disposal:**
  - No unmanaged handles exist: no native library, no pooled ImageSharp buffers.
  - `PngWriter` writes into a `using` MemoryStream with `ShouldCloseStream=false`.
  - Resampler buffers are ordinary arrays bounded by one source row plus `window × destWidth` floats.
- **Q-161 resolution:** see the section near the end of this file.

## Deviations from spec
- 30 §1 named ImageSharp. That is changed by an authorized erratum (64); see Cross-task edits.
- `Frames.ToImage`/`Frames.FromImage`, whose public signatures carried ImageSharp types, are removed. `PngCodec` and `Resampler` are the new public helpers.
  - The only callers were tests and the three call sites listed above.
  - Public capture/API contracts and `Frame` are unchanged.
- **Measured consequence of the different PNG encoder.** Hjg.Pngcs output is about 1–5% larger than ImageSharp `BestCompression`; across 645 crops it averaged 1.0090× the old size.
  - For crops already near the 60 KiB limit, the ×0.7 loop can take one extra step, giving smaller final dimensions:
    - real layout ROIs: 645 crops from 43 layout rectangles × 15 fixtures, measured against a verbatim ImageSharp 3.1.12 replica of the old `CropPng` in scratch;
    - **643 have identical final dimensions**;
    - 2 differ, both from `deck.diamondRows` `[215, 369, 524, 679]` on 07 and 10. That is a list of four row Y values that the scratch extractor misread as a rectangle; it is never a crop, so no real ROI changed;
    - random rectangles: 588/600 identical, 12 one step smaller (e.g. 823×36 instead of 1178×51 for a 1683×74 strip);
    - max output 61,345 B, always ≤ 61,440.
  - Review crops remain valid PNGs within the contract (≤60 KiB, real dimensions, pixels exactly the cropped or resampled pixels). Only compression size differs.
  - Unscaled crops round-trip exact pixels, which is tested.

## Cross-task edits
- `docs/specs/30-capture-agent.md` §1 (T09/T10-owned spec): the ImageSharp mandate is replaced with an erratum block. Authorized by 64; the paragraph is changed in place, nothing broader.
- `docs/runbooks/agent-install.md` (T10-owned): one new paragraph. The commands are unchanged.
- Tests owned by T09/T10/T11 only swap the synthetic resize/PNG helper (listed under Files). Their assertions are unchanged.
- **Not touched:** schema, API, engine, web, master, golden, fixtures/labels/OCR recordings, layouts, thresholds, CI/workflows, `agent-gates.sh`, `Directory.Build.props`, `global.json`, SQLite, T17's capture-quality policy.

## Verification
Environment:
- SDK 10.0.103, selected by `agent/global.json` (9.0.100 + latestMajor).
- Global runtimes are 9.0.14 and 10.0.3 only. The native net8 host is the IR1 scratch `dotnet8` (Microsoft.NETCore.App 8.0.31), inspected first.
- To run the **unmodified** gate scripts, which require a net8 runtime next to the SDK, I built `~/.hermes/cache/scratch/T16b/dotnet-combo`:
  - a copied muxer plus symlinks to the global SDK/packs and the 8.0.31/9/10 runtimes;
  - used via `DOTNET_ROOT`/`DOTNET_BIN`;
  - no global configuration was changed.
- Audit properties are defaults (unchanged) and `TreatWarningsAsErrors=true` stays. No `NuGetAudit=false` or suppression appears in any gate evidence.
- `bin/`/`obj/` were deleted before the gate runs at 8ddd262, so these are fresh builds of this candidate. `--no-build` was used only directly after a successful build.

RED, pre-migration (base 55d1aac, unchanged tree, normal audited Release):
```
$ bash .github/scripts/agent-gates.sh core-tests   → exit 1
  Uma.Agent.Core.csproj : error NU1902: Warning As Error: Package 'SixLabors.ImageSharp' 3.1.12 has a known moderate severity vulnerability … (×2)
  Uma.Agent.Core.csproj : error NU1903: … high severity … (×3)   Failed to restore …/Uma.Agent.Core.csproj
$ bash .github/scripts/agent-gates.sh windows-build → "5 Error(s)"
```
The publish RED is identical in T16's retained evidence (restore failure).

Characterization and RED for the new regressions, at commit 92d59e2 (tests only, ImageSharp still in place):
- These ran in **Debug with `-p:NuGetAudit=false`**. That was the only way to execute the old library and record its expected values, and it is not gate evidence.
- All 15 fixture decode hashes, the resample vectors, the review-crop decoded hashes and the 4 OCR upscale hashes came from that run or from the equivalent ImageSharp 3.1.12 scratch harness.
```
Portable OcrUpscaleBehaviourTests: Passed 5/5   (expected values = old behaviour)
Core ImageBehaviourTests: Failed 2, Passed 28, Total 30
  Core_has_no_SixLabors_dependency [FAIL]
  Loading_a_non_image_fails_with_a_typed_error_and_releases_the_file [FAIL]
    Expected: typeof(System.IO.InvalidDataException)  Actual: typeof(SixLabors.ImageSharp.UnknownImageFormatException)
```
Two more REDs came up during implementation. Each was added and failed before its fix:
```
Oversized_png_headers_are_refused_before_pixel_allocation (3 cases) → Failed 3: "corrupt or unsupported PNG image" (no pre-allocation guard)
Corrupted_pngs_only_ever_fail_with_InvalidDataException → Failed: System.IO.IOException : An attempt was made to move the position before the beginning of the stream.
→ after IHDR guard + IOException wrapping: Passed 3/3, Passed 1/1
```
A scratch fuzz of 200,000 mutated PNGs afterwards produced only `ok` frames (10,714) or `InvalidDataException`.

Parity measurement of new against old bicubic (scratch harness; old = ImageSharp 3.1.12, new = Core `Resampler` logic):
```
fixture cases 90 (15 fixtures × {2560x1440, 1600x900, 1280x720, 3840x2160} + normalising 2560/3840 back to 1920x1080): 0 differing bytes in every case
OCR-style 600x60 upscale on 01–03: diff=0
random-alpha synthetic: 37x23→25x15/60x23, 64x64→17x9, 5x1→11x3: diff 0; 37x23→74x46: 1 alpha byte of 13,616 differs by 1 (float summation order)
PNG decode (StbImageSharp vs ImageSharp) of all 15 fixtures: 0 differing bytes; all fixtures have alpha 255
```
Fixtures only have opaque pixels, so the remaining 1-LSB alpha-edge difference cannot affect calibrated fixture readings. Parity was measured on macOS arm64; native x64 output was not measured (H4).

GREEN, fresh build of candidate 8ddd262, normal audited Release:
```
$ DOTNET_BIN=…/dotnet-combo/dotnet bash .github/scripts/agent-gates.sh runtime       → exit 0 (10.0.103; Microsoft.NETCore.App 8.0.31)
$ DOTNET_BIN=… bash .github/scripts/agent-gates.sh core-tests                        → exit 0
  Passed!  - Failed: 0, Passed: 336, Skipped: 0, Total: 336 - Uma.Agent.Core.Tests.dll (net8.0)
$ DOTNET_BIN=… bash .github/scripts/agent-gates.sh windows-build                     → exit 0   0 Warning(s) 0 Error(s)
$ dotnet test agent/tests/Uma.Agent.Windows.Tests/Portable/…Portable.Tests.csproj -c Release   → exit 0
  Passed!  - Failed: 0, Passed: 230, Skipped: 0, Total: 230 - Uma.Agent.Windows.Portable.Tests.dll (net8.0)
$ dotnet build agent/tests/Uma.Agent.Windows.Tests/Native/Uma.Agent.Windows.Tests.csproj -c Release -p:EnableWindowsTargeting=true → 0 Warning(s) 0 Error(s)
$ dotnet build agent/Uma.Agent.sln -c Release -p:EnableWindowsTargeting=true          → 0 Warning(s) 0 Error(s)
$ dotnet build Tools/MemoryProbe, Tools/EdgeProbe -c Release                          → 0 Warning(s) 0 Error(s) each
$ dotnet publish agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -c Release -r win-x64 --self-contained true \
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableWindowsTargeting=true -o $SCRATCH/publish → exit 0
  Uma.Agent.Windows.exe 191,285,045 B (+ Uma.Agent.Core.pdb, Uma.Agent.Windows.pdb)
```
Counts: Core has 336 tests, the previous 302 plus 34 new `ImageBehaviourTests` cases. Portable has 230, the previous 225 plus 5 new `OcrUpscaleBehaviourTests` cases.

No licence anywhere:
- `env | grep -i sixlabors` is empty, and no `*.lic` file exists in the repo.
- The publish does not mention a licence.
- Bundle bytes contain `SixLabors` 0 times, `sixlabors.lic` 0 times and `SixLaborsLicense` 0 times.

Dependency graph and advisories:
```
$ dotnet list src/Uma.Agent.Core/Uma.Agent.Core.csproj package --include-transitive
  > Hjg.Pngcs 1.1.5 1.1.5 ; > Microsoft.Data.Sqlite 10.0.3 ; > StbImageSharp 2.30.16 2.30.16
  transitive: Microsoft.Data.Sqlite.Core 10.0.3, SQLitePCLRaw.* 2.1.11, System.Memory 4.5.3   (no image-library transitive deps)
$ dotnet list … package --vulnerable --include-transitive   (Core and Windows)
  > SQLitePCLRaw.lib.e_sqlite3  2.1.11  High  GHSA-2m69-gcr7-jv3q     ← pre-existing, unchanged, out of scope (see follow-ups)
```
Published bundle manifest (bundle v6, parsed independently; 475 entries):
- managed: `StbImageSharp.dll` 77,312 B, `Hjg.Pngcs.dll` 82,944 B, `Uma.Agent.Core.dll`;
- the only non-runtime native: `e_sqlite3.dll` 1,795,072 B;
- no libSkiaSharp and no SixLabors assembly.

`python3 agent/tests/Uma.Agent.Windows.Tests/Tools/bundle_probe.py <exe> .` → `matches 15 of 15` bundled data files, exit 0.

Boundedness and cancellation regressions:
```
$ <dotnet8> Tools/MemoryProbe.dll "$PWD" → exit 0
  A still 240 polls: processed 1 skipped 239; Frames 1; managed +MB 8.7 (T10 recorded +11.1)
  C 20 veterans: Frames 9; +MB 77.8 flat; after Stop Frames 0 (+11.4)
  D worst case: Sessions 2, Frames 80; +MB 671.9 (bound 664 MB of frames; T10 recorded 672.0)
$ <dotnet8> Tools/EdgeProbe.dll "$PWD" → exit 0 … "DRAIN bounded=8; oldDisposed=True", "OCR tile cancellation propagated", "ASSERTIONS passed"
```
.github regression suite:
```
$ TOOLS_DIR=~/.hermes/cache/scratch/IR1/tools bash .github/tests/run.sh → exit 0, "regression checks: 62 passed, 0 failed"
$ node .github/scripts/check-config.mjs . → config check ok (structure): MASTER_VERSION=global-20260930
```
Not run:
- The TS workspace (`pnpm -r …`): no TS, schema, API, web or integration path was touched. Agent capture JSON and fingerprints are unchanged; the Core contract/parity tests are part of the 336.
- Recursive builds, golden refresh, deploy, push: forbidden.
- Native Windows: WGC, Windows.Media.Ocr, launching the published EXE, and x64 numeric parity of resampling. These are **H4**. The cross-target publish is compile/packaging evidence only and does not show the EXE runs on Windows.

## Q-161 resolution (T16, recorded here only)
- Q-161 ("ImageSharp advisory fix requires a Six Labors build licence key") exists only on `task/T16-agent-dependency` (commit 129228e, `docs/OPEN_QUESTIONS.md`). It is **not** present in this branch's `docs/OPEN_QUESTIONS.md`, so I do not add or renumber it here.
- Resolution: the user chose option 3 (replace ImageSharp with a key-free library). T16b implements it, with no licence key, audit suppression or licensing bypass.
- Main ownership and reconciliation: the coordinator owns `docs/OPEN_QUESTIONS.md` on main. If T16's docs are ever merged, mark Q-161 resolved by T16b, citing this changelog. The 4.1.3 pin attempt stays unmerged.

## Open questions / follow-ups
- **Follow-up (separate from B2, not fixed here per 64):**
  - Transitive `SQLitePCLRaw.lib.e_sqlite3 2.1.11` has a High advisory, GHSA-2m69-gcr7-jv3q, which arrives via Microsoft.Data.Sqlite 10.0.3.
  - Gates ignore it only because `NuGetAuditMode=direct`.
  - It needs its own task. No new Q-number was invented here, to avoid colliding with T16's branch numbering.
- Follow-up: there is no in-app third-party notice. Apache-2.0 (Hjg.Pngcs) and MIT (StbImageSharp) attribution should be added to the release packaging or about text by the T10/T12 owner.
- Follow-up: if Windows readings ever differ, re-measure bicubic parity on native x64 at H4. The calibrated fixtures are opaque and macOS arm64 parity is exact.
- H4 is unchanged: native Windows build/run, WGC/OCR, `--record-ocr`, live imports and the memory measurement remain human acceptance. This task only removes the Release-build dependency blocker. It verifies no game mechanics.
