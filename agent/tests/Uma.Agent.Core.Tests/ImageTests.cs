using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using Xunit;

namespace Uma.Agent.Core.Tests;
public class ImageTests
{
    private static string Repo => Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../../"));

    [Fact]
    public void Ties_and_crop_jitter_never_force_an_identity()
    {
        var hashes = new Dictionary<string, IReadOnlyList<string>> { ["a"] = ["ffffffffffffffff"], ["b"] = ["ffffffffffffffff"] };
        var match = ImageMatcher.Find("ffffffffffffffff", hashes);
        Assert.False(match.Accepted);
        Assert.Null(match.Id);
        Assert.Equal(0, match.Margin);
        Assert.Equal("a", ImageMatcher.Find("ffffffffffffffff", new Dictionary<string, IReadOnlyList<string>> { ["a"] = ["ffffffffffffffff"] }).Id);
    }

    [Fact]
    public void First_real_support_card_tile_matches_committed_portrait_only_when_confident()
    {
        var root = Repo;
        using var image = Image.Load<Rgba32>(Path.Combine(root, "docs/reference/screenshots/13-support-card-list.png"));
        var hashes = ImageMatcher.LoadHashes(Path.Combine(root, "apps/web/public/master/global-20260930/cards.json"), "artHashes");
        ImageMatch Probe(int offset)
        {
            const int width = 101, height = 134;
            var bytes = new byte[width * height * 4];
            for (int y = 0; y < height; y++) for (int x = 0; x < width; x++)
            {
                var rgba = image[273 + offset + x, 93 + y]; var p = (y * width + x) * 4;
                bytes[p] = rgba.B; bytes[p + 1] = rgba.G; bytes[p + 2] = rgba.R; bytes[p + 3] = rgba.A;
            }
            return ImageMatcher.Find(PixelAlgorithms.DHash(new Frame(bytes, width, height), LayoutProfiles.CardArtCrop), hashes);
        }
        var aligned = Probe(0);
        Assert.True(aligned.Accepted, $"aligned: distance {aligned.Distance}, margin {aligned.Margin}");
        Assert.Equal("card:the-brightest-star-in-japan-special-week", aligned.Id);
        var shifted = Probe(-3);
        Assert.False(shifted.Accepted);
        Assert.Null(shifted.Id);
    }
}
