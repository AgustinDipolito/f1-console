/** Tramos: recta, frenada, curva y salida de curva (pide tracción). */
export type Seg = 's' | 'b' | 'c' | 'x';
export type Vec2 = [number, number];
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface Track {
  id: string;
  name: string;
  q: Vec2[];
  n: number;
  len: number;
  ds: number;
  k: number[];
  v: number[];
  ty: Seg[];
  hd: number[];
  idealLap: number;
}

export interface Controls {
  lev: number;
  ers: number;
  bal: number;
  lim: boolean;
  /** Diferencial: 0 abierto, 1 medio, 2 bloqueado. */
  dif: number;
  /** Freno motor: 0 bajo, 1 medio, 2 alto. */
  eb: number;
  /** Pulsaciones de cada fusible (ERS, diferencial, freno motor). Cada cambio es un intento de rearme. */
  rst: number[];
}

export interface TrailPt { x: number; y: number; q: number }

/** Caja negra: lo que pedía la consola y el estado del auto al pasar por un registro. */
export interface Rec {
  lev: number; ers: number; bal: number; dif: number; eb: number; lim: boolean;
  fuse: boolean[]; bat: number; temp: number; tyre: number; fuel: number;
  /** Balance que pedían las frenadas con la nafta de ese momento. */
  bw: number;
}

/** Una vuelta registrada cada TEL_DS metros: tiempo desde la línea y velocidad. rec solo existe en las vueltas corridas en esta sesión. */
export interface Lap { t: number; tt: number[]; v: number[]; rec?: Rec[] }

export interface Car {
  s: number;
  lat: number;
  v: number;
  laps: number;
  lapT0: number;
  last: number | null;
  best: number | null;
  done: boolean;
  fin: number | null;
  bat: number;
  temp: number;
  eff: number;
  sc: number;
  off: number;
  ty: Seg;
  trail: TrailPt[];
  tq: number;
  /** Banda de rodamiento restante (%). */
  tyre: number;
  /** Nafta (kg) y la carga con que largó. */
  fuel: number;
  fuel0: number;
  /** Fusibles saltados (ERS, diferencial, freno motor) y cuándo saltaron. */
  fuse: boolean[];
  fuseT: number[];
  rstSeen: number[];
  rng: number;
  /** Vuelta en curso y vueltas cerradas. */
  tel: Lap;
  hist: Lap[];
}
