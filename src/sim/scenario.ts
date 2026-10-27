import { PHYS, SIM_VER } from './physics';
import type { Race, RaceOpts } from './race';
import type { Difficulty } from './types';

/** Condiciones de largada. La nafta es una fracción de la carga normal de la dificultad. */
export interface StartState { bat?: number; temp?: number; tyre?: number; fuel?: number }

/** Falla programada: salta una vez, a todos los autos, al cruzar el punto. */
export interface ScriptedFault {
  /** Vuelta de carrera, desde 1. */
  lap: number;
  /** Metros desde la línea. */
  s: number;
  /** Índice en FUSED. */
  f: number;
}

/** Qué hay que cumplir para ganar el desafío. */
export type Criterion = { kind: 'ahead' } | { kind: 'cool'; max: number } | { kind: 'notDry' } | { kind: 'tyreAbove'; min: number };

export interface Scenario {
  id: string; ver: number;
  /** 16 letras o menos. */
  title: string; context: string; goal: string;
  track: string; laps: number; difficulty: Difficulty; bots: number; faults: boolean; seed: number;
  start: StartState; fault?: ScriptedFault;
  /** Si los macros de la consola están disponibles. */
  macros: boolean;
  win: Criterion[];
}

export interface Outcome {
  ok: boolean;
  /** Una por criterio, en el orden de sc.win. */
  lines: string[];
  /** El primer criterio que no se cumplió: el mismo objeto de sc.win. */
  failed: Criterion | null;
}

// Números de cada desafío. Los textos salen de acá, así lo que dicen es lo que se juega.
// Medidos con tests/scenario.test.ts (normal, 1 bot, sin fallas al azar) contra el jugador ideal y contra la consola fija
// de tests/models.ts. «Ventaja» es la diferencia exacta de tiempos con el bot, positiva si ganás.

/**
 * ar-1952 (Gálvez), 1 vuelta. Con 0,95 de la carga normal (1,064 veces lo que se gasta en normal) alcanza yendo en normal.
 * Ideal: ventaja +5,3 s y llega con 0,03 kg (el ideal gasta toda la holgura en push y llega justo).
 * Consola fija: ventaja −0,5 s y llega con 0,43 kg. En Mónaco (mc-1929) la consola fija empataba con el bot (+0,0 s a 0,92; −0,3 s a 0,95): por eso Gálvez.
 */
const LAST_START: StartState = { bat: 20, fuel: 0.95 };
/**
 * at-1969, 2 vueltas.
 * Ideal: ventaja +6,8 s y motor a 99,93°. Consola fija: −2,6 s (el motor no pasa de 95°: la pierde el tiempo).
 */
const HOT_START: StartState = { temp: 95 };
const HOT_LAPS = 2;
const HOT_MAX = PHYS.TEMP_LIMIT;
/**
 * ca-1978, 2 vueltas: salta el fusible del ERS (índice 0) a 1500 m de la vuelta 1.
 * Ideal (rearma a los 0,5 s): ventaja +4,9 s. Consola fija: −5,0 s.
 */
const FUSE_AT = { lap: 1, s: 1500, f: 0 };
/**
 * hu-1986, 3 vueltas.
 * Medido con gomas al 30 %: el ideal gana por 17,6 s y termina con 15 %; la consola fija pierde por 2,4 s y termina con 11,8 %, debajo del piso.
 * Con 35 % la fija terminaba en 16,8 % y el piso no jugaba.
 */
const TYRE_START: StartState = { tyre: 30 };
const TYRE_LAPS = 3;
const TYRE_MIN = 12;

const base = { ver: SIM_VER, difficulty: 'normal', bots: 1, faults: false } as const;

