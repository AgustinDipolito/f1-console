import type { LastResult } from '../config';
import { fmt } from './format';

export interface ResultActions {
  again(): void;
  otherCircuit(): void;
  telemetry(): void;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Pantalla de resultados: queda abierta hasta que el jugador elija qué hacer; nada se reinicia solo. */
export function openResults(dlg: HTMLDialogElement, circuit: string, res: LastResult, a: ResultActions): void {
  const bestAll = Math.min(...res.rows.map((r) => r.best ?? Infinity));
  const rows = res.rows.map((r) => `<tr${r.me ? ' class="me"' : ''}><td>${r.pos}.º</td><td>${esc(r.name)}</td><td>${r.fin === null ? 'sin terminar' : fmt(r.fin)}</td><td>${fmt(r.best)}${r.best !== null && r.best === bestAll ? '<span class="fast">la más rápida</span>' : ''}</td></tr>`).join('');
  dlg.innerHTML = `<h2>Resultados</h2><p class="tot">${esc(circuit)} · ${res.laps} ${res.laps === 1 ? 'vuelta' : 'vueltas'}</p>
<table class="results"><thead><tr><th>Puesto</th><th>Piloto</th><th>Tiempo</th><th>Mejor vuelta</th></tr></thead><tbody>${rows}</tbody></table>
<div class="actions"><button data-a="tel">Telemetría</button><button data-a="other">Otro circuito</button><button data-a="again" class="primary">Correr de nuevo</button><button data-a="close">Cerrar</button></div>`;
  const act: Record<string, () => void> = { tel: a.telemetry, other: a.otherCircuit, again: a.again, close: () => undefined };
  dlg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.a ?? 'close';
    dlg.close();
    act[k]?.();
  }));
  if (!dlg.open) dlg.showModal();
}
