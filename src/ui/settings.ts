import { DEFAULTS, deleteProfile, loadProfiles, saveProfile, sessionOf, type Config } from '../config';
import { LIVERIES, RANDOM_LIVERY } from '../console/panel';
import { canVibrate, type InstallState } from './device';

type Opt = [string, string];
const sel = (name: string, label: string, opts: Opt[]): string =>
  `<label class="field">${label}<select name="${name}">${opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>`;
const chk = (name: string, label: string): string => `<label class="field">${label}<input type="checkbox" name="${name}"></label>`;
/** Vueltas entre 1 y 20; un campo vacío o inválido deja el valor que había. */
export function lapsOf(v: string, prev: number): number {
  const n = Number(v);
  return v.trim() === '' || !Number.isFinite(n) ? prev : Math.max(1, Math.min(20, Math.round(n)));
}
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Instalar como aplicación: el botón donde el navegador lo ofrece, y en el iPhone, dónde está. */
const appSection = (app: InstallState): string => (app.install || app.ios ? `
      <h3>Aplicación</h3>
      ${app.install ? '<div class="field">Instalar la consola en este aparato<button type="button" data-install>Instalar</button></div>' : ''}
      ${app.ios ? '<p class="hint">En el iPhone o el iPad se instala desde Compartir, con «Agregar a inicio».</p>' : ''}` : '');

