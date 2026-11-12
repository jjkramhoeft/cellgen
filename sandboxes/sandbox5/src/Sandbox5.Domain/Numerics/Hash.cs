namespace Sandbox5.Domain.Numerics;

/// <summary>
/// Deterministic integer hashing. Everything here is 32-bit integer arithmetic with
/// wrap-around, so results are bit-identical to the TypeScript generator of Sandbox 4
/// (shared/core/hash.ts) and on every platform.
/// </summary>
public static class Hash
{
    /// <summary>pcg3d (Jarzynski &amp; Olano, JCGT 2020): the first output lane.</summary>
    public static uint Pcg3(int a, int b, int c)
    {
        unchecked
        {
            int x = a * 1664525 + 1013904223;
            int y = b * 1664525 + 1013904223;
            int z = c * 1664525 + 1013904223;
            x += y * z;
            y += z * x;
            z += x * y;
            x ^= (int)((uint)x >> 16);
            y ^= (int)((uint)y >> 16);
            z ^= (int)((uint)z >> 16);
            x += y * z;
            return (uint)x;
        }
    }

    /// <summary>MurmurHash3 fmix32 finalizer.</summary>
    public static uint Fmix32(uint h)
    {
        unchecked
        {
            h ^= h >> 16;
            h *= 0x85ebca6b;
            h ^= h >> 13;
            h *= 0xc2b2ae35;
            h ^= h >> 16;
            return h;
        }
    }

    /// <summary>Hash of (seed, stage, x, y). The workhorse for per-cell randomness.</summary>
    public static uint Hash4(int seed, int stage, int x, int y)
    {
        unchecked
        {
            return Fmix32(Pcg3(x, y, seed ^ (stage * (int)0x9e3779b9)));
        }
    }

    /// <summary>Hash of (seed, stage, i).</summary>
    public static uint Hash3(int seed, int stage, int i) => Fmix32(Pcg3(i, stage, seed));

    /// <summary>uint32 → [0, 1).</summary>
    public static double ToUnit(uint h) => h / 4294967296.0;

    /// <summary>String → uint32 seed (xmur3 style), over the UTF-16 code units.</summary>
    public static uint HashString(string str)
    {
        unchecked
        {
            uint h = 1779033703u ^ (uint)str.Length;
            foreach (char ch in str)
            {
                h = (h ^ ch) * 3432918353u;
                h = (h << 13) | (h >> 19);
            }
            h = (h ^ (h >> 16)) * 2246822507u;
            h = (h ^ (h >> 13)) * 3266489909u;
            return h ^ (h >> 16);
        }
    }

    /// <summary>Seed text → uint32. Up to nine digits are used as a number, anything else is hashed.</summary>
    public static uint SeedFromText(string text)
    {
        string t = text.Trim();
        if (t.Length is >= 1 and <= 9 && t.All(c => c is >= '0' and <= '9')) return uint.Parse(t);
        return HashString(t);
    }

    /// <summary>FNV-1a over the float64 bit patterns of the given values: an 8-hex-digit fingerprint.</summary>
    public static string Fingerprint(IEnumerable<double> values)
    {
        unchecked
        {
            uint h = 0x811c9dc5;
            foreach (double v in values)
            {
                ulong bits = (ulong)BitConverter.DoubleToInt64Bits(v);
                h = (h ^ (uint)bits) * 16777619u;
                h = (h ^ (uint)(bits >> 32)) * 16777619u;
            }
            return h.ToString("x8");
        }
    }
}

/// <summary>
/// sfc32 (PractRand) with its state filled from SplitMix32: the sequential PRNG of the
/// generator. One instance per random stream; not thread-safe.
/// </summary>
public sealed class Sfc32
{
    private uint _a, _b, _c, _d;

    public Sfc32(uint seed)
    {
        uint s = seed;
        uint SplitMix()
        {
            unchecked
            {
                s += 0x9e3779b9;
                uint z = s;
                z = (z ^ (z >> 16)) * 0x85ebca6b;
                z = (z ^ (z >> 13)) * 0xc2b2ae35;
                return z ^ (z >> 16);
            }
        }
        _a = SplitMix();
        _b = SplitMix();
        _c = SplitMix();
        _d = SplitMix();
        for (int i = 0; i < 12; i++) Next();
    }

    /// <summary>Uniform in [0, 1).</summary>
    public double Next()
    {
        unchecked
        {
            uint t = _a + _b + _d;
            _d += 1;
            _a = _b ^ (_b >> 9);
            _b = _c + (_c << 3);
            _c = (_c << 21) | (_c >> 11);
            _c += t;
            return t / 4294967296.0;
        }
    }

    /// <summary>Uniform integer in [0, n).</summary>
    public int Int(int n) => (int)Math.Floor(Next() * n);

    /// <summary>Uniform in [lo, hi).</summary>
    public double Range(double lo, double hi) => lo + (hi - lo) * Next();
}
