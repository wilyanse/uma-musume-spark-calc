using System.Security.Cryptography;
using System.Text.Json;

namespace Uma.Agent.Core;

public sealed record OutfitInfo(string Id, string CharacterId, string Title);
public sealed record SparkInfo(string Id, string Name, string Type);
public sealed record RankInfo(string Id, int MinRating);

/// <summary>Read-only view of a published master-data bundle (01 §11). Hashes are verified against latest.json when present.</summary>
public sealed class MasterData
{
    public required string Version { get; init; }
    public required IReadOnlyList<VocabEntry> Vocab { get; init; }
    public required IReadOnlyDictionary<string, OutfitInfo> Outfits { get; init; }
    public required IReadOnlyDictionary<string, SparkInfo> Sparks { get; init; }
    public required IReadOnlyList<RankInfo> Ranks { get; init; }
    public required IReadOnlyDictionary<string, IReadOnlyList<string>> CardArtHashes { get; init; }
    public required IReadOnlyDictionary<string, IReadOnlyList<string>> CharacterIconHashes { get; init; }
    public required IReadOnlyDictionary<string, IReadOnlySet<string>> Ids { get; init; }
    public required IReadOnlySet<string> UniqueSkills { get; init; }

    public IEnumerable<VocabEntry> OfKind(string kind) => Vocab.Where(v => v.Kind == kind);

    /// <summary>Loads `<root>/<version>/` and checks each file's sha256 against `<root>/latest.json` when that index names this version.</summary>
    public static MasterData Load(string versionDirectory)
    {
        var dir = Path.GetFullPath(versionDirectory);
        var version = Path.GetFileName(dir.TrimEnd(Path.DirectorySeparatorChar));
        var index = Path.Combine(Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar))!, "latest.json");
        if (File.Exists(index))
        {
            using var latest = JsonDocument.Parse(File.ReadAllText(index));
            if (latest.RootElement.GetProperty("version").GetString() == version)
                foreach (var file in latest.RootElement.GetProperty("sha256").EnumerateObject())
                {
                    var actual = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(Path.Combine(dir, file.Name)))).ToLowerInvariant();
                    if (actual != file.Value.GetString()) throw new InvalidDataException($"master file {file.Name} does not match latest.json sha256");
                }
        }
        JsonElement Read(string name) => JsonDocument.Parse(File.ReadAllText(Path.Combine(dir, name))).RootElement.Clone();
        var vocabOptions = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
        var vocab = JsonSerializer.Deserialize<List<VocabEntry>>(File.ReadAllText(Path.Combine(dir, "vocab.json")), vocabOptions)!;
        // Q-5: card titles are an explicit sidecar, not part of the schema's VocabEntry kinds.
        var cardVocab = Path.Combine(dir, "vocab-cards.json");
        if (File.Exists(cardVocab)) vocab.AddRange(JsonSerializer.Deserialize<List<VocabEntry>>(File.ReadAllText(cardVocab), vocabOptions)!);

        var ids = new Dictionary<string, IReadOnlySet<string>>();
        HashSet<string> IdSet(JsonElement arr) => arr.EnumerateArray().Select(e => e.GetProperty("id").GetString()!).ToHashSet(StringComparer.Ordinal);
        var characters = Read("characters.json"); var outfits = Read("outfits.json"); var skills = Read("skills.json");
        var sparks = Read("sparks.json"); var cards = Read("cards.json"); var scenarios = Read("scenarios.json"); var ranks = Read("ranks.json");
        ids["characters"] = IdSet(characters); ids["outfits"] = IdSet(outfits); ids["skills"] = IdSet(skills);
        ids["sparks"] = IdSet(sparks); ids["cards"] = IdSet(cards); ids["scenarios"] = IdSet(scenarios); ids["ranks"] = IdSet(ranks);

        static IReadOnlyDictionary<string, IReadOnlyList<string>> Hashes(JsonElement arr, string prop) => arr.EnumerateArray()
            .Where(e => e.TryGetProperty(prop, out var h) && h.GetArrayLength() > 0)
            .ToDictionary(e => e.GetProperty("id").GetString()!, e => (IReadOnlyList<string>)e.GetProperty(prop).EnumerateArray().Select(x => x.GetString()!).ToArray());

        return new MasterData
        {
            Version = version,
            Vocab = vocab,
            Outfits = outfits.EnumerateArray().ToDictionary(o => o.GetProperty("id").GetString()!, o => new OutfitInfo(o.GetProperty("id").GetString()!, o.GetProperty("characterId").GetString()!, o.GetProperty("title").GetString()!)),
            Sparks = sparks.EnumerateArray().ToDictionary(s => s.GetProperty("id").GetString()!, s => new SparkInfo(s.GetProperty("id").GetString()!, s.GetProperty("name").GetString()!, s.GetProperty("type").GetString()!)),
            Ranks = ranks.EnumerateArray().Select(r => new RankInfo(r.GetProperty("id").GetString()!, r.GetProperty("minRating").GetInt32())).OrderBy(r => r.MinRating).ToArray(),
            CardArtHashes = Hashes(cards, "artHashes"),
            CharacterIconHashes = Hashes(characters, "iconHashes"),
            Ids = ids,
            UniqueSkills = skills.EnumerateArray().Where(s => s.GetProperty("rarity").GetString() == "unique").Select(s => s.GetProperty("id").GetString()!).ToHashSet(StringComparer.Ordinal),
        };
    }

    /// <summary>The rank whose rating band contains `rating` (master `ranks.json` minRating thresholds).</summary>
    public RankInfo? RankForRating(int rating) => Ranks.LastOrDefault(r => r.MinRating <= rating);
}
