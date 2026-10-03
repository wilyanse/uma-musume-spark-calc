using System.Text.Json;
using Xunit;

namespace Uma.Agent.Core.Tests;

public class ContractParityTests
{
    private static string Repo => Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../../"));

    private static Veteran ParseVeteran(JsonElement input, JsonSerializerOptions options)
    {
        return JsonSerializer.Deserialize<Veteran>(input.GetRawText(), options)!;
    }

    [Fact]
    public void Fingerprint_matches_every_shared_vector()
    {
        using var file = JsonDocument.Parse(File.ReadAllText(Path.Combine(Repo, "packages/schema/test/fingerprint.vectors.json")));
        var vectors = file.RootElement.GetProperty("vectors").EnumerateArray().ToArray();
        Assert.True(vectors.Length >= 5);
        foreach (var vector in vectors)
        {
            var input = vector.GetProperty("input");
            var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true, Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() } };
            var veteran = ParseVeteran(input, options);
            Assert.Equal(vector.GetProperty("canonical").GetString(), Fingerprint.Canonical(veteran));
            Assert.Equal(vector.GetProperty("sha256").GetString(), Fingerprint.Hash(veteran));
        }
    }

    [Fact]
    public void Capture_rules_reject_duplicate_sparks_invalid_parent_slots_and_missing_flags()
    {
        using var file = JsonDocument.Parse(File.ReadAllText(Path.Combine(Repo, "packages/schema/test/fingerprint.vectors.json")));
        var input = file.RootElement.GetProperty("vectors")[0].GetProperty("input");
        var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true, Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() } };
        var veteran = ParseVeteran(input, options);
        var capture = new VeteranCapture(1, "01K7B33MXGVZV6TZRJZDHB99YE", DateTimeOffset.UtcNow, "test", "layout", "master", Fingerprint.Hash(veteran), veteran, []);
        Assert.Empty(CaptureValidation.Validate(capture));
        var duplicate = veteran with { Sparks = [.. veteran.Sparks, veteran.Sparks[0]] };
        Assert.Contains(CaptureValidation.Validate(capture with { Veteran = duplicate }), x => x.Contains("same spark"));
        var slots = veteran with { Parents = [veteran.Parents[0], veteran.Parents[1] with { Slot = 1 }] };
        Assert.Contains(CaptureValidation.Validate(capture with { Veteran = slots }), x => x.Contains("parent slots"));
        var missing = veteran with { Sparks = veteran.Sparks.Where(s => s.Owner != "parent2").ToList() };
        Assert.Contains(CaptureValidation.Validate(capture with { Veteran = missing }), x => x.Contains("parent owner"));
        var flag = new CaptureField("/sparks/parent2", null, null, 0, FieldStatus.low_confidence, [], null);
        Assert.Empty(CaptureValidation.Validate(capture with { Veteran = missing, Fields = [flag] }));
        var bad = new CaptureField("/trainMode", "Independent Learner", "independent", .3, FieldStatus.low_confidence, [], null);
        Assert.Contains(CaptureValidation.Validate(capture with { Fields = [bad] }), x => x.Contains("not correctable"));
        Assert.Empty(CaptureValidation.Validate(capture with { Fields = [bad with { Status = FieldStatus.ok }] }));
    }

    [Fact]
    public void Owned_card_sync_cross_field_rules()
    {
        Assert.Empty(CaptureValidation.ValidateOwnedCards(2, ["card:a", "card:b"]));
        Assert.Contains(CaptureValidation.ValidateOwnedCards(3, ["card:a", "card:b"]), x => x.Contains("heldCount"));
        Assert.Empty(CaptureValidation.ValidateOwnedCards(3, ["card:a", "card:b"], partial: true));
        Assert.Contains(CaptureValidation.ValidateOwnedCards(2, ["card:a", "card:a"], partial: true), x => x.Contains("duplicate"));
    }

    [Fact]
    public void Canonical_inputs_need_no_escaping()
    {
        // N1: the default encoder escapes '+' and non-ASCII (JS JSON.stringify doesn't). Every master ID that can reach
        // the fingerprint, and the McQueen capture's canonical string, must therefore be plain ASCII without escapes.
        var master = FixtureEnv.Instance.Master;
        var ids = new[] { "characters", "outfits", "sparks", "scenarios" }.SelectMany(k => master.Ids[k]).ToArray();
        Assert.NotEmpty(ids);
        Assert.All(ids, id => Assert.Matches("^[a-z]+:[a-z0-9]+(?:-[a-z0-9]+)*$", id));
        Assert.Equal("\"a\\u002Bb\"", System.Text.Json.JsonSerializer.Serialize("a+b"));   // documents the encoder behaviour
        var (_, r) = Collect.Assemble(Collect.Complete());
        var canonical = Fingerprint.Canonical(r.Capture!.Veteran);
        Assert.DoesNotContain("\\u", canonical);
        Assert.True(canonical.All(c => c < 128));
    }
}
