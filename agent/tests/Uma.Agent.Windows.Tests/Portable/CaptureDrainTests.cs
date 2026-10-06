using Uma.Agent.Windows.Shell;
using Xunit;

namespace Uma.Agent.Windows.Portable.Tests;

/// <summary>T10 review S1 (newest WGC frame, bounded drain) and S5 (numeric geometry diagnostics).</summary>
public class CaptureDrainTests
{
    private sealed class Item(int n) : IDisposable
    {
        public int N { get; } = n;
        public bool Disposed { get; private set; }
        public void Dispose() => Disposed = true;
    }

    [Fact]
    public void The_newest_queued_frame_is_kept_and_every_older_one_disposed()
    {
        var queue = new Queue<Item>(new[] { new Item(1), new Item(2), new Item(3) });
        var all = queue.ToArray();
        var (newest, drained) = FrameDrain.TakeNewest(() => queue.Count > 0 ? queue.Dequeue() : null, 8);
        Assert.Equal(3, newest!.N);
        Assert.Equal(3, drained);
        Assert.False(newest.Disposed);
        Assert.True(all[0].Disposed && all[1].Disposed);
    }

    [Fact]
    public void An_empty_pool_yields_nothing()
    {
        var (newest, drained) = FrameDrain.TakeNewest<Item>(() => null, 8);
        Assert.Null(newest);
        Assert.Equal(0, drained);
    }

    [Fact]
    public void A_producer_that_never_runs_dry_is_drained_at_most_max_times()
    {
        var made = new List<Item>();
        var (newest, drained) = FrameDrain.TakeNewest(() => { var i = new Item(made.Count); made.Add(i); return i; }, 8);
        Assert.Equal(8, drained);
        Assert.Equal(8, made.Count);
        Assert.Same(made[^1], newest);
        Assert.All(made.Take(7), i => Assert.True(i.Disposed));
    }

    [Fact]
    public void A_failing_drain_disposes_what_it_already_took()
    {
        var first = new Item(1);
        var n = 0;
        Assert.Throws<InvalidOperationException>(() => FrameDrain.TakeNewest(() => ++n == 1 ? first : throw new InvalidOperationException("device lost"), 8));
        Assert.True(first.Disposed);
    }

    [Fact]
    public void Geometry_diagnostics_are_numbers_only_and_reported_once_per_change()
    {
        var d = new GeometryDiagnostics();
        var text = d.Report("size-mismatch", texture: (1936, 1119), bitmap: null, frame: (100, 50, 1938, 1121), client: (108, 81, 1920, 1080));
        Assert.Equal("Capture geometry size-mismatch: texture 1936x1119; dwm frame 1938x1121 at 100,50; client 1920x1080 at 108,81", text);
        Assert.Matches(@"^Capture geometry [a-z-]+: [0-9x,; a-z]+$", text);
        Assert.Null(d.Report("size-mismatch", (1936, 1119), null, (100, 50, 1938, 1121), (108, 81, 1920, 1080)));   // unchanged: not repeated
        Assert.NotNull(d.Report("size-mismatch", (1936, 1119), null, (100, 50, 1940, 1121), (108, 81, 1920, 1080)));
        Assert.Contains("bitmap 10x10", d.Report("bitmap-mismatch", (1936, 1119), (10, 10), (0, 0, 1, 1), (0, 0, 1, 1)));
        d.Clear();
        Assert.NotNull(d.Report("bitmap-mismatch", (1936, 1119), (10, 10), (0, 0, 1, 1), (0, 0, 1, 1)));
    }
}
