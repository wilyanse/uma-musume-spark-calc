using System.Text.Json;

namespace Uma.Agent.Core;

public sealed record Anchor(Rect Roi, string DHash, int MaxDistance);
public sealed record ScreenFamily(string Id, Anchor Anchor, Rect TitleRoi, string Title);
public sealed record SparkColumn(int Left, int Right, int StarsX);
public sealed record SparkView(int ViewportTop, int ViewportBottom, IReadOnlyList<SparkColumn> Columns);

/// <summary>Typed view of agent/layouts/&lt;version&gt;.json. All coordinates are reference-space (1920x1080).</summary>
public sealed class LayoutProfile
{
    public required string Version { get; init; }
    public required string Directory { get; init; }
    public required JsonElement Root { get; init; }
    public required IReadOnlyList<ScreenFamily> Families { get; init; }
    public required LayoutCrop CardArtCrop { get; init; }
    public required LayoutCrop CharIconCrop { get; init; }

    public static LayoutProfile Load(string path)
    {
        var root = JsonDocument.Parse(File.ReadAllText(path)).RootElement.Clone();
        var reference = root.GetProperty("reference").EnumerateArray().Select(e => e.GetInt32()).ToArray();
        if (reference is not [LayoutProfiles.ReferenceWidth, LayoutProfiles.ReferenceHeight]) throw new InvalidDataException("layout reference must be 1920x1080");
        var families = root.GetProperty("families").EnumerateArray().Select(f => new ScreenFamily(
            f.GetProperty("id").GetString()!,
            new Anchor(R(f.GetProperty("anchor").GetProperty("roi")), f.GetProperty("anchor").GetProperty("dhash").GetString()!, f.GetProperty("anchor").GetProperty("maxDistance").GetInt32()),
            R(f.GetProperty("titleRoi")), f.GetProperty("title").GetString()!)).ToArray();
        var profile = new LayoutProfile
        {
            Version = root.GetProperty("version").GetString()!,
            Directory = Path.GetDirectoryName(Path.GetFullPath(path))!,
            Root = root,
            Families = families,
            CardArtCrop = Crop(root.GetProperty("cardArtCrop")),
            CharIconCrop = Crop(root.GetProperty("charIconCrop")),
        };
        // The layout must mirror packages/master-data/src/art-crop.ts (30 §3).
        if (profile.CardArtCrop != LayoutProfiles.CardArtCrop || profile.CharIconCrop != LayoutProfiles.CharIconCrop)
            throw new InvalidDataException("layout crops differ from the master-data art-crop definition");
        return profile;
    }

    public JsonElement At(params string[] path)
    {
        var e = Root;
        foreach (var p in path) e = e.GetProperty(p);
        return e;
    }

    public Rect Rect(params string[] path) => R(At(path));
    public int Int(params string[] path) => At(path).GetInt32();
    public double Num(params string[] path) => At(path).GetDouble();
    public int[] Ints(params string[] path) => At(path).EnumerateArray().Select(e => e.GetInt32()).ToArray();
    public string Str(params string[] path) => At(path).GetString()!;

    public SparkView Sparks(string screen)
    {
        var s = At("sparks", screen);
        return new SparkView(s.GetProperty("viewportTop").GetInt32(), s.GetProperty("viewportBottom").GetInt32(),
            s.GetProperty("columns").EnumerateArray().Select(c => new SparkColumn(c.GetProperty("left").GetInt32(), c.GetProperty("right").GetInt32(), c.GetProperty("stars").GetInt32())).ToArray());
    }

    public static Rect R(JsonElement e)
    {
        var v = e.EnumerateArray().Select(x => x.GetInt32()).ToArray();
        if (v.Length != 4) throw new InvalidDataException("ROI must be [x,y,w,h]");
        return new Rect(v[0], v[1], v[2], v[3]);
    }

    private static LayoutCrop Crop(JsonElement e) => new(e.GetProperty("x0").GetInt32(), e.GetProperty("y0").GetInt32(), e.GetProperty("x1").GetInt32(), e.GetProperty("y1").GetInt32());
}
