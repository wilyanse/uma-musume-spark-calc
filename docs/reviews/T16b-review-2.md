↻ Resumed session 20261010_080715_e1d1fc "Review T16b image library migration candidate" (3 user messages, 200 total messages)
## Verdict: CHANGES_REQUESTED

Reviewed 4d701d4e677280a9932c3e74bfe16691442487f5 against previously reviewed 3a157d5be8ef7785ef9cab211d346cbf52ae0693, retaining the original base 55d1aac17e9be32f84ada4c522b597b6ef2b1e72.

This is the same round-2 review, continued on GPT-6.1 Sol at the user’s request. The earlier Opus work is retained and identified below; the model switch was deliberate, not a provider failure.

The replacement fixes the demonstrated StbImageSharp CRC failures, native leaks and inflate bombs. Valid-format coverage is substantially stronger, and the audited gates pass. Two remaining defects prevent approval:

- Frames.Load reads and allocates an oversized file before enforcing the encoded-input limit.
- Inflate does not prove that the zlib stream reached a valid end. A checksummed PNG containing an unfinished Deflate stream is accepted.

No implementation changes were made. The worktree remains clean on task/T16b-image-library-migration at the exact candidate SHA.

## Blocking

- [B3] agent/src/Uma.Agent.Core/Frames.cs:27; agent/src/Uma.Agent.Core/PngCodec.cs:33,53 — High: encoded-size protection is applied after unrestricted file reading.

  Frames.Load calls File.ReadAllBytes before PngCodec.Decode checks MaxEncodedBytes. The comment “file size checked before it is read” is false.

  Fresh Sol reproduction, using a sparse file in a supervised scratch subprocess:

      python3 run.py loadfile gen/sparse_300M.png
      loadfile ... -> InvalidDataException:
        PNG image of 314572800 bytes exceeds the 268435456 byte decode limit
      maximum resident set size: 356843520 bytes

  The eventual refusal is typed, but only after allocating and reading the entire 300 MiB file. It is not a pre-read resource guard.

  A separate sparse 3 GiB input produced:

      IOException: The file is too long. This operation is currently limited
      to supporting files less than 2 gigabytes in size.

  That is also outside the documented over-limit InvalidDataException behavior.

  This path is used by --record-ocr inputs, not just private test helpers. It leaves the resource-bound portion of the migration incomplete despite the bounded Decode(byte[]) implementation.

  Required fix:
  - Open the file once and enforce the limit against that open handle before allocating the encoded buffer.
  - Bound the actual read independently of the initial length, including a file growing during the read. A separate FileInfo check is not sufficient.
  - Refuse over-limit encoded input with InvalidDataException and dispose the handle on every path.
  - Add regressions for initial oversize and growth during reading. Keep large sparse-file/resource probes in supervised subprocesses.
  - Correct the comment and the corresponding boundedness claims.

- [B4] agent/src/Uma.Agent.Core/PngCodec.cs:179-200; agent/tests/Uma.Agent.Core.Tests/PngDecodeSafetyTests.cs:131-143 — Medium: expected output length plus the last four bytes is not proof of valid zlib termination.

  Inflate accepts ZLibStream returning zero and then compares the final four IDAT bytes with Adler32(raw). ZLibStream can return the requested pixels and then report no more output even though the compressed stream never reached its final block/trailer.

  Fresh Sol reproduction was generated independently in Python, without TestPngs or PngCodec:
  - 2×2 RGBA PNG.
  - Valid PNG chunk CRCs.
  - Valid zlib header.
  - A stored Deflate block with BFINAL=0.
  - Exactly 18 expected filtered bytes.
  - The matching Adler-32 appended after that unfinished block.

      python3 sol/png_end_probe.py
      nofinal python output 18 eof False unused 0

      python3 h2/run.py decodefile sol/nofinal.png
      decode nofinal.png 86B -> OK 2x2

  Python’s inflater confirms that the stream has not reached EOF. The candidate nevertheless returns a frame. This is an unfinished stream, not the legitimate Adler collision discussed in the changelog.

  Additional fresh probes show the boundary check is not tied to the trailer actually consumed:

      valid stream + "junk" + duplicate matching Adler:
        Python eof True, unused 8 bytes; candidate OK 2x2

      valid stream + second zlib stream + duplicate matching Adler:
        Python eof True, unused 15 bytes; candidate OK 2x2

  ImageSharp 3.1.12 also accepted these three diagnostic files. Therefore this is not a newly demonstrated pixel-parity regression against ImageSharp. It is a correctness gap in the newly promised validating decoder and malformed-input refusal behavior.

  Required fix:
  - Validate actual compressed-stream completion and the actual trailer boundary, rather than treating “no more decoded output” and “last four bytes match” as equivalent.
  - Use an approach that exposes reliable end-of-stream/consumed-input information. MemoryStream.Position alone is not proof because inflater buffering can consume ahead.
  - Define and test the policy for non-stream data remaining in concatenated IDAT payloads.
  - Add the tiny BFINAL=0 regression with valid chunk CRCs and matching apparent Adler.
  - Strengthen ChecksumConsistent accordingly; it currently shares the same BCL EOF assumption and final-four-byte check.
  - Do not introduce a handwritten Deflate engine merely to patch this boundary check.

