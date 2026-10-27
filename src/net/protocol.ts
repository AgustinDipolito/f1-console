import type { Snap } from '../sim/remote';
import { EV_KEYS, EV_VMAX, TEL_DS, smCount, timeAt, type Category } from '../sim/telemetry';
import type { Ctl, Difficulty, Ev, Lap, Sm } from '../sim/types';

/** Lo que llega por la red viene de otro navegador: se valida todo antes de usarlo. Corre en Node para los tests. */

export const NAME_MAX = 16;
/** Sin caracteres de control y con los espacios juntos. Vacío queda vacío: quien llama decide el nombre por defecto. */
export const cleanName = (s: string): string =>
  s.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

// ——— Fantasma compartido ———

/** cat: la categoría de la vuelta; null en un código v1, que no la lleva. */
export interface SharedGhost { track: string; name: string; lap: Lap; cat: Category | null }

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

// ——— v2: la vuelta con su categoría, la consola al cruzar la línea, los eventos y las muestras. Ancho fijo, big endian ———

const GHOST_V2 = 2;
const HEAD2 = 14;
/** Unidades del tiempo (s) y la velocidad (m/s) en el código. */
const TT_Q = 0.005, V_Q = 0.5;
/** Valor que marca un registro vacío (NaN). */
const HOLE8 = 255;
/** Registros que acepta un código (100 km): lo que pase es basura. */
const N_MAX = 10000;
const DIFFS: readonly Difficulty[] = ['easy', 'normal', 'hard'];

const q = (x: number, hi: number): number => Math.max(0, Math.min(hi, Math.round(x)));
/** Con traza completa una vuelta sale como v2; si no (una legacy, un v1), como v1. */
export const hasTrace = (l: Lap): boolean => !!l.c0 && l.sm?.length === smCount(l.tt.length);

function putTT(dv: DataView, o: number, tt: number[]): void {
  let prev = 0;
  tt.forEach((t, k) => {
    const u = Math.round(t / TT_Q), ok = Number.isFinite(u) && u >= prev, d = ok ? Math.min(254, u - prev) : HOLE8;
    // ponytail: un registro de más de 1,27 s se recorta a 254 unidades; el acumulado lo recupera en los siguientes y t total va aparte, exacto.
    dv.setUint8(o + k, d);
    if (ok) prev += d;
  });
}

function putV(dv: DataView, o: number, v: number[]): void {
  v.forEach((x, k) => { const u = Math.round(x / V_Q); dv.setUint8(o + k, Number.isFinite(u) && u >= 0 && u < HOLE8 ? u : HOLE8); });
}

function putEv(dv: DataView, o: number, ev: Ev[]): void {
  ev.forEach((e, i) => { dv.setUint16(o + 4 * i, q(e.s, 0xffff)); dv.setUint8(o + 4 * i + 2, EV_KEYS.indexOf(e.k)); dv.setUint8(o + 4 * i + 3, q(e.v, 255)); });
}

function putSm(dv: DataView, o: number, sm: Sm[]): void {
  sm.forEach((x, i) => {
    const p = o + 5 * i;
    dv.setUint8(p, q(x.bat, 255)); dv.setUint8(p + 1, q(x.temp, 255)); dv.setUint8(p + 2, q(x.tyre, 255)); dv.setUint16(p + 3, q(x.fuel * 10, 0xffff));
  });
}

function lapBytes2(l: Lap, c: Category): Uint8Array {
  const n = l.tt.length, ev = l.ev ?? [], sm = l.sm ?? [], c0 = l.c0 as Ctl, o = HEAD2 + 2 * n;
  const dv = new DataView(new ArrayBuffer(o + 4 * ev.length + 5 * sm.length));
  dv.setUint8(0, GHOST_V2); dv.setUint8(1, c.ver); dv.setUint8(2, c.laps); dv.setUint8(3, DIFFS.indexOf(c.difficulty));
  dv.setUint16(4, n); dv.setUint32(6, Math.round(l.t * 1000));
  dv.setUint8(10, c0.lev | (c0.ers << 2) | (c0.dif << 4) | (c0.eb << 6));
  dv.setUint8(11, q(c0.bal, 100) | (c0.lim << 7));
  dv.setUint16(12, ev.length);
  putTT(dv, HEAD2, l.tt); putV(dv, HEAD2 + n, l.v); putEv(dv, o, ev); putSm(dv, o + 4 * ev.length, sm);
  return new Uint8Array(dv.buffer);
}

interface Head2 { ver: number; laps: number; d: number; n: number; t: number; c0: Ctl; nEv: number }

