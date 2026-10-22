import './styles.css';
import catalogJson from './tracks/catalog.json';
import { firstRun, loadBest, loadConfig, loadLast, loadRival, markWelcomed, saveBest, saveLast, saveConfig, saveRival, type Config } from './config';
import { loadTrack } from './tracks/load';
import { Race, type RaceEvent } from './sim/race';
import { FUSED, ahead, balWant, fuelLoad, fuelNeed, steer } from './sim/car';
import { FAULT, FUEL, LOOKAHEAD_T } from './sim/physics';
import { suggest } from './sim/score';
import { delta, emptyLap, ghostS } from './sim/telemetry';
import { snapOf } from './sim/remote';
import type { Car, Lap, Seg, Track } from './sim/types';
import { cleanName, decodeGhost, encodeGhost, newRoomCode, roomCodeOf, type Go, type RoomCfg, type SharedGhost } from './net/protocol';
import type { NetRoom } from './net/room';
import { defaultPanel, idleGauges, pickLivery, wheelColors, type ConsoleFx, type GaugeSource } from './console/panel';
import type { ConsoleView } from './console/console';
import { TrackView, type Ghost } from './trackview/trackview';
import type { Track3D } from './trackview/track3d';
import { PALETTES } from './render/palette';
import { setText } from './render/redraw';
import { Sound } from './audio/sound';
import { applyTheme, mapColors } from './ui/theme';
import { TOP, located, lossMarks, lossText, type LossMark } from './ui/losses';
import { lapDiagnosis } from './sim/diagnose';
import type { MultiActions, MultiState } from './ui/multi';
import { SEG_NAMES, f1, fmt } from './ui/format';
import { Coach } from './ui/coach';
import { Awake, BUZZ, buzz, installState, registerWorker, watchInstall } from './ui/device';
import { cockpitFollow } from './ui/layouts';

// Lo que no hace falta para la primera pantalla se baja cuando se usa: el volante 3D (three) arranca
// enseguida pero sin frenar el mapa; la pista 3D, la sala y los diálogos, recién al pedirlos.
const consoleModule = () => import('./console/console');
const track3dModule = () => import('./trackview/track3d');
const roomModule = () => import('./net/room');
const settingsModule = () => import('./ui/settings');
const helpModule = () => import('./ui/help');
const telemetryModule = () => import('./ui/telemetry');
const multiModule = () => import('./ui/multi');
const resultsModule = () => import('./ui/results');
const welcomeModule = () => import('./ui/welcome');

interface CircuitInfo { id: string; name: string }
const catalog = (catalogJson as CircuitInfo[]).slice().sort((a, b) => a.name.localeCompare(b.name, 'es'));
const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const els = {
  circuit: byId<HTMLSelectElement>('circuit'),
  go: byId<HTMLButtonElement>('go'),
  pause: byId<HTMLButtonElement>('pause'),
  view: byId<HTMLButtonElement>('view'),
  info: byId('info'),
  raceNow: byId('race-now'),
  raceTimes: byId('race-times'),
  log: byId('log'),
  msg: byId('msg'),
  readout: byId('readout'),
  eff: byId('eff'),
  effSeg: byId('eff-seg'),
  layout: byId('layout'),
  track: byId('track'),
  console: byId('console'),
  labels: byId('labels'),
  settings: byId<HTMLDialogElement>('dlg-settings'),
  help: byId<HTMLDialogElement>('dlg-help'),
  tel: byId<HTMLDialogElement>('dlg-tel'),
  multi: byId<HTMLDialogElement>('dlg-multi'),
  result: byId<HTMLDialogElement>('dlg-result'),
  welcome: byId<HTMLDialogElement>('dlg-welcome'),
  multiBtn: byId<HTMLButtonElement>('btn-multi'),
  multiLabels: [...document.querySelectorAll<HTMLElement>('#btn-multi .long, #btn-multi .short')],
};
byId('boot')?.remove();

let cfg: Config = loadConfig();
let theme = applyTheme(cfg.theme);
/** Esquema del volante en esta sesión: con «al azar» se sortea al abrir y al volver a elegirlo en ajustes. */
let livery = pickLivery(cfg.livery);
const panel = defaultPanel();
const map = new TrackView(els.track, mapColors());
const sound = new Sound(cfg.sound);
const awake = new Awake();
let view: ConsoleView | null = null;
let view3d: Track3D | null = null;
let race: Race | null = null;
let best: Lap | null = null;
/** Fantasma de otro jugador en este circuito. */
let rival: SharedGhost | null = null;
let loadId = 0;
/** Circuito cargado (o cargándose). */
let curCircuit = '';
/** Cada armado del volante o de la pista 3D lleva un número: si mientras se bajaba se pidió otro, el viejo no se usa. */
let consoleGen = 0;
let view3dGen = 0;