## Should fix

- [S5] agent/src/Uma.Agent.Core/PngCodec.cs:59,74,104,173-175 — Medium: chunk-count-dependent allocations are much larger than the image requires.

  Fresh Sol supervised probes reused the Opus-generated inputs:

      zeroidat_20M.png: 240000070 bytes, 1×1 image
        accepted
        decoderAllocated 1122 MiB
        maximum RSS 554811392 bytes

      zeroanc_20M.png: 240000070 bytes, 1×1 image
        accepted
        decoderAllocated 610 MiB
        maximum RSS 290291712 bytes

  The IDAT list retains an entry for every empty chunk and grows repeatedly. Every chunk also allocates a string for its type.

  Important distinction: 1122 MiB is cumulative managed allocation, not a measured 1.1 GiB live working set. These inputs are below the encoded cap, and this probe did not establish unbounded inflation or a GiB-sized retained image buffer. I am not presenting it as a recurrence of the old Stb bomb.

  Suggested fix:
  - Compare chunk types without allocating a string per chunk.
  - Do not retain an offset/length entry for each zero-length IDAT.
  - Prefer bounded metadata or a second pass over the already validated buffer; alternatively document and enforce a conservative chunk-count limit with a typed refusal.
  - Add a subprocess allocation regression so this remains visible.

- [S6] agent/src/Uma.Agent.Core/PngCodec.cs:85-89 — Low: indexed PLTE length is checked against 256 entries, but not against the image’s bit depth.

  Fresh probe plte_pal1_too_many supplies a 1-bit indexed image with three palette entries. It is accepted. PNG specifies that the palette entry count must not exceed the range representable by the image bit depth.

  Require palette.Length / 3 <= 1 << header.Depth for indexed colour and retain the existing index-range check. This case produced correct pixels for the indices actually used; no wrong-pixel exploit was demonstrated.

- [S7] docs/changelog/T16b-image-library-migration.md:270-273 — Low: qualify the package-search conclusion.

  The inspection justifies rejecting the pinned Pngcs implementation. It does not prove that no maintained managed package satisfying the requirements exists anywhere.

  Say “none of the evaluated alternatives met these requirements” and identify the evaluated set. The BCL-based design can be defended without an exhaustive absence claim.

## Nits

- [N5] agent/tests/Uma.Agent.Core.Tests/PngDecodeSafetyTests.cs:310-316 — the test name says the decoder “allocates only what it reads,” but it does not measure allocation. Its comment also describes the filtered buffer as allocated up front, while this particular input is rejected by the pre-allocation expansion-ratio guard.

  Rename it to describe tiny-payload refusal and add an allocation assertion if allocation behavior is intended to be a retained acceptance criterion.

- No finding for treating an unknown ancillary chunk with a lowercase reserved third letter as unknown. The PNG specification expressly advises decoders not to flag that reserved bit alone as an error, for forward compatibility.

## Prior finding dispositions

- B1 — Original defect resolved; validating-decoder acceptance remains incomplete under B4.

  The original unmodified-CRC mutation sweep now refuses all 3000 cases, with zero wrong successful decodes. Bad IHDR CRC is refused. The new retained tests no longer count merely consistent byte length as successful corruption handling.

  The Adler-collision exception is justified. Fresh Sol execution of the worker-supplied collision file returned 263 differing BGRA bytes against the original in both the candidate and ImageSharp 3.1.12. Earlier Opus verification also found valid chunk CRCs, successful Python zlib decoding and acceptance by the independent native PNG loader. This is checksum-consistent changed content, not proof that ordinary corruption is accepted.

  Checksums are not authenticity checks. No original-pixel oracle should be invented for production.

