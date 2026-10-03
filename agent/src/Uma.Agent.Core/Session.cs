using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.Processing;

namespace Uma.Agent.Core;

/// <summary>A reading together with the frame it came from (needed to cut the review crop).</summary>
public sealed record Evidence(Reading R, Frame Frame);

/// <summary>Rows positioned in content space of one scrolling list. The first frame showing the top anchors the map
/// (offset 0); every later frame must overlap already-placed rows (same column, same key, |Δy| ≤ tolerance) within
/// ±window of the scrollbar estimate, so a gap between frames can never be silently bridged.</summary>
public sealed class ContentMap<T>(Func<T, int> column, Func<T, int> y, Func<T, string> key, int window, int tolerance)
{
    private readonly List<(int ContentY, T Row, Frame Frame)> _rows = [];
    private readonly List<(IReadOnlyList<T> Rows, Frame Frame, bool Top, bool End, double Estimate, IReadOnlyList<int> Extra)> _pending = [];
    private readonly List<int> _extra = [];
    public bool Anchored { get; private set; }
    public bool EndSeen { get; private set; }
    public int FramesMerged { get; private set; }
    public int FramesRejected => _pending.Count;
    public IReadOnlyList<(int ContentY, T Row, Frame Frame)> Rows => Vision.ReadingOrder(_rows, r => r.ContentY, r => column(r.Row));
    /// <summary>Content-space positions of non-row markers (the "Legacy Origin" heading).</summary>
    public IReadOnlyList<int> Extra => _extra.Distinct().Order().ToArray();

    internal void Add(IReadOnlyList<T> rows, Frame frame, bool atTop, bool atEnd, double estimate, IReadOnlyList<int>? extra = null)
    {
        _pending.Add((rows, frame, atTop, atEnd, estimate, extra ?? []));
        bool progress;
        do
        {
            progress = false;
            foreach (var p in _pending.ToArray())
                if (TryMerge(p.Rows, p.Frame, p.Top, p.End, p.Estimate, p.Extra)) { _pending.Remove(p); progress = true; }
        } while (progress);
    }

    private bool TryMerge(IReadOnlyList<T> rows, Frame frame, bool top, bool end, double estimate, IReadOnlyList<int> extra)
    {
        int shift;
        if (top) shift = 0;
        else
        {
            if (!Anchored) return false;
            var best = (Shift: 0, Count: 0, Off: int.MaxValue);
            var est = (int)Math.Round(estimate);
            for (var s = est - window; s <= est + window; s++)
            {
                var count = rows.Count(r => _rows.Any(e => column(e.Row) == column(r) && key(e.Row) == key(r) && Math.Abs(y(r) + s - e.ContentY) <= tolerance));
                if (count > best.Count || (count == best.Count && Math.Abs(s - est) < best.Off)) best = (s, count, Math.Abs(s - est));
            }
            if (best.Count == 0) return false;
            var diffs = rows.SelectMany(r => _rows.Where(e => column(e.Row) == column(r) && key(e.Row) == key(r) && Math.Abs(y(r) + best.Shift - e.ContentY) <= tolerance).Select(e => e.ContentY - y(r))).Order().ToArray();
            shift = diffs[diffs.Length / 2];
        }
        foreach (var r in rows)
        {
            var cy = y(r) + shift;
            var dup = _rows.FindIndex(e => column(e.Row) == column(r) && Math.Abs(e.ContentY - cy) <= tolerance);
            if (dup < 0) _rows.Add((cy, r, frame));
        }
        _extra.AddRange(extra.Select(e => e + shift));
        if (top) Anchored = true;
        if (end) EndSeen = true;
        FramesMerged++;
        return true;
    }
}

public sealed record SectionStatus(string Section, bool Complete, string Detail);

/// <summary>Assembler output. <see cref="Capture"/> may be present while the 30 §5 checklist is incomplete: that is a
/// diagnostic capture (it satisfies the 30 §10 "01–07 assembles a valid VeteranCapture" check) and is never uploadable,
/// because 01 §3 has no way to say "skills list incomplete" (Q-93). Only a result sealed by the assembler for a complete
/// checklist with no errors is <see cref="Uploadable"/>; editing the capture or crops afterwards breaks the seal.
/// The seal is an integrity guard, not cryptographic trust against hostile same-process code. ParsedFrame is public
/// and can be synthetically edited; callers must supply parser evidence, not fabricated coverage. Cosmetic checklist
/// Detail text is intentionally not sealed.</summary>
public sealed record CaptureResult(VeteranCapture? Capture, IReadOnlyList<(string Path, byte[] Png)> Crops, IReadOnlyList<SectionStatus> Checklist, IReadOnlyList<string> Errors)
{
    internal string? Seal { get; init; }

