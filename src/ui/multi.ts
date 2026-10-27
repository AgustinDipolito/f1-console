import { NAME_MAX } from '../net/protocol';
import { fmt } from './format';

export interface MultiState {
  name: string;
  /** Null fuera de una sala. */
  room: { code: string; link: string; members: { name: string; me: boolean; host: boolean }[]; isHost: boolean } | null;
  joining: boolean;
  /** Código de sala para dejar escrito (entraste por un link sin nombre). */
  code: string;
  /** Estado de la conexión o el último error, en una línea. */
  status: string;
  /** El circuito con su categoría: «Gálvez, Buenos Aires (3 vueltas · normal)». */
  circuit: string;
  /** Link de tu récord en esta categoría, o null si todavía no hay. */
  share: string | null;
  rival: { name: string; t: number } | null;
}

export interface MultiActions {
  name(n: string): void;
  create(): void;
  join(code: string): void;
  leave(): void;
  /** Devuelve el error para mostrar, o null si cargó. */
  ghost(code: string): string | null;
  clearRival(): void;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Campo de solo lectura con el link y su botón de copiar: si el portapapeles no está disponible, se copia a mano.
 * Donde el aparato sabe compartir (el teléfono), también Compartir: abre la hoja del sistema para mandarlo por mensaje.
 */
const linkField = (key: string, link: string, label: string): string =>
  `<div class="field"><input type="text" readonly value="${esc(link)}" aria-label="${label}" data-link="${key}"><span class="row">${
    typeof navigator.share === 'function' ? `<button type="button" data-share="${key}">Compartir</button>` : ''}<button type="button" data-copy="${key}">Copiar</button></span></div>`;

function body(st: MultiState): string {
  const r = st.room;
  const room = r ? `
      <p>Sala <b class="mono">${esc(r.code)}</b>. Pasale este link a quien quieras sumar:</p>
      ${linkField('room', r.link, 'Link de la sala')}
      <ul class="members">${r.members.map((m) => `<li>${esc(m.name)}${m.me ? ' (vos)' : ''}${m.host ? ' · anfitrión' : ''}</li>`).join('')}</ul>
      <p class="hint">${r.isHost ? 'Vos elegís el circuito y das la largada. Vueltas, fallas y velocidad del tiempo salen de tus ajustes.' : 'El anfitrión elige el circuito, las vueltas y da la largada.'} En la sala no hay bots, pausa ni modos: se corre una carrera.</p>
      <div class="field"><span class="hint">${esc(st.status)}</span><button type="button" data-leave>Salir de la sala</button></div>`
    : `
      <label class="field">Tu nombre<input type="text" name="name" maxlength="${NAME_MAX}" placeholder="Cómo te ven los demás" value="${esc(st.name)}"></label>
      <div class="field"><span>Armá una sala y pasá el link</span><button type="button" data-create ${st.joining ? 'disabled' : ''}>Crear sala</button></div>
      <div class="field"><input type="text" name="code" placeholder="Código o link de una sala" aria-label="Código de sala" value="${esc(st.code)}"><button type="button" data-join ${st.joining ? 'disabled' : ''}>Entrar</button></div>
      <p class="hint">${st.status ? esc(st.status) : 'Los navegadores se conectan directo entre sí. En algunas redes de empresa o de celular no llegan a conectarse.'}</p>`;
  const ghost = `
      <p>Mandale tu récord en ${esc(st.circuit)} a alguien para que corra contra él, o cargá el de otro.</p>
      ${st.share ? linkField('ghost', st.share, 'Link de tu récord') : '<p class="hint">Todavía no tenés un récord en esta categoría.</p>'}
      <div class="field"><input type="text" name="ghost" placeholder="Pegá el link o el código de un fantasma" aria-label="Fantasma de otro jugador"><button type="button" data-ghost>Cargar</button></div>
      <p class="hint" data-ghost-msg></p>
      ${st.rival ? `<div class="field"><span>Fantasma cargado: ${esc(st.rival.name)} · ${fmt(st.rival.t)}</span><button type="button" data-clear>Quitar</button></div>` : ''}`;
  return `
    <form method="dialog">
      <h2>Jugar con otros</h2>
      <h3>Sala privada</h3>${room}
      <h3>Fantasma de otro jugador</h3>${ghost}
      <div class="actions"><button value="close">Cerrar</button></div>
    </form>`;
}

/** Dibuja el diálogo. Se puede volver a llamar con el diálogo abierto: conserva lo que se estaba escribiendo. */
export function renderMulti(dlg: HTMLDialogElement, st: MultiState, act: MultiActions): void {
  const kept = new Map<string, string>();
  dlg.querySelectorAll<HTMLInputElement>('input[name]').forEach((i) => kept.set(i.name, i.value));
  const focus = (document.activeElement as HTMLInputElement | null)?.name;
  dlg.innerHTML = body(st);
  const form = dlg.querySelector('form') as HTMLFormElement;
  const inp = (n: string): HTMLInputElement | null => form.querySelector(`input[name="${n}"]`);
  kept.forEach((v, n) => { const i = inp(n); if (i) i.value = v; });
  if (focus) inp(focus)?.focus();
  const on = (sel: string, f: () => void): void => form.querySelector(sel)?.addEventListener('click', f);
  const named = (): void => { const i = inp('name'); if (i) act.name(i.value); };
  on('[data-create]', () => { named(); act.create(); });
  const join = (): void => { named(); act.join(inp('code')?.value ?? ''); };
  on('[data-join]', join);
  on('[data-leave]', () => act.leave());
  on('[data-clear]', () => act.clearRival());
  const ghost = (): void => {
    const err = act.ghost(inp('ghost')?.value ?? '');
    const m = form.querySelector('[data-ghost-msg]');
    if (m) m.textContent = err ?? '';
  };
  on('[data-ghost]', ghost);
  inp('name')?.addEventListener('change', named);
  // Enter en un campo hace lo de su botón: sin esto el formulario se envía y el diálogo se cierra.
  const enter = (n: string, f: () => void): void => inp(n)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); f(); } });
  enter('code', join);
  enter('ghost', ghost);
  enter('name', named);
  form.querySelectorAll<HTMLButtonElement>('[data-share]').forEach((b) => b.addEventListener('click', () => {
    const url = form.querySelector<HTMLInputElement>(`[data-link="${b.dataset.share}"]`)?.value;
    // Cancelar la hoja del sistema también rechaza la promesa: no es un error.
    if (url) navigator.share({ title: 'Consola de carrera', url }).catch(() => undefined);
  }));
  form.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((b) => b.addEventListener('click', () => {
    const f = form.querySelector<HTMLInputElement>(`[data-link="${b.dataset.copy}"]`);
    if (!f) return;
    f.select();
    navigator.clipboard?.writeText(f.value).then(() => { b.textContent = 'Copiado'; }, () => { b.textContent = 'Copialo a mano'; });
  }));
}
