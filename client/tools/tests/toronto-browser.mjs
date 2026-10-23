import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { preview } from 'vite';
import { chromium } from 'playwright';

// Mount below a project path to catch root-relative URLs before any Pages deployment.
const server = await preview({ configFile: 'vite.toronto.config.js', base: '/sixsim/', preview: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const base = server.resolvedUrls.local[0];
  const errors = [], requests = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url()); requests.push(url.pathname);
    if (url.origin !== new URL(base).origin || !url.pathname.startsWith('/sixsim/')) {
      errors.push(`Nonlocal or root-relative request: ${url}`); return route.abort();
    }
    return route.continue();
  });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  page.on('requestfailed', r => errors.push(`${r.url()}: ${r.failure()?.errorText}`));
  await page.goto(`${base}toronto.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__TORONTO?.frames >= 3);
  const stats = await page.evaluate(() => {
    const a = window.__TORONTO;
    return { count: a.masses.children.length, triangles: a.renderer.info.render.triangles,
      lost: a.renderer.getContext().isContextLost(), height: a.records[0].height,
      firstId: a.masses.children[0].userData.sourceId };
  });
  assert.equal(stats.count, 15); assert.equal(stats.firstId, '2025:record:137000');
  assert.ok(Math.abs(stats.height - 8.5619) < 1e-4);
  assert.ok(stats.triangles > 100); assert.equal(stats.lost, false);
  assert.match(await page.locator('aside').innerText(), /Open Government Licence/);
  assert.match(await page.locator('#status').innerText(), /15 source masses/);
  assert.equal(requests.filter(p => p.endsWith('.bin')).length, 1);
  await mkdir('shots', { recursive: true });
  await page.screenshot({ path: 'shots/toronto-perspective.png' });
  await page.locator('#plan').click();
  const click = await page.evaluate(() => {
    // Exercise a preset change and projection in the same event turn, before RAF.
    document.querySelector('#perspective').click();
    document.querySelector('#plan').click();
    const { masses, camera, renderer } = window.__TORONTO;
    const geometry = masses.children[1].geometry;
    geometry.computeBoundingBox();
    const p = geometry.boundingBox.min.clone().add(geometry.boundingBox.max).multiplyScalar(0.5).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
  });
  await page.mouse.click(click.x, click.y);
  assert.match(await page.locator('#detail').innerText(), /2025:record:137020.*7\.7509/);
  await page.screenshot({ path: 'shots/toronto-plan.png' });
  // Inspect downloadable evidence as served, not merely HTML links.
  for (const id of ['source-download', 'provenance-download']) {
    const href = await page.locator(`#${id}`).getAttribute('href');
    const response = await page.request.get(new URL(href, base).href);
    assert.equal(response.status(), 200); assert.ok(await response.json());
  }
  for (const name of ['LICENSE.txt', 'THIRD_PARTY_NOTICES.txt']) {
    const response = await page.request.get(new URL(name, base).href);
    assert.equal(response.status(), 200); assert.match(await response.text(), /MIT/);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ...stats, requests: requests.length, subpath: '/sixsim/', errors }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