    /// <summary>Why this result cannot be uploaded (empty when it can): incomplete sections first, then errors.</summary>
    public IReadOnlyList<string> Blockers => Checklist.Where(s => !s.Complete).Select(s => $"{s.Section}: {s.Detail}")
        .Concat(Errors).Concat(Capture is null && Errors.Count == 0 ? ["no capture assembled"] : []).ToArray();

    public bool Uploadable => Capture is not null && Errors.Count == 0 && Checklist.Count > 0 && Checklist.All(s => s.Complete)
                              && Seal is not null && Seal == ComputeSeal(Capture, Crops, Checklist);

    internal static string ComputeSeal(VeteranCapture capture, IReadOnlyList<(string Path, byte[] Png)> crops, IReadOnlyList<SectionStatus> checklist)
    {
        using var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        sha.AppendData(Encoding.UTF8.GetBytes(CaptureJson.Serialize(capture)));
        foreach (var (path, png) in crops) { sha.AppendData(Encoding.UTF8.GetBytes("\0crop\0" + path + "\0")); sha.AppendData(SHA256.HashData(png)); }
        foreach (var c in checklist) sha.AppendData(Encoding.UTF8.GetBytes($"\0{c.Section}\0{c.Complete}"));
        return Convert.ToHexString(sha.GetHashAndReset());
    }
}

/// <summary>Thrown by the outbox for a result that is not <see cref="CaptureResult.Uploadable"/> (T10 shows the checklist).</summary>
public sealed class IncompleteCaptureException(string message) : InvalidOperationException(message);

/// <summary>Collects frames for one veteran (30 §5) and assembles a validated <see cref="VeteranCapture"/>.</summary>
public sealed class CaptureSession
{
    private readonly LayoutProfile _layout;
    private readonly MasterData _master;
    public string IdentityKey { get; }
    private readonly List<(HeaderReading Header, Frame Frame)> _headers = [];
    public ContentMap<SkillRow> Skills { get; }
    public ContentMap<SparkRow> Sparks { get; }
    private (IReadOnlyList<DeckTile> Deck, IReadOnlyList<ParentPortrait> Parents, Frame Frame)? _careerTop;
    private readonly Dictionary<string, Evidence> _career = new(StringComparer.Ordinal);
    private readonly List<ParsedFrame> _popups = [];

    public CaptureSession(LayoutProfile layout, MasterData master, string identityKey)
    {
        _layout = layout; _master = master; IdentityKey = identityKey;
        int window = layout.Int("scrollbar", "alignWindow"), tol = layout.Int("scrollbar", "rowTolerance");
        Skills = new ContentMap<SkillRow>(r => r.Column, r => r.Y, r => Convert.ToString(r.Skill.Value, CultureInfo.InvariantCulture) ?? r.Skill.Raw ?? "", window, tol);
        Sparks = new ContentMap<SparkRow>(r => r.Column, r => r.Y, r => $"{r.Spark.Value}|{r.Stars}", window, tol);
    }

    public void Add(ParsedFrame p)
    {
        if (p.Header is not null) _headers.Add((p.Header, p.Frame));
        var top = Vision.AtTop(p.Thumb, _layout); var end = Vision.AtEnd(p.Thumb, _layout);
        var estimate = p.Thumb is null ? 0 : Vision.ContentOffset(p.Thumb, _layout);
        switch (p.Screen.Id)
        {
            case ScreenId.DetailsSkills: Skills.Add(p.Skills, p.Frame, top, end, estimate); break;
            case ScreenId.DetailsInspiration: Sparks.Add(p.Sparks, p.Frame, top, end, estimate, p.HeadingY is int h ? [h] : []); break;
            case ScreenId.DetailsCareer:
                if (p.Deck.Count > 0 && p.Parents.Count > 0) _careerTop = (p.Deck, p.Parents, p.Frame);
                if (p.Career is { } c)
                    foreach (var (k, r) in new[] { ("races", c.Races), ("wins", c.Wins), ("fans", c.Fans), ("scenario", c.Scenario), ("date", c.Date) })
                        if (r is not null && (!_career.TryGetValue(k, out var old) || (!old.R.Ok && r.Ok))) _career[k] = new Evidence(r, p.Frame);
                break;
            case ScreenId.SparksPopup:
            case ScreenId.SparksPopupGuest: _popups.Add(p); break;
        }
    }

