using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Uma.Agent.Core;

namespace Uma.Agent.Windows.Shell;

public interface IShellLog { void Info(string message); void Warn(string message); void Error(string message); }
public interface ISupportCardsIntegration { bool Available { get; } string Message { get; } }
public sealed class SupportCardsUnavailable : ISupportCardsIntegration
{
    public bool Available => false;
    public string Message => "Support card capture is unavailable until T11 is merged and integrated. Nothing is synced or uploaded.";
}
public enum PipelineEventKind { Progress, NotUploadable, Ignored, CardScreen, Unsupported, Skipped, Queued, AlreadyQueued, Failed, Limit }
public sealed record PipelineEvent(PipelineEventKind Kind, string Message, string? CaptureId = null);
/// <summary>What the pipeline keeps alive: unqueued veteran sessions, the parsed frames fed into them (Core keeps one
/// full 1920x1080 BGRA reference frame, about 8.3 MB, per fed frame) and sealed results awaiting an enqueue retry
/// (capture JSON and review-crop PNGs only, no frames).</summary>
public sealed record RetainedEvidence(int Sessions, int Frames, int SealedPending);
public sealed record SessionProgress(string IdentityKey, int TabsComplete, IReadOnlyList<SectionStatus> Checklist);

/// <summary>Single-owner pipeline. The host serializes processing/flush. Never edits parser evidence or checklist
/// coverage. Sessions finalize on identity change or explicit Stop/Exit, allowing parent popups before enqueue.
/// <para>Memory bound (T10 review B1). Core's <see cref="CaptureSession"/> keeps every frame fed to it, and Core's
/// coordinator keeps every session. The shell therefore gives each veteran its own <see cref="CaptureCoordinator"/>
/// and routes frames between them with the same rules as <see cref="CaptureCoordinator.Feed"/> (confident outfit,
/// character, rating and stats; continuity after a frame of the current veteran, popups included; ambiguity is refused;
/// a new veteran needs confident outfit, character and rating), counting already queued veterans as candidates exactly
/// as Core did. Then:</para>
/// <list type="bullet">
/// <item>A sealed (Uploadable) veteran is dropped with its frames as soon as it is assembled; only the sealed result
/// is kept until <see cref="UploadOutbox.EnqueueCapture"/> succeeds, so a failed enqueue retries the exact capture.
/// Its confident identity is remembered, so returning to it reports <see cref="PipelineEventKind.AlreadyQueued"/> and
/// stores nothing.</item>
/// <item>A parsed frame whose evidence fingerprint equals one already fed to the same veteran is not fed again
/// (moving clocks/animations re-parse to the same evidence).</item>
/// <item>At most <see cref="MaxLiveSessions"/> unqueued veterans and <see cref="MaxFramesPerSession"/> fed frames
/// per veteran are kept; reaching either limit is reported, never silently uploaded.</item>
/// </list></summary>
public sealed class CapturePipeline
{
    /// <summary>Unqueued veterans kept at once: the current one plus one incomplete veteran the user may come back to.</summary>
    public const int MaxLiveSessions = 2;
    /// <summary>Distinct-evidence frames per veteran (about 330 MB of reference frames). The fixture veteran needs 9.</summary>
    public const int MaxFramesPerSession = 40;
    private static readonly string[] Required = ["outfit", "character", "rating"];

    private sealed class Live(CaptureCoordinator coordinator, string id, DateTimeOffset at)
    {
        public CaptureCoordinator Coordinator { get; } = coordinator;
        public CaptureSession? Session { get; set; }
        public Dictionary<string, string> Identity { get; } = new(StringComparer.Ordinal);
        public HashSet<string> Fingerprints { get; } = new(StringComparer.Ordinal);
        public int Frames { get; set; }
        public string Id { get; } = id;
        public DateTimeOffset At { get; } = at;
    }
    private sealed record Sealed(CaptureResult Result, string Id);

    private readonly AgentData _data;
    private readonly FrameParser _parser;
    private readonly UploadOutbox _outbox;
    private readonly IClock _clock;
    private readonly UlidGenerator _ids;
    private readonly string _version;
    private readonly FrameGate _gate;
    private readonly IShellLog _log;
    private readonly List<Live> _live = [];
    private readonly List<Dictionary<string, string>> _sealedIdentities = [];
    private readonly List<Sealed> _pending = [];
    private Live? _current;                              // Core's Current: popups route here
    private Dictionary<string, string>? _currentSealed;  // Current is a veteran that was already queued
    private bool _continuing;                            // Core's continuity flag
    private Live? _active;                               // the veteran the user is on; finalized when another one appears
    public SessionProgress? Progress { get; private set; }
    public RetainedEvidence Retained => new(_live.Count, _live.Sum(l => l.Frames), _pending.Count);

