using System.Globalization;
using System.Text.RegularExpressions;

namespace Uma.Agent.Core;

/// <summary>One extracted value with provenance. `Ok` = confident enough to submit as `ok`; otherwise the assembler
/// emits `low_confidence` with the candidates and queues `Crop` for upload. Values are never forced to a label.</summary>
public sealed record Reading(object? Value, string? Raw, double Confidence, bool Ok, IReadOnlyList<Candidate> Candidates, Rect? Crop)
{
    public static Reading Missing(Rect? crop = null, string? raw = null) => new(null, raw, 0, false, [], crop);
    public T? Get<T>() => Value is T t ? t : default;
}

public sealed record HeaderReading(Reading Character, Reading Outfit, Reading Rank, Reading Rating, Reading Epithet,
    IReadOnlyDictionary<string, Reading> Stats, IReadOnlyDictionary<string, Reading> Aptitudes)
{
    /// <summary>Veteran identity (30 §5): outfit + name + rating, from IDs when accepted, else normalised OCR text.</summary>
    public string IdentityKey => string.Join("|", Key(Outfit), Key(Character), Key(Rating));
    private static string Key(Reading r) => r.Ok ? Convert.ToString(r.Value, CultureInfo.InvariantCulture)! : "?" + VocabIndex.Normalize(r.Raw ?? "");
}

public sealed record SkillRow(int Column, int Y, Reading Skill, Reading Level);
public sealed record SparkRow(int Column, int Y, Reading Spark, string? Type, double TypeDistance, int Stars, bool StarsClear, string? Owner);
public sealed record DeckTile(int Slot, Reading Card, Reading Lb, Reading Level, Reading Borrowed);
public sealed record ParentPortrait(int Slot, Reading Character, Reading IsGuest);
public sealed record CareerRows(Reading? Races, Reading? Wins, Reading? Fans, Reading? Scenario, Reading? Date);
public sealed record ListTile(int Index, Reading Card, Reading Lb, Reading Level);

public sealed record ParsedFrame(ScreenClassification Screen, Frame Frame, ScrollThumb? Thumb)
{
    public HeaderReading? Header { get; init; }
    public IReadOnlyList<SkillRow> Skills { get; init; } = [];
    public IReadOnlyList<SparkRow> Sparks { get; init; } = [];
    public int? HeadingY { get; init; }
    public IReadOnlyList<DeckTile> Deck { get; init; } = [];
    public IReadOnlyList<ParentPortrait> Parents { get; init; } = [];
    public CareerRows? Career { get; init; }
    public Reading? PopupCharacter { get; init; }
    public Reading? PopupOutfit { get; init; }
    public Reading? GuestTrainer { get; init; }
    public Reading? HeldCount { get; init; }
    public IReadOnlyList<ListTile> ListTiles { get; init; } = [];
    public Reading? DetailCard { get; init; }
    public Reading? DetailLevel { get; init; }
}

/// <summary>All screen parsers (30 §4). Inputs: a frame, recorded or live OCR, the layout profile, the master bundle and
/// templates cut from fixture crops. Nothing here knows fixture names or expected values.</summary>
public sealed partial class FrameParser
{
    private readonly LayoutProfile _layout;
    private readonly MasterData _master;
    private readonly VocabIndex _vocab;
    private readonly IReadOnlyDictionary<string, TemplateSet> _templates;
    private readonly IOcrEngine _ocr;
    private readonly ScreenClassifier _classifier;
    private static readonly string[] StatKeys = ["spd", "sta", "pow", "gut", "wit"];

    public FrameParser(LayoutProfile layout, MasterData master, IReadOnlyDictionary<string, TemplateSet> templates, IOcrEngine ocr)
    {
        _layout = layout; _master = master; _templates = templates; _ocr = ocr;
        _vocab = new VocabIndex(master.Vocab); _classifier = new ScreenClassifier(layout, ocr);
    }

    public VocabIndex Vocab => _vocab;

