using Sandbox5.Domain.Generation;
using Sandbox5.Domain.Numerics;

namespace Sandbox5.Domain.Model;

/// <summary>An sRGB colour.</summary>
public readonly record struct Rgb(byte R, byte G, byte B)
{
    public string Hex => $"#{R:x2}{G:x2}{B:x2}";
}

/// <summary>The five kinds of elevation zone. The numeric value is the index into <see cref="ElevationZoneType.All"/>.</summary>
public enum ElevationZoneKind
{
    Ocean = 0,
    Flat = 1,
    Lowland = 2,
    Hills = 3,
    Mountains = 4,
}

/// <summary>
/// Elevation zone type. Every elevation zone (the medium cells) is ocean or one of four land
/// types. Ocean comes from the ocean genesis; a land zone's type is picked from a hash of its
/// key, by weight. The type sets the terrain's hillslope, river gradient and detail noise.
/// </summary>
public sealed record ElevationZoneType(ElevationZoneKind Kind, string Id, string Name, Rgb Color, int Weight)
{
    /// <summary>Index order is used by the per-type terrain parameters.</summary>
    public static readonly IReadOnlyList<ElevationZoneType> All =
    [
        new(ElevationZoneKind.Ocean, "ocean", "Ocean", new Rgb(38, 84, 132), 0),
        new(ElevationZoneKind.Flat, "flat", "Flat", new Rgb(143, 174, 93), 5),
        new(ElevationZoneKind.Lowland, "lowland", "Lowland", new Rgb(92, 134, 74), 6),
        new(ElevationZoneKind.Hills, "hills", "Hills", new Rgb(154, 138, 98), 1),
        new(ElevationZoneKind.Mountains, "mountains", "Mountains", new Rgb(124, 116, 112), 1),
    ];

    public const int OceanIndex = 0;
    public const int FlatIndex = 1;
    public const int LowlandIndex = 2;
    public const int HillsIndex = 3;
    public const int MountainsIndex = 4;

    private static readonly uint TotalWeight = (uint)All.Sum(t => t.Weight);

    /// <summary>
    /// Type index (into <see cref="All"/>) of an elevation zone: ocean, otherwise a land type
    /// picked by weight from a hash of the zone key (the merged root).
    /// </summary>
    public static int IndexOf(long zoneKey, bool ocean)
    {
        if (ocean) return OceanIndex;
        long h = Hash.Hash4(0x0c0101, 1, CellKeys.I(zoneKey), CellKeys.J(zoneKey)) % TotalWeight;
        for (int i = 0; i < All.Count; i++)
        {
            h -= All[i].Weight;
            if (h < 0) return i;
        }
        return All.Count - 1;
    }

    public static ElevationZoneType Of(long zoneKey, bool ocean) => All[IndexOf(zoneKey, ocean)];
}