/** Sala: null jugando solo. roomCfg es lo último que mandó el anfitrión; raceN, la última largada de la sala. */
let net: NetRoom | null = null;
let joining = false;
let netStatus = '';
let prefillCode = '';
let roomCfg: RoomCfg | null = null;
let raceN = 0;
/** Llegó una largada mientras se cargaba el circuito: se larga apenas termine. */
let pendingGo = false;
/** Cada cuánto se manda la posición de tu auto (s). */
const SNAP_DT = 0.1;

const myRoomCfg = (): RoomCfg => ({ circuit: curCircuit, laps: cfg.laps, faults: cfg.faults, timeScale: cfg.timeScale });
/** En una sala manda el anfitrión: vueltas, fallas y velocidad del tiempo son las suyas. */
const activeCfg = (): RoomCfg | null => (net ? (net.isHost ? myRoomCfg() : roomCfg ?? myRoomCfg()) : null);
const timeScale = (): number => activeCfg()?.timeScale ?? cfg.timeScale;
const raceOpts = () => {
  const rc = activeCfg();
  return {
    laps: rc?.laps ?? cfg.laps, difficulty: cfg.difficulty, trail: cfg.showTrail, bots: net ? 0 : cfg.bots, faults: rc?.faults ?? cfg.faults,
    seed: (Math.random() * 2 ** 31) | 0,
  };
};
const link = (k: string, v: string): string => `${location.href.split('#')[0]}#${k}=${v}`;
const signed = (x: number): string => `${x >= 0 ? '+' : '−'}${f1(Math.abs(x))}`;

/** Usa un módulo que se baja aparte. Si no llega (sin red, o una versión nueva publicada), lo avisa en vez de fallar callado. */
function lazy<T>(load: () => Promise<T>, use: (m: T) => void): void {
  load().then(use, (e: unknown) => {
    console.error(e);
    els.msg.textContent = 'No se pudo cargar esa parte de la página. Recargala y probá de nuevo';
  });
}

/** El fantasma vale solo para este trazado: si el procesamiento cambió, los registros no coinciden. */
function rivalFor(track: Track, code: string | null): SharedGhost | null {
  const g = code ? decodeGhost(code) : null;
  return g && g.track === track.id && g.lap.tt.length === emptyLap(track.len).tt.length ? g : null;
}
/**
 * Volante delante del mapa: dónde va tu auto (fracción del ancho y del alto), donde el volante no tapa. El volante tapa los dos
 * tercios de abajo; en el teléfono apaisado, la de la derecha (abajo quedaría a menos de 1 px por mm). Lo mismo dibuja la bienvenida.
 */
const landscape = window.matchMedia('(max-height: 499px)');
const cockpitAt = (): [number, number] => cockpitFollow(landscape.matches);
const applyLayout = (): void => { els.layout.className = `layout ${cfg.layout}`; placeMap(); };

/**
 * Mapa en el volante: la caja del mapa pasa adentro de la consola y el volante la acomoda sobre su pantalla. Sin volante
 * (three sin bajar o sin WebGL) queda en su panel. Volante delante del mapa: el mapa y la pista 3D siguen a tu auto por arriba del volante.
 */
function placeMap(): void {
  const inWheel = cfg.layout === 'screen' && !!view, cockpit = cfg.layout === 'cockpit' ? cockpitAt() : null;
  if (inWheel && els.track.parentElement !== els.console) els.console.appendChild(els.track);
  if (!inWheel && els.track.parentElement === els.console) els.msg.before(els.track);
  view?.setScreenMap(inWheel ? els.track : null);
  map.setFollow(cockpit);
  view3d?.setAnchor(cockpit ?? [0.5, 0.5]);
}
/** Largar y Revancha son la acción primaria de la pantalla; Reiniciar, con la carrera andando, es un botón común. */
function setGo(label: 'Largar' | 'Reiniciar' | 'Revancha'): void {
  els.go.textContent = label;
  els.go.classList.toggle('primary', label !== 'Reiniciar');
}

/** Comentarios bajo el volante, uno por tramo. Se vacían al volver a la grilla. */
const coach = new Coach();

const consoleFx = (): ConsoleFx => ({ leds: cfg.fxLeds, aim: cfg.fxAim, flash: cfg.fxFlash, delta: cfg.fxDelta });

function setupConsole(v: ConsoleView): void {
  v.showLabels = cfg.labels;
  v.fx = consoleFx();
  v.setSteerRoom(cfg.difficulty === 'hard');
  placeMap();
}

async function buildConsole(): Promise<void> {
  const gen = ++consoleGen;
  let mod: Awaited<ReturnType<typeof consoleModule>>;
  try {
    mod = await consoleModule();
  } catch (e) {
    console.error(e);
    els.readout.textContent = 'No se pudo cargar la consola';
    return;
  }
  if (gen !== consoleGen) return;
  view?.dispose();
  try {
    view = new mod.ConsoleView(els.console, els.labels, panel, PALETTES[theme], cfg.quality, wheelColors(livery, theme, PALETTES[theme]));
    setupConsole(view);
  } catch (e) {
    view = null;
    placeMap();
    els.readout.textContent = 'WebGL no disponible';
    console.error(e);
  }
}

