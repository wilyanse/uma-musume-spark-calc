↻ Resumed session 20261010_080715_e1d1fc "Review T16b image library migration candidate" (3 user messages, 130 total messages)
## Verdict: PASS

I independently re-reviewed candidate 2d9471c0ac8fa413cfc2cbebd87e592fdf259669 against round-2 candidate 4d701d4e677280a9932c3e74bfe16691442487f5 and original base 55d1aac17e9be32f84ada4c522b597b6ef2b1e72. B3 and B4 are fixed. No blocking findings remain.

The tested code is 107ac9c. I confirmed that the later commit changes only the changelog and runbook text.

The worktree is clean at the exact candidate SHA. I made no tracked edits, commits, merges or pushes. I deleted only ignored `bin` and `obj` folders before fresh builds.

PASS approves T16b for local merge after the parent's normal process. It is not:
- release approval;
- blanket security approval;
- native Windows, game or deployment proof.

T18 (SQLite advisory) and T19 (licence delivery to recipients) remain separate. T19 still blocks every `agent-v*` release, and that now includes SharpZipLib.

Review provenance:
- **Rounds 1 and 2:** Opus, then Sol on the user's request.
- **Round 3:** Sol started it, but the provider's safety filter refused the run and Sol produced no verdict. It only rewrote scratch harness files; those were rebuilt here against the current Core.
- **This report:** written by Opus on the user's explicit selection.
- **Evidence labels:** "fresh Opus" means run in this round. "Inherited" means Opus r1/r2 or Sol r2. "Worker/parent" means their own runs, not checked here.

## Blocking

None.

## Should fix

- **[S8]** `agent/src/Uma.Agent.Core/PngCodec.cs:191-203` (behaviour of SharpZipLib 1.4.2 `OutputWindow.Repeat`). Low severity; record as a follow-up, not a merge blocker.
  - **Problem:** the inflater accepts a back-reference that points before the start of the output ("distance too far back"). It reads uninitialised window bytes as zeros. RFC 1951 forbids this, and Python zlib rejects it.
  - **Fresh Opus repro:** I built a hand-written fixed-Huffman stream in Python, `T16b-review3/vec/dist_too_far.png`. It is a 2×1 grey image whose single back-reference has length 3 and distance 1, with nothing output before it. The CRC and Adler-32 are valid.
    - `python3 run.py decodefile ../vec/dist_too_far.png` → `OK 2x1`.
    - Python zlib: `invalid distance too far back`.
    - ImageSharp 3.1.12: `InvalidDataException`.
  - **Impact is bounded:**
    - A random-corruption sweep found no case where this is reachable. 300,000 mutations with re-fixed CRCs produced 7,226 accepted decodes that differ from their seed. I dumped 4,000 of them, and every one is a stream Python zlib also fully accepts, with clean EOF and no trailing data.
    - The bytes decoded are fully defined: zeros, verified by Adler-32. A valid stream could produce the same pixels, so this does not add a new way to get wrong pixels beyond the accepted policy that checksums are not authenticity.
    - The retained test helper `ChecksumConsistent` uses the same SharpZipLib, so it shares this blind spot.
  - **Suggestion:** record this as a dependency-conformance limitation in the changelog follow-ups. If the coordinator wants strict RFC 1951 behaviour, track the cumulative output position against the distance or use a stricter inflater. Do not add a handwritten Deflate engine for this alone.

## Nits

- **[N6]** `agent/src/Uma.Agent.Core/Frames.cs:38-41`. The internal `ReadEncoded(null, …)` throws `NullReferenceException`, while `Load(null)` correctly throws `ArgumentNullException`. It is internal and only used by tests; `ArgumentNullException.ThrowIfNull(input)` would make it consistent.
- **[N7]** `agent/legal/SharpZipLib-1.4.2-LICENSE.txt:1` says "2000-2018", while the nuspec says "Copyright © 2000-2022". The file is a verbatim copy of upstream (hash verified below), so it is correct. T19 may want to cite both lines in the notice.

## Dispositions of findings from rounds 2 and 3

