import { START } from '../sim/physics';
import { BAL, type Knob } from '../sim/score';
import type { Controls, Seg } from '../sim/types';
import { KNOB_LABEL, KNOB_NAMES } from '../ui/format';

/** Estado de la consola y lo que muestra. Sin three: lo leen main y la ayuda sin cargar el volante 3D. */
export interface PanelState extends Controls { grd: boolean }
/** Lo que muestran pantalla, lámparas y volante. Todo sale del auto y del trazado. */
export interface GaugeSource {
  bat: number; temp: number; tyre: number; fuel: number; fuelMax: number; fuelLaps: number;
  fuse: boolean[]; ty: Seg; next: Seg; dist: number; soon: boolean;
  /** Modo fácil: controles a mover y a qué valor. */
  hint: Partial<Record<Knob, number>>;
  /** Giro del volante (rad, positivo a la izquierda). Solo en difícil; si no, 0. */
  steer: number;
  /** Cuánto falta para el tramo siguiente dentro de la anticipación: 0 recién avisado, 1 en el cambio. */
  lead: number;
  /** Segundos reales que faltan para el tramo siguiente, con el indicador prendido; si no, 0. */
  eta: number;
  /** Puntaje de la consola en el tramo actual y si el auto está corriendo. */
  sc: number;
  live: boolean;
  /** Delta contra la mejor vuelta (s, negativo es ir ganando); null sin referencia. */
  delta: number | null;
  /** Balance de frenos que piden las frenadas con la nafta que queda (%). */
  bal: number;
}
/** Efectos del volante que se prenden y apagan en ajustes. */
export interface ConsoleFx { leds: boolean; aim: boolean; flash: boolean; delta: boolean }
export const defaultPanel = (): PanelState => ({ lev: 1, ers: 1, bal: 56, lim: false, grd: false, dif: 1, eb: 1, rst: [0, 0, 0] });
export const idleGauges = (): GaugeSource => ({
  bat: START.BAT, temp: START.TEMP, tyre: 100, fuel: 1, fuelMax: 1, fuelLaps: 0, fuse: [false, false, false],
  ty: 's', next: 's', dist: Infinity, soon: false, hint: {}, steer: 0, lead: 0, eta: 0, sc: 1, live: false, delta: null, bal: BAL.FULL,
});

/** Un atajo de la consola: lleva potencia y ERS de una sola vez. El orden es el de los eventos de la traza (índice = `Ev.v` de 'macro'). */
export interface Macro { id: 'ataque' | 'conserva'; name: string; set: Partial<Pick<Controls, 'lev' | 'ers'>>; key: string }
export const MACROS: Macro[] = [
  { id: 'ataque', name: 'Ataque', set: { lev: 2, ers: 2 }, key: 'z' },
  { id: 'conserva', name: 'Ahorro', set: { lev: 0, ers: 0 }, key: 'x' },
];
const macroKeys = (m: Macro): ('lev' | 'ers')[] => Object.keys(m.set) as ('lev' | 'ers')[];
/** La consola ya está como la deja el macro. */
export const macroActive = (p: Controls, m: Macro): boolean => macroKeys(m).every((k) => p[k] === m.set[k]);
/** Lleva potencia y ERS a lo del macro sobre el PanelState compartido y devuelve siempre el mismo texto: aplicarlo dos veces da lo mismo. */
export function applyMacro(p: PanelState, m: Macro): string {
  macroKeys(m).forEach((k) => { p[k] = m.set[k] as number; });
  return `${m.name}: ${macroKeys(m).map((k) => `${KNOB_LABEL[k]} ${KNOB_NAMES[k][m.set[k] as number]}`).join(', ')}`;
}

export const DELTA_COLORS = { gain: 0x1d9e75, lose: 0xe24b4a };
/** LEDs de cambio por grupo: recta, frenada, curva, salida. */
export const LED_GROUPS = [4, 4, 4, 3];
/** Lámparas de alerta: batería, motor, limitador y falla. LEDs de tramo en azul. */
export const ALERT_COLORS = [0xef9f27, 0xe24b4a, 0x1d9e75, 0xe24b4a];
export const LED_COLOR = 0x378add;

export * from './livery';
