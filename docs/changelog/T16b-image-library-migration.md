# T16b — License-key-free image-library migration (integration B2)

- **Status:** Final worker fix round 2 complete; awaiting independent focused round-3 review and parent rerun. Native Windows execution remains H4.

> **Review round 1 supersedes parts of this file.** The original sections below are kept as the historical record of candidate 3a157d5.
> - Wherever they name StbImageSharp/Hjg.Pngcs as dependencies, or claim no unmanaged handles, bounded decode memory, an ok-only fuzz, or that the licence travels with the build, see `## Review round 1` at the end.
> - Current state (review round 2): no third-party image packages; first-party PNG framing/conversions, SharpZipLib 1.4.2 for managed decode compression, BCL `ZLibStream` for encoding. Round-1 BCL completion and file-ingress claims are superseded below.
- **Branch:** task/T16b-image-library-migration (base 55d1aac)
- **Agent / model:** inherited claude-opus-5-5 medium implementation; final worker fix round 2 explicitly user-directed openai-codex/gpt-6.1-sol medium, same implementation session. Work/history preserved; no provider failure, subagents or model CLIs.
- **Date:** 2026-10-10

## Summary
*(historical, candidate 3a157d5; superseded by Review round 1)*
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

## Library selection (historical round-0 assessment; the two chosen packages were removed in review round 1) (actual NuGet/source metadata, fetched 2026-10-10; nupkgs downloaded to scratch only)
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
  - **[Incorrect; corrected in review round 1, S1]** Apache-2.0 attribution: Hjg.Pngcs's licence travels inside the nupkg. A user-facing NOTICE/about screen does not exist in the agent today, so adding one is a follow-up for the release packaging owner.

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
*(round-0 decisions; StbImageSharp/Hjg.Pngcs and their decode policy are superseded by Review round 1)*
- **Decode: StbImageSharp, encode: Hjg.Pngcs, resample: our own code.**
  - None of the round-0 evaluated alternatives above met all three requirements with the measured ImageSharp-compatible bicubic. This is not an exhaustive package-absence claim.
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
  - **[False for 3a157d5; review B2]** No unmanaged handles exist: no native library, no pooled ImageSharp buffers. (StbImageSharp allocated with `Marshal.AllocHGlobal` and leaked on its IOException path.)
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
A scratch fuzz of 200,000 mutated PNGs afterwards produced only `ok` frames (10,714) or `InvalidDataException`. **[Misleading; review B1]** "ok" only meant a consistent byte length. Many of those decodes had wrong pixels, because StbImageSharp checked neither CRC nor Adler-32.

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
- **[Superseded by review round 1, S1: this is a release blocker, see there]** Follow-up: there is no in-app third-party notice. Apache-2.0 (Hjg.Pngcs) and MIT (StbImageSharp) attribution should be added to the release packaging or about text by the T10/T12 owner.
- Follow-up: if Windows readings ever differ, re-measure bicubic parity on native x64 at H4. The calibrated fixtures are opaque and macOS arm64 parity is exact.
- H4 is unchanged: native Windows build/run, WGC/OCR, `--record-ocr`, live imports and the memory measurement remain human acceptance. This task only removes the Release-build dependency blocker. It verifies no game mechanics.

## Review round 1
Historical evidence at 4d701d4: BCL zlib completion/oracle and pre-read ingress claims were incomplete (B3/B4); see Review round 2. No-third-party-component wording applies to this historical candidate, not the new SharpZipLib dependency.

Review: `docs/reviews/T16b-review-1.md` on the main checkout (reviewer session 20261010_080715_e1d1fc), verdict CHANGES_REQUESTED on 3a157d5. This is worker fix round 1 of 2.

Commits since 3a157d5:
- `9de2736` RED regressions;
- `cab3634` codec replacement;
- `f36ea0d` canonical fixture re-encode check;
- `fbae89a` errata, runbook, fuzz test and comments;
- the final commit holds this changelog.

### Decision: no third-party image library at all
Both StbImageSharp 2.30.16 and Hjg.Pngcs 1.1.5 are **removed** from `Uma.Agent.Core.csproj`. `PngCodec` is now a fully managed, validating PNG codec on the .NET base library's `ZLibStream`, about 400 lines with no `unsafe`, no `Marshal` and no native allocation of its own.

The reviewer suggested the Hjg.Pngcs reader. I read its sources at the pinned commit (b4a13cc, scratch copy in `T16b-review1/pngcs`) instead of assuming "managed = safe", and rejected it:
- `ZlibInputStreamMs` reads the zlib Adler-32 into `crcread`, with the comments "merely informational, not checked" and "we dont really check/use this". So Adler-32 is not verified.
- Its inflate limit is `MaxTotalBytesRead`, 200 MB by default, counted against compressed input bytes, not inflated output.
- It returns raw samples only. Palette/tRNS/16-bit-to-8 conversion and Adam7 placement would still have to be hand-written.

Once those checks and conversions are written, a separate PNG library adds nothing. 64 prefers a stable dependency over a large bespoke codec. The decisive facts here:
- The deflate engine is the BCL's (`System.IO.Compression`, already part of the runtime).
- The PNG layer itself is small: chunk walk, unfilter, sample conversion.
- None of the evaluated PNG alternatives met the complete requirements at the inspected pins: ImageSharp, StbImageSharp, Hjg.Pngcs, StbImageWriteSharp, SkiaSharp, PhotoSauce.MagicScaler and BigGustave (table above). This is a scoped evaluation, not a universal package-absence claim (S7). Review round 2 adds SharpZipLib for compression completion, not a replacement PNG/image library.

