// OpenStreetMap's bridge structures (© OpenStreetMap contributors, ODbL; raw data only, never shipped): for each box
// below, the bridges' supports (towers, pylons, piers and abutments: `bridge:support`, building=bridge, man_made=tower
// on a bridge) and the bridges' outlines (man_made=bridge), with their tags and centroids, so tools/pipeline/bridges.mjs
// can place the towers and piers the NOAA ENC does not hold (those on land, and the New Jersey shore's).
//
//   node tools/pipeline/fetch_osm_bridges.mjs [key ...]
//
// One OSM API 0.6 `map` call per box; the XML is cached in data/raw/osm_bridges/<key>.xml, the parse written to
// data/raw/osm_bridges.json (lon, lat).
import fs from 'node:fs';
import path from 'node:path';

const RAW = path.resolve('data/raw');
const XML_DIR = path.join(RAW, 'osm_bridges');
fs.mkdirSync(XML_DIR, { recursive: true });
const UA = 'valdrada-research/0.1 (project contact: github.com/mkturkcan/valdrada)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// box = [west, south, east, north], each round one bridge's main structure
const BOXES = {
  kosciuszko: [-73.9330, 40.7240, -73.9240, 40.7310],
  pulaski: [-73.9545, 40.7365, -73.9505, 40.7420],
  goethals: [-74.2060, 40.6320, -74.1890, 40.6400],
  bayonne: [-74.1470, 40.6375, -74.1370, 40.6460],
  outerbridge: [-74.2560, 40.5225, -74.2400, 40.5270],
  marineParkway: [-73.8900, 40.5680, -73.8800, 40.5800],
  crossBay: [-73.8240, 40.5860, -73.8150, 40.5960],
  rooseveltBr: [-73.9480, 40.7615, -73.9430, 40.7645],
  broadwayBr: [-73.9125, 40.8725, -73.9095, 40.8745],
  henryHudson: [-73.9245, 40.8755, -73.9195, 40.8800],
  harlemHigh: [-73.9330, 40.8410, -73.9220, 40.8490],
  macombs: [-73.9350, 40.8270, -73.9300, 40.8300],
  harlemLow: [-73.9350, 40.8020, -73.9280, 40.8210],
  universityHts: [-73.9165, 40.8610, -73.9130, 40.8640],
  whitestone: [-73.8340, 40.7975, -73.8260, 40.8060],
  throgs: [-73.7960, 40.7950, -73.7915, 40.8040],
  rfkBronxKill: [-73.9230, 40.7990, -73.9140, 40.8040],
  millBasin: [-73.9060, 40.6050, -73.9000, 40.6100],
  cityIsland: [-73.7960, 40.8550, -73.7900, 40.8590],
};

async function osmMap(name, box) {
  const file = path.join(XML_DIR, `${name}.xml`);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`https://api.openstreetmap.org/api/0.6/map?bbox=${box.join(',')}`, { headers: { 'User-Agent': UA } }).catch((e) => ({ ok: false, status: String(e) }));
    if (r.ok) { const txt = await r.text(); fs.writeFileSync(file, txt); console.log(`  ${name}: ${(txt.length / 1e6).toFixed(1)} MB`); await sleep(1500); return txt; }
    console.log(`  ${name}: HTTP ${r.status}, retry`);
    await sleep(5000 * (attempt + 1));
  }
  throw new Error('OSM API failed for ' + name);
}
function parse(xml) {
  const nodes = new Map(), ways = [];
  const attr = (s, k) => { const m = new RegExp(`\\b${k}="([^"]*)"`).exec(s); return m ? m[1] : null; };
  const tagsOf = (body) => { const t = {}; for (const m of body.matchAll(/<tag k="([^"]*)" v="([^"]*)"\/>/g)) t[m[1]] = m[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'"); return t; };
  for (const m of xml.matchAll(/<node ([^>]*?)(\/>|>([\s\S]*?)<\/node>)/g)) nodes.set(attr(m[1], 'id'), { ll: [+attr(m[1], 'lon'), +attr(m[1], 'lat')], tags: m[3] ? tagsOf(m[3]) : {} });
  for (const m of xml.matchAll(/<way ([^>]*?)>([\s\S]*?)<\/way>/g)) ways.push({ id: attr(m[1], 'id'), nd: [...m[2].matchAll(/<nd ref="(\d+)"\/>/g)].map((x) => x[1]), tags: tagsOf(m[2]) });
  return { nodes, ways };
}
const isSupport = (t) => !!t['bridge:support'] || t.building === 'bridge' || (t.man_made === 'tower' && /bridge|pylon/.test(t['tower:type'] || '')) || t['bridge:part'] === 'pylon';

const want = process.argv.slice(2);
const out = fs.existsSync(path.join(RAW, 'osm_bridges.json')) ? JSON.parse(fs.readFileSync(path.join(RAW, 'osm_bridges.json'), 'utf8')) : {};
for (const [key, box] of Object.entries(BOXES)) {
  if (want.length && !want.includes(key)) continue;
  const { nodes, ways } = parse(await osmMap(key, box));
  const supports = [], outlines = [];
  for (const w of ways) {
    const pts = w.nd.map((id) => nodes.get(id)?.ll).filter(Boolean);
    if (pts.length < 3) continue;
    const c = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
    if (isSupport(w.tags)) supports.push({ id: w.id, c, ring: pts, tags: w.tags });
    else if (w.tags.man_made === 'bridge') outlines.push({ id: w.id, ring: pts, tags: w.tags });
  }
  for (const [id, n] of nodes) if (isSupport(n.tags)) supports.push({ id, c: n.ll, ring: null, tags: n.tags });
  out[key] = { box, supports, outlines };
  console.log(`${key}: ${supports.length} supports, ${outlines.length} outlines`);
}
fs.writeFileSync(path.join(RAW, 'osm_bridges.json'), JSON.stringify(out));
