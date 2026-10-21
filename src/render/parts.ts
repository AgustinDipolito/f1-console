import * as THREE from 'three';
import type { InkRenderer } from './ink';

export const PRINTED_LAYER = 1;

const BEZEL = [[10.6, 0], [12.5, 0], [12.5, 2], [12, 2.6], [10.6, 2.6], [10.6, 0]].map(([r, y]) => new THREE.Vector2(r, y));

/** Vocabulario de piezas. Todas las medidas en unidades de mundo, y hacia arriba. */
export class Parts {
  readonly pick: THREE.Mesh[] = [];

  constructor(private readonly ink: InkRenderer, private readonly root: THREE.Object3D) {}

  add(g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent?: THREE.Object3D, printed = false, ctl?: string): THREE.Mesh {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    (parent ?? this.root).add(o);
    if (printed) o.layers.set(PRINTED_LAYER);
    if (ctl) { o.userData.ctl = ctl; this.pick.push(o); }
    return o;
  }

  box(w: number, h: number, d: number, hex: number, x: number, y: number, z: number, parent?: THREE.Object3D, ctl?: string): THREE.Mesh {
    return this.add(new THREE.BoxGeometry(w, h, d), this.ink.tone(hex), x, y + h / 2, z, parent, false, ctl);
  }

  cyl(r: number, h: number, hex: number, x: number, y: number, z: number, parent?: THREE.Object3D, seg = 40, ctl?: string): THREE.Mesh {
    return this.add(new THREE.CylinderGeometry(r, r, h, seg), this.ink.tone(hex), x, y + h / 2, z, parent, false, ctl);
  }

  ball(r: number, hex: number, x: number, y: number, z: number, parent?: THREE.Object3D, ctl?: string): THREE.Mesh {
    return this.add(new THREE.SphereGeometry(r, 24, 16), this.ink.tone(hex), x, y, z, parent, false, ctl);
  }

  dome(r: number, m: THREE.Material, x: number, y: number, z: number, parent?: THREE.Object3D): THREE.Mesh {
    return this.add(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), m, x, y, z, parent);
  }

  slab(w: number, d: number, h: number, r: number, b: number, hex: number, x: number, y: number, z: number, parent?: THREE.Object3D): THREE.Mesh {
    const s = new THREE.Shape(), hw = w / 2 - b, hd = d / 2 - b, q = Math.max(0.1, r - b);
    s.moveTo(-hw + q, -hd); s.lineTo(hw - q, -hd); s.quadraticCurveTo(hw, -hd, hw, -hd + q);
    s.lineTo(hw, hd - q); s.quadraticCurveTo(hw, hd, hw - q, hd); s.lineTo(-hw + q, hd);
    s.quadraticCurveTo(-hw, hd, -hw, hd - q); s.lineTo(-hw, -hd + q); s.quadraticCurveTo(-hw, -hd, -hw + q, -hd);
    const g = new THREE.ExtrudeGeometry(s, { depth: h - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: 6 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, b, 0);
    return this.add(g, this.ink.tone(hex), x, y, z, parent);
  }

  mark(w: number, d: number, x: number, y: number, z: number, parent?: THREE.Object3D, rotY = 0, m?: THREE.Material): THREE.Mesh {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    const o = this.add(g, m ?? this.ink.inkMat, x, y + 0.06, z, parent, true);
    o.rotation.y = rotY;
    return o;
  }

  screw(x: number, y: number, z: number, parent?: THREE.Object3D, i = 0): void {
    this.cyl(1.3, 0.8, this.ink.pal.hi, x, y, z, parent, 20);
    this.mark(2, 0.35, x, y + 0.8, z, parent, i * 1.3);
  }

  /** Reloj con bisel, dial, marcas (rojas desde redFrom) y aguja. Devuelve el grupo de la aguja. */
  gauge(x: number, ticks: number, major: number, redFrom: number | null, parent: THREE.Object3D): THREE.Group {
    const pal = this.ink.pal;
    const bez = new THREE.LatheGeometry(BEZEL, 64).toNonIndexed();
    bez.computeVertexNormals();
    this.add(bez, this.ink.tone(pal.hi), x, 0, 0, parent);
    this.cyl(10.6, 1.2, pal.mid, x, 0, 0, parent, 64);
    for (let i = 0; i <= ticks; i++) {
      const a = ((-135 + (270 * i) / ticks) * Math.PI) / 180, M = i % major === 0, ln = M ? 2.6 : 1.4, r = 10 - ln / 2;
      const m = redFrom !== null && i >= redFrom ? this.ink.redMat : this.ink.inkMat;
      this.mark(M ? 0.45 : 0.3, ln, x + Math.sin(a) * r, 1.2, -Math.cos(a) * r, parent, Math.PI - a, m);
    }
    const needle = new THREE.Group();
    needle.position.set(x, 1.2, 0);
    parent.add(needle);
    this.box(0.7, 0.5, 9, pal.lit, 0, 0.9, 4.2, needle);
    this.box(0.7, 0.5, 3, pal.lit, 0, 0.9, -1.4, needle);
    this.cyl(1.4, 1.2, pal.hi, 0, 0, 0, needle, 24);
    return needle;
  }
}
