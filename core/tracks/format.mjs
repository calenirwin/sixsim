// Actor tracks, binary (docs/specs/actor-tracks.md): 'ATRK' v1. Little-endian; a JSON header (the take, the actor table,
// the static actors, the signal list, the camera per frame) and one record block per frame.
import fs from 'node:fs';

export const MAGIC = 0x4b525441;   // 'ATRK'
export const VERSION = 1;
export const VEH_BYTES = 52, WALK_BYTES = 44, TRAIN_BYTES = 72;
export const TRAIN_KINDS = ['r62a', 'm7a', 'm8'];

// frames: [{ veh: [{id, x, y, z, q: [x, y, z, w], v, spin, steer, bend, lamps, flags, kind}], walk: [{id, x, y, z, yaw, v,
// phase, hz, sxz, sy, amp, pose}], sig: Uint8Array, train: [{id, x, y, z, yaw, ta: [x, y, z, yaw], tb: [...], roll, doors, v,
// lamps, kind, flags, side, num, dest}] }]
export function writeTracks(file, header, frames) {
  const hdr = Buffer.from(JSON.stringify(header), 'utf8');
  const hpad = (4 - ((12 + hdr.length) % 4)) % 4;
  const blocks = frames.map(frameBlock);
  let size = 12 + hdr.length + hpad + 4 + 4 * frames.length;
  for (const b of blocks) size += b.length;
  const buf = Buffer.alloc(size);
  let o = 0;
  buf.writeUInt32LE(MAGIC, o); o += 4;
  buf.writeUInt32LE(VERSION, o); o += 4;
  buf.writeUInt32LE(hdr.length + hpad, o); o += 4;
  hdr.copy(buf, o); o += hdr.length;
  buf.fill(0x20, o, o + hpad); o += hpad;
  buf.writeUInt32LE(frames.length, o); o += 4;
  const table = o; o += 4 * frames.length;
  blocks.forEach((b, i) => { buf.writeUInt32LE(o, table + 4 * i); b.copy(buf, o); o += b.length; });
  if (o !== size) throw new Error(`tracks size ${o} != ${size}`);
  fs.writeFileSync(file, buf);
  return size;
}

// one frame block (the file's per-frame record block; also the blob of the render protocol's render.state)
export function frameBlock(F) {
  const size = 8 + F.veh.length * VEH_BYTES + F.walk.length * WALK_BYTES + ((F.sig.length + 3) & ~3) + (F.train ? F.train.length : 0) * TRAIN_BYTES;
  const buf = Buffer.alloc(size);
  let o = 0;
  buf.writeUInt16LE(F.veh.length, o); buf.writeUInt16LE(F.walk.length, o + 2); buf.writeUInt16LE(F.sig.length, o + 4); buf.writeUInt16LE(F.train ? F.train.length : 0, o + 6); o += 8;
  for (const v of F.veh) {
    buf.writeUInt32LE(v.id, o);
    buf.writeFloatLE(v.x, o + 4); buf.writeFloatLE(v.y, o + 8); buf.writeFloatLE(v.z, o + 12);
    buf.writeFloatLE(v.q[0], o + 16); buf.writeFloatLE(v.q[1], o + 20); buf.writeFloatLE(v.q[2], o + 24); buf.writeFloatLE(v.q[3], o + 28);
    buf.writeFloatLE(v.v, o + 32); buf.writeFloatLE(v.spin, o + 36); buf.writeFloatLE(v.steer, o + 40); buf.writeFloatLE(v.bend, o + 44);
    buf.writeUInt8(v.lamps & 255, o + 48); buf.writeUInt8(v.flags & 255, o + 49); buf.writeUInt16LE(v.kind, o + 50);
    o += VEH_BYTES;
  }
  for (const w of F.walk) {
    buf.writeUInt32LE(w.id, o);
    buf.writeFloatLE(w.x, o + 4); buf.writeFloatLE(w.y, o + 8); buf.writeFloatLE(w.z, o + 12);
    buf.writeFloatLE(w.yaw, o + 16); buf.writeFloatLE(w.v, o + 20); buf.writeFloatLE(w.phase, o + 24); buf.writeFloatLE(w.hz, o + 28);
    buf.writeFloatLE(w.sxz, o + 32); buf.writeFloatLE(w.sy, o + 36);
    buf.writeUInt8(Math.round(Math.max(0, Math.min(1, w.amp)) * 255), o + 40); buf.writeUInt8(w.pose & 255, o + 41); buf.writeUInt16LE(Math.round(Math.max(0, Math.min(6.5, w.pace ?? 1)) * 10000), o + 42);
    o += WALK_BYTES;
  }
  for (let k = 0; k < F.sig.length; k++) buf.writeUInt8(F.sig[k], o + k);
  o += (F.sig.length + 3) & ~3;
  for (const t of F.train || []) {
    buf.writeUInt32LE(t.id, o);
    buf.writeFloatLE(t.x, o + 4); buf.writeFloatLE(t.y, o + 8); buf.writeFloatLE(t.z, o + 12); buf.writeFloatLE(t.yaw, o + 16);
    for (let k = 0; k < 4; k++) { buf.writeFloatLE(t.ta[k], o + 20 + 4 * k); buf.writeFloatLE(t.tb[k], o + 36 + 4 * k); }
    buf.writeFloatLE(t.roll, o + 52); buf.writeFloatLE(t.doors, o + 56); buf.writeFloatLE(t.v, o + 60);
    buf.writeUInt8(t.lamps & 255, o + 64); buf.writeUInt8(t.kind & 255, o + 65); buf.writeUInt8(t.flags & 255, o + 66); buf.writeInt8(t.side, o + 67);
    buf.writeUInt8(t.num & 255, o + 68); buf.writeUInt8(t.dest & 255, o + 69); buf.writeUInt16LE(0, o + 70);
    o += TRAIN_BYTES;
  }
  if (o !== size) throw new Error(`frame block size ${o} != ${size}`);
  return buf;
}

