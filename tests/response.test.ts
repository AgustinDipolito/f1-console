import { describe, expect, it } from 'vitest';
import { MACROS, applyMacro, defaultPanel, macroActive, type PanelState } from '../src/console/panel';
import { EV_VMAX } from '../src/sim/telemetry';
import { PHYS } from '../src/sim/physics';
import { Sound } from '../src/audio/sound';
import { BUZZ } from '../src/ui/device';
import { FEEDBACK, Feedback, type Cue, type FeedbackIn } from '../src/ui/feedback';

const [ATAQUE, AHORRO] = MACROS;
/** Una consola con todo movido de fábrica, para ver que el macro no toca nada más. */
const moved = (o: Partial<PanelState> = {}): PanelState => ({ ...defaultPanel(), bal: 61, dif: 2, eb: 0, lim: true, grd: true, rst: [1, 2, 3], ...o });
const clon = (p: PanelState): PanelState => ({ ...p, rst: p.rst.slice() });

describe('macros de la consola', () => {
  it('son dos, con nombre y tecla: Ataque en z y Ahorro en x', () => {
    expect(MACROS.map((m) => [m.id, m.name, m.key])).toEqual([['ataque', 'Ataque', 'z'], ['conserva', 'Ahorro', 'x']]);
    expect(MACROS.length - 1).toBe(EV_VMAX.macro);
  });

  it('solo tocan potencia y ERS', () => {
    for (const m of MACROS) expect(Object.keys(m.set).sort()).toEqual(['ers', 'lev']);
    for (const m of MACROS) {
      const p = moved(), antes = clon(p), rst = p.rst;
      applyMacro(p, m);
      expect({ ...p, lev: 0, ers: 0 }).toEqual({ ...antes, lev: 0, ers: 0 });
      expect(p.rst).toBe(rst);
      expect([p.lev, p.ers]).toEqual([m.set.lev, m.set.ers]);
    }
  });

  it('aplicar deja la consola como el macro, sobre el mismo objeto, y macroActive lo ve', () => {
    for (const m of MACROS) {
      const p = moved({ lev: 1, ers: 1 }), mismo = p;
      expect(macroActive(p, m)).toBe(false);
      applyMacro(p, m);
      expect(p).toBe(mismo);
      expect(macroActive(p, m)).toBe(true);
      // Solo el macro que corresponde está activo.
      expect(MACROS.filter((q) => macroActive(p, q))).toEqual([m]);
    }
  });

  it('macroActive pide las dos cosas: con una sola no alcanza', () => {
    expect(macroActive(moved({ lev: 2, ers: 1 }), ATAQUE)).toBe(false);
    expect(macroActive(moved({ lev: 1, ers: 2 }), ATAQUE)).toBe(false);
    expect(macroActive(moved({ lev: 2, ers: 2 }), ATAQUE)).toBe(true);
  });

  it('aplicarlo dos veces da lo mismo y el mismo texto', () => {
    for (const m of MACROS) {
      const p = moved(), a = applyMacro(p, m), una = clon(p), b = applyMacro(p, m);
      expect(b).toBe(a);
      expect(p).toEqual(una);
    }
  });

  it('el texto dice qué quedó, en 34 letras o menos', () => {
    expect(applyMacro(moved(), ATAQUE)).toBe('Ataque: potencia push, ERS attack');
    expect(applyMacro(moved(), AHORRO)).toBe('Ahorro: potencia eco, ERS harvest');
    for (const m of MACROS) {
      const t = applyMacro(moved(), m);
      expect(t.length).toBeLessThanOrEqual(34);
      expect(t).not.toMatch(/[!¡.]/);
      // El texto no depende de cómo estaba la consola.
      expect(applyMacro(moved({ lev: 0, ers: 2 }), m)).toBe(t);
    }
  });

  it('aplicar y volver deja la consola igual', () => {
    for (const m of MACROS) {
      const p = moved({ lev: 1, ers: 1 }), antes = clon(p);
      applyMacro(p, m);
      p.lev = antes.lev;
      p.ers = antes.ers;
      expect(p).toEqual(antes);
    }
    // Y de un macro al otro, si la consola estaba como el segundo, se vuelve a ella.
    const q = moved({ lev: 0, ers: 0 }), antes = clon(q);
    applyMacro(q, ATAQUE);
    applyMacro(q, AHORRO);
    expect(q).toEqual(antes);
  });
});

