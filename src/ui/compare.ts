import { compareLaps, type SegDiff } from '../sim/compare';
import { categoryText, sameCategory, type Category } from '../sim/telemetry';
import type { Lap, Track } from '../sim/types';
import { fmt } from './format';
import { SHOW_MIN } from './losses';
import { cmpRows, gainText, segTitle, type CmpView } from './replay-data';

/** Tu vuelta contra un fantasma (el récord o el de otro jugador), tramo por tramo, con lo que hizo cada uno en la consola. */

export interface Ghost { name: string; lap: Lap; cat: Category | null; own: boolean }

/** Cuántos tramos se muestran, los de más diferencia. */
const MAX_SEGS = 8;
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Los tramos con más diferencia, de mayor a menor. */
const topOf = (all: SegDiff[]): SegDiff[] =>
  all.filter((d) => Math.abs(d.gain) >= SHOW_MIN).sort((x, y) => Math.abs(y.gain) - Math.abs(x.gain)).slice(0, MAX_SEGS);

function items(ds: SegDiff[], a: Lap, g: Ghost, view: CmpView): string {
  if (!ds.length) return '<li>Sin diferencias de tiempo que valga la pena mostrar.</li>';
  return ds.map((d) => `<li><div class="cmp-head"><b>${segTitle(d)}</b><span class="cmp-gain">${gainText(d.gain)}</span></div>
    <ul class="cmp-ev">${cmpRows(d, a, g.lap, g.name, view).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    <button type="button" class="link" data-at="${Math.round(d.s0)}">ver</button></li>`).join('');
}

const hasCmds = (a: Lap, g: Ghost): boolean => !!(a.ev && g.lap.ev);

function views(g: Ghost): string {
  const opt = (v: CmpView, label: string): string => `<label><input type="radio" name="cmpv" value="${v}"${v === 'diff' ? ' checked' : ''}><span>${esc(label)}</span></label>`;
  return `<div class="field"><span>Comandos</span><span class="seg" role="radiogroup" aria-label="Qué comandos ver">${opt('me', 'Yo')}${opt('rival', g.own ? 'Récord' : g.name)}${opt('diff', 'Diferencias')}</span></div>`;
}

function notes(a: Lap, g: Ghost, cat: Category | null): string {
  const out: string[] = [];
  if (!g.lap.ev) out.push('Este fantasma es de una versión anterior y no trae los comandos. Se ve dónde ganó o perdió tiempo, no qué hizo.');
  if (cat && g.cat && !sameCategory(cat, g.cat)) {
    out.push(`Es de otra categoría (${categoryText(g.cat)}, la tuya es ${categoryText(cat)}). Con otra carga de nafta los tiempos no se comparan del todo.`);
  }
  return out.map((t) => `<p class="hint">${t}</p>`).join('');
}

/** La tarjeta de comparación; vacía si las vueltas no tienen la misma cantidad de registros. */
export function compareHtml(tr: Track, a: Lap, g: Ghost, cat: Category | null): string {
  const all = compareLaps(tr, a, g.lap);
  if (!all.length) return '';
  const title = g.own ? 'Contra tu récord' : `Contra el fantasma de ${esc(g.name)}`;
  return `<section class="tcard cmp"><h3>${title} · ${fmt(g.lap.t)}</h3>${notes(a, g, cat)}${hasCmds(a, g) ? views(g) : ''}
    <ol class="cmp-list">${items(topOf(all), a, g, 'diff')}</ol></section>`;
}

/** Un cambio de vista reescribe solo la lista. */
export function bindCompare(root: HTMLElement, tr: Track, a: Lap, g: Ghost): void {
  const list = root.querySelector<HTMLElement>('.cmp-list');
  if (!list || !hasCmds(a, g)) return;
  const ds = topOf(compareLaps(tr, a, g.lap));
  root.querySelectorAll<HTMLInputElement>('input[name="cmpv"]').forEach((r) =>
    r.addEventListener('change', () => { if (r.checked) list.innerHTML = items(ds, a, g, r.value as CmpView); }));
}
