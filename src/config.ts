import { decodeGhost, encodeGhost, hasTrace } from './net/protocol';
import { HEAD_STARTS } from './sim/chase';
import { categoryKey, sameCategory, type Category } from './sim/telemetry';
import type { Difficulty, Lap } from './sim/types';

/** Qué se corre: carrera contra bots, mejor vuelta, persecución de un fantasma o un desafío. */
export type Mode = 'race' | 'tt' | 'chase' | 'challenge';
export const MODES: readonly Mode[] = ['race', 'tt', 'chase', 'challenge'];

export interface Config {
  circuit: string;
  laps: number;
  timeScale: number;
  difficulty: Difficulty;
  bots: number;
  faults: boolean;
  assist: boolean;
  showBraking: boolean;
  showTrail: boolean;
  showGhost: boolean;
  mapView: '2d' | '3d';
  sound: boolean;
  theme: 'auto' | 'light' | 'dark';
  /** screen: el mapa en la pantalla del volante y sus lecturas en el HUD. cockpit: el volante delante del mapa, que sigue a tu auto. */
  layout: 'auto' | 'side' | 'stack' | 'screen' | 'cockpit';
  quality: number;
  labels: boolean;
  /** Esquema de colores del volante (clave de `LIVERIES`). */
  livery: string;
  /** Efectos del volante: LEDs que se llenan antes del tramo, marca de destino al apuntar, destello al acertar el tramo y barra de delta. */
  fxLeds: boolean;
  fxAim: boolean;
  fxFlash: boolean;
  fxDelta: boolean;
  /** Comentarios bajo el volante: qué salió bien o mal en cada tramo. */
  coach: boolean;
  /** Efectos del mapa y la pista: pérdidas de la vuelta en el mapa y discos al rojo en las frenadas. */
  fxLosses: boolean;
  fxBrakes: boolean;
  /** Vibrar al accionar un control y cuando salta un fusible (solo donde el aparato vibra). */
  haptics: boolean;
  /** Cómo te ven los demás en una sala o en tu fantasma. */
  name: string;
  mode: Mode;
  /** Desafío elegido (id de CHALLENGES); vacío, el primero de la lista. */
  challenge: string;
  /** Ventaja del fantasma en persecución (s): una de HEAD_STARTS. */
  chaseHead: number;
}

export const DEFAULTS: Config = {
  circuit: 'ar-1952',
  laps: 3,
  timeScale: 1,
  difficulty: 'normal',
  bots: 1,
  faults: true,
  assist: true,
  showBraking: true,
  showTrail: true,
  showGhost: true,
  mapView: '2d',
  sound: true,
  theme: 'dark',
  layout: 'auto',
  quality: 2,
  labels: true,
  livery: 'azar',
  fxLeds: true,
  fxAim: true,
  fxFlash: true,
  fxDelta: true,
  coach: true,
  fxLosses: true,
  fxBrakes: true,
  haptics: true,
  name: '',
  mode: 'race',
  challenge: '',
  chaseHead: 6,
};

const KEY = 'f1c.config.v1';
const PROFILES = 'f1c.profiles.v1';
const BEST = 'f1c.best.v1.';
const BEST2 = 'f1c.best.v2.';
const RIVAL = 'f1c.rival.v1.';
const WELCOME = 'f1c.welcome';

const read = <T>(key: string, def: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : (JSON.parse(v) as T);
  } catch {
    return def;
  }
};

const write = (key: string, v: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* sin almacenamiento disponible */
  }
};

/**
 * Revisión de los valores de fábrica. Al subirla, una config guardada antes vuelve a tomar los de `CHANGED` una sola vez:
 * guardar la config entera dejaba fijo el valor de fábrica viejo aunque nadie lo hubiera elegido.
 */
const REV = 2;
const CHANGED: (keyof Config)[] = ['livery', 'assist', 'timeScale', 'theme'];
export function loadConfig(): Config {
  const { rev, ...saved } = read<Partial<Config> & { rev?: number }>(KEY, {});
  if ((rev ?? 1) < REV) for (const k of CHANGED) delete saved[k];
  const c = { ...DEFAULTS, ...saved };
  // Lo guardado puede venir de una versión con otras opciones: lo que no existe vuelve a lo de fábrica.
  if (!MODES.includes(c.mode)) c.mode = DEFAULTS.mode;
  if (!HEAD_STARTS.includes(c.chaseHead)) c.chaseHead = DEFAULTS.chaseHead;
  return c;
}
export const saveConfig = (c: Config): void => write(KEY, { ...c, rev: REV });

/** Lo que no es un ajuste: un perfil o «Restablecer» lo dejan como estaba. */
export const SESSION = ['circuit', 'name', 'mode', 'challenge', 'chaseHead'] as const;
type SessionKey = (typeof SESSION)[number];
export const sessionOf = (c: Config): Pick<Config, SessionKey> =>
  ({ circuit: c.circuit, name: c.name, mode: c.mode, challenge: c.challenge, chaseHead: c.chaseHead });

