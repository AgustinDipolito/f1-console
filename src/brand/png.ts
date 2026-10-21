/** Lo justo de PNG para comprobar los íconos: el tamaño y los textos guardados, y agregar un texto al generarlos. */

const TEXT = 'tEXt';
const be = (b: Uint8Array, i: number): number => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const ascii = (b: Uint8Array, from: number, to: number): string => String.fromCharCode(...b.subarray(from, to));

/** Ancho, alto y textos (tEXt) de un PNG. Null si no es un PNG. */
export function pngInfo(b: Uint8Array): { w: number; h: number; text: Record<string, string> } | null {
  if (b.length < 33 || ascii(b, 1, 4) !== 'PNG' || ascii(b, 12, 16) !== 'IHDR') return null;
  const text: Record<string, string> = {};
  for (let i = 8; i + 8 <= b.length;) {
    const len = be(b, i), type = ascii(b, i + 4, i + 8);
    if (type === TEXT) {
      const data = b.subarray(i + 8, i + 8 + len), z = data.indexOf(0);
      text[ascii(data, 0, z)] = ascii(data, z + 1, data.length);
    }
    i += 12 + len;
  }
  return { w: be(b, 16), h: be(b, 20), text };
}

let table: Uint32Array | null = null;
function crc32(b: Uint8Array): number {
  if (!table) table = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let c = 0xffffffff;
  for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** El mismo PNG con un texto agregado después de la cabecera. */
export function withText(png: Uint8Array, key: string, value: string): Uint8Array {
  const data = Uint8Array.from(`${TEXT}${key}\0${value}`, (ch) => ch.charCodeAt(0));
  const chunk = new Uint8Array(12 + data.length - 4);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, data.length - 4);
  chunk.set(data, 4);
  dv.setUint32(chunk.length - 4, crc32(data));
  const at = 33; // firma (8) + IHDR (25)
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, at));
  out.set(chunk, at);
  out.set(png.subarray(at), at + chunk.length);
  return out;
}
