using System.Text.Json;
using System.Text.RegularExpressions;

namespace Uma.Agent.Core.Cards;

/// <summary>One owned card in an <see cref="OwnedCardsSync"/> (01 §4).</summary>
public sealed record OwnedCard(string CardId, int Lb, int Level, double Confidence);

/// <summary>01 §4 `PUT /api/v1/owned-cards` body, mirroring `OwnedCardsSync` in packages/schema/src/api.ts.
/// Equality compares the card list element-wise.</summary>
public sealed record OwnedCardsSync(int SchemaVersion, DateTimeOffset CapturedAt, string MasterVersion, int HeldCount, IReadOnlyList<OwnedCard> Cards)
{
    private IReadOnlyList<OwnedCard> _cards = Freeze(Cards);
    public IReadOnlyList<OwnedCard> Cards { get => _cards; init => _cards = Freeze(value); }
    private static IReadOnlyList<OwnedCard> Freeze(IReadOnlyList<OwnedCard>? cards)
        => cards is null ? null! : Array.AsReadOnly(cards.ToArray());

    // Not wire data. Record copies retain this seal, so rewriting a session body
    // and wrapping it in a new envelope cannot upgrade partial to full or alter Held.
    internal OwnedCardsProvenance? Provenance { get; init; }

    public bool Equals(OwnedCardsSync? other) => other is not null && SchemaVersion == other.SchemaVersion && CapturedAt.Equals(other.CapturedAt)
        && MasterVersion == other.MasterVersion && HeldCount == other.HeldCount
        && (Cards is null ? other.Cards is null : other.Cards is not null && Cards.SequenceEqual(other.Cards));
    public override int GetHashCode() => HashCode.Combine(SchemaVersion, CapturedAt, MasterVersion, HeldCount, Cards?.Count ?? 0);
}

// Trusted, in-memory provenance only; never added to the 01 §4 request body.
internal sealed record OwnedCardsProvenance(OwnedCardsSync Snapshot, bool Partial);

/// <summary>Immutable upload envelope. Its body is frozen on ingress. Body record copies
/// preserve a non-wire authorization seal: rewrapping an edited body is rejected locally.
/// This is a UI safety boundary, not cryptographic authorization against hostile code.</summary>
public sealed record OwnedCardsSyncPayload
{
    public OwnedCardsSync Body { get; }
    public bool Partial { get; }
    internal bool HasValidProvenance { get; }

    internal OwnedCardsSyncPayload(OwnedCardsSync Body, bool Partial)
    {
        this.Partial = Partial;
        var seal = Body?.Provenance;
        HasValidProvenance = seal is null || (seal.Partial == Partial && seal.Snapshot.Equals(Body));
        if (Body is null) { this.Body = null!; return; }
        var snapshot = Body with { Provenance = null };
        this.Body = snapshot with { Provenance = seal ?? new(snapshot, Partial) };
    }
}

/// <summary>Wire format: the same serializer options as the veteran capture (camelCase, UTC `Z` timestamps, unknown
/// members refused). Deserialization also requires every schema property to be present.</summary>
public static class OwnedCardsSyncJson
{
    private static readonly string[] RootKeys = ["schemaVersion", "capturedAt", "masterVersion", "heldCount", "cards"];
    private static readonly string[] CardKeys = ["cardId", "lb", "level", "confidence"];
    // Exact exported IsoUtc pattern, including calendar/leap-day constraints and optional fractional seconds.
    public const string IsoUtcPattern = "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$";
    internal static bool IsIsoUtc(string text)
    {
        var match = Regex.Match(text, IsoUtcPattern, RegexOptions.CultureInvariant);
        return match.Success && match.Length == text.Length;
    }

    private static bool IsInteger(JsonElement e) => e.ValueKind == JsonValueKind.Number && e.TryGetInt32(out _);

    public static string Serialize(OwnedCardsSync body) => JsonSerializer.Serialize(body, CaptureJson.Options);

