import { describe, expect, it } from 'vitest';
import { buildTrack } from '../src/tracks/build';
import { Race } from '../src/sim/race';
import { balWant, idx } from '../src/sim/car';
import { compareLaps } from '../src/sim/compare';
import { PHYS, SIM_VER } from '../src/sim/physics';
import { IDEAL_BAL, WANTS } from '../src/sim/score';
import { SM_DS, TEL_DS, categoryKey, categoryOf, categoryText, controlsAt, evAt, sameCategory, smAt } from '../src/sim/telemetry';
import type { Car, Controls, Lap, Seg, Track, Vec2 } from '../src/sim/types';

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
/** Lo que pide el tramo, perfecto y sin retraso. */
const wanted = (ty: Seg, c: Car): Controls => {
  const w = WANTS[ty];
  return ctl({ lev: w.lev?.[0] ?? 1, ers: w.ers?.[0] ?? 1, bal: c ? balWant(c) : IDEAL_BAL, dif: w.dif?.[0] ?? 1, eb: w.eb?.[0] ?? 1 });
};

/** Corre `laps` vueltas con la consola que dice `ctlFor` (se la llama antes de cada paso de 20 ms). */
function run(laps: number, ctlFor: (r: Race, i: number) => Controls, bots = 0): Race {
  const r = new Race(track, { laps, difficulty: 'normal', trail: false, bots, faults: false });
  r.start();
  for (let i = 0; i < 200000 && !r.cars.every((c) => c.done); i++) r.step(0.02, 1, ctlFor(r, i));
  return r;
}

/** Consola según dónde está el auto: ctl(s) en la primera vuelta y la misma de la última posición después. */
const byS = (f: (s: number) => Partial<Controls>) => (r: Race): Controls => {
  const p = r.player;
  return ctl(p.laps < 0 ? {} : f(p.laps === 0 ? p.s : track.len - 1));
};

describe('versión de las reglas', () => {
  it('SIM_VER está exportada y vale 1', () => {
    // Al subirla hay que rehacer la calibración y los desafíos: este test obliga a mirarlos.
    expect(SIM_VER).toBe(1);
  });
});