- B2 — Original Stb native leak and unbounded-inflate defects resolved; file-ingress bounds remain incomplete under B3.

  StbImageSharp is removed. The 256 MiB, 1 GiB and 2 GiB inflate bombs now fail after producing only the declared image plus the one-byte excess probe. The old leak2 structure fails before inflation, without the repeated approximately 32 MiB native leak.

- S1 — Corrected and explicitly deferred as a release blocker.

  Both added third-party image packages are removed, so their package-specific licence election/delivery is no longer required by this candidate. The pre-existing recipient licence/NOTICE delivery gap remains.

  I read the coordinator’s T19 task card and confirmed the candidate runbook explicitly prohibits an agent-v* release until the licence packaging task lands. Licence delivery is not an optional aesthetic About screen. This review authorizes neither distribution nor release.

- S2 — Compression implementation fixed; measured crop contract holds.

  The encoder uses BCL SmallestSize and adaptive filters. Inherited Opus’s independent 600-crop comparison completed with 600 equal-dimension crops, no reported pixel differences, no over-limit PNGs and maximum length 61,386 bytes.

  Worker measurements report 645/645 equal-dimension layout crops and 0–1 additional reduction step per 600 random crops. Those exact worker samples remain inherited, not fresh Sol measurements.

- S3 — Deferred visibly to T18, not fixed here.

  Fresh Sol all-transitive vulnerability inspection still reports SQLitePCLRaw.lib.e_sqlite3 2.1.11, High, GHSA-2m69-gcr7-jv3q. The coordinator has an explicit separate remediation task. No SQLite change is demanded inside T16b and no blanket security-clean claim is made.

- S4 — Unsafe auto-ported image decoder removed.

  No StbImageSharp or Hjg.Pngcs reference remains in the current Core graph or inspected publish. The first-party PNG code is bounds-checked managed code; the compression engine is the serviced BCL runtime implementation. B3/B4/S5 demonstrate that dependency removal does not itself prove security.

- N1 — Corrected for pixel-storage accounting.

  The managed allocation counter now covers decoder pixel arrays. It still does not measure BCL native inflater state; the updated comments acknowledge that distinction.

- N2 — Resolved.

  PngWriter is gone. Encode disposes ZLibStream and both MemoryStreams through using scopes, including exceptional unwinding. Decode likewise disposes its streams.

- N3 — Provenance wording corrected; limited parity claim accepted.

  The comment explicitly says conventions are mirrored from ImageSharp and are not independently derived. The Keys kernel is mathematical; the implementation uses its own simpler kernel storage and bounded row ring.

  The worker’s nine ±1-byte differences in two non-layout crop cases are documented rather than hidden. Inherited Opus’s rerun of the supplied minimal source matched its independently executed ImageSharp replica, while both differed by one byte from the worker’s saved ImageSharp output. That does not independently reproduce the worker’s exact numerical delta.

  Fresh Sol’s broader resampler comparison below was exact for its tested inputs. I do not conclude universal byte identity or native-x64 identity from that.

- N4 — Resolved.

  StbImageSharp’s global failure-reason state is removed. The replacement has no equivalent shared mutable per-decode state.

## Checklist

1. Spec conformance — issues B3/B4; other scoped requirements demonstrated or explicitly bounded.

   - User-authorized key-free replacement: achieved without licence acquisition, licensing bypass or audit suppression.
   - ImageSharp runtime/test package references: removed.
   - Targets: net8.0 Core/Portable and existing Windows target preserved.
   - BGRA: valid-format comparisons preserve straight channels, alpha, colour under transparency and top-down placement.
   - Reference/refusal behavior: below-1080p and non-16:9 guards preserved.
   - Fixture/parser/art identities: existing expected values, labels and thresholds unchanged; Core tests pass.
   - Crop/OCR behavior: rounding, scale==1 and maximum-dimension behavior retained; fresh Portable tests pass.
   - Crop PNG contract: true dimensions and decoded pixels confirmed; tested outputs stay at or below 61,440 bytes.
   - Disposal/stationary capture/cancellation: inspected using scopes and inherited independent MemoryProbe/EdgeProbe evidence.
   - Resource/integrity acceptance: not complete because of B3/B4.
   - H4: native Windows execution remains outstanding.

