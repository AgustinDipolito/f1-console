import { carPos, posAt } from '../sim/car';
import type { Race } from '../sim/race';
import type { Track } from '../sim/types';
import { Redraw } from '../render/redraw';

export interface MapColors { ink: string; muted: string; paper: string; font: string }
/** Fantasma: distancia en la vuelta y de quién es (tu mejor vuelta o la de otro jugador). */
export interface Ghost { s: number; label: string }
/** losses: pérdidas de la última vuelta, numeradas como en la telemetría. */
export interface MapOpts { braking: boolean; trail: boolean; ghosts: Ghost[]; losses: { s: number; n: string }[] }

/** Zonas de frenada en el mapa. */
export const BRAKING_FILL = 'rgba(239,159,39,0.45)';
/** Eficacia de la estela: verde bien, ámbar regular, rojo mal. La telemetría usa los mismos cortes. */
export const Q_COLORS = ['#1D9E75', '#BA7517', '#E24B4A'];
export const qBand = (q: number): number => (q >= 0.85 ? 0 : q >= 0.6 ? 1 : 2);
type Pt = [number, number];
type Project = (x: number, y: number) => Pt;
/** Siguiendo a tu auto: metros de pista a la vista entre el auto y el borde de arriba. */
const AHEAD = 200;

/** Todo lo que se ve en el mapa además del trazado. Si no cambió, el mapa no se vuelve a pintar. */
const frameKey = (race: Race, o: MapOpts, tags: string[]): string => [
  race.cars.map((c) => `${c.s},${c.off},${c.lat}`).join(';'),
  o.trail ? race.player.trail.length : -1,
  o.ghosts.map((g) => `${g.s}${g.label}`).join(),
  o.losses.map((l) => `${l.s}${l.n}`).join(),
  tags.join(),
].join('|');

export class TrackView {
  private readonly cv = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layer = document.createElement('canvas');
  private readonly lctx: CanvasRenderingContext2D;
  private readonly dpr = Math.min(2, window.devicePixelRatio || 1);
  private track: Track | null = null;
  private map: { sc: number; f: Project } | null = null;
  private W = 0;
  private H = 0;
  private brakingShown = true;
  /** Siguiendo a tu auto: dónde va el auto en la caja (fracción del ancho y del alto). null muestra el circuito entero. */
  private follow: [number, number] | null = null;
  /** El mapa es una foto del estado: si nada se movió, el cuadro anterior sigue valiendo. */
  private readonly redraw = new Redraw(0);

  constructor(private readonly box: HTMLElement, private colors: MapColors) {
    box.appendChild(this.cv);
    this.ctx = this.cv.getContext('2d') as CanvasRenderingContext2D;
    this.lctx = this.layer.getContext('2d') as CanvasRenderingContext2D;
    new ResizeObserver(() => this.fit()).observe(box);
  }

  setTrack(t: Track): void { this.track = t; this.fit(); }
  show(on: boolean): void { this.cv.style.display = on ? 'block' : 'none'; }
  setColors(c: MapColors): void { this.colors = c; this.fit(); }
  setFollow(a: [number, number] | null): void { this.follow = a; this.fit(); }

  draw(race: Race | null, o: MapOpts): void {
    if (o.braking !== this.brakingShown) { this.brakingShown = o.braking; this.fit(); }
    const m = this.map, live = this.liveRace(race), tags = live ? live.tags() : [];
    if (!this.redraw.need(live ? frameKey(live, o, tags) : 'idle', 0)) return;
    this.ctx.clearRect(0, 0, this.W, this.H);
    if (!m || !live) return;
    // Siguiendo al auto el trazado se mueve en cada cuadro: se pinta entero, sin la capa guardada.
    const f = this.follow === null ? m.f : this.chase(live, this.follow);
    if (this.follow === null) this.ctx.drawImage(this.layer, 0, 0);
    else this.paint(this.ctx, f, (this.H * this.follow[1]) / AHEAD);
    if (o.trail) this.drawTrail(f, live);
    this.ctx.font = `${12 * this.dpr}px ${this.colors.font}`;
    this.drawLosses(f, live.track, o.losses);
    this.drawGhosts(f, live.track, o.ghosts);
    this.drawCars(f, live, tags);
  }

