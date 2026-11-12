namespace Sandbox5.Domain.Numerics;

/// <summary>Binary min-heap of (key: double, value: int) pairs. Ties break on the smaller value, for determinism.</summary>
public sealed class MinHeap
{
    private double[] _keys;
    private int[] _vals;

    public int Size { get; private set; }

    public MinHeap(int capacity = 64)
    {
        _keys = new double[Math.Max(4, capacity)];
        _vals = new int[Math.Max(4, capacity)];
    }

    private bool Less(int a, int b)
    {
        double ka = _keys[a];
        double kb = _keys[b];
        return ka < kb || (ka == kb && _vals[a] < _vals[b]);
    }

    private void Swap(int a, int b)
    {
        (_keys[a], _keys[b]) = (_keys[b], _keys[a]);
        (_vals[a], _vals[b]) = (_vals[b], _vals[a]);
    }

    public void Push(double key, int val)
    {
        if (Size == _keys.Length)
        {
            Array.Resize(ref _keys, Size * 2);
            Array.Resize(ref _vals, Size * 2);
        }
        int i = Size++;
        _keys[i] = key;
        _vals[i] = val;
        while (i > 0)
        {
            int p = (i - 1) >> 1;
            if (!Less(i, p)) break;
            Swap(i, p);
            i = p;
        }
    }

    /// <summary>Key of the minimum element (undefined when empty).</summary>
    public double PeekKey() => _keys[0];

    /// <summary>Remove and return the value of the minimum element.</summary>
    public int Pop()
    {
        int top = _vals[0];
        Size--;
        if (Size > 0)
        {
            _keys[0] = _keys[Size];
            _vals[0] = _vals[Size];
            int i = 0;
            for (;;)
            {
                int l = 2 * i + 1;
                int r = l + 1;
                int m = i;
                if (l < Size && Less(l, m)) m = l;
                if (r < Size && Less(r, m)) m = r;
                if (m == i) break;
                Swap(i, m);
                i = m;
            }
        }
        return top;
    }

    public void Clear() => Size = 0;
}
