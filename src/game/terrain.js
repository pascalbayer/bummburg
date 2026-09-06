// Height-field terrain: two castle plateaus, rolling hills between them and an
// occasional ridge in the middle that shots have to clear. Craters deform the
// field in place; the mesh is rebuilt only when it actually changes.

import { WORLD, CASTLE_CENTRE } from './config.js';
import { makeNoise1D } from '../core/rng.js';
import { clamp, smoothstep, lerp } from '../core/math.js';

const SPACING = 4;

export class Terrain {
  constructor(rng, opts = {}) {
    this.width = WORLD.width;
    this.count = Math.floor(this.width / SPACING) + 1;
    this.spacing = SPACING;
    this.heights = new Float32Array(this.count);
    this.dirty = true;
    this.rng = rng;
    this.plateauY = [0, 0];
    this.generate(opts);
  }

  generate(opts) {
    const rng = this.rng;
    const base = makeNoise1D(rng, 4);
    const detail = makeNoise1D(rng, 5);

    const plateauLevel = rng.range(268, 330);
    // Keep the two castle platforms within a few units of each other so neither
    // player starts with a height advantage; the ground between them varies.
    const py = [plateauLevel + rng.range(-12, 12), plateauLevel + rng.range(-12, 12)];
    this.plateauY = py;
    this.plateauHalf = 200;

    const ridge = opts.ridge ?? rng.chance(0.55);
    this.hasRidge = ridge;
    const ridgeH = ridge ? rng.range(90, 210) : 0;
    const ridgeX = WORLD.width / 2 + rng.range(-120, 120);
    const ridgeW = rng.range(150, 300);

    for (let i = 0; i < this.count; i++) {
      const x = i * SPACING;
      const t = x / this.width;
      let h = 150 + base(t * 1.15 + 0.3) * 190 + detail(t * 3.1) * 46;

      // valley floor dips in the middle of the map
      h -= smoothstep(0.12, 0.5, t) * smoothstep(0.88, 0.5, t) * 58;

      if (ridge) {
        const d = Math.abs(x - ridgeX) / ridgeW;
        h += ridgeH * Math.max(0, Math.cos(clamp(d, 0, 1) * Math.PI * 0.5)) ** 1.6;
      }

      // flatten a platform under each castle with a soft shoulder
      for (let p = 0; p < 2; p++) {
        const d = Math.abs(x - CASTLE_CENTRE[p]);
        const k = 1 - smoothstep(this.plateauHalf * 0.62, this.plateauHalf * 1.5, d);
        h = lerp(h, py[p], k);
      }

      // taper to the map edges so nothing floats off the side
      const edge = smoothstep(0, 90, x) * smoothstep(0, 90, this.width - x);
      this.heights[i] = lerp(120, h, edge);
    }
    this.dirty = true;
  }

  /** Interpolated ground height at a world x. */
  heightAt(x) {
    const t = clamp(x / SPACING, 0, this.count - 1.001);
    const i = t | 0;
    const f = t - i;
    return this.heights[i] * (1 - f) + this.heights[i + 1] * f;
  }

  slopeAt(x) {
    const d = SPACING * 2;
    return (this.heightAt(x + d) - this.heightAt(x - d)) / (2 * d);
  }

  /** Blast a bowl-shaped crater into the field. */
  crater(cx, radius, depthScale = 0.72) {
    const i0 = Math.max(0, Math.floor((cx - radius) / SPACING));
    const i1 = Math.min(this.count - 1, Math.ceil((cx + radius) / SPACING));
    for (let i = i0; i <= i1; i++) {
      const dx = (i * SPACING - cx) / radius;
      if (dx <= -1 || dx >= 1) continue;
      const drop = Math.cos(dx * Math.PI * 0.5) ** 1.4 * radius * depthScale;
      this.heights[i] = Math.max(70, this.heights[i] - drop);
    }
    this.dirty = true;
  }