    public async Task<ParsedFrame> ParseAsync(Frame raw)
    {
        var frame = Frames.Normalize(raw);
        var screen = await _classifier.ClassifyAsync(frame);
        var thumb = screen.Id is ScreenId.DetailsSkills or ScreenId.DetailsInspiration or ScreenId.DetailsCareer ? Vision.Thumb(frame, _layout) : null;
        var parsed = new ParsedFrame(screen, frame, thumb);
        switch (screen.Id)
        {
            case ScreenId.DetailsSkills:
                return parsed with { Header = await HeaderAsync(frame), Skills = await SkillsAsync(frame) };
            case ScreenId.DetailsInspiration:
            {
                var heading = await HeadingAsync(frame);
                return parsed with { Header = await HeaderAsync(frame), Sparks = await SparksAsync(frame, "details.inspiration", Vision.AtTop(thumb, _layout), heading), HeadingY = heading };
            }
            case ScreenId.DetailsCareer:
            {
                var atTop = Vision.AtTop(thumb, _layout);
                return parsed with
                {
                    Header = await HeaderAsync(frame),
                    Deck = atTop ? await DeckAsync(frame) : [],
                    Parents = atTop ? await ParentsAsync(frame) : [],
                    Career = await CareerAsync(frame),
                };
            }
            case ScreenId.SparksPopup:
            case ScreenId.SparksPopupGuest:
            {
                var guest = screen.Id == ScreenId.SparksPopupGuest;
                var (character, outfit) = await IdentityAsync(frame, _layout.Rect("popupHeader", "name"), _layout.Rect("popupHeader", "outfit"));
                Reading? trainer = null;
                if (guest)
                {
                    var roi = _layout.Rect("popupHeader", "trainer");
                    var (t, c) = await Ocr.TextAsync(_ocr, frame, roi);
                    trainer = t.Length > 0 ? new Reading(t.Trim(), t, c, c >= 0.5, [], roi) : Reading.Missing(roi);
                }
                return parsed with
                {
                    PopupCharacter = character, PopupOutfit = outfit, GuestTrainer = trainer,
                    Sparks = await SparksAsync(frame, guest ? "sparks.popup.guest" : "sparks.popup", true, null, popup: true),
                };
            }
            case ScreenId.CardsList:
                return parsed with { HeldCount = await HeldAsync(frame), ListTiles = await ListTilesAsync(frame) };
            case ScreenId.CardsDetail:
            {
                var (card, level) = await DetailAsync(frame);
                return parsed with { DetailCard = card, DetailLevel = level };
            }
            default: return parsed;
        }
    }

    // ---------- header ----------
    public async Task<HeaderReading> HeaderAsync(Frame f)
    {
        var (character, outfit) = await IdentityAsync(f, _layout.Rect("header", "name"), _layout.Rect("header", "outfit"));
        var rating = await DigitsAsync(f, _layout.Rect("header", "rating"), 0, 1_000_000);
        var rank = Rank(f, rating);
        var epithetRoi = _layout.Rect("header", "epithet");
        var (eText, eConf) = await Ocr.TextAsync(_ocr, f, epithetRoi);
        var em = _vocab.Match(eText, "epithet");
        var epithetText = em.Accepted ? _vocab.TextsOf("epithet", em.Id!).First() : VocabIndex.Normalize(eText);
        var epithet = new Reading(epithetText, eText, em.Accepted ? Math.Min(eConf, em.Score) : em.Score, em.Accepted && eConf >= 0.5,
            em.Candidates.Select(c => new Candidate(_vocab.TextsOf("epithet", (string)c.Value!).First(), c.Score)).ToArray(), epithetRoi);
        var stats = new Dictionary<string, Reading>();
        foreach (var k in StatKeys) stats[k] = await DigitsAsync(f, _layout.Rect("header", "stats", k), 1, 2000);
        var apt = new Dictionary<string, Reading>();
        var grade = _templates["grade"];
        foreach (var cell in _layout.At("header", "aptitudeCells").EnumerateObject())
        {
            var roi = LayoutProfile.R(cell.Value);
            var m = grade.Match(f, roi);
            apt[cell.Name] = new Reading(m.Label ?? (string?)m.Candidates.FirstOrDefault()?.Value, null, m.Candidates.FirstOrDefault()?.Score ?? 0, m.Accepted, m.Candidates, Pad(roi, 6));
        }
        return new HeaderReading(character, outfit, rank, rating, epithet, stats, apt);
    }

