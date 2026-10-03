using System.Text.Json;
using System.Text.Json.Nodes;
using Xunit;
namespace Uma.Agent.Core.Tests;
public class SchemaTests
{
    [Fact]
    public void Runtime_is_native_net8() => Assert.Equal(8, Environment.Version.Major);
    [Theory]
    [InlineData("captureId", "bad")]
    [InlineData("fingerprint", "ABC")]
    [InlineData("agentVersion", "")]
    [InlineData("layoutVersion", "")]
    [InlineData("masterVersion", "")]
    public void Primitive_envelope_rejection(string name, string value)
    {
        var node = JsonNode.Parse(CaptureJson.Serialize(SerializationTests.Capture()))!;
        node[name] = value;
        Assert.Contains(CaptureSchema.Validate(node.ToJsonString()), e => e.StartsWith("/"+name+":"));
    }
    [Theory]
    [InlineData("2026-02-30")]
    [InlineData("2025-02-29")]
    [InlineData("09/30/2026")]
    public void Calendar_dates_rejected(string value)
    {
        var capture = SerializationTests.Capture();
        capture = capture with { Veteran = capture.Veteran with { Career = capture.Veteran.Career with { DateAcquired = value } } };
        Assert.Contains(CaptureValidation.Validate(capture), e => e.Contains("dateAcquired"));
    }
    [Fact]
    public void Actual_shared_vector_serializer_payloads_all_satisfy_shared_schema()
    {
        using var vectors = JsonDocument.Parse(File.ReadAllText(Path.Combine(SerializationTests.Repo,"packages/schema/test/fingerprint.vectors.json")));
        foreach (var vector in vectors.RootElement.GetProperty("vectors").EnumerateArray())
        {
            var veteran = JsonSerializer.Deserialize<Veteran>(vector.GetProperty("input"),CaptureJson.Options)!;
            var capture = SerializationTests.Capture() with { Veteran = veteran, Fingerprint = Fingerprint.Hash(veteran) };
            Assert.Empty(CaptureSchema.Validate(CaptureJson.Serialize(capture)));
            Assert.Equal(vector.GetProperty("sha256").GetString(),capture.Fingerprint);
        }
    }
    [Fact]
    public void Null_flat_shape_and_extra_properties_are_rejected_by_real_schema()
    {
        var node = JsonNode.Parse(CaptureJson.Serialize(SerializationTests.Capture()))!;
        node["veteran"]!["aptitudes"] = new JsonObject { ["values"] = node["veteran"]!["aptitudes"]!.DeepClone() };
        Assert.NotEmpty(CaptureSchema.Validate(node.ToJsonString()));
        node["secret"] = "never-accepted";
        Assert.Contains(CaptureSchema.Validate(node.ToJsonString()),e => e.Contains("additional property"));
    }
    [Fact]
    public void Master_ID_validation_covers_every_kind_and_deduplicates()
    {
        var capture = SerializationTests.Capture();
        var kinds = new[] { "characters","outfits","ranks","skills","sparks","cards","scenarios" };
        var empty = kinds.ToDictionary(k => k,k => (IReadOnlySet<string>)new HashSet<string>());
        var errors = CaptureValidation.Validate(capture,empty);
        foreach (var kind in kinds) Assert.Contains(errors,e => e.StartsWith("unknown "+kind+" "));
        Assert.Equal(errors.Count,errors.Distinct().Count());
    }
}
