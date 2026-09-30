using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Uma.Agent.Core;

public static class TextMatcher
{
    public static string Normalize(string text)
    {
        var s=text.Trim().Replace("[", "").Replace("]", "");
        s=System.Text.RegularExpressions.Regex.Replace(s, @"^[•)LT]\s*(?=(Speed|Stamina|Power|Guts|Wit|Track|Distance|Style)\b)", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        s=System.Text.RegularExpressions.Regex.Replace(s, @"\s+[®@◯O]$", " ◯");
        s=s.Replace(" O", " ◯").Replace("®", "◯").Replace("@", "◯");
        return System.Text.RegularExpressions.Regex.Replace(s, @"\s+", " ").Trim();
    }
    public static Match<VocabEntry> Match(string raw,IEnumerable<VocabEntry> vocab)
    {
        var n=Normalize(raw); var ranked=vocab.Select(v=>(v,Score(n,Normalize(v.Text)))).OrderByDescending(x=>x.Item2).ThenBy(x=>x.v.Id,StringComparer.Ordinal).Take(3).ToArray();
        var best=ranked.FirstOrDefault(); var second=ranked.Skip(1).FirstOrDefault();
        var accepted=best.v is not null && best.Item2>=.85 && (second.v is null || best.Item2-second.Item2>=.05);
        return new Match<VocabEntry>(accepted?best.v:null,best.v is null?0:best.Item2,ranked.Select(x=>new Candidate(x.v.Id,x.Item2)).ToArray(),accepted);
    }
    private static double Score(string a,string b){ if(a==b)return 1; if(a.Equals(b,StringComparison.OrdinalIgnoreCase))return .99; var d=Distance(a.ToLowerInvariant(),b.ToLowerInvariant()); return 1-(double)d/Math.Max(1,Math.Max(a.Length,b.Length)); }
    private static int Distance(string a,string b){var d=new int[b.Length+1];for(var j=0;j<=b.Length;j++)d[j]=j;for(var i=1;i<=a.Length;i++){var p=d[0];d[0]=i;for(var j=1;j<=b.Length;j++){var q=d[j];d[j]=Math.Min(Math.Min(d[j]+1,d[j-1]+1),p+(a[i-1]==b[j-1]?0:1));p=q;}}return d[^1];}
}

public static class TrainModeDetector { public static TrainMode Detect(string epithet)=>epithet.Trim().Equals("independent learner",StringComparison.OrdinalIgnoreCase)?TrainMode.independent:TrainMode.manual; }

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

public sealed class MasterCatalog
{
    public IReadOnlyList<VocabEntry> Vocab {get;}
    public MasterCatalog(IEnumerable<VocabEntry> vocab)=>Vocab=vocab.ToArray();
    public static MasterCatalog Load(string vocabPath,string? cardVocabPath=null){var list=JsonSerializer.Deserialize<List<VocabEntry>>(File.ReadAllText(vocabPath))??[];if(cardVocabPath is not null&&File.Exists(cardVocabPath))list.AddRange(JsonSerializer.Deserialize<List<VocabEntry>>(File.ReadAllText(cardVocabPath))??[]);return new MasterCatalog(list);}
}