    private Reading Rank(Frame f, Reading rating)
    {
        var roi = _layout.Rect("header", "rank");
        var m = _templates["rank"].Match(f, roi);
        var band = rating.Ok ? _master.RankForRating((int)rating.Value!)?.Id : null;
        if (m.Accepted)
        {
            // Template and master rating band must agree (Q-7: the ladder is unverified, so disagreement is low confidence).
            var agrees = band is null || band == m.Label;
            return new Reading(m.Label, null, m.Candidates[0].Score, agrees && _master.Ids["ranks"].Contains(m.Label!), m.Candidates, roi);
        }
        // No template is confident (unseen badge): propose the rating band, flagged for review.
        var candidates = band is null ? m.Candidates : new[] { new Candidate(band, 0.5) }.Concat(m.Candidates).Take(3).ToArray();
        return new Reading(band ?? (string?)m.Candidates.FirstOrDefault()?.Value, null, 0.5, false, candidates, roi);
    }

    /// <summary>Character name + outfit title. The outfit is matched among the matched character's outfits when known.</summary>
    private async Task<(Reading Character, Reading Outfit)> IdentityAsync(Frame f, Rect nameRoi, Rect outfitRoi)
    {
        var (nText, nConf) = await Ocr.TextAsync(_ocr, f, nameRoi);
        var cm = _vocab.Match(nText, "character");
        var character = new Reading(cm.Id ?? cm.Best, nText, cm.Score, cm.Accepted && nConf >= 0.5, cm.Candidates, nameRoi);
        var (oText, oConf) = await Ocr.TextAsync(_ocr, f, outfitRoi);
        IReadOnlySet<string>? allowed = cm.Accepted ? _master.Outfits.Values.Where(o => o.CharacterId == cm.Id).Select(o => o.Id).ToHashSet() : null;
        var om = OutfitTitles(oText).Select(t => _vocab.Match(t, "outfit", restrictTo: allowed)).OrderByDescending(m => m.Accepted).ThenByDescending(m => m.Score).First();
        var outfit = new Reading(om.Id ?? om.Best, oText, om.Score, om.Accepted && oConf >= 0.5, om.Candidates, outfitRoi);
        if (!cm.Accepted && om.Accepted)
        {
            // The outfit implies the character; keep it flagged because the name itself was unreadable.
            var owner = _master.Outfits[om.Id!].CharacterId;
            character = character with { Value = owner, Candidates = new[] { new Candidate(owner, om.Score) }.Concat(cm.Candidates).Take(3).ToArray() };
        }
        return (character, outfit);
    }

    /// <summary>"[Frontline Elegancel" → "Frontline Elegance": OCR reads the closing bracket as l/|/I (30 §4). Both readings are tried.</summary>
    public static IEnumerable<string> OutfitTitles(string text)
    {
        var s = text.Trim();
        var opened = s.StartsWith('[');
        if (opened) s = s[1..];
        if (s.EndsWith(']')) { yield return s[..^1].Trim(); yield break; }
        yield return s.Trim();
        if (opened && s.Length > 1 && s[^1] is 'l' or '|' or 'I' or '1') yield return s[..^1].Trim();
    }

    private async Task<Reading> DigitsAsync(Frame f, Rect roi, int min, int max)
    {
        var (text, conf) = await Ocr.TextAsync(_ocr, f, roi, OcrMode.Digits);
        var v = Ocr.ParseInt(text.Replace(" ", ""));
        if (v is null) return Reading.Missing(roi, text);
        var ok = v >= min && v <= max && conf >= 0.5;
        return new Reading(v, text, conf, ok, [], roi);
    }

