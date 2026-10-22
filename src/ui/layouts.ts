import type { Config } from '../config';

/**
 * Distribuciones de la pantalla de juego, en geometría: dónde caen la cabecera, el mapa y el volante para un ancho y un alto.
 * Puro (corre en Node). Lo usan el diagrama de la bienvenida y main (dónde va tu auto con el volante delante del mapa).
 * Los cortes y proporciones son los de styles.css: si cambian allá, cambian acá (lo controla tests/welcome.test.ts).
 */
export type Layout = Config['layout'];
export type ScreenKind = 'tel' | 'apaisado' | 'ancha' | 'angosta';
export interface Box { x: number; y: number; w: number; h: number }
export interface LayoutPlan {
  head: Box;
  map: Box;
  wheel: Box;
  /** El volante va apoyado abajo (o a la derecha) y tapa parte del mapa. */
  over: boolean;
  /** El mapa va sobre la pantalla del volante. */
  onWheel: boolean;
  /** Dónde va tu auto en el mapa cuando lo sigue (fracción del ancho y del alto), o null si el mapa muestra el circuito entero. */
  follow: [number, number] | null;
}

/** Teléfono vertical, teléfono apaisado, pantalla ancha (lado a lado en la automática) o angosta (apilada). */
export function screenKind(w: number, h: number): ScreenKind {
  if (w < 600) return 'tel';
  if (h < 500) return 'apaisado';
  return w >= 1100 || (w >= h && w >= 900) ? 'ancha' : 'angosta';
}

/** Volante delante del mapa: cuánto alto tapa (computadora y teléfono vertical) y cuánto ancho en el teléfono apaisado. */
export const COCKPIT = { cover: 0.68, coverTel: 0.58, side: 0.58 };
/** Dónde va tu auto con el volante delante del mapa: arriba al medio, o a la izquierda en el teléfono apaisado. */
export const cockpitFollow = (landscapePhone: boolean): [number, number] => (landscapePhone ? [0.22, 0.5] : [0.5, 0.22]);
/** Proporción del frente del volante hasta las empuñaduras, como la caja de la consola en el teléfono vertical. */
const FRONT = 204 / 282;

const HEAD: Record<ScreenKind, number> = { tel: 106, apaisado: 56, ancha: 48, angosta: 48 };
const GAP = 6;

const cols = (b: Box, left: number): [Box, Box] => {
  const lw = (b.w - GAP) * left;
  return [{ ...b, w: lw }, { ...b, x: b.x + lw + GAP, w: b.w - lw - GAP }];
};
const rows = (b: Box, top: number): [Box, Box] => {
  const th = (b.h - GAP) * top;
  return [{ ...b, h: th }, { ...b, y: b.y + th + GAP, h: b.h - th - GAP }];
};

/** Mapa y volante, cada uno en su panel: lado a lado, apilados o como en el teléfono. */
function split(kind: ScreenKind, layout: Layout, b: Box): [Box, Box] {
  if (layout === 'side') return cols(b, 1 / 2.15);
  if (layout === 'stack' || kind === 'angosta') return rows(b, 0.5);
  if (kind === 'ancha') return cols(b, 1 / 2.15);
  if (kind === 'apaisado') return cols(b, 1 / 1.8);
  // Teléfono vertical: la consola abajo con la proporción del frente, el mapa arriba debajo del renglón de la carrera.
  const wh = Math.min(b.w * FRONT, b.h - 190), race = 34, msg = 40;
  return [{ x: b.x, y: b.y + race, w: b.w, h: b.h - wh - race - msg - GAP }, { x: b.x, y: b.y + b.h - wh, w: b.w, h: wh }];
}

export function layoutPlan(layout: Layout, w: number, h: number): LayoutPlan {
  const kind = screenKind(w, h), hh = HEAD[kind];
  const head = { x: 0, y: 0, w, h: hh }, b = { x: GAP, y: hh, w: w - 2 * GAP, h: h - hh - GAP };
  if (layout === 'cockpit') {
    const wheel = kind === 'apaisado'
      ? { x: b.x + b.w * (1 - COCKPIT.side), y: b.y, w: b.w * COCKPIT.side, h: b.h }
      : { x: b.x, y: b.y + b.h * (1 - (kind === 'tel' ? COCKPIT.coverTel : COCKPIT.cover)), w: b.w, h: b.h * (kind === 'tel' ? COCKPIT.coverTel : COCKPIT.cover) };
    return { head, map: b, wheel, over: true, onWheel: false, follow: cockpitFollow(kind === 'apaisado') };
  }
  if (layout === 'screen') {
    // Apaisado: la carrera y el HUD en la columna de la izquierda. Si no, dos renglones arriba del volante.
    const wheel = kind === 'apaisado' ? cols(b, 0.7 / 2)[1] : { ...b, y: b.y + 44, h: b.h - 44 - 28 };
    return { head, map: wheel, wheel, over: false, onWheel: true, follow: null };
  }
  const [map, wheel] = split(kind, layout, b);
  return { head, map, wheel, over: false, onWheel: false, follow: null };
}

// ——— Diagrama ———

/** Medio ancho y medio alto del volante dibujado (mm) y la pantalla en coordenadas del SVG (y hacia abajo). */
const HALF: [number, number] = [137, 87];
const SCREEN = { x: -56, y: -58, w: 112, h: 62 };
/** Un circuito cualquiera, en una caja de 100 × 60. */
const LOOP = 'M12 42C8 22 22 10 40 14S62 30 74 18S96 16 92 36S70 54 52 48S20 58 12 42Z';
const n = (v: number): string => String(Math.round(v * 10) / 10);

