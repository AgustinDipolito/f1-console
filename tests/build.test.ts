import { describe, expect, it } from 'vitest';
import { buildTrack, coordsOf, geoToMeters } from '../src/tracks/build';
import { PHYS } from '../src/sim/physics';
import type { Track, Vec2 } from '../src/sim/types';

const circle = (r: number, n = 400): Vec2[] =>
  Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return [Math.cos(a) * r, Math.sin(a) * r] as Vec2; });

describe('buildTrack', () => {
  it('mide el largo de un círculo', () => {
    const t = buildTrack('c', 'c', circle(300));
    expect(t.len).toBeGreaterThan(2 * Math.PI * 300 * 0.98);
    expect(t.len).toBeLessThan(2 * Math.PI * 300 * 1.01);
  });

  it('limita la velocidad por agarre lateral', () => {
    const t = buildTrack('c', 'c', circle(100));
    const expected = Math.sqrt(PHYS.A_LAT * 100), v = t.v[Math.floor(t.n / 2)];
    expect(v).toBeGreaterThan(expected * 0.9);
    expect(v).toBeLessThan(expected * 1.1);
    expect(t.ty.every((s) => s === 'c')).toBe(true);
  });
});

const files = import.meta.glob<string>('../public/tracks/*.geojson', { eager: true, query: '?raw', import: 'default' });
const json = (f: string) => JSON.parse(files[f]);
const real = Object.keys(files);
const load = (f: string): Track => buildTrack(f, f, geoToMeters(coordsOf(json(f))!));

describe.skipIf(!real.length)('trazados reales', () => {
  it.each(real)('%s: ningún tramo dura menos de lo que se puede reaccionar', (f) => {
    const t = load(f);
    let acc = 0, st = 0;
    while (t.ty[st] === t.ty[(st - 1 + t.n) % t.n]) st++;
    for (let k = 0; k < t.n; k++) {
      const i = (st + k) % t.n;
      acc += t.ds / t.v[i];
      if (t.ty[i] !== t.ty[(i + 1) % t.n]) {
        expect(acc).toBeGreaterThan((t.ty[i] === 'b' ? PHYS.SEG_MIN_B : PHYS.SEG_MIN) - 0.05);
        acc = 0;
      }
    }
  });

  it('las salidas de curva aparecen en casi todos los circuitos', () => {
    expect(real.filter((f) => load(f).ty.includes('x')).length).toBeGreaterThan(real.length * 0.8);
  });

  it.each(real)('%s: el largo procesado está cerca del oficial', (f) => {
    const off = json(f).features[0].properties.length as number;
    expect(Math.abs(load(f).len / off - 1)).toBeLessThan(0.05);
  });
});