/** La pista 3D se arma recién cuando se pide, y se rehace si cambia el tema. */
async function build3d(): Promise<void> {
  const gen = ++view3dGen;
  try {
    const { Track3D } = await track3dModule();
    if (gen !== view3dGen || view3d) return;
    view3d = new Track3D(els.track, PALETTES[theme], cfg.quality);
    if (race) view3d.setTrack(race.track);
    placeMap();
  } catch (e) {
    // Sin WebGL o sin el módulo: queda el mapa, pero se avisa. Callado parecía que el botón no hacía nada.
    console.error(e);
    cfg = { ...cfg, mapView: '2d' };
    els.msg.textContent = 'No se pudo armar la pista en 3D. Recargá la página y probá de nuevo';
  }
}

async function applyView(): Promise<void> {
  if (cfg.mapView === '3d' && !view3d) await build3d();
  map.show(cfg.mapView === '2d');
  view3d?.show(cfg.mapView === '3d');
  els.view.textContent = cfg.mapView === '3d' ? 'Ver mapa' : 'Ver en 3D';
}

function rebuild3d(): void {
  view3dGen++;
  view3d?.dispose();
  view3d = null;
  void applyView();
}

async function selectCircuit(id: string): Promise<void> {
  const my = ++loadId;
  curCircuit = id;
  race = null;
  best = null;
  rival = null;
  final = null;
  els.msg.textContent = 'Cargando circuito';
  const info = catalog.find((c) => c.id === id);
  const { track, source } = await loadTrack(id, info?.name ?? id);
  if (my !== loadId) return;
  race = new Race(track, raceOpts());
  coach.reset();
  best = loadBest(track.id);
  rival = rivalFor(track, loadRival(id));
  laps = 0;
  lapMarks = [];
  map.setTrack(track);
  view3d?.setTrack(track);
  setGo('Largar');
  els.pause.textContent = 'Pausa';
  els.msg.textContent = source === 'fallback' ? fallbackText()
    : rival ? `Listo para largar contra el fantasma de ${rival.name || 'otro jugador'}` : 'Listo para largar';
  refreshMulti();
  if (pendingGo) { pendingGo = false; startRoomRace(); }
}

/** Sin el trazado real. Sin conexión no es una falla: es lo que pasa en el teléfono con un circuito que nunca se abrió. */
const fallbackText = (): string => (navigator.onLine
  ? 'No se pudo bajar el trazado real; uso un circuito de prueba'
  : 'Sin conexión, y este circuito no estaba guardado: uso uno de prueba');

/** Cambia de circuito. Siguiendo al anfitrión no se guarda: tu circuito de siempre queda como estaba. */
function chooseCircuit(id: string, save: boolean): void {
  els.circuit.value = id;
  if (save) { cfg = { ...cfg, circuit: id }; saveConfig(cfg); }
  void selectCircuit(id);
  if (net?.isHost) net.sendCfg(myRoomCfg());
}

function togglePause(): void {
  // En una sala los demás siguen corriendo: pausar solo te dejaría atrás.
  if (net || !race || (race.phase !== 'run' && race.phase !== 'count')) return;
  race.paused = !race.paused;
  els.pause.textContent = race.paused ? 'Seguir' : 'Pausa';
  els.msg.textContent = race.paused ? 'En pausa' : '';
}

function onEvent(ev: RaceEvent): void {
  if (!race) return;
  if (ev === 'green') { els.msg.textContent = 'Largaron'; sound.beep(true); return; }
  if (ev === 'fuse') { els.msg.textContent = 'Saltó un fusible: poné su control en el medio y apretalo'; sound.alarm(); buzz(cfg.haptics, BUZZ.alarm); return; }
  // El resultado se congela en la meta: los autos siguen andando y la diferencia estimada se movería.
  // Si el segundo llega después, se recalcula con su tiempo real.
  if (ev === 'player-done' || race.player.done) { finish(race); return; }
  els.msg.textContent = net ? 'Otro jugador ya terminó, seguí empujando' : 'Un bot ya terminó, seguí empujando';
}

function finish(r: Race): void {
  final = r.result();
  setGo('Revancha');
  if (final) els.msg.textContent = resultText(final, r.player);
  showResults(r);
}

/** Tabla de resultados al terminar: se guarda para que una recarga no la pierda y queda abierta hasta que elijas. */
function showResults(r: Race, remember = true): void {
  const res = { circuit: r.track.id, laps: r.opts.laps, rows: r.standings() };
  if (remember) saveLast(res);
  openResultsDialog(r.track.name, res);
}

function openResultsDialog(name: string, res: NonNullable<ReturnType<typeof loadLast>>): void {
  lazy(resultsModule, (m) => m.openResults(els.result, name, res, {
    again: rematch,
    otherCircuit: pickCircuit,
    telemetry: () => byId('btn-tel').click(),
  }));
}

