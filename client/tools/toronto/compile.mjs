// Bounded massing importer: existing CTL1 writer and 44-byte building record.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeTile } from '../pipeline/binio.mjs';
import { localFrame } from '../../src/shared/localFrame.js';
import { PROFILE } from '../../src/toronto/profile.js';

const frame = localFrame(PROFILE.geoOrigin);
const area = ring => ring.reduce((a, p, i) => {
  const q = ring[(i + 1) % ring.length];
  return a + p[0] * q[1] - q[0] * p[1];
}, 0) / 2;

export function compileBlock(collection, out, { tx=0, tz=0, district=false } = {}) {
  const origin=[tx*512,tz*512];
  if (collection.type !== 'FeatureCollection' || !collection.features.length || collection.features.length > (district ? 10000 : 50)) {
    throw new Error(district?'Expected 1–10000 district parts':'Expected 1–50 source features');
  }
  const positions = [], records = [], holes = [], identities = [], ids = new Set();
  function addRing(coordinates, exterior) {
    if (coordinates.length < 4 || coordinates[0].some((v, i) => v !== coordinates.at(-1)[i])) {
      throw new Error('Expected a closed source ring');
    }
    const ring = coordinates.slice(0, -1).map(([lon, lat]) => frame.project(lon, lat).map((v,i)=>v-origin[i]));
    if (ring.length > 65535 || ring.some(p => p.some(v => !Number.isFinite(v) || (!district && (v < 0 || v >= 512)) || Math.abs(v)>4096))) {
      throw new Error('Footprint outside the single 512 m tile or non-finite');
    }
    const signed = area(ring);
    if (Math.abs(signed) < 0.01) throw new Error('Degenerate footprint');
    if ((signed > 0) !== exterior) ring.reverse();
    const start = positions.length / 2;
    positions.push(...ring.flat());
    return { start, len: ring.length, area: Math.abs(signed) };
  }
  for (const feature of collection.features) {
    if (typeof feature.id !== 'string' || ids.has(feature.id)) throw new Error('Missing/duplicate source ID');
    ids.add(feature.id);
    const height = feature.properties?.[PROFILE.heightField];
    if (!Number.isFinite(height) || height <= 0 || height >= 600) throw new Error('Missing/invalid observed height');
    const geom = feature.geometry;
    const polygons = geom?.type === 'Polygon' ? [geom.coordinates] : geom?.type === 'MultiPolygon' ? geom.coordinates : null;
    if (!polygons?.length) throw new Error('Expected Polygon/MultiPolygon');
    for (const [part, polygon] of polygons.entries()) {
      if (!polygon.length) throw new Error('Empty polygon');
      const outer = addRing(polygon[0], true);
      const index = records.length;
      let footprintArea = outer.area;
      for (const coordinates of polygon.slice(1)) {
        const hole = addRing(coordinates, false);
        footprintArea -= hole.area;
        const bytes = Buffer.alloc(12);
        bytes.writeUInt32LE(index, 0); bytes.writeUInt32LE(hole.start, 4);
        bytes.writeUInt16LE(hole.len, 8); bytes.writeUInt8(Math.min(255, Math.round(hole.area / 4)), 11);
        holes.push(bytes);
      }
      if (footprintArea <= 0 || footprintArea > 65535) throw new Error('Unsupported footprint area');
      const bytes = Buffer.alloc(44);
      bytes.writeUInt32LE(outer.start, 0); bytes.writeUInt16LE(outer.len, 4);
      bytes.writeInt16LE(-1, 6); // no landmark
      bytes.writeFloatLE(height, 12); // base is explicitly flat, not an observed elevation
      bytes.writeUInt8(255, 17); // unclassified: never invent a NYC facade family
      bytes.set([180, 191, 202], 18);
      bytes.writeUInt16LE(Math.round(footprintArea), 40);
      records.push(bytes);
      identities.push({ sourceId: feature.sourceId ?? feature.id, part: feature.sourcePart ?? part, sourceRecordIndex: feature.properties.source_record_index });
    }
  }
  const header = { v: 1, tx, tz, origin, res: 1, names: [], nodes: [],
    profile: PROFILE, sourceArchiveSha256: collection.source_archive_sha256,
    records: identities, unknownFields: ['floors', 'facadeStyle', 'use', 'roof', 'terrain', 'roads'] };
  fs.mkdirSync(out, { recursive: true });
  writeTile(path.join(out, `${tx}_${tz}.bin`), header, [
    { name: 'bldgXZ', array: new Float32Array(positions) },
    { name: 'bldg', array: new Uint8Array(Buffer.concat(records)) },
    { name: 'bholes', array: new Uint8Array(Buffer.concat(holes)) },
    { name: 'roads', array: new Uint8Array() }, { name: 'furn', array: new Uint8Array() },
    { name: 'roadVerts', array: new Float32Array() }, { name: 'terrain', array: new Float32Array(4) },
  ]);
  const manifest = { tile: 512, macro: 2048, bounds: [0, 0, 512, 512], profile: PROFILE,
    tiles: { [`${tx}_${tz}`]: { f: `${tx}_${tz}.bin`, b: records.length, r: 0, fu: 0 } }, macros: {} };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

// Whole polygon parts belong to their bounding-box centre tile. Boundary-crossing
// vertices remain intact in local float coordinates; no clipping or duplication.
export function compileDistrict(collection, out) {
  if(collection.type!=='FeatureCollection' || !collection.features.length || collection.features.length>10000) throw new Error('District source budget exceeded');
  const groups=new Map(), seen=new Set();
  for(const feature of collection.features) {
    if(typeof feature.id!=='string' || seen.has(feature.id))throw new Error('Missing/duplicate source ID');
    seen.add(feature.id);
    const parts=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.type==='MultiPolygon'?feature.geometry.coordinates:null;
    if(!parts)throw new Error('Expected Polygon/MultiPolygon');
    parts.forEach((coordinates,part)=>{
      const points=coordinates[0].map(p=>frame.project(...p));
      if(points.some(p=>p.some(v=>!Number.isFinite(v) || Math.abs(v)>10000)))throw new Error('District coordinate budget exceeded');
      const axes=[0,1].map(i=>points.map(p=>p[i]));
      const [tx,tz]=axes.map(a=>Math.floor((Math.min(...a)+Math.max(...a))/1024));
      const key=`${tx}_${tz}`, list=groups.get(key)||[];
      list.push({...feature,id:`${feature.id}:part:${part}`,sourceId:feature.id,sourcePart:part,geometry:{type:'Polygon',coordinates}});
      groups.set(key,list);
    });
  }
  const tiles={};
  for(const [key,features] of [...groups].sort(([a],[b])=>a.localeCompare(b))) {
    const [tx,tz]=key.split('_').map(Number);
    Object.assign(tiles,compileBlock({...collection,features},out,{tx,tz,district:true}).tiles);
  }
  const ids=Object.keys(tiles).map(k=>k.split('_').map(Number));
  const bounds=[Math.min(...ids.map(p=>p[0]))*512,Math.min(...ids.map(p=>p[1]))*512,(Math.max(...ids.map(p=>p[0]))+1)*512,(Math.max(...ids.map(p=>p[1]))+1)*512];
  const manifest={tile:512,macro:2048,bounds,profile:PROFILE,coverage:collection.bbox,tiles,macros:{},selection:'Whole source polygon parts; bounding-box-centre tile ownership; no invented far geometry'};
  fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const client = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const source = JSON.parse(fs.readFileSync(path.join(client, 'fixtures/toronto/block.geojson')));
  const result = compileBlock(source, path.join(client, '.generated/toronto'));
  console.log(`Toronto: ${result.tiles['0_0'].b} source massing records -> one CTL1 tile`);
}
