// Plain file serving, no Vite/SPA fallback: test the actual deployable directory.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
const dir = path.resolve('dist-toronto');
const inventory = JSON.parse(await fs.readFile(path.join(dir, 'PACKAGE.json')));
for (const f of inventory.files) {
  const bytes = await fs.readFile(path.join(dir, f.path));
  assert.equal(bytes.length, f.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), f.sha256);
}
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.bin': 'application/octet-stream', '.json': 'application/json', '.geojson': 'application/geo+json', '.txt': 'text/plain' };
const server = createServer(async (req, res) => {
  try {
    let name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (name.startsWith('/sixsim/')) name = name.slice('/sixsim'.length);
    if (name.startsWith('/nested/demo/')) name = name.slice('/nested/demo'.length);
    if (name.endsWith('/')) name += 'index.html';
    const file = path.resolve(dir, '.' + name);
    if (!file.startsWith(dir + path.sep)) throw new Error('outside');
    const bytes = await fs.readFile(file);
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream'); res.end(bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  for (const mount of ['/', '/sixsim/', '/nested/demo/']) {
    const paths = [];
    await page.route('**/*', route => {
      const url = new URL(route.request().url()); paths.push(url.pathname);
      assert.equal(url.origin, origin);
      assert.ok(url.pathname.startsWith(mount), `Root-relative URL: ${url.pathname}`);
      return route.continue();
    });
    assert.equal((await page.goto(origin + mount)).status(), 200);
    await page.waitForFunction(() => window.__TORONTO?.frames > 1);
    assert.match(await page.locator('#status').innerText(), /15 source masses/);
    assert.equal(await page.locator('#plan').isEnabled(), true);
    assert.equal(paths.filter(p => p.endsWith('.bin')).length, 1);
    assert.equal((await page.request.get(origin + mount + 'missing-file.bin')).status(), 404);
    await page.unroute('**/*');
  }
  for (const [kind, expected] of [['http', /HTTP 404/], ['html', /invalid tile/], ['network', /Unable to display/], ['short', /incomplete/], ['oversize', /download limit/]]) {
    await page.route('**/*.bin', route => {
      if (kind === 'network') return route.abort();
      return route.fulfill({ status: kind === 'http' ? 404 : 200,
        body: kind === 'html' ? '<html>host fallback</html>' : kind === 'short' ? 'CTL' : kind === 'oversize' ? Buffer.alloc(17000) : 'missing' });
    });
    await page.goto(origin + '/sixsim/');
    await page.waitForFunction(() => !document.querySelector('#reload').hidden);
    assert.match(await page.locator('#status').innerText(), expected);
    assert.equal(await page.locator('#plan').isDisabled(), true);
    assert.equal(await page.locator('canvas').count(), 0);
    await page.unroute('**/*.bin');
    await page.locator('#reload').click();
    await page.waitForFunction(() => window.__TORONTO?.frames > 1);
    assert.equal(await page.locator('canvas').count(), 1);
  }
  await page.evaluate(() => window.__TORONTO.renderer.getContext().getExtension('WEBGL_lose_context').loseContext());
  await page.waitForFunction(() => !document.querySelector('#reload').hidden);
  assert.match(await page.locator('#status').innerText(), /Graphics context lost/);
  assert.equal(await page.locator('#plan').isDisabled(), true);
  await page.locator('#reload').click();
  await page.waitForFunction(() => window.__TORONTO?.frames > 1);
  for (const module of ['main', 'identity']) {
    await page.route(`**/assets/${module}-*.js`, route => route.abort());
    await page.goto(origin + '/sixsim/');
    await page.waitForFunction(() => !document.querySelector('#reload').hidden);
    assert.match(await page.locator('#status').innerText(), /Unable to display/);
    await page.unroute(`**/assets/${module}-*.js`);
    await page.locator('#reload').click();
    await page.waitForFunction(() => window.__TORONTO?.frames > 1);
  }
  const noGpu = await browser.newPage();
  await noGpu.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      return ['webgl', 'webgl2', 'experimental-webgl'].includes(type) ? null : original.call(this, type, ...args);
    };
  });
  await noGpu.goto(origin + '/');
  await noGpu.waitForFunction(() => !document.querySelector('#reload').hidden);
  assert.match(await noGpu.locator('#status').innerText(), /WebGL context/);
  assert.equal(await noGpu.locator('#plan').isDisabled(), true);
  await noGpu.close();
  assert.deepEqual(errors, []);
  console.log('Static package: hashes, 3 mount paths, 5 tile failures/reloads, WebGL unavailability/context loss and module failure/reload passed');
} finally {
  await browser?.close(); server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
