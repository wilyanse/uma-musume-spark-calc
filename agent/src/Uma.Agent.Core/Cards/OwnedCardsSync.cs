using System.Text.Json;
using System.Text.RegularExpressions;

namespace Uma.Agent.Core.Cards;

/// <summary>One owned card in an <see cref="OwnedCardsSync"/> (01 §4).</summary>
public sealed record OwnedCard(string CardId, int Lb, int Level, double Confidence);

/// <summary>01 §4 `PUT /api/v1/owned-cards` body, mirroring `OwnedCardsSync` in packages/schema/src/api.ts.
/// Equality compares the card list element-wise.</summary>
public sealed record OwnedCardsSync(int SchemaVersion, DateTimeOffset CapturedAt, string MasterVersion, int HeldCount, IReadOnlyList<OwnedCard> Cards)
{
    public bool Equals(OwnedCardsSync? other) => other is not null && SchemaVersion == other.SchemaVersion && CapturedAt.Equals(other.CapturedAt)
        && MasterVersion == other.MasterVersion && HeldCount == other.HeldCount && Cards.SequenceEqual(other.Cards);
    public override int GetHashCode() => HashCode.Combine(SchemaVersion, CapturedAt, MasterVersion, HeldCount, Cards.Count);
}

/// <summary>A body plus the query flag it must be sent with. `Partial` is only ever set by
/// <see cref="CardSyncSession.BuildPartial"/> after an explicit user confirmation (01 §4 `?partial=1`).</summary>
public sealed record OwnedCardsSyncPayload(OwnedCardsSync Body, bool Partial);

/// <summary>Wire format: the same serializer options as the veteran capture (camelCase, UTC `Z` timestamps, unknown
/// members refused). Deserialization also requires every schema property to be present.</summary>
public static class OwnedCardsSyncJson
{
    private static readonly string[] RootKeys = ["schemaVersion", "capturedAt", "masterVersion", "heldCount", "cards"];
    private static readonly string[] CardKeys = ["cardId", "lb", "level", "confidence"];

    public static string Serialize(OwnedCardsSync body) => JsonSerializer.Serialize(body, CaptureJson.Options);

    public static OwnedCardsSync Deserialize(string json)
    {
        using (var doc = JsonDocument.Parse(json))
        {
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object || RootKeys.Any(k => !root.TryGetProperty(k, out _))) throw new JsonException("OwnedCardsSync: missing property");
            if (root.GetProperty("cards").ValueKind != JsonValueKind.Array) throw new JsonException("OwnedCardsSync: cards must be an array");
            foreach (var c in root.GetProperty("cards").EnumerateArray())
                if (c.ValueKind != JsonValueKind.Object || CardKeys.Any(k => !c.TryGetProperty(k, out _))) throw new JsonException("OwnedCardsSync: card missing property");
        }
        var body = JsonSerializer.Deserialize<OwnedCardsSync>(json, CaptureJson.Options) ?? throw new JsonException("OwnedCardsSync is null");
        if (body.MasterVersion is null || body.Cards is null || body.Cards.Any(c => c is null || c.CardId is null)) throw new JsonException("OwnedCardsSync: null value");
        return body;
    }
}

/// <summary>The agent-side check of 01 §4, run before anything is sent. Mirrors the exported JSON Schema
/// (`packages/schema/json/OwnedCardsSync.schema.json`), the cross-field `OWNED_CARDS_SYNC_RULES` (messages verbatim)
/// and the API route's master-ID check (`apps/api/src/routes/owned-cards.ts`). Errors are `"&lt;json pointer&gt;: message"`.</summary>
public static partial class OwnedCardsSyncValidator
{
    public const string CardIdPattern = "^card:[a-z0-9]+(?:-[a-z0-9]+)*$";
    public const int MinLb = 0, MaxLb = 4, MinLevel = 1;
    public const string DuplicateMessage = "duplicate cardId (owned_cards.card_id is the primary key)";
    public const string HeldCountMessage = "cards.length must equal heldCount unless the request has ?partial=1";

    /// <param name="knownCards">The `cards` IDs of the master version named by the body (null skips the check).</param>
    public static IReadOnlyList<string> Validate(OwnedCardsSync body, bool partial, IReadOnlySet<string>? knownCards)
    {
        var errors = new List<string>();
        if (body.SchemaVersion != 1) errors.Add("/schemaVersion: must be 1");
        if (body.CapturedAt.Offset != TimeSpan.Zero) errors.Add("/capturedAt: must be an ISO UTC time");
        if (string.IsNullOrEmpty(body.MasterVersion)) errors.Add("/masterVersion: must be non-empty");
        if (body.HeldCount < 0) errors.Add("/heldCount: must be >= 0");
        var cards = body.Cards ?? [];
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < cards.Count; i++)
        {
            var c = cards[i];
            if (c.CardId is null || !CardIdRegex().IsMatch(c.CardId)) errors.Add($"/cards/{i}/cardId: must match {CardIdPattern}");
            else if (!seen.Add(c.CardId)) errors.Add($"/cards/{i}/cardId: {DuplicateMessage}");
            else if (knownCards is not null && !knownCards.Contains(c.CardId)) errors.Add($"/cards/{i}/cardId: unknown cards ID \"{c.CardId}\" in master data {body.MasterVersion}");
            if (c.Lb is < MinLb or > MaxLb) errors.Add($"/cards/{i}/lb: must be {MinLb}..{MaxLb}");
            if (c.Level < MinLevel) errors.Add($"/cards/{i}/level: must be >= {MinLevel}");
            if (!double.IsFinite(c.Confidence) || c.Confidence is < 0 or > 1) errors.Add($"/cards/{i}/confidence: must be 0..1");
        }
        if (!partial && cards.Count != body.HeldCount) errors.Add($"/heldCount: {HeldCountMessage}");
        return errors;
    }

    [GeneratedRegex(CardIdPattern, RegexOptions.CultureInvariant)] private static partial Regex CardIdRegex();
}
