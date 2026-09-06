// A castle is a grid of destructible blocks plus the cannons mounted on it.
// Blocks take damage from blasts, and anything left without a load path down
// to the foundation collapses — knock out a tower's feet and it comes down.

import { CELL_SIZE, CASTLE_COLS, CASTLE_ROWS, CASTLE_CENTRE, MAT, MAT_INFO } from './config.js';

const MAX_CANTILEVER = 3;

/**
 * Mount points a cannon can occupy, in the order they are bought. The castle
 * steps down towards the enemy, so every one of these has a clear line of fire
 * over whatever stands in front of it.
 */
function mountPlan(L) {
  return [
    { gx: L.tower1, gy: L.towerH },       // great tower — the workhorse gun
    { gx: L.wall1, gy: L.wallH },         // front of the curtain wall, flat shots
    { gx: L.keep1, gy: L.keepH },         // keep parapet: highest and longest ranged
    { gx: L.apron1 - 1, gy: 1 },          // field guns on the apron, horribly exposed
    { gx: L.apron0, gy: 1 },
  ];
}

export class Castle {
  /**
   * @param {number} side 0 = left player (faces right), 1 = right player
   */
  constructor(side, rng, terrain) {
    this.side = side;
    this.facing = side === 0 ? 1 : -1;
    this.cols = CASTLE_COLS;
    this.rows = CASTLE_ROWS;
    this.cell = CELL_SIZE;
    this.centreX = CASTLE_CENTRE[side];
    this.originX = this.centreX - (this.cols * CELL_SIZE) / 2;
    this.baseY = terrain.plateauY[side] - 2;

    this.grid = new Uint8Array(this.cols * this.rows);
    this.hp = new Float32Array(this.cols * this.rows);
    this.maxHp = new Float32Array(this.cols * this.rows);
    this.variant = new Uint8Array(this.cols * this.rows);
    this.tone = new Float32Array(this.cols * this.rows);

    this.cannons = [];
    this.king = null;
    this.kingAlive = true;
    this.flag = null;

    this._build(rng);
    this.freezeOriginal();
    this.initialCells = this.countCells();
  }

  idx(gx, gy) { return gy * this.cols + gx; }
  inBounds(gx, gy) { return gx >= 0 && gy >= 0 && gx < this.cols && gy < this.rows; }
  matAt(gx, gy) { return this.inBounds(gx, gy) ? this.grid[this.idx(gx, gy)] : MAT.EMPTY; }

  /** World-space centre of a cell. Mirrored for the right-hand castle. */
  cellWorld(gx, gy) {
    const lx = this.side === 0 ? gx : this.cols - 1 - gx;
    return {
      x: this.originX + (lx + 0.5) * this.cell,
      y: this.baseY + (gy + 0.5) * this.cell,
    };
  }

  /** World point -> grid coordinates in *layout* space (already un-mirrored). */
  worldToCell(x, y) {
    const lx = Math.floor((x - this.originX) / this.cell);
    const gy = Math.floor((y - this.baseY) / this.cell);
    const gx = this.side === 0 ? lx : this.cols - 1 - lx;
    return { gx, gy };
  }

  get bounds() {
    return {
      x0: this.originX,
      x1: this.originX + this.cols * this.cell,
      y0: this.baseY,
      y1: this.baseY + this.rows * this.cell,
    };
  }

  _set(gx, gy, mat, rng) {
    if (!this.inBounds(gx, gy)) return;
    const i = this.idx(gx, gy);
    this.grid[i] = mat;
    if (mat === MAT.EMPTY) { this.hp[i] = this.maxHp[i] = 0; return; }
    const info = MAT_INFO[mat];
    const hp = info.hp * (rng ? rng.range(0.9, 1.12) : 1);
    this.hp[i] = this.maxHp[i] = hp;
    this.variant[i] = rng ? rng.int(0, info.sprite.length - 1) : 0;
    this.tone[i] = rng ? rng.range(0.9, 1.1) : 1;
  }

  _rect(x0, y0, x1, y1, mat, rng) {
    for (let gy = y0; gy <= y1; gy++)
      for (let gx = x0; gx <= x1; gx++) this._set(gx, gy, mat, rng);
  }

