// Turn the isolated build into an ordinary static directory, with deterministic inventory.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
export const BUDGET = Object.freeze({ totalBytes: 2_600_000, javascriptBytes: 700_000, tileBytes: 16_384 });
export function packageDemo(dir) {
  fs.rmSync(path.join(dir, 'PACKAGE.json'), { force: true });
  fs.copyFileSync(path.join(dir, 'toronto.html'), path.join(dir, 'index.html'));
  const files = [];
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Static package must not contain symlinks');
      if (entry.isDirectory()) { walk(file); continue; }
      const name = path.relative(dir, file).split(path.sep).join('/');
      if (name === 'PACKAGE.json') continue;
      if (!/\.(html|js|json|geojson|bin|txt)$/.test(name)) throw new Error(`Unexpected package asset: ${name}`);
      const data = fs.readFileSync(file);
      files.push({ path: name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
    }
  }
  walk(dir);
  for (const required of ['index.html', 'toronto.html', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.txt']) {
    if (!files.some(f => f.path === required)) throw new Error(`Missing ${required}`);
  }
  const jsBytes = files.filter(f => f.path.endsWith('.js')).reduce((n, f) => n + f.bytes, 0);
  const tiles = files.filter(f => f.path.endsWith('.bin'));
  if (tiles.length !== 1 || tiles[0].bytes > BUDGET.tileBytes) throw new Error('Expected one tile within the byte budget');
  if (jsBytes > BUDGET.javascriptBytes) throw new Error('JavaScript byte budget exceeded');
  const report = { version: 1, entry: 'index.html', budget: BUDGET, files };
  const json = JSON.stringify(report, null, 2) + '\n';
  const total = files.reduce((n, f) => n + f.bytes, 0) + Buffer.byteLength(json);
  if (total > BUDGET.totalBytes) throw new Error('Total package byte budget exceeded');
  fs.writeFileSync(path.join(dir, 'PACKAGE.json'), json);
  return { totalBytes: total, javascriptBytes: jsBytes, tileBytes: tiles[0].bytes, files: files.length + 1 };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist-toronto');
  console.log(JSON.stringify(packageDemo(dir)));
}
