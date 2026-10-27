import type { Config } from '../config';
import { cleanName, NAME_MAX } from '../net/protocol';
import { LIVERIES, RANDOM_LIVERY } from '../console/panel';
import { layoutSvg } from './layouts';
import { DIFF_CHOICES, FAN, LIVERY_CHOICES, SPREAD_PCT, diffFacts, layoutChoices, liveryWheel } from './welcome-data';

/**
 * Bienvenida del primer ingreso: tu nombre, el volante (carrusel con cada esquema dibujado), cómo se ve la pantalla
 * (un diagrama de cada distribución con el alto y el ancho de esta pantalla) y la dificultad con lo que significa.
 * Cada paso aplica lo elegido al pasar al siguiente; cerrar en cualquier momento deja lo elegido hasta ahí. Todo se cambia en ajustes.
 */
export interface WelcomeEnd {
  /** Cómo terminó: largar, abrir la ayuda o solo cerrar. */
  (how: 'go' | 'help' | ''): void;
}

const STEPS = ['Bienvenida', 'Volante', 'Pantalla', 'Dificultad', 'Listo'] as const;
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const BOX = 'viewBox="-137 -87 274 174"';
const chevron = (d: 1 | -1): string =>
  `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="${d < 0 ? 'M12.5 4 6.5 10l6 6' : 'M7.5 4l6 6-6 6'}"/></svg>`;

/** Para «al azar», tres volantes en abanico; si no, el esquema solo. */
function liveryFigure(id: string, theme: 'light' | 'dark'): string {
  if (id !== RANDOM_LIVERY) return `<svg ${BOX} aria-hidden="true">${liveryWheel(id, theme)}</svg>`;
  const fan = FAN.map((l, i) => `<g transform="translate(${(i - 1) * 80} ${Math.abs(i - 1) * 10}) rotate(${(i - 1) * 10}) scale(${i === 1 ? 0.6 : 0.5})">${liveryWheel(l, theme)}</g>`);
  return `<svg ${BOX} aria-hidden="true">${fan[0]}${fan[2]}${fan[1]}</svg>`;
}

const liveryName = (id: string): string => LIVERY_CHOICES.find((c) => c.id === id)?.name ?? '';
const layoutName = (id: Config['layout']): string => layoutChoices(id).find((c) => c.id === id)?.name ?? '';

/** theme: el del momento. shown: el esquema que se ve ahora (para «al azar»). canGo: si la carrera está en la grilla y se puede largar desde acá (se pregunta al llegar al último paso: el circuito puede estar cargándose). */
export interface WelcomeOpts { theme: 'light' | 'dark'; shown: string; canGo: () => boolean }

