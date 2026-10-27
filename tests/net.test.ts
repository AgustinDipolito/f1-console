import { describe, expect, it } from 'vitest';
import { buildTrack } from '../src/tracks/build';
import { Race } from '../src/sim/race';
import { EXTRAP_MAX, snapOf } from '../src/sim/remote';
import { rand } from '../src/sim/car';
import { EV_KEYS, EV_VMAX, categoryOf, emptyLap, sameCategory, smCount } from '../src/sim/telemetry';
import { cleanName, decodeGhost, encodeGhost, hostOf, newRoomCode, parseCfg, parseGo, parseHello, parseSnap, roomCodeOf } from '../src/net/protocol';
import type { Controls, Ev, Lap, Vec2 } from '../src/sim/types';

const circle: Vec2[] = Array.from({ length: 400 }, (_, i) => { const a = (i / 400) * Math.PI * 2; return [Math.cos(a) * 300, Math.sin(a) * 300] as Vec2; });
const track = buildTrack('c', 'c', circle);
const push: Controls = { lev: 2, ers: 1, bal: 56, lim: false, dif: 1, eb: 1, rst: [0, 0, 0] };
const solo = (laps = 1): Race => new Race(track, { laps, difficulty: 'normal', trail: false, bots: 0, faults: false });

describe('carrera en sala', () => {
  it('sin bots y solo: termina primero de uno', () => {
    const r = solo();
    r.start();
    for (let i = 0; i < 100000 && !r.player.done; i++) r.step(0.02, 1, push);
    expect(r.cars.length).toBe(1);
    expect(r.gap()).toBe(0);
    expect(r.result()).toEqual({ won: true, pos: 1, of: 1, margin: 0 });
  });

  it('el auto remoto sigue al otro jugador y cuenta para las posiciones', () => {
    // Dos carreras: la de "ellos" manda su auto a la nuestra, con un mensaje cada 0,1 s.
    const mine = solo(2), theirs = solo(2);
    mine.start(); theirs.start();
    let next = 0, maxErr = 0;
    for (let i = 0; i < 100000 && !theirs.player.done; i++) {
      theirs.step(0.02, 1, push);
      mine.step(0.02, 1, { ...push, lim: true });
      if (theirs.t >= next) { mine.snap('b', 'Ana', snapOf(theirs.player, track.len, theirs.t)); next += 0.1; }
      if (mine.remote.length) maxErr = Math.max(maxErr, Math.abs(mine.dist(mine.remote[0].car) - theirs.dist(theirs.player)));
    }
    for (let i = 0; i < 10; i++) { mine.step(0.02, 1, push); mine.snap('b', 'Ana', snapOf(theirs.player, track.len, theirs.t)); }
    expect(maxErr).toBeLessThan(15);
    expect(mine.names()).toEqual(['Vos', 'Ana']);
    expect(mine.remote[0].car.done).toBe(true);
    expect(mine.position()).toBe(2);
  });

  it('avisa cuando termina un rival remoto', () => {
    const r = solo();
    r.start();
    while (r.phase === 'count') r.step(0.02, 1, push);
    r.snap('b', 'Ana', { t: r.t, d: 10, v: 50, off: 0, done: false, fin: null, best: null });
    expect(r.step(0.02, 1, push)).not.toContain('rival-done');
    r.snap('b', 'Ana', { t: r.t, d: track.len + 1, v: 50, off: 0, done: true, fin: 60, best: 60 });
    expect(r.step(0.02, 1, push)).toContain('rival-done');
  });

  it('sin mensajes el auto remoto se frena en vez de seguir solo', () => {
    const r = solo();
    r.start();
    while (r.phase === 'count') r.step(0.02, 1, push);
    r.snap('b', 'Ana', { t: r.t, d: 100, v: 50, off: 0, done: false, fin: null, best: null });
    for (let i = 0; i < 300; i++) r.step(0.02, 1, push);
    expect(r.dist(r.remote[0].car)).toBeCloseTo(100 + 50 * EXTRAP_MAX, 0);
    r.leave('b');
    expect(r.remote.length).toBe(0);
  });
});

