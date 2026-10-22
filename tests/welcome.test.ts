import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOT_LEVELS } from '../src/bot/bot';
import { LIVERIES, RANDOM_LIVERY, faceDecals, wheelColors } from '../src/console/panel';
import { PALETTES } from '../src/render/palette';
import { COCKPIT, cockpitFollow, layoutPlan, layoutSvg, screenKind, type Box } from '../src/ui/layouts';
import { DIFF_CHOICES, LAYOUT_CHOICES, LIVERY_CHOICES, diffFacts, layoutChoices, liveryInk, liveryWheel } from '../src/ui/welcome-data';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const inside = (a: Box, b: Box): boolean => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.w <= b.x + b.w + 0.5 && a.y + a.h <= b.y + b.h + 0.5;
const SIZES: [number, number][] = [[360, 640], [844, 340], [768, 1024], [1366, 768], [1000, 700]];

describe('bienvenida: volante', () => {
  it('el carrusel tiene «al azar» y todos los esquemas, sin repetir', () => {
    expect(LIVERY_CHOICES.map((c) => c.id)).toEqual([RANDOM_LIVERY, ...Object.keys(LIVERIES)]);
  });

  it('cada esquema se dibuja con sus colores y todas sus calcomanías', () => {
    for (const id of Object.keys(LIVERIES)) for (const th of ['light', 'dark'] as const) {
      const w = wheelColors(id, th, PALETTES[th]), svg = liveryWheel(id, th), ink = liveryInk(id, th);
      for (const c of [ink.body, ink.face, ink.grip, ink.knob]) expect(svg, `${id} ${th} ${c}`).toContain(`fill="${c}"`);
      // Una calcomanía es un polígono más: frente, cuerpo y uno por calcomanía.
      expect(svg.split('<polygon').length - 1, id).toBe(2 + faceDecals(w).length);
      expect(ink.knob).toBe(`#${(w.cap ?? w.knob).toString(16).padStart(6, '0')}`);
    }
  });

  it('dos esquemas no se dibujan igual', () => {
    const all = Object.keys(LIVERIES).map((id) => liveryWheel(id, 'dark'));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('bienvenida: distribuciones', () => {
  it('el tipo de pantalla sigue los cortes de styles.css', () => {
    expect(screenKind(360, 640)).toBe('tel');
    expect(screenKind(599, 900)).toBe('tel');
    expect(screenKind(844, 340)).toBe('apaisado');
    expect(screenKind(768, 1024)).toBe('angosta');
    expect(screenKind(1100, 1200)).toBe('ancha');
    expect(screenKind(950, 700)).toBe('ancha');
    expect(screenKind(950, 1000)).toBe('angosta');
    expect(css).toContain('@media (min-width: 1100px), (orientation: landscape) and (min-width: 900px) { .layout.auto');
    expect(css).toMatch(/@media \(max-width: 599px\) \{\s*\.bar \.grow/);
    expect(css).toMatch(/@media \(max-height: 499px\) and \(min-width: 600px\)/);
  });

  it('cuánto tapa el volante delante del mapa es lo de styles.css', () => {
    const pct = (sel: RegExp): number => Number(css.match(sel)?.[1]) / 100;
    expect(pct(/\.layout\.cockpit > \.panel:last-child \{ align-self: end; height: (\d+)%/)).toBe(COCKPIT.cover);
    expect(pct(/@media \(max-width: 599px\) \{ \.layout\.cockpit > \.panel:last-child \{ height: (\d+)%/)).toBe(COCKPIT.coverTel);
    expect(pct(/\.layout\.cockpit > \.panel:last-child \{ height: auto; align-self: stretch; justify-self: end; width: (\d+)%/)).toBe(COCKPIT.side);
  });

  it('en cada pantalla y distribución, mapa y volante entran debajo de la cabecera y no se pisan si van en paneles', () => {
    for (const [w, h] of SIZES) for (const l of LAYOUT_CHOICES) {
      const p = layoutPlan(l.id, w, h), screen = { x: 0, y: p.head.h, w, h: h - p.head.h }, tag = `${l.id} ${w}×${h}`;
      expect(inside(p.map, screen), `${tag} mapa`).toBe(true);
      expect(inside(p.wheel, screen), `${tag} volante`).toBe(true);
      expect(Math.min(p.map.h, p.wheel.h, p.map.w, p.wheel.w), tag).toBeGreaterThan(40);
      if (!p.over && !p.onWheel) {
        const apart = p.map.x + p.map.w <= p.wheel.x + 0.5 || p.map.y + p.map.h <= p.wheel.y + 0.5;
        expect(apart, `${tag} se pisan`).toBe(true);
      }
    }
  });

  it('volante delante del mapa: tu auto donde lo pone main, del lado que el volante no tapa', () => {
    expect(layoutPlan('cockpit', 1366, 768).follow).toEqual(cockpitFollow(false));
    expect(layoutPlan('cockpit', 844, 340).follow).toEqual(cockpitFollow(true));
    const land = layoutPlan('cockpit', 844, 340), [fx] = cockpitFollow(true);
    expect(land.map.x + land.map.w * fx).toBeLessThan(land.wheel.x);
    const tall = layoutPlan('cockpit', 360, 640), [, fy] = cockpitFollow(false);
    expect(tall.map.y + tall.map.h * fy).toBeLessThan(tall.wheel.y);
  });

  it('la automática se dibuja como queda en esa pantalla', () => {
    const side = layoutPlan('auto', 1366, 768), stack = layoutPlan('auto', 768, 1024), tel = layoutPlan('auto', 360, 640);
    expect(side.map.y).toBe(side.wheel.y);
    expect(stack.map.x).toBe(stack.wheel.x);
    expect(tel.wheel.y).toBeGreaterThan(tel.map.y);
    // Teléfono vertical: la consola con la proporción del frente hasta las empuñaduras, como en styles.css.
    expect(tel.wheel.h / tel.wheel.w).toBeCloseTo(204 / 282, 3);
    expect(css).toContain('aspect-ratio: 282 / 204');
  });

  it('el diagrama lleva el volante elegido y el mapa o la pista 3D, con recortes que no chocan entre diagramas', () => {
    const wheel = liveryWheel('neon', 'dark');
    const a = layoutSvg('auto', '2d', 1366, 768, wheel, 'dg-auto'), b = layoutSvg('cockpit', '3d', 1366, 768, wheel, 'dg-cockpit');
    expect(a).toContain(wheel);
    expect(a).toContain('dg-loop');
    expect(b).toContain('dg-road3');
    expect(a.match(/clipPath id="([^"]+)"/)?.[1]).not.toBe(b.match(/clipPath id="([^"]+)"/)?.[1]);
    // Mapa en el volante: el mapa va encima del volante, no debajo.
    const s = layoutSvg('screen', '2d', 1366, 768, wheel, 'dg-screen');
    expect(s.indexOf('dg-loop')).toBeGreaterThan(s.indexOf(wheel));
  });

  it('lado a lado y apilada aparecen solo si ya estaban elegidas', () => {
    expect(layoutChoices('auto').map((c) => c.id)).toEqual(['auto', 'screen', 'cockpit']);
    expect(layoutChoices('side').map((c) => c.id)).toEqual(['auto', 'screen', 'cockpit', 'side']);
  });
});

describe('bienvenida: dificultad', () => {
  it('las tres dificultades, con los números del bot', () => {
    expect(DIFF_CHOICES.map((d) => d.id)).toEqual(Object.keys(BOT_LEVELS));
    for (const d of DIFF_CHOICES) {
      const L = BOT_LEVELS[d.id], text = diffFacts(d.id).join(' ');
      expect(text, d.id).toContain(`${Math.round(L.delay)} m`);
      expect(text, d.id).toContain(`${String(L.fix).replace('.', ',')} s`);
      expect(text, d.id).toContain(`${String(L.balErr).replace('.', ',')} %`);
    }
  });

  it('solo difícil avisa que el volante gira', () => {
    for (const d of DIFF_CHOICES) expect(diffFacts(d.id).some((f) => f.includes('gira')), d.id).toBe(d.id === 'hard');
  });

  it('sin signos de exclamación ni mayúsculas fuera del comienzo de cada frase', () => {
    const texts = [...DIFF_CHOICES.map((d) => d.say), ...LAYOUT_CHOICES.map((l) => l.say), ...DIFF_CHOICES.flatMap((d) => diffFacts(d.id))];
    for (const t of texts) expect(t).not.toMatch(/[!¡]/);
  });
});

describe('bienvenida: cuándo aparece sola', () => {
  const store = (init: Record<string, string>) => {
    const m = new Map(Object.entries(init));
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    };
    return m;
  };

  it('solo en el primer ingreso: sin nada guardado, y una vez vista ya no', async () => {
    const { firstRun, markWelcomed } = await import('../src/config');
    store({});
    expect(firstRun()).toBe(true);
    markWelcomed();
    expect(firstRun()).toBe(false);
  });

  it('quien ya jugaba antes (vio la ayuda o tiene ajustes) no la ve sola', async () => {
    const { firstRun } = await import('../src/config');
    store({ 'f1c.help': '1' });
    expect(firstRun()).toBe(false);
    store({ 'f1c.config.v1': '{}' });
    expect(firstRun()).toBe(false);
  });

  it('sin almacenamiento no aparece: si no, saldría en cada visita', async () => {
    const { firstRun } = await import('../src/config');
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => { throw new Error('bloqueado'); } };
    expect(firstRun()).toBe(false);
  });
});
