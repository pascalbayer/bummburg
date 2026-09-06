// Particle recipes. Kept apart from the pool so the look of an explosion can be
// tuned without touching the simulation.

import { MAT } from '../game/config.js';

const MAT_DEBRIS = {
  [MAT.STONE]:   [0.55, 0.51, 0.46],
  [MAT.GRANITE]: [0.43, 0.44, 0.48],
  [MAT.WOOD]:    [0.42, 0.29, 0.17],
  [MAT.ROOF]:    [0.55, 0.23, 0.23],
  [MAT.GATE]:    [0.36, 0.24, 0.14],
  [MAT.SLIT]:    [0.55, 0.51, 0.46],
  [MAT.KING]:    [0.72, 0.62, 0.35],
  [MAT.POWDER]:  [0.30, 0.24, 0.18],
};

const rnd = (a, b) => a + Math.random() * (b - a);

export function explosion(P, x, y, scale = 1, { smoke = true, dark = 0.0 } = {}) {
  P.spawn({ x, y, life: 0.16, size: 90 * scale, sizeEnd: 190 * scale, sprite: 'spark',
    r: 1, g: 0.94, b: 0.76, a: 1, additive: true });
  P.spawn({ x, y, life: 0.55, size: 40 * scale, sizeEnd: 300 * scale, sprite: 'ring',
    r: 1, g: 0.82, b: 0.5, a: 0.85, additive: true });
  const sparks = Math.round(16 * scale);
  for (let i = 0; i < sparks; i++) {
    const a = rnd(0, Math.PI * 2), sp = rnd(60, 420) * scale;
    P.spawn({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 40,
      life: rnd(0.35, 1.0), size: rnd(7, 17) * scale, sizeEnd: 2,
      sprite: 'spark', additive: true, grav: 260, drag: 0.9,
      r: 1, g: rnd(0.6, 0.92), b: rnd(0.2, 0.5), a: 1,
    });
  }
  if (!smoke) return;
  const puffs = Math.round(11 * scale);
  for (let i = 0; i < puffs; i++) {
    const a = rnd(0, Math.PI * 2), sp = rnd(10, 150) * scale;
    const tone = rnd(0.5, 0.86) * (1 - dark * 0.55);
    P.spawn({
      x: x + rnd(-8, 8) * scale, y: y + rnd(-8, 8) * scale,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + rnd(20, 70),
      life: rnd(1.1, 2.6), size: rnd(30, 60) * scale, sizeEnd: rnd(90, 180) * scale,
      sprite: 'soft', drag: 1.25, grav: -14,
      rot: rnd(0, 6.28), vrot: rnd(-1.2, 1.2),
      r: tone, g: tone * 0.96, b: tone * 0.92, a: rnd(0.35, 0.6),
    });
  }
}

export function dirtSpray(P, x, y, scale = 1, color = [0.38, 0.29, 0.19]) {
  for (let i = 0; i < Math.round(18 * scale); i++) {
    const a = rnd(-Math.PI * 0.85, -Math.PI * 0.15);
    const sp = rnd(70, 330) * scale;
    P.spawn({
      x, y, vx: Math.cos(a) * sp, vy: -Math.sin(a) * sp,
      life: rnd(0.5, 1.4), size: rnd(5, 13), sizeEnd: rnd(3, 8),
      sprite: 'rubble', grav: 460, drag: 0.25, collide: true,
      rot: rnd(0, 6.28), vrot: rnd(-9, 9),
      r: color[0], g: color[1], b: color[2], a: 1,
    });
  }
  for (let i = 0; i < Math.round(6 * scale); i++) {
    P.spawn({
      x: x + rnd(-14, 14), y: y + rnd(0, 12),
      vx: rnd(-40, 40), vy: rnd(20, 90),
      life: rnd(0.9, 1.9), size: rnd(26, 46), sizeEnd: rnd(70, 130),
      sprite: 'soft', drag: 1.4, grav: -6,
      r: color[0] + 0.16, g: color[1] + 0.14, b: color[2] + 0.12, a: 0.42,
    });
  }
}

