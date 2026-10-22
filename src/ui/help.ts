import { BAL, WANTS, type Knob } from '../sim/score';
import { PHYS } from '../sim/physics';
import type { Seg } from '../sim/types';
import { ALERT_COLORS, DELTA_COLORS, LED_COLOR, LED_GROUPS } from '../console/panel';
import { BRAKING_FILL, Q_COLORS } from '../trackview/trackview';
import { KNOB_LABEL as LABEL, KNOB_NAMES, SEG_NAMES, cap } from './format';

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
const SEGS: Seg[] = ['s', 'b', 'c', 'x'];

// ——— Tramos: la misma curva en las cuatro tarjetas, con la parte de cada una resaltada ———

/** Una curva de 90°: recta, frenada, curva y salida, en ese orden. */
const PART: Record<Seg, string> = { s: 'M4 34 H34', b: 'M34 34 H50', c: 'M50 34 Q62 34 64 24', x: 'M64 24 Q66 14 66 4' };
const NOTE: Partial<Record<Seg, string>> = { b: 'Sombreada en ámbar en el mapa', x: 'La parte de la curva donde el auto acelera' };

const segSvg = (ty: Seg): string => `
  <svg viewBox="0 0 72 40" class="seg-svg" aria-hidden="true">
    <path d="${SEGS.map((s) => PART[s]).join(' ')}" class="seg-rest"/>
    <path d="${PART[ty]}" class="seg-on" ${ty === 'b' ? `style="stroke:${BRAKING_FILL.replace('0.45', '1')}"` : ''}/>
  </svg>`;

const tramos = (): string => `<div class="cards">${SEGS.map((ty) => {
  const rows = (Object.entries(WANTS[ty]) as [Knob, [number, number]][]).map(([k, [v]]) =>
    `<dt>${cap(LABEL[k])}</dt><dd>${k === 'bal' ? `${BAL.FULL} % adelante con el tanque lleno, baja a ${BAL.EMPTY} %` : KNOB_NAMES[k][v]}</dd>`).join('');
  return `<div class="card seg">${segSvg(ty)}<div><b>${cap(SEG_NAMES[ty])}</b><dl>${rows}</dl>${NOTE[ty] ? `<span class="hint">${NOTE[ty]}</span>` : ''}</div></div>`;
}).join('')}</div>`;

// ——— Volante: esquema en milímetros, con las medidas de la consola 3D ———

const badge = (n: number, x: number, y: number): string =>
  `<g class="badge"><circle cx="${x}" cy="${y}" r="7"/><text x="${x}" y="${y + 3}">${n}</text></g>`;

function wheelSvg(): string {
  // Para mostrar cómo avisan: la recta prendida y la frenada a medio llenar.
  const leds = LED_GROUPS.flatMap((n, g) => Array.from({ length: n }, (_, j) => g === 0 || (g === 1 && j < 2)));
  const knob = (x: number): string => `<circle cx="${x}" cy="46" r="13" class="part"/><line x1="${x}" y1="46" x2="${x}" y2="35" class="ink"/>`
    + [-1, 0, 1].map((d) => `<line x1="${x + d * 11}" y1="${46 - 14 + Math.abs(d) * 4}" x2="${x + d * 12.5}" y2="${46 - 16 + Math.abs(d) * 4}" class="ink thin"/>`).join('');
  return `
  <svg viewBox="-150 -92 300 184" class="wheel-svg" role="img" aria-label="Esquema del volante con sus partes numeradas">
    <rect x="-140" y="-80" width="30" height="160" rx="15" class="part"/>
    <rect x="110" y="-80" width="30" height="160" rx="15" class="part"/>
    <rect x="-110" y="-75" width="220" height="150" rx="18" class="body"/>
    ${leds.map((on, i) => `<circle cx="${-52.5 + i * 7.5}" cy="-64" r="2.8" fill="${on ? hex(LED_COLOR) : 'var(--surface)'}" class="ink"/>`).join('')}
    <rect x="-56" y="-58" width="112" height="62" rx="4" class="part"/>
    ${[52, 43, 34, 25, 16].map((y, i) => `<line x1="-48" y1="${-y}" x2="12" y2="${-y}" class="ink thin"/><line x1="${-40 + i * 9}" y1="${-y - 3}" x2="${-40 + i * 9}" y2="${-y + 3}" class="ink"/>`).join('')}
    <line x1="-48" y1="-6" x2="12" y2="-6" class="ink thin"/><rect x="-28" y="-7.5" width="10" height="3" fill="${hex(DELTA_COLORS.gain)}"/>
    ${([[-62, 40], [-62, 16], [62, 40], [62, 16]] as const).map(([x, y], i) => `<circle cx="${x}" cy="${-y}" r="4.5" fill="${hex(ALERT_COLORS[i])}" class="ink"/>`).join('')}
    <circle cx="-86" cy="-34" r="6" class="part"/><circle cx="-86" cy="-12" r="6" class="part"/>
    <rect x="72" y="-74" width="22" height="20" rx="2" class="part"/>
    <rect x="-34" y="7" width="68" height="18" rx="4" class="part"/>
    ${[-22, 0, 22].map((x) => `<circle cx="${x}" cy="16" r="6" class="part"/>`).join('')}
    ${[-66, -22, 22, 66].map(knob).join('')}
    ${badge(1, -66, -64)}${badge(2, 34, -26)}${badge(3, 78, -28)}${badge(4, -100, -23)}${badge(5, 100, -64)}${badge(6, 46, 16)}${badge(7, -92, 46)}
  </svg>`;
}

