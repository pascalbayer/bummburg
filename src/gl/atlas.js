// Every pixel in Bummburg is generated at runtime with Canvas2D and uploaded as
// a single texture atlas — no image assets to ship, and the art scales with the
// device pixel ratio. Sprites are packed with a simple shelf packer.

import { makeRng } from '../core/rng.js';

const PAD = 8;

/* ── little drawing helpers ─────────────────────────────────────────── */

function scratch(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  return { canvas: c, ctx };
}

/** Per-pixel brightness jitter — cheap way to break up flat fills. */
function speckle(ctx, w, h, amount, rng, alphaOnly = false) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const n = (rng.next() - 0.5) * amount;
    if (alphaOnly) { d[i + 3] = Math.max(0, Math.min(255, d[i + 3] + n)); continue; }
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

function radial(ctx, x, y, r, stops) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  for (const [t, c] of stops) g.addColorStop(t, c);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function linear(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [t, c] of stops) g.addColorStop(t, c);
  return g;
}

function poly(ctx, pts, fill, stroke, lw = 1) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

/* ── masonry ────────────────────────────────────────────────────────── */

function masonry(ctx, w, h, rng, opts) {
  const { base, mortar, light, dark, rows = 2, cols = 2, offset = true } = opts;
  ctx.fillStyle = mortar;
  ctx.fillRect(0, 0, w, h);
  const bh = h / rows;
  for (let r = 0; r < rows; r++) {
    const shift = offset && r % 2 === 1 ? -w / (cols * 2) : 0;
    for (let c = -1; c <= cols; c++) {
      const bw = w / cols;
      const x = c * bw + shift + 1.2;
      const y = r * bh + 1.2;
      const bwi = bw - 2.4, bhi = bh - 2.4;
      if (x > w || x + bwi < 0) continue;
      const tone = 1 + (rng.next() - 0.5) * 0.16;
      ctx.fillStyle = shade(base, tone);
      roundRect(ctx, x, y, bwi, bhi, 2.5);
      ctx.fill();
      // top highlight / bottom shadow give each stone a little relief
      ctx.fillStyle = light;
      ctx.fillRect(x + 1.5, y + 0.8, bwi - 3, 1.4);
      ctx.fillStyle = dark;
      ctx.fillRect(x + 1.5, y + bhi - 2.2, bwi - 3, 1.6);
    }
  }
  speckle(ctx, w, h, 26, rng);
  // edge vignette so a wall of blocks still reads as individual blocks
  ctx.globalCompositeOperation = 'multiply';
  const v = ctx.createLinearGradient(0, 0, 0, h);
  v.addColorStop(0, '#ffffff');
  v.addColorStop(0.75, '#eae7e2');
  v.addColorStop(1, '#c6c2bd');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

/* ── sprite generators ──────────────────────────────────────────────── */

const SPRITES = {
  white: [8, 8, (ctx, w, h) => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }],

  dot: [32, 32, (ctx, w, h) => {
    radial(ctx, w / 2, h / 2, w / 2, [[0, 'rgba(255,255,255,1)'], [0.55, 'rgba(255,255,255,0.95)'],
      [0.8, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]);
  }],

  soft: [96, 96, (ctx, w, h, rng) => {
    for (let i = 0; i < 6; i++) {
      const a = rng.range(0, Math.PI * 2), d = rng.range(0, w * 0.17);
      radial(ctx, w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, w * rng.range(0.26, 0.4),
        [[0, 'rgba(255,255,255,0.42)'], [0.6, 'rgba(255,255,255,0.18)'], [1, 'rgba(255,255,255,0)']]);
    }
    speckle(ctx, w, h, 30, rng, true);
  }],

  spark: [32, 32, (ctx, w, h) => {
    radial(ctx, w / 2, h / 2, w / 2, [[0, 'rgba(255,255,255,1)'], [0.28, 'rgba(255,240,190,0.85)'],
      [0.6, 'rgba(255,170,60,0.30)'], [1, 'rgba(255,120,20,0)']]);
  }],

  ring: [160, 160, (ctx, w, h) => {
    radial(ctx, w / 2, h / 2, w / 2, [[0, 'rgba(255,255,255,0)'], [0.62, 'rgba(255,255,255,0)'],
      [0.80, 'rgba(255,246,214,0.85)'], [0.90, 'rgba(255,190,90,0.5)'], [1, 'rgba(255,150,40,0)']]);
  }],

  stoneA: [64, 64, (ctx, w, h, rng) => masonry(ctx, w, h, rng,
    { base: '#8d8375', mortar: '#544c43', light: 'rgba(255,246,225,0.22)', dark: 'rgba(30,22,16,0.28)' })],
  stoneB: [64, 64, (ctx, w, h, rng) => masonry(ctx, w, h, rng,
    { base: '#95897a', mortar: '#4f483f', light: 'rgba(255,246,225,0.26)', dark: 'rgba(30,22,16,0.26)', rows: 3, cols: 2 })],
  stoneC: [64, 64, (ctx, w, h, rng) => masonry(ctx, w, h, rng,
    { base: '#847a6d', mortar: '#4a433b', light: 'rgba(255,246,225,0.18)', dark: 'rgba(30,22,16,0.3)', rows: 2, cols: 3 })],
  granite: [64, 64, (ctx, w, h, rng) => masonry(ctx, w, h, rng,
    { base: '#6f7079', mortar: '#3c3d45', light: 'rgba(226,236,255,0.22)', dark: 'rgba(14,16,26,0.34)', rows: 3, cols: 2 })],

  wood: [64, 64, (ctx, w, h, rng) => {
    ctx.fillStyle = '#4a3423';
    ctx.fillRect(0, 0, w, h);
    const planks = 3, pw = w / planks;
    for (let i = 0; i < planks; i++) {
      ctx.fillStyle = shade('#6d4a2c', 1 + (rng.next() - 0.5) * 0.22);
      ctx.fillRect(i * pw + 1, 1, pw - 2, h - 2);
      ctx.strokeStyle = 'rgba(38,24,12,0.45)';
      ctx.lineWidth = 1;
      for (let g = 0; g < 3; g++) {          // grain
        const gx = i * pw + rng.range(3, pw - 3);
        ctx.beginPath();
        ctx.moveTo(gx, 2);
        ctx.bezierCurveTo(gx + rng.range(-3, 3), h * 0.35, gx + rng.range(-3, 3), h * 0.65, gx, h - 2);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,224,180,0.16)';
      ctx.fillRect(i * pw + 1.5, 1.5, 1.5, h - 3);
    }
    speckle(ctx, w, h, 18, rng);
  }],

  roof: [64, 64, (ctx, w, h, rng) => {
    ctx.fillStyle = '#57202a';
    ctx.fillRect(0, 0, w, h);
    const rows = 4, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rh;
      const cols = 4, cw = w / cols;
      for (let c = -1; c <= cols; c++) {
        const x = c * cw + (r % 2 ? cw / 2 : 0);
        ctx.fillStyle = shade('#8c3a3a', 1 + (rng.next() - 0.5) * 0.18);
        ctx.beginPath();
        ctx.moveTo(x + 1, y + rh);
        ctx.lineTo(x + 1, y + rh * 0.42);
        ctx.quadraticCurveTo(x + cw / 2, y - rh * 0.15, x + cw - 1, y + rh * 0.42);
        ctx.lineTo(x + cw - 1, y + rh);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,190,160,0.16)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    speckle(ctx, w, h, 20, rng);
  }],

  gate: [64, 64, (ctx, w, h, rng) => {
    ctx.fillStyle = '#2a1c12';
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(4, h);
    ctx.lineTo(4, h * 0.42);
    ctx.quadraticCurveTo(w / 2, -h * 0.1, w - 4, h * 0.42);
    ctx.lineTo(w - 4, h);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = '#5d3d22';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = 'rgba(28,16,8,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo((i + 0.5) * w / 5, 0);
      ctx.lineTo((i + 0.5) * w / 5, h);
      ctx.stroke();
    }
    ctx.fillStyle = '#3a3d47';
    ctx.fillRect(0, h * 0.3, w, 5);
    ctx.fillRect(0, h * 0.72, w, 5);
    ctx.fillStyle = 'rgba(220,230,255,0.25)';
    ctx.fillRect(0, h * 0.3, w, 1.5);
    ctx.fillRect(0, h * 0.72, w, 1.5);
    ctx.restore();
    speckle(ctx, w, h, 18, rng);
  }],

  slit: [64, 64, (ctx, w, h, rng) => {
    masonry(ctx, w, h, rng,
      { base: '#8d8375', mortar: '#544c43', light: 'rgba(255,246,225,0.2)', dark: 'rgba(30,22,16,0.28)' });
    ctx.fillStyle = '#191410';
    ctx.beginPath();
    ctx.moveTo(w * 0.42, h * 0.78);
    ctx.lineTo(w * 0.42, h * 0.3);
    ctx.quadraticCurveTo(w * 0.5, h * 0.14, w * 0.58, h * 0.3);
    ctx.lineTo(w * 0.58, h * 0.78);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,214,140,0.35)';
    ctx.fillRect(w * 0.44, h * 0.55, w * 0.12, h * 0.2);
  }],

  crack1: [64, 64, (ctx, w, h, rng) => cracks(ctx, w, h, rng, 3, 0.5)],
  crack2: [64, 64, (ctx, w, h, rng) => cracks(ctx, w, h, rng, 5, 0.72)],
  crack3: [64, 64, (ctx, w, h, rng) => cracks(ctx, w, h, rng, 7, 0.92)],

  rubble: [32, 32, (ctx, w, h, rng) => {
    const pts = [];
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = w * rng.range(0.3, 0.48);
      pts.push([w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r]);
    }
    poly(ctx, pts, '#8a8175', 'rgba(30,24,18,0.6)', 2);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, '#ffffff'], [1, '#9a958e']]);
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }],

  barrel: [48, 56, (ctx, w, h, rng) => {
    ctx.fillStyle = linear(ctx, 0, 0, w, 0,
      [[0, '#3d2a17'], [0.28, '#7a5330'], [0.55, '#8d6238'], [1, '#3a2715']]);
    roundRect(ctx, 3, 2, w - 6, h - 4, 7);
    ctx.fill();
    ctx.fillStyle = '#2f3138';
    ctx.fillRect(2, h * 0.16, w - 4, 5);
    ctx.fillRect(2, h * 0.68, w - 4, 5);
    ctx.fillStyle = 'rgba(220,230,255,0.28)';
    ctx.fillRect(2, h * 0.16, w - 4, 1.6);
    ctx.fillRect(2, h * 0.68, w - 4, 1.6);
    ctx.strokeStyle = 'rgba(30,18,8,0.5)';
    ctx.lineWidth = 1.2;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(3 + (i * (w - 6)) / 4, 3);
      ctx.lineTo(3 + (i * (w - 6)) / 4, h - 3);
      ctx.stroke();
    }
    speckle(ctx, w, h, 16, rng);
  }],

  crown: [72, 56, (ctx, w, h) => {
    const g = linear(ctx, 0, 0, 0, h, [[0, '#fff0b8'], [0.45, '#f0c14b'], [1, '#9a6b16']]);
    poly(ctx, [[8, h - 6], [8, h * 0.42], [w * 0.24, h * 0.66], [w * 0.36, h * 0.16],
      [w * 0.5, h * 0.5], [w * 0.64, h * 0.16], [w * 0.76, h * 0.66], [w - 8, h * 0.42], [w - 8, h - 6]],
      g, 'rgba(90,58,10,0.7)', 2);
    ctx.fillStyle = '#e8ecff';
    ctx.beginPath(); ctx.arc(w * 0.36, h * 0.2, 3.4, 0, 7); ctx.fill();
    ctx.fillStyle = '#ff6f7d';
    ctx.beginPath(); ctx.arc(w * 0.64, h * 0.2, 3.4, 0, 7); ctx.fill();
    ctx.fillStyle = '#8ef0c0';
    ctx.beginPath(); ctx.arc(w * 0.5, h * 0.72, 4, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(10, h * 0.78, w - 20, 2);
  }],

  flag: [64, 40, (ctx, w, h) => {                    // white so it can be tinted
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, 0);
    ctx.lineTo(w * 0.82, h / 2);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = linear(ctx, 0, 0, w, h, [[0, '#ffffff'], [0.4, '#c9c9c9'], [0.65, '#ffffff'], [1, '#b8b8b8']]);
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }],

  wheel: [44, 44, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2, r = w / 2 - 2;
    ctx.fillStyle = '#2b2f37';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
    ctx.fillStyle = '#6d4a2c';
    ctx.beginPath(); ctx.arc(cx, cy, r - 3.5, 0, 7); ctx.fill();
    ctx.strokeStyle = '#3a2715';
    ctx.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
      ctx.stroke();
    }
    ctx.fillStyle = '#3a3d47';
    ctx.beginPath(); ctx.arc(cx, cy, 4.5, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(220,230,255,0.22)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(cx, cy, r - 1.4, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  }],

  gun: [128, 40, (ctx, w, h) => {                    // muzzle points +x, breech at x=0
    ctx.fillStyle = linear(ctx, 0, 0, 0, h,
      [[0, '#5b626f'], [0.3, '#9aa3b3'], [0.52, '#767d8b'], [1, '#242830']]);
    ctx.beginPath();
    ctx.moveTo(2, h * 0.16);
    ctx.lineTo(w * 0.72, h * 0.3);
    ctx.lineTo(w - 3, h * 0.3);
    ctx.lineTo(w - 3, h * 0.7);
    ctx.lineTo(w * 0.72, h * 0.7);
    ctx.lineTo(2, h * 0.84);
    ctx.quadraticCurveTo(-2, h * 0.5, 2, h * 0.16);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2f343d';
    ctx.fillRect(w * 0.7, h * 0.24, 6, h * 0.52);
    ctx.fillRect(w - 9, h * 0.26, 6, h * 0.48);
    ctx.fillStyle = '#12151b';
    ctx.beginPath(); ctx.ellipse(w - 4, h * 0.5, 2.6, h * 0.19, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(226,236,255,0.35)';
    ctx.fillRect(4, h * 0.3, w - 10, 1.8);
    ctx.fillStyle = '#3a3d47';                       // cascabel
    ctx.beginPath(); ctx.arc(3, h * 0.5, 5.5, 0, 7); ctx.fill();
  }],

  carriage: [80, 44, (ctx, w, h, rng) => {
    ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, '#8a5f37'], [0.5, '#6d4a2c'], [1, '#422c19']]);
    poly(ctx, [[2, h - 4], [w * 0.12, h * 0.12], [w * 0.72, h * 0.2], [w - 3, h * 0.55], [w - 3, h - 4]],
      ctx.fillStyle, 'rgba(28,16,8,0.65)', 2);
    ctx.fillStyle = 'rgba(255,224,180,0.15)';
    ctx.fillRect(w * 0.14, h * 0.18, w * 0.56, 2);
    ctx.fillStyle = '#3a3d47';
    ctx.fillRect(w * 0.2, h * 0.42, w * 0.5, 4);
    speckle(ctx, w, h, 16, rng);
  }],

  ball: [48, 48, (ctx, w, h) => {
    radial(ctx, w * 0.38, h * 0.36, w * 0.52,
      [[0, '#8e94a3'], [0.28, '#4a4f5b'], [0.72, '#22252c'], [1, '#0e1013']]);
    ctx.globalCompositeOperation = 'lighter';
    radial(ctx, w * 0.68, h * 0.72, w * 0.3,
      [[0, 'rgba(255,170,90,0.30)'], [1, 'rgba(255,150,60,0)']]);
    radial(ctx, w * 0.34, h * 0.3, w * 0.16,
      [[0, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]);
    ctx.globalCompositeOperation = 'source-over';
  }],

  tree: [112, 144, (ctx, w, h, rng) => {
    ctx.strokeStyle = '#3b2a1c';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(w / 2, h);
    ctx.lineTo(w / 2 + rng.range(-4, 4), h * 0.52);
    ctx.stroke();
    ctx.lineWidth = 4;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(w / 2, h * 0.66);
      ctx.lineTo(w / 2 + s * w * 0.16, h * 0.5);
      ctx.stroke();
    }
    const greens = ['#3f6b34', '#4c7d3c', '#2f5628', '#588a44'];
    for (let i = 0; i < 9; i++) {
      const a = rng.range(0, Math.PI * 2), d = rng.range(0, w * 0.26);
      ctx.fillStyle = greens[i % greens.length];
      ctx.beginPath();
      ctx.ellipse(w / 2 + Math.cos(a) * d, h * 0.34 + Math.sin(a) * d * 0.7,
        rng.range(w * 0.2, w * 0.3), rng.range(h * 0.13, h * 0.19), rng.range(-0.4, 0.4), 0, 7);
      ctx.fill();
    }
    speckle(ctx, w, h, 22, rng);
  }],

  pine: [96, 160, (ctx, w, h, rng) => {
    ctx.fillStyle = '#3b2a1c';
    ctx.fillRect(w / 2 - 4, h * 0.7, 8, h * 0.3);
    for (let i = 0; i < 4; i++) {
      const t = i / 4;
      const y0 = h * (0.1 + t * 0.62), y1 = y0 + h * 0.26;
      const half = w * (0.16 + t * 0.32);
      ctx.fillStyle = ['#2c5230', '#35603a', '#294c2c', '#3a6a3f'][i];
      poly(ctx, [[w / 2, y0], [w / 2 + half, y1], [w / 2 - half, y1]], ctx.fillStyle);
    }
    speckle(ctx, w, h, 20, rng);
  }],

  bush: [80, 48, (ctx, w, h, rng) => {
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = ['#3f6b34', '#345c2c', '#4a7d3c'][i % 3];
      ctx.beginPath();
      ctx.ellipse(rng.range(w * 0.2, w * 0.8), rng.range(h * 0.45, h * 0.8),
        rng.range(w * 0.16, w * 0.26), rng.range(h * 0.24, h * 0.4), 0, 0, 7);
      ctx.fill();
    }
    speckle(ctx, w, h, 20, rng);
  }],

  grass: [64, 40, (ctx, w, h, rng) => {
    ctx.lineCap = 'round';
    for (let i = 0; i < 11; i++) {
      const x = rng.range(4, w - 4);
      const bend = rng.range(-10, 10);
      ctx.strokeStyle = ['#4f7d3a', '#5f8f44', '#3d642e'][i % 3];
      ctx.lineWidth = rng.range(1.6, 3);
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.quadraticCurveTo(x + bend * 0.4, h * 0.5, x + bend, rng.range(2, h * 0.4));
      ctx.stroke();
    }
  }],

  cloud: [256, 128, (ctx, w, h, rng) => {
    for (let i = 0; i < 14; i++) {
      const t = rng.next();
      const x = w * (0.12 + t * 0.76);
      const y = h * (0.62 - Math.sin(t * Math.PI) * rng.range(0.1, 0.34));
      const r = h * rng.range(0.18, 0.34) * (0.6 + Math.sin(t * Math.PI) * 0.7);
      radial(ctx, x, y, r, [[0, 'rgba(255,255,255,0.55)'], [0.55, 'rgba(255,255,255,0.30)'], [1, 'rgba(255,255,255,0)']]);
    }
  }],

  bird: [48, 24, (ctx, w, h) => {
    ctx.strokeStyle = '#1a1622';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(w * 0.08, h * 0.62);
    ctx.quadraticCurveTo(w * 0.3, h * 0.18, w * 0.5, h * 0.55);
    ctx.quadraticCurveTo(w * 0.7, h * 0.18, w * 0.92, h * 0.62);
    ctx.stroke();
  }],
};

