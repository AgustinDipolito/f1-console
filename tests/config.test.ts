import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULTS, SESSION, loadConfig, loadLast, loadProfiles, saveLast, saveProfile, sessionOf, type LastResult } from '../src/config';

// localStorage de mentira: los tests corren en Node.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
});
beforeEach(() => store.clear());
afterAll(() => vi.unstubAllGlobals());

const saved = (c: object): void => { store.set('f1c.config.v1', JSON.stringify({ rev: 2, ...c })); };

describe('config: modo', () => {
  it('una config guardada antes de los modos carga carrera y 6 s de ventaja', () => {
    saved({ laps: 5 });
    const c = loadConfig();
    expect(c.laps).toBe(5);
    expect(c.mode).toBe('race');
    expect(c.chaseHead).toBe(6);
    expect(c.challenge).toBe('');
  });

  it('un modo o una ventaja que no existen vuelven a lo de fábrica', () => {
    saved({ mode: 'nada', chaseHead: 7 });
    const c = loadConfig();
    expect(c.mode).toBe(DEFAULTS.mode);
    expect(c.chaseHead).toBe(DEFAULTS.chaseHead);
  });

  it('un modo válido se conserva', () => {
    saved({ mode: 'challenge', challenge: 'gomas', chaseHead: 10 });
    expect(loadConfig()).toMatchObject({ mode: 'challenge', challenge: 'gomas', chaseHead: 10 });
  });
});

describe('config: perfiles', () => {
  const cfg = { ...DEFAULTS, circuit: 'mc-1929', name: 'Ana', mode: 'chase' as const, challenge: 'gomas', chaseHead: 10, laps: 7 };

  it('un perfil no guarda las claves de sesión', () => {
    const p = saveProfile('mío', cfg)['mío'];
    for (const k of SESSION) expect(p, k).not.toHaveProperty(k);
    expect(p.laps).toBe(7);
    expect(loadProfiles()['mío']).toEqual(p);
  });

  it('sessionOf junta exactamente las claves de sesión', () => {
    expect(Object.keys(sessionOf(cfg)).sort()).toEqual([...SESSION].sort());
    expect(sessionOf(cfg)).toEqual({ circuit: 'mc-1929', name: 'Ana', mode: 'chase', challenge: 'gomas', chaseHead: 10 });
  });

  it('usar un perfil o restablecer deja la sesión como estaba', () => {
    const p = saveProfile('mío', { ...DEFAULTS, laps: 9 })['mío'];
    const used = { ...DEFAULTS, ...p, ...sessionOf(cfg) };
    expect(used).toMatchObject({ laps: 9, circuit: 'mc-1929', name: 'Ana', mode: 'chase', challenge: 'gomas', chaseHead: 10 });
    expect({ ...DEFAULTS, ...sessionOf(cfg) }).toMatchObject({ laps: DEFAULTS.laps, mode: 'chase' });
  });
});

describe('config: último resultado', () => {
  it('un resultado de antes de los modos se lee igual, sin los campos nuevos', () => {
    const old = { circuit: 'ar-1952', laps: 3, rows: [{ pos: 1, name: 'Vos', me: true, fin: 252.3, best: 83.4 }] };
    store.set('f1c.last', JSON.stringify(old));
    const l = loadLast() as LastResult;
    expect(l.rows).toHaveLength(1);
    expect(l.mode).toBeUndefined();
    expect(l.verdict).toBeUndefined();
  });

  it('guarda el veredicto y el resto, y se puede borrar', () => {
    const res: LastResult = {
      circuit: 'ar-1952', laps: 1, mode: 'challenge', title: 'Desafío: La última vuelta', cat: '1 vuelta · normal',
      verdict: { ok: false, title: 'Desafío no cumplido', lines: ['Te quedaste sin nafta antes de la meta'] }, key: 'Lo que más costó: curva a 1,2 km',
      rows: [{ pos: 2, name: 'Vos', me: true, fin: 90, best: 90, trait: '' }, { pos: 1, name: 'Vera Apex', me: false, fin: 88, best: 88, trait: 'Hace cada cambio a tiempo' }],
    };
    saveLast(res);
    expect(loadLast()).toEqual(res);
    saveLast(null);
    expect(loadLast()).toBeNull();
  });
});
