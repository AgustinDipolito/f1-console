import { describe, expect, it } from 'vitest';
import { buildTrack } from '../src/tracks/build';
import { Race } from '../src/sim/race';
import { botControls } from '../src/bot/bot';
import { compareLaps } from '../src/sim/compare';
import type { Loss } from '../src/sim/diagnose';
import { PHYS } from '../src/sim/physics';
import { SM_DS, TEL_DS } from '../src/sim/telemetry';
import type { Controls, Ev, Lap, Track, Vec2 } from '../src/sim/types';
import { MACROS } from '../src/console/panel';
import { READ, W, chartX, cmpRows, collapse, evText, gainText, kAt, missingNote, miniMap, replayRows, segTitle, stepTo, timeline, timelineSvg, type Mark } from '../src/ui/replay-data';

function oval(): Vec2[] {
  const pts: Vec2[] = [], L = 600, R = 80;
  for (let x = 0; x < L; x += 5) pts.push([x, -R]);
  for (let a = -Math.PI / 2; a < Math.PI / 2; a += 0.05) pts.push([L + Math.cos(a) * R, Math.sin(a) * R]);
  for (let x = L; x > 0; x -= 5) pts.push([x, R]);
  for (let a = Math.PI / 2; a < (3 * Math.PI) / 2; a += 0.05) pts.push([Math.cos(a) * R, Math.sin(a) * R]);
  return pts;
}

const track: Track = buildTrack('oval', 'Óvalo', oval());

/** Una vuelta corrida en esta sesión: con caja negra, eventos y muestras. */
function realLap(): Lap {
  const r = new Race(track, { laps: 2, difficulty: 'hard', trail: false, bots: 0, faults: false, seed: 3 });
  r.start();
  for (let i = 0; i < 100000 && !r.cars.every((c) => c.done); i++) r.step(0.02, 1, botControls(r.player, track, r.t, 'hard', 0, 2));
  return r.player.hist[0];
}

/** Una vuelta con la consola guionada (sin el vaivén del bot): los eventos y la caja negra cuentan la misma historia. */
function scriptedLap(): Lap {
  const ctl = (o: Partial<Controls>): Controls => ({ lev: 1, ers: 1, bal: 56, lim: false, dif: 1, eb: 1, rst: [0, 0, 0], ...o });
  const r = new Race(track, { laps: 2, difficulty: 'normal', trail: false, bots: 0, faults: false, seed: 3 });
  r.start();
  for (let i = 0; i < 100000 && !r.cars.every((c) => c.done); i++) {
    const p = r.player, s = p.laps < 0 ? 0 : p.laps === 0 ? p.s : track.len - 1;
    r.step(0.02, 1, ctl({ lev: s >= 100 ? 2 : 1, ers: s >= 300 ? 2 : 1, dif: s >= 500 ? 0 : 1, bal: s >= 700 ? 57 : 56, lim: s >= 900 && s < 1000 }));
  }
  return r.player.hist[0];
}

const base = realLap();
const n = base.tt.length;
/** Copia que se puede tocar sin afectar a las demás. */
const copy = (l: Lap = base): Lap => structuredClone(l);
/** La misma vuelta sin la caja negra: lo que trae un fantasma de esta versión. */
const noRec = (): Lap => { const l = copy(); delete l.rec; return l; };
const bare = (): Lap => ({ t: base.t, tt: base.tt.slice(), v: base.v.slice() });
const ev = (s: number, k: Ev['k'], v: number): Ev => ({ s, t: 0, k, v });
const count = (marks: Mark[], kind: Mark['kind']): Mark[] => marks.filter((m) => m.kind === kind);
const loss = (s0: number): Loss => ({ cause: 'lev', knob: 'lev', ty: 's', s0, s1: s0 + 50, sec: 0.2, m: 50 });