  /** Tu auto fijo en a, con el sentido de marcha hacia arriba (tomado de 20 m atrás a 60 m adelante). */
  private chase(race: Race, a: [number, number]): Project {
    const t = race.track, s = race.player.s, at = (d: number): Pt => posAt(t, (((s + d) % t.len) + t.len) % t.len);
    const [cx, cy] = carPos(t, race.player), [ax, ay] = at(-20), [bx, by] = at(60);
    const r = Math.PI / 2 - Math.atan2(by - ay, bx - ax), cs = Math.cos(r), sn = Math.sin(r);
    const sc = (this.H * a[1]) / AHEAD, x0 = this.W * a[0], y0 = this.H * a[1];
    return (x, y) => {
      const dx = x - cx, dy = y - cy;
      return [x0 + (dx * cs - dy * sn) * sc, y0 - (dx * sn + dy * cs) * sc];
    };
  }

  /** Mientras carga otro circuito no hay carrera: no se deja a la vista el trazado anterior. */
  private liveRace(race: Race | null): Race | null {
    return this.map && race && race.track === this.track ? race : null;
  }

  /** Estela del jugador en tres trazos, uno por banda de eficacia. Un salto largo (vuelta nueva) corta la línea. */
  private drawTrail(f: Project, race: Race): void {
    const c = this.ctx, B: Pt[][] = [[], [], []], tr = race.player.trail;
    for (let k = 1; k < tr.length; k++) {
      const a = tr[k - 1], b = tr[k];
      if (Math.hypot(a.x - b.x, a.y - b.y) > 40) continue;
      B[qBand(b.q)].push(f(a.x, a.y), f(b.x, b.y));
    }
    c.lineWidth = 2.2 * this.dpr;
    c.lineCap = 'round';
    B.forEach((seg, bi) => {
      c.strokeStyle = Q_COLORS[bi];
      c.beginPath();
      for (let k = 0; k < seg.length; k += 2) { c.moveTo(seg[k][0], seg[k][1]); c.lineTo(seg[k + 1][0], seg[k + 1][1]); }
      c.stroke();
    });
  }

  /** Pérdidas: un rombo sobre el trazado donde empezó cada una y su número al costado. */
  private drawLosses(f: Project, t: Track, losses: MapOpts['losses']): void {
    const c = this.ctx, d = this.dpr, C = this.colors, r = 5 * d;
    for (const l of losses) {
      const lp = posAt(t, l.s), [lx, ly] = f(lp[0], lp[1]);
      c.lineWidth = 1.5 * d; c.strokeStyle = C.ink; c.fillStyle = C.paper;
      c.beginPath(); c.moveTo(lx, ly - r); c.lineTo(lx + r, ly); c.lineTo(lx, ly + r); c.lineTo(lx - r, ly); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = C.ink; c.fillText(l.n, lx + 8 * d, ly + 4 * d);
    }
  }

  private drawGhosts(f: Project, t: Track, ghosts: Ghost[]): void {
    const c = this.ctx, d = this.dpr, C = this.colors;
    for (const g of ghosts) {
      const gp = posAt(t, g.s), [gx, gy] = f(gp[0], gp[1]);
      c.lineWidth = 1.5 * d; c.strokeStyle = C.muted; c.setLineDash([3 * d, 2 * d]);
      c.beginPath(); c.arc(gx, gy, 5 * d, 0, Math.PI * 2); c.stroke();
      c.setLineDash([]);
      c.fillStyle = C.muted; c.fillText(g.label, gx + 8 * d, gy + 14 * d);
    }
  }

