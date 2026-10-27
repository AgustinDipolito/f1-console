import { MACROS } from '../console/panel';
import { FUSED, idx, posAt } from '../sim/car';
import type { SegDiff } from '../sim/compare';
import { splitRuns, type Loss } from '../sim/diagnose';
import { PHYS } from '../sim/physics';
import { CTL_KEYS, SM_DS, TEL_DS, controlsAt, smAt } from '../sim/telemetry';
import type { Ctl, CtlKey, Ev, Lap, Rec, Sm, Track, Vec2 } from '../sim/types';
import { KNOB_LABEL, KNOB_NAMES, SEG_NAMES, cap, f1, fmt } from './format';

/** Lo puro de la repetición y la comparación de la telemetría: se prueba en Node, sin DOM. */

export const W = 520, H = 150, PAD = { l: 44, r: 28, t: 18, b: 24 };
/** Posición horizontal de la distancia s en el gráfico y en la línea de tiempo (x1: distancia del último registro). */
export const chartX = (s: number, x1: number): number => PAD.l + (Math.min(Math.max(s, 0), x1) / (x1 || 1)) * (W - PAD.l - PAD.r);

const DASH = '—';
const r1 = (v: number): number => Math.round(v * 10) / 10;

/** Registro del tiempo de vuelta t, avanzando desde from; saltea NaN. */
export function kAt(tt: number[], t: number, from: number): number {
  let k = from;
  for (let j = from + 1; j < tt.length && !(tt[j] > t); j++) if (!Number.isNaN(tt[j])) k = j;
  return k;
}

// ——— Línea de tiempo ———

export type MarkKind = 'loss' | 'ctl' | 'macro' | 'fuse' | 'hot' | 'seg';
export interface Mark { k: number; kind: MarkKind; to?: number }
/** Orden de dibujo y de desempate dentro de un mismo registro. */
const KIND_ORDER: MarkKind[] = ['seg', 'hot', 'ctl', 'macro', 'fuse', 'loss'];
/** Eventos seguidos del mismo control a menos de esto se muestran como uno. */
const JOIN_M = 20;
/** Un mismo cambio hecho por los dos autos con menos de esto de diferencia no cuenta como distinto. */
const PAIR_M = 10;

/** Junta los eventos seguidos de un mismo control a menos de 20 m: deja la primera distancia y el último valor. */
export function collapse(evs: Ev[]): Ev[] {
  const out: Ev[] = [], last = new Map<string, { e: Ev; s: number }>();
  for (const e of evs) {
    // Cada fusible y cada macro es su propio control: su valor dice cuál es, no cuánto.
    const key = e.k === 'rst' || e.k === 'macro' ? `${e.k}${e.v}` : e.k, p = last.get(key);
    if (p && e.s - p.s < JOIN_M) { p.e.v = e.v; p.s = e.s; continue; }
    const c = { ...e };
    out.push(c);
    last.set(key, { e: c, s: e.s });
  }
  return out;
}

/** Tandas de registros seguidos que cumplen ok: [primero, último]. */
function runsOf(n: number, ok: (k: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    if (!ok(k)) continue;
    const last = out[out.length - 1];
    if (last && last[1] === k - 1) last[1] = k; else out.push([k, k]);
  }
  return out;
}

/** Temperatura del motor en el registro k: la de la caja negra o la muestra más cercana. */
const tempAt = (lap: Lap, k: number): number => lap.rec?.[k]?.temp ?? smAt(lap, k * TEL_DS)?.temp ?? NaN;

/** Registros donde un fusible pasa a saltado. Solo con caja negra. */
function fuseMarks(rec: Rec[]): Mark[] {
  const out: Mark[] = [];
  for (let k = 1; k < rec.length; k++) if (rec[k]?.fuse.some((on, f) => on && !rec[k - 1]?.fuse[f])) out.push({ k, kind: 'fuse' });
  return out;
}