/** Un cuadro tranquilo en plena carrera; cada prueba cambia lo que le importa. */
const quiet: FeedbackIn = { temp: 80, bat: 50, fuelLaps: 1, fuse: [false, false, false], lap: 0, done: false, green: true, ty: 's', sc: 0.5, changed: false };
const X = (o: Partial<FeedbackIn> = {}): FeedbackIn => ({ ...quiet, fuse: quiet.fuse.slice(), ...o });
const HOT = X({ temp: PHYS.TEMP_LIMIT - 1 });

/** Corre cuadros de a 0,1 s y devuelve las señales que salieron, con su tiempo. */
function run(f: Feedback, xs: FeedbackIn[], t0 = 0, dt = 0.1): [number, Cue][] {
  const out: [number, Cue][] = [];
  xs.forEach((x, i) => { const now = t0 + i * dt, c = f.step(x, now); if (c) out.push([Math.round(now * 10) / 10, c]); });
  return out;
}
const cues = (r: [number, Cue][]): Cue[] => r.map((e) => e[1]);
const same = (n: number, x: FeedbackIn): FeedbackIn[] => Array.from({ length: n }, () => ({ ...x, fuse: x.fuse.slice() }));

describe('señales de respuesta', () => {
  it('un cuadro tranquilo no da nada', () => {
    expect(cues(run(new Feedback(), same(50, quiet)))).toEqual([]);
  });

  it('la falla le gana a todo', () => {
    const f = new Feedback();
    f.step(X(), 0);
    const todo = X({ fuse: [false, true, false], temp: 99, lap: 1, done: true, ty: 'b', sc: 1, changed: true });
    expect(f.step(todo, 0.1)).toBe('fault');
  });

  it('sin falla la advertencia le gana a la vuelta, al tramo acertado y a la confirmación', () => {
    const f = new Feedback();
    f.step(X(), 0);
    expect(f.step(X({ temp: 99, lap: 1, ty: 'b', sc: 1, changed: true }), 0.1)).toBe('warn');
    // La vuelta ya pasó: no vuelve.
    expect(f.step(X({ temp: 99, lap: 1, ty: 'b', sc: 1, changed: true }), 0.2)).toBe('confirm');
  });

  it('la advertencia que perdió contra una falla sale en el cuadro siguiente', () => {
    const f = new Feedback();
    f.step(X(), 0);
    expect(f.step(X({ temp: 99, fuse: [true, false, false] }), 0.1)).toBe('fault');
    expect(f.step(X({ temp: 99, fuse: [true, false, false] }), 0.2)).toBe('warn');
    expect(f.step(X({ temp: 99, fuse: [true, false, false] }), 0.3)).toBe(null);
  });

  it('un fusible que ya estaba saltado no da falla; uno nuevo sí, aunque haya otro saltado', () => {
    const f = new Feedback();
    expect(f.step(X({ fuse: [true, false, false] }), 0)).toBe(null);
    expect(f.step(X({ fuse: [true, false, false] }), 0.1)).toBe(null);
    expect(f.step(X({ fuse: [true, false, true] }), 0.2)).toBe('fault');
    // Se rearma y vuelve a saltar: otra falla.
    expect(f.step(X({ fuse: [false, false, true] }), 0.3)).toBe(null);
    expect(f.step(X({ fuse: [true, false, true] }), 0.4)).toBe('fault');
  });

  it('una condición sostenida avisa una sola vez, aunque dure mucho más que el silencio', () => {
    const r = run(new Feedback(), same(400, HOT));
    expect(r).toEqual([[0, 'warn']]);
  });

  it('una que va y viene no avisa dos veces en 10 s', () => {
    const f = new Feedback(), frio = X({ temp: 80 });
    const r = run(f, [HOT, frio, HOT, frio, HOT, frio], 0, 1).concat(run(f, [HOT], 10, 1));
    expect(r).toEqual([[0, 'warn'], [10, 'warn']]);
    // Con la condición apagada en el medio y 9,9 s después sigue callada; a los 10 s vuelve.
    const g = new Feedback();
    expect(g.step(HOT, 0)).toBe('warn');
    expect(g.step(frio, 1)).toBe(null);
    expect(g.step(HOT, FEEDBACK.SILENCE - 0.1)).toBe(null);
    expect(g.step(frio, FEEDBACK.SILENCE - 0.05)).toBe(null);
    expect(g.step(HOT, FEEDBACK.SILENCE)).toBe('warn');
  });

  it('el silencio es por tipo: motor, batería y nafta no se tapan entre sí', () => {
    const f = new Feedback();
    expect(f.step(X({ temp: 99 }), 0)).toBe('warn');
    expect(f.step(X({ temp: 99, bat: 10 }), 0.1)).toBe('warn');
    expect(f.step(X({ temp: 99, bat: 10, fuelLaps: -0.2 }), 0.2)).toBe('warn');
    expect(f.step(X({ temp: 99, bat: 10, fuelLaps: -0.2 }), 0.3)).toBe(null);
  });

  it('cada advertencia se prende en su umbral', () => {
    const avisa = (o: Partial<FeedbackIn>): boolean => new Feedback().step(X(o), 0) === 'warn';
    expect(avisa({ temp: FEEDBACK.HOT - 0.1 })).toBe(false);
    expect(avisa({ temp: FEEDBACK.HOT })).toBe(true);
    expect(FEEDBACK.HOT).toBe(PHYS.TEMP_LIMIT - 2);
    expect(avisa({ bat: FEEDBACK.BAT })).toBe(false);
    expect(avisa({ bat: FEEDBACK.BAT - 0.1 })).toBe(true);
    expect(avisa({ fuelLaps: 0 })).toBe(false);
    expect(avisa({ fuelLaps: -0.1 })).toBe(true);
  });

  it('meta y vuelta salen por flanco', () => {
    const f = new Feedback();
    expect(cues(run(f, [X({ lap: 0 }), X({ lap: 0 }), X({ lap: 1 }), X({ lap: 1 }), X({ lap: 1 })]))).toEqual(['phase']);
    expect(cues(run(f, [X({ lap: 2 }), X({ lap: 2 }), X({ lap: 3, done: true }), X({ lap: 3, done: true })], 1))).toEqual(['phase', 'phase']);
    const g = new Feedback();
    expect(cues(run(g, [X({ lap: 2 }), X({ lap: 2, done: true }), X({ lap: 2, done: true })]))).toEqual(['phase']);
  });

  it('la largada no da señal: ni la luz verde, ni el primer cuadro, ni la primera vuelta', () => {
    const f = new Feedback();
    const grilla = X({ green: false, ty: 's' });
    expect(cues(run(f, [grilla, grilla, X({ green: true, ty: 's' }), X({ green: true, ty: 's', lap: 0 })]))).toEqual([]);
    // El primer cuadro no tiene flancos aunque ya haya vueltas, fusibles saltados o meta.
    expect(new Feedback().step(X({ lap: 4, done: true, fuse: [true, true, true] }), 0)).toBe(null);
  });

  it('entrar a un tramo con puntaje 1 da good; con menos, o quedándose en él, nada', () => {
    const f = new Feedback();
    f.step(X({ ty: 's', sc: 1 }), 0);
    expect(f.step(X({ ty: 'b', sc: 1 }), 0.1)).toBe('good');
    expect(f.step(X({ ty: 'b', sc: 1 }), 0.2)).toBe(null);
    expect(f.step(X({ ty: 'c', sc: 0.9 }), 0.3)).toBe(null);
    expect(f.step(X({ ty: 'c', sc: 1 }), 0.4)).toBe(null);
    expect(f.step(X({ ty: 'x', sc: 1 }), 0.5)).toBe('good');
    expect(FEEDBACK.GOOD).toBeLessThanOrEqual(1);
    expect(FEEDBACK.GOOD).toBeGreaterThan(0.99);
  });

  it('la confirmación sale cuando el jugador toca un control y es lo último en el orden', () => {
    const f = new Feedback();
    expect(f.step(X({ changed: true }), 0)).toBe('confirm');
    expect(f.step(X({ changed: false }), 0.1)).toBe(null);
    expect(f.step(X({ changed: true, ty: 'b', sc: 1 }), 0.2)).toBe('good');
  });

  it('en la grilla no hay advertencias ni good, y con la meta tampoco', () => {
    const f = new Feedback();
    const r = run(f, [X({ green: false, temp: 99, bat: 5, fuelLaps: -1 }), X({ green: false, temp: 99, bat: 5, fuelLaps: -1, ty: 'b', sc: 1 })]);
    expect(r).toEqual([]);
    const g = new Feedback();
    g.step(X({ lap: 2 }), 0);
    expect(g.step(X({ lap: 3, done: true, temp: 99, ty: 'b', sc: 1 }), 0.1)).toBe('phase');
    expect(g.step(X({ lap: 3, done: true, temp: 99, ty: 'x', sc: 1 }), 0.2)).toBe(null);
  });

  it('una advertencia que se prendió en la grilla sale al largar', () => {
    const f = new Feedback();
    expect(f.step(X({ green: false, temp: 99 }), 0)).toBe(null);
    expect(f.step(X({ green: true, temp: 99 }), 0.1)).toBe('warn');
  });

  it('reset vuelve a armar todo: advertencias, silencio y flancos', () => {
    const f = new Feedback();
    expect(f.step(HOT, 5)).toBe('warn');
    expect(f.step(HOT, 6)).toBe(null);
    f.step(X({ lap: 3, done: true, fuse: [true, true, false] }), 7);
    f.reset();
    // Carrera nueva, el reloj arranca de nuevo: la advertencia sale de entrada, sin esperar los 10 s.
    expect(f.step(HOT, 1)).toBe('warn');
    // El primer cuadro después del reset no tiene flancos: sin el reset, este fusible saltado sería una falla.
    f.reset();
    expect(f.step(X({ fuse: [true, false, false] }), 0)).toBe(null);
  });
});

