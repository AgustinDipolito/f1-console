import { describe, expect, it } from 'vitest';
import { Coach, type Sample } from '../src/ui/coach';
import type { Controls, Seg } from '../src/sim/types';

/** Consola justa para cada tramo (balance 56 %, el que piden las frenadas con medio tanque). */
const RIGHT: Record<Seg, Partial<Controls>> = {
  s: { lev: 2, ers: 2 },
  b: { ers: 0, bal: 56, eb: 2 },
  c: { lev: 1, ers: 1, dif: 0, eb: 0 },
  x: { lev: 2, dif: 2 },
};
const base: Controls = { lev: 1, ers: 1, bal: 56, lim: false, dif: 1, eb: 1, rst: [0, 0, 0] };
const at = (ty: Seg, ctl: Partial<Controls> = RIGHT[ty], more: Partial<Sample> = {}): Sample =>
  ({ ty, ctl: { ...base, ...ctl }, fuse: [false, false, false], bat: 60, bal: 56, temp: 90, ...more });
/** Corre un tramo de 2 s en pasos de 0,1 s. */
const run = (c: Coach, ...xs: Sample[]): void => { for (const x of xs) for (let i = 0; i < 20; i++) c.step(x, 0.1); };
const texts = (c: Coach): string[] => c.lines.map((l) => l.text);

describe('comentarios bajo el volante', () => {
  it('un tramo bien hecho se dice al salir y la racha usa un solo renglón', () => {
    const c = new Coach();
    run(c, at('s'), at('b'), at('c'), at('x'));
    // La salida sigue abierta: se dice recién al pasar al tramo siguiente.
    expect(c.lines).toEqual([{ text: 'Curva limpia · 3 al hilo', good: true }]);
  });

  it('lo que sigue mal se avisa en el tramo, una sola vez, y al salir no se repite', () => {
    const c = new Coach();
    for (let i = 0; i < 14; i++) c.step(at('c', { ...RIGHT.c, dif: 2 }), 0.1);
    expect(c.lines).toEqual([]);
    c.step(at('c', { ...RIGHT.c, dif: 2 }), 0.1);
    expect(c.lines).toEqual([{ text: 'Curva: diferencial pedía abierto', good: false }]);
    run(c, at('c', { ...RIGHT.c, dif: 2 }), at('s'));
    expect(texts(c)).toEqual(['Curva: diferencial pedía abierto']);
  });

  it('corregido antes del aviso pero con el tramo ya andado, fue tarde', () => {
    const c = new Coach();
    for (let i = 0; i < 10; i++) c.step(at('b', { ...RIGHT.b, eb: 0 }), 0.1);
    run(c, at('b'), at('c'));
    expect(texts(c)[0]).toBe('Frenada: freno motor tarde');
  });

  it('puesto ya para el tramo que viene, fue antes de tiempo', () => {
    const c = new Coach();
    for (let i = 0; i < 15; i++) c.step(at('s'), 0.1);
    for (let i = 0; i < 5; i++) c.step(at('s', { ...RIGHT.s, ers: 0 }, { soon: true }), 0.1);
    run(c, at('b'));
    expect(texts(c)[0]).toBe('Recta: ERS antes de tiempo');
  });

  it('attack sin carga y control trabado por un fusible tienen su propia frase', () => {
    const c = new Coach();
    run(c, at('s', RIGHT.s, { bat: 0 }), at('c', { ...RIGHT.c, dif: 0 }, { fuse: [false, true, false] }), at('s'));
    expect(texts(c)).toEqual(['Curva: diferencial trabado por el fusible', 'Recta: attack sin carga no empuja']);
  });

  it('el motor caliente avisa una vez hasta que vuelve a enfriarse', () => {
    const c = new Coach();
    for (let i = 0; i < 10; i++) c.step(at('s', RIGHT.s, { temp: 101 }), 0.1);
    expect(texts(c)).toEqual(['Motor caliente: bajá la potencia']);
    c.step(at('s', RIGHT.s, { temp: 95 }), 0.1);
    c.step(at('s', RIGHT.s, { temp: 101 }), 0.1);
    expect(texts(c)).toEqual(['Motor caliente: bajá la potencia', 'Motor caliente: bajá la potencia']);
  });

  it('guarda solo los últimos renglones y en pausa (dt 0) no cuenta', () => {
    const c = new Coach(2);
    run(c, at('s', { lev: 0, ers: 2 }), at('b', { ers: 2, bal: 56, eb: 2 }), at('c', { ...RIGHT.c, lev: 2 }), at('x'));
    expect(c.lines).toHaveLength(2);
    c.step(at('s'), 0);
    expect(c.lines).toHaveLength(2);
  });
});
