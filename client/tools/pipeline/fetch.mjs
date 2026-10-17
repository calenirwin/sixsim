// NYC Open Data fetcher with disk cache and pagination.
// Usage: node tools/pipeline/fetch.mjs --boro 1        (1=MN 2=BX 3=BK 4=QN 5=SI)
//        node tools/pipeline/fetch.mjs --boro 1,2,3,4,5
//        --noshared skips the citywide datasets (hydrants, boundaries, shelters, kiosks, racks, FISP, OSM colours,
//        subway entrances, rail lines) and fetches only the boroughs' own files; --noshared --rail adds the rail lines
//        --footprints fetches a fresh footprint export for the listed boroughs into data/raw/footprints/<date>/ (see below)
import fs from 'node:fs';
import path from 'node:path';

const RAW = path.resolve('data/raw');
fs.mkdirSync(RAW, { recursive: true });

const BOROS = {
  1: { pluto: 'MN', name: 'Manhattan', parks: 'M', cscl: '1', trees: 'Manhattan' },
  2: { pluto: 'BX', name: 'Bronx', parks: 'X', cscl: '2', trees: 'Bronx' },
  3: { pluto: 'BK', name: 'Brooklyn', parks: 'B', cscl: '3', trees: 'Brooklyn' },
  4: { pluto: 'QN', name: 'Queens', parks: 'Q', cscl: '4', trees: 'Queens' },
  5: { pluto: 'SI', name: 'Staten Island', parks: 'R', cscl: '5', trees: 'Staten Island' },
};
// Generous per-borough bboxes (lat1,lon1,lat2,lon2) for datasets without a borough column.
const BBOX = {
  1: [40.678, -74.05, 40.888, -73.9], // Manhattan (incl. Marble Hill fringe)
  2: [40.783, -73.94, 40.92, -73.746],
  3: [40.55, -74.045, 40.741, -73.83],
  4: [40.535, -73.97, 40.812, -73.695],
  // Staten Island: the borough polygon spans lat 40.4961..40.6489, lon -74.2556..-74.0492 (boundaries.geojson); the box
  // runs east to -74.04 so the Verrazzano-Narrows Bridge reaches the Brooklyn file's box (west edge -74.045) and the
  // bridges to New Jersey keep their New York spans
  5: [40.49, -74.26, 40.66, -74.04],
};
// a User-Agent on every request (Overpass answers 429 without one)
const UA = 'valdrada-research/0.1 (project contact: github.com/mkturkcan/valdrada)';

async function fetchJSON(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'X-App-Token': '', 'User-Agent': UA } });
      if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
      if (!r.ok) throw new Error('HTTP ' + r.status + ' fatal');
      return await r.text();
    } catch (e) {
      if (String(e).includes('fatal') || i === tries - 1) throw e;
      const wait = 2000 * (i + 1);
      console.log(`  retry in ${wait}ms: ${e.message ?? e}`);
      await new Promise((s) => setTimeout(s, wait));
    }
  }
}

// Paginated GeoJSON fetch -> single FeatureCollection on disk.
async function geoPaged(outFile, base, where, pageSize = 40000) {
  const out = path.join(RAW, outFile);
  if (fs.existsSync(out)) { console.log(`cache hit ${outFile}`); return; }
  const feats = [];
  for (let offset = 0; ; offset += pageSize) {
    const url = `${base}?$limit=${pageSize}&$offset=${offset}${where ? `&$where=${encodeURIComponent(where)}` : ''}&$order=:id`;
    process.stdout.write(`  ${outFile} offset ${offset} ... `);
    const txt = await fetchJSON(url);
    const fc = JSON.parse(txt);
    const n = fc.features?.length ?? 0;
    console.log(`${n} rows`);
    feats.push(...(fc.features ?? []));
    if (n < pageSize) break;
    await new Promise((s) => setTimeout(s, 500));   // a pause between pages: the anonymous Socrata quota
  }
  fs.writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features: feats }));
  console.log(`wrote ${outFile}: ${feats.length} features`);
}