Decoder design (`agent/src/Uma.Agent.Core/PngCodec.cs`):
1. Signature, and encoded size ≤ 256 MiB.
2. Full chunk walk before anything is inflated:
   - every length within the buffer, ASCII-letter types, and every CRC-32 verified;
   - IHDR first with length 13, exactly once; PLTE and tRNS at most once and before IDAT;
   - IDATs contiguous, IEND last with length 0 and nothing after it;
   - unknown critical chunks refused; unknown ancillary chunks CRC-checked and ignored.
3. IHDR is checked for colour type, bit depth, compression, filter and interlace method, and against the existing limits (16384 px per side, 7680×4320 pixels).
4. Bounded inflate:
   - The exact filtered size `Σ passes (rowBytes+1)×rows` is computed from IHDR, including Adam7.
   - The zlib header is validated (CM=8, FCHECK, no preset dictionary).
   - An IDAT payload too small to ever reach that size (1032:1 deflate bound) is refused before allocation.
   - `ZLibStream` inflates into a buffer of exactly that size; one extra byte, or a shortfall, is refused. Inflated output therefore never exceeds the declared image by more than one byte.
   - Adler-32 is recomputed over the inflated bytes and compared with the stored value. The BCL accepts a stream that ends without its Adler-32, so that check is mandatory here.
5. Unfilter (types 0–4, otherwise refused) and conversion to straight BGRA:
   - grey 1/2/4/8/16, grey+alpha 8/16, RGB 8/16, RGBA 8/16, palette 1/2/4/8 (index range checked), tRNS for grey, RGB and palette, Adam7;
   - 16→8 bit as round(v/257) and sub-byte grey scaled to 0–255, following ImageSharp 3.1.12's conversions.

Encoder: 8-bit RGBA, non-interlaced, IHDR/IDAT/IEND only.
- Per-row minimum-sum-of-absolute-differences filter choice (PNG spec heuristic).
- `ZLibStream` at `CompressionLevel.SmallestSize`.
- `using`-scoped streams.

### B1: confident-wrong decodes. Resolved
- Every chunk CRC and the zlib Adler-32 are verified; structural rules as above.
- Regressions (`PngDecodeSafetyTests`):
  - `Every_bit_flip_in_IHDR_IDAT_and_their_CRCs_is_refused`: one flip in every type, data and CRC byte of IHDR and IDAT of a real fixture-13 PNG; every flip throws `InvalidDataException`. That is 37,316 flips: IHDR 4+13+4 bytes plus IDAT 4+37,287+4 bytes, from the measured IDAT length 37,287.
  - `Every_zlib_bit_flip_with_a_recomputed_chunk_CRC_is_refused_unless_checksum_consistent`:
    - every byte of the zlib stream of a 48×40 real crop, with the chunk CRC re-fixed so the zlib layer itself is tested;
    - every zlib-header and Adler-32 flip is refused;
    - a decode with wrong pixels is tolerated only if an independent BCL inflate plus reference Adler-32 shows the mutated stream is itself checksum-consistent;
    - at least `len-16` refusals are required.
  - `Random_mutations_never_produce_wrong_pixels_from_inconsistent_data`: 3000 multi-bit mutations with the CRC re-fixed, the same rule, and ≥ 2990 refusals required.
  - `Malformed_structure_is_refused`: 22 cases, including missing IDAT/IEND, IEND not last, trailing bytes, duplicate or late IHDR, IHDR length 12 or 14, split IDAT, an unknown critical chunk, a length past the end, a truncated file, missing PLTE, out-of-range palette index, PLTE after IDAT, bad colour type or depth, bad filter, data too short or long, missing Adler-32, and a preset dictionary.
  - `Valid_unknown_ancillary_chunks_are_accepted`.
- Residual risk, measured rather than hidden: Adler-32 is only a 32-bit checksum.
  - On the 101×134 crop, one of 37,287 single-bit flips (zlib byte 36957) with a re-fixed chunk CRC changes 3 inflated bytes and leaves Adler-32 unchanged.
  - ImageSharp 3.1.12 also decodes that exact file, with 263 differing BGRA bytes against the source (scratch `r1/adler-collision.png`).
  - Such a file is fully checksum-consistent PNG, so no decoder can refuse it.
  - Without the CRC re-fix, the chunk CRC-32 catches it too, and `Every_bit_flip…` proves that.

