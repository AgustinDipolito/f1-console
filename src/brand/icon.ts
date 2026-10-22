import { BODY_OUTLINE, FACE_OUTLINE, type Decal, type Pt } from '../console/livery';
import { PALETTES } from '../render/palette';

/**
 * Ícono de la aplicación: el volante de frente, en los tonos claros de carbono, sobre una placa oscura.
 * Es un solo dibujo en milímetros del volante (x a la derecha, y arriba, como `livery.ts`) y de él salen todas
 * las variantes: el SVG del favicon y los PNG del manifiesto, que `npm run icons` rasteriza desde acá.
 *
 * - any: placa con esquinas redondeadas y el resto transparente (favicon, escritorio).
 * - full: la misma composición a sangre, sin esquinas propias (iPhone: el sistema redondea).
 * - maskable: a sangre y con todo el dibujo dentro del círculo seguro, de radio 40 % del lado (Android recorta con su forma).
 */
export type IconKind = 'any' | 'full' | 'maskable';
export const ICON_KINDS: IconKind[] = ['any', 'full', 'maskable'];

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
const L = PALETTES.light;
/** La placa es el fondo del tema oscuro; los LEDs, el azul de tramo. */
export const TILE = '#1c1c1a';
/**
 * Tonos del dibujo. knob: perillas de los rotativos; button: BB y limitador; ink: contornos; screen, bar y lit: la pantalla.
 * El ícono va en carbono claro; la bienvenida dibuja cada esquema del volante con el mismo dibujo.
 */
export interface WheelInk { grip: string; body: string; face: string; knob: string; button: string; ink: string; screen: string; bar: string; lit: string; led: string }
const C: WheelInk = { grip: hex(L.mid), body: hex(L.lo), face: hex(L.mid), knob: hex(L.hi), button: hex(L.ink), ink: hex(L.ink), screen: hex(L.ink), bar: hex(L.slot), lit: hex(L.hi), led: '#378add' };
/** Grosor del contorno en mm del volante. */
const STROKE = 3;
/** Radio del círculo seguro del ícono enmascarable, en unidades de un lado de 100. */
export const SAFE_R = 40;

type Shape =
  | { k: 'rect'; x: number; y: number; w: number; h: number; r: number; fill: string; line?: boolean }
  | { k: 'circle'; x: number; y: number; r: number; fill: string; line?: boolean }
  | { k: 'poly'; pts: Pt[]; fill: string; line?: boolean }
  | { k: 'seg'; a: Pt; b: Pt; color: string; w: number };

/** Pantalla: tres barras con su aguja; luces de tramo arriba; cuatro rotativos, BB y limitador. */
const SCREEN = { y: 27, w: 112, h: 62 };
const BARS: [number, number][] = [[44, 0.7], [27, 0.35], [10, 0.55]];
const LEDS = 9;
/** El volante de frente con esos tonos. Las calcomanías (ya recortadas al frente) van sobre el frente y debajo de la pantalla. */
export function wheelShapes(c: WheelInk, decals: Decal[] = []): Shape[] {
  return [
    ...[-117, 117].map((x): Shape => ({ k: 'rect', x, y: 0, w: 36, h: 170, r: 18, fill: c.grip, line: true })),
    { k: 'poly', pts: BODY_OUTLINE, fill: c.body, line: true },
    { k: 'poly', pts: FACE_OUTLINE, fill: c.face },
    ...decals.map((d): Shape => ({ k: 'poly', pts: d.pts, fill: hex(d.hex) })),
    { k: 'rect', x: 0, y: SCREEN.y, w: SCREEN.w, h: SCREEN.h, r: 5, fill: c.screen },
    ...BARS.flatMap(([y, at]): Shape[] => {
      const x0 = -44, x1 = 44, nx = x0 + (x1 - x0) * at;
      return [{ k: 'seg', a: [x0, y], b: [x1, y], color: c.bar, w: 2.4 }, { k: 'seg', a: [nx, y - 6], b: [nx, y + 6], color: c.lit, w: 4 }];
    }),
    ...Array.from({ length: LEDS }, (_, i): Shape => ({ k: 'circle', x: -56 + (i * 112) / (LEDS - 1), y: 66, r: 4.2, fill: c.led })),
    ...[-66, -22, 22, 66].flatMap((x): Shape[] => [
      { k: 'circle', x, y: -44, r: 13, fill: c.knob, line: true },
      { k: 'seg', a: [x, -44], b: [x, -33], color: c.ink, w: STROKE },
    ]),
    ...([[-84, 34], [-84, 12], [84, 56]] as Pt[]).map(([x, y]): Shape => ({ k: 'circle', x, y, r: 7, fill: c.button })),
  ];
}
export const SHAPES: Shape[] = wheelShapes(C);

