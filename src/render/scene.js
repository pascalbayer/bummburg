// Draw order for the whole battlefield, from the sky down to the grass in the
// foreground. Everything here reads game state; nothing here mutates it.

import { WORLD, MAT, MAT_INFO, PLAYER_COLORS } from '../game/config.js';
import { Mesh } from '../gl/mesh.js';
import { QuadBatch } from '../gl/quadbatch.js';
import { Sky } from './sky.js';
import { buildHillMesh } from '../game/terrain.js';
import { clamp, lerp } from '../core/math.js';

const PARALLAX = { far: 0.20, mid: 0.42, near: 0.68, clouds: 0.30, wind: 0.55 };

const sliceCache = new Map();

/** Cut the shared gate artwork into the piece belonging to one cell. */
function gateSlice(sprite, rect, gx, gy) {
  const key = `${gx},${gy},${rect.x0},${rect.y0}`;
  let s = sliceCache.get(key);
  if (s) return s;
  const w = rect.x1 - rect.x0 + 1;
  const h = rect.y1 - rect.y0 + 1;
  const fx = (gx - rect.x0) / w;
  const fy = (gy - rect.y0) / h;
  s = {
    u0: lerp(sprite.u0, sprite.u1, fx),
    u1: lerp(sprite.u0, sprite.u1, fx + 1 / w),
    v0: lerp(sprite.v0, sprite.v1, fy),
    v1: lerp(sprite.v0, sprite.v1, fy + 1 / h),
    aspect: sprite.aspect,
  };
  sliceCache.set(key, s);
  return s;
}

export class Scene {
  constructor(ctx, atlas) {
    this.ctx = ctx;
    this.atlas = atlas;
    this.sprites = atlas.sprites;
    this.batch = new QuadBatch(ctx, atlas.texture);
    this.sky = new Sky(ctx, WORLD);
    this.terrainMesh = new Mesh(ctx, { grain: 0.44 });
    this.hills = [
      { mesh: new Mesh(ctx, { grain: 0.08 }), parallax: PARALLAX.far, trees: [] },
      { mesh: new Mesh(ctx, { grain: 0.13 }), parallax: PARALLAX.mid, trees: [] },
      { mesh: new Mesh(ctx, { grain: 0.2 }), parallax: PARALLAX.near, trees: [] },
    ];
    this.clouds = [];
    this.scenery = [];
    this.birds = [];
    this.windStreaks = [];
    this.time = 0;
  }