- **B3 (file input bounds): fixed. Fresh Opus.**
  - `Frames.Load` opens one `FileStream` with `bufferSize=1` and takes `Length` from that handle before allocating. `ReadEncoded` then caps the actual bytes read at the limit plus one probe byte. `using` closes the handle on every path before decoding.
  - Sparse files of 300 MiB, 2 GiB−100 and 3 GiB all fail with `InvalidDataException: PNG file exceeds the 268435456 byte decode limit` in 5–9 ms. Peak RSS is about 41.6 MB. In round 2 the 300 MiB file reached 356.8 MB RSS, and the 3 GiB file threw an untyped `IOException`.
  - Growth during the read, using a real file grown through a second handle on the first read:

    | Initial size | Appended | Result | Bytes read from handle |
    |---|---|---|---|
    | 2 | 31 | refused | 33 |
    | 32 | 1 | refused | 33 |
    | 0 | 33 | refused | 33 |
    | 0 | 100,000,000 | refused | 33 |
    | 0 | 32 | accepted, 32 bytes | 32 |
    | 16 | 16 | accepted, 32 bytes | 32 |

    The bytes read never exceed the cap plus one.
  - After a refused load and after a successful one, an exclusive reopen of the file succeeds, so the handle is released. Not-seekable streams are rejected without reading (retained test). Using the open handle's length plus an independent read cap avoids the FileInfo check-then-read race.
- **B4 (zlib completion and trailer): fixed. Fresh Opus.**
  - I read the SharpZipLib source at commit 33f64eb:
    - `FINISHED` is reached only after `isLastBlock`, a skip to the byte boundary, and `DecodeChksum` checking all 32 bits of the Adler-32 that was actually read.
    - `IsFinished` also requires the output window to be drained.
    - `RemainingInput` includes bit-buffer bytes read ahead (`StreamManipulator.AvailableBytes`).
    - Malformed header and Huffman input throws `SharpZipBaseException`, `InvalidOperationException` (window full), `IndexOutOfRange` or `ArgumentException`; the candidate turns these into `InvalidDataException`.
    - Every `Decode()` that returns true consumes input or changes state, and the caller throws when no progress is made.
    - No private runtime API, reflection, P/Invoke or bespoke Deflate code is involved.
  - My vectors, each checked against an independent Python zlib oracle first:

    | Vector | Python zlib | Candidate |
    |---|---|---|
    | `nofinal` (BFINAL=0) | output 18, eof False | `unfinished zlib stream` |
    | junk + duplicated Adler | eof True, 8 unused bytes | `data after the single zlib stream` |
    | second stream + duplicated Adler | eof True, 15 unused bytes | `data after the single zlib stream` |
    | one trailing byte | eof True, 1 unused | refused |
    | bad Adler | incorrect data check | `invalid zlib data` |
    | BTYPE=3 | invalid block type | `invalid zlib data` |
    | CINFO=8 | invalid window size | `invalid zlib header` |
    | preset-dictionary flag | rejected | `invalid zlib header` |
    | valid stream split over many IDATs, including empty ones | valid | `OK 2x2` |
    | Adler trailer split across an IDAT boundary | valid | `OK 2x2` |

    The only gap found is the narrow S8 conformance issue above.
- **S5 (chunk allocation): fixed. Fresh Opus.**
  - Chunk types are compared as `uint`. Only constant IDAT start/end metadata is kept, and IDAT bodies are copied in a second pass.
  - Two 240,000,070-byte inputs with 20 million empty IDAT or ancillary chunks: `OK 1x1`, decoder allocation reported as 0 MiB (the worker measured 46,096 bytes; inherited). Max RSS is about 283 MB, almost all of it the input held by the harness. In round 2 the same inputs allocated 1,122 and 610 MiB.
  - The retained test is a real 100,000-chunk allocation assertion.
- **S6 (indexed palette vs bit depth): fixed. Fresh Opus.** `PngCodec.cs:91`.
  - 1-bit indexed with 3 entries → `PLTE exceeds indexed bit depth`, for both `plte_pal1_too_many` and `pal1_3entries`.
  - 1-bit with 2 entries → `OK 2x1`.
  - All palette rows in the 28-format matrix remain identical.
- **S7 (package-search claim): fixed.** The changelog now names the evaluated set (BCL `ZLibStream`, Hjg.Pngcs reader, SharpZipLib) and explicitly makes no claim to have searched every package.
- **N5 (test accuracy): fixed.** The test was renamed, its comment corrected, and it now asserts allocation below 100,000 bytes. It passes inside the fresh 414/414.

## Dispositions of findings from rounds 1 and 2 (rechecked fresh by Opus)