describe('fantasma compartido', () => {
  const lap = (): Lap => {
    const l = emptyLap(track.len);
    l.tt = l.tt.map((_, k) => k * 0.2 + 0.0123);
    l.v = l.v.map((_, k) => 50 + (k % 7));
    l.tt[3] = NaN;
    l.t = l.tt.length * 0.2;
    return l;
  };

  it('ida y vuelta conserva la vuelta al milisegundo', () => {
    const l = lap(), code = encodeGhost({ track: 'ar-1952', name: 'Ana 50%', lap: l, cat: null });
    const g = decodeGhost(`https://x.test/#fantasma=${code}`);
    expect(g?.track).toBe('ar-1952');
    expect(g?.name).toBe('Ana 50%');
    expect(g?.lap.t).toBeCloseTo(l.t, 3);
    expect(Number.isNaN(g?.lap.tt[3])).toBe(true);
    g?.lap.tt.forEach((t, k) => { if (k !== 3) expect(Math.abs(t - l.tt[k])).toBeLessThanOrEqual(0.0006); });
    g?.lap.v.forEach((v, k) => expect(v).toBeCloseTo(l.v[k], 2));
  });

  it('rechaza códigos rotos', () => {
    expect(decodeGhost('')).toBeNull();
    expect(decodeGhost('ar-1952~x~@@@')).toBeNull();
    expect(decodeGhost('ar 1952~x~AAAA')).toBeNull();
    const code = encodeGhost({ track: 'c', name: 'a', lap: lap(), cat: null });
    expect(decodeGhost(code.slice(0, -8))).toBeNull();
  });
});

describe('protocolo de sala', () => {
  it('limpia nombres', () => {
    expect(cleanName('  Ana\n  <b>  ')).toBe('Ana b');
    expect(cleanName('x'.repeat(40)).length).toBe(16);
  });

  it('códigos de sala', () => {
    const c = newRoomCode();
    expect(c).toMatch(/^[a-z2-9]{6}$/);
    expect(roomCodeOf(`https://x.test/#sala=${c}`)).toBe(c);
    expect(roomCodeOf(' AB-CD-EF ')).toBe('abcdef');
    expect(roomCodeOf('ab')).toBeNull();
  });

  it('valida lo que llega de otro navegador', () => {
    expect(parseHello({ name: 'Ana', since: 0 })).toEqual({ name: 'Ana', since: 0 });
    expect(parseHello({ name: 3, since: 0 })).toBeNull();
    const cfg = { circuit: 'ar-1952', laps: 3, faults: true, timeScale: 2 };
    expect(parseCfg(cfg)).toEqual(cfg);
    expect(parseCfg({ ...cfg, laps: 99 })).toBeNull();
    expect(parseCfg({ ...cfg, timeScale: 50 })).toBeNull();
    expect(parseCfg({ ...cfg, circuit: '../x' })).toBeNull();
    expect(parseGo({ n: 2, cfg })).toEqual({ n: 2, cfg });
    expect(parseGo({ n: 0, cfg })).toBeNull();
    const sn = { n: 1, t: 3, d: 120, v: 60, off: 0, done: false, fin: null, best: null };
    expect(parseSnap(sn)).toEqual(sn);
    expect(parseSnap({ ...sn, v: Infinity })).toBeNull();
    expect(parseSnap({ ...sn, d: 'x' })).toBeNull();
  });

  it('el anfitrión es el que creó la sala, y si se va, el que entró antes', () => {
    expect(hostOf([{ id: 'b', since: 100 }, { id: 'a', since: 0 }, { id: 'c', since: 50 }])).toBe('a');
    expect(hostOf([{ id: 'b', since: 100 }, { id: 'c', since: 50 }])).toBe('c');
    expect(hostOf([{ id: 'b', since: 5 }, { id: 'a', since: 5 }])).toBe('a');
    expect(hostOf([])).toBeNull();
  });
});

