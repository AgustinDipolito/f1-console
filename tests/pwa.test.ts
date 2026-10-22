import { describe, expect, it } from 'vitest';
import { HASH_KEY, ICON_FILES, ICON_KINDS, SAFE_R, contentRadius, iconHash, iconScale, iconSvg } from '../src/brand/icon';
import { pngInfo } from '../src/brand/png';
import { DATA_CACHE, precacheList, swSource } from '../src/pwa/sw';
import { readFileSync } from 'node:fs';

const at = (p: string): URL => new URL(`../${p}`, import.meta.url);
const text = (p: string): string => readFileSync(at(p), 'utf8');
const png = (file: string) => {
  try { return pngInfo(readFileSync(at(`public/${file}`))); } catch { return null; }
};
const manifestRaw = text('public/manifest.webmanifest'), iconSvgFile = text('public/icon.svg'), indexHtml = text('index.html'), css = text('src/styles.css');
const manifest = JSON.parse(manifestRaw) as { icons: { src: string; sizes: string; purpose: string; type: string }[]; [k: string]: unknown };
const lightBg = /:root \{[^}]*--bg: (#[0-9a-f]{6})/.exec(css)?.[1];

describe('ícono', () => {
  it('el enmascarable deja todo el dibujo dentro del círculo seguro', () => {
    expect(iconScale('maskable') * contentRadius()).toBeLessThanOrEqual(SAFE_R);
  });

  it('el de esquinas redondeadas es el único que no va a sangre', () => {
    for (const k of ICON_KINDS) expect(iconSvg(k).includes('<rect width="100" height="100" rx=')).toBe(k === 'any');
  });

  it('public/icon.svg es el dibujo de hoy', () => {
    expect(iconSvgFile).toBe(iconSvg('any'));
  });

  it.each(ICON_FILES)('$file mide lo que dice y salió del dibujo de hoy (si falla: npm run icons)', ({ file, kind, size }) => {
    const info = png(file);
    expect(info).not.toBeNull();
    expect([info?.w, info?.h]).toEqual([size, size]);
    expect(info?.text[HASH_KEY]).toBe(iconHash(kind));
  });
});

describe('manifiesto', () => {
  it('cada ícono existe y mide lo que declara', () => {
    for (const ic of manifest.icons) {
      if (ic.type === 'image/svg+xml') { expect(ic.src).toBe('icon.svg'); continue; }
      const info = png(ic.src);
      expect(info, ic.src).not.toBeNull();
      expect(`${info?.w}x${info?.h}`).toBe(ic.sizes);
    }
  });

  it('tiene los tamaños que pide Chrome para instalar, comunes y enmascarables', () => {
    const has = (purpose: string, sizes: string): boolean => manifest.icons.some((i) => i.purpose === purpose && i.sizes === sizes);
    for (const p of ['any', 'maskable']) for (const s of ['192x192', '512x512']) expect(has(p, s), `${p} ${s}`).toBe(true);
  });

  it('abre en su carpeta, sin la barra del navegador y con el fondo del tema claro', () => {
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.display).toBe('standalone');
    expect(lightBg).toBeDefined();
    expect(manifest.background_color).toBe(lightBg);
    expect(manifest.theme_color).toBe(lightBg);
  });

  it('la página enlaza manifiesto, favicon e ícono del iPhone, y los tres existen', () => {
    expect(indexHtml).toContain('<link rel="manifest" href="manifest.webmanifest"');
    expect(indexHtml).toContain('<link rel="icon" href="icon.svg"');
    expect(indexHtml).toContain('href="icons/apple-touch-icon.png"');
    expect(png('icons/apple-touch-icon.png')).not.toBeNull();
    expect(indexHtml).toContain(`<meta name="theme-color" content="${lightBg}"`);
  });
});

describe('lista de lo que guarda el service worker', () => {
  it('todo lo empaquetado y todo public/, sin mapas ni el propio service worker, sin repetir', () => {
    expect(precacheList(['index.html', 'assets/a.js', 'assets/a.js.map', 'sw.js'], ['tracks/ar-1952.geojson', 'icon.svg', 'index.html']))
      .toEqual(['assets/a.js', 'icon.svg', 'index.html', 'tracks/ar-1952.geojson']);
  });
});

// ——— El service worker en un entorno de mentira: cachés en memoria y una red que se puede cortar ———

type Req = { url: string; method: string; mode: string; cache?: string };
const BASE = 'https://consola.test/app/';
const FILES = ['index.html', 'assets/index-abc.js', 'tracks/ar-1952.geojson'];