const volante = (): string => {
  const rot = (['ers', 'lev', 'dif', 'eb'] as const).map((k) => LABEL[k]).join(', ').replace(/, ([^,]+)$/, ' y $1');
  const items = [
    ['Luces de tramo', 'Recta, frenada, curva y salida. El grupo del tramo actual queda prendido y el del siguiente se llena al acercarse. Si entrás justo, destellan todas.'],
    ['Pantalla', 'Carga, motor, nafta, gomas y frenos. Abajo, el delta contra tu mejor vuelta: verde ganás, rojo perdés.'],
    ['Alertas', 'Qué dice cada lámpara, en <button type="button" class="link" data-go="alertas">Alertas</button>.'],
    ['BB+ y BB−', 'Balance de frenos, de a 1 %. Las frenadas lo piden más adelante con el tanque lleno y más atrás a medida que se gasta la nafta: la marca azul en la barra Frenos dice cuánto.'],
    ['Limitador', 'Primero la tapa, después la llave.'],
    ['Fusibles', 'ERS, diferencial y freno motor.'],
    ['Rotativos', `${cap(rot)}. Tocá la marca de la posición que querés.`],
  ];
  return `<div class="wheel"><div>${wheelSvg()}
    <p class="hint">En difícil el volante gira con el auto en cada curva y los botones se mueven bajo el puntero. Con el modo fácil, en ajustes, la consola marca en azul qué mover y a qué posición.</p></div>
    <ol class="parts">${items.map(([t, d]) => `<li><b>${t}</b> ${d}</li>`).join('')}</ol></div>`;
};

// ——— Alertas ———

const lamp = (i: number): string => `<span class="lamp" style="background:${hex(ALERT_COLORS[i])}"></span>`;
/** Nafta y gomas no son lámparas: son barras de la pantalla. */
const gauge = (at: number): string =>
  `<svg viewBox="0 0 40 12" class="gauge" aria-hidden="true"><line x1="2" y1="6" x2="38" y2="6"/><line x1="${at}" y1="1" x2="${at}" y2="11" class="needle"/></svg>`;

const alertas = (): string => `
  <ul class="rows">
    <li>${lamp(0)}<div><b>Batería</b> Se prende por debajo de ${PHYS.BAT_LOW} %. Attack la gasta y sin carga deja de empujar. Harvest la carga, sobre todo fuera de las rectas.</div></li>
    <li>${lamp(1)}<div><b>Motor</b> Se prende desde ${PHYS.TEMP_LIMIT}°. Push lo calienta y la protección corta potencia hasta que baja.</div></li>
    <li>${lamp(2)}<div><b>Limitador</b> Clava ${Math.round(PHYS.LIMITER * 3.6)} km/h mientras está puesto.</div></li>
    <li>${lamp(3)}<div><b>Falla, parpadea</b> Saltó un fusible: el botón sube y se ve la banda roja.
      <ol class="steps"><li>Poné su control en la posición del medio.</li><li>Apretá el fusible.</li></ol>
      <span class="hint">Con el control en otra posición no arma.</span></div></li>
  </ul>
  <h3>Desgaste</h3>
  <ul class="rows">
    <li>${gauge(26)}<div><b>Nafta</b> En normal y difícil no alcanza para ir en push toda la carrera; en fácil, sí. El medidor dice cuánto sobra o falta yendo en normal.</div></li>
    <li>${gauge(14)}<div><b>Gomas</b> Se gastan más en push y con la curva mal configurada.</div></li>
  </ul>`;

