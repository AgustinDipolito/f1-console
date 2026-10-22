import { describe, expect, it } from 'vitest';
import { buildTrack } from '../src/tracks/build';
import { Race } from '../src/sim/race';
import { ahead, balWant, effective, steer, fuelLoad, idx, newCar, posAt, remaining, stepCar, type StepCtx } from '../src/sim/car';
import { botControls } from '../src/bot/bot';
import { FAULT, FUEL, PHYS, STEER } from '../src/sim/physics';
import { BAL, IDEAL_BAL, WANTS, efficiency, idealBal, score, suggest } from '../src/sim/score';
import { TEL_DS, delta, emptyLap, ghostS, timeAt } from '../src/sim/telemetry';
import { diagnose, lapDiagnosis, type Diagnosis, type Loss } from '../src/sim/diagnose';
import type { Car, Controls, Difficulty, Lap, Seg, Track, Vec2 } from '../src/sim/types';

function oval(): Vec2[] {
  const pts: Vec2[] = [], L = 600, R = 80;
  for (let x = 0; x < L; x += 5) pts.push([x, -R]);
  for (let a = -Math.PI / 2; a < Math.PI / 2; a += 0.05) pts.push([L + Math.cos(a) * R, Math.sin(a) * R]);
  for (let x = L; x > 0; x -= 5) pts.push([x, R]);
  for (let a = Math.PI / 2; a < (3 * Math.PI) / 2; a += 0.05) pts.push([Math.cos(a) * R, Math.sin(a) * R]);
  return pts;
}

const track: Track = buildTrack('oval', 'Óvalo', oval());
const ctl = (o: Partial<Controls> = {}): Controls => ({ lev: 1, ers: 1, bal: 56, lim: false, dif: 1, eb: 1, rst: [0, 0, 0], ...o });

/** Lo que pide el tramo, perfecto y sin retraso. El balance, el que pide la nafta que le queda al auto. */
const wanted = (ty: Seg, c?: Car): Controls => {
  const w = WANTS[ty];
  return ctl({ lev: w.lev?.[0] ?? 1, ers: w.ers?.[0] ?? 1, bal: c ? balWant(c) : IDEAL_BAL, dif: w.dif?.[0] ?? 1, eb: w.eb?.[0] ?? 1 });
};
const ideal = (s: number, c?: Car): Controls => wanted(track.ty[idx(track, s)], c);

function runRace(ctlFor: (s: number, c: Car) => Controls, difficulty: Difficulty = 'normal', o: { bots?: number; faults?: boolean } = {}): Race {
  const r = new Race(track, { laps: 2, difficulty, trail: false, bots: o.bots ?? 1, faults: o.faults ?? false });
  r.start();
  for (let i = 0; i < 200000 && !r.cars.every((c) => c.done); i++) r.step(0.02, 1, ctlFor(r.player.s, r.player));
  return r;
}

const ctx: StepCtx = { green: true, t: 0, laps: 99, trail: false, faults: false };

describe('carrera', () => {
  it('todos terminan', () => {
    const r = runRace(ideal, 'normal', { bots: 3 });
    expect(r.cars.every((c) => c.done)).toBe(true);
    expect(r.result()?.of).toBe(4);
  });

  it('configurar bien cada tramo es más rápido que ir en eco y harvest', () => {
    const good = runRace(ideal), bad = runRace(() => ctl({ lev: 0, ers: 0, bal: 50 }));
    expect(good.player.fin as number).toBeLessThan(bad.player.fin as number);
  });

  it('el bot difícil es más rápido que el fácil', () => {
    const easy = runRace(ideal, 'easy'), hard = runRace(ideal, 'hard');
    expect(hard.bots[0].fin as number).toBeLessThan(easy.bots[0].fin as number);
  });

  it('el orden pone primero al que terminó antes', () => {
    const r = runRace(() => ctl({ lev: 0, ers: 0, bal: 50 }), 'hard');
    expect(r.position()).toBe(2);
    expect(r.result()?.won).toBe(false);
  });
});

