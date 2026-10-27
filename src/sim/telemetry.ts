import { SIM_VER } from './physics';
import type { Controls, Ctl, CtlKey, Difficulty, Ev, EvKey, Lap, Sm } from './types';

/** Cada cuántos metros se registra la vuelta. */
export const TEL_DS = 10;

/** Cada cuántos metros se toma una muestra del estado del auto. */
export const SM_DS = 50;
/** Muestras de una vuelta de n registros. */
export const smCount = (n: number): number => Math.ceil(n / (SM_DS / TEL_DS));
export const CTL_KEYS: readonly CtlKey[] = ['lev', 'ers', 'bal', 'dif', 'eb', 'lim'];
/** Orden fijo: el índice viaja en el fantasma v2. No reordenar; lo nuevo va al final. */
export const EV_KEYS: readonly EvKey[] = ['lev', 'ers', 'bal', 'dif', 'eb', 'lim', 'rst', 'macro'];
/** Valor más alto de cada evento; lo valida el fantasma. macro = MACROS.length − 1 (lo controla un test). */
export const EV_VMAX: Record<EvKey, number> = { lev: 2, ers: 2, bal: 100, dif: 2, eb: 2, lim: 1, rst: 2, macro: 1 };

export const emptyLap = (len: number): Lap => {
  const n = Math.ceil(len / TEL_DS);
  return { t: 0, tt: new Array<number>(n).fill(NaN), v: new Array<number>(n).fill(NaN), rec: [], ev: [], sm: [] };
};

/** ponytail: tope de un evento por registro y por vuelta; lo que pase se descarta. Alcanza para tocar un control cada 10 m. */
export function pushEv(l: Lap, e: Ev): void {
  if (l.ev && l.ev.length < l.tt.length) l.ev.push(e);
}

/** Consola como la guarda la traza; sirve para Controls y para Rec. */
export const ctlOf = (k: Pick<Controls, CtlKey>): Ctl =>
  ({ lev: k.lev, ers: k.ers, bal: Math.round(k.bal), dif: k.dif, eb: k.eb, lim: k.lim ? 1 : 0 });

const isCtl = (k: EvKey): k is CtlKey => (CTL_KEYS as readonly string[]).includes(k);
const clamp = (x: number, hi: number): number => Math.max(0, Math.min(hi, x));

/** Eventos con s0 <= s < s1. */
export const evAt = (l: Lap, s0: number, s1: number): Ev[] => (l.ev ?? []).filter((e) => e.s >= s0 && e.s < s1);

/** La muestra en s o la anterior más cercana; null sin muestras. */
export function smAt(l: Lap, s: number): Sm | null {
  const sm = l.sm;
  return sm?.length ? sm[clamp(Math.floor(s / SM_DS), sm.length - 1)] : null;
}

/** Consola en s: la de la caja negra si la hay; si no, c0 más los eventos hasta s. null sin rec ni c0. */
export function controlsAt(l: Lap, s: number): Ctl | null {
  const r = l.rec?.[clamp(Math.floor(s / TEL_DS), l.tt.length - 1)];
  if (r) return ctlOf(r);
  if (!l.c0) return null;
  const c = { ...l.c0 };
  for (const e of l.ev ?? []) {
    if (e.s > s) break;
    if (isCtl(e.k)) c[e.k] = e.v;
  }
  return c;
}

// ——— Categoría del récord: dos vueltas se comparan solo si tienen la misma ———

export interface Category { track: string; ver: number; laps: number; difficulty: Difficulty }
export const categoryOf = (track: string, laps: number, difficulty: Difficulty): Category => ({ track, ver: SIM_VER, laps, difficulty });
export const categoryKey = (c: Category): string => `${c.track}|${c.ver}|${c.laps}|${c.difficulty}`;
export const sameCategory = (a: Category, b: Category): boolean => categoryKey(a) === categoryKey(b);
const DIFF_TEXT: Record<Difficulty, string> = { easy: 'fácil', normal: 'normal', hard: 'difícil' };
/** «3 vueltas · normal». */
export const categoryText = (c: Category): string => `${c.laps} ${c.laps === 1 ? 'vuelta' : 'vueltas'} · ${DIFF_TEXT[c.difficulty]}`;

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
