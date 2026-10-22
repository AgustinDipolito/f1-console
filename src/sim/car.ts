import { PHYS, START, STEER, aAcc, TEMP_TARGET, POWER, ERS_BOOST, batteryRate, TYRE, FUEL, FAULT } from './physics';
import { score, efficiency, idealBal } from './score';
import { TEL_DS, emptyLap } from './telemetry';
import type { Car, Controls, Difficulty, Rec, Seg, Track, Vec2 } from './types';

/** Generador sembrado (mulberry32): devuelve el número y el estado siguiente. */
export function rand(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

export const fuelLoad = (tr: Track, laps: number, d: Difficulty = 'normal'): number => laps * tr.len * FUEL.BURN * FUEL.LOAD[d];
/** Metros que le faltan para cerrar la carrera. */
export const remaining = (tr: Track, c: Car, laps: number): number => Math.max(0, (laps - c.laps) * tr.len - c.s);
/** Nafta que hace falta para terminar con la mezcla dada (multiplicador de FUEL.MIX). */
export const fuelNeed = (tr: Track, c: Car, laps: number, mix: number): number => remaining(tr, c, laps) * FUEL.BURN * mix;
export const grip = (tyre: number): number => TYRE.GRIP_MIN + (1 - TYRE.GRIP_MIN) * (tyre / 100);

export function newCar(tr: Track, gridGap: number, lat: number, laps = 3, seed = 1, d: Difficulty = 'normal'): Car {
  const s = tr.len - gridGap;
  return {
    s, lat, v: 0, laps: -1, lapT0: 0, last: null, best: null, done: false, fin: null, bat: START.BAT, temp: START.TEMP, eff: START.EFF, sc: 1, off: 0, ty: 's', trail: [], tq: s,
    tyre: 100, fuel: fuelLoad(tr, laps, d), fuel0: fuelLoad(tr, laps, d), fuse: [false, false, false], fuseT: [0, 0, 0], rstSeen: [0, 0, 0], rng: seed, tel: emptyLap(tr.len), hist: [],
  };
}

export const idx = (tr: Track, s: number): number => Math.floor(s / tr.ds) % tr.n;
/** Balance que piden las frenadas con la nafta que le queda al auto. */
export const balWant = (c: Car): number => idealBal(c.fuel0 > 0 ? c.fuel / c.fuel0 : 0);

/** Ángulo del volante (rad, positivo a la izquierda) para la curvatura del trazado en s. Replica al auto: nadie lo maneja. */
export function steer(tr: Track, s: number): number {
  const a = Math.atan(STEER.WHEELBASE * tr.k[idx(tr, s)]) * STEER.RATIO;
  return Math.max(-STEER.LOCK, Math.min(STEER.LOCK, a));
}

/** Próximo tramo distinto del actual y a cuántos metros empieza. */
export function ahead(tr: Track, s: number): { ty: Seg; dist: number } {
  const i = idx(tr, s), cur = tr.ty[i];
  for (let k = 1; k < tr.n; k++) {
    const j = (i + k) % tr.n;
    if (tr.ty[j] !== cur) return { ty: tr.ty[j], dist: k * tr.ds - (s - i * tr.ds) };
  }
  return { ty: cur, dist: Infinity };
}

/** Controles que tiene cada fusible, en orden. */
export const FUSED = ['ers', 'dif', 'eb'] as const;

/** Lo que de verdad llega al auto: un fusible saltado deja su sistema trabado en el centro. */
export function effective<T extends Record<(typeof FUSED)[number], number>>(ctl: T, fuse: readonly boolean[]): T {
  if (!fuse.some(Boolean)) return ctl;
  const k = { ...ctl };
  FUSED.forEach((n, f) => { if (fuse[f]) k[n] = FAULT.NEUTRAL as T[typeof n]; });
  return k;
}

/** Punto del trazado a la distancia s, corrido o metros hacia la izquierda. */
export function posAt(tr: Track, s: number, o = 0): Vec2 {
  const u = s / tr.ds, i = Math.floor(u) % tr.n, t = u - Math.floor(u);
  const a = tr.q[i], b = tr.q[(i + 1) % tr.n], h = tr.hd[i];
  return [a[0] + (b[0] - a[0]) * t - Math.sin(h) * o, a[1] + (b[1] - a[1]) * t + Math.cos(h) * o];
}

export const carPos = (tr: Track, c: Car): Vec2 => posAt(tr, c.s, c.off + c.lat);

export interface StepCtx { green: boolean; t: number; laps: number; trail: boolean; faults: boolean }

/** Cada cambio en un botón de fusible es un intento de rearme: vale si su control está en el centro. */
function rearm(c: Car, ctl: Controls): void {
  FUSED.forEach((n, f) => {
    if (ctl.rst[f] === c.rstSeen[f]) return;
    c.rstSeen[f] = ctl.rst[f];
    if (c.fuse[f] && ctl[n] === FAULT.NEUTRAL) c.fuse[f] = false;
  });
}

/** Sorteo de falla del paso: más probable con el motor pasado de temperatura. */
function rollFault(c: Car, t: number, dt: number): void {
  let r: number;
  [r, c.rng] = rand(c.rng);
  if (r >= FAULT.RATE * (c.temp >= PHYS.TEMP_LIMIT ? FAULT.HOT : 1) * dt) return;
  [r, c.rng] = rand(c.rng);
  const f = Math.floor(r * FUSED.length);
  if (!c.fuse[f]) { c.fuse[f] = true; c.fuseT[f] = t; }
}

/** Velocidad a la que va el auto: la del perfil por la eficacia, con gomas, nafta y limitador. En la grilla, 0. */
function targetSpeed(c: Car, lim: boolean, v: number, ty: Seg, green: boolean): number {
  if (!green) return 0;
  let tg = v;
  if (ty !== 's') tg *= Math.sqrt(grip(c.tyre));
  if (c.fuel <= 0) tg = Math.min(tg, FUEL.DRY_V);
  if (lim) tg = Math.min(tg, PHYS.LIMITER);
  return tg;
}

/** Multiplicador de aceleración: posición de potencia, empuje del ERS, falta de nafta y peso de la nafta. */
function power(c: Car, lev: number, ers: number): number {
  const boost = ers === 2 && c.bat >= 1 ? ERS_BOOST : 0;
  return (POWER[lev] + boost) * (c.fuel <= 0 ? FUEL.DRY_POWER : 1) * (1 - c.fuel * FUEL.WEIGHT);
}

function approach(c: Car, tg: number, pw: number, dt: number): void {
  const dv = tg - c.v;
  c.v += dv > 0 ? Math.min(dv, aAcc(c.v) * pw * dt) : Math.max(dv, -PHYS.A_BRK * dt);
}

function wearTyres(c: Car, lev: number, ty: Seg, sc: number, dt: number): void {
  const push = lev === 2 ? TYRE.PUSH : 1, bad = ty === 's' ? 1 : 1 + TYRE.BAD * (1 - sc);
  c.tyre = Math.max(0, c.tyre - TYRE.WEAR * push * bad * dt);
}

function closeLap(c: Car, lt: number): void {
  c.last = lt;
  if (c.best === null || lt < c.best) c.best = lt;
  c.tel.t = lt;
  c.hist.push(c.tel);
}

function crossLine(c: Car, tr: Track, x: StepCtx): void {
  c.s -= tr.len;
  c.laps++;
  if (c.laps >= 1 && !c.done) closeLap(c, x.t - c.lapT0);
  c.tel = emptyLap(tr.len);
  c.lapT0 = x.t;
  if (c.laps >= x.laps && !c.done) { c.done = true; c.fin = x.t; }
}

const blackBox = (c: Car, ctl: Controls): Rec => ({
  lev: ctl.lev, ers: ctl.ers, bal: ctl.bal, dif: ctl.dif, eb: ctl.eb, lim: ctl.lim,
  fuse: c.fuse.slice(), bat: c.bat, temp: c.temp, tyre: c.tyre, fuel: c.fuel, bw: balWant(c),
});

/** Llena el registro actual y cualquiera que se haya salteado en este paso (el último puede medir menos que un paso). */
function record(c: Car, ctl: Controls, t: number): void {
  for (let tk = Math.floor(c.s / TEL_DS); tk >= 0 && Number.isNaN(c.tel.tt[tk]); tk--) {
    c.tel.tt[tk] = t - c.lapT0;
    c.tel.v[tk] = c.v;
    if (c.tel.rec) c.tel.rec[tk] = blackBox(c, ctl);
  }
}

/** Como la batería, el motor no cambia en la grilla: la largada no depende de cuánto se esperó. */
function heatAndCharge(c: Car, lev: number, ers: number, ty: Seg, dt: number): void {
  c.temp += (TEMP_TARGET[lev] - c.temp) * PHYS.TEMP_RATE * dt;
  if (!c.fuse[0]) c.bat = Math.max(0, Math.min(100, c.bat + batteryRate(ers, ty) * dt));
}

/** En curva y salida, cuanto peor el puntaje, más se abre el auto hacia afuera. */
function drift(c: Car, k: number, ty: Seg, sc: number, dt: number): void {
  const ot = ty === 'c' || ty === 'x' ? (1 - sc) * 6 * -Math.sign(k) : 0;
  c.off += (ot - c.off) * Math.min(1, dt * 1.5);
}

/** Un punto de la estela cada 10 m, con el puntaje que llevaba. */
function dropTrail(c: Car, tr: Track, sc: number): void {
  if ((c.s - c.tq + tr.len) % tr.len < 10) return;
  c.tq = c.s;
  const p = carPos(tr, c);
  c.trail.push({ x: p[0], y: p[1], q: sc });
  if (c.trail.length > tr.len / 10) c.trail.shift();
}

export function stepCar(c: Car, ctl: Controls, tr: Track, dt: number, x: StepCtx): void {
  rearm(c, ctl);
  const run = x.green && !c.done;
  if (run && x.faults) rollFault(c, x.t, dt);
  const k = effective(ctl, c.fuse), i = idx(tr, c.s), ty = tr.ty[i], sc = score(ty, k, c.bat, balWant(c)), ef = efficiency(sc, c.temp);
  approach(c, targetSpeed(c, ctl.lim, tr.v[i] * ef, ty, x.green), power(c, ctl.lev, k.ers), dt);
  c.s += c.v * dt;
  c.fuel = Math.max(0, c.fuel - c.v * dt * FUEL.BURN * FUEL.MIX[ctl.lev]);
  if (run) wearTyres(c, ctl.lev, ty, sc, dt);
  if (c.s >= tr.len) crossLine(c, tr, x);
  if (c.laps >= 0) record(c, ctl, x.t);
  if (x.green) heatAndCharge(c, ctl.lev, k.ers, ty, dt);
  c.sc = sc;
  c.ty = ty;
  c.eff += (ef - c.eff) * Math.min(1, dt * 2);
  drift(c, tr.k[i], ty, sc, dt);
  if (x.trail && x.green) dropTrail(c, tr, sc);
}
