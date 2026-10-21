import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
if (!process.env.npm_execpath) throw new Error('Run with npm run test:toronto:repro');
const build = () => {
  execFileSync(process.execPath, [process.env.npm_execpath, 'run', 'build:toronto'], { stdio: 'pipe' });
  return fs.readFileSync('dist-toronto/PACKAGE.json', 'utf8');
};
const first = build();
assert.equal(build(), first, 'Two clean builds must have identical asset paths, byte sizes and SHA256 hashes');
console.log('Two clean Toronto builds produced identical PACKAGE.json inventories');
