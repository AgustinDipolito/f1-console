import { mkdir, readFile, writeFile } from 'node:fs/promises';

const catalog = JSON.parse(await readFile(new URL('../src/tracks/catalog.json', import.meta.url), 'utf8'));
const out = new URL('../public/tracks/', import.meta.url);
await mkdir(out, { recursive: true });

let ok = 0;
for (const { id, name } of catalog) {
  const url = `https://cdn.jsdelivr.net/gh/bacinger/f1-circuits@master/circuits/${id}.geojson`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await writeFile(new URL(`${id}.geojson`, out), await r.text());
    ok++;
    console.log(`ok     ${id}  ${name}`);
  } catch (e) {
    console.warn(`falló  ${id}: ${e.message}`);
  }
}
console.log(`${ok}/${catalog.length} trazados en public/tracks/`);
