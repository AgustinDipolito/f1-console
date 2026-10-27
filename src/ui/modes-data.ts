import type { Mode, Verdict } from '../config';
import { CHALLENGES, type Outcome, type Scenario } from '../sim/scenario';
import { cap, f1, fmt } from './format';

/** Lo puro de los modos: nombre y frase de cada uno, el renglón de la carrera, los mensajes de grilla y de meta y el veredicto. Sin DOM: se prueba en Node. */

export const MODE_INFO: Record<Mode, { name: string; say: string }> = {
  race: { name: 'Carrera', say: 'Contra los bots de Ajustes. Gana el que cruza primero la meta.' },
  tt: { name: 'Mejor vuelta', say: 'Solo en la pista, contra tu récord en este circuito con estas vueltas y esta dificultad.' },
  chase: { name: 'Persecución', say: 'Sin bots. Tu récord o el fantasma de otro jugador larga con ventaja y ganás si llegás antes.' },
  challenge: { name: 'Desafío', say: 'Una situación que arranca siempre igual, contra un bot. Ganás si la resolvés y llegás delante.' },
};

/** El desafío con ese id; con uno que no existe (o vacío), el primero. */
export const challengeOf = (id: string): Scenario => CHALLENGES.find((s) => s.id === id) ?? CHALLENGES[0];

export const signed = (x: number): string => `${x >= 0 ? '+' : '−'}${f1(Math.abs(x))}`;

const join = (parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' · ');

// ——— Renglones de la carrera ———

/** pos: el puesto ya escrito. delta: contra la referencia del modo. ref: hay con qué compararse (récord o fantasma). */
export interface LineIn {
  mode: Mode; lap: number; laps: number; pos: string; delta: number | null; ref: boolean;
  rival: { name: string; d: number } | null; title: string;
}

/**
 * Renglón de arriba: en carrera, vuelta, puesto y deltas; en los otros modos empieza con el nombre del modo.
 * A 13 px entran 44 caracteres en un teléfono de 360 px (lo fija tests/modes.test.ts).
 */
export function raceLine(x: LineIn): string {
  const lap = `vuelta ${x.lap}/${x.laps}`, d = x.delta === null ? '' : `Δ ${signed(x.delta)}`;
  if (x.mode === 'race') return join([lap, x.pos, d, x.rival && `vs ${x.rival.name} ${signed(x.rival.d)}`]);
  if (x.mode === 'challenge') return join([x.title, lap, x.pos]);
  const [name, none] = x.mode === 'tt' ? ['mejor vuelta', 'sin récord'] : ['persecución', 'sin fantasma'];
  return join([name, lap, d || (x.ref ? '' : none)]);
}

/** chase: la vuelta que se persigue (s) y su ventaja. metric: lo que decide el desafío, ya escrito. */
export interface TimesIn { mode: Mode; last: number | null; best: number | null; kmh: number; chase: { t: number; head: number } | null; metric: string }

/** Renglón de abajo (12 px, hasta 48 caracteres). El desafío cambia la velocidad por lo que se juega. */
export function timesLine(x: TimesIn): string {
  const last = `última ${fmt(x.last)}`;
  if (x.mode === 'challenge') return join([x.metric, last]);
  if (x.mode === 'chase' && x.chase) return join([`fantasma ${fmt(x.chase.t)}`, `ventaja ${x.chase.head} s`, `${x.kmh} km/h`]);
  return join([last, `mejor ${fmt(x.best)}`, `${x.kmh} km/h`]);
}

/**
 * Lo que juega el desafío, mientras corrés: el primer criterio que no es llegar delante. Los enteros son los del veredicto
 * (`evaluate` los juzga con el entero que muestra el renglón). fuelLaps: el de la etiqueta Nafta del volante.
 */
export function challengeMetric(sc: Scenario, m: { tmax: number; tyre: number; fuelLaps: number }): string {
  const c = sc.win.find((w) => w.kind !== 'ahead');
  switch (c?.kind) {
    case 'cool': return `motor ${Math.floor(m.tmax)}°, tope ${c.max}°`;
    case 'notDry': return `nafta ${signed(m.fuelLaps)} v`;
    case 'tyreAbove': return `gomas ${Math.floor(m.tyre)} %, piso ${c.min} %`;
    default: return '';
  }
}

// ——— Mensajes de la grilla y de la meta ———

/** cat: la categoría escrita. rival: nombre del fantasma de otro jugador cargado. chase: a quién se persigue. */
export interface ReadyIn { mode: Mode; cat: string; best: number | null; rival: string | null; chase: { name: string; head: number } | null; sc: Scenario }

