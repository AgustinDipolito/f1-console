import { describe, expect, it } from 'vitest';
import { ALERT_COLORS, DELTA_COLORS, FACE_OUTLINE, LED_COLOR, LIVERIES, RANDOM_LIVERY, area, clip, faceDecals, pickLivery, wheelColors, type Pt } from '../src/console/panel';
import { PALETTES } from '../src/render/palette';

const rgb = (h: number): number[] => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const dist = (a: number, b: number): number => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
/** Colores que son dato: lámparas, LEDs de tramo, delta (el rojo de zonas y fusibles es el mismo de las alarmas). */
const DATA = [...ALERT_COLORS, LED_COLOR, DELTA_COLORS.gain, DELTA_COLORS.lose];
const variants = Object.entries(LIVERIES).flatMap(([id, l]) => [l.light, l.dark].filter((w) => w !== null).map((w) => [id, w] as const));

describe('esquemas del volante', () => {
  it('ningún color del volante se confunde con un color de dato', () => {
    for (const [id, w] of variants)
      for (const c of [w.body, w.face, w.grip, w.knob, w.cap ?? w.knob, ...(w.decals ?? []).map((d) => d.hex)])
        for (const d of DATA) expect(dist(c, d), `${id} ${c.toString(16)} contra ${d.toString(16)}`).toBeGreaterThan(90);
  });

  it('cada calcomanía cae sobre el frente', () => {
    for (const [id, w] of variants) expect(faceDecals(w).length, id).toBe(w.decals?.length ?? 0);
  });

  it('carbono y un esquema desconocido usan los tonos del tema', () => {
    const p = PALETTES.dark, base = { body: p.lo, face: p.mid, grip: p.mid, knob: p.hi };
    expect(wheelColors('carbono', 'dark', p)).toEqual(base);
    expect(wheelColors('no-existe', 'dark', p)).toEqual(base);
    expect(wheelColors('neon', 'light', PALETTES.light)).toEqual(LIVERIES.neon.light);
  });

  it('al azar sortea entre todos los esquemas, y uno elegido queda como está', () => {
    const ids = Object.keys(LIVERIES);
    expect(pickLivery(RANDOM_LIVERY, 0)).toBe(ids[0]);
    expect(pickLivery(RANDOM_LIVERY, 0.9999)).toBe(ids[ids.length - 1]);
    expect(pickLivery(RANDOM_LIVERY, 1)).toBe(ids[ids.length - 1]);
    expect(new Set(Array.from({ length: 100 }, (_, i) => pickLivery(RANDOM_LIVERY, i / 100))).size).toBe(ids.length);
    expect(pickLivery('neon')).toBe('neon');
  });
});

describe('recorte de calcomanías', () => {
  const sq: Pt[] = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
  it('lo que está adentro queda igual y lo de afuera desaparece', () => {
    expect(area(clip(sq, FACE_OUTLINE))).toBeCloseTo(400);
    expect(clip(sq.map(([x, y]): Pt => [x + 300, y]), FACE_OUTLINE)).toEqual([]);
  });
  it('lo que cruza el borde queda cortado en el borde', () => {
    // Mitad del cuadrado por encima del borde de arriba del frente (y = 65,96).
    const top = 72 * 0.93 - 1, cut = clip(sq.map(([x, y]): Pt => [x, y + top]), FACE_OUTLINE);
    expect(Math.abs(area(cut))).toBeCloseTo(200);
    expect(Math.max(...cut.map(([, y]) => y))).toBeCloseTo(top);
  });
});
