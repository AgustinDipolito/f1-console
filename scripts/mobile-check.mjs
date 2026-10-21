/**
 * Revisión de la página en teléfono, tableta y escritorio con Chrome sin ventana.
 * Sirve dist-web/ (antes: `npm run build:web`), la abre en cada tamaño de pantalla, mide lo que se puede medir
 * y guarda una captura de la pantalla de juego (en la grilla y corriendo) y de cada diálogo.
 *
 *   npm run check:mobile                    capturas en la carpeta temporal del sistema
 *   npm run check:mobile -- --out capturas  capturas en ./capturas
 *
 * Chrome se busca en los lugares de siempre; si está en otro lado, poné su ruta en la variable CHROME.
 * Sale con código 1 si alguna medida falla. Lo que mide no incluye la forma: las capturas se miran igual.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { chrome, sleep, tab } from './chrome.mjs';

const ROOT = resolve('dist-web');
const outArg = process.argv.indexOf('--out');
const OUT = resolve(outArg > 0 ? process.argv[outArg + 1] : join(tmpdir(), 'consola-mobile'));

/** Teléfonos con la barra del navegador a la vista: es el alto que de verdad queda. */
const SCREENS = [
  { name: 'telefono-360', w: 360, h: 640, touch: true, dpr: 3 },
  { name: 'telefono-390', w: 390, h: 664, touch: true, dpr: 3 },
  { name: 'telefono-apaisado', w: 844, h: 340, touch: true, dpr: 3 },
  { name: 'tableta', w: 768, h: 1024, touch: true, dpr: 2 },
  { name: 'escritorio', w: 1366, h: 768, touch: false, dpr: 1 },
];
const DIALOGS = [['btn-settings', 'dlg-settings'], ['btn-help', 'dlg-help'], ['btn-tel', 'dlg-tel'], ['btn-multi', 'dlg-multi']];
/** Piso de toque en un aparato táctil (px). */
const TOUCH_MIN = 44;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function serve() {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '');
    const file = join(ROOT, path || 'index.html');
    if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

