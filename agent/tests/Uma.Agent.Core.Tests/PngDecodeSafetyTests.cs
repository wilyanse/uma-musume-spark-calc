using System.Buffers.Binary;
using System.IO.Compression;
using System.Security.Cryptography;
using Xunit;

namespace Uma.Agent.Core.Tests;

/// <summary>T16b review round 1 (B1/B2): PNG decode must refuse corrupt, malformed or oversized input with
/// <see cref="InvalidDataException"/>, never return wrong pixels, and never inflate past the size IHDR declares.</summary>
public class PngDecodeSafetyTests
{
    private static FixtureEnv Env => FixtureEnv.Instance;

    private static string Sha(byte[] b) => Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant();

    // ---------- format coverage ----------

    /// <summary>Expected BGRA sha256 per synthetic format (TestPngs.Build). Produced by SixLabors.ImageSharp 3.1.12 in a
    /// scratch harness, except the four marked cases where 3.1.12 deviates from the PNG specification (W3C PNG 2nd ed.):
    /// <list type="bullet">
    /// <item>16-bit tRNS (gray16-trns, rgb16-trns): 3.1.12 ignores the 16-bit transparent key and returns alpha 255; the
    /// spec makes exactly the 35 key pixels transparent (key match verified independently with the Hjg.Pngcs reader's raw
    /// samples). Colour channels are identical.</item>
    /// <item>Adam7 images smaller than 8 px in a dimension (rgba8-adam7-3x2, graya8-adam7-1x9): 3.1.12 misplaces/zeroes
    /// pixels; the expected value matches both StbImageSharp 2.30.16 and the Hjg.Pngcs reader row by row.</item>
    /// </list>
    /// No agent input uses these forms: fixtures are 8-bit RGBA, non-interlaced, and the encoder writes the same.</summary>
    public static IEnumerable<object[]> FormatHashes() => new Dictionary<string, string>
    {
        ["gray1"] = "5ac9138356f6188cc4fc387b0ac153162815a1f95fc55a4d07ca7bdc5628258a",
        ["gray2"] = "0dd2d30893822e1efe1f04f6295173c22ac20fb07c67b0273142df3b102e325a",
        ["gray4"] = "755ea65eb6c8cdf530b29ea18f0102a2bf89eea6917923c37ad17c00ce08aa0c",
        ["gray8"] = "6c1067173a754f1c3c03f2a505a05007188cbb08e6a40f39ef8cff45881270e7",
        ["gray16"] = "54177ffbe868dde2116334aa3efd906becf75312fd6bf9e2e9fa5d77af8c621a",
        ["gray8-trns"] = "a66852d617c9af65756fd33479b6fed359fb25585f255807b6bb82df797d097a",
        ["gray16-trns"] = "SPEC",
        ["gray1-trns"] = "b3698f14e769d291300cd978aa21eaa1b7ee45f07e14071aac36cc4119331289",
        ["graya8"] = "08f557c656b035ecddbfafc262f1f7eb248d0c5cedc670431c57611c19de4860",
        ["graya16"] = "f3b6c6a78a5a2703393c57314432a708042bbbadd77d90594142c97b1c6f2a85",
        ["rgb8"] = "c43fdd8b3fe2c500e829c1b77303a358727addeed24a82a2d6298deeff06e032",
        ["rgb16"] = "e0e1d5777dd25340f6c17578e0d1d6672cb370b9f018b05e6dd526995b1b8231",
        ["rgb8-trns"] = "39d2535152ec05de893e91f51295e29dce209ad4f7b1a132904881d8d1966c0c",
        ["rgb16-trns"] = "SPEC",
        ["pal1"] = "802d221cdfccecd1e94641efebed0f39d88f17fc2d2023c53ff422aa51bd9754",
        ["pal2"] = "caf7f9056a29720c9441f238a2a977a6e48acd5e7ab682c89c11b66a6f415641",
        ["pal4"] = "a596189cf916f3a012d98e40a43cf72fd1e5471530b1c7f5482ca9f4c6afdded",
        ["pal8"] = "6173eb926d1c265d789ed3f992301228e38b84be3c563fa82afd4da6d50ac1b8",
        ["pal8-trns"] = "6be95adb90471072b11ec47b8050cd809373dee0f58546823c5834c0829c90e8",
        ["rgba8"] = "815433cf230dc3e4432615ebb835abfdcdf7bc464c1c0b377622397109ee2341",
        ["rgba16"] = "2be78a4be86516ba050d6f8d7ce51635e40ba3567439c19d1cca7f9cc5f85fd6",
        ["rgba8-1x1"] = "c0a2905d1e3776b6ac35276d5f2de1d1d6cdaca38ad6fffc1de5db9f6f160c54",
        ["rgba8-adam7"] = "cf89bc1f7b66b4201eff0cd52dea5d15dc01745c2757ed5e90a14df60515cd07",
        ["gray1-adam7"] = "f5e58149e32db109b36440811fbf35ff354f1afe931ba486ce3d25d2343d8343",
        ["pal4-adam7"] = "8082f9c84114b94b6f0ed4c165353a47233a63b001134e020c8247db59484ba8",
        ["rgb16-adam7"] = "e3eba7cfd6fa0161f680fdd0a888f1c655df26af0fffcb52b1bfaaeea0f1fcf4",
        ["rgba8-adam7-3x2"] = "SPEC",
        ["graya8-adam7-1x9"] = "SPEC",
    }.Select(kv => new object[] { kv.Key, kv.Value });