  /**
   * Interleaved x,y,r,g,b,depth triangles: a sunlit turf edge, the turf body,
   * a soil band and the rock underneath.
   * @param {{ground:number[]}} palette
   */
  buildMesh(palette) {
    // one extra span at each end runs the ground off past the camera limits
    const cols = this.count + 1;
    const bands = 4;
    const verts = cols * bands * 6;
    if (!this._mesh || this._mesh.length !== verts * 6) this._mesh = new Float32Array(verts * 6);
    const out = this._mesh;
    let o = 0;

    const grassBase = palette.ground;
    const grassLit = grassBase.map((c) => Math.min(1, c * 1.3 + 0.05));
    const soil = [0.34, 0.24, 0.15];
    const soilDeep = [0.24, 0.17, 0.11];
    const rock = [0.19, 0.19, 0.23];
    const rockDeep = [0.10, 0.10, 0.13];

    const push = (x, y, c, depth) => {
      out[o++] = x; out[o++] = y;
      out[o++] = c[0]; out[o++] = c[1]; out[o++] = c[2];
      out[o++] = depth;
    };
    const quad = (x0, y0a, y0b, x1, y1a, y1b, cTop, cBot, dTop, dBot) => {
      push(x0, y0a, cTop, dTop); push(x1, y1a, cTop, dTop); push(x0, y0b, cBot, dBot);
      push(x1, y1a, cTop, dTop); push(x1, y1b, cBot, dBot); push(x0, y0b, cBot, dBot);
    };

    // Thick enough that turf still reads as turf when the whole map is on screen.
    const LIT = 9, GRASS = 54, SOIL = 190;
    const EDGE = 900;
    const last = this.count - 1;
    const sampleX = (k) => (k < 0 ? -EDGE : k > last ? this.width + EDGE : k * SPACING);
    const sampleH = (k) => this.heights[clamp(k, 0, last)];
    const tmpA = [0, 0, 0], tmpB = [0, 0, 0];
    for (let j = 0; j < cols; j++) {
      const i = j - 1;
      const x0 = sampleX(i), x1 = sampleX(i + 1);
      const h0 = sampleH(i), h1 = sampleH(i + 1);
      // steep ground shows rock instead of turf
      const steep = Math.min(1, Math.abs(h1 - h0) / (SPACING * 1.25));
      // (edge spans are flat, so they always read as turf)
      for (let k = 0; k < 3; k++) {
        // steep ground sheds its turf and shows the soil beneath
        tmpA[k] = lerp(grassLit[k], soil[k] * 1.35, steep);
        tmpB[k] = lerp(grassBase[k] * 0.78, soil[k], steep);
      }
      const g0 = h0 - LIT, g1 = h1 - LIT;
      const s0 = h0 - LIT - GRASS, s1 = h1 - LIT - GRASS;
      const r0 = s0 - SOIL, r1 = s1 - SOIL;
      quad(x0, h0, g0, x1, h1, g1, tmpA, tmpB, 0, 0.02);
      quad(x0, g0, s0, x1, g1, s1, tmpB, soil, 0.02, 0.12);
      quad(x0, s0, r0, x1, s1, r1, soil, soilDeep, 0.12, 0.45);
      quad(x0, r0, WORLD.groundFloor, x1, r1, WORLD.groundFloor, rock, rockDeep, 0.45, 1);
    }
    this.dirty = false;
    return { data: out, count: verts };
  }
}

/** Rolling silhouettes for the parallax layers behind the battlefield. */
export function buildHillMesh(rng, { amp, base, colorTop, colorBottom, seedScale = 1.4, span = 2.4 }) {
  const noise = makeNoise1D(rng, 4);
  const cols = 120;
  const width = WORLD.width * span;
  const x0 = -(width - WORLD.width) / 2;
  const step = width / cols;
  const out = new Float32Array(cols * 12 * 6);
  let o = 0;
  const push = (x, y, c, d) => {
    out[o++] = x; out[o++] = y; out[o++] = c[0]; out[o++] = c[1]; out[o++] = c[2]; out[o++] = d;
  };
  const band = (xa, ya, xb, yb, ya2, yb2, cTop, cBot, dTop, dBot) => {
    push(xa, ya, cTop, dTop); push(xb, yb, cTop, dTop); push(xa, ya2, cBot, dBot);
    push(xb, yb, cTop, dTop); push(xb, yb2, cBot, dBot); push(xa, ya2, cBot, dBot);
  };
  const hAt = (i) => base + noise((i / cols) * seedScale) * amp + noise((i / cols) * seedScale * 3.7) * amp * 0.3;
  const lit = colorTop.map((c) => Math.min(1, c * 1.14 + 0.02));
  const CAP = 7 + amp * 0.06;
  for (let i = 0; i < cols; i++) {
    const xa = x0 + i * step, xb = xa + step;
    const ya = hAt(i), yb = hAt(i + 1);
    band(xa, ya, xb, yb, ya - CAP, yb - CAP, lit, colorTop, 0, 0.05);
    band(xa, ya - CAP, xb, yb - CAP, WORLD.groundFloor, WORLD.groundFloor, colorTop, colorBottom, 0.05, 1);
  }
  // callers place scenery along the same profile, in this layer's own space
  const heightAt = (x) => {
    const t = clamp((x - x0) / step, 0, cols);
    const i = Math.floor(t);
    return lerp(hAt(i), hAt(i + 1), t - i);
  };
  return { data: out, count: cols * 12, heightAt, x0, x1: x0 + width };
}