/** Escala (unidades por mm) de cada variante, sobre un lado de 100. */
export function iconScale(kind: IconKind): number {
  return kind === 'maskable' ? (SAFE_R - 1) / contentRadius() : 0.3;
}

/** Distancia más lejana del centro a la que llega algo dibujado, en mm, contando medio contorno. */
export function contentRadius(): number {
  const far = (s: Shape): number => {
    const pad = 'line' in s && s.line ? STROKE / 2 : 0;
    if (s.k === 'circle') return Math.hypot(s.x, s.y) + s.r + pad;
    if (s.k === 'poly') return Math.max(...s.pts.map(([x, y]) => Math.hypot(x, y))) + pad;
    if (s.k === 'seg') return Math.max(Math.hypot(...s.a), Math.hypot(...s.b)) + s.w / 2;
    // Rectángulo redondeado: la esquina más lejana es un arco de radio r.
    return Math.hypot(Math.abs(s.x) + s.w / 2 - s.r, Math.abs(s.y) + s.h / 2 - s.r) + s.r + pad;
  };
  return Math.max(...SHAPES.map(far));
}

const n = (v: number): string => String(Math.round(v * 100) / 100);
const stroke = (ink: string, on?: boolean): string => (on ? ` stroke="${ink}" stroke-width="${STROKE}"` : '');

function shapeSvg(s: Shape, ink = C.ink): string {
  if (s.k === 'rect') return `<rect x="${n(s.x - s.w / 2)}" y="${n(s.y - s.h / 2)}" width="${n(s.w)}" height="${n(s.h)}" rx="${n(s.r)}" fill="${s.fill}"${stroke(ink, s.line)}/>`;
  if (s.k === 'circle') return `<circle cx="${n(s.x)}" cy="${n(s.y)}" r="${n(s.r)}" fill="${s.fill}"${stroke(ink, s.line)}/>`;
  if (s.k === 'poly') return `<polygon points="${s.pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="${s.fill}" stroke-linejoin="round"${stroke(ink, s.line)}/>`;
  return `<line x1="${n(s.a[0])}" y1="${n(s.a[1])}" x2="${n(s.b[0])}" y2="${n(s.b[1])}" stroke="${s.color}" stroke-width="${n(s.w)}" stroke-linecap="round"/>`;
}

/** Medio ancho y medio alto del volante dibujado, en mm, con el contorno: la caja donde entra entero. */
export const WHEEL_HALF: Pt = [137, 87];
/** Las piezas del volante en un sistema con y hacia arriba en mm, para meter adentro de un SVG con `viewBox` centrado en 0. */
export const wheelInner = (c: WheelInk, decals: Decal[] = []): string =>
  `<g transform="scale(1 -1)">${wheelShapes(c, decals).map((s) => shapeSvg(s, c.ink)).join('')}</g>`;

/** SVG de la variante, en un lado de 100. El dibujo va con y hacia arriba: se da vuelta con la escala. */
export function iconSvg(kind: IconKind): string {
  const s = Math.round(iconScale(kind) * 1e4) / 1e4;
  const tile = kind === 'any' ? `<rect width="100" height="100" rx="22" fill="${TILE}"/>` : `<rect width="100" height="100" fill="${TILE}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${tile}<g transform="translate(50 50) scale(${s} ${-s})">${SHAPES.map((sh) => shapeSvg(sh)).join('')}</g></svg>`;
}

/** Huella del SVG de una variante (FNV-1a). Cada PNG la lleva adentro: si el dibujo cambió y no se regeneró, no coincide. */
export function iconHash(kind: IconKind): string {
  let h = 0x811c9dc5;
  for (const ch of iconSvg(kind)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
export const HASH_KEY = 'svg-fnv1a';

/** Archivos que salen del dibujo: la variante y el lado en píxeles. El SVG va a la raíz de public/, los PNG a public/icons/. */
export const ICON_FILES: { file: string; kind: IconKind; size: number }[] = [
  { file: 'icons/icon-192.png', kind: 'any', size: 192 },
  { file: 'icons/icon-512.png', kind: 'any', size: 512 },
  { file: 'icons/maskable-192.png', kind: 'maskable', size: 192 },
  { file: 'icons/maskable-512.png', kind: 'maskable', size: 512 },
  { file: 'icons/apple-touch-icon.png', kind: 'full', size: 180 },
];
