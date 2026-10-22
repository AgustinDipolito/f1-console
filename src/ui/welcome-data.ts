import { BOT_LEVELS, SPREAD } from '../bot/bot';
import { LED_COLOR, LIVERIES, RANDOM_LIVERY, faceDecals, wheelColors } from '../console/panel';
import { PALETTES } from '../render/palette';
import { wheelInner, type WheelInk } from '../brand/icon';
import type { Config } from '../config';
import type { Difficulty } from '../sim/types';

/** Lo que muestra la bienvenida, sin DOM: el volante de cada esquema, las distribuciones que se ofrecen y qué significa cada dificultad. */

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
const num = (v: number): string => v.toLocaleString('es-AR', { maximumFractionDigits: 1 });

/** Tonos del dibujo del volante para un esquema. La pantalla va como en el ícono; el contorno, con la tinta del tema. */
export function liveryInk(id: string, theme: 'light' | 'dark'): WheelInk {
  const w = wheelColors(id, theme, PALETTES[theme]), L = PALETTES.light, top = hex(w.cap ?? w.knob);
  return {
    grip: hex(w.grip), body: hex(w.body), face: hex(w.face), knob: top, button: top, ink: hex(PALETTES[theme].ink),
    screen: hex(L.ink), bar: hex(L.slot), lit: hex(L.hi), led: hex(LED_COLOR),
  };
}

/** El volante de un esquema en mm, centrado en 0, para meter en un SVG (viewBox -137 -87 274 174). */
export const liveryWheel = (id: string, theme: 'light' | 'dark'): string =>
  wheelInner(liveryInk(id, theme), faceDecals(wheelColors(id, theme, PALETTES[theme])));

/** Esquemas en el orden del carrusel: primero «al azar», después los de `LIVERIES`. */
export const LIVERY_CHOICES: { id: string; name: string }[] = [
  { id: RANDOM_LIVERY, name: 'Al azar cada vez que abrís' },
  ...Object.entries(LIVERIES).map(([id, l]) => ({ id, name: l.name })),
];
/** Para «al azar», tres esquemas abiertos en abanico. */
export const FAN = ['celeste', 'neon', 'rosa'];

/** Distribuciones de la bienvenida. Lado a lado y apilada son formas de la automática: aparecen solo si ya estaban elegidas. */
export const LAYOUT_CHOICES: { id: Config['layout']; name: string; say: string }[] = [
  { id: 'auto', name: 'Mapa y volante', say: 'Cada uno en su lugar, acomodados según la pantalla. El mapa muestra el circuito entero.' },
  { id: 'screen', name: 'Mapa en el volante', say: 'Un solo panel: el mapa va en la pantalla del volante y las lecturas, arriba. El volante queda más grande.' },
  { id: 'cockpit', name: 'Volante delante del mapa', say: 'Como desde el auto: el mapa sigue a tu auto con el sentido de marcha hacia arriba y el volante va adelante.' },
  { id: 'side', name: 'Lado a lado', say: 'Mapa a la izquierda y volante a la derecha, aunque la pantalla sea angosta.' },
  { id: 'stack', name: 'Apilada', say: 'Mapa arriba y volante abajo, aunque la pantalla sea ancha.' },
];
export const layoutChoices = (current: Config['layout']): typeof LAYOUT_CHOICES =>
  LAYOUT_CHOICES.filter((c) => c.id !== 'side' && c.id !== 'stack' || c.id === current);

/**
 * Las tres dificultades. El resumen sale de la calibración contra el jugador modelo humano (`npm run calibrate`):
 * le gana al fácil en los 40 circuitos, queda parejo con el normal y el difícil le gana en casi todos.
 */
export const DIFF_CHOICES: { id: Difficulty; name: string; say: string }[] = [
  { id: 'easy', name: 'Fácil', say: 'Para aprender la consola: atento a cada tramo, le ganás en todos los circuitos.' },
  { id: 'normal', name: 'Normal', say: 'Parejo con alguien atento: la carrera se define por décimas.' },
  { id: 'hard', name: 'Difícil', say: 'Para cuando ya sabés qué pide cada tramo: solo le ganás si acertás cada uno a tiempo.' },
];

/** Cómo juegan los bots en cada dificultad, con los números del bot. */
export function diffFacts(d: Difficulty): string[] {
  const L = BOT_LEVELS[d];
  return [
    `Acomodan la consola unos ${Math.round(L.delay)} m después de que empieza cada tramo.`,
    `Le erran hasta ${num(L.balErr)} % al balance de frenos.`,
    `Tardan ${num(L.fix)} s en rearmar un fusible.`,
    ...(d === 'hard' ? ['El volante gira con el auto en cada curva: los botones se mueven mientras los tocás.'] : []),
  ];
}
/** Con varios bots, cuánto mejor o peor puede rendir cada uno alrededor de la dificultad. */
export const SPREAD_PCT = Math.round(SPREAD * 100);
