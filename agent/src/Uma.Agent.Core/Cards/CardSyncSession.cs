namespace Uma.Agent.Core.Cards;

public enum CardSyncStatus { Idle, Collecting, Complete, HeldChanged, Cancelled }
public enum CardFeedOutcome { Ignored, Collected, Rejected, HeldChanged, Cancelled, DetailBound, DetailIgnored }

public sealed record CardFeedResult(CardFeedOutcome Outcome, string Reason);

/// <summary>A card the session is sure of. `Segment`/`Position` locate it in the list as seen so far: a segment is a
/// run of tiles linked by overlapping frames, and positions are row-major indices within it (0 = the
/// topmost observed row's grid origin, including unread occupied cells). `Source` is `art` (accepted art match + read level) or `detail` (resolved on the cards.detail screen).</summary>
public sealed record CollectedCard(int Segment, int Position, string CardId, int Lb, int Level, double Confidence, string Source);

/// <summary>A tile that is not sure yet: art not accepted (`CardId` null, `Candidates` = the parser's top 3) and/or level
/// unread. It is never sent. Open the card (cards.detail) to resolve it; <see cref="CardSyncSession.RequestDetail"/>
/// binds the next detail screen to this tile when more than one could match.</summary>
public sealed record PendingTile(string Id, int Segment, int Position, string? CardId, int Lb, int? Level, IReadOnlyList<Candidate> Candidates, string? Raw);

public sealed record CardObservation(string? CardId, int Lb, int? Level);

/// <summary>Frames disagreed about one position (e.g. LB or level changed while scanning). Never sent; blocks a full sync.
/// Reset and scan again.</summary>
public sealed record CardConflict(int Segment, int Position, IReadOnlyList<CardObservation> Observations);

/// <summary>What the user saw when they chose "Send partial". <see cref="CardSyncSession.BuildPartial"/> refuses a
/// confirmation that no longer matches the current state. The API replaces the whole owned-card table even with
/// `?partial=1` (apps/api/src/routes/owned-cards.ts: DELETE then INSERT), so the shell must show <see cref="Message"/>.</summary>
public sealed record PartialSyncConfirmation
{
    public long Revision { get; }
    public int Cards { get; }
    public int HeldCount { get; }
    public Guid SessionId { get; }
    public long Generation { get; }
    public long SessionInstance { get; }
    // A manually constructed confirmation has no session authority.
    public PartialSyncConfirmation(long Revision, int Cards, int HeldCount)
        : this(Revision, Cards, HeldCount, Guid.Empty, -1, -1) { }
    internal PartialSyncConfirmation(long revision, int cards, int heldCount, Guid sessionId, long generation, long sessionInstance)
    { Revision = revision; Cards = cards; HeldCount = heldCount; SessionId = sessionId; Generation = generation; SessionInstance = sessionInstance; }
    public string Message => $"Send {Cards} of {HeldCount} cards as a partial sync? The web app's owned-card list will be replaced by these {Cards} cards; cards not collected in this scan will no longer be listed.";
}

/// <summary>Immutable snapshot for the UI (T10 tray / card-sync window).</summary>
public sealed record CardSyncState(
    CardSyncStatus Status, long Revision, int? HeldCount, string MasterVersion, DateTimeOffset? CapturedAt,
    IReadOnlyList<CollectedCard> Cards, IReadOnlyList<PendingTile> Pending, IReadOnlyList<CardConflict> Conflicts,
    int Segments, string? AwaitingDetailFor, bool CanSendFull, IReadOnlyList<string> Blockers, PartialSyncConfirmation? PartialConfirmation);