describe('tramos', () => {
  it('el óvalo tiene rectas, frenadas y curvas', () => {
    const seen = new Set(track.ty);
    for (const s of ['s', 'b', 'c'] as Seg[]) expect(seen.has(s)).toBe(true);
  });

  it('la salida de curva pide diferencial bloqueado y la curva abierto', () => {
    expect(score('x', ctl({ lev: 2, dif: 2 }), 50)).toBeGreaterThan(score('x', ctl({ lev: 2, dif: 0 }), 50));
    expect(score('c', ctl({ dif: 0, eb: 0 }), 50)).toBeGreaterThan(score('c', ctl({ dif: 2, eb: 0 }), 50));
  });

  it('el modo fácil sugiere solo lo que está fuera de lugar', () => {
    expect(suggest('x', ctl({ lev: 2, dif: 0 }))).toEqual({ dif: 2 });
    expect(suggest('b', ctl({ ers: 0, eb: 2, bal: 57 }), 57)).toEqual({});
    expect(suggest('b', ctl({ ers: 0, eb: 2, bal: 56 }), 57)).toEqual({ bal: 57 });
    expect(suggest('s', ctl({ lev: 2, ers: 2, bal: 50 }), 57)).toEqual({});
  });

  it('el balance pedido va de adelante con el tanque lleno hacia atrás con el tanque vacío, de a 1 %', () => {
    expect(idealBal(1)).toBe(BAL.FULL);
    expect(idealBal(0)).toBe(BAL.EMPTY);
    const steps = new Set(Array.from({ length: 101 }, (_, i) => idealBal(i / 100)));
    expect(steps.size).toBe(BAL.FULL - BAL.EMPTY + 1);
    for (let i = 1; i <= 100; i++) expect(idealBal(i / 100)).toBeGreaterThanOrEqual(idealBal((i - 1) / 100));
  });

  it('el auto pide más balance adelante al largar que al final de la carrera', () => {
    const c = newCar(track, 6, 0, 5);
    expect(balWant(c)).toBe(BAL.FULL);
    c.fuel = c.fuel0 * 0.05;
    expect(balWant(c)).toBe(BAL.EMPTY);
  });

  it('en la frenada, el balance lejos de lo pedido cuesta y justo no', () => {
    const b = ctl({ ers: 0, eb: 2, bal: 58 });
    expect(score('b', b, 50, 58)).toBe(1);
    expect(score('b', b, 50, 56)).toBeLessThan(score('b', b, 50, 57));
    expect(score('b', b, 50, 54)).toBeLessThan(0.75);
  });

  it('seguir el balance que pide la nafta da una carrera más rápida que dejarlo fijo', () => {
    const fixed = runRace((s, c) => ({ ...ideal(s, c), bal: IDEAL_BAL }), 'normal', { bots: 0 });
    const tracked = runRace(ideal, 'normal', { bots: 0 });
    expect(tracked.player.fin as number).toBeLessThan(fixed.player.fin as number);
  });

  it('la frenada pide freno motor alto', () => {
    expect(score('b', ctl({ ers: 0, bal: IDEAL_BAL, eb: 2 }), 50)).toBe(1);
    expect(score('b', ctl({ ers: 0, bal: IDEAL_BAL, eb: 0 }), 50)).toBeLessThan(1);
  });

  it('ahead da el próximo tramo y la distancia', () => {
    const s = 40, a = ahead(track, s), i = idx(track, s);
    expect(a.ty).not.toBe(track.ty[i]);
    expect(track.ty[idx(track, s + a.dist + 0.01)]).toBe(a.ty);
    expect(track.ty[idx(track, s + a.dist - 0.5)]).toBe(track.ty[i]);
  });
});