2. Correctness — issues B3/B4; valid-image implementation otherwise supported by independent comparisons.

   The unfilter operations, Paeth tie-breaking, sub-byte sample extraction, 16-bit reduction, transparency comparison before reduction and Adam7 placement were reviewed.

   Fresh comparison against Sharp/libvips’s independent native PNG loader matched all 28 formats, including the four documented ImageSharp deviations. Fresh tiny Adam7 probes also produced the expected 1×1 and narrow-row pixels.

   Chunk-length arithmetic rejects out-of-range lengths before span construction. Unsupported component combinations and tested malformed structures produce InvalidDataException.

   Resampler source review found the ring-row reuse valid for the consecutive vertical taps, normalized kernels and checked output arithmetic. Fresh comparisons covered one-pixel/narrow/extreme-aspect inputs and opaque/random/tiny/binary alpha.

3. Test quality — materially improved; gaps B3/B4 and N5.

   The original hashes derive from the old library rather than the replacement. Old fixture/helper changes preserve their assertions.

   The 28-format generator is not accepted as its own oracle: the independent native PNG decode comparison matched its outputs. The corruption tests now check pixels/checksum consistency, not only byte length.

   The BCL-based ChecksumConsistent helper is independent of PngCodec’s CRC implementation but shares its termination blind spot. Missing tests for oversized file ingress, actual stream completion and chunk amplification explain why green gates did not expose these findings.

   The two-second bomb-test limit has substantial headroom in measured runs; no timing-test change is required by this review.

4. Fabrication check — no invented game facts or hard-coded fixture answers found.

   Gate counts and packaging claims align with observed results. Two claims need correction:
   - encoded file size is checked before reading;
   - every successful decode has a fully validated zlib stream.

   The package absence claim should also be qualified under S7. macOS parity is not native Windows evidence.

5. Security — issues B3/B4; S5 and separately tracked T18/T19 remain visible.

   No credential/config change, suppression or weakened warnings-as-errors setting was made. No new image-package advisory surface remains.

   The self-contained runtime’s compression implementation still requires runtime servicing and republishing. Removal of vulnerable ImageSharp dependencies is not equivalent to all-transitive security clearance.

6. Free-tier constraints — unchanged.

   No service, paid product or cloud tier was added. The tested crop size contract remains intact. Cloudflare request/CPU/database acceptance is outside this scoped migration and was not inferred from local tests.

7. Scope — conformant.

   The exact fix diff is confined to the codec, provenance comment, Core package removal, relevant tests and declared narrow documentation errata.

   Base-to-candidate inspection found no changes to schema, API, engine, web, master, golden, screenshots, OCR fixtures, layouts, parser thresholds, CI/workflows, Directory.Build.props or global.json.

   No tracked edit, commit, merge, push or deployment was performed by the reviewer.

8. Maintainability — first-party deviation reviewed, conditionally reasonable after the blocking fixes.

   The approximately 414-line PNG layer is a substantial expansion, not a trivial dependency swap. It makes this project responsible for PNG framing, filtering and sample conversion.

   Rejecting the pinned Pngcs reader is supported by source inspection: Adler is explicitly not checked, its byte limit counts compressed input, and its public rows expose raw samples requiring conversion.

   Using BCL Deflate rather than writing a compression engine is a sound boundary. The format matrix and corruption coverage make this a defensible documented deviation from spec 64’s dependency preference, not an automatic violation solely because it is first-party code.

   However, the new boundary bugs show why this deviation needs complete validation and retained regressions. B3/B4 must be fixed before approval.

## Commands run

Evidence labels:
- Fresh Sol: executed after the user-requested continuation.
- Inherited Opus: independently executed earlier in this same round-2 reviewer session.
- Worker/parent: supplied evidence, not independent reviewer execution.
- Diagnostic old-library comparison: scratch ImageSharp 3.1.12 oracle, not audited migration gate evidence.

Paths below use:
- W = /Users/willjose/Projects/personal/uma-musume-spark-calc.worktrees/T16b-image-library-migration
- R = /Users/willjose/.hermes/cache/scratch/T16b-review2
- D = /Users/willjose/.hermes/cache/scratch/T16b/dotnet-combo/dotnet

