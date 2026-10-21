import { PHYS, aAcc } from '../sim/physics';
import type { Seg, Track, Vec2 } from '../sim/types';

interface GJ { type: string; features?: GJ[]; geometry?: GJ; geometries?: GJ[]; coordinates?: unknown }

export function coordsOf(g: GJ): number[][] | null {
  const L: number[][][] = [];
  const walk = (o?: GJ): void => {
    if (!o) return;
    switch (o.type) {
      case 'FeatureCollection': o.features?.forEach(walk); break;
      case 'Feature': walk(o.geometry); break;
      case 'GeometryCollection': o.geometries?.forEach(walk); break;
      case 'LineString': L.push(o.coordinates as number[][]); break;
      case 'MultiLineString': (o.coordinates as number[][][]).forEach((c) => L.push(c)); break;
      case 'Polygon': L.push((o.coordinates as number[][][])[0]); break;
    }
  };
  walk(g);
  L.sort((a, b) => b.length - a.length);
  return L[0] ?? null;
}

export function geoToMeters(co: number[][]): Vec2[] {
  let lo = 0, la = 0;
  for (const c of co) { lo += c[0]; la += c[1]; }
  lo /= co.length; la /= co.length;
  const kx = Math.cos((la * Math.PI) / 180) * 111320, ky = 110574;
  return co.map((c) => [(c[0] - lo) * kx, (c[1] - la) * ky] as Vec2);
}

export function catmullLoop(cp: Vec2[], per = 30): Vec2[] {
  const M = cp.length, out: Vec2[] = [];
  const crm = (a: number, b: number, c: number, d: number, t: number): number =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  for (let i = 0; i < M * per; i++) {
    const u = i / per, k = Math.floor(u), t = u - k, g = (j: number): Vec2 => cp[(k + j + M) % M];
    out.push([crm(g(-1)[0], g(0)[0], g(1)[0], g(2)[0], t), crm(g(-1)[1], g(0)[1], g(1)[1], g(2)[1], t)]);
  }
  return out;
}

const wrap = (a: number): number => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

/** Cierra la polilínea si el último punto repite el primero. */
function openLoop(pts: Vec2[]): Vec2[] {
  const p = pts.slice();
  if (p.length > 2 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 1) p.pop();
  return p;
}