async function csvPaged(outFile, base, params, pageSize = 50000) {
  const out = path.join(RAW, outFile);
  if (fs.existsSync(out)) { console.log(`cache hit ${outFile}`); return; }
  let all = '';
  for (let offset = 0; ; offset += pageSize) {
    const url = `${base}?$limit=${pageSize}&$offset=${offset}&${params}&$order=:id`;
    process.stdout.write(`  ${outFile} offset ${offset} ... `);
    const txt = await fetchJSON(url);
    const lines = txt.trim().split('\n');
    const n = lines.length - 1;
    console.log(`${n} rows`);
    if (offset === 0) all = txt.trim();
    else all += '\n' + lines.slice(1).join('\n');
    if (n < pageSize) break;
    await new Promise((s) => setTimeout(s, 500));
  }
  fs.writeFileSync(out, all);
  console.log(`wrote ${outFile}`);
}

const NYC = (id) => `https://data.cityofnewyork.us/resource/${id}.geojson`;
const NYCCSV = (id) => `https://data.cityofnewyork.us/resource/${id}.csv`;

async function fetchBoro(b) {
  const B = BOROS[b];
  const [la1, lo1, la2, lo2] = BBOX[b];
  console.log(`\n### Fetching borough ${b} (${B.name})`);

  // Building footprints (bbox filter; deduped at compile time by bin)
  await geoPaged(`buildings_${b}.geojson`, NYC('5zhs-2jue'),
    `within_box(the_geom,${la1},${lo1},${la2},${lo2})`, 30000);

  // PLUTO attributes
  await csvPaged(`pluto_${b}.csv`, NYCCSV('64uk-42ks'),
    `$select=${encodeURIComponent('bbl,numfloors,yearbuilt,bldgclass,landuse,lotarea,bldgarea,unitsres,unitstotal,numbldgs,bldgfront,builtfar,histdist,landmark,zonedist1,address,ownername')}` +
    `&$where=${encodeURIComponent(`borough='${B.pluto}'`)}`);

  // Street centerlines — bbox fetch so bridge spans/approaches and
  // cross-river waterfront streets are included (deduped by physicalid at compile).
  await geoPaged(`streets_${b}.geojson`, NYC('inkn-q76z'),
    `within_box(the_geom,${la1},${lo1},${la2},${lo2})`, 30000);

  // Street trees (2015 census, live only)
  await csvPaged(`trees_${b}.csv`, NYCCSV('uvpi-gqnh'),
    `$select=${encodeURIComponent('spc_common,tree_dbh,status,latitude,longitude')}` +
    `&$where=${encodeURIComponent(`boroname='${B.trees}' AND status='Alive'`)}`);

  // Parks polygons
  await geoPaged(`parks_${b}.geojson`, NYC('enfh-gkve'),
    `borough='${B.parks}'`, 5000);
}

// NYC Planimetric Database: Railroad Line (one centreline per track, with the at grade / elevated / embankment / viaduct /
// open cut / fence / abandoned feature codes; compile.mjs RL36 draws the at-grade, embankment and open-cut ones)
async function fetchRail() {
  await geoPaged('rail_lines.geojson', NYC('anc7-97cy'), null, 10000);
}

async function fetchShared() {
  console.log('\n### Fetching shared/citywide datasets');
  await fetchRail();
  await geoPaged('hydrants.geojson', NYC('5bgh-vtsn'), null, 40000);
  await geoPaged('boundaries.geojson', NYC('gthc-hcne'), null, 100);
  await geoPaged('shelters.geojson', NYC('t4f2-8md7'), null, 10000);
  await geoPaged('linknyc.geojson', NYC('s4kf-3yrf'), null, 10000);
  // DOT Bicycle Parking (CityRacks program, ~47k rack points)
  await geoPaged('bikeracks.geojson', NYC('592z-n7dk'), null, 40000);
  // DOB FISP facade filings: REAL exterior wall material/type per BIN (all bldgs >6 stories)
  await csvPaged('fisp.csv', NYCCSV('xubg-57si'),
    `$select=${encodeURIComponent('bin,exterior_wall_material_s_,exterior_wall_type_s_,filing_date')}` +
    `&$where=${encodeURIComponent("exterior_wall_material_s_ IS NOT NULL")}`);
  // OSM building:colour tags (literal facade colours, ~2.2k buildings in the bbox)
  {
    const out = path.join(RAW, 'osm_colours.json');
    if (!fs.existsSync(out)) {
      const q = '[out:json][timeout:120];way["building"]["building:colour"](40.49,-74.26,40.92,-73.70);out tags center;';
      const r = await fetch('https://overpass.kumi.systems/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: 'data=' + encodeURIComponent(q),
      });
      const j = await r.json();
      const rows = (j.elements || []).map((e) => ({
        lat: e.center?.lat, lon: e.center?.lon,
        colour: e.tags?.['building:colour'], material: e.tags?.['building:material'] || null,
      })).filter((e) => e.lat && e.colour);
      fs.writeFileSync(out, JSON.stringify(rows));
      console.log('wrote osm_colours.json:', rows.length);
    } else console.log('cache hit osm_colours.json');
  }
  // MTA subway entrances (state portal, plain JSON w/ lat/lon columns)
  const out = path.join(RAW, 'subway.csv');
  if (!fs.existsSync(out)) {
    await csvPaged('subway.csv', 'https://data.ny.gov/resource/i9wp-a4ja.csv',
      `$select=${encodeURIComponent('stop_name,daytime_routes,entrance_type,entrance_latitude,entrance_longitude')}`);
  } else console.log('cache hit subway.csv');
}

