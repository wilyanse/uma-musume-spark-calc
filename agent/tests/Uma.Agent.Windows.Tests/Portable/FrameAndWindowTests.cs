using Uma.Agent.Core;
using Uma.Agent.Windows.Shell;
using Xunit;

namespace Uma.Agent.Windows.Portable.Tests;

public class FrameAndWindowTests
{
    private static Repo R => Repo.Instance;

    [Fact]
    public void Ulid_encodes_time_like_the_reference_implementation_and_is_deterministic_with_a_seed()
    {
        // ULID spec example: timestamp 1469918176385 encodes as the 10-char time prefix "01ARYZ6S41".
        var g = new UlidGenerator(new TestClock { UtcNow = DateTimeOffset.FromUnixTimeMilliseconds(1469918176385) }, Seeded.Bytes(7));
        var a = g.Next();
        Assert.StartsWith("01ARYZ6S41", a);
        Assert.Matches("^[0-7][0-9A-HJKMNP-TV-Z]{25}$", a);
        var b = new UlidGenerator(new TestClock { UtcNow = DateTimeOffset.FromUnixTimeMilliseconds(1469918176385) }, Seeded.Bytes(7)).Next();
        Assert.Equal(a, b);
        Assert.NotEqual(a, g.Next());
    }

    [Fact]
    public void Frame_gate_skips_an_unchanged_whole_frame_dhash_and_passes_changes()
    {
        var clock = new TestClock();
        var gate = new FrameGate(clock, TimeSpan.FromSeconds(2));
        var f02 = R.Frame(Repo.McQueen[1]); var f03 = R.Frame("15-veteran-details-skills-manual");
        Assert.True(gate.ShouldProcess(f02));
        Assert.False(gate.ShouldProcess(f02));
        Assert.False(gate.ShouldProcess(f02 with { Bgra = (byte[])f02.Bgra.Clone() }));   // same pixels, new buffer
        Assert.NotEqual(FrameGate.Hash(f02), FrameGate.Hash(f03));   // a scrolled list changes the whole-frame dHash
        Assert.True(gate.ShouldProcess(f03));
    }

    [Fact]
    public void Frame_gate_reprocesses_a_still_frame_after_the_refresh_interval_and_after_a_resize()
    {
        var clock = new TestClock();
        var gate = new FrameGate(clock, TimeSpan.FromSeconds(2));
        var f = R.Frame(Repo.McQueen[0]);
        Assert.True(gate.ShouldProcess(f));
        clock.UtcNow += TimeSpan.FromMilliseconds(1999);
        Assert.False(gate.ShouldProcess(f));
        clock.UtcNow += TimeSpan.FromMilliseconds(1);
        Assert.False(gate.ShouldProcess(f with { Bgra = (byte[])f.Bgra.Clone() }));   // re-checked, but byte-identical: not re-read (B1)
        clock.UtcNow += TimeSpan.FromSeconds(2);
        var moved = f with { Bgra = (byte[])f.Bgra.Clone() };
        moved.Bgra[0] ^= 0xFF;   // one changed byte keeps the 64-bit dHash ...
        Assert.Equal(FrameGate.Hash(f), FrameGate.Hash(moved));
        Assert.True(gate.ShouldProcess(moved));   // ... and is re-read after the refresh interval
        var small = new Frame(new byte[16 * 9 * 4], 16, 9);
        Assert.True(gate.ShouldProcess(small));   // size change always counts
        gate.Reset();
        Assert.True(gate.ShouldProcess(small));
        Assert.True(gate.ShouldProcess(new Frame(new byte[4], 1, 1)));   // too small to hash: never silently skipped
    }

    private static WindowInfo W(long h, string process, string title, int cw = 1920, int ch = 1080, bool visible = true, bool minimized = false)
        => new(h, process, title, visible, minimized, cw, ch);

    [Fact]
    public void Window_selection_prefers_the_configured_process_then_the_title_fallback()
    {
        var windows = new[]
        {
            W(1, "explorer", "Umamusume fan wiki - Explorer"),
            W(2, "UmamusumePrettyDerby", "", 0, 0, visible: false),
            W(3, "UmamusumePrettyDerby", "Umamusume", 1600, 900),
            W(4, "UmamusumePrettyDerby", "Umamusume", 1920, 1080),
            W(5, "notepad", "Umamusume notes"),
        };
        var s = WindowSelector.Select(windows, "umamusumeprettyderby.EXE", "Umamusume");
        Assert.Equal(4, s.Window!.Handle);   // largest visible client area of the configured process
        Assert.Contains("process", s.Reason);

        var fallback = WindowSelector.Select(windows.Where(w => w.ProcessName != "UmamusumePrettyDerby").ToArray(), "UmamusumePrettyDerby", "umamusume notes");
        Assert.Equal(5, fallback.Window!.Handle);
        Assert.Contains("title", fallback.Reason);

        var none = WindowSelector.Select([W(1, "explorer", "x")], "UmamusumePrettyDerby", "");
        Assert.Null(none.Window);
        Assert.Contains("UmamusumePrettyDerby", none.Reason);

        var minimized = WindowSelector.Select([W(9, "UmamusumePrettyDerby", "U", minimized: true)], "UmamusumePrettyDerby", "");
        Assert.Null(minimized.Window);
        Assert.Contains("minimized", minimized.Reason);
    }

