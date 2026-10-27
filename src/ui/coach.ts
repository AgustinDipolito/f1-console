import { FUSED, effective } from '../sim/car';
import { PHYS } from '../sim/physics';
import { deficits, wantOf, type Knob } from '../sim/score';
import type { Controls, Seg } from '../sim/types';
import { KNOB_LABEL, KNOB_NAMES, SEG_NAMES, cap } from './format';

/**
 * Lo que mira el comentarista en cada paso: el tramo, lo que pide la consola y el estado del auto. bal: balance que piden las frenadas.
 * soon: ya se ve el tramo siguiente (la anticipación de los LEDs); ahí preparar la consola no se avisa como error.
 */
export interface Sample { ty: Seg; ctl: Controls; fuse: boolean[]; bat: number; bal: number; temp: number; soon?: boolean }
export interface Line { text: string; good: boolean; info?: boolean }

/** Puntaje promedio del tramo a partir del cual se da por bien hecho: deja pasar el tiempo de reacción en un tramo corto. */
export const GOOD = 0.95;
/** Segundos de carrera dentro del tramo antes de avisar lo que sigue mal: el tiempo de mirar y mover el control. */
export const WARN = 1.5;
/** El motor vuelve a contar como frío unos grados debajo del límite: así un motor justo en 100° no avisa en cada paso. */
const COOL = 3;
const NICE: Record<Seg, string> = { s: 'Recta a fondo', b: 'Frenada justa', c: 'Curva limpia', x: 'Buena salida' };

const label = (k: Knob): string => (k === 'bal' ? 'balance' : KNOB_LABEL[k]);
const valueName = (k: Knob, v: number): string => (k === 'bal' ? `${v} %` : KNOB_NAMES[k][v]);

interface Open { ty: Seg; t: number; sc: number; def: Partial<Record<Knob, number>>; last: Sample; warned: boolean }

/** Qué salió mal en el tramo: el control que más costó y por qué (fusible, attack sin carga, tarde, antes de tiempo o en otro valor). */
function why(s: Open, next: Seg): string {
  const k = (Object.entries(s.def) as [Knob, number][]).sort((a, b) => b[1] - a[1])[0][0];
  const x = s.last, head = cap(SEG_NAMES[s.ty]), f = FUSED.indexOf(k as (typeof FUSED)[number]);
  if (f >= 0 && x.fuse[f]) return `${head}: ${label(k)} trabado por el fusible`;
  if (k === 'ers' && x.ctl.ers === 2 && x.bat < 1) return `${head}: attack sin carga no empuja`;
  const want = wantOf(s.ty, k, x.bal) as number, v = x.ctl[k] as number;
  if (v === want) return `${head}: ${label(k)} tarde`;
  if (wantOf(next, k, x.bal) === v) return `${head}: ${label(k)} antes de tiempo`;
  return `${head}: ${label(k)} pedía ${valueName(k, want)}`;
}

/**
 * Comentarios cortos de lo que vas haciendo, uno por tramo, el más nuevo primero. Mide en tiempo de carrera lo mismo que el
 * puntaje (`deficits`). Lo que sigue mal a WARN segundos de entrar al tramo se dice en el momento; al salir, un tramo bien hecho
 * suma a la racha y uno flojo que no se avisó nombra el control que más costó (tarde, antes de tiempo).
 */
export class Coach {
  lines: Line[] = [];
  private seg: Open | null = null;
  private streak = 0;
  private hot = false;

  constructor(private readonly keep = 3) {}

  reset(): void { this.lines = []; this.seg = null; this.streak = 0; this.hot = false; }

  /** Un paso de dt segundos de carrera con el auto corriendo. */
  step(x: Sample, dt: number): void {
    if (dt <= 0) return;
    if (this.seg && this.seg.ty !== x.ty) this.close(x.ty);
    this.heat(x.temp);
    const s = this.seg ??= { ty: x.ty, t: 0, sc: 0, def: {}, last: x, warned: false };
    const d = deficits(x.ty, effective(x.ctl, x.fuse), x.bat, x.bal), vals = Object.values(d);
    s.t += dt;
    s.sc += (1 - vals.reduce((a, v) => a + v, 0) / vals.length) * dt;
    for (const [k, v] of Object.entries(d) as [Knob, number][]) s.def[k] = (s.def[k] ?? 0) + v * dt;
    s.last = x;
    if (s.warned || s.t < WARN || x.soon || vals.every((v) => v === 0)) return;
    // Con lo que falta ahora, no con lo acumulado: el control que hay que mover es el que sigue mal.
    s.warned = true;
    this.streak = 0;
    this.say(why({ ...s, def: d }, s.ty), false);
  }

  private close(next: Seg): void {
    const s = this.seg as Open;
    this.seg = null;
    if (s.sc / s.t >= GOOD) { this.streak++; this.say(this.streak > 1 ? `${NICE[s.ty]} · ${this.streak} al hilo` : NICE[s.ty], true, this.streak > 1); return; }
    this.streak = 0;
    if (!s.warned) this.say(why(s, next), false);
  }

  /** Un aviso sin tono (un macro aplicado): va primero y no toca la racha. */
  note(text: string): void { this.lines = [{ text, good: false, info: true }, ...this.lines].slice(0, this.keep); }

  private heat(temp: number): void {
    if (temp >= PHYS.TEMP_LIMIT && !this.hot) { this.hot = true; this.say('Motor caliente: bajá la potencia', false); }
    else if (temp < PHYS.TEMP_LIMIT - COOL) this.hot = false;
  }

  /** La racha reemplaza su propio renglón en vez de llenar el registro de «bien». */
  private say(text: string, good: boolean, replace = false): void {
    if (replace && this.lines[0]?.good) this.lines[0] = { text, good };
    else this.lines = [{ text, good }, ...this.lines].slice(0, this.keep);
  }
}