describe('la vuelta de prueba', () => {
  it('trae caja negra, eventos y muestras', () => {
    expect(n).toBeGreaterThan(100);
    expect(base.rec?.length).toBe(n);
    expect(base.ev?.length).toBeGreaterThan(0);
    expect(base.sm?.length).toBeGreaterThan(0);
  });
});

describe('kAt', () => {
  it('encuentra el registro de su tiempo, llega al último y nunca vuelve atrás', () => {
    const tt = base.tt;
    for (let k = 0; k < n - 1; k++) if (tt[k] < tt[k + 1]) expect(kAt(tt, tt[k], 0)).toBe(k);
    expect(kAt(tt, Infinity, 0)).toBe(n - 1);
    expect(kAt(tt, 0, 30)).toBe(30);
    let k = 0;
    for (let t = 0; t < base.t + 5; t += 0.37) { const next = kAt(tt, t, k); expect(next).toBeGreaterThanOrEqual(k); k = next; }
  });

  it('saltea los registros vacíos', () => {
    const tt = [0, 1, NaN, 3];
    expect(kAt(tt, 1.5, 0)).toBe(1);
    expect(kAt(tt, 3, 0)).toBe(3);
    expect(kAt([0, NaN, NaN], 9, 0)).toBe(0);
  });
});

describe('collapse', () => {
  it('tres BB+ a 5 m dejan uno, con la primera distancia y el último valor', () => {
    const out = collapse([ev(100, 'bal', 57), ev(105, 'bal', 58), ev(110, 'bal', 59)]);
    expect(out).toEqual([{ s: 100, t: 0, k: 'bal', v: 59 }]);
  });

  it('no toca los eventos de entrada y respeta los 20 m', () => {
    const src = [ev(100, 'bal', 57), ev(105, 'bal', 58), ev(125, 'bal', 59), ev(130, 'lev', 2)];
    const out = collapse(src);
    expect(src[0].v).toBe(57);
    expect(out.map((e) => [e.s, e.k, e.v])).toEqual([[100, 'bal', 58], [125, 'bal', 59], [130, 'lev', 2]]);
  });

  it('cada fusible y cada macro es un control aparte', () => {
    expect(collapse([ev(10, 'rst', 0), ev(12, 'rst', 1), ev(14, 'rst', 0)]).map((e) => e.v)).toEqual([0, 1]);
    expect(collapse([ev(10, 'macro', 0), ev(12, 'macro', 1)]).length).toBe(2);
  });
});

