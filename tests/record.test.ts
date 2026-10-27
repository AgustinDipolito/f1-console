import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULTS, loadBest, loadConfig, saveBest, saveConfig } from '../src/config';
import { EV_KEYS, EV_VMAX, categoryKey, categoryOf, smCount } from '../src/sim/telemetry';
import type { Ev, Lap } from '../src/sim/types';

// localStorage de mentira: los tests corren en Node.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
});
beforeEach(() => store.clear());
afterAll(() => vi.unstubAllGlobals());

const cat = categoryOf('oval', 3, 'normal');
const bestKey = (c = cat): string => `f1c.best.v2.${categoryKey(c)}`;

/** Una vuelta con traza completa: 171 registros de 10 m, 30 eventos, muestras y consola de la línea. */
const lap = (t = 28): Lap => {
  const n = 171;
  return {
    t, tt: Array.from({ length: n }, (_, k) => (k * t) / n), v: Array.from({ length: n }, (_, k) => 40 + (k % 9)),
    c0: { lev: 1, ers: 1, bal: 56, dif: 1, eb: 1, lim: 0 },
    ev: Array.from({ length: 30 }, (_, i): Ev => { const k = EV_KEYS[i % 6]; return { s: 10 + i * 50, t: i, k, v: i % (EV_VMAX[k] + 1) }; }),
    sm: Array.from({ length: smCount(n) }, (_, i) => ({ bat: 90 - i, temp: 85 + (i % 10), tyre: 100 - i, fuel: Math.round((9 - i * 0.2) * 10) / 10 })),
  };
};
const legacy = { t: 25.5, tt: [0, 1.5, null], v: [30, 31, null] };

describe('mejor vuelta por categoría', () => {
  it('guarda la primera y la devuelve con eventos, muestras y consola', () => {
    const l = lap();
    expect(loadBest(cat)).toBeNull();
    expect(saveBest(cat, l)).toBe(true);
    const b = loadBest(cat);
    expect(b?.legacy).toBe(false);
    expect(b?.cat).toEqual(cat);
    expect(b?.lap.c0).toEqual(l.c0);
    expect(b?.lap.sm).toEqual(l.sm);
    expect(b?.lap.ev?.map((e) => [e.s, e.k, e.v])).toEqual(l.ev?.map((e) => [e.s, e.k, e.v]));
    expect(b?.lap.t).toBeCloseTo(l.t, 3);
  });

  it('un tiempo peor no pisa el récord, uno mejor sí', () => {
    saveBest(cat, lap(28));
    expect(saveBest(cat, lap(28.5))).toBe(false);
    expect(saveBest(cat, lap(28))).toBe(false);
    expect(loadBest(cat)?.lap.t).toBeCloseTo(28, 3);
    expect(saveBest(cat, lap(27.5))).toBe(true);
    expect(loadBest(cat)?.lap.t).toBeCloseTo(27.5, 3);
  });

  it('otra categoría no se toca', () => {
    const others = [categoryOf('oval', 5, 'normal'), categoryOf('oval', 3, 'hard'), { ...cat, ver: cat.ver + 1 }, categoryOf('otro', 3, 'normal')];
    saveBest(cat, lap(28));
    for (const o of others) {
      expect(loadBest(o)).toBeNull();
      expect(saveBest(o, lap(30))).toBe(true);
    }
    expect(loadBest(cat)?.lap.t).toBeCloseTo(28, 3);
    expect(loadBest(others[1])?.lap.t).toBeCloseTo(30, 3);
    expect(saveBest(others[0], lap(31))).toBe(false);
  });

  it('el v1 se lee como legacy solo si no hay v2', () => {
    store.set('f1c.best.v1.oval', JSON.stringify(legacy));
    const b = loadBest(cat);
    expect(b?.legacy).toBe(true);
    expect(b?.cat).toEqual(cat);
    expect(b?.lap.t).toBe(25.5);
    expect(Number.isNaN(b?.lap.tt[2])).toBe(true);
    // Otro circuito no hereda el v1.
    expect(loadBest(categoryOf('otro', 3, 'normal'))).toBeNull();
    saveBest(cat, lap(28));
    expect(loadBest(cat)?.legacy).toBe(false);
  });

  it('con solo legacy, la primera vuelta crea el v2 aunque sea más lenta, y el v1 queda como estaba', () => {
    store.set('f1c.best.v1.oval', JSON.stringify(legacy));
    expect(saveBest(cat, lap(40))).toBe(true);
    expect(loadBest(cat)).toMatchObject({ legacy: false });
    expect(loadBest(cat)?.lap.t).toBeCloseTo(40, 3);
    expect(JSON.parse(store.get('f1c.best.v1.oval') as string)).toEqual(legacy);
  });

  it('una vuelta sin traza no es récord', () => {
    const { sm: _sm, ...noSm } = lap();
    expect(saveBest(cat, noSm)).toBe(false);
    expect(saveBest(cat, { ...lap(), c0: undefined })).toBe(false);
    expect(store.size).toBe(0);
  });

  it('un récord dañado se ignora sin tirar y se pisa con la próxima vuelta', () => {
    for (const bad of ['"basura"', '123', '{"a":1}', 'null', 'no es json {', '"oval~x~AAAA"', '"oval~x~Ag"']) {
      store.set(bestKey(), bad);
      expect(() => loadBest(cat)).not.toThrow();
      expect(loadBest(cat)).toBeNull();
      expect(saveBest(cat, lap(28))).toBe(true);
      expect(loadBest(cat)?.legacy).toBe(false);
    }
  });

  it('un código de otra categoría guardado en la clave no vale', () => {
    saveBest(categoryOf('oval', 5, 'normal'), lap(28));
    store.set(bestKey(), store.get(bestKey(categoryOf('oval', 5, 'normal'))) as string);
    expect(loadBest(cat)).toBeNull();
  });
});

describe('configuración', () => {
  it('una config vieja sin modo carga carrera, y con rev 1 sigue valiendo CHANGED', () => {
    store.set('f1c.config.v1', JSON.stringify({ circuit: 'x', laps: 5, livery: 'carbono', theme: 'light', rev: 1 }));
    const c = loadConfig();
    expect(c.mode).toBe('race');
    expect(c.challenge).toBe('');
    expect(c.chaseHead).toBe(6);
    expect(c.circuit).toBe('x');
    expect(c.laps).toBe(5);
    expect(c.livery).toBe(DEFAULTS.livery);
    expect(c.theme).toBe(DEFAULTS.theme);
  });

  it('el modo, el desafío y la ventaja se guardan y vuelven', () => {
    saveConfig({ ...DEFAULTS, mode: 'chase', challenge: 'fusible', chaseHead: 10, livery: 'carbono' });
    const c = loadConfig();
    expect(c).toMatchObject({ mode: 'chase', challenge: 'fusible', chaseHead: 10, livery: 'carbono' });
  });
});