Fresh Sol audited gates, process-scoped DOTNET_ROOT/DOTNET_BIN:

    bash .github/scripts/agent-gates.sh runtime
      exit 0
      SDK 10.0.103
      Microsoft.NETCore.App 8.0.31 present

    bash .github/scripts/agent-gates.sh core-tests
      exit 0
      Failed: 0, Passed: 394, Skipped: 0, Total: 394
      Duration: 43 s

    bash .github/scripts/agent-gates.sh windows-build
      exit 0
      0 Warning(s), 0 Error(s)

    D test agent/tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release
      exit 0
      Failed: 0, Passed: 230, Skipped: 0, Total: 230
      Duration: 7 s

    D build agent/tests/Uma.Agent.Windows.Tests/Native/Uma.Agent.Windows.Tests.csproj -c Release -p:EnableWindowsTargeting=true
      exit 0
      0 Warning(s), 0 Error(s)

    D build agent/Uma.Agent.sln -c Release -p:EnableWindowsTargeting=true
      exit 0
      0 Warning(s), 0 Error(s)

These invoked restore/build/test normally; no --no-build or audit-disable flag was used. Sol reused the same-candidate outputs previously clean-built by Opus rather than claiming a second deleted-bin/obj run.

Fresh Sol package and regression checks:

    D list agent/src/Uma.Agent.Core/Uma.Agent.Core.csproj package --include-transitive
      Microsoft.Data.Sqlite 10.0.3
      Microsoft.Data.Sqlite.Core 10.0.3
      SQLitePCLRaw.* 2.1.11
      System.Memory 4.5.3
      No ImageSharp, StbImageSharp or Hjg.Pngcs

    D list agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj package --vulnerable --include-transitive
      SQLitePCLRaw.lib.e_sqlite3 2.1.11
      High https://github.com/advisories/GHSA-2m69-gcr7-jv3q

    TOOLS_DIR=.../IR1/tools bash .github/tests/run.sh
      exit 0
      regression checks: 62 passed, 0 failed

    node .github/scripts/check-config.mjs .
      config check ok (structure): MASTER_VERSION=global-20260930

Inherited Opus audited publish, freshly inspected by Sol:

    D publish ...Uma.Agent.Windows.csproj -c Release -r win-x64 --self-contained true
      -p:PublishSingleFile=true
      -p:IncludeNativeLibrariesForSelfExtract=true
      -p:EnableWindowsTargeting=true
      -o R/publish
      exit 0

    python3 agent/tests/Uma.Agent.Windows.Tests/Tools/bundle_probe.py R/publish/Uma.Agent.Windows.exe .
      bundle 6; entries 473
      matches 15 of 15
      Core/Windows assemblies and e_sqlite3.dll present

    Independent byte inspection:
      EXE size 191131839 bytes
      StbImageSharp: 0
      Hjg.Pngcs: 0
      SixLabors: 0
      libSkiaSharp: 0
      e_sqlite3.dll: 6 occurrences
      Identical to parent-fix1 publish: True

The fresh Core DLL and the scratch safety harness’s candidate DLL had identical SHA-256:

    960ad7dab44e1d8fb69f246d6dcf49f320a6081756dea39ec5a1d37f89ae90af

Fresh Sol valid-image/parity execution using inherited scratch harnesses:

    node fmt/cmp.mjs out
      Sharp 0.35.5, libvips 8.18.7
      identical 28 diff 0

    node fmt/cmp.mjs enc
      independent native decode of 90 candidate crop PNGs:
      identical 90 diff 0

    D par.dll corrupt <fixture13>
      single bit flip inside IDAT payload x3000:
      new ok-identical 0
      new ok-WRONG-pixels 0
      new refused 3000
      ImageSharp3.1.12 ok 0, refused 3000

    D par.dll resample <screenshots>
      resample cases 165x4 kinds
      total bytes 61823728
      opaque: diffbytes 0
      randalpha: diffbytes 0
      tinyalpha: diffbytes 0
      binalpha: diffbytes 0
      fixture resamples 120, with diffs 0

    D par.dll decode
      rgba8/rgba16/rgb8/gray8/gray1/graya8/pal8/rgba8-adam7:
      diffbytes 0
      new encode -> ImageSharp decode diff 0
      PNG colour type 6, depth 8, interlace 0
      1x1 roundtrip 4 bytes

    D par.dll adler <worker collision PNG> <original BGRA>
      ours OK 101x134 diff-vs-source 263
      ImageSharp OK diff-vs-source 263

The old-library comparisons are diagnostic oracle executions, not evidence that the old vulnerable dependency passes normal audited Release. The original old characterization used NuGetAudit=false; that historical diagnostic evidence remains labelled as such.