describe('eventos', () => {
  it('una vuelta con tres cambios tiene tres eventos, en orden y donde se hicieron', () => {
    const r = run(3, byS((s) => ({ lev: s >= 100 ? 2 : 1, ers: s >= 300 ? 2 : 1, dif: s >= 500 ? 0 : 1 })));
    const ev = r.player.hist[0].ev ?? [];
    expect(ev.map((e) => e.k)).toEqual(['lev', 'ers', 'dif']);
    expect(ev.map((e) => e.v)).toEqual([2, 2, 0]);
    [100, 300, 500].forEach((s, i) => expect(Math.abs(ev[i].s - s)).toBeLessThan(2));
    expect(ev[0].t).toBeLessThan(ev[1].t);
    expect(ev[1].t).toBeLessThan(ev[2].t);
  });

  it('un paso sin cambios no agrega eventos y la consola de la vuelta siguiente es la de la anterior', () => {
    const r = run(3, byS((s) => ({ lev: s >= 100 ? 2 : 1, ers: s >= 300 ? 2 : 1, dif: s >= 500 ? 0 : 1 })));
    const [l0, l1] = r.player.hist;
    expect(l1.ev).toEqual([]);
    expect(l1.c0).toEqual({ lev: 2, ers: 2, bal: 56, dif: 0, eb: 1, lim: 0 });
    expect(l0.c0).toEqual({ lev: 1, ers: 1, bal: 56, dif: 1, eb: 1, lim: 0 });
  });

  it('cada toque de BB es un evento', () => {
    let n = 0;
    const r = run(2, (r0) => {
      if (r0.player.laps === 0 && r0.player.s > 200) n++;
      return ctl({ bal: n === 0 ? 56 : n === 1 ? 57 : 58 });
    });
    const bal = (r.player.hist[0].ev ?? []).filter((e) => e.k === 'bal');
    expect(bal.map((e) => e.v)).toEqual([57, 58]);
  });

  it('cada pulsación de fusible es un evento con su índice', () => {
    const r = run(2, (r0) => ctl({ rst: r0.player.laps === 0 && r0.player.s > 200 ? [0, 1, 0] : [0, 0, 0] }));
    const ev = r.player.hist[0].ev ?? [];
    expect(ev.filter((e) => e.k === 'rst').map((e) => e.v)).toEqual([1]);
  });

  it('el limitador se registra como 0 o 1', () => {
    const r = run(2, (r0) => ctl({ lim: r0.player.laps === 0 && r0.player.s > 400 }));
    expect((r.player.hist[0].ev ?? []).map((e) => [e.k, e.v])).toEqual([['lim', 1]]);
  });

  it('en la grilla no se registra y c0 guarda la consola de la línea', () => {
    // Cuenta con potencia 0 y largada con 2: nada de eso es un evento de la vuelta, pero c0 lo recuerda.
    const r = run(2, (r0) => ctl({ lev: r0.phase === 'run' ? 2 : 0 }));
    const l = r.player.hist[0];
    expect((l.ev ?? []).filter((e) => e.k === 'lev')).toEqual([]);
    expect(l.c0?.lev).toBe(2);
  });

  it('los eventos tienen tope: uno por registro', () => {
    const r = run(2, (r0, i) => ctl({ dif: i % 2 }));
    expect(r.player.hist[0].ev?.length).toBe(r.player.hist[0].tt.length);
  });

  it('con un bot, toda vuelta de todo auto respeta el tope', () => {
    const r = run(2, (r0) => wanted(track.ty[idx(track, r0.player.s)], r0.player), 1);
    for (const c of r.cars) for (const l of [...c.hist, c.tel]) expect(l.ev?.length ?? 0).toBeLessThanOrEqual(l.tt.length);
  });

  it('el balance del bot se registra entero', () => {
    const r = run(3, () => ctl(), 1);
    const bal = r.bots[0].hist.flatMap((l) => l.ev ?? []).filter((e) => e.k === 'bal');
    expect(bal.length).toBeGreaterThan(0);
    bal.forEach((e) => expect(Number.isInteger(e.v)).toBe(true));
  });
});

describe('muestras', () => {
  it('una cada 50 m, redondeadas y en rango', () => {
    const r = run(3, (r0) => wanted(track.ty[idx(track, r0.player.s)], r0.player));
    for (const l of r.player.hist) {
      const sm = l.sm ?? [];
      expect(sm.length).toBe(Math.ceil(track.len / SM_DS));
      for (const m of sm) {
        expect(Number.isInteger(m.bat) && m.bat >= 0 && m.bat <= 100).toBe(true);
        expect(Number.isInteger(m.tyre) && m.tyre >= 0 && m.tyre <= 100).toBe(true);
        expect(Number.isInteger(m.temp) && m.temp >= 60 && m.temp <= 120).toBe(true);
        expect(m.fuel).toBeGreaterThanOrEqual(0);
        expect(m.fuel).toBeLessThanOrEqual(r.player.fuel0);
        expect(Math.round(m.fuel * 10) / 10).toBe(m.fuel);
      }
    }
  });

  it('también las toman los bots, sin caja negra', () => {
    const r = run(2, () => ctl(), 1);
    const l = { ...r.bots[0].hist[0], rec: undefined };
    expect(l.sm?.length).toBe(Math.ceil(track.len / SM_DS));
  });
});

describe('tmax', () => {
  it('sigue el motor desde la largada y no cambia pasada la meta', () => {
    // Push hasta pasar 100°, después eco; terminada la carrera, push otra vez: la temperatura sube y tmax no.
    let hot = false;
    const r = run(3, (r0) => {
      if (r0.player.temp > PHYS.TEMP_LIMIT) hot = true;
      return ctl({ lev: hot ? 0 : 2 });
    });
    const p = r.player;
    expect(p.done).toBe(true);
    const peak = Math.max(...p.hist.flatMap((l) => (l.rec ?? []).map((x) => x.temp)));
    expect(p.tmax).toBeGreaterThan(PHYS.TEMP_LIMIT);
    expect(p.tmax).toBeGreaterThanOrEqual(peak);
    const at = p.tmax;
    for (let i = 0; i < 3000; i++) r.step(0.02, 1, ctl({ lev: 2 }));
    expect(p.temp).toBeGreaterThan(at);
    expect(p.tmax).toBe(at);
  });
});