    public CapturePipeline(AgentData data, IOcrEngine ocr, UploadOutbox outbox, IClock clock, UlidGenerator ids, string version, FrameGate gate, IShellLog log)
    {
        _data = data; _parser = new(data.Layout, data.Master, data.Templates, ocr);
        _outbox = outbox; _clock = clock; _ids = ids; _version = version; _gate = gate; _log = log;
    }
    public async Task<PipelineEvent> ProcessAsync(Frame frame, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        // Validate even unchanged frames: a resize must never inherit the previous valid status.
        try
        {
            if (frame.Width < 1920 || frame.Height < 1080 || (long)frame.Width * 9 != (long)frame.Height * 16)
                Frames.Normalize(frame); // invalid inputs throw before dHash/OCR; valid larger inputs normalize once in ParseAsync
        }
        catch (UnsupportedFrameException e) { return new(PipelineEventKind.Unsupported, e.Message); }
        if (!_gate.ShouldProcess(frame)) return new(PipelineEventKind.Skipped, "unchanged frame");
        var p = await _parser.ParseAsync(frame);
        ct.ThrowIfCancellationRequested();
        return Accept(p);
    }

    /// <summary>Same confident identity as Core's coordinator (internal there).</summary>
    internal static Dictionary<string, string> ConfidentIdentity(HeaderReading h)
    {
        var d = new Dictionary<string, string>(StringComparer.Ordinal);
        void Add(string k, Reading r) { if (r.Ok && r.Value is not null) d[k] = Convert.ToString(r.Value, CultureInfo.InvariantCulture)!; }
        Add("outfit", h.Outfit); Add("character", h.Character); Add("rating", h.Rating);
        foreach (var (k, r) in h.Stats) Add("stats/" + k, r);
        return d;
    }
    private static bool Compatible(IReadOnlyDictionary<string, string> known, IReadOnlyDictionary<string, string> id)
        => id.All(kv => !known.TryGetValue(kv.Key, out var v) || v == kv.Value);

    internal PipelineEvent Accept(ParsedFrame p)
    {
        switch (p.Screen.Id)
        {
            case ScreenId.DetailsSkills or ScreenId.DetailsInspiration or ScreenId.DetailsCareer when p.Header is not null:
                return AcceptDetails(p, ConfidentIdentity(p.Header));
            case ScreenId.SparksPopup or ScreenId.SparksPopupGuest when _currentSealed is not null:
                return AlreadyQueued();
            case ScreenId.SparksPopup or ScreenId.SparksPopupGuest when _current is not null:
                return Feed(_current, p, null);
            default:
                _continuing = false;
                if (p.Screen.Id is ScreenId.CardsList or ScreenId.CardsDetail) return new(PipelineEventKind.CardScreen, new SupportCardsUnavailable().Message);
                return new(PipelineEventKind.Ignored, "Unknown screen ignored; no data stored.");
        }
    }

    private PipelineEvent AcceptDetails(ParsedFrame p, Dictionary<string, string> id)
    {
        Live? target = null;
        Dictionary<string, string>? sealedTarget = null;
        if (_continuing && _current is not null && Compatible(_current.Identity, id)) target = _current;
        else if (_continuing && _currentSealed is not null && Compatible(_currentSealed, id)) sealedTarget = _currentSealed;
        else
        {
            var live = _live.Where(l => Compatible(l.Identity, id)).ToList();
            var queued = _sealedIdentities.Where(s => Compatible(s, id)).ToList();
            if (live.Count + queued.Count > 1 || (live.Count + queued.Count == 0 && !Required.All(id.ContainsKey)))
            {
                _current = null; _currentSealed = null; _continuing = false;
                return new(PipelineEventKind.Ignored, "Veteran identity is not clear on this frame; hold still on the details header. Nothing stored.");
            }
            if (queued.Count == 1) sealedTarget = queued[0];
            else if (live.Count == 1) target = live[0];
        }
        if (sealedTarget is not null)
        {
            var left = _active is null ? null : Finalize(_active);
            _active = null; _current = null; _currentSealed = sealedTarget; _continuing = true; Progress = null;
            return left is { Kind: PipelineEventKind.Queued or PipelineEventKind.Failed or PipelineEventKind.NotUploadable } ? left : AlreadyQueued();
        }
        PipelineEvent? finalized = null;
        if (_active is not null && !ReferenceEquals(_active, target)) finalized = Finalize(_active);
        if (target is null)
        {
            var evicted = Evict();
            if (evicted is not null) finalized = finalized is null ? evicted : finalized with { Message = finalized.Message + "\n" + evicted.Message };
            target = new Live(new CaptureCoordinator(_data.Layout, _data.Master), _ids.Next(), _clock.UtcNow);
            _live.Add(target);
        }
        if (!ReferenceEquals(_live[^1], target)) { _live.Remove(target); _live.Add(target); }   // most recently visited last
        _current = target; _currentSealed = null; _active = target; _continuing = true;
        foreach (var (k, v) in id) target.Identity.TryAdd(k, v);
        return Feed(target, p, finalized);
    }

