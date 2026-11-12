using System.Collections.Concurrent;
using Sandbox5.Api.Rendering;
using Sandbox5.Domain;
using Sandbox5.Domain.Settings;

namespace Sandbox5.Api;

/// <summary>
/// Holds the settings file and the world maps built from it: one per seed in use (the
/// default seed of the file, and any seed a request names). The file is re-read when it
/// changes, so editing <c>defaults.json</c> and reloading the page shows the new map.
///
/// A map only grows as it is explored; when one has memoised more than the budget it is
/// replaced by a fresh one (results are pure functions of the settings, so nothing changes).
/// </summary>
public sealed class MapHost
{
    /// <summary>Tile size in pixels, and metres per pixel at zoom 0 (each zoom level halves it).</summary>
    public const int TileSize = 256;
    public const double BaseMpp = 8192;
    public const int MinZoom = 0;
    public const int MaxZoom = 10;

    private const int MaxMaps = 4;
    private const long MapBudget = 6_000_000;
    private const long TileCacheBytes = 192L * 1024 * 1024;

    private readonly ILogger<MapHost> _log;
    private readonly object _lock = new();
    private readonly string _path;
    private MapSettings _settings;
    private DateTime _stamp;
    private long _lastCheck;
    private int _version;
    private readonly Dictionary<string, (WorldMap Map, long Used)> _maps = new(StringComparer.Ordinal);
    private long _clock;

    private readonly ConcurrentDictionary<string, byte[]> _tiles = new();
    private readonly ConcurrentQueue<string> _tileOrder = new();
    private long _tileBytes;

    /// <summary>Limits how many images are rendered at once, so a burst of tile requests does not starve the server.</summary>
    public SemaphoreSlim RenderGate { get; } = new(Math.Max(2, Environment.ProcessorCount));

    public MapHost(IConfiguration config, IHostEnvironment env, ILogger<MapHost> log)
    {
        _log = log;
        _path = FindSettingsFile(config["Map:SettingsFile"] ?? "defaults.json", env.ContentRootPath);
        _settings = MapSettings.Load(_path);
        _stamp = File.GetLastWriteTimeUtc(_path);
        _log.LogInformation("Sandbox 5 settings: {Path} (seed \"{Seed}\", {Count} parameters)", _path, _settings.SeedText, _settings.File.Params.Count);
    }

    /// <summary>
    /// The settings file: the configured path when it exists (absolute, or relative to the
    /// content root or one of the folders above it), otherwise the copy next to the binaries.
    /// </summary>
    private static string FindSettingsFile(string name, string contentRoot)
    {
        if (Path.IsPathRooted(name)) return name;
        string? dir = contentRoot;
        for (int up = 0; up < 4 && dir != null; up++, dir = Path.GetDirectoryName(dir))
        {
            string candidate = Path.Combine(dir, name);
            if (File.Exists(candidate)) return candidate;
        }
        return Path.Combine(AppContext.BaseDirectory, name);
    }

    public string SettingsPath => _path;

    /// <summary>The settings of the file as last read (re-read at most once a second when the file changed).</summary>
    public MapSettings Settings
    {
        get
        {
            long now = Environment.TickCount64;
            if (now - Interlocked.Read(ref _lastCheck) < 1000) return _settings;
            lock (_lock)
            {
                _lastCheck = now;
                try
                {
                    DateTime stamp = File.GetLastWriteTimeUtc(_path);
                    if (stamp != _stamp)
                    {
                        _stamp = stamp;
                        _settings = MapSettings.Load(_path);
                        _maps.Clear();
                        _tiles.Clear();
                        while (_tileOrder.TryDequeue(out _)) { }
                        Interlocked.Exchange(ref _tileBytes, 0);
                        _version++;
                        _log.LogInformation("Sandbox 5 settings reloaded from {Path}", _path);
                    }
                }
                catch (Exception e) when (e is SettingsException or IOException or System.Text.Json.JsonException)
                {
                    _log.LogError("Sandbox 5 settings not reloaded (keeping the previous ones): {Message}", e.Message);
                }
                return _settings;
            }
        }
    }

    /// <summary>Changes whenever the settings file is re-read: part of every cache key and ETag.</summary>
    public int Version => _version;

    /// <summary>The map of a seed (the default seed of the settings when null or empty).</summary>
    public WorldMap Map(string? seed = null)
    {
        MapSettings settings = Settings;
        string key = string.IsNullOrWhiteSpace(seed) ? settings.SeedText : seed.Trim();
        if (key.Length > 64) throw new ArgumentException("seed is at most 64 characters");
        lock (_lock)
        {
            if (_maps.TryGetValue(key, out var hit) && hit.Map.CacheCost <= MapBudget)
            {
                _maps[key] = (hit.Map, ++_clock);
                return hit.Map;
            }
            if (!_maps.ContainsKey(key) && _maps.Count >= MaxMaps) _maps.Remove(_maps.MinBy(m => m.Value.Used).Key);
            var map = new WorldMap(key == settings.SeedText ? settings : settings.With(seed: key));
            _maps[key] = (map, ++_clock);
            return map;
        }
    }

    public RenderOptions DefaultOptions => RenderOptions.From(Settings);

    /// <summary>The view of a tile: tile (x, y) at zoom z covers the square from (x, y) × 256 px × mpp(z).</summary>
    public static MapView TileView(int z, int x, int y)
    {
        double mpp = BaseMpp / (1 << z);
        return new MapView(x * TileSize * mpp, y * TileSize * mpp, mpp, TileSize, TileSize);
    }

    /// <summary>A rendered image from the cache, or rendered now (at most a few at a time) and cached.</summary>
    public async Task<byte[]> Image(string cacheKey, Func<byte[]> render, CancellationToken cancel)
    {
        if (_tiles.TryGetValue(cacheKey, out byte[]? png)) return png;
        await RenderGate.WaitAsync(cancel);
        try
        {
            if (_tiles.TryGetValue(cacheKey, out png)) return png;
            png = await Task.Run(render, cancel);
        }
        finally
        {
            RenderGate.Release();
        }
        if (_tiles.TryAdd(cacheKey, png))
        {
            _tileOrder.Enqueue(cacheKey);
            // oldest images go first when over budget
            while (Interlocked.Add(ref _tileBytes, 0) + png.Length > TileCacheBytes && _tileOrder.TryDequeue(out string? old))
            {
                if (_tiles.TryRemove(old, out byte[]? gone)) Interlocked.Add(ref _tileBytes, -gone.Length);
            }
            Interlocked.Add(ref _tileBytes, png.Length);
        }
        return png;
    }
}
