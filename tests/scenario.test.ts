import { describe, expect, it } from 'vitest';
import { buildTrack, coordsOf, geoToMeters } from '../src/tracks/build';
import catalog from '../src/tracks/catalog.json';
import { Race } from '../src/sim/race';
import { fuelLoad } from '../src/sim/car';
import { BOT_PROFILES, botControls, botProfile } from '../src/bot/bot';
import { PHYS, SIM_VER, START } from '../src/sim/physics';
import { CHALLENGES, evaluate, scenarioOpts, type Scenario } from '../src/sim/scenario';
import { HEAD_STARTS, chaseDelta, chaseResult, chaseS } from '../src/sim/chase';
import { ghostS, timeAt } from '../src/sim/telemetry';
import type { Controls, Lap, Track, Vec2 } from '../src/sim/types';
import { FIXED, PLAYERS } from './models';

function oval(): Vec2[] {
  const pts: Vec2[] = [], L = 600, R = 80;
  for (let x = 0; x < L; x += 5) pts.push([x, -R]);
  for (let a = -Math.PI / 2; a < Math.PI / 2; a += 0.05) pts.push([L + Math.cos(a) * R, Math.sin(a) * R]);
  for (let x = L; x > 0; x -= 5) pts.push([x, R]);
  for (let a = Math.PI / 2; a < (3 * Math.PI) / 2; a += 0.05) pts.push([Math.cos(a) * R, Math.sin(a) * R]);
  return pts;
}

const track: Track = buildTrack('oval', 'Óvalo', oval());
const ctl: Controls = { ...FIXED };
const opts = { laps: 2, difficulty: 'normal', trail: false, bots: 1, faults: false } as const;
const snapOf = { t: 0, d: 0, v: 0, off: 0, done: false, fin: null, best: null };

