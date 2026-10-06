using Uma.Agent.Core;
using Uma.Agent.Windows.Shell;
using Xunit;

namespace Uma.Agent.Windows.Portable.Tests;

/// <summary>T10 review round 1: S3 (malformed settings), N1 (own window), N2 (address compare), N3 (typed messages).</summary>
public class ReviewRound1Tests
{
    private static string Defaults => Path.Combine(Repo.Root, "agent/src/Uma.Agent.Windows/appsettings.json");

    [Theory]
    [InlineData("{not json")]
    [InlineData("")]
    [InlineData("[1,2]")]
    [InlineData("{\"apiBaseUrl\": 5}")]
    public void Malformed_settings_are_backed_up_and_defaults_load_with_an_actionable_notice(string content)
    {
        var dir = Temp.Dir();
        try
        {
            var path = Path.Combine(dir, "settings.json");
            File.WriteAllText(path, content);
            var clock = new TestClock { UtcNow = new DateTimeOffset(2026, 10, 6, 1, 2, 3, TimeSpan.Zero) };
            var store = new SettingsStore(path, Defaults, clock);
            var s = store.Load();
            Assert.Equal(new AgentSettings("", "UmamusumePrettyDerby", ""), s);   // shipped defaults: uploads paused
            Assert.False(ApiAddress.TryParse(s.ApiBaseUrl, out _, out _));
            var backup = Path.Combine(dir, "settings.json.bad-20261006T010203Z");
            Assert.Equal(content, File.ReadAllText(backup));                     // the user's bytes are kept, not lost
            Assert.False(File.Exists(path));                                      // the bad file no longer blocks startup
            Assert.NotNull(store.Notice);
            Assert.Contains("settings.json.bad-20261006T010203Z", store.Notice);
            Assert.Contains("Settings", store.Notice);
            // A second start is clean and does not create another backup.
            var again = new SettingsStore(path, Defaults, clock);
            Assert.Equal(s, again.Load());
            Assert.Null(again.Notice);
            Assert.Single(Directory.GetFiles(dir, "settings.json.bad-*"));
        }
        finally { Temp.Drop(dir); }
    }

    [Fact]
    public void A_backup_never_overwrites_an_earlier_backup()
    {
        var dir = Temp.Dir();
        try
        {
            var path = Path.Combine(dir, "settings.json");
            var clock = new TestClock { UtcNow = new DateTimeOffset(2026, 10, 6, 1, 2, 3, TimeSpan.Zero) };
            File.WriteAllText(path, "{first");
            new SettingsStore(path, Defaults, clock).Load();
            File.WriteAllText(path, "{second");
            var store = new SettingsStore(path, Defaults, clock);
            store.Load();
            Assert.Equal("{first", File.ReadAllText(Path.Combine(dir, "settings.json.bad-20261006T010203Z")));
            Assert.Equal("{second", File.ReadAllText(Path.Combine(dir, "settings.json.bad-20261006T010203Z-1")));
            Assert.Contains("bad-20261006T010203Z-1", store.Notice);
        }
        finally { Temp.Drop(dir); }
    }

    [Fact]
    public void Null_and_partial_settings_still_fall_back_without_a_backup()
    {
        var dir = Temp.Dir();
        try
        {
            var path = Path.Combine(dir, "settings.json");
            File.WriteAllText(path, "null");
            var store = new SettingsStore(path, Defaults, new TestClock());
            Assert.Equal(new AgentSettings("", "UmamusumePrettyDerby", ""), store.Load());
            Assert.Null(store.Notice);
            File.WriteAllText(path, "{\"apiBaseUrl\":\"http://evil/\",\"processName\":\"x\"}");
            var loaded = store.Load();
            Assert.Equal("x", loaded.ProcessName);
            Assert.False(ApiAddress.TryParse(loaded.ApiBaseUrl, out _, out _));   // uploads stay refused
            Assert.Empty(Directory.GetFiles(dir, "*.bad-*"));
        }
        finally { Temp.Drop(dir); }
    }

    [Theory]
    [InlineData("https://uma.example.test", "https://uma.example.test/", false)]
    [InlineData(" https://UMA.example.test/ ", "https://uma.example.test/", false)]
    [InlineData("https://uma.example.test/a", "https://uma.example.test/a/", false)]
    [InlineData("https://uma.example.test/a", "https://uma.example.test/b/", true)]
    [InlineData("", "https://uma.example.test/", true)]
    [InlineData("", "", false)]
    [InlineData("https://other.example.test/", "https://uma.example.test/", true)]
    public void Destination_change_compares_normalised_addresses(string dialog, string saved, bool changed)
        => Assert.Equal(changed, ApiAddress.Changes(saved, dialog));

    private static WindowInfo W(long h, string process, string title, int pid = 10) => new(h, process, title, true, false, 1920, 1080) { ProcessId = pid };

    [Fact]
    public void Title_fallback_never_selects_the_agent_itself()
    {
        var windows = new[] { W(1, "Uma.Agent.Windows", "Uma Spark Calc — assisted capture", 42), W(2, "Game", "Uma Spark Calc notes", 7) };
        var s = WindowSelector.Select(windows, "UmamusumePrettyDerby", "Uma Spark Calc", ownProcessId: 42);
        Assert.Equal(2, s.Window!.Handle);
        var only = WindowSelector.Select([windows[0]], "UmamusumePrettyDerby", "Uma Spark Calc", ownProcessId: 42);
        Assert.Null(only.Window);
        // Even when configured as the "game" process, the agent never captures itself.
        Assert.Null(WindowSelector.Select([windows[0]], "Uma.Agent.Windows", "", ownProcessId: 42).Window);
    }

    [Theory]
    [InlineData(typeof(UnsupportedFrameException))]
    [InlineData(typeof(CaptureUnavailableException))]
    [InlineData(typeof(ArgumentException))]
    [InlineData(typeof(ServiceTokenMissingException))]
    public void Known_local_errors_show_their_own_typed_message(Type type)
    {
        var e = type == typeof(UnsupportedFrameException) ? Frames().Item2! : (Exception)Activator.CreateInstance(type, "Specific actionable text.")!;
        Assert.Equal(e.Message, UserMessages.For(e));
    }

    private static (Frame, Exception?) Frames()
    {
        try { Uma.Agent.Core.Frames.Normalize(new Frame(new byte[1280 * 720 * 4], 1280, 720)); return (null!, null); }
        catch (UnsupportedFrameException e) { return (null!, e); }
    }

    [Fact]
    public void Unknown_errors_show_only_a_category_never_their_message()
    {
        var e = new InvalidOperationException("token=abc https://secret.example/");
        var text = UserMessages.For(e);
        Assert.DoesNotContain("abc", text);
        Assert.DoesNotContain("secret.example", text);
        Assert.Contains("InvalidOperationException", text);
        Assert.Contains("logs", text);
        Assert.DoesNotContain("abc", UserMessages.For(new System.Net.Http.HttpRequestException("abc")));
    }
}
