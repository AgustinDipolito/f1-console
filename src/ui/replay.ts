import type { Loss } from '../sim/diagnose';
import { TEL_DS } from '../sim/telemetry';
import type { Lap, Track } from '../sim/types';
import { READ, chartX, kAt, miniMap, missingNote, replayRows, stepTo, timeline, timelineSvg } from './replay-data';

/** La repetición de una vuelta en el diálogo de telemetría: línea de tiempo, barra, controles, mapa chico y lectura en el punto elegido. */

export interface ReplayIn { tr: Track; lap: Lap; losses: Loss[] }
export interface Replay { seek(s: number): void; stop(): void }

const DASH = '—';
const SPEEDS = [1, 2, 4];
const ICONS = { prev: 'M5 4v12M15 4l-7 6 7 6', next: 'M15 4v12M5 4l7 6-7 6', play: 'M6 4l10 6-10 6z', pause: 'M7 4v12M13 4v12' };
const lossSet = (x: ReplayIn): number[] => [...new Set(x.losses.map((l) => l.s0))];

const button = (id: string, label: string, d: string): string =>
  `<button type="button" class="ico" data-rp="${id}" aria-label="${label}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="${d}"/></svg></button>`;

const speedRadios = SPEEDS.map((v) => `<label><input type="radio" name="rpv" value="${v}"${v === 1 ? ' checked' : ''}><span>×${v}</span></label>`).join('');

/** Las tres partes del cuerpo no cambian con el punto: la lectura arranca en «—» y la completa bindReplay. */
export function replayHtml(x: ReplayIn): string {
  const n = x.lap.tt.length, { inner } = miniMap(x.tr, n, lossSet(x)), note = missingNote(x.lap);
  const read = READ.map(([, label]) => `<div><dt>${label}</dt><dd>${DASH}</dd></div>`).join('');
  return `<section class="tcard rp"><h3>Repetición</h3>
    ${timelineSvg(timeline(x.tr, x.lap, x.losses), n)}
    <input type="range" class="rp-range" min="0" max="${n - 1}" step="1" value="0" aria-label="Punto de la vuelta">
    <div class="rp-ctl">${button('prev', 'Evento anterior', ICONS.prev)}${button('play', 'Reproducir', ICONS.play)}${button('next', 'Evento siguiente', ICONS.next)}
      <span class="seg" role="radiogroup" aria-label="Velocidad de la repetición">${speedRadios}</span></div>
    <div class="rp-body">
      <svg class="rp-map" viewBox="0 0 200 140" role="img" aria-label="Circuito con tu auto en el punto elegido">${inner}<circle class="rp-car" r="5" cx="-10" cy="-10"/></svg>
      <dl class="rp-read">${read}</dl>
    </div>
    <p class="legend">◆ pérdida · │ cambio de control · ▲ macro · ■ fusible · ▬ motor sobre 100° · ╷ tramo</p>
    ${note ? `<p class="hint">${note}</p>` : ''}
  </section>`;
}

const setLine = (el: Element | null, x: number): void => { el?.setAttribute('x1', String(x)); el?.setAttribute('x2', String(x)); };
const noReplay: Replay = { seek: () => undefined, stop: () => undefined };

/** Engancha la repetición dentro de root (el diálogo). Se vuelve a llamar después de cada dibujo: los listeners viven en los elementos nuevos. */
export function bindReplay(root: HTMLElement, x: ReplayIn): Replay {
  const q = <T extends Element>(sel: string): T | null => root.querySelector<T>(sel);
  const range = q<HTMLInputElement>('.rp-range'), play = q<HTMLButtonElement>('[data-rp="play"]'), car = q('.rp-car');
  if (!range || !play) return noReplay;
  const tt = x.lap.tt, n = tt.length, x1 = (n - 1) * TEL_DS;
  const rows = replayRows(x.tr, x.lap), xy = miniMap(x.tr, n, []).xy, marks = timeline(x.tr, x.lap, x.losses);
  const dds = [...root.querySelectorAll<HTMLElement>('.rp-read dd')], tl = q('.tl-cur'), chartCur = q('.chart .cursor');
  let shown = -1, T = 0, last = 0, speed = 1, raf = 0;

  const text = (el: HTMLElement, v: string): void => { if (el.textContent !== v) el.textContent = v; };
  const show = (k: number): void => {
    if (k === shown) return;
    shown = k;
    const cx = chartX(k * TEL_DS, x1);
    setLine(tl, cx); setLine(chartCur, cx);
    car?.setAttribute('cx', String(xy[k][0])); car?.setAttribute('cy', String(xy[k][1]));
    range.value = String(k);
    dds.forEach((dd, i) => text(dd, rows[k][i]));
  };
  /** Tiempo de vuelta del registro k; si falta (NaN), el del último que lo tenga. */
  const tOf = (k: number): number => { for (let j = k; j >= 0; j--) if (Number.isFinite(tt[j])) return tt[j]; return 0; };
  const seekK = (k: number): void => { const c = Math.max(0, Math.min(n - 1, k)); T = tOf(c); show(c); };
  const setPlaying = (on: boolean): void => {
    play.setAttribute('aria-label', on ? 'Pausa' : 'Reproducir');
    play.querySelector('path')?.setAttribute('d', on ? ICONS.pause : ICONS.play);
  };
  const stop = (): void => { cancelAnimationFrame(raf); raf = 0; setPlaying(false); };
  const tick = (now: number): void => {
    T += ((now - last) / 1000) * speed;
    last = now;
    show(kAt(tt, T, shown));
    if (shown >= n - 1 || T > x.lap.t) stop(); else raf = requestAnimationFrame(tick);
  };
  const start = (): void => {
    if (shown >= n - 1) seekK(0);
    setPlaying(true);
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };

  range.addEventListener('input', () => seekK(Number(range.value)));
  play.addEventListener('click', () => (raf ? stop() : start()));
  root.querySelectorAll<HTMLButtonElement>('[data-rp="prev"], [data-rp="next"]').forEach((b) =>
    b.addEventListener('click', () => seekK(stepTo(marks, shown, b.dataset.rp === 'next' ? 1 : -1))));
  root.querySelectorAll<HTMLInputElement>('input[name="rpv"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) speed = Number(r.value); }));
  show(0);
  return { seek: (s) => seekK(Math.round(s / TEL_DS)), stop };
}
