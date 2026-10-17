#!/usr/bin/env python3
# City v2 (docs/notes/ue-city-architecture.md, "The city build, version 2", step 3): a 1 km block's cells (their unique
# meshes, the kit sets already out: kit_strip.py) as ONE package. The plain meshes are concatenated per group (material,
# vertex attributes, and the node's flags: shadow, night, class, layers), the instance sets per prototype (protoHash) and
# flags, every position moved from its cell's origin to the block's. A block imports as ~100 meshes and instance sets
# where its 64 cells imported ~4,500, so Unreal's import, Nanite's resources (its root pages are capped per scene) and the
# editor's per-package costs are paid per block; the cut (city_build.city_cut) already draws whole blocks.
#   python3 tools/ue/block_merge.py --out <block.glb> --origin x,z <cell glb> ...
import argparse, json, os, struct, sys
import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
FLAGS = ('castShadow', 'receiveShadow', 'nightOnly', 'class', 'layers', 'renderOrder', 'dress')


def load(path):
    b = open(path, 'rb').read(); L = struct.unpack('<I', b[12:16])[0]
    J = json.loads(b[20:20 + L]); o = 20 + L
    B = b[o + 8:o + 8 + struct.unpack('<I', b[o:o + 4])[0]] if len(b) > o + 8 else b''
    return J, B


def read(J, B, ai):
    a = J['accessors'][ai]; bv = J['bufferViews'][a['bufferView']]
    dt = np.dtype(CT[a['componentType']]); nc = NC[a['type']]; n = a['count']
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); st = bv.get('byteStride') or dt.itemsize * nc
    if st == dt.itemsize * nc: arr = np.frombuffer(B, dt, n * nc, off).reshape(n, nc)
    else: arr = np.stack([np.frombuffer(B, dt, nc, off + i * st) for i in range(n)])
    return arr.copy(), a


class Out:
    def __init__(self):
        self.J = {'asset': {'version': '2.0', 'generator': 'valdrada block_merge'}, 'scene': 0, 'scenes': [{'nodes': [0]}],
                  'nodes': [], 'meshes': [], 'materials': [], 'accessors': [], 'bufferViews': [], 'buffers': [{'byteLength': 0}]}
        self.bin = bytearray(); self.mat = {}

    def acc(self, arr, like, target=None):
        arr = np.ascontiguousarray(arr)
        data = arr.tobytes(); off = len(self.bin)
        self.bin += data + b'\0' * ((-len(data)) % 4)
        bv = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target: bv['target'] = target
        self.J['bufferViews'].append(bv)
        a = {'bufferView': len(self.J['bufferViews']) - 1, 'componentType': like['componentType'], 'count': int(arr.shape[0]), 'type': like['type']}
        if like.get('normalized'): a['normalized'] = True
        if like['type'] in ('VEC3',) and like['componentType'] == 5126 and like.get('_pos'):
            a['min'] = arr.min(0).astype(float).tolist(); a['max'] = arr.max(0).astype(float).tolist()
        self.J['accessors'].append(a)
        return len(self.J['accessors']) - 1

    def material(self, m):
        k = m.get('name')
        if k not in self.mat: self.J['materials'].append(m); self.mat[k] = len(self.J['materials']) - 1
        return self.mat[k]

    def write(self, path):
        self.J['buffers'][0]['byteLength'] = len(self.bin)
        js = json.dumps(self.J, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
        tmp = path + f'.{os.getpid()}.tmp'
        with open(tmp, 'wb') as w:
            w.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(self.bin)))
            w.write(struct.pack('<II', len(js), 0x4E4F534A)); w.write(js)
            w.write(struct.pack('<II', len(self.bin), 0x004E4942)); w.write(bytes(self.bin))
        os.replace(tmp, path)