    public IReadOnlyList<SectionStatus> Checklist()
    {
        // A section is complete only when the top and the end were both seen with a detected scroll thumb and every frame
        // was aligned (an unaligned frame may hide a gap). A missing thumb is unknown, never top/end (B1).
        var list = new List<SectionStatus>
        {
            new("details.skills", Skills.Anchored && Skills.EndSeen && Skills.FramesRejected == 0,
                $"{Skills.Rows.Count} skills; top {(Skills.Anchored ? "seen" : "missing")}, end {(Skills.EndSeen ? "seen" : "not reached")}; {Skills.FramesRejected} unaligned frame(s)"),
        };
        var blocks = SparkBlocks();
        list.Add(new("details.inspiration", Sparks.Anchored && Sparks.EndSeen && Sparks.FramesRejected == 0 && blocks.Count == 3,
            $"{blocks.Count}/3 blocks; top {(Sparks.Anchored ? "seen" : "missing")}, end {(Sparks.EndSeen ? "seen" : "not reached")}; {Sparks.FramesRejected} unaligned frame(s)"));
        var deckOk = _careerTop is { Deck.Count: 6 }; var parentsOk = _careerTop is { Parents.Count: 2 };
        list.Add(new("details.career.deck", deckOk, _careerTop is null ? "deck not captured" : $"{_careerTop.Value.Deck.Count}/6 tiles"));
        list.Add(new("details.career.parents", parentsOk, _careerTop is null ? "parents not captured" : $"{_careerTop.Value.Parents.Count}/2 parents"));
        var careerOk = _career.ContainsKey("races") && _career.ContainsKey("wins") && _career.ContainsKey("scenario") && _career.ContainsKey("date");
        list.Add(new("details.career.block", careerOk, string.Join(",", _career.Keys.Order())));
        return list;
    }

    public bool IsComplete => Checklist().All(s => s.Complete);

    /// <summary>Confident header values seen so far (outfit, character, rating, five stats): the session identity (S5).</summary>
    internal Dictionary<string, string> Identity { get; } = new(StringComparer.Ordinal);

    private List<(int Start, int End)> SparkBlocks()
        => FrameParser.Blocks(Sparks.Rows.Select(r => r.ContentY).ToArray(), Sparks.Extra.Count > 0 ? Sparks.Extra[0] : null, _layout.Int("sparks", "blockGap"));

