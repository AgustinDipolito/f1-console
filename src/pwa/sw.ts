/**
 * Versión instalable (solo `npm run build:web`): el código del service worker y la lista de lo que guarda.
 * Lo arma el plugin de `vite.config.ts` después de empaquetar; acá queda puro para probarlo en Node.
 *
 * - Al instalarse guarda la página, todas sus partes (también las que se cargan aparte), los íconos y los 40 trazados:
 *   la consola abre sin conexión, y una sala o un trazado del CDN son lo único que pide red.
 * - Cada versión usa su propio caché. La nueva espera a que se cierre la consola para tomar el control y recién ahí
 *   borra el caché viejo: una pestaña abierta nunca mezcla partes de dos versiones.
 * - Los trazados que llegan del CDN (si el sitio se publicó sin public/tracks) se guardan aparte y sobreviven a las versiones.
 */

/** Caché de los trazados del CDN: no cambia de nombre entre versiones. */
export const DATA_CACHE = 'consola-trazados';
export const CDN_HOST = 'cdn.jsdelivr.net';

/** Lo que se guarda al instalar: todo lo empaquetado y todo public/, menos los mapas de código y el propio service worker. */
export function precacheList(bundle: string[], publicFiles: string[]): string[] {
  const keep = (f: string): boolean => !f.endsWith('.map') && f !== 'sw.js';
  return [...new Set([...bundle, ...publicFiles].filter(keep))].sort();
}

/** Código del service worker. `version` cambia con cualquier archivo que cambie. */
export function swSource(version: string, files: string[]): string {
  return `// Consola de carrera · versión ${version}. Generado por vite.config.ts desde src/pwa/sw.ts.
const CACHE = 'consola-${version}', DATA = '${DATA_CACHE}', FILES = ${JSON.stringify(files)};

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))));

self.addEventListener('activate', (e) => e.waitUntil(caches.keys()
  .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== DATA).map((k) => caches.delete(k))))
  .then(() => self.clients.claim())));

self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET') return;
  // La página sale siempre de esta versión, con o sin red: así coincide con las partes guardadas.
  if (r.mode === 'navigate') e.respondWith(caches.open(CACHE).then((c) => c.match('index.html')).then((hit) => hit || fetch(r)));
  else if (u.origin === location.origin) e.respondWith(caches.open(CACHE).then((c) => c.match(r, { ignoreSearch: true })).then((hit) => hit || fetch(r)));
  else if (u.hostname === '${CDN_HOST}') e.respondWith(fresh(r, e));
});

/** Trazado del CDN: lo guardado sale enseguida y se actualiza por detrás; sin nada guardado, espera a la red. */
async function fresh(r, e) {
  const c = await caches.open(DATA), hit = await c.match(r);
  const net = fetch(r).then((res) => { if (res.ok) c.put(r, res.clone()); return res; });
  if (!hit) return net;
  e.waitUntil(net.catch(() => undefined));
  return hit;
}
`;
}
