import { describe, expect, it } from 'vitest';
import { BOT_LEVELS, BOT_PROFILES, STYLES, STYLE_TRAIT, botControls, botLevel, botProfile, styled, type BotLevel, type Style } from '../src/bot/bot';
import { remaining } from '../src/sim/car';
import { PHYS } from '../src/sim/physics';
import { Race } from '../src/sim/race';
import { buildTrack, coordsOf, geoToMeters } from '../src/tracks/build';
import type { Difficulty, Track, Vec2 } from '../src/sim/types';

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];
const STYLE_LIST = Object.keys(STYLES) as Style[];
const RIVAL = STYLE_LIST.filter((s) => s !== 'metodico');

/** Mismo óvalo que sim.test.ts: rectas largas, curvas de 80 m. */
function oval(): Vec2[] {
  const pts: Vec2[] = [], L = 600, R = 80;
  for (let x = 0; x < L; x += 5) pts.push([x, -R]);
  for (let a = -Math.PI / 2; a < Math.PI / 2; a += 0.05) pts.push([L + Math.cos(a) * R, Math.sin(a) * R]);
  for (let x = L; x > 0; x -= 5) pts.push([x, R]);
  for (let a = Math.PI / 2; a < (3 * Math.PI) / 2; a += 0.05) pts.push([Math.cos(a) * R, Math.sin(a) * R]);
  return pts;
}

const sinAcentos = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Pilotos reales: ningún nombre de bot puede parecerse a uno. */
const REALES = ['Senna', 'Prost', 'Fangio', 'Schumacher', 'Hamilton', 'Verstappen', 'Alonso', 'Rosberg', 'Leclerc', 'Norris', 'Sainz', 'Pérez', 'Vettel', 'Lauda', 'Piquet', 'Reutemann', 'Räikkönen', 'Hülkenberg', 'Piastri', 'Colapinto'];

describe('perfiles de los bots', () => {
  it('son diez, con nombre único, etiqueta corta y rasgo corto; el primero es metódico', () => {
    expect(BOT_PROFILES).toHaveLength(10);
    expect(new Set(BOT_PROFILES.map((p) => p.name)).size).toBe(10);
    expect(BOT_PROFILES[0].style).toBe('metodico');
    for (const p of BOT_PROFILES) {
      expect(p.tag.length).toBeGreaterThan(0);
      expect(p.tag.length).toBeLessThanOrEqual(8);
      expect(p.name.startsWith(p.tag)).toBe(true);
      expect(p.trait).toBe(STYLE_TRAIT[p.style]);
    }
    expect(botProfile(10)).toBe(BOT_PROFILES[0]);
  });

  it('el rasgo de cada estilo: 40 letras o menos, mayúscula inicial, sin punto final ni exclamación', () => {
    expect(Object.keys(STYLE_TRAIT).sort()).toEqual([...STYLE_LIST].sort());
    for (const t of Object.values(STYLE_TRAIT)) {
      expect(t.length).toBeLessThanOrEqual(40);
      expect(t[0]).toBe(t[0].toUpperCase());
      expect(t).not.toMatch(/[.!¡]$/);
      expect(t).not.toMatch(/[!¡]/);
    }
  });

  it('ningún nombre es de un piloto real', () => {
    const reales = REALES.map(sinAcentos);
    for (const p of BOT_PROFILES) {
      const n = sinAcentos(`${p.name} ${p.tag}`);
      for (const r of reales) expect(n.includes(r), `${p.name} ~ ${r}`).toBe(false);
    }
  });

  it('el estilo reparte los cuatro entre los diez', () => {
    expect(new Set(BOT_PROFILES.map((p) => p.style)).size).toBe(4);
  });
});

