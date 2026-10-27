import { PHYS } from '../sim/physics';
import type { Seg } from '../sim/types';

/** Qué señal le toca a main en este cuadro: sonido, vibración y destello. Puro: sin DOM ni audio. */
export type Cue = 'fault' | 'warn' | 'phase' | 'good' | 'confirm';
/**
 * Lo que mira en cada cuadro. lap: vueltas cerradas (hist.length). ty y sc: tramo y puntaje de la consola en él.
 * changed: el jugador tocó un control en este cuadro.
 */
export interface FeedbackIn { temp: number; bat: number; fuelLaps: number; fuse: boolean[]; lap: number; done: boolean; green: boolean; ty: Seg; sc: number; changed: boolean }

export const FEEDBACK = {
  /** Silencio de la misma advertencia (s). */ SILENCE: 10,
  /** Motor al límite: dos grados antes de que pierda eficacia. */ HOT: PHYS.TEMP_LIMIT - 2,
  /** Batería baja: la misma lámpara ámbar. */ BAT: PHYS.BAT_LOW,
  /** Nafta corta: yendo en normal no alcanza (fuelLaps < 0). */ FUEL: 0,
  /** Tramo acertado: el mismo corte que el destello de la barra de LEDs (console.ts). */ GOOD: 0.999,
} as const;

type Kind = 'hot' | 'bat' | 'fuel';
const KINDS: Kind[] = ['hot', 'bat', 'fuel'];
/** Qué advertencias tienen la condición prendida. */
const lit = (x: FeedbackIn): Record<Kind, boolean> => ({ hot: x.temp >= FEEDBACK.HOT, bat: x.bat < FEEDBACK.BAT, fuel: x.fuelLaps < FEEDBACK.FUEL });

/** Lo del cuadro anterior de lo que se compara por flanco. */
interface Prev { fuse: boolean[]; lap: number; done: boolean; ty: Seg }
const snap = (x: FeedbackIn): Prev => ({ fuse: x.fuse.slice(), lap: x.lap, done: x.done, ty: x.ty });

const blew = (p: Prev, x: FeedbackIn): boolean => x.fuse.some((f, i) => f && !p.fuse[i]);
const turned = (p: Prev, x: FeedbackIn): boolean => (x.done && !p.done) || x.lap > p.lap;
const scored = (p: Prev, x: FeedbackIn): boolean => x.green && !x.done && x.ty !== p.ty && x.sc >= FEEDBACK.GOOD;

const fresh = <T>(v: T): Record<Kind, T> => ({ hot: v, bat: v, fuel: v });

/**
 * Elige la señal de cada cuadro, a lo sumo una y en este orden: falla, advertencia, vuelta o meta, tramo acertado y confirmación.
 * Falla, meta, vuelta y tramo acertado salen por flanco; la advertencia, por nivel: avisa una vez, se rearma cuando la condición
 * se va y calla SILENCE segundos por tipo. La largada no da señal.
 */
export class Feedback {
  private prev: Prev | null = null;
  private armed = fresh(true);
  private at = fresh(-Infinity);

  /** Carrera nueva: todo vuelve a armarse y el primer cuadro no tiene flancos. */
  reset(): void {
    this.prev = null;
    this.armed = fresh(true);
    this.at = fresh(-Infinity);
  }

  /** now en s, que solo avance (el tiempo de carrera sirve). */
  step(x: FeedbackIn, now: number): Cue | null {
    const p = this.prev ?? snap(x);
    this.prev = snap(x);
    this.rearm(x);
    if (blew(p, x)) return 'fault';
    if (this.warn(x, now)) return 'warn';
    if (turned(p, x)) return 'phase';
    if (scored(p, x)) return 'good';
    return x.changed ? 'confirm' : null;
  }

  /** Una advertencia cuya condición se fue vuelve a quedar lista, aunque otra señal se haya llevado el cuadro. */
  private rearm(x: FeedbackIn): void {
    const on = lit(x);
    KINDS.forEach((k) => { if (!on[k]) this.armed[k] = true; });
  }

  /** La primera advertencia lista (prendida, armada y fuera del silencio), si la carrera corre. Al salir se desarma. Una que no salió no se toca. */
  private warn(x: FeedbackIn, now: number): boolean {
    if (!x.green || x.done) return false;
    const on = lit(x), k = KINDS.find((q) => on[q] && this.armed[q] && now - this.at[q] >= FEEDBACK.SILENCE);
    if (!k) return false;
    this.armed[k] = false;
    this.at[k] = now;
    return true;
  }
}