/// <summary>Support card sync (30 §8, F03), UI-neutral. Feed it every frame the shell parsed (or raw frames through
/// <see cref="FeedAsync"/>, which runs <see cref="FrameParser.ParseAsync"/> and so accepts any supported client size);
/// only `cards.list` and `cards.detail` frames are used.
/// <list type="bullet">
/// <item>`Held N/255` is taken from the first confident read. A different confident value stops the session
/// (<see cref="CardSyncStatus.HeldChanged"/>) until <see cref="Reset"/>.</item>
/// <item>Assisted scrolling: a list frame is placed by its confidently matched tiles (accepted art) against the cards
/// already collected, i.e. de-duplicated by (cardId, lb, level, grid position relative to the earlier frames). The
/// offset must be a whole number of rows. A frame whose matched tiles disagree on the offset, repeat a card, or put a
/// different card on a known position is rejected whole. A frame with no matched tile is ignored (it can't be placed).
/// Frames that don't overlap anything open a new segment; a later frame overlapping both joins them.</item>
/// <item>Tiles without an accepted art match or level read become <see cref="PendingTile"/>s with the parser's
/// candidates, never a guessed ID. A cards.detail frame (title + name OCR, exact) resolves the one pending tile it fits
/// (candidate/ID and level agree); when several fit, the user picks the tile with <see cref="RequestDetail"/>.</item>
/// <item>A full sync (<see cref="BuildFull"/>) needs: Held read, one gap-free segment, no pending tile, no conflict and
/// unique card count == Held. Otherwise the user may explicitly send the collected cards as partial
/// (<see cref="BuildPartial"/>, `?partial=1`), which the API stores as given.</item>
/// </list>
/// Thread-safe; every outcome is deterministic for a given frame sequence. Time comes from the injected clock.</summary>
public sealed class CardSyncSession
{
    private abstract record Slot;
    private sealed record CardSlot(string CardId, int Lb, int Level, double Confidence, string Source) : Slot;
    private sealed record PendingSlot(string Id, string? CardId, int Lb, int? Level, IReadOnlyList<Candidate> Candidates, string? Raw) : Slot;
    private sealed record ConflictSlot(IReadOnlyList<CardObservation> Observations) : Slot;
    // Occupancy was observed, but LB could not be read. Keep the position (including boundaries); never guess LB.
    private sealed record UnreadSlot(string? CardId) : Slot;
    private sealed class RejectFrame(string reason) : Exception(reason);

    private readonly object _gate = new();
    private readonly string _masterVersion;
    private readonly IReadOnlySet<string> _knownCards;
    private readonly Guid _sessionId;
    // A faulty/reused injected GUID must not alias another live session. No static session registry is retained.
    private static long _nextInstance;
    private readonly long _sessionInstance = Interlocked.Increment(ref _nextInstance);
    private long _generation;
    private readonly IClock _clock;
    private readonly int _columns;

    private SortedDictionary<int, SortedDictionary<int, Slot>> _segments = new();
    private int _nextSegment, _nextPending;
    private int? _held;
    private bool _heldChanged, _cancelled;
    private string? _awaiting;
    private long _revision;
    private DateTimeOffset? _capturedAt;

    public CardSyncSession(MasterData master, LayoutProfile layout, IClock clock, Func<Guid>? sessionIdentity = null)
    {
        _masterVersion = master.Version; _knownCards = new HashSet<string>(master.Ids["cards"], StringComparer.Ordinal); _clock = clock;
        _sessionId = (sessionIdentity ?? Guid.NewGuid)();
        if (_sessionId == Guid.Empty) throw new ArgumentException("session identity must not be empty", nameof(sessionIdentity));
        _columns = layout.Int("cardsList", "columns");
        if (_columns <= 0) throw new ArgumentException("layout cardsList.columns must be positive", nameof(layout));
    }

    public string MasterVersion => _masterVersion;

    /// <summary>Parses a raw client frame (normalized to 1920x1080 by ParseAsync; unsupported sizes throw its typed
    /// <see cref="UnsupportedFrameException"/>s before anything is read) and feeds it.</summary>
    public async Task<CardFeedResult> FeedAsync(FrameParser parser, Frame raw, CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        var parsed = await parser.ParseAsync(raw);
        ct.ThrowIfCancellationRequested();
        return Feed(parsed);
    }

