using System.Globalization;
using Sandbox5.Domain.Settings;

namespace Sandbox5.Api.Rendering;

/// <summary>A rectangle of the world as an image: the world position of the image's top-left corner, the scale and the size.</summary>
/// <param name="X0">World x of the left edge, metres.</param>
/// <param name="Y0">World y of the top edge, metres (y grows downwards, as on screen).</param>
/// <param name="Mpp">Metres per pixel.</param>
public readonly record struct MapView(double X0, double Y0, double Mpp, int Width, int Height)
{
    public double X1 => X0 + Width * Mpp;
    public double Y1 => Y0 + Height * Mpp;

    /// <summary>The view of a given size centred on a point.</summary>
    public static MapView Centred(double x, double y, double mpp, int width, int height) => new(x - width * mpp / 2, y - height * mpp / 2, mpp, width, height);
}

/// <summary>What a map image shows. Defaults come from the <c>view.*</c> parameters of the settings file.</summary>
public sealed record RenderOptions
{
    /// <summary>Colour mode, one of <see cref="ViewSettings.ColorModes"/>.</summary>
    public required string Color { get; init; }
    public required bool Hillshade { get; init; }
    public required bool Rivers { get; init; }
    public required bool Lakes { get; init; }
    public required bool Locations { get; init; }
    /// <summary>Hide every location below this viability score (0–100).</summary>
    public required double LocationMinScore { get; init; }
    public required bool Travel { get; init; }
    /// <summary>"terrain": routes follow the terrain; "simple": straight lines from place to place.</summary>
    public required string TravelStyle { get; init; }
    public required bool RegionEdges { get; init; }
    public required bool ZoneEdges { get; init; }
    public required bool PatchEdges { get; init; }
    public required bool Coast { get; init; }
    public required double RiverWidth { get; init; }
    public required double RiverExp { get; init; }
    public required int RiverMin { get; init; }
    /// <summary>Outline this (merged) patch; −1 = none.</summary>
    public long PinPatch { get; init; } = -1;

    public static RenderOptions From(MapSettings settings)
    {
        ViewSettings v = settings.View;
        return new RenderOptions
        {
            Color = v.Color,
            Hillshade = v.Hillshade,
            Rivers = settings.RiversEnabled,
            Lakes = settings.RiversEnabled,
            Locations = v.Locations,
            LocationMinScore = v.LocationMinScore,
            Travel = v.Travel,
            TravelStyle = v.TravelStyle,
            RegionEdges = v.RegionEdges,
            ZoneEdges = v.ZoneEdges,
            PatchEdges = v.PatchEdges,
            Coast = v.Coast,
            RiverWidth = v.RiverWidth,
            RiverExp = v.RiverExp,
            RiverMin = v.RiverMin,
        };
    }

    /// <summary>
    /// The options with the layers named in a request's query replaced: <c>color</c>,
    /// <c>hillshade</c>, <c>rivers</c>, <c>lakes</c>, <c>locations</c>, <c>locMin</c>,
    /// <c>travel</c>, <c>travelStyle</c>, <c>regEdges</c>, <c>zoneEdges</c>, <c>patchEdges</c>,
    /// <c>coast</c>, <c>pin</c>. Booleans are 1/0 or true/false. Throws
    /// <see cref="ArgumentException"/> on a value that does not parse.
    /// </summary>
    public RenderOptions With(Func<string, string?> query)
    {
        bool Flag(string name, bool current)
        {
            string? v = query(name);
            return v switch
            {
                null or "" => current,
                "1" or "true" => true,
                "0" or "false" => false,
                _ => throw new ArgumentException($"{name} must be 1 or 0"),
            };
        }
        string color = query("color") is { Length: > 0 } c ? c : Color;
        if (Array.IndexOf(ViewSettings.ColorModes, color) < 0) throw new ArgumentException($"color must be one of: {string.Join(", ", ViewSettings.ColorModes)}");
        string style = query("travelStyle") is { Length: > 0 } s ? s : TravelStyle;
        if (style is not ("terrain" or "simple")) throw new ArgumentException("travelStyle must be terrain or simple");
        double locMin = LocationMinScore;
        if (query("locMin") is { Length: > 0 } lm && (!double.TryParse(lm, NumberStyles.Float, CultureInfo.InvariantCulture, out locMin) || !(locMin >= 0 && locMin <= 100))) throw new ArgumentException("locMin must be a number from 0 to 100");
        long pin = PinPatch;
        if (query("pin") is { Length: > 0 } pk && !long.TryParse(pk, NumberStyles.Integer, CultureInfo.InvariantCulture, out pin)) throw new ArgumentException("pin must be a patch key");
        return this with
        {
            Color = color,
            Hillshade = Flag("hillshade", Hillshade),
            Rivers = Flag("rivers", Rivers),
            Lakes = Flag("lakes", Lakes),
            Locations = Flag("locations", Locations),
            LocationMinScore = locMin,
            Travel = Flag("travel", Travel),
            TravelStyle = style,
            RegionEdges = Flag("regEdges", RegionEdges),
            ZoneEdges = Flag("zoneEdges", ZoneEdges),
            PatchEdges = Flag("patchEdges", PatchEdges),
            Coast = Flag("coast", Coast),
            PinPatch = pin,
        };
    }

    /// <summary>A compact key naming everything that changes the image.</summary>
    public string Key => string.Create(CultureInfo.InvariantCulture,
        $"{Color}|{(Hillshade ? 1 : 0)}{(Rivers ? 1 : 0)}{(Lakes ? 1 : 0)}{(Locations ? 1 : 0)}{(Travel ? 1 : 0)}{(RegionEdges ? 1 : 0)}{(ZoneEdges ? 1 : 0)}{(PatchEdges ? 1 : 0)}{(Coast ? 1 : 0)}|{LocationMinScore}|{TravelStyle}|{RiverWidth}|{RiverExp}|{RiverMin}|{PinPatch}");
}
