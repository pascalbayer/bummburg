// Orthographic 2-D camera with damped motion, parallax support and clamping.
// The view is described by how many world units span the screen width, which
// keeps the framing predictable across phone and desktop aspect ratios.

import { clamp, damp } from '../core/math.js';

export class Camera {
  constructor(world) {
    this.world = world;                  // { width, skyTop, groundFloor }
    this.x = world.width / 2;
    this.y = 380;
    this.viewW = world.width;
    this.tx = this.x;
    this.ty = this.y;
    this.tViewW = this.viewW;
    this.aspect = 16 / 9;
    this.shake = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.minViewW = 340;
    this.maxViewW = world.width * 1.2;
  }

  get viewH() { return this.viewW / this.aspect; }

  setAspect(a) { this.aspect = a; }

  /** Aim the camera at a point with a given horizontal span. */
  focus(x, y, viewW) {
    this.tx = x;
    this.ty = y;
    if (viewW) this.tViewW = clamp(viewW, this.minViewW, this.maxViewW);
  }

  zoomBy(factor, anchorWorldX, anchorWorldY) {
    const before = this.tViewW;
    this.tViewW = clamp(this.tViewW * factor, this.minViewW, this.maxViewW);
    if (anchorWorldX !== undefined) {
      // keep the anchor under the finger/cursor while zooming
      const k = 1 - this.tViewW / before;
      this.tx += (anchorWorldX - this.tx) * k;
      this.ty += (anchorWorldY - this.ty) * k;
    }
    this._clampTargets();
  }

  panBy(dx, dy) {
    this.tx += dx;
    this.ty += dy;
    this._clampTargets();
  }

  addShake(amount) { this.shake = Math.min(this.shake + amount, 46); }

  _clampTargets() {
    const w = this.world;
    const vw = this.tViewW;
    const vh = vw / this.aspect;
    const halfW = vw / 2;
    this.tx = vw >= w.width ? w.width / 2 : clamp(this.tx, halfW - 60, w.width - halfW + 60);
    const minY = vh / 2 + w.groundFloor;
    const maxY = Math.max(minY, w.skyTop - vh / 2);
    this.ty = clamp(this.ty, minY, maxY);
  }

  update(dt) {
    this._clampTargets();
    const lambda = 6.5;
    this.x = damp(this.x, this.tx, lambda, dt);
    this.y = damp(this.y, this.ty, lambda, dt);
    this.viewW = damp(this.viewW, this.tViewW, lambda, dt);
    if (this.shake > 0.02) {
      const s = this.shake;
      this.shakeX = (Math.random() * 2 - 1) * s;
      this.shakeY = (Math.random() * 2 - 1) * s * 0.7;
      this.shake = damp(this.shake, 0, 7, dt);
    } else {
      this.shake = this.shakeX = this.shakeY = 0;
    }
  }

  snap() {
    this._clampTargets();
    this.x = this.tx;
    this.y = this.ty;
    this.viewW = this.tViewW;
  }

  /** Uniform payload: centre x, centre y, 2/viewW, 2/viewH — optionally parallaxed. */
  uniform(parallax = 1, anchorX = this.world.width / 2, anchorY = 300) {
    const cx = anchorX + (this.x + this.shakeX - anchorX) * parallax;
    const cy = anchorY + (this.y + this.shakeY - anchorY) * parallax;
    return [cx, cy, 2 / this.viewW, 2 / this.viewH];
  }

  /** Convert CSS pixel coordinates (origin top-left) into world space. */
  screenToWorld(px, py, cssW, cssH) {
    const nx = (px / cssW) * 2 - 1;
    const ny = 1 - (py / cssH) * 2;
    return {
      x: this.x + this.shakeX + (nx * this.viewW) / 2,
      y: this.y + this.shakeY + (ny * this.viewH) / 2,
    };
  }

  worldToScreen(wx, wy, cssW, cssH) {
    const nx = (wx - this.x - this.shakeX) / (this.viewW / 2);
    const ny = (wy - this.y - this.shakeY) / (this.viewH / 2);
    return { x: ((nx + 1) / 2) * cssW, y: ((1 - ny) / 2) * cssH };
  }

  /** World units per CSS pixel — used to keep line widths screen-constant. */
  unitsPerPixel(cssW) { return this.viewW / cssW; }
}