/** Dónde queda la pantalla del volante cuando el volante entra en `b` sin deformarse. */
function screenIn(b: Box, low: boolean): Box {
  const k = Math.min(b.w / (2 * HALF[0]), b.h / (2 * HALF[1]));
  const cx = b.x + b.w / 2, cy = low ? b.y + b.h - HALF[1] * k : b.y + b.h / 2;
  return { x: cx + SCREEN.x * k, y: cy + SCREEN.y * k, w: SCREEN.w * k, h: SCREEN.h * k };
}

/** El circuito entero en la caja, con tu auto en la largada; o, siguiendo al auto, un tramo de pista que sube y pasa por él. */
function map2d(b: Box, follow: [number, number] | null): string {
  if (follow) {
    const cx = b.x + b.w * follow[0], cy = b.y + b.h * follow[1], s = Math.min(b.w, b.h);
    const road = `M${n(cx - s * 0.05)} ${n(b.y + b.h)}C${n(cx - s * 0.05)} ${n(cy + s * 0.2)} ${n(cx)} ${n(cy + s * 0.1)} ${n(cx)} ${n(cy)}S${n(cx + s * 0.35)} ${n(b.y + s * 0.02)} ${n(cx + s * 0.4)} ${n(b.y - 4)}`;
    return `<path d="${road}" class="dg-road"/><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(Math.max(3, s * 0.035))}" class="dg-car"/>`;
  }
  const k = Math.min((b.w * 0.86) / 100, (b.h * 0.8) / 60), x0 = b.x + (b.w - 100 * k) / 2, y0 = b.y + (b.h - 60 * k) / 2;
  return `<path d="${LOOP}" transform="translate(${n(x0)} ${n(y0)}) scale(${Math.round(k * 1000) / 1000})" class="dg-loop" vector-effect="non-scaling-stroke"/>`
    + `<circle cx="${n(x0 + 12 * k)}" cy="${n(y0 + 42 * k)}" r="${n(Math.max(2.5, k * 3))}" class="dg-car"/>`;
}

/** La pista en 3D: el camino hacia el horizonte, con tu auto adelante de la cámara (o donde lo deja el seguimiento). */
function map3d(b: Box, follow: [number, number] | null): string {
  const [fx, fy] = follow ?? [0.5, 0.62], cx = b.x + b.w * fx, cy = b.y + b.h * fy;
  const hz = b.y + b.h * Math.max(0.06, fy - 0.3), half = Math.min(b.w, b.h) * 0.42;
  const road = `${n(cx - 2)},${n(hz)} ${n(cx + 2)},${n(hz)} ${n(cx + half)},${n(b.y + b.h)} ${n(cx - half)},${n(b.y + b.h)}`;
  return `<line x1="${n(b.x)}" y1="${n(hz)}" x2="${n(b.x + b.w)}" y2="${n(hz)}" class="dg-hz"/><polygon points="${road}" class="dg-road3"/>`
    + `<line x1="${n(cx)}" y1="${n(hz)}" x2="${n(cx)}" y2="${n(b.y + b.h)}" class="dg-mid"/><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(Math.max(3, half * 0.09))}" class="dg-car"/>`;
}

const rect = (b: Box, cls: string, r = 4): string => `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" rx="${r}" class="${cls}"/>`;

/**
 * Diagrama de una distribución en un SVG de w × h (el alto y el ancho de esta pantalla): cabecera, mapa o pista 3D y el volante con su esquema.
 * `wheel` es el volante en mm centrado en 0 (sale de `wheelInner`); `id` separa los recortes de varios diagramas en la misma página.
 */
export function layoutSvg(layout: Layout, view: Config['mapView'], w: number, h: number, wheel: string, id: string): string {
  const p = layoutPlan(layout, w, h), clip = `${id}-map`;
  const area = p.onWheel ? screenIn(p.wheel, false) : p.map;
  const draw = view === '3d' ? map3d(area, p.follow) : map2d(area, p.follow);
  const pills = [0.06, 0.2, 0.3].map((x, i) => rect({ x: w * x, y: p.head.h * 0.3, w: i ? w * 0.08 : w * 0.11, h: p.head.h * 0.4 }, 'dg-pill', 3)).join('');
  const box = `${-HALF[0]} ${-HALF[1]} ${2 * HALF[0]} ${2 * HALF[1]}`;
  const wheelSvg = `<svg x="${n(p.wheel.x)}" y="${n(p.wheel.y)}" width="${n(p.wheel.w)}" height="${n(p.wheel.h)}" viewBox="${box}" preserveAspectRatio="${p.over ? 'xMidYMax' : 'xMidYMid'} meet">${wheel}</svg>`;
  const mapPart = `<clipPath id="${clip}">${rect(area, '', p.onWheel ? 1 : 4)}</clipPath>${rect(area, 'dg-panel', p.onWheel ? 1 : 4)}<g clip-path="url(#${clip})">${draw}</g>`;
  const wheelPanel = p.over || p.onWheel ? '' : rect(p.wheel, 'dg-panel');
  // Mapa en el volante: el volante primero y el mapa encima, sobre su pantalla.
  const body = p.onWheel ? `${wheelSvg}${mapPart}` : `${mapPart}${wheelPanel}${wheelSvg}`;
  return `<svg viewBox="0 0 ${n(w)} ${n(h)}" class="diagram" aria-hidden="true">${rect({ x: 0, y: 0, w, h }, 'dg-frame', 6)}${pills}${body}</svg>`;
}