function cracks(ctx, w, h, rng, count, alpha) {
  ctx.strokeStyle = `rgba(18,12,8,${alpha})`;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    let x = rng.range(w * 0.15, w * 0.85);
    let y = rng.range(h * 0.15, h * 0.85);
    ctx.lineWidth = rng.range(1.4, 3.4);
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = rng.int(2, 4);
    for (let s = 0; s < steps; s++) {
      x += rng.range(-w * 0.3, w * 0.3);
      y += rng.range(-h * 0.3, h * 0.3);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // chipped corners
  const chips = Math.round(count / 2);
  for (let i = 0; i < chips; i++) {
    const cx = rng.chance(0.5) ? rng.range(0, w * 0.2) : rng.range(w * 0.8, w);
    const cy = rng.chance(0.5) ? rng.range(0, h * 0.2) : rng.range(h * 0.8, h);
    ctx.fillStyle = `rgba(12,9,6,${alpha * 0.8})`;
    ctx.beginPath();
    ctx.arc(cx, cy, rng.range(3, 7), 0, 7);
    ctx.fill();
  }
}

/* ── packing + upload ───────────────────────────────────────────────── */

export function buildAtlas(gl, scale = 1) {
  const rng = makeRng(0x5eed1234);
  const size = 1024;
  const { canvas, ctx } = scratch(size, size);
  ctx.clearRect(0, 0, size, size);

  const entries = Object.entries(SPRITES)
    .map(([name, [w, h, fn]]) => ({ name, w: Math.round(w * scale), h: Math.round(h * scale), fn }))
    .sort((a, b) => b.h - a.h);

  const sprites = {};
  let shelfX = PAD, shelfY = PAD, shelfH = 0;
  for (const e of entries) {
    if (shelfX + e.w + PAD > size) {
      shelfX = PAD;
      shelfY += shelfH + PAD;
      shelfH = 0;
    }
    if (shelfY + e.h + PAD > size) throw new Error('Texture atlas overflow');
    const s = scratch(e.w, e.h);
    s.ctx.save();
    e.fn(s.ctx, e.w, e.h, rng);
    s.ctx.restore();
    ctx.drawImage(s.canvas, shelfX, shelfY);
    sprites[e.name] = {
      u0: shelfX / size,
      v0: (shelfY + e.h) / size,     // v0 = bottom edge: quad corner (0,0) is bottom-left
      u1: (shelfX + e.w) / size,
      v1: shelfY / size,
      w: e.w,
      h: e.h,
      aspect: e.w / e.h,
    };
    shelfX += e.w + PAD;
    shelfH = Math.max(shelfH, e.h);
  }

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // Keep the mip chain short: deeper levels would bleed neighbouring sprites.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 3);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return { texture: tex, sprites };
}