    /// <summary>Assembles, validates and fingerprints. A missing required section is an error (no capture). A parent spark
    /// block that is partial or unreadable is dropped and replaced by the `/sparks/&lt;owner&gt;` low_confidence field
    /// (01 §3); that is uploadable once the Inspiration tab was covered top to end. A list that was not scrolled to its
    /// end yields a diagnostic capture whose result is not <see cref="CaptureResult.Uploadable"/> (B1, Q-93).</summary>
    public CaptureResult Assemble(string captureId, DateTimeOffset capturedAt, string agentVersion)
    {
        var errors = new List<string>();
        var fields = new List<CaptureField>();
        var crops = new List<(string, byte[])>();
        var checklist = Checklist();
        if (_headers.Count == 0) return new CaptureResult(null, [], checklist, ["no Umamusume Details header captured"]);
        if (!Skills.Anchored) errors.Add("Skills tab not captured (the top of the list was not seen with a detectable scroll bar)");

        Evidence Pick(Func<HeaderReading, Reading> f)
        {
            var all = _headers.Select(h => new Evidence(f(h.Header), h.Frame)).ToArray();
            // Prefer a confident reading; several confident readings must agree, otherwise it is uncertain.
            var ok = all.Where(e => e.R.Ok).ToArray();
            if (ok.Length > 0)
            {
                var values = ok.Select(e => Convert.ToString(e.R.Value, CultureInfo.InvariantCulture)).Distinct().Count();
                return values == 1 ? ok[0] : ok[0] with { R = ok[0].R with { Ok = false } };
            }
            return all.FirstOrDefault(e => e.R.Value is not null) ?? all[0];
        }

        T? Emit<T>(string path, Evidence? e, bool vocab = false)
        {
            if (e is null || e.R.Value is null && !(e.R.Ok)) { errors.Add($"{path}: not captured"); return default; }
            var status = e.R.Ok ? FieldStatus.ok : FieldStatus.low_confidence;
            fields.Add(new CaptureField(path, e.R.Raw, e.R.Value, Math.Clamp(Math.Round(e.R.Confidence, 4), 0, 1), status, vocab ? e.R.Candidates.Take(3).ToArray() : [], null));
            if (status == FieldStatus.low_confidence && e.R.Crop is { } crop) crops.Add((path, CropPng(e.Frame, crop)));
            return e.R.Value is T t ? t : default;
        }

        var character = Emit<string>("/characterId", Pick(h => h.Character), true);
        var outfit = Emit<string>("/outfitId", Pick(h => h.Outfit), true);
        var rank = Emit<string>("/rank", Pick(h => h.Rank), true);
        var rating = Emit<int?>("/rating", Pick(h => h.Rating)) ?? 0;
        var epithet = Emit<string>("/epithet", Pick(h => h.Epithet), true) ?? "";
        var trainMode = TrainModeDetector.Detect(epithet);
        fields.Add(new CaptureField("/trainMode", epithet, trainMode.ToString(), 1, FieldStatus.ok, [], null));   // provenance only (Q-110)
        int Stat(string k) => Emit<int?>($"/stats/{k}", Pick(h => h.Stats[k])) ?? 0;
        var stats = new Stats(Stat("spd"), Stat("sta"), Stat("pow"), Stat("gut"), Stat("wit"));
        var apt = new Dictionary<string, string>();
        foreach (var k in new[] { "turf", "dirt", "sprint", "mile", "medium", "long", "front", "pace", "late", "end" })
            apt[k] = Emit<string>($"/aptitudes/{k}", Pick(h => h.Aptitudes[k]), true) ?? "";

        // Skills in reading order (content Y, then column).
        var skills = new List<Skill>();
        foreach (var (_, row, frame) in Skills.Rows)
        {
            var i = skills.Count;
            var id = Emit<string>($"/skills/{i}/skillId", new Evidence(row.Skill, frame), true);
            if (id is null) continue;
            int? level = null;
            if (row.Level.Value is int) level = Emit<int?>($"/skills/{i}/level", new Evidence(row.Level, frame));
            else
            {
                // Non-unique skill: no level (ok). Unique skill whose "Lvl N" was unreadable: null, flagged for review.
                var status = row.Level.Ok ? FieldStatus.ok : FieldStatus.low_confidence;
                fields.Add(new CaptureField($"/skills/{i}/level", row.Level.Raw, null, row.Level.Ok ? 1 : 0, status, [], null));
                if (status == FieldStatus.low_confidence && row.Level.Crop is { } c) crops.Add(($"/skills/{i}/level", CropPng(frame, c)));
            }
            skills.Add(new Skill(id, level));
        }
        if (skills.Select(s => s.SkillId).Distinct().Count() != skills.Count) errors.Add("a skill was read twice; re-scroll the Skills tab");

        // Sparks: owners by block order; missing/partial parent blocks get the /sparks/<owner> flag.
        var sparks = new List<Spark>();
        var blocks = SparkBlocks();
        var owners = new[] { "self", "parent1", "parent2" };
        if (!Sparks.Anchored || blocks.Count == 0) errors.Add("self sparks not captured (Inspiration tab top not seen)");
        if (blocks.Count > 3) errors.Add($"{blocks.Count} spark blocks found; expected at most 3");
        var lastBlockPartial = !Sparks.EndSeen;
        var flagged = new HashSet<string>();
        for (var b = 0; b < Math.Min(blocks.Count, 3); b++)
        {
            var owner = owners[b];
            var rows = Sparks.Rows.Where(r => r.ContentY >= blocks[b].Start && r.ContentY <= blocks[b].End).ToArray();
            var partial = lastBlockPartial && b == blocks.Count - 1;
            var start = sparks.Count; var startFields = fields.Count; var startCrops = crops.Count;
            foreach (var (_, row, frame) in rows)
            {
                var i = sparks.Count;
                if (row.Spark.Value is null)
                {
                    // Unreadable label: fatal for self; for a parent the whole block is dropped and flagged below (S1).
                    if (owner == "self") errors.Add($"self spark label unreadable (/sparks/{i}/sparkId)");
                    partial = true; continue;
                }
                var id = Emit<string>($"/sparks/{i}/sparkId", new Evidence(row.Spark, frame), true)!;
                var type = _master.Sparks.TryGetValue(id, out var info) ? info.Type : row.Type ?? "white";
                fields.Add(new CaptureField($"/sparks/{i}/type", row.Type, type, row.Type == type ? 1 : 0.5, row.Type == type ? FieldStatus.ok : FieldStatus.low_confidence, [], null));
                // The emitted value always equals the payload value; an unclear or out-of-range count is clamped to 1..3
                // and flagged with every legal count as a candidate (S2).
                var stars = Math.Clamp(row.Stars, 1, 3);
                var starsOk = row.StarsClear && row.Stars is >= 1 and <= 3;
                Candidate[] starCandidates = starsOk ? [] : [new(stars, 0.5), .. new[] { 1, 2, 3 }.Where(n => n != stars).Select(n => new Candidate(n, 0.25))];
                fields.Add(new CaptureField($"/sparks/{i}/stars", row.Stars.ToString(CultureInfo.InvariantCulture), stars, starsOk ? 1 : 0.5, starsOk ? FieldStatus.ok : FieldStatus.low_confidence, starCandidates, null));
                if (!starsOk && row.Spark.Crop is { } sc) crops.Add(($"/sparks/{i}/stars", CropPng(frame, sc)));
                sparks.Add(new Spark(owner, id, type, stars));
            }
            var own = sparks.Skip(start).ToArray();
            var shapeOk = own.Count(s => s.Type == "blue") == 1 && own.Count(s => s.Type == "pink") == 1 && own.Count(s => s.Type == "green") <= 1
                          && own.Select(s => s.SparkId).Distinct().Count() == own.Length;
            if (!shapeOk || partial)
            {
                if (owner == "self") { errors.Add(partial ? "self spark block is incomplete" : "self spark block violates the blue/pink/green shape"); continue; }
                // Not representable as a complete block: drop it, keep only the explicit owner-block flag (01 §3).
                sparks.RemoveRange(start, sparks.Count - start); fields.RemoveRange(startFields, fields.Count - startFields); crops.RemoveRange(startCrops, crops.Count - startCrops);
                flagged.Add(owner);
            }
        }
        foreach (var owner in owners.Skip(1).Where(o => !sparks.Any(s => s.Owner == o) || flagged.Contains(o)))
            fields.Add(new CaptureField("/sparks/" + owner, null, null, 0, FieldStatus.low_confidence, [], null));

        // Deck and parents from the Career Info top frame; parents may be resolved exactly by a Sparks popup.
        var deck = new List<Deck>();
        var parents = new List<Parent>();
        if (_careerTop is { } top)
        {
            foreach (var t in top.Deck)
            {
                var i = deck.Count;
                var card = Emit<string>($"/deck/{i}/cardId", new Evidence(t.Card, top.Frame), true);
                var lb = Emit<int?>($"/deck/{i}/lb", new Evidence(t.Lb, top.Frame)) ?? 0;
                var lvl = Emit<int?>($"/deck/{i}/level", new Evidence(t.Level, top.Frame)) ?? 0;
                var borrowed = Emit<bool?>($"/deck/{i}/borrowed", new Evidence(t.Borrowed, top.Frame)) ?? false;
                if (card is not null) deck.Add(new Deck(i + 1, card, lb, lvl, borrowed));
            }
            var resolved = ResolveParents(top.Parents, sparks);
            foreach (var (portrait, popup) in resolved)
            {
                var i = parents.Count;
                Evidence characterEv = popup?.PopupCharacter is { Ok: true } pc ? new Evidence(pc, popup.Frame) : new Evidence(portrait.Character, top.Frame);
                var characterId = Emit<string>($"/parents/{i}/characterId", characterEv, true);
                string? outfitId = null;
                if (popup?.PopupOutfit is { } po) outfitId = Emit<string>($"/parents/{i}/outfitId", new Evidence(po, popup.Frame), true);
                else
                {
                    // Unresolved (no matching Sparks popup): null is a gap, not a reading. Flag it for review with the
                    // portrait crop; the pointer resolves to the null leaf, which the API accepts as correctable (S7).
                    fields.Add(new CaptureField($"/parents/{i}/outfitId", null, null, 0, FieldStatus.low_confidence, [], null));
                    if (portrait.IsGuest.Crop is { } oc) crops.Add(($"/parents/{i}/outfitId", CropPng(top.Frame, oc)));
                }
                var isGuest = popup is not null ? popup.Screen.Id == ScreenId.SparksPopupGuest : portrait.IsGuest.Get<bool>();
                if (popup is not null && popup.Screen.Id == ScreenId.SparksPopupGuest != portrait.IsGuest.Get<bool>())
                    Emit<bool?>($"/parents/{i}/isGuest", new Evidence(portrait.IsGuest with { Value = isGuest, Ok = false }, top.Frame));
                else Emit<bool?>($"/parents/{i}/isGuest", new Evidence(portrait.IsGuest with { Value = isGuest }, top.Frame));
                string? trainer = null;
                if (isGuest)
                {
                    if (popup?.GuestTrainer is { } gt) trainer = Emit<string>($"/parents/{i}/guestTrainer", new Evidence(gt, popup.Frame));
                    else
                    {
                        fields.Add(new CaptureField($"/parents/{i}/guestTrainer", null, null, 0, FieldStatus.low_confidence, [], null));
                        if (portrait.IsGuest.Crop is { } gc) crops.Add(($"/parents/{i}/guestTrainer", CropPng(top.Frame, gc)));
                    }
                }
                if (characterId is not null) parents.Add(new Parent(i + 1, characterId, outfitId, isGuest, trainer));
            }
        }
        else errors.Add("Career Info top (deck + parents) not captured");

        var scenario = Emit<string>("/scenarioId", _career.GetValueOrDefault("scenario"), true);
        var races = Emit<int?>("/career/races", _career.GetValueOrDefault("races")) ?? 0;
        var wins = Emit<int?>("/career/wins", _career.GetValueOrDefault("wins")) ?? 0;
        int? fans = null;
        if (_career.TryGetValue("fans", out var fe)) fans = Emit<int?>("/career/fans", fe);
        var date = Emit<string>("/career/dateAcquired", _career.GetValueOrDefault("date"));

        if (errors.Count > 0 || character is null || outfit is null || rank is null || scenario is null || date is null)
            return new CaptureResult(null, [], checklist, errors.Count > 0 ? errors : ["required field missing"]);

        var veteran = new Veteran(character, outfit, rank, rating, epithet, trainMode, stats, new Aptitudes(apt), skills, sparks, deck, parents, scenario, new Career(races, wins, fans, date));
        var capture = new VeteranCapture(1, captureId, capturedAt, agentVersion, _layout.Version, _master.Version, Fingerprint.Hash(veteran), veteran, fields);
        var validation = CaptureValidation.Validate(capture, _master.Ids);
        if (validation.Count > 0) return new CaptureResult(null, [], checklist, validation);
        var complete = checklist.All(s => s.Complete);
        return new CaptureResult(capture, crops, checklist, []) { Seal = complete ? CaptureResult.ComputeSeal(capture, crops, checklist) : null };
    }

