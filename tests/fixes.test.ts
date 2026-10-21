import { describe, expect, it } from 'vitest';
import { buildTrack } from '../src/tracks/build';
import { newCar, stepCar } from '../src/sim/car';
import { START } from '../src/sim/physics';
import { Race } from '../src/sim/race';
import { lapsOf } from '../src/ui/settings';
import { FACE_BELOW, detentAt, frameFor } from '../src/console/console';
import { BODY_OUTLINE } from '../src/console/livery';
import { lossMarks } from '../src/ui/telemetry';
import type { Loss } from '../src/sim/diagnose';
import type { Controls, Vec2 } from '../src/sim/types';

const circle: Vec2[] = Array.from({ length: 400 }, (_, i) => { const a = (i / 400) * Math.PI * 2; return [Math.cos(a) * 300, Math.sin(a) * 300] as Vec2; });
const track = buildTrack('c', 'c', circle);
const push: Controls = { lev: 2, ers: 1, bal: 56, lim: false, dif: 1, eb: 1, rst: [0, 0, 0] };

describe('grilla', () => {
  it('el motor no se calienta ni se enfría antes de la largada', () => {
    const c = newCar(track, 6, 0);
    const ctx = { green: false, t: 0, laps: 3, trail: false, faults: false };
    for (let i = 0; i < 6000; i++) stepCar(c, push, track, 0.02, ctx);
    expect(c.temp).toBe(START.TEMP);
    expect(c.bat).toBe(START.BAT);
  });

  it('la cuenta regresiva no cambia la temperatura de largada', () => {
    const r = new Race(track, { laps: 1, difficulty: 'normal', trail: false, bots: 1, faults: false });
    r.start();
    while (r.phase === 'count') r.step(0.02, 1, push);
    expect(r.player.temp).toBeCloseTo(START.TEMP, 0);
  });
});

describe('ajustes', () => {
  it('las vueltas quedan entre 1 y 20 y un campo vacío deja el valor anterior', () => {
    expect(lapsOf('0', 5)).toBe(1);
    expect(lapsOf('-3', 5)).toBe(1);
    expect(lapsOf('99', 5)).toBe(20);
    expect(lapsOf('4.6', 5)).toBe(5);
    expect(lapsOf('', 7)).toBe(7);
    expect(lapsOf('abc', 7)).toBe(7);
  });
});

describe('rotativos', () => {
  it('un toque va directo a la posición de la marca más cercana', () => {
    expect(detentAt(-12)).toBe(0);
    expect(detentAt(-6)).toBe(0);
    expect(detentAt(-4)).toBe(1);
    expect(detentAt(0)).toBe(1);
    expect(detentAt(4)).toBe(1);
    expect(detentAt(6)).toBe(2);
    expect(detentAt(16)).toBe(2);
  });
});

describe('encuadre de la consola', () => {
  const pxmm = (w: number, h: number, turning = false): number => h / (2 * frameFor(w, h, turning).hh);
  /** Cajas medidas en el navegador: teléfono vertical y apaisado, tableta, computadora. */
  const BOXES: [number, number][] = [[344, 301], [374, 328], [340, 272], [718, 396], [717, 640], [1200, 700]];

  it('en un teléfono vertical encuadra hasta las empuñaduras: enteras a la vista y los controles 1,2 veces más grandes', () => {
    const { hh, face } = frameFor(374, 328, false);
    expect(face).toBe(true);
    expect(hh * (374 / 328)).toBeGreaterThanOrEqual(141);
    expect(pxmm(374, 328) / (328 / (2 * (168 / (374 / 328))))).toBeGreaterThan(1.18);
  });

  it('con lugar sigue el volante entero, como antes', () => {
    expect(frameFor(717, 640, false)).toEqual({ hh: 168 / (717 / 640), face: false });
    expect(pxmm(717, 640)).toBeGreaterThanOrEqual(FACE_BELOW);
  });

  it.each(BOXES)('en %i × %i el cuerpo entero queda adentro', (w, h) => {
    const { hh } = frameFor(w, h, false), as = w / h, xs = BODY_OUTLINE.map(([x]) => Math.abs(x)), ys = BODY_OUTLINE.map(([, y]) => y);
    // La cámara mira a y = 4.
    expect(hh * as).toBeGreaterThanOrEqual(Math.max(...xs));
    expect(4 + hh).toBeGreaterThanOrEqual(Math.max(...ys));
    expect(4 - hh).toBeLessThanOrEqual(Math.min(...ys));
  });

  it.each(BOXES)('en %i × %i, girando hasta 90°, el cuerpo no se sale', (w, h) => {
    const { hh } = frameFor(w, h, true), r = Math.max(...BODY_OUTLINE.map(([x, y]) => Math.hypot(x, y)));
    expect(Math.min(hh, hh * (w / h))).toBeGreaterThanOrEqual(r + 4);
  });
});

describe('marcas de pérdidas', () => {
  it('dos pérdidas del mismo tramo comparten la marca y se numeran como en la lista', () => {
    const l = (s0: number): Loss => ({ cause: 'lev', ty: 's', s0, s1: s0 + 100, sec: 1, m: 100 });
    expect(lossMarks([l(300), l(300), l(100)])).toEqual([{ s: 300, n: '1, 2' }, { s: 100, n: '3' }]);
  });
});
