import type { Diagnosis, Loss } from '../sim/diagnose';
import { KNOB_LABEL, KNOB_NAMES, SEG_NAMES, f1 } from './format';

/** Pérdidas de una vuelta en texto y marcas. Sin el gráfico: lo usa main en cada vuelta sin cargar el diálogo de telemetría. */

/** Pérdidas más chicas que esto no se listan: el registro mide de a pasos de simulación. */
export const SHOW_MIN = 0.05;
/** Cuántas pérdidas con lugar se marcan en el gráfico y en el mapa, y se listan. */
export const TOP = 5;

/** Marca numerada en la vuelta: s en metros, n el número de la lista. */
export interface LossMark { s: number; n: string }
/** Dos pérdidas del mismo tramo comparten la marca: «1, 2». */
export function lossMarks(ls: Loss[]): LossMark[] {
  return [...new Set(ls.map((l) => l.s0))].map((s) => ({ s, n: ls.flatMap((l, i) => (l.s0 === s ? [i + 1] : [])).join(', ') }));
}

/** Una pérdida con su lugar, en una línea: tramo, qué tenía la consola, cuándo y cuánto costó. */
export function lossText(l: Loss): string {
  const k = l.knob ?? 'lev', v = (x = 0): string => (k === 'bal' ? `${Math.round(x)} %` : KNOB_NAMES[k][x]);
  const what = l.cause === 'bat' ? 'ERS en attack sin carga'
    : l.cause === 'fuse' ? `${KNOB_LABEL[k]} trabado por el fusible`
    : `${KNOB_LABEL[k]} en ${v(l.val)}, el tramo pide ${v(l.want)}`;
  const when = l.when === 'late' ? `tarde, ${l.m} m` : l.when === 'early' ? `antes de tiempo, ${l.m} m`
    : l.m >= l.s1 - l.s0 ? 'todo el tramo' : `${l.m} m`;
  return `${SEG_NAMES[l.ty]} a ${f1(l.s0 / 1000)} km · ${what} · ${when} · ${f1(l.sec)} s`;
}

/** Las pérdidas con lugar (un control en juego), de la más cara a la más barata. */
export const located = (d: Diagnosis): Loss[] => d.losses.filter((l) => l.knob && l.sec >= SHOW_MIN);