  _build(rng) {
    // The profile descends towards the enemy: keep, then tower, then wall, then
    // the open apron. Guns on each level can shoot over everything ahead of them.
    const keepH = rng.int(14, 16);
    const towerH = keepH - rng.int(3, 4);
    const wallH = towerH - rng.int(3, 4);
    const L = {
      keep0: 1, keep1: 6,
      tower0: 8, tower1: 11,
      wall0: 13, wall1: 17,
      apron0: 18, apron1: 20,
      keepH, towerH, wallH,
    };
    this.layout = L;

    // foundation, running out to the apron where the field guns stand
    this._rect(1, 0, L.apron1, 1, MAT.GRANITE, rng);

    // ── keep: thick shell, hollow throne room, timber floors ──
    this._rect(L.keep0, 2, L.keep1, keepH, MAT.STONE, rng);
    this._rect(L.keep0 + 1, 2, L.keep1 - 1, keepH - 1, MAT.EMPTY, rng);
    for (let gy = 2; gy < keepH - 1; gy += 4) {
      this._rect(L.keep0 + 1, gy, L.keep1 - 1, gy, MAT.WOOD, rng);
    }
    this._set(L.keep1, 7, MAT.SLIT, rng);
    this._set(L.keep0, 7, MAT.SLIT, rng);
    // the throne stands on the middle floor, level with the arrow slits
    const kx = L.keep0 + 2;
    this._set(kx, 7, MAT.KING, rng);
    this.king = { gx: kx, gy: 7 };
    // roof stops short of the front column, leaving a parapet for a cannon
    for (let i = 0; i <= 3; i++) {
      this._rect(L.keep0 + i, keepH + 1 + i, L.keep1 - 1 - i, keepH + 1 + i, MAT.ROOF, rng);
    }
    this.flag = { gx: kx, gy: keepH + 5 };

    // ── great tower, with the powder magazine in its belly ──
    this._rect(L.tower0, 2, L.tower1, towerH, MAT.GRANITE, rng);
    this._set(L.tower1, 8, MAT.SLIT, rng);
    // merlons behind the embrasure only, so the gun is never firing into them
    for (let gx = L.tower0; gx < L.tower1; gx++) this._set(gx, towerH + 1, MAT.GRANITE, rng);
    this._rect(L.tower0 + 1, 2, L.tower0 + 2, 3, MAT.POWDER, rng);
    this.magazine = [
      { gx: L.tower0 + 1, gy: 2 }, { gx: L.tower0 + 2, gy: 2 },
      { gx: L.tower0 + 1, gy: 3 }, { gx: L.tower0 + 2, gy: 3 },
    ];

    // ── curtain wall and gatehouse ──
    this._rect(L.wall0, 2, L.wall1, wallH, MAT.STONE, rng);
    this._rect(L.wall0 + 1, 2, L.wall0 + 2, 4, MAT.GATE, rng);
    this.gateRect = { x0: L.wall0 + 1, y0: 2, x1: L.wall0 + 2, y1: 4 };
    for (let gx = L.wall0; gx < L.wall1; gx += 2) this._set(gx, wallH + 1, MAT.STONE, rng);

    this.mounts = mountPlan(L).map((m) => ({ ...m, used: false }));
  }

  /* ── cannons ─────────────────────────────────────────────────────── */

  addCannon() {
    const mount = this.mounts.find((m) => !m.used && this.matAt(m.gx, m.gy) !== MAT.EMPTY);
    if (!mount) return null;
    mount.used = true;
    const p = this.cellWorld(mount.gx, mount.gy);
    const cannon = {
      mount,
      x: p.x,
      y: p.y + this.cell * 0.5 + 7,
      angle: 45,
      alive: true,
      recoil: 0,
      heat: 0,
    };
    this.cannons.push(cannon);
    return cannon;
  }

  get liveCannons() { return this.cannons.filter((c) => c.alive); }

  /** A wrecked gun frees its emplacement, so the mount can be re-armed later. */
  killCannon(cannon) {
    if (!cannon.alive) return;
    cannon.alive = false;
    cannon.mount.used = false;
  }