    /// <summary>Pairs each parent portrait with a Sparks popup that proves its identity: the popup's sparks equal that
    /// parent's spark block, or (no block) the guest flag/portrait candidates agree. Popups for other veterans don't match.</summary>
    private List<(ParentPortrait Portrait, ParsedFrame? Popup)> ResolveParents(IReadOnlyList<ParentPortrait> portraits, IReadOnlyList<Spark> sparks)
    {
        var result = new List<(ParentPortrait, ParsedFrame?)>();
        foreach (var p in portraits)
        {
            var owner = "parent" + p.Slot;
            var block = sparks.Where(s => s.Owner == owner).Select(s => $"{s.SparkId}|{s.Stars}").Order().ToArray();
            ParsedFrame? match = null;
            foreach (var popup in _popups.Where(x => x.PopupCharacter is { Ok: true }))
            {
                var popupSparks = popup.Sparks.Where(s => s.Spark.Value is not null).Select(s => $"{s.Spark.Value}|{s.Stars}").Order().ToArray();
                var sameBlock = block.Length > 0 && popupSparks.SequenceEqual(block);
                var guestAgrees = (popup.Screen.Id == ScreenId.SparksPopupGuest) == p.IsGuest.Get<bool>();
                var inCandidates = p.Character.Candidates.Any(c => (string?)c.Value == (string?)popup.PopupCharacter!.Value);
                if (sameBlock || (block.Length == 0 && guestAgrees && inCandidates)) { match = popup; break; }
            }
            result.Add((p, match));
        }
        return result;
    }

