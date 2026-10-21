import { describe, expect, it } from 'vitest';
import { buildTrack } from '../src/tracks/build';
import { Race } from '../src/sim/race';
import { EXTRAP_MAX, snapOf } from '../src/sim/remote';
import { emptyLap } from '../src/sim/telemetry';
import { cleanName, decodeGhost, encodeGhost, hostOf, newRoomCode, parseCfg, parseGo, parseHello, parseSnap, roomCodeOf } from '../src/net/protocol';
import type { Controls, Lap, Vec2 } from '../src/sim/types';

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
    const l = lap(), code = encodeGhost({ track: 'ar-1952', name: 'Ana 50%', lap: l });
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
    const code = encodeGhost({ track: 'c', name: 'a', lap: lap() });
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
