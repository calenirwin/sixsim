#!/usr/bin/env python3
# GB43 KIT (docs/notes/ue-city-architecture.md): a cell's kit instances as the table the cell actor reads (the plugin
# ValdradaCells, AValdradaCell): per instance set, the kit mesh its prototype was imported to once (the kit index, by the
# prototype's hash), its shadow flag, and per instance its matrix rows in Unreal's axes and centimetres and its custom
# data (tint, then the merged path's values: grime, base, cornice shadow, texture offset u v, texture size, then 1, the
# master's KitOn). Little endian: 'VCEL', u32 1, u32 sets; per set: str mesh, u16 materials (str each), u32 flags,
# u32 custom floats, u32 instances, f32 x 12 per instance, f32 x custom per instance. A str: u16 bytes, UTF-8.
#   python3 tools/ue/vcel_write.py --glb <a packed, deduplicated cell> --kit <kit index json> --out <table>
import json, os, struct, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from r1c_cells import glb_instances, ue_transforms   # (the import's own reading of the instance sets and its axes)


def s16(t):
    b = t.encode('utf-8'); return struct.pack('<H', len(b)) + b


def write_table(glb, kit, out, min_size=0.0):
    """the cell's kit sets to `out`; returns {sets, instances, missing: [prototype hashes the kit lacks]}. With min_size
    (metres), the reduced table for the cells far from a shot's lens: an instance whose largest extent is under it (a sill,
    a frame, an air conditioner) left out, the walls and the large parts kept"""
    insts, root = glb_instances(glb)
    org = root.get('translation') or [0, 0, 0]
    raw = open(glb, 'rb').read(); L_ = struct.unpack('<I', raw[12:16])[0]
    J = json.loads(raw[20:20 + L_]); B_ = raw[20 + L_ + 8:20 + L_ + 8 + struct.unpack('<I', raw[20 + L_:24 + L_])[0]]
    ext_of = {}
    ex_of = {n.get('name'): (n.get('extras') or {}) for n in J['nodes']}
    parts, sets, total, missing = [], 0, 0, []
    for name, ir in insts.items():
        ex = ex_of.get(name) or {}
        if ex.get('kind') != 'kit': continue
        ph = ex.get('protoHash'); k = kit.get(ph)
        if not k: missing.append(ph); continue
        t_, R_, S_ = ue_transforms(ir, org)
        n = ir['n']
        keep = np.ones(n, bool)
        if min_size > 0:
            if ir['mesh'] not in ext_of:   # (the prototype's size, metres, from its positions: the accessor's bounds are the
                # bake's placeholder's, export_plain.mjs inlining the prototype under them)
                import r1c_dupgate as dg
                P_ = dg.read(J, B_, J['meshes'][ir['mesh']]['primitives'][0]['attributes']['POSITION'])
                ext_of[ir['mesh']] = (P_.max(0) - P_.min(0)) if len(P_) else np.ones(3)
            ext = ext_of[ir['mesh']]
            size = np.abs(S_) * ext[[0, 2, 1]][None, :]   # (glTF x y z to Unreal's x, y, z = three's x, z, y)
            keep = size.max(1) >= min_size
            if not keep.any(): continue
        t_, R_, S_ = t_[keep], R_[keep], S_[keep]; n = int(keep.sum())
        A = np.empty((n, 12), np.float32)
        for j in range(3): A[:, 3 * j:3 * j + 3] = R_[:, :, j] * S_[:, j:j + 1]   # (row j: axis j, scaled)
        A[:, 9:12] = t_
        cd = np.asarray(ir['cd'], np.float32)[keep] if ir.get('cd') is not None else np.zeros((n, 0), np.float32)
        mp = k['mesh'] if '.' in k['mesh'].split('/')[-1] else f"{k['mesh']}.{k['mesh'].split('/')[-1]}"   # (Package.Object, as LoadObject wants)
        hdr = s16(mp) + struct.pack('<H', 0) + struct.pack('<III', 1 if ex.get('castShadow', True) else 0, cd.shape[1], n)
        parts.append(hdr + A.tobytes() + cd.tobytes())
        sets += 1; total += n
    data = b'VCEL' + struct.pack('<II', 1, sets) + b''.join(parts)
    tmp = out + f'.{os.getpid()}.tmp'
    with open(tmp, 'wb') as f: f.write(data)
    os.replace(tmp, out)
    return {'sets': sets, 'instances': total, 'missing': sorted(set(m for m in missing if m)), 'bytes': len(data)}


if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--glb', required=True); ap.add_argument('--kit', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--min-size', type=float, default=0.0)
    a = ap.parse_args()
    print(json.dumps(write_table(a.glb, json.load(open(a.kit)), a.out, a.min_size)))