    [Theory]
    [MemberData(nameof(FormatHashes))]
    public void Every_png_colour_type_depth_and_interlace_decodes_to_the_expected_bgra(string name, string sha)
    {
        var spec = TestPngs.Formats.Single(f => f.Name == name);
        var frame = PngCodec.Decode(TestPngs.Build(spec));
        Assert.Equal((spec.Width, spec.Height), (frame.Width, frame.Height));
        if (sha != "SPEC") { Assert.Equal(sha, Sha(frame.Bgra)); return; }
        Assert.Equal(SpecExpectations[name], Sha(frame.Bgra));
    }

    /// <summary>Spec-conformant values for the four cases above (see FormatHashes), computed in scratch independently of
    /// Core's decoder: 16-bit tRNS = ImageSharp 3.1.12 colours with alpha set to 0 exactly where Hjg.Pngcs's raw 16-bit
    /// samples equal the key; small Adam7 = StbImageSharp 2.30.16 output, which equals Hjg.Pngcs row by row.</summary>
    private static readonly Dictionary<string, string> SpecExpectations = new()
    {
        ["gray16-trns"] = "11af89a0085b1f38f4905db23e3061f78cfc4b21693953ca146efbb53c67357d", // ImageSharp colours, alpha 0 at the 35 key pixels
        ["rgb16-trns"] = "feda1c323bc3fb3a2395af22e6e668b4e3935d759684aae96718346fa0a46934", // ImageSharp colours, alpha 0 at the 35 key pixels
        ["rgba8-adam7-3x2"] = "a2707e00449108ac6d3fd495ac9dd2f88969cc4ae3f2695f83b4273ec17ee7fe", // StbImageSharp 2.30.16 == Hjg.Pngcs reader
        ["graya8-adam7-1x9"] = "4c73cc65f66c5691618f8fbee9630943140e886875c504b0d8ef521440eddd1f", // StbImageSharp 2.30.16 == Hjg.Pngcs reader
    };

    [Fact]
    public void Spec_cases_differ_from_ImageSharp_only_where_documented()
    {
        // 16-bit tRNS: only the alpha of key pixels differs; Adam7 3x2: the decoded pixels are the raw row-major samples.
        var t = PngCodec.Decode(TestPngs.Build(TestPngs.Formats.Single(f => f.Name == "gray16-trns")));
        Assert.Equal(35, Enumerable.Range(0, t.Width * t.Height).Count(p => t.Bgra[p * 4 + 3] == 0));
        Assert.All(Enumerable.Range(0, t.Width * t.Height), p => Assert.Contains(t.Bgra[p * 4 + 3], new byte[] { 0, 255 }));
    }

    // ---------- corruption ----------

    private static byte[] FixturePng() => PngCodec.Encode(Frames.Crop(Env.Frame("13-support-card-list"), new Rect(273, 93, 101, 134)));

    private static List<(string Type, int Start, int Length)> Chunks(byte[] png)
    {
        var list = new List<(string, int, int)>();
        for (var p = 8; p < png.Length;)
        {
            var len = (int)BinaryPrimitives.ReadUInt32BigEndian(png.AsSpan(p));
            list.Add((System.Text.Encoding.ASCII.GetString(png, p + 4, 4), p, len));
            p += 12 + len;
        }
        return list;
    }

