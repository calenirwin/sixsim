#!/usr/bin/env python3
# R1C (lane C, 2026-10-11): the per-vertex data the family masters read, packed into the cells' glb UV sets the way
# ue_prep.py packs a take's USD (UE imports TEXCOORD_n as UV n, as it imports st, st1-st3), so a cell drawn with a take's
# resolved material instance (tools/ue/r1c_cellmat.py) gets the kit's tints, the vertex colours and the ground's surface
# kinds and kerb frames:
#   kit meshes (_aFkTr [_aWeather] [_aGrime])  TEXCOORD_1 = aFkTr.xy, _2 = (aFkTr.z, aGrime), _3 = (aWeather.w dirt, aWeather.z topY)
#   vertex colours (COLOR_0)                    TEXCOORD_1 = rgb.rg, _2 = (rgb.b, 0)
#   viaduct rivets (_aRv, _aJ)                  TEXCOORD_1 = aRv.xy, _2 = aRv.zw, _3 = aJ.xy
#   ground (_matId, _gpK)                       TEXCOORD_1 = (matId, kerb valid), _2 = (kQ, kDn) m, _3 = (kW m, kA rad)
# (three's own uv1 in TEXCOORD_1 is replaced, as the take's st1 replaces it.)
# and what the packages mark for a renderer (2026-10-11, after the owner's rejection of the ue2 cut):
#   shadowOnly nodes (the tile facades of the buildings a cell holds dressed: the client hides them by the tile's mask)
#     are dropped: drawn, they doubled every dressed building's walls (the z-fighting of the ue2 cut)
#   nightOnly nodes (the dresser's lit window parts, the lamps' glows) get their own copy of each material, '<name>~night'
#     with `nightOnly` in its record: r1c_cellmat2.py masks it by the take's night (MPC_r1c.Night)
#   the sign kit's faces, shade quads and lit letters carry their terms per vertex (_sgRect, _sgBg, _sgFg, _sgLamp, _sgP,
#     _sgF): each primitive is split by its terms into one primitive per term set, with a copy of the material per set
#     ('<name>~sg<hash>', the terms in its record as `sgTerms`), and the face's slot in its atlas page applied:
#     TEXCOORD_0 = sgRect.xy + uv * sgRect.zw (the page), TEXCOORD_1 = uv (the face's own, for its grime and lamp falloff).
#     Drawn with the page's own uv, a face showed the whole page (the ue2 billboard).
#   python3 tools/ue/r1c_glbuv.py --src <plain dir>/<region> --dst <dir>
import argparse, hashlib, json, math, os, struct
import numpy as np

CT = {5126: ('f4', 4), 5123: ('u2', 2), 5121: ('u1', 1), 5122: ('i2', 2), 5120: ('i1', 1), 5125: ('u4', 4)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def read(J, B, i):
    a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]
    dt, sz = CT[a['componentType']]; n = NC[a['type']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); st = bv.get('byteStride') or sz * n
    raw = np.frombuffer(B, np.uint8, st * (a['count'] - 1) + sz * n, off)
    arr = np.lib.stride_tricks.as_strided(raw, (a['count'], sz * n), (st, 1)).copy().view('<' + dt).reshape(a['count'], n).astype(np.float64)
    if a.get('normalized') and dt != 'f4':
        arr /= {'u1': 255.0, 'u2': 65535.0, 'i1': 127.0, 'i2': 32767.0, 'u4': 4294967295.0}[dt]
    return arr


def pack(attrs, J, B):
    """the three UV sets for one primitive, or None"""
    g = lambda k: read(J, B, attrs[k]) if k in attrs else None
    n = J['accessors'][attrs['POSITION']]['count']
    if '_matId' in attrs:
        m = g('_matId')[:, 0]
        k = g('_gpK') if '_gpK' in attrs else np.zeros((n, 4))
        ok = ((k[:, 0] > 100.5) & (k[:, 3] > 0.5)).astype(np.float64)
        kQ = (k[:, 0] - 1.0) * 0.01 - 320.0; kDn = np.maximum(k[:, 1] - 1.0, 0.0) * 0.01
        kW = np.maximum(k[:, 2] - 1.0, 0.0) * 0.01; kA = (k[:, 3] - 1.0) / 65534.0 * math.pi - math.pi / 2
        return 'ground', [np.stack([m, ok], 1), np.stack([kQ * ok, kDn], 1), np.stack([kW, kA], 1)]
    if '_aRv' in attrs:
        rv = g('_aRv'); j = g('_aJ') if '_aJ' in attrs else np.zeros((n, 3))
        return 'vk', [rv[:, 0:2], rv[:, 2:4], j[:, 0:2]]
    # ==== BD40 (backdrop lane, 2026-10-11): the tiles' facades (_aux, _aux2, _aux3 and the vertex colour) for the facade master
    # /Game/R2BD/Cell/M_bd_tilefac_v1 (tools/ue/bd_tilefac.py): UV 1-2 aux, UV 3-4 aux2, UV 5 + UV 6.x aux3, UV 6.y + UV 7 the
    # colour (exact floats; these meshes stay out of Nanite, r1c_cells.py)
    if os.environ.get('BD_TILEFAC', '1') == '1' and '_aux' in attrs and '_aux2' in attrs:   # (the default since GB43; BD_TILEFAC=0 off)
        x1 = g('_aux'); x2 = g('_aux2'); x3 = g('_aux3') if '_aux3' in attrs else np.zeros((n, 3))
        c = g('COLOR_0')[:, :3] if 'COLOR_0' in attrs else np.ones((n, 3))
        return 'tilefac', [x1[:, 0:2], x1[:, 2:4], x2[:, 0:2], x2[:, 2:4], x3[:, 0:2], np.stack([x3[:, 2], c[:, 0]], 1), c[:, 1:3]]
    # ==== end BD40
    if '_aFkTr' in attrs:
        fk = g('_aFkTr'); gr = g('_aGrime')[:, 0] if '_aGrime' in attrs else np.zeros(n)
        we = g('_aWeather') if '_aWeather' in attrs else np.zeros((n, 4))
        return 'kit', [fk[:, 0:2], np.stack([fk[:, 2], gr], 1), np.stack([we[:, 3], we[:, 2]], 1)]
    if 'COLOR_0' in attrs:
        c = g('COLOR_0')
        return 'vc', [c[:, 0:2], np.stack([c[:, 2], np.zeros(n)], 1)]
    return None, None


