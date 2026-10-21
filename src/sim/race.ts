import { botControls } from '../bot/bot';
import { newCar, stepCar, type StepCtx } from './car';
import { stepRemote, type Remote, type Snap } from './remote';
import type { Car, Controls, Difficulty, Track } from './types';

export type Phase = 'grid' | 'count' | 'run' | 'done';
export type RaceEvent = 'green' | 'rival-done' | 'player-done' | 'fuse';
/** bots: en una sala con otros jugadores van 0. */
export interface RaceOpts { laps: number; difficulty: Difficulty; trail: boolean; bots: number; faults: boolean; seed?: number }

/** Grilla de los bots: de a dos por fila, filas cada 8 m, empezando detrás tuyo. */
export const gridSlot = (i: number): { gap: number; lat: number } => ({ gap: 14 + 8 * Math.floor(i / 2), lat: i % 2 ? -2 : 2 });
/** Bots que se nombran en el mapa: los que van en estos puestos. */
const TAGGED_TOP = 3;

export interface Standing { pos: number; name: string; me: boolean; fin: number | null; best: number | null }

const blown = (c: Car): number => c.fuse.filter(Boolean).length;

/** Carril de cada jugador remoto en la grilla: todos largan a la misma distancia que vos, uno al lado del otro. */
const REMOTE_LAT = [2, -6, 6];

export class Race {
  phase: Phase = 'grid';
  t = 0;
  cd = 0;
  green = false;
  paused = false;
  player!: Car;
  bots: Car[] = [];
  remote: Remote[] = [];

  constructor(public readonly track: Track, public opts: RaceOpts) {
    this.reset();
  }

  get cars(): Car[] { return [this.player, ...this.bots, ...this.remote.map((r) => r.car)]; }

  /** Nombre de cada auto, en el orden de `cars`. */
  names(): string[] {
    return ['Vos', ...this.bots.map((_, i) => (this.bots.length > 1 ? `Bot ${i + 1}` : 'Bot')), ...this.remote.map((r) => r.name)];
  }

  /** Etiqueta de cada auto, en el orden de `cars`: vos y los otros jugadores siempre; un bot, solo si va en el podio. */
  tags(): string[] {
    const top = new Set(this.order().slice(0, TAGGED_TOP)), n = this.names(), nb = this.bots.length;
    return this.cars.map((c, i) => (i === 0 || i > nb || top.has(c) ? n[i] : ''));
  }

  reset(): void {
    const L = this.opts.laps, seed = this.opts.seed ?? 1;
    this.player = newCar(this.track, 6, -2, L, seed);
    this.bots = Array.from({ length: Math.max(0, this.opts.bots) }, (_, i) => { const g = gridSlot(i); return newCar(this.track, g.gap, g.lat, L, seed + 101 * (i + 1)); });
    this.remote = [];
    this.phase = 'grid';
    this.t = 0;
    this.cd = 0;
    this.green = false;
    this.paused = false;
  }

  /** Último estado que mandó otro jugador. El primero lo suma a la carrera. */
  snap(id: string, name: string, s: Snap): void {
    let r = this.remote.find((x) => x.id === id);
    if (!r) {
      r = { id, name, car: newCar(this.track, 6, REMOTE_LAT[this.remote.length % REMOTE_LAT.length], this.opts.laps), snap: null };
      this.remote.push(r);
    }
    r.name = name;
    r.snap = s;
  }

  leave(id: string): void { this.remote = this.remote.filter((r) => r.id !== id); }

  start(): void {
    if (this.phase === 'done') this.reset();
    if (this.phase === 'grid') { this.phase = 'count'; this.cd = 3; }
  }

  step(dtReal: number, timeScale: number, ctl: Controls): RaceEvent[] {
    const ev: RaceEvent[] = [];
    if (this.paused) return ev;
    if (this.phase === 'count') this.countdown(dtReal, ev);
    const sd = dtReal * timeScale, n = Math.max(1, Math.ceil(sd / 0.02)), h = sd / n, o = this.opts;
    const ctx: StepCtx = { green: this.green, t: this.t, laps: o.laps, trail: o.trail, faults: o.faults };
    for (let k = 0; k < n; k++) this.substep(h, ctl, ctx, ev);
    return ev;
  }

  private countdown(dt: number, ev: RaceEvent[]): void {
    this.cd -= dt;
    if (this.cd <= 0) { this.phase = 'run'; this.green = true; this.t = 0; ev.push('green'); }
  }

  private substep(h: number, ctl: Controls, ctx: StepCtx, ev: RaceEvent[]): void {
    const o = this.opts, p = this.player;
    if (this.green) this.t += h;
    ctx.t = this.t;
    const was = this.rivalsDone(), playerWas = p.done, fuses = blown(p);
    stepCar(p, ctl, this.track, h, ctx);
    this.bots.forEach((b, i) => stepCar(b, botControls(b, this.track, this.t, o.difficulty, i, o.laps), this.track, h, ctx));
    this.remote.forEach((r) => stepRemote(r, this.track.len, this.t, h));
    if (this.rivalsDone() > was) ev.push('rival-done');
    if (blown(p) > fuses) ev.push('fuse');
    if (!playerWas && p.done && this.phase === 'run') { this.phase = 'done'; ev.push('player-done'); }
  }

  /** Bots y jugadores remotos que ya cruzaron la meta. Se cuenta sin armar listas: corre en cada subpaso. */
  private rivalsDone(): number {
    let n = 0;
    for (const b of this.bots) if (b.done) n++;
    for (const r of this.remote) if (r.car.done) n++;
    return n;
  }

  dist(c: Car): number { return c.laps * this.track.len + c.s; }

  /** Orden de carrera: primero los que terminaron, por tiempo; después el resto, por distancia. */
  order(): Car[] {
    return this.cars.slice().sort((a, b) =>
      a.done && b.done ? (a.fin as number) - (b.fin as number) : a.done ? -1 : b.done ? 1 : this.dist(b) - this.dist(a));
  }

  /** o: el orden ya calculado, para no ordenar dos veces en el mismo cuadro. */
  position(o = this.order()): number { return o.indexOf(this.player) + 1; }

  /** Segundos contra el de adelante (negativo) o, si vas primero, contra el segundo (positivo). Solo, 0. */
  gap(o = this.order()): number {
    const p = o.indexOf(this.player), r = o[p === 0 ? 1 : p - 1];
    if (!r) return 0;
    return (this.dist(this.player) - this.dist(r)) / Math.max(25, (this.player.v + r.v) / 2);
  }

  /** Tabla de resultados en orden de carrera: los que terminaron con su tiempo, el resto sin tiempo. */
  standings(): Standing[] {
    const n = this.names(), cars = this.cars;
    return this.order().map((c, i) => ({ pos: i + 1, name: n[cars.indexOf(c)], me: c === this.player, fin: c.done ? c.fin : null, best: c.best }));
  }

  result(): { won: boolean; pos: number; of: number; margin: number } | null {
    const p = this.player;
    if (!p.done || p.fin === null) return null;
    const o = this.order(), pos = o.indexOf(p) + 1, r = o[pos === 1 ? 1 : 0];
    if (!r) return { won: true, pos, of: 1, margin: 0 };
    const margin = r.fin !== null ? Math.abs(p.fin - r.fin) : Math.max(0, (this.dist(p) - this.dist(r)) / Math.max(20, r.v));
    return { won: pos === 1, pos, of: o.length, margin };
  }
}
