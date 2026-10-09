using System.Security.Cryptography;
using Xunit;

namespace Uma.Agent.Core.Tests;

/// <summary>T16b (64): image behaviour that must survive the image-library migration. Only Core's library-neutral API is
/// used (Frames.Load / Normalize, CaptureSession.CropPng), so these tests compile and run against both the pre-migration
/// ImageSharp 3.1.12 build and the migrated build. Every expected value was produced by the pre-migration build
/// (ImageSharp 3.1.12 decode/bicubic resize/PNG encode) and is recorded here verbatim; it is not derived from the new code.</summary>
public class ImageBehaviourTests
{
    private static FixtureEnv Env => FixtureEnv.Instance;

    private static string Sha(byte[] b) => Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant();

    private static string TempPng(byte[] bytes)
    {
        var path = Path.Combine(Path.GetTempPath(), $"t16b-{Guid.NewGuid():N}.png");
        File.WriteAllBytes(path, bytes);
        return path;
    }

    /// <summary>Deterministic straight-alpha BGRA test pattern (alpha varies, including 0 and 255).</summary>
    internal static Frame Pattern(int w, int h)
    {
        var b = new byte[w * h * 4];
        for (var y = 0; y < h; y++)
            for (var x = 0; x < w; x++)
            {
                var p = (y * w + x) * 4;
                b[p] = (byte)((x * 37 + y * 11) % 256);
                b[p + 1] = (byte)((x * 13 + y * 71 + 40) % 256);
                b[p + 2] = (byte)((x * x * 9 + y * 29) % 256);
                b[p + 3] = (byte)((x + y) % 3 == 0 ? 255 : (x * y * 23 + 7) % 256);
            }
        return new Frame(b, w, h);
    }

    private static byte[] Block(Frame f, int x, int y, int w, int h)
    {
        var b = new byte[w * h * 4];
        for (var r = 0; r < h; r++) Buffer.BlockCopy(f.Bgra, ((y + r) * f.Width + x) * 4, b, r * w * 4, w * 4);
        return b;
    }

    // 3x2 RGBA PNG (8-bit, colour type 6, encoded by ImageSharp 3.1.12): (255,0,0,255) (0,255,0,128) (10,20,30,0) /
    // (1,2,3,4) (255,255,255,255) (0,0,0,7). Colour under alpha 0 must survive (straight, not premultiplied).
    private const string RgbaPng = "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAAI0lEQVR4nGP5z8Dwn/E/QyOXqFwDCxMTM+t/hj+/Gd8wtgMAbecIvLBxb0cAAAAASUVORK5CYII=";
    // 2x2 RGB PNG (colour type 2): (9,8,7) (6,5,4) / (3,2,1) (250,251,252).
    private const string RgbPng = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAAF0lEQVR4nGPh5GD/+/cvy69fv77//A0AMKsI8WTmcroAAAAASUVORK5CYII=";

    [Fact]
    public void Png_decode_yields_tightly_packed_straight_bgra_in_top_down_row_order()
    {
        var rgba = TempPng(Convert.FromBase64String(RgbaPng));
        var rgb = TempPng(Convert.FromBase64String(RgbPng));
        try
        {
            var f = Frames.Load(rgba);
            Assert.Equal((3, 2), (f.Width, f.Height));
            Assert.Equal(new byte[] { 0, 0, 255, 255, 0, 255, 0, 128, 30, 20, 10, 0, 3, 2, 1, 4, 255, 255, 255, 255, 0, 0, 0, 7 }, f.Bgra);
            var g = Frames.Load(rgb);
            Assert.Equal((2, 2), (g.Width, g.Height));
            Assert.Equal(new byte[] { 7, 8, 9, 255, 4, 5, 6, 255, 1, 2, 3, 255, 252, 251, 250, 255 }, g.Bgra);
        }
        finally { File.Delete(rgba); File.Delete(rgb); }
    }

