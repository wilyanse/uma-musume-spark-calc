using System.Text.Json;
using System.Text.RegularExpressions;
using Uma.Agent.Core.Cards;
using Xunit;

namespace Uma.Agent.Core.Tests;

/// <summary>OwnedCardsSync (01 §4) wire format and validation parity with packages/schema
/// (`json/OwnedCardsSync.schema.json` exported from zod, and `OWNED_CARDS_SYNC_RULES`).</summary>
public class CardsContractTests
{
    private static string Repo => FixtureEnv.Repo;
    private static readonly DateTimeOffset At = new(2026, 10, 3, 1, 2, 3, TimeSpan.Zero);
    private static IReadOnlySet<string> Known => FixtureEnv.Instance.Master.Ids["cards"];
    private static string Card(int i) => Known.Order(StringComparer.Ordinal).ElementAt(i);

    private static OwnedCardsSync Body(int n = 2, int? held = null) => new(1, At, "global-20260930", held ?? n,
        Enumerable.Range(0, n).Select(i => new OwnedCard(Card(i), i % 5, 30 + i, 0.9)).ToArray());

    private static JsonElement Schema()
        => JsonDocument.Parse(File.ReadAllText(Path.Combine(Repo, "packages/schema/json/OwnedCardsSync.schema.json"))).RootElement.Clone();

    [Fact]
    public void Serialized_body_has_exactly_the_schema_properties_and_matches_its_patterns()
    {
        var schema = Schema();
        var json = OwnedCardsSyncJson.Serialize(Body());
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var props = schema.GetProperty("properties");
        Assert.Equal(OwnedCardsSyncJson.IsoUtcPattern, props.GetProperty("capturedAt").GetProperty("pattern").GetString());
        Assert.Equal(schema.GetProperty("required").EnumerateArray().Select(x => x.GetString()).Order(), root.EnumerateObject().Select(p => p.Name).Order());
        Assert.False(schema.GetProperty("additionalProperties").GetBoolean());
        var item = props.GetProperty("cards").GetProperty("items");
        Assert.Equal(item.GetProperty("required").EnumerateArray().Select(x => x.GetString()).Order(), root.GetProperty("cards")[0].EnumerateObject().Select(p => p.Name).Order());
        Assert.Matches(new Regex(props.GetProperty("capturedAt").GetProperty("pattern").GetString()!), root.GetProperty("capturedAt").GetString()!);
        Assert.Equal("2026-10-03T01:02:03Z", root.GetProperty("capturedAt").GetString());
        Assert.Equal(1, root.GetProperty("schemaVersion").GetInt32());
        foreach (var c in root.GetProperty("cards").EnumerateArray())
            Assert.Matches(new Regex(item.GetProperty("properties").GetProperty("cardId").GetProperty("pattern").GetString()!), c.GetProperty("cardId").GetString()!);
        Assert.Equal(Body(), OwnedCardsSyncJson.Deserialize(json));
    }

    [Fact]
    public void Validator_constants_mirror_the_exported_schema_and_shared_rules()
    {
        var schema = Schema();
        var item = schema.GetProperty("properties").GetProperty("cards").GetProperty("items").GetProperty("properties");
        Assert.Equal(OwnedCardsSyncValidator.CardIdPattern, item.GetProperty("cardId").GetProperty("pattern").GetString());
        Assert.Equal(OwnedCardsSyncValidator.MinLb, item.GetProperty("lb").GetProperty("minimum").GetInt32());
        Assert.Equal(OwnedCardsSyncValidator.MaxLb, item.GetProperty("lb").GetProperty("maximum").GetInt32());
        Assert.Equal(OwnedCardsSyncValidator.MinLevel, item.GetProperty("level").GetProperty("minimum").GetInt32());
        Assert.Equal(0, item.GetProperty("confidence").GetProperty("minimum").GetInt32());
        Assert.Equal(1, item.GetProperty("confidence").GetProperty("maximum").GetInt32());
        Assert.Equal(0, schema.GetProperty("properties").GetProperty("heldCount").GetProperty("minimum").GetInt32());
        // OWNED_CARDS_SYNC_RULES messages, verbatim (packages/schema/src/capture.ts).
        var rules = File.ReadAllText(Path.Combine(Repo, "packages/schema/src/capture.ts"));
        Assert.Contains($"message: '{OwnedCardsSyncValidator.DuplicateMessage}'", rules);
        Assert.Contains($"message: '{OwnedCardsSyncValidator.HeldCountMessage}'", rules);
        Assert.Contains("unlessQuery: 'partial=1'", rules);
    }