/** Distancia acumulada hasta cada vértice, con el tramo que vuelve al primero al final. */
function arcLength(p: Vec2[]): number[] {
  const n = p.length, cum = [0];
  for (let i = 1; i <= n; i++) {
    const a = p[i - 1], b = p[i % n];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return cum;
}

/** N puntos a distancia pareja ds sobre la polilínea. */
function resample(p: Vec2[], cum: number[], N: number, ds: number): Vec2[] {
  const n = p.length, q: Vec2[] = [];
  let k = 0;
  for (let i = 0; i < N; i++) {
    const d = i * ds;
    while (k < n - 1 && cum[k + 1] < d) k++;
    const a = p[k], b = p[(k + 1) % n], t = (d - cum[k]) / (cum[k + 1] - cum[k] || 1);
    q.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return q;
}

/** Cuatro pasadas de un filtro 1-2-3-2-1 sobre el lazo cerrado. */
function smooth(q: Vec2[]): Vec2[] {
  const W = [1, 2, 3, 2, 1], N = q.length;
  for (let r = 0; r < 4; r++) {
    q = q.map((_, i) => {
      let sx = 0, sy = 0;
      for (let j = -2; j <= 2; j++) { const z = q[(i + j + N) % N]; sx += z[0] * W[j + 2]; sy += z[1] * W[j + 2]; }
      return [sx / 9, sy / 9] as Vec2;
    });
  }
  return q;
}

/** Rumbo en cada punto y curvatura: cambio de rumbo en ±3 puntos, promediado en una ventana de 7. */
function headingAndCurvature(q: Vec2[], ds: number): { hd: number[]; K: number[] } {
  const N = q.length;
  const hd = q.map((z, i) => { const b = q[(i + 1) % N]; return Math.atan2(b[1] - z[1], b[0] - z[0]); });
  const k0 = q.map((_, i) => wrap(hd[(i + 3) % N] - hd[(i - 3 + N) % N]) / (6 * ds));
  const K = k0.map((_, i) => { let s = 0; for (let j = -3; j <= 3; j++) s += k0[(i + j + N) % N]; return s / 7; });
  return { hd, K };
}

/**
 * Perfil de velocidad: tope por agarre lateral (VL), lo que se llega acelerando desde atrás (VF)
 * y lo que permite frenar para lo que viene (V). Dos vueltas a cada pasada para cerrar el lazo.
 */
function speedProfile(K: number[], ds: number): { VL: number[]; VF: number[]; V: number[] } {
  const N = K.length;
  const VL = K.map((c) => Math.min(PHYS.VMAX, Math.sqrt(PHYS.A_LAT / Math.max(Math.abs(c), 1e-6))));
  const VF = VL.slice();
  for (let r = 0; r < 2; r++) for (let i = 0; i < N; i++) {
    const pv = VF[(i - 1 + N) % N];
    VF[i] = Math.min(VL[i], Math.sqrt(pv * pv + 2 * aAcc(pv) * ds));
  }
  const V = VF.slice();
  for (let r = 0; r < 2; r++) for (let i = N - 1; i >= 0; i--) {
    const nv = V[(i + 1) % N];
    V[i] = Math.min(V[i], Math.sqrt(nv * nv + 2 * PHYS.A_BRK * ds));
  }
  return { VL, VF, V };
}

/** Frenada si hay que bajar de lo que se traía; recta si casi no curva; salida si la curva todavía no está al límite de agarre. */
function segType(v: number, vf: number, vl: number, k: number): Seg {
  if (v < vf - 1) return 'b';
  if (Math.abs(k) <= PHYS.K_CURVE) return 's';
  return v < vl - PHYS.TRACTION_GAP ? 'x' : 'c';
}

export function buildTrack(id: string, name: string, pts: Vec2[]): Track {
  const p = openLoop(pts), cum = arcLength(p);
  const len = cum[p.length], N = Math.max(50, Math.round(len / PHYS.DS)), ds = len / N;
  const q = smooth(resample(p, cum, N, ds));
  const { hd, K } = headingAndCurvature(q, ds);
  const { VL, VF, V } = speedProfile(K, ds);
  const ty: Seg[] = V.map((v, i) => segType(v, VF[i], VL[i], K[i]));
  const dt = V.map((v) => ds / Math.max(v, 1));
  settle(ty, dt);
  const idealLap = dt.reduce((a, t) => a + t, 0);
  return { id, name, q, n: N, len, ds, k: K, v: V, ty, hd, idealLap };
}

interface Block { i: number; n: number; ty: Seg; t: number }

function blocks(ty: Seg[], dt: number[]): Block[] {
  const N = ty.length;
  let st = 0;
  while (st < N && ty[st] === ty[(st - 1 + N) % N]) st++;
  if (st === N) return [{ i: 0, n: N, ty: ty[0], t: dt.reduce((a, t) => a + t, 0) }];
  const out: Block[] = [];
  for (let k = 0; k < N; k++) {
    const i = (st + k) % N, b = out[out.length - 1];
    if (b && b.ty === ty[i]) { b.n++; b.t += dt[i]; } else out.push({ i, n: 1, ty: ty[i], t: dt[i] });
  }
  return out;
}

/**
 * Los trazados son polilíneas: cada vértice deja un pico de curvatura y parte las curvas en
 * tramos de décimas de segundo. Acá se junta lo que dura menos que el mínimo jugable: la
 * frenada crece hacia atrás y el resto toma el tipo del vecino más largo.
 */
export function settle(ty: Seg[], dt: number[]): void {
  const N = ty.length;
  for (let guard = 0; guard < N; guard++) {
    const bl = blocks(ty, dt);
    if (bl.length < 2) return;
    let w = -1;
    bl.forEach((b, j) => { if (b.t < (b.ty === 'b' ? PHYS.SEG_MIN_B : PHYS.SEG_MIN) && (w < 0 || b.t < bl[w].t)) w = j; });
    if (w < 0) return;
    const b = bl[w];
    if (b.ty === 'b') {
      let i = (b.i - 1 + N) % N, t = b.t;
      while (t < PHYS.SEG_MIN_B && ty[i] !== 'b') { ty[i] = 'b'; t += dt[i]; i = (i - 1 + N) % N; }
    } else {
      const p = bl[(w - 1 + bl.length) % bl.length], q = bl[(w + 1) % bl.length], to = p.t >= q.t ? p.ty : q.ty;
      for (let k = 0; k < b.n; k++) ty[(b.i + k) % N] = to;
    }
  }
}
