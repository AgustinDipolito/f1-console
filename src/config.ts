import type { Difficulty, Lap } from './sim/types';

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
};

const KEY = 'f1c.config.v1';
const PROFILES = 'f1c.profiles.v1';
const BEST = 'f1c.best.v1.';
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
  return { ...DEFAULTS, ...saved };
}
export const saveConfig = (c: Config): void => write(KEY, { ...c, rev: REV });

/** Perfiles: ajustes completos guardados con nombre. El circuito y tu nombre de jugador no forman parte del perfil. */
export type Profiles = Record<string, Omit<Config, 'circuit' | 'name'>>;
export const loadProfiles = (): Profiles => read<Profiles>(PROFILES, {});
export function saveProfile(name: string, c: Config): Profiles {
  const { circuit: _, name: __, ...rest } = c;
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

/** Mejor vuelta por circuito, para el fantasma y la telemetría. JSON guarda NaN como null. */
export function loadBest(id: string): Lap | null {
  const l = read<{ t: number; tt: (number | null)[]; v: (number | null)[] } | null>(BEST + id, null);
  if (!l || !Array.isArray(l.tt)) return null;
  const n = (a: (number | null)[]): number[] => a.map((x) => x ?? NaN);
  return { t: l.t, tt: n(l.tt), v: n(l.v) };
}
export const saveBest = (id: string, l: Lap): void =>
  write(BEST + id, { t: l.t, tt: l.tt.map((x) => Math.round(x * 100) / 100), v: l.v.map((x) => Math.round(x * 10) / 10) });

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

/** Último resultado de carrera: sobrevive a una recarga de la pestaña para no perder la tabla. */
export interface LastResult { circuit: string; laps: number; rows: { pos: number; name: string; me: boolean; fin: number | null; best: number | null }[] }
export const loadLast = (): LastResult | null => {
  const l = read<LastResult | null>('f1c.last', null);
  return l && Array.isArray(l.rows) ? l : null;
};
export const saveLast = (l: LastResult | null): void => {
  if (l) { write('f1c.last', l); return; }
  try { localStorage.removeItem('f1c.last'); } catch { /* sin almacenamiento disponible */ }
};
