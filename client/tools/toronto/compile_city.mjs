import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {compileBlock} from './compile.mjs';import {PROFILE} from '../../src/toronto/profile.js';
const spool=process.argv[2]||'client/data/toronto/city-building-spool',out=process.argv[3]||'client/fixtures/toronto/city-buildings';fs.mkdirSync(out,{recursive:true});
const report=JSON.parse(fs.readFileSync(path.join(spool,'report.json'))),tiles={};let total=0,parts=0,max=0;
for(const [key,count] of Object.entries(report.tiles)){
 const features=fs.readFileSync(path.join(spool,key+'.ndjson'),'utf8').trim().split('\n').map(JSON.parse);if(features.length!==count)throw Error('Spool count mismatch');
 const [tx,tz]=key.split('_').map(Number);compileBlock({type:'FeatureCollection',features,source_archive_sha256:report.sourceArchiveSha256,terrain_sha256:report.terrainSha256},out,{tx,tz,district:true,city:true});
 const bytes=fs.readFileSync(path.join(out,key+'.bin'));if(bytes.length>2_000_000)throw Error('City tile byte cap exceeded');total+=bytes.length;parts+=count;max=Math.max(max,bytes.length);tiles[key]={f:key+'.bin',b:count,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
if(total>120_000_000)throw Error('City building distribution cap exceeded');
const manifest={version:1,tile:512,profile:{...PROFILE,verticalDatum:'Illustrative terrain-relative CGVD2013 level bases; not source surface datum'},placement:report.placement,selection:report.selection,sourceArchiveSha256:report.sourceArchiveSha256,terrainSha256:report.terrainSha256,boundarySha256:report.boundarySha256,counts:{...report.counts,retainedRecords:report.retainedRecords,tiles:Object.keys(tiles).length,bytes:total,maxTileBytes:max},tiles};
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest)+'\n');fs.writeFileSync(path.join(out,'omissions.json'),JSON.stringify({omissions:report.omissions,boundaryCrossingParts:report.boundaryCrossingParts})+'\n');
console.log(manifest.counts);