function head2(dv: DataView): Head2 {
  const a = dv.getUint8(10), b = dv.getUint8(11);
  return {
    ver: dv.getUint8(1), laps: dv.getUint8(2), d: dv.getUint8(3), n: dv.getUint16(4), t: dv.getUint32(6) / 1000, nEv: dv.getUint16(12),
    c0: { lev: a & 3, ers: (a >> 2) & 3, dif: (a >> 4) & 3, eb: (a >> 6) & 3, bal: b & 127, lim: b >> 7 },
  };
}

/** La consola de la largada: cada control en su rango. */
const okCtl = (c: Ctl): boolean => c.lev <= 2 && c.ers <= 2 && c.dif <= 2 && c.eb <= 2 && c.bal <= EV_VMAX.bal;

/** Cabecera sana y largo exacto: de acá en más ninguna lectura se sale del buffer. */
const okHead = (h: Head2, len: number): boolean =>
  h.laps >= 1 && h.d < DIFFS.length && h.n >= 1 && h.n <= N_MAX && h.t > 0 && h.nEv <= h.n && okCtl(h.c0)
  && len === HEAD2 + 2 * h.n + 4 * h.nEv + 5 * smCount(h.n);

function readTT(dv: DataView, o: number, n: number): number[] {
  let prev = 0;
  return Array.from({ length: n }, (_, k) => { const d = dv.getUint8(o + k); if (d === HOLE8) return NaN; prev += d; return prev * TT_Q; });
}

function readV(dv: DataView, o: number, n: number): number[] {
  return Array.from({ length: n }, (_, k) => { const x = dv.getUint8(o + k); return x === HOLE8 ? NaN : x * V_Q; });
}

/** El tiempo de un evento no viaja: sale de los registros (±20 ms) o, con un hueco, de repartir el total. */
function evTime(l: Lap, s: number): number {
  const t = timeAt(l, s);
  return Number.isFinite(t) ? t : (l.t * s) / (l.tt.length * TEL_DS);
}

function readEv(dv: DataView, o: number, h: Head2, l: Lap): Ev[] | null {
  const out: Ev[] = [];
  let last = 0;
  for (let i = 0; i < h.nEv; i++) {
    const p = o + 4 * i, s = dv.getUint16(p), k = EV_KEYS[dv.getUint8(p + 2)], v = dv.getUint8(p + 3);
    if (k === undefined || s < last || s > h.n * TEL_DS || v > EV_VMAX[k]) return null;
    last = s;
    out.push({ s, t: evTime(l, s), k, v });
  }
  return out;
}

function readSm(dv: DataView, o: number, m: number): Sm[] | null {
  const out: Sm[] = [];
  for (let i = 0; i < m; i++) {
    const p = o + 5 * i, bat = dv.getUint8(p), tyre = dv.getUint8(p + 2);
    if (bat > 100 || tyre > 100) return null;
    out.push({ bat, temp: dv.getUint8(p + 1), tyre, fuel: dv.getUint16(p + 3) / 10 });
  }
  return out;
}

/** La vuelta v2 y su categoría sin circuito (el circuito viaja aparte, en el código). */
function bytesLap2(b: Uint8Array): { lap: Lap; cat: Omit<Category, 'track'> } | null {
  if (b.length < HEAD2) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), h = head2(dv);
  if (!okHead(h, b.length)) return null;
  const o = HEAD2 + 2 * h.n, lap: Lap = { t: h.t, tt: readTT(dv, HEAD2, h.n), v: readV(dv, HEAD2 + h.n, h.n), c0: h.c0 };
  const ev = readEv(dv, o, h, lap), sm = readSm(dv, o + 4 * h.nEv, smCount(h.n));
  if (!ev || !sm) return null;
  return { lap: { ...lap, ev, sm }, cat: { ver: h.ver, laps: h.laps, difficulty: DIFFS[h.d] } };
}

const TRACK_ID = /^[\w-]{1,40}$/;

/** Código de fantasma: circuito~nombre~vuelta. Va en el link después de #fantasma=. */
export const encodeGhost = (g: SharedGhost): string =>
  `${g.track}~${encodeURIComponent(cleanName(g.name))}~${toB64url(g.cat && hasTrace(g.lap) ? lapBytes2(g.lap, g.cat) : lapBytes(g.lap))}`;

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
  const b = fromB64url(data);
  if (!b) return null;
  if (b[0] === GHOST_V2) {
    const g = bytesLap2(b);
    return g ? { track, name: nm, lap: g.lap, cat: { track, ...g.cat } } : null;
  }
  const lap = bytesLap(b);
  return lap ? { track, name: nm, lap, cat: null } : null;
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