/** Todo lo que pasó en la vuelta, ordenado por registro: tramos, cambios, macros, fusibles, motor caliente y pérdidas. Una marca por tipo y registro. */
export function timeline(tr: Track, lap: Lap, losses: Loss[]): Mark[] {
  const n = lap.tt.length, kOf = (s: number): number => Math.max(0, Math.min(n - 1, Math.floor(s / TEL_DS)));
  const marks: Mark[] = [
    ...splitRuns(n, (k) => tr.ty[idx(tr, k * TEL_DS)]).start.map((k): Mark => ({ k, kind: 'seg' })),
    ...collapse(lap.ev ?? []).map((e): Mark => ({ k: kOf(e.s), kind: e.k === 'macro' ? 'macro' : 'ctl' })),
    ...fuseMarks(lap.rec ?? []),
    ...runsOf(n, (k) => tempAt(lap, k) >= PHYS.TEMP_LIMIT).map(([k, to]): Mark => ({ k, kind: 'hot', to })),
    ...losses.map((l): Mark => ({ k: kOf(l.s0), kind: 'loss' })),
  ];
  const seen = new Set<string>();
  return marks
    .filter((m) => { const key = `${m.k}|${m.kind}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((a, b) => a.k - b.k || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

/** La línea de tiempo con la escala horizontal del gráfico de velocidad, y el cursor en el registro 0. */
export function timelineSvg(marks: Mark[], n: number): string {
  const x1 = (n - 1) * TEL_DS, X = (k: number): number => r1(chartX(k * TEL_DS, x1));
  const draw = (m: Mark): string => {
    const x = X(m.k);
    switch (m.kind) {
      case 'hot': return `<rect class="tl-hot" x="${x}" y="1" width="${r1(Math.max(2, X(m.to ?? m.k) - x))}" height="4"/>`;
      case 'ctl': return `<line class="tl-ev" x1="${x}" x2="${x}" y1="9" y2="21"/>`;
      case 'macro': return `<path class="tl-mac" d="M${x} 10l4 10h-8z"/>`;
      case 'fuse': return `<rect class="tl-fuse" x="${r1(x - 4)}" y="12" width="8" height="8"/>`;
      case 'loss': return `<path class="tl-loss" d="M${x} 9l5 6-5 6-5-6z"/>`;
      default: return `<line class="tl-seg" x1="${x}" x2="${x}" y1="26" y2="31"/>`;
    }
  };
  const c = X(0);
  return `<svg viewBox="0 0 ${W} 32" class="tl" role="img" aria-label="Línea de tiempo de la vuelta">${marks.map(draw).join('')}<line class="tl-cur" x1="${c}" x2="${c}" y1="0" y2="32"/></svg>`;
}

/** Evento anterior o siguiente sin contar inicios de tramo; si no hay, k. */
export function stepTo(marks: Mark[], k: number, dir: 1 | -1): number {
  const ks = marks.filter((m) => m.kind !== 'seg').map((m) => m.k).filter((x) => (dir > 0 ? x > k : x < k));
  return ks.length ? (dir > 0 ? Math.min(...ks) : Math.max(...ks)) : k;
}

// ——— Lectura en un punto de la vuelta ———

export const READ: [key: string, label: string][] = [
  ['s', 'Distancia'], ['t', 'Tiempo'], ['v', 'Velocidad'], ['ty', 'Tramo'],
  ['lev', 'Potencia'], ['ers', 'ERS'], ['bal', 'Frenos'], ['dif', 'Diferencial'], ['eb', 'Freno motor'], ['lim', 'Limitador'],
  ['fuse', 'Fusibles'], ['bat', 'Batería'], ['temp', 'Motor'], ['tyre', 'Gomas'], ['fuel', 'Nafta'],
];

const f2 = (x: number): string => x.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const finite = (x: number, f: (x: number) => string): string => (Number.isFinite(x) ? f(x) : DASH);
const named = (k: keyof typeof KNOB_NAMES, v: number): string => cap(KNOB_NAMES[k][v] ?? DASH);

function ctlCols(c: Ctl | null): string[] {
  if (!c) return new Array<string>(6).fill(DASH);
  return [named('lev', c.lev), named('ers', c.ers), `${c.bal} %`, named('dif', c.dif), named('eb', c.eb), c.lim ? 'Puesto' : 'Apagado'];
}

function fuseText(fuse: boolean[]): string {
  const on = FUSED.filter((_, f) => fuse[f]);
  return on.length === 0 ? 'En orden' : on.length === 1 ? `Saltó ${KNOB_LABEL[on[0]]}` : `Saltaron ${on.length}`;
}

const carCols = (a: Sm | null): string[] =>
  (a ? [`${Math.round(a.bat)} %`, `${Math.round(a.temp)}°`, `${Math.round(a.tyre)} %`, `${f1(a.fuel)} kg`] : new Array<string>(4).fill(DASH));

/** Por registro, los valores de READ en ese orden. Con caja negra sale todo; sin ella, lo que alcance a reconstruirse y «—» en el resto. */
export function replayRows(tr: Track, lap: Lap): string[][] {
  return lap.tt.map((t, k) => {
    const s = k * TEL_DS, r = lap.rec?.[k];
    return [
      `${f2(s / 1000)} km`, finite(t, fmt), finite(lap.v[k], (v) => `${Math.round(v * 3.6)} km/h`), cap(SEG_NAMES[tr.ty[idx(tr, s)]]),
      ...ctlCols(controlsAt(lap, s)), r ? fuseText(r.fuse) : DASH, ...carCols(r ?? smAt(lap, s)),
    ];
  });
}

/** Qué falta en una vuelta que no se corrió en esta sesión. */
export function missingNote(lap: Lap): string {
  if (lap.rec?.length) return '';
  if (!lap.ev) return 'Esta vuelta es de antes de que se guardaran los comandos. Se ven la velocidad y el tiempo, no la consola ni el auto.';
  return `Esta vuelta guarda los cambios de la consola y el estado del auto cada ${SM_DS} m. Los fusibles no se ven.`;
}

// ——— Mapa chico ———

const MW = 200, MH = 140, MARGIN = 12;

/** El trazado centrado y escalado en 200 × 140, los rombos de pérdida y la posición proyectada de cada registro. */
export function miniMap(tr: Track, n: number, lossS: number[]): { inner: string; xy: [number, number][] } {
  const xs = tr.q.map((p) => p[0]), ys = tr.q.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sc = Math.min((MW - 2 * MARGIN) / Math.max(x1 - x0, 1), (MH - 2 * MARGIN) / Math.max(y1 - y0, 1));
  // El mundo tiene y hacia arriba, como en el mapa grande.
  const P = (p: Vec2): [number, number] => [r1(MW / 2 + (p[0] - (x0 + x1) / 2) * sc), r1(MH / 2 - (p[1] - (y0 + y1) / 2) * sc)];
  const road = `${tr.q.map((p, i) => `${i ? 'L' : 'M'}${P(p).join(' ')}`).join('')}Z`;
  const loss = lossS.map((s) => { const [x, y] = P(posAt(tr, s)); return `<path class="rp-loss" d="M${x} ${r1(y - 5)}l5 5-5 5-5-5z"/>`; }).join('');
  return { inner: `<path class="rp-road" d="${road}"/>${loss}`, xy: Array.from({ length: n }, (_, k) => P(posAt(tr, k * TEL_DS))) };
}

// ——— Texto de los eventos y comparación ———

const rel = (e: Ev, s0: number): number => Math.round(e.s - s0);

/** Qué hizo el evento, sin la distancia: «potencia → push». */
function what(e: Ev): string {
  switch (e.k) {
    case 'bal': return `frenos → ${e.v} %`;
    case 'lim': return `limitador ${e.v ? 'puesto' : 'sacado'}`;
    case 'rst': return `rearme del fusible de ${KNOB_LABEL[FUSED[e.v]]}`;
    case 'macro': return `macro ${MACROS[e.v].name}`;
    default: return `${KNOB_LABEL[e.k]} → ${KNOB_NAMES[e.k][e.v]}`;
  }
}

/** «+120 m potencia → push»: s0 es el inicio del tramo (o 0 para contar desde la línea). */
export const evText = (e: Ev, s0: number): string => `+${rel(e, s0)} m ${what(e)}`;

export type CmpView = 'me' | 'rival' | 'diff';

const LABEL: Record<CtlKey, string> = { ...KNOB_LABEL, lim: 'limitador' };
const valueText = (k: CtlKey, v: number): string => (k === 'bal' ? `${v} %` : k === 'lim' ? (v ? 'puesto' : 'apagado') : KNOB_NAMES[k][v]);
/** «en push»; el limitador va sin «en»: «vos puesto». */
const inText = (k: CtlKey, v: number): string => `${k === 'lim' ? '' : 'en '}${valueText(k, v)}`;

/** Lo que tenía distinto cada consola justo antes de entrar al tramo. Sin consola de alguna de las dos, nada. */
function entryRows(d: SegDiff, a: Lap, b: Lap, who: string): string[] {
  const ca = controlsAt(a, d.s0 - 1e-3), cb = controlsAt(b, d.s0 - 1e-3);
  if (!ca || !cb) return [];
  return CTL_KEYS.filter((k) => ca[k] !== cb[k]).map((k) => `Al entrar: ${LABEL[k]}, vos ${inText(k, ca[k])} y ${who} ${inText(k, cb[k])}`);
}

interface Pair { a?: Ev; b?: Ev }
const sameEv = (x: Ev, y: Ev): boolean => x.k === y.k && x.v === y.v;

/** Aparea los eventos de a con los de b por control y valor, en orden; lo que no tiene par queda solo. */
function pairUp(a: Ev[], b: Ev[]): Pair[] {
  const left = [...b];
  const pairs = a.map((e): Pair => { const i = left.findIndex((x) => sameEv(x, e)); return { a: e, b: i < 0 ? undefined : left.splice(i, 1)[0] }; });
  return [...pairs, ...left.map((e): Pair => ({ b: e }))];
}

/** El renglón de un par y dónde ocurrió (para ordenar); null si los dos lo hicieron casi en el mismo lugar. */
function pairLine({ a, b }: Pair, s0: number, who: string): [number, string] | null {
  const e = (a ?? b) as Ev, at = (x: Ev): string => `+${rel(x, s0)} m`, head = cap(what(e));
  if (a && b) return Math.abs(a.s - b.s) < PAIR_M ? null : [Math.min(a.s, b.s), `${head}: vos a ${at(a)}, ${who} a ${at(b)}`];
  return [e.s, `${head}: ${a ? `vos a ${at(a)}, ${who} no` : `${who} a ${at(e)}, vos no`}`];
}

/** Los renglones de un tramo: los eventos de cada uno, o lo que hicieron distinto. */
export function cmpRows(d: SegDiff, a: Lap, b: Lap, who: string, view: CmpView): string[] {
  if (view !== 'diff') {
    const evs = collapse(view === 'me' ? d.evA : d.evB);
    return evs.length ? evs.map((e) => evText(e, d.s0)) : ['Sin cambios'];
  }
  const lines = pairUp(collapse(d.evA), collapse(d.evB)).map((p) => pairLine(p, d.s0, who)).filter((l): l is [number, string] => l !== null).sort((x, y) => x[0] - y[0]);
  const rows = [...entryRows(d, a, b, who), ...lines.map(([, t]) => t)];
  return rows.length ? rows : ['Mismos comandos'];
}

/** «Frenada a 1,2 km». */
export const segTitle = (d: SegDiff): string => `${cap(SEG_NAMES[d.ty])} a ${f1(d.s0 / 1000)} km`;
export const gainText = (g: number): string => (g >= 0 ? `perdés ${f1(g)} s` : `ganás ${f1(-g)} s`);