/** Lo que se mide adentro de la página. Devuelve fallas y datos para el informe. */
const MEASURE = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; };
  const cross = (a, b) => Math.min(a.r, b.r) - Math.max(a.x, b.x) > 2 && Math.min(a.b, b.b) - Math.max(a.y, b.y) > 2;
  const W = innerWidth, H = innerHeight, phone = W < 600 || H < 500, touch = matchMedia('(pointer: coarse)').matches;
  const fail = [], info = {};
  const de = document.documentElement;
  if (de.scrollWidth > W + 1) fail.push('la página se desborda a lo ancho: ' + de.scrollWidth + ' px en ' + W);
  if (phone && de.scrollHeight > H + 1) fail.push('la pantalla de juego no entra: ' + de.scrollHeight + ' px de alto en ' + H);
  const ctl = [...document.querySelectorAll('.bar button, .bar select, .panel-head button, .view-btns button')].filter(vis);
  for (const c of ctl) {
    const r = rect(c), name = c.getAttribute('aria-label') || c.textContent.trim() || c.id;
    if (touch && Math.min(r.w, r.h) < ${TOUCH_MIN} - 0.5) fail.push('control chico para el dedo: ' + name + ' ' + Math.round(r.w) + '×' + Math.round(r.h));
    if (r.r > W + 0.5 || r.x < -0.5 || r.b > H + 0.5) fail.push('control fuera de la pantalla: ' + name);
  }
  ctl.forEach((a, i) => ctl.slice(i + 1).forEach((b) => { if (cross(rect(a), rect(b))) fail.push('controles encimados: ' + (a.textContent.trim() || a.id) + ' y ' + (b.textContent.trim() || b.id)); }));
  if (touch) for (const f of document.querySelectorAll('select, input[type=text], input[type=number]')) {
    if (vis(f) && parseFloat(getComputedStyle(f).fontSize) < 16) fail.push('campo con letra menor a 16 px (el iPhone acerca la página al tocarlo): ' + (f.id || f.name));
  }
  const box = document.getElementById('console');
  info.consola = { pxmm: Number(box.dataset.pxmm || 0), encuadre: box.dataset.frame || '?', caja: Math.round(box.clientWidth) + '×' + Math.round(box.clientHeight) };
  const bx = rect(box), labels = [...box.querySelectorAll('.label')].filter(vis).map((l) => ({ t: l.textContent, ...rect(l) }));
  for (const l of labels) if (l.x < bx.x - 1 || l.r > bx.r + 1 || l.y < bx.y - 1 || l.b > bx.b + 1) fail.push('etiqueta de la consola cortada por el borde: ' + l.t);
  labels.forEach((a, i) => labels.slice(i + 1).forEach((b) => { if (cross(a, b)) fail.push('etiquetas encimadas: ' + a.t + ' / ' + b.t); }));
  const sizes = new Set();
  for (const el of document.querySelectorAll('.bar *, .layout *')) if (vis(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) sizes.add(getComputedStyle(el).fontSize);
  info.tamañosDeLetra = [...sizes].sort();
  info.puntero = touch ? 'táctil' : 'fino';
  info.alto = { cabecera: Math.round(rect(document.querySelector('.bar')).h), mapa: Math.round(rect(document.getElementById('track')).h), consola: Math.round(bx.h) };
  return { fail, info };
})()`;

const DIALOG_MEASURE = (id) => `(() => {
  const d = document.getElementById('${id}'), W = innerWidth, H = innerHeight, fail = [];
  if (!d.open) return { fail: ['no abrió'], info: {} };
  const r = d.getBoundingClientRect();
  if (r.left < -0.5 || r.right > W + 0.5 || r.top < -0.5 || r.bottom > H + 0.5) fail.push('el diálogo se sale de la pantalla');
  if (d.scrollWidth > d.clientWidth + 1) fail.push('el diálogo se desborda a lo ancho: ' + d.scrollWidth + ' en ' + d.clientWidth);
  for (const b of d.querySelectorAll('.actions button')) {
    const q = b.getBoundingClientRect();
    if (q.bottom > H + 0.5 || q.right > W + 0.5) fail.push('botón «' + b.textContent.trim() + '» fuera de la vista sin desplazar');
  }
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch) for (const c of d.querySelectorAll('button, select, input')) {
    const q = c.getBoundingClientRect(), s = getComputedStyle(c);
    if (q.width && q.height && s.display !== 'none' && !c.classList.contains('link') && Math.min(q.width, q.height) < (c.type === 'checkbox' ? 20 : ${TOUCH_MIN}) - 0.5)
      fail.push('control chico para el dedo: ' + (c.textContent.trim() || c.name || c.getAttribute('aria-label') || c.type) + ' ' + Math.round(q.width) + '×' + Math.round(q.height));
  }
  return { fail, info: { caja: Math.round(r.width) + '×' + Math.round(r.height) } };
})()`;

/** Las reglas que el navegador leyó contra las escritas: una llave de más descarta todo lo que sigue. */
const CSS_MEASURE = `(async () => {
  const fail = [];
  for (const s of document.styleSheets) {
    const src = s.href ? await (await fetch(s.href)).text() : s.ownerNode.textContent;
    let depth = 0, top = 0;
    for (const ch of src.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '')) { if (ch === '{') { if (depth === 0) top++; depth++; } else if (ch === '}') depth--; }
    if (depth !== 0) fail.push('llaves sin cerrar en la hoja de estilo: ' + depth);
    if (top !== s.cssRules.length) fail.push('el navegador leyó ' + s.cssRules.length + ' reglas de ' + top);
  }
  return { fail, info: {} };
})()`;

const LAST = JSON.stringify({ circuit: 'ar-1952', laps: 3, rows: [
  { pos: 1, name: 'Vos', me: true, fin: 262.4, best: 86.9 }, { pos: 2, name: 'Bot 1', me: false, fin: 263.6, best: 87.2 },
  { pos: 3, name: 'Bot 2', me: false, fin: 268.1, best: 88.0 }, { pos: 4, name: 'Bot 10', me: false, fin: null, best: 89.3 }] });
/** Sin la ayuda del primer ingreso y con una carrera terminada guardada: la tabla de resultados abre al cargar. */
const FRESH = `try { localStorage.clear(); localStorage.setItem('f1c.help', '1'); localStorage.setItem('f1c.last', ${JSON.stringify(LAST)}); } catch {}`;
const READY = `!!document.querySelector('#console canvas') && /Listo|prueba/.test(document.getElementById('msg').textContent)`;

async function open(c, base, sc) {
  const t = await tab(c);
  await t.send('Emulation.setDeviceMetricsOverride', { width: sc.w, height: sc.h, deviceScaleFactor: sc.dpr, mobile: sc.touch });
  if (sc.touch) await t.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await t.send('Page.addScriptToEvaluateOnNewDocument', { source: FRESH });
  await t.send('Page.navigate', { url: base });
  t.until = async (cond, ms = 15000) => { for (let i = 0; i < ms; i += 200) { if (await t.evaluate(cond)) return true; await sleep(200); } return false; };
  await t.until(READY);
  await sleep(800);
  return t;
}

async function screen(c, base, sc) {
  const t = await open(c, base, sc), report = [];
  const shot = async (name) => writeFileSync(join(OUT, `${sc.name}-${name}.png`), await t.shot());
  const take = async (what, m) => report.push({ what, ...(await t.evaluate(m)) });
  await t.until(`document.getElementById('dlg-result').open`, 4000);
  await take('resultados', DIALOG_MEASURE('dlg-result'));
  await shot('resultados');
  await t.evaluate(`document.getElementById('dlg-result').close()`);
  await sleep(300);
  await take('grilla', MEASURE);
  await take('hoja de estilo', CSS_MEASURE);
  await shot('grilla');
  for (const [btn, dlg] of DIALOGS) {
    await t.evaluate(`document.getElementById('${btn}').click()`);
    await t.until(`document.getElementById('${dlg}').open`, 5000);
    await sleep(300);
    await take(dlg.slice(4), DIALOG_MEASURE(dlg));
    await shot(dlg.slice(4));
    await t.evaluate(`document.getElementById('${dlg}').close()`);
  }
  await t.evaluate(`document.getElementById('go').click()`);
  await sleep(7000);
  await take('carrera', MEASURE);
  await shot('carrera');
  await t.close();
  return report;
}

/** Con el service worker instalado, la página vuelve a abrir sin red, y también lo que se carga aparte (ajustes). */
async function offline(c, base) {
  const t = await open(c, base, SCREENS[1]), fail = [];
  const ready = await t.evaluate(`navigator.serviceWorker ? Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((ok) => setTimeout(() => ok(false), 15000))]) : false`);
  if (!ready) fail.push('no se instaló el service worker');
  else {
    await t.send('Network.enable');
    await t.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await t.send('Page.reload');
    await sleep(500);
    if (!(await t.until(READY))) fail.push('sin red, la página no arrancó');
    await t.evaluate(`document.getElementById('dlg-result').close(); document.getElementById('btn-settings').click()`);
    if (!(await t.until(`document.getElementById('dlg-settings').open`, 5000))) fail.push('sin red, ajustes no abrió');
  }
  await t.close();
  return { what: 'sin conexión', fail, info: {} };
}

const print = (r) => {
  const extra = Object.keys(r.info).length ? ` ${JSON.stringify(r.info)}` : '';
  console.log(`  ${r.fail.length ? '✗' : '✓'} ${r.what}${extra}`);
  for (const f of r.fail) console.log(`      ${f}`);
  return r.fail.length;
};

async function main() {
  if (!existsSync(join(ROOT, 'index.html'))) throw new Error('Falta dist-web/: corré antes npm run build:web');
  mkdirSync(OUT, { recursive: true });
  const server = await serve(), c = await chrome();
  const base = `http://127.0.0.1:${server.address().port}/`;
  let bad = 0;
  try {
    for (const sc of SCREENS) {
      console.log(`\n${sc.name} (${sc.w}×${sc.h}${sc.touch ? ', táctil' : ''})`);
      for (const r of await screen(c, base, sc)) bad += print(r);
    }
    console.log('\nversión instalable');
    bad += print(await offline(c, base));
  } finally {
    c.close();
    server.close();
  }
  console.log(`\nCapturas en ${OUT}`);
  console.log(bad ? `${bad} fallas` : 'Sin fallas en lo que se mide');
  process.exitCode = bad ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