    /// <summary>PNG of the field's ROI (≤ 60 KB, 01 §8), downscaled if needed.</summary>
    public static byte[] CropPng(Frame frame, Rect r)
    {
        var x = Math.Clamp(r.X, 0, frame.Width - 1); var y = Math.Clamp(r.Y, 0, frame.Height - 1);
        var rect = new Rect(x, y, Math.Min(r.Width, frame.Width - x), Math.Min(r.Height, frame.Height - y));
        using var image = Frames.ToImage(Frames.Crop(frame, rect));
        for (var scale = 1.0; ; scale *= 0.7)
        {
            using var copy = scale < 1 ? image.Clone(c => c.Resize(Math.Max(1, (int)(rect.Width * scale)), Math.Max(1, (int)(rect.Height * scale)))) : image.Clone();
            using var ms = new MemoryStream();
            copy.Save(ms, new PngEncoder { CompressionLevel = PngCompressionLevel.BestCompression });
            if (ms.Length <= 60 * 1024 || scale < 0.05) return ms.ToArray();
        }
    }
}

/// <summary>Routes parsed frames to per-veteran sessions. A veteran is identified by its confident header values: outfit,
/// character, rating and the five stats (30 §5 names outfit + name + rating; stats are added so two veterans that share
/// those three are never merged, S5). A frame joins a session only if no confident value conflicts.
/// <list type="bullet">
/// <item>Continuity: right after a frame of the current session (popups don't break it), a compatible frame continues it.</item>
/// <item>Otherwise exactly one compatible session must exist; several compatible sessions is ambiguous and the frame is
/// ignored (<see cref="AmbiguousIdentity"/>), never guessed.</item>
/// <item>No compatible session: a new one starts, but only when outfit, character and rating were all read confidently.</item>
/// </list>
/// Popups attach to the current session; unknown and card screens are ignored and break continuity.</summary>
public sealed class CaptureCoordinator(LayoutProfile layout, MasterData master)
{
    private static readonly string[] Required = ["outfit", "character", "rating"];
    private readonly List<CaptureSession> _sessions = [];
    private bool _continuing;
    public CaptureSession? Current { get; private set; }
    public IReadOnlyCollection<CaptureSession> Sessions => _sessions;
    public int Ignored { get; private set; }
    public int AmbiguousIdentity { get; private set; }