def merge(cells, out_path, origin):
    """cells: [cell glb]; origin: (x, z) of the block's corner. Returns the counts"""
    groups, isets = {}, {}
    st = {'cells': 0, 'mesh_nodes': 0, 'inst_nodes': 0}
    for path in cells:
        J, B = load(path)
        if not J.get('scenes') or not J['scenes'][0].get('nodes'): continue
        st['cells'] += 1
        root = J['nodes'][J['scenes'][0]['nodes'][0]]
        t = root.get('translation') or [0, 0, 0]
        off = np.array([t[0] - origin[0], t[1], t[2] - origin[1]], np.float32)
        for ni in root.get('children', []):
            n = J['nodes'][ni]
            if 'mesh' not in n: continue
            if n.get('translation') or n.get('rotation') or n.get('scale') or n.get('matrix'):
                raise ValueError(f'{path}: node {n.get("name")} carries its own transform')
            ex = n.get('extras') or {}; fl = tuple((f, json.dumps(ex.get(f))) for f in FLAGS)
            inst = (n.get('extensions') or {}).get('EXT_mesh_gpu_instancing')
            prims = J['meshes'][n['mesh']]['primitives']
            if inst:
                st['inst_nodes'] += 1
                k = (ex.get('protoHash') or f'{os.path.basename(path)}:{n["mesh"]}', fl, tuple(sorted(inst['attributes'])))
                g = isets.setdefault(k, {'cells': [], 'extras': ex, 'name': n.get('name')})
                g['cells'].append((J, B, n, off))
            else:
                st['mesh_nodes'] += 1
                for p in prims:
                    sig = tuple((nm, J['accessors'][ai]['componentType'], J['accessors'][ai]['type'], bool(J['accessors'][ai].get('normalized'))) for nm, ai in sorted(p['attributes'].items()))
                    mat = J['materials'][p['material']] if 'material' in p else {'name': 'none'}
                    k = (mat.get('name'), sig, fl, p.get('mode', 4))
                    g = groups.setdefault(k, {'parts': [], 'mat': mat, 'extras': ex})
                    g['parts'].append((J, B, p, off))
    O = Out()
    O.J['nodes'].append({'name': os.path.basename(out_path)[:-4], 'translation': [float(origin[0]), 0.0, float(origin[1])], 'children': []})
    for gi, (k, g) in enumerate(sorted(groups.items(), key=lambda kv: str(kv[0][0]))):
        cols = {}; idx = []; base = 0; likes = {}
        for J, B, p, off in g['parts']:
            n = None
            for nm, ai in p['attributes'].items():
                arr, a = read(J, B, ai)
                if nm == 'POSITION': arr = arr.astype(np.float32) + off
                cols.setdefault(nm, []).append(arr); likes[nm] = a; n = arr.shape[0]
            ii = read(J, B, p['indices'])[0].reshape(-1).astype(np.uint32) if 'indices' in p else np.arange(n, dtype=np.uint32)
            idx.append(ii + base); base += n
        attrs = {}
        for nm, parts in cols.items():
            like = dict(likes[nm]); like['_pos'] = nm == 'POSITION'
            attrs[nm] = O.acc(np.concatenate(parts), like, 34962)
        ia = O.acc(np.concatenate(idx), {'componentType': 5125, 'type': 'SCALAR'}, 34963)
        prim = {'attributes': attrs, 'indices': ia, 'material': O.material(g['mat'])}
        if k[3] != 4: prim['mode'] = k[3]
        O.J['meshes'].append({'name': f'g{gi}', 'primitives': [prim]})
        ex = {f: json.loads(v) for f, v in k[2]}; ex.update(kind='mesh', matKey=g['mat'].get('name'), parts=len(g['parts']))
        O.J['nodes'].append({'name': f'g{gi}', 'mesh': len(O.J['meshes']) - 1, 'extras': ex})
        O.J['nodes'][0]['children'].append(len(O.J['nodes']) - 1)
    proto_mesh = {}
    for si, (k, g) in enumerate(sorted(isets.items(), key=lambda kv: str(kv[0][0]))):
        J0, B0, n0, _ = g['cells'][0]
        if k[0] not in proto_mesh:   # (the prototype's mesh once per package)
            prims = []
            for p in J0['meshes'][n0['mesh']]['primitives']:
                attrs = {nm: O.acc(read(J0, B0, ai)[0], dict(J0['accessors'][ai], _pos=nm == 'POSITION'), 34962) for nm, ai in p['attributes'].items()}
                pr = {'attributes': attrs, 'material': O.material(J0['materials'][p['material']]) if 'material' in p else None}
                if 'indices' in p: pr['indices'] = O.acc(read(J0, B0, p['indices'])[0].reshape(-1).astype(np.uint32), {'componentType': 5125, 'type': 'SCALAR'}, 34963)
                if pr['material'] is None: pr.pop('material')
                prims.append(pr)
            O.J['meshes'].append({'name': f'p{len(proto_mesh)}', 'primitives': prims}); proto_mesh[k[0]] = len(O.J['meshes']) - 1
        cols = {}; likes = {}
        for J, B, n, off in g['cells']:
            for nm, ai in n['extensions']['EXT_mesh_gpu_instancing']['attributes'].items():
                arr, a = read(J, B, ai)
                if nm == 'TRANSLATION': arr = arr.astype(np.float32) + off
                cols.setdefault(nm, []).append(arr); likes[nm] = a
        ia = {nm: O.acc(np.concatenate(parts), likes[nm]) for nm, parts in cols.items()}
        ex = dict(g['extras']); ex['count'] = int(sum(len(c) for c in cols.get('TRANSLATION', [[]])))
        O.J['nodes'].append({'name': f's{si}_{g["name"]}'[:60], 'mesh': proto_mesh[k[0]], 'extras': ex, 'extensions': {'EXT_mesh_gpu_instancing': {'attributes': ia}}})
        O.J['nodes'][0]['children'].append(len(O.J['nodes']) - 1)
    if isets: O.J['extensionsUsed'] = ['EXT_mesh_gpu_instancing']
    O.write(out_path)
    st.update(groups=len(groups), instance_sets=len(isets), prototypes=len(proto_mesh), materials=len(O.J['materials']), bytes=len(O.bin))
    return st


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True); ap.add_argument('--origin', required=True); ap.add_argument('cells', nargs='+')
    a = ap.parse_args()
    ox, oz = map(float, a.origin.split(','))
    print(json.dumps(merge(a.cells, a.out, (ox, oz))))
