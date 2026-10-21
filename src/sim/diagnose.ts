import { FUSED, effective, grip, idx } from './car';
import { FUEL, PHYS } from './physics';
import { WANTS, deficits, efficiency, wantOf, type Knob } from './score';
import { TEL_DS } from './telemetry';
import type { Lap, Rec, Seg, Track } from './types';

/** Por qué se perdió el tiempo. Un control fuera de lo que pide el tramo va con su nombre. */
export type Cause = Knob | 'bat' | 'fuse' | 'hot' | 'tyre' | 'fuel' | 'lim' | 'start' | 'other';
/** Control fuera de lo pedido: al entrar al tramo (tarde), al salir (antes de tiempo) o en el medio o todo el tramo. */
export type When = 'late' | 'early' | 'off';

export interface Loss {
  cause: Cause;
  /** Solo en un control fuera de lo pedido. */
  when?: When;
  /** El control en juego: el propio, el que trabó el fusible o el ERS sin carga. */
  knob?: Knob;
  /** Tramo donde empezó la pérdida (m). */
  ty: Seg; s0: number; s1: number;
  /** Segundos, incluido lo que se siguió pagando en los tramos siguientes. */
  sec: number;
  /** Metros con la causa activa. */
  m: number;
  /** Valor del control cuando empezó la causa y el que pide el tramo. */
  val?: number; want?: number;
}

/** lap e ideal en segundos; q, el puntaje de cada registro. */
export interface Diagnosis { lap: number; ideal: number; losses: Loss[]; q: number[] }

/** Debajo de esta fracción de su velocidad objetivo, el auto todavía está acelerando desde la largada. */
const LAUNCHED = 0.98;

/**
 * Reparte el tiempo perdido contra la vuelta ideal entre lo que lo causó, registro por registro.
 * La pérdida de cada registro se parte en dos: lo que bajó la velocidad objetivo ahí (cada causa según
 * cuánto la bajó) y lo que el auto venía atrasado de antes, que se le cobra a las causas anteriores.
 * Devuelve null si la vuelta no tiene caja negra completa (una mejor vuelta guardada o un fantasma).
 */
/** Todo lo que se sabe de la vuelta antes de repartir: tramos, controles efectivos y dónde estuvo cada control justo. */
interface Ctx {
  tr: Track; n: number; rec: Rec[];
  tyOf: (k: number) => Seg;
  /** Tramo de cada registro y registro donde empieza cada tramo. */
  run: number[]; start: number[];
  eff: Rec[];
  /** Primer y último registro de cada tramo con el control justo, por `tramo|control`. */
  first: Map<string, number>; last: Map<string, number>;
  out: Map<string, Loss>;
}

/** Una pérdida activa en el registro: la pérdida, su clave y su peso en la bajada de velocidad. */
type Active = [Loss, string, number];

/** Solo las vueltas corridas en esta sesión tienen caja negra, y tiene que estar completa. */
function blackBoxOf(lap: Lap): Rec[] | null {
  const rec = lap.rec;
  if (!rec || lap.tt.some(Number.isNaN)) return null;
  for (let k = 0; k < lap.tt.length; k++) if (!rec[k]) return null;
  return rec;
}

/** Tiempo ideal desde la línea hasta s, con el mismo perfil que da tr.idealLap. */
function idealClock(tr: Track): (s: number) => number {
  const cum = [0];
  for (let i = 0; i < tr.n; i++) cum.push(cum[i] + tr.ds / Math.max(tr.v[i], 1));
  return (s) => { const i = Math.min(tr.n - 1, Math.floor(s / tr.ds)); return cum[i] + (s - i * tr.ds) / Math.max(tr.v[i], 1); };
}

/** Tramos: tandas de registros seguidos del mismo tipo. */
function splitRuns(n: number, tyOf: (k: number) => Seg): { run: number[]; start: number[] } {
  const run: number[] = [], start: number[] = [];
  for (let k = 0; k < n; k++) { if (!k || tyOf(k) !== tyOf(k - 1)) start.push(k); run.push(start.length - 1); }
  return { run, start };
}