    internal static Dictionary<string, string> ConfidentIdentity(HeaderReading h)
    {
        var d = new Dictionary<string, string>(StringComparer.Ordinal);
        void Add(string k, Reading r) { if (r.Ok && r.Value is not null) d[k] = Convert.ToString(r.Value, CultureInfo.InvariantCulture)!; }
        Add("outfit", h.Outfit); Add("character", h.Character); Add("rating", h.Rating);
        foreach (var (k, r) in h.Stats) Add("stats/" + k, r);
        return d;
    }

    private static bool Compatible(CaptureSession s, IReadOnlyDictionary<string, string> id)
        => id.All(kv => !s.Identity.TryGetValue(kv.Key, out var v) || v == kv.Value);

    public CaptureSession? Feed(ParsedFrame p)
    {
        switch (p.Screen.Id)
        {
            case ScreenId.DetailsSkills or ScreenId.DetailsInspiration or ScreenId.DetailsCareer when p.Header is not null:
            {
                var id = ConfidentIdentity(p.Header);
                CaptureSession? target;
                if (_continuing && Current is not null && Compatible(Current, id)) target = Current;
                else
                {
                    var compatible = _sessions.Where(s => Compatible(s, id)).ToList();
                    if (compatible.Count > 1) { AmbiguousIdentity++; Current = null; _continuing = false; return null; }
                    if (compatible.Count == 1) target = compatible[0];
                    else if (Required.All(id.ContainsKey)) { target = new CaptureSession(layout, master, p.Header.IdentityKey); _sessions.Add(target); }
                    else { AmbiguousIdentity++; Current = null; _continuing = false; return null; }
                }
                foreach (var (k, v) in id) target.Identity.TryAdd(k, v);
                Current = target; _continuing = true; target.Add(p); return target;
            }
            case ScreenId.SparksPopup or ScreenId.SparksPopupGuest when Current is not null:
                Current.Add(p); return Current;
            default:
                Ignored++; _continuing = false; return null;
        }
    }
}
