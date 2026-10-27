import { ghostS, timeAt } from './telemetry';
import type { Lap } from './types';

/** Ventajas que se pueden elegir (s): cuánto adelanto lleva el fantasma al arrancar. */
export const HEAD_STARTS = [3, 6, 10];

/**
 * Distancia total del fantasma (vueltas × len + s) a tiempo de carrera t: corre t + head segundos de ref, vuelta tras vuelta.
 * laps: tope en la meta.
 */
export function chaseS(ref: Lap, t: number, head: number, len: number, laps = Infinity): number {
  const te = Math.max(0, t + head), k = Math.floor(te / ref.t);
  return Math.min(laps * len, k * len + Math.max(0, ghostS(ref, te - k * ref.t, len)));
}

/**
 * Segundos detrás (positivo) o delante (negativo) del fantasma, a la distancia total dist (Race.dist; negativa en la grilla cuenta como 0)
 * y tiempo de carrera t.
 */
export function chaseDelta(ref: Lap, t: number, dist: number, head: number, len: number): number {
  const d = Math.max(0, dist), k = Math.floor(d / len), s = d - k * len;
  return t + head - (k * ref.t + (s > 0 ? timeAt(ref, s, len) : 0));
}

/**
 * Ganás si cruzás la meta antes de que el fantasma complete sus vueltas; el empate pierde.
 * ghost: tiempo de carrera del fantasma en la meta. margin: ghost − fin, negativo si perdiste.
 */
export function chaseResult(ref: Lap, fin: number, laps: number, head: number): { won: boolean; margin: number; ghost: number } {
  const ghost = laps * ref.t - head;
  return { won: fin < ghost, margin: ghost - fin, ghost };
}