export function openWelcome(dlg: HTMLDialogElement, start: Config, { theme, shown, canGo }: WelcomeOpts, onChange: (c: Config) => void, end: WelcomeEnd): void {
  let draft: Config = { ...start, livery: start.livery in LIVERIES || start.livery === RANDOM_LIVERY ? start.livery : 'carbono' };
  let step = 0, sent = start;
  const touch = matchMedia('(pointer: coarse)').matches;
  /** Lo elegido llega a la consola al cambiar de paso y al cerrar, no en cada roce del carrusel: cambiar el esquema rehace el volante 3D. */
  const commit = (): void => { if (JSON.stringify(draft) !== JSON.stringify(sent)) { sent = draft; onChange(draft); } };

  const progress = (): string => `<div class="wl-progress"><span>Paso ${step + 1} de ${STEPS.length} · ${STEPS[step]}</span>
    <ol aria-hidden="true">${STEPS.map((_, i) => `<li class="${i < step ? 'done' : i === step ? 'now' : ''}"></li>`).join('')}</ol></div>`;

  const hello = (): string => `
    <h2 id="wl-title">Te damos la bienvenida</h2>
    <p class="lead">El auto se maneja solo. Vos operás su computadora desde el volante: cada tramo de la pista pide una configuración y cuanto más cerca estés, más rápido va.</p>
    <div class="wl-hero">${liveryFigure(draft.livery === RANDOM_LIVERY ? shown : draft.livery, theme)}</div>
    <p class="wl-note">En tres pasos elegís tu volante, cómo se ve la pantalla y contra quién corrés.</p>
    <label class="field col">Tu nombre (opcional)<input type="text" name="name" maxlength="${NAME_MAX}" placeholder="Cómo te ven los demás" autocomplete="nickname" value="${esc(draft.name)}"></label>
    <p class="hint">Lo ven los demás en una sala y cuando corren contra tu fantasma.</p>`;

  const wheel = (): string => `
    <h2 id="wl-title">Elegí tu volante</h2>
    <p class="lead">Deslizá o usá las flechas. Después se cambia en Ajustes, en «Colores del volante».</p>
    <div class="wl-track" role="radiogroup" aria-label="Colores del volante">${LIVERY_CHOICES.map((c) => `
      <label class="wl-card pick"><input type="radio" name="livery" value="${c.id}" aria-label="${esc(c.name)}" ${c.id === draft.livery ? 'checked' : ''}>${liveryFigure(c.id, theme)}</label>`).join('')}
    </div>
    <div class="wl-nav">
      <button type="button" class="wl-arrow" data-move="-1" aria-label="Esquema anterior">${chevron(-1)}</button>
      <p class="wl-name" aria-live="polite"></p>
      <button type="button" class="wl-arrow" data-move="1" aria-label="Esquema siguiente">${chevron(1)}</button>
    </div>`;

  const diagrams = (): string => {
    const opts = layoutChoices(draft.layout), w = innerWidth, h = innerHeight, sel = opts.find((o) => o.id === draft.layout) ?? opts[0];
    return `<div class="wl-layouts" role="radiogroup" aria-label="Distribución" style="--n:${opts.length}">${opts.map((o) => `
      <label class="wl-pick pick"><input type="radio" name="layout" value="${o.id}" ${o.id === sel.id ? 'checked' : ''}>
        ${layoutSvg(o.id, draft.mapView, w, h, liveryWheel(draft.livery === RANDOM_LIVERY ? 'carbono' : draft.livery, theme), `dg-${o.id}`)}<span>${o.name}</span></label>`).join('')}
    </div><p class="wl-say">${sel.say}</p>`;
  };

  const screen = (): string => `
    <h2 id="wl-title">¿Cómo querés ver la carrera?</h2>
    <p class="lead">Así queda en esta pantalla. Después se cambia en Ajustes, en «Distribución».</p>
    <div data-diagrams>${diagrams()}</div>
    <div class="field"><span>Vista del circuito</span><span class="seg" role="radiogroup" aria-label="Vista del circuito">
      <label><input type="radio" name="mapView" value="2d" ${draft.mapView === '2d' ? 'checked' : ''}><span>Mapa</span></label>
      <label><input type="radio" name="mapView" value="3d" ${draft.mapView === '3d' ? 'checked' : ''}><span>Pista en 3D</span></label></span></div>`;

  const diffInfo = (): string => {
    const d = DIFF_CHOICES.find((c) => c.id === draft.difficulty) ?? DIFF_CHOICES[1];
    return `<p class="wl-say fit"><b>${d.name}.</b> ${d.say}</p><ul class="wl-facts">${diffFacts(d.id).map((f) => `<li>${f}</li>`).join('')}</ul>
      <p class="hint">Con varios bots, cada uno rinde hasta ${SPREAD_PCT} % mejor o peor que esto. La cantidad de bots se elige en Ajustes.</p>`;
  };

  const difficulty = (): string => `
    <h2 id="wl-title">¿Contra quién corrés?</h2>
    <p class="lead">Los bots operan su propia consola con las mismas reglas que vos.</p>
    <span class="seg wide" role="radiogroup" aria-label="Dificultad de los bots">${DIFF_CHOICES.map((c) => `
      <label><input type="radio" name="difficulty" value="${c.id}" ${c.id === draft.difficulty ? 'checked' : ''}><span>${c.name}</span></label>`).join('')}</span>
    <div data-diff>${diffInfo()}</div>
    <label class="field">Modo fácil: sugerir qué controles mover<input type="checkbox" name="assist" ${draft.assist ? 'checked' : ''}></label>
    <p class="hint">La consola marca en azul qué control mover y a qué posición. Conviene dejarlo prendido las primeras carreras.</p>`;

  const row = (k: string, v: string, to: number): string =>
    `<div class="wl-row"><dt>${k}</dt><dd>${v}</dd><button type="button" data-to="${to}" aria-label="Cambiar ${k.toLowerCase()}">Cambiar</button></div>`;
  const tips = (): string[] => [
    'Las luces de arriba del volante dicen en qué tramo estás, y las del tramo siguiente se llenan al acercarte.',
    ...(draft.assist ? ['En modo fácil, la etiqueta azul de cada control dice a qué posición moverlo.'] : []),
    'Todo esto se cambia en Ajustes, y Ayuda explica cada parte del volante.',
    touch ? 'En los rotativos, tocá la marca de la posición que querés. Arrastrá para inclinar la vista.'
      : 'Teclas: Q, W, E y R mueven los rotativos; A y D, los frenos; Z y X, Ataque y Ahorro; espacio pausa.',
  ];
  const ready = (): string => `
    <h2 id="wl-title">${canGo() ? 'Listo para largar' : 'Listo'}${draft.name ? `, ${esc(draft.name)}` : ''}</h2>
    <dl class="wl-sum">
      ${row('Nombre', draft.name ? esc(draft.name) : 'Sin nombre', 0)}
      ${row('Volante', liveryName(draft.livery), 1)}
      ${row('Pantalla', `${layoutName(draft.layout)} · ${draft.mapView === '3d' ? 'pista en 3D' : 'mapa'}`, 2)}
      ${row('Dificultad', `${DIFF_CHOICES.find((c) => c.id === draft.difficulty)?.name ?? ''} · modo fácil ${draft.assist ? 'prendido' : 'apagado'}`, 3)}
    </dl>
    <h3>Antes de largar</h3>
    <ul class="wl-facts">${tips().map((t) => `<li>${t}</li>`).join('')}</ul>`;

  const BODIES = [hello, wheel, screen, difficulty, ready];
  const actions = (): string => step === STEPS.length - 1
    ? `<button type="button" data-back>Atrás</button><button type="button" data-end="help">Cómo se juega</button>${canGo() ? '<button type="button" data-end="go" class="primary">Largar</button>' : '<button type="button" data-end="" class="primary">Listo</button>'}`
    : `<button type="button" data-end="" class="wl-skip">Saltar</button>${step ? '<button type="button" data-back>Atrás</button>' : ''}<button type="button" data-next class="primary">Siguiente</button>`;

  function render(): void {
    dlg.innerHTML = `<form method="dialog" class="wl" aria-labelledby="wl-title">${progress()}<div class="wl-body">${BODIES[step]()}</div><div class="actions">${actions()}</div></form>`;
    if (step === 1) carousel();
    focusMain();
  }
  /** El foco va al botón que sigue (no al nombre: en el teléfono abriría el teclado, ni al cuerpo, que el navegador enfoca por ser desplazable). */
  const focusMain = (): void => (dlg.querySelector('[data-next], .actions .primary') as HTMLElement | null)?.focus({ preventScroll: true });
  const go = (to: number): void => { readName(); commit(); step = Math.max(0, Math.min(STEPS.length - 1, to)); render(); };
  const readName = (): void => {
    const f = dlg.querySelector<HTMLInputElement>('input[name="name"]');
    if (f) draft = { ...draft, name: cleanName(f.value) };
  };

  /** El esquema elegido es el que queda en el medio: al deslizar, al tocar uno (se centra) y con las flechas. */
  function carousel(): void {
    const track = dlg.querySelector('.wl-track') as HTMLElement, cards = [...track.querySelectorAll<HTMLLabelElement>('.wl-card')];
    const radios = cards.map((c) => c.querySelector('input') as HTMLInputElement), label = dlg.querySelector('.wl-name') as HTMLElement;
    const at = (): number => Math.max(0, radios.findIndex((r) => r.checked));
    const show = (): void => { label.innerHTML = `<b>${esc(liveryName(draft.livery))}</b> <span class="hint">${at() + 1} de ${cards.length}</span>`; };
    /** Un desplazamiento que hace el carrusel para centrar no elige nada: si no, un paso intermedio pisaba lo tocado. */
    let own = false;
    const center = (i: number, smooth: boolean): void => {
      const c = cards[i], left = c.offsetLeft - (track.clientWidth - c.offsetWidth) / 2;
      own = Math.abs(track.scrollLeft - left) > 1;
      track.scrollTo({ left, behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
    };
    const pick = (i: number, smooth = true): void => {
      radios[i].checked = true;
      draft = { ...draft, livery: radios[i].value };
      show();
      center(i, smooth);
    };
    let timer = 0;
    track.addEventListener('scroll', () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (own) { own = false; return; }
        const mid = track.scrollLeft + track.clientWidth / 2;
        const near = cards.reduce((b, c, i) => (Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid) < Math.abs(cards[b].offsetLeft + cards[b].offsetWidth / 2 - mid) ? i : b), 0);
        if (near !== at()) { radios[near].checked = true; draft = { ...draft, livery: radios[near].value }; show(); }
      }, 120);
    }, { passive: true });
    radios.forEach((r, i) => r.addEventListener('change', () => pick(i)));
    dlg.querySelectorAll<HTMLButtonElement>('[data-move]').forEach((b) =>
      b.addEventListener('click', () => pick((at() + Number(b.dataset.move) + cards.length) % cards.length)));
    show();
    requestAnimationFrame(() => center(at(), false));
  }

  /** Pantalla y dificultad: lo elegido se ve enseguida en el diagrama y en la explicación. */
  dlg.oninput = (e): void => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'layout' || t.name === 'mapView') {
      draft = { ...draft, [t.name]: t.value };
      (dlg.querySelector('[data-diagrams]') as HTMLElement).innerHTML = diagrams();
      dlg.querySelector<HTMLInputElement>(`input[name="${t.name}"][value="${t.value}"]`)?.focus();
    }
    if (t.name === 'difficulty') { draft = { ...draft, difficulty: t.value as Config['difficulty'] }; (dlg.querySelector('[data-diff]') as HTMLElement).innerHTML = diffInfo(); }
    if (t.name === 'assist') draft = { ...draft, assist: t.checked };
  };
  dlg.onclick = (e): void => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.dataset.next !== undefined) go(step + 1);
    else if (b.dataset.back !== undefined) go(step - 1);
    else if (b.dataset.to !== undefined) go(Number(b.dataset.to));
    else if (b.dataset.end !== undefined) dlg.close(b.dataset.end);
  };
  // Enter en el nombre pasa al paso siguiente: sin esto el formulario se enviaría y el diálogo se cerraría.
  dlg.onkeydown = (e): void => {
    if (e.key === 'Enter' && (e.target as HTMLElement).matches('input[name="name"]')) { e.preventDefault(); go(step + 1); }
  };
  // El diagrama se dibuja con el alto y el ancho de la pantalla: si se gira el teléfono o cambia la ventana, se vuelve a dibujar.
  const resize = (): void => { const box = dlg.querySelector('[data-diagrams]'); if (box) box.innerHTML = diagrams(); };
  window.addEventListener('resize', resize);
  dlg.addEventListener('close', () => {
    window.removeEventListener('resize', resize);
    readName();
    commit();
    end((dlg.returnValue || '') as 'go' | 'help' | '');
  }, { once: true });

  dlg.className = 'welcome';
  dlg.returnValue = '';
  render();
  dlg.showModal();
  focusMain();
}