function fakeWorker(version = 'v1') {
  const stores = new Map<string, Map<string, Response>>();
  const net = { online: true, asked: [] as string[], reloads: [] as string[] };
  const key = (r: Req | string): string => new URL(typeof r === 'string' ? r : r.url, BASE).href;
  const store = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name) as Map<string, Response>;
    return {
      addAll: async (fs: (Req | string)[]) => {
        for (const f of fs) {
          if (typeof f !== 'string') net.reloads.push(f.cache ?? '');
          m.set(key(f), new Response(`guardado ${typeof f === 'string' ? f : f.url}`));
        }
      },
      match: async (r: Req | string, o?: { ignoreSearch?: boolean }) => m.get(o?.ignoreSearch ? key(r).split('?')[0] : key(r))?.clone(),
      put: async (r: Req, res: Response) => { m.set(key(r), res); },
    };
  };
  const caches = { open: async (n: string) => store(n), keys: async () => [...stores.keys()], delete: async (n: string) => stores.delete(n) };
  const fetch = async (r: Req): Promise<Response> => {
    net.asked.push(r.url);
    if (!net.online) throw new TypeError('sin red');
    return new Response(`red ${r.url}`);
  };
  const on: Record<string, (e: unknown) => void> = {};
  const self = { addEventListener: (t: string, f: (e: unknown) => void) => { on[t] = f; }, clients: { claim: async () => undefined } };
  // Request de mentira: guarda la ruta tal cual y el modo de caché.
  const Request = function (url: string, o?: { cache?: string }): Req { return { url, method: 'GET', mode: 'no-cors', cache: o?.cache }; };
  new Function('self', 'caches', 'fetch', 'location', 'Request', swSource(version, FILES))(self, caches, fetch, new URL(BASE), Request);
  /** Dispara un evento y devuelve la respuesta, o null si el service worker no la tomó. */
  const fire = async (type: string, request?: Req): Promise<string | null> => {
    const waits: Promise<unknown>[] = [];
    let res: Promise<Response> | null = null;
    on[type]({ request, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: (p: Promise<Response>) => { res = p; } });
    await Promise.all(waits);
    return res ? (await (res as Promise<Response>)).text() : null;
  };
  const get = (path: string, mode = 'no-cors', method = 'GET'): Req => ({ url: new URL(path, BASE).href, method, mode });
  return { fire, get, net, stores, store };
}

describe('service worker', () => {
  it('al instalarse guarda todo, y sin red abre la página y sus partes', async () => {
    const w = fakeWorker();
    await w.fire('install');
    w.net.online = false;
    expect(await w.fire('fetch', w.get('./', 'navigate'))).toBe('guardado index.html');
    expect(await w.fire('fetch', w.get('?sala=abc', 'navigate'))).toBe('guardado index.html');
    expect(await w.fire('fetch', w.get('assets/index-abc.js?v=2'))).toBe('guardado assets/index-abc.js');
    expect(await w.fire('fetch', w.get('tracks/ar-1952.geojson'))).toBe('guardado tracks/ar-1952.geojson');
    expect(w.net.asked).toEqual([]);
  });

  it('al instalarse saltea la caché HTTP, así no guarda un index.html de la versión anterior', async () => {
    const w = fakeWorker();
    await w.fire('install');
    expect(w.net.reloads).toEqual(FILES.map(() => 'reload'));
  });

  it('lo que no guardó lo pide a la red, y no toca lo que no es GET ni otros sitios', async () => {
    const w = fakeWorker();
    await w.fire('install');
    expect(await w.fire('fetch', w.get('otra.txt'))).toBe(`red ${BASE}otra.txt`);
    expect(await w.fire('fetch', w.get('assets/index-abc.js', 'no-cors', 'POST'))).toBeNull();
    expect(await w.fire('fetch', { url: 'https://relay.example/x', method: 'GET', mode: 'cors' })).toBeNull();
  });

  it('un trazado del CDN se guarda aparte y sin red sale de lo guardado', async () => {
    const w = fakeWorker(), cdn = { url: 'https://cdn.jsdelivr.net/gh/bacinger/f1-circuits@master/circuits/ar-1952.geojson', method: 'GET', mode: 'cors' };
    expect(await w.fire('fetch', cdn)).toBe(`red ${cdn.url}`);
    w.net.online = false;
    expect(await w.fire('fetch', cdn)).toBe(`red ${cdn.url}`);
    expect(w.stores.has(DATA_CACHE)).toBe(true);
  });

  it('al tomar el control borra el caché de la versión anterior y conserva los trazados', async () => {
    const w = fakeWorker('v2');
    await w.store('consola-v1').addAll(['index.html']);
    await w.store(DATA_CACHE).addAll(['x']);
    await w.fire('install');
    await w.fire('activate');
    expect([...w.stores.keys()].sort()).toEqual(['consola-v2', DATA_CACHE].sort());
  });
});