  /** Rebuild all the static geometry for a fresh match. */
  setup(game, rng) {
    const pal = game.palette;
    this.sky.setPalette(pal);

    const fog = pal.fog;
    // Distance reads as haze: far ridges keep the sky's colour and stay bright,
    // near ones darken towards the turf the battlefield is made of.
    // Heights are chosen so the ridges stack just above the battlefield horizon
    // and still leave the top third of a landscape view to the sky.
    const tints = [
      { amp: 104, base: 330, span: 3.4, scale: 1.1, haze: 0.80, value: 1.04 },
      { amp: 80, base: 274, span: 2.6, scale: 1.7, haze: 0.58, value: 0.90 },
      { amp: 58, base: 228, span: 2.0, scale: 2.4, haze: 0.33, value: 0.76 },
    ];
    this.hills.forEach((layer, i) => {
      const t = tints[i];
      const colorTop = pal.ground.map((c, k) => lerp(c * 1.2, fog[k], t.haze) * t.value);
      const colorBottom = pal.ground.map((c, k) => lerp(c * 0.7, fog[k], t.haze * 0.86) * t.value * 0.9);
      const hill = buildHillMesh(rng, {
        amp: t.amp, base: t.base, colorTop, colorBottom, seedScale: t.scale, span: t.span,
      });
      layer.mesh.upload(hill.data, hill.count);
      layer.profile = hill;
      // a scatter of distant pines, standing on this layer's own skyline
      layer.trees = [];
      const n = i === 0 ? 0 : 12 + i * 7;
      for (let k = 0; k < n; k++) {
        const x = lerp(hill.x0, hill.x1, rng.next());
        const h = 18 + rng.range(0, 14) + i * 13;
        layer.trees.push({
          x, y: hill.heightAt(x) - h * 0.12, h,
          sprite: rng.chance(0.7) ? 'pine' : 'tree',
          haze: [0.72, 0.5, 0.28][i],
          shade: 0.5 + i * 0.14 + rng.range(-0.05, 0.05),
          flip: rng.chance(0.5) ? 1 : -1,
        });
      }
    });

    this.clouds = [];
    for (let i = 0; i < 9; i++) {
      this.clouds.push({
        x: rng.range(-400, WORLD.width + 400),
        y: rng.range(700, 2100),
        w: rng.range(320, 900),
        speed: rng.range(3, 11),
        alpha: rng.range(0.3, 0.85),
      });
    }

    this.birds = [];
    for (let i = 0; i < 5; i++) {
      this.birds.push({
        x: rng.range(0, WORLD.width), y: rng.range(600, 1200),
        speed: rng.range(16, 34) * (rng.chance(0.5) ? 1 : -1),
        phase: rng.range(0, 6.28), size: rng.range(16, 26),
      });
    }

    this.windStreaks = [];
    for (let i = 0; i < 16; i++) {
      this.windStreaks.push({
        x: rng.range(-200, WORLD.width + 200), y: rng.range(420, 1900),
        len: rng.range(40, 190), speed: rng.range(0.6, 1.5), alpha: rng.range(0.05, 0.16),
      });
    }

    // trees, bushes and grass on the playfield itself, clear of the castles
    this.scenery = [];
    const blocked = (x) => game.castles.some((c) => x > c.bounds.x0 - 34 && x < c.bounds.x1 + 34);
    for (let i = 0; i < 72; i++) {
      const x = rng.range(40, WORLD.width - 40);
      if (blocked(x)) continue;
      const roll = rng.next();
      const kind = roll < 0.18 ? 'tree' : roll < 0.34 ? 'pine' : roll < 0.52 ? 'bush' : 'grass';
      const h = kind === 'tree' ? rng.range(38, 66)
        : kind === 'pine' ? rng.range(42, 78)
          : kind === 'bush' ? rng.range(14, 23) : rng.range(8, 14);
      this.scenery.push({
        x, kind, h,
        shade: rng.range(0.82, 1.06),
        flip: rng.chance(0.5) ? 1 : -1,
        sway: rng.range(0, 6.28),
      });
    }
    this.scenery.sort((a, b) => (a.kind === 'grass' ? 1 : 0) - (b.kind === 'grass' ? 1 : 0));
    this.refreshTerrain(game);
  }

  refreshTerrain(game) {
    const m = game.terrain.buildMesh(game.palette);
    this.terrainMesh.upload(m.data, m.count);
  }

  /* ── main draw ───────────────────────────────────────────────────── */

  draw(game, cam, dt) {
    this.time += dt;
    const ctx = this.ctx;
    const b = this.batch;
    const pal = game.palette;
    const S = this.sprites;

    if (game.terrain.dirty) this.refreshTerrain(game);

    ctx.clear(pal.low[0] * 0.4, pal.low[1] * 0.4, pal.low[2] * 0.45);
    this.sky.draw(cam.uniform(0.06), dt);

    // clouds drift with the wind
    const camClouds = cam.uniform(PARALLAX.clouds);
    b.setCamera(camClouds[0], camClouds[1], camClouds[2], camClouds[3]);
    for (const c of this.clouds) {
      c.x += (c.speed + game.wind * 26) * dt;
      if (c.x > WORLD.width + 900) c.x = -900;
      if (c.x < -900) c.x = WORLD.width + 900;
      const tint = pal.fog;
      b.draw(S.cloud, c.x, c.y, c.w, c.w * 0.5, 0,
        1 + tint[0] * 0.1, 1 + tint[1] * 0.05, 1, c.alpha);
    }
    b.flush();

    // hill layers, each with its own parallax and skyline trees
    for (const layer of this.hills) {
      layer.mesh.draw(cam.uniform(layer.parallax));
      if (!layer.trees.length) continue;
      const u = cam.uniform(layer.parallax);
      b.setCamera(u[0], u[1], u[2], u[3]);
      for (const t of layer.trees) {
        const spr = S[t.sprite];
        const s = t.shade;
        b.draw(spr, t.x, t.y + t.h / 2, t.h * spr.aspect * t.flip, t.h, 0,
          lerp(s, pal.fog[0], t.haze), lerp(s, pal.fog[1], t.haze), lerp(s, pal.fog[2] * 1.05, t.haze), 1);
      }
      b.flush();
    }

    // wind streaks make the round's wind readable at a glance
    if (Math.abs(game.wind) > 0.08) {
      const u = cam.uniform(PARALLAX.wind);
      b.setCamera(u[0], u[1], u[2], u[3]);
      b.setBlend('add');
      for (const s of this.windStreaks) {
        s.x += game.wind * 190 * s.speed * dt;
        if (s.x > WORLD.width + 300) s.x -= WORLD.width + 600;
        if (s.x < -300) s.x += WORLD.width + 600;
        const len = s.len * (0.5 + Math.abs(game.wind));
        b.draw(S.dot, s.x, s.y, len, 2.6, 0, 1, 1, 1, s.alpha * Math.abs(game.wind));
      }
      b.setBlend('normal');
      b.flush();
    }

    // ── playfield, all at parallax 1 ──
    const u = cam.uniform(1);
    this.terrainMesh.draw(u);
    b.setCamera(u[0], u[1], u[2], u[3]);

    const view = { x0: cam.x - cam.viewW * 0.6, x1: cam.x + cam.viewW * 0.6 };
    this._drawScenery(game, view, pal);
    for (const castle of game.castles) this._drawCastle(game, castle, pal, view);
    for (const castle of game.castles) this._drawCannons(game, castle, pal);
    b.flush();

    if (game.preview && game.preview.points.length > 3) this._drawPreview(game, cam);
    if (game.dragIndicator) this._drawDrag(game, cam);
    this._drawBall(game);
    b.flush();

    game.particles.draw(b);
    b.flush();
  }