Fresh Sol hostile probes, separate supervised subprocesses:

    python3 h2/run.py bomb1x1_256M bomb1x1_1G bomb1x1_2G leak2

      256M -> InvalidDataException: longer than the header declares
        maximum RSS 46743552 bytes

      1G -> InvalidDataException: longer than the header declares
        maximum RSS 51101696 bytes

      2G -> InvalidDataException: longer than the header declares
        maximum RSS 61603840 bytes

      leak2 x20 -> InvalidDataException: truncated chunk
        managed 128 MiB; working set 136 MiB
        maximum RSS 174948352 bytes

    Other fresh malformed probes:
      duplicate IHDR, wrong IHDR length, truncated/short/excess image data,
      huge/overflow-like chunk lengths, missing palette, bad colour type,
      unsupported compression/interlace, oversized dimension, nonletter
      chunk type, 257-entry palette, invalid/misplaced transparency,
      missing IEND:
        InvalidDataException

    maxrgba16_full:
      OK 7680x4320
      decoderAllocated 379 MiB
      maximum RSS 442286080 bytes

    maxrgba16_short:
      InvalidDataException before image-sized allocation
      decoderAllocated 0 MiB reported

    Tiny Adam7:
      1x1 RGBA -> BGRA [7,8,9,6]
      1x1 gray1 -> [255,255,255,255]
      9x1 gray2 -> expected unpacked pass-placement values

B3/B4/S5 reproductions and their real output are included in the findings above. Scratch B4 generator:

    R/sol/png_end_probe.py

Inherited Opus independent results, not relabelled fresh Sol:
- All 15 fixture BGRA hashes matched the independent native PNG loader.
- Python CRC/zlib inspection of 90 encoded crops: zero bad CRCs, correct filtered geometry, maximum 61,095 bytes.
- Independent 600-crop old/new comparison: same dimensions 600, different dimensions 0, over60KiB 0, maximum 61,386 bytes.
- Two additional 401-case crop-downscale sweeps: zero differences.
- Seeded 300,000-case mutation/CRC-repair fuzz: 29,798 accepted, zero untyped exceptions. This is typed-error/robustness evidence, not proof every accepted malformed stream is valid.
- Freshly rebuilt MemoryProbe:
  - idle 240 polls: processed 1, skipped 239, +9.2 MB;
  - 20 veterans: +75.8 MB;
  - after Stop: zero retained sessions/frames, +9.4 MB;
  - worst case: 80 frames, +672.0 MB against 664 MB frame storage.
- Freshly rebuilt EdgeProbe:
  - DRAIN bounded=8; oldDisposed=True; newestAlive=True;
  - OCR tile cancellation propagated;
  - ASSERTIONS passed.

Worker/parent evidence not independently reproduced as those exact samples:
- Worker’s 645 layout-crop comparison.
- Worker’s 1,200-case crop sample and nine ±1 bytes.
- Worker’s RED commit execution and performance timings.
- Parent’s separate broad gate runs.

Fresh source/reference checks:
- Full original round-1 report and round-2 instructions read.
- Exact fix diff and base-to-candidate scope inspected.
- Pngcs source confirms unchecked Adler and compressed-byte counting.
- RFC 1950 and W3C PNG specification retrieved directly after web_extract returned 403. No credentials or service configuration were added.

Final repository checks:

    git diff --check 55d1aac17e9be32f84ada4c522b597b6ef2b1e72..4d701d4e677280a9932c3e74bfe16691442487f5
      clean

    git status --porcelain=v1
      empty

    git rev-parse HEAD
      4d701d4e677280a9932c3e74bfe16691442487f5

    git branch --show-current
      task/T16b-image-library-migration

Scope gaps:
- No native Windows EXE execution, WGC, Windows.Media.Ocr, Windows --record-ocr or native-x64 numerical parity was performed. Cross-build/publish is packaging evidence only.
- No game imports, real-roster accuracy, deployment, Cloudflare acceptance or milestone exit approval is claimed.
- The untouched TS workspace was not rerun.
- T18 remains the transitive SQLite security task.
- T19 remains a recipient-licence release blocker.
- One worker fix round has been used. This reviewer made no additional implementation changes and did not authorize another implementation round.

session_id: 20261010_080715_e1d1fc

session_id: 20261010_080715_e1d1fc
