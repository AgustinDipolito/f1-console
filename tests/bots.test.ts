import { describe, expect, it } from 'vitest';
import { buildTrack, coordsOf, geoToMeters } from '../src/tracks/build';
import { fuelLoad, remaining } from '../src/sim/car';
import { FUEL } from '../src/sim/physics';
import { Race, gridSlot } from '../src/sim/race';
import { BOT_LEVELS, botControls, botLevel } from '../src/bot/bot';
import type { Controls, Vec2 } from '../src/sim/types';

const circle: Vec2[] = Array.from({ length: 600 }, (_, i) => { const a = (i / 600) * Math.PI * 2; return [Math.cos(a) * 500 + Math.cos(4 * a) * 60, Math.sin(a) * 300] as Vec2; });
const track = buildTrack('c', 'c', circle);
const ctl: Controls = { lev: 1, ers: 1, bal: 56, lim: false, dif: 1, eb: 1, rst: [0, 0, 0] };

describe('hasta 10 bots', () => {
  it('la grilla va de a dos por fila y el primer bot queda donde estaba', () => {
    expect(gridSlot(0)).toEqual({ gap: 14, lat: 2 });
    expect(gridSlot(1)).toEqual({ gap: 14, lat: -2 });
    expect(gridSlot(9)).toEqual({ gap: 46, lat: -2 });
  });

  it('el primer bot rinde exacto según la dificultad y el resto se dispersa', () => {
    expect(botLevel('normal', 0)).toBe(BOT_LEVELS.normal);
    const delays = Array.from({ length: 10 }, (_, i) => botLevel('normal', i).delay);
    expect(new Set(delays.map((d) => d.toFixed(2))).size).toBeGreaterThan(5);
    expect(Math.min(...delays)).toBeGreaterThan(BOT_LEVELS.normal.delay * 0.7);
    expect(Math.max(...delays)).toBeLessThan(BOT_LEVELS.normal.delay * 1.3);
  });

  it('con 10 bots todos terminan y el pelotón se estira', () => {
    const r = new Race(track, { laps: 3, difficulty: 'normal', trail: false, bots: 10, faults: false, seed: 3 });
    r.start();
    for (let i = 0; i < 300000 && !r.cars.every((c) => c.done); i++) r.step(0.02, 1, ctl);
    expect(r.cars.every((c) => c.done)).toBe(true);
    const fins = r.bots.map((b) => b.fin as number);
    expect(Math.max(...fins) - Math.min(...fins)).toBeGreaterThan(1);
  });

  it('solo se nombran vos y los bots del podio', () => {
    const r = new Race(track, { laps: 1, difficulty: 'normal', trail: false, bots: 10, faults: false });
    r.start();
    for (let i = 0; i < 2000; i++) r.step(0.02, 1, { ...ctl, lim: true });
    const tags = r.tags(), top = new Set(r.order().slice(0, 3));
    expect(tags[0]).toBe('Vos');
    expect(tags.filter(Boolean).length).toBe(top.has(r.player) ? 3 : 4);
    r.bots.forEach((b, i) => expect(tags[i + 1] !== '').toBe(top.has(b)));
    r.snap('x', 'Ana', { t: r.t, d: 0, v: 10, off: 0, done: false, fin: null, best: null });
    expect(r.tags().at(-1)).toBe('Ana');
  });
});

describe('nafta en Gálvez', () => {
  const raw = Object.values(import.meta.glob<string>('../public/tracks/ar-1952.geojson', { eager: true, query: '?raw', import: 'default' }))[0];
  const galvez = buildTrack('ar-1952', 'Gálvez', geoToMeters(coordsOf(JSON.parse(raw))!));

  it('el consumo por vuelta es el mismo que en cualquier otro trazado: BURN por metro', () => {
    const per = galvez.len * FUEL.BURN;
    expect(fuelLoad(galvez, 3) / per).toBeCloseTo(3 * FUEL.LOAD, 6);
    expect(galvez.len).toBeGreaterThan(4000);
    expect(galvez.len).toBeLessThan(4600);
  });

  it.each(['easy', 'normal', 'hard'] as const)('en %s ningún auto se queda sin nafta antes de los últimos 50 m', (d) => {
    const laps = 2, r = new Race(galvez, { laps, difficulty: d, trail: false, bots: 3, faults: true, seed: 5 });
    r.start();
    let dryAt = Infinity;
    for (let i = 0; i < 60000 && !r.cars.every((c) => c.done); i++) {
      r.step(0.04, 1, botControls(r.player, galvez, r.t, d, 5, laps));
      for (const c of r.cars) if (c.fuel <= 0 && !c.done) dryAt = Math.min(dryAt, remaining(galvez, c, laps));
    }
    expect(r.cars.every((c) => c.done)).toBe(true);
    expect(dryAt === Infinity ? 0 : dryAt).toBeLessThan(50);
  });
});
