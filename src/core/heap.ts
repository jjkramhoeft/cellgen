/** Binary min-heap of (key: float64, value: int32) pairs. Ties break on the smaller value for determinism. */
export class MinHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  size = 0;

  constructor(capacity = 64) {
    this.keys = new Float64Array(Math.max(4, capacity));
    this.vals = new Int32Array(Math.max(4, capacity));
  }

  private less(a: number, b: number): boolean {
    const ka = this.keys[a];
    const kb = this.keys[b];
    return ka < kb || (ka === kb && this.vals[a] < this.vals[b]);
  }

  private swap(a: number, b: number): void {
    const k = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = k;
    const v = this.vals[a];
    this.vals[a] = this.vals[b];
    this.vals[b] = v;
  }

  push(key: number, val: number): void {
    if (this.size === this.keys.length) {
      const nk = new Float64Array(this.size * 2);
      nk.set(this.keys);
      this.keys = nk;
      const nv = new Int32Array(this.size * 2);
      nv.set(this.vals);
      this.vals = nv;
    }
    let i = this.size++;
    this.keys[i] = key;
    this.vals[i] = val;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }

  /** Key of the minimum element (undefined behaviour when empty). */
  peekKey(): number {
    return this.keys[0];
  }

  /** Remove and return the value of the minimum element. */
  pop(): number {
    const top = this.vals[0];
    this.size--;
    if (this.size > 0) {
      this.keys[0] = this.keys[this.size];
      this.vals[0] = this.vals[this.size];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.size && this.less(l, m)) m = l;
        if (r < this.size && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}
