using Sandbox5.Domain.Generation;
using Sandbox5.Domain.Settings;

namespace Sandbox5.Tests;

/// <summary>The settings file: the shipped one is valid, and a broken one is refused with a reason.</summary>
public class SettingsTests
{
    private static string GoldenJson => File.ReadAllText(Path.Combine(Golden.Dir, "settings.json"));

    [Fact]
    public void The_shipped_defaults_file_is_valid()
    {
        // the live sandboxes/sandbox5/defaults.json, copied next to the binaries: every
        // parameter present, of the right type, in range, and no unknown key. Its values are
        // not pinned, so the file can be retuned.
        MapSettings live = MapSettings.Load(Path.Combine(AppContext.BaseDirectory, "defaults.json"));
        Assert.False(string.IsNullOrWhiteSpace(live.SeedText));
        Assert.Equal(8, new World(live.World).Fingerprint().Length);
    }

    [Fact]
    public void Units_of_the_file_become_units_of_the_model()
    {
        MapSettings s = Golden.Settings;
        Assert.Equal(128_000, s.World.RegionSize); // km → m
        Assert.Equal(0.4, s.World.ConnectChance); // per cent → fraction
        Assert.Equal(1000, s.Rivers.Step);
        Assert.Equal(120, s.Rivers.Cone);
        Assert.Equal(1000, s.Terrain.Res);
        Assert.Equal(5, s.Biomes.CoolH.Length);
        Assert.Equal(20_000, s.Locations.Spacing);
        Assert.Equal("map", s.View.Color);
    }

    [Theory]
    [InlineData("\"reg.size\": 128,", "", "is missing")]
    [InlineData("\"reg.size\": 128,", "\"reg.size\": 9000,", "outside")]
    [InlineData("\"reg.size\": 128,", "\"reg.size\": \"big\",", "must be a number")]
    [InlineData("\"reg.size\": 128,", "\"reg.size\": 128, \"reg.colour\": 3,", "unknown parameter")]
    [InlineData("\"oc.from\": \"connected\",", "\"oc.from\": \"everywhere\",", "not one of")]
    [InlineData("\"reg.oceanMax\": 2,", "\"reg.oceanMax\": 1.5,", "whole number")]
    public void A_broken_file_is_refused_with_a_reason(string find, string replace, string reason)
    {
        Assert.Contains(find, GoldenJson);
        var e = Assert.Throws<SettingsException>(() => new MapSettings(DefaultsFile.Parse(GoldenJson.Replace(find, replace), "test.json")));
        Assert.Contains(reason, e.Message);
        Assert.Contains("test.json", e.Message);
    }

    [Fact]
    public void A_seed_and_parameters_can_be_replaced()
    {
        MapSettings other = Golden.Settings.With(seed: "12345", overrides: [new("riv.step", "2"), new("patch.nest", "0")]);
        Assert.Equal(12345u, other.Seed); // digits are used as a number
        Assert.Equal(2000, other.Rivers.Step);
        Assert.False(other.World.Nest);
        Assert.Equal(Golden.Settings.World.RegionSize, other.World.RegionSize);
        Assert.Throws<SettingsException>(() => Golden.Settings.With(overrides: [new("no.such", "1")]));
    }
}
