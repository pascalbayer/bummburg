// Instanced quad batch. Everything that is not the terrain mesh or the sky is
// drawn through here: castle blocks, cannons, the projectile, particles,
// trajectory dots, scenery. One atlas texture, one draw call per state change.

import { Program } from './program.js';

const VERT = `#version 300 es
layout(location=0) in vec2 aCorner;    // unit quad 0..1
layout(location=1) in vec4 aPosSize;   // xy = centre, zw = half size
layout(location=2) in vec4 aUV;        // u0 v0 u1 v1
layout(location=3) in vec4 aColor;
layout(location=4) in float aRot;
uniform vec4 uCam;                     // xy = camera centre, zw = 2/viewSize
out vec2 vUV;
out vec4 vColor;
void main() {
  vec2 local = (aCorner - 0.5) * 2.0 * aPosSize.zw;
  float c = cos(aRot), s = sin(aRot);
  vec2 world = aPosSize.xy + vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  gl_Position = vec4((world - uCam.xy) * uCam.zw, 0.0, 1.0);
  vUV = mix(aUV.xy, aUV.zw, aCorner);
  vColor = aColor;
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec2 vUV;
in vec4 vColor;
uniform sampler2D uTex;
out vec4 fragColor;
void main() {
  vec4 t = texture(uTex, vUV);
  vec4 c = t * vColor;
  if (c.a < 0.004) discard;
  fragColor = c;
}`;

const FLOATS_PER_INSTANCE = 13;

export class QuadBatch {
  constructor(ctx, texture) {
    const gl = ctx.gl;
    this.ctx = ctx;
    this.gl = gl;
    this.texture = texture;
    this.program = new Program(gl, VERT, FRAG, 'quad');
    this.capacity = 4096;
    this.data = new Float32Array(this.capacity * FLOATS_PER_INSTANCE);
    this.count = 0;
    this.drawCalls = 0;
    this.cam = new Float32Array([0, 0, 1, 1]);
    this._blend = 'normal';

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    const corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const stride = FLOATS_PER_INSTANCE * 4;
    const attribs = [[1, 4, 0], [2, 4, 16], [3, 4, 32], [4, 1, 48]];
    for (const [loc, size, offset] of attribs) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
  }

  /** Camera uniform: centre x/y and 2/viewWidth, 2/viewHeight. */
  setCamera(cx, cy, invHalfW, invHalfH) {
    const c = this.cam;
    if (c[0] === cx && c[1] === cy && c[2] === invHalfW && c[3] === invHalfH) return;
    this.flush();
    c[0] = cx; c[1] = cy; c[2] = invHalfW; c[3] = invHalfH;
  }

  setBlend(mode) {
    if (mode === this._blend) return;
    this.flush();
    this._blend = mode;
  }

  _grow() {
    this.flush();
    if (this.capacity >= 65536) return;
    this.capacity *= 2;
    this.data = new Float32Array(this.capacity * FLOATS_PER_INSTANCE);
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
  }

  /**
   * @param {{u0:number,v0:number,u1:number,v1:number}} sprite
   * Width/height are full extents in world units; rot in radians.
   */
  draw(sprite, x, y, w, h, rot = 0, r = 1, g = 1, b = 1, a = 1) {
    if (this.count >= this.capacity) this._grow();
    const d = this.data;
    let i = this.count * FLOATS_PER_INSTANCE;
    d[i++] = x; d[i++] = y; d[i++] = w * 0.5; d[i++] = h * 0.5;
    d[i++] = sprite.u0; d[i++] = sprite.v0; d[i++] = sprite.u1; d[i++] = sprite.v1;
    d[i++] = r; d[i++] = g; d[i++] = b; d[i++] = a;
    d[i] = rot;
    this.count++;
  }

  /** A quad stretched between two points — used for beams, ropes, aim lines. */
  drawLine(sprite, x0, y0, x1, y1, thickness, r, g, b, a) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) return;
    this.draw(sprite, (x0 + x1) * 0.5, (y0 + y1) * 0.5, len, thickness, Math.atan2(dy, dx), r, g, b, a);
  }

  flush() {
    if (this.count === 0) return;
    const gl = this.gl;
    this.ctx.setBlend(this._blend);
    this.program.use();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * FLOATS_PER_INSTANCE);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    this.program.u1i('uTex', 0);
    const c = this.cam;
    this.program.u4f('uCam', c[0], c[1], c[2], c[3]);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    gl.bindVertexArray(null);
    this.count = 0;
    this.drawCalls++;
  }
}