    [Fact]
    public void Ambiguous_title_matches_are_refused_rather_than_guessed()
    {
        var s = WindowSelector.Select([W(1, "a", "Umamusume"), W(2, "b", "Umamusume")], "UmamusumePrettyDerby", "Umamusume");
        Assert.Null(s.Window);
        Assert.Contains("2 windows", s.Reason);
    }

    [Theory]
    // window frame (screen) x,y ; client origin (screen) x,y ; client w,h ; captured texture w,h ; expected crop or null
    [InlineData(100, 50, 108, 81, 1920, 1080, 1936, 1119, 8, 31, 1920, 1080)]
    [InlineData(0, 0, 0, 0, 1920, 1080, 1920, 1080, 0, 0, 1920, 1080)]
    public void Client_area_is_cropped_from_the_window_capture(int fx, int fy, int cx, int cy, int cw, int ch, int tw, int th, int ex, int ey, int ew, int eh)
        => Assert.Equal(new Rect(ex, ey, ew, eh), ClientArea.Within(fx, fy, cx, cy, cw, ch, tw, th));

    [Theory]
    [InlineData(100, 50, 108, 81, 1920, 1080, 1900, 1119)]   // the texture lags a resize: client would be clipped
    [InlineData(100, 50, 90, 81, 1920, 1080, 1936, 1119)]    // client left of the frame: inconsistent geometry
    [InlineData(0, 0, 0, 0, 0, 1080, 1920, 1080)]            // minimized / empty client
    public void Inconsistent_or_clipped_client_geometry_yields_no_frame(int fx, int fy, int cx, int cy, int cw, int ch, int tw, int th)
        => Assert.Null(ClientArea.Within(fx, fy, cx, cy, cw, ch, tw, th));

    [Fact]
    public void Client_crop_copies_rows_honouring_the_stride_and_forces_opaque_alpha()
    {
        const int w = 4, h = 3, stride = 20;   // 4 px * 4 B + 4 B padding
        var src = new byte[stride * h];
        for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var p = y * stride + x * 4; src[p] = (byte)(10 * y + x); src[p + 1] = 1; src[p + 2] = 2; src[p + 3] = 0; }
        var f = FrameCopy.Crop(src, stride, w, h, new Rect(1, 1, 2, 2));
        Assert.Equal((2, 2), (f.Width, f.Height));
        Assert.Equal(new byte[] { 11, 1, 2, 255, 12, 1, 2, 255, 21, 1, 2, 255, 22, 1, 2, 255 }, f.Bgra);
        Assert.Throws<ArgumentOutOfRangeException>(() => FrameCopy.Crop(src, stride, w, h, new Rect(3, 0, 2, 1)));
    }

    [Fact]
    public void Ocr_roi_is_upscaled_twice_within_the_engine_limit_and_boxes_map_back_to_reference_space()
    {
        Assert.Equal(2.0, OcrGeometry.Scale(new Rect(0, 0, 300, 30), 2600));
        Assert.Equal(2600.0 / 1920, OcrGeometry.Scale(new Rect(0, 0, 1920, 1080), 2600), 6);
        Assert.Equal(1.0, OcrGeometry.Scale(new Rect(0, 0, 3000, 30), 2600));   // never downscale
        var box = OcrGeometry.ToReference(new Rect(540, 95, 300, 30), 2.0, 46.4, 4.2, 300.6, 51.0);
        Assert.Equal(new Rect(563, 97, 151, 26), box);
        Assert.Equal(new Rect(10, 20, 15, 25), OcrGeometry.Union([new Rect(10, 20, 5, 5), new Rect(20, 30, 5, 15)]));

        var frame = R.Frame(Repo.McQueen[0]);
        var crop = OcrGeometry.Upscale(frame, new Rect(540, 95, 300, 30), 2.0);
        Assert.Equal((600, 60), (crop.Width, crop.Height));
        Assert.Throws<NonReferenceFrameException>(() => OcrGeometry.Upscale(new Frame(new byte[1280 * 720 * 4], 1280, 720), new Rect(0, 0, 10, 10), 2));
    }

    [Fact]
    public void Ocr_lines_are_post_filtered_for_digit_mode_and_get_the_documented_constant_confidence()
    {
        var lines = OcrGeometry.Finish([("Speed 1,234", new Rect(1, 2, 3, 4)), ("RANK", new Rect(5, 6, 7, 8))], OcrMode.Digits);
        var only = Assert.Single(lines);
        Assert.Equal("1,234", only.Text);
        Assert.Equal(OcrGeometry.WindowsOcrConfidence, only.Confidence);
        var text = OcrGeometry.Finish([("A", new Rect(0, 0, 1, 1)), (" ", new Rect(0, 0, 1, 1)), ("B", new Rect(0, 0, 1, 1))], OcrMode.Text);
        Assert.Equal(["A", "B"], text.Select(l => l.Text));   // whitespace-only lines are dropped
    }
}
