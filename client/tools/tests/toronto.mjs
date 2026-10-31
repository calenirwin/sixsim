import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { compileBlock } from '../toronto/compile.mjs';
import { parseTile, buildingsOf, holesOf } from '../../src/world/tiledata.js';
import { localFrame } from '../../src/shared/localFrame.js';
import { PROFILE } from '../../src/toronto/profile.js';
import { project, LAT0, LON0, tileId } from '../../src/shared/geo.js';
import { BUILDING_OVERRIDES } from '../../src/shared/landmarkSpec.js';

const sourceBytes = fs.readFileSync(new URL('../../fixtures/toronto/block.geojson', import.meta.url));
const source = JSON.parse(sourceBytes);
const provenance = JSON.parse(fs.readFileSync(new URL('../../fixtures/toronto/provenance.json', import.meta.url)));
const frame = localFrame(PROFILE.geoOrigin);
const near = (a, b, tolerance = 1e-4) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
function compiled(data = source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sixsim-toronto-'));
  try {
    const manifest = compileBlock(data, dir);
    const bytes = fs.readFileSync(path.join(dir, '0_0.bin'));
    return { manifest, bytes, tile: parseTile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('source provenance, revision and bounded selection are pinned', () => {
  assert.equal(createHash('sha256').update(sourceBytes).digest('hex'), provenance.subset_sha256);
  assert.equal(source.source_archive_sha256, provenance.archive_sha256);
  assert.equal(source.features.length, 15);
  assert.equal(source.excluded_boundary_record_indices.length, 10);
  assert.equal(provenance.license, 'Open Government Licence – Toronto, version 1.0');
  assert.equal(new Set(source.features.map(f => f.id)).size, 15);
  for (const f of source.features) for (const ring of f.geometry.coordinates) for (const [lon, lat] of ring) {
    assert.ok(lon >= source.bbox[0] && lon <= source.bbox[2]);
    assert.ok(lat >= source.bbox[1] && lat <= source.bbox[3]);
  }
});

test('explicit projection preserves upstream orientation, round trips and negative tile IDs', () => {
  const nyc = localFrame({ lat: LAT0, lon: LON0 });
  assert.deepEqual(nyc.project(-73.96, 40.81), project(-73.96, 40.81));
  const p = frame.project(-79.395, 43.649);
  assert.ok(p[0] > 100 && p[0] < 200 && p[1] > 100 && p[1] < 120);
  const ll = frame.unproject(...p); near(ll[0], -79.395, 1e-10); near(ll[1], 43.649, 1e-10);
  assert.equal(tileId(...frame.project(PROFILE.geoOrigin.lon - 0.00001, PROFILE.geoOrigin.lat + 0.00001)), '-1_-1');
  assert.throws(() => localFrame({ lat: 90, lon: 0 }), /Invalid/);
});

test('real records survive CTL1 encode/runtime decode with identities, heights and coordinates', () => {
  const { tile, manifest, bytes } = compiled();
  assert.equal(bytes.readUInt32LE(0), 0x43544c31);
  assert.ok(bytes.length < 20_000);
  assert.equal(manifest.tiles['0_0'].b, 15);
  assert.equal(tile.header.profile.id, PROFILE.id);
  const decoded = [...buildingsOf(tile, { applyOverrides: false })];
  assert.equal(decoded.length, source.features.length);
  for (const [i, b] of decoded.entries()) {
    const f = source.features[i];
    assert.equal(tile.header.records[i].sourceId, f.id);
    near(b.height, f.properties.AVG_HEIGHT);
    assert.equal(b.floors, 0); assert.equal(b.style, 255); assert.equal(b.baseY, 0);
    const points = Array.from({ length: b.len }, (_, j) => [tile.S.bldgXZ[2 * (b.start + j)], tile.S.bldgXZ[2 * (b.start + j) + 1]]);
    assert.equal(points.length, f.geometry.coordinates[0].length - 1);
    for (const ll of f.geometry.coordinates[0].slice(0, -1)) {
      const p = frame.project(...ll);
      assert.ok(points.some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.0001));
    }
    const signed = points.reduce((a, p, j) => { const q = points[(j + 1) % points.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0);
    assert.ok(signed > 0, 'upstream exterior winding');
  }
  assert.deepEqual(compiled().bytes, bytes, 'deterministic compile');
});

test('synthetic hole/multipart regression stays in the existing bholes contract', () => {
  // Test geometry only; never included in the real-data subset or viewer.
  const ring = points => points.map(p => frame.unproject(...p));
  const outer = ring([[20, 20], [60, 20], [60, 60], [20, 60], [20, 20]]);
  const hole = ring([[30, 30], [40, 30], [40, 40], [30, 40], [30, 30]]);
  const second = ring([[70, 20], [80, 20], [80, 30], [70, 30], [70, 20]]);
  const data = structuredClone(source); data.features = [structuredClone(source.features[0])];
  data.features[0].geometry = { type: 'MultiPolygon', coordinates: [[outer, hole], [second]] };
  const { tile } = compiled(data);
  assert.equal([...buildingsOf(tile, { applyOverrides: false })].length, 2);
  const holes = holesOf(tile);
  assert.equal(holes.get(0).length, 1); assert.equal(holes.get(0)[0].len, 4);
  assert.equal(holes.has(1), false);
  assert.deepEqual(tile.header.records.map(r => r.part), [0, 1]);
});

test('bad/missing heights, duplicate IDs and out-of-tile footprints fail closed', () => {
  for (const value of [null, NaN, 0, -1, 600]) {
    const data = structuredClone(source); data.features[0].properties.AVG_HEIGHT = value;
    assert.throws(() => compiled(data), /observed height/);
  }
  const duplicate = structuredClone(source); duplicate.features.push(duplicate.features[0]);
  assert.throws(() => compiled(duplicate), /duplicate source ID/);
  const outside = structuredClone(source);
  outside.features[0].geometry.coordinates[0][1] = [-80, 43];
  assert.throws(() => compiled(outside), /outside/);
});

test('Toronto opt-out suppresses NYC read-time overrides; existing default is preserved', () => {
  const override = BUILDING_OVERRIDES.find(o => o.height);
  assert.ok(override);
  const [x, z] = project(override.lon, override.lat);
  const { tile } = compiled();
  tile.header.origin = [x - 5, z - 5];
  tile.S.bldgXZ = new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]);
  tile.S.bldg = tile.S.bldg.slice(0, 44);
  const dv = new DataView(tile.S.bldg.buffer);
  dv.setUint32(0, 0, true); dv.setUint16(4, 4, true); dv.setFloat32(12, 1, true);
  assert.equal([...buildingsOf(tile)][0].height, override.height);
  assert.equal([...buildingsOf(tile, { applyOverrides: false })][0].height, 1);
});
