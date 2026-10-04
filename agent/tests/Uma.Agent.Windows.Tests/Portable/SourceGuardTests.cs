using System.Text.RegularExpressions;
using Xunit;

namespace Uma.Agent.Windows.Portable.Tests;

/// <summary>Static guards over the Windows shell sources (assisted mode only, 30 §7 / 00 §6; no secrets in logs).</summary>
public class SourceGuardTests
{
    private static IEnumerable<(string Path, string Text)> Sources()
        => Directory.GetFiles(Path.Combine(Repo.Root, "agent/src/Uma.Agent.Windows"), "*.*", SearchOption.AllDirectories)
            .Where(p => !p.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}") && !p.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}"))
            .Where(p => p.EndsWith(".cs", StringComparison.Ordinal) || p.EndsWith(".xaml", StringComparison.Ordinal) || p.EndsWith(".csproj", StringComparison.Ordinal))
            .Select(p => (p, File.ReadAllText(p)));

    [Fact]
    public void Shell_sources_exist() => Assert.True(Sources().Count() >= 10);

    [Theory]
    // Input injection (T14 only), game memory and network inspection are out of scope (00 §6).
    [InlineData(@"\bSendInput\b")]
    [InlineData(@"\bkeybd_event\b")]
    [InlineData(@"\bmouse_event\b")]
    [InlineData(@"\bPostMessage\w*\b")]
    [InlineData(@"\bSendMessage\w*\b")]
    [InlineData(@"\bSetCursorPos\b")]
    [InlineData(@"\bReadProcessMemory\b")]
    [InlineData(@"\bWriteProcessMemory\b")]
    [InlineData(@"\bOpenProcess\b")]
    [InlineData(@"\bVirtualQueryEx\b")]
    [InlineData(@"\bSetWindowsHookEx\b")]
    [InlineData(@"\bWinDivert\b|\bPcap\b|\bSharpPcap\b|\bRawSocket\b")]
    [InlineData(@"SocketType\.Raw")]
    public void No_input_injection_memory_or_network_inspection(string pattern)
    {
        foreach (var (path, text) in Sources())
            Assert.False(Regex.IsMatch(text, pattern), $"{pattern} found in {path}");
    }

    [Fact]
    public void Log_calls_never_interpolate_token_values()
    {
        var log = new Regex(@"(Log\.\w+|_log\.\w+|log\.\w+|Logger\.\w+)\((?<args>[^;]*)\);");
        foreach (var (path, text) in Sources())
            foreach (Match m in log.Matches(text))
                Assert.False(Regex.IsMatch(m.Groups["args"].Value, @"(?i)secret|clientId|tokenValue|\bid\b\s*[,)}]"), $"{path}: {m.Value}");
    }

    [Fact]
    public void Http_clients_are_built_only_from_the_no_redirect_handler()
    {
        foreach (var (path, text) in Sources())
        {
            Assert.DoesNotContain("new HttpClientHandler", text);
            Assert.DoesNotContain("new SocketsHttpHandler", text);
            Assert.False(Regex.IsMatch(text, @"new HttpClient\(\s*\)"), path);
        }
        Assert.Contains(Sources(), s => s.Text.Contains("UploadClient.CreateHandler()", StringComparison.Ordinal));
    }
}
