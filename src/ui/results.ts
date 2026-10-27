import type { LastResult, Verdict } from '../config';
import { fmt } from './format';

export interface ResultActions {
  again(): void;
  /** Otro circuito, o en desafío otro desafío. */
  other(): void;
  telemetry(): void;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Veredicto del modo: el borde dice si se ganó (verde), se perdió (rojo) o no hubo resultado (gris), y el título lo dice en palabras. */
function verdictHtml(v: Verdict | undefined): string {
  if (!v) return '';
  const tone = v.ok === null ? '' : v.ok ? ' ok' : ' no';
  return `<div class="verdict${tone}"><b>${esc(v.title)}</b><ul>${v.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>`;
}

/** La categoría escrita; un resultado de antes de las categorías solo sabe sus vueltas. */
const catText = (res: LastResult): string => res.cat ?? `${res.laps} ${res.laps === 1 ? 'vuelta' : 'vueltas'}`;

function tableHtml(res: LastResult): string {
  const bestAll = Math.min(...res.rows.map((r) => r.best ?? Infinity));
  const rows = res.rows.map((r) => `<tr${r.me ? ' class="me"' : ''}><td>${r.pos}.º</td><td>${esc(r.name)}${r.trait ? `<span class="trait">${esc(r.trait)}</span>` : ''}</td><td>${r.fin === null ? 'sin terminar' : fmt(r.fin)}</td><td>${fmt(r.best)}${r.best !== null && r.best === bestAll ? '<span class="fast">la más rápida</span>' : ''}</td></tr>`).join('');
  return `<table class="results"><thead><tr><th>Puesto</th><th>Piloto</th><th>Tiempo</th><th>Mejor vuelta</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/**
 * Pantalla de resultados: queda abierta hasta que el jugador elija qué hacer; nada se reinicia solo.
 * replay: hay una pérdida con lugar a la que llevar la repetición, y el botón lo dice. Sin tabla cuando corrés solo y hay veredicto.
 */
export function openResults(dlg: HTMLDialogElement, circuit: string, res: LastResult, a: ResultActions, replay = false): void {
  const table = res.rows.length > 1 || !res.verdict ? tableHtml(res) : '';
  dlg.innerHTML = `<h2>${esc(res.title ?? 'Resultados')}</h2><p class="tot">${esc(circuit)} · ${esc(catText(res))}</p>
${verdictHtml(res.verdict)}${table}${res.key ? `<p class="key">${esc(res.key)}</p>` : ''}
<div class="actions"><button data-a="tel">${replay ? 'Ver en la repetición' : 'Telemetría'}</button><button data-a="other">${res.mode === 'challenge' ? 'Otro desafío' : 'Otro circuito'}</button><button data-a="again" class="primary">Correr de nuevo</button><button data-a="close">Cerrar</button></div>`;
  const act: Record<string, () => void> = { tel: a.telemetry, other: a.other, again: a.again, close: () => undefined };
  dlg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.a ?? 'close';
    dlg.close();
    act[k]?.();
  }));
  if (!dlg.open) dlg.showModal();
}
