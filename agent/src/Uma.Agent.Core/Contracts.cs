namespace Uma.Agent.Core;

public enum SparkType { blue, pink, green, white }
public enum SparkOwner { self, parent1, parent2 }
public enum TrainMode { independent, manual }
public enum FieldStatus { ok, low_confidence, corrected }
public enum OcrMode { Text, Digits }
public readonly record struct Rect(int X, int Y, int Width, int Height);
public sealed record Frame(byte[] Bgra, int Width, int Height);
public sealed record OcrLine(string Text, double Confidence, Rect Box);
public interface IFrameSource { Task<Frame> NextAsync(CancellationToken ct); }
public interface IOcrEngine { Task<IReadOnlyList<OcrLine>> ReadAsync(Frame frame, Rect roi, OcrMode mode); }
public interface IClock { DateTimeOffset UtcNow { get; } }
public sealed record CaptureField(string Path, string? RawText, object? Value, double Confidence, FieldStatus Status, IReadOnlyList<Candidate> Candidates, string? CropKey);
public sealed record Candidate(object? Value, double Score);
public sealed record Stats(int Spd,int Sta,int Pow,int Gut,int Wit);
public sealed record Spark(string Owner,string SparkId,string Type,int Stars);
public sealed record Skill(string SkillId,int? Level);
public sealed record Deck(int Slot,string CardId,int Lb,int Level,bool Borrowed);
public sealed record Parent(int Slot,string CharacterId,string? OutfitId,bool IsGuest,string? GuestTrainer);
[System.Text.Json.Serialization.JsonConverter(typeof(AptitudesJsonConverter))]
public sealed record Aptitudes(Dictionary<string,string> Values);
public sealed record Career(int Races,int Wins,int? Fans,string DateAcquired);
public sealed record Veteran(string CharacterId,string OutfitId,string Rank,int Rating,string Epithet,TrainMode TrainMode,Stats Stats,Aptitudes Aptitudes,List<Skill> Skills,List<Spark> Sparks,List<Deck> Deck,List<Parent> Parents,string ScenarioId,Career Career);
public sealed record VeteranCapture(int SchemaVersion,string CaptureId,DateTimeOffset CapturedAt,string AgentVersion,string LayoutVersion,string MasterVersion,string Fingerprint,Veteran Veteran,List<CaptureField> Fields);
public sealed record VocabEntry(string Kind,string Id,string Text);
public sealed record Match<T>(T? Value,double Score,IReadOnlyList<Candidate> Candidates,bool Accepted);
