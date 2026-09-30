using System.Text.Json;

namespace Uma.Agent.Core;

public sealed record ImageMatch(string? Id, int Distance, int Margin, bool Accepted, IReadOnlyList<Candidate> Candidates);

/// <summary>Fail closed on near-ties and misaligned art. No fixture-specific answers.</summary>
public static class ImageMatcher
{
    public static ImageMatch Find(string hash, IReadOnlyDictionary<string, IReadOnlyList<string>> hashes, int maxDistance = 10, int minMargin = 4)
    {
        var nearest = hashes.Select(entry => (entry.Key, Distance: entry.Value.Select(h => PixelAlgorithms.Hamming(hash, h)).DefaultIfEmpty(65).Min()))
            .OrderBy(x => x.Distance).ThenBy(x => x.Key, StringComparer.Ordinal).Take(3).ToArray();
        if (nearest.Length == 0) return new ImageMatch(null, 65, 0, false, []);
        var margin = nearest.Length > 1 ? nearest[1].Distance - nearest[0].Distance : 65 - nearest[0].Distance;
        var accepted = nearest[0].Distance <= maxDistance && margin >= minMargin;
        return new ImageMatch(accepted ? nearest[0].Key : null, nearest[0].Distance, margin, accepted,
            nearest.Select(n => new Candidate(n.Key, 1d - n.Distance / 64d)).ToArray());
    }

    public static IReadOnlyDictionary<string, IReadOnlyList<string>> LoadHashes(string bundleFile, string property)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(bundleFile));
        var entries = document.RootElement.ValueKind == JsonValueKind.Array
            ? document.RootElement.EnumerateArray() : document.RootElement.GetProperty("items").EnumerateArray();
        return entries.Where(e => e.TryGetProperty(property, out var h) && h.ValueKind == JsonValueKind.Array)
            .ToDictionary(e => e.GetProperty("id").GetString()!, e => (IReadOnlyList<string>)e.GetProperty(property).EnumerateArray().Select(x => x.GetString()!).ToArray());
    }
}