// --footprints: a fresh building-footprint export per borough (5zhs-2jue, the same bbox as fetchBoro) into a dated folder,
// data/raw/footprints/<YYYY-MM-DD>/buildings_<b>.geojson, with data/raw/footprints/latest pointing at it (compile.mjs reads
// latest/ first; the files fetched beside the other raw data stay untouched). Each export is checked against the live
// dataset's own count for the box: the July 2026 exports lacked 2,299 of today's 163,914 Manhattan records, among them
// 30 Rockefeller Plaza and 91 towers over 60 m (the towers lane, 2026-10-11), and nothing had noticed.
async function fetchFootprints(boros) {
  const day = new Date().toISOString().slice(0, 10);
  const rel = path.join('footprints', day), dir = path.join(RAW, rel);
  fs.mkdirSync(dir, { recursive: true });
  const report = {};
  for (const b of boros) {
    const [la1, lo1, la2, lo2] = BBOX[b];
    const where = `within_box(the_geom,${la1},${lo1},${la2},${lo2})`;
    const file = path.join(rel, `buildings_${b}.geojson`);
    await geoPaged(file, NYC('5zhs-2jue'), where, 30000);
    const n = JSON.parse(fs.readFileSync(path.join(RAW, file), 'utf8')).features.length;
    const live = +JSON.parse(await fetchJSON(`${NYC('5zhs-2jue').replace(/\.geojson$/, '.json')}?$select=count(*)&$where=${encodeURIComponent(where)}`))[0].count;
    report[b] = { file, features: n, liveCount: live, ok: n === live };
    console.log(`buildings_${b}: ${n} features, the live dataset counts ${live} in the box${n === live ? '' : '  MISMATCH (re-run: a page shifted while paging)'}`);
  }
  fs.writeFileSync(path.join(dir, 'fetch.json'), JSON.stringify({ fetched: new Date().toISOString(), dataset: '5zhs-2jue', report }, null, 1));
  if (Object.values(report).every((r) => r.ok)) {
    const link = path.join(RAW, 'footprints', 'latest');
    try { fs.unlinkSync(link); } catch { /* none yet */ }
    fs.symlinkSync(day, link);
    console.log(`footprints/latest -> ${day}`);
  } else { console.error('footprints/latest NOT moved: a count did not match'); process.exitCode = 1; }
}

const arg = process.argv.find((a) => a.startsWith('--boro'));
const list = (arg ? (arg.split('=')[1] ?? process.argv[process.argv.indexOf(arg) + 1]) : '1').split(',').map(Number);
const unknown = list.filter((b) => !BOROS[b]);
if (unknown.length) { console.error(`unknown borough ${unknown.join(',')} (1=MN 2=BX 3=BK 4=QN 5=SI)`); process.exit(2); }
if (process.argv.includes('--footprints')) { await fetchFootprints(list); console.log('\nDone.'); process.exit(); }
if (!process.argv.includes('--noshared')) await fetchShared();
else if (process.argv.includes('--rail')) await fetchRail();
for (const b of list) await fetchBoro(b);
console.log('\nDone.');