### B2: unmanaged leaks and unbounded inflate. Resolved
- No unmanaged allocation route remains: StbImageSharp is gone, and the decoder uses arrays plus the BCL inflater.
- The BCL `ZLibStream` holds a native zlib inflate state with a fixed 32 KiB window, released by `using` on every path, including exceptions.
- Bounded subprocess probes (`~/.hermes/cache/scratch/T16b/r1/hostile`, adapted from the reviewer's `hostile` probe):
  - each case runs in a separate process under the reviewer's `run.py` (RSS kill at 6 GB, 120 s timeout);
  - `/usr/bin/time -l` maximum RSS is shown;
  - the RSS includes building the hostile payload in the harness.
```
bomb1x1_256M | 260979B  -> InvalidDataException: … image data is longer than the header declares | max RSS  45,744,128
bomb1x1_1G   | 1043701B -> InvalidDataException: … longer than the header declares             | max RSS  49,971,200
bomb1x1_2G   | 2088341B -> InvalidDataException: … longer than the header declares             | max RSS  60,243,968
leak2 (64x64 IHDR + 32 MiB IDAT + truncated trailing chunk, ×20) -> InvalidDataException: … data after IEND | max RSS 243,466,240;
     direct rerun: "x20, process WS after GC 104 MiB, managed 64 MiB"   (reviewer on 3a157d5: WS 779 MiB, max RSS 917 MB)
maxdecl_full 7680x4320 (real full-size payload) -> OK 7680x4320 len 132710400 | max RSS 310,018,048 (3a157d5: 442 MB)
small cases: dupihdr, ihdrlen, trunc, short, extra, badcrc, chunklenhuge, ct3nopal, badct, maxdecl_tiny → all InvalidDataException
     (badcrc: "chunk CRC mismatch"; previously "OK 4x4"; extra: now refused as "longer than the header declares")
```
- Retained in-process regression: `Inflate_bomb_is_refused_without_inflating_past_the_declared_image`.
  - It uses a compact payload: a 1×1 IHDR with a 64 MiB-of-zeros IDAT, under 200 KB compressed.
  - It asserts `InvalidDataException` with "longer than the header declares", managed allocation below `2×input+1 MB`, and under 2 s.
  - `Large_declared_image_with_tiny_payload…` is refused before the image-sized buffer is allocated.
  - No GiB-sized payload runs in the xUnit process.
- The `PngCodec` comment and changelog:104 are corrected: they are marked false above and accurate in the code.

### S1: licence delivery. Corrected; release blocker recorded
- The round-0 claim that "Hjg.Pngcs's licence travels inside the nupkg" was wrong: a nupkg file does not reach recipients of the single-file EXE.
- After this round, T16b adds **no** third-party component: StbImageSharp and Hjg.Pngcs are removed, so no Unlicense/MIT election and no Apache §4(a) duty arises from T16b. The new codec is first-party code.
- ImageSharp's split licence also no longer applies.
- The pre-existing gap remains: the self-contained EXE bundles .NET runtime (MIT), SQLite/SQLitePCLRaw, Serilog (Apache-2.0), ProtectedData and others without licence texts.
- Per the parent:
  - **T19** owns packaging all bundled third-party licences and notices;
  - **no `agent-v*` release may be published until T19 lands**, which is recorded in `docs/runbooks/agent-install.md`;
  - T16b does not broaden into runtime attribution and edits no workflow.

### S2: compression. Fixed
- The encoder is now first-party on `ZLibStream(CompressionLevel.SmallestSize)` with per-row MSAD filter selection. Hjg.Pngcs could only reach `Optimal`.
- Fresh comparison against a verbatim ImageSharp 3.1.12 replica of the old `CropPng` (scratch `r1/crop`; each decoded PNG compared with old pixels):
```
layout  seed 0  : crops 645 sameDims 645 (pixel diffs 0) newSmaller 0 newLarger 0 over60KiB 0 maxBytes 60729 meanNew/Old 0.9618
random  seed 42 : crops 600 sameDims 599 (pixel diffs 2) newSmaller 1 newLarger 0 over60KiB 0 maxBytes 61259 meanNew/Old 0.9894
  14 1632x424: old 559x145 61063B new 391x101 35840B
random  seed 99 : crops 600 sameDims 600 (pixel diffs 0) newSmaller 0 newLarger 0 over60KiB 0 maxBytes 61145 meanNew/Old 0.9918
```
- Earlier numbers for comparison, kept as measured:
  - this worker's round-0 random sample: 12/600 took an extra step, on a different seed;
  - the reviewer's round-0 sample: 34/600.
  - The rate depends on the seed. It is now 0–1 per 600 and 0/645 for real layout ROIs.
- The ≤60 KiB contract holds for every crop.
- The "pixel diffs 2" are not encoder-related; see N3 below. The PNG round-trips exactly, and the difference comes from resampling.

### S3: SQLite advisory
- Not fixed in T16b. The parent queued **T18** for SQLitePCLRaw / GHSA-2m69-gcr7-jv3q remediation.
- Fresh `dotnet list … --vulnerable --include-transitive` still shows `SQLitePCLRaw.lib.e_sqlite3 2.1.11 High` and nothing else.

### S4: unsafe auto-ported decoder. Resolved by removal
- StbImageSharp, and with it the C stb_image CVE lineage (CVE-2023-45662/3/4/6/7), is no longer a dependency.
- New decoder inspection:
  - fully managed and bounds-checked: spans and arrays, `checked` size arithmetic, no `unsafe`;
  - the only non-trivial engine is the BCL zlib inflater shipped with the runtime;
  - only PNG is reachable.
- Residual risk:
  - Bugs in first-party code, for example in the conversion paths, are possible. They are covered by the format matrix against ImageSharp-recorded hashes, the structure and corruption suites, and the subprocess hostile probes.
  - The BCL inflater is a native zlib (zlib-ng in .NET 9+, system/bundled zlib in .NET 8) serviced with the runtime. Its CVE exposure is the runtime's and is patched by runtime updates. The win-x64 publish is self-contained, so updating requires a rebuild.

### N1–N4
- **N1:** the `GC.GetAllocatedBytesForCurrentThread` assertions now measure all decoder pixel storage, because the decoder is managed; test comments say so. The BCL inflater's fixed-size native window is noted in the bomb test.
- **N2:** `PngWriter` is gone. The encoder uses `using` for `ZLibStream` and both `MemoryStream`s, so disposal is deterministic and does not rely on finalizers.
- **N3:**
  - The `Resampler` doc comment now says its conventions are **mirrored from** ImageSharp 3.1.12's `BicubicResampler`/`ResizeKernelMap.BuildKernel`, not independently derived. Code is unchanged.
  - The new crop comparison found a previously unmeasured ±1:
    - 2 of 1,200 random review-crop downscales differ (9 bytes total, max 1);
    - the minimal repro is 85×543→59×380 from fixture 14, 1 byte at (26,33): ImageSharp 232, ours 233.
    - It is float-summation-order noise in a non-16:9 crop downscale; ImageSharp shares periodic kernel rows.
  - All fixture-frame normalisations, OCR upscales and all 645 layout-ROI crops stay byte-identical. I recorded this rather than rewrite the reviewed-good resampler.
- **N4:** resolved by removing StbImageSharp, and its non-thread-static failure-reason global with it. `PngCodec` has no shared mutable state; the CRC table is read-only.

### Other corrections
- `ImageBehaviourTests.Corrupted_pngs_only_ever_fail_with_InvalidDataException` used to count wrong-pixel decodes as success. It now requires any accepted input to equal the unmodified image.
- **Format parity matrix** (`TestPngs.cs`, `PngDecodeSafetyTests.Every_png_colour_type…`, 28 formats, each row a different real filter type, two IDAT chunks, a `tEXt` ancillary chunk, random padding bits):
  - 24 hashes were recorded from ImageSharp 3.1.12 in scratch (`r1/par`) and our output is byte-identical to them.
  - 4 deviate because 3.1.12 itself deviates from the PNG spec:
    - 16-bit tRNS (gray16-trns, rgb16-trns): 3.1.12 ignores the 16-bit key and returns alpha 255. Ours makes exactly the 35 key pixels transparent; the expected hash is the 3.1.12 colours with alpha 0 exactly where Hjg.Pngcs's raw samples equal the key.
    - Adam7 images under 8 px (rgba8-adam7-3x2, graya8-adam7-1x9): 3.1.12 misplaces or zeroes pixels. The expected hash equals both StbImageSharp 2.30.16 and the Hjg.Pngcs reader row by row (scratch `r1/spec`).
  - No agent input uses these forms.
- **Fixture parity:** `Every_real_fixture_decodes_to_the_same_bgra_bytes_as_before` gives the same 15 ImageSharp-recorded hashes. A scratch check found 0 differing bytes on all 15 fixtures against ImageSharp. `Every_real_fixture_reencodes_and_decodes_to_identical_bgra` re-encodes all 15 fixtures and checks chunk order, every CRC-32, an independent BCL inflate to the exact filtered size with a valid Adler-32, and a byte-identical round trip.
- **Performance, measured in scratch:**
  - full-1080p encode: 2242 ms (ImageSharp BestCompression 2384 ms);
  - full-frame `CropPng` with downscale steps: 5477 ms (old 5882 ms);
  - typical ROI crops: 5–13 ms;
  - full 1080p decode: 117 ms.

### Verification (fresh, code-final fbae89a; bin/obj deleted first; audit default, warnings as errors on; `DOTNET_ROOT`/`DOTNET_BIN` = scratch `dotnet-combo`, SDK 10.0.103 + Microsoft.NETCore.App 8.0.31)
RED at 9de2736: the new tests ran against the unchanged StbImageSharp codec, Release, normal audit.
```
Failed!  - Failed: 18, Passed: 39, Total: 57 - Uma.Agent.Core.Tests.dll (net8.0)
  Every_bit_flip_in_IHDR_IDAT_and_their_CRCs_is_refused; Corrupt_deflate_or_Adler32_…; Random_mutations_never_produce_wrong_pixels;
  Inflate_bomb_is_refused_…; Large_declared_image_with_tiny_payload_…;
  Malformed_structure_is_refused × 6 (IEND not last, trailing bytes, split IDAT, image data too long, zlib without Adler-32, palette index out of range);
  Every_png_colour_type… × 7 (gray16, graya16, rgb16, rgba16, rgb16-adam7: StbImageSharp truncates 16→8 instead of rounding; gray16-trns, rgb16-trns)
```
The two zlib-flip tests were refined after GREEN because of the measured Adler-32 collision. The refined tests are stricter, requiring every header and Adler-32 flip to be refused and only checksum-consistent streams to be tolerated.

GREEN:
```
$ bash .github/scripts/agent-gates.sh runtime        → exit 0 (10.0.103; Microsoft.NETCore.App 8.0.31)
$ bash .github/scripts/agent-gates.sh core-tests     → exit 0  Passed!  - Failed: 0, Passed: 394, Skipped: 0, Total: 394 - Uma.Agent.Core.Tests.dll (net8.0)
$ bash .github/scripts/agent-gates.sh windows-build  → exit 0  0 Warning(s) 0 Error(s)
$ dotnet test …/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release → exit 0  Passed: 230, Failed: 0
$ dotnet build …/Native/Uma.Agent.Windows.Tests.csproj -c Release -p:EnableWindowsTargeting=true → 0 Warning(s) 0 Error(s)
$ dotnet build Uma.Agent.sln -c Release -p:EnableWindowsTargeting=true → 0 Warning(s) 0 Error(s)
$ dotnet publish … -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableWindowsTargeting=true → exit 0
  Uma.Agent.Windows.exe 191,131,839 B
$ python3 …/Tools/bundle_probe.py <exe> . → exit 0, matches 15 of 15
  bundle byte counts: StbImageSharp 0, Hjg.Pngcs 0, SixLabors 0, libSkiaSharp 0, e_sqlite3.dll 6
$ dotnet list Core package --include-transitive → Microsoft.Data.Sqlite 10.0.3; transitive Microsoft.Data.Sqlite.Core 10.0.3, SQLitePCLRaw.* 2.1.11, System.Memory 4.5.3
$ dotnet list Windows package --vulnerable --include-transitive → SQLitePCLRaw.lib.e_sqlite3 2.1.11 High GHSA-2m69-gcr7-jv3q (T18)
$ MemoryProbe → exit 0: A +MB 9.2 (processed 1 skipped 239); B +MB 8.3; C after veteran 20 +MB 75.8, after Stop +MB 9.4; D +MB 672.0 (bound 664 MB)
$ EdgeProbe → exit 0: DRAIN bounded=8; oldDisposed=True; OCR tile cancellation propagated; ASSERTIONS passed
$ TOOLS_DIR=…/IR1/tools bash .github/tests/run.sh → exit 0, regression checks: 62 passed, 0 failed
$ node .github/scripts/check-config.mjs . → config check ok (structure)
$ git diff --check 3a157d5..HEAD → clean
```
Counts:
- Core 394 = 336 + 57 `PngDecodeSafetyTests` (28 format, 22 malformed and 7 other cases) + 1 fixture re-encode test.
- Portable 230 is unchanged.
- No existing assertion, fixture, label, threshold, master or golden file changed.
- Not run: the TS workspace (not touched); native Windows (H4).

### Still open
- H4: native execution.
- T18: SQLite advisory.
- T19: third-party licence packaging; a release blocker for `agent-v*`.
- Independent focused round-2 review and the parent's gate rerun (historical; round 2 requested the fixes below).

## Review round 2

Final worker fix round **2 of 2**, responding to the complete independent CHANGES_REQUESTED report at `/Users/willjose/Projects/personal/uma-musume-spark-calc/docs/reviews/T16b-review-2.md`, reviewer session `20261010_080715_e1d1fc` (inherited Opus, continued Sol). Implementation resumed directly in the same session `20261010_071731_eb8acb` on user-requested GPT-6.1 Sol medium via openai-codex; inherited Opus work and candidate `4d701d4e677280a9932c3e74bfe16691442487f5` are preserved. No delegation or model CLI was used.

Commits:
- `4b349f7`: retained RED tests and unrestricted stream-reader extraction seam;
- **`107ac9ca52013b21b3f5060bb5905a1eee6f738e`**: final code/test/package/licence-inventory candidate, freshly built and gated below;
- subsequent commit: changelog and runbook wording only, no codec/build-input change.

### B3 — file ingress bounds: fixed
`Frames.Load` opens exactly one FileStream, with read-ahead disabled (`bufferSize=1`), and obtains **that handle's** Length before encoded-buffer allocation. No FileInfo pre-check or second open. Initial over-limit length gives InvalidDataException, including a 3 GiB file. Actual reading is independently bounded to 256 MiB plus one single-byte EOF/growth probe; over-cap growth gives InvalidDataException. All paths dispose the file via using before decode, including failures.

Internal `Frames.ReadEncoded` is the small-limit deterministic test seam. It explicitly requires a seekable stream (the production FileStream is seekable), does not own it, loops on short reads, trims a shrinking input and accepts growth within the cap without truncation. Its initial unrestricted implementation was extracted for RED; the cap enforcement was added only afterwards. Tests exercise initial oversize without any reads, growing 2→33 and 32→33 at a cap of 32, short reads/shrink, nonseekable refusal without reads, zero-length input, growth to/exactly the cap and the final one-byte excess probe. Large sparse files run only in supervised scratch subprocesses.

The earlier PngCodec comment claiming file-size protection before reading was false at 4d701d4. It is accurate only after this actual open-handle/actual-read fix.

### B4 — actual zlib completion and trailer boundary: fixed
BCL ZLibStream remains the encoder at SmallestSize, **not the decode-completion validator**. Decode now uses SharpZipLib's public `Inflater(noHeader:false)` RFC1950 mode:
- existing CM/CINFO/FCHECK and no-dictionary policy remain;
- the caller supplies all concatenated IDAT bytes as one input;
- writes only the exact IHDR/Adam7 filtered length plus a one-byte excess probe;
- requires **IsFinished**, **RemainingInput==0**, and **TotalIn==IDAT payload length**;
- the public finished state is reached only after BFINAL and the Adler-32 at the actual consumed trailer have been verified. Read-ahead is accounted for by RemainingInput, not MemoryStream.Position;
- PNG policy: IDAT concatenation contains exactly one zlib stream. Junk, a second stream, incomplete final blocks, and missing/partial trailers are rejected with InvalidDataException.

Source inspection at the package's exact commit confirms `Decode` gates checksum processing on isLastBlock, `DecodeChksum` verifies all four trailer bytes before FINISHED, IsFinished also requires the output window drained, and RemainingInput includes unread bit-buffer bytes (`StreamManipulator.AvailableBytes`). The decoder is managed and owns no stream/native handle or IDisposable resource. Its fixed 32 KiB managed output window may decode ahead internally; the caller-visible output bound is expected+1, not a claim of zero internal buffering. Malformed Huffman tables exposed IndexOutOfRangeException in the first GREEN attempt; the retained mutation gates caught it, and known decoder format/index/state exceptions are now normalized to InvalidDataException at this boundary. No OOM/cancellation catch, private runtime API, reflection, PInvoke or handwritten Deflate engine was introduced.

`ChecksumConsistent` now uses a separate bounded test-side completion check through the public inflater API plus reference Adler calculation. It shares the compression dependency, so it is **not** claimed to be an independently implemented Deflate oracle. Its end validation is checked against explicit RFC1951 stored-block vectors with known raw pixels and BFINAL, and against the independent Python zlib probe below. The old BCL EOF assumption is removed. The retained failure vectors cover BFINAL=0, valid stream+junk+duplicate Adler, valid stream+second stream+duplicate Adler, and each 1–4-byte trailer truncation; the matching finished stored block must produce exact known BGRA. The legitimate Adler-collision explanation remains: checksums are not authenticity checks.

### Compression package assessment, pin and legal inventory
Selected **SharpZipLib 1.4.2**, not an image/PNG library. Exact package/source inspection preceded selection:
- NuGet version index: https://api.nuget.org/v3-flatcontainer/sharpziplib/index.json ; latest stable listed is 1.4.2.
- Downloaded package: https://api.nuget.org/v3-flatcontainer/sharpziplib/1.4.2/sharpziplib.1.4.2.nupkg
- SHA-256: `fe0895aa2930a2b1b65caa9f37db8bca35125ebdf9cc1b99d855f6afc5ff5946`.
- Nuspec licence **MIT**, repository commit `33f64eb0f28cdd2b084cb822fcc224c7c5aba553`.
- Framework assets net6.0/netstandard2.0/netstandard2.1; actual net8 restore chooses **lib/net6.0/ICSharpCode.SharpZipLib.dll**, with no added transitive dependencies. No build/buildTransitive targets, native/RID assets, install scripts or licence-key checks in the nupkg. Normal audited Release builds/publish below use no key.
- Public API/source: https://github.com/icsharpcode/SharpZipLib/blob/33f64eb0f28cdd2b084cb822fcc224c7c5aba553/src/ICSharpCode.SharpZipLib/Zip/Compression/Inflater.cs ; also inspected StreamManipulator, OutputWindow, InflaterDynHeader and InflaterHuffmanTree at v1.4.2. Tag/commit Inflater and LICENSE bytes were verified identical. Managed output window is fixed at 32768 bytes; dynamic header limits are 286 literal/length, 30 distance and 19 meta codes.
- Maintenance assessment: upstream is not archived; API reports latest release v1.4.2 on 2023-01-29 and last code push 2024-09-03. This is a mature, slow-release dependency, **not a claim of recent release activity**. It was chosen for stable public completion APIs and managed/net8 compatibility; future servicing remains necessary.
- Actual GHSA query https://api.github.com/advisories?ecosystem=nuget&affects=SharpZipLib%401.4.2 returned `[]`. Fresh NuGet all-transitive audit for Core and Windows reports only the existing SQLite advisory, not SharpZipLib. No claim that absence of advisories proves bug absence.
- Alternatives assessed for this boundary: BCL ZLibStream has no reliable public completion/remaining-input API and accepts the reproduced invalid ends; pinned Hjg.Pngcs reader ignores Adler and does not expose the needed strict boundary. SharpZipLib meets this narrow compression requirement; no claim that all compression packages were searched.

Minimal declared cross-task legal-inventory addition: `agent/legal/SharpZipLib-1.4.2-LICENSE.txt` is a verbatim copy from https://github.com/icsharpcode/SharpZipLib/blob/33f64eb0f28cdd2b084cb822fcc224c7c5aba553/LICENSE.txt (SHA-256 `d7fbbc16f871bf24fa5624c7eaf945054b778985f32676dcacba41fddca61133`); `agent/legal/README.md` records the package, pin/source and **T19 recipient-delivery obligation**. No workflow/publishing change. This copy in the source repository does not automatically ship with the EXE. No agent-v release until T19 includes SharpZipLib's copyright/permission text and the other bundled components' notices. The historical round-1 “no new third-party component” statement no longer applies to this candidate.

### S5 — allocation amplification: fixed
Chunk type checks now read the four-byte span as a uint, without allocating ASCII strings. Constant metadata records only the contiguous IDAT start/end and total payload bytes; a second pass copies validated IDAT bodies. No per-chunk List, including for empty IDATs; no arbitrary chunk-count cap. Ordinary valid unknown ancillary chunks remain accepted.

Retained deterministic regressions decode 100,000 empty IDAT or private ancillary chunks and require decoder allocation below 200,000 bytes (input constructed before measurement). Supervised repro of the reviewer's actual 240,000,070-byte/20-million-empty-chunk files gives **46,096 bytes decoder allocation in both cases**, not 610/1122 MiB cumulative allocation. Peak process RSS remains about 280 MB because the harness already holds the 240 MB encoded input. These are distinct measurements: cumulative GC allocation is not live RSS.

Residual memory bounds are not zero: Decode retains the encoded input E (≤256 MiB), makes one concatenated payload copy Z≤E, one exact filtered buffer F computed from dimensions/depth/Adam7, and BGRA P=4×pixels, plus fixed inflater window/Huffman state and bounded palette/transparency. F is conservatively ≤8×MaxPixels+7×MaxDimension; P≤4×MaxPixels. The ingress reader ordinarily allocates the observed file length once; growth/shrink can temporarily retain bounded old/new arrays during resizing, each ≤the encoded cap. Managed GC reclamation is not immediate disposal. BCL encoding still owns its native compression state and temporary row/MemoryStream arrays and releases stream handles through using. Adversarial compression block counts may add cumulative temporary Huffman-table allocations; no zero-allocation claim is made for arbitrary Deflate data.

### S6 / S7 / N5
- **S6 fixed:** indexed PLTE entries must be ≤1<<bit depth in addition to the existing ≤256/nonempty/multiple-of-three checks. The existing index-range check is unchanged. Retained 1-bit/three-entry palette regression is RED before the fix and GREEN after it; all valid palette cases in the 28-format matrix remain green.
- **S7 fixed:** both historical broad package-absence statements are now scoped to the explicitly enumerated evaluated alternatives; the compression selection above is independently enumerated. No exhaustive universal claim.
- **N5 fixed:** renamed to `Large_declared_image_with_tiny_payload_is_refused_before_pixel_storage_allocation`. Comment now describes the pre-allocation ratio guard accurately and a retained GC allocation assertion requires <100,000 bytes. It does not claim an up-front filtered allocation in this refusal case.

### Verification — exact code candidate 107ac9ca52013b21b3f5060bb5905a1eee6f738e
All execution is local, SDK **10.0.103**, native **Microsoft.NETCore.App 8.0.31** inspected before tests; process-scoped DOTNET_ROOT/DOTNET_BIN point to `/Users/willjose/.hermes/cache/scratch/T16b/dotnet-combo`. Audit/warnings-as-errors unchanged. No --no-build/stale test use. Only gitignored agent bin/obj directories were removed before the full gate run. Evidence and command manifest: `/Users/willjose/.hermes/cache/scratch/T16b/r2/evidence/`; RED in `../red.txt`.

Strict TDD against inherited 4d701d4 codec, prior to production fixes, with only unrestricted stream-reader extraction for the small-limit seam:
```
$ D test agent/tests/Uma.Agent.Core.Tests -c Release --filter FullyQualifiedName~PngIngressEndTests
Failed! - Failed: 10, Passed: 6, Skipped: 0, Total: 16
  initial oversize; two growth cases; nonseekable helper; BFINAL=0;
  junk+duplicate Adler; second stream+duplicate Adler; two empty-chunk allocation cases; indexed palette depth
```
Committed RED at 4b349f7. The first combined targeted GREEN attempt found two untyped malformed-Huffman failures in existing retained mutation tests; after boundary exception normalization, it passed 74/74. Four additional positive ingress cases were subsequently retained; the final full suite below covers all 20 new cases plus the existing 394.

Fresh full command outputs (D=the inspected scoped dotnet):
```
$ bash .github/scripts/agent-gates.sh runtime -> exit 0 (SDK 10.0.103; Microsoft.NETCore.App 8.0.31 present)
$ bash .github/scripts/agent-gates.sh core-tests -> exit 0
Passed! - Failed: 0, Passed: 414, Skipped: 0, Total: 414, Duration: 45 s
$ bash .github/scripts/agent-gates.sh windows-build -> exit 0; 0 Warning(s), 0 Error(s)
$ D test agent/tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release -> exit 0
Passed! - Failed: 0, Passed: 230, Skipped: 0, Total: 230, Duration: 7 s
$ D build agent/tests/Uma.Agent.Windows.Tests/Native/Uma.Agent.Windows.Tests.csproj -c Release -p:EnableWindowsTargeting=true -> exit 0; 0 Warning(s), 0 Error(s)
$ D build agent/Uma.Agent.sln -c Release -p:EnableWindowsTargeting=true -> exit 0; 0 Warning(s), 0 Error(s)
$ D publish agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableWindowsTargeting=true -o /Users/willjose/.hermes/cache/scratch/T16b/r2/publish -> exit 0
Uma.Agent.Windows.exe 191391501 bytes
$ python3 agent/tests/Uma.Agent.Windows.Tests/Tools/bundle_probe.py <that EXE> . -> exit 0
bundle 6 0 entries 474; matches 15 of 15
Exact parsed entries: ICSharpCode.SharpZipLib.dll 258048 bytes (managed), e_sqlite3.dll 1795072 bytes (native).
ImageSharp/StbImageSharp/Hjg.Pngcs entries: absent.
Native manifest entries: D3DCompiler_47_cor3.dll, PenImc_cor3.dll, PresentationNative_cor3.dll, vcruntime140_cor3.dll, wpfgfx_cor3.dll (WPF runtime), e_sqlite3.dll. No added image/compression native binary.
$ TOOLS_DIR=/Users/willjose/.hermes/cache/scratch/IR1/tools bash .github/tests/run.sh -> exit 0
regression checks: 62 passed, 0 failed
$ node .github/scripts/check-config.mjs . -> exit 0
config check ok (structure): MASTER_VERSION=global-20260930
$ D build agent/tests/Uma.Agent.Windows.Tests/Tools/MemoryProbe -c Release -> exit 0, 0 Warning(s), 0 Error(s)
$ D build agent/tests/Uma.Agent.Windows.Tests/Tools/EdgeProbe -c Release -> exit 0, 0 Warning(s), 0 Error(s)
$ D <fresh MemoryProbe.dll> <worktree> -> exit 0
idle 240 polls: processed 1 skipped 239, +MB 9.2; changing still view +MB 8.3;
after Stop zero retained sessions/frames, +MB 9.4; worst 80 frames +MB 672.0 (664 MB frame bound)
$ D <fresh EdgeProbe.dll> <worktree> -> exit 0
DRAIN bounded=8; oldDisposed=True; newestAlive=True; OCR tile cancellation propagated; calls=2; ASSERTIONS passed
$ D list agent/src/Uma.Agent.Core/Uma.Agent.Core.csproj package --include-transitive -> exit 0
$ D list agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj package --include-transitive -> exit 0
Core direct: Microsoft.Data.Sqlite 10.0.3, SharpZipLib 1.4.2; Windows transitive SharpZipLib 1.4.2.
No added compression transitive dependency. Actual net8 compile/runtime asset: lib/net6.0/ICSharpCode.SharpZipLib.dll.
$ D list <each same project> package --vulnerable --include-transitive -> each exit 0
SQLitePCLRaw.lib.e_sqlite3 2.1.11 High https://github.com/advisories/GHSA-2m69-gcr7-jv3q (unchanged; T18)
```

Supervised subprocesses, rebuilt exact current Core via project reference; 750 MiB sampled RSS kill ceiling, 120 s deadline, process-group kill on exceedance. RSS includes harness/runtime/input storage; every listed child exited 0 without a kill. Command: `python3 /Users/willjose/.hermes/cache/scratch/T16b/r2/probes.py` (full output `evidence/probes.txt`).
```
sparse300M.png -> InvalidDataException before input allocation; allocated 20544 bytes; 7 ms; max RSS 37208064 bytes
sparse3G.png   -> InvalidDataException before input allocation; allocated 20536 bytes; 5 ms; max RSS 37273600 bytes
zeroidat_20M.png -> OK 1x1; decoderAllocated 46096 bytes; 305 ms; max RSS 279625728 bytes
zeroanc_20M.png  -> OK 1x1; decoderAllocated 46096 bytes; 242 ms; max RSS 279724032 bytes
nofinal.png -> InvalidDataException: unfinished zlib stream; max RSS 38010880 bytes
junk_duplicate_adler.png -> InvalidDataException: data after the single zlib stream; max RSS 38158336 bytes
second_stream_duplicate_adler.png -> same typed refusal; max RSS 38174720 bytes
Independent Python zlib.decompressobj on the original reviewer files:
nofinal: output 18, eof False, unused 0
junk_duplicate_adler: output 18, eof True, unused 8
second_stream_duplicate_adler: output 18, eof True, unused 15
```

All 28 format cases, 15 saved fixture hashes/roundtrips, parser/classification/dHash/art identities, crop-size/geometry and OCR expectations remain unmodified and gate GREEN. Encoder/conversions/calibrated resampler and thresholds were not changed. TS workspace not run because no TS/integration/schema/master/golden/database paths were touched. Original Opus measurements remain labelled inherited; no new universal resampler-parity claim is made.

### Remaining gates and ownership
- Parent fresh independent rerun and **same-reviewer focused review 3 before merge**. No self-approval/merge/push/deployment.
- This exhausts the two authorized worker fix rounds. Subsequent blocking findings require coordinator takeover/escalation, not a third worker loop.
- H4 native Windows execution/WGC/OCR/x64 parity and live imports remain human acceptance. Native cross-build and self-contained publish are compilation/packaging evidence only.
- T18 owns unchanged SQLite transitive advisory. No audit suppression or scope creep.
- T19 owns recipient licence/notice delivery, now including the SharpZipLib inventory. It still blocks every agent-v release.

## Review round 3 — independent approval and coordinator disposition

Same independent reviewer `20261010_080715_e1d1fc` returned **PASS** on exact candidate `2d9471c0ac8fa413cfc2cbebd87e592fdf259669` (code `107ac9c`, subsequent changes documentation only). Reviewer provenance Opus→Sol→Opus is preserved: Sol's r3 provider refusal was not a verdict; user explicitly approved Opus continuation. Full reports are coordinator-saved `docs/reviews/T16b-review-{1,2,3}.md`. All B1–B4 blockers and S5–S7/N5 are resolved. Two worker fix rounds were used; no third worker fix round.

Fresh independent r3 verification: audited Release Core414/Portable230, Windows/Native/solution cross-build 0 warnings/errors, win-x64 self-contained publish and bundle15/15, regression62, package/license/source checks, mutation/format/parity and bounded input/stream-end reproductions. Exact commands and real output are in the full r3 report. Coordinator independently reran the same broad gates on `2d9471c` plus seven supervised resource/end probes: all succeeded; sparse300MiB/3GiB inputs refused before input allocation (~37MB RSS), empty-chunk cases allocated46096 decoder bytes, invalid final-block/trailing-stream cases refused. No native Windows execution, deployment or game-mechanics acceptance implied.

### Accepted nonblocking follow-ups
- **S8 — dependency conformance limitation:** SharpZipLib1.4.2 accepts a checksummed Deflate distance referencing before output start, yielding defined zeros rather than an RFC1951 refusal. Reviewer classified it low severity, bounded and nonblocking; no ordinary-corruption regression was demonstrated and an equivalent valid stream can produce the same pixels. This is **not** a universally strict RFC1951 validator; `ChecksumConsistent` shares the limitation. Coordinator defers stricter invalid-distance rejection to a separately scoped codec-conformance follow-up, not a third worker loop or handwritten Deflate engine. Retain reviewer repro `T16b-review3/vec/dist_too_far.png` as an anchor when scoping that work.
- **N6:** internal `ReadEncoded(null, …)` currently yields NullReferenceException; public Load's null behavior remains ArgumentNullException. Internal null-argument consistency is deferred with the codec follow-up; no post-approval executable edit.
- **N7:** upstream SharpZipLib license text says2000–2018 while nuspec copyright says2000–2022. The verbatim verified upstream license is retained; T19 should cite both metadata lines when preparing recipient notices.
- T18 still owns the inherited SQLite advisory; T19 remains a recipient-license release blocker; H4 native/live acceptance remains.
