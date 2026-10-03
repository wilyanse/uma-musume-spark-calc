using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Uma.Agent.Core;

public static class TrainModeDetector { public static TrainMode Detect(string epithet)=>epithet.Trim().Equals("independent learner",StringComparison.OrdinalIgnoreCase)?TrainMode.independent:TrainMode.manual; }

/// <summary>01 §5 fingerprint. `Canonical` serialises with the default System.Text.Json encoder, which escapes `+`, `&lt;`,
/// `&gt;`, `&amp;`, `'` and every non-ASCII character as \uXXXX, unlike JS `JSON.stringify`. That is safe only because
/// every value it sees is a lower-kebab master ID (`^[a-z]+:[a-z0-9]+(-[a-z0-9]+)*$`), a grade letter, an owner name,
/// an integer or a `YYYY-MM-DD` date, all plain ASCII with no such characters (asserted by
/// `ContractParityTests.Canonical_inputs_need_no_escaping`). If free text ever enters the fingerprint, switch to an
/// encoder that matches JSON.stringify and add a shared vector.</summary>
public static class Fingerprint
{
    private static readonly string[] AptKeys={"turf","dirt","sprint","mile","medium","long","front","pace","late","end"};
    public static string Canonical(Veteran v){
        var a=new Dictionary<string,object?>{{"c",v.CharacterId},{"o",v.OutfitId},{"s",new[]{v.Stats.Spd,v.Stats.Sta,v.Stats.Pow,v.Stats.Gut,v.Stats.Wit}},{"a",AptKeys.Select(k=>v.Aptitudes.Values[k]).ToArray()},{"sp",v.Sparks.Select(s=>$"{s.Owner}|{s.SparkId}|{s.Stars}").OrderBy(x=>x,StringComparer.Ordinal).ToArray()},{"p",v.Parents.OrderBy(p=>p.Slot).Select(p=>p.CharacterId).ToArray()},{"d",v.Career.DateAcquired}};
        using var doc=JsonDocument.Parse(JsonSerializer.Serialize(a)); return Canon(doc.RootElement);
    }
    private static string Canon(JsonElement e){return e.ValueKind switch {JsonValueKind.Object=>"{"+string.Join(',',e.EnumerateObject().OrderBy(x=>x.Name,StringComparer.Ordinal).Select(x=>JsonSerializer.Serialize(x.Name)+":"+Canon(x.Value)))+"}",JsonValueKind.Array=>"["+string.Join(',',e.EnumerateArray().Select(Canon))+"]",_=>e.GetRawText()};}
    public static string Hash(Veteran v){var bytes=SHA256.HashData(Encoding.UTF8.GetBytes(Canonical(v)));return Convert.ToHexString(bytes).ToLowerInvariant();}
}
