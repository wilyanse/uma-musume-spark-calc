using System.Text.Json;
using System.Text.RegularExpressions;
namespace Uma.Agent.Core;

/// <summary>Evaluates the shared capture schema's deliberately bounded keyword set.
/// Unknown validation keywords fail closed instead of silently weakening a future contract.</summary>
public static class CaptureSchema
{
    private static readonly JsonDocument Schema = Load();
    private static JsonDocument Load()
    {
        using var stream = typeof(CaptureSchema).Assembly.GetManifestResourceStream("Uma.Agent.Core.VeteranCapture.schema.json") ?? throw new InvalidOperationException("Shared capture schema missing");
        return JsonDocument.Parse(stream);
    }
    public static IReadOnlyList<string> Validate(string json)
    {
        using var document = JsonDocument.Parse(json);
        var errors = new List<string>();
        Check(document.RootElement, Schema.RootElement, "", errors);
        return errors;
    }
    private static void Check(JsonElement value, JsonElement schema, string path, List<string> errors)
    {
        foreach (var key in schema.EnumerateObject())
            if (key.Name is not ("$schema" or "type" or "properties" or "required" or "additionalProperties" or "const" or "enum" or "anyOf" or "items" or "minimum" or "maximum" or "minLength" or "pattern" or "format" or "minItems" or "maxItems"))
                throw new NotSupportedException("Unsupported shared schema keyword: " + key.Name);
        if (schema.TryGetProperty("anyOf", out var alternatives))
        {
            if (!alternatives.EnumerateArray().Any(s => { var e = new List<string>(); Check(value, s, path, e); return e.Count == 0; })) errors.Add(path + ": anyOf");
            return;
        }
        if (schema.TryGetProperty("type", out var type))
        {
            bool Matches(string? name) => name switch
            {
                "object" => value.ValueKind == JsonValueKind.Object,
                "array" => value.ValueKind == JsonValueKind.Array,
                "string" => value.ValueKind == JsonValueKind.String,
                "integer" => value.ValueKind == JsonValueKind.Number && value.TryGetDecimal(out var n) && decimal.Truncate(n) == n,
                "number" => value.ValueKind == JsonValueKind.Number,
                "boolean" => value.ValueKind is JsonValueKind.True or JsonValueKind.False,
                "null" => value.ValueKind == JsonValueKind.Null,
                _ => throw new NotSupportedException("Unknown schema type")
            };
            var match = type.ValueKind == JsonValueKind.Array ? type.EnumerateArray().Any(t => Matches(t.GetString())) : Matches(type.GetString());
            if (!match) { errors.Add(path + ": type"); return; }
        }
        if (schema.TryGetProperty("const", out var constant) && value.GetRawText() != constant.GetRawText()) errors.Add(path + ": const");
        if (schema.TryGetProperty("enum", out var choices) && !choices.EnumerateArray().Any(c => c.GetRawText() == value.GetRawText())) errors.Add(path + ": enum");
        if (value.ValueKind == JsonValueKind.Object)
        {
            if (schema.TryGetProperty("required", out var required)) foreach (var name in required.EnumerateArray()) if (!value.TryGetProperty(name.GetString()!, out _)) errors.Add(path + "/" + name.GetString() + ": required");
            var hasProperties = schema.TryGetProperty("properties", out var properties);
            foreach (var property in value.EnumerateObject())
            {
                if (hasProperties && properties.TryGetProperty(property.Name, out var child)) Check(property.Value, child, path + "/" + property.Name, errors);
                else if (schema.TryGetProperty("additionalProperties", out var additional) && additional.ValueKind == JsonValueKind.False) errors.Add(path + "/" + property.Name + ": additional property");
            }
        }
        if (value.ValueKind == JsonValueKind.Array)
        {
            if (schema.TryGetProperty("minItems", out var min) && value.GetArrayLength() < min.GetInt32()) errors.Add(path + ": minItems");
            if (schema.TryGetProperty("maxItems", out var max) && value.GetArrayLength() > max.GetInt32()) errors.Add(path + ": maxItems");
            if (schema.TryGetProperty("items", out var item)) { var i = 0; foreach (var child in value.EnumerateArray()) Check(child, item, path + "/" + i++, errors); }
        }
        if (value.ValueKind == JsonValueKind.Number)
        {
            var n = value.GetDouble();
            if (schema.TryGetProperty("minimum", out var min) && n < min.GetDouble()) errors.Add(path + ": minimum");
            if (schema.TryGetProperty("maximum", out var max) && n > max.GetDouble()) errors.Add(path + ": maximum");
        }
        if (value.ValueKind == JsonValueKind.String)
        {
            var text = value.GetString()!;
            if (schema.TryGetProperty("minLength", out var min) && text.Length < min.GetInt32()) errors.Add(path + ": minLength");
            if (schema.TryGetProperty("pattern", out var pattern) && !Regex.IsMatch(text, pattern.GetString()!, RegexOptions.CultureInvariant, TimeSpan.FromSeconds(1))) errors.Add(path + ": pattern");
            // Both date formats in the shared schema carry full calendar/time regexes.
        }
    }
}
