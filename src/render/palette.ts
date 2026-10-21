/** Tonos del pipeline anatomy. Sin three: main elige la paleta antes de cargar el motor 3D. */
export interface Palette { lo: number; mid: number; hi: number; ink: number; lit: number; slot: number; shadow: number }

export const PALETTES: Record<'light' | 'dark', Palette> = {
  light: { lo: 0xdcd9cf, mid: 0xeae8e1, hi: 0xf9f8f4, ink: 0x2c2c2a, lit: 0x111111, slot: 0x8a887f, shadow: 0.09 },
  dark: { lo: 0x2a2a28, mid: 0x353532, hi: 0x46453f, ink: 0xd3d1c7, lit: 0xffffff, slot: 0x161615, shadow: 0.4 },
};
