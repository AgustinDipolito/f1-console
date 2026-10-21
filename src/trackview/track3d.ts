import * as THREE from 'three';
import { InkRenderer, type Palette } from '../render/ink';
import { Parts } from '../render/parts';
import { Redraw, setStyle, setText } from '../render/redraw';
import { carPos, idx, posAt } from '../sim/car';
import { PHYS } from '../sim/physics';
import type { Race } from '../sim/race';
import type { Car, Track, Vec2 } from '../sim/types';
import type { Ghost } from './trackview';

/** Ancho de pista y alto del asfalto sobre el terreno (m): el escalón es lo que dibuja el contorno. */
const WIDTH = 14;
const CURB = 0.8;
/** Media altura de la vista (m), elevación y distancia de la cámara. */
const VIEW = 150;
const EL = 0.62;
const DIST = 700;
const NEAR = 300;
/** Tu auto va en azul (el mismo de tramo y modo fácil); los bots en el tono medio. Los autos se dibujan más grandes que en escala para que se lean. */
const MINE = 0x378add;
const CAR_SCALE = 1.8;
const FAR = 1300;
/** Segundos que se sigue dibujando con todo quieto: lo que tardan la cámara y los discos en asentarse. */
const SETTLE = 3;

/** Del plano del trazado (x este, y norte) al mundo de three (y arriba). */
const w3 = (p: Vec2, h = 0): THREE.Vector3 => new THREE.Vector3(p[0], h, -p[1]);

/** Lo que mueve la imagen: tiempo de carrera, autos, fantasmas y opciones. Quieto, la pista no se vuelve a dibujar. */
const frameKey = (race: Race, ghosts: Ghost[], braking: boolean, brakes: boolean): string =>
  `${race.t}|${race.cars.map((c) => `${c.s},${c.off},${c.lat}`).join(';')}|${ghosts.map((g) => `${g.s}${g.label}`).join()}|${braking}|${brakes}`;

