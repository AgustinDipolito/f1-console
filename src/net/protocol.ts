import type { Snap } from '../sim/remote';
import type { Lap } from '../sim/types';

/** Lo que llega por la red viene de otro navegador: se valida todo antes de usarlo. Corre en Node para los tests. */

export const NAME_MAX = 16;
/** Sin caracteres de control y con los espacios juntos. Vacío queda vacío: quien llama decide el nombre por defecto. */
export const cleanName = (s: string): string =>
  s.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

// ——— Fantasma compartido ———

export interface SharedGhost { track: string; name: string; lap: Lap }

const GHOST_VER = 1;
/** Valor que marca un registro vacío (NaN) en el código. */
const HOLE = 0xffff;

function toB64url(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b;
  } catch {
    return null;
  }
}

/** Vuelta a bytes: tiempo total en ms, cada registro como el paso en ms desde el anterior y la velocidad en cm/s. */
function lapBytes(l: Lap): Uint8Array {
  const n = l.tt.length, dv = new DataView(new ArrayBuffer(7 + n * 4));
  dv.setUint8(0, GHOST_VER);
  dv.setUint16(1, n);
  dv.setUint32(3, Math.round(l.t * 1000));
  let prev = 0;
  for (let k = 0; k < n; k++) {
    const ms = Math.round(l.tt[k] * 1000), ok = Number.isFinite(ms) && ms >= prev && ms - prev < HOLE;
    dv.setUint16(7 + k * 2, ok ? ms - prev : HOLE);
    if (ok) prev = ms;
    const v = Math.round(l.v[k] * 100);
    dv.setUint16(7 + n * 2 + k * 2, Number.isFinite(v) && v >= 0 && v < HOLE ? v : HOLE);
  }
  return new Uint8Array(dv.buffer);
}

function bytesLap(b: Uint8Array): Lap | null {
  if (b.length < 7) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), n = dv.getUint16(1);
  if (dv.getUint8(0) !== GHOST_VER || n === 0 || b.length !== 7 + n * 4) return null;
  const t = dv.getUint32(3) / 1000, tt: number[] = [], v: number[] = [];
  let prev = 0;
  for (let k = 0; k < n; k++) {
    const d = dv.getUint16(7 + k * 2);
    if (d === HOLE) tt.push(NaN);
    else { prev += d; tt.push(prev / 1000); }
    const x = dv.getUint16(7 + n * 2 + k * 2);
    v.push(x === HOLE ? NaN : x / 100);
  }
  return t > 0 ? { t, tt, v } : null;
}

const TRACK_ID = /^[\w-]{1,40}$/;

/** Código de fantasma: circuito~nombre~vuelta. Va en el link después de #fantasma=. */
export const encodeGhost = (g: SharedGhost): string =>
  `${g.track}~${encodeURIComponent(cleanName(g.name))}~${toB64url(lapBytes(g.lap))}`;

/** El código pelado: sin el link alrededor y con los ~ sin codificar (algunas apps los mandan codificados). */
function ghostCode(input: string): string {
  let s = input.trim();
  const at = s.indexOf('fantasma=');
  if (at >= 0) s = s.slice(at + 9);
  return s.includes('~') ? s : s.replace(/%7e/gi, '~');
}

/** Circuito, nombre y datos; null si no son exactamente tres partes con un circuito válido. */
function ghostParts(code: string): [string, string, string] | null {
  const [track, name, data, ...rest] = code.split('~');
  if (rest.length || !track || !TRACK_ID.test(track)) return null;
  return name === undefined || !data ? null : [track, name, data];
}

function nameOf(s: string): string | null {
  try { return cleanName(decodeURIComponent(s)); } catch { return null; }
}

/** Acepta el código solo o el link entero. */
export function decodeGhost(input: string): SharedGhost | null {
  const parts = ghostParts(ghostCode(input));
  if (!parts) return null;
  const [track, name, data] = parts, nm = nameOf(name);
  if (nm === null) return null;
  const b = fromB64url(data), lap = b && bytesLap(b);
  return lap ? { track, name: nm, lap } : null;
}

// ——— Sala ———

const ROOM_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
export const newRoomCode = (rnd: () => number = Math.random): string =>
  Array.from({ length: 6 }, () => ROOM_CHARS[Math.floor(rnd() * ROOM_CHARS.length)]).join('');

/** Acepta el código solo o el link entero. Null si no parece un código. */
export function roomCodeOf(input: string): string | null {
  let s = input.trim();
  const at = s.indexOf('sala=');
  if (at >= 0) s = s.slice(at + 5);
  s = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return s.length >= 4 && s.length <= 12 ? s : null;
}

/** Presentación de cada uno. since: 0 para quien creó la sala; para el resto, cuándo entró. */
export type Hello = { name: string; since: number };
/** Lo que decide el anfitrión. */
export type RoomCfg = { circuit: string; laps: number; faults: boolean; timeScale: number };
/** Largada: n numera las carreras de la sala, para no mezclar mensajes de una anterior. */
export type Go = { n: number; cfg: RoomCfg };
export type NetSnap = Snap & { n: number };

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
const numOrNull = (x: unknown, lo: number, hi: number): boolean => x === null || num(x, lo, hi);

export function parseHello(x: unknown): Hello | null {
  if (!isObj(x) || typeof x.name !== 'string' || !num(x.since, 0, Number.MAX_SAFE_INTEGER)) return null;
  return { name: cleanName(x.name) || 'Jugador', since: x.since };
}

export function parseCfg(x: unknown): RoomCfg | null {
  if (!isObj(x) || typeof x.circuit !== 'string' || !TRACK_ID.test(x.circuit)) return null;
  if (!num(x.laps, 1, 20) || !Number.isInteger(x.laps) || typeof x.faults !== 'boolean' || ![1, 2, 3].includes(x.timeScale as number)) return null;
  return { circuit: x.circuit, laps: x.laps, faults: x.faults, timeScale: x.timeScale as number };
}

export function parseGo(x: unknown): Go | null {
  if (!isObj(x) || !num(x.n, 1, Number.MAX_SAFE_INTEGER) || !Number.isInteger(x.n)) return null;
  const cfg = parseCfg(x.cfg);
  return cfg ? { n: x.n, cfg } : null;
}

export function parseSnap(x: unknown): NetSnap | null {
  if (!isObj(x) || !num(x.n, 1, Number.MAX_SAFE_INTEGER)) return null;
  if (!num(x.t, 0, 1e6) || !num(x.d, -1e3, 1e7) || !num(x.v, 0, 1e3) || !num(x.off, -50, 50) || typeof x.done !== 'boolean') return null;
  if (!numOrNull(x.fin, 0, 1e6) || !numOrNull(x.best, 0, 1e6)) return null;
  return { n: x.n, t: x.t, d: x.d, v: x.v, off: x.off, done: x.done, fin: x.fin as number | null, best: x.best as number | null };
}

/** Anfitrión: el que entró primero; a igual momento, el id menor. Todos llegan a la misma cuenta sin hablar. */
export function hostOf(members: { id: string; since: number }[]): string | null {
  let h: { id: string; since: number } | null = null;
  for (const m of members) if (!h || m.since < h.since || (m.since === h.since && m.id < h.id)) h = m;
  return h?.id ?? null;
}
