namespace Uma.Agent.Core;

public enum ScreenId { Unknown, DetailsSkills, DetailsInspiration, DetailsCareer, SparksPopup, SparksPopupGuest, CardsList, CardsDetail }

public sealed record ScreenClassification(ScreenId Id, string? Family, int AnchorDistance, double TitleScore, string Reason)
{
    public string Name => ScreenNames.Of(Id);
}

public static class ScreenNames
{
    public static string Of(ScreenId id) => id switch
    {
        ScreenId.DetailsSkills => "details.skills", ScreenId.DetailsInspiration => "details.inspiration", ScreenId.DetailsCareer => "details.career",
        ScreenId.SparksPopup => "sparks.popup", ScreenId.SparksPopupGuest => "sparks.popup.guest",
        ScreenId.CardsList => "cards.list", ScreenId.CardsDetail => "cards.detail", _ => "unknown",
    };
}

/// <summary>30 §3: classification = anchor dHash distance AND OCR of the title. Detail tabs are told apart by which tab
/// segment carries the active (green) colour; exactly one must. Anything else is `unknown` and the frame is ignored.</summary>
public sealed class ScreenClassifier(LayoutProfile layout, IOcrEngine ocr)
{
    public async Task<ScreenClassification> ClassifyAsync(Frame frame)
    {
        var f = Frames.Normalize(frame);
        var minTitle = layout.Num("titleMinScore");
        ScreenFamily? chosen = null; var bestDistance = 65; double titleScore = 0;
        var rejected = new List<string>();
        foreach (var family in layout.Families)
        {
            var d = PixelAlgorithms.Hamming(f.DHash(family.Anchor.Roi), family.Anchor.DHash);
            if (d > family.Anchor.MaxDistance) continue;
            var (text, _) = await Ocr.TextAsync(ocr, f, family.TitleRoi);
            var s = VocabIndex.Score(VocabIndex.Normalize(text), family.Title);
            if (s < minTitle) { rejected.Add($"{family.Id}: anchor {d} but title '{text}' ({s:0.00})"); continue; }
            if (d < bestDistance) { chosen = family; bestDistance = d; titleScore = s; }
        }
        if (chosen is null) return new ScreenClassification(ScreenId.Unknown, null, bestDistance, 0, rejected.Count == 0 ? "no anchor within distance" : string.Join("; ", rejected));
        switch (chosen.Id)
        {
            case "details":
            {
                var active = ActiveTabs(f);
                if (active.Count != 1) return new ScreenClassification(ScreenId.Unknown, chosen.Id, bestDistance, titleScore, $"{active.Count} active tabs");
                var id = active[0] switch { "details.skills" => ScreenId.DetailsSkills, "details.inspiration" => ScreenId.DetailsInspiration, _ => ScreenId.DetailsCareer };
                return new ScreenClassification(id, chosen.Id, bestDistance, titleScore, "anchor+title+active tab");
            }
            case "sparks":
            {
                var (text, _) = await Ocr.TextAsync(ocr, f, layout.Rect("guestTrainerRoi"));
                var guest = VocabIndex.Score(VocabIndex.Normalize(text), layout.Str("guestTrainerText")) >= minTitle;
                return new ScreenClassification(guest ? ScreenId.SparksPopupGuest : ScreenId.SparksPopup, chosen.Id, bestDistance, titleScore, guest ? "anchor+title+guest trainer" : "anchor+title");
            }
            case "cards.list": return new ScreenClassification(ScreenId.CardsList, chosen.Id, bestDistance, titleScore, "anchor+title");
            case "cards.detail": return new ScreenClassification(ScreenId.CardsDetail, chosen.Id, bestDistance, titleScore, "anchor+title");
            default: return new ScreenClassification(ScreenId.Unknown, chosen.Id, bestDistance, titleScore, "unknown family");
        }
    }

    /// <summary>Tab segments whose mean per-pixel colour distance to the active green is within the threshold.</summary>
    public List<string> ActiveTabs(Frame f)
    {
        var target = layout.Ints("tabs", "activeRgb"); var max = layout.Num("tabs", "maxColorDistance");
        var result = new List<string>();
        foreach (var seg in layout.At("tabs", "segments").EnumerateObject())
        {
            var r = LayoutProfile.R(seg.Value); double sum = 0; var n = 0;
            for (var y = r.Y; y < r.Y + r.Height; y++) for (var x = r.X; x < r.X + r.Width; x++) { sum += Frames.ColorDistance(f.Rgb(x, y), target); n++; }
            if (sum / n <= max) result.Add(seg.Name);
        }
        return result;
    }
}