/** Perfiles: ajustes completos guardados con nombre, sin las claves de sesión (el circuito, tu nombre, el modo y el desafío). */
export type Profiles = Record<string, Omit<Config, SessionKey>>;
export const loadProfiles = (): Profiles => read<Profiles>(PROFILES, {});
export function saveProfile(name: string, c: Config): Profiles {
  const rest = Object.fromEntries(Object.entries(c).filter(([k]) => !(SESSION as readonly string[]).includes(k))) as Profiles[string];
  const all = { ...loadProfiles(), [name]: rest };
  write(PROFILES, all);
  return all;
}
export function deleteProfile(name: string): Profiles {
  const all = loadProfiles();
  delete all[name];
  write(PROFILES, all);
  return all;
}

/** Mejor vuelta de la categoría. legacy: la guardó la versión anterior, sin historial; cat es entonces la pedida, porque la del v1 no se sabe. */
export interface Best { lap: Lap; cat: Category; legacy: boolean }

/** El récord de antes de las categorías, por circuito. JSON guarda NaN como null. Nunca se borra ni se reescribe. */
function loadLegacy(id: string): Lap | null {
  const l = read<{ t: number; tt: (number | null)[]; v: (number | null)[] } | null>(BEST + id, null);
  if (!l || !Array.isArray(l.tt)) return null;
  const n = (a: (number | null)[]): number[] => a.map((x) => x ?? NaN);
  return { t: l.t, tt: n(l.tt), v: n(l.v) };
}

/** Mejor vuelta de la categoría, para el fantasma y la telemetría. Guardada como código de fantasma v2; sin ella, el v1 del circuito. */
export function loadBest(cat: Category): Best | null {
  const code = read<unknown>(BEST2 + categoryKey(cat), null);
  const g = typeof code === 'string' ? decodeGhost(code) : null;
  if (g?.cat && sameCategory(g.cat, cat)) return { lap: g.lap, cat, legacy: false };
  const lap = loadLegacy(cat.track);
  return lap ? { lap, cat, legacy: true } : null;
}

/** Guarda si es récord de la categoría: una vuelta sin traza no sirve, y un v1 no cuenta como récord. true si guardó. */
export function saveBest(cat: Category, lap: Lap): boolean {
  if (!hasTrace(lap)) return false;
  const cur = loadBest(cat);
  if (cur && !cur.legacy && cur.lap.t <= lap.t) return false;
  write(BEST2 + categoryKey(cat), encodeGhost({ track: cat.track, name: '', lap, cat }));
  return true;
}

/** Fantasma de otro jugador por circuito, guardado como el código que llegó en el link. */
export const loadRival = (id: string): string | null => read<string | null>(RIVAL + id, null);
export function saveRival(id: string, code: string | null): void {
  if (code !== null) { write(RIVAL + id, code); return; }
  try { localStorage.removeItem(RIVAL + id); } catch { /* sin almacenamiento disponible */ }
}

/**
 * Primer ingreso: nadie pasó por la bienvenida en este navegador. Quien ya había jugado antes de que existiera
 * (vio la ayuda del primer ingreso o tiene ajustes guardados) no la ve sola: la abre desde ajustes.
 * Sin almacenamiento no se muestra: aparecería en cada visita.
 */
export function firstRun(): boolean {
  try {
    return ![WELCOME, 'f1c.help', KEY].some((k) => localStorage.getItem(k) !== null);
  } catch {
    return false;
  }
}
export const markWelcomed = (): void => write(WELCOME, 1);

/** Veredicto de un modo que se gana o se pierde: ok null es «sin resultado» (persecución sin fantasma). */
export interface Verdict { ok: boolean | null; title: string; lines: string[] }

/**
 * Último resultado de carrera: sobrevive a una recarga de la pestaña para no perder la tabla.
 * Lo que sigue a `rows` es opcional: un resultado guardado antes de los modos se dibuja como una carrera.
 * cat: categoría en texto («3 vueltas · normal»). key: lo que más costó, ya escrito.
 */
export interface LastResult {
  circuit: string; laps: number;
  mode?: Mode; title?: string; cat?: string; verdict?: Verdict; key?: string;
  rows: { pos: number; name: string; me: boolean; fin: number | null; best: number | null; trait?: string }[];
}
export const loadLast = (): LastResult | null => {
  const l = read<LastResult | null>('f1c.last', null);
  return l && Array.isArray(l.rows) ? l : null;
};
export const saveLast = (l: LastResult | null): void => {
  if (l) { write('f1c.last', l); return; }
  try { localStorage.removeItem('f1c.last'); } catch { /* sin almacenamiento disponible */ }
};
