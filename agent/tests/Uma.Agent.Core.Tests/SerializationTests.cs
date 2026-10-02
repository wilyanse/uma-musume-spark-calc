using System.Text.Json;
using Xunit;
namespace Uma.Agent.Core.Tests;

public class SerializationTests
{
    internal static string Repo => Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../../"));
    internal static VeteranCapture Capture()
    {
        using var vectors = JsonDocument.Parse(File.ReadAllText(Path.Combine(Repo, "packages/schema/test/fingerprint.vectors.json")));
        var veteran = JsonSerializer.Deserialize<Veteran>(vectors.RootElement.GetProperty("vectors")[0].GetProperty("input"), CaptureJson.Options)!;
        return new(1, "01K7B33MXGVZV6TZRJZDHB99YE", new(2026,9,30,0,0,0,TimeSpan.Zero), "test", "layout", "master", Fingerprint.Hash(veteran), veteran, []);
    }
    [Fact]
    public void Actual_serializer_round_trips_flat_aptitudes_and_enum_names()
    {
        var capture = Capture();
        var json = CaptureJson.Serialize(capture);
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(10, doc.RootElement.GetProperty("veteran").GetProperty("aptitudes").EnumerateObject().Count());
        Assert.False(doc.RootElement.GetProperty("veteran").GetProperty("aptitudes").TryGetProperty("values", out _));
        Assert.Equal(capture.Veteran.TrainMode.ToString(), doc.RootElement.GetProperty("veteran").GetProperty("trainMode").GetString());
        var copy = CaptureJson.Deserialize(json);
        Assert.Empty(CaptureValidation.Validate(copy));
        Assert.Equal(capture.Fingerprint, Fingerprint.Hash(copy.Veteran));
        Assert.Contains("2026-09-30T00:00:00Z", json);
    }
    [Fact]
    public void Reversed_deck_and_parents_are_rejected_without_sorting()
    {
        var capture = Capture();
        Assert.Contains(CaptureValidation.Validate(capture with { Veteran = capture.Veteran with { Deck = capture.Veteran.Deck.AsEnumerable().Reverse().ToList() } }), s => s.Contains("deck slots"));
        Assert.Contains(CaptureValidation.Validate(capture with { Veteran = capture.Veteran with { Parents = capture.Veteran.Parents.AsEnumerable().Reverse().ToList() } }), s => s.Contains("parent slots"));
    }
    [Theory]
    [InlineData("/stats", true)]
    [InlineData("/career", true)]
    [InlineData("/sparks/0/sparkId", true)]
    [InlineData("/sparks/0/owner", false)]
    [InlineData("/deck/0/slot", false)]
    [InlineData("/parents/0/slot", false)]
    [InlineData("/sparks", false)]
    [InlineData("/sparks/0", false)]
    [InlineData("/skills/0", false)]
    [InlineData("/trainMode", false)]
    [InlineData("/__proto__/x", false)]
    [InlineData("/constructor/prototype", false)]
    [InlineData("/sparks/999/stars", false)]
    [InlineData("/sparks/parent2", true)]
    [InlineData("/deck/00/lb", false)]
    public void Merged_API_correctability(string path, bool allowed)
    {
        var capture = Capture() with { Fields = [new(path, null, null, .1, FieldStatus.low_confidence, [], null)] };
        Assert.Equal(!allowed, CaptureValidation.Validate(capture).Any(s => s.Contains("not correctable")));
    }
}