export const CHALLENGES: Scenario[] = [
  {
    ...base, id: 'ultima-vuelta', title: 'La última vuelta', track: 'ar-1952', laps: 1, seed: 11, start: LAST_START, macros: true,
    context: `Queda una vuelta, con ${LAST_START.bat} % de batería y la nafta justa para ir en normal.`,
    goal: 'Llegá delante del bot con nafta en el tanque.',
    win: [{ kind: 'ahead' }, { kind: 'notDry' }],
  },
  {
    ...base, id: 'cien-grados', title: `No pases de ${HOT_MAX}°`, track: 'at-1969', laps: HOT_LAPS, seed: 22, start: HOT_START, macros: true,
    context: `El motor larga a ${HOT_START.temp}° y la protección corta potencia desde ${PHYS.TEMP_LIMIT}°. Son ${HOT_LAPS} vueltas.`,
    goal: `Llegá delante del bot con el motor por debajo de ${HOT_MAX}°.`,
    win: [{ kind: 'ahead' }, { kind: 'cool', max: HOT_MAX }],
  },
  {
    ...base, id: 'fusible', title: 'El fusible falló', track: 'ca-1978', laps: 2, seed: 33, start: {}, fault: FUSE_AT, macros: false,
    context: `En la vuelta ${FUSE_AT.lap}, a ${FUSE_AT.s} m de la largada, salta el fusible del ERS.`,
    goal: 'Rearmalo con el control en el medio y llegá delante del bot.',
    win: [{ kind: 'ahead' }],
  },
  {
    ...base, id: 'gomas', title: 'Gomas al límite', track: 'hu-1986', laps: TYRE_LAPS, seed: 44, start: TYRE_START, macros: true,
    context: `Las gomas largan al ${TYRE_START.tyre} % y quedan ${TYRE_LAPS} vueltas.`,
    goal: `Llegá delante del bot con las gomas por encima del ${TYRE_MIN} %.`,
    win: [{ kind: 'ahead' }, { kind: 'tyreAbove', min: TYRE_MIN }],
  },
];

/** Opciones de carrera de un escenario; la interfaz suma `trail`. */
export const scenarioOpts = (sc: Scenario): Omit<RaceOpts, 'trail'> =>
  ({ laps: sc.laps, difficulty: sc.difficulty, bots: sc.bots, faults: sc.faults, seed: sc.seed, start: sc.start, fault: sc.fault });

const n1 = (x: number): string => x.toFixed(1).replace('.', ',');

const checkAhead = (r: Race): [boolean, string] => {
  const res = r.result();
  if (!res) return [false, 'No llegaste a la meta'];
  return [res.won, `Llegaste ${res.won ? 'delante' : 'detrás'} del bot por ${n1(res.margin)} s`];
};

const checkFuel = (left: number | null): [boolean, string] => {
  if (left === null) return [false, 'No llegaste a la meta'];
  if (left <= 0) return [false, 'Te quedaste sin nafta antes de la meta'];
  return [true, left < 0.05 ? 'Llegaste con la nafta justa' : `Te sobraron ${n1(left)} kg de nafta`];
};

/** Un criterio contra la carrera: si se cumple y el renglón que lo cuenta. cool y tyreAbove se juzgan con el entero que muestra el renglón. */
function check(c: Criterion, r: Race): [boolean, string] {
  const p = r.player;
  switch (c.kind) {
    case 'ahead': return checkAhead(r);
    case 'cool': return [Math.floor(p.tmax) < c.max, `El motor llegó a ${Math.floor(p.tmax)}°, el tope era ${c.max}°`];
    case 'notDry': return checkFuel(r.fuelEnd);
    case 'tyreAbove': return [Math.floor(p.tyre) > c.min, `Las gomas terminaron en ${Math.floor(p.tyre)} %, el piso era ${c.min} %`];
  }
}

/** Veredicto del desafío. Llamala con el jugador en la meta. */
export function evaluate(sc: Scenario, r: Race): Outcome {
  const rows = sc.win.map((c) => ({ c, v: check(c, r) }));
  return { ok: rows.every((x) => x.v[0]), lines: rows.map((x) => x.v[1]), failed: rows.find((x) => !x.v[0])?.c ?? null };
}