describe('timeline', () => {
  const tyOf = (k: number): string => track.ty[Math.floor((k * TEL_DS) / track.ds) % track.n];
  const plain = (): Lap => { const l = copy(); l.rec?.forEach((r) => { r.temp = 80; r.fuse = [false, false, false]; }); return l; };

  it('una marca seg por tramo', () => {
    let runs = 1;
    for (let k = 1; k < n; k++) if (tyOf(k) !== tyOf(k - 1)) runs++;
    const segs = count(timeline(track, base, []), 'seg');
    expect(segs.length).toBe(runs);
    expect(segs[0].k).toBe(0);
  });

  it('un motor sobre el límite en los registros 50 a 60 es una marca hot de 50 a 60', () => {
    const l = plain();
    expect(count(timeline(track, l, []), 'hot')).toEqual([]);
    for (let k = 50; k <= 60; k++) (l.rec as NonNullable<Lap['rec']>)[k].temp = PHYS.TEMP_LIMIT + 5;
    expect(count(timeline(track, l, []), 'hot')).toEqual([{ k: 50, kind: 'hot', to: 60 }]);
  });

  it('sin caja negra el motor caliente sale de las muestras', () => {
    const l = noRec();
    (l.sm as NonNullable<Lap['sm']>).forEach((m) => { m.temp = 80; });
    (l.sm as NonNullable<Lap['sm']>)[4].temp = 120;
    const per = SM_DS / TEL_DS;
    expect(count(timeline(track, l, []), 'hot')).toEqual([{ k: 4 * per, kind: 'hot', to: 5 * per - 1 }]);
  });

  it('un fusible que salta en el registro 80 es una marca fuse en 80', () => {
    const l = plain();
    expect(count(timeline(track, l, []), 'fuse')).toEqual([]);
    (l.rec as NonNullable<Lap['rec']>).forEach((r, k) => { if (k >= 80) r.fuse = [true, false, false]; });
    expect(count(timeline(track, l, []), 'fuse')).toEqual([{ k: 80, kind: 'fuse' }]);
  });

  it('una marca ctl por cada evento juntado y una macro por cada macro', () => {
    const l = copy();
    l.ev = [ev(100, 'lev', 2), ev(300, 'ers', 2), ev(305, 'ers', 0), ev(600, 'macro', 0), ev(900, 'rst', 1)];
    const marks = timeline(track, l, []);
    expect(count(marks, 'ctl').map((m) => m.k)).toEqual([10, 30, 90]);
    expect(count(marks, 'macro').map((m) => m.k)).toEqual([60]);
  });

  it('con los eventos reales hay una ctl por registro con evento juntado', () => {
    const ks = new Set(collapse(base.ev ?? []).filter((e) => e.k !== 'macro').map((e) => Math.min(n - 1, Math.floor(e.s / TEL_DS))));
    expect(count(timeline(track, base, []), 'ctl').length).toBe(ks.size);
  });

  it('una marca por pérdida, y dos del mismo lugar quedan en una', () => {
    expect(count(timeline(track, base, [loss(200), loss(400)]), 'loss').map((m) => m.k)).toEqual([20, 40]);
    expect(count(timeline(track, base, [loss(200), loss(205)]), 'loss').length).toBe(1);
  });

  it('sale ordenada por registro', () => {
    const ks = timeline(track, base, [loss(200)]).map((m) => m.k);
    expect(ks).toEqual([...ks].sort((a, b) => a - b));
  });

  it('una vuelta vieja solo tiene tramos', () => {
    expect(timeline(track, bare(), []).every((m) => m.kind === 'seg')).toBe(true);
  });
});

describe('stepTo', () => {
  const marks: Mark[] = [{ k: 0, kind: 'seg' }, { k: 10, kind: 'ctl' }, { k: 20, kind: 'seg' }, { k: 20, kind: 'loss' }, { k: 30, kind: 'seg' }, { k: 40, kind: 'macro' }];

  it('salta de evento en evento sin parar en los inicios de tramo', () => {
    expect(stepTo(marks, 0, 1)).toBe(10);
    expect(stepTo(marks, 10, 1)).toBe(20);
    expect(stepTo(marks, 20, 1)).toBe(40);
    expect(stepTo(marks, 40, -1)).toBe(20);
    expect(stepTo(marks, 25, -1)).toBe(20);
    expect(stepTo(marks, 11, -1)).toBe(10);
  });

  it('en las puntas queda en el lugar', () => {
    expect(stepTo(marks, 40, 1)).toBe(40);
    expect(stepTo(marks, 10, -1)).toBe(10);
    expect(stepTo(marks, 5, -1)).toBe(5);
    expect(stepTo([], 7, 1)).toBe(7);
  });
});

