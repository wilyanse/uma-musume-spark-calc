using System.Collections.Concurrent;
using System.Net;
using System.Text;
using Uma.Agent.Core;
using Uma.Agent.Windows.Shell;

namespace Uma.Agent.Windows.Portable.Tests;

/// <summary>Read-only access to the repository fixtures (screenshots, recorded OCR, layout, published master bundle).</summary>
internal sealed class Repo
{
    public static string Root { get; } = FindRoot();
    private static readonly Lazy<Repo> Lazy = new(() => new Repo());
    public static Repo Instance => Lazy.Value;

    public static string Screens => Path.Combine(Root, "docs/reference/screenshots");
    public static string Fixtures => Path.Combine(Root, "agent/tests/fixtures");
    public static string LayoutsDir => Path.Combine(Root, "agent/layouts");
    public static string MasterRoot => Path.Combine(Root, "apps/web/public/master");

    public AgentData Data { get; } = AgentData.Load(LayoutsDir, MasterRoot);
    private readonly ConcurrentDictionary<string, Frame> _frames = new();

    public Frame Frame(string name) => _frames.GetOrAdd(name, n => Frames.Load(Path.Combine(Screens, n + ".png")));
    public FixtureOcrEngine Ocr(string name) => new(Path.Combine(Fixtures, "ocr", name + ".json"), Path.Combine(Fixtures, "ocr-roi", name + ".json"));
    public FrameParser Parser(string name) => new(Data.Layout, Data.Master, Data.Templates, Ocr(name));

    private static string FindRoot()
    {
        for (var d = new DirectoryInfo(AppContext.BaseDirectory); d is not null; d = d.Parent)
            if (File.Exists(Path.Combine(d.FullName, "AGENTS.md")) && Directory.Exists(Path.Combine(d.FullName, "agent"))) return d.FullName;
        throw new InvalidOperationException("repository root not found");
    }

    public static readonly string[] McQueen = ["01-veteran-details-skills-independent", "02-veteran-details-inspiration-p1", "03-veteran-details-inspiration-p2",
        "04-veteran-details-inspiration-p3", "05-veteran-details-career-info-deck-legacy", "06-veteran-details-career-info-record", "07-veteran-details-career-info-races"];
    public const string SpecialWeekPopup = "09-sparks-popup-special-week-parent", OperaPopup = "10-sparks-popup-guest-parent";
}

internal sealed class TestClock : IClock
{
    public DateTimeOffset UtcNow { get; set; } = new(2026, 10, 4, 0, 0, 0, TimeSpan.Zero);
}

/// <summary>Deterministic randomness for ULIDs: a fixed seed (tests must not depend on the OS RNG).</summary>
internal static class Seeded
{
    public static RandomFill Bytes(int seed)
    {
        var rng = new Random(seed);
        return span => rng.NextBytes(span);
    }
}

/// <summary>In-memory stand-in for DPAPI: reversible, but never stores the plaintext bytes verbatim, so the
/// "no plaintext on disk" assertions are meaningful.</summary>
internal sealed class XorProtector : ISecretProtector
{
    public int Protects { get; private set; }
    public byte[] Protect(byte[] plain) { Protects++; return [0x55, .. plain.Select(b => (byte)(b ^ 0xA7))]; }
    public byte[] Unprotect(byte[] blob)
    {
        if (blob.Length == 0 || blob[0] != 0x55) throw new System.Security.Cryptography.CryptographicException("not protected by this user");
        return blob.Skip(1).Select(b => (byte)(b ^ 0xA7)).ToArray();
    }
}

/// <summary>Scriptable API: records request headers/paths and answers with the queued responses (default: valid acks).</summary>
internal sealed class StubApi : HttpMessageHandler
{
    public List<(string Method, string Path, string? ClientId, string? Secret)> Requests { get; } = [];
    public Queue<Func<HttpRequestMessage, HttpResponseMessage>> Script { get; } = new();
    public int VeteranCount { get; private set; }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        Requests.Add((request.Method.Method, request.RequestUri!.PathAndQuery,
            request.Headers.TryGetValues("CF-Access-Client-Id", out var id) ? id.Single() : null,
            request.Headers.TryGetValues("CF-Access-Client-Secret", out var s) ? s.Single() : null));
        if (Script.Count > 0) return Task.FromResult(Script.Dequeue()(request));
        return Task.FromResult(Ack(request));
    }

    public HttpResponseMessage Ack(HttpRequestMessage request)
    {
        var path = request.RequestUri!.AbsolutePath;
        if (path.StartsWith("/api/v1/crops/", StringComparison.Ordinal))
        {
            var captureId = path["/api/v1/crops/".Length..];
            var fieldPath = Uri.UnescapeDataString(request.RequestUri.Query.TrimStart('?').Split('=', 2)[1]);
            return Json(HttpStatusCode.OK, $"{{\"cropKey\":\"crops/{captureId}/{Uri.EscapeDataString(fieldPath)}.png\"}}");
        }
        VeteranCount++;
        return Json(HttpStatusCode.Created, "{\"veteranId\":\"01K7B33MXGVZV6TZRJZDHB99Z0\",\"created\":true}");
    }

    public static HttpResponseMessage Json(HttpStatusCode code, string body)
        => new(code) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    public static HttpResponseMessage Status(HttpStatusCode code) => new(code) { Content = new StringContent("") };
}

internal static class Temp
{
    public static string Dir()
    {
        var d = Path.Combine(Path.GetTempPath(), "uma-t10-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(d);
        return d;
    }

    public static void Drop(string dir)
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (Directory.Exists(dir)) Directory.Delete(dir, true);
    }
}
