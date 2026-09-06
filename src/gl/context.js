// WebGL2 context creation plus device-pixel-ratio aware sizing.

export class GLContext {
  constructor(canvas) {
    /** @type {HTMLCanvasElement} */
    this.canvas = canvas;
    const opts = {
      alpha: false,
      antialias: true,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
      failIfMajorPerformanceCaveat: false,
    };
    const gl = canvas.getContext('webgl2', opts);
    if (!gl) throw new Error('WebGL 2 is not available in this browser.');
    /** @type {WebGL2RenderingContext} */
    this.gl = gl;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.maxDpr = 2;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }

  /** Resize the drawing buffer to match the CSS box. Returns true when it changed. */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width || window.innerWidth));
    const cssH = Math.max(1, Math.round(rect.height || window.innerHeight));
    // Big phone screens with dpr 3+ cost a lot of fill rate for no visible gain.
    const dpr = Math.min(window.devicePixelRatio || 1, cssW * cssH > 900_000 ? 1.75 : this.maxDpr);
    const w = Math.round(cssW * dpr);
    const h = Math.round(cssH * dpr);
    if (w === this.canvas.width && h === this.canvas.height) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    this.width = w;
    this.height = h;
    this.cssWidth = cssW;
    this.cssHeight = cssH;
    this.dpr = dpr;
    this.gl.viewport(0, 0, w, h);
    return true;
  }

  get aspect() { return this.width / this.height; }

  clear(r, g, b) {
    const gl = this.gl;
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Alpha blending modes used by the sprite batch. */
  setBlend(mode) {
    const gl = this.gl;
    if (mode === this._blend) return;
    this._blend = mode;
    if (mode === 'add') gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE);
    else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
}