    // ---------- skills ----------
    public async Task<IReadOnlyList<SkillRow>> SkillsAsync(Frame f)
    {
        var rows = new List<SkillRow>();
        var cols = _layout.At("skills", "columns");
        int h = _layout.Int("skills", "pillHeight"), labelLeft = _layout.Int("skills", "labelLeft");
        for (var c = 0; c < cols.GetArrayLength(); c++)
        {
            int left = cols[c].GetProperty("left").GetInt32(), right = cols[c].GetProperty("right").GetInt32();
            foreach (var bottom in Vision.SkillPillBottoms(f, _layout, c))
            {
                var pill = new Rect(left, bottom - h, right - left, h);
                var roi = new Rect(left + labelLeft, bottom - h, right - left - labelLeft, h);
                var lines = (await _ocr.ReadAsync(f, roi, OcrMode.Text)).OrderBy(l => l.Box.Y).ThenBy(l => l.Box.X).ToList();
                Reading level = Reading.Missing(pill);
                var levelLine = lines.FirstOrDefault(l => LevelOnly().IsMatch(l.Text.Trim()));
                if (levelLine is not null)
                {
                    lines.Remove(levelLine);
                    var lv = Ocr.ParseLevel(levelLine.Text);
                    level = lv is null ? Reading.Missing(pill, levelLine.Text) : new Reading(lv, levelLine.Text, levelLine.Confidence, levelLine.Confidence >= 0.5, [], pill);
                }
                // A trailing "Lvl N" can also be glued to the name line.
                if (level.Value is null && lines.Count > 0)
                {
                    var glued = GluedLevel().Match(lines[^1].Text);
                    if (glued.Success)
                    {
                        var last = lines[^1];
                        lines[^1] = last with { Text = last.Text[..glued.Index].TrimEnd() };
                        level = new Reading(int.Parse(glued.Groups[1].Value, CultureInfo.InvariantCulture), glued.Value, last.Confidence, last.Confidence >= 0.5, [], pill);
                    }
                }
                var text = string.Join(' ', lines.Select(l => l.Text.Trim()));
                if (text.Length == 0) { rows.Add(new SkillRow(c, bottom, Reading.Missing(pill), level)); continue; }
                var glyph = HasCircle(text) ? Vision.Circle(f, _layout, lines[^1].Box).Glyph : CircleGlyph.None;
                var m = _vocab.Match(text, "skill", glyph);
                var conf = lines.Min(l => l.Confidence);
                var skill = new Reading(m.Id ?? m.Best, text, m.Score, m.Accepted && conf >= 0.5, m.Candidates, pill);
                if (m.Accepted)
                {
                    var unique = _master.UniqueSkills.Contains(m.Id!);
                    if (!unique && level.Value is not null) level = level with { Ok = false };       // only unique skills carry a level
                    if (!unique && level.Value is null) level = new Reading(null, null, 1, true, [], pill);
                    if (unique && level.Value is null) level = level with { Ok = false };
                }
                rows.Add(new SkillRow(c, bottom, skill, level));
            }
        }
        return Vision.ReadingOrder(rows, r => r.Y, r => r.Column);
    }

    private static bool HasCircle(string text) => CircleTail().IsMatch(text.TrimEnd());

    // ---------- sparks ----------
    private async Task<int?> HeadingAsync(Frame f)
    {
        var lines = await _ocr.ReadAsync(f, _layout.Rect("sparks", "details.inspiration", "headingRoi"), OcrMode.Text);
        var heading = _layout.Str("sparks", "details.inspiration", "headingText");
        var hit = lines.FirstOrDefault(l => VocabIndex.Score(VocabIndex.Normalize(l.Text), heading) >= 0.85);
        return hit is null ? null : hit.Box.Y + hit.Box.Height / 2;
    }