  /** Muzzle position for a cannon at its current elevation. */
  muzzle(cannon) {
    const a = cannon.angle * (Math.PI / 180);
    const len = 46 - cannon.recoil * 12;
    return {
      x: cannon.x + Math.cos(a) * len * this.facing,
      y: cannon.y + Math.sin(a) * len + 2,
    };
  }

  /* ── damage ──────────────────────────────────────────────────────── */

  /** Solid test in world space (used by projectile collision). */
  solidAt(x, y) {
    const b = this.bounds;
    if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) return false;
    const { gx, gy } = this.worldToCell(x, y);
    return this.matAt(gx, gy) !== MAT.EMPTY;
  }

  countCells() {
    let n = 0;
    for (let i = 0; i < this.grid.length; i++) if (this.grid[i] !== MAT.EMPTY) n++;
    return n;
  }

  get integrity() { return this.initialCells ? this.countCells() / this.initialCells : 0; }

  /**
   * Apply a blast. Returns the cells that were destroyed (with world position
   * and material) plus flags for the two special targets.
   */
  applyBlast(wx, wy, radius, damage, out = []) {
    const result = { destroyed: out, kingHit: false, magazineHit: false, damaged: 0 };
    const r2 = radius * radius;
    const gr = Math.ceil(radius / this.cell) + 1;
    const c = this.worldToCell(wx, wy);
    for (let dy = -gr; dy <= gr; dy++) {
      for (let dx = -gr; dx <= gr; dx++) {
        const gx = c.gx + dx;
        const gy = c.gy + dy;
        if (!this.inBounds(gx, gy)) continue;
        const i = this.idx(gx, gy);
        const mat = this.grid[i];
        if (mat === MAT.EMPTY) continue;
        const p = this.cellWorld(gx, gy);
        const d2 = (p.x - wx) ** 2 + (p.y - wy) ** 2;
        if (d2 > r2) continue;
        const falloff = 1 - Math.sqrt(d2) / radius;
        this.hp[i] -= damage * (0.35 + 0.65 * falloff ** 1.3);
        result.damaged++;
        if (this.hp[i] <= 0) this._destroyCell(gx, gy, result);
      }
    }
    if (result.destroyed.length) this.collapse(result);
    return result;
  }

  _destroyCell(gx, gy, result) {
    const i = this.idx(gx, gy);
    const mat = this.grid[i];
    if (mat === MAT.EMPTY) return;
    if (mat === MAT.KING) { result.kingHit = true; this.kingAlive = false; }
    if (mat === MAT.POWDER) result.magazineHit = true;
    const p = this.cellWorld(gx, gy);
    result.destroyed.push({ x: p.x, y: p.y, mat, gx, gy });
    this.grid[i] = MAT.EMPTY;
    this.hp[i] = 0;
    for (const cannon of this.cannons) {
      if (cannon.alive && cannon.mount.gx === gx && cannon.mount.gy === gy) this.killCannon(cannon);
    }
  }

  /**
   * Structural pass: flood support up from the foundation, allowing a short
   * cantilever sideways. Anything unreached falls down.
   */
  collapse(result) {
    const n = this.cols * this.rows;
    const dist = new Uint8Array(n).fill(255);
    const queue = [];
    for (let gx = 0; gx < this.cols; gx++) {
      const i = this.idx(gx, 0);
      if (this.grid[i] !== MAT.EMPTY) { dist[i] = 0; queue.push(i); }
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi];
      const gx = i % this.cols;
      const gy = (i / this.cols) | 0;
      const d = dist[i];
      // straight up keeps the same load path; sideways and downwards cost span
      const steps = [[gx, gy + 1, d], [gx - 1, gy, d + 1], [gx + 1, gy, d + 1], [gx, gy - 1, d + 1]];
      for (const [nx, ny, nd] of steps) {
        if (!this.inBounds(nx, ny) || nd > MAX_CANTILEVER) continue;
        const ni = this.idx(nx, ny);
        if (this.grid[ni] === MAT.EMPTY || dist[ni] <= nd) continue;
        dist[ni] = nd;
        queue.push(ni);
      }
    }
    for (let gy = this.rows - 1; gy >= 0; gy--) {
      for (let gx = 0; gx < this.cols; gx++) {
        const i = this.idx(gx, gy);
        if (this.grid[i] !== MAT.EMPTY && dist[i] === 255) this._destroyCell(gx, gy, result);
      }
    }
    for (const cannon of this.cannons) {
      if (cannon.alive && this.matAt(cannon.mount.gx, cannon.mount.gy) === MAT.EMPTY) this.killCannon(cannon);
    }
  }

  /** Masons: rebuild destroyed blocks nearest the keep, and patch damage. */
  repair(budget, rng) {
    const rebuilt = [];
    const kx = this.king ? this.king.gx : this.cols / 2;
    const holes = [];
    for (let gy = 0; gy < this.rows; gy++) {
      for (let gx = 0; gx < this.cols; gx++) {
        const i = this.idx(gx, gy);
        if (this.grid[i] === MAT.EMPTY && this.original && this.original[i] !== MAT.EMPTY) {
          holes.push({ gx, gy, i, d: Math.abs(gx - kx) + gy * 0.35 });
        }
      }
    }
    holes.sort((a, b) => a.d - b.d);
    for (const h of holes.slice(0, budget)) {
      // only rebuild where there is something to build on
      if (h.gy > 0 && this.matAt(h.gx, h.gy - 1) === MAT.EMPTY
          && this.matAt(h.gx - 1, h.gy) === MAT.EMPTY
          && this.matAt(h.gx + 1, h.gy) === MAT.EMPTY) continue;
      this._set(h.gx, h.gy, this.original[h.i], rng);
      const p = this.cellWorld(h.gx, h.gy);
      rebuilt.push({ x: p.x, y: p.y, mat: this.original[h.i] });
    }
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] !== MAT.EMPTY) this.hp[i] = Math.min(this.maxHp[i], this.hp[i] + this.maxHp[i] * 0.34);
    }
    if (this.king && this.matAt(this.king.gx, this.king.gy) === MAT.KING) this.kingAlive = true;
    return rebuilt;
  }

  /** Snapshot the pristine layout so masons know what used to stand where. */
  freezeOriginal() {
    this.original = this.grid.slice();
    this._buildInterior();
  }

  /**
   * Mark everything that is "inside" the castle: solid blocks and any void they
   * enclose. Rendering paints those cells with a dark ground first, so a hollow
   * hall reads as a room and a breach reads as a hole rather than a window onto
   * the hills. Cells with open sky directly above are left out, so knocking the
   * top off a wall does not leave a dark square hanging in the air.
   */
  _buildInterior() {
    const n = this.cols * this.rows;
    const outside = new Uint8Array(n);
    const queue = [];
    const seed = (gx, gy) => {
      if (!this.inBounds(gx, gy)) return;
      const i = this.idx(gx, gy);
      if (outside[i] || this.original[i] !== MAT.EMPTY) return;
      outside[i] = 1;
      queue.push(i);
    };
    for (let gx = 0; gx < this.cols; gx++) { seed(gx, 0); seed(gx, this.rows - 1); }
    for (let gy = 0; gy < this.rows; gy++) { seed(0, gy); seed(this.cols - 1, gy); }
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi];
      const gx = i % this.cols;
      const gy = (i / this.cols) | 0;
      seed(gx - 1, gy); seed(gx + 1, gy); seed(gx, gy - 1); seed(gx, gy + 1);
    }
    const inside = new Uint8Array(n);
    for (let i = 0; i < n; i++) inside[i] = outside[i] ? 0 : 1;
    this.interior = new Uint8Array(n);
    for (let gy = 0; gy < this.rows; gy++) {
      for (let gx = 0; gx < this.cols; gx++) {
        const i = this.idx(gx, gy);
        const above = gy + 1 < this.rows ? inside[this.idx(gx, gy + 1)] : 0;
        this.interior[i] = inside[i] && above ? 1 : 0;
      }
    }
  }
}
