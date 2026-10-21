import * as THREE from 'three';
import { InkRenderer, type Palette } from '../render/ink';
import { Parts } from '../render/parts';
import { Redraw, setStyle, setText } from '../render/redraw';
import type { Knob } from '../sim/score';
import type { Seg } from '../sim/types';
import { KNOB_NAMES, SEG_NAMES, cap, f1 } from '../ui/format';
import { PHYS } from '../sim/physics';
import { ALERT_COLORS, BODY_OUTLINE, DELTA_COLORS, FACE_OUTLINE, LED_COLOR, LED_GROUPS, faceDecals, idleGauges, type ConsoleFx, type GaugeSource, type PanelState, type WheelColors } from './panel';

export * from './panel';

/**
 * Volante de F1 visto de frente, en milímetros (x a la derecha, y arriba). Medidas de un volante
 * real de la era híbrida: unos 270 × 175, empuñaduras de 170, pantalla de 4,3" arriba al centro,
 * 15 LEDs de cambio arriba, rotativos abajo, BB y limitador bajo los pulgares.
 */
const BODY_T = 22;
/** Cámara: casi de frente, con un margen chico de giro. */
const AZ_MAX = (8 * Math.PI) / 180;
const EL0 = (6 * Math.PI) / 180;
const EL_MAX = (11 * Math.PI) / 180;
const NEAR = 200;
const FAR = 800;
/**
 * Encuadre: volante entero (con empuñaduras y levas, unos ±168 mm de ancho y ±112 de alto con etiquetas) o, cuando así
 * queda chico, el frente hasta las empuñaduras: ±141 de ancho (abiertas 5°, asoman apenas las levas) y ±102 de alto alrededor
 * de y = 4, para que entre la sugerencia de dos renglones debajo de los rotativos. En un teléfono vertical sale 1,2 veces más grande que el volante entero y ninguna
 * empuñadura queda cortada. Girando (difícil, hasta 90°) hace falta el círculo que barre cada uno: 168 y 165.
 */
const FULL = { w: 168, h: 112, turn: 168 };
const FACE = { w: 141, h: 102, turn: 165 };
/** Por debajo de esta escala (px por mm) con el volante entero, se encuadra el frente. */
export const FACE_BELOW = 1.6;

/** Media altura visible (mm) y si se encuadra el frente, para una caja de w × h px. */
export function frameFor(w: number, h: number, turning: boolean): { hh: number; face: boolean } {
  const fit = (f: typeof FULL): number => {
    const as = w / h, half = turning ? f.turn : f.h, wide = turning ? f.turn : f.w;
    return Math.max(half, wide / as);
  };
  const full = fit(FULL);
  return h / (2 * full) < FACE_BELOW ? { hh: fit(FACE), face: true } : { hh: full, face: false };
}
/** Escala de la barra de motor en pantalla (°): la zona roja arranca en PHYS.TEMP_LIMIT. */
const TEMP_BAR = [60, 120];
const BAL_BAR = [50, 65];
/** Rotativos de tres posiciones: ángulo de cada una y orden de izquierda a derecha. */
const DETENT = [-Math.PI / 4, 0, Math.PI / 4];
/** Radio del anillo donde está impresa la marca de cada posición (mm). */
const DETENT_R = 15;
/** Posición cuya marca queda más cerca, a lo ancho del volante, de donde se tocó (dx: mm desde el centro de la perilla). */
export const detentAt = (dx: number): number => {
  const gap = DETENT.map((a) => Math.abs(dx - Math.sin(a) * DETENT_R));
  return gap.indexOf(Math.min(...gap));
};
const ROTARIES: [Knob & ('lev' | 'ers' | 'dif' | 'eb'), number][] = [['ers', -66], ['lev', -22], ['dif', 22], ['eb', 66]];
const ROT_Y = -46;
/** Pantalla: centro, tamaño y barras (de arriba hacia abajo). */
const SCR = { y: 28, w: 104, h: 58, x0: -48, x1: 12 };
const BARS = [52, 43, 34, 25, 16];
/** Barra de delta, la última de la pantalla: crece desde el centro, hacia la derecha perdiendo y hacia la izquierda ganando. */
const DELTA_Y = 6;
const DELTA_RANGE = 2;
/** Cuánto dura el destello de tramo bien configurado (s). */
const FLASH_T = 0.15;
const FUSE_X = [-22, 0, 22];
/** Bajo la pantalla, apoyado sin cruzar su marco (que llega a y = -5). */
const FUSE_Y = -16;
const FUSE_NAMES = ['ERS', 'diferencial', 'freno motor'];
const SEG_ORDER: Seg[] = ['s', 'b', 'c', 'x'];
const N = KNOB_NAMES;
/** Segundos que se sigue dibujando después del último cambio: lo que tardan las piezas en llegar a su lugar. */
const SETTLE = 1.5;
/** Teclas de la consola: control que accionan, en el orden en que se ven (ERS, potencia, diferencial, freno motor). Las de selector no repiten al mantenerlas. */
const KEY_ACT = new Map([['q', 'ers'], ['w', 'lev'], ['e', 'dif'], ['r', 'eb'], ['1', 'f0'], ['2', 'f1'], ['3', 'f2'], ['a', 'bb-'], ['d', 'bb+']]);
const NO_REPEAT = new Set(['q', 'w', 'e', 'r', '1', '2', '3', 'p']);
const ease = (c: number, t: number, k: number): number => c + (t - c) * k;
const isRotary = (c: string): c is (typeof ROTARIES)[number][0] => ROTARIES.some(([kn]) => kn === c);

type Align = 'down' | 'up' | 'in' | 'left' | 'right';
interface Label { obj: THREE.Object3D; local: THREE.Vector3; value: () => string; el: HTMLDivElement; valEl: HTMLDivElement; align: Align; knob?: Knob; hinted: boolean; stagger: boolean; when?: () => boolean }
/** Etiquetas de rotativos que en caja chica pasan arriba de su perilla, alternadas con las de abajo. */
const ROT_UP = 2 * 17;