    private PipelineEvent Feed(Live target, ParsedFrame p, PipelineEvent? finalized)
    {
        PipelineEvent? limit = null;
        var fingerprint = Fingerprint(p);
        if (!target.Fingerprints.Contains(fingerprint))
        {
            if (target.Frames >= MaxFramesPerSession)
                limit = new(PipelineEventKind.Limit, $"This veteran reached the {MaxFramesPerSession}-view evidence limit, so new views are not collected. If the checklist is complete, Stop to save it; otherwise Stop, Start and recapture with fewer, longer scroll stops.");
            else
            {
                var session = target.Coordinator.Feed(p);
                if (session is null || (target.Session is not null && !ReferenceEquals(session, target.Session)))
                    throw new InvalidOperationException("Capture routing diverged from Core.");
                target.Session = session; target.Frames++; target.Fingerprints.Add(fingerprint);
            }
        }
        if (target.Session is null) return finalized ?? limit ?? new(PipelineEventKind.Ignored, "No veteran evidence stored.");
        var list = target.Session.Checklist().ToArray();
        var tabs = (list.First(s => s.Section == "details.skills").Complete ? 1 : 0)
            + (list.First(s => s.Section == "details.inspiration").Complete ? 1 : 0)
            + (list.Where(s => s.Section.StartsWith("details.career", StringComparison.Ordinal)).All(s => s.Complete) ? 1 : 0);
        Progress = new(target.Session.IdentityKey, tabs, list);
        if (finalized is not null) return finalized;
        return limit ?? new(PipelineEventKind.Progress, "Scroll slowly from top to bottom on Skills and Inspiration, then Career Info; open parent popups before Stop.");
    }

    private static PipelineEvent AlreadyQueued() => new(PipelineEventKind.AlreadyQueued, "This veteran was already queued; Stop and Start to recapture it.");

    /// <summary>Before a new veteran starts, keep at most MaxLiveSessions-1 other unqueued veterans: the least recently
    /// visited one is released and reported. It is necessarily incomplete: a veteran is assembled when the user leaves
    /// it and, if sealed, queued and dropped at once; a left veteran only changes again by being visited.</summary>
    private PipelineEvent? Evict()
    {
        if (_live.Count < MaxLiveSessions) return null;
        var oldest = _live[0];
        _live.RemoveAt(0);
        if (ReferenceEquals(_current, oldest)) _current = null;
        if (ReferenceEquals(_active, oldest)) _active = null;
        _log.Warn("Incomplete collection released at the live-session limit");
        return new(PipelineEventKind.NotUploadable, $"An earlier incomplete veteran was released (at most {MaxLiveSessions} unqueued veterans are kept). Nothing was uploaded for it; recapture it from the top.");
    }

    private PipelineEvent Finalize(Live live)
    {
        if (live.Session is null) { _live.Remove(live); return new(PipelineEventKind.Ignored, "No veteran evidence stored."); }
        var result = live.Session.Assemble(live.Id, live.At, _version);
        if (!result.Uploadable) return new(PipelineEventKind.NotUploadable, "Incomplete veteran kept in memory, NOT uploaded: " + string.Join("; ", result.Blockers));
        // Sealed: the frames are no longer needed. Keep the sealed result (exact retry) and the identity (duplicate guard).
        _live.Remove(live);
        if (ReferenceEquals(_current, live)) { _current = null; _currentSealed = live.Identity; }
        if (ReferenceEquals(_active, live)) _active = null;
        _sealedIdentities.Add(live.Identity);
        return Enqueue(new Sealed(result, live.Id));
    }

    private PipelineEvent Enqueue(Sealed s)
    {
        try
        {
            _outbox.EnqueueCapture(s.Result);
            _pending.Remove(s);
            _log.Info("Complete capture queued");
            return new(PipelineEventKind.Queued, "Complete capture queued for acknowledged upload.", s.Id);
        }
        catch (Exception e)
        {
            if (!_pending.Contains(s)) _pending.Add(s);
            _log.Error("Capture enqueue failed: " + e.GetType().Name);
            return new(PipelineEventKind.Failed, "Complete capture not saved. Keep the agent open, fix local outbox access, then retry Stop.", s.Id);
        }
    }

    /// <summary>Stop/Exit: retry sealed results whose enqueue failed, then finalize every unqueued veteran.</summary>
    public IReadOnlyList<PipelineEvent> Flush()
    {
        var events = _pending.ToArray().Select(Enqueue).ToList();
        events.AddRange(_live.ToArray().Select(Finalize).Where(e => e.Kind != PipelineEventKind.Ignored));
        return events;
    }

    private static readonly JsonSerializerOptions FingerprintOptions = new() { NumberHandling = JsonNumberHandling.AllowNamedFloatingPointLiterals };

    /// <summary>SHA-256 over everything Core reads from a parsed frame except its pixels: screen, scroll thumb, header,
    /// rows, heading, deck, parents, career and popup readings (values, raw text, confidence, ok flags, candidates and
    /// crop boxes). A frame with a fingerprint already fed to the same veteran adds nothing new to its checklist.</summary>
    internal static string Fingerprint(ParsedFrame p)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(new
        {
            Screen = p.Screen.Id, p.Thumb, p.Header, p.Skills, p.Sparks, p.HeadingY, p.Deck, p.Parents, p.Career,
            p.PopupCharacter, p.PopupOutfit, p.GuestTrainer, p.HeldCount, p.ListTiles, p.DetailCard, p.DetailLevel,
        }, FingerprintOptions);
        return Convert.ToHexString(SHA256.HashData(bytes));
    }
}
