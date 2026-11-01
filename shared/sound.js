// Mwendo Real-Time Web Audio Synthesizer (Zero External Dependencies)
class MwendoSoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  getContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  playTone(freq, type = 'sine', duration = 0.15, gainVal = 0.1) {
    if (!this.enabled) return;
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(gainVal, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {
      console.warn('Audio tone error', e);
    }
  }

  playClick() {
    this.playTone(800, 'triangle', 0.04, 0.08);
  }

  playRadarPing() {
    this.playTone(1300, 'sine', 0.1, 0.15);
    setTimeout(() => this.playTone(1750, 'sine', 0.2, 0.12), 90);
  }

  playDispatchAlert() {
    // Two urgent double pings for incoming ride
    this.playTone(880, 'square', 0.12, 0.12);
    setTimeout(() => this.playTone(1046.5, 'square', 0.15, 0.15), 140);
    setTimeout(() => this.playTone(1318.5, 'square', 0.25, 0.18), 300);
  }

  playAcceptChime() {
    this.playTone(523.25, 'sine', 0.1, 0.15);
    setTimeout(() => this.playTone(659.25, 'sine', 0.12, 0.15), 90);
    setTimeout(() => this.playTone(783.99, 'sine', 0.2, 0.18), 180);
    setTimeout(() => this.playTone(1046.5, 'sine', 0.35, 0.2), 270);
  }

  playSliderClick() {
    this.playTone(450, 'triangle', 0.05, 0.09);
  }

  playTripCompleteFanfare() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, idx) => {
      setTimeout(() => this.playTone(f, 'sine', 0.25, 0.18), idx * 110);
    });
  }

  playCashRegister() {
    this.playTone(987.77, 'sine', 0.08, 0.15);
    setTimeout(() => this.playTone(1318.51, 'sine', 0.2, 0.18), 80);
  }

  playEmergencyAlarm() {
    for (let i = 0; i < 4; i++) {
      setTimeout(() => this.playTone(700, 'sawtooth', 0.12, 0.2), i * 220);
      setTimeout(() => this.playTone(950, 'sawtooth', 0.12, 0.2), i * 220 + 110);
    }
  }
}

// Global instance
window.mwendoSound = new MwendoSoundEngine();
window.gamanSound = window.mwendoSound;
window.aarohanSound = window.mwendoSound;