describe('auto', () => {
  it('attack descarga la batería', () => {
    const c = newCar(track, 6, 0);
    c.s = 100;
    stepCar(c, ctl({ lev: 2, ers: 2 }), track, 1, ctx);
    expect(c.bat).toBeLessThan(80);
  });

  it('el limitador clava 80 km/h', () => {
    const c = newCar(track, 6, 0);
    c.s = 50;
    for (let i = 0; i < 500; i++) stepCar(c, ctl({ lev: 2, lim: true }), track, 0.02, ctx);
    expect(c.v).toBeLessThanOrEqual(PHYS.LIMITER + 1e-6);
    expect(c.v).toBeGreaterThan(PHYS.LIMITER - 1);
  });
});

describe('neumáticos y nafta', () => {
  const lap = (c: Controls): ReturnType<typeof newCar> => {
    const car = newCar(track, 6, 0, 5);
    car.s = 0; car.laps = 0;
    for (let i = 0; i < 3000; i++) stepCar(car, c, track, 0.02, ctx);
    return car;
  };

  it('push gasta más goma y más nafta que eco', () => {
    const push = lap(ctl({ lev: 2 })), eco = lap(ctl({ lev: 0 }));
    expect(push.tyre).toBeLessThan(eco.tyre);
    expect(push.fuel).toBeLessThan(eco.fuel);
  });

  it('con la goma gastada la curva sale más lenta', () => {
    const run = (tyre: number): number => {
      const c = newCar(track, 6, 0);
      const i = track.ty.indexOf('c');
      c.s = i * track.ds; c.v = track.v[i]; c.tyre = tyre;
      for (let k = 0; k < 50; k++) stepCar(c, ideal(c.s), track, 0.02, ctx);
      return c.v;
    };
    expect(run(0)).toBeLessThan(run(100));
  });

  it('sin nafta el auto se arrastra', () => {
    const c = newCar(track, 6, 0);
    c.s = 0; c.fuel = 0;
    for (let i = 0; i < 1000; i++) stepCar(c, ctl({ lev: 2, ers: 2 }), track, 0.02, ctx);
    expect(c.v).toBeLessThanOrEqual(FUEL.DRY_V + 1e-6);
  });

  it('la carga alcanza yendo en normal; en push todo el tiempo, solo en fácil', () => {
    const need = (mix: number): number => 3 * track.len * FUEL.BURN * mix;
    for (const d of ['easy', 'normal', 'hard'] as const) expect(fuelLoad(track, 3, d)).toBeGreaterThan(need(FUEL.MIX[1]));
    expect(fuelLoad(track, 3, 'easy')).toBeGreaterThan(need(FUEL.MIX[2]));
    expect(fuelLoad(track, 3, 'normal')).toBeLessThan(need(FUEL.MIX[2]));
    expect(fuelLoad(track, 3, 'hard')).toBeLessThan(fuelLoad(track, 3, 'normal'));
    expect(fuelLoad(track, 3, 'normal')).toBeLessThan(fuelLoad(track, 3, 'easy'));
  });
});

describe('fusibles', () => {
  const blown = (f: number): ReturnType<typeof newCar> => { const c = newCar(track, 6, 0); c.s = 0; c.fuse[f] = true; return c; };

  it('con fallas activas, tarde o temprano salta uno', () => {
    const c = newCar(track, 6, 0, 99, 7);
    for (let i = 0; i < 100000 && !c.fuse.some(Boolean); i++) stepCar(c, ctl(), track, 0.02, { ...ctx, faults: true });
    expect(c.fuse.some(Boolean)).toBe(true);
  });

  it('un fusible saltado traba su control en el centro', () => {
    expect(effective(ctl({ dif: 2 }), blown(1).fuse).dif).toBe(FAULT.NEUTRAL);
  });

  it('ERS saltado no carga ni descarga la batería', () => {
    const c = blown(0);
    stepCar(c, ctl({ ers: 0 }), track, 1, ctx);
    expect(c.bat).toBe(80);
  });

  it('rearmar con el control fuera del centro no anda; en el centro sí', () => {
    const c = blown(1);
    stepCar(c, ctl({ dif: 2, rst: [0, 1, 0] }), track, 0.02, ctx);
    expect(c.fuse[1]).toBe(true);
    stepCar(c, ctl({ dif: 1, rst: [0, 2, 0] }), track, 0.02, ctx);
    expect(c.fuse[1]).toBe(false);
  });

  it('el bot rearma después de su demora', () => {
    const c = blown(2);
    c.fuseT[2] = 0;
    expect(botControls(c, track, 0.5, 'hard').rst[2]).toBe(0);
    const k = botControls(c, track, 10, 'hard');
    expect(k.rst[2]).toBe(1);
    expect(k.eb).toBe(FAULT.NEUTRAL);
  });
});