describe('replayRows', () => {
  it('con caja negra no tiene «—» y cada renglón sigue el orden de READ', () => {
    const rows = replayRows(track, base);
    expect(rows.length).toBe(n);
    rows.forEach((r) => expect(r.length).toBe(READ.length));
    expect(rows.flat()).not.toContain('—');
  });

  it('da los formatos del diseño', () => {
    const l = copy(), r = (l.rec as NonNullable<Lap['rec']>)[134];
    Object.assign(r, { lev: 2, ers: 2, bal: 56.4, dif: 1, eb: 2, lim: false, fuse: [true, false, false], bat: 61.6, temp: 97.2, tyre: 88.4, fuel: 21.43 });
    l.v[134] = 287 / 3.6;
    const row = replayRows(track, l)[134], get = (key: string): string => row[READ.findIndex(([k]) => k === key)];
    expect(get('s')).toBe('1,34 km');
    expect(get('t')).toMatch(/^\d:\d\d,\d$/);
    expect(get('v')).toBe('287 km/h');
    expect(get('ty')).toMatch(/^[A-Z]/);
    expect([get('lev'), get('ers'), get('bal'), get('dif'), get('eb'), get('lim')]).toEqual(['Push', 'Attack', '56 %', 'Medio', 'Alto', 'Apagado']);
    expect([get('fuse'), get('bat'), get('temp'), get('tyre'), get('fuel')]).toEqual(['Saltó ERS', '62 %', '97°', '88 %', '21,4 kg']);
  });

  it('limitador y fusibles', () => {
    const l = copy(), rec = l.rec as NonNullable<Lap['rec']>;
    rec[1].lim = true; rec[1].fuse = [false, false, false];
    rec[2].fuse = [false, true, true]; rec[3].fuse = [false, false, true];
    const rows = replayRows(track, l), at = (i: number, key: string): string => rows[i][READ.findIndex(([k]) => k === key)];
    expect([at(1, 'lim'), at(1, 'fuse'), at(2, 'fuse'), at(3, 'fuse')]).toEqual(['Puesto', 'En orden', 'Saltaron 2', 'Saltó freno motor']);
  });

  it('sin caja negra la consola sale de c0 y los eventos, el auto de las muestras y los fusibles quedan en «—»', () => {
    const full = scriptedLap(), l = structuredClone(full);
    delete l.rec;
    const rows = replayRows(track, l), ref = replayRows(track, full), col = (key: string): number => READ.findIndex(([k]) => k === key);
    // Lo único que falta es el fusible.
    expect(rows.every((r) => r.filter((x) => x === '—').length === 1 && r[col('fuse')] === '—')).toBe(true);
    // La consola reconstruida coincide con la de la caja negra salvo en el registro exacto de cada cambio.
    for (const key of ['lev', 'ers', 'bal', 'dif', 'lim']) {
      const same = rows.filter((r, k) => r[col(key)] === ref[k][col(key)]).length;
      expect(same / rows.length, key).toBeGreaterThan(0.95);
    }
  });

  it('sin caja negra ni eventos, consola y auto quedan en «—», la velocidad tiene valor y la nota no está vacía', () => {
    const rows = replayRows(track, bare());
    rows.forEach((r) => {
      expect(r.slice(0, 4)).not.toContain('—');
      expect(r.slice(4)).toEqual(new Array(READ.length - 4).fill('—'));
    });
    expect(missingNote(bare())).not.toBe('');
  });
});

describe('missingNote', () => {
  it('vacía con caja negra; con eventos y muestras dice los 50 m; sin eventos avisa que son de antes', () => {
    expect(missingNote(base)).toBe('');
    expect(missingNote(noRec())).toBe(`Esta vuelta guarda los cambios de la consola y el estado del auto cada ${SM_DS} m. Los fusibles no se ven.`);
    expect(missingNote(bare())).toMatch(/^Esta vuelta es de antes de que se guardaran los comandos/);
  });
});

describe('evText', () => {
  it('escribe cada tipo de evento con la distancia desde el inicio del tramo', () => {
    expect(evText({ s: 1320, t: 0, k: 'lev', v: 2 }, 1200)).toBe('+120 m potencia → push');
    expect(evText(ev(1000, 'ers', 0), 1000)).toBe('+0 m ERS → harvest');
    expect(evText(ev(105, 'dif', 2), 100)).toBe('+5 m diferencial → bloqueado');
    expect(evText(ev(105, 'eb', 1), 100)).toBe('+5 m freno motor → medio');
    expect(evText(ev(112, 'bal', 57), 100)).toBe('+12 m frenos → 57 %');
    expect(evText(ev(130, 'lim', 1), 100)).toBe('+30 m limitador puesto');
    expect(evText(ev(130, 'lim', 0), 100)).toBe('+30 m limitador sacado');
    expect(evText(ev(108, 'rst', 0), 100)).toBe('+8 m rearme del fusible de ERS');
    expect(evText(ev(108, 'rst', 2), 100)).toBe('+8 m rearme del fusible de freno motor');
    expect(evText(ev(100, 'macro', 0), 100)).toBe(`+0 m macro ${MACROS[0].name}`);
    expect(evText(ev(100, 'macro', 1), 100)).toBe('+0 m macro Ahorro');
  });
});

