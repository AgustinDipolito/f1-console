import { describe, expect, it } from 'vitest';
import { buildTrack } from '../src/tracks/build';
import { Race } from '../src/sim/race';
import { CHALLENGES, type Outcome } from '../src/sim/scenario';
import { HEAD_STARTS } from '../src/sim/chase';
import { worstLoss } from '../src/ui/losses';
import {
  MODE_INFO, challengeMetric, challengeOf, endText, raceLine, readyText, resultsTitle, timesLine, verdictOf,
  type End, type LineIn, type ReadyIn,
} from '../src/ui/modes-data';
import type { Vec2 } from '../src/sim/types';
import { FIXED } from './models';

const RACE = { won: false, pos: 2, of: 2, margin: 1.2 };
const base: LineIn = { mode: 'race', lap: 10, laps: 12, pos: 'P10/11 −12,4 s', delta: -12.4, ref: true, rival: null, title: '' };
const len = (s: string): number => [...s].length;

describe('modos: renglón de la carrera', () => {
  it('en carrera queda como siempre: vuelta, puesto, Δ y rival', () => {
    expect(raceLine({ ...base, lap: 2, laps: 3, pos: 'P1/2 +0,4 s', delta: 0.3, rival: { name: 'Juan', d: 1.2 } })).toBe('vuelta 2/3 · P1/2 +0,4 s · Δ +0,3 · vs Juan +1,2');
    expect(raceLine({ ...base, delta: null })).toBe('vuelta 10/12 · P10/11 −12,4 s');
  });

  it('los otros modos empiezan con su nombre', () => {
    expect(raceLine({ ...base, mode: 'tt', delta: -0.2 })).toBe('mejor vuelta · vuelta 10/12 · Δ −0,2');
    expect(raceLine({ ...base, mode: 'chase', delta: 1.4 })).toBe('persecución · vuelta 10/12 · Δ +1,4');
    expect(raceLine({ ...base, mode: 'challenge', title: 'La última vuelta' })).toBe('La última vuelta · vuelta 10/12 · P10/11 −12,4 s');
  });

  it('sin referencia lo dice; con referencia y sin Δ todavía, calla', () => {
    expect(raceLine({ ...base, mode: 'tt', delta: null, ref: false })).toBe('mejor vuelta · vuelta 10/12 · sin récord');
    expect(raceLine({ ...base, mode: 'tt', delta: null })).toBe('mejor vuelta · vuelta 10/12');
    expect(raceLine({ ...base, mode: 'chase', delta: null, ref: false })).toBe('persecución · vuelta 10/12 · sin fantasma');
  });

  it('el peor caso entra en 44 caracteres (el tope de un teléfono de 360 px a 13 px)', () => {
    const worst: LineIn[] = [
      { ...base, mode: 'tt', delta: null, ref: false },
      { ...base, mode: 'tt', delta: -12.4 },
      { ...base, mode: 'chase', delta: null, ref: false },
      { ...base, mode: 'chase', delta: 12.4 },
      ...CHALLENGES.map((sc): LineIn => ({ ...base, mode: 'challenge', lap: sc.laps, laps: sc.laps, pos: 'P2/2 −12,4 s', title: sc.title })),
      { ...base, mode: 'race', rival: null },
    ];
    for (const x of worst) expect(len(raceLine(x)), raceLine(x)).toBeLessThanOrEqual(44);
  });

  it('el peor renglón de tiempos entra en 48', () => {
    const t = { last: 754.5, best: 754.5, kmh: 345, chase: null, metric: '' };
    const lines = [
      timesLine({ ...t, mode: 'race' }),
      timesLine({ ...t, mode: 'tt' }),
      timesLine({ ...t, mode: 'chase', chase: { t: 754.5, head: 10 } }),
      ...CHALLENGES.map((sc) => timesLine({ ...t, mode: 'challenge', metric: challengeMetric(sc, { tmax: 100, tyre: 100, fuelLaps: -12.4 }) })),
    ];
    for (const l of lines) expect(len(l), l).toBeLessThanOrEqual(48);
    expect(timesLine({ ...t, mode: 'race', last: 83.4, best: 82.9, kmh: 287 })).toBe('última 1:23,4 · mejor 1:22,9 · 287 km/h');
    expect(timesLine({ ...t, mode: 'chase', last: 83.4, chase: { t: 82.1, head: 6 }, kmh: 287 })).toBe('fantasma 1:22,1 · ventaja 6 s · 287 km/h');
    expect(timesLine({ ...t, mode: 'chase', last: 83.4, best: 82.9, kmh: 287 })).toBe('última 1:23,4 · mejor 1:22,9 · 287 km/h');
  });

  it('el desafío muestra lo que juega, con los enteros del veredicto', () => {
    const [, hot, , tyres] = CHALLENGES, fuel = CHALLENGES[0], fuse = CHALLENGES[2];
    expect(challengeMetric(hot, { tmax: 97.9, tyre: 100, fuelLaps: 0 })).toBe('motor 97°, tope 100°');
    expect(challengeMetric(tyres, { tmax: 90, tyre: 41.8, fuelLaps: 0 })).toBe('gomas 41 %, piso 12 %');
    expect(challengeMetric(fuel, { tmax: 90, tyre: 90, fuelLaps: 0.3 })).toBe('nafta +0,3 v');
    expect(challengeMetric(fuel, { tmax: 90, tyre: 90, fuelLaps: -0.3 })).toBe('nafta −0,3 v');
    expect(challengeMetric(fuse, { tmax: 90, tyre: 90, fuelLaps: 0 })).toBe('');
  });
});

