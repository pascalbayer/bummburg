// Procedural sound: no audio files, everything is synthesised on demand.
// The context is created on the first user gesture to respect autoplay rules.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.noise = null;
  }

  /** Call from a pointerdown/keydown handler. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch { return; }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = -14;
      this.comp.ratio.value = 8;
      this.master.connect(this.comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.55 : 0;
  }

  get ok() { return this.ctx && this.enabled; }
  get t() { return this.ctx.currentTime; }

  _noiseSource(playbackRate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.playbackRate.value = playbackRate;
    return s;
  }

  _env(gain, t0, attack, decay, peak = 1) {
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  /** Cannon firing — a filtered noise crack over a low thump. */
  boom(power = 60) {
    if (!this.ok) return;
    const t0 = this.t;
    const p = 0.55 + power / 160;
    const src = this._noiseSource(1);
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = 1.2;
    filt.frequency.setValueAtTime(2600, t0);
    filt.frequency.exponentialRampToValueAtTime(120, t0 + 0.45);
    const g = this.ctx.createGain();
    this._env(g, t0, 0.004, 0.55 * p, 0.85 * p);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + 0.9);

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140 * p, t0);
    osc.frequency.exponentialRampToValueAtTime(38, t0 + 0.35);
    const og = this.ctx.createGain();
    this._env(og, t0, 0.006, 0.42, 0.9 * p);
    osc.connect(og).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 0.7);
  }

  /** Impact: hard = stone, soft = dirt. */
  impact(hard = true, scale = 1) {
    if (!this.ok) return;
    const t0 = this.t;
    const src = this._noiseSource(hard ? 1.5 : 0.7);
    const filt = this.ctx.createBiquadFilter();
    filt.type = hard ? 'bandpass' : 'lowpass';
    filt.frequency.setValueAtTime(hard ? 1500 : 420, t0);
    filt.frequency.exponentialRampToValueAtTime(hard ? 320 : 110, t0 + 0.3);
    filt.Q.value = hard ? 1.6 : 0.7;
    const g = this.ctx.createGain();
    this._env(g, t0, 0.003, hard ? 0.3 : 0.42, (hard ? 0.6 : 0.5) * scale);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + 0.8);

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(hard ? 190 : 96, t0);
    osc.frequency.exponentialRampToValueAtTime(hard ? 60 : 40, t0 + 0.22);
    const og = this.ctx.createGain();
    this._env(og, t0, 0.005, 0.26, 0.5 * scale);
    osc.connect(og).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 0.5);
  }

  /** Masonry falling apart. */
  crumble(scale = 1) {
    if (!this.ok) return;
    const t0 = this.t;
    for (let i = 0; i < 5; i++) {
      const at = t0 + Math.random() * 0.5;
      const src = this._noiseSource(0.8 + Math.random());
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'bandpass';
      filt.frequency.value = 500 + Math.random() * 1800;
      filt.Q.value = 2.5;
      const g = this.ctx.createGain();
      this._env(g, at, 0.004, 0.12 + Math.random() * 0.2, 0.3 * scale);
      src.connect(filt).connect(g).connect(this.master);
      src.start(at);
      src.stop(at + 0.5);
    }
  }

  /** The powder magazine going up. */
  bigBlast() {
    if (!this.ok) return;
    this.boom(100);
    const t0 = this.t;
    const src = this._noiseSource(0.55);
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(1400, t0);
    filt.frequency.exponentialRampToValueAtTime(70, t0 + 1.5);
    const g = this.ctx.createGain();
    this._env(g, t0 + 0.02, 0.01, 1.6, 1.0);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + 2.0);
    this.crumble(1.4);
  }

  /** Whistling shot; returns a handle whose pitch follows the ball. */
  whistle() {
    if (!this.ok) return { update() {}, stop() {} };
    const t0 = this.t;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(760, t0);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.10, t0 + 0.14);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    let stopped = false;
    return {
      update: (v) => {
        if (stopped || !this.ctx) return;
        const f = 300 + Math.max(0, Math.min(1, v)) * 900;
        osc.frequency.setTargetAtTime(f, this.t, 0.08);
      },
      stop: () => {
        if (stopped || !this.ctx) return;
        stopped = true;
        const t = this.t;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        osc.stop(t + 0.2);
      },
    };
  }

  click(high = false) {
    if (!this.ok) return;
    const t0 = this.t;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(high ? 880 : 520, t0);
    const g = this.ctx.createGain();
    this._env(g, t0, 0.002, 0.05, 0.10);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 0.1);
  }

  coins() {
    if (!this.ok) return;
    const t0 = this.t;
    [1320, 1760, 2093].forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const g = this.ctx.createGain();
      this._env(g, t0 + i * 0.045, 0.003, 0.16, 0.12);
      osc.connect(g).connect(this.master);
      osc.start(t0 + i * 0.045);
      osc.stop(t0 + i * 0.045 + 0.3);
    });
  }

  fanfare(win = true) {
    if (!this.ok) return;
    const t0 = this.t + 0.05;
    const notes = win ? [392, 523, 659, 784, 1047] : [392, 349, 294, 220];
    notes.forEach((f, i) => {
      const at = t0 + i * 0.16;
      for (const [mult, gainScale, type] of [[1, 0.22, 'triangle'], [2, 0.07, 'sine']]) {
        const osc = this.ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = f * mult;
        const g = this.ctx.createGain();
        this._env(g, at, 0.02, i === notes.length - 1 ? 0.9 : 0.28, gainScale);
        osc.connect(g).connect(this.master);
        osc.start(at);
        osc.stop(at + 1.2);
      }
    });
  }
}