  _drawScenery(game, view, pal) {
    const b = this.batch;
    const S = this.sprites;
    const light = pal.light;
    for (const s of this.scenery) {
      if (s.x < view.x0 - 80 || s.x > view.x1 + 80) continue;
      const gy = game.terrain.heightAt(s.x);
      const spr = S[s.kind === 'grass' ? 'grass' : s.kind];
      const w = s.h * spr.aspect * s.flip;
      const sway = Math.sin(this.time * 1.4 + s.sway) * (0.014 + Math.abs(game.wind) * 0.05)
        + game.wind * 0.06;
      b.draw(spr, s.x, gy + s.h / 2 - 2, w, s.h, sway,
        light[0] * s.shade, light[1] * s.shade, light[2] * s.shade, 1);
    }
  }

  _drawCastle(game, castle, pal, view) {
    const b = this.batch;
    const S = this.sprites;
    const cell = castle.cell;
    const light = pal.light;
    const amb = pal.ambient;
    const bounds = castle.bounds;
    if (bounds.x1 < view.x0 || bounds.x0 > view.x1) return;

    // dark interior behind the masonry: rooms read as rooms, breaches as holes
    const dark = [0.085 + amb[0] * 0.05, 0.072 + amb[1] * 0.05, 0.070 + amb[2] * 0.06];
    for (let gy = 0; gy < castle.rows; gy++) {
      for (let gx = 0; gx < castle.cols; gx++) {
        if (!castle.interior[castle.idx(gx, gy)]) continue;
        const p = castle.cellWorld(gx, gy);
        b.draw(S.white, p.x, p.y, cell + 1.2, cell + 1.2, 0, dark[0], dark[1], dark[2], 1);
      }
    }

    for (let gy = 0; gy < castle.rows; gy++) {
      for (let gx = 0; gx < castle.cols; gx++) {
        const i = castle.idx(gx, gy);
        const mat = castle.grid[i];
        if (mat === MAT.EMPTY) continue;
        const p = castle.cellWorld(gx, gy);
        const info = MAT_INFO[mat];

        // cheap ambient occlusion: enclosed blocks sit in shade
        let neighbours = 0;
        if (castle.matAt(gx - 1, gy)) neighbours++;
        if (castle.matAt(gx + 1, gy)) neighbours++;
        if (castle.matAt(gx, gy + 1)) neighbours += 1.6;
        if (castle.matAt(gx, gy - 1)) neighbours += 0.4;
        const ao = 1 - neighbours * 0.045;
        const tone = castle.tone[i] * ao;
        const hpFrac = castle.maxHp[i] ? clamp(castle.hp[i] / castle.maxHp[i], 0, 1) : 1;
        const scorch = lerp(0.62, 1, hpFrac);

        const r = light[0] * tone * info.tint[0] * scorch + amb[0] * 0.14;
        const g = light[1] * tone * info.tint[1] * scorch + amb[1] * 0.14;
        const bl = light[2] * tone * info.tint[2] * scorch + amb[2] * 0.14;

        if (mat === MAT.POWDER) {
          b.draw(S.stoneC, p.x, p.y, cell + 0.6, cell + 0.6, 0, r * 0.7, g * 0.68, bl * 0.66, 1);
          b.draw(S.barrel, p.x, p.y, cell * 0.82, cell * 0.94, 0, r, g * 0.95, bl * 0.9, 1);
        } else if (mat === MAT.GATE && castle.gateRect) {
          // one gate spread across its cells rather than a door in every block
          b.draw(gateSlice(S.gate, castle.gateRect, gx, gy), p.x, p.y,
            (cell + 0.6) * (castle.side === 0 ? 1 : -1), cell + 0.6, 0, r, g, bl, 1);
        } else {
          const name = info.sprite[castle.variant[i] % info.sprite.length];
          const flip = castle.side === 0 ? 1 : -1;
          b.draw(S[name], p.x, p.y, (cell + 0.6) * flip, cell + 0.6, 0, r, g, bl, 1);
        }

        if (hpFrac < 0.86) {
          const stage = hpFrac < 0.35 ? 'crack3' : hpFrac < 0.62 ? 'crack2' : 'crack1';
          b.draw(S[stage], p.x, p.y, cell + 0.6, cell + 0.6, 0, 1, 1, 1, 1 - hpFrac * 0.55);
        }
      }
    }

    // the throne: a crown that glows while the king still holds it
    if (castle.kingAlive && castle.king) {
      const p = castle.cellWorld(castle.king.gx, castle.king.gy);
      const pulse = 0.72 + Math.sin(this.time * 2.4) * 0.14;
      b.setBlend('add');
      b.draw(S.dot, p.x, p.y, cell * 3.4, cell * 3.4, 0, 1, 0.82, 0.35, 0.2 * pulse);
      b.setBlend('normal');
      b.draw(S.crown, p.x, p.y + 1, cell * 1.15, cell * 1.15 / S.crown.aspect, 0, 1, 1, 1, 1);
    }

    // banner on the keep
    if (castle.flag) {
      const anchorGy = this._flagAnchor(castle);
      if (anchorGy !== null) {
        const p = castle.cellWorld(castle.flag.gx, anchorGy);
        const col = PLAYER_COLORS[castle.side];
        const poleH = cell * 2.2;
        const baseY = p.y + cell * 0.5;
        b.draw(S.white, p.x, baseY + poleH / 2, 2.4, poleH, 0, 0.24, 0.2, 0.16, 1);
        const wave = Math.sin(this.time * 3.1 + castle.side) * 0.09 + game.wind * 0.12;
        const fw = cell * 1.9 * castle.facing;
        b.draw(S.flag, p.x + fw * 0.5, baseY + poleH - cell * 0.5, fw, cell * 1.15, wave,
          col[0] * 1.05, col[1] * 1.05, col[2] * 1.05, 1);
      }
    }
  }