/** Pista en 3D con el pipeline de la consola. La cámara sigue a tu auto desde atrás. */
export class Track3D {
  private readonly ink: InkRenderer;
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, NEAR, FAR);
  private readonly parts: Parts;
  private readonly ro: ResizeObserver;
  private readonly look = new THREE.Vector3();
  private world: THREE.Group | null = null;
  private braking: THREE.Mesh | null = null;
  private cars: THREE.Group[] = [];
  /** Discos de cada auto: se ponen al rojo según cuánto frena. Velocidad y tiempo de carrera de la medición anterior. */
  private discs: THREE.ShaderMaterial[] = [];
  private glow: number[] = [];
  private prevV: number[] = [];
  private prevT = 0;
  /** Etiqueta HTML proyectada sobre cada auto: Vos, Bot 1… */
  private readonly tagBox = document.createElement('div');
  private tags: HTMLDivElement[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly ghostMat: THREE.MeshBasicMaterial;
  private ghosts: THREE.Mesh[] = [];
  private ghostTags: HTMLDivElement[] = [];
  private track: Track | null = null;
  private yaw = 0;
  private visible = false;
  /** Dónde va tu auto en la caja (fracción del ancho y del alto): con el volante delante, va donde el volante no tapa. */
  private anchor: [number, number] = [0.5, 0.5];
  private readonly dir = new THREE.Vector3();
  /** Tamaño de la caja, medido al cambiar: leerlo por cada etiqueta obligaba a recalcular el layout. */
  private w = 0;
  private h = 0;
  private readonly redraw = new Redraw(SETTLE);

  constructor(private readonly box: HTMLElement, private readonly pal: Palette, quality: number) {
    this.ink = new InkRenderer(pal, quality, FAR - NEAR);
    this.ink.canvas.style.display = 'none';
    box.insertBefore(this.ink.canvas, box.firstChild);
    this.tagBox.className = 'labels';
    this.tagBox.style.display = 'none';
    box.appendChild(this.tagBox);
    this.parts = new Parts(this.ink, this.scene);
    this.ghostMat = new THREE.MeshBasicMaterial({ color: pal.ink, transparent: true, opacity: 0.3, depthWrite: false, depthTest: false });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(box);
  }

  show(on: boolean): void {
    this.visible = on;
    this.ink.canvas.style.display = on ? 'block' : 'none';
    this.tagBox.style.display = on ? 'block' : 'none';
    if (on) this.resize();
  }

  setAnchor(a: [number, number]): void { this.anchor = a; this.resize(); }

  setTrack(t: Track): void {
    this.track = t;
    this.redraw.touch();
    if (this.world) { this.scene.remove(this.world); this.world.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); }
    const g = new THREE.Group(), n = t.n, hw = WIDTH / 2, L: Vec2[] = [], R: Vec2[] = [];
    for (let i = 0; i < n; i++) {
      const [x, y] = t.q[i], h = t.hd[i], nx = -Math.sin(h), ny = Math.cos(h);
      L.push([x + nx * hw, y + ny * hw]);
      R.push([x - nx * hw, y - ny * hw]);
    }
    const top: number[] = [], side: number[] = [], brk: number[] = [];
    const quad = (out: number[], a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): void => {
      out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
    };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      quad(top, w3(L[i], CURB), w3(R[i], CURB), w3(R[j], CURB), w3(L[j], CURB));
      quad(side, w3(L[i]), w3(L[j]), w3(L[j], CURB), w3(L[i], CURB));
      quad(side, w3(R[i]), w3(R[j]), w3(R[j], CURB), w3(R[i], CURB));
      if (t.ty[i] === 'b' && t.ty[j] === 'b') quad(brk, w3(L[i], CURB), w3(R[i], CURB), w3(R[j], CURB), w3(L[j], CURB));
    }
    const geo = (a: number[]): THREE.BufferGeometry => {
      const b = new THREE.BufferGeometry();
      b.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
      b.computeVertexNormals();
      return b;
    };
    const p = this.parts, pal = this.pal;
    p.add(geo(top), this.ink.tone(pal.hi), 0, 0, 0, g);
    p.add(geo(side), this.ink.tone(pal.mid), 0, 0, 0, g);
    this.braking = p.add(geo(brk), new THREE.MeshBasicMaterial({ color: 0xef9f27, transparent: true, opacity: 0.45, depthWrite: false }), 0, 0.06, 0, g, true);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of t.q) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const ground = new THREE.PlaneGeometry(x1 - x0 + 400, y1 - y0 + 400);
    ground.rotateX(-Math.PI / 2);
    p.add(ground, this.ink.tone(pal.lo), (x0 + x1) / 2, 0, -(y0 + y1) / 2, g);
    p.mark(2.5, WIDTH, t.q[0][0], CURB + 0.02, -t.q[0][1], g, t.hd[0]);
    this.scene.add(g);
    this.world = g;
    this.yaw = t.hd[0];
    this.look.copy(w3(t.q[0]));
  }

  /** ghosts: tu mejor vuelta y, si cargaste una, la de otro jugador. brakes: discos al rojo al frenar. */
  draw(race: Race | null, ghosts: Ghost[], braking: boolean, dt: number, brakes = true): void {
    if (!this.visible || !this.track) return;
    const t = this.track, live = race && race.track === t ? race : null;
    const key = live ? frameKey(live, ghosts, braking, brakes) : 'idle';
    if (!this.redraw.need(key, dt)) return;
    if (this.braking) this.braking.visible = braking;
    // Mientras carga otro circuito no se dibuja el mundo viejo con los autos congelados.
    if (!live) { this.clear(); return; }
    this.syncCars(live, t);
    this.glowBrakes(live, dt, brakes);
    this.syncTags(live.tags());
    this.syncGhosts(ghosts, t);
    this.follow(live, t, dt);
    this.ink.render(this.scene, this.cam);
    this.placeTags();
  }

  private clear(): void {
    this.ink.renderer.setRenderTarget(null);
    this.ink.renderer.clear();
    [...this.tags, ...this.ghostTags].forEach((el) => setStyle(el, 'display', 'none'));
  }

  private syncCars(race: Race, t: Track): void {
    const all = race.cars;
    while (this.cars.length < all.length) this.cars.push(this.car(this.cars.length === 0));
    this.cars.forEach((g, i) => { g.visible = i < all.length; if (i < all.length) this.place(g, t, all[i]); });
  }

  /** Desaceleración medida en tiempo de carrera: no depende de la velocidad del tiempo ni de los cuadros por segundo. */
  private glowBrakes(race: Race, dt: number, brakes: boolean): void {
    const st = race.t - this.prevT, k = 1 - Math.exp(-dt * 8);
    race.cars.forEach((c, i) => {
      const to = brakes && race.green ? Math.max(0, Math.min(1, this.decel(i, c.v, st) / PHYS.A_BRK)) : 0;
      this.glow[i] = (this.glow[i] ?? 0) + (to - (this.glow[i] ?? 0)) * k;
      this.discs[i].uniforms.uOn.value = this.glow[i];
      if (st > 0) this.prevV[i] = c.v;
    });
    if (st !== 0) this.prevT = race.t;
  }

  private decel(i: number, v: number, st: number): number {
    return st > 0 && this.prevV[i] !== undefined ? (this.prevV[i] - v) / st : 0;
  }

  private syncTags(tags: string[]): void {
    while (this.tags.length < tags.length) {
      const el = document.createElement('div');
      el.className = this.tags.length === 0 ? 'tag mine' : 'tag';
      this.tagBox.appendChild(el);
      this.tags.push(el);
    }
    this.tags.forEach((el, i) => {
      setStyle(el, 'display', tags[i] ? 'block' : 'none');
      setText(el, tags[i] ?? '');
    });
  }

  private syncGhosts(ghosts: Ghost[], t: Track): void {
    while (this.ghosts.length < ghosts.length) this.ghosts.push(this.ghostMesh());
    while (this.ghostTags.length < ghosts.length) {
      const el = document.createElement('div');
      el.className = 'tag ghost';
      this.tagBox.appendChild(el);
      this.ghostTags.push(el);
    }
    this.ghosts.forEach((m, i) => {
      const g = ghosts[i];
      m.visible = !!g;
      setStyle(this.ghostTags[i], 'display', g ? 'block' : 'none');
      if (!g) return;
      const p = posAt(t, g.s);
      m.position.set(p[0], CURB + CAR_SCALE, -p[1]);
      m.rotation.y = t.hd[idx(t, g.s)];
      setText(this.ghostTags[i], g.label);
    });
  }

  /** La cámara sigue a tu auto desde atrás, con el giro y la posición suavizados. */
  private follow(race: Race, t: Track, dt: number): void {
    const p = carPos(t, race.player), h = t.hd[idx(t, race.player.s)], k = 1 - Math.exp(-dt * 2.5);
    let dy = h - this.yaw;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    this.yaw += dy * k;
    this.look.lerp(w3(p), 1 - Math.exp(-dt * 6));
    this.dir.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.cam.position.copy(this.look).addScaledVector(this.dir, -DIST * Math.cos(EL)).setY(this.look.y + DIST * Math.sin(EL));
    this.cam.lookAt(this.look);
    this.ink.setLightAzimuth(this.yaw - Math.PI / 2);
  }

  private placeTags(): void {
    const place = (el: HTMLDivElement, o: THREE.Object3D | undefined): void => {
      if (!o?.visible) { setStyle(el, 'display', 'none'); return; }
      this.tmp.copy(o.position).setY(CURB + 4 * CAR_SCALE).project(this.cam);
      setStyle(el, 'transform', `translate(${(((this.tmp.x + 1) / 2) * this.w).toFixed(1)}px, ${(((1 - this.tmp.y) / 2) * this.h).toFixed(1)}px) translate(-50%, -100%)`);
    };
    this.tags.forEach((el, i) => place(el, this.cars[i]));
    this.ghostTags.forEach((el, i) => place(el, this.ghosts[i]));
  }

  /** El fantasma va a la escala de los autos y se dibuja encima: si no, desaparece justo cuando vas igual que la vuelta de referencia. */
  private ghostMesh(): THREE.Mesh {
    const m = this.parts.add(new THREE.BoxGeometry(7, 2, 3.2), this.ghostMat, 0, CURB + CAR_SCALE, 0, this.scene, true);
    m.scale.setScalar(CAR_SCALE);
    m.renderOrder = 1;
    return m;
  }

  dispose(): void {
    this.ro.disconnect();
    this.scene.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.ink.dispose();
    this.ink.canvas.remove();
    this.tagBox.remove();
  }

  /** Auto: chasis bajo, cockpit y alerón. */
  private car(mine: boolean): THREE.Group {
    const p = this.parts, hex = mine ? MINE : this.pal.mid, g = new THREE.Group();
    g.scale.setScalar(CAR_SCALE);
    this.scene.add(g);
    p.box(7, 1.2, 3.2, hex, 0, 0, 0, g);
    p.box(2.4, 1, 1.6, hex, -0.4, 1.2, 0, g);
    p.box(1, 0.8, 3.6, hex, -3.2, 1.6, 0, g);
    // Ruedas con el disco a la vista: un solo material por auto, que se pone al rojo al frenar.
    const disc = this.ink.tone(this.pal.mid, 0xe24b4a);
    this.discs.push(disc);
    // Afuera del chasis, como en un auto de fórmula: desde la cámara de atrás se ve la banda de rodamiento.
    for (const [x, z] of [[2.3, 2.1], [2.3, -2.1], [-2.3, 2.1], [-2.3, -2.1]]) {
      const w = new THREE.CylinderGeometry(0.9, 0.9, 0.9, 16);
      w.rotateX(Math.PI / 2);
      p.add(w, disc, x, 0.4, z, g);
    }
    return g;
  }

  private place(g: THREE.Group, t: Track, c: Car): void {
    const p = carPos(t, c);
    g.position.set(p[0], CURB, -p[1]);
    g.rotation.y = t.hd[idx(t, c.s)];
  }

  private resize(): void {
    const w = this.box.clientWidth, h = this.box.clientHeight;
    this.w = w;
    this.h = h;
    this.redraw.touch();
    if (!w || !h || !this.visible) return;
    this.ink.resize(w, h);
    const as = w / h;
    const [ax, ay] = this.anchor;
    this.cam.left = -2 * VIEW * as * ax;
    this.cam.right = 2 * VIEW * as * (1 - ax);
    this.cam.top = 2 * VIEW * ay;
    this.cam.bottom = -2 * VIEW * (1 - ay);
    this.cam.updateProjectionMatrix();
  }
}