describe('telemetría', () => {
  const r = runRace(ideal);
  const best = r.player.hist.reduce((a, l) => (l.t < a.t ? l : a));

  it('registra cada vuelta con su tiempo', () => {
    expect(r.player.hist.length).toBe(2);
    expect(best.t).toBe(r.player.best);
    expect(timeAt(best, 0)).toBeLessThan(0.5);
  });

  it('contra sí misma el delta es cero y el fantasma coincide', () => {
    const s = track.len / 2, t = timeAt(best, s);
    expect(Math.abs(delta(best, s, t))).toBeLessThan(1e-9);
    expect(Math.abs(ghostS(best, t, track.len) - s)).toBeLessThan(1);
    expect(delta(best, s, t + 1)).toBeCloseTo(1);
  });
});

describe('detalles del modelo', () => {
  const launch = (setup: (c: ReturnType<typeof newCar>) => void, k: Controls): number => {
    const c = newCar(track, 6, 0, 5);
    c.s = 0;
    setup(c);
    for (let i = 0; i < 100; i++) stepCar(c, k, track, 0.02, ctx);
    return c.v;
  };

  it('con menos nafta acelera más', () => {
    expect(launch((c) => { c.fuel = 5; }, ctl({ lev: 2 }))).toBeGreaterThan(launch(() => {}, ctl({ lev: 2 })));
  });

  it('attack con batería empuja más que balanced', () => {
    expect(launch(() => {}, ctl({ lev: 2, ers: 2 }))).toBeGreaterThan(launch(() => {}, ctl({ lev: 2, ers: 1 })));
  });

  it('pasando el límite de temperatura la eficacia cae', () => {
    expect(efficiency(1, PHYS.TEMP_LIMIT)).toBeLessThan(efficiency(1, PHYS.TEMP_LIMIT - 1));
  });

  it('con el motor caliente saltan más fusibles', () => {
    const firstFault = (hot: boolean, seed: number): number => {
      const c = newCar(track, 6, 0, 99, seed);
      for (let i = 1; i < 200000; i++) {
        if (hot) c.temp = 110; else c.temp = 80;
        stepCar(c, ctl({ lev: hot ? 2 : 0 }), track, 0.02, { ...ctx, faults: true });
        if (c.fuse.some(Boolean)) return i;
      }
      return 200000;
    };
    const avg = (hot: boolean): number => Array.from({ length: 20 }, (_, k) => firstFault(hot, 100 + k)).reduce((a, b) => a + b) / 20;
    expect(avg(true)).toBeLessThan(avg(false));
  });

  it('remaining arranca en la carrera completa más el hueco de la grilla', () => {
    const c = newCar(track, 6, 0, 3);
    expect(remaining(track, c, 3)).toBeCloseTo(3 * track.len + 6);
  });

  it('posAt corre el punto o metros hacia la izquierda', () => {
    const a = posAt(track, 20), b = posAt(track, 20, 5);
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(5);
  });

  it('el bot levanta en la recta si no le alcanza la nafta', () => {
    const c = newCar(track, 6, 0, 3);
    // Mitad de una recta, con margen para el retraso de lectura del bot.
    const i = track.ty.findIndex((_, j) => j > 20 && track.ty.slice(j - 20, j + 1).every((t) => t === 's'));
    c.s = i * track.ds;
    c.laps = 0;
    expect(botControls(c, track, 0, 'hard', 0, 3).lev).toBe(2);
    c.fuel = 1;
    expect(botControls(c, track, 0, 'hard', 0, 3).lev).toBe(1);
  });

  it('el gap es negativo yendo atrás y el margen de la derrota es positivo', () => {
    const r = runRace(() => ctl({ lev: 0, ers: 0, bal: 50 }), 'hard');
    expect(r.gap()).toBeLessThan(0);
    expect(r.result()?.margin).toBeGreaterThan(0);
  });
});

