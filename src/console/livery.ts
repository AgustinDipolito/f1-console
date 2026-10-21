import type { Palette } from '../render/palette';

/** Punto del frente del volante en mm: x a la derecha, y arriba, centro del volante en 0. */
export type Pt = [number, number];
/** Calcomanía: polígono convexo pintado sobre el frente. Se recorta contra el borde del frente. */
export interface Decal { hex: number; pts: Pt[] }
/**
 * Colores del volante: cuerpo (con levas y buje), frente (la placa que cubre casi todo el cuerpo),
 * empuñaduras, perillas o botones y tapa de los rotativos. Las calcomanías se pintan sobre el frente, en orden.
 */
export interface WheelColors { body: number; face: number; grip: number; knob: number; cap?: number; decals?: Decal[] }
export interface Livery { name: string; light: WheelColors | null; dark: WheelColors | null }

/** Cuerpo: arriba recto, costados hasta las empuñaduras y mentón que se angosta. */
export const BODY_OUTLINE: Pt[] = [[-92, 72], [92, 72], [100, 66], [102, -30], [82, -70], [-82, -70], [-102, -30], [-100, 66]];
export const FACE_OUTLINE: Pt[] = BODY_OUTLINE.map(([x, y]): Pt => [x * 0.93, y * 0.93 - 1]);

const cross = (a: Pt, b: Pt, p: Pt): number => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
export const area = (pts: Pt[]): number =>
  pts.reduce((s, [x, y], i) => { const [u, v] = pts[(i + 1) % pts.length]; return s + x * v - u * y; }, 0) / 2;
const meet = (p: Pt, q: Pt, a: Pt, b: Pt): Pt => {
  const dp = cross(a, b, p), t = dp / (dp - cross(a, b, q));
  return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
};
function clipEdge(src: Pt[], a: Pt, b: Pt, sg: number): Pt[] {
  const out: Pt[] = [], ins = (p: Pt): boolean => cross(a, b, p) * sg >= 0;
  src.forEach((q, j) => {
    const p = src[(j + src.length - 1) % src.length];
    if (ins(q) !== ins(p)) out.push(meet(p, q, a, b));
    if (ins(q)) out.push(q);
  });
  return out;
}
/** La parte de `pts` dentro del polígono convexo `win` (Sutherland–Hodgman). */
export const clip = (pts: Pt[], win: Pt[]): Pt[] => {
  const sg = Math.sign(area(win));
  return win.reduce((src, a, i) => (src.length ? clipEdge(src, a, win[(i + 1) % win.length], sg) : src), pts);
};

/** Franja entre dos rectas paralelas: los puntos con from ≤ x·cos a + y·sen a ≤ to (a en grados). */
const band = (a: number, from: number, to: number): Pt[] => {
  const r = (a * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), L = 400;
  return [[c * from + s * L, s * from - c * L], [c * to + s * L, s * to - c * L], [c * to - s * L, s * to + c * L], [c * from - s * L, s * from + c * L]];
};
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
/** La misma figura reflejada al otro lado del volante. */
const both = (pts: Pt[]): Pt[][] => [pts, pts.map(([x, y]): Pt => [-x, y]).reverse()];
const paint = (hex: number, shapes: Pt[][]): Decal[] => shapes.map((pts) => ({ hex, pts }));
/** Damero de n × m casillas desde la esquina (x0, y0), con la primera casilla pintada. */
const checker = (x0: number, y0: number, n: number, m: number, size: number): Pt[][] =>
  Array.from({ length: n * m }, (_, k) => [k % n, Math.floor(k / n)])
    .filter(([i, j]) => (i + j) % 2 === 0)
    .map(([i, j]) => rect(x0 + i * size, y0 + j * size, x0 + (i + 1) * size, y0 + (j + 1) * size));
/** Franjas a 45° de ancho w cada 2w, solo dentro de `win`. Las que no tocan el frente se descartan. */
const hazard = (win: Pt[], w: number, from: number, to: number): Pt[][] =>
  Array.from({ length: Math.ceil((to - from) / (2 * w)) }, (_, i) => clip(band(45, from + 2 * i * w, from + (2 * i + 1) * w), win))
    .filter((p) => Math.abs(area(clip(p, FACE_OUTLINE))) > 1);
const same = (name: string, w: WheelColors): Livery => ({ name, light: w, dark: w });

