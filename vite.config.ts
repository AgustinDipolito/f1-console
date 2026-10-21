import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import { precacheList, swSource } from './src/pwa/sw';

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Mete el JS y el CSS del build dentro de index.html para que dist/index.html abra con doble clic (file://). */
const inlineBundle = (): Plugin => ({
  name: 'inline-bundle',
  apply: 'build',
  enforce: 'post',
  generateBundle(_, bundle) {
    const page = bundle['index.html'];
    if (!page || page.type !== 'asset') return;
    let html = String(page.source);
    for (const [name, out] of Object.entries(bundle)) {
      if (out.type === 'chunk' && out.isEntry) {
        // Con los import() metidos en el mismo archivo, Vite no llega a reemplazar la lista de precarga: queda vacía.
        const code = out.code.replace(/__VITE_PRELOAD__/g, 'void 0').replace(/<\/script/gi, '<\\/script');
        html = html.replace(new RegExp(`<script[^>]*src="[^"]*${esc(name)}"[^>]*></script>`), () => `<script type="module">${code}</script>`);
        delete bundle[name];
      } else if (out.type === 'asset' && name.endsWith('.css')) {
        html = html.replace(new RegExp(`<link[^>]*href="[^"]*${esc(name)}"[^>]*>`), () => `<style>${String(out.source)}</style>`);
        delete bundle[name];
      }
    }
    page.source = html;
  },
});

/** Archivos de public/ con la ruta con que se publican. */
const publicFiles = (dir: string, base = ''): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? publicFiles(join(dir, f.name), `${base}${f.name}/`) : [`${base}${f.name}`]));

/**
 * Versión instalable. En `build:web` escribe sw.js con la lista de todo lo publicado y una versión que cambia con cualquier
 * archivo. En el archivo único (file://) saca el manifiesto: desde file:// el navegador no lo puede leer y no se instala.
 */
const pwa = (web: boolean): Plugin => ({
  name: 'pwa',
  apply: 'build',
  enforce: 'post',
  transformIndexHtml: (html) => (web ? html : html.replace(/\s*<link rel="manifest"[^>]*>/, '')),
  generateBundle(_, bundle) {
    if (!web) return;
    const pub = publicFiles('public'), hash = createHash('sha256');
    for (const [name, out] of Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))) hash.update(name).update(out.type === 'chunk' ? out.code : out.source);
    for (const f of pub.sort()) hash.update(f).update(readFileSync(join('public', f)));
    const files = precacheList(Object.keys(bundle), pub);
    this.emitFile({ type: 'asset', fileName: 'sw.js', source: swSource(hash.digest('hex').slice(0, 12), files) });
  },
});

/**
 * Dos salidas:
 * - `npm run build` (dist/): un solo index.html con todo adentro, para abrir con doble clic. Desde file:// el navegador
 *   no deja cargar otros módulos, así que lo que en el código se carga aparte (consola 3D, diálogos, sala) va adentro.
 * - `npm run build:web` (dist-web/): para publicar en un servidor. Cada parte que se carga aparte es su propio archivo,
 *   y three va en uno fijo que el navegador guarda entre versiones.
 */
const singleFile = {
  plugins: [inlineBundle(), pwa(false)],
  build: { modulePreload: false as const, rollupOptions: { output: { inlineDynamicImports: true } } },
};
const web = {
  plugins: [pwa(true)],
  build: {
    outDir: 'dist-web',
    rollupOptions: { output: { manualChunks: (id: string) => (id.includes('node_modules/three/') ? 'three' : undefined) } },
  },
};

export default defineConfig(({ mode }) => ({
  base: './',
  ...(mode === 'web' ? web : singleFile),
  server: { open: true },
  // La calibración corre carreras en los 40 trazados: va aparte, con `npm run calibrate`.
  test: { environment: 'node', include: [mode === 'calibrate' ? 'tests/**/*.cal.ts' : 'tests/**/*.test.ts'] },
}));