    /// <summary>Feeds a frame parsed by <see cref="FrameParser.ParseAsync"/>. Its frame must be in the 1920x1080
    /// reference space (<see cref="NonReferenceFrameException"/> otherwise).</summary>
    /// <param name="confirmedEmptyCells">Explicit caller-verified empty grid cells; absence of OCR/art
    /// is not evidence of emptiness. The parser does not currently provide an occupancy classifier.
    /// Never infer this set from missing readings. Cells with accepted identity or level cannot be declared empty.</param>
    public CardFeedResult Feed(ParsedFrame parsed, IReadOnlySet<int>? confirmedEmptyCells = null)
    {
        ArgumentNullException.ThrowIfNull(parsed);
        Frames.RequireReference(parsed.Frame);
        lock (_gate)
        {
            if (parsed.Screen.Id is not (ScreenId.CardsList or ScreenId.CardsDetail)) return new(CardFeedOutcome.Ignored, "not a support card screen");
            if (_cancelled) return new(CardFeedOutcome.Cancelled, "the card sync was cancelled; reset to start again");
            if (_heldChanged) return new(CardFeedOutcome.Ignored, "Held changed during the scan; reset to start again");
            var before = Signature();
            var result = parsed.Screen.Id == ScreenId.CardsList ? FeedList(parsed, confirmedEmptyCells) : FeedDetail(parsed);
            if (Signature() != before) { _revision++; _capturedAt = _clock.UtcNow; }
            return result;
        }
    }

    /// <summary>Binds the next matching cards.detail frame to this pending tile (the user clicked it). False when the
    /// tile is unknown or already resolved.</summary>
    public bool RequestDetail(string pendingId)
    {
        lock (_gate)
        {
            if (_cancelled || _heldChanged || Find(pendingId) is null) return false;
            if (_awaiting != pendingId) { _awaiting = pendingId; _revision++; }
            return true;
        }
    }

    public void ClearDetailRequest() { lock (_gate) { if (_awaiting is not null) { _awaiting = null; _revision++; } } }

    /// <summary>Stops collecting. Nothing can be built until <see cref="Reset"/>.</summary>
    public void Cancel() { lock (_gate) { _cancelled = true; _awaiting = null; _generation++; _revision++; } }

    /// <summary>Forgets everything (Held, cards, pending tiles, conflicts) and starts over.</summary>
    public void Reset()
    {
        lock (_gate)
        {
            _segments = new(); _nextSegment = 0; _nextPending = 0; _held = null; _generation++;
            _heldChanged = false; _cancelled = false; _awaiting = null; _capturedAt = null; _revision++;
        }
    }

    public CardSyncState State { get { lock (_gate) return Snapshot(); } }

    /// <summary>The full sync (no `?partial=1`). Throws <see cref="InvalidOperationException"/> unless
    /// <see cref="CardSyncState.CanSendFull"/>.</summary>
    public OwnedCardsSyncPayload BuildFull()
    {
        lock (_gate)
        {
            var s = Snapshot();
            if (!s.CanSendFull) throw new InvalidOperationException("full sync not possible: " + string.Join("; ", s.Blockers));
            return Payload(s, partial: false);
        }
    }

    /// <summary>The explicit "Send partial" (`?partial=1`): only the collected cards, never pending or conflicting tiles.
    /// `confirmation` must equal the current <see cref="CardSyncState.PartialConfirmation"/>, so a partial is always the
    /// collection the user saw and agreed to send.</summary>
    public OwnedCardsSyncPayload BuildPartial(PartialSyncConfirmation confirmation)
    {
        lock (_gate)
        {
            var s = Snapshot();
            if (s.PartialConfirmation is null) throw new InvalidOperationException("nothing can be sent: " + string.Join("; ", s.Blockers));
            if (confirmation != s.PartialConfirmation) throw new InvalidOperationException("the collection changed since the user confirmed the partial sync; confirm again");
            return Payload(s, partial: true);
        }
    }

    private OwnedCardsSyncPayload Payload(CardSyncState s, bool partial)
    {
        var body = new OwnedCardsSync(1, (s.CapturedAt ?? _clock.UtcNow).ToUniversalTime(), _masterVersion, s.HeldCount!.Value,
            Freeze(s.Cards.Select(c => new OwnedCard(c.CardId, c.Lb, c.Level, c.Confidence))));
        var errors = OwnedCardsSyncValidator.Validate(body, partial, _knownCards);
        if (errors.Count > 0) throw new InvalidOperationException("invalid owned-cards payload: " + string.Join("; ", errors));
        return new OwnedCardsSyncPayload(body, partial);
    }

