/**
 * Decide si hace falta volver a dibujar. Se dibuja cuando cambia lo que se muestra (la clave) y durante
 * `settle` segundos después, mientras las animaciones suavizadas llegan a su valor. Quieto, no se dibuja.
 */
export class Redraw {
  private key = '';
  private left = 0;

  constructor(private readonly settle: number) {}

  /** Fuerza el próximo cuadro: cambió el tamaño, el tema o algo que la clave no ve. */
  touch(): void { this.key = ''; }

  need(key: string, dt: number): boolean {
    if (key !== this.key) { this.key = key; this.left = this.settle; return true; }
    this.left -= dt;
    return this.left > 0;
  }
}

const written = new WeakMap<HTMLElement, Map<string, string>>();

/**
 * Escribe un estilo solo si cambió. Cada escritura invalida el estilo de la página, y leer después
 * el tamaño de algo obliga al navegador a recalcular todo de nuevo.
 */
export function setStyle(el: HTMLElement, prop: 'transform' | 'display', v: string): void {
  let m = written.get(el);
  if (!m) { m = new Map(); written.set(el, m); }
  if (m.get(prop) === v) return;
  m.set(prop, v);
  el.style[prop] = v;
}

export function setText(el: HTMLElement, s: string): void {
  if (el.textContent !== s) el.textContent = s;
}
