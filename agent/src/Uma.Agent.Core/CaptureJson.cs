using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
namespace Uma.Agent.Core;

/// <summary>The wire serializer used by persistence and HTTP, not a test-only adapter.</summary>
public static class CaptureJson
{
    public static JsonSerializerOptions Options { get; } = CreateOptions();
    private static JsonSerializerOptions CreateOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web) { UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
        options.Converters.Add(new JsonStringEnumConverter(allowIntegerValues: false));
        options.Converters.Add(new UtcConverter());
        return options;
    }
    public static string Serialize(VeteranCapture capture) => JsonSerializer.Serialize(capture, Options);
    public static VeteranCapture Deserialize(string json) => JsonSerializer.Deserialize<VeteranCapture>(json, Options) ?? throw new JsonException("Capture is null");
    private sealed class UtcConverter : JsonConverter<DateTimeOffset>
    {
        public override DateTimeOffset Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options)
        {
            var value = reader.GetString();
            if (value is null || !value.EndsWith('Z') || !DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var result)) throw new JsonException("Expected UTC timestamp ending in Z");
            return result;
        }
        public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options) => writer.WriteStringValue(value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'", CultureInfo.InvariantCulture).Replace(".0000000Z", "Z"));
    }
}

public sealed class AptitudesJsonConverter : JsonConverter<Aptitudes>
{
    public override Aptitudes Read(ref Utf8JsonReader reader, Type type, JsonSerializerOptions options) => new(JsonSerializer.Deserialize<Dictionary<string,string>>(ref reader, options) ?? throw new JsonException("Aptitudes is null"));
    public override void Write(Utf8JsonWriter writer, Aptitudes value, JsonSerializerOptions options) => JsonSerializer.Serialize(writer, value.Values, options);
}
