using System.Text.Json;
using System.Text.Json.Nodes;
using Uma.Agent.Core;
using Uma.Agent.Windows.Shell;
using Xunit;

namespace Uma.Agent.Windows.Portable.Tests;

public class OcrRecordingTests
{
    private static Repo R => Repo.Instance;
    private const string Deck = "05-veteran-details-career-info-deck-legacy", List = "13-support-card-list";

    [Fact]
    public void Roi_plan_reproduces_the_committed_per_roi_recording_rois_from_the_layout()
    {
        foreach (var name in new[] { Deck, List })
        {
            var committed = JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Fixtures, "ocr-roi", name + ".json")))!["roiLines"]!.AsArray()
                .Select(r => r!["roi"]!.AsArray().Select(v => v!.GetValue<int>()).ToArray()).Select(a => new Rect(a[0], a[1], a[2], a[3])).ToArray();
            Assert.Equal(committed, RoiPlan.For(name, R.Data.Layout));
        }
        Assert.Empty(RoiPlan.For("01-veteran-details-skills-independent", R.Data.Layout));
        Assert.Equal(["05-veteran-details-career-info-deck-legacy", "13-support-card-list"], RoiPlan.Fixtures);
    }

    /// <summary>Format compatibility: replaying the committed Apple Vision ROI recording through the recorder (the
    /// recorder only calls IOcrEngine) yields byte-for-byte the same roiLines, and the written files load in
    /// FixtureOcrEngine. This is a format check, not a Windows OCR result.</summary>
    [Fact]
    public async Task Recorder_output_is_loadable_by_the_fixture_engine_and_matches_the_committed_format()
    {
        var dir = Temp.Dir();
        try
        {
            var replay = R.Ocr(Deck);
            var recorder = new OcrRecorder(replay, "replay-of-committed-recording", R.Data.Layout);
            var png = Path.Combine(Repo.Screens, Deck + ".png");
            var written = await recorder.RecordAsync(png, dir, overwrite: false);
            Assert.Equal([Path.Combine(dir, "ocr", Deck + ".json"), Path.Combine(dir, "ocr-roi", Deck + ".json")], written);

            var roi = JsonNode.Parse(File.ReadAllText(written[1]))!.AsObject();
            var committed = JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Fixtures, "ocr-roi", Deck + ".json")))!.AsObject();
            Assert.Equal("replay-of-committed-recording-roi-x2", roi["engine"]!.GetValue<string>());
            Assert.Equal(Deck, roi["fixture"]!.GetValue<string>());
            Assert.True(JsonNode.DeepEquals(committed["roiLines"], roi["roiLines"]));

            var full = JsonNode.Parse(File.ReadAllText(written[0]))!.AsObject();
            Assert.Equal("replay-of-committed-recording", full["engine"]!.GetValue<string>());
            Assert.Equal([1920, 1080], full["reference"]!.AsArray().Select(v => v!.GetValue<int>()));
            var lines = full["lines"]!.AsArray();
            Assert.NotEmpty(lines);
            var ys = lines.Select(l => l!["box"]![1]!.GetValue<int>()).ToArray();
            Assert.Equal(ys.Order(), ys);   // sorted top-to-bottom (30 Appendix A)

            // Both files load in Core's replay engine and answer an ROI read the way Core expects.
            var engine = new FixtureOcrEngine(written[0], written[1]);
            var levels = await engine.ReadAsync(R.Frame(Deck), new Rect(287, 598, 76, 34), OcrMode.Text);
            Assert.Equal(await R.Ocr(Deck).ReadAsync(R.Frame(Deck), new Rect(287, 598, 76, 34), OcrMode.Text), levels);
        }
        finally { Temp.Drop(dir); }
    }

    [Fact]
    public async Task Recorder_never_overwrites_existing_recordings_unless_explicitly_told()
    {
        var dir = Temp.Dir();
        try
        {
            var recorder = new OcrRecorder(R.Ocr(Deck), "replay", R.Data.Layout);
            var png = Path.Combine(Repo.Screens, Deck + ".png");
            Directory.CreateDirectory(Path.Combine(dir, "ocr-roi"));
            var existing = Path.Combine(dir, "ocr-roi", Deck + ".json");
            File.WriteAllText(existing, "{\"keep\":true}");
            var e = await Assert.ThrowsAsync<IOException>(() => recorder.RecordAsync(png, dir, overwrite: false));
            Assert.Contains("--overwrite", e.Message);
            Assert.Equal("{\"keep\":true}", File.ReadAllText(existing));
            Assert.False(File.Exists(Path.Combine(dir, "ocr", Deck + ".json")));   // checked before anything is written

            await recorder.RecordAsync(png, dir, overwrite: true);
            Assert.NotEqual("{\"keep\":true}", File.ReadAllText(existing));
        }
        finally { Temp.Drop(dir); }
    }

    [Fact]
    public async Task Recorder_refuses_frames_that_are_not_the_reference_size_and_writes_nothing()
    {
        var dir = Temp.Dir();
        try
        {
            var png = Path.Combine(dir, "small.png");
            using (var img = new SixLabors.ImageSharp.Image<SixLabors.ImageSharp.PixelFormats.Rgba32>(1280, 720)) await SixLabors.ImageSharp.ImageExtensions.SaveAsPngAsync(img, png);
            var recorder = new OcrRecorder(R.Ocr(Deck), "replay", R.Data.Layout);
            await Assert.ThrowsAsync<NonReferenceFrameException>(() => recorder.RecordAsync(png, Path.Combine(dir, "out"), overwrite: false));
            Assert.False(Directory.Exists(Path.Combine(dir, "out")));
        }
        finally { Temp.Drop(dir); }
    }

    [Fact]
    public void Default_output_is_a_fresh_scratch_directory_not_the_committed_fixtures()
    {
        var o = CommandLineOptions.Parse(["--record-ocr", "a.png"]);
        Assert.Equal(AgentMode.RecordOcr, o.Mode);
        Assert.NotNull(o.OutputDirectory);
        Assert.DoesNotContain(Path.Combine("agent", "tests", "fixtures"), o.OutputDirectory!);
        Assert.False(o.Overwrite);
        Assert.Equal(["a.png"], o.Inputs);
    }

    [Theory]
    [InlineData(new string[0], AgentMode.Tray)]
    [InlineData(new[] { "--record-ocr", "x.png", "y.png", "--out", "d", "--overwrite" }, AgentMode.RecordOcr)]
    [InlineData(new[] { "--help" }, AgentMode.Help)]
    public void Command_line_modes(string[] args, AgentMode mode)
    {
        var o = CommandLineOptions.Parse(args);
        Assert.Equal(mode, o.Mode);
        if (mode == AgentMode.RecordOcr) { Assert.Equal(["x.png", "y.png"], o.Inputs); Assert.Equal("d", o.OutputDirectory); Assert.True(o.Overwrite); }
    }

    [Theory]
    [InlineData("--record-ocr")]
    [InlineData("--record-ocr --out")]
    [InlineData("--bogus")]
    [InlineData("--out d")]
    public void Command_line_errors_are_reported(string line)
        => Assert.Throws<ShellValidationException>(() => CommandLineOptions.Parse(line.Split(' ')));

    [Fact]
    public void Recording_engine_names_say_what_produced_them()
    {
        Assert.Equal("windows-media-ocr-en-US", OcrRecorder.WindowsEngineName("en-US"));
        Assert.Equal("windows-media-ocr-en-US-roi-x2", OcrRecorder.RoiEngineName(OcrRecorder.WindowsEngineName("en-US")));
    }
}