describe('telemetría en la línea', () => {
  // Vuelta de 22 m: el último registro mide 2 m, no 10.
  const l: Lap = { ...emptyLap(22), t: 2.2 };
  l.tt = [0, 1, 2];

  it('timeAt llega al tiempo de vuelta justo en la línea', () => {
    expect(timeAt(l, 21.99, 22)).toBeCloseTo(2.2, 2);
  });

  it('el fantasma no se adelanta en el último registro', () => {
    expect(ghostS(l, 2.1, 22)).toBeCloseTo(21);
  });

  it('una vuelta real no deja registros vacíos', () => {
    const r = runRace(ideal);
    for (const lap of r.player.hist) expect(lap.tt.every(Number.isFinite)).toBe(true);
    expect(TEL_DS).toBeGreaterThan(0);
  });
});

describe('caja negra y diagnóstico', () => {
  /** Lee el tramo m metros atrás (positivo, tarde) o adelante (negativo, antes de tiempo). */
  const reading = (m: number) => (s: number, c: Car): Controls => ideal((((s - m) % track.len) + track.len) % track.len, c);
  const lapsOf = (f: (s: number, c: Car) => Controls): Lap[] => runRace(f).player.hist;
  const sum = (d: Diagnosis, pick: (l: Loss) => boolean = () => true): number => d.losses.filter(pick).reduce((a, l) => a + l.sec, 0);

  it('la caja negra guarda lo que pedía la consola en cada registro', () => {
    const [l] = lapsOf(() => ctl({ lev: 2, bal: 60 }));
    expect(l.rec?.length).toBe(l.tt.length);
    expect(l.rec?.every((r) => r.lev === 2 && r.bal === 60)).toBe(true);
  });

  it('las pérdidas suman lo que la vuelta tardó de más contra la ideal', () => {
    lapsOf(reading(30)).forEach((l, i) => {
      const d = diagnose(track, l, i === 0) as Diagnosis;
      expect(d.ideal).toBeCloseTo(track.idealLap, 6);
      expect(sum(d)).toBeCloseTo(l.t - l.tt[0] - d.ideal, 6);
    });
  });

  it('leer el tramo 30 m tarde se diagnostica como llegar tarde', () => {
    const d = diagnose(track, lapsOf(reading(30))[1], false) as Diagnosis;
    expect(sum(d, (l) => l.when === 'late')).toBeGreaterThan(5 * Math.max(0, sum(d, (l) => l.when === 'early')));
    expect(d.losses.filter((l) => l.when === 'late').every((l) => l.m <= 40)).toBe(true);
  });

  it('adelantarse 40 m se diagnostica como cambiar antes de tiempo', () => {
    const d = diagnose(track, lapsOf(reading(-40))[1], false) as Diagnosis;
    expect(sum(d, (l) => l.when === 'early')).toBeGreaterThan(5 * Math.max(0, sum(d, (l) => l.when === 'late')));
  });

  it('bajar el ERS al final de la recta a un valor que no pide la frenada no es adelantarse', () => {
    const d = diagnose(track, lapsOf((s, car) => {
      const c = ideal(s, car);
      return c.ers === 2 && track.ty[idx(track, s + 60)] !== 's' ? { ...c, ers: 1 } : c;
    })[1], false) as Diagnosis;
    expect(d.losses.some((l) => l.cause === 'ers' && l.when === 'early')).toBe(false);
    expect(d.losses.some((l) => l.cause === 'ers' && l.when === 'off' && l.val === 1 && l.ty === 's')).toBe(true);
  });

  it('el fader de frenos corrido queda como frenos fuera de lo pedido, con su valor', () => {
    const lap = lapsOf((s, c) => ({ ...ideal(s, c), bal: 60 }))[1], d = diagnose(track, lap, false) as Diagnosis;
    const l = d.losses.find((x) => x.knob) as Loss;
    expect(l).toMatchObject({ cause: 'bal', when: 'off', ty: 'b', val: 60 });
    expect(l.want).toBe(lap.rec?.[l.s0 / TEL_DS].bw);
  });

  it('la largada se cuenta aparte y solo en la primera vuelta', () => {
    const [a, b] = lapsOf(ideal);
    expect(sum(diagnose(track, a, true) as Diagnosis, (l) => l.cause === 'start')).toBeGreaterThan(0.1);
    expect((diagnose(track, b, false) as Diagnosis).losses.some((l) => l.cause === 'start')).toBe(false);
  });

  it('una vuelta sin caja negra no se diagnostica', () => {
    const l = lapsOf(ideal)[0];
    expect(diagnose(track, { t: l.t, tt: l.tt, v: l.v }, false)).toBeNull();
  });

  it('el diagnóstico de una vuelta cerrada se calcula una vez y da lo mismo que diagnose', () => {
    const [a] = lapsOf(reading(30));
    const d = lapDiagnosis(track, a, true);
    expect(lapDiagnosis(track, a, true)).toBe(d);
    expect(d).toEqual(diagnose(track, a, true));
    // Con otra largada u otro trazado es otra cuenta.
    expect(lapDiagnosis(track, a, false)).toEqual(diagnose(track, a, false));
    expect(lapDiagnosis(track, a, false)).not.toBe(d);
  });
});

