using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Uma.Agent.Core.Tests;

/// <summary>Shared, cached test environment: layout, published master bundle (read-only), templates, PNG frames and
/// recorded OCR. Label names are translated to IDs by exact vocab text, independently of the OCR under test.</summary>
public sealed class FixtureEnv
{
    public static string Repo => Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../../"));
    private static readonly Lazy<FixtureEnv> Lazy = new(() => new FixtureEnv());
    public static FixtureEnv Instance => Lazy.Value;
    public static string Screens => Path.Combine(Repo, "docs/reference/screenshots");
    public static string Fixtures => Path.Combine(Repo, "agent/tests/fixtures");
    public static string LayoutPath => Path.Combine(Repo, "agent/layouts/global-2026-09.json");
    public static string TemplatesPath => Path.Combine(Repo, "agent/layouts/templates/global-2026-09.json");
    public static string MasterDir => Path.Combine(Repo, "apps/web/public/master/global-20260930");

    public LayoutProfile Layout { get; } = LayoutProfile.Load(LayoutPath);
    public MasterData Master { get; } = MasterData.Load(MasterDir);
    private readonly Lazy<IReadOnlyDictionary<string, TemplateSet>> _templates = new(() => TemplateSet.Load(TemplatesPath));
    public IReadOnlyDictionary<string, TemplateSet> Templates => _templates.Value;
    public IReadOnlyList<string> Names { get; } = Directory.GetFiles(Screens, "*.png").Select(Path.GetFileNameWithoutExtension).Order(StringComparer.Ordinal).ToArray()!;
    private readonly ConcurrentDictionary<string, Frame> _frames = new();
    private readonly ConcurrentDictionary<(string, bool), Lazy<ParsedFrame>> _parsed = new();

    public Frame Frame(string name) => _frames.GetOrAdd(name, n => Frames.Load(Path.Combine(Screens, n + ".png")));

    /// <summary>roiMode: exact per-ROI recordings first (how the Windows adapter reads), full-frame recording as fallback.</summary>
    public FixtureOcrEngine Ocr(string name, bool roiMode = true)
        => new(Path.Combine(Fixtures, "ocr", name + ".json"), roiMode ? Path.Combine(Fixtures, "ocr-roi", name + ".json") : null);

    public FrameParser Parser(string name, bool roiMode = true) => new(Layout, Master, Templates, Ocr(name, roiMode));

    public ParsedFrame Parsed(string name, bool roiMode = true)
        => _parsed.GetOrAdd((name, roiMode), k => new Lazy<ParsedFrame>(() => Parser(k.Item1, k.Item2).ParseAsync(Frame(k.Item1)).GetAwaiter().GetResult())).Value;

    public JsonObject Label(string name) => JsonNode.Parse(File.ReadAllText(Path.Combine(Fixtures, "labels", name + ".json")))!.AsObject();

    private static string Unify(string s) => s.Replace('○', '◯').Trim();

    /// <summary>The unique master ID whose vocab text equals `text` exactly (◯/○ unified); throws when not unique.</summary>
    public string IdOf(string kind, string text, Func<string, bool>? filter = null)
    {
        var ids = Master.Vocab.Where(v => v.Kind == kind && Unify(v.Text) == Unify(text)).Select(v => v.Id).Where(id => filter?.Invoke(id) ?? true).Distinct().ToArray();
        if (ids.Length != 1) throw new InvalidOperationException($"label text '{text}' ({kind}) maps to {ids.Length} ids: {string.Join(",", ids)}");
        return ids[0];
    }

    public string OutfitOf(string character, string title)
    {
        var c = IdOf("character", character);
        return IdOf("outfit", title, id => Master.Outfits[id].CharacterId == c);
    }
}

public sealed record FieldResult(string Fixture, string Field, string Category, string Expected, string Actual, bool Correct, bool Confident);