/** Abre la lista de circuitos. Donde el navegador no deja abrirla desde el código, queda enfocada con el aviso. */
function pickCircuit(): void {
  els.circuit.focus();
  els.msg.textContent = 'Elegí otro circuito en la lista';
  try { els.circuit.showPicker(); } catch { /* sin showPicker: queda enfocada */ }
}

/** Correr de nuevo: solo a pedido del jugador. */
function rematch(): void {
  if (!race || net) return;
  toGrid();
  saveLast(null);
  race.start();
  setGo('Reiniciar');
}

function resultText(res: NonNullable<ReturnType<Race['result']>>, p: Car): string {
  const tail = `total ${fmt(p.fin)} · mejor vuelta ${fmt(p.best)}`;
  if (res.of === 1) return `Terminaste · ${tail}`;
  return `${res.won ? 'Ganaste' : `Terminaste ${res.pos}.º de ${res.of}`} por ${f1(res.margin)} s · ${tail}`;
}

let final: ReturnType<Race['result']> = null;

/** Pérdidas numeradas de la última vuelta, para el mapa. */
let lapMarks: LossMark[] = [];
let laps = 0;

/** Al cerrar una vuelta: contra el rival, si es la mejor (y se guarda) y qué fue lo que más costó. */
function checkLap(): void {
  if (!race) return;
  const h = race.player.hist;
  if (h.length === laps) return;
  laps = h.length;
  const l = h[h.length - 1];
  if (l) lapNews(race, l, h.length === 1);
}

function lapNews(r: Race, l: Lap, first: boolean): void {
  let say = rival ? rivalSay(l, rival) : '';
  if (!best || l.t < best.t) {
    best = l;
    saveBest(r.track.id, l);
    say = `Mejor vuelta en este circuito: ${fmt(l.t)}`;
  }
  const d = lapDiagnosis(r.track, l, first), worst = d ? located(d).slice(0, TOP) : [];
  lapMarks = lossMarks(worst);
  if (worst.length) say = `${say ? `${say}. ` : ''}Lo que más costó: ${lossText(worst[0])}`;
  // En la meta manda el resultado de la carrera.
  if (say && !r.player.done) els.msg.textContent = say;
}

function rivalSay(l: Lap, rv: SharedGhost): string {
  const d = l.t - rv.lap.t, who = rv.name || 'tu rival';
  return d < 0 ? `Le sacaste ${f1(-d)} s a la vuelta de ${who}` : `La vuelta de ${who} fue ${f1(d)} s más rápida`;
}

function gauges(r: Race): GaugeSource {
  const p = r.player, tr = r.track, a = ahead(tr, p.s), perLap = tr.len * FUEL.BURN * FUEL.MIX[1];
  const look = Math.max(p.v, 10) * LOOKAHEAD_T, soon = r.green && a.dist < look;
  return {
    bat: p.bat, temp: p.temp, tyre: p.tyre, fuel: p.fuel, fuelMax: fuelLoad(tr, r.opts.laps),
    fuelLaps: (p.fuel - fuelNeed(tr, p, r.opts.laps, FUEL.MIX[1])) / perLap,
    fuse: p.fuse, ty: p.ty, next: a.ty, dist: a.dist, soon,
    hint: cfg.assist && r.phase !== 'done' ? hints(soon ? a.ty : p.ty, p.fuse, balWant(p)) : {},
    // En difícil el volante gira con el auto: los botones se mueven bajo el puntero.
    steer: r.opts.difficulty === 'hard' && r.green ? steer(tr, p.s) : 0,
    lead: soon ? 1 - a.dist / look : 0, sc: p.sc, live: r.green && !p.done, delta: lapDelta(r), bal: balWant(p),
  };
}

/** Modo fácil: con un fusible saltado, su control va al centro para poder rearmar; no sirve moverlo a otro lado. */
function hints(ty: Seg, fuse: boolean[], bal: number): ReturnType<typeof suggest> {
  const h = suggest(ty, panel, bal);
  FUSED.forEach((k, f) => {
    if (!fuse[f]) return;
    if (panel[k] === FAULT.NEUTRAL) delete h[k];
    else h[k] = FAULT.NEUTRAL;
  });
  return h;
}

/** Hay una vuelta en curso: largaron, ya cruzaste la línea una vez y no terminaste. */
const lapOn = (r: Race): boolean => r.green && r.player.laps >= 0 && !r.player.done;

/** Fantasmas en la vuelta en curso: tu mejor vuelta (si está a la vista) y la del rival cargado. */
function ghostsAt(r: Race): Ghost[] {
  const p = r.player, len = r.track.len, e = r.t - p.lapT0, out: Ghost[] = [];
  if (!lapOn(r)) return out;
  if (cfg.showGhost && best) out.push({ s: ghostS(best, e, len) % len, label: 'Mejor' });
  if (rival) out.push({ s: ghostS(rival.lap, e, len) % len, label: rival.name || 'Rival' });
  return out;
}

/** Delta contra la mejor vuelta en este punto; null sin referencia o fuera de una vuelta. */
function lapDelta(r: Race): number | null {
  const p = r.player;
  return best && lapOn(r) ? delta(best, p.s, r.t - p.lapT0, r.track.len) : null;
}

