import type { Car } from './types';

/** Lo que cada jugador manda de su auto. d: distancia total (vueltas × largo + s); t: tiempo de carrera al medirlo. */
export type Snap = { t: number; d: number; v: number; off: number; done: boolean; fin: number | null; best: number | null };

/** Auto de otro jugador. Lo simula su dueño; acá solo se estima dónde está entre mensaje y mensaje. */
export interface Remote { id: string; name: string; car: Car; snap: Snap | null }

/** Más de este tiempo sin noticias y el auto remoto se queda donde estaba: no se lo inventa avanzando. */
export const EXTRAP_MAX = 1;
/** Qué tan rápido se corrige la estimación hacia lo que dice el último mensaje (1/s). */
const CORR = 4;
/** Una diferencia más grande que esta no se suaviza: se salta (primer mensaje, o un auto que volvió). */
const JUMP = 150;

export const snapOf = (c: Car, len: number, t: number): Snap =>
  ({ t, d: c.laps * len + c.s, v: c.v, off: c.off, done: c.done, fin: c.fin, best: c.best });

export function stepRemote(r: Remote, len: number, t: number, h: number): void {
  const c = r.car, s = r.snap;
  if (!s) return;
  const target = s.d + s.v * Math.min(EXTRAP_MAX, Math.max(0, t - s.t));
  let d = c.laps * len + c.s;
  if (Math.abs(target - d) > JUMP) d = target;
  else {
    const moving = t - s.t < EXTRAP_MAX;
    d += (moving ? s.v * h : 0) + (target - d) * Math.min(1, h * CORR);
  }
  c.laps = Math.floor(d / len);
  c.s = d - c.laps * len;
  c.v = s.v;
  c.off += (s.off - c.off) * Math.min(1, h * CORR);
  c.done = s.done;
  c.fin = s.fin;
  c.best = s.best;
}
