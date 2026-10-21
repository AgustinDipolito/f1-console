import type { Config } from '../config';
import type { MapColors } from '../trackview/trackview';

export function applyTheme(t: Config['theme']): 'light' | 'dark' {
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  // La barra del navegador y la de la aplicación instalada toman el fondo del tema elegido, no el del sistema.
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  return dark ? 'dark' : 'light';
}

export function mapColors(): MapColors {
  const s = getComputedStyle(document.documentElement), v = (n: string): string => s.getPropertyValue(n).trim();
  return { ink: v('--text'), muted: v('--muted'), paper: v('--surface-2'), font: getComputedStyle(document.body).fontFamily || 'sans-serif' };
}
