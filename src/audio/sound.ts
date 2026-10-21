/** Escalonado de marchas para el tono del motor (m/s por marcha) y rango de tono dentro de cada una (Hz). */
const GEAR_V = 12;
const F_LOW = 190;
const F_HIGH = 520;

/**
 * Sonido con WebAudio: motor, clic de cada control, pitidos de largada y alarma.
 * El navegador no deja arrancar audio sin un gesto, así que espera al primer clic o tecla.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  private motor!: GainNode;
  private osc: OscillatorNode[] = [];
  private filt!: BiquadFilterNode;
  /** Lo último que se le pidió al motor. */
  private last = '';

  constructor(public enabled: boolean) {}

  unlock(): void {
    if (!this.enabled) return;
    if (this.ctx) { void this.ctx.resume(); return; }
    try {
      const c = new AudioContext();
      this.ctx = c;
      this.out = c.createGain();
      this.out.gain.value = 0.6;
      this.out.connect(c.destination);
      this.filt = c.createBiquadFilter();
      this.filt.type = 'lowpass';
      this.filt.frequency.value = 900;
      this.motor = c.createGain();
      this.motor.gain.value = 0;
      this.filt.connect(this.motor).connect(this.out);
      this.osc = (['sawtooth', 'square'] as OscillatorType[]).map((type) => {
        const o = c.createOscillator();
        o.type = type;
        o.frequency.value = F_LOW;
        o.connect(this.filt);
        o.start();
        return o;
      });
    } catch {
      this.ctx = null;
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on && this.ctx) this.motor.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    this.last = '';
    if (on) this.unlock();
  }

  /** Tono según velocidad y marcha simulada; volumen según potencia. Mudo si el auto está quieto. */
  engine(v: number, lev: number): void {
    const c = this.ctx;
    if (!c || !this.enabled) return;
    const f = F_LOW + (F_HIGH - F_LOW) * ((v / GEAR_V) % 1), now = c.currentTime;
    // Cada llamada agenda cuatro rampas: con el auto quieto o en pausa no hay nada nuevo que agendar.
    const key = `${f}|${lev}|${v > 0.5}`;
    if (key === this.last) return;
    this.last = key;
    this.osc[0].frequency.setTargetAtTime(f, now, 0.03);
    this.osc[1].frequency.setTargetAtTime(f * 0.5, now, 0.03);
    this.filt.frequency.setTargetAtTime(500 + lev * 350, now, 0.1);
    this.motor.gain.setTargetAtTime(v > 0.5 ? 0.05 + 0.025 * lev : 0, now, 0.15);
  }

  private blip(f: number, dur: number, vol: number, type: OscillatorType = 'square', at = 0): void {
    const c = this.ctx;
    if (!c || !this.enabled) return;
    const t = c.currentTime + at, o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.value = f;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  click(): void { this.blip(1800, 0.025, 0.12); }
  beep(high: boolean): void { this.blip(high ? 880 : 440, high ? 0.5 : 0.18, 0.18, 'sine'); }
  alarm(): void { [0, 0.18, 0.36].forEach((at, i) => this.blip(i % 2 ? 620 : 860, 0.14, 0.16, 'triangle', at)); }
}