    [Fact]
    public void Validation_rules()
    {
        Assert.Empty(OwnedCardsSyncValidator.Validate(Body(), partial: false, Known));
        Assert.Contains(OwnedCardsSyncValidator.Validate(Body(2, held: 3), partial: false, Known), e => e.Contains(OwnedCardsSyncValidator.HeldCountMessage));
        Assert.Empty(OwnedCardsSyncValidator.Validate(Body(2, held: 3), partial: true, Known));
        var b = Body(3);
        Assert.Contains(OwnedCardsSyncValidator.Validate(b with { Cards = [b.Cards[0], b.Cards[1], b.Cards[0]] }, false, Known), e => e.StartsWith("/cards/2/cardId") && e.Contains(OwnedCardsSyncValidator.DuplicateMessage));
        Assert.Contains(OwnedCardsSyncValidator.Validate(b with { Cards = [b.Cards[0], b.Cards[1], b.Cards[0]] }, true, Known), e => e.Contains("duplicate"));
        Assert.Contains(OwnedCardsSyncValidator.Validate(b with { Cards = [b.Cards[0] with { Lb = 5 }, b.Cards[1], b.Cards[2]] }, false, Known), e => e.StartsWith("/cards/0/lb"));
        Assert.Contains(OwnedCardsSyncValidator.Validate(b with { Cards = [b.Cards[0] with { Lb = -1 }, b.Cards[1], b.Cards[2]] }, false, Known), e => e.StartsWith("/cards/0/lb"));
        Assert.Contains(OwnedCardsSyncValidator.Validate(b with { Cards = [b.Cards[0] with { Level = 0 }, b.Cards[1], b.Cards[2]] }, false, Known), e => e.StartsWith("/cards/0/level"));
        Assert.Contains(OwnedCardsSyncValidator.Validate(b with { Cards = [b.Cards[0] with { Confidence = 1.01 }, b.Cards[1], b.Cards[2]] }, false, Known), e => e.StartsWith("/cards/0/confidence"));
        Assert.Contains(OwnedCardsSyncValidator.Validate(b with { Cards = [b.Cards[0] with { Confidence = double.NaN }, b.Cards[1], b.Cards[2]] }, false, Known), e => e.StartsWith("/cards/0/confidence"));
        Assert.Contains(OwnedCardsSyncValidator.Validate(b with { Cards = [b.Cards[0] with { CardId = "Card:Bad" }, b.Cards[1], b.Cards[2]] }, false, Known), e => e.StartsWith("/cards/0/cardId"));
        Assert.Contains(OwnedCardsSyncValidator.Validate(b with { Cards = [b.Cards[0] with { CardId = "card:not-in-master-zz" }, b.Cards[1], b.Cards[2]] }, false, Known), e => e.Contains("unknown cards ID"));
        Assert.Empty(OwnedCardsSyncValidator.Validate(b with { Cards = [b.Cards[0] with { CardId = "card:not-in-master-zz" }, b.Cards[1], b.Cards[2]] }, false, null));
        Assert.Contains(OwnedCardsSyncValidator.Validate(b with { HeldCount = -1 }, true, Known), e => e.StartsWith("/heldCount"));
        Assert.Contains(OwnedCardsSyncValidator.Validate(b with { MasterVersion = "" }, false, Known), e => e.StartsWith("/masterVersion"));
        Assert.Contains(OwnedCardsSyncValidator.Validate(b with { SchemaVersion = 2 }, false, Known), e => e.StartsWith("/schemaVersion"));
        Assert.Contains(OwnedCardsSyncValidator.Validate(b with { CapturedAt = new DateTimeOffset(2026, 10, 3, 9, 0, 0, TimeSpan.FromHours(8)) }, false, Known), e => e.StartsWith("/capturedAt"));
        // Empty full sync is the API's documented way to clear (heldCount 0, cards []).
        Assert.Empty(OwnedCardsSyncValidator.Validate(Body(0), false, Known));
    }

    [Fact]
    public void Shape_validation_is_separate_from_business_validation()
    {
        Assert.Contains(OwnedCardsSyncValidator.ValidateSchema(null), e => e.StartsWith("/"));
        Assert.Contains(OwnedCardsSyncValidator.ValidateSchema(Body(0) with { Cards = null! }), e => e.StartsWith("/cards:"));
        Assert.Contains(OwnedCardsSyncValidator.ValidateSchema(Body(1) with { Cards = [null!] }), e => e.StartsWith("/cards/0:"));
        var mismatch = Body(2, held: 3);
        Assert.Empty(OwnedCardsSyncValidator.ValidateSchema(mismatch));
        Assert.Contains(OwnedCardsSyncValidator.Validate(mismatch, false, Known), e => e.Contains(OwnedCardsSyncValidator.HeldCountMessage));
        Assert.Empty(OwnedCardsSyncValidator.Validate(mismatch, true, Known));
    }

    [Fact]
    public void Deserialize_is_strict()
    {
        var json = OwnedCardsSyncJson.Serialize(Body());
        Assert.Throws<JsonException>(() => OwnedCardsSyncJson.Deserialize(json.Replace("\"heldCount\"", "\"extra\":1,\"heldCount\"")));
        Assert.Throws<JsonException>(() => OwnedCardsSyncJson.Deserialize(json.Replace("2026-10-03T01:02:03Z", "2026-10-03T09:02:03+08:00")));
        Assert.Throws<JsonException>(() => OwnedCardsSyncJson.Deserialize(json.Replace("\"heldCount\":2", "\"heldCount\":2,\"heldCount\":2")));
        Assert.Throws<JsonException>(() => OwnedCardsSyncJson.Deserialize(json.Replace("2026-10-03T01:02:03Z", "October 3, 2026 01:02:03Z")));
        Assert.Throws<JsonException>(() => OwnedCardsSyncJson.Deserialize(json.Replace("\"cards\":[", "\"cards\":null,\"cards\":[")));
    }
}
