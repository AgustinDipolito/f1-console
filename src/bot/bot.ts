import { FUSED, balWant, fuelNeed, idx } from '../sim/car';
import { FAULT } from '../sim/physics';
import { WANTS } from '../sim/score';
import type { Car, Controls, Difficulty, Track } from '../sim/types';

/**
 * delay y jitter: metros de retraso con que lee el tramo. balErr: error del fader de frenos.
 * tempCap: temperatura a la que levanta. fix: segundos hasta rearmar un fusible.
 * fuelMix: mezcla con la que calcula si le alcanza la nafta para seguir en push.
 */
export interface BotLevel { delay: number; jitter: number; balErr: number; tempCap: number; fix: number; fuelMix: number }

export const BOT_LEVELS: Record<Difficulty, BotLevel> = {
  easy: { delay: 95, jitter: 30, balErr: 4.5, tempCap: 92, fix: 8, fuelMix: 1.15 },
  normal: { delay: 52, jitter: 25, balErr: 2.4, tempCap: 97.5, fix: 4, fuelMix: 1.1 },
  hard: { delay: 15, jitter: 8, balErr: 0.8, tempCap: 99.5, fix: 1.5, fuelMix: 1.06 },
};

/**
 * Con varios bots, cada uno rinde distinto alrededor de la dificultad: si no, van en pelotón.
 * Multiplica retraso, error y tiempo de rearme por 1 + SPREAD × el factor de su lugar. El primero va exacto
 * (la calibración corre contra él).
 */
export const SPREAD = 0.25;
const SPREAD_BY_BOT = [0, -0.5, 0.5, -1, 1, -0.25, 0.25, -0.75, 0.75, 0];

export function botLevel(d: Difficulty, i: number): BotLevel {
  const L = BOT_LEVELS[d], k = 1 + SPREAD * SPREAD_BY_BOT[i % SPREAD_BY_BOT.length];
  return k === 1 ? L : { ...L, delay: L.delay * k, jitter: L.jitter * k, balErr: L.balErr * k, fix: L.fix * k };
}

/** Batería mínima para seguir en attack y margen sobre tempCap desde el que pasa a eco. */
const BAT_MIN = 6;
const TEMP_PANIC = 6;

/** Lo que pide el tramo, o el valor por defecto si al tramo ese control no le importa. */
const want = (ty: keyof typeof WANTS, k: 'lev' | 'ers' | 'dif' | 'eb', def: number): number => WANTS[ty][k]?.[0] ?? def;

export function botControls(c: Car, tr: Track, t: number, d: Difficulty | BotLevel, i = 0, laps = 99): Controls {
  const L = typeof d === 'string' ? botLevel(d, i) : d, ph = i * 1.7;
  const look = (((c.s - (L.delay + L.jitter * Math.sin(t * 0.31 + ph))) % tr.len) + tr.len) % tr.len;
  const ty = tr.ty[idx(tr, look)];
  let lev = want(ty, 'lev', 1);
  if (c.temp > L.tempCap) lev = 1;
  if (c.temp > L.tempCap + TEMP_PANIC) lev = 0;
  if (lev === 2 && c.fuel < fuelNeed(tr, c, laps, L.fuelMix)) lev = 1;
  let ers = want(ty, 'ers', 1);
  if (ers === 2 && c.bat < BAT_MIN) ers = 1;
  const ctl: Controls = {
    lev, ers, dif: want(ty, 'dif', 1), eb: want(ty, 'eb', 1),
    bal: balWant(c) + L.balErr * Math.sin(t * 0.23 + ph), lim: false, rst: c.rstSeen.slice(),
  };
  FUSED.forEach((n, f) => {
    if (!c.fuse[f] || t - c.fuseT[f] < L.fix) return;
    ctl[n] = FAULT.NEUTRAL;
    ctl.rst[f]++;
  });
  return ctl;
}