SG_TERMS = ('_sgBg', '_sgFg', '_sgLamp', '_sgP', '_sgF')


def rewrite(src, dst, strip=False):
    f = open(src, 'rb').read()
    L = struct.unpack('<I', f[12:16])[0]
    J = json.loads(f[20:20 + L]); o = 20 + L
    if strip and J.get('images'):   # (the cells' embedded copies of the shared texture store: the materials resolve by key, so the
        # importer is spared one texture import per cell; the image names, the store's hashes, stay in the material extras)
        for m in J.get('materials', []):
            pm = m.get('pbrMetallicRoughness') or {}
            for k in ('baseColorTexture', 'metallicRoughnessTexture'): pm.pop(k, None)
            for k in ('normalTexture', 'occlusionTexture', 'emissiveTexture'): m.pop(k, None)
        for k in ('images', 'textures', 'samplers'): J.pop(k, None)
    bl = struct.unpack('<I', f[o:o + 4])[0]
    B = f[o + 8:o + 8 + bl]
    extra = bytearray(); stats = {}
    base = len(B) + (-len(B)) % 4
    pad0 = b'\0' * (base - len(B))

    def add(arr, typ, ctype=5126):
        """one more accessor over new data at the end of the buffer"""
        dt = {5126: '<f4', 5125: '<u4'}[ctype]
        data = np.ascontiguousarray(arr.astype(dt)).tobytes()
        off = base + len(extra)
        J['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data)})
        extra.extend(data + b'\0' * ((-len(data)) % 4))
        acc = {'bufferView': len(J['bufferViews']) - 1, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': typ}
        if ctype == 5126:
            a2 = arr.reshape(arr.shape[0], -1)
            acc['min'] = a2.min(0).astype(float).tolist(); acc['max'] = a2.max(0).astype(float).tolist()
        J['accessors'].append(acc)
        return len(J['accessors']) - 1

    nodes = J.get('nodes', [])
    # -- shadowOnly: dropped (the node stays, without its mesh, out of its parent's children)
    gone = set()
    for ni, n in enumerate(nodes):
        if (n.get('extras') or {}).get('shadowOnly') and 'mesh' in n:
            del n['mesh']; gone.add(ni)
    if gone:
        for n in nodes:
            if n.get('children'): n['children'] = [c for c in n['children'] if c not in gone]
        for sc in J.get('scenes', []): sc['nodes'] = [c for c in sc.get('nodes', []) if c not in gone]
        stats['shadow_only_dropped'] = len(gone)
    # -- nightOnly: a night copy of each material (a mesh shared with a node drawn always is copied first)
    users = {}
    for ni, n in enumerate(nodes):
        if 'mesh' in n: users.setdefault(n['mesh'], []).append(ni)
    night_mat = {}
    def night_variant(mi):
        if mi not in night_mat:
            m = json.loads(json.dumps(J['materials'][mi]))
            m['name'] = (m.get('name') or f'mat{mi}') + '~night'
            ex = m.setdefault('extras', {}); th = ex.setdefault('three', {}); th['nightOnly'] = True
            J['materials'].append(m); night_mat[mi] = len(J['materials']) - 1
        return night_mat[mi]
    for ni, n in enumerate(nodes):
        if not ((n.get('extras') or {}).get('nightOnly') and 'mesh' in n): continue
        mi_ = n['mesh']
        if any(not (nodes[u].get('extras') or {}).get('nightOnly') for u in users.get(mi_, [])):
            J['meshes'].append(json.loads(json.dumps(J['meshes'][mi_]))); n['mesh'] = len(J['meshes']) - 1
        for pr in J['meshes'][n['mesh']]['primitives']:
            if 'material' in pr: pr['material'] = night_variant(pr['material'])
        stats['night_nodes'] = stats.get('night_nodes', 0) + 1
    # -- the sign kit's terms: one primitive and one material per term set, the atlas slot applied
    done = set()
    for mesh in J['meshes']:
        prims = []
        for pr in mesh['primitives']:
            at = pr['attributes']
            if '_sgLamp' not in at or 'indices' not in pr:
                prims.append(pr); continue
            n = J['accessors'][at['POSITION']]['count']
            present = [k for k in SG_TERMS if k in at]
            cols = [read(J, B, at[k]) for k in present]
            widths = [c.shape[1] for c in cols]
            T = np.round(np.concatenate(cols, 1), 4)
            I = read(J, B, pr['indices'])[:, 0].astype(np.int64).reshape(-1, 3)
            if '_sgRect' in at and 'TEXCOORD_0' in at:
                R = read(J, B, at['_sgRect']); uv = read(J, B, at['TEXCOORD_0'])
                at['TEXCOORD_0'] = add(R[:, 0:2] + uv * R[:, 2:4], 'VEC2')
                at['TEXCOORD_1'] = add(uv, 'VEC2')
            for k in ('_sgRect',) + SG_TERMS: at.pop(k, None)
            keys, inv = np.unique(T[I[:, 0]], axis=0, return_inverse=True)
            inv = inv.reshape(-1)
            for gi, key in enumerate(keys):
                tri = I[inv == gi]
                p2 = {kk: vv for kk, vv in pr.items() if kk not in ('indices', 'material', 'attributes')}
                p2['attributes'] = at
                p2['indices'] = add(tri.reshape(-1), 'SCALAR', 5125)
                if 'material' in pr:
                    m = json.loads(json.dumps(J['materials'][pr['material']]))
                    kv = [float(x) for x in key]
                    th = m.setdefault('extras', {}).setdefault('three', {})
                    terms, i = {}, 0
                    for k, w in zip(present, widths):
                        terms[k[3:].lower()] = kv[i:i + w]; i += w
                    th['sgTerms'] = terms
                    hsh = hashlib.sha1(json.dumps(terms, sort_keys=True).encode()).hexdigest()[:8]
                    m['name'] = (m.get('name') or 'sign') + '~sg' + hsh
                    J['materials'].append(m); p2['material'] = len(J['materials']) - 1
                prims.append(p2)
            done.add(id(at))
            stats['sign_prims'] = stats.get('sign_prims', 0) + 1; stats['sign_sets'] = stats.get('sign_sets', 0) + len(keys)
        mesh['primitives'] = prims
    for mesh in J['meshes']:
        for pr in mesh['primitives']:
            if id(pr['attributes']) in done: continue
            kind, sets = pack(pr['attributes'], J, B)
            if kind is None: continue
            stats[kind] = stats.get(kind, 0) + 1
            n = J['accessors'][pr['attributes']['POSITION']]['count']
            if 'TEXCOORD_0' not in pr['attributes']:   # (UV 0 stays three's uv everywhere: a zero one where there is none, as ue_prep)
                sets = [np.zeros((n, 2))] + list(sets); first = 0
            else: first = 1
            for si, arr in enumerate(sets):
                pr['attributes'][f'TEXCOORD_{si + first}'] = add(arr, 'VEC2')
    NB = B + pad0 + bytes(extra)
    J['buffers'][0]['byteLength'] = len(NB)
    js = json.dumps(J, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
    total = 12 + 8 + len(js) + 8 + len(NB)
    with open(dst, 'wb') as w:
        w.write(struct.pack('<III', 0x46546C67, 2, total))
        w.write(struct.pack('<II', len(js), 0x4E4F534A)); w.write(js)
        w.write(struct.pack('<II', len(NB), 0x004E4942)); w.write(NB)
    return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True); ap.add_argument('--dst', required=True)
    ap.add_argument('--strip-images', action='store_true', help='drop embedded images (the materials resolve by key)')
    a = ap.parse_args()
    os.makedirs(a.dst, exist_ok=True)
    tot = {}
    for fn in sorted(os.listdir(a.src)):
        if fn.endswith('.glb'):
            # ==== R2B (2026-10-11): an empty cell (a package with no binary chunk: open water with no ground, e.g. 0_51 to
            # 3_51 under the Williamsburg probe) has nothing to draw and stays out of the world
            hd = open(os.path.join(a.src, fn), 'rb').read(20)
            if len(hd) == 20 and os.path.getsize(os.path.join(a.src, fn)) <= 20 + struct.unpack('<I', hd[12:16])[0] + 8:
                tot['empty_cells'] = tot.get('empty_cells', 0) + 1; continue
            # ==== end R2B
            st = rewrite(os.path.join(a.src, fn), os.path.join(a.dst, fn), a.strip_images)
            for k, v in st.items(): tot[k] = tot.get(k, 0) + v
        elif fn.endswith('.json') and not os.path.exists(os.path.join(a.dst, fn)):
            os.symlink(os.path.join(a.src, fn), os.path.join(a.dst, fn))
    print(json.dumps(tot))


if __name__ == '__main__':
    main()