describe('modos: grilla', () => {
  const sc = CHALLENGES[0];
  const ready: ReadyIn = { mode: 'race', cat: '3 vueltas · normal', best: null, rival: null, chase: null, sc };

  it('todo empieza con «Listo», salvo la persecución sin a quién perseguir', () => {
    const all: ReadyIn[] = [
      ready, { ...ready, rival: 'Juan' },
      { ...ready, mode: 'tt' }, { ...ready, mode: 'tt', best: 83.4 },
      { ...ready, mode: 'chase', chase: { name: 'tu récord', head: 6 } },
      ...CHALLENGES.map((c) => ({ ...ready, mode: 'challenge' as const, sc: c })),
    ];
    for (const x of all) expect(readyText(x)).toMatch(/^Listo/);
    expect(readyText({ ...ready, mode: 'chase' })).toMatch(/^No hay a quién perseguir/);
  });

  it('dice el récord y su categoría, o que todavía no hay', () => {
    expect(readyText({ ...ready, rival: 'Juan' })).toBe('Listo para largar contra el fantasma de Juan');
    expect(readyText({ ...ready, mode: 'tt', best: 83.4 })).toBe('Listo para la mejor vuelta. Récord en 3 vueltas · normal: 1:23,4');
    expect(readyText({ ...ready, mode: 'tt' })).toBe('Listo para la mejor vuelta. Todavía no hay récord en 3 vueltas · normal');
    expect(readyText({ ...ready, mode: 'chase', chase: { name: 'tu récord', head: 6 } })).toBe('Listo para perseguir a tu récord, que larga con 6 s de ventaja');
    expect(readyText({ ...ready, mode: 'challenge' })).toBe('Listo para «La última vuelta». Llegá delante del bot con nafta en el tanque.');
  });

  it('el desafío que no existe cae en el primero', () => {
    expect(challengeOf('nada')).toBe(CHALLENGES[0]);
    expect(challengeOf('')).toBe(CHALLENGES[0]);
    expect(challengeOf(CHALLENGES[2].id)).toBe(CHALLENGES[2]);
  });
});

