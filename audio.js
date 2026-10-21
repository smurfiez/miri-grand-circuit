// audio.js — 100% procedural Web Audio engine for "Miri Grab Delivery Rush".
// No audio files, no fetch, no network, no DOM. One shared 2s white-noise
// buffer looped by every noise layer; ~20 persistent nodes; one-shot SFX
// create transient nodes that disconnect themselves via onended.

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.muted = false;
    this.isNight = false;
    this.rainOn = false;
    this._skidActive = false;
    this._disposed = false;
    this._chirpTimer = null;
  }

  // ------------------------------------------------------------ lifecycle

  async unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        try { await this.ctx.resume(); } catch (e) { /* ignore */ }
      }
      return;
    }
    const AC = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) ||
      (typeof globalThis !== 'undefined' && globalThis.AudioContext);
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    // Master bus (mute = gain to 0)
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(ctx.destination);

    // Shared 2s white-noise buffer
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    this._buildEngine();
    this._buildSkid();
    this._buildSurf();
    this._buildRain();

    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch (e) { /* ignore */ }
    }
    this._scheduleChirps();
  }

  dispose() {
    this._disposed = true;
    if (this._chirpTimer !== null) {
      clearTimeout(this._chirpTimer);
      this._chirpTimer = null;
    }
    const ctx = this.ctx;
    this.ctx = null;
    if (!ctx) return;
    const stop = (n) => { try { if (n) n.stop(); } catch (e) { /* already stopped */ } };
    stop(this.osc1); stop(this.osc2); stop(this.sub); stop(this.engLfo);
    stop(this.surfLfo); stop(this.skidSrc); stop(this.surfSrc); stop(this.rainSrc);
    try { ctx.close(); } catch (e) { /* ignore */ }
    this.master = null;
    this.noiseBuffer = null;
  }

  // ------------------------------------------------------- graph builders

  _buildEngine() {
    const ctx = this.ctx;
    // 2 detuned saws + square sub-octave -> lowpass -> gain
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc1.frequency.value = 55;
    this.osc1.detune.value = 6;
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'sawtooth';
    this.osc2.frequency.value = 55;
    this.osc2.detune.value = -6;
    this.sub = ctx.createOscillator();
    this.sub.type = 'square';
    this.sub.frequency.value = 27.5;

    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 300;
    this.engineFilter.Q.value = 1;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.05;

    this.osc1.connect(this.engineFilter);
    this.osc2.connect(this.engineFilter);
    this.sub.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);

    // Putter LFO on detune — depth grows as speed drops
    this.engLfo = ctx.createOscillator();
    this.engLfo.type = 'sine';
    this.engLfo.frequency.value = 11;
    this.engLfoDepth = ctx.createGain();
    this.engLfoDepth.gain.value = 25;
    this.engLfo.connect(this.engLfoDepth);
    this.engLfoDepth.connect(this.osc1.detune);
    this.engLfoDepth.connect(this.osc2.detune);

    this.osc1.start(); this.osc2.start(); this.sub.start(); this.engLfo.start();
  }

  _buildSkid() {
    const ctx = this.ctx;
    this.skidSrc = ctx.createBufferSource();
    this.skidSrc.buffer = this.noiseBuffer;
    this.skidSrc.loop = true;
    this.skidFilter = ctx.createBiquadFilter();
    this.skidFilter.type = 'bandpass';
    this.skidFilter.frequency.value = 900;
    this.skidFilter.Q.value = 4;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    this.skidSrc.connect(this.skidFilter);
    this.skidFilter.connect(this.skidGain);
    this.skidGain.connect(this.master);
    this.skidSrc.start();
  }

  _buildSurf() {
    const ctx = this.ctx;
    this.surfSrc = ctx.createBufferSource();
    this.surfSrc.buffer = this.noiseBuffer;
    this.surfSrc.loop = true;
    this.surfFilter = ctx.createBiquadFilter();
    this.surfFilter.type = 'lowpass';
    this.surfFilter.frequency.value = 420;
    this.surfGain = ctx.createGain();
    this.surfGain.gain.value = 0;
    this.surfSrc.connect(this.surfFilter);
    this.surfFilter.connect(this.surfGain);
    this.surfGain.connect(this.master);

    // Slow swell LFO wired into surfGain.gain (base + LFO depth)
    this.surfLfo = ctx.createOscillator();
    this.surfLfo.type = 'sine';
    this.surfLfo.frequency.value = 0.07;
    this.surfLfoDepth = ctx.createGain();
    this.surfLfoDepth.gain.value = 0;
    this.surfLfo.connect(this.surfLfoDepth);
    this.surfLfoDepth.connect(this.surfGain.gain);
    this.surfLfo.start();
    this.surfSrc.start();
  }

  _buildRain() {
    const ctx = this.ctx;
    this.rainSrc = ctx.createBufferSource();
    this.rainSrc.buffer = this.noiseBuffer;
    this.rainSrc.loop = true;
    this.rainHP = ctx.createBiquadFilter();
    this.rainHP.type = 'highpass';
    this.rainHP.frequency.value = 1200;
    this.rainLP = ctx.createBiquadFilter();
    this.rainLP.type = 'lowpass';
    this.rainLP.frequency.value = 6000;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    this.rainSrc.connect(this.rainHP);
    this.rainHP.connect(this.rainLP);
    this.rainLP.connect(this.rainGain);
    this.rainGain.connect(this.master);
    this.rainSrc.start();
  }

  // -------------------------------------------------------- continuous bus

  setEngine(speedNorm, isDrifting) {
    if (!this.ctx || !this.engineGain) return;
    const s = clamp01(Number(speedNorm) || 0);
    const t = this.ctx.currentTime;
    const f = 55 + s * 170;
    this.osc1.frequency.setTargetAtTime(f, t, 0.06);
    this.osc2.frequency.setTargetAtTime(f, t, 0.06);
    this.sub.frequency.setTargetAtTime(f * 0.5, t, 0.06);
    this.engineFilter.frequency.setTargetAtTime(300 + s * 2200, t, 0.06);
    this.engineGain.gain.setTargetAtTime(0.05 + s * 0.11, t, 0.08);
    this.engLfoDepth.gain.setTargetAtTime(5 + (1 - s) * 25, t, 0.1);
    // setEngine's drift flag may drive the skid loop too (defensive: only
    // when the caller actually passes a boolean, so skid() alone still works)
    if (typeof isDrifting === 'boolean') this._skidActive = isDrifting;
    this._applySkid();
  }

  skid(active) {
    this._skidActive = !!active;
    this._applySkid();
  }

  _applySkid() {
    if (!this.ctx || !this.skidGain) return;
    this.skidGain.gain.setTargetAtTime(this._skidActive ? 0.12 : 0, this.ctx.currentTime, 0.06);
  }

  setRain(on) {
    this.rainOn = !!on;
    if (!this.ctx || !this.rainGain) return;
    this.rainGain.gain.setTargetAtTime(this.rainOn ? 0.09 : 0, this.ctx.currentTime, 0.5);
  }

  update(dt, playerPos, world) {
    if (!this.ctx || !this.surfGain) return;
    const oceanX = (world && typeof world.oceanX === 'number') ? world.oceanX : -430;
    const px = (playerPos && typeof playerPos.x === 'number') ? playerPos.x : 0;
    // Sea is west of oceanX; px - oceanX = distance east of the coast.
    // Loud at the shoreline, fades out over 900 units inland (closer = louder).
    const factor = clamp01(1 - (px - oceanX) / 900);
    const amp = factor * 0.125; // base + LFO depth -> swells up to factor * 0.25
    const t = this.ctx.currentTime;
    this.surfGain.gain.setTargetAtTime(amp, t, 0.25);
    this.surfLfoDepth.gain.setTargetAtTime(amp, t, 0.25);
  }

  // -------------------------------------------------------------- one-shots

  blinker() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.14, t);
    g.gain.setTargetAtTime(0, t + 0.004, 0.006);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 1.5, 0.06);
    src.onended = () => this._cleanup(src, bp, g);
  }

  cash() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    // bright ascending dings with a slight pitch-up feel
    const dings = [[1318.5, 0.0, 0.11], [1760, 0.07, 0.10], [2217.5, 0.14, 0.07]];
    for (const [f0, delay, vol] of dings) {
      const t = t0 + delay;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.linearRampToValueAtTime(f0 * 1.012, t + 0.09);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.006);
      g.gain.setTargetAtTime(0, t + 0.02, 0.1);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 0.5);
      o.onended = () => this._cleanup(o, g);
    }
    // tiny mechanical register tick
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06, t0);
    g.gain.setTargetAtTime(0, t0 + 0.004, 0.008);
    src.connect(hp); hp.connect(g); g.connect(this.master);
    src.start(t0, Math.random() * 1.5, 0.04);
    src.onended = () => this._cleanup(src, hp, g);
  }

  bump() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    // dull filtered noise burst
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    lp.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.4, t);
    ng.gain.setTargetAtTime(0, t + 0.01, 0.07);
    src.connect(lp); lp.connect(ng); ng.connect(this.master);
    src.start(t, Math.random() * 1.5, 0.3);
    src.onended = () => this._cleanup(src, lp, ng);
    // low sine drop
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.012);
    g.gain.setTargetAtTime(0, t + 0.03, 0.09);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.45);
    o.onended = () => this._cleanup(o, g);
  }

  horn() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const tones = [[440, 'square'], [554.37, 'sawtooth']];
    for (const [f0, type] of tones) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f0;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.02);
      g.gain.setValueAtTime(0.06, t + 0.26);
      g.gain.setTargetAtTime(0, t + 0.28, 0.04);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 0.42);
      o.onended = () => this._cleanup(o, g);
    }
  }

  orderPing() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const notes = [[987.77, 0.0], [783.99, 0.18]]; // ding — dong
    for (const [f0, delay] of notes) {
      const t = t0 + delay;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.13, t + 0.01);
      g.gain.setTargetAtTime(0, t + 0.03, 0.14);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 0.7);
      o.onended = () => this._cleanup(o, g);
    }
  }

  // ------------------------------------------------------- ambience critters

  setNight(on) {
    this.isNight = !!on;
    this._scheduleChirps(); // restart the chain in the new mode
  }

  _scheduleChirps() {
    if (this._chirpTimer !== null) {
      clearTimeout(this._chirpTimer);
      this._chirpTimer = null;
    }
    if (!this.ctx || this._disposed) return;
    const next = () => {
      this._chirpTimer = null;
      if (this._disposed || !this.ctx) return;
      if (this.ctx.state === 'running') {
        try {
          if (this.isNight) this._cricketBurst();
          else this._cicadaBurst();
        } catch (e) { /* ignore */ }
      }
      const [lo, hi] = this.isNight ? [0.9, 2.4] : [0.4, 1.6];
      this._chirpTimer = setTimeout(next, (lo + Math.random() * (hi - lo)) * 1000);
    };
    this._chirpTimer = setTimeout(next, 300 + Math.random() * 700);
  }

  _cicadaBurst() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 4200 + Math.random() * 800;
    const g = ctx.createGain();
    g.gain.value = 0;
    o.connect(g); g.connect(this.master);
    const dur = 0.15;
    const pulses = 6 + ((Math.random() * 4) | 0);
    const step = dur / pulses;
    let s = t;
    for (let i = 0; i < pulses; i++) {
      g.gain.setValueAtTime(0.0001, s);
      g.gain.linearRampToValueAtTime(0.03, s + step * 0.35);
      g.gain.linearRampToValueAtTime(0.0001, s + step * 0.85);
      s += step;
    }
    o.start(t); o.stop(t + dur + 0.02);
    o.onended = () => this._cleanup(o, g);
  }

  _cricketBurst() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 2200 + Math.random() * 800;
    const g = ctx.createGain();
    g.gain.value = 0;
    o.connect(g); g.connect(this.master);
    // classic 3-pulse chirp, slower rhythm than cicadas
    let s = t;
    for (let i = 0; i < 3; i++) {
      g.gain.setValueAtTime(0.0001, s);
      g.gain.linearRampToValueAtTime(0.04, s + 0.015);
      g.gain.setTargetAtTime(0, s + 0.03, 0.015);
      s += 0.11;
    }
    o.start(t); o.stop(t + 0.45);
    o.onended = () => this._cleanup(o, g);
  }

  // ----------------------------------------------------------------- helpers

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.02);
    }
    return this.muted;
  }

  _cleanup(...nodes) {
    for (const n of nodes) {
      try { if (n) n.disconnect(); } catch (e) { /* ignore */ }
    }
  }
}
