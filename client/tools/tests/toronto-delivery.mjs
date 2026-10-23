import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadTileBytes } from '../../src/toronto/load.js';
import { packageDemo, BUDGET } from '../toronto/package.mjs';
const valid = Buffer.alloc(12); valid.writeUInt32LE(0x43544c31);
async function served(handler, check) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await check(`http://127.0.0.1:${server.address().port}/tile`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
test('transport returns bytes and rejects HTTP, HTML and short responses', async () => {
  await served((_, res) => res.end(valid), async url => assert.deepEqual(Buffer.from(await loadTileBytes(url)), valid));
  for (const [status, body, expected] of [[404, 'missing', /HTTP 404/], [200, '<html>fallback</html>', /invalid tile/], [200, 'CTL', /incomplete/]]) {
    await served((_, res) => { res.statusCode = status; res.end(body); }, url => assert.rejects(loadTileBytes(url), expected));
  }
});
test('transport bounds declared and chunked bodies', async () => {
  await served((_, res) => { res.setHeader('Content-Length', '20000'); res.end(); }, url => assert.rejects(loadTileBytes(url), /download limit/));
  await served((_, res) => { res.write(Buffer.alloc(16000)); res.end(Buffer.alloc(1000)); }, url => assert.rejects(loadTileBytes(url), /download limit/));
});
test('timeout bounds absent headers and stalled body', async () => {
  for (const body of [false, true]) await served((_, res) => { if (body) { res.writeHead(200); res.write(valid); } }, url => assert.rejects(loadTileBytes(url, { timeoutMs: 50 }), /timed out/));
});
function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sixsim-delivery-'));
  try {
    for (const name of ['toronto.html', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.txt']) fs.writeFileSync(path.join(dir, name), name);
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'assets/tile.bin'), valid);
    fs.writeFileSync(path.join(dir, 'assets/main.js'), 'export {};');
    return run(dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
test('package inventory is deterministic and supplies index.html', () => fixture(dir => {
  const first = packageDemo(dir), manifest = fs.readFileSync(path.join(dir, 'PACKAGE.json'));
  assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), 'toronto.html');
  assert.deepEqual(packageDemo(dir), first);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'PACKAGE.json')), manifest);
  assert.ok(first.totalBytes < BUDGET.totalBytes);
}));
test('package rejects budget overruns and unexpected assets', () => {
  fixture(dir => { fs.writeFileSync(path.join(dir, 'assets/main.js'), Buffer.alloc(BUDGET.javascriptBytes + 1)); assert.throws(() => packageDemo(dir), /JavaScript/); });
  fixture(dir => { fs.writeFileSync(path.join(dir, 'assets/tile.bin'), Buffer.alloc(BUDGET.tileBytes + 1)); assert.throws(() => packageDemo(dir), /tile/); });
  fixture(dir => { fs.writeFileSync(path.join(dir, 'assets/extra.json'), Buffer.alloc(BUDGET.totalBytes)); assert.throws(() => packageDemo(dir), /Total/); });
  fixture(dir => { fs.writeFileSync(path.join(dir, 'raw.zip'), 'no'); assert.throws(() => packageDemo(dir), /Unexpected/); });
});