    // ---------------- list frames ----------------
    private CardFeedResult FeedList(ParsedFrame p, IReadOnlySet<int>? confirmedEmptyCells)
    {
        int? held = p.HeldCount is { Ok: true, Value: int h } ? h : null;
        if (held is not null && _held is not null && held != _held)
        {
            _heldChanged = true; _awaiting = null;
            return new(CardFeedOutcome.HeldChanged, $"Held changed from {_held} to {held} during the scan; reset and scan again");
        }

        var observations = new List<(int Index, Slot Slot)>();
        var anchors = new List<(int Index, string CardId)>();
        foreach (var t in p.ListTiles.OrderBy(t => t.Index))
        {
            int? level = t.Level is { Ok: true, Value: int lv } && lv >= OwnedCardsSyncValidator.MinLevel ? lv : null;
            var cardOk = t.Card is { Ok: true, Value: string id } && _knownCards.Contains(id);
            var cardId = cardOk ? (string)t.Card.Value! : null;
            if (confirmedEmptyCells?.Contains(t.Index) == true)
            {
                if (cardId is not null || level is not null)
                    return new(CardFeedOutcome.Rejected, "an explicitly empty cell has an occupied reading; frame not used");
                continue;
            }
            if (cardId is null && level is null)
            { observations.Add((t.Index, new UnreadSlot(null))); continue; } // Unknown occupancy, never assumed empty.
            if (cardId is not null) anchors.Add((t.Index, cardId));
            if (t.Lb is not { Ok: true, Value: int lb } || lb is < 0 or > 4)
            { observations.Add((t.Index, new UnreadSlot(cardId))); continue; }
            Slot slot = cardId is not null && level is not null
                ? new CardSlot(cardId, lb, level.Value, Math.Round(Math.Min(t.Card.Confidence, t.Level.Confidence), 4), "art")
                : new PendingSlot("", cardId, lb, level, Freeze(t.Card.Candidates.Where(c => c.Value is string).Select(c => new Candidate((string)c.Value!, c.Score))), t.Card.Raw);
            observations.Add((t.Index, slot));
        }
        if (anchors.Count == 0) return new(CardFeedOutcome.Ignored, "no tile was matched confidently, so the frame can't be placed; scroll slowly or open a card");
        var dup = anchors.GroupBy(a => a.CardId).FirstOrDefault(g => g.Count() > 1);
        if (dup is not null) return new(CardFeedOutcome.Rejected, $"{dup.Key} appears twice in one frame");

        var work = Clone(_segments);
        var nextPending = _nextPending;
        try
        {
            var offsets = new SortedDictionary<int, int>();
            foreach (var (index, id) in anchors)
            {
                if (Locate(work, id) is not { } at) continue;
                var off = at.Position - index;
                if (off % _columns != 0) throw new RejectFrame($"{id} moved by a fraction of a row");
                if (offsets.TryGetValue(at.Segment, out var known) && known != off) throw new RejectFrame("the matched tiles disagree on how far the list scrolled");
                offsets[at.Segment] = off;
            }
            int segment, offset;
            if (offsets.Count == 0) { segment = _nextSegment; offset = 0; work[segment] = new(); }
            else
            {
                (segment, offset) = offsets.First();
                foreach (var (other, otherOff) in offsets.Skip(1))
                {
                    foreach (var (pos, s) in work[other]) Put(work[segment], pos - otherOff + offset, s);
                    work.Remove(other);
                }
            }
            foreach (var (index, slot) in observations)
            {
                var s = slot is PendingSlot ps ? ps with { Id = $"tile-{_sessionId:N}-{_sessionInstance}-{_generation}-{++nextPending}" } : slot;
                Put(work[segment], index + offset, s);
            }
            // Uniqueness across the whole collection (01 §4 cardId is the primary key).
            var ids = work.Values.SelectMany(seg => seg.Values).SelectMany(SlotIds).ToArray();
            var again = ids.GroupBy(x => x).FirstOrDefault(g => g.Count() > 1);
            if (again is not null) throw new RejectFrame($"{again.Key} would be at two positions");
            if (offsets.Count == 0) _nextSegment++;
        }
        catch (RejectFrame e) { return new(CardFeedOutcome.Rejected, e.Message + "; frame not used"); }

        _segments = Normalize(work);
        _nextPending = nextPending;
        if (held is not null) _held = held;
        if (_awaiting is not null && Find(_awaiting) is null) _awaiting = null;
        return new(CardFeedOutcome.Collected, $"{anchors.Count} matched tiles placed");
    }