    public async Task<IReadOnlyList<SparkRow>> SparksAsync(Frame f, string screen, bool atTop, int? headingY, bool popup = false)
    {
        var strips = Vision.SparkStrips(f, _layout, screen);
        var view = _layout.Sparks(screen);
        var window = _layout.Ints("sparks", "labelWindow");
        var rows = new List<SparkRow>();
        foreach (var s in strips)
        {
            var col = view.Columns[s.Column];
            var roi = new Rect(col.Left, s.Y0 + window[0], col.Right - col.Left, window[1] - window[0]);
            var pill = new Rect(col.Left, s.Y0 + _layout.Int("sparks", "pillTopOffset"), col.Right - col.Left, s.Y1 - s.Y0 + 1 - _layout.Int("sparks", "pillTopOffset"));
            // Star rows OCR as "***", "*2→" etc.: a label line needs at least two letters.
            var lines = (await _ocr.ReadAsync(f, roi, OcrMode.Text)).Where(l => l.Text.Count(char.IsLetter) >= 2).OrderBy(l => l.Box.Y).ThenBy(l => l.Box.X).ToList();
            var text = string.Join(' ', lines.Select(l => l.Text.Trim()));
            Reading spark;
            if (text.Length == 0) spark = Reading.Missing(pill);
            else
            {
                var glyph = HasCircle(text) ? Vision.Circle(f, _layout, lines[^1].Box).Glyph : CircleGlyph.None;
                var m = _vocab.Match(text, "spark", glyph);
                var ok = m.Accepted && lines.Min(l => l.Confidence) >= 0.3;
                // The pill colour is independent evidence: a label whose master type disagrees is not trusted.
                if (ok && s.Type is not null && _master.Sparks[m.Id!].Type != s.Type) ok = false;
                spark = new Reading(m.Id ?? m.Best, text, m.Score, ok, m.Candidates, pill);
            }
            var clear = s.Ratios.All(r => r < 0.08 || r > 0.22);
            rows.Add(new SparkRow(s.Column, s.Y0, spark, s.Type, s.TypeDistance, s.Stars, clear, null));
        }
        if (popup) return rows.Select(r => r with { Owner = "self" }).ToArray();
        return AssignOwners(rows, atTop, headingY);
    }

    /// <summary>Owner by block order (30 §4): blocks split at the "Legacy Origin" heading or a vertical gap. Only decided
    /// when the frame shows the top of the tab or the heading; otherwise left null for the session to align.</summary>
    public IReadOnlyList<SparkRow> AssignOwners(IReadOnlyList<SparkRow> rows, bool atTop, int? headingY)
    {
        var blocks = Blocks(rows.Select(r => r.Y).ToArray(), headingY, _layout.Int("sparks", "blockGap"));
        string? OwnerOf(int y)
        {
            var b = blocks.FindIndex(x => y >= x.Start && y <= x.End);
            if (atTop) return b < 3 ? new[] { "self", "parent1", "parent2" }[b] : null;
            if (headingY is null) return null;
            var after = blocks.Where(x => x.Start > headingY).ToList();
            if (y < headingY) return "self";
            var i = after.FindIndex(x => y >= x.Start && y <= x.End);
            return i switch { 0 => "parent1", 1 => "parent2", _ => null };
        }
        return rows.Select(r => r with { Owner = OwnerOf(r.Y) }).ToArray();
    }

    public static List<(int Start, int End)> Blocks(IReadOnlyList<int> ys, int? headingY, int gap)
    {
        var sorted = ys.Distinct().Order().ToArray();
        var blocks = new List<(int Start, int End)>();
        foreach (var y in sorted)
        {
            var split = blocks.Count == 0 || y - blocks[^1].End > gap || (headingY is int h && blocks[^1].End < h && y > h);
            if (split) blocks.Add((y, y)); else blocks[^1] = (blocks[^1].Start, y);
        }
        return blocks;
    }

    // ---------- career ----------
    public async Task<IReadOnlyList<DeckTile>> DeckAsync(Frame f)
    {
        var d = _layout.At("career", "deck");
        int tiles = d.GetProperty("tiles").GetInt32(), tileY = d.GetProperty("tileY").GetInt32(), tileW = d.GetProperty("tileW").GetInt32(), tileH = d.GetProperty("tileH").GetInt32();
        double pitch = d.GetProperty("tilePitch").GetDouble(), lbPitch = d.GetProperty("lbPitch").GetDouble();
        var level = LayoutProfile.R(d.GetProperty("levelRoi")); var band = LayoutProfile.R(d.GetProperty("friendsBand"));
        var friends = d.GetProperty("friendsRgb").EnumerateArray().Select(e => e.GetInt32()).ToArray();
        var result = new List<DeckTile>();
        for (var t = 0; t < tiles; t++)
        {
            var x = Round(d.GetProperty("tileX").GetInt32() + t * pitch);
            var tile = new Rect(x, tileY, tileW, tileH);
            var card = HashMatch(f, tile, _master.CardArtHashes, _layout.CardArtCrop, d.GetProperty("search").GetInt32(), d.GetProperty("maxDistance").GetInt32(), d.GetProperty("minMargin").GetInt32());
            var bandColor = f.Median(new Rect(x + band.X, band.Y, band.Width, band.Height));
            var friendDistance = Frames.ColorDistance(bandColor, friends);
            var borrowed = friendDistance <= d.GetProperty("friendsMaxDistance").GetDouble();
            var lbY = borrowed ? d.GetProperty("lbYBorrowed").GetInt32() : d.GetProperty("lbY").GetInt32();
            var lb = Lb(f, Round(d.GetProperty("lbFirstX").GetDouble() + t * pitch), lbPitch, lbY, tile with { Height = tileH + 30 });
            var levelRoi = new Rect(x + level.X, level.Y, level.Width, level.Height);
            var (lText, lConf) = await Ocr.TextAsync(_ocr, f, levelRoi);
            var lv = Ocr.ParseLevel(lText);
            var lvl = lv is null ? Reading.Missing(levelRoi, lText) : new Reading(lv, lText, lConf, lConf >= 0.5 && lv is >= 1 and <= 50, [], levelRoi);
            result.Add(new DeckTile(t + 1, card, lb, lvl, new Reading(borrowed, null, 1, true, [], tile with { Height = tileH + 30 })));
        }
        return result;
    }