describe('cmpRows', () => {
  const diffs = compareLaps(track, base, base);

  it('la comparación contra sí misma tiene tramos y cada uno dice «Mismos comandos»', () => {
    expect(diffs.length).toBeGreaterThan(2);
    diffs.forEach((d) => expect(cmpRows(d, base, base, 'Juan', 'diff')).toEqual(['Mismos comandos']));
  });

  it('un evento que solo hizo el otro termina en «, vos no»', () => {
    const other = copy(), d = diffs[1];
    other.ev = [...(base.ev ?? []), ev(d.s0 + 5, 'lim', 1)].sort((a, b) => a.s - b.s);
    const rows = cmpRows(compareLaps(track, base, other)[1], base, other, 'Juan', 'diff');
    expect(rows).toEqual(['Limitador puesto: Juan a +5 m, vos no']);
    expect(rows[0].endsWith(', vos no')).toBe(true);
  });

  it('y uno que solo hice yo, en «, Juan no»', () => {
    const other = copy(), d = diffs[1];
    other.ev = (base.ev ?? []).filter((e) => !(e.s >= d.s0 && e.s < d.s1));
    const mine = [...(base.ev ?? []), ev(d.s0 + 40, 'lim', 1)].sort((a, b) => a.s - b.s);
    const me = { ...base, ev: mine };
    expect(cmpRows(compareLaps(track, me, other)[1], me, other, 'Juan', 'diff')).toContain('Limitador puesto: vos a +40 m, Juan no');
  });

  it('el mismo cambio a 10 m o más se lista con las dos distancias, y a menos no', () => {
    const d = { ...diffs[0], evA: [ev(40, 'lev', 0)], evB: [ev(45, 'lev', 0)] };
    expect(cmpRows({ ...d, s0: 0 }, base, base, 'Juan', 'diff')).toEqual(['Mismos comandos']);
    d.evB = [ev(5, 'lev', 0)];
    expect(cmpRows({ ...d, s0: 0 }, base, base, 'Juan', 'diff')).toEqual(['Potencia → eco: vos a +40 m, Juan a +5 m']);
  });

  it('los eventos de cada uno, o «Sin cambios»', () => {
    const d = { ...diffs[0], s0: 100, evA: [ev(120, 'lev', 2), ev(300, 'lim', 1)], evB: [] };
    expect(cmpRows(d, base, base, 'Juan', 'me')).toEqual(['+20 m potencia → push', '+200 m limitador puesto']);
    expect(cmpRows(d, base, base, 'Juan', 'rival')).toEqual(['Sin cambios']);
  });

  it('las diferencias al entrar salen de la consola de cada vuelta antes del tramo', () => {
    const me = copy(), other = copy(), d = diffs[2], cut = Math.floor(d.s0 / TEL_DS);
    (me.rec as NonNullable<Lap['rec']>).forEach((r, k) => { if (k < cut) r.lev = 0; });
    (other.rec as NonNullable<Lap['rec']>).forEach((r, k) => { if (k < cut) r.lev = 2; });
    expect(cmpRows(d, me, other, 'Juan', 'diff')[0]).toBe('Al entrar: potencia, vos en eco y Juan en push');
    // El limitador va sin «en».
    (me.rec as NonNullable<Lap['rec']>)[cut - 1].lim = true;
    expect(cmpRows(d, me, other, 'Juan', 'diff')).toContain('Al entrar: limitador, vos puesto y Juan apagado');
  });

  it('segTitle y gainText', () => {
    expect(segTitle({ ...diffs[0], ty: 'b', s0: 1200 })).toBe('Frenada a 1,2 km');
    expect(gainText(0.4)).toBe('perdés 0,4 s');
    expect(gainText(-0.4)).toBe('ganás 0,4 s');
  });
});

