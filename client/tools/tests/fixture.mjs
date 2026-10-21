// WebGL smoke test against the production fixture, with no remote assets.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { preview } from 'vite';
import { chromium } from 'playwright';

const server = await preview({ configFile: 'vite.fixture.config.js', preview: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
  const errors = [];
  const base = server.resolvedUrls.local[0];
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== new URL(base).origin) {
      errors.push(`External request: ${route.request().url()}`);
      return route.abort();
    }
    return route.continue();
  });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  page.on('requestfailed', r => errors.push(`${r.url()}: ${r.failure()?.errorText}`));
  await mkdir('shots', { recursive: true });
  for (const type of ['rowhouse', 'mixeduse']) {
    await page.goto(`${base}fixture.html?type=${type}&shot=1`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__SHOT_READY, null, { timeout: 60_000 });
    const result = await page.evaluate(() => {
      const { renderer, scene } = window.__APP;
      let meshes = 0;
      scene.traverse(o => { if (o.isMesh) meshes++; });
      return { meshes, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        lost: renderer.getContext().isContextLost() };
    });
    assert.equal(result.lost, false);
    assert.ok(result.meshes > 5 && result.calls > 0 && result.triangles > 100, JSON.stringify(result));
    assert.match(await page.locator('aside').innerText(), /not Toronto data/);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `shots/fixture-${type}.png` });
    console.log(`${type}: ${JSON.stringify(result)}`);
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
