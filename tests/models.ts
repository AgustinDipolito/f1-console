import type { BotLevel } from '../src/bot/bot';
import type { Controls } from '../src/sim/types';

/**
 * Jugadores modelo, compartidos por la calibración y los desafíos (vitest no levanta este archivo).
 * ideal: lee el tramo sin retraso y maneja nafta y temperatura justo.
 * humano: un segundo de reacción (unos 60 m), frenos aproximados y 6 s para rearmar un fusible.
 */
export const PLAYERS: Record<'ideal' | 'humano', BotLevel> = {
  ideal: { delay: 0, jitter: 0, balErr: 0, tempCap: 99.9, fix: 0.5, fuelMix: 1.08 },
  humano: { delay: 60, jitter: 20, balErr: 2.5, tempCap: 97, fix: 6, fuelMix: 1.12 },
};

/** Consola que no se toca nunca: ni un cambio en toda la carrera. */
export const FIXED: Controls = { lev: 1, ers: 1, bal: 56, lim: false, dif: 1, eb: 1, rst: [0, 0, 0] };