/// <summary>Compares a parsed frame to its label file. Every labelled value is one field; extra parsed rows are errors.</summary>
public static class FixtureComparer
{
    private static string S(object? v) => v switch { null => "null", bool b => b ? "true" : "false", _ => Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture)! };

    public static List<FieldResult> Compare(string name, ParsedFrame p, FixtureEnv env)
    {
        var label = env.Label(name);
        var r = new List<FieldResult>();
        void Add(string field, string cat, object? expected, object? actual, bool confident) => r.Add(new FieldResult(name, field, cat, S(expected), S(actual), S(expected) == S(actual), confident));
        void AddR(string field, string cat, object? expected, Reading? reading) => Add(field, cat, expected, reading?.Value, reading?.Ok ?? false);

        Add("screen", "screen", label["screen"]!.GetValue<string>(), p.Screen.Name, true);

        // Unlabelled parts must be absent (review r1 S6): no header on popups/card screens.
        if (label["header"] is null) Add("header/absent", "absence", "absent", p.Header is null ? "absent" : "present", true);
        if (label["scroll"] is JsonObject scroll)
        {
            Add("scroll/atTop", "scroll", scroll["atTop"]!.GetValue<bool>(), Vision.AtTop(p.Thumb, env.Layout), p.Thumb is not null);
            Add("scroll/atEnd", "scroll", scroll["atEnd"]!.GetValue<bool>(), Vision.AtEnd(p.Thumb, env.Layout), p.Thumb is not null);
        }

        if (label["header"] is JsonObject h)
        {
            var hd = p.Header;
            var character = env.IdOf("character", h["character"]!.GetValue<string>());
            AddR("characterId", "identity", character, hd?.Character);
            AddR("outfitId", "identity", env.OutfitOf(h["character"]!.GetValue<string>(), h["outfit"]!.GetValue<string>()), hd?.Outfit);
            AddR("rank", "rank", h["rank"]!.GetValue<string>(), hd?.Rank);
            AddR("rating", "rating", h["rating"]!.GetValue<int>(), hd?.Rating);
            AddR("epithet", "epithet", h["epithet"]!.GetValue<string>(), hd?.Epithet);
            foreach (var (k, v) in h["stats"]!.AsObject()) AddR("stats/" + k, "stats", v!.GetValue<int>(), hd?.Stats[k]);
            foreach (var (k, v) in h["aptitudes"]!.AsObject()) AddR("aptitudes/" + k, "aptitude", v!.GetValue<string>(), hd?.Aptitudes[k]);
        }

        if (label["skills"] is JsonArray skills)
        {
            for (var i = 0; i < Math.Max(skills.Count, p.Skills.Count); i++)
            {
                if (i >= skills.Count) { Add($"skills/{i}", "skill", "absent", p.Skills[i].Skill.Value, p.Skills[i].Skill.Ok); continue; }
                var s = skills[i]!;
                var row = i < p.Skills.Count ? p.Skills[i] : null;
                AddR($"skills/{i}/skillId", "skill", env.IdOf("skill", s["name"]!.GetValue<string>()), row?.Skill);
                AddR($"skills/{i}/level", "skillLevel", s["level"]?.GetValue<int>(), row?.Level);
            }
        }

        if (label["sparks"] is JsonArray sparks)
        {
            var ownerChecked = label["screen"]!.GetValue<string>() == "details.inspiration" && label["ownerFromFrame"]?.GetValue<bool>() != false;
            for (var i = 0; i < Math.Max(sparks.Count, p.Sparks.Count); i++)
            {
                if (i >= sparks.Count) { Add($"sparks/{i}", "spark", "absent", p.Sparks[i].Spark.Value, p.Sparks[i].Spark.Ok); continue; }
                var s = sparks[i]!;
                var row = i < p.Sparks.Count ? p.Sparks[i] : null;
                AddR($"sparks/{i}/sparkId", "spark", env.IdOf("spark", s["name"]!.GetValue<string>()), row?.Spark);
                Add($"sparks/{i}/type", "sparkType", s["type"]!.GetValue<string>(), row?.Type, row?.Type is not null);
                Add($"sparks/{i}/stars", "stars", s["stars"]!.GetValue<int>(), row?.Stars, row?.StarsClear ?? false);
                if (ownerChecked) Add($"sparks/{i}/owner", "owner", s["owner"]!.GetValue<string>(), row?.Owner, row?.Owner is not null);
            }
        }

        if (label["deck"] is JsonArray deck)
        {
            for (var i = 0; i < deck.Count; i++)
            {
                var d = deck[i]!; var t = i < p.Deck.Count ? p.Deck[i] : null;
                AddR($"deck/{i}/lb", "lb", d["lb"]!.GetValue<int>(), t?.Lb);
                AddR($"deck/{i}/level", "deckLevel", d["level"]!.GetValue<int>(), t?.Level);
                AddR($"deck/{i}/borrowed", "borrowed", d["borrowed"]!.GetValue<bool>(), t?.Borrowed);
                // Identity is art-only: the matched card must be accepted and agree with the visible type icon and rarity.
                var card = t?.Card.Value as string;
                var info = card is null ? null : CardInfo(env, card);
                Add($"deck/{i}/cardTypeRarity", "cardVisible", $"{d["type"]}/{d["rarity"]}", info is null ? null : $"{info.Value.Type}/{info.Value.Rarity}", t?.Card.Ok ?? false);
                // S4: where one main character is clearly visible on the art, the matched card must feature them.
                if (d["visibleCharacter"] is JsonValue vc)
                    Add($"deck/{i}/visibleCharacter", "cardVisible", env.IdOf("character", vc.GetValue<string>()), card is null ? null : CardCharacter(env, card), t?.Card.Ok ?? false);
            }
        }

        if (label["parents"] is JsonArray parents)
            for (var i = 0; i < parents.Count; i++)
            {
                var e = parents[i]!; var pp = i < p.Parents.Count ? p.Parents[i] : null;
                AddR($"parents/{i}/characterId", "parent", env.IdOf("character", e["character"]!.GetValue<string>()), pp?.Character);
                AddR($"parents/{i}/isGuest", "parent", e["isGuest"]!.GetValue<bool>(), pp?.IsGuest);
            }

        if (label["career"] is JsonObject career)
        {
            // Rows not visible in the screenshot must not be read (S6), e.g. 05 shows only the record, 07 none.
            foreach (var k in new[] { "races", "wins", "fans", "scenario", "dateAcquired" }.Where(k => !career.ContainsKey(k)))
            {
                var reading = k switch { "races" => p.Career?.Races, "wins" => p.Career?.Wins, "fans" => p.Career?.Fans, "scenario" => p.Career?.Scenario, _ => p.Career?.Date };
                Add("career/" + k + "/absent", "absence", "absent", reading is null ? "absent" : $"read {reading.Value}", true);
            }
            foreach (var (k, v) in career)
            {
                var reading = k switch { "races" => p.Career?.Races, "wins" => p.Career?.Wins, "fans" => p.Career?.Fans, "scenario" => p.Career?.Scenario, "dateAcquired" => p.Career?.Date, _ => null };
                object? expected = k switch { "scenario" => env.IdOf("scenario", v!.GetValue<string>()), "dateAcquired" => v!.GetValue<string>(), _ => v!.GetValue<int>() };
                AddR("career/" + k, "career", expected, reading);
            }
        }

        if (label["popup"] is JsonObject popup)
        {
            AddR("popup/characterId", "identity", env.IdOf("character", popup["character"]!.GetValue<string>()), p.PopupCharacter);
            AddR("popup/outfitId", "identity", env.OutfitOf(popup["character"]!.GetValue<string>(), popup["outfit"]!.GetValue<string>()), p.PopupOutfit);
            Add("popup/isGuest", "parent", popup["isGuest"]!.GetValue<bool>(), p.Screen.Id == ScreenId.SparksPopupGuest, true);
            if (popup["guestTrainer"] is JsonValue gt) AddR("popup/guestTrainer", "parent", gt.GetValue<string>(), p.GuestTrainer);
        }

        if (label["heldCount"] is JsonValue held) AddR("heldCount", "held", held.GetValue<int>(), p.HeldCount);
        if (label["cards"] is JsonArray cards)
            for (var i = 0; i < cards.Count; i++)
            {
                var c = cards[i]!; var t = p.ListTiles.FirstOrDefault(x => x.Index == c["index"]!.GetValue<int>());
                AddR($"cards/{i}/lb", "lb", c["lb"]!.GetValue<int>(), t?.Lb);
                AddR($"cards/{i}/level", "cardLevel", c["level"]!.GetValue<int>(), t?.Level);
                var listCard = t?.Card.Value as string;
                if (c["type"] is JsonValue ct) Add($"cards/{i}/type", "cardVisible", ct.GetValue<string>(), listCard is null ? null : CardInfo(env, listCard)?.Type, t?.Card.Ok ?? false);
                if (c["visibleCharacter"] is JsonValue cc) Add($"cards/{i}/visibleCharacter", "cardVisible", env.IdOf("character", cc.GetValue<string>()), listCard is null ? null : CardCharacter(env, listCard), t?.Card.Ok ?? false);
            }

        if (label["detail"] is JsonObject detail)
        {
            var character = env.IdOf("character", detail["character"]!.GetValue<string>());
            var title = detail["title"]!.GetValue<string>();
            var card = env.Master.Vocab.Where(v => v.Kind == "card" && v.Text == title).Select(v => v.Id).Distinct()
                .Single(id => CardCharacter(env, id) == character);
            AddR("detail/cardId", "identity", card, p.DetailCard);
            AddR("detail/level", "cardLevel", detail["level"]!.GetValue<int>(), p.DetailLevel);
        }
        return r;
    }

    private static readonly Lazy<Dictionary<string, (string Type, string Rarity, string? Character)>> Cards = new(() =>
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(FixtureEnv.MasterDir, "cards.json")));
        return doc.RootElement.EnumerateArray().ToDictionary(c => c.GetProperty("id").GetString()!, c => (c.GetProperty("type").GetString()!, c.GetProperty("rarity").GetString()!,
            c.TryGetProperty("characterId", out var ch) && ch.ValueKind == JsonValueKind.String ? ch.GetString() : null));
    });
    public static (string Type, string Rarity)? CardInfo(FixtureEnv env, string id) => Cards.Value.TryGetValue(id, out var c) ? (c.Type, c.Rarity) : null;
    public static string? CardCharacter(FixtureEnv env, string id) => Cards.Value.TryGetValue(id, out var c) ? c.Character : null;
}
