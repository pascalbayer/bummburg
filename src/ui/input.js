// Pointer, wheel and keyboard input. One finger aims, two fingers pan and
// zoom, and the mouse does both without any modifier gymnastics.

const TAP_SLOP = 10;      // CSS px a "tap" may wander
const TAP_TIME = 320;     // ms
const DOUBLE_TAP = 320;

export class InputController {
  constructor(canvas, handlers) {
    this.canvas = canvas;
    this.h = handlers;
    this.pointers = new Map();
    this.drag = null;
    this.gesture = null;
    this.lastTap = 0;
    this.enabled = true;
    this._bind();
  }

  get cssSize() {
    const r = this.canvas.getBoundingClientRect();
    return { w: r.width || window.innerWidth, h: r.height || window.innerHeight, left: r.left, top: r.top };
  }

  _local(e) {
    const s = this.cssSize;
    return { x: e.clientX - s.left, y: e.clientY - s.top };
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this._down(e));
    c.addEventListener('pointermove', (e) => this._move(e));
    c.addEventListener('pointerup', (e) => this._up(e));
    c.addEventListener('pointercancel', (e) => this._up(e, true));
    c.addEventListener('pointerleave', (e) => this._up(e, true));
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = this._local(e);
      const factor = Math.exp(Math.sign(e.deltaY) * 0.16);
      this.h.onZoom?.(factor, p);
    }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this._key(e));
    window.addEventListener('keyup', (e) => {
      if (e.key === ' ') this.spaceHeld = false;
    });
  }

  _down(e) {
    if (!this.enabled) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    const p = this._local(e);
    this.pointers.set(e.pointerId, { ...p, startX: p.x, startY: p.y, t: performance.now(), button: e.button });
    this.h.onFirstInteraction?.();

    if (this.pointers.size === 2) {
      this.drag = null;
      this.h.onAimCancel?.();
      const [a, b] = [...this.pointers.values()];
      this.gesture = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
      };
      return;
    }
    if (this.pointers.size > 2) return;

    // right/middle mouse button pans instead of aiming
    if (e.pointerType === 'mouse' && (e.button === 1 || e.button === 2)) {
      this.drag = { mode: 'pan', x: p.x, y: p.y, id: e.pointerId };
      return;
    }
    this.drag = { mode: 'aim', id: e.pointerId, sx: p.x, sy: p.y, x: p.x, y: p.y, moved: false, t: performance.now() };
    this.h.onAimStart?.({ ...this.drag });
  }

  _move(e) {
    if (!this.enabled) return;
    const rec = this.pointers.get(e.pointerId);
    if (!rec) return;
    const p = this._local(e);
    rec.x = p.x;
    rec.y = p.y;

    if (this.pointers.size >= 2 && this.gesture) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      if (this.gesture.dist > 4) {
        this.h.onZoom?.(this.gesture.dist / dist, { x: cx, y: cy });
      }
      this.h.onPan?.(cx - this.gesture.cx, cy - this.gesture.cy);
      this.gesture = { dist, cx, cy };
      return;
    }

    if (!this.drag || this.drag.id !== e.pointerId) return;
    if (this.drag.mode === 'pan') {
      this.h.onPan?.(p.x - this.drag.x, p.y - this.drag.y);
      this.drag.x = p.x;
      this.drag.y = p.y;
      return;
    }
    this.drag.x = p.x;
    this.drag.y = p.y;
    const dx = p.x - this.drag.sx;
    const dy = p.y - this.drag.sy;
    if (Math.hypot(dx, dy) > TAP_SLOP) this.drag.moved = true;
    if (this.drag.moved) this.h.onAimMove?.({ ...this.drag, dx, dy, dist: Math.hypot(dx, dy) });
  }

  _up(e, cancelled = false) {
    const rec = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.gesture = null;
    if (!rec || !this.drag || this.drag.id !== e.pointerId) return;
    const drag = this.drag;
    this.drag = null;
    if (drag.mode === 'pan') return;

    const dt = performance.now() - drag.t;
    if (!drag.moved && dt < TAP_TIME && !cancelled) {
      const now = performance.now();
      if (now - this.lastTap < DOUBLE_TAP) {
        this.lastTap = 0;
        this.h.onDoubleTap?.({ x: drag.x, y: drag.y });
      } else {
        this.lastTap = now;
        this.h.onTap?.({ x: drag.x, y: drag.y });
      }
      this.h.onAimCancel?.();
      return;
    }
    if (cancelled) { this.h.onAimCancel?.(); return; }
    const dx = drag.x - drag.sx;
    const dy = drag.y - drag.sy;
    this.h.onAimEnd?.({ ...drag, dx, dy, dist: Math.hypot(dx, dy) });
  }

  _key(e) {
    if (e.target && /^(INPUT|BUTTON|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.key !== 'Escape') {
      if (e.key !== ' ') return;
    }
    const step = e.shiftKey ? 5 : e.altKey ? 0.2 : 1;
    switch (e.key) {
      case 'ArrowLeft':  this.h.onNudge?.('angle', -step); break;
      case 'ArrowRight': this.h.onNudge?.('angle', step); break;
      case 'ArrowUp':    this.h.onNudge?.('power', step); break;
      case 'ArrowDown':  this.h.onNudge?.('power', -step); break;
      case ' ':          this.h.onFire?.(); break;
      case 'Tab':        this.h.onCycleCannon?.(); break;
      case 'v': case 'V': this.h.onToggleView?.(); break;
      case 's': case 'S': this.h.onShop?.(); break;
      case 'Escape':     this.h.onMenu?.(); break;
      default: return;
    }
    this.h.onFirstInteraction?.();
    e.preventDefault();
  }
}