const KNOB_OF: Record<string, Knob> = { Potencia: 'lev', ERS: 'ers', Frenos: 'bal', Diferencial: 'dif', 'Freno motor': 'eb' };
const knobText = (k: Knob, v: number): string => (k === 'bal' ? `${v} %` : cap(KNOB_NAMES[k][v]));
const ALIGN: Record<Align, string> = {
  down: 'translate(-50%, 4px)', up: 'translate(-50%, calc(-100% - 4px))', in: 'translate(0, -50%)',
  left: 'translate(calc(-100% - 6px), -50%)', right: 'translate(6px, -50%)',
};

interface Moving {
  wheel: THREE.Group; rot: Record<string, THREE.Group>; guard: THREE.Group; limBtn: THREE.Group; fuses: THREE.Group[];
  needles: THREE.Group[]; bb: THREE.Group[];
  /** Marca azul bajo la barra de frenos: el balance que piden las frenadas. */
  balWant: THREE.Group;
  /** Marcas de posición de cada rotativo, para resaltar la de destino. */
  marks: Record<string, THREE.Mesh[]>;
  delta: THREE.Group; deltaFill: THREE.Mesh;
}

export class ConsoleView {
  showLabels = true;
  fx: ConsoleFx = { leds: true, aim: true, flash: true, delta: true };
  private readonly ink: InkRenderer;
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, NEAR, FAR);
  private readonly target = new THREE.Vector3(0, 4, 0);
  private readonly parts: Parts;
  /** Alertas (batería, motor, limitador, falla) y después los 15 LEDs de cambio, de izquierda a derecha. */
  private readonly lamps: THREE.ShaderMaterial[] = [];
  private readonly lampOn: number[] = [];
  /** Rotativo y posición que quedaría con el puntero donde está. */
  private aim: { kn: string; i: number } | null = null;
  private lastTy: Seg | null = null;
  private flashT = 0;
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly tmp = new THREE.Vector3();
  private readonly ac = new AbortController();
  private readonly ro: ResizeObserver;
  /** Frente del volante: y local hacia la cámara, posición (x, y) del frente en (x, -z) local. */
  private face!: THREE.Group;
  private g!: Moving;
  private labels: Label[] = [];
  private gauges: GaugeSource = idleGauges();
  private az = 0;
  private el = EL0;
  private azT = 0;
  private elT = EL0;
  private drag = false;
  private px = 0;
  private py = 0;
  private labelT = 1;
  private clock = 0;
  private bbPress = [0, 0];
  /** En difícil el volante gira hasta 90°: el encuadre deja lugar para eso. Si no, se aprovecha el alto. */
  private steerRoom = false;
  /** Encuadre del frente, sin empuñaduras: las etiquetas de los costados quedarían afuera y van como en caja chica. */
  private faceFit = false;
  /** Puntero que arrastra la vista: con dos dedos, el segundo no la hace saltar. */
  private dragId = -1;
  /** Tamaño de la caja, medido por el ResizeObserver: leerlo en cada cuadro fuerza un cálculo de layout. */
  private w = 0;
  private h = 0;
  /** Último movimiento del puntero sin procesar: el raycast se hace una vez por cuadro, no en cada evento. */
  private hover: PointerEvent | null = null;
  private cursor = '';
  private readonly redraw = new Redraw(SETTLE);
  /** Mapa en la pantalla: el elemento va sobre el vidrio y las lecturas de la pantalla pasan al HUD, un renglón arriba de la caja. */
  private screenEl: HTMLElement | null = null;
  /** Tamaño del vidrio en px a la escala actual. */
  private scrPx: [number, number] = [1, 1];
  private readonly hud = document.createElement('div');

  constructor(private readonly box: HTMLElement, private readonly labelBox: HTMLElement, readonly panel: PanelState, pal: Palette, quality: number, wheel: WheelColors) {
    this.ink = new InkRenderer(pal, quality, FAR - NEAR);
    box.insertBefore(this.ink.canvas, box.firstChild);
    this.parts = new Parts(this.ink, this.scene);
    this.build(pal, wheel);
    this.scene.updateMatrixWorld();
    this.makeLabels();
    this.hud.className = 'hud';
    this.bindPointer();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(box);
    this.resize();
    this.applyCamera();
  }

  setSteerRoom(on: boolean): void { this.steerRoom = on; this.resize(); }

  /** Pone el elemento (dentro de la caja de la consola) sobre el vidrio de la pantalla, o lo suelta con null. */
  setScreenMap(el: HTMLElement | null): void {
    if (el === this.screenEl) return;
    if (this.screenEl) { setStyle(this.screenEl, 'transform', ''); this.screenEl.style.width = this.screenEl.style.height = ''; }
    this.screenEl = el;
    for (const l of this.labels) if (l.align === 'in') {
      setStyle(l.el, 'transform', 'none');
      l.el.classList.remove('compact');
      (el ? this.hud : this.labelBox).appendChild(l.el);
    }
    if (el) this.box.before(this.hud); else this.hud.remove();
    this.resize();
  }

  /** Teclas de la consola. Devuelve true si la tecla se usó. */
  handleKey(e: KeyboardEvent): boolean {
    const k = e.key.toLowerCase();
    // Mantener apretada una tecla de selector la haría dar vueltas: esas no repiten. El resto de las teclas (Tab, F5…) sigue su curso.
    if (e.repeat && NO_REPEAT.has(k)) return true;
    if (!this.keyAction(k, e.key)) return false;
    this.refreshLabels();
    return true;
  }

  private keyAction(k: string, key: string): boolean {
    const c = KEY_ACT.get(k);
    if (c) this.act(c);
    else if (k === 'p') { this.panel.grd = true; this.panel.lim = !this.panel.lim; }
    else if (key === 'ArrowLeft') this.nudge(1);
    else if (key === 'ArrowRight') this.nudge(-1);
    else return false;
    return true;
  }

  /** Medio margen de giro de cámara hacia un lado. */
  private nudge(dir: number): void {
    this.azT = Math.max(-AZ_MAX, Math.min(AZ_MAX, this.azT + (dir * AZ_MAX) / 2));
  }

  update(dt: number, gauges: GaugeSource): void {
    this.gauges = gauges;
    this.clock += dt;
    this.hoverNow();
    // Quieto (grilla, pausa, menú) no se vuelve a dibujar: la GPU queda libre. El parpadeo sí necesita cada cuadro.
    if (!this.redraw.need(this.stateKey(), dt) && !this.blinking()) return;
    const k = 1 - Math.exp(-dt * 12);
    this.az = ease(this.az, this.azT, k * 0.8);
    this.el = ease(this.el, this.elT, k * 0.8);
    this.applyCamera();
    this.moveParts(dt, k);
    this.moveNeedles(k);
    this.lightLamps(dt, k);
    this.markAim();
    this.showDelta();
    this.labelT += dt;
    if (this.labelT > 0.15) { this.labelT = 0; this.refreshLabels(); }
    this.scene.updateMatrixWorld();
    this.placeLabels();
    this.ink.render(this.scene, this.cam);
  }

  /** Todo lo que puede cambiar la imagen. Si no cambió, alcanza con lo que ya está dibujado. */
  private stateKey(): string {
    return JSON.stringify([this.gauges, this.panel, this.azT, this.elT, this.aim, this.fx, this.showLabels, this.bbPress.some((t) => t > 0), this.flashT > 0]);
  }

  private blinking(): boolean {
    const g = this.gauges;
    return g.fuse.some(Boolean) || (g.soon && !this.fx.leds);
  }

  private moveParts(dt: number, k: number): void {
    const P = this.panel, g = this.g, G = this.gauges;
    // El volante replica al auto: más lento que los controles, como una dirección con inercia.
    g.wheel.rotation.z = ease(g.wheel.rotation.z, G.steer, k * 0.5);
    for (const [kn] of ROTARIES) g.rot[kn].rotation.y = ease(g.rot[kn].rotation.y, -DETENT[P[kn]], k);
    g.guard.rotation.x = ease(g.guard.rotation.x, P.grd ? -2.2 : 0, k * 0.7);
    g.limBtn.position.y = ease(g.limBtn.position.y, BODY_T + (P.lim ? 0.4 : 2.2), k);
    g.fuses.forEach((f, i) => { f.position.y = ease(f.position.y, BODY_T + 1 + (G.fuse[i] ? 4 : 0), k * 1.5); });
    this.bbPress = this.bbPress.map((t) => Math.max(0, t - dt));
    g.bb.forEach((b, i) => { b.position.y = ease(b.position.y, BODY_T + (this.bbPress[i] > 0 ? 0.6 : 2.4), k * 2); });
  }

  private moveNeedles(k: number): void {
    const G = this.gauges, clamp = (v: number): number => Math.max(0, Math.min(1, v));
    const frac = [
      G.bat / 100,
      (G.temp - TEMP_BAR[0]) / (TEMP_BAR[1] - TEMP_BAR[0]),
      G.fuel / G.fuelMax,
      G.tyre / 100,
      (this.panel.bal - BAL_BAR[0]) / (BAL_BAR[1] - BAL_BAR[0]),
    ];
    const at = (f: number): number => SCR.x0 + (SCR.x1 - SCR.x0) * clamp(f);
    this.g.needles.forEach((nd, i) => { nd.position.x = ease(nd.position.x, at(frac[i]), k * 0.6); });
    this.g.balWant.position.x = ease(this.g.balWant.position.x, at((G.bal - BAL_BAR[0]) / (BAL_BAR[1] - BAL_BAR[0])), k * 0.6);
  }

  /** Destello: al entrar a un tramo nuevo con la consola justa, la barra entera se prende un instante. */
  private enteredRight(): boolean {
    const G = this.gauges;
    return G.live && this.lastTy !== null && G.ty !== this.lastTy && G.sc >= 0.999 && this.fx.flash;
  }

  private lightLamps(dt: number, k: number): void {
    const G = this.gauges, blink = Math.sin(this.clock * Math.PI * 6) > 0;
    if (this.enteredRight()) this.flashT = FLASH_T;
    this.lastTy = G.live ? G.ty : null;
    this.flashT = Math.max(0, this.flashT - dt);
    const flash = this.flashT > 0;
    const on = [G.bat < PHYS.BAT_LOW, G.temp >= PHYS.TEMP_LIMIT, this.panel.lim, G.fuse.some(Boolean) && blink, ...this.ledsOn(flash, blink)];
    on.forEach((o, i) => {
      this.lampOn[i] = flash && i >= 4 ? 1 : ease(this.lampOn[i] ?? 0, o ? 1 : 0, k * 1.6);
      this.lamps[i].uniforms.uOn.value = this.lampOn[i];
    });
  }

  /** El grupo del tramo actual prendido; el del siguiente parpadea, o se llena de izquierda a derecha a medida que se acerca. */
  private ledsOn(flash: boolean, blink: boolean): boolean[] {
    const G = this.gauges, out: boolean[] = [];
    LED_GROUPS.forEach((n, gi) => {
      const s = SEG_ORDER[gi], coming = G.soon && s === G.next;
      for (let j = 0; j < n; j++) out.push(flash || s === G.ty || (coming && this.filled(j, n, blink)));
    });
    return out;
  }

  private filled(j: number, n: number, blink: boolean): boolean {
    return this.fx.leds ? j < Math.ceil(this.gauges.lead * n) : blink;
  }

  private markAim(): void {
    for (const [kn] of ROTARIES) this.g.marks[kn].forEach((m, i) => {
      const t = this.aim?.kn === kn && this.aim.i === i;
      m.scale.set(t ? 3.5 : 1, 1, t ? 1.5 : 1);
    });
  }

  private showDelta(): void {
    const g = this.g, d = this.gauges.delta;
    g.delta.visible = this.fx.delta;
    const dl = d === null ? 0 : Math.max(-1, Math.min(1, d / DELTA_RANGE)), half = (SCR.x1 - SCR.x0) / 2;
    g.deltaFill.visible = dl !== 0;
    g.deltaFill.scale.x = Math.max(0.01, Math.abs(dl) * half);
    g.deltaFill.position.x = (SCR.x0 + SCR.x1) / 2 + (dl * half) / 2;
    ((g.deltaFill.material as THREE.ShaderMaterial).uniforms.uE.value as THREE.Color).setHex(dl > 0 ? DELTA_COLORS.lose : DELTA_COLORS.gain);
  }

  dispose(): void {
    this.ac.abort();
    this.ro.disconnect();
    this.scene.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.ink.dispose();
    this.ink.canvas.remove();
    this.labelBox.replaceChildren();
    this.hud.remove();
  }

  /** Contorno en el plano del frente (x, y en mm), extruido hacia la cámara y apoyado en el frente local. */
  private plate(pts: [number, number][], depth: number, bevel: number, hex: number, y0: number): THREE.Mesh {
    const s = new THREE.Shape();
    pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
    const geo = new THREE.ExtrudeGeometry(s, { depth: depth - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8 });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, bevel, 0);
    return this.parts.add(geo, this.ink.tone(hex), 0, y0, 0, this.face);
  }

  /** Área de clic invisible más grande que la pieza: los controles reales miden 14 a 24 mm. */
  private hitArea(r: number, x: number, fy: number, ctl: string, parent: THREE.Object3D = this.face, h = BODY_T + 8): void {
    const m = this.parts.add(new THREE.CylinderGeometry(r, r, h, 20), this.ink.inkMat, x, h / 2, -fy, parent, false, ctl);
    m.visible = false;
  }

  /**
   * Área de toque rectangular, de x0 a x1 y de y0 a y1 en el frente (mm). Los botones chicos van pegados (BB a 22 mm, fusibles a 22):
   * cada área llega hasta la del vecino y se estira hacia donde no hay otro control, para acercarse a los 44 px del dedo.
   */
  private hitBox(x0: number, x1: number, y0: number, y1: number, ctl: string, h = BODY_T + 8): void {
    const m = this.parts.add(new THREE.BoxGeometry(x1 - x0, h, y1 - y0), this.ink.inkMat, (x0 + x1) / 2, h / 2, -(y0 + y1) / 2, this.face, false, ctl);
    m.visible = false;
  }

  private build(pal: Palette, wc: WheelColors): void {
    const p = this.parts, ink = this.ink, s = this.scene;
    const wheel = new THREE.Group();
    s.add(wheel);
    const face = new THREE.Group();
    face.rotation.x = Math.PI / 2;
    wheel.add(face);
    this.face = face;

    // Cuerpo y placa del frente, con las calcomanías del esquema pintadas encima (capa 1: sin contornos).
    this.plate(BODY_OUTLINE, BODY_T - 2, 3, wc.body, 0);
    this.plate(FACE_OUTLINE, 2, 0.6, wc.face, BODY_T - 2);
    faceDecals(wc).forEach((d, i) => {
      const geo = new THREE.ShapeGeometry(new THREE.Shape(d.pts.map(([x, y]) => new THREE.Vector2(x, y))));
      geo.rotateX(-Math.PI / 2);
      p.add(geo, ink.tone(d.hex), 0, BODY_T + 0.05 + i * 0.02, 0, face, true);
    });

    // Empuñaduras de goma, un poco abiertas arriba, con los topes en tono claro.
    for (const sg of [-1, 1]) {
      const grip = new THREE.Group();
      grip.position.set(sg * 117, BODY_T / 2, 0);
      // Arriba se abren hacia afuera: girar sobre la normal del frente.
      grip.rotation.y = (-sg * 5 * Math.PI) / 180;
      face.add(grip);
      const cap = new THREE.CapsuleGeometry(18, 134, 6, 20);
      cap.rotateX(Math.PI / 2);
      p.add(cap, ink.tone(wc.grip), 0, 0, 0, grip);
      for (let r = -50; r <= 50; r += 10) p.mark(18, 0.5, 0, 18.1, r, grip);
      // Levas de cambio atrás, asomando por fuera de la empuñadura.
      p.box(30, 4, 56, wc.body, sg * 22, -BODY_T / 2 - 8, -20, grip);
    }
    // Buje de liberación rápida, atrás al centro.
    p.cyl(27, 26, wc.body, 0, -26, 0, face, 40);

    // Pantalla de 4,3": marco, vidrio y cinco barras con su aguja.
    p.slab(SCR.w + 8, SCR.h + 8, 2.4, 3, 0.6, pal.hi, 0, BODY_T, -SCR.y, face);
    p.slab(SCR.w, SCR.h, 0.6, 1.5, 0.2, pal.mid, 0, BODY_T + 2.4, -SCR.y, face);
    const zy = BODY_T + 3;
    const red = (from: number, to: number, fy: number): void => {
      const a = SCR.x0 + (SCR.x1 - SCR.x0) * from, b = SCR.x0 + (SCR.x1 - SCR.x0) * to;
      p.mark(b - a, 1.2, (a + b) / 2, zy + 0.3, -fy + 2.4, face, 0, ink.redMat);
    };
    const needles = BARS.map((fy) => {
      // La pista apoya sobre el vidrio (no en su mismo plano, que titila) y las marcas van encima.
      p.box(SCR.x1 - SCR.x0, 0.3, 1.4, pal.slot, (SCR.x0 + SCR.x1) / 2, zy, -fy, face);
      for (let i = 0; i <= 10; i++) p.mark(0.3, i % 5 === 0 ? 3 : 1.6, SCR.x0 + ((SCR.x1 - SCR.x0) * i) / 10, zy + 0.3, -fy + 2.4, face);
      const nd = new THREE.Group();
      nd.position.set(SCR.x0, zy + 0.3, -fy);
      face.add(nd);
      p.box(1, 0.6, 7, pal.lit, 0, 0, 0, nd);
      return nd;
    });
    red(0, PHYS.BAT_LOW / 100, BARS[0]);
    red((PHYS.TEMP_LIMIT - TEMP_BAR[0]) / (TEMP_BAR[1] - TEMP_BAR[0]), 1, BARS[1]);
    red(0, 0.2, BARS[2]);
    red(0, 0.2, BARS[3]);
    // Balance pedido: una marca azul bajo la barra de frenos, como las sugerencias del modo fácil. Se corre con la nafta.
    const balWant = new THREE.Group();
    balWant.position.set(SCR.x0, zy + 0.3, -BARS[4]);
    face.add(balWant);
    const wantMat = ink.tone(pal.mid, LED_COLOR);
    wantMat.uniforms.uOn.value = 1;
    p.add(new THREE.BoxGeometry(2.2, 0.6, 2.2), wantMat, 0, 0, 3.4, balWant);
    // Delta: pista con marca al medio (cero) y un relleno que crece desde ahí, con color solo porque el color es el dato.
    const delta = new THREE.Group();
    face.add(delta);
    p.box(SCR.x1 - SCR.x0, 0.3, 1.4, pal.slot, (SCR.x0 + SCR.x1) / 2, zy, -DELTA_Y, delta);
    for (let i = 0; i <= 4; i++) p.mark(0.3, i === 2 ? 4 : 1.6, SCR.x0 + ((SCR.x1 - SCR.x0) * i) / 4, zy + 0.3, -DELTA_Y + 2.4, delta);
    const fillMat = ink.tone(pal.mid, DELTA_COLORS.gain);
    fillMat.uniforms.uOn.value = 1;
    const deltaFill = p.add(new THREE.BoxGeometry(1, 0.6, 3), fillMat, 0, zy + 0.6, -DELTA_Y, delta);

    // Luces de cambio: 15 LEDs en cuatro grupos, uno por tipo de tramo.
    const alertAt: [number, number][] = [[-62, 40], [-62, 16], [62, 40], [62, 16]];
    alertAt.forEach(([x, fy], i) => {
      p.cyl(5, 1.2, pal.hi, x, BODY_T, -fy, face, 28);
      const m = ink.tone(pal.mid, ALERT_COLORS[i]);
      this.lamps.push(m);
      p.dome(4, m, x, BODY_T + 1.2, -fy, face);
    });
    // Un material por LED: el grupo del tramo siguiente se llena de a uno.
    for (let led = 0; led < LED_GROUPS.reduce((a, n) => a + n, 0); led++) {
      const m = ink.tone(pal.mid, LED_COLOR), x = -52.5 + led * 7.5;
      this.lamps.push(m);
      p.cyl(3.4, 1, pal.hi, x, BODY_T, -64, face, 20);
      p.dome(2.8, m, x, BODY_T + 1, -64, face);
    }
    [4, 8, 12].forEach((i) => p.mark(0.4, 7, -52.5 + 7.5 * (i - 0.5), BODY_T + 0.1, -64, face));

    // Frenos: BB+ arriba y BB− abajo, bajo el pulgar izquierdo.
    // Áreas: hasta el borde del frente a la izquierda y hasta el ERS a la derecha; entre las dos, el medio de los botones.
    // Línea índice de perillas y BB: oscura sobre tapa clara y clara sobre tapa oscura, sea cual sea el tema.
    const capC = new THREE.Color(wc.cap ?? wc.knob), capL = 0.2126 * capC.r + 0.7152 * capC.g + 0.0722 * capC.b;
    const idx = ink.tone(capL > 0.35 ? 0x111114 : 0xf2f2f2);
    const bbHit: Record<string, [number, number]> = { 'bb+': [23, 46], 'bb-': [-2, 23] };
    const bb = ([[34, 'bb+'], [12, 'bb-']] as [number, string][]).map(([fy, ctl]) => {
      p.cyl(9, 1.2, pal.mid, -84, BODY_T, -fy, face, 28);
      const b = new THREE.Group();
      b.position.set(-84, BODY_T + 2.4, -fy);
      face.add(b);
      p.cyl(7, 2.6, wc.cap ?? wc.knob, 0, 0, 0, b, 28, ctl);
      p.mark(5, 0.8, 0, 2.6, 0, b, 0, idx);
      if (ctl === 'bb+') p.mark(0.8, 5, 0, 2.6, 0, b, 0, idx);
      this.hitBox(-98, -66, ...bbHit[ctl], ctl);
      return b;
    });

    // Limitador: botón arriba a la derecha bajo una tapa con bisagra arriba.
    p.cyl(10, 1.2, pal.mid, 84, BODY_T, -56, face, 28);
    const limBtn = new THREE.Group();
    limBtn.position.set(84, BODY_T + 2.2, -56);
    face.add(limBtn);
    p.cyl(7, 2.4, wc.knob, 0, 0, 0, limBtn, 28, 'lim');
    this.hitArea(14, 84, 56, 'lim', face, BODY_T + 4);
    const hinge = new THREE.CylinderGeometry(1.4, 1.4, 22, 16);
    hinge.rotateZ(Math.PI / 2);
    p.add(hinge, ink.tone(pal.mid), 84, BODY_T + 1.4, -68, face);
    const guard = new THREE.Group();
    guard.position.set(84, BODY_T + 1.4, -68);
    face.add(guard);
    p.box(22, 1, 22, wc.knob, 0, 5.4, 11, guard, 'grd');
    p.box(1, 6, 22, wc.knob, -10.5, 0, 11, guard, 'grd');
    p.box(1, 6, 22, wc.knob, 10.5, 0, 11, guard, 'grd');
    // Cerrada, el área de la tapa cubre entera la del limitador: un toque en el borde abre la tapa en vez de no hacer nada.
    const gh = this.parts.add(new THREE.BoxGeometry(30, 8, 30), this.ink.inkMat, 0, 4, 11, guard, false, 'grd');
    gh.visible = false;

    // Fusibles: tres botones rebajados que saltan y muestran la banda roja.
    p.slab(70, 22, 1, 3, 0.3, pal.mid, 0, BODY_T, -FUSE_Y, face);
    const fuses = FUSE_X.map((x, i) => {
      p.cyl(9, 1.6, pal.hi, x, BODY_T, -FUSE_Y, face, 28);
      const f = new THREE.Group();
      f.position.set(x, BODY_T + 1, -FUSE_Y);
      face.add(f);
      p.add(new THREE.CylinderGeometry(5.6, 5.6, 4, 20), ink.redMat, 0, -2, 0, f, false, `f${i}`);
      p.cyl(6.2, 1.6, wc.knob, 0, 0, 0, f, 24, `f${i}`);
      p.mark(4, 0.6, 0, 1.6, 0, f);
      // Del medio entre fusibles al del vecino; arriba hasta el marco de la pantalla y abajo hasta el área de los rotativos.
      this.hitBox(x - 11, x + 11, -26, -4, `f${i}`);
      return f;
    });

    // Rotativos: anillo con tres marcas y perilla moleteada con línea índice.
    const rot: Record<string, THREE.Group> = {}, marks: Record<string, THREE.Mesh[]> = {};
    for (const [kn, x] of ROTARIES) {
      p.cyl(17, 2, pal.mid, x, BODY_T, -ROT_Y, face, 40);
      marks[kn] = DETENT.map((a) => p.mark(0.8, 3, x + Math.sin(a) * DETENT_R, BODY_T + 2, -ROT_Y - Math.cos(a) * DETENT_R, face, -a));
      const g = new THREE.Group();
      g.position.set(x, BODY_T + 2, -ROT_Y);
      face.add(g);
      p.cyl(12, 9, wc.knob, 0, 0, 0, g, 36, kn);
      p.cyl(10.5, 1, wc.cap ?? wc.knob, 0, 9, 0, g, 36, kn);
      p.mark(1.2, 7, 0, 10, -5, g, 0, idx);
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const o = p.add(new THREE.PlaneGeometry(0.4, 7.6), ink.inkMat, Math.sin(a) * 12.06, 4.5, Math.cos(a) * 12.06, g, true);
        o.rotation.y = a;
      }
      // 20 mm: casi tocan al vecino (están a 44) y no llegan a los fusibles. Con el dedo, la marca de los costados queda a mano.
      this.hitArea(20, x, ROT_Y, kn);
      rot[kn] = g;
    }

    this.g = { wheel, rot, guard, limBtn, fuses, needles, bb, marks, delta, deltaFill, balWant };
    const P = this.panel;
    for (const [kn] of ROTARIES) rot[kn].rotation.y = -DETENT[P[kn]];
    guard.rotation.x = P.grd ? -2.2 : 0;
  }

  private makeLabels(): void {
    const P = this.panel, G = (): GaugeSource => this.gauges, f = this.face;
    const at = (x: number, fy: number, up = BODY_T): THREE.Vector3 => new THREE.Vector3(x, up, -fy);
    const screen = (i: number): THREE.Vector3 => at(SCR.x1 + 3, BARS[i], BODY_T + 3.3);
    const defs: [THREE.Vector3, string, () => string, Align][] = [
      [at(0, 70), 'Tramo', () => {
        const g = G();
        return g.soon ? `${cap(SEG_NAMES[g.ty])} → ${SEG_NAMES[g.next]} en ${Math.round(g.dist)} m` : cap(SEG_NAMES[g.ty]);
      }, 'up'],
      [at(68, 28), 'Alertas', () => {
        const g = G(), a = [g.bat < PHYS.BAT_LOW && 'batería', g.temp >= PHYS.TEMP_LIMIT && 'motor', P.lim && 'pit', g.fuse.some(Boolean) && 'falla'].filter(Boolean);
        return a.length ? cap(a.join(' · ')) : 'Ninguna';
      }, 'right'],
      [screen(0), 'Carga', () => `${Math.round(G().bat)} %`, 'in'],
      [screen(1), 'Motor', () => `${Math.round(G().temp)}°`, 'in'],
      [screen(2), 'Nafta', () => { const m = G().fuelLaps; return `${m >= 0 ? '+' : '−'}${Math.abs(m).toFixed(1).replace('.', ',')} v`; }, 'in'],
      [screen(3), 'Gomas', () => `${Math.round(G().tyre)} %`, 'in'],
      // Fuera del balance pedido, la etiqueta dice a cuánto llevarlo.
      [screen(4), 'Frenos', () => (P.bal === G().bal ? `${P.bal} %` : `${P.bal} → ${G().bal} %`), 'in'],
      [at(SCR.x1 + 3, DELTA_Y, BODY_T + 3.3), 'Delta', () => { const d = G().delta; return d === null ? '—' : `${d >= 0 ? '+' : '−'}${f1(Math.abs(d))} s`; }, 'in'],
      [at(-104, 23), 'Balance', () => '+ arriba · − abajo', 'left'],
      [at(96, 56), 'Limitador', () => (P.lim ? 'Activo' : P.grd ? 'Tapa abierta' : 'Apagado'), 'right'],
      [at(36, FUSE_Y), 'Fusibles', () => {
        const out = FUSE_NAMES.filter((_, i) => G().fuse[i]);
        return out.length ? `Saltó ${out.join(', ')}` : 'En orden';
      }, 'right'],
      ...ROTARIES.map(([kn, x]): [THREE.Vector3, string, () => string, Align] => [
        at(x, ROT_Y - 17), ({ lev: 'Potencia', ers: 'ERS', dif: 'Diferencial', eb: 'Freno motor' } as const)[kn], () => cap(N[kn][P[kn]]), 'down']),
    ];
    this.labelBox.replaceChildren();
    this.labels = defs.map(([local, name, value, align]) => {
      const el = document.createElement('div');
      el.className = align === 'in' ? 'label inline' : 'label';
      const n = document.createElement('div');
      n.className = 'n';
      n.textContent = name;
      const v = document.createElement('div');
      v.className = 'v';
      el.append(n, v);
      this.labelBox.appendChild(el);
      // Rotativos pares: en caja chica su etiqueta va arriba de la perilla, así dos sugerencias vecinas no se pisan.
      const stagger = ['Potencia', 'Freno motor'].includes(name);
      return { obj: f, local, value, el, valEl: v, align, knob: KNOB_OF[name], hinted: false, stagger, when: name === 'Delta' ? () => this.fx.delta : undefined };
    });
    this.refreshLabels();
  }

  private refreshLabels(): void {
    const hint = this.gauges.hint;
    for (const l of this.labels) {
      const to = l.knob ? hint[l.knob] : undefined;
      l.hinted = to !== undefined;
      l.el.classList.toggle('hint', l.hinted);
      // La posición actual ya se ve en la pieza: la sugerencia muestra solo a dónde ir, así no se pisan las etiquetas vecinas.
      setText(l.valEl, l.hinted ? `→ ${knobText(l.knob as Knob, to as number)}` : l.value());
    }
  }

  private placeLabels(): void {
    const { w, h } = this;
    // Caja chica (volante a menos de 1,8 px por mm): las etiquetas de los controles se pisarían; quedan tramo, alertas, pantalla y lo sugerido.
    const pxmm = h / (this.cam.top - this.cam.bottom), compact = pxmm < 1.8 || this.faceFit;
    // Las lecturas de la pantalla giran con el volante, como un display; debajo de 1,3 px/mm no entran y quedan las agujas.
    const spin = `rotate(${(-this.g.wheel.rotation.z).toFixed(3)}rad)`;
    // En caja angosta los valores no entran al lado de sus controles; en compacta solo queda el del tramo, y ese sí entra.
    const bareValues = w < 520 && !compact;
    if (this.screenEl) this.placeScreen(this.screenEl);
    for (const l of this.labels) {
      // En el HUD las lecturas van en fila y siempre a la vista: la pantalla que las mostraba la tapa el mapa.
      if (this.screenEl && l.align === 'in') { setStyle(l.el, 'display', l.when && !l.when() ? 'none' : 'flex'); continue; }
      const inline = l.align === 'in', show = this.labelShown(l, pxmm, compact);
      l.el.classList.toggle('compact', compact && inline);
      l.el.classList.toggle('bare', compact && l.align === 'up');
      setStyle(l.el, 'display', show ? (inline ? 'flex' : 'block') : 'none');
      if (!show) continue;
      setStyle(l.el, 'transform', this.labelAt(l, compact, spin));
      setStyle(l.valEl, 'display', bareValues && !l.hinted && !inline ? 'none' : 'block');
    }
  }

  /** Lo sugerido se ve siempre; el resto, si las etiquetas están prendidas y entran a este tamaño. */
  private labelShown(l: Label, pxmm: number, compact: boolean): boolean {
    if (l.when && !l.when()) return false;
    if (l.hinted) return true;
    if (!this.showLabels) return false;
    return l.align === 'in' ? pxmm >= 1.3 : !compact || l.align === 'up';
  }

  /** Vidrio de la pantalla en px: la cámara es ortográfica, así que tres esquinas definen la transformación entera. */
  private placeScreen(el: HTMLElement): void {
    const corner = (x: number, fy: number): [number, number] => {
      this.tmp.set(x, BODY_T + 3, -fy);
      this.face.localToWorld(this.tmp).project(this.cam);
      return [((this.tmp.x + 1) / 2) * this.w, ((1 - this.tmp.y) / 2) * this.h];
    };
    const top = SCR.y + SCR.h / 2, tl = corner(-SCR.w / 2, top), tr = corner(SCR.w / 2, top), bl = corner(-SCR.w / 2, SCR.y - SCR.h / 2);
    const [W, H] = this.scrPx, n = (v: number): string => v.toFixed(4);
    setStyle(el, 'transform', `matrix(${n((tr[0] - tl[0]) / W)}, ${n((tr[1] - tl[1]) / W)}, ${n((bl[0] - tl[0]) / H)}, ${n((bl[1] - tl[1]) / H)}, ${n(tl[0])}, ${n(tl[1])})`);
  }

  private labelAt(l: Label, compact: boolean, spin: string): string {
    const flip = compact && l.stagger;
    this.tmp.copy(l.local);
    if (flip) this.tmp.z -= ROT_UP;
    l.obj.localToWorld(this.tmp).project(this.cam);
    const x = (((this.tmp.x + 1) / 2) * this.w).toFixed(1), y = (((1 - this.tmp.y) / 2) * this.h).toFixed(1);
    return `translate(${x}px, ${y}px) ${l.align === 'in' ? spin + ' ' : ''}${ALIGN[flip ? 'up' : l.align]}`;
  }

  /** Acciona un control. Un rotativo va directo a la posición cuya marca se tocó; sin punto (teclado) cicla. */
  private act(c: string, at?: THREE.Vector3): void {
    if (isRotary(c)) this.turn(c, at);
    else if (c === 'bb+' || c === 'bb-') this.bias(c === 'bb+' ? 1 : -1);
    else this.press(c);
    this.refreshLabels();
  }

  private turn(kn: (typeof ROTARIES)[number][0], at?: THREE.Vector3): void {
    const P = this.panel;
    P[kn] = at ? this.detentOf(kn, at) : (P[kn] + 1) % 3;
  }

  /** BB+ y BB−: un punto del balance de frenos por toque. */
  private bias(dir: 1 | -1): void {
    const P = this.panel;
    P.bal = Math.max(BAL_BAR[0], Math.min(BAL_BAR[1], P.bal + dir));
    this.bbPress[dir > 0 ? 0 : 1] = 0.12;
  }

  /** Tapa, limitador (solo con la tapa abierta) y fusibles. */
  private press(c: string): void {
    const P = this.panel;
    if (c === 'grd') P.grd = !P.grd;
    else if (c === 'lim' && P.grd) P.lim = !P.lim;
    else if (c[0] === 'f') P.rst[Number(c[1])]++;
  }

  /** Posición del rotativo para un punto tocado. Se mide sobre el volante, no en pantalla: en difícil el volante gira y las marcas giran con él. */
  private detentOf(kn: string, at: THREE.Vector3): number {
    const x = (ROTARIES.find(([k]) => k === kn) as [string, number])[1];
    return detentAt(this.face.worldToLocal(at.clone()).x - x);
  }

  private cast(e: PointerEvent): void {
    const r = this.ink.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.cam);
  }

  /** Primera pieza bajo el puntero si es un control. Una pieza que tapa al control se lleva el clic; las marcas impresas (capa 1) no cuentan. */
  private hit(): THREE.Intersection | null {
    this.scene.updateMatrixWorld();
    const h = this.ray.intersectObject(this.scene, true)[0];
    return h?.object.userData.ctl ? h : null;
  }

  private bindPointer(): void {
    const cv = this.ink.canvas, opt = { signal: this.ac.signal };
    cv.addEventListener('pointerdown', (e) => {
      this.cast(e);
      const h = this.hit();
      if (h) { this.act(h.object.userData.ctl as string, h.point); return; }
      if (this.drag) return;
      this.drag = true;
      this.dragId = e.pointerId;
      this.px = e.clientX;
      this.py = e.clientY;
      try { cv.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
      this.setCursor('grabbing');
    }, opt);
    cv.addEventListener('pointermove', (e) => {
      if (this.drag) {
        if (e.pointerId !== this.dragId) return;
        // Apenas un margen para ver el relieve: más giro estorba al apuntar a los botones.
        this.azT = Math.max(-AZ_MAX, Math.min(AZ_MAX, this.azT - (e.clientX - this.px) * 0.002));
        this.elT = Math.max(0, Math.min(EL_MAX, this.elT + (e.clientY - this.py) * 0.002));
        this.px = e.clientX;
        this.py = e.clientY;
        return;
      }
      this.hover = e;
    }, opt);
    cv.addEventListener('pointerleave', () => { this.hover = null; this.aim = null; }, opt);
    const up = (e: PointerEvent): void => { if (e.pointerId === this.dragId) { this.drag = false; this.setCursor('grab'); } };
    cv.addEventListener('pointerup', up, opt);
    cv.addEventListener('pointercancel', up, opt);
  }

  /** Lo que hay bajo el puntero: cursor y marca de destino del rotativo. */
  private hoverNow(): void {
    const e = this.hover;
    if (!e) return;
    this.hover = null;
    this.cast(e);
    const h = this.hit();
    this.setCursor(h ? 'pointer' : 'grab');
    this.aim = this.aimAt(e, h);
  }

  /** Marca de destino: solo con puntero de verdad (en táctil no hay «encima» antes del toque). */
  private aimAt(e: PointerEvent, h: THREE.Intersection | null): { kn: string; i: number } | null {
    const kn = h?.object.userData.ctl as string | undefined;
    if (!h || !kn || !this.fx.aim || e.pointerType === 'touch' || !isRotary(kn)) return null;
    return { kn, i: this.detentOf(kn, h.point) };
  }

  private setCursor(c: string): void {
    if (c === this.cursor) return;
    this.cursor = c;
    this.box.style.cursor = c;
  }

  private applyCamera(): void {
    const t = this.target, el = this.el, az = this.az, R = (NEAR + FAR) / 2;
    this.cam.position.set(t.x + R * Math.cos(el) * Math.sin(az), t.y + R * Math.sin(el), t.z + R * Math.cos(el) * Math.cos(az));
    this.cam.lookAt(t);
    this.ink.setLightAzimuth(az);
  }

  private resize(): void {
    const w = this.box.clientWidth, h = this.box.clientHeight;
    this.w = w;
    this.h = h;
    this.redraw.touch();
    if (!w || !h) return;
    this.ink.resize(w, h);
    const as = w / h, { hh, face } = frameFor(w, h, this.steerRoom);
    this.faceFit = face;
    // Para revisar en el navegador sin mirar el código: la escala y el encuadre quedan en la caja.
    this.box.dataset.pxmm = (h / (2 * hh)).toFixed(2);
    this.box.dataset.frame = face ? 'empuñaduras' : 'entero';
    // El mapa mide en px lo que mide el vidrio con esta escala: así se dibuja nítido y la transformación casi no lo estira.
    this.scrPx = [Math.max(1, Math.round(SCR.w * (h / (2 * hh)))), Math.max(1, Math.round(SCR.h * (h / (2 * hh))))];
    if (this.screenEl) { this.screenEl.style.width = `${this.scrPx[0]}px`; this.screenEl.style.height = `${this.scrPx[1]}px`; }
    this.cam.left = -hh * as;
    this.cam.right = hh * as;
    this.cam.top = hh;
    this.cam.bottom = -hh;
    this.cam.updateProjectionMatrix();
  }
}