describe('fantasma compartido v2', () => {
  function ovalPts(): Vec2[] {
    const pts: Vec2[] = [], L = 600, R = 80;
    for (let x = 0; x < L; x += 5) pts.push([x, -R]);
    for (let a = -Math.PI / 2; a < Math.PI / 2; a += 0.05) pts.push([L + Math.cos(a) * R, Math.sin(a) * R]);
    for (let x = L; x > 0; x -= 5) pts.push([x, R]);
    for (let a = Math.PI / 2; a < (3 * Math.PI) / 2; a += 0.05) pts.push([Math.cos(a) * R, Math.sin(a) * R]);
    return pts;
  }
  const oval = buildTrack('oval', 'Óvalo', ovalPts());
  const cat = categoryOf('oval', 3, 'normal');

  /** Una vuelta real del óvalo, con la consola cambiando por todos lados. */
  const real = (): Lap => {
    const r = new Race(oval, { laps: 2, difficulty: 'normal', trail: false, bots: 0, faults: false });
    r.start();
    while (!r.player.done) {
      const s = r.player.laps === 0 ? r.player.s : 0;
      r.step(0.02, 1, { lev: Math.floor(s / 137) % 3, ers: Math.floor(s / 211) % 3, bal: 50 + (Math.floor(s / 90) % 12), lim: Math.floor(s / 301) % 2 === 1, dif: Math.floor(s / 173) % 3, eb: Math.floor(s / 251) % 3, rst: [0, 0, 0] });
    }
    return r.player.hist[0];
  };

  /** Una vuelta de 5 km inventada: n registros de 10 m, nEv eventos repartidos y las muestras de siempre. */
  const synth = (n = 500, nEv = 60): Lap => ({
    t: n * 0.2, tt: Array.from({ length: n }, (_, k) => k * 0.2), v: Array.from({ length: n }, (_, k) => 40 + (k % 9)),
    c0: { lev: 1, ers: 1, bal: 56, dif: 1, eb: 1, lim: 0 },
    ev: Array.from({ length: nEv }, (_, i): Ev => { const k = EV_KEYS[i % 6]; return { s: Math.round(((i + 1) * n * 10) / (nEv + 1)), t: 0, k, v: i % (EV_VMAX[k] + 1) }; }),
    sm: Array.from({ length: smCount(n) }, (_, i) => ({ bat: 100 - (i % 60), temp: 80 + (i % 20), tyre: 100 - (i % 40), fuel: Math.round((12 - i * 0.1) * 10) / 10 })),
  });

  const parts = (code: string): [string, string, string] => code.split('~') as [string, string, string];
  const bytesOf = (code: string): Uint8Array => Uint8Array.from(atob(parts(code)[2].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const withBytes = (code: string, b: Uint8Array): string => {
    const [t, n] = parts(code);
    return `${t}~${n}~${btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
  };

  it('ida y vuelta: la categoría, la consola y las muestras exactas; los eventos y los tiempos casi', () => {
    const l = real(), code = encodeGhost({ track: 'oval', name: 'Ana', lap: l, cat });
    const g = decodeGhost(code);
    expect(g?.cat).toEqual(cat);
    expect(g?.track).toBe('oval');
    expect(g?.lap.c0).toEqual(l.c0);
    expect(g?.lap.sm).toEqual(l.sm);
    expect(g?.lap.t).toBeCloseTo(l.t, 3);
    expect(l.ev?.length).toBeGreaterThan(20);
    expect(g?.lap.ev?.length).toBe(l.ev?.length);
    let maxT = 0;
    l.ev?.forEach((e, i) => {
      const d = g?.lap.ev?.[i] as Ev;
      expect(d.k).toBe(e.k);
      expect(d.v).toBe(e.v);
      expect(Math.abs(d.s - e.s)).toBeLessThanOrEqual(0.5);
      maxT = Math.max(maxT, Math.abs(d.t - e.t));
    });
    // El tiempo del evento se deriva de los registros, no viaja: queda a lo sumo a ~0,03 s de lo medido (un paso de simulación y medio).
    expect(maxT).toBeLessThan(0.031);
    g?.lap.tt.forEach((t, k) => { if (!Number.isNaN(l.tt[k])) expect(Math.abs(t - l.tt[k])).toBeLessThanOrEqual(0.003); });
    g?.lap.v.forEach((v, k) => { if (!Number.isNaN(l.v[k])) expect(Math.abs(v - l.v[k])).toBeLessThanOrEqual(0.25); });
    expect(encodeGhost(g as NonNullable<typeof g>)).toBe(code);
  });

  it('v1 sigue decodificando: categoría null y sin historial', () => {
    const l = real(), g = decodeGhost(encodeGhost({ track: 'oval', name: 'Ana', lap: l, cat: null }));
    expect(g?.cat).toBeNull();
    expect(g?.lap.t).toBeCloseTo(l.t, 3);
    expect(g?.lap.ev).toBeUndefined();
    expect(g?.lap.sm).toBeUndefined();
    expect(g?.lap.c0).toBeUndefined();
  });

  it('un v2 de 5 km con 60 eventos mide menos de 2.400 caracteres y menos que el v1 de la misma vuelta', () => {
    const l = synth(), c = categoryOf('ar-1952', 3, 'normal');
    const v2 = encodeGhost({ track: 'ar-1952', name: 'Ana', lap: l, cat: c }), v1 = encodeGhost({ track: 'ar-1952', name: 'Ana', lap: l, cat: null });
    expect(v2.length).toBeLessThan(2400);
    expect(v2.length).toBeLessThan(v1.length);
    expect(decodeGhost(v2)?.lap.ev?.length).toBe(60);
  });

  it('un fantasma de otra categoría se acepta con su categoría', () => {
    const other = categoryOf('oval', 5, 'hard'), g = decodeGhost(encodeGhost({ track: 'oval', name: 'Ana', lap: real(), cat: other }));
    expect(g?.cat).toEqual(other);
    expect(g?.cat && sameCategory(g.cat, cat)).toBe(false);
  });

  it('una vuelta sin muestras, sin consola de largada o sin categoría sale como v1', () => {
    const l = real(), v1Len = encodeGhost({ track: 'oval', name: '', lap: l, cat: null }).length;
    const noSm = encodeGhost({ track: 'oval', name: '', lap: { ...l, sm: undefined }, cat });
    const noC0 = encodeGhost({ track: 'oval', name: '', lap: { ...l, c0: undefined }, cat });
    const short = encodeGhost({ track: 'oval', name: '', lap: { ...l, sm: l.sm?.slice(1) }, cat });
    for (const code of [noSm, noC0, short]) { expect(code.length).toBe(v1Len); expect(decodeGhost(code)?.cat).toBeNull(); }
  });

  describe('un v2 dañado da null sin excepción', () => {
    const l = real(), code = encodeGhost({ track: 'oval', name: 'Ana', lap: l, cat }), good = bytesOf(code);
    const n = l.tt.length, nEv = l.ev?.length ?? 0, evAt = 14 + 2 * n, smAt = evAt + 4 * nEv;
    const set = (o: number, v: number) => (b: Uint8Array): Uint8Array => { const c = b.slice(); c[o] = v; return c; };
    const cases: [string, (b: Uint8Array) => Uint8Array][] = [
      ['cortado', (b) => b.slice(0, b.length - 3)],
      ['con bytes de más', (b) => Uint8Array.from([...b, 0])],
      ['sin cabecera', (b) => b.slice(0, 10)],
      ['versión 3', set(0, 3)],
      ['n que no cierra', set(5, (good[5] + 1) & 255)],
      ['n en cero', (b) => { const c = b.slice(); c[4] = 0; c[5] = 0; return c; }],
      ['vueltas en cero', set(2, 0)],
      ['dificultad 3', set(3, 3)],
      ['tiempo en cero', (b) => { const c = b.slice(); c.fill(0, 6, 10); return c; }],
      ['clave de evento 8', set(evAt + 2, 8)],
      ['potencia 3 en un evento', (b) => { const c = b.slice(); c[evAt + 2] = 0; c[evAt + 3] = 3; return c; }],
      ['s mayor que n por 10', (b) => { const c = b.slice(); c[evAt] = 255; c[evAt + 1] = 255; return c; }],
      ['eventos desordenados', (b) => { const c = b.slice(); c[evAt + 4] = 0; c[evAt + 5] = 0; return c; }],
      ['batería 101', set(smAt, 101)],
      ['gomas 101', set(smAt + 2, 101)],
      ['c0 con potencia 3', (b) => { const c = b.slice(); c[10] = (c[10] & ~3) | 3; return c; }],
      ['c0 con balance 101', set(11, 101)],
    ];
    it.each(cases)('%s', (_, f) => {
      expect(() => decodeGhost(withBytes(code, f(good)))).not.toThrow();
      expect(decodeGhost(withBytes(code, f(good)))).toBeNull();
    });
    it('el original, sin tocar, se lee', () => expect(decodeGhost(withBytes(code, good))?.cat).toEqual(cat));
  });

  it('bytes al azar con versión 2 nunca tiran', () => {
    let st = 12345, ok = 0;
    const rnd = (): number => { let x: number; [x, st] = rand(st); return x; };
    for (let i = 0; i < 500; i++) {
      // La mitad con la cabecera sana y el largo exacto, para llegar a las lecturas de eventos y muestras.
      const n = 1 + Math.floor(rnd() * 20), nEv = Math.floor(rnd() * (n + 1)), len = i % 2 ? 14 + 2 * n + 4 * nEv + 5 * smCount(n) : Math.floor(rnd() * 120);
      const b = Uint8Array.from({ length: len }, () => Math.floor(rnd() * 256));
      if (len) b[0] = 2;
      if (i % 2) { b[4] = 0; b[5] = n; b[12] = 0; b[13] = nEv; b[10] &= 0x2a; b[11] &= 0x64; b[2] = 1 + (b[2] & 7); b[3] &= 1; b[6] = 0; b[7] = 0; b[8] = 1; }
      const code = withBytes('x~y~AAAA', b);
      expect(() => decodeGhost(code)).not.toThrow();
      const g = decodeGhost(code);
      if (g) { ok++; g.lap.ev?.forEach((e) => expect(e.v).toBeLessThanOrEqual(EV_VMAX[e.k])); }
    }
    // Con la cabecera sana alguna tiene que haber pasado: si no, el test no llega a las lecturas.
    expect(ok).toBeGreaterThan(0);
  });
});