  /** Highest solid cell in the flag's column, so the banner sinks with the keep. */
  _flagAnchor(castle) {
    for (let gy = castle.rows - 1; gy >= 0; gy--) {
      if (castle.matAt(castle.flag.gx, gy) !== MAT.EMPTY) return gy;
    }
    return null;
  }

  _drawCannons(game, castle, pal) {
    const b = this.batch;
    const S = this.sprites;
    const light = pal.light;
    const isActive = (c) => game.activeCannon === c && game.phase === 'aim';
    for (const c of castle.cannons) {
      if (!c.alive) continue;
      const facing = castle.facing;
      const a = c.angle * (Math.PI / 180);
      const rot = facing === 1 ? a : Math.PI - a;
      const recoil = c.recoil * 16;
      const bx = c.x - Math.cos(a) * recoil * facing;
      const by = c.y - Math.sin(a) * recoil;
      const glow = isActive(c) ? 1.18 : 1;
      const r = light[0] * glow, g = light[1] * glow, bl = light[2] * glow;

      b.draw(S.carriage, bx, by - 2, 30 * facing, 30 / S.carriage.aspect, 0, r * 0.95, g * 0.9, bl * 0.85, 1);
      // barrel pivots about the trunnion, a little ahead of the carriage centre
      const len = 46, pivotBack = 13;
      const cx = bx + Math.cos(rot) * (len / 2 - pivotBack);
      const cy = by + 5 + Math.sin(rot) * (len / 2 - pivotBack);
      b.draw(S.gun, cx, cy, len, len / S.gun.aspect, rot, r, g, bl, 1);
      b.draw(S.wheel, bx - 5 * facing, by - 8, 15, 15, -c.recoil * 3 * facing, r * 0.9, g * 0.85, bl * 0.8, 1);

      if (c.heat > 0.01) {
        b.setBlend('add');
        const m = castle.muzzle(c);
        b.draw(S.spark, m.x, m.y, 26 * c.heat, 26 * c.heat, 0, 1, 0.6, 0.25, c.heat * 0.7);
        b.setBlend('normal');
      }
      if (isActive(c)) {
        const pulse = 0.5 + Math.sin(this.time * 4) * 0.2;
        b.setBlend('add');
        b.draw(S.dot, bx, by + 2, 74, 74, 0,
          PLAYER_COLORS[castle.side][0], PLAYER_COLORS[castle.side][1], PLAYER_COLORS[castle.side][2],
          0.16 * pulse);
        b.setBlend('normal');
      }
    }
  }

