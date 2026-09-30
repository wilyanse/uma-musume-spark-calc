using System.Text.Json;

namespace Uma.Agent.Core;
public sealed class FixtureOcrEngine : IOcrEngine
{
    private sealed record JsonLine(string text,double confidence,int[] box);
    private sealed record Fixture(string engine,int[] reference,List<JsonLine> lines);
    private readonly Fixture _fixture;
    public FixtureOcrEngine(string path)=>_fixture=JsonSerializer.Deserialize<Fixture>(File.ReadAllText(path),new JsonSerializerOptions{PropertyNameCaseInsensitive=true})??throw new InvalidDataException(path);
    public Task<IReadOnlyList<OcrLine>> ReadAsync(Frame frame,Rect roi,OcrMode mode){var result=_fixture.lines.Where(l=>l.box.Length==4 && l.box[0]+l.box[2]/2>=roi.X&&l.box[1]+l.box[3]/2>=roi.Y&&l.box[0]+l.box[2]/2<roi.X+roi.Width&&l.box[1]+l.box[3]/2<roi.Y+roi.Height).Select(l=>new OcrLine(l.text,l.confidence,new Rect(l.box[0],l.box[1],l.box[2],l.box[3]))).ToArray();return Task.FromResult<IReadOnlyList<OcrLine>>(result);}
}
public enum ScreenId { Unknown,DetailsSkills,DetailsInspiration,DetailsCareer,SparksPopup,SparksPopupGuest,CardsList,CardsDetail }
public sealed record ScreenClassification(ScreenId Id,double Confidence);
public sealed class ScreenClassifier
{
 public ScreenClassification Classify(IEnumerable<OcrLine> lines){var t=string.Join(' ',lines.Select(x=>x.Text));if(t.Contains("Support Card List",StringComparison.OrdinalIgnoreCase))return new(ScreenId.CardsList,1);if(t.Contains("Featured Cards",StringComparison.OrdinalIgnoreCase))return new(ScreenId.CardsDetail,1);if(t.Contains("Guest's Trainer",StringComparison.OrdinalIgnoreCase))return new(ScreenId.SparksPopupGuest,1);if(t.Contains("Sparks",StringComparison.OrdinalIgnoreCase))return new(ScreenId.SparksPopup,1);if(t.Contains("Umamusume Details",StringComparison.OrdinalIgnoreCase)){if(t.Contains("Skills",StringComparison.OrdinalIgnoreCase))return new(ScreenId.DetailsSkills,1);if(t.Contains("Inspiration",StringComparison.OrdinalIgnoreCase))return new(ScreenId.DetailsInspiration,1);if(t.Contains("Career Info",StringComparison.OrdinalIgnoreCase))return new(ScreenId.DetailsCareer,1);}return new(ScreenId.Unknown,0);}
}
public static class CaptureValidation
{
    private static readonly string[] Owners = ["self", "parent1", "parent2"];
    private static readonly string[] AptKeys = ["turf", "dirt", "sprint", "mile", "medium", "long", "front", "pace", "late", "end"];
    public static IReadOnlyList<string> Validate(VeteranCapture capture, IReadOnlyDictionary<string, IReadOnlySet<string>>? master = null)
    {
        var errors = new List<string>();
        var v = capture.Veteran;
        if (capture.SchemaVersion != 1) errors.Add("schemaVersion");
        if (v.Stats is { Spd: < 1 or > 2000 } or { Sta: < 1 or > 2000 } or { Pow: < 1 or > 2000 } or { Gut: < 1 or > 2000 } or { Wit: < 1 or > 2000 }) errors.Add("stats");
        if (v.Aptitudes.Values.Count != 10 || !v.Aptitudes.Values.Keys.Order(StringComparer.Ordinal).SequenceEqual(AptKeys.Order(StringComparer.Ordinal)) || v.Aptitudes.Values.Values.Any(g => !"GFEDCBAS".Contains(g) || g.Length != 1)) errors.Add("aptitudes");
        if (!v.Deck.Select(d => d.Slot).Order().SequenceEqual(new[] { 1, 2, 3, 4, 5, 6 })) errors.Add("deck slots must be exactly 1..6, each once");
        if (!v.Parents.Select(p => p.Slot).Order().SequenceEqual(new[] { 1, 2 })) errors.Add("parent slots must be exactly 1 and 2, each once");
        if (v.Parents.Count == 2 && v.Parents[0].CharacterId == v.Parents[1].CharacterId) errors.Add("the two parents must be different characters");
        foreach (var p in v.Parents)
        {
            if (p.CharacterId == v.CharacterId) errors.Add("a parent must not be the same character as the veteran");
            if (!p.IsGuest && p.GuestTrainer is not null) errors.Add("a non-guest parent must not have a guestTrainer");
        }
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var s in v.Sparks)
        {
            if (!seen.Add(s.Owner + "|" + s.SparkId)) errors.Add("the same spark appears twice for one owner");
            if (!Owners.Contains(s.Owner) || !new[] { "blue", "pink", "green", "white" }.Contains(s.Type) || s.Stars is < 1 or > 3) errors.Add("spark value invalid");
        }
        foreach (var owner in Owners)
        {
            var own = v.Sparks.Where(s => s.Owner == owner).ToArray();
            if (own.Length == 0)
            {
                if (owner == "self") errors.Add("self sparks are required: exactly one blue and one pink");
                else if (!capture.Fields.Any(f => f.Path == "/sparks/" + owner && f.Status == FieldStatus.low_confidence)) errors.Add($"a parent owner with no sparks needs a low_confidence field whose path is exactly \"/sparks/<owner>\" (owner {owner})");
                continue;
            }
            if (own.Count(s => s.Type == "blue") != 1 || own.Count(s => s.Type == "pink") != 1 || own.Count(s => s.Type == "green") > 1) errors.Add($"spark shape violated: exactly one blue, one pink and at most one green per owner (owner {owner})");
        }
        if (v.Deck.Any(d => d.Lb is < 0 or > 4 || d.Level < 1)) errors.Add("deck value invalid");
        if (v.Skills.Any(s => s.Level is < 1) || v.Rating < 0 || v.Career.Races < 0 || v.Career.Wins < 0 || v.Career.Fans is < 0) errors.Add("numeric value invalid");
        if (TrainModeDetector.Detect(v.Epithet) != v.TrainMode) errors.Add("trainMode must be derived from epithet");
        foreach (var f in capture.Fields)
        {
            if (f.Confidence is < 0 or > 1 || f.Candidates.Count > 3 || f.Candidates.Any(c => c.Score is < 0 or > 1)) errors.Add("field confidence invalid");
            // Q-110: provenance may include /trainMode; corrections must target real, safe paths.
            if (f.Status == FieldStatus.low_confidence && !CorrectablePath(f.Path, v)) errors.Add("low_confidence path is not correctable: " + f.Path);
        }
        if (master is not null) errors.AddRange(UnknownMasterIds(v, master));
        return errors;
    }

    private static bool CorrectablePath(string path, Veteran v)
    {
        if (path is "/sparks/parent1" or "/sparks/parent2") return true;
        if (!path.StartsWith('/') || path.Split('/').Any(x => x is ".." or "__proto__" or "constructor" or "prototype")) return false;
        var parts = path.Split('/').Skip(1).ToArray();
        if (parts.Length == 1) return new[] { "characterId", "outfitId", "rank", "rating", "epithet", "scenarioId" }.Contains(parts[0]);
        if (parts.Length == 2 && parts[0] == "stats") return new[] { "spd", "sta", "pow", "gut", "wit" }.Contains(parts[1]);
        if (parts.Length == 2 && parts[0] == "aptitudes") return AptKeys.Contains(parts[1]);
        if (parts.Length == 2 && parts[0] == "career") return new[] { "races", "wins", "fans", "dateAcquired" }.Contains(parts[1]);
        if (parts.Length != 3 || !int.TryParse(parts[1], out var index) || index < 0 || index.ToString() != parts[1]) return false;
        return parts[0] switch
        {
            "skills" => index < v.Skills.Count && new[] { "skillId", "level" }.Contains(parts[2]),
            "sparks" => index < v.Sparks.Count && new[] { "sparkId", "type", "stars" }.Contains(parts[2]),
            "deck" => index < v.Deck.Count && new[] { "cardId", "lb", "level", "borrowed" }.Contains(parts[2]),
            "parents" => index < v.Parents.Count && new[] { "characterId", "outfitId", "isGuest", "guestTrainer" }.Contains(parts[2]),
            _ => false
        };
    }

    public static IReadOnlyList<string> ValidateOwnedCards(int heldCount, IReadOnlyList<string> cardIds, bool partial = false)
    {
        var errors = new List<string>();
        if (cardIds.Distinct(StringComparer.Ordinal).Count() != cardIds.Count) errors.Add("duplicate cardId (owned_cards.card_id is the primary key)");
        if (!partial && heldCount != cardIds.Count) errors.Add("cards.length must equal heldCount unless the request has ?partial=1");
        return errors;
    }

    public static IReadOnlyList<string> UnknownMasterIds(Veteran v, IReadOnlyDictionary<string, IReadOnlySet<string>> master)
    {
        var errors = new List<string>(); var seen = new HashSet<string>();
        void Check(string kind, string path, string? id)
        {
            if (id is null) return;
            if (!master.TryGetValue(kind, out var known)) { errors.Add("missing master index: " + kind); return; }
            if (!known.Contains(id) && seen.Add(kind + "|" + id)) errors.Add($"unknown {kind} {id} at {path}");
        }
        Check("characters", "/characterId", v.CharacterId); Check("outfits", "/outfitId", v.OutfitId); Check("ranks", "/rank", v.Rank);
        for (var i = 0; i < v.Skills.Count; i++) Check("skills", $"/skills/{i}/skillId", v.Skills[i].SkillId);
        for (var i = 0; i < v.Sparks.Count; i++) Check("sparks", $"/sparks/{i}/sparkId", v.Sparks[i].SparkId);
        for (var i = 0; i < v.Deck.Count; i++) Check("cards", $"/deck/{i}/cardId", v.Deck[i].CardId);
        for (var i = 0; i < v.Parents.Count; i++) { Check("characters", $"/parents/{i}/characterId", v.Parents[i].CharacterId); Check("outfits", $"/parents/{i}/outfitId", v.Parents[i].OutfitId); }
        Check("scenarios", "/scenarioId", v.ScenarioId);
        return errors;
    }
}