/** Puesto: el resultado congelado después de la meta, la grilla antes de largar o el puesto con la diferencia. */
function posText(r: Race): string {
  // Después de la meta los autos siguen andando: se muestra el resultado, no una diferencia que se sigue moviendo.
  const res = r.phase === 'done' ? final : null;
  if (res) return res.of === 1 ? 'P1/1' : `P${res.pos}/${res.of} ${res.won ? '+' : '−'}${f1(res.margin)} s`;
  if (!r.green) return 'grilla';
  const n = r.cars.length, o = r.order();
  return n === 1 ? 'P1/1' : `P${r.position(o)}/${n} ${signed(r.gap(o))} s`;
}

function deltaTexts(r: Race): string[] {
  const p = r.player, out: string[] = [], d = lapDelta(r);
  if (d !== null) out.push(`Δ ${signed(d)}`);
  if (rival && lapOn(r)) out.push(`vs ${rival.name || 'rival'} ${signed(delta(rival.lap, p.s, r.t - p.lapT0, r.track.len))}`);
  return out;
}

/**
 * Cabecera del mapa: el circuito. Renglón de la carrera, aparte: vuelta, puesto y deltas arriba; tiempos y velocidad abajo.
 * Son dos renglones fijos para que el mapa no cambie de alto cuando un número se alarga.
 */
function hud(): void {
  if (!race) { setText(els.info, 'cargando circuito'); return; }
  const p = race.player, t = race.track, L = race.opts.laps;
  setText(els.info, `${t.name} · ${(t.len / 1000).toFixed(2).replace('.', ',')} km · ×${timeScale()}`);
  setText(els.raceNow, [`vuelta ${Math.min(L, Math.max(1, p.laps + 1))}/${L}`, posText(race), ...deltaTexts(race)].join(' · '));
  setText(els.raceTimes, [`última ${fmt(p.last)}`, `mejor ${fmt(best?.t ?? p.best)}`, `${Math.round(p.v * 3.6)} km/h`].join(' · '));
  // En el teléfono el tramo lo dice la etiqueta del volante: la lectura queda en la eficacia.
  if (view) { setText(els.eff, `eficacia ${Math.round(p.eff * 100)} %`); setText(els.effSeg, ` · ${SEG_NAMES[p.ty]}`); }
  drawLog();
}

/** Renglones del comentarista: escribe solo el texto o el tono que cambió. */
function drawLog(): void {
  [...els.log.children].forEach((el, i) => {
    const l = coach.lines[i], tone = l ? (l.good ? 'good' : 'bad') : '';
    setText(el as HTMLElement, l?.text ?? '');
    if (el.className !== tone) el.className = tone;
  });
}

// ——— Sala y fantasma de otro jugador ———

/** Deja la carrera en la grilla con las opciones que correspondan (solo o en sala). */
function toGrid(): void {
  if (!race) return;
  race.opts = raceOpts();
  race.reset();
  coach.reset();
  laps = 0;
  lapMarks = [];
  final = null;
  setGo('Largar');
  els.pause.textContent = 'Pausa';
}

function startRoomRace(): void {
  if (!race || !net) return;
  toGrid();
  race.start();
  setGo('Reiniciar');
}

function hostGo(): void {
  if (!net || !race) return;
  const g: Go = { n: ++raceN, cfg: myRoomCfg() };
  roomCfg = g.cfg;
  net.sendGo(g);
  startRoomRace();
}

function updateRoomUI(): void {
  const guest = !!net && !net.isHost;
  els.circuit.disabled = guest;
  els.go.disabled = guest;
  els.pause.disabled = !!net;
  els.multiLabels.forEach((l, i) => { l.textContent = net ? `Sala · ${net.members.size}` : ['Jugar con otros', 'Con otros'][i]; });
  refreshMulti();
}

const roomEvents = {
  change: updateRoomUI,
  joined(id: string): void { if (net?.isHost) net.sendCfg(myRoomCfg(), id); },
  cfg(c: RoomCfg): void {
    roomCfg = c;
    const idle = !race || race.phase === 'grid' || race.phase === 'done';
    if (!idle) return;
    if (c.circuit !== curCircuit) chooseCircuit(c.circuit, false);
    else toGrid();
  },
  go(g: Go): void {
    if (g.n <= raceN) return;
    raceN = g.n;
    roomCfg = g.cfg;
    els.msg.textContent = 'El anfitrión dio la largada';
    if (!race || g.cfg.circuit !== curCircuit) { pendingGo = true; if (g.cfg.circuit !== curCircuit) chooseCircuit(g.cfg.circuit, false); return; }
    startRoomRace();
  },
  snap(id: string, sn: Parameters<NetRoom['sendSnap']>[0]): void {
    if (!race || !net || sn.n !== raceN || race.phase === 'grid') return;
    race.snap(id, net.nameOf(id), sn);
  },
  leave(id: string): void { race?.leave(id); },
  error(msg: string): void { netStatus = `Problema con la sala: ${msg}`; refreshMulti(); },
};

