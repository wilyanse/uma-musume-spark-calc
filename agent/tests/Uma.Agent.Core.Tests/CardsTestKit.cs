using Uma.Agent.Core.Cards;

namespace Uma.Agent.Core.Tests;

/// <summary>Helpers for the T11 card-sync tests.
/// <para>Two kinds of input are used and never mixed up:</para>
/// <list type="bullet">
/// <item>GROUNDED: the real screenshots 13/14 parsed by <see cref="FrameParser.ParseAsync"/> with the recorded OCR
/// (<see cref="FixtureEnv"/>). Where a test needs an ambiguous tile, it demotes one real reading (Ok=false, keeping the
/// parser's real candidates) and says so.</item>
/// <item>SYNTHETIC: <see cref="Synthetic"/> builds ParsedFrame sequences over a made-up inventory of real master card IDs.
/// They are not captures and are never compared against labels; they only drive the session's sequence logic
/// (scrolling, duplicates, conflicts, reset, cancel). Their frame bitmap is a blank 1920x1080 buffer.</item>
/// </list></summary>
internal static class CardsKit
{
    public static FixtureEnv Env => FixtureEnv.Instance;
    public const string List13 = "13-support-card-list", Detail14 = "14-support-card-detail";
    public const string Brightest = "card:the-brightest-star-in-japan-special-week";
    public static readonly int[] Lb13 = [2, 4, 4, 4, 4, 0, 0, 1, 0, 4, 0, 4, 0, 4, 4, 0, 0, 4, 4, 0];

    public static CardSyncSession NewSession(TestClock? clock = null) => new(Env.Master, Env.Layout, clock ?? new TestClock());

    /// <summary>The real parse of fixture 13 with tile `index` demoted to an ambiguous art reading (synthetic demotion of
    /// a real reading: value, raw text and candidates are exactly what the parser produced).</summary>
    public static ParsedFrame DemoteTile(ParsedFrame p, params int[] indices)
        => p with { ListTiles = p.ListTiles.Select(t => indices.Contains(t.Index) ? t with { Card = t.Card with { Ok = false } } : t).ToArray() };

    public static ParsedFrame ReplaceTile(ParsedFrame p, int index, Func<ListTile, ListTile> change)
        => p with { ListTiles = p.ListTiles.Select(t => t.Index == index ? change(t) : t).ToArray() };
}

/// <summary>SYNTHETIC sequences (see <see cref="CardsKit"/>): a made-up inventory over real master card IDs, shown
/// 4 rows x 5 columns per page like the cards.list grid. Nothing here is a capture.</summary>
internal sealed class Synthetic
{
    public static readonly Frame Blank = new(new byte[1920 * 1080 * 4], 1920, 1080);
    private static readonly ScreenClassification ListScreen = new(ScreenId.CardsList, "cards.list", 0, 1, "SYNTHETIC");
    private static readonly ScreenClassification DetailScreen = new(ScreenId.CardsDetail, "cards.detail", 0, 1, "SYNTHETIC");
    public const int Columns = 5, PageTiles = 20;

    public sealed record Card(string Id, int Lb, int Level);
    public IReadOnlyList<Card> Inventory { get; }
    public int Held { get; }

    public Synthetic(int count, int? held = null, int skip = 0)
    {
        var ids = CardsKit.Env.Master.Ids["cards"].Order(StringComparer.Ordinal).Skip(skip).Take(count).ToArray();
        if (ids.Length != count) throw new InvalidOperationException("not enough master cards");
        Inventory = ids.Select((id, i) => new Card(id, i % 5, 20 + i % 31)).ToArray();
        Held = held ?? count;
    }

    public static ListTile Tile(int index, Card c, double conf = 0.95)
        => new(index, new Reading(c.Id, "SYNTHETIC dhash", conf, true, [new Candidate(c.Id, conf), new Candidate("card:synthetic-runner-up", 0.7)], null),
            new Reading(c.Lb, null, 1, true, [], null), new Reading(c.Level, "Lvl " + c.Level, 0.9, true, [], null));

    /// <summary>An unresolved tile: art not accepted (candidates given), level read or not.</summary>
    public static ListTile Ambiguous(int index, Card c, IReadOnlyList<string> candidates, bool levelRead = true)
        => new(index, new Reading(candidates.FirstOrDefault(), "SYNTHETIC dhash ambiguous", 0.8, false, candidates.Select((x, i) => new Candidate(x, 0.8 - i * 0.01)).ToArray(), null),
            new Reading(c.Lb, null, 1, true, [], null), levelRead ? new Reading(c.Level, "Lvl " + c.Level, 0.9, true, [], null) : Reading.Missing(null, ""));

    /// <summary>A grid cell past the end of the list: no accepted art and no level text.</summary>
    public static ListTile Empty(int index)
        => new(index, new Reading("card:synthetic-nearest", "SYNTHETIC dhash d=30 margin=0", 0.53, false, [new Candidate("card:synthetic-nearest", 0.53)], null),
            new Reading(0, null, 1, true, [], null), Reading.Missing(null, ""));

    public static ParsedFrame List(IEnumerable<ListTile> tiles, int? held, bool heldOk = true)
        => new(ListScreen, Blank, null)
        {
            HeldCount = held is null ? Reading.Missing(null, "") : new Reading(held.Value, $"{held}/255", 0.9, heldOk, [], null),
            ListTiles = tiles.ToArray(),
        };

    /// <summary>The page whose first visible tile is inventory index `start` (start must be row-aligned).</summary>
    public ParsedFrame Page(int start, int? held = -1)
    {
        if (start % Columns != 0) throw new ArgumentException("row-aligned start only");
        var tiles = Enumerable.Range(0, PageTiles).Select(i => start + i < Inventory.Count ? Tile(i, Inventory[start + i]) : Empty(i));
        return List(tiles, held == -1 ? Held : held);
    }

    public ParsedFrame PageWith(int start, Func<int, ListTile, ListTile> change)
    {
        var p = Page(start);
        return p with { ListTiles = p.ListTiles.Select(t => change(start + t.Index, t)).ToArray() };
    }

    public static ParsedFrame Detail(string? cardId, int? level, bool cardOk = true, bool levelOk = true)
        => new(DetailScreen, Blank, null)
        {
            DetailCard = new Reading(cardId, "SYNTHETIC [title] / name", 1, cardOk, cardId is null ? [] : [new Candidate(cardId, 1)], null),
            DetailLevel = level is null ? Reading.Missing(null, "") : new Reading(level.Value, $"Lvl {level}", 0.9, levelOk, [], null),
        };

    public static ParsedFrame Other(ScreenId id) => new(new ScreenClassification(id, null, 0, 1, "SYNTHETIC"), Blank, null);
}
