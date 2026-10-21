import { describe, expect, it } from 'vitest';
import { buildTrack, coordsOf, geoToMeters } from '../src/tracks/build';
import { Race } from '../src/sim/race';
import { botControls, type BotLevel } from '../src/bot/bot';
import type { Difficulty, Track } from '../src/sim/types';

/**
 * Calibración contra jugadores modelo en todos los trazados reales.
 * ideal: lee el tramo sin retraso y maneja nafta y temperatura justo.
 * humano: un segundo de reacción (unos 60 m), frenos aproximados y 6 s para rearmar un fusible.
 */
const PLAYERS: Record<'ideal' | 'humano', BotLevel> = {
  ideal: { delay: 0, jitter: 0, balErr: 0, tempCap: 99.9, fix: 0.5, fuelMix: 1.08 },
  humano: { delay: 60, jitter: 20, balErr: 2.5, tempCap: 97, fix: 6, fuelMix: 1.12 },
};
const LAPS = 3;

const files = import.meta.glob<string>('../public/tracks/*.geojson', { eager: true, query: '?raw', import: 'default' });
const tracks: Track[] = Object.entries(files).map(([f, raw]) => buildTrack(f, f, geoToMeters(coordsOf(JSON.parse(raw))!)));

/** Tiempo total del jugador modelo y del bot, con la misma semilla de fallas. */
function duel(tr: Track, player: BotLevel, d: Difficulty, seed: number): { p: number; b: number; pDry: number; bDry: number } {
  const r = new Race(tr, { laps: LAPS, difficulty: d, trail: false, bots: 1, faults: true, seed });
  r.start();
  // Metros andados sin nafta antes de la meta.
  let pDry = 0, bDry = 0;
  for (let i = 0; i < 400000 && !r.cars.every((c) => c.done); i++) {
    r.step(0.04, 1, botControls(r.player, tr, r.t, player, 5, LAPS));
    if (!r.player.done && r.player.fuel <= 0) pDry += r.player.v * 0.04;
    if (!r.bots[0].done && r.bots[0].fuel <= 0) bDry += r.bots[0].v * 0.04;
  }
  return { p: r.player.fin as number, b: r.bots[0].fin as number, pDry, bDry };
}

describe.skipIf(!tracks.length)('calibración', () => {
  const rows = tracks.map((tr, k) => {
    const seed = 1000 + k;
    const out: Record<string, number> = {};
    for (const d of ['easy', 'normal', 'hard'] as Difficulty[]) {
      for (const [name, lv] of Object.entries(PLAYERS)) {
        const r = duel(tr, lv, d, seed);
        out[`${name}-${d}`] = r.b / r.p - 1;
        out[`dry-${name}`] = Math.max(out[`dry-${name}`] ?? 0, r.pDry);
        out[`dry-${d}`] = Math.max(out[`dry-${d}`] ?? 0, r.bDry);
      }
    }
    return { id: tr.id.replace(/.*\//, '').replace('.geojson', ''), v: out };
  });
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`.padStart(7);
  console.log('circuito        ' + ['easy', 'normal', 'hard'].map((d) => `ideal/${d}  humano/${d}`).join('  '));
  for (const r of rows) console.log(r.id.padEnd(14), ['easy', 'normal', 'hard'].map((d) => `${pct(r.v[`ideal-${d}`])}  ${pct(r.v[`humano-${d}`])}`).join('     '));

  // Positivo: el bot tardó más que el jugador modelo.
  it('el jugador ideal le gana al bot difícil en todos los circuitos', () => {
    for (const r of rows) expect(r.v['ideal-hard'], r.id).toBeGreaterThan(0);
  });
  it('el humano le gana al bot fácil en todos los circuitos', () => {
    for (const r of rows) expect(r.v['humano-easy'], r.id).toBeGreaterThan(0);
  });
  it('el bot difícil le gana al humano en casi todos', () => {
    expect(rows.filter((r) => r.v['humano-hard'] < 0).length).toBeGreaterThan(rows.length * 0.8);
  });
  it('el bot normal queda parejo con el humano: en promedio a menos de 1,5 %', () => {
    const avg = rows.reduce((a, r) => a + r.v['humano-normal'], 0) / rows.length;
    expect(Math.abs(avg)).toBeLessThan(0.015);
  });
  it('nadie anda seco más de 50 m antes de la meta manejando con cabeza', () => {
    for (const r of rows) for (const k of ['dry-ideal', 'dry-humano', 'dry-easy', 'dry-normal', 'dry-hard']) expect(r.v[k], `${r.id} ${k}`).toBeLessThan(50);
  });
});
