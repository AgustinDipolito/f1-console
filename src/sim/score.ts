import { PHYS } from './physics';
import type { Controls, Seg } from './types';

/**
 * Balance de frenos que piden las frenadas (% adelante, entero: BB va de a 1 %). Como en un auto real, con el tanque
 * lleno se frena más adelante y a medida que se gasta la nafta el balance va hacia atrás: cambia unas cuatro veces por carrera.
 */
export const BAL = { FULL: 58, EMPTY: 54 } as const;
/** Medio tanque: lo que pide una frenada cuando no se sabe cuánta nafta hay (la ayuda y los tests). */
export const IDEAL_BAL = (BAL.FULL + BAL.EMPTY) / 2;
/** Balance pedido para la fracción de nafta que queda (0 vacío, 1 lleno). */
export const idealBal = (fuelFrac: number): number =>
  Math.round(BAL.EMPTY + (BAL.FULL - BAL.EMPTY) * Math.max(0, Math.min(1, fuelFrac)));

export type Knob = 'lev' | 'ers' | 'bal' | 'dif' | 'eb';

/** Qué pide cada tramo: control → [valor ideal, distancia a la que ese término vale 0]. El balance de verdad lo da `idealBal`. */
export const WANTS: Record<Seg, Partial<Record<Knob, [number, number]>>> = {
  s: { lev: [2, 2], ers: [2, 2] },
  b: { ers: [0, 2], bal: [IDEAL_BAL, 4], eb: [2, 2] },
  c: { lev: [1, 1], ers: [1, 1], dif: [0, 2], eb: [0, 2] },
  x: { lev: [2, 2], dif: [2, 2] },
};

/** Valor que pide el tramo para un control, con el balance que corresponde a la nafta (bal). undefined si al tramo no le importa. */
export const wantOf = (ty: Seg, k: Knob, bal: number): number | undefined => {
  const w = WANTS[ty][k];
  return w && (k === 'bal' ? bal : w[0]);
};

/**
 * Qué tan lejos está cada control pedido por el tramo de su valor ideal: 0 justo, 1 en el peor caso. Attack sin carga empuja como balanced.
 * bal: balance que piden las frenadas con la nafta que queda.
 */
export function deficits(ty: Seg, c: Record<Knob, number>, bat: number, bal = IDEAL_BAL): Partial<Record<Knob, number>> {
  const out: Partial<Record<Knob, number>> = {};
  for (const [k, [ideal, span]] of Object.entries(WANTS[ty]) as [Knob, [number, number]][]) {
    const v = k === 'ers' && c.ers === 2 && bat < 1 ? 1 : c[k];
    out[k] = Math.min(1, Math.abs(v - (k === 'bal' ? bal : ideal)) / span);
  }
  return out;
}

/** Promedio de qué tan cerca está cada control pedido de su valor ideal (0 a 1). */
export function score(ty: Seg, c: Record<Knob, number>, bat: number, bal = IDEAL_BAL): number {
  const d = Object.values(deficits(ty, c, bat, bal));
  return 1 - d.reduce((a, x) => a + x, 0) / d.length;
}

/** Modo fácil: los controles que no están donde los pide el tramo, con el valor al que hay que llevarlos. */
export function suggest(ty: Seg, c: Controls, bal = IDEAL_BAL): Partial<Record<Knob, number>> {
  const out: Partial<Record<Knob, number>> = {};
  for (const k of Object.keys(WANTS[ty]) as Knob[]) {
    const ideal = wantOf(ty, k, bal) as number;
    if (c[k] !== ideal) out[k] = ideal;
  }
  return out;
}

export const efficiency = (sc: number, temp: number): number =>
  (PHYS.EFF_FLOOR + (1 - PHYS.EFF_FLOOR) * sc) * (temp >= PHYS.TEMP_LIMIT ? PHYS.TEMP_PENALTY : 1);
