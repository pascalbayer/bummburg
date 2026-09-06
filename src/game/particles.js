// Struct-of-arrays particle pool. Everything smoky, sparky or crumbly in the
// game is one of these; the pool never allocates during play.

const NORMAL = 0, ADDITIVE = 1;

export class Particles {
  constructor(sprites, max = 3000) {
    this.max = max;
    this.n = 0;
    this.sprites = sprites;
    const f = () => new Float32Array(max);
    this.x = f(); this.y = f(); this.vx = f(); this.vy = f();
    this.life = f(); this.maxLife = f();
    this.size = f(); this.sizeEnd = f();
    this.rot = f(); this.vrot = f();
    this.r = f(); this.g = f(); this.b = f(); this.a = f();
    this.drag = f(); this.grav = f();
    this.blend = new Uint8Array(max);
    this.spr = new Uint8Array(max);
    this.flags = new Uint8Array(max);        // 1 = collides with ground
    this.spriteNames = ['soft', 'spark', 'rubble', 'ring', 'dot', 'ball', 'grass'];
    this.spriteRefs = this.spriteNames.map((n) => sprites[n]);
    // hoisted so the hot removal path allocates nothing
    this._floatArrays = [this.x, this.y, this.vx, this.vy, this.life, this.maxLife,
      this.size, this.sizeEnd, this.rot, this.vrot, this.r, this.g, this.b, this.a,
      this.drag, this.grav];
  }

  clear() { this.n = 0; }

  spawn(o) {
    let i;
    if (this.n < this.max) i = this.n++;
    else i = (Math.random() * this.max) | 0;    // recycle the unlucky one
    this.x[i] = o.x; this.y[i] = o.y;
    this.vx[i] = o.vx || 0; this.vy[i] = o.vy || 0;
    this.maxLife[i] = this.life[i] = o.life;
    this.size[i] = o.size;
    this.sizeEnd[i] = o.sizeEnd ?? o.size;
    this.rot[i] = o.rot || 0;
    this.vrot[i] = o.vrot || 0;
    this.r[i] = o.r ?? 1; this.g[i] = o.g ?? 1; this.b[i] = o.b ?? 1; this.a[i] = o.a ?? 1;
    this.drag[i] = o.drag ?? 0.6;
    this.grav[i] = o.grav ?? 0;
    this.blend[i] = o.additive ? ADDITIVE : NORMAL;
    this.spr[i] = this.spriteNames.indexOf(o.sprite || 'soft');
    this.flags[i] = o.collide ? 1 : 0;
  }

  update(dt, terrain) {
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this._swapRemove(i);
        i--;
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vx[i] *= d;
      this.vy[i] = this.vy[i] * d - this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.rot[i] += this.vrot[i] * dt;
      if (this.flags[i] && terrain) {
        const h = terrain.heightAt(this.x[i]);
        if (this.y[i] < h) {
          this.y[i] = h;
          this.vy[i] = -this.vy[i] * 0.32;
          this.vx[i] *= 0.62;
          this.vrot[i] *= 0.5;
          if (Math.abs(this.vy[i]) < 22) {
            this.vy[i] = 0;
            this.vrot[i] = 0;
            this.flags[i] = 0;
            this.life[i] = Math.min(this.life[i], 1.1);
          }
        }
      }
    }
  }

  _swapRemove(i) {
    const last = --this.n;
    if (i === last) return;
    const arrays = this._floatArrays;
    for (let k = 0; k < arrays.length; k++) arrays[k][i] = arrays[k][last];
    this.blend[i] = this.blend[last];
    this.spr[i] = this.spr[last];
    this.flags[i] = this.flags[last];
  }

  draw(batch) {
    for (const pass of [NORMAL, ADDITIVE]) {
      batch.setBlend(pass === ADDITIVE ? 'add' : 'normal');
      for (let i = 0; i < this.n; i++) {
        if (this.blend[i] !== pass) continue;
        const t = 1 - this.life[i] / this.maxLife[i];
        const s = this.size[i] + (this.sizeEnd[i] - this.size[i]) * t;
        // fade in briefly, then out
        const fade = t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;
        batch.draw(this.spriteRefs[this.spr[i]], this.x[i], this.y[i], s, s, this.rot[i],
          this.r[i], this.g[i], this.b[i], this.a[i] * Math.max(0, fade));
      }
    }
    batch.setBlend('normal');
  }
}