/**
 * Esquemas cerrados. Ningún color se acerca a los de dato (lámparas, LEDs, delta): lo controla
 * `tests/livery.test.ts`. Por eso no hay rojo, naranja, verde agua ni azul medio. Carbono usa los tonos del tema.
 */
export const LIVERIES: Record<string, Livery> = {
  carbono: { name: 'Carbono', light: null, dark: null },
  neon: same('Neón', {
    body: 0x0e0e11, face: 0x1a1a20, grip: 0x111114, knob: 0x2a2a31, cap: 0xc6ff00,
    decals: [...paint(0xc6ff00, both(band(15, 64, 76))), ...paint(0xff2bd6, [...both(band(15, 79, 82)), rect(-2, -70, 2, -27)])],
  }),
  celeste: same('Celeste y blanco', {
    body: 0x14254d, face: 0xf3f5f7, grip: 0x1b2a4f, knob: 0x8fd3ff, cap: 0xf3f5f7,
    decals: [...paint(0x8fd3ff, [band(90, 42, 100), band(90, -100, -10)]), ...paint(0x14254d, [band(90, 38, 39.5), band(90, -7.5, -6)])],
  }),
  atardecer: same('Atardecer', {
    body: 0x150c2c, face: 0x24134a, grip: 0x160e2a, knob: 0x3a1f6e, cap: 0xff7ad9,
    decals: [
      ...paint(0xff7ad9, [band(90, -9, -7), band(90, 47, 49)]),
      ...paint(0xc4169c, [band(90, -15, -11.5), band(90, 51.5, 55)]),
      ...paint(0x8f3dff, [band(90, -100, -18), band(90, 58, 100)]),
    ],
  }),
  damero: same('Damero', {
    body: 0x0c0c0e, face: 0x16161a, grip: 0x101012, knob: 0x2a2a2e, cap: 0xf2f2f2,
    decals: paint(0xf2f2f2, [...checker(57, -31, 5, 12, 8), ...checker(-97, -31, 5, 12, 8)]),
  }),
  violeta: same('Violeta eléctrico', {
    body: 0x1a0b3d, face: 0x5b22d9, grip: 0x1d1240, knob: 0x2c1766, cap: 0x29f0ff,
    decals: [...paint(0x29f0ff, [band(135, -40, -28)]), ...paint(0xffffff, [band(135, -24, -22)])],
  }),
  rosa: same('Rosa chicle', {
    body: 0x111113, face: 0xff5cb8, grip: 0x1a1a1d, knob: 0x111113, cap: 0xffffff,
    decals: [...paint(0xffffff, both(band(-30, 58, 68))), ...paint(0x111113, both(band(-30, 72, 75)))],
  }),
  limon: same('Limón', {
    body: 0x101010, face: 0xe1ff2e, grip: 0x161616, knob: 0x161616, cap: 0xe1ff2e,
    decals: paint(0x161616, [...hazard(rect(57, -70, 100, 0), 5, -20, 80), ...hazard(rect(-100, -70, -57, 0), 5, -130, -30)]),
  }),
  artico: same('Ártico', {
    body: 0xf4f6f8, face: 0xdfe5ea, grip: 0x2a2e33, knob: 0x2a2e33, cap: 0x00d9ff,
    decals: [...paint(0x16181b, both(band(20, 70, 100))), ...paint(0x00d9ff, both(band(20, 64, 67)))],
  }),
};

/** Opción de ajustes (y la de fábrica): un esquema cualquiera cada vez que se abre la consola. */
export const RANDOM_LIVERY = 'azar';
/** El esquema que toca para lo elegido en ajustes. r: número al azar entre 0 y 1. */
export function pickLivery(id: string, r = Math.random()): string {
  if (id !== RANDOM_LIVERY) return id;
  const ids = Object.keys(LIVERIES);
  return ids[Math.min(ids.length - 1, Math.floor(r * ids.length))];
}

/** Un esquema desconocido (de una config vieja o editada a mano) cae en carbono. */
export const wheelColors = (id: string, theme: 'light' | 'dark', pal: Palette): WheelColors =>
  LIVERIES[id]?.[theme] ?? { body: pal.lo, face: pal.mid, grip: pal.mid, knob: pal.hi };

/** Calcomanías recortadas al frente; las que quedan afuera no se pintan. */
export const faceDecals = (w: WheelColors): Decal[] =>
  (w.decals ?? []).map((d) => ({ hex: d.hex, pts: clip(d.pts, FACE_OUTLINE) })).filter((d) => d.pts.length >= 3 && Math.abs(area(d.pts)) > 1);