describe('consola en un punto', () => {
  /** Una vuelta con cambios por todos lados: cada control con su propio período. */
  const busy = (): Lap => {
    const r = run(2, byS((s) => ({
      lev: Math.floor(s / 137) % 3, ers: Math.floor(s / 211) % 3, bal: 50 + (Math.floor(s / 90) % 12),
      dif: Math.floor(s / 173) % 3, eb: Math.floor(s / 251) % 3, lim: Math.floor(s / 301) % 2 === 1,
    })));
    return r.player.hist[0];
  };

  it('controlsAt da lo mismo con caja negra que con c0 y eventos', () => {
    const l = busy(), bare: Lap = { ...l, rec: undefined };
    expect(l.ev?.length).toBeGreaterThan(30);
    let probes = 0;
    for (let k = 0; k < l.tt.length; k++) {
      const s = k * TEL_DS + TEL_DS / 2;
      if ((l.ev ?? []).some((e) => Math.abs(e.s - s) <= TEL_DS)) continue;
      probes++;
      expect(controlsAt(bare, s)).toEqual(controlsAt(l, s));
    }
    expect(probes).toBeGreaterThan(l.tt.length / 3);
  });

  it('sin rec ni c0, controlsAt es null', () => {
    expect(controlsAt({ t: 2, tt: [0, 1], v: [1, 1] }, 5)).toBeNull();
    expect(controlsAt({ t: 2, tt: [0, 1], v: [1, 1], rec: [], ev: [] }, 5)).toBeNull();
  });

  it('evAt corta medio abierto', () => {
    const ev = [10, 20, 30].map((s) => ({ s, t: s / 10, k: 'lev' as const, v: 2 }));
    const l: Lap = { t: 4, tt: [0, 1, 2, 3], v: [1, 1, 1, 1], ev };
    expect(evAt(l, 10, 30).map((e) => e.s)).toEqual([10, 20]);
    expect(evAt(l, 11, 12)).toEqual([]);
    expect(evAt({ t: 1, tt: [0], v: [1] }, 0, 100)).toEqual([]);
  });

  it('smAt da la anterior y no se sale', () => {
    const sm = [1, 2, 3].map((bat) => ({ bat, temp: 90, tyre: 100, fuel: 5 }));
    const l: Lap = { t: 4, tt: [0, 1, 2, 3], v: [1, 1, 1, 1], sm };
    expect(smAt(l, 0)).toBe(sm[0]);
    expect(smAt(l, SM_DS - 0.1)).toBe(sm[0]);
    expect(smAt(l, SM_DS)).toBe(sm[1]);
    expect(smAt(l, 9999)).toBe(sm[2]);
    expect(smAt(l, -5)).toBe(sm[0]);
    expect(smAt({ t: 1, tt: [0], v: [1] }, 10)).toBeNull();
  });
});

describe('categoría', () => {
  it('junta circuito, reglas, vueltas y dificultad', () => {
    const c = categoryOf('ar-1952', 3, 'normal');
    expect(categoryKey(c)).toBe('ar-1952|1|3|normal');
    expect(c.ver).toBe(SIM_VER);
    expect(sameCategory(c, categoryOf('ar-1952', 3, 'normal'))).toBe(true);
    expect(sameCategory(c, categoryOf('ar-1953', 3, 'normal'))).toBe(false);
    expect(sameCategory(c, categoryOf('ar-1952', 5, 'normal'))).toBe(false);
    expect(sameCategory(c, categoryOf('ar-1952', 3, 'hard'))).toBe(false);
    expect(sameCategory(c, { ...c, ver: c.ver + 1 })).toBe(false);
  });

  it('el texto de la categoría', () => {
    expect(categoryText(categoryOf('x', 1, 'easy'))).toBe('1 vuelta · fácil');
    expect(categoryText(categoryOf('x', 3, 'hard'))).toBe('3 vueltas · difícil');
    expect(categoryText(categoryOf('x', 2, 'normal'))).toBe('2 vueltas · normal');
  });
});

