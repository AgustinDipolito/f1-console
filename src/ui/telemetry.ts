import { lapDiagnosis, type Diagnosis, type Loss } from '../sim/diagnose';
import { PHYS } from '../sim/physics';
import { TEL_DS, categoryText, timeAt, type Category } from '../sim/telemetry';
import type { Lap, Track } from '../sim/types';
import { Q_COLORS, qBand } from '../trackview/trackview';
import { bindCompare, compareHtml, type Ghost } from './compare';
import { cap, f1, fmt } from './format';
import { SHOW_MIN, TOP, located, lossMarks, lossText, type LossMark } from './losses';
import { bindReplay, replayHtml, type Replay } from './replay';
import { H, PAD, W, chartX } from './replay-data';

export { lossMarks } from './losses';

type Series = { pts: [number, number][]; cls: string };
/** band: puntaje de cada registro, abajo del gráfico. marks: pérdidas numeradas. cursor: cantidad de registros de la vuelta de la repetición (fija la escala y dibuja el cursor). */
interface Extra { band?: number[]; marks?: LossMark[]; cursor?: number }

/** Gráfico de líneas en SVG: distancia en x. Los ejes salen de los datos. */
function chart(series: Series[], yName: string, zero: boolean, o: Extra = {}): string {
  const all = series.flatMap((s) => s.pts).filter(([, y]) => Number.isFinite(y));
  if (!all.length) return '';
  const x1 = o.cursor ? (o.cursor - 1) * TEL_DS : Math.max(...all.map(([x]) => x));
  let y0 = Math.min(...all.map(([, y]) => y)), y1 = Math.max(...all.map(([, y]) => y));
  if (zero) { const m = Math.max(Math.abs(y0), Math.abs(y1), 0.1); y0 = -m; y1 = m; }
  if (y1 - y0 < 1e-6) y1 = y0 + 1;
  const X = (x: number): number => chartX(x, x1);
  const Y = (y: number): number => PAD.t + (1 - (y - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
  const path = (s: Series): string => {
    let d = '', pen = false;
    for (const [x, y] of s.pts) {
      if (!Number.isFinite(y)) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(y).toFixed(1)}`;
      pen = true;
    }
    return `<path class="${s.cls}" d="${d}"/>`;
  };
  // La banda junta los registros seguidos del mismo color en un solo rectángulo.
  let band = '';
  const q = o.band ?? [];
  for (let k0 = 0, k = 1; k <= q.length; k++) {
    if (k < q.length && qBand(q[k]) === qBand(q[k0])) continue;
    band += `<rect x="${X(k0 * TEL_DS).toFixed(1)}" y="${H - PAD.b + 2}" width="${(X(k * TEL_DS) - X(k0 * TEL_DS)).toFixed(1)}" height="4" fill="${Q_COLORS[qBand(q[k0])]}"/>`;
    k0 = k;
  }
  const marks = (o.marks ?? []).map(({ s, n }) => {
    return `<line class="mark" x1="${X(s).toFixed(1)}" x2="${X(s).toFixed(1)}" y1="${PAD.t}" y2="${H - PAD.b}"/><text class="mark" x="${(X(s) + 3).toFixed(1)}" y="${PAD.t + 10}">${n}</text>`;
  }).join('');
  const ticks = [y0, (y0 + y1) / 2, y1];
  const km = [0, x1 / 2, x1];
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${yName} según la distancia">
    ${ticks.map((v) => `<line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${PAD.l - 6}" y="${Y(v) + 4}" text-anchor="end">${f1(v)}</text>`).join('')}
    ${km.map((v) => `<text x="${X(v)}" y="${H - 6}" text-anchor="middle">${f1(v / 1000)} km</text>`).join('')}
    <text x="${PAD.l}" y="${PAD.t - 6}" class="axis">${yName}</text>
    ${series.map(path).join('')}${band}${marks}${o.cursor ? `<line class="cursor" x1="${X(0)}" x2="${X(0)}" y1="${PAD.t}" y2="${H - PAD.b}"/>` : ''}
  </svg>`;
}

const speed = (l: Lap): [number, number][] => l.v.map((v, k) => [k * TEL_DS, v * 3.6]);

/** Cómo se agrupa cada pérdida en el resumen de la vuelta. */
const CATS: Record<string, string> = {
  late: 'Llegaste tarde al tramo',
  early: 'Cambiaste antes de tiempo',
  off: 'Distinto de lo que pide el tramo',
  bat: 'ERS en attack sin carga',
  fuse: 'Controles trabados por un fusible',
  hot: `Motor pasado de ${PHYS.TEMP_LIMIT}°`,
  tyre: 'Desgaste de gomas',
  fuel: 'Sin nafta',
  lim: 'Limitador puesto',
  start: 'Largada',
  other: 'Resto, sin causa en la consola',
};

function lossSection(d: Diagnosis, top: Loss[]): string {
  const sum = new Map<string, number>();
  for (const l of d.losses) { const c = l.when ?? l.cause; sum.set(c, (sum.get(c) ?? 0) + l.sec); }
  const shown = [...sum].filter(([, s]) => s >= SHOW_MIN).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...shown.map(([, s]) => s), 0.1);
  const rows = shown.map(([c, s]) => `<li><span class="cause">${CATS[c]}</span><span class="bar"><i style="width:${Math.max(2, (s / max) * 100).toFixed(1)}%"></i></span><b>${f1(s)} s</b></li>`).join('');
  const stat = (k: string, v: string, cls = ''): string => `<div class="stat ${cls}"><span>${k}</span><b>${v}</b></div>`;
  const see = (l: Loss): string => ` <button type="button" class="link" data-at="${Math.round(l.s0)}">ver</button>`;
  return `
    <section class="tcard">
      <h3>Pérdidas contra la vuelta ideal</h3>
      <div class="stats">${stat('Tu vuelta', fmt(d.lap))}${stat('Ideal', fmt(d.ideal))}${stat('De más', `${f1(d.lap - d.ideal)} s`, 'loss')}</div>
      ${rows ? `<ul class="causes">${rows}</ul>` : ''}
    </section>
    ${top.length ? `<section class="tcard"><h3>Dónde se perdió más</h3><ol class="losses">${top.map((l) => `<li>${cap(lossText(l))}${see(l)}</li>`).join('')}</ol></section>` : ''}
    <p class="hint">Es una estimación: lo que se pierde en un tramo se sigue pagando en los siguientes y se le cuenta al tramo donde empezó. La ideal es la vuelta con la consola justa en cada tramo, gomas nuevas y el motor por debajo de ${PHYS.TEMP_LIMIT}°.</p>`;
}

const vsBest = (l: Lap, ref: Lap | null): string => {
  if (!ref) return '—';
  const d = l.t - ref.t;
  return `${d >= 0 ? '+' : '−'}${f1(Math.abs(d))} s`;
};

function lapTable(laps: Lap[], ref: Lap | null, sel: string): string {
  if (!laps.length) return '';
  const rows = laps.map((l, i) => `<tr${`lap:${i}` === sel ? ' class="sel" aria-current="true"' : ''}><td>${i + 1}</td><td>${fmt(l.t)}</td><td>${vsBest(l, ref)}</td></tr>`).join('');
  return `<section class="tcard"><h3>Vueltas</h3><div class="scroll"><table class="laps"><thead><tr><th>Vuelta</th><th>Tiempo</th><th>Contra el récord</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

/** Con qué se compara y de dónde sale cada cosa que se puede mirar. */
export interface TelRefs {
  best: Lap | null; old: Lap | null; cat: Category | null;
  rival: { name: string; lap: Lap; cat: Category | null } | null;
}

/** Lo que se puede mirar: las vueltas de la sesión, el récord (si no es una de ellas) y la vuelta del rival. */
interface Opt { value: string; label: string; short: string; lap: Lap }

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function options(laps: Lap[], refs: TelRefs): Opt[] {
  const out = laps.map((l, i): Opt => ({ value: `lap:${i}`, label: `Vuelta ${i + 1} · ${fmt(l.t)}`, short: `Vuelta ${i + 1}`, lap: l }));
  if (refs.best && !laps.includes(refs.best)) out.push({ value: 'best', label: `Récord · ${fmt(refs.best.t)}`, short: 'Récord', lap: refs.best });
  if (refs.rival) out.push({ value: 'rival', label: `${refs.rival.name} · ${fmt(refs.rival.lap.t)}`, short: refs.rival.name, lap: refs.rival.lap });
  return out;
}

/** Contra quién se compara: el rival o, si no hay, el récord. */
function ghostOf(refs: TelRefs): Ghost | null {
  if (refs.rival) return { name: refs.rival.name, lap: refs.rival.lap, cat: refs.rival.cat, own: false };
  return refs.best ? { name: 'Récord', lap: refs.best, cat: refs.cat, own: true } : null;
}

function lapPicker(opts: Opt[], sel: string): string {
  if (opts.length < 2) return '';
  const o = opts.map((x) => `<option value="${x.value}"${x.value === sel ? ' selected' : ''}>${esc(x.label)}</option>`).join('');
  return `<label class="pick">Vuelta<select data-lap>${o}</select></label>`;
}

const card = (title: string, inner: string, note = ''): string => (inner ? `<section class="tcard"><h3>${title}</h3>${note}${inner}</section>` : '');

function speedChart(cur: Lap | null, ref: Lap | null, d: Diagnosis | null, top: Loss[]): string {
  const sp: Series[] = [];
  if (ref) sp.push({ pts: speed(ref), cls: 'ref' });
  if (cur) sp.push({ pts: speed(cur), cls: 'cur' });
  return chart(sp, 'Velocidad (km/h)', false, { band: d?.q, marks: lossMarks(top), cursor: cur?.tt.length }) + (d ? '<p class="hint">Abajo, la eficacia de la consola en cada tramo: verde bien, ámbar regular, rojo mal. Los números marcan las pérdidas de la lista.</p>' : '');
}

function deltaChart(cur: Lap | null, ref: Lap | null): string {
  if (!cur || !ref || cur === ref) return '';
  return chart([{ pts: cur.tt.map((t, k) => [k * TEL_DS, t - timeAt(ref, k * TEL_DS)]), cls: 'cur' }], 'Δ contra el récord (s)', true);
}

function legend(short: string, ref: Lap | null, refs: TelRefs): string {
  const rec = refs.cat ? `Récord en ${categoryText(refs.cat)}` : 'Récord';
  const old = refs.old ? `<p class="hint">Récord anterior, de otra categoría: ${fmt(refs.old.t)}. No se compara.</p>` : '';
  return `<p class="legend"><span class="sw cur"></span>${esc(short)} <span class="sw ref"></span>${ref ? `${rec} · ${fmt(ref.t)}` : 'Sin récord en esta categoría'}</p>${old}`;
}

/** Lo que se calcula de la vuelta elegida: su diagnóstico (con memoria por vuelta) y las pérdidas con lugar. */
function analyze(tr: Track | null, cur: Lap | null, sel: string): { d: Diagnosis | null; top: Loss[] } {
  const d = tr && cur ? lapDiagnosis(tr, cur, sel === 'lap:0') : null;
  return { d, top: d ? located(d).slice(0, TOP) : [] };
}

/** Contenido del diálogo con la opción `sel` elegida. */
function telemetryHtml(tr: Track | null, laps: Lap[], refs: TelRefs, sel: string): string {
  const opts = options(laps, refs), o = opts.find((x) => x.value === sel), cur = o?.lap ?? null, ghost = ghostOf(refs);
  const { d, top } = analyze(tr, cur, sel);
  const rp = tr && cur ? replayHtml({ tr, lap: cur, losses: top }) : '';
  const cmp = tr && cur && ghost && ghost.lap !== cur ? compareHtml(tr, cur, ghost, refs.cat) : '';
  const body = opts.length
    ? `${card('Velocidad', speedChart(cur, refs.best, d, top), legend(o?.short ?? '', refs.best, refs))}${rp}${cmp}${card('Diferencia contra el récord', deltaChart(cur, refs.best))}${d ? lossSection(d, top) : ''}${lapTable(laps, refs.best, sel)}`
    : '<p class="empty">Todavía no hay vueltas cerradas. Completá una y volvé.</p>';
  return `
    <form method="dialog">
      <header class="thead"><h2 tabindex="-1" autofocus>Telemetría</h2>${lapPicker(opts, sel)}</header>
      ${body}
      <div class="actions"><button value="close">Cerrar</button></div>
    </form>`;
}

/** Lleva la repetición a la vista del diálogo. */
const showReplay = (dlg: HTMLElement): void => dlg.querySelector('.rp')?.scrollIntoView({ block: 'nearest' });

/** Engancha la repetición y la comparación al dibujo recién hecho; un clic en «ver» mueve el cursor. */
function wire(dlg: HTMLDialogElement, tr: Track | null, cur: Lap | null, top: Loss[], ghost: Ghost | null): Replay | undefined {
  if (!tr || !cur) return undefined;
  const rp = bindReplay(dlg, { tr, lap: cur, losses: top });
  if (ghost && ghost.lap !== cur) bindCompare(dlg, tr, cur, ghost);
  dlg.querySelector('form')?.addEventListener('click', (e) => {
    const at = (e.target as Element).closest<HTMLElement>('[data-at]');
    if (!at) return;
    rp.seek(Number(at.dataset.at));
    showReplay(dlg);
  });
  return rp;
}

/** La opción que se abre: la que pide `at`, o la última vuelta; sin vueltas, la primera opción. */
function firstSel(laps: Lap[], opts: Opt[], at?: { lap: number; s: number }): string {
  if (at && laps[at.lap]) return `lap:${at.lap}`;
  return laps.length ? `lap:${laps.length - 1}` : opts[0]?.value ?? '';
}

export function openTelemetry(dlg: HTMLDialogElement, tr: Track | null, laps: Lap[], refs: TelRefs, at?: { lap: number; s: number }): void {
  const opts = options(laps, refs), ghost = ghostOf(refs);
  let rp: Replay | undefined;
  const draw = (sel: string, focus = false): void => {
    rp?.stop();
    dlg.innerHTML = telemetryHtml(tr, laps, refs, sel);
    const cur = opts.find((x) => x.value === sel)?.lap ?? null;
    rp = wire(dlg, tr, cur, analyze(tr, cur, sel).top, ghost);
    const pick = dlg.querySelector<HTMLSelectElement>('select[data-lap]');
    pick?.addEventListener('change', () => draw(pick.value, true));
    if (focus) pick?.focus();
  };
  dlg.className = 'wide tel';
  const sel = firstSel(laps, opts, at);
  draw(sel);
  dlg.addEventListener('close', () => rp?.stop(), { once: true });
  dlg.showModal();
  if (at && sel === `lap:${at.lap}`) {
    rp?.seek(at.s);
    showReplay(dlg);
    dlg.querySelector<HTMLElement>('.rp-range')?.focus({ preventScroll: true });
  }
}