    private static IEnumerable<string> SlotIds(Slot s) => s switch
    {
        CardSlot c => [c.CardId],
        UnreadSlot { CardId: { } id } => [id],
        PendingSlot { CardId: { } id } => [id],
        ConflictSlot c => c.Observations.Select(o => o.CardId).OfType<string>().Distinct(),
        _ => [],
    };

    /// <summary>Merges an observation into a position. Same card again = no change (confidence max); a confident read
    /// resolves a pending tile; LB/level disagreement = conflict; a different accepted card = frame rejected.</summary>
    private static void Put(SortedDictionary<int, Slot> seg, int pos, Slot incoming)
    {
        if (!seg.TryGetValue(pos, out var old)) { seg[pos] = incoming; return; }
        seg[pos] = Merge(old, incoming);
    }

    private static Slot Merge(Slot a, Slot b)
    {
        string? IdOf(Slot s) => s switch { CardSlot c => c.CardId, PendingSlot p => p.CardId, UnreadSlot u => u.CardId, ConflictSlot c => c.Observations.Select(o => o.CardId).OfType<string>().FirstOrDefault(), _ => null };
        var ia = IdOf(a); var ib = IdOf(b);
        if (ia is not null && ib is not null && ia != ib) throw new RejectFrame($"{ib} read where {ia} was seen");
        // A subsequent readable observation resolves unknown LB. An unread repeat cannot erase a read.
        if (a is UnreadSlot u) return b is UnreadSlot v ? u with { CardId = u.CardId ?? v.CardId }
            : b is PendingSlot p ? p with { CardId = p.CardId ?? u.CardId } : b;
        if (b is UnreadSlot) return a;
        switch (a, b)
        {
            case (CardSlot x, CardSlot y):
                return x.Lb == y.Lb && x.Level == y.Level ? (y.Confidence > x.Confidence && x.Source == y.Source ? y : x) : Conflict(x, y);
            case (CardSlot x, PendingSlot y):
                return Compatible(x, y) ? x : Conflict(x, y);
            case (PendingSlot x, CardSlot y):
                return Compatible(y, x) ? y : Conflict(x, y);
            case (PendingSlot x, PendingSlot y):
                if (x.Lb != y.Lb || (x.Level is not null && y.Level is not null && x.Level != y.Level)) return Conflict(x, y);
                return x with { CardId = x.CardId ?? y.CardId, Level = x.Level ?? y.Level, Candidates = x.Candidates.Count > 0 ? x.Candidates : y.Candidates, Raw = x.Raw ?? y.Raw };
            default:
                return Conflict(a, b);
        }
    }

    private static bool Compatible(CardSlot c, PendingSlot p) => c.Lb == p.Lb && (p.Level is null || p.Level == c.Level);

    private static ConflictSlot Conflict(Slot a, Slot b)
    {
        IEnumerable<CardObservation> Obs(Slot s) => s switch
        {
            CardSlot c => [new(c.CardId, c.Lb, c.Level)],
            PendingSlot p => [new(p.CardId, p.Lb, p.Level)],
            ConflictSlot c => c.Observations,
            _ => [],
        };
        return new ConflictSlot(Freeze(Obs(a).Concat(Obs(b)).Distinct()));
    }

