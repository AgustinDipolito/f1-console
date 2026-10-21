/** Lo único de Node que usan las pruebas: leer archivos del proyecto. El proyecto no trae @types/node. */
declare module 'node:fs' {
  export function readFileSync(path: URL): Uint8Array;
  export function readFileSync(path: URL, encoding: 'utf8'): string;
}
