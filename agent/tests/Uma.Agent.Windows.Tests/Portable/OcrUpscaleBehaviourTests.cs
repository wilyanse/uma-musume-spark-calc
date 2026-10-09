using System.Security.Cryptography;
using Uma.Agent.Core;
using Uma.Agent.Windows.Shell;
using Xunit;

namespace Uma.Agent.Windows.Portable.Tests;

/// <summary>T16b (64): OCR ROI upscaling must keep its geometry and the calibrated bicubic output across the
/// image-library migration. Expected hashes were produced by the pre-migration ImageSharp 3.1.12 build.</summary>
public class OcrUpscaleBehaviourTests
{
    private static Repo R => Repo.Instance;

    private static string Sha(byte[] b) => Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant();

    // Sizes use Math.Round (banker's rounding): 1080 x 2600/1920 = 1462.5 -> 1462 and 3 x 1.5 = 4.5 -> 4.
    [Theory]
    [InlineData("01-veteran-details-skills-independent", 540, 95, 300, 30, 2.0, 600, 60, "6869da0296a646e6d879fdd66de4e520b74ed2c22cf668f2dfa0eb144b7e143c")]
    [InlineData("05-veteran-details-career-info-deck-legacy", 0, 0, 1920, 1080, 2600.0 / 1920, 2600, 1462, "66d3a84cf5325f3cd42d0ec7c3fa59c288696fb082850ec7288ebfb25e2359f1")]
    [InlineData("13-support-card-list", 273, 93, 101, 134, 2.0, 202, 268, "edbd1c24faf82f3e6cbf33fce0792a792e4c350f2089f888b3990363d3f052ea")]
    [InlineData("10-sparks-popup-guest-parent", 11, 7, 3, 1, 1.5, 4, 2, "cd4f07a654feeb0fff07380d836cd3cdc41ccd5885efb6a4e05dbf6c9c33320c")]
    public void Upscaled_roi_keeps_rounded_size_and_calibrated_pixels(string name, int x, int y, int w, int h, double scale, int ew, int eh, string sha)
    {
        var crop = OcrGeometry.Upscale(R.Frame(name), new Rect(x, y, w, h), scale);
        Assert.Equal((ew, eh), (crop.Width, crop.Height));
        Assert.Equal(ew * eh * 4, crop.Bgra.Length);
        var actual = Sha(crop.Bgra);
        Assert.True(sha == actual, $"upscaled sha256 {actual}");
    }

    [Fact]
    public void Scale_one_returns_the_exact_crop()
    {
        var frame = R.Frame(Repo.McQueen[0]);
        var roi = new Rect(540, 95, 300, 30);
        Assert.Equal(Frames.Crop(frame, roi).Bgra, OcrGeometry.Upscale(frame, roi, 1.0).Bgra);
    }
}