    private static void FixCrc(byte[] png, int chunkStart, int length)
        => BinaryPrimitives.WriteUInt32BigEndian(png.AsSpan(chunkStart + 8 + length), TestPngs.Crc(png.AsSpan(chunkStart + 4, 4 + length)));

    [Fact]
    public void Every_bit_flip_in_IHDR_IDAT_and_their_CRCs_is_refused()
    {
        var png = FixturePng();
        var chunks = Chunks(png);
        var refused = 0;
        foreach (var (type, start, len) in chunks.Where(c => c.Type is "IHDR" or "IDAT"))
            for (var i = start + 4; i < start + 12 + len; i++)       // type, data and CRC bytes
            {
                var bit = 1 << (i % 8);
                var s = (byte[])png.Clone(); s[i] ^= (byte)bit;
                Assert.Throws<InvalidDataException>(() => PngCodec.Decode(s));
                refused++;
            }
        Assert.True(refused > 1000, $"{refused}");
    }

    [Fact]
    public void Corrupt_deflate_or_Adler32_is_refused_even_when_the_chunk_CRC_is_recomputed()
    {
        var png = FixturePng();
        var (_, start, len) = Chunks(png).Single(c => c.Type == "IDAT");
        var count = 0;
        // Every byte of the zlib stream (header, deflate data, Adler-32), one bit each, with a valid chunk CRC.
        for (var i = 0; i < len; i++)
        {
            var s = (byte[])png.Clone();
            s[start + 8 + i] ^= (byte)(1 << (i % 8));
            FixCrc(s, start, len);
            Assert.Throws<InvalidDataException>(() => PngCodec.Decode(s));
            count++;
        }
        Assert.Equal(len, count);
    }

    [Fact]
    public void Random_mutations_never_produce_wrong_pixels()
    {
        // Deterministic mutation sweep with CRCs recomputed (so the zlib/filter layers are exercised, not just the CRC):
        // a decode that succeeds must reproduce the source pixels exactly.
        var source = Frames.Crop(Env.Frame("13-support-card-list"), new Rect(273, 93, 101, 134));
        var png = PngCodec.Encode(source);
        var (_, start, len) = Chunks(png).Single(c => c.Type == "IDAT");
        var rnd = new Random(1234);
        for (var i = 0; i < 3000; i++)
        {
            var s = (byte[])png.Clone();
            for (var j = 1 + rnd.Next(4); j > 0; j--) s[start + 8 + rnd.Next(len)] ^= (byte)(1 << rnd.Next(8));
            FixCrc(s, start, len);
            try { Assert.Equal(source.Bgra, PngCodec.Decode(s).Bgra); }
            catch (InvalidDataException) { }
        }
    }

    // ---------- structure ----------