describe('carrera: orden calculado una vez', () => {
  it('puesto y diferencia dan lo mismo con el orden pasado que calculándolo', () => {
    const r = new Race(track, { laps: 2, difficulty: 'normal', trail: false, bots: 3, faults: false });
    r.start();
    for (let i = 0; i < 1500; i++) r.step(0.02, 1, ideal(r.player.s));
    const o = r.order();
    expect(r.position(o)).toBe(r.position());
    expect(r.gap(o)).toBe(r.gap());
  });
});

describe('volante', () => {
  it('en recta va derecho y en curva gira hacia el lado de la curva, con tope', () => {
    const si = track.ty.findIndex((_, j) => j > 20 && track.ty.slice(j - 20, j + 1).every((t) => t === 's'));
    expect(Math.abs(steer(track, si * track.ds))).toBeLessThan(0.05);
    const ci = track.ty.indexOf('c'), a = steer(track, ci * track.ds);
    expect(Math.sign(a)).toBe(Math.sign(track.k[ci]));
    expect(Math.abs(a)).toBeGreaterThan(0.3);
    expect(Math.abs(a)).toBeLessThanOrEqual(STEER.LOCK);
  });
});

describe('tabla de resultados', () => {
  it('al terminar lista a todos en orden de carrera, con vos marcado', () => {
    const r = new Race(track, { laps: 1, difficulty: 'normal', trail: false, bots: 2, faults: false });
    r.start();
    const ctl = { lev: 2, ers: 1, bal: 56, lim: false, dif: 1, eb: 1, rst: [0, 0, 0] } as Controls;
    for (let i = 0; i < 60000 && r.phase !== 'done'; i++) r.step(0.02, 1, ctl);
    expect(r.phase).toBe('done');
    const st = r.standings();
    expect(st.map((x) => x.pos)).toEqual([1, 2, 3]);
    expect(st.filter((x) => x.me)).toHaveLength(1);
    expect(st.find((x) => x.me)?.fin).toBe(r.player.fin);
    r.step(0.02, 1, ctl);
    expect(r.phase).toBe('done');
  });
});