/** Primer y último registro de cada tramo con el control justo: lo de antes es tarde, lo de después es antes de tiempo. */
function rightSpans(def: Partial<Record<Knob, number>>[], run: number[]): { first: Map<string, number>; last: Map<string, number> } {
  const first = new Map<string, number>(), last = new Map<string, number>();
  def.forEach((d, k) => {
    for (const [kn, x] of Object.entries(d)) {
      if (x !== 0) continue;
      const key = `${run[k]}|${kn}`;
      if (!first.has(key)) first.set(key, k);
      last.set(key, k);
    }
  });
  return { first, last };
}

/** El control no estaba en manos del jugador: un fusible lo trabó o el ERS pedía attack sin carga. */
function carCause(x: Ctx, k: number, kn: Knob): Cause | null {
  const f = (FUSED as readonly string[]).indexOf(kn), r = x.rec[k];
  if (f >= 0 && r.fuse[f]) return 'fuse';
  const flat = kn === 'ers' && r.ers === 2 && r.bat < 1;
  return flat && WANTS[x.tyOf(k)].ers?.[0] === 2 ? 'bat' : null;
}

/** Antes de tiempo es ya estar en lo que pide el tramo siguiente; otro valor al final (attack que se quedó sin carga) no es anticipar. */
function anticipates(x: Ctx, k: number, kn: Knob): boolean {
  const next = x.tyOf(x.start[(x.run[k] + 1) % x.start.length]);
  return x.eff[k][kn] === wantOf(next, kn, x.rec[k].bw);
}

function timing(x: Ctx, k: number, kn: Knob): When {
  const key = `${x.run[k]}|${kn}`, a = x.first.get(key), b = x.last.get(key);
  if (a === undefined || b === undefined) return 'off';
  if (k < a) return 'late';
  return k > b && anticipates(x, k, kn) ? 'early' : 'off';
}

function knobCause(x: Ctx, k: number, kn: Knob): [Cause, When?] {
  const c = carCause(x, k, kn);
  return c ? [c] : [kn, timing(x, k, kn)];
}

function newLoss(x: Ctx, k: number, cause: Cause, when?: When, knob?: Knob): Loss {
  const r = x.run[k], s1 = (r + 1 < x.start.length ? x.start[r + 1] : x.n) * TEL_DS;
  const l: Loss = { cause, ty: x.tyOf(x.start[r]), s0: x.start[r] * TEL_DS, s1: Math.min(x.tr.len, s1), sec: 0, m: 0 };
  if (when) l.when = when;
  if (knob) { l.knob = knob; l.val = x.eff[k][knob]; l.want = wantOf(x.tyOf(k), knob, x.rec[k].bw); }
  return l;
}

/** La pérdida de esta causa en el tramo del registro k, creada la primera vez. */
function entry(x: Ctx, k: number, cause: Cause, when?: When, knob?: Knob): [string, Loss] {
  const key = `${x.run[k]}|${cause}|${when ?? ''}|${knob ?? ''}`;
  let l = x.out.get(key);
  if (!l) { l = newLoss(x, k, cause, when, knob); x.out.set(key, l); }
  return [key, l];
}

/**
 * Lo mismo que hace stepCar con la velocidad objetivo, causa por causa: anota en `act` cada causa que la bajó
 * en el registro k, con su peso, y devuelve la velocidad objetivo resultante.
 */
function targetCauses(x: Ctx, k: number, d: Partial<Record<Knob, number>>, v0: number, act: Active[]): { tg: number; sc: number } {
  const r = x.rec[k], ds = Object.values(d), dsum = ds.reduce((a, y) => a + y, 0), sc = 1 - dsum / ds.length;
  const fc = efficiency(sc, 0), fh = efficiency(sc, r.temp) / fc, ft = x.tyOf(k) === 's' ? 1 : Math.sqrt(grip(r.tyre));
  let tg = v0 * fc * fh * ft;
  const on = ([key, l]: [string, Loss], w: number): void => { act.push([l, key, w]); l.m += TEL_DS; };
  for (const [kn, y] of Object.entries(d) as [Knob, number][]) {
    if (y > 0) { const [c, wh] = knobCause(x, k, kn); on(entry(x, k, c, wh, kn), (-Math.log(fc) * y) / dsum); }
  }
  if (fh < 1) on(entry(x, k, 'hot'), -Math.log(fh));
  if (ft < 1) on(entry(x, k, 'tyre'), -Math.log(ft));
  const cap = (cause: Cause, lim: number): void => { if (tg > lim) { on(entry(x, k, cause), Math.log(tg / lim)); tg = lim; } };
  if (r.fuel <= 0) cap('fuel', FUEL.DRY_V);
  if (r.lim) cap('lim', PHYS.LIMITER);
  return { tg, sc };
}