const files = import.meta.glob<string>('../public/tracks/*.geojson', { eager: true, query: '?raw', import: 'default' });
const cache = new Map<string, Track>();
const file = (id: string): string => `../public/tracks/${id}.geojson`;
/** Trazado real por id, armado una sola vez. */
const real = (id: string): Track => {
  let t = cache.get(id);
  if (!t) { t = buildTrack(id, id, geoToMeters(coordsOf(JSON.parse(files[file(id)]))!)); cache.set(id, t); }
  return t;
};
const ids = Object.keys(files).map((f) => f.replace(/.*\//, '').replace('.geojson', ''));

/** Corre hasta que el jugador cruza la meta (o hasta que `until` diga basta). */
function drive(r: Race, until: (r: Race) => boolean = () => false): Race {
  r.start();
  for (let i = 0; i < 400000 && r.phase !== 'done' && !until(r); i++) r.step(0.02, 1, ctl);
  return r;
}

describe('condiciones de largada', () => {
  const start = { bat: 30, temp: 90, tyre: 50, fuel: 0.5 };

  it('todos largan con lo pedido', () => {
    const r = new Race(track, { ...opts, laps: 3, bots: 2, start });
    for (const c of [r.player, ...r.bots]) {
      expect([c.bat, c.temp, c.tmax, c.tyre]).toEqual([30, 90, 90, 50]);
      expect(c.fuel0).toBe(fuelLoad(track, 3));
      expect(c.fuel).toBeCloseTo(c.fuel0 * 0.5, 12);
    }
  });

  it('un jugador remoto no entra al escenario: larga como siempre', () => {
    const r = new Race(track, { ...opts, start });
    r.snap('x', 'Ana', snapOf);
    const c = r.remote[0].car;
    expect([c.bat, c.temp, c.tyre, c.fuel]).toEqual([START.BAT, START.TEMP, 100, c.fuel0]);
  });

  it('sin start largan como siempre y con la nafta llena', () => {
    const r = new Race(track, opts);
    for (const c of [r.player, ...r.bots]) {
      expect([c.bat, c.temp, c.tmax, c.tyre, c.fuel]).toEqual([START.BAT, START.TEMP, START.TEMP, 100, c.fuel0]);
    }
    expect(r.fuelEnd).toBeNull();
  });

  it('la revancha vuelve a aplicar el start', () => {
    const r = drive(new Race(track, { ...opts, laps: 1, start }));
    expect(r.phase).toBe('done');
    expect(r.player.tyre).not.toBe(50);
    r.start();
    expect(r.phase).toBe('count');
    expect([r.player.bat, r.player.temp, r.player.tmax, r.player.tyre]).toEqual([30, 90, 90, 50]);
    expect(r.player.fuel).toBeCloseTo(r.player.fuel0 * 0.5, 12);
    expect(r.fuelEnd).toBeNull();
  });
});

describe('falla programada', () => {
  const fault = { lap: 1, s: 400, f: 1 };
  interface Hit { i: number; laps: number; dist: number }
  /** Cada flanco de fusible saltado: de qué auto y dónde. Vos rearmás apenas salta. */
  function hits(r: Race, f: number): Hit[] {
    const prev = r.cars.map(() => false), out: Hit[] = [], rst = [0, 0, 0];
    r.start();
    for (let k = 0; k < 400000 && !r.cars.every((c) => c.done); k++) {
      if (r.player.fuse[f]) rst[f]++;
      r.step(0.02, 1, { ...ctl, rst: rst.slice() });
      r.cars.forEach((c, i) => { if (c.fuse[f] && !prev[i]) out.push({ i, laps: c.laps, dist: r.dist(c) }); prev[i] = c.fuse[f]; });
    }
    return out;
  }

  it('salta una vez, en el punto, a vos y a los bots; se rearma y en la vuelta 2 no vuelve', () => {
    const r = new Race(track, { ...opts, bots: 2, fault });
    const h = hits(r, 1);
    expect(h.map((x) => x.i).sort()).toEqual([0, 1, 2]);
    for (const x of h) {
      expect(x.laps).toBe(0);
      expect(Math.abs(x.dist - 400)).toBeLessThan(10);
    }
    expect(r.cars.every((c) => c.done && !c.fuse[1])).toBe(true);
  });

  it('cuenta como un evento fuse de la carrera y queda su hora', () => {
    const r = new Race(track, { ...opts, bots: 0, fault });
    r.start();
    const evs: string[] = [];
    for (let k = 0; k < 4000 && !r.player.fuse[1]; k++) evs.push(...r.step(0.02, 1, ctl));
    expect(evs.filter((e) => e === 'fuse')).toHaveLength(1);
    expect(r.player.fuseT[1]).toBeCloseTo(r.t, 1);
  });

  it('sin falla programada ni fallas al azar no salta nada', () => {
    expect(hits(new Race(track, { ...opts, bots: 2 }), 1)).toHaveLength(0);
  });

  it.skipIf(!ids.length)('en los trazados reales salta a menos de 10 m del punto', () => {
    for (const id of ids) {
      const r = new Race(real(id), { ...opts, bots: 0, laps: 3, fault: { lap: 1, s: 1000, f: 0 } });
      drive(r, (x) => x.dist(x.player) >= 1100 || x.player.fuse[0]);
      expect(r.player.fuse[0], id).toBe(true);
      expect(Math.abs(r.dist(r.player) - 1000), id).toBeLessThan(10);
    }
  });
});

describe('determinismo y nafta en la meta', () => {
  it('misma semilla, mismo orden: 3 bots, fallas al azar más la programada', () => {
    const o = { ...opts, bots: 3, faults: true, seed: 5, start: { tyre: 60 }, fault: { lap: 1, s: 300, f: 2 } };
    const a = drive(new Race(track, o)), b = drive(new Race(track, o));
    const fins = (r: Race): (number | null)[] => r.cars.map((c) => c.fin);
    expect(a.order().map((c) => a.cars.indexOf(c))).toEqual(b.order().map((c) => b.cars.indexOf(c)));
    expect(fins(a)).toEqual(fins(b));
    expect(a.fuelEnd).toBe(b.fuelEnd);
  });

  it('fuelEnd es la nafta al cruzar la meta y no baja después', () => {
    const r = new Race(track, { ...opts, laps: 1, bots: 0 });
    expect(r.fuelEnd).toBeNull();
    drive(r);
    expect(r.phase).toBe('done');
    expect(r.fuelEnd).toBe(r.player.fuel);
    expect(r.fuelEnd).toBeGreaterThan(0);
    const fin = r.fuelEnd as number;
    for (let i = 0; i < 200; i++) r.step(0.02, 1, ctl);
    expect(r.player.fuel).toBeLessThan(fin);
    expect(r.fuelEnd).toBe(fin);
  });
});

describe('marca de macro', () => {
  const evs = (r: Race): string[] => (r.player.tel.ev ?? []).map((e) => `${e.k}:${e.v}`);

  it('en la grilla no hace nada', () => {
    const r = new Race(track, opts);
    r.mark('macro', 1);
    r.start();
    r.mark('macro', 1);
    expect(r.player.laps).toBe(-1);
    expect(evs(r)).toEqual([]);
  });

  it('deja una marca por aplicación, en la vuelta en curso', () => {
    const r = new Race(track, opts);
    r.start();
    for (let i = 0; i < 2000 && r.player.laps < 0; i++) r.step(0.02, 1, ctl);
    expect(r.player.laps).toBe(0);
    r.mark('macro', 1);
    r.mark('macro', 0);
    const e = r.player.tel.ev!;
    expect(evs(r)).toEqual(['macro:1', 'macro:0']);
    expect(e[0].s).toBeCloseTo(r.player.s, 6);
    expect(e[0].t).toBeCloseTo(r.t - r.player.lapT0, 6);
    for (let i = 0; i < 20000 && r.player.laps < 1; i++) r.step(0.02, 1, ctl);
    expect(r.player.hist[0].ev).toHaveLength(2);
    expect(evs(r)).toEqual([]);
  });

  it('pasada la meta no hace nada', () => {
    const r = drive(new Race(track, { ...opts, laps: 1, bots: 0 }));
    expect(r.player.done).toBe(true);
    const before = [r.player.tel.ev!.length, r.player.hist[0].ev!.length];
    r.mark('macro', 1);
    expect([r.player.tel.ev!.length, r.player.hist[0].ev!.length]).toEqual(before);
  });
});

describe('nombres de los bots', () => {
  it('se llaman como su perfil, también con uno solo', () => {
    expect(new Race(track, opts).names()).toEqual(['Vos', botProfile(0).name]);
    const r = new Race(track, { ...opts, bots: 4 });
    expect(r.names().slice(1)).toEqual([0, 1, 2, 3].map((i) => BOT_PROFILES[i].name));
  });

  it('las etiquetas usan el nombre de pila; vos y los remotos, como siempre', () => {
    const r = new Race(track, { ...opts, bots: 6 });
    r.start();
    for (let i = 0; i < 1500; i++) r.step(0.02, 1, { ...ctl, lim: true });
    r.snap('x', 'Ana', snapOf);
    const tags = r.tags(), bots = tags.slice(1, 7);
    expect(tags[0]).toBe('Vos');
    expect(tags.at(-1)).toBe('Ana');
    bots.forEach((t, i) => { if (t) expect(t).toBe(botProfile(i).tag); });
    expect(bots.filter(Boolean).length).toBeGreaterThan(0);
    expect(bots.every((t) => !t.includes(' '))).toBe(true);
  });

  it('la tabla trae el rasgo del bot y vacío para vos y para los remotos', () => {
    const r = new Race(track, { ...opts, bots: 3 });
    r.snap('x', 'Ana', snapOf);
    const rows = r.standings();
    expect(rows).toHaveLength(5);
    expect(rows.find((x) => x.me)?.trait).toBe('');
    expect(rows.find((x) => x.name === 'Ana')?.trait).toBe('');
    BOT_PROFILES.slice(0, 3).forEach((p) => expect(rows.find((x) => x.name === p.name)?.trait).toBe(p.trait));
  });
});

describe('evaluate', () => {
  const sc = (win: Scenario['win']): Scenario => ({ ...CHALLENGES[0], win });
  /** Carrera de dos autos terminada a mano: vos en `me`, el bot en `bot` (null: sin terminar). */
  function finished(me: number | null, bot: number | null): Race {
    const r = new Race(track, opts);
    const set = (c: Race['player'], fin: number | null): void => { c.done = fin !== null; c.fin = fin; };
    set(r.player, me);
    set(r.bots[0], bot);
    return r;
  }

  it('ahead: delante, detrás y sin terminar', () => {
    const win = sc([{ kind: 'ahead' }]);
    expect(evaluate(win, finished(100, 101.44))).toEqual({ ok: true, lines: ['Llegaste delante del bot por 1,4 s'], failed: null });
    const b = evaluate(win, finished(100, 98.6));
    expect(b.ok).toBe(false);
    expect(b.lines).toEqual(['Llegaste detrás del bot por 1,4 s']);
    expect(b.failed).toBe(win.win[0]);
    expect(evaluate(win, finished(null, 98.6))).toMatchObject({ ok: false, lines: ['No llegaste a la meta'] });
  });

  it('cool: el renglón y el veredicto usan el mismo número', () => {
    const win = sc([{ kind: 'cool', max: 100 }]), r = finished(100, 101);
    r.player.tmax = 99.92;
    expect(evaluate(win, r)).toMatchObject({ ok: true, lines: ['El motor llegó a 99°, el tope era 100°'] });
    r.player.tmax = 100.4;
    expect(evaluate(win, r)).toMatchObject({ ok: false, lines: ['El motor llegó a 100°, el tope era 100°'] });
  });

  it('notDry: con nafta, justa, seca y sin llegar', () => {
    const win = sc([{ kind: 'notDry' }]), r = finished(100, 101);
    expect(evaluate(win, r)).toMatchObject({ ok: false, lines: ['No llegaste a la meta'] });
    r.fuelEnd = 1.234;
    expect(evaluate(win, r)).toMatchObject({ ok: true, lines: ['Te sobraron 1,2 kg de nafta'] });
    r.fuelEnd = 0.01;
    expect(evaluate(win, r)).toMatchObject({ ok: true, lines: ['Llegaste con la nafta justa'] });
    r.fuelEnd = 0;
    expect(evaluate(win, r)).toMatchObject({ ok: false, lines: ['Te quedaste sin nafta antes de la meta'] });
  });

  it('tyreAbove: el renglón y el veredicto usan el mismo número', () => {
    const win = sc([{ kind: 'tyreAbove', min: 12 }]), r = finished(100, 101);
    r.player.tyre = 12.4;
    expect(evaluate(win, r)).toMatchObject({ ok: false, lines: ['Las gomas terminaron en 12 %, el piso era 12 %'] });
    r.player.tyre = 13.1;
    expect(evaluate(win, r)).toMatchObject({ ok: true, lines: ['Las gomas terminaron en 13 %, el piso era 12 %'] });
  });

  it('failed es el primero que falló, el mismo objeto de win; lines sigue el orden de win', () => {
    const win = sc([{ kind: 'ahead' }, { kind: 'cool', max: 100 }, { kind: 'tyreAbove', min: 12 }]), r = finished(100, 101);
    r.player.tmax = 100.2;
    r.player.tyre = 5;
    const o = evaluate(win, r);
    expect(o.ok).toBe(false);
    expect(o.failed).toBe(win.win[1]);
    expect(o.lines).toHaveLength(3);
    expect(o.lines[0].startsWith('Llegaste delante')).toBe(true);
  });

  it('sin terminar no gana ningún desafío', () => {
    const r = new Race(track, opts);
    for (const c of CHALLENGES) {
      const o = evaluate(c, r);
      expect(o.ok, c.id).toBe(false);
      expect(o.failed, c.id).toBe(c.win[0]);
    }
  });
});

describe('persecución', () => {
  const N = 100, LEN = N * 10;
  /** Vuelta de 60 s con la velocidad que sube y baja. */
  const ref: Lap = (() => {
    const dt = Array.from({ length: N }, (_, k) => 1 + 0.3 * Math.sin(k / 5)), sum = dt.reduce((a, b) => a + b, 0), tt: number[] = [];
    let acc = 0;
    for (const d of dt) { tt.push(acc); acc += (d * 60) / sum; }
    return { t: 60, tt, v: new Array<number>(N).fill(LEN / 60) };
  })();

  it('ref.t 60, 3 vueltas, ventaja 6: el fantasma llega a los 174 s', () => {
    const win = chaseResult(ref, 173.9, 3, 6), tie = chaseResult(ref, 174, 3, 6);
    expect(win.ghost).toBe(174);
    expect(win.won).toBe(true);
    expect(win.margin).toBeCloseTo(0.1, 9);
    expect(tie).toEqual({ won: false, margin: 0, ghost: 174 });
    expect(chaseResult(ref, 175, 3, 6).won).toBe(false);
  });

  it('chaseS arranca ventaja segundos adelante, llega a len en ref.t − ventaja, no baja y no pasa del tope', () => {
    expect(chaseS(ref, 0, 6, LEN)).toBe(ghostS(ref, 6, LEN));
    expect(Math.abs(chaseS(ref, ref.t - 6, 6, LEN) - LEN)).toBeLessThanOrEqual(1);
    for (const head of HEAD_STARTS) {
      let prev = -1;
      for (let t = 0; t <= 4 * ref.t; t += 0.1) {
        const s = chaseS(ref, t, head, LEN, 3);
        expect(s).toBeGreaterThanOrEqual(prev);
        expect(s).toBeLessThanOrEqual(3 * LEN);
        prev = s;
      }
      expect(chaseS(ref, 1000, head, LEN, 3)).toBe(3 * LEN);
    }
    expect(chaseS(ref, 1000, 6, LEN)).toBeGreaterThan(3 * LEN);
  });

  it('chaseDelta: la ventaja en la grilla, constante al mismo ritmo y −margen en la meta', () => {
    expect(chaseDelta(ref, 0, -6, 6, LEN)).toBe(6);
    expect(chaseDelta(ref, 0, 0, 10, LEN)).toBe(10);
    for (const k of [0, 1, 2]) {
      for (const s of [50, 300, 777]) expect(chaseDelta(ref, k * ref.t + timeAt(ref, s, LEN), k * LEN + s, 6, LEN)).toBeCloseTo(6, 9);
    }
    const r = chaseResult(ref, 171, 3, 6);
    expect(chaseDelta(ref, 171, 3 * LEN, 6, LEN)).toBeCloseTo(-r.margin, 9);
  });
});

describe('desafíos: datos', () => {
  const trackIds = (catalog as { id: string }[]).map((c) => c.id);

  it('ids únicos, circuito del catálogo, versión de las reglas y títulos cortos', () => {
    expect(new Set(CHALLENGES.map((c) => c.id)).size).toBe(CHALLENGES.length);
    expect(CHALLENGES).toHaveLength(4);
    for (const c of CHALLENGES) {
      expect(trackIds, c.id).toContain(c.track);
      expect(c.ver, c.id).toBe(SIM_VER);
      expect(c.title.length, c.id).toBeLessThanOrEqual(16);
      expect(c.win.length, c.id).toBeGreaterThan(0);
      expect(c.bots, c.id).toBe(1);
      expect(c.faults, c.id).toBe(false);
      expect(c.difficulty, c.id).toBe('normal');
    }
  });

  it('start en rango, falla dentro de las vueltas y textos sin exclamación', () => {
    for (const c of CHALLENGES) {
      const { bat = 50, temp = 80, tyre = 100, fuel = 1 } = c.start;
      expect(bat, c.id).toBeGreaterThanOrEqual(0);
      expect(bat, c.id).toBeLessThanOrEqual(100);
      expect(temp, c.id).toBeGreaterThanOrEqual(START.TEMP - 20);
      expect(temp, c.id).toBeLessThan(PHYS.TEMP_LIMIT);
      expect(tyre, c.id).toBeGreaterThan(0);
      expect(tyre, c.id).toBeLessThanOrEqual(100);
      expect(fuel, c.id).toBeGreaterThan(0);
      expect(fuel, c.id).toBeLessThanOrEqual(1);
      if (c.fault) {
        expect(c.fault.lap, c.id).toBeGreaterThanOrEqual(1);
        expect(c.fault.lap, c.id).toBeLessThanOrEqual(c.laps);
        expect([0, 1, 2], c.id).toContain(c.fault.f);
      }
      for (const t of [c.title, c.context, c.goal]) expect(t, c.id).not.toMatch(/[!¡]/);
    }
  });

  it('los textos dicen los números del escenario', () => {
    const [last, hot, fuse, tyre] = CHALLENGES;
    expect(last.context).toContain(`${last.start.bat} %`);
    expect(hot.title).toBe(`No pases de ${PHYS.TEMP_LIMIT}°`);
    expect(hot.context).toContain(`${hot.start.temp}°`);
    expect(hot.context).toContain(`${hot.laps} vueltas`);
    expect(fuse.context).toContain(`${fuse.fault!.s} m`);
    expect(tyre.context).toContain(`${tyre.start.tyre} %`);
    expect(tyre.context).toContain(`${tyre.laps} vueltas`);
  });

  it('scenarioOpts arma las opciones de carrera del escenario', () => {
    const sc = CHALLENGES[2], o = scenarioOpts(sc);
    expect(o).toEqual({ laps: sc.laps, difficulty: 'normal', bots: 1, faults: false, seed: sc.seed, start: sc.start, fault: sc.fault });
  });
});

describe.skipIf(!CHALLENGES.every((c) => files[file(c.track)]))('desafíos: se ganan con el ideal y no con la consola fija', () => {
  /** Corre el desafío hasta que cruzan todos; evalúa con el jugador en la meta. */
  function play(sc: Scenario, who: 'ideal' | 'fija'): { r: Race; out: ReturnType<typeof evaluate>; lead: number } {
    const tr = real(sc.track), r = new Race(tr, { ...scenarioOpts(sc), trail: false });
    const make = (x: Race): Controls => (who === 'ideal' ? botControls(x.player, tr, x.t, PLAYERS.ideal, 5, sc.laps) : FIXED);
    r.start();
    let out = null as ReturnType<typeof evaluate> | null;
    for (let i = 0; i < 400000 && !r.cars.every((c) => c.done); i++) {
      r.step(0.04, 1, make(r));
      if (!out && r.phase === 'done') out = evaluate(sc, r);
    }
    return { r, out: out!, lead: (r.bots[0].fin as number) - (r.player.fin as number) };
  }

  it.each(CHALLENGES.map((c) => [c.id, c] as const))('%s', (_id, sc) => {
    const best = play(sc, 'ideal'), fixed = play(sc, 'fija');
    const p = best.r.player, f = fixed.r.player;
    console.log(`${sc.id} · ideal: ${best.out.lines.join(' | ')} · ventaja exacta ${best.lead.toFixed(2)} s · tmax ${p.tmax.toFixed(2)} · gomas ${p.tyre.toFixed(1)} · nafta ${best.r.fuelEnd?.toFixed(2)}`);
    console.log(`${sc.id} · consola fija: ${fixed.out.lines.join(' | ')} · ventaja exacta ${fixed.lead.toFixed(2)} s · tmax ${f.tmax.toFixed(2)} · gomas ${f.tyre.toFixed(1)} · nafta ${fixed.r.fuelEnd?.toFixed(2)}`);
    expect(best.out.ok, best.out.lines.join(' | ')).toBe(true);
    expect(fixed.out.ok, fixed.out.lines.join(' | ')).toBe(false);
    // Márgenes: ni el ideal gana de casualidad ni la consola fija pierde por un pelo.
    expect(best.lead).toBeGreaterThan(0.3);
    expect(fixed.lead).toBeLessThan(-0.3);
    for (const w of sc.win) {
      if (w.kind === 'cool') expect(p.tmax).toBeLessThanOrEqual(99.95);
      if (w.kind === 'tyreAbove') expect(p.tyre).toBeGreaterThanOrEqual(w.min + 2);
      // El ideal gasta toda la holgura en push y llega justo; yendo en normal (la consola fija) sobra nafta.
      if (w.kind === 'notDry') expect(fixed.r.fuelEnd as number).toBeGreaterThan(0.2);
    }
  });

  it('la falla cae dentro del circuito', () => {
    for (const sc of CHALLENGES) {
      if (!sc.fault) continue;
      expect(sc.fault.s, sc.id).toBeGreaterThan(0);
      expect(sc.fault.s, sc.id).toBeLessThan(real(sc.track).len);
    }
  });
});
