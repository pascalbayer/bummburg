// Deterministic PRNG (mulberry32). Every match is reproducible from its seed,
// which keeps terrain, castle variation and AI jitter debuggable.

export function makeRng(seed = Date.now() >>> 0) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed,
    /** float in [0,1) */
    next,
    /** float in [lo,hi) */
    range: (lo, hi) => lo + next() * (hi - lo),
    /** integer in [lo,hi] */
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length) % arr.length],
    chance: (p) => next() < p,
    /** roughly normal, mean 0, stddev 1 */
    gauss: () => {
      let u = 0;
      for (let i = 0; i < 3; i++) u += next();
      return (u - 1.5) * 2;
    },
  };
}

/** Smooth 1-D value noise on top of a seeded RNG, used for terrain profiles. */
export function makeNoise1D(rng, octaves = 4) {
  const layers = [];
  for (let o = 0; o < octaves; o++) {
    const n = 8 << o;
    const pts = new Float32Array(n);
    for (let i = 0; i < n; i++) pts[i] = rng.next();
    layers.push(pts);
  }
  return (t) => {
    let sum = 0, amp = 1, norm = 0;
    for (let o = 0; o < layers.length; o++) {
      const pts = layers[o], n = pts.length;
      const x = t * n;
      const i0 = Math.floor(x) % n;
      const i1 = (i0 + 1) % n;
      const f = x - Math.floor(x);
      const s = f * f * (3 - 2 * f);
      sum += (pts[i0] * (1 - s) + pts[i1] * s) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };
}
