import type { Lap } from './types';

/** Cada cuántos metros se registra la vuelta. */
export const TEL_DS = 10;

export const emptyLap = (len: number): Lap => {
  const n = Math.ceil(len / TEL_DS);
  return { t: 0, tt: new Array<number>(n).fill(NaN), v: new Array<number>(n).fill(NaN), rec: [] };
};

/** Ancho real del registro k: el último termina en la línea, no a los 10 m. */
const width = (k: number, len: number): number => Math.max(1e-6, Math.min(TEL_DS, len - k * TEL_DS));

/** Tiempo de la vuelta `l` al pasar por la distancia `s`, interpolado entre registros. */
export function timeAt(l: Lap, s: number, len = l.tt.length * TEL_DS): number {
  const k = Math.min(l.tt.length - 1, Math.floor(s / TEL_DS)), a = l.tt[k], b = k + 1 < l.tt.length ? l.tt[k + 1] : l.t;
  return a + (b - a) * Math.min(1, (s - k * TEL_DS) / width(k, len));
}

/** Diferencia contra la vuelta de referencia en este punto: negativo es ir ganando. */
export const delta = (ref: Lap, s: number, elapsed: number, len?: number): number => elapsed - timeAt(ref, s, len);

/** Distancia a la que estaba la vuelta de referencia al mismo tiempo de vuelta: el fantasma. */
export function ghostS(ref: Lap, elapsed: number, len: number): number {
  const tt = ref.tt;
  if (elapsed >= ref.t) return len;
  let lo = 0, hi = tt.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (tt[m] <= elapsed) lo = m; else hi = m - 1; }
  const a = tt[lo], b = lo + 1 < tt.length ? tt[lo + 1] : ref.t;
  return Math.min(len, lo * TEL_DS + (b > a ? (elapsed - a) / (b - a) : 0) * width(lo, len));
}