  _drawPreview(game, cam) {
    const b = this.batch;
    const S = this.sprites;
    const pts = game.preview.points;
    const n = pts.length / 2;
    const limit = game.assist === 'full' ? n : Math.min(n, Math.max(6, Math.floor(n * 0.34)));
    const col = PLAYER_COLORS[game.activePlayer];
    const size = clamp(cam.viewW * 0.006, 3.4, 8);
    b.setBlend('add');
    for (let i = 1; i < limit; i++) {
      const t = i / Math.max(1, limit - 1);
      const fade = (1 - t * 0.75) * (game.assist === 'full' ? 0.85 : 1);
      b.draw(S.dot, pts[i * 2], pts[i * 2 + 1], size, size, 0, col[0], col[1], col[2], 0.55 * fade);
    }
    b.setBlend('normal');
    if (game.assist === 'full' && game.preview.hit) {
      const h = game.preview.hit;
      const s = 22 + Math.sin(this.time * 6) * 3;
      b.draw(S.ring, h.x, h.y, s * 2.4, s * 2.4, 0, col[0], col[1], col[2], 0.5);
    }
  }

  /** The bowstring the player is pulling: origin, taut line and heading. */
  _drawDrag(game, cam) {
    const b = this.batch;
    const S = this.sprites;
    const d = game.dragIndicator;
    const col = PLAYER_COLORS[game.activePlayer];
    const px = cam.viewW / 1000;
    const dx = d.x1 - d.x0, dy = d.y1 - d.y0;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    b.setBlend('add');
    const dots = Math.min(28, Math.max(3, Math.round(len / (16 * px))));
    for (let i = 0; i <= dots; i++) {
      const t = i / dots;
      b.draw(S.dot, d.x0 + dx * t, d.y0 + dy * t, 6 * px, 6 * px, 0,
        col[0], col[1], col[2], 0.5 * (1 - t * 0.5));
    }
    b.draw(S.ring, d.x0, d.y0, 46 * px, 46 * px, 0, col[0], col[1], col[2], 0.55);
    // power read-out as a filled ring around the anchor
    const p = d.power / 100;
    b.draw(S.dot, d.x0, d.y0, 26 * px * p, 26 * px * p, 0, 1, 0.8 + p * 0.2, 0.4, 0.5);
    b.setBlend('normal');
  }

  _drawBall(game) {
    const b = this.batch;
    const S = this.sprites;
    if (!game.ball) return;
    const trail = game.ballTrail;
    b.setBlend('add');
    for (let i = 0; i < trail.length; i += 2) {
      const t = i / Math.max(2, trail.length - 2);
      b.draw(S.dot, trail[i], trail[i + 1], 9 * t + 2, 9 * t + 2, 0, 1, 0.72, 0.42, 0.24 * t);
    }
    b.setBlend('normal');
    const r = 11;
    b.draw(S.ball, game.ball.x, game.ball.y, r, r, game.ball.t * 6, 1, 1, 1, 1);
  }
}