    // ---------------- detail frames ----------------
    private CardFeedResult FeedDetail(ParsedFrame p)
    {
        if (p.DetailCard is not { Ok: true, Value: string id } || !_knownCards.Contains(id))
            return new(CardFeedOutcome.DetailIgnored, "the card title and name were not read exactly");
        if (p.DetailLevel is not { Ok: true, Value: int level } || level < OwnedCardsSyncValidator.MinLevel)
            return new(CardFeedOutcome.DetailIgnored, "the card level was not read");
        if (_segments.Values.SelectMany(s => s.Values).OfType<CardSlot>().Any(c => c.CardId == id))
            return new(CardFeedOutcome.DetailIgnored, $"{id} is already collected");
        if (_segments.Values.SelectMany(s => s.Values).OfType<ConflictSlot>().Any(c => c.Observations.Any(o => o.CardId == id)))
            return new(CardFeedOutcome.DetailIgnored, $"{id} has conflicting reads; reset and scan again");

        var pendings = _segments.SelectMany(s => s.Value.Where(kv => kv.Value is PendingSlot).Select(kv => (Segment: s.Key, Position: kv.Key, Tile: (PendingSlot)kv.Value))).ToArray();
        (int Segment, int Position, PendingSlot Tile) target;
        if (_awaiting is not null)
        {
            var requested = pendings.Where(x => x.Tile.Id == _awaiting).ToArray();
            if (requested.Length == 0) { _awaiting = null; return new(CardFeedOutcome.DetailIgnored, "the selected tile is no longer pending"); }
            target = requested[0];
            if (target.Tile.Level is not null && target.Tile.Level != level) return new(CardFeedOutcome.DetailIgnored, $"the selected tile shows Lvl {target.Tile.Level}, this card is Lvl {level}");
            if (!FitsIdentity(target.Tile, id)) return new(CardFeedOutcome.DetailIgnored, $"the selected tile candidates do not match {id}");
            if (pendings.Any(x => x.Tile.Id != _awaiting && x.Tile.CardId == id)) return new(CardFeedOutcome.DetailIgnored, $"{id} was matched to another tile");
        }
        else
        {
            var fits = pendings.Where(x => FitsIdentity(x.Tile, id)
                                           && (x.Tile.Level is null || x.Tile.Level == level)).ToArray();
            if (fits.Length == 0) return new(CardFeedOutcome.DetailIgnored, $"no pending tile fits {id} Lvl {level}");
            if (fits.Length > 1) return new(CardFeedOutcome.DetailIgnored, $"{fits.Length} pending tiles could be {id}; select the tile first");
            target = fits[0];
        }
        var conf = Math.Round(Math.Min(p.DetailCard.Confidence, p.DetailLevel.Confidence), 4);
        _segments[target.Segment][target.Position] = new CardSlot(id, target.Tile.Lb, level, Math.Clamp(conf, 0, 1), "detail");
        if (_awaiting == target.Tile.Id) _awaiting = null;
        return new(CardFeedOutcome.DetailBound, $"{id} resolved tile {target.Tile.Id}");
    }

    // ---------------- helpers ----------------
    private static SortedDictionary<int, SortedDictionary<int, Slot>> Clone(SortedDictionary<int, SortedDictionary<int, Slot>> s)
        => new(s.ToDictionary(kv => kv.Key, kv => new SortedDictionary<int, Slot>(kv.Value)));

    private static bool FitsIdentity(PendingSlot tile, string id)
        => tile.CardId == id || (tile.CardId is null && tile.Candidates.Any(c => c.Value as string == id));

    private static IReadOnlyList<T> Freeze<T>(IEnumerable<T> items) => Array.AsReadOnly(items.ToArray());

    /// <summary>Shift by whole rows only, keeping the grid origin and unread occupied boundary slots.</summary>
    private SortedDictionary<int, SortedDictionary<int, Slot>> Normalize(SortedDictionary<int, SortedDictionary<int, Slot>> s)
        => new(s.Where(kv => kv.Value.Count > 0).ToDictionary(kv => kv.Key, kv => { var min = (int)Math.Floor((double)kv.Value.Keys.First() / _columns) * _columns; return new SortedDictionary<int, Slot>(kv.Value.ToDictionary(x => x.Key - min, x => x.Value)); }));

    private static (int Segment, int Position)? Locate(SortedDictionary<int, SortedDictionary<int, Slot>> s, string cardId)
    {
        foreach (var (segment, seg) in s)
            foreach (var (pos, slot) in seg)
                if (SlotIds(slot).Contains(cardId)) return (segment, pos);
        return null;
    }