async function enterRoom(code: string, creator: boolean): Promise<void> {
  if (net || joining) return;
  if (!cfg.name) { prefillCode = code; netStatus = 'Poné tu nombre para que los demás te reconozcan'; openMulti(); return; }
  joining = true;
  netStatus = 'Conectando';
  refreshMulti();
  try {
    const { NetRoom } = await roomModule();
    net = await NetRoom.join(code, { name: cfg.name, since: creator ? 0 : Date.now() }, roomEvents);
    raceN = 0;
    roomCfg = null;
    prefillCode = '';
    netStatus = '';
    toGrid();
    els.msg.textContent = creator ? 'Sala creada: pasá el link y largá cuando estén todos' : 'Entraste a la sala: esperá la largada';
  } catch (e) {
    console.error(e);
    netStatus = 'No se pudo cargar la conexión. Revisá internet y probá de nuevo';
  }
  joining = false;
  updateRoomUI();
}

function leaveRoom(): void {
  net?.leave();
  net = null;
  roomCfg = null;
  raceN = 0;
  pendingGo = false;
  netStatus = '';
  // Si seguías al anfitrión, el circuito que quedó pasa a ser el tuyo.
  if (curCircuit && curCircuit !== cfg.circuit) { cfg = { ...cfg, circuit: curCircuit }; saveConfig(cfg); }
  toGrid();
  els.msg.textContent = 'Saliste de la sala';
  updateRoomUI();
}

/** Carga el fantasma de otro jugador. Devuelve el error para mostrar, o null. */
function takeGhost(input: string): string | null {
  const g = decodeGhost(input);
  if (!g) return 'Ese código de fantasma no se pudo leer';
  if (!catalog.some((c) => c.id === g.track)) return 'El fantasma es de un circuito que no está en la lista';
  const code = encodeGhost(g);
  if (g.track === curCircuit && race) return useRival(race.track, g.track, code);
  if (net && !net.isHost) return 'Estás en una sala: el circuito lo elige el anfitrión';
  saveRival(g.track, code);
  chooseCircuit(g.track, true);
  return null;
}

/** Fantasma para el circuito que ya está cargado. */
function useRival(track: Track, id: string, code: string): string | null {
  const r = rivalFor(track, code);
  if (!r) return 'El fantasma es de otra versión del trazado';
  rival = r;
  saveRival(id, code);
  els.msg.textContent = `Fantasma de ${r.name || 'otro jugador'} cargado: ${fmt(r.lap.t)}`;
  return null;
}

function roomStatus(n: NetRoom | null): string {
  if (netStatus) return netStatus;
  if (!n) return '';
  if (n.peers === 0) return 'Esperando que entre alguien';
  return n.isHost ? 'Cuando estén todos, tocá Largar' : 'Esperando la largada';
}

function roomView(n: NetRoom): MultiState['room'] {
  const members = [...n.members.values()].sort((a, b) => a.since - b.since).map((m) => ({ name: m.name, me: m.me, host: m.id === n.host }));
  return { code: n.code, link: link('sala', n.code), isHost: n.isHost, members };
}

const circuitName = (): string => race?.track.name ?? catalog.find((c) => c.id === curCircuit)?.name ?? '';
const shareLink = (): string | null =>
  best && race ? link('fantasma', encodeGhost({ track: race.track.id, name: cfg.name || 'Jugador', lap: best })) : null;

function multiState(): MultiState {
  return {
    name: cfg.name, code: prefillCode, joining, status: roomStatus(net),
    room: net ? roomView(net) : null,
    circuit: circuitName(),
    share: shareLink(),
    rival: rival ? { name: rival.name || 'otro jugador', t: rival.lap.t } : null,
  };
}

const multiActions: MultiActions = {
  name(v) { const c = cleanName(v); if (c !== cfg.name) { cfg = { ...cfg, name: c }; saveConfig(cfg); } },
  create() { void enterRoom(newRoomCode(), true); },
  join(v) {
    const c = roomCodeOf(v);
    if (c) { void enterRoom(c, false); return; }
    netStatus = 'Ese código de sala no es válido';
    refreshMulti();
  },
  leave: leaveRoom,
  ghost(v) { const e = takeGhost(v); if (!e) refreshMulti(); return e; },
  clearRival() { if (curCircuit) saveRival(curCircuit, null); rival = null; refreshMulti(); },
};

/** El estado se arma cuando el módulo ya está: así se dibuja lo último aunque haya tardado en bajar. */
function refreshMulti(): void {
  if (els.multi.open) lazy(multiModule, (m) => m.renderMulti(els.multi, multiState(), multiActions));
}
function openMulti(): void {
  lazy(multiModule, (m) => {
    m.renderMulti(els.multi, multiState(), multiActions);
    if (!els.multi.open) els.multi.showModal();
  });
}

