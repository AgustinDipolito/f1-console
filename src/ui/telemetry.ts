import { lapDiagnosis, type Diagnosis, type Loss } from '../sim/diagnose';
import { PHYS } from '../sim/physics';
import { TEL_DS, timeAt } from '../sim/telemetry';
import type { Lap, Track } from '../sim/types';
import { Q_COLORS, qBand } from '../trackview/trackview';
import { cap, f1, fmt } from './format';
import { SHOW_MIN, TOP, located, lossMarks, lossText, type LossMark } from './losses';

export { lossMarks } from './losses';

const W = 520;
const H = 150;
/** Arriba queda lugar para el nombre del eje: la curva llega al tope y lo tapaba. */
const PAD = { l: 44, r: 28, t: 18, b: 24 };
type Series = { pts: [number, number][]; cls: string };
/** band: puntaje de cada registro, abajo del gráfico. marks: pérdidas numeradas. */
interface Extra { band?: number[]; marks?: LossMark[] }

/** Gráfico de líneas en SVG: distancia en x. Los ejes salen de los datos. */
function chart(series: Series[], yName: string, zero: boolean, o: Extra = {}): string {
  const all = series.flatMap((s) => s.pts).filter(([, y]) => Number.isFinite(y));
  if (!all.length) return '';
  const x1 = Math.max(...all.map(([x]) => x));
  let y0 = Math.min(...all.map(([, y]) => y)), y1 = Math.max(...all.map(([, y]) => y));
  if (zero) { const m = Math.max(Math.abs(y0), Math.abs(y1), 0.1); y0 = -m; y1 = m; }
  if (y1 - y0 < 1e-6) y1 = y0 + 1;
  const X = (x: number): number => PAD.l + (Math.min(x, x1) / x1) * (W - PAD.l - PAD.r);
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
    ${series.map(path).join('')}${band}${marks}
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
  return `
    <section class="tcard">
      <h3>Pérdidas contra la vuelta ideal</h3>
      <div class="stats">${stat('Tu vuelta', fmt(d.lap))}${stat('Ideal', fmt(d.ideal))}${stat('De más', `${f1(d.lap - d.ideal)} s`, 'loss')}</div>
      ${rows ? `<ul class="causes">${rows}</ul>` : ''}
    </section>
    ${top.length ? `<section class="tcard"><h3>Dónde se perdió más</h3><ol class="losses">${top.map((l) => `<li>${cap(lossText(l))}</li>`).join('')}</ol></section>` : ''}
    <p class="hint">Es una estimación: lo que se pierde en un tramo se sigue pagando en los siguientes y se le cuenta al tramo donde empezó. La ideal es la vuelta con la consola justa en cada tramo, gomas nuevas y el motor por debajo de ${PHYS.TEMP_LIMIT}°.</p>`;
}

const vsBest = (l: Lap, ref: Lap | null): string => {
  if (!ref) return '—';
  const d = l.t - ref.t;
  return `${d >= 0 ? '+' : '−'}${f1(Math.abs(d))} s`;
};

function lapTable(laps: Lap[], ref: Lap | null, sel: number): string {
  if (!laps.length) return '';
  const rows = laps.map((l, i) => `<tr${i === sel ? ' class="sel" aria-current="true"' : ''}><td>${i + 1}</td><td>${fmt(l.t)}</td><td>${vsBest(l, ref)}</td></tr>`).join('');
  return `<section class="tcard"><h3>Vueltas</h3><div class="scroll"><table class="laps"><thead><tr><th>Vuelta</th><th>Tiempo</th><th>Contra la mejor</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function lapPicker(laps: Lap[], sel: number): string {
  if (laps.length < 2) return '';
  const opts = laps.map((l, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${i + 1} · ${fmt(l.t)}</option>`).join('');
  return `<label class="pick">Vuelta<select data-lap>${opts}</select></label>`;
}

const card = (title: string, inner: string, note = ''): string => (inner ? `<section class="tcard"><h3>${title}</h3>${note}${inner}</section>` : '');

function speedChart(cur: Lap | null, ref: Lap | null, d: Diagnosis | null, top: Loss[]): string {
  const sp: Series[] = [];
  if (ref) sp.push({ pts: speed(ref), cls: 'ref' });
  if (cur) sp.push({ pts: speed(cur), cls: 'cur' });
  return chart(sp, 'Velocidad (km/h)', false, { band: d?.q, marks: lossMarks(top) }) + (d ? '<p class="hint">Abajo, la eficacia de la consola en cada tramo: verde bien, ámbar regular, rojo mal. Los números marcan las pérdidas de la lista.</p>' : '');
}

function deltaChart(cur: Lap | null, ref: Lap | null): string {
  if (!cur || !ref) return '';
  return chart([{ pts: cur.tt.map((t, k) => [k * TEL_DS, t - timeAt(ref, k * TEL_DS)]), cls: 'cur' }], 'Δ contra la mejor (s)', true);
}

function legend(cur: Lap | null, ref: Lap | null, sel: number): string {
  const mine = cur ? `<span class="sw cur"></span>Vuelta ${sel + 1}` : '';
  return `<p class="legend">${mine} <span class="sw ref"></span>Mejor vuelta en este circuito${ref ? ` · ${fmt(ref.t)}` : ''}</p>`;
}

/** Contenido del diálogo con la vuelta `sel` elegida. */
function telemetryHtml(tr: Track | null, laps: Lap[], ref: Lap | null, sel: number): string {
  const cur = laps[sel] ?? null;
  const d = tr && cur ? lapDiagnosis(tr, cur, sel === 0) : null, top = d ? located(d).slice(0, TOP) : [];
  const body = laps.length || ref
    ? `${card('Velocidad', speedChart(cur, ref, d, top), legend(cur, ref, sel))}${card('Diferencia contra la mejor', deltaChart(cur, ref))}${d ? lossSection(d, top) : ''}${lapTable(laps, ref, sel)}`
    : '<p class="empty">Todavía no hay vueltas cerradas. Completá una y volvé.</p>';
  return `
    <form method="dialog">
      <header class="thead"><h2 tabindex="-1" autofocus>Telemetría</h2>${lapPicker(laps, sel)}</header>
      ${body}
      <div class="actions"><button value="close">Cerrar</button></div>
    </form>`;
}

export function openTelemetry(dlg: HTMLDialogElement, tr: Track | null, laps: Lap[], best: Lap | null): void {
  const html = (sel: number): string => telemetryHtml(tr, laps, best, sel);
  const draw = (sel: number, focus = false): void => {
    dlg.innerHTML = html(sel);
    const pick = dlg.querySelector<HTMLSelectElement>('select[data-lap]');
    pick?.addEventListener('change', () => draw(Number(pick.value), true));
    if (focus) pick?.focus();
  };
  dlg.className = 'wide tel';
  draw(laps.length - 1);
  dlg.showModal();
}