    private PendingSlot? Find(string pendingId) => _segments.Values.SelectMany(s => s.Values).OfType<PendingSlot>().FirstOrDefault(p => p.Id == pendingId);

    /// <summary>Content of the collection, for change detection (revision / capture time). Lists are spelled out.</summary>
    private string Signature() => string.Join("\n", _segments.Select(s => s.Key + ":" + string.Join(",", s.Value.Select(kv => kv.Key + "=" + Describe(kv.Value)))))
        + "|" + _held + "|" + _heldChanged + "|" + _awaiting;

    private static string Describe(Slot s) => s switch
    {
        CardSlot c => $"C({c.CardId},{c.Lb},{c.Level},{c.Confidence.ToString("R", System.Globalization.CultureInfo.InvariantCulture)},{c.Source})",
        PendingSlot p => $"P({p.Id},{p.CardId},{p.Lb},{p.Level},[{string.Join(";", p.Candidates.Select(c => c.Value + "@" + c.Score.ToString("R", System.Globalization.CultureInfo.InvariantCulture)))}])",
        ConflictSlot k => $"X([{string.Join(";", k.Observations.Select(o => $"{o.CardId}/{o.Lb}/{o.Level}"))}])",
        UnreadSlot u => $"U({u.CardId})",
        _ => "?",
    };

    private CardSyncState Snapshot()
    {
        var cards = new List<CollectedCard>(); var pending = new List<PendingTile>(); var conflicts = new List<CardConflict>();
        foreach (var (segment, seg) in _segments)
            foreach (var (pos, slot) in seg)
                switch (slot)
                {
                    case CardSlot c: cards.Add(new(segment, pos, c.CardId, c.Lb, c.Level, c.Confidence, c.Source)); break;
                    case PendingSlot p: pending.Add(new(p.Id, segment, pos, p.CardId, p.Lb, p.Level, Freeze(p.Candidates), p.Raw)); break;
                    case ConflictSlot k: conflicts.Add(new(segment, pos, Freeze(k.Observations))); break;
                }
        var holes = _segments.Values.Sum(seg => seg.Count == 0 ? 0 : seg.Keys.Last() - seg.Keys.First() + 1 - seg.Count + seg.Values.OfType<UnreadSlot>().Count());

        var blockers = new List<string>();
        if (_cancelled) blockers.Add("cancelled");
        if (_heldChanged) blockers.Add("Held changed during the scan; reset and scan again");
        if (_held is null) blockers.Add("Held N/255 has not been read yet");
        else if (cards.Count < _held) blockers.Add($"{cards.Count} of {_held} cards collected");
        else if (cards.Count > _held) blockers.Add($"{cards.Count} cards collected, more than Held {_held}; reset and scan again");
        if (pending.Count > 0) blockers.Add($"{pending.Count} tiles need the card detail screen");
        if (conflicts.Count > 0) blockers.Add($"{conflicts.Count} positions read differently in different frames");
        if (_segments.Count > 1) blockers.Add($"the list was seen in {_segments.Count} separate parts; scroll back over the gap");
        if (holes > 0) blockers.Add($"{holes} tiles inside the scanned range were not read");

        var canFull = blockers.Count == 0 && _held is not null && cards.Count == _held;
        var status = _cancelled ? CardSyncStatus.Cancelled : _heldChanged ? CardSyncStatus.HeldChanged
            : canFull ? CardSyncStatus.Complete : _revision == 0 || (_segments.Count == 0 && _held is null) ? CardSyncStatus.Idle : CardSyncStatus.Collecting;
        PartialSyncConfirmation? confirm = !_cancelled && !_heldChanged && _held is not null && cards.Count > 0 && cards.Count <= _held
            ? new(_revision, cards.Count, _held.Value, _sessionId, _generation, _sessionInstance) : null;
        return new CardSyncState(status, _revision, _held, _masterVersion, _capturedAt, Freeze(cards), Freeze(pending), Freeze(conflicts), _segments.Count, _awaiting, canFull, Freeze(blockers), confirm);
    }
}