    private Reading Lb(Frame f, int firstX, double pitch, int y, Rect crop)
    {
        var filled = 0;
        for (var k = 0; k < 4; k++) if (Vision.LbFilled(f, _layout, Round(firstX + k * pitch), y)) filled++;
        return new Reading(filled, null, 1, true, [], crop);
    }

    public async Task<IReadOnlyList<ParentPortrait>> ParentsAsync(Frame f)
    {
        var p = _layout.At("career", "parents");
        int r = p.GetProperty("radius").GetInt32();
        var guestRoi = LayoutProfile.R(p.GetProperty("guestRoi")); var guestText = p.GetProperty("guestText").GetString()!;
        var result = new List<ParentPortrait>();
        var slot = 0;
        foreach (var c in p.GetProperty("centers").EnumerateArray())
        {
            slot++;
            int cx = c[0].GetInt32(), cy = c[1].GetInt32();
            var box = new Rect(cx - r, cy - r, 2 * r, 2 * r);
            var character = HashMatch(f, box, _master.CharacterIconHashes, _layout.CharIconCrop, p.GetProperty("search").GetInt32(), p.GetProperty("maxDistance").GetInt32(), p.GetProperty("minMargin").GetInt32());
            var roi = new Rect(cx + guestRoi.X, guestRoi.Y, guestRoi.Width, guestRoi.Height);
            var (text, conf) = await Ocr.TextAsync(_ocr, f, roi);
            var guest = text.Length > 0 && VocabIndex.Score(VocabIndex.Normalize(text), guestText) >= 0.85;
            result.Add(new ParentPortrait(slot, character, new Reading(guest, text, guest ? conf : 0.9, !guest || conf >= 0.5, [], box with { Height = box.Height + 40 })));
        }
        return result;
    }

