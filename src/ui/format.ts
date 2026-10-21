export const f1 = (n: number): string => n.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** m:ss,d. Redondea antes de separar minutos para no mostrar ':60,0'. */
export function fmt(t: number | null): string {
  if (t == null) return '—';
  const r = Math.round(t * 10) / 10, m = Math.floor(r / 60);
  return `${m}:${(r - m * 60).toFixed(1).padStart(4, '0').replace('.', ',')}`;
}

export const KNOB_NAMES = {
  lev: ['eco', 'normal', 'push'],
  ers: ['harvest', 'balanced', 'attack'],
  dif: ['abierto', 'medio', 'bloqueado'],
  eb: ['bajo', 'medio', 'alto'],
} as const;
export const SEG_NAMES = { s: 'recta', b: 'frenada', c: 'curva', x: 'salida' } as const;
/** Nombre de cada control en una oración. */
export const KNOB_LABEL = { lev: 'potencia', ers: 'ERS', bal: 'frenos', dif: 'diferencial', eb: 'freno motor' } as const;
export const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);