- **B1 (corrupt PNGs decoded as wrong pixels): still resolved.**
  - 3,000 single-bit IDAT flips: 0 wrong-pixel decodes, 3,000 refusals. ImageSharp also refuses all 3,000. Round 1 had 1,858 wrong-pixel decodes.
  - `badcrc` → `chunk CRC mismatch`.
  - The worker's Adler-collision file decodes with 263 differing bytes in both the candidate and ImageSharp. It is a checksum-consistent valid PNG; checksums are not authenticity, so this is accepted policy.
  - The 300,000-case CRC-refixed fuzz produced 0 untyped exceptions. Every accepted output that differed from its seed was a stream Python zlib also accepts.
- **B2 (native leaks and unbounded inflate): still resolved.**
  - Inflate bombs of 256 MiB, 1 GiB and 2 GiB are refused with `longer than the header declares`. Max RSS is 47–51 MB; round 1 reached 315 MB–1.56 GB.
  - `leak2` ×20: managed 128 MiB, working set 110 MiB, max RSS 175 MB. Round 1 reached 917 MB.
  - A 7680×4320 image at the maximum size decodes OK with max RSS of 312–442 MB.
  - There is no unmanaged allocation route. SharpZipLib is fully managed, with a fixed 32 KiB window.
- **S1 (licence delivery):** carried forward and accurate.
  - `agent/legal` records SharpZipLib's licence and its T19 obligation.
  - The published EXE contains `ICSharpCode.SharpZipLib` 70 times but "Permission is hereby granted" 0 times. The licence text is not delivered with the binary yet.
  - T19 remains a release blocker. The round-2 claim that "no third-party component" was added is explicitly superseded in the changelog.
- **S2 (crop compression):** still holds. The encoder is unchanged: diff hunks touch only its doc comment. 90 fresh crops: CRCs all valid, Python zlib reaches a clean EOF with exact geometry, maximum 61,095 bytes (≤61,440), and all 90 match the independent decoder. The 600-crop comparison is inherited from Opus r2.
- **S3 (SQLite advisory):** unchanged. Fresh all-transitive audit shows only `SQLitePCLRaw.lib.e_sqlite3 2.1.11 High GHSA-2m69-gcr7-jv3q` for both Core and Windows. Owned by T18.
- **S4 (unsafe decoder):** remains resolved. The new dependency is managed, with no native assets, build targets or added transitive dependencies on net8.
- **N1–N4:** remain resolved.
  - N1: the managed allocation counter now covers the decoder's working memory, including SharpZipLib.
  - N2: encoding still uses `using`.
  - N3: the resampler is unchanged; fresh comparison shows 0 differing bytes.
  - N4: no shared mutable state was added; SharpZipLib is instantiated per decode.
- **Round 2 S5–S7 and N5:** see the previous section.

## Checklist

1. **Spec conformance: ok** (64 plus the T16b task card).
   - The replacement is key-free and exact-pinned, and ImageSharp, Stb and Pngcs are absent.
   - Targets are unchanged.
   - Straight BGRA, alpha, orientation and the 15 fixture identities are preserved.
   - The ≤60 KiB crop contract holds with true dimensions.
   - OCR rounding and maximum-dimension behaviour hold.
   - Disposal is deterministic, and the stationary-capture bound and cancellation behaviour are re-run fresh.
   - The audited Release build, cross-builds and publish pass.
   - H4 remains outstanding.
2. **Correctness: ok, with S8.**
   - Input reading is bounded.
   - zlib completion and trailer are enforced.
   - The PNG conversion code is unchanged since round 2 and still matches independent decoders.
   - Edge cases checked: tiny Adam7 images, 16-bit, tRNS, palette limits, the reserved bit on ancillary chunks (correctly accepted per the PNG specification), and chunk-length overflow.
   - S8 is a narrow RFC deviation inherited from the dependency.
3. **Test quality: ok.**
   - 20 new retained cases, verified meaningful against an independent Python oracle.
   - The worker's RED-before-fix result (10 failed, 6 passed) is inherited and was not re-run.
   - The `ChecksumConsistent` helper shares the dependency, which the changelog acknowledges; this is the S8 blind spot.
   - The counts in the changelog match my fresh runs exactly.
4. **Fabrication: ok.**
   - Package SHA, licence hash, source commit, net6 asset, an empty GHSA result and the 474-entry bundle all reproduce.
   - The parent's fix2 EXE is byte-identical to my fresh publish.
   - No game constants were touched.