describe('modos: meta y resultados', () => {
  const lost: Outcome = { ok: false, lines: ['Llegaste delante del bot por 1,2 s', 'El motor llegó a 101°, el tope era 100°'], failed: null };
  const hot = CHALLENGES[1];
  const failed = (i: number): End => ({ mode: 'challenge', sc: hot, out: { ...lost, failed: hot.win[i] } });
  const ends: Record<string, End> = {
    carrera: { mode: 'race', res: RACE, fin: 252.3, best: 83.4 },
    sola: { mode: 'race', res: { won: true, pos: 1, of: 1, margin: 0 }, fin: 252.3, best: 83.4 },
    récord: { mode: 'tt', record: true, mine: 83.4, before: 83.9, cat: '3 vueltas · normal' },
    primero: { mode: 'tt', record: true, mine: 83.4, before: null, cat: '3 vueltas · normal' },
    sinRécord: { mode: 'tt', record: false, mine: 83.9, before: 83.4, cat: '3 vueltas · normal' },
    ganó: { mode: 'chase', name: 'Juan', fin: 252.3, head: 6, r: { won: true, margin: 1.2, ghost: 253.5 } },
    perdió: { mode: 'chase', name: 'tu récord', fin: 252.3, head: 6, r: { won: false, margin: -0.8, ghost: 251.5 } },
    sinFantasma: { mode: 'chase', name: '', fin: 252.3, head: 6, r: null },
    cumplido: { mode: 'challenge', sc: hot, out: { ok: true, lines: ['Llegaste delante del bot por 1,2 s', 'El motor llegó a 98°, el tope era 100°'], failed: null } },
    noCumplido: failed(1),
  };

  it('el mensaje de la meta de cada variante', () => {
    expect(endText(ends.carrera)).toBe('Terminaste 2.º de 2 por 1,2 s · total 4:12,3 · mejor vuelta 1:23,4');
    expect(endText(ends.sola)).toBe('Terminaste · total 4:12,3 · mejor vuelta 1:23,4');
    expect(endText(ends.récord)).toBe('Récord nuevo en 3 vueltas · normal: 1:23,4, 0,5 s menos');
    expect(endText(ends.primero)).toBe('Primer récord en 3 vueltas · normal: 1:23,4');
    expect(endText(ends.sinRécord)).toBe('Sin récord: tu mejor vuelta fue 1:23,9 y el récord es 1:23,4');
    expect(endText(ends.ganó)).toBe('Le ganaste a Juan por 1,2 s · total 4:12,3');
    expect(endText(ends.perdió)).toBe('Tu récord llegó 0,8 s antes · total 4:12,3');
    expect(endText(ends.sinFantasma)).toBe('Terminaste en 4:12,3. No había fantasma para perseguir');
    expect(endText(ends.cumplido)).toBe('Desafío cumplido: Llegaste delante del bot por 1,2 s · El motor llegó a 98°, el tope era 100°');
  });

  it('desafío no cumplido: la línea es la del criterio que falló', () => {
    expect(endText(failed(1))).toBe('Desafío no cumplido: El motor llegó a 101°, el tope era 100°');
    expect(endText(failed(0))).toBe('Desafío no cumplido: Llegaste delante del bot por 1,2 s');
  });

  it('el veredicto de cada variante; la carrera no lleva', () => {
    expect(verdictOf(ends.carrera)).toBeNull();
    expect(verdictOf(ends.récord)).toEqual({ ok: true, title: 'Récord nuevo', lines: ['Tu mejor vuelta: 1:23,4', 'Récord anterior: 1:23,9'] });
    expect(verdictOf(ends.primero)?.lines[1]).toBe('Era la primera vuelta en esta categoría');
    expect(verdictOf(ends.sinRécord)).toEqual({ ok: false, title: 'Sin récord', lines: ['Tu mejor vuelta: 1:23,9', 'Récord: 1:23,4'] });
    expect(verdictOf(ends.ganó)).toEqual({ ok: true, title: 'Le ganaste a Juan', lines: ['Tu tiempo: 4:12,3', 'Juan, con 6 s de ventaja: 4:13,5'] });
    expect(verdictOf(ends.perdió)).toMatchObject({ ok: false, title: 'Tu récord llegó antes' });
    expect(verdictOf(ends.sinFantasma)).toEqual({ ok: null, title: 'Sin fantasma', lines: ['No había a quién perseguir en esta categoría'] });
    expect(verdictOf(ends.noCumplido)).toEqual({ ok: false, title: 'Desafío no cumplido', lines: lost.lines });
    expect(verdictOf(ends.cumplido)?.ok).toBe(true);
  });

  it('el título de resultados', () => {
    expect(resultsTitle(ends.carrera)).toBe('Resultados');
    expect(resultsTitle(ends.récord)).toBe('Mejor vuelta');
    expect(resultsTitle(ends.ganó)).toBe('Persecución');
    expect(resultsTitle(ends.cumplido)).toBe(`Desafío: ${hot.title}`);
  });

  it('ningún texto lleva signos de exclamación', () => {
    const texts: string[] = [
      ...Object.values(MODE_INFO).flatMap((m) => [m.name, m.say]),
      ...CHALLENGES.flatMap((c) => [c.title, c.context, c.goal]),
      ...Object.values(ends).flatMap((e) => [endText(e), resultsTitle(e), ...(verdictOf(e) ? [verdictOf(e)?.title ?? '', ...(verdictOf(e)?.lines ?? [])] : [])]),
      readyText({ mode: 'race', cat: '', best: null, rival: 'Juan', chase: null, sc: CHALLENGES[0] }),
      readyText({ mode: 'chase', cat: '', best: null, rival: null, chase: null, sc: CHALLENGES[0] }),
      readyText({ mode: 'tt', cat: '3 vueltas · normal', best: 83.4, rival: null, chase: null, sc: CHALLENGES[0] }),
    ];
    for (const t of texts) expect(t).not.toMatch(/[!¡]/);
  });

  it('las ventajas de la persecución son las de la simulación', () => {
    expect(HEAD_STARTS).toEqual([3, 6, 10]);
  });
});

describe('pérdida más cara de la carrera', () => {
  const oval = (): Vec2[] => {
    const pts: Vec2[] = [], L = 600, R = 80;
    for (let x = 0; x < L; x += 5) pts.push([x, -R]);
    for (let a = -Math.PI / 2; a < Math.PI / 2; a += 0.05) pts.push([L + Math.cos(a) * R, Math.sin(a) * R]);
    for (let x = L; x > 0; x -= 5) pts.push([x, R]);
    for (let a = Math.PI / 2; a < (3 * Math.PI) / 2; a += 0.05) pts.push([Math.cos(a) * R, Math.sin(a) * R]);
    return pts;
  };
  const track = buildTrack('oval', 'Óvalo', oval());

  it('una vuelta con la consola fija: la vuelta 0 y una pérdida con control', () => {
    const r = new Race(track, { laps: 1, difficulty: 'normal', trail: false, bots: 0, faults: false });
    r.start();
    for (let i = 0; i < 200000 && !r.player.done; i++) r.step(0.02, 1, FIXED);
    const w = worstLoss(track, r.player.hist);
    expect(w?.lap).toBe(0);
    expect(w?.loss.knob).toBeDefined();
    expect(w?.loss.sec).toBeGreaterThan(0);
  });

  it('sin vueltas o sin caja negra no hay nada que marcar', () => {
    expect(worstLoss(track, [])).toBeNull();
    const n = Math.ceil(track.len / 10);
    expect(worstLoss(track, [{ t: 30, tt: new Array<number>(n).fill(1), v: new Array<number>(n).fill(40) }])).toBeNull();
  });
});