    private static byte[] Png(Action<List<byte>> body, bool signature = true)
    {
        var o = new List<byte>();
        if (signature) o.AddRange(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A });
        body(o);
        return o.ToArray();
    }

    private static readonly byte[] Idat2x2 = TestPngs.Zlib(new byte[] { 0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 9, 10, 11, 12, 13, 14, 15, 16 });
    private static byte[] Ihdr2x2(int length = 13) => TestPngs.Ihdr(2, 2, 8, 6, false).Concat(new byte[Math.Max(0, length - 13)]).Take(length).ToArray();

    public static IEnumerable<object[]> Malformed() =>
    [
        ["missing IDAT", Png(o => { TestPngs.Chunk(o, "IHDR", Ihdr2x2()); TestPngs.Chunk(o, "IEND", []); })],
        ["missing IEND", Png(o => { TestPngs.Chunk(o, "IHDR", Ihdr2x2()); TestPngs.Chunk(o, "IDAT", Idat2x2); })],
        ["IEND not last", Png(o => { TestPngs.Chunk(o, "IHDR", Ihdr2x2()); TestPngs.Chunk(o, "IDAT", Idat2x2); TestPngs.Chunk(o, "IEND", []); TestPngs.Chunk(o, "tEXt", "a\0b"u8); })],
        ["trailing bytes", Png(o => { TestPngs.Chunk(o, "IHDR", Ihdr2x2()); TestPngs.Chunk(o, "IDAT", Idat2x2); TestPngs.Chunk(o, "IEND", []); o.AddRange(new byte[] { 0, 0, 0 }); })],
        ["duplicate IHDR", Png(o => { TestPngs.Chunk(o, "IHDR", Ihdr2x2()); TestPngs.Chunk(o, "IHDR", Ihdr2x2()); TestPngs.Chunk(o, "IDAT", Idat2x2); TestPngs.Chunk(o, "IEND", []); })],
        ["IHDR not first", Png(o => { TestPngs.Chunk(o, "tEXt", "a\0b"u8); TestPngs.Chunk(o, "IHDR", Ihdr2x2()); TestPngs.Chunk(o, "IDAT", Idat2x2); TestPngs.Chunk(o, "IEND", []); })],
        ["IHDR length 12", Png(o => { TestPngs.Chunk(o, "IHDR", Ihdr2x2(12)); TestPngs.Chunk(o, "IDAT", Idat2x2); TestPngs.Chunk(o, "IEND", []); })],
        ["IHDR length 14", Png(o => { TestPngs.Chunk(o, "IHDR", Ihdr2x2(14)); TestPngs.Chunk(o, "IDAT", Idat2x2); TestPngs.Chunk(o, "IEND", []); })],
        ["split IDAT", Png(o => { TestPngs.Chunk(o, "IHDR", Ihdr2x2()); TestPngs.Chunk(o, "IDAT", Idat2x2[..5]); TestPngs.Chunk(o, "tEXt", "a\0b"u8); TestPngs.Chunk(o, "IDAT", Idat2x2[5..]); TestPngs.Chunk(o, "IEND", []); })],
        ["unknown critical chunk", Png(o => { TestPngs.Chunk(o, "IHDR", Ihdr2x2()); TestPngs.Chunk(o, "ABCD", [1]); TestPngs.Chunk(o, "IDAT", Idat2x2); TestPngs.Chunk(o, "IEND", []); })],
        ["chunk length past end", ((Func<byte[]>)(() => { var p = Png(o => { TestPngs.Chunk(o, "IHDR", Ihdr2x2()); TestPngs.Chunk(o, "IDAT", Idat2x2); TestPngs.Chunk(o, "IEND", []); }); BinaryPrimitives.WriteUInt32BigEndian(p.AsSpan(33), 0x7FFFFFF0); return p; }))()],
        ["truncated mid-chunk", Png(o => { TestPngs.Chunk(o, "IHDR", Ihdr2x2()); TestPngs.Chunk(o, "IDAT", Idat2x2); TestPngs.Chunk(o, "IEND", []); })[..40]],
        ["missing PLTE", Png(o => { TestPngs.Chunk(o, "IHDR", TestPngs.Ihdr(2, 2, 8, 3, false)); TestPngs.Chunk(o, "IDAT", TestPngs.Zlib(new byte[6])); TestPngs.Chunk(o, "IEND", []); })],
        ["palette index out of range", Png(o => { TestPngs.Chunk(o, "IHDR", TestPngs.Ihdr(2, 2, 8, 3, false)); TestPngs.Chunk(o, "PLTE", new byte[6]); TestPngs.Chunk(o, "IDAT", TestPngs.Zlib(new byte[] { 0, 0, 5, 0, 1, 0 })); TestPngs.Chunk(o, "IEND", []); })],
        ["PLTE after IDAT", Png(o => { TestPngs.Chunk(o, "IHDR", TestPngs.Ihdr(2, 2, 8, 3, false)); TestPngs.Chunk(o, "IDAT", TestPngs.Zlib(new byte[6])); TestPngs.Chunk(o, "PLTE", new byte[6]); TestPngs.Chunk(o, "IEND", []); })],
        ["bad colour type", Png(o => { TestPngs.Chunk(o, "IHDR", TestPngs.Ihdr(2, 2, 8, 5, false)); TestPngs.Chunk(o, "IDAT", Idat2x2); TestPngs.Chunk(o, "IEND", []); })],
        ["bad bit depth", Png(o => { TestPngs.Chunk(o, "IHDR", TestPngs.Ihdr(2, 2, 4, 6, false)); TestPngs.Chunk(o, "IDAT", Idat2x2); TestPngs.Chunk(o, "IEND", []); })],
        ["bad filter type", Png(o => { TestPngs.Chunk(o, "IHDR", Ihdr2x2()); TestPngs.Chunk(o, "IDAT", TestPngs.Zlib(new byte[] { 5, 1, 2, 3, 4, 5, 6, 7, 8, 0, 9, 10, 11, 12, 13, 14, 15, 16 })); TestPngs.Chunk(o, "IEND", []); })],
        ["image data too short", Png(o => { TestPngs.Chunk(o, "IHDR", Ihdr2x2()); TestPngs.Chunk(o, "IDAT", TestPngs.Zlib(new byte[17])); TestPngs.Chunk(o, "IEND", []); })],
        ["image data too long", Png(o => { TestPngs.Chunk(o, "IHDR", Ihdr2x2()); TestPngs.Chunk(o, "IDAT", TestPngs.Zlib(new byte[19])); TestPngs.Chunk(o, "IEND", []); })],
        ["zlib without Adler-32", Png(o => { TestPngs.Chunk(o, "IHDR", Ihdr2x2()); TestPngs.Chunk(o, "IDAT", Idat2x2[..^4]); TestPngs.Chunk(o, "IEND", []); })],
        ["zlib preset dictionary", Png(o => { var z = (byte[])Idat2x2.Clone(); z[1] = 0xBC; TestPngs.Chunk(o, "IHDR", Ihdr2x2()); TestPngs.Chunk(o, "IDAT", z); TestPngs.Chunk(o, "IEND", []); })],
    ];

    [Theory]
    [MemberData(nameof(Malformed))]
    public void Malformed_structure_is_refused(string why, byte[] png)
    {
        var e = Assert.Throws<InvalidDataException>(() => PngCodec.Decode(png));
        Assert.False(string.IsNullOrEmpty(e.Message), why);
    }

    [Fact]
    public void Valid_unknown_ancillary_chunks_are_accepted()
    {
        var png = Png(o =>
        {
            TestPngs.Chunk(o, "IHDR", Ihdr2x2());
            TestPngs.Chunk(o, "prVt", [1, 2, 3]);                     // private ancillary chunk
            TestPngs.Chunk(o, "IDAT", Idat2x2);
            TestPngs.Chunk(o, "tIME", [7, 234, 10, 10, 8, 0, 0]);
            TestPngs.Chunk(o, "IEND", []);
        });
        var f = PngCodec.Decode(png);
        Assert.Equal(new byte[] { 3, 2, 1, 4, 7, 6, 5, 8, 11, 10, 9, 12, 15, 14, 13, 16 }, f.Bgra);
    }

    // ---------- bounded inflate ----------

    private static byte[] ZeroZlib(long bytes)
    {
        using var ms = new MemoryStream();
        using (var z = new ZLibStream(ms, CompressionLevel.SmallestSize, true))
        {
            var chunk = new byte[1 << 16];
            for (long i = 0; i < bytes; i += chunk.Length) z.Write(chunk, 0, (int)Math.Min(chunk.Length, bytes - i));
        }
        return ms.ToArray();
    }

    [Fact]
    public void Inflate_bomb_is_refused_without_inflating_past_the_declared_image()
    {
        // 1x1 RGBA declares 5 filtered bytes; the IDAT inflates to 64 MiB (about 64 KiB compressed).
        var png = TestPngs.WithIdat(1, 1, 8, 6, ZeroZlib(64L << 20));
        Assert.True(png.Length < 200_000);
        var before = GC.GetAllocatedBytesForCurrentThread();
        var watch = System.Diagnostics.Stopwatch.StartNew();
        var e = Assert.Throws<InvalidDataException>(() => PngCodec.Decode(png));
        watch.Stop();
        Assert.Contains("longer than the header declares", e.Message);
        // The decoder is fully managed (no native pixel buffers), so this counts its working memory; the BCL inflater's
        // own native state is a fixed-size zlib window, independent of the payload.
        Assert.True(GC.GetAllocatedBytesForCurrentThread() - before < 2 * png.Length + 1_000_000, "decoder allocated beyond the compressed input");
        Assert.True(watch.ElapsedMilliseconds < 2_000, $"{watch.ElapsedMilliseconds} ms");
    }

    [Fact]
    public void Large_declared_image_with_tiny_payload_allocates_only_what_it_reads()
    {
        // 7680x4320 at the pixel limit with 10 bytes of image data: refused as short; nothing near 127 MiB of BGRA is ever
        // filled. (The filtered buffer is allocated up front at its exact declared size, bounded by MaxPixels.)
        var png = TestPngs.WithIdat(7680, 4320, 8, 6, TestPngs.Zlib(new byte[10]));
        var e = Assert.Throws<InvalidDataException>(() => PngCodec.Decode(png));
        Assert.Contains("shorter than the header declares", e.Message);
    }
}
