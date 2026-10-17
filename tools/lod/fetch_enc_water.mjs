#!/usr/bin/env node
// The water round the city from NOAA's Electronic Navigational Charts (ENC Direct, public domain): the depth areas and
// dredged areas of the harbour, approach and coastal charts over the persistent tier's L6 squares, for tools/lod/water_l6.py,
// which clips the far level's water to them.
// BD40 (backdrop lane, 2026-10-11): the extent is the backdrop's L6 squares (i -7..5, j -5..6: x -57.3 to +49.2 km, z -41.0
// to +57.3 km about the city's origin, the city's line buffered by 25 km), and each scale's coverage areas (M_COVR) and
// unsurveyed areas come too, so water_l6.py takes a coarser chart only where no finer one covers.
//
//   node tools/lod/fetch_enc_water.mjs [--out <file>]     writes client/data/raw/enc_water.json (GeoJSON, lon/lat)
//
// One ArcGIS REST query per chart scale and layer, paged; the features keep their scale band and object class.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argOut = process.argv.indexOf('--out');
const OUT = argOut > 0 ? path.resolve(process.argv[argOut + 1]) : path.join(root, 'client', 'data', 'raw', 'enc_water.json');
const BASE = 'https://encdirect.noaa.gov/arcgis/rest/services/encdirect';
const UA = 'valdrada-research/0.1 (project contact: github.com/mkturkcan/valdrada)';
// the L6 squares' extent in lon/lat (client/src/shared/geo.js project(), inverted)
const LAT0 = 40.7831, LON0 = -73.9712, MLAT = 111132.0, MLON = 111320.0 * Math.cos((LAT0 * Math.PI) / 180);
const X0 = -57344, X1 = 49152, Z0 = -40960, Z1 = 57344;   // BD40: the backdrop's L6 squares (was x -32.8..32.8, z -24.6..41.0 km)
const BBOX = [LON0 + X0 / MLON, LAT0 - Z1 / MLAT, LON0 + X1 / MLON, LAT0 - Z0 / MLAT];   // west, south, east, north
const SCALES = ['harbour', 'approach', 'coastal'];
const WANT = /\.(Depth_Area|Dredged_Area|Coverage_area|Unsurveyed_Area)$/;   // BD40: + coverage and unsurveyed areas
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url) {
  for (let k = 0; k < 4; k++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (r.ok) return await r.json();
      console.log(`  HTTP ${r.status}, retry`);
    } catch (e) { console.log(`  ${e.message}, retry`); }
    await sleep(3000 * (k + 1));
  }
  throw new Error('ENC Direct failed: ' + url);
}

const out = { type: 'FeatureCollection', source: 'NOAA ENC Direct (public domain)', bbox: BBOX, fetched: new Date().toISOString(), features: [] };
for (const sc of SCALES) {
  const svc = await getJSON(`${BASE}/enc_${sc}/MapServer?f=json`);
  const layers = (svc.layers || []).filter((l) => WANT.test(l.name) && !/_(line|point)$/.test(l.name));
  for (const L of layers) {
    let off = 0, n = 0;
    // BD40: the fields each layer has (a field a layer lacks fails the whole query), and a failed query stops the fetch
    const meta = await getJSON(`${BASE}/enc_${sc}/MapServer/${L.id}?f=json`);
    const have = new Set((meta.fields || []).map((f) => f.name));
    const fields = ['DRVAL1', 'DRVAL2', 'CATCOV', 'DSNM'].filter((f) => have.has(f)).join(',') || 'OBJECTID';
    for (;;) {
      const q = new URLSearchParams({ where: '1=1', geometry: BBOX.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
        outFields: fields, returnGeometry: 'true', outSR: '4326', resultOffset: String(off), resultRecordCount: '1000', f: 'geojson' });
      const fc = await getJSON(`${BASE}/enc_${sc}/MapServer/${L.id}/query?${q}`);
      if (fc.error) throw new Error(`ENC Direct query failed (${sc} ${L.name}): ${JSON.stringify(fc.error)}`);
      const fs_ = fc.features || [];
      for (const f of fs_) { f.properties = { ...(f.properties || {}), scale: sc, layer: L.name }; out.features.push(f); }
      n += fs_.length; off += fs_.length;
      if (fs_.length < 1000 && !fc.exceededTransferLimit) break;
      await sleep(500);
    }
    console.log(`${sc} ${L.name} (layer ${L.id}): ${n} features`);
  }
}
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`${out.features.length} features -> ${OUT}`);
