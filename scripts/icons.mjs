/**
 * Genera los íconos desde el único dibujo (`src/brand/icon.ts`): public/icon.svg y los PNG del manifiesto en public/icons/.
 * Rasteriza con Chrome sin ventana. Cada PNG lleva la huella de su SVG, y `npm test` avisa si el dibujo cambió y no se regeneró.
 *
 *   npm run icons
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createServer } from 'vite';
import { chrome, sleep, tab } from './chrome.mjs';

const vite = await createServer({ configFile: false, logLevel: 'error', appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true } });
const { iconSvg, iconHash, HASH_KEY, ICON_FILES } = await vite.ssrLoadModule('/src/brand/icon.ts');
const { withText } = await vite.ssrLoadModule('/src/brand/png.ts');
await vite.close();

writeFileSync('public/icon.svg', iconSvg('any'));
console.log('public/icon.svg');

const c = await chrome();
try {
  for (const { file, kind, size } of ICON_FILES) {
    const t = await tab(c);
    await t.send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    await t.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    const src = `data:image/svg+xml;base64,${Buffer.from(iconSvg(kind)).toString('base64')}`;
    const html = `<style>html,body{margin:0;background:transparent}img{display:block;width:100vw;height:100vh}</style><img src="${src}">`;
    await t.send('Page.navigate', { url: `data:text/html;base64,${Buffer.from(html).toString('base64')}` });
    for (let i = 0; i < 50 && !(await t.evaluate('document.images[0]?.complete')); i++) await sleep(50);
    const png = withText(new Uint8Array(await t.shot()), HASH_KEY, iconHash(kind));
    const out = join('public', file);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, png);
    console.log(`${out} · ${kind} · ${size} px`);
    await t.close();
  }
} finally {
  c.close();
}