export function openSettings(dlg: HTMLDialogElement, cfg: Config, onChange: (c: Config) => void, app: InstallState, welcome: () => void): void {
  const vibrate = canVibrate();
  dlg.innerHTML = `
    <form method="dialog">
      <h2>Ajustes</h2>
      <div class="field">Volante, pantalla y dificultad, con dibujos<button type="button" data-welcome>Ver la bienvenida</button></div>
      <h3>Perfiles</h3>
      <div class="field"><select name="profile" aria-label="Perfil guardado"></select><span class="row"><button type="button" data-load>Usar</button><button type="button" data-del>Borrar</button></span></div>
      <div class="field"><input name="pname" type="text" maxlength="30" placeholder="Nombre del perfil" aria-label="Nombre del perfil"><button type="button" data-save>Guardar</button></div>
      <h3>Juego</h3>
      ${sel('difficulty', 'Dificultad de los bots', [['easy', 'Fácil'], ['normal', 'Normal'], ['hard', 'Difícil']])}
      ${sel('bots', 'Bots', Array.from({ length: 10 }, (_, i): Opt => [String(i + 1), String(i + 1)]))}
      <label class="field">Vueltas<input name="laps" type="number" min="1" max="20" step="1"></label>
      ${sel('timeScale', 'Velocidad del tiempo', [['1', '×1'], ['2', '×2'], ['3', '×3']])}
      ${chk('assist', 'Modo fácil: sugerir qué controles mover')}
      ${chk('faults', 'Fallas de fusibles')}
      ${chk('showBraking', 'Mostrar zonas de frenada')}
      ${chk('showTrail', 'Mostrar estela de eficacia')}
      ${chk('showGhost', 'Mostrar fantasma de la mejor vuelta')}
      <h3>Interfaz</h3>
      ${sel('mapView', 'Vista del circuito', [['2d', 'Mapa'], ['3d', 'Pista en 3D']])}
      ${chk('sound', 'Sonido')}
      ${vibrate ? chk('haptics', 'Vibrar al tocar un control') : ''}
      ${sel('theme', 'Tema', [['auto', 'Según el sistema'], ['light', 'Claro'], ['dark', 'Oscuro']])}
      ${sel('livery', 'Colores del volante', [[RANDOM_LIVERY, 'Al azar cada vez que abrís'], ...Object.entries(LIVERIES).map(([v, l]): Opt => [v, l.name])])}
      ${sel('layout', 'Distribución', [['auto', 'Automática'], ['side', 'Lado a lado'], ['stack', 'Apilada'], ['screen', 'Mapa en el volante'], ['cockpit', 'Volante delante del mapa']])}
      ${sel('quality', 'Calidad de la consola', [['1', 'Baja'], ['1.5', 'Media'], ['2', 'Alta']])}
      ${chk('labels', 'Etiquetas en la consola')}
      <h3>Efectos del volante</h3>
      ${chk('fxLeds', 'Los LEDs se llenan antes del tramo siguiente')}
      ${chk('fxAim', 'Marcar la posición del rotativo al apuntar')}
      ${chk('fxFlash', 'Destello al entrar al tramo bien configurado')}
      ${chk('fxDelta', 'Barra de delta en la pantalla')}
      ${chk('coach', 'Comentarios bajo el volante')}
      <h3>Efectos del mapa y la pista</h3>
      ${chk('fxLosses', 'Pérdidas de la última vuelta en el mapa')}
      ${chk('fxBrakes', 'Discos al rojo en las frenadas (pista 3D)')}
      ${appSection(app)}
      <p class="hint">Dificultad, vueltas, bots y fallas se aplican en la próxima largada.</p>
      <div class="actions"><button type="button" data-reset>Restablecer</button><button value="close">Cerrar</button></div>
    </form>`;
  const form = dlg.querySelector('form') as HTMLFormElement;
  const inp = (n: string): HTMLInputElement => form.elements.namedItem(n) as HTMLInputElement;
  const sl = (n: string): HTMLSelectElement => form.elements.namedItem(n) as HTMLSelectElement;
  const btn = (k: string): HTMLButtonElement => form.querySelector(`[data-${k}]`) as HTMLButtonElement;
  // Vibrar solo aparece donde el aparato vibra: en el resto el ajuste queda como estaba.
  const checks = (['assist', 'faults', 'showBraking', 'showTrail', 'showGhost', 'sound', 'haptics', 'labels', 'fxLeds', 'fxAim', 'fxFlash', 'fxDelta', 'coach', 'fxLosses', 'fxBrakes'] as const)
    .filter((k) => k !== 'haptics' || vibrate);
  const fill = (c: Config): void => {
    sl('difficulty').value = c.difficulty;
    sl('bots').value = String(c.bots);
    inp('laps').value = String(c.laps);
    sl('timeScale').value = String(c.timeScale);
    sl('mapView').value = c.mapView;
    sl('theme').value = c.theme;
    sl('livery').value = c.livery in LIVERIES || c.livery === RANDOM_LIVERY ? c.livery : 'carbono';
    sl('layout').value = c.layout;
    sl('quality').value = String(c.quality);
    for (const k of checks) inp(k).checked = c[k];
  };
  const read = (): Config => ({
    ...cfg,
    difficulty: sl('difficulty').value as Config['difficulty'],
    bots: Number(sl('bots').value),
    laps: lapsOf(inp('laps').value, cfg.laps),
    timeScale: Number(sl('timeScale').value),
    mapView: sl('mapView').value as Config['mapView'],
    theme: sl('theme').value as Config['theme'],
    livery: sl('livery').value,
    layout: sl('layout').value as Config['layout'],
    quality: Number(sl('quality').value),
    ...Object.fromEntries(checks.map((k) => [k, inp(k).checked])),
  });
  const apply = (c: Config): void => { cfg = c; fill(c); onChange(c); };
  const listProfiles = (sel?: string): void => {
    const names = Object.keys(loadProfiles()).sort((a, b) => a.localeCompare(b, 'es'));
    sl('profile').innerHTML = names.length ? names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('') : '<option value="">Sin perfiles guardados</option>';
    if (sel) sl('profile').value = sel;
    btn('load').disabled = btn('del').disabled = !names.length;
  };
  fill(cfg);
  listProfiles();
  form.addEventListener('change', (e) => {
    const n = (e.target as HTMLElement).getAttribute('name');
    if (n === 'profile' || n === 'pname') return;
    cfg = read();
    inp('laps').value = String(cfg.laps);
    onChange(cfg);
  });
  const save = (): void => {
    const name = inp('pname').value.trim();
    if (!name) { inp('pname').focus(); return; }
    saveProfile(name, cfg);
    inp('pname').value = '';
    listProfiles(name);
  };
  btn('save').addEventListener('click', save);
  // Enter en el nombre guarda: sin esto el formulario se envía con el primer botón y el diálogo se cierra.
  inp('pname').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  btn('load').addEventListener('click', () => {
    const p = loadProfiles()[sl('profile').value];
    if (p) apply({ ...DEFAULTS, ...p, ...sessionOf(cfg) });
  });
  btn('del').addEventListener('click', () => { deleteProfile(sl('profile').value); listProfiles(); });
  btn('reset').addEventListener('click', () => apply({ ...DEFAULTS, ...sessionOf(cfg) }));
  btn('welcome').addEventListener('click', () => { dlg.close(); welcome(); });
  form.querySelector('[data-install]')?.addEventListener('click', (e) => {
    app.install?.();
    (e.currentTarget as HTMLElement).closest('.field')?.remove();
  });
  dlg.showModal();
}
