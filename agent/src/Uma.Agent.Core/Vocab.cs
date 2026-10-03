using System.Text.RegularExpressions;

namespace Uma.Agent.Core;

public enum CircleGlyph { None, Single, Double, Unknown }

public sealed record VocabMatch(string? Id, double Score, IReadOnlyList<Candidate> Candidates, bool Accepted, string Raw)
{
    public string? Best => Candidates.Count > 0 ? (string?)Candidates[0].Value : null;
}

/// <summary>Vocab matching per 30 §4: exact → case-insensitive → normalised Levenshtein, accept at ≥ 0.85 with a
/// ≥ 0.05 lead over the best *different ID* (several texts of one ID never compete with each other).
/// OCR cannot tell ◯ from ◎ (both read as "O"); the caller passes the pixel-classified glyph.</summary>
public sealed partial class VocabIndex
{
    private sealed record Entry(string Id, string Text, string Norm);
    private readonly Dictionary<string, Entry[]> _byKind;
    public const double AcceptScore = 0.85, AcceptMargin = 0.05;

    public VocabIndex(IEnumerable<VocabEntry> vocab)
        => _byKind = vocab.GroupBy(v => v.Kind).ToDictionary(g => g.Key, g => g.Select(v => new Entry(v.Id, v.Text, Normalize(v.Text))).ToArray());

    public IEnumerable<string> TextsOf(string kind, string id) => _byKind.TryGetValue(kind, out var e) ? e.Where(x => x.Id == id).Select(x => x.Text) : [];

    /// <summary>Trim, unify circle glyphs, map OCR's trailing O/0/®/@/© to ◯, collapse spaces.</summary>
    public static string Normalize(string text)
    {
        var s = text.Trim().Replace('○', '◯').Replace('“', '"').Replace('”', '"').Replace('’', '\'');
        s = Spaces().Replace(s, " ");
        s = TrailingCircle().Replace(s, " ◯");
        return s.Trim();
    }

    /// <summary>OCR prefixes the pill's radio dot / stat icon as a short token (•, ), O, 0, 5, ©, L, T…). Try with and without it.</summary>
    public static IEnumerable<string> Variants(string raw)
    {
        var n = Normalize(raw);
        yield return n;
        var stripped = LeadingJunk().Replace(n, "");
        if (stripped != n && stripped.Length > 0) yield return stripped;
        var token = LeadingToken().Match(n);
        if (token.Success && token.Groups[2].Value.Length > 0) yield return token.Groups[2].Value;
    }

    public VocabMatch Match(string raw, string kind, CircleGlyph glyph = CircleGlyph.None, IReadOnlySet<string>? restrictTo = null)
    {
        if (!_byKind.TryGetValue(kind, out var entries) || string.IsNullOrWhiteSpace(raw)) return new VocabMatch(null, 0, [], false, raw);
        if (restrictTo is not null) entries = entries.Where(e => restrictTo.Contains(e.Id)).ToArray();
        var queries = new List<string>();
        foreach (var v in Variants(raw).Distinct())
        {
            if (v.EndsWith(" ◯", StringComparison.Ordinal) && glyph is CircleGlyph.Double) queries.Add(v[..^1] + "◎");
            else if (v.EndsWith(" ◯", StringComparison.Ordinal) && glyph is CircleGlyph.Unknown) { queries.Add(v); queries.Add(v[..^1] + "◎"); }
            else queries.Add(v);
        }
        var best = new Dictionary<string, double>(StringComparer.Ordinal);
        // When pixels decided the glyph, an entry ending in the other glyph is a different skill, not a near miss.
        var excluded = glyph switch { CircleGlyph.Single => " ◎", CircleGlyph.Double => " ◯", _ => null };
        foreach (var e in entries)
        foreach (var q in queries)
        {
            if (excluded is not null && e.Norm.EndsWith(excluded, StringComparison.Ordinal)) continue;
            var s = Score(q, e.Norm);
            if (!best.TryGetValue(e.Id, out var old) || s > old) best[e.Id] = s;
        }
        var ranked = best.OrderByDescending(kv => kv.Value).ThenBy(kv => kv.Key, StringComparer.Ordinal).Take(3).ToArray();
        if (ranked.Length == 0) return new VocabMatch(null, 0, [], false, raw);
        var accepted = ranked[0].Value >= AcceptScore && (ranked.Length == 1 || ranked[0].Value - ranked[1].Value >= AcceptMargin);
        return new VocabMatch(accepted ? ranked[0].Key : null, Math.Round(ranked[0].Value, 4),
            ranked.Select(kv => new Candidate(kv.Key, Math.Round(kv.Value, 4))).ToArray(), accepted, raw);
    }

    /// <summary>IDs with any text of `kind` scoring ≥ min against the OCR text (used to intersect card name and title).</summary>
    public IReadOnlySet<string> IdsAbove(string raw, string kind, double min)
    {
        if (!_byKind.TryGetValue(kind, out var entries) || string.IsNullOrWhiteSpace(raw)) return new HashSet<string>();
        var q = Variants(raw).ToArray();
        return entries.Where(e => q.Any(v => Score(v, e.Norm) >= min)).Select(e => e.Id).ToHashSet(StringComparer.Ordinal);
    }

    public static double Score(string a, string b)
    {
        if (a == b) return 1;
        if (a.Equals(b, StringComparison.OrdinalIgnoreCase)) return 0.99;
        a = a.ToLowerInvariant(); b = b.ToLowerInvariant();
        var d = new int[b.Length + 1];
        for (var j = 0; j <= b.Length; j++) d[j] = j;
        for (var i = 1; i <= a.Length; i++)
        {
            var prev = d[0]; d[0] = i;
            for (var j = 1; j <= b.Length; j++) { var t = d[j]; d[j] = Math.Min(Math.Min(d[j] + 1, d[j - 1] + 1), prev + (a[i - 1] == b[j - 1] ? 0 : 1)); prev = t; }
        }
        return 1 - (double)d[b.Length] / Math.Max(1, Math.Max(a.Length, b.Length));
    }

    [GeneratedRegex(@"\s+")] private static partial Regex Spaces();
    [GeneratedRegex(@"\s+[O0o®@©◯]$")] private static partial Regex TrailingCircle();   // ◎ is kept: it is a distinct skill
    [GeneratedRegex(@"^[^\p{L}\p{N}\[(""']+")] private static partial Regex LeadingJunk();
    // A non-letter token of ≤ 2 chars, or one of the single letters OCR produces for the radio dot / stat icon.
    [GeneratedRegex(@"^([^\p{L}\s]{1,2}|[OoÖöLT])\s+(.+)$")] private static partial Regex LeadingToken();
}