  /**
   * Rivales en círculo hueco, con nombre si van en el podio; vos, lleno y encima de todos. Cada nombre va para su lado
   * (vos arriba a la derecha, los rivales arriba a la izquierda, el fantasma abajo): en la largada los autos están juntos.
   */
  private drawCars(f: Project, race: Race, tags: string[]): void {
    const c = this.ctx, d = this.dpr, C = this.colors;
    race.cars.forEach((b, i) => {
      if (i === 0) return;
      const bp = carPos(race.track, b), [bx, by] = f(bp[0], bp[1]);
      c.lineWidth = 2 * d; c.strokeStyle = C.ink; c.fillStyle = C.paper;
      c.beginPath(); c.arc(bx, by, 5 * d, 0, Math.PI * 2); c.fill(); c.stroke();
      if (tags[i]) { c.fillStyle = C.muted; c.textAlign = 'right'; c.fillText(tags[i], bx - 8 * d, by - 8 * d); c.textAlign = 'left'; }
    });
    const pp = carPos(race.track, race.player), [qx, qy] = f(pp[0], pp[1]);
    c.fillStyle = C.ink;
    c.beginPath(); c.arc(qx, qy, 5.5 * d, 0, Math.PI * 2); c.fill();
    c.fillText('Vos', qx + 8 * d, qy - 8 * d);
  }

  private fit(): void {
    this.redraw.touch();
    const t = this.track, w = this.box.clientWidth, h = this.box.clientHeight;
    if (!t || !w || !h) return;
    const d = this.dpr;
    this.W = Math.round(w * d);
    this.H = Math.round(h * d);
    this.cv.width = this.layer.width = this.W;
    this.cv.height = this.layer.height = this.H;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of t.q) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    // En una caja chica el margen fijo daría una escala negativa y el trazado se daría vuelta.
    const pad = Math.min(28 * d, Math.min(this.W, this.H) * 0.15);
    const sc = Math.min((this.W - 2 * pad) / (x1 - x0), (this.H - 2 * pad) / (y1 - y0));
    if (!(sc > 0)) { this.map = null; return; }
    const ox = (this.W - (x1 - x0) * sc) / 2, oy = (this.H - (y1 - y0) * sc) / 2;
    const f = (x: number, y: number): Pt => [ox + (x - x0) * sc, oy + (y1 - y) * sc];
    this.map = { sc, f };
    this.lctx.clearRect(0, 0, this.W, this.H);
    if (this.follow === null) this.paint(this.lctx, f, sc);
  }

  /** Trazado, zonas de frenada y línea de largada con la proyección f (sc: px por metro). */
  private paint(c: CanvasRenderingContext2D, f: Project, sc: number): void {
    const t = this.track as Track, d = this.dpr, C = this.colors, rw = Math.max(8 * d, 13 * sc), path = new Path2D();
    t.q.forEach(([x, y], i) => { const [mx, my] = f(x, y); if (i) path.lineTo(mx, my); else path.moveTo(mx, my); });
    path.closePath();
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.strokeStyle = C.ink; c.lineWidth = rw + 2.5 * d; c.stroke(path);
    c.strokeStyle = C.paper; c.lineWidth = rw; c.stroke(path);
    if (this.brakingShown) {
      c.strokeStyle = BRAKING_FILL;
      c.lineWidth = rw * 0.8;
      c.beginPath();
      for (let i = 0; i < t.n; i++) {
        const j = (i + 1) % t.n;
        if (t.ty[i] === 'b' && t.ty[j] === 'b') { const a = f(t.q[i][0], t.q[i][1]), b = f(t.q[j][0], t.q[j][1]); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); }
      }
      c.stroke();
    }
    const [sx, sy] = t.q[0], h0 = t.hd[0], wd = (rw / sc) * 0.75, nx = -Math.sin(h0), ny = Math.cos(h0);
    const s1 = f(sx + nx * wd, sy + ny * wd), s2 = f(sx - nx * wd, sy - ny * wd);
    c.strokeStyle = C.ink; c.lineCap = 'butt'; c.lineWidth = 3 * d;
    c.beginPath(); c.moveTo(s1[0], s1[1]); c.lineTo(s2[0], s2[1]); c.stroke();
  }
}
