/** Chrome sin ventana manejado por el protocolo de DevTools, sin dependencias. Lo usan `icons.mjs` y `mobile-check.mjs`. */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROMES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);

export const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Arranca Chrome y devuelve un cliente conectado al navegador. */
export async function chrome() {
  const exe = CHROMES.find((p) => existsSync(p));
  if (!exe) throw new Error('No encontré Chrome: poné su ruta en la variable CHROME');
  const dir = mkdtempSync(join(tmpdir(), 'consola-chrome-'));
  const proc = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  const portFile = join(dir, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const c = await connect(webSocketDebuggerUrl);
  return {
    ...c,
    close() {
      c.close();
      proc.kill();
      // Chrome tarda en soltar la carpeta: si sigue tomada, queda en la carpeta temporal.
      setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* sigue tomada */ } }, 500);
    },
  };
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const wait = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (!msg.id || !wait.has(msg.id)) return;
    const [ok, ko] = wait.get(msg.id);
    wait.delete(msg.id);
    if (msg.error) ko(new Error(msg.error.message)); else ok(msg.result);
  };
  const send = (method, params = {}, sessionId) => new Promise((ok, ko) => { wait.set(++id, [ok, ko]); ws.send(JSON.stringify({ id, method, params, sessionId })); });
  return new Promise((ok) => { ws.onopen = () => ok({ send, close: () => ws.close() }); });
}

/** Pestaña nueva con su propia sesión: send(método, parámetros) y evaluate(expresión) devuelven el resultado. */
export async function tab(c) {
  const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => c.send(m, p, sessionId);
  await send('Page.enable');
  const evaluate = (expression) => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then((r) => r.result.value);
  const shot = async () => Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64');
  return { send, evaluate, shot, close: () => c.send('Target.closeTarget', { targetId }) };
}