5. **Security: ok for this scope.**
   - No secrets, audit suppression or new warning suppression.
   - The existing `WFAC010` `NoWarn` in `Uma.Agent.Windows.csproj` is pre-existing and was not touched.
   - S8 is low severity. T18 is separate; no blanket security claim.
6. **Free tier: ok.** No service changes, and the R2 crop size limit holds.
7. **Scope: ok.**
   - Changes are limited to agent Core, tests, docs, and the declared `agent/legal` and runbook cross-task edits.
   - No changes to schema, API, engine, web, master, golden, fixtures, layouts, thresholds, workflows, `Directory.Build.props` or `global.json`.
   - Nothing changed after 107ac9c except the changelog and runbook.
8. **Maintainability: ok.**
   - Delegating Deflate to a mature, exact-pinned managed library behind a narrow public API is better than bespoke inflate code.
   - The PNG layer is clear.
   - Maintenance status is described accurately: last release 2023, last push 2024, not "active".

## Commands run

**Environment repair (fresh Opus, scratch only, nothing global).**
- The first fresh run was invalid and I discarded it. The scratch `IR1/dotnet8` runtime and `IR1/tools` had been pruned, so:
  - runtime and Core/Portable failed with `Microsoft.NETCore.App 8.x runtime is not installed … Test Run Aborted`;
  - `.github/tests/run.sh` failed with `missing tool: AGE`.
- I reinstalled both into scratch only:
  - `dotnet-install.sh --runtime dotnet --version 8.0.31 --install-dir $S/IR1/dotnet8 --no-path` (it reinstated the 8.0.31 runtime under the existing `dotnet-combo` path);
  - `.github/scripts/install-tool.sh age|actionlint $S/IR1/tools`, which checks pinned SHA-256 digests → `v1.3.2`, `1.7.12`.
- I then deleted the ignored `bin`/`obj` again and ran everything from clean.

**Fresh Opus gates** (process-scoped `DOTNET_ROOT`/`DOTNET_BIN`; audit at defaults; `TreatWarningsAsErrors=true`; no `--no-build`):

```
$ bash .github/scripts/agent-gates.sh runtime        → exit 0; 10.0.103; Microsoft.NETCore.App 8.0.31
$ bash .github/scripts/agent-gates.sh core-tests     → Passed! Failed 0, Passed 414, Total 414 (48 s)
$ bash .github/scripts/agent-gates.sh windows-build  → 0 Warning(s) 0 Error(s)
$ dotnet test …Portable.Tests.csproj -c Release      → Passed! Failed 0, Passed 230, Total 230
$ dotnet build …Native/Uma.Agent.Windows.Tests.csproj -c Release -p:EnableWindowsTargeting=true → 0 Warning(s) 0 Error(s)
$ dotnet build agent/Uma.Agent.sln -c Release -p:EnableWindowsTargeting=true                   → 0 Warning(s) 0 Error(s)
$ dotnet publish … -r win-x64 --self-contained -p:PublishSingleFile=true … → exit 0, EXE 191391501 B
    cmp with T16b-parent-fix2-publish/Uma.Agent.Windows.exe → identical
$ bundle_probe.py <exe> . → bundle 6, 474 entries; matches 15 of 15; e_sqlite3.dll True
$ TOOLS_DIR=…/IR1/tools bash .github/tests/run.sh → regression checks: 62 passed, 0 failed
$ node .github/scripts/check-config.mjs . → config check ok (structure): MASTER_VERSION=global-20260930
$ dotnet list Core package --include-transitive → Microsoft.Data.Sqlite 10.0.3, SharpZipLib 1.4.2; transitive SQLitePCLRaw.* 2.1.11, System.Memory 4.5.3
$ dotnet list Core|Windows package --vulnerable --include-transitive → only SQLitePCLRaw.lib.e_sqlite3 2.1.11 High GHSA-2m69-gcr7-jv3q
$ MemoryProbe → idle 240 polls processed 1 skipped 239 +MB 9.2; veteran 20 +MB 75.8; after Stop 0 sessions/frames +MB 9.4; 80 frames +MB 672.0 (bound 664)
$ EdgeProbe → DRAIN bounded=8; oldDisposed=True; newestAlive=True; OCR tile cancellation propagated; ASSERTIONS passed
```

