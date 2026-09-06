// Shader program compilation with cached uniform locations.

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Failed to compile ${label} shader: ${log}`);
  }
  return sh;
}

export class Program {
  constructor(gl, vertSrc, fragSrc, label = 'program') {
    this.gl = gl;
    const vs = compile(gl, gl.VERTEX_SHADER, vertSrc, `${label} vertex`);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc, `${label} fragment`);
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      throw new Error(`Failed to link ${label}: ${log}`);
    }
    this.handle = p;
    this.uniforms = new Map();
  }

  use() { this.gl.useProgram(this.handle); return this; }

  loc(name) {
    let l = this.uniforms.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.handle, name);
      this.uniforms.set(name, l);
    }
    return l;
  }

  u1f(n, x) { this.gl.uniform1f(this.loc(n), x); return this; }
  u1i(n, x) { this.gl.uniform1i(this.loc(n), x); return this; }
  u2f(n, x, y) { this.gl.uniform2f(this.loc(n), x, y); return this; }
  u3f(n, x, y, z) { this.gl.uniform3f(this.loc(n), x, y, z); return this; }
  u4f(n, x, y, z, w) { this.gl.uniform4f(this.loc(n), x, y, z, w); return this; }
}