/** Links compartidos: #sala=código entra a la sala, #fantasma=código carga la vuelta de otro. */
function readHash(): void {
  const h = decodeURIComponent(location.hash.slice(1));
  if (!h) return;
  history.replaceState(null, '', location.href.split('#')[0]);
  if (h.startsWith('sala=')) { const c = roomCodeOf(h); if (c) void enterRoom(c, false); }
  else if (h.startsWith('fantasma=')) { const e = takeGhost(h); if (e) els.msg.textContent = e; }
}

/** Ajustes nuevos: se guardan y se rehace solo lo que cambió (el tema y la calidad rehacen el volante y la pista 3D). */
function applySettings(next: Config): void {
  const prev = cfg;
  cfg = next;
  saveConfig(cfg);
  applyLayout();
  els.log.hidden = !cfg.coach;
  sound.setEnabled(cfg.sound);
  if (next.livery !== prev.livery) livery = pickLivery(next.livery);
  if (next.theme !== prev.theme) { theme = applyTheme(cfg.theme); map.setColors(mapColors()); }
  // Cada cambio por su lado: encadenados, cambiar el esquema y la vista juntos dejaba la vista sin aplicar.
  if (next.theme !== prev.theme || next.quality !== prev.quality) rebuildViews();
  else {
    if (next.livery !== prev.livery) void buildConsole();
    if (next.mapView !== prev.mapView) void applyView();
  }
  if (view) setupConsole(view);
  if (race) { race.opts.difficulty = cfg.difficulty; race.opts.trail = cfg.showTrail; }
  if (net?.isHost) net.sendCfg(myRoomCfg());
}

function rebuildViews(): void {
  void buildConsole();
  rebuild3d();
}

for (const c of catalog) els.circuit.add(new Option(c.name, c.id));
els.circuit.value = catalog.some((c) => c.id === cfg.circuit) ? cfg.circuit : 'ar-1952';
// Elegido con el mouse, el selector suelta el foco para que las teclas vuelvan a la consola.
// Con teclado no: Chrome dispara change en cada flecha o letra y el foco se perdería a mitad de camino.
let byPointer = false;
els.circuit.addEventListener('pointerdown', () => { byPointer = true; });
els.circuit.addEventListener('change', () => {
  if (byPointer) els.circuit.blur();
  byPointer = false;
  chooseCircuit(els.circuit.value, true);
});

els.go.addEventListener('click', () => {
  if (!race) return;
  if (net) { if (net.isHost) hostGo(); return; }
  const running = race.phase === 'count' || race.phase === 'run';
  toGrid();
  if (running) { els.msg.textContent = 'Listo para largar'; return; }
  saveLast(null);
  race.start();
  setGo('Reiniciar');
});
els.pause.addEventListener('click', togglePause);
els.view.addEventListener('click', () => { cfg = { ...cfg, mapView: cfg.mapView === '3d' ? '2d' : '3d' }; saveConfig(cfg); void applyView(); });
byId('btn-help').addEventListener('click', () => lazy(helpModule, (m) => m.openHelp(els.help)));
els.multiBtn.addEventListener('click', () => openMulti());
byId('btn-tel').addEventListener('click', () =>
  lazy(telemetryModule, (m) => m.openTelemetry(els.tel, race?.track ?? null, race?.player.hist ?? [], best)));
byId('btn-settings').addEventListener('click', () => lazy(settingsModule, (m) => m.openSettings(els.settings, cfg, applySettings, installState(), openWelcome)));

/**
 * Bienvenida: nombre, volante, distribución y dificultad, con dibujos. Sola en el primer ingreso y desde ajustes cuando se pida.
 * Lo elegido se aplica como un cambio de ajustes. Al cerrar puede largar o abrir la ayuda; `after` sigue con lo que esperaba (un link).
 */
function openWelcome(after?: () => void): void {
  lazy(welcomeModule, (m) => m.openWelcome(els.welcome, cfg, { theme, shown: livery, canGo: () => !net && race?.phase === 'grid' }, applySettings, (how) => {
    markWelcomed();
    if (how === 'help') lazy(helpModule, (h) => h.openHelp(els.help));
    if (how === 'go' && race && race.phase === 'grid' && !net) els.go.click();
    after?.();
  }));
}

/** Escribiendo en un campo o con un diálogo abierto, las teclas no son de la consola. */
const typing = (t: HTMLElement | null): boolean => !!t && (!!t.closest('dialog') || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName));

/** Espacio pausa. Con un botón enfocado, espacio lo apretaría (Largar reinicia la carrera): se pausa igual. */
function onSpace(e: KeyboardEvent, t: HTMLElement | null): void {
  if (t?.tagName === 'BUTTON') t.blur();
  e.preventDefault();
  if (!e.repeat) togglePause();
}

