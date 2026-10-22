import type { Seg } from './types';

export const PHYS = {
  DS: 4,
  A_LAT: 35,
  A_BRK: 42,
  VMAX: 92,
  LIMITER: 80 / 3.6,
  TEMP_LIMIT: 100,
  /** Qué tan rápido va el motor hacia su temperatura de régimen (por segundo). */
  TEMP_RATE: 0.08,
  /** Eficacia con el peor puntaje y castigo con el motor por encima del límite. */
  EFF_FLOOR: 0.8,
  TEMP_PENALTY: 0.94,
  /** Batería por debajo de la cual se prende la lámpara ámbar (%). */
  BAT_LOW: 15,
  /** Curvatura desde la que un tramo cuenta como curva (radio 200 m). */
  K_CURVE: 1 / 200,
  /** Margen bajo el límite de agarre a partir del cual la curva pide tracción (m/s). */
  TRACTION_GAP: 0.5,
  /** Duración mínima de un tramo a velocidad ideal (s): debajo de esto no se puede reaccionar. */
  SEG_MIN: 1,
  SEG_MIN_B: 1.2,
} as const;

/** Cómo arranca cada auto: batería (%), temperatura (°) y eficacia. */
export const START = { BAT: 80, TEMP: 80, EFF: 0.9 } as const;

export const aAcc = (v: number): number => Math.max(3, 13 - 0.11 * v);
export const TEMP_TARGET = [72, 86, 108];
export const POWER = [0.86, 0.93, 1];
export const ERS_BOOST = 0.08;

export function batteryRate(ers: number, ty: Seg): number {
  const st = ty === 's';
  if (ers === 2) return st ? -2.5 : -1;
  if (ers === 0) return st ? 0.8 : 4.5;
  return st ? -0.8 : 1;
}

export const TYRE = {
  /** Desgaste base (% por segundo). */
  WEAR: 0.05,
  /** Multiplicador en push y por mala configuración en curvas, frenadas y salidas. */
  PUSH: 1.4,
  BAD: 2.5,
  /** Agarre con la goma terminada, relativo a nueva. */
  GRIP_MIN: 0.9,
} as const;

export const FUEL = {
  /** Consumo en normal (kg por metro) y multiplicador por posición de potencia. */
  BURN: 0.0016,
  MIX: [0.8, 1, 1.15],
  /** Carga por dificultad: cuántas veces lo que se gasta yendo en normal toda la carrera. En fácil alcanza hasta en push todo el tiempo. */
  LOAD: { easy: 1.2, normal: 1.12, hard: 1.05 },
  /** Pérdida de aceleración por kg. */
  WEIGHT: 0.0008,
  /** Sin nafta: potencia que queda y velocidad tope (m/s). */
  DRY_POWER: 0.4,
  DRY_V: 25,
} as const;

export const FAULT = {
  /** Probabilidad de que salte un fusible, por segundo de carrera. */
  RATE: 1 / 150,
  /** Multiplicador con el motor por encima del límite. */
  HOT: 3,
  /** Posición del control en la que el fusible se puede rearmar, y en la que queda trabado. */
  NEUTRAL: 1,
} as const;

/** Distancia de anticipación del indicador de próximo tramo (s a la velocidad actual). */
export const LOOKAHEAD_T = 2.5;

/**
 * Giro del volante (solo se ve en difícil): ángulo de rueda por geometría de Ackermann
 * con la curvatura del trazado, multiplicado por la relación de dirección y limitado al tope.
 */
export const STEER = {
  /** Distancia entre ejes (m). */
  WHEELBASE: 3.6,
  /** Vueltas de volante por vuelta de rueda. */
  RATIO: 12,
  /** Tope de giro del volante a cada lado (rad). */
  LOCK: Math.PI / 2,
} as const;