    public static IEnumerable<object[]> FixtureDecodeHashes() => new Dictionary<string, string>
    {
        ["01-veteran-details-skills-independent"] = "4561891e171f14294567207cbe7827fefc909136f501d850175887ca6a6c5b53",
        ["02-veteran-details-inspiration-p1"] = "3f7355f67b7ff28c61155e905bbd180914784958d324bfe58bfb50ba95226156",
        ["03-veteran-details-inspiration-p2"] = "03656bdab10529a404c403157f9b7a8c23fa9e7640bb6f11a50e50cc0195e03e",
        ["04-veteran-details-inspiration-p3"] = "f79e37d95db775d3e68fdfb7df25958e487d2c4846d3529a065c23497589edda",
        ["05-veteran-details-career-info-deck-legacy"] = "4c9812e9ae78ff72202897c9b65c578535250bc43acef2021ca2b332b11a2bd4",
        ["06-veteran-details-career-info-record"] = "0e8ac9a311649ca634f239b9328570ae220dff7453534f07dfca67cf606e83d2",
        ["07-veteran-details-career-info-races"] = "26dc9877b369edcd03101bd5e56a2e496de9eb1df7c3e40b8c06409a3e5c104f",
        ["08-sparks-popup-oguri-cap"] = "3b4219b1b7b926041291ff2018a881e481ec4e2d61ee4eae1a2502ecd6092bbd",
        ["09-sparks-popup-special-week-parent"] = "988021b2c1d7e992be6ab41f841cabe2a46e50efcd9f81de40d57180584bc1e6",
        ["10-sparks-popup-guest-parent"] = "aaa8e3821599753bcbe562d359e1b3dea6930924a492335672497d0be8d3aa1f",
        ["11-sparks-popup-gold-city"] = "1d1e8cc367d4aa5835eb804d53a02cb9a2dc86a1821710e06dc09f97bb0708ef",
        ["12-sparks-popup-kitasan-black"] = "aa21f9b118b5a389c63e30322e783596ee713c3cabb6e682154aef9950568513",
        ["13-support-card-list"] = "2cc44a97d8f5b2669264ce4bfcf46cfbfbf0559b8e53362f63f3c1ad5d373d72",
        ["14-support-card-detail"] = "abd200ba665d4213c349733c3363ba6c6adf7bdaa8cbcaa76181d9dc7de0ebe5",
        ["15-veteran-details-skills-manual"] = "0223b3b281c140ef7511e8a192bda19cac9456f476562d79a9fcf5c49133c674",
    }.Select(kv => new object[] { kv.Key, kv.Value });

    [Theory]
    [MemberData(nameof(FixtureDecodeHashes))]
    public void Every_real_fixture_decodes_to_the_same_bgra_bytes_as_before(string name, string sha)
    {
        var f = Frames.Load(Path.Combine(FixtureEnv.Screens, name + ".png"));
        Assert.Equal((1920, 1080), (f.Width, f.Height));
        Assert.Equal(sha, Sha(f.Bgra));
    }

    [Theory]
    [InlineData(2560, 1440, 0, 0, "ACMAjV2FOxtrV02siG7zItyJfKGerVxcNcyyeFbG3qE62EIbSK1Cr3PFcnuz2bTS3NKApSBe3602lnjFdJCn4iTlU6xUSmF7iUGjwrOvi2r9ZWChUTdn10hGQXJ8YXjaNHljIm1qmdKGYqFq2ZEbnbSbfY0qyE6bUsKmspmJiW8=")]
    [InlineData(2560, 1440, 957, 533, "1XCPlCthxaRNII1vr0WVRcFamvrXb8atK4gwvFCUm4AaiXaINJfYqX343kOdrKWz3JnG4FKq4dkrvE/GZMO61ia8UcBObUXbeX7I8sda/yDtH9SgeBNLY0JEiaxwSnDHMGuEYFUuKb+OSD7GxG3prn6BQW4gmEDFSJ2W0IyrZ7I=")]
    [InlineData(2560, 1440, 1912, 1076, "D5ab6FasZreHqavVsrR1e+nMdtIp0jKDVEzMl21gk3orrmzoX9przZUevsTGJZ/i1Tae0zBNY/JaVN72hGzfajo5H8JqLXozrIRGn9uDWrwvqJWxJ55TlG3CRLuXysn4Pas/fI/L1aKjv06r/uhKkGN8ptRAFo27c1IvualyOLQ=")]
    [InlineData(3840, 2160, 0, 0, "EU4LUWSHUH2/r618lJyHiz65uKmK3YiJwocEWSVxW4Yzu059dG2Inc+3gaB0UISuTmJpsaCMqLmpkkicPJAoxlOYknyGiKeg241MjEipgrFeo4iKxmKizHKLiqw+iGezXJHTi6yCr66NW4exNV2Dx4J7Z6vQfnTDjIDCkFmYqKE=")]
    [InlineData(3840, 2160, 957, 533, "iFiHfstVRq4ycZKuaYjXrLhwkI1tmIivOrhgvpGeaL2gnYqBub95lENNQYl8nFzBwmU5x1lJrdtRa4narnmnxsdaXJZ8eJirNW5SmZmLQKHTmYu7NrSGuWK+narZYnaCya5fknptXZxTkad7tWOGi6lNq8NIdGC+hYmZxMWIf60=")]
    [InlineData(3840, 2160, 1912, 1076, "Nnm9po922anBj4q+KoFlr2q5aMa7gX+0eX5UvDyMhL5NZE++p3pkrKaWP6UwQ6q8fWmTm8d4ZblfenTCUYUqzWp3NrjAgy7gjYt2qz+zfbGXlXSmx4BmqjOAmrlnTWiUgp93rspkabtoQ7KLVV63e7Jli7RbcHWdKH5pf4m0poI=")]
    public void Normalize_downsamples_larger_16x9_frames_with_the_calibrated_bicubic(int w, int h, int x, int y, string expected)
    {
        var n = Frames.Normalize(Pattern(w, h));
        Assert.Equal((1920, 1080), (n.Width, n.Height));
        Assert.Equal(expected, Convert.ToBase64String(Block(n, x, y, 8, 4)));
    }