    public static OwnedCardsSync Deserialize(string json)
    {
        using (var doc = JsonDocument.Parse(json))
        {
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object || RootKeys.Any(k => !root.TryGetProperty(k, out _))) throw new JsonException("OwnedCardsSync: missing property");
            if (root.EnumerateObject().Count() != RootKeys.Length || root.EnumerateObject().Select(p => p.Name).Distinct(StringComparer.Ordinal).Count() != RootKeys.Length) throw new JsonException("OwnedCardsSync: duplicate or unknown property");
            if (root.GetProperty("capturedAt").ValueKind != JsonValueKind.String || !IsIsoUtc(root.GetProperty("capturedAt").GetString()!)) throw new JsonException("OwnedCardsSync: invalid ISO UTC time");
            if (root.GetProperty("cards").ValueKind != JsonValueKind.Array) throw new JsonException("OwnedCardsSync: cards must be an array");
            // JSON types per the exported schema. CaptureJson.Options (T09, Web defaults) would read "1" as 1, so check here.
            if (!IsInteger(root.GetProperty("schemaVersion")) || !IsInteger(root.GetProperty("heldCount"))) throw new JsonException("OwnedCardsSync: schemaVersion/heldCount must be integers");
            if (root.GetProperty("masterVersion").ValueKind != JsonValueKind.String) throw new JsonException("OwnedCardsSync: masterVersion must be a string");
            foreach (var c in root.GetProperty("cards").EnumerateArray())
            {
                if (c.ValueKind != JsonValueKind.Object || CardKeys.Any(k => !c.TryGetProperty(k, out _)) || c.EnumerateObject().Count() != CardKeys.Length || c.EnumerateObject().Select(p => p.Name).Distinct(StringComparer.Ordinal).Count() != CardKeys.Length) throw new JsonException("OwnedCardsSync: card missing property");
                if (c.GetProperty("cardId").ValueKind != JsonValueKind.String || !IsInteger(c.GetProperty("lb")) || !IsInteger(c.GetProperty("level"))
                    || c.GetProperty("confidence").ValueKind != JsonValueKind.Number) throw new JsonException("OwnedCardsSync: card property has the wrong JSON type");
            }
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

    /// <summary>Shape/range validation, separate from duplicate, master-ID and held-count business rules.</summary>
    public static IReadOnlyList<string> ValidateSchema(OwnedCardsSync? body)
    {
        var errors = new List<string>();
        if (body is null) return ["/: must be an object"];
        if (body.SchemaVersion != 1) errors.Add("/schemaVersion: must be 1");
        if (body.CapturedAt.Offset != TimeSpan.Zero) errors.Add("/capturedAt: must be an ISO UTC time");
        if (string.IsNullOrEmpty(body.MasterVersion)) errors.Add("/masterVersion: must be non-empty");
        if (body.HeldCount < 0) errors.Add("/heldCount: must be >= 0");
        if (body.Cards is null) { errors.Add("/cards: must be an array"); return errors; }
        var cards = body.Cards;
        for (var i = 0; i < cards.Count; i++)
        {
            var c = cards[i];
            if (c is null) { errors.Add($"/cards/{i}: must be an object"); continue; }
            if (c.CardId is null || !CardIdRegex().IsMatch(c.CardId)) errors.Add($"/cards/{i}/cardId: must match {CardIdPattern}");

            if (c.Lb is < MinLb or > MaxLb) errors.Add($"/cards/{i}/lb: must be {MinLb}..{MaxLb}");
            if (c.Level < MinLevel) errors.Add($"/cards/{i}/level: must be >= {MinLevel}");
            if (!double.IsFinite(c.Confidence) || c.Confidence is < 0 or > 1) errors.Add($"/cards/{i}/confidence: must be 0..1");
        }
        return errors;
    }

    /// <param name="knownCards">The `cards` IDs of the master version named by the body (null skips the check).</param>
    public static IReadOnlyList<string> Validate(OwnedCardsSync? body, bool partial, IReadOnlySet<string>? knownCards)
    {
        var errors = ValidateSchema(body).ToList();
        if (errors.Count != 0) return errors;
        var cards = body!.Cards;
        var seen = new HashSet<string>(StringComparer.Ordinal);
        for (var i = 0; i < cards.Count; i++)
        {
            var c = cards[i];
            if (!seen.Add(c.CardId)) errors.Add($"/cards/{i}/cardId: {DuplicateMessage}");
            else if (knownCards is not null && !knownCards.Contains(c.CardId)) errors.Add($"/cards/{i}/cardId: unknown cards ID \"{c.CardId}\" in master data {body.MasterVersion}");
        }
        if (!partial && cards.Count != body.HeldCount) errors.Add($"/heldCount: {HeldCountMessage}");
        return errors;
    }

    [GeneratedRegex(CardIdPattern, RegexOptions.CultureInvariant)] private static partial Regex CardIdRegex();
}
