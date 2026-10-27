import { idx } from './car';
import { splitRuns } from './diagnose';
import { TEL_DS, evAt, smAt, timeAt } from './telemetry';
import type { Ev, Lap, Seg, Sm, Track } from './types';

export interface SegDiff {
  ty: Seg; s0: number; s1: number;
  /** Lo que a perdió contra b en el tramo (s): positivo es perder. La suma de todos los tramos da a.t − b.t. */
  gain: number;
  /** Eventos de cada vuelta en el tramo, con s desde la línea (la interfaz resta s0). */
  evA: Ev[]; evB: Ev[];
  /** Recursos al entrar al tramo. */
  smA: Sm | null; smB: Sm | null;
}

/**
 * a contra b, tramo por tramo en orden de pista. Si las vueltas tienen distinta cantidad de registros, [].
 * Los tramos se cortan en la línea aunque la recta siga del otro lado. Ordenar por costo lo hace quien llama.
 */
export function compareLaps(tr: Track, a: Lap, b: Lap): SegDiff[] {
  const n = a.tt.length;
  if (b.tt.length !== n) return [];
  const tyOf = (k: number): Seg => tr.ty[idx(tr, k * TEL_DS)], { start } = splitRuns(n, tyOf);
  // d(0) = 0 fuerza que la suma de los tramos dé a.t − b.t exacto, aunque el primer registro de cada una difiera.
  const d = (s: number): number => (s <= 0 ? 0 : timeAt(a, s, tr.len) - timeAt(b, s, tr.len));
  return start.map((k, j) => {
    const s0 = k * TEL_DS, s1 = Math.min(tr.len, (start[j + 1] ?? n) * TEL_DS), g = d(s1) - d(s0);
    // ponytail: un registro vacío de un fantasma dañado da 0 en el tramo en vez de NaN.
    return { ty: tyOf(k), s0, s1, gain: Number.isFinite(g) ? g : 0, evA: evAt(a, s0, s1), evB: evAt(b, s0, s1), smA: smAt(a, s0), smB: smAt(b, s0) };
  });
}
