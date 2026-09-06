// Coloured triangle meshes: the terrain body and the parallax hill layers.
// Vertices carry a colour plus a "depth" term the fragment shader uses to add
// procedural grain, so a few hundred triangles still look like rock and soil.

import { Program } from './program.js';

const VERT = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in vec3 aColor;
layout(location=2) in float aDepth;
uniform vec4 uCam;
out vec3 vColor;
out float vDepth;
out vec2 vWorld;
void main() {
  gl_Position = vec4((aPos - uCam.xy) * uCam.zw, 0.0, 1.0);
  vColor = aColor;
  vDepth = aDepth;
  vWorld = aPos;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
in float vDepth;
in vec2 vWorld;
uniform float uGrain;
uniform float uAlpha;
out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void main() {
  float n = noise(vWorld * 0.11) * 0.6 + noise(vWorld * 0.43) * 0.3 + noise(vWorld * 1.7) * 0.1;
  vec3 col = vColor * (1.0 + (n - 0.5) * uGrain);
  // a touch of extra darkening deep underground
  col *= 1.0 - clamp(vDepth, 0.0, 1.0) * 0.12;
  fragColor = vec4(col, uAlpha);
}`;

let sharedProgram = null;

export class Mesh {
  constructor(ctx, { grain = 0.28, alpha = 1 } = {}) {
    const gl = ctx.gl;
    this.ctx = ctx;
    this.gl = gl;
    this.grain = grain;
    this.alpha = alpha;
    this.count = 0;
    this.capacity = 0;
    if (!sharedProgram) sharedProgram = new Program(gl, VERT, FRAG, 'mesh');
    this.program = sharedProgram;
    this.vao = gl.createVertexArray();
    this.buffer = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const stride = 6 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 20);
    gl.bindVertexArray(null);
  }

  /** @param {Float32Array} data interleaved x,y,r,g,b,depth  */
  upload(data, vertexCount) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    if (data.byteLength > this.capacity) {
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      this.capacity = data.byteLength;
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, vertexCount * 6);
    }
    this.count = vertexCount;
  }

  draw(cam) {
    if (!this.count) return;
    const gl = this.gl;
    this.ctx.setBlend('normal');
    this.program.use();
    this.program.u4f('uCam', cam[0], cam[1], cam[2], cam[3]);
    this.program.u1f('uGrain', this.grain);
    this.program.u1f('uAlpha', this.alpha);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.count);
    gl.bindVertexArray(null);
  }
}
