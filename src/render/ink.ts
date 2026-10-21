import * as THREE from 'three';
import type { Palette } from './palette';

export type { Palette } from './palette';

THREE.ColorManagement.enabled = false;

const TONE_VS = `
varying vec3 vW;
void main() {
  vW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const TONE_FS = `
uniform vec3 uC; uniform vec3 uL; uniform vec3 uE; uniform float uOn;
varying vec3 vW;
void main() {
  vec3 n = normalize(vW);
  if (!gl_FrontFacing) n = -n;
  float t = clamp(dot(n, uL), 0.0, 1.0);
  vec3 c = min(uC * (0.62 + 0.48 * t), vec3(1.0));
  gl_FragColor = vec4(mix(c, uE, uOn), 1.0);
}`;

const NORMAL_VS = `
varying vec3 vN;
void main() {
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const NORMAL_FS = `
varying vec3 vN;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
}`;

const POST_VS = `
varying vec2 vU;
void main() { vU = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const POST_FS = `
uniform sampler2D tC; uniform sampler2D tN; uniform sampler2D tD;
uniform vec2 uPx; uniform vec3 uInk; uniform float uRg;
varying vec2 vU;
float D(vec2 o) { return texture2D(tD, vU + o * uPx).x; }
vec3 N(vec2 o) { return texture2D(tN, vU + o * uPx).xyz * 2.0 - 1.0; }
void main() {
  vec4 c = texture2D(tC, vU);
  float d0 = D(vec2(0.0)), dl = D(vec2(-1.0, 0.0)), dr = D(vec2(1.0, 0.0)), du = D(vec2(0.0, 1.0)), dd = D(vec2(0.0, -1.0));
  float bg = step(0.9999, d0) + step(0.9999, dl) + step(0.9999, dr) + step(0.9999, du) + step(0.9999, dd);
  float e = 0.0;
  if (bg > 0.0 && bg < 5.0) e = 1.0;
  else if (bg == 0.0) {
    e = smoothstep(0.3, 0.6, abs(4.0 * d0 - dl - dr - du - dd) * uRg);
    vec3 n0 = N(vec2(0.0));
    float nd = max(max(1.0 - dot(n0, N(vec2(-1.0, 0.0))), 1.0 - dot(n0, N(vec2(1.0, 0.0)))),
                   max(1.0 - dot(n0, N(vec2(0.0, 1.0))), 1.0 - dot(n0, N(vec2(0.0, -1.0)))));
    e = max(e, smoothstep(0.18, 0.3, nd));
  }
  float a = max(c.a, e);
  gl_FragColor = vec4(mix(c.rgb, uInk, e) * a, a);
}`;

/**
 * Pipeline visual estilo anatomy: tonos por orientación de cara (tapa clara, laterales
 * más oscuros) y contornos en tinta calculados por un pase de bordes sobre profundidad
 * y normales. La capa 1 son marcas impresas: se pintan pero no generan contornos.
 */
export class InkRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly light = new THREE.Vector3();
  readonly inkMat: THREE.MeshBasicMaterial;
  readonly redMat = new THREE.MeshBasicMaterial({ color: 0xe24b4a });
  private readonly baseLight = new THREE.Vector3(0.28, 0.8, 0.52).normalize();
  private readonly cache = new Map<number, THREE.ShaderMaterial>();
  private readonly rtC = new THREE.WebGLRenderTarget(1, 1);
  private readonly rtN = new THREE.WebGLRenderTarget(1, 1);
  private readonly normalMat: THREE.ShaderMaterial;
  private readonly post: THREE.ShaderMaterial;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.Camera();

  constructor(readonly pal: Palette, private readonly pixelRatio: number, depthRange: number) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, premultipliedAlpha: true });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(pixelRatio);
    this.light.copy(this.baseLight);
    this.inkMat = new THREE.MeshBasicMaterial({ color: pal.ink });
    this.rtN.depthTexture = new THREE.DepthTexture(1, 1);
    this.normalMat = new THREE.ShaderMaterial({ vertexShader: NORMAL_VS, fragmentShader: NORMAL_FS, side: THREE.DoubleSide });
    this.post = new THREE.ShaderMaterial({
      uniforms: {
        tC: { value: this.rtC.texture }, tN: { value: this.rtN.texture }, tD: { value: this.rtN.depthTexture },
        uPx: { value: new THREE.Vector2() }, uInk: { value: new THREE.Color(pal.ink) }, uRg: { value: depthRange },
      },
      vertexShader: POST_VS, fragmentShader: POST_FS, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  get canvas(): HTMLCanvasElement { return this.renderer.domElement; }

  tone(hex: number, emissive?: number): THREE.ShaderMaterial {
    if (emissive === undefined) { const c = this.cache.get(hex); if (c) return c; }
    const m = new THREE.ShaderMaterial({
      uniforms: { uC: { value: new THREE.Color(hex) }, uL: { value: this.light }, uE: { value: new THREE.Color(emissive ?? 0) }, uOn: { value: 0 } },
      vertexShader: TONE_VS, fragmentShader: TONE_FS, side: THREE.DoubleSide,
    });
    if (emissive === undefined) this.cache.set(hex, m);
    return m;
  }

  /** Gira la luz con la cámara para que los tonos por cara se mantengan al rotar. */
  setLightAzimuth(delta: number): void {
    const c = Math.cos(delta), s = Math.sin(delta), b = this.baseLight;
    this.light.set(b.x * c + b.z * s, b.y, -b.x * s + b.z * c);
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    // Mismo tamaño que el lienzo (three redondea hacia abajo): si no, el pase de bordes remuestrea y los contornos se corren.
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rtC.setSize(s.x, s.y);
    this.rtN.setSize(s.x, s.y);
    (this.post.uniforms.uPx.value as THREE.Vector2).set(1 / s.x, 1 / s.y);
  }

  render(scene: THREE.Scene, cam: THREE.Camera): void {
    const r = this.renderer;
    cam.layers.set(0);
    scene.overrideMaterial = this.normalMat;
    r.setRenderTarget(this.rtN); r.setClearColor(0x808080, 0); r.render(scene, cam);
    scene.overrideMaterial = null;
    cam.layers.enableAll();
    r.setRenderTarget(this.rtC); r.setClearColor(0x000000, 0); r.render(scene, cam);
    r.setRenderTarget(null); r.render(this.quadScene, this.quadCam);
  }

  dispose(): void {
    this.rtC.dispose(); this.rtN.dispose();
    this.cache.forEach((m) => m.dispose());
    this.inkMat.dispose(); this.redMat.dispose(); this.normalMat.dispose(); this.post.dispose();
    this.renderer.dispose();
    // dispose no suelta el contexto WebGL: cada volante rehecho (tema, colores, calidad) dejaba uno vivo y, pasado el
    // tope del navegador (unos 16), ya no se podía crear la pista 3D.
    this.renderer.forceContextLoss();
  }
}