// El audio arranca con el primer gesto. En una pantalla táctil el navegador cuenta como gesto el toque al soltar, no al apoyar.
for (const ev of ['pointerdown', 'pointerup', 'touchend'] as const) document.addEventListener(ev, () => sound.unlock(), { capture: true, passive: true });
document.addEventListener('keydown', (e) => {
  sound.unlock();
  const t = e.target instanceof HTMLElement ? e.target : null;
  // Los atajos del navegador (Ctrl+R, Ctrl+P, Alt+flechas) no son teclas de la consola.
  if (e.ctrlKey || e.metaKey || e.altKey || typing(t)) return;
  if (e.code === 'Space') { onSpace(e, t); return; }
  if (view?.handleKey(e)) e.preventDefault();
});

// En una pestaña oculta el loop se frena y el motor quedaría sonando con el último tono. Jugando solo, además, se pausa:
// una llamada o cambiar de aplicación en el teléfono no larga de golpe la carrera al volver.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  sound.engine(0, 0);
  if (race && !race.paused) togglePause();
});

landscape.addEventListener('change', placeMap);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (cfg.theme !== 'auto') return;
  theme = applyTheme('auto');
  map.setColors(mapColors());
  rebuildViews();
});

applyLayout();
els.log.hidden = !cfg.coach;
setGo('Largar');
watchInstall();
registerWorker();
void buildConsole();
void applyView();
void selectCircuit(els.circuit.value);
// Primer ingreso: la bienvenida va primero, y un link de sala o de fantasma se atiende al cerrarla (la sala pide el nombre que se pone ahí).
if (firstRun()) openWelcome(readHash);
else readHash();
// Si la pestaña se recargó justo al terminar, la tabla de resultados vuelve a aparecer.
const lastRes = loadLast();
if (lastRes) openResultsDialog(catalog.find((c) => c.id === lastRes.circuit)?.name ?? lastRes.circuit, lastRes);
window.addEventListener('hashchange', readHash);

const panelKey = (): string => `${panel.lev}${panel.ers}${panel.dif}${panel.eb}${panel.bal}${panel.lim}${panel.grd}${panel.rst.join('')}`;
let last = performance.now(), hudT = 1, pk = panelKey(), cd = 0, netT = 0;
const idle = idleGauges();

/** Cuenta regresiva: un pitido por número. */
function countdown(r: Race): void {
  if (r.phase !== 'count' || r.paused) { cd = 0; return; }
  const c = Math.max(1, Math.ceil(r.cd));
  if (c !== cd) { cd = c; sound.beep(false); }
  setText(els.msg, `Largada en ${c}`);
}

/** En una sala, la posición de tu auto sale cada SNAP_DT. */
function sendSnap(r: Race, dt: number): void {
  netT += dt;
  if (!net || raceN === 0 || r.phase === 'grid' || netT < SNAP_DT) return;
  netT = 0;
  net.sendSnap({ n: raceN, ...snapOf(r.player, r.track.len, r.t) });
}

function stepRace(r: Race, dt: number): void {
  const t0 = r.t;
  for (const ev of r.step(dt, timeScale(), panel)) onEvent(ev);
  const p = r.player;
  // En tiempo de carrera: en pausa no avanza y a ×3 cuenta lo mismo que a ×1.
  if (r.green && !p.done) coach.step({ ty: p.ty, ctl: { ...panel }, fuse: p.fuse.slice(), bat: p.bat, bal: balWant(p), temp: p.temp, soon: gauges(r).soon }, r.t - t0);
  countdown(r);
  checkLap();
  sendSnap(r, dt);
}

/** Mapa o pista 3D. Mientras la pista 3D se baja, sigue el mapa. */
function drawTrack(dt: number): void {
  const ghosts = race ? ghostsAt(race) : [];
  if (cfg.mapView === '3d' && view3d) view3d.draw(race, ghosts, cfg.showBraking, dt, cfg.fxBrakes);
  else map.draw(race, { braking: cfg.showBraking, trail: cfg.showTrail, ghosts, losses: cfg.fxLosses ? lapMarks : [] });
}

function frame(now: number): void {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (race) stepRace(race, dt);
  // Pasada la meta el auto sigue andando solo: el motor quedaba sonando parejo detrás de la tabla de resultados.
  sound.engine(race && running(race) && !race.player.done ? race.player.v : 0, panel.lev);
  const k = panelKey();
  if (k !== pk) { pk = k; sound.click(); buzz(cfg.haptics, BUZZ.tap); }
  awake.set(running(race));
  view?.update(dt, race ? gauges(race) : idle);
  drawTrack(dt);
  hudT += dt;
  if (hudT > 0.15) { hudT = 0; hud(); }
  requestAnimationFrame(safeFrame);
}
/** El auto anda (cuenta regresiva o carrera, sin pausa) y se ve: la pantalla del teléfono no se apaga. */
const running = (r: Race | null): boolean => !!r && !r.paused && (r.phase === 'count' || r.phase === 'run') && !document.hidden;
/** Un error en un cuadro no puede frenar el loop: la pantalla quedaría congelada justo al terminar. */
function safeFrame(now: number): void {
  try { frame(now); } catch (e) { console.error(e); requestAnimationFrame(safeFrame); }
}
requestAnimationFrame(safeFrame);