/** El atraso que el auto trae de antes se cobra a las deudas pendientes, en proporción. Sin deudas, va a 'other'. */
function chargeLag(x: Ctx, k: number, lag: number, debt: Map<string, number>): void {
  const D = [...debt.values()].reduce((a, y) => a + y, 0);
  if (D > 1e-9) payDebts(x, lag, D, debt);
  else entry(x, k, 'other')[1].sec += lag;
}

function payDebts(x: Ctx, lag: number, D: number, debt: Map<string, number>): void {
  for (const [key, y] of debt) {
    const part = (lag * y) / D;
    (x.out.get(key) as Loss).sec += part;
    if (lag > 0) shrink(debt, key, y - part);
  }
}

/** Lo que queda de la deuda después de pagar una parte: si no queda nada, se borra. */
function shrink(debt: Map<string, number>, key: string, rest: number): void {
  if (rest > 1e-9) debt.set(key, rest);
  else debt.delete(key);
}

/** Lo que bajó la velocidad objetivo en este registro se reparte por peso y queda como deuda para los siguientes. */
function chargeTarget(act: Active[], target: number, debt: Map<string, number>): void {
  const W = act.reduce((a, [, , w]) => a + w, 0);
  for (const [l, key, w] of act) {
    const part = (target * w) / W;
    l.sec += part;
    debt.set(key, (debt.get(key) ?? 0) + part);
  }
}

export function diagnose(tr: Track, lap: Lap, standing: boolean): Diagnosis | null {
  const rec = blackBoxOf(lap);
  if (!rec) return null;
  const n = lap.tt.length, T = idealClock(tr);
  const tyOf = (k: number): Seg => tr.ty[idx(tr, k * TEL_DS)];
  const eff = rec.map((r) => effective(r, r.fuse));
  const def = eff.map((e, k) => deficits(tyOf(k), e, rec[k].bat, rec[k].bw));
  const { run, start } = splitRuns(n, tyOf);
  const x: Ctx = { tr, n, rec, tyOf, run, start, eff, ...rightSpans(def, run), out: new Map() };

  // ponytail: el atraso se cobra en proporción a lo que cada causa bajó la velocidad y todavía no se pagó.
  // Con dos causas encimadas el reparto es aproximado; para exacto, volver a simular la vuelta sin cada causa.
  const debt = new Map<string, number>(), q: number[] = [];
  let launch = standing;
  for (let k = 0; k < n; k++) {
    const s = k * TEL_DS, v0 = tr.v[idx(tr, s)], act: Active[] = [];
    const { tg, sc } = targetCauses(x, k, def[k], v0, act);
    q.push(sc);
    const ideal = T(Math.min(tr.len, s + TEL_DS)) - T(s), real = (k + 1 < n ? lap.tt[k + 1] : lap.t) - lap.tt[k];
    const target = ideal * (v0 / tg - 1), lag = real - ideal - target;
    // El atraso viene de antes: se cobra con las deudas de los registros anteriores, antes de sumar las de este.
    if (launch) {
      entry(x, k, 'start')[1].sec += lag;
      if (lap.v[k] >= tg * LAUNCHED) launch = false;
    } else chargeLag(x, k, lag, debt);
    chargeTarget(act, target, debt);
  }
  return { lap: lap.t, ideal: T(tr.len), losses: [...x.out.values()].sort((a, b) => b.sec - a.sec), q };
}

const memo = new WeakMap<Lap, { tr: Track; standing: boolean; d: Diagnosis | null }>();

/**
 * diagnose con memoria por vuelta. Una vuelta cerrada no cambia, y la piden el mensaje de fin de vuelta
 * y la telemetría (cada vez que se abre o se elige otra vuelta). Solo para vueltas cerradas.
 */
export function lapDiagnosis(tr: Track, lap: Lap, standing: boolean): Diagnosis | null {
  const m = memo.get(lap);
  if (m && m.tr === tr && m.standing === standing) return m.d;
  const d = diagnose(tr, lap, standing);
  memo.set(lap, { tr, standing, d });
  return d;
}