describe('gráfico y línea de tiempo', () => {
  it('chartX va del margen izquierdo al derecho y no se sale', () => {
    expect(chartX(0, 4000)).toBe(44);
    expect(chartX(4000, 4000)).toBe(492);
    expect(chartX(-5, 4000)).toBe(44);
    expect(chartX(9999, 4000)).toBe(492);
    expect(W - 28).toBe(492);
    expect(chartX(0, 0)).toBe(44);
  });

  it('timelineSvg lleva un tl-loss por pérdida y cada marca con su clase', () => {
    const marks = timeline(track, base, [loss(200), loss(400), loss(900)]);
    const svg = timelineSvg(marks, n);
    expect(svg.match(/class="tl-loss"/g)?.length).toBe(3);
    expect(svg.match(/class="tl-seg"/g)?.length).toBe(count(marks, 'seg').length);
    expect(svg.match(/class="tl-ev"/g)?.length).toBe(count(marks, 'ctl').length);
    expect(svg.match(/class="tl-cur"/g)?.length).toBe(1);
    expect(svg).toContain('viewBox="0 0 520 32"');
  });

  it('timelineSvg dibuja motor, macro y fusible', () => {
    const marks: Mark[] = [{ k: 10, kind: 'hot', to: 20 }, { k: 30, kind: 'macro' }, { k: 40, kind: 'fuse' }];
    const svg = timelineSvg(marks, n);
    expect(svg).toMatch(/<rect class="tl-hot" x="[\d.]+" y="1" width="[\d.]+" height="4"\/>/);
    expect(svg).toContain('class="tl-mac"');
    expect(svg).toMatch(/<rect class="tl-fuse"[^>]* width="8" height="8"\/>/);
  });

  it('el cursor arranca en el margen y la marca del último registro cae en el borde derecho', () => {
    expect(timelineSvg([], n)).toContain('<line class="tl-cur" x1="44" x2="44"');
    expect(timelineSvg([{ k: n - 1, kind: 'ctl' }], n)).toContain('<line class="tl-ev" x1="492" x2="492"');
  });
});

describe('miniMap', () => {
  const coords = (s: string): number[] => (s.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

  it('da una posición por registro, adentro del cuadro y con margen', () => {
    const { xy, inner } = miniMap(track, n, []);
    expect(xy.length).toBe(n);
    for (const [x, y] of xy) {
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(200);
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(140);
    }
    const road = coords(inner.match(/d="([^"]+)"/)?.[1] ?? '');
    expect(Math.min(...road)).toBeGreaterThanOrEqual(5);
    expect(inner).toMatch(/^<path class="rp-road" d="M[^"]+Z"\/>/);
  });

  it('el trazado ocupa el cuadro: el óvalo es ancho, entonces llena el ancho', () => {
    const xs = miniMap(track, n, []).xy.map(([x]) => x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(150);
  });

  it('un rombo por pérdida', () => {
    expect(miniMap(track, n, [200, 700]).inner.match(/class="rp-loss"/g)?.length).toBe(2);
    expect(miniMap(track, n, []).inner).not.toContain('rp-loss');
  });

  it('los registros siguen el sentido de marcha: el primero y el siguiente están cerca', () => {
    const { xy } = miniMap(track, n, []);
    expect(Math.hypot(xy[1][0] - xy[0][0], xy[1][1] - xy[0][1])).toBeLessThan(5);
  });
});