describe('sonido y vibración de respuesta', () => {
  interface Tono { f: number; type: string; at: number; end: number; dur: number; vol: number }
  /** Un AudioContext de mentira que anota cada tono que se agenda. */
  function falso(): { s: Sound; tonos: Tono[] } {
    const tonos: Tono[] = [];
    const nodo = (): { connect: <T>(n: T) => T } => ({ connect: (n) => n });
    const ctx = {
      currentTime: 100,
      createOscillator: () => {
        const tono: Tono = { f: 0, type: '', at: 0, end: 0, dur: 0, vol: 0 };
        tonos.push(tono);
        const o = { type: '', frequency: { value: 0 }, ...nodo(), stop: () => {}, start: (t: number) => { tono.f = o.frequency.value; tono.type = o.type; tono.at = t - 100; tono.dur = tono.end - tono.at; } };
        return o;
      },
      createGain: () => ({
        ...nodo(),
        gain: {
          setValueAtTime: (v: number) => { tonos[tonos.length - 1].vol = v; },
          exponentialRampToValueAtTime: (_v: number, t: number) => { tonos[tonos.length - 1].end = t - 100; },
        },
      }),
    };
    const s = new Sound(true);
    Object.assign(s, { ctx, out: nodo() });
    return { s, tonos };
  }
  const forma = (t: Tono[]): [number, string, number, number, number][] =>
    t.map((x) => [x.f, x.type, +x.at.toFixed(2), +x.dur.toFixed(2), x.vol]);

  it('warn: dos toques graves iguales', () => {
    const { s, tonos } = falso();
    s.warn();
    expect(forma(tonos)).toEqual([[520, 'triangle', 0, 0.12, 0.14], [520, 'triangle', 0.16, 0.12, 0.14]]);
  });

  it('good: uno corto y bajito', () => {
    const { s, tonos } = falso();
    s.good();
    expect(forma(tonos)).toEqual([[1320, 'sine', 0, 0.06, 0.08]]);
  });

  it('lap: dos tonos que suben', () => {
    const { s, tonos } = falso();
    s.lap();
    expect(forma(tonos)).toEqual([[660, 'sine', 0, 0.12, 0.14], [880, 'sine', 0.14, 0.12, 0.14]]);
  });

  it('finish: tres tonos que suben y el último largo', () => {
    const { s, tonos } = falso();
    s.finish();
    expect(forma(tonos)).toEqual([[660, 'sine', 0, 0.12, 0.16], [880, 'sine', 0.15, 0.12, 0.16], [1100, 'sine', 0.3, 0.4, 0.16]]);
  });

  it('sin audio o apagado no suena nada', () => {
    const { s, tonos } = falso();
    s.enabled = false;
    s.warn(); s.good(); s.lap(); s.finish();
    expect(tonos).toEqual([]);
    expect(() => new Sound(true).warn()).not.toThrow();
  });

  it('la vibración de advertencia es corta y distinta de la del fusible', () => {
    expect(BUZZ.warn).toEqual([30, 80, 30]);
    expect(BUZZ.warn).not.toEqual(BUZZ.alarm);
    expect(BUZZ.tap).toBe(8);
  });
});