/** Qué dice la grilla. En carrera sigue empezando con «Listo»: el chequeo del teléfono lo espera. */
export function readyText(x: ReadyIn): string {
  switch (x.mode) {
    case 'race': return x.rival ? `Listo para largar contra el fantasma de ${x.rival}` : 'Listo para largar';
    case 'tt': return x.best === null ? `Listo para la mejor vuelta. Todavía no hay récord en ${x.cat}` : `Listo para la mejor vuelta. Récord en ${x.cat}: ${fmt(x.best)}`;
    case 'chase': return x.chase
      ? `Listo para perseguir a ${x.chase.name}, que larga con ${x.chase.head} s de ventaja`
      : 'No hay a quién perseguir: corré en mejor vuelta o cargá el fantasma de otro jugador';
    case 'challenge': return `Listo para «${x.sc.title}». ${x.sc.goal}`;
  }
}

/** Cómo terminó la carrera, según el modo. */
export type End =
  | { mode: 'race'; res: { won: boolean; pos: number; of: number; margin: number }; fin: number; best: number | null }
  | { mode: 'tt'; record: boolean; mine: number | null; before: number | null; cat: string }
  | { mode: 'chase'; name: string; fin: number; head: number; r: { won: boolean; margin: number; ghost: number } | null }
  | { mode: 'challenge'; sc: Scenario; out: Outcome };

type Of<M extends Mode> = Extract<End, { mode: M }>;

function raceText({ res, fin, best }: Of<'race'>): string {
  const tail = `total ${fmt(fin)} · mejor vuelta ${fmt(best)}`;
  if (res.of === 1) return `Terminaste · ${tail}`;
  return `${res.won ? 'Ganaste' : `Terminaste ${res.pos}.º de ${res.of}`} por ${f1(res.margin)} s · ${tail}`;
}

function ttText(e: Of<'tt'>): string {
  if (!e.record) return `Sin récord: tu mejor vuelta fue ${fmt(e.mine)} y el récord es ${fmt(e.before)}`;
  if (e.before === null) return `Primer récord en ${e.cat}: ${fmt(e.mine)}`;
  return `Récord nuevo en ${e.cat}: ${fmt(e.mine)}, ${f1(e.before - (e.mine ?? e.before))} s menos`;
}

function chaseText({ name, fin, r }: Of<'chase'>): string {
  if (!r) return `Terminaste en ${fmt(fin)}. No había fantasma para perseguir`;
  const total = `total ${fmt(fin)}`;
  return r.won ? `Le ganaste a ${name} por ${f1(r.margin)} s · ${total}` : `${cap(name)} llegó ${f1(-r.margin)} s antes · ${total}`;
}

/** Cumplido: todo lo que se contó. No cumplido: solo el renglón del criterio que falló. */
function challengeText({ sc, out }: Of<'challenge'>): string {
  if (out.ok) return `Desafío cumplido: ${out.lines.join(' · ')}`;
  const i = out.failed ? sc.win.indexOf(out.failed) : 0;
  return `Desafío no cumplido: ${out.lines[Math.max(0, i)]}`;
}

/** El mensaje de la meta (#msg). */
export function endText(e: End): string {
  switch (e.mode) {
    case 'race': return raceText(e);
    case 'tt': return ttText(e);
    case 'chase': return chaseText(e);
    case 'challenge': return challengeText(e);
  }
}

// ——— Resultados ———

function ttVerdict(e: Of<'tt'>): Verdict {
  const prior = e.before === null ? 'Era la primera vuelta en esta categoría' : `${e.record ? 'Récord anterior' : 'Récord'}: ${fmt(e.before)}`;
  return { ok: e.record, title: e.record ? 'Récord nuevo' : 'Sin récord', lines: [`Tu mejor vuelta: ${fmt(e.mine)}`, prior] };
}

function chaseVerdict({ name, fin, head, r }: Of<'chase'>): Verdict {
  if (!r) return { ok: null, title: 'Sin fantasma', lines: ['No había a quién perseguir en esta categoría'] };
  const title = r.won ? `Le ganaste a ${name}` : `${cap(name)} llegó antes`;
  return { ok: r.won, title, lines: [`Tu tiempo: ${fmt(fin)}`, `${cap(name)}, con ${head} s de ventaja: ${fmt(r.ghost)}`] };
}

/** El bloque de veredicto de la pantalla de resultados; la carrera no lo tiene: manda la tabla. */
export function verdictOf(e: End): Verdict | null {
  switch (e.mode) {
    case 'race': return null;
    case 'tt': return ttVerdict(e);
    case 'chase': return chaseVerdict(e);
    case 'challenge': return { ok: e.out.ok, title: e.out.ok ? 'Desafío cumplido' : 'Desafío no cumplido', lines: e.out.lines };
  }
}

export function resultsTitle(e: End): string {
  switch (e.mode) {
    case 'race': return 'Resultados';
    case 'tt': return 'Mejor vuelta';
    case 'chase': return 'Persecución';
    case 'challenge': return `Desafío: ${e.sc.title}`;
  }
}