// ——— Mapa, telemetría y con otros ———

const mapa = (): string => `
  <ul class="rows">
    <li><span class="sw3">${Q_COLORS.map((c) => `<i style="background:${c}"></i>`).join('')}</span><div><b>Tu estela</b> Verde bien configurado, ámbar regular, rojo mal. Si una curva te agarra mal configurado, el auto se abre.</div></li>
    <li><span class="swb" style="background:${BRAKING_FILL}"></span><div><b>Frenadas</b> Las zonas donde hay que frenar.</div></li>
    <li><span class="swg"></span><div><b>Fantasma</b> Tu mejor vuelta en ese circuito, o la de otro jugador si cargaste una.</div></li>
    <li><span class="swn">1</span><div><b>Pérdidas</b> Dónde perdiste tiempo en la última vuelta, numeradas como en la telemetría.</div></li>
  </ul>
  <h3>Telemetría</h3>
  <p>Cada vuelta se compara con la ideal y lo perdido se reparte por causa: un control que llegó tarde al tramo, uno que cambiaste antes de tiempo, uno distinto de lo que pide el tramo, el motor caliente, las gomas o la largada.</p>
  <h3>Jugar con otros</h3>
  <p>Armá una sala privada y pasá el link: cada uno corre su auto y ve a los demás en el mapa. El anfitrión elige el circuito y da la largada. También podés mandar tu mejor vuelta como link para que alguien corra contra tu fantasma.</p>`;

// ——— Teclas ———

const KEYS: [string[], string][] = [
  [['Q'], LABEL.ers], [['W'], cap(LABEL.lev)], [['E'], cap(LABEL.dif)], [['R'], cap(LABEL.eb)],
  [['A', 'D'], 'Frenos: atrás y adelante'], [['P'], 'Limitador'], [['1', '2', '3'], 'Fusibles'],
  [['←', '→'], 'Inclinar apenas la vista'], [['Espacio'], 'Pausa'],
];
const teclas = (): string => `
  <div class="keys">${KEYS.map(([ks, t]) => `<div class="key-row"><span>${ks.map((k) => `<kbd>${k}</kbd>`).join('')}</span>${t}</div>`).join('')}</div>
  <p class="hint">Con el teclado, cada rotativo pasa a la posición siguiente.</p>`;

const TABS: [string, string, () => string][] = [
  ['tramos', 'Tramos', tramos], ['volante', 'Volante', volante], ['alertas', 'Alertas', alertas], ['mapa', 'Mapa', mapa], ['teclas', 'Teclas', teclas],
];

export function openHelp(dlg: HTMLDialogElement): void {
  // Las teclas solo donde hay con qué apretarlas: un teléfono sin mouse ni teclado no tiene esa solapa.
  const tabsHere = matchMedia('(any-pointer: fine)').matches ? TABS : TABS.filter(([id]) => id !== 'teclas');
  dlg.className = 'help';
  dlg.innerHTML = `
  <form method="dialog">
    <h2>Cómo se juega</h2>
    <p class="lead">El auto se maneja solo. Vos operás su computadora: cada tramo pide una configuración y cuanto más cerca estés, más rápido va.</p>
    <div class="tabs" role="tablist" aria-label="Secciones de la ayuda">
      ${tabsHere.map(([id, t], i) => `<button type="button" role="tab" id="tab-${id}" aria-controls="pane-${id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${t}</button>`).join('')}
    </div>
    ${tabsHere.map(([id, , body], i) => `<section role="tabpanel" id="pane-${id}" aria-labelledby="tab-${id}" class="pane" ${i ? 'hidden' : ''}>${body()}</section>`).join('')}
    <div class="actions"><span class="hint grow">Trazados de bacinger/f1-circuits (licencia MIT), datos no oficiales.</span><button value="close">Entendido</button></div>
  </form>`;
  const tabs = [...dlg.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const show = (id: string, focus = false): void => tabs.forEach((t) => {
    const on = t.id === `tab-${id}`;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    (dlg.querySelector(`#${t.getAttribute('aria-controls')}`) as HTMLElement).hidden = !on;
    if (on && focus) t.focus();
  });
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => show(t.id.slice(4)));
    // Flechas entre solapas, como en cualquier lista de solapas.
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      show(tabs[(i + d + tabs.length) % tabs.length].id.slice(4), true);
    });
  });
  dlg.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) => b.addEventListener('click', () => show(b.dataset.go as string, true)));
  dlg.showModal();
}