**Harness integrity (fresh Opus).**
- The `io`, `h2`, `fmt`, `par`, `fz` and `fz2` harnesses were all rebuilt with `ProjectReference` to the candidate.
- Every copy of `Uma.Agent.Core.dll` has SHA-256 `788f365e311c5c92…`, identical to the worktree build.
- The bundled `ICSharpCode.SharpZipLib.dll` has SHA-256 `32ea2d0c…`, identical to `lib/net6.0` inside the nupkg.
- The ImageSharp NU1902/NU1903 warnings appear only in the scratch diagnostic oracle (`par`), never in the candidate.

**Package and legal (fresh Opus downloads).**
```
sharpziplib.1.4.2.nupkg sha256 fe0895aa…5ff5946 (= agent/legal/README.md)
nuspec: license MIT; repository commit 33f64eb0f28c…; net6.0 group has no dependencies; lib only (net6.0/netstandard2.0/2.1), no build/, no runtimes/
upstream LICENSE.txt @33f64eb sha256 d7fbbc16…ca61133 == agent/legal/SharpZipLib-1.4.2-LICENSE.txt (byte-identical)
GHSA affects=SharpZipLib@1.4.2 → []
EXE strings: ICSharpCode.SharpZipLib 70, "Permission is hereby granted" 0, StbImageSharp/Hjg.Pngcs/SixLabors 0
```

**Fresh Opus parity and format checks.**
```
par corrupt (3000 IDAT 1-bit flips): ok-WRONG 0, refused 3000; ImageSharp refused 3000
par decode: rgba8/rgba16/rgb8/gray8/gray1/graya8/pal8/rgba8-adam7 diffbytes 0; new encode→ImageSharp diff 0
par resample: 165×4 alpha kinds 0 diff; fixture resamples 120, with diffs 0
par adler (worker collision file): ours 263 diff | ImageSharp 263 diff
fmt + sharp 0.35.5/libvips/libspng: 28 formats identical 28; 90 encoded crops identical 90; 15 fixture hashes match 15 of 15
python CRC/zlib on 90 crops: crc bad 0, clean EOF, max 61095 B ≤ 61440
```

**Fresh Opus supervised hostile probes.**
- Each case ran in its own process under `run.py`, with an RSS kill at 6 GB and a 180 s timeout. Results are in the B1–B4 and S5–S6 dispositions above.
- Also refused with typed errors:
  - structure: `dupihdr`, `ihdrlen`, `missing_iend`, `type_nonletter`, `ihdr_w_2pow31`;
  - IDAT length: `trunc`, `short`, `extra`;
  - chunk lengths: `chunklenhuge`, `chunklenFFFF`, `chunklen7FFFFFF4`;
  - colour and palette: `ct3nopal`, `badct`, `plte_257`, `trns_pal_toolong`, `trns_before_plte`;
  - declared size: `maxdecl_tiny`;
  - zlib end: `zlib_nofinal`, `concat_zlib`, `zlib_trailing_garbage`.
- Accepted correctly: `adam7_1x1` → [7,8,9,6], `adam7_1x1_gray1`, and the expected `adam7_9x1_gray2` values.
- Fuzz with re-fixed CRCs (seed 31337, 300,000 cases): accepted 29,774, untyped 0, max RSS 72.9 MB. All 4,000 dumped differing-accepted outputs are valid per Python zlib.

**Inherited, not re-run:**
- Opus r2: 600-crop old-vs-new dimension comparison and 2×401 crop-downscale sweeps.
- Sol r2: gates on 4d701d4.
- Worker: TDD RED at 4b349f7, 46,096-byte S5 allocation figure, performance timings.
- Parent: Gate A on 2d9471c and seven probes.

**Final state.** `git status --porcelain` is empty. `HEAD` is 2d9471c0ac8fa413cfc2cbebd87e592fdf259669 on `task/T16b-image-library-migration`. `git diff --name-only 107ac9c..HEAD` shows only the changelog and `docs/runbooks/agent-install.md`.

**Scope gaps.**
- Not checked: native Windows execution, WGC, Windows.Media.Ocr, `--record-ocr`, x64 numeric parity, game imports, Cloudflare and deployment (all H4/H2).
- The TS workspace was not touched and not run.
- The two worker fix rounds are used up. S8, N6 and N7 are follow-ups for the coordinator, not a reason for a third worker round.

session_id: 20261010_080715_e1d1fc

session_id: 20261010_080715_e1d1fc
