// Full-screen sky: a world-anchored gradient with a sun, glow and dithering.
// Palettes give each match its own time of day.

import { Program } from '../gl/program.js';

const VERT = `#version 300 es
layout(location=0) in vec2 aPos;
uniform vec4 uCam;
out vec2 vWorld;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
  vWorld = uCam.xy + aPos / uCam.zw;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vWorld;
uniform vec3 uLow;
uniform vec3 uMid;
uniform vec3 uHigh;
uniform vec3 uSunColor;
uniform vec3 uSun;        // x, y, radius
uniform vec2 uBand;       // horizon y, sky top y
uniform float uTime;
out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(41.7, 289.1))) * 43758.5453);
}

void main() {
  float t = clamp((vWorld.y - uBand.x) / (uBand.y - uBand.x), 0.0, 1.0);
  vec3 col = t < 0.35
    ? mix(uLow, uMid, smoothstep(0.0, 0.35, t))
    : mix(uMid, uHigh, smoothstep(0.35, 1.0, t));

  // sun disc plus atmospheric glow
  float d = length((vWorld - uSun.xy) / uSun.z);
  col += uSunColor * exp(-d * d * 1.35) * 0.55;
  col += uSunColor * smoothstep(1.02, 0.94, d) * 1.25;

  // faint haze right above the horizon
  col += uMid * 0.14 * exp(-max(vWorld.y - uBand.x, 0.0) / 220.0);

  // dither to kill banding on wide gradients
  col += (hash(gl_FragCoord.xy + uTime) - 0.5) / 255.0;
  fragColor = vec4(col, 1.0);
}`;

export const SKY_PALETTES = [
  {
    name: 'clear morning',
    low: [0.71, 0.79, 0.86], mid: [0.44, 0.63, 0.86], high: [0.16, 0.32, 0.66],
    sun: [1.0, 0.94, 0.76], sunAt: [0.22, 0.86], sunR: 150,
    light: [1.0, 0.97, 0.9], ambient: [0.62, 0.68, 0.82], fog: [0.68, 0.76, 0.85],
    ground: [0.38, 0.5, 0.28],
  },
  {
    name: 'golden hour',
    low: [0.99, 0.72, 0.42], mid: [0.85, 0.47, 0.42], high: [0.29, 0.22, 0.48],
    sun: [1.0, 0.82, 0.45], sunAt: [0.14, 0.66], sunR: 190,
    light: [1.0, 0.84, 0.6], ambient: [0.6, 0.5, 0.62], fog: [0.85, 0.6, 0.5],
    ground: [0.4, 0.42, 0.24],
  },
  {
    name: 'storm front',
    low: [0.58, 0.60, 0.66], mid: [0.33, 0.37, 0.5], high: [0.11, 0.13, 0.24],
    sun: [0.80, 0.82, 0.92], sunAt: [0.76, 0.9], sunR: 130,
    light: [0.80, 0.85, 0.95], ambient: [0.42, 0.46, 0.6], fog: [0.46, 0.50, 0.6],
    ground: [0.27, 0.36, 0.26],
  },
  {
    name: 'cold dawn',
    low: [0.95, 0.78, 0.66], mid: [0.6, 0.6, 0.8], high: [0.18, 0.2, 0.42],
    sun: [1.0, 0.88, 0.72], sunAt: [0.86, 0.74], sunR: 165,
    light: [1.0, 0.9, 0.82], ambient: [0.56, 0.58, 0.72], fog: [0.76, 0.7, 0.72],
    ground: [0.33, 0.44, 0.3],
  },
];

export class Sky {
  constructor(ctx, world) {
    const gl = ctx.gl;
    this.ctx = ctx;
    this.gl = gl;
    this.world = world;
    this.program = new Program(gl, VERT, FRAG, 'sky');
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.setPalette(SKY_PALETTES[0]);
    this.time = 0;
  }

  setPalette(p) {
    this.palette = p;
    this.sunX = this.world.width * p.sunAt[0];
    this.sunY = 260 + (this.world.skyTop - 260) * p.sunAt[1];
  }

  draw(cam, dt = 0) {
    this.time = (this.time + dt * 60) % 1000;
    const gl = this.gl;
    const p = this.palette;
    this.ctx.setBlend('normal');
    this.program.use();
    this.program.u4f('uCam', cam[0], cam[1], cam[2], cam[3]);
    this.program.u3f('uLow', p.low[0], p.low[1], p.low[2]);
    this.program.u3f('uMid', p.mid[0], p.mid[1], p.mid[2]);
    this.program.u3f('uHigh', p.high[0], p.high[1], p.high[2]);
    this.program.u3f('uSunColor', p.sun[0], p.sun[1], p.sun[2]);
    this.program.u3f('uSun', this.sunX, this.sunY, p.sunR);
    this.program.u2f('uBand', 120, this.world.skyTop);
    this.program.u1f('uTime', this.time);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}
