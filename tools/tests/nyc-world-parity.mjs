// Before/after regression against the pre-integration core; no city archive needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeTile } from '../../client/tools/pipeline/binio.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const baseline = '3e73317d551fc2ddbd1d640ce2e4f795ca09016c';
test('default NYC headless initialization/stepping matches pre-integration core', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-core-parity-'));
  try {
    fs.cpSync(path.join(root, 'core'), path.join(tmp, 'core'), { recursive: true });
    for (const file of ['core/sim/world.mjs', 'core/world/streamer.mjs', 'core/world/simTile.mjs']) {
      fs.writeFileSync(path.join(tmp, file), execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root }));
    }
    for (const name of ['client', 'node_modules']) fs.symlinkSync(path.join(root,name),path.join(tmp,name),'dir');
    const tiles = path.join(tmp,'tiles'); fs.mkdirSync(tiles);
    writeTile(path.join(tiles,'0_0.bin'), { v:1, tx:0,tz:0,origin:[0,0],res:1,names:[],nodes:[[256,256,true]] }, [
      {name:'terrain',array:new Float32Array([1,2,3,4])},
      {name:'roads',array:new Uint8Array()}, {name:'roadVerts',array:new Float32Array()},
    ]);
    fs.writeFileSync(path.join(tiles,'manifest.json'),JSON.stringify({tiles:{'0_0':{f:'0_0.bin'}},macros:{}}));
    fs.writeFileSync(path.join(tiles,'bridges.json'),'[]');
    const outputs=[];
    for (const [name,base] of [['before',tmp],['after',root]]) {
      const output=path.join(tmp,`${name}.json`);
      execFileSync(process.execPath,[path.join(root,'tools/tests/helpers/nyc-world-probe.mjs'),path.join(base,'core/sim/world.mjs'),tiles,output],{cwd:root,timeout:30000,stdio:'pipe'});
      outputs.push(JSON.parse(fs.readFileSync(output)));
    }
    assert.deepEqual(outputs[1],outputs[0]);
    assert.deepEqual(outputs[1].externalAttempts,[]);
    for (const s of outputs[1].snapshots) {
      assert.deepEqual(s.models,[true,true,true]); assert.deepEqual(s.loaded,['0_0']);
      assert.ok(Number.isFinite(s.terrain) && s.terrain > 0); assert.ok(s.signals.length > 0);
    }
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
});
