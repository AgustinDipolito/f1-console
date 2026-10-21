import { buildTrack, catmullLoop, coordsOf, geoToMeters } from './build';
import type { Track, Vec2 } from '../sim/types';

const CDN = (id: string): string => `https://cdn.jsdelivr.net/gh/bacinger/f1-circuits@master/circuits/${id}.geojson`;

const FALLBACK: Vec2[] = (
  [[0.08, 0.7], [0.3, 0.82], [0.62, 0.84], [0.88, 0.8], [0.95, 0.6], [0.86, 0.46], [0.7, 0.44],
   [0.6, 0.28], [0.72, 0.15], [0.58, 0.08], [0.38, 0.16], [0.3, 0.36], [0.17, 0.3], [0.06, 0.44]] as Vec2[]
).map(([x, y]) => [x * 1700, (1 - y) * 650] as Vec2);

export type TrackSource = 'local' | 'cdn' | 'fallback';
type Loaded = { track: Track; source: TrackSource };

/** Trazados ya bajados y procesados: volver a un circuito no repite la descarga ni el procesamiento. */
const loaded = new Map<string, Promise<Loaded>>();

export function loadTrack(id: string, name: string): Promise<Loaded> {
  let p = loaded.get(id);
  if (!p) {
    p = fetchTrack(id, name);
    loaded.set(id, p);
    // El circuito de prueba es por falta de red: la próxima vez se vuelve a intentar.
    void p.then((r) => { if (r.source === 'fallback') loaded.delete(id); });
  }
  return p;
}

async function fetchTrack(id: string, name: string): Promise<Loaded> {
  const tries: [string, TrackSource][] = [[`${import.meta.env.BASE_URL}tracks/${id}.geojson`, 'local'], [CDN(id), 'cdn']];
  // Desde file:// el navegador no deja leer archivos locales con fetch: va directo al CDN.
  if (location.protocol === 'file:') tries.shift();
  for (const [url, source] of tries) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const co = coordsOf(await r.json());
      if (co && co.length >= 10) return { track: buildTrack(id, name, geoToMeters(co)), source };
    } catch {
      /* probar la siguiente fuente */
    }
  }
  return { track: buildTrack('test', 'Circuito de prueba', catmullLoop(FALLBACK)), source: 'fallback' };
}