export function debrisBurst(P, cells, intensity = 1) {
  for (const c of cells) {
    const col = MAT_DEBRIS[c.mat] || [0.5, 0.5, 0.5];
    const bits = 2 + (Math.random() * 3 | 0);
    for (let i = 0; i < bits; i++) {
      const a = rnd(0, Math.PI * 2), sp = rnd(30, 260) * intensity;
      P.spawn({
        x: c.x + rnd(-6, 6), y: c.y + rnd(-6, 6),
        vx: Math.cos(a) * sp, vy: Math.abs(Math.sin(a)) * sp + rnd(20, 130),
        life: rnd(0.9, 2.4), size: rnd(6, 15), sizeEnd: rnd(5, 12),
        sprite: 'rubble', grav: 470, drag: 0.16, collide: true,
        rot: rnd(0, 6.28), vrot: rnd(-11, 11),
        r: col[0], g: col[1], b: col[2], a: 1,
      });
    }
    P.spawn({
      x: c.x, y: c.y, vx: rnd(-24, 24), vy: rnd(14, 60),
      life: rnd(0.8, 1.8), size: rnd(16, 28), sizeEnd: rnd(46, 82),
      sprite: 'soft', drag: 1.5, grav: -8,
      r: 0.72, g: 0.68, b: 0.62, a: 0.4,
    });
  }
}

export function muzzleBlast(P, x, y, angleRad, facing, power = 60) {
  const s = 0.7 + power / 130;
  const dx = Math.cos(angleRad) * facing, dy = Math.sin(angleRad);
  P.spawn({ x: x + dx * 12, y: y + dy * 12, life: 0.12, size: 60 * s, sizeEnd: 120 * s,
    sprite: 'spark', r: 1, g: 0.92, b: 0.7, a: 1, additive: true });
  for (let i = 0; i < 14; i++) {
    const spread = rnd(-0.45, 0.45);
    const a = Math.atan2(dy, dx) + spread;
    const sp = rnd(120, 460) * s;
    P.spawn({
      x: x + dx * 10, y: y + dy * 10,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: rnd(0.2, 0.6), size: rnd(8, 18) * s, sizeEnd: 2,
      sprite: 'spark', additive: true, drag: 2.4, grav: 60,
      r: 1, g: rnd(0.7, 0.95), b: rnd(0.35, 0.6), a: 1,
    });
  }
  for (let i = 0; i < 10; i++) {
    const a = Math.atan2(dy, dx) + rnd(-0.7, 0.7);
    const sp = rnd(30, 200) * s;
    P.spawn({
      x: x + dx * 8, y: y + dy * 8,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 30,
      life: rnd(0.9, 2.1), size: rnd(20, 40) * s, sizeEnd: rnd(70, 140) * s,
      sprite: 'soft', drag: 1.6, grav: -12,
      rot: rnd(0, 6.28), vrot: rnd(-1, 1),
      r: 0.82, g: 0.8, b: 0.78, a: 0.5,
    });
  }
}

export function trailPuff(P, x, y) {
  P.spawn({
    x, y, vx: rnd(-9, 9), vy: rnd(4, 22),
    life: rnd(0.45, 0.95), size: rnd(7, 12), sizeEnd: rnd(22, 38),
    sprite: 'soft', drag: 1.5, grav: -4,
    r: 0.85, g: 0.84, b: 0.82, a: 0.30,
  });
}

export function collapseDust(P, x, y, w) {
  for (let i = 0; i < 8; i++) {
    P.spawn({
      x: x + rnd(-w, w), y: y + rnd(-10, 20),
      vx: rnd(-40, 40), vy: rnd(-10, 40),
      life: rnd(1.4, 3.0), size: rnd(26, 50), sizeEnd: rnd(80, 170),
      sprite: 'soft', drag: 1.2, grav: -5,
      r: 0.68, g: 0.64, b: 0.58, a: 0.36,
    });
  }
}

export function celebration(P, x, y, color) {
  for (let i = 0; i < 26; i++) {
    const a = rnd(0, Math.PI * 2), sp = rnd(80, 420);
    P.spawn({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 120,
      life: rnd(0.8, 2.0), size: rnd(6, 14), sizeEnd: 2,
      sprite: 'spark', additive: true, grav: 200, drag: 0.7,
      r: color[0], g: color[1], b: color[2], a: 1,
    });
  }
}