    [Fact]
    public void Normalize_returns_reference_frames_untouched_and_keeps_typed_refusals()
    {
        var f = Env.Frame("05-veteran-details-career-info-deck-legacy");
        Assert.Same(f, Frames.Normalize(f));
        Assert.Throws<UnsupportedResolutionException>(() => Frames.Normalize(Pattern(1600, 900)));
        Assert.Throws<UnsupportedAspectRatioException>(() => Frames.Normalize(Pattern(1920, 1200)));
    }

    public static IEnumerable<object[]> CropCases() =>
    [
        // fixture, rect, expected decoded size, sha256 of the decoded BGRA (pre-migration build).
        ["01-veteran-details-skills-independent", new Rect(540, 95, 300, 30), 300, 30, "373939ac32afcc9a43a017be2f193b5cb84b33dbba91bdda3d0ace1e2b363656"],
        ["05-veteran-details-career-info-deck-legacy", new Rect(1900, 1060, 100, 100), 20, 20, "b11e52529564d54e18afb09b42095bd0bd5c5a17297234f273385be54981f88d"],
        ["13-support-card-list", new Rect(0, 0, 1920, 1080), 225, 127, "70619bfa9ef487048fe7cf63e618a3689fe7f498b0884ca81f56a3d428b2da20"],
        ["08-sparks-popup-oguri-cap", new Rect(100, 100, 600, 400), 293, 195, "823592d89d1685b01c212bcf6cd2537f6fa59427194c104cd5e43fa2d7ba2a78"],
    ];

    [Theory]
    [MemberData(nameof(CropCases))]
    public void Review_crop_png_is_at_most_60KiB_and_decodes_to_the_expected_pixels(string name, Rect r, int w, int h, string sha)
    {
        var png = CaptureSession.CropPng(Env.Frame(name), r);
        Assert.True(png.Length <= 60 * 1024, $"{png.Length} bytes");
        Assert.Equal(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }, png[..8]);
        var path = TempPng(png);
        try
        {
            var d = Frames.Load(path);
            Assert.Equal((w, h), (d.Width, d.Height));
            var actual = Sha(d.Bgra);
            Assert.True(sha == actual, $"decoded sha256 {actual}");
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void Unscaled_review_crop_round_trips_exact_crop_pixels()
    {
        var frame = Env.Frame("15-veteran-details-skills-manual");
        var r = new Rect(200, 300, 160, 40);
        var path = TempPng(CaptureSession.CropPng(frame, r));
        try { Assert.Equal(Frames.Crop(frame, r).Bgra, Frames.Load(path).Bgra); }
        finally { File.Delete(path); }
    }

    [Fact]
    public void Loading_a_non_image_fails_with_a_typed_error_and_releases_the_file()
    {
        var path = TempPng([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
        try
        {
            Assert.Throws<InvalidDataException>(() => Frames.Load(path));
            using (new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { }
            var truncated = Convert.FromBase64String(RgbaPng)[..40];
            File.WriteAllBytes(path, truncated);
            Assert.Throws<InvalidDataException>(() => Frames.Load(path));
            using (new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { }
        }
        finally { File.Delete(path); }
        Assert.Throws<FileNotFoundException>(() => Frames.Load(path));
    }

    [Fact]
    public void Core_has_no_SixLabors_dependency()
        => Assert.DoesNotContain(typeof(Frames).Assembly.GetReferencedAssemblies(), a => a.Name!.StartsWith("SixLabors", StringComparison.Ordinal));
}