describe('estilos', () => {
  it('el bot 0 rinde exacto según la dificultad (el mismo objeto)', () => {
    for (const d of DIFFS) {
      expect(botLevel(d, 0)).toBe(BOT_LEVELS[d]);
      expect(botLevel(d, 10)).toBe(BOT_LEVELS[d]);
      expect(styled(BOT_LEVELS[d], 'metodico')).toBe(BOT_LEVELS[d]);
    }
  });

  it('el estilo no toca delay ni jitter: el bot 9 (k = 1, atacante) solo cambia en lo del estilo', () => {
    expect(botProfile(9).style).toBe('atacante');
    for (const d of DIFFS) {
      const L = BOT_LEVELS[d], b = botLevel(d, 9);
      expect(b).not.toBe(L);
      expect([b.delay, b.jitter]).toEqual([L.delay, L.jitter]);
      for (const s of STYLE_LIST) expect([styled(L, s).delay, styled(L, s).jitter]).toEqual([L.delay, L.jitter]);
    }
  });

  it('cotas: multiplicadores de 0,5 a 1,5, tempCap hasta 2 grados, fuelMix de 0 a 0,02', () => {
    for (const s of STYLE_LIST) {
      const m = STYLES[s];
      for (const k of [m.balErr, m.fix]) { expect(k).toBeGreaterThanOrEqual(0.5); expect(k).toBeLessThanOrEqual(1.5); }
      expect(Math.abs(m.tempCap)).toBeLessThanOrEqual(2);
      expect(m.fuelMix).toBeGreaterThanOrEqual(0);
      expect(m.fuelMix).toBeLessThanOrEqual(0.02);
    }
    expect(STYLES.metodico).toEqual({ balErr: 1, fix: 1, tempCap: 0, fuelMix: 0 });
  });

  it.each(RIVAL)('el %s gana en algo y paga en algo', (s) => {
    const m = STYLES[s];
    expect(m.balErr < 1 || m.fix < 1 || m.tempCap > 0).toBe(true);
    expect(m.balErr > 1 || m.fix > 1 || m.tempCap < 0 || m.fuelMix > 0).toBe(true);
  });

  it('styled aplica el estilo sobre el nivel: multiplica balErr y fix, suma tempCap y fuelMix', () => {
    const L = BOT_LEVELS.normal, a = styled(L, 'conservador'), m = STYLES.conservador;
    expect(a).not.toBe(L);
    expect(a.balErr).toBeCloseTo(L.balErr * m.balErr, 10);
    expect(a.fix).toBeCloseTo(L.fix * m.fix, 10);
    expect(a.tempCap).toBeCloseTo(L.tempCap + m.tempCap, 10);
    expect(a.fuelMix).toBeCloseTo(L.fuelMix + m.fuelMix, 10);
    expect(BOT_LEVELS.normal.tempCap).toBe(97.5);
  });

  it('ningún bot aguanta hasta el límite de temperatura', () => {
    for (const d of DIFFS) {
      for (let i = 0; i < 10; i++) expect(botLevel(d, i).tempCap).toBeLessThan(PHYS.TEMP_LIMIT);
      for (const s of STYLE_LIST) expect(styled(BOT_LEVELS[d], s).tempCap).toBeLessThan(PHYS.TEMP_LIMIT);
    }
    // En difícil el atacante pasaría de 100 si no hubiera tope: queda a una décima.
    expect(styled(BOT_LEVELS.hard, 'atacante').tempCap).toBeCloseTo(PHYS.TEMP_LIMIT - 0.1, 10);
  });
});

describe('estilos en el óvalo', () => {
  const tr: Track = buildTrack('oval', 'Óvalo', oval());
  /** El jugador conduce con el estilo contra el bot 0 (metódico) en el mismo óvalo. */
  function duelo(s: Style): Race {
    const r = new Race(tr, { laps: 3, difficulty: 'normal', trail: false, bots: 1, faults: false });
    const L: BotLevel = styled(BOT_LEVELS.normal, s);
    r.start();
    for (let i = 0; i < 100000 && !r.cars.every((c) => c.done); i++) r.step(0.02, 1, botControls(r.player, tr, r.t, L, 0, 3));
    return r;
  }

  it.each(RIVAL)('%s: termina a menos de 2 % del metódico y se distingue tramo a tramo', (s) => {
    const r = duelo(s), p = r.player, b = r.bots[0];
    expect(p.done && b.done).toBe(true);
    const pct = Math.abs((p.fin as number) - (b.fin as number)) / (b.fin as number);
    // Diferencia acumulada contra el metódico en cada registro de la vuelta 2.
    const d = p.hist[1].tt.map((t, k) => t - b.hist[1].tt[k]).filter(Number.isFinite);
    const spread = Math.max(...d) - Math.min(...d);
    console.log(`${s}: fin ${(p.fin as number).toFixed(2)} vs ${(b.fin as number).toFixed(2)} s (${(pct * 100).toFixed(2)} %), vuelta 2 varía ${spread.toFixed(3)} s`);
    expect(pct).toBeLessThan(0.02);
    expect(spread).toBeGreaterThan(0.05);
  });
});

describe('nafta con los cuatro estilos en Gálvez', () => {
  const raw = Object.values(import.meta.glob<string>('../public/tracks/ar-1952.geojson', { eager: true, query: '?raw', import: 'default' }))[0];
  const galvez = buildTrack('ar-1952', 'Gálvez', geoToMeters(coordsOf(JSON.parse(raw))!));

  it('en difícil, con los bots 0 a 3 (uno de cada estilo), nadie se queda seco antes de los últimos 50 m', () => {
    expect(BOT_PROFILES.slice(0, 4).map((p) => p.style).sort()).toEqual([...STYLE_LIST].sort());
    const laps = 2, r = new Race(galvez, { laps, difficulty: 'hard', trail: false, bots: 4, faults: true, seed: 5 });
    r.start();
    let dryAt = Infinity;
    for (let i = 0; i < 60000 && !r.cars.every((c) => c.done); i++) {
      r.step(0.04, 1, botControls(r.player, galvez, r.t, 'hard', 5, laps));
      for (const c of r.cars) if (c.fuel <= 0 && !c.done) dryAt = Math.min(dryAt, remaining(galvez, c, laps));
    }
    expect(r.cars.every((c) => c.done)).toBe(true);
    expect(dryAt === Infinity ? 0 : dryAt).toBeLessThan(50);
  });
});
