using System.Globalization;
using System.Text.Json;

namespace Sandbox5.Domain.Settings;

/// <summary>Thrown when the settings file is missing a parameter, has one of the wrong type, or has one nothing uses.</summary>
public sealed class SettingsException(string message) : Exception(message);

/// <summary>
/// The settings file of a sandbox, in the format every cellgen sandbox uses
/// (<c>sandboxes/&lt;id&gt;/defaults.json</c>): the default <c>seed</c> text and the value of
/// every parameter in <c>params</c>, by key. Values are numbers, booleans or strings.
/// </summary>
public sealed class DefaultsFile
{
    public string Source { get; }
    public string Seed { get; }
    public IReadOnlyDictionary<string, object> Params { get; }

    public DefaultsFile(string seed, IReadOnlyDictionary<string, object> parameters, string source = "settings")
    {
        Seed = seed;
        Params = parameters;
        Source = source;
    }

    public static DefaultsFile Load(string path) => Parse(File.ReadAllText(path), path);

    public static DefaultsFile Parse(string json, string source = "settings")
    {
        using JsonDocument doc = JsonDocument.Parse(json, new JsonDocumentOptions { CommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true });
        JsonElement root = doc.RootElement;
        if (root.ValueKind != JsonValueKind.Object) throw new SettingsException($"{source}: expected a JSON object");
        if (!root.TryGetProperty("seed", out JsonElement seed) || seed.ValueKind != JsonValueKind.String) throw new SettingsException($"{source}: \"seed\" must be a string");
        if (!root.TryGetProperty("params", out JsonElement pars) || pars.ValueKind != JsonValueKind.Object) throw new SettingsException($"{source}: \"params\" must be an object");
        var values = new Dictionary<string, object>(StringComparer.Ordinal);
        foreach (JsonProperty p in pars.EnumerateObject())
        {
            values[p.Name] = p.Value.ValueKind switch
            {
                JsonValueKind.Number => p.Value.GetDouble(),
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                JsonValueKind.String => p.Value.GetString()!,
                _ => throw new SettingsException($"{source}: parameter \"{p.Name}\" must be a number, a boolean or a string"),
            };
        }
        return new DefaultsFile(seed.GetString()!, values, source);
    }

    /// <summary>A copy with some parameters replaced (and optionally another seed). Unknown keys are rejected.</summary>
    public DefaultsFile With(IEnumerable<KeyValuePair<string, string>> overrides, string? seed = null)
    {
        var values = new Dictionary<string, object>(Params, StringComparer.Ordinal);
        foreach (var (key, text) in overrides)
        {
            if (!values.TryGetValue(key, out object? current)) throw new SettingsException($"unknown parameter \"{key}\"");
            values[key] = current switch
            {
                double => double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out double d) && double.IsFinite(d) ? d : throw new SettingsException($"parameter \"{key}\" must be a number"),
                bool => text is "1" or "true" ? true : text is "0" or "false" ? false : throw new SettingsException($"parameter \"{key}\" must be true or false"),
                _ => text,
            };
        }
        return new DefaultsFile(seed ?? Seed, values, Source);
    }
}

/// <summary>Typed access to the parameters of a <see cref="DefaultsFile"/>, remembering which keys were read.</summary>
internal sealed class ParamBag(DefaultsFile file)
{
    private readonly HashSet<string> _used = new(StringComparer.Ordinal);

    private object Get(string key)
    {
        _used.Add(key);
        return file.Params.TryGetValue(key, out object? v) ? v : throw new SettingsException($"{file.Source}: parameter \"{key}\" is missing");
    }

    public void Touch(string key) => _used.Add(key);

    public double Num(string key) => Get(key) is double d ? d : throw new SettingsException($"{file.Source}: parameter \"{key}\" must be a number");

    public double Num(string key, double min, double max)
    {
        double v = Num(key);
        return v >= min && v <= max ? v : throw new SettingsException($"{file.Source}: parameter \"{key}\" = {v.ToString(CultureInfo.InvariantCulture)} is outside [{min.ToString(CultureInfo.InvariantCulture)}, {max.ToString(CultureInfo.InvariantCulture)}]");
    }

    public int Int(string key, int min, int max)
    {
        double v = Num(key, min, max);
        return v == Math.Floor(v) ? (int)v : throw new SettingsException($"{file.Source}: parameter \"{key}\" must be a whole number");
    }

    public bool Bool(string key) => Get(key) is bool b ? b : throw new SettingsException($"{file.Source}: parameter \"{key}\" must be true or false");

    public string Str(string key) => Get(key) is string s ? s : throw new SettingsException($"{file.Source}: parameter \"{key}\" must be a string");

    public string Option(string key, params string[] options)
    {
        string v = Str(key);
        return Array.IndexOf(options, v) >= 0 ? v : throw new SettingsException($"{file.Source}: parameter \"{key}\" = \"{v}\" is not one of: {string.Join(", ", options)}");
    }

    /// <summary>Throws when the file has a key that no parameter uses (a typo, or a removed parameter).</summary>
    public void CheckAllUsed()
    {
        string[] extra = file.Params.Keys.Where(k => !_used.Contains(k)).OrderBy(k => k, StringComparer.Ordinal).ToArray();
        if (extra.Length > 0) throw new SettingsException($"{file.Source}: unknown parameter(s): {string.Join(", ", extra)}");
    }
}
