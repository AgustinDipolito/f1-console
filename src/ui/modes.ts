import { MODES, type Mode } from '../config';
import { HEAD_STARTS } from '../sim/chase';
import { CHALLENGES } from '../sim/scenario';
import { categoryOf, categoryText } from '../sim/telemetry';
import { fmt } from './format';
import { MODE_INFO, challengeOf } from './modes-data';

/**
 * Diálogo Modo: una tarjeta por modo. Carrera, Mejor vuelta y Persecución cambian el modo en el acto; Desafío solo muestra
 * la lista y cambia con «Correr», así recorrer la lista no recarga ningún circuito.
 */
export interface ModesState {
  mode: Mode;
  /** Desafío elegido (id; vacío, el primero). */
  challenge: string;
  /** Ventaja del fantasma en persecución (s). */
  head: number;
  /** A quién se perseguiría, o null si no hay a quién. */
  target: { name: string; t: number } | null;
  circuitName(id: string): string;
}
export interface ModesActions {
  pick(m: Exclude<Mode, 'challenge'>): void;
  head(h: number): void;
  run(id: string): void;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

const card = (m: Mode, on: boolean): string =>
  `<label class="mode pick"><input type="radio" name="mode" value="${m}"${on ? ' checked' : ''}><b>${MODE_INFO[m].name}</b><span>${MODE_INFO[m].say}</span></label>`;

function chaseExtra(st: ModesState, head: number): string {
  const heads = HEAD_STARTS.map((h) => `<label><input type="radio" name="head" value="${h}"${h === head ? ' checked' : ''}><span>${h} s</span></label>`).join('');
  const note = st.target
    ? `Perseguís a ${esc(st.target.name)}, que da la vuelta en ${fmt(st.target.t)}. En el renglón de la carrera, Δ es la diferencia con el fantasma: negativa, vas adelante.`
    : 'Todavía no hay a quién perseguir con estas vueltas y esta dificultad. Corré en mejor vuelta o cargá el fantasma de otro jugador en Jugar con otros.';
  return `<div class="field"><span>Ventaja del fantasma</span><span class="seg" role="radiogroup" aria-label="Ventaja del fantasma">${heads}</span></div><p class="hint">${note}</p>`;
}

/** active: el modo en juego es el desafío, así que el elegido se marca. */
function challengeExtra(st: ModesState, active: boolean): string {
  const cur = challengeOf(st.challenge).id;
  const items = CHALLENGES.map((sc) => {
    const on = active && sc.id === cur;
    const where = `${st.circuitName(sc.track)} · ${categoryText(categoryOf(sc.track, sc.laps, sc.difficulty))}${on ? ' · elegido' : ''}`;
    return `<li class="chal"${on ? ' aria-current="true"' : ''}><b>${esc(sc.title)}</b><span class="hint">${esc(where)}</span>
      <p>${esc(sc.context)}</p><p>Objetivo: ${esc(sc.goal)}</p>
      <div class="row"><button type="button" class="primary" data-run="${sc.id}">Correr</button></div></li>`;
  });
  return `<ol class="chal-list">${items.join('')}</ol>`;
}

export function openModes(dlg: HTMLDialogElement, st: ModesState, act: ModesActions): void {
  // shown: la tarjeta marcada; active: el modo que corre (Desafío marcado sin correr no lo cambia).
  let shown = st.mode, active = st.mode, head = st.head;
  const extra = (): string => (shown === 'chase' ? chaseExtra(st, head) : shown === 'challenge' ? challengeExtra(st, active === 'challenge') : '');
  dlg.innerHTML = `<form method="dialog">
    <h2>Modo</h2>
    <p class="hint">Elegí qué correr. Al cambiar, la carrera vuelve a la grilla.</p>
    <div class="modes-list" role="radiogroup" aria-label="Modo">${MODES.map((m) => card(m, m === shown)).join('')}</div>
    <div data-extra>${extra()}</div>
    <div class="actions"><button value="close">Listo</button></div>
  </form>`;
  const box = dlg.querySelector('[data-extra]') as HTMLElement;
  dlg.onchange = (e): void => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'head') { head = Number(t.value); act.head(head); return; }
    shown = t.value as Mode;
    if (shown !== 'challenge') { active = shown; act.pick(shown); }
    box.innerHTML = extra();
  };
  dlg.onclick = (e): void => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-run]')?.dataset.run;
    if (id === undefined) return;
    dlg.close();
    act.run(id);
  };
  if (!dlg.open) dlg.showModal();
}