describe('comparar vueltas', () => {
  const ideal = (r: Race): Controls => wanted(track.ty[idx(track, r.player.s)], r.player);
  const lapOf = (f: (r: Race) => Controls): Lap => run(2, f).player.hist[0];

  it('dos vueltas idénticas dan 0 en todos los tramos y cubren la vuelta entera', () => {
    const l = lapOf(ideal), segs = compareLaps(track, l, l);
    expect(segs.length).toBeGreaterThan(3);
    segs.forEach((s) => expect(s.gain).toBe(0));
    expect(segs[0].s0).toBe(0);
    expect(segs[segs.length - 1].s1).toBe(track.len);
    segs.slice(1).forEach((s, j) => expect(s.s0).toBe(segs[j].s1));
  });

  it('la suma de los tramos es la diferencia de tiempos', () => {
    const a = lapOf(() => ctl()), b = lapOf(ideal);
    expect(a.tt.every(Number.isFinite) && b.tt.every(Number.isFinite)).toBe(true);
    const sum = compareLaps(track, a, b).reduce((x, s) => x + s.gain, 0);
    expect(a.t - b.t).toBeGreaterThan(0.5);
    expect(Math.abs(sum - (a.t - b.t))).toBeLessThan(1e-9);
  });

  it('un cambio tardío señala ese tramo', () => {
    const base = compareLaps(track, lapOf(ideal), lapOf(ideal));
    const straights = base.filter((s) => s.ty === 's'), long = straights.reduce((m, s) => (s.s1 - s.s0 > m.s1 - m.s0 ? s : m));
    // ERS en attack recién 100 m después de entrar a la recta más larga.
    const late = lapOf((r) => {
      const c = ideal(r), s = r.player.s;
      return s >= long.s0 && s < long.s0 + 100 && r.player.laps === 0 ? { ...c, ers: 1 } : c;
    });
    const segs = compareLaps(track, late, lapOf(ideal));
    const worst = segs.reduce((m, s) => (s.gain > m.gain ? s : m));
    expect(worst.s0).toBe(long.s0);
    expect(worst.gain).toBeGreaterThan(0.01);
  });

  it('cada tramo trae los eventos de cada vuelta y las muestras de la entrada', () => {
    const a = lapOf(byS((s) => ({ lev: Math.floor(s / 200) % 3, ers: Math.floor(s / 300) % 3 })));
    const b = lapOf(ideal), segs = compareLaps(track, a, b);
    expect(segs.flatMap((s) => s.evA)).toEqual(a.ev);
    expect(segs.flatMap((s) => s.evB)).toEqual(b.ev);
    segs.forEach((s) => {
      s.evA.forEach((e) => { expect(e.s).toBeGreaterThanOrEqual(s.s0); expect(e.s).toBeLessThan(s.s1); });
      expect(s.smA).toBe(smAt(a, s.s0));
      expect(s.smB).toBe(smAt(b, s.s0));
    });
    expect(segs.some((s) => s.evA.length > 0)).toBe(true);
  });

  it('vueltas de distinto largo no se comparan', () => {
    const l = lapOf(ideal);
    expect(compareLaps(track, l, { ...l, tt: l.tt.slice(1), v: l.v.slice(1) })).toEqual([]);
  });

  it('un registro vacío no mete NaN', () => {
    const l = lapOf(ideal), holey: Lap = { ...l, tt: l.tt.map((t, k) => (k === 20 ? NaN : t)) };
    compareLaps(track, holey, l).forEach((s) => expect(Number.isFinite(s.gain)).toBe(true));
  });
});
