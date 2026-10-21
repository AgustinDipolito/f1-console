/** Lo que depende del aparato: pantalla encendida durante la carrera, vibración, instalación y modo sin conexión. */

/** Vibración disponible (Android; el iPhone no la ofrece a la web). */
export const canVibrate = (): boolean => typeof navigator.vibrate === 'function';

/** Toque corto al accionar un control y un aviso más largo cuando salta un fusible. */
export const BUZZ = { tap: 8, alarm: [60, 50, 60] };
export function buzz(on: boolean, pattern: number | number[]): void {
  // Sin un toque previo el navegador la rechaza y lo avisa en la consola: no hace falta pedirla.
  if (on && canVibrate() && navigator.userActivation?.hasBeenActive !== false) navigator.vibrate(pattern);
}

/**
 * Pantalla encendida mientras el auto corre: la consola se toca seguido, pero entre tramo y tramo el teléfono
 * podía apagarla. Se pide y se suelta según el estado, y el navegador la suelta solo al ocultarse la pestaña.
 */
export class Awake {
  private lock: WakeLockSentinel | null = null;
  private want = false;
  private asking = false;

  set(on: boolean): void {
    if (on === this.want) return;
    this.want = on;
    void this.sync();
  }

  private async sync(): Promise<void> {
    if (this.asking || !('wakeLock' in navigator)) return;
    this.asking = true;
    let ok = true;
    try {
      if (this.want && !this.lock) {
        const lock = await navigator.wakeLock.request('screen');
        // Al ocultarse la pestaña el navegador la suelta: el próximo pedido la vuelve a tomar.
        lock.addEventListener('release', () => { if (this.lock === lock) { this.lock = null; this.want = false; } });
        this.lock = lock;
      } else if (!this.want && this.lock) {
        const lock = this.lock;
        this.lock = null;
        await lock.release();
      }
    } catch {
      ok = false; // sin permiso o con ahorro de batería: la pantalla se maneja como siempre hasta la próxima largada
    }
    this.asking = false;
    // Si mientras se pedía cambió lo que se quiere (una pausa justo al largar), se vuelve a acomodar.
    if (ok && this.want !== !!this.lock) void this.sync();
  }
}

/** Evento de instalación de Chrome y Edge; no está en los tipos del DOM. */
interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }

export interface InstallState {
  /** Instala la consola como aplicación; null si este navegador no lo ofrece ahora. */
  install: (() => void) | null;
  /** iPhone o iPad en el navegador: se instala desde Compartir. */
  ios: boolean;
}

const standalone = (): boolean =>
  matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as { standalone?: boolean }).standalone === true;
const isIos = (): boolean => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let deferred: InstallPrompt | null = null;
/** Guarda el ofrecimiento de instalar del navegador para ofrecerlo también en ajustes. El aviso propio del navegador sigue saliendo. */
export function watchInstall(): void {
  addEventListener('beforeinstallprompt', (e) => { deferred = e as InstallPrompt; });
  addEventListener('appinstalled', () => { deferred = null; });
}

/** Cómo se instala en este aparato, si todavía no está instalada. */
export function installState(): InstallState {
  if (standalone()) return { install: null, ios: false };
  const d = deferred;
  return { install: d ? () => { deferred = null; void d.prompt(); } : null, ios: isIos() };
}

/** Service worker de la versión web: guarda la página y los trazados para abrir sin conexión. No en el archivo único ni en desarrollo. */
export function registerWorker(): void {
  if (import.meta.env.MODE !== 'web' || !('serviceWorker' in navigator)) return;
  const go = (): void => { navigator.serviceWorker.register('./sw.js').catch((e: unknown) => console.error(e)); };
  if (document.readyState === 'complete') go();
  else addEventListener('load', go, { once: true });
}