    public async Task<CareerRows> CareerAsync(Frame f)
    {
        var roi = _layout.Rect("career", "rows", "roi");
        int keyMaxX = _layout.Int("career", "rows", "keyMaxX"), tol = _layout.Int("career", "rows", "rowTolerance");
        var lines = await _ocr.ReadAsync(f, roi, OcrMode.Text);
        Reading? races = null, wins = null, fans = null, scenario = null, date = null;
        foreach (var key in lines.Where(l => l.Box.X + l.Box.Width / 2 < keyMaxX))
        {
            var kind = _layout.At("career", "keys").EnumerateObject().Select(k => (k.Value.GetString(), Score: VocabIndex.Score(VocabIndex.Normalize(key.Text), k.Name)))
                .Where(k => k.Score >= 0.85).OrderByDescending(k => k.Score).Select(k => k.Item1).FirstOrDefault();
            if (kind is null) continue;
            var cy = key.Box.Y + key.Box.Height / 2;
            var values = lines.Where(l => l.Box.X + l.Box.Width / 2 >= keyMaxX && Math.Abs(l.Box.Y + l.Box.Height / 2 - cy) <= tol).OrderBy(l => l.Box.X).ToArray();
            if (values.Length == 0) continue;
            var text = string.Join(' ', values.Select(v => v.Text.Trim()));
            var conf = values.Min(v => v.Confidence);
            var rowRect = new Rect(roi.X, cy - 18, roi.Width, 36);
            switch (kind)
            {
                case "record":
                {
                    var m = RacesWins().Match(text);
                    races = m.Success ? new Reading(int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture), text, conf, conf >= 0.5, [], rowRect) : Reading.Missing(rowRect, text);
                    wins = m.Success ? new Reading(int.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture), text, conf, conf >= 0.5, [], rowRect) : Reading.Missing(rowRect, text);
                    if (m.Success && (int)wins.Value! > (int)races.Value!) wins = wins with { Ok = false };
                    break;
                }
                case "fans":
                {
                    var v = Ocr.ParseInt(text.Replace(" ", ""));
                    fans = v is null ? Reading.Missing(rowRect, text) : new Reading(v, text, conf, conf >= 0.5, [], rowRect);
                    break;
                }
                case "scenario":
                {
                    var m = _vocab.Match(text, "scenario");
                    scenario = new Reading(m.Id ?? m.Best, text, m.Score, m.Accepted && conf >= 0.5, m.Candidates, rowRect);
                    break;
                }
                case "date":
                {
                    var ok = DateTime.TryParseExact(text.Replace(" ,", ","), ["MMM d, yyyy", "MMM dd, yyyy", "MMM d,yyyy"], CultureInfo.InvariantCulture, DateTimeStyles.None, out var d);
                    date = ok ? new Reading(d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), text, conf, conf >= 0.5, [], rowRect) : Reading.Missing(rowRect, text);
                    break;
                }
            }
        }
        return new CareerRows(races, wins, fans, scenario, date);
    }

    // ---------- support cards (primitives for T11) ----------
    public async Task<Reading> HeldAsync(Frame f)
    {
        var roi = _layout.Rect("cardsList", "heldRoi");
        var (text, conf) = await Ocr.TextAsync(_ocr, f, roi);
        var m = Held().Match(text);
        return m.Success ? new Reading(int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture), text, conf, conf >= 0.5, [], roi) : Reading.Missing(roi, text);
    }

    public async Task<IReadOnlyList<ListTile>> ListTilesAsync(Frame f)
    {
        var l = _layout.At("cardsList");
        int cols = l.GetProperty("columns").GetInt32(), tileX = l.GetProperty("tileX").GetInt32(), artOff = l.GetProperty("artOffsetY").GetInt32();
        int artW = l.GetProperty("artW").GetInt32(), artH = l.GetProperty("artH").GetInt32(), bottom = l.GetProperty("visibleBottom").GetInt32();
        double pitch = l.GetProperty("tilePitch").GetDouble(), lbPitch = l.GetProperty("lbPitch").GetDouble(), lbFirst = l.GetProperty("lbFirstX").GetDouble();
        var levelRoi = LayoutProfile.R(l.GetProperty("levelRoi"));
        var tiles = new List<ListTile>();
        var index = 0;
        foreach (var rowY in l.GetProperty("diamondRows").EnumerateArray().Select(e => e.GetInt32()))
        {
            if (rowY > bottom) break;
            for (var c = 0; c < cols; c++, index++)
            {
                var x = Round(tileX + c * pitch);
                var art = new Rect(x, rowY + artOff, artW, artH);
                var card = HashMatch(f, art, _master.CardArtHashes, _layout.CardArtCrop, 2, 10, 4);
                var lb = Lb(f, Round(lbFirst + c * pitch), lbPitch, rowY, art with { Height = artH + 20 });
                var roi = new Rect(x + levelRoi.X, rowY + levelRoi.Y, levelRoi.Width, levelRoi.Height);
                var (text, conf) = await Ocr.TextAsync(_ocr, f, roi);
                var lv = Ocr.ParseLevel(text);
                tiles.Add(new ListTile(index, card, lb, lv is null ? Reading.Missing(roi, text) : new Reading(lv, text, conf, conf >= 0.5 && lv is >= 1 and <= 50, [], roi)));
            }
        }
        return tiles;
    }

    public async Task<(Reading Card, Reading Level)> DetailAsync(Frame f)
    {
        var titleRoi = _layout.Rect("cardsDetail", "title"); var nameRoi = _layout.Rect("cardsDetail", "name"); var levelRoi = _layout.Rect("cardsDetail", "level");
        var (title, tConf) = await Ocr.TextAsync(_ocr, f, titleRoi);
        var (name, nConf) = await Ocr.TextAsync(_ocr, f, nameRoi);
        // Card titles repeat across characters, and names repeat across a character's cards: intersect both.
        var byName = _vocab.IdsAbove(name, "card", 0.85);
        var m = OutfitTitles(title).Select(t => _vocab.Match(t, "card", restrictTo: byName.Count > 0 ? byName : null)).OrderByDescending(x => x.Accepted).ThenByDescending(x => x.Score).First();
        var card = new Reading(m.Id ?? m.Best, title + " / " + name, m.Score, m.Accepted && Math.Min(tConf, nConf) >= 0.5 && byName.Count > 0, m.Candidates, new Rect(titleRoi.X, titleRoi.Y, titleRoi.Width, nameRoi.Y + nameRoi.Height - titleRoi.Y));
        var (lText, lConf) = await Ocr.TextAsync(_ocr, f, levelRoi);
        var lv = Ocr.ParseLevel(lText);
        return (card, lv is null ? Reading.Missing(levelRoi, lText) : new Reading(lv, lText, lConf, lConf >= 0.5, [], levelRoi));
    }

    // ---------- shared ----------
    /// <summary>dHash identity with a ±search px alignment search (Q-6 jitter). Accepted only with distance ≤ max and a
    /// best/runner-up margin ≥ minMargin; otherwise the best guess is kept as an uncertain candidate.</summary>
    public static Reading HashMatch(Frame f, Rect box, IReadOnlyDictionary<string, IReadOnlyList<string>> hashes, LayoutCrop crop, int search, int maxDistance, int minMargin)
    {
        var best = new Dictionary<string, int>(StringComparer.Ordinal);
        for (var dy = -search; dy <= search; dy++)
        for (var dx = -search; dx <= search; dx++)
        {
            var r = box with { X = box.X + dx, Y = box.Y + dy };
            if (r.X < 0 || r.Y < 0 || r.X + r.Width > f.Width || r.Y + r.Height > f.Height) continue;
            var h = f.DHash(r, crop);
            foreach (var (id, list) in hashes)
            {
                var d = list.Min(x => PixelAlgorithms.Hamming(h, x));
                if (!best.TryGetValue(id, out var old) || d < old) best[id] = d;
            }
        }
        var ranked = best.OrderBy(kv => kv.Value).ThenBy(kv => kv.Key, StringComparer.Ordinal).Take(3).ToArray();
        if (ranked.Length == 0) return Reading.Missing(box);
        var margin = ranked.Length > 1 ? ranked[1].Value - ranked[0].Value : 64;
        var accepted = ranked[0].Value <= maxDistance && margin >= minMargin;
        return new Reading(ranked[0].Key, $"dhash d={ranked[0].Value} margin={margin}", 1 - ranked[0].Value / 64.0, accepted,
            ranked.Select(kv => new Candidate(kv.Key, Math.Round(1 - kv.Value / 64.0, 4))).ToArray(), box);
    }

    private static Rect Pad(Rect r, int p) => new(r.X - p, r.Y - p, r.Width + 2 * p, r.Height + 2 * p);
    private static int Round(double v) => (int)Math.Round(v, MidpointRounding.AwayFromZero);

    [GeneratedRegex(@"^(?:L?v[l|I1]?|Lv[l|I1])\s*[|lI]?\s*\d{1,2}$")] private static partial Regex LevelOnly();
    [GeneratedRegex(@"\s+L?v[l|I1]\s*(\d{1,2})$")] private static partial Regex GluedLevel();
    [GeneratedRegex(@"\s[O0o®@©◯◎○]$")] private static partial Regex CircleTail();
    [GeneratedRegex(@"Races:?\s*(\d+)\s*Wins:?\s*(\d+)", RegexOptions.IgnoreCase)] private static partial Regex RacesWins();
    [GeneratedRegex(@"(\d{1,3})\s*/\s*(\d{3})")] private static partial Regex Held();
}