export function readTracks(file) {
  const buf = fs.readFileSync(file);
  let o = 0;
  if (buf.readUInt32LE(0) !== MAGIC) throw new Error('not an ATRK file');
  const version = buf.readUInt32LE(4), hl = buf.readUInt32LE(8);
  const header = JSON.parse(buf.subarray(12, 12 + hl).toString('utf8'));
  o = 12 + hl;
  const n = buf.readUInt32LE(o); o += 4;
  const frames = [];
  for (let i = 0; i < n; i++) {
    let p = buf.readUInt32LE(o + 4 * i);
    const nv = buf.readUInt16LE(p), nw = buf.readUInt16LE(p + 2), ns = buf.readUInt16LE(p + 4), nt = buf.readUInt16LE(p + 6); p += 8;
    const veh = [], walk = [], train = [];
    for (let k = 0; k < nv; k++, p += VEH_BYTES) veh.push({ id: buf.readUInt32LE(p), x: buf.readFloatLE(p + 4), y: buf.readFloatLE(p + 8), z: buf.readFloatLE(p + 12),
      q: [buf.readFloatLE(p + 16), buf.readFloatLE(p + 20), buf.readFloatLE(p + 24), buf.readFloatLE(p + 28)], v: buf.readFloatLE(p + 32), spin: buf.readFloatLE(p + 36),
      steer: buf.readFloatLE(p + 40), bend: buf.readFloatLE(p + 44), lamps: buf.readUInt8(p + 48), flags: buf.readUInt8(p + 49), kind: buf.readUInt16LE(p + 50) });
    for (let k = 0; k < nw; k++, p += WALK_BYTES) walk.push({ id: buf.readUInt32LE(p), x: buf.readFloatLE(p + 4), y: buf.readFloatLE(p + 8), z: buf.readFloatLE(p + 12),
      yaw: buf.readFloatLE(p + 16), v: buf.readFloatLE(p + 20), phase: buf.readFloatLE(p + 24), hz: buf.readFloatLE(p + 28), sxz: buf.readFloatLE(p + 32), sy: buf.readFloatLE(p + 36),
      amp: buf.readUInt8(p + 40) / 255, pose: buf.readUInt8(p + 41), pace: buf.readUInt16LE(p + 42) / 10000 });
    const sig = Uint8Array.from(buf.subarray(p, p + ns));
    p += (ns + 3) & ~3;
    for (let k = 0; k < nt; k++, p += TRAIN_BYTES) {
      const f = (q) => buf.readFloatLE(p + q);
      train.push({ id: buf.readUInt32LE(p), x: f(4), y: f(8), z: f(12), yaw: f(16), ta: [f(20), f(24), f(28), f(32)], tb: [f(36), f(40), f(44), f(48)], roll: f(52), doors: f(56), v: f(60),
        lamps: buf.readUInt8(p + 64), kind: buf.readUInt8(p + 65), flags: buf.readUInt8(p + 66), side: buf.readInt8(p + 67), num: buf.readUInt8(p + 68), dest: buf.readUInt8(p + 69) });
    }
    frames.push({ veh, walk, sig, train });
  }
  return { version, header, frames };
}
