#!/usr/bin/env python3
# R1C (lane C, 2026-10-11): the world build's duplicate and coplanar-surface gate. Every opaque triangle a world will draw
# (its cells' mesh nodes and the far city's packages, in world metres) is binned by its plane (normal to ~2 degrees, offset
# to 2 cm); in each bin, triangles from different sources (a source: one node of one package) that overlap in the plane
# are two surfaces in one place: z-fighting, or a thing drawn twice. Decal-like surfaces (transparent, alpha-blended or
# polygon-offset materials, the sign kit's shade and halo quads) are overlays by design and are left out, as are nodes
# the renderer hides (shadowOnly; nightOnly unless --night). Surfaces fight only when they face the same way (two-sided ones
# face both ways).
#   python3 tools/ue/r1c_dupgate.py --glb-dir <dir> [--glb-dir <dir> ...] [--night] [--classes 2,26,33,34,35] [--far-all]
#       --out <dir> [--max-m2 10]
# Fails (exit 3) on a tile facade within 2 mm of a dressed building's walls or on other coplanar surfaces (contacts under
# 1 mm), either over --max-m2 (default 10 m2) in all, every pair listed; the facade kit's overlapping room boxes and the
# close layers (1 mm to 2 cm) are reported. Exit 0 pass, 2 no input. Writes <out>/dupgate.json (totals, pairs with their
# area, cells, materials, a world point each) and prints a summary.
import argparse, collections, glob, json, math, os, struct, sys, time
import numpy as np

CT = {5126: ('f4', 4), 5123: ('u2', 2), 5121: ('u1', 1), 5125: ('u4', 4), 5122: ('i2', 2), 5120: ('i1', 1)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def read(J, B, i):
    a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]
    dt, sz = CT[a['componentType']]; n = NC[a['type']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); st = bv.get('byteStride') or sz * n
    raw = np.frombuffer(B, np.uint8, st * (a['count'] - 1) + sz * n, off)
    return np.lib.stride_tricks.as_strided(raw, (a['count'], sz * n), (st, 1)).copy().view('<' + dt).reshape(a['count'], n)


def overlay(three):
    t = three or {}
    nm = t.get('name') or ''
    if t.get('transparent') or t.get('polygonOffset') or nm.startswith(('ar33sign:shade', 'ar33sign:halo')): return True
    if float(t.get('alphaTest') or 0) > 0 and int(t.get('side') or 0) == 2: return True   # (cards: foliage, fences)
    return False


def kit_tris(J, B, n):
    """GB43 KIT: a kit instance set's triangles in the cell's frame (its prototype, inlined by export_plain.mjs, at each
    instance's translation, rotation and scale), and the index of its prototype's triangle for each"""
    at = n['extensions']['EXT_mesh_gpu_instancing']['attributes']
    p = J['meshes'][n['mesh']]['primitives'][0]
    P = read(J, B, p['attributes']['POSITION']).astype(np.float64)
    I = read(J, B, p['indices']).reshape(-1, 3).astype(np.int64) if 'indices' in p else np.arange(len(P)).reshape(-1, 3)
    T = read(J, B, at['TRANSLATION']).astype(np.float64)
    R = read(J, B, at['ROTATION']).astype(np.float64) if 'ROTATION' in at else np.tile([0, 0, 0, 1.0], (len(T), 1))
    S = read(J, B, at['SCALE']).astype(np.float64) if 'SCALE' in at else np.ones((len(T), 3))
    x, y, z, w = R[:, 0], R[:, 1], R[:, 2], R[:, 3]
    M = np.empty((len(T), 3, 3))
    M[:, 0, 0] = 1 - 2 * (y * y + z * z); M[:, 0, 1] = 2 * (x * y - z * w); M[:, 0, 2] = 2 * (x * z + y * w)
    M[:, 1, 0] = 2 * (x * y + z * w); M[:, 1, 1] = 1 - 2 * (x * x + z * z); M[:, 1, 2] = 2 * (y * z - x * w)
    M[:, 2, 0] = 2 * (x * z - y * w); M[:, 2, 1] = 2 * (y * z + x * w); M[:, 2, 2] = 1 - 2 * (x * x + y * y)
    V = np.einsum('kij,vj->kvi', M * S[:, None, :], P) + T[:, None, :]   # (instances, vertices, 3)
    return V[:, I].reshape(-1, 3, 3), p


def load(paths, classes, night, far_all, shadow_only=False):
    """triangles (N, 3, 3) in world metres and a source id per triangle, with the source table"""
    tris, srcs, table = [], [], []
    for fp in paths:
        f = open(fp, 'rb').read()
        L = struct.unpack('<I', f[12:16])[0]
        J = json.loads(f[20:20 + L]); o = 20 + L
        B = f[o + 8:o + 8 + struct.unpack('<I', f[o:o + 4])[0]]
        root = J['nodes'][J['scenes'][0]['nodes'][0]]
        org = np.asarray(root.get('translation') or [0, 0, 0], np.float64)
        rx = root.get('extras') or {}
        far = bool(rx.get('level')) or bool(rx.get('landmark')) or os.path.basename(fp).startswith(('L4_', 'L5_', 'L6_', 'LM_'))
        for ni, n in enumerate(J['nodes']):
            ex = n.get('extras') or {}
            if 'mesh' in n and ex.get('kind') == 'kit' and not far:   # (GB43 KIT: the dresser's kit instances, as the dressed walls they are)
                if ex.get('nightOnly') and not night: continue
                if classes and ex.get('class') not in classes: continue
                tri, p = kit_tris(J, B, n)
                if not len(tri): continue
                m = J['materials'][p['material']] if 'material' in p else {}
                if overlay((m.get('extras') or {}).get('three') or {}): continue
                sid = len(table)
                table.append({'file': os.path.basename(fp), 'node': n.get('name') or f'node{ni}', 'prim': 0, 'material': m.get('name'),
                              'class': ex.get('class'), 'dress': True, 'far': False, 'tris': int(len(tri)), 'two': False, 'tile': False, 'kit': True})
                tris.append(tri + org); srcs.append(np.full(len(tri), sid, np.int32))
                continue
            if 'mesh' not in n or ex.get('kind') != 'mesh': continue
            if ex.get('shadowOnly') and not shadow_only: continue   # (--as-drawn-before: the worlds that drew them)
            if ex.get('nightOnly') and not night: continue
            if not far and classes and ex.get('class') not in classes: continue
            if far and not far_all and not (ex.get('class') in (2, 35) or ex.get('landmark') or n.get('name') == 'shells'): continue
            for pi, p in enumerate(J['meshes'][n['mesh']]['primitives']):
                m = J['materials'][p['material']] if 'material' in p else {}
                three = (m.get('extras') or {}).get('three') or {}
                if overlay(three): continue
                two = int(three.get('side') or 0) == 2 or bool(m.get('doubleSided'))
                P = read(J, B, p['attributes']['POSITION']).astype(np.float64) + org
                I = read(J, B, p['indices']).reshape(-1, 3).astype(np.int64) if 'indices' in p else np.arange(len(P)).reshape(-1, 3)
                if not len(I): continue
                sid = len(table)
                table.append({'file': os.path.basename(fp), 'node': n.get('name') or f'node{ni}', 'prim': pi, 'material': m.get('name'),
                              'class': ex.get('class'), 'dress': ex.get('dress'), 'far': far, 'tris': int(len(I)), 'two': two,
                              'tile': bool('_aBid' in p['attributes'] and not ex.get('dress'))})
                tris.append(P[I]); srcs.append(np.full(len(I), sid, np.int32))
                if two:   # (a two-sided surface faces both ways: its triangles once more, wound the other way)
                    tris.append(P[I[:, ::-1]]); srcs.append(np.full(len(I), sid, np.int32))
    if not tris: return None, None, table
    return np.concatenate(tris), np.concatenate(srcs), table


G = {}
# GB43: the area of a pair's contacts under 1 mm (COP_GAP), apart from its mean gap: a sill's top on its reveal floor (0.7 mm) and
# the same two masonry bins' trim a centimetre off the wall averaged 6.8 mm, and neither the dedupe nor the gate saw the
# sills as coplanar (overlaps() leaves it in G['cop'])
COP_GAP = 0.001   # (1 mm, the gate's first definition of coplanar; at 1.5 mm, walls and roofs that two cells' runs each moved 2 mm, independently, stayed counted at 1.2 to 1.5 mm)


def scan(groups, cell=0.5):
    """overlap area per source pair over a list of plane bins (one worker's share)"""
    T, S, nrm, ar = G['T'], G['S'], G['nrm'], G['ar']
    pair_area = collections.defaultdict(float); pair_pt = {}; pair_sep = collections.defaultdict(float); pair_cop = collections.defaultdict(float)
    pair_dir = collections.defaultdict(lambda: [0.0, 0.0, -1.0])   # (source a, source b) -> [area of a on b, area x (b's offset - a's) along a's normal, its largest]
    tested = 0
    for g in groups:
        n0 = nrm[g[0]]
        u = np.cross(n0, [0.0, 1.0, 0.0] if abs(n0[1]) < 0.9 else [1.0, 0.0, 0.0]); u /= np.linalg.norm(u); v = np.cross(n0, u)
        P2 = np.stack([T[g] @ u, T[g] @ v], -1)            # (k, 3, 2)
        lo, hi = P2.min(1), P2.max(1)
        # (a 2D grid in the plane: a triangle's samples are tested against the triangles of OTHER sources in the same grid cells)
        cx0 = np.floor(lo / cell).astype(np.int64); cx1 = np.floor(hi / cell).astype(np.int64)
        span = (cx1 - cx0 + 1).prod(1)
        big = span > 4096                                   # (a huge triangle: a ground or roof plate; not a facade duplicate)
        if big.any():   # (GB43: the plate is left out, not its bin: the facade pairs that shared the bin went unseen with it)
            k_ = ~big; g, P2, lo, hi, cx0, cx1 = g[k_], P2[k_], lo[k_], hi[k_], cx0[k_], cx1[k_]
            if len(g) < 2: continue
        ss = S[g]
        if ss.min() == ss.max(): continue
        grid = collections.defaultdict(list)
        for i in range(len(g)):
            for gx in range(cx0[i, 0], cx1[i, 0] + 1):
                for gy in range(cx0[i, 1], cx1[i, 1] + 1):
                    grid[(gx, gy)].append(i)
        # samples: the centroid and three points halfway to it (four per triangle, each a quarter of its area)
        cen = P2.mean(1)
        smp = np.concatenate([cen[:, None], (P2 + cen[:, None]) * 0.5], 1)   # (k, 4, 2)
        T3 = T[g]; c3 = T3.mean(1)
        smp3 = np.concatenate([c3[:, None], (T3 + c3[:, None]) * 0.5], 1)    # (the same samples in 3D: each contact's gap is
        # the distance from its sample to the partner's plane, small vectors only, GB43)
        for i in range(len(g)):
            cand = set()
            for gx in range(cx0[i, 0], cx1[i, 0] + 1):
                for gy in range(cx0[i, 1], cx1[i, 1] + 1):
                    cand.update(grid[(gx, gy)])
            cand = [j for j in cand if ss[j] != ss[i]]
            if not cand: continue
            tested += 1
            cj = np.asarray(cand)
            A_, B_, C_ = P2[cj, 0], P2[cj, 1], P2[cj, 2]
            for s_, q in enumerate(smp[i]):
                v0, v1, v2 = C_ - A_, B_ - A_, q - A_
                d00 = (v0 * v0).sum(1); d01 = (v0 * v1).sum(1); d11 = (v1 * v1).sum(1); d20 = (v2 * v0).sum(1); d21 = (v2 * v1).sum(1)
                den = d00 * d11 - d01 * d01
                with np.errstate(divide='ignore', invalid='ignore'):
                    uu = (d11 * d20 - d01 * d21) / den; vv = (d00 * d21 - d01 * d20) / den
                inside = (uu >= -1e-4) & (vv >= -1e-4) & (uu + vv <= 1 + 1e-4) & np.isfinite(uu)
                # (every other source under the sample, once each: GB43, crediting the first alone let a third surface in the
                # plane hide a pair, and the dedupe never moved it)
                seen_ = set()
                for j in cj[inside]:
                    if int(ss[j]) in seen_: continue
                    seen_.add(int(ss[j]))
                    k_ = (int(min(ss[i], ss[j])), int(max(ss[i], ss[j])))
                    pair_area[k_] += ar[g[i]] / 4.0
                    off = float((T3[j, 0] - smp3[i, s_]) @ nrm[g[j]])   # (the partner's plane ahead of this sample, along its normal)
                    pair_sep[k_] += ar[g[i]] / 4.0 * abs(off)   # (area-weighted: the mean gap)
                    if abs(off) < COP_GAP: pair_cop[k_] += ar[g[i]] / 4.0
                    pd_ = pair_dir[(int(ss[i]), int(ss[j]))]; pd_[0] += ar[g[i]] / 4.0; pd_[1] += ar[g[i]] / 4.0 * off; pd_[2] = max(pd_[2], off)
                    pair_pt.setdefault(k_, [round(float(x), 2) for x in T[g[i]].mean(0)])
    return dict(pair_area), pair_pt, tested, dict(pair_sep), {k: tuple(v) for k, v in pair_dir.items()}, dict(pair_cop)


def overlaps(T, S, jobs=0):
    """{(source a, source b): (area m2, mean gap m)} for every two sources with same-facing surfaces within 2 cm of one
    plane that overlap in it (each overlap counted from both sides: the area is the mean of the two counts)"""
    a, b, c = T[:, 0], T[:, 1], T[:, 2]
    nrm = np.cross(b - a, c - a); ar = np.linalg.norm(nrm, axis=1)
    ok = ar > 1e-6
    T, S, nrm, ar = T[ok], S[ok], nrm[ok] / ar[ok, None], ar[ok] / 2.0
    # (two surfaces in one plane fight only when they face the same way: back to back, as two party walls or a deck's top
    # and underside, each is culled from the side the other is seen from; a two-sided surface was entered both ways)
    G.update(T=T, S=S, nrm=nrm, ar=ar)
    # two binnings, the second shifted by half a bin (normal, offset and tile), so two surfaces a few millimetres apart that
    # one binning splits meet in the other; a pair's area is the larger of the two. GB43: the offset is taken from a 64 m
    # tile's corner, not the world's origin: kilometres out, a float32 triangle's normal off by 1e-5 moved n.p by
    # centimetres, and surfaces 5 mm apart were binned (and measured) as touching or as apart at random
    cen = T.mean(1)
    results = []
    nbins = 0
    for shift in (0.0, 0.5):
        tl = np.floor(cen[:, [0, 2]] / 64.0 + shift).astype(np.int64)
        ref = np.zeros((len(T), 3)); ref[:, 0] = (tl[:, 0] - shift) * 64.0; ref[:, 2] = (tl[:, 1] - shift) * 64.0
        d = np.einsum('ij,ij->i', nrm, T[:, 0] - ref)
        qn = np.floor(nrm * 30.0 + 0.5 + shift).astype(np.int64)            # (about 2 degrees)
        qd = np.floor(d / 0.02 + 0.5 + shift).astype(np.int64)              # (2 cm)
        key = ((qn[:, 0] + 64) * 129 + (qn[:, 1] + 64)) * 129 + (qn[:, 2] + 64)
        key = ((key * 60011 + np.clip(qd + 30000, 0, 60010)) * 1009 + np.mod(tl[:, 0] + 500, 1009)) * 1009 + np.mod(tl[:, 1] + 500, 1009)
        order = np.argsort(key, kind='stable'); ks = key[order]
        cuts = np.flatnonzero(np.diff(ks)) + 1
        groups = [g for g in np.split(order, cuts) if len(g) > 1 and S[g].min() != S[g].max()]
        nbins += len(groups)
        # (the bins dealt to workers by size, largest first, round robin)
        groups.sort(key=len, reverse=True)
        nj = jobs or max(1, min(24, (os.cpu_count() or 4) - 2))
        shares = [groups[i::nj] for i in range(nj)]
        if nj > 1:
            import multiprocessing as mp
            with mp.get_context('fork').Pool(nj) as pool:
                parts = pool.map(scan, shares)
        else:
            parts = [scan(sh) for sh in shares]
        pa, pp, tested, ps, pdir = collections.defaultdict(float), {}, 0, collections.defaultdict(float), collections.defaultdict(lambda: [0.0, 0.0, -1.0])
        pc = collections.defaultdict(float)
        for a_, p_, t_, s_, d_, c_ in parts:
            for k, v in c_.items(): pc[k] += v
            for k, v in a_.items(): pa[k] += v
            for k, v in p_.items(): pp.setdefault(k, v)
            for k, v in s_.items(): ps[k] += v
            for k, v in d_.items(): pdir[k][0] += v[0]; pdir[k][1] += v[1]; pdir[k][2] = max(pdir[k][2], v[2])
            tested += t_
        results.append((pa, pp, tested, ps, pdir, pc))
    out = {}; G['dir'] = {}; G['cop'] = {}; G['dmax'] = {}
    for pa, pp, _, ps, pdir, pc in results:
        for k, v in pa.items():
            if v / 2.0 > out.get(k, (0.0,))[0]:
                out[k] = (v / 2.0, ps[k] / max(v, 1e-9), pp[k])
                G['cop'][k] = pc.get(k, 0.0) / 2.0
                for kk in (k, (k[1], k[0])):   # (the offset of each side's partner along its own normal, area-weighted)
                    if kk in pdir and pdir[kk][0] > 0: G['dir'][kk] = pdir[kk][1] / pdir[kk][0]; G['dmax'][kk] = pdir[kk][2]   # (and the largest)
    return out, {'triangles': int(len(T)), 'bins': nbins, 'tested': sum(r[2] for r in results)}


def gate(T, S, table, max_m2, cell=0.5, jobs=0, max_pair=5.0):
    t0 = time.time()
    O, info = overlaps(T, S, jobs)
    pair_area = {k: v[0] * 2.0 for k, v in O.items()}; pair_gap = {k: v[1] for k, v in O.items()}; pair_pt = {k: v[2] for k, v in O.items()}
    nbins = info['bins']; T_n = info['triangles']; tested = info['tested']
    # (each overlap is counted from both sides: halve). A pair's contacts under 1 mm are COPLANAR (one surface drawn
    # twice, or two in one plane: they fight in any renderer), the rest, 1 mm to 2 cm, CLOSE (a layer laid on another:
    # depth precision holds it apart, but a simplified LOD of either, Nanite's included, can cross the other at distance)
    pairs = sorted(((k, v / 2.0) for k, v in pair_area.items()), key=lambda kv: -kv[1])
    cop_a = dict(G['cop'])   # (GB43: a pair's coplanar part is its contacts' area under 1 mm, on the scale of its area)
    # TWICE: a tile facade on a dressed building's walls within 2 mm (one building drawn twice, fighting: r1c_dedupe.py removes
    # them; one 2 mm to 2 cm off the other is a CLOSE layer);
    # INTERIOR: two rooms' walls behind the windows of the facade kit in one plane (its rooms are boxes 0.8 m wider than
    # their window on each side, so the next room's box overlaps: a kit matter, reported apart)
    intr = lambda k: all((table[x]['material'] or '').startswith('fk:int_') for x in k)
    twice = [(k, v) for k, v in pairs if ((table[k[0]]['tile'] and table[k[1]]['dress']) or (table[k[1]]['tile'] and table[k[0]]['dress'])) and pair_gap[k] < 0.002]
    tw = set(k for k, _ in twice)
    interior = [(k, v) for k, v in pairs if k not in tw and pair_gap[k] < 0.001 and intr(k)]
    it = set(k for k, _ in interior)
    cop = sorted([(k, cop_a.get(k, 0.0)) for k, _ in pairs if cop_a.get(k, 0.0) > 0 and k not in tw and k not in it], key=lambda kv: -kv[1])
    close = sorted([(k, v - cop_a.get(k, 0.0)) for k, v in pairs if v - cop_a.get(k, 0.0) > 1e-6 and k not in tw and k not in it], key=lambda kv: -kv[1])
    total = sum(v for _, v in cop); total_close = sum(v for _, v in close)
    total_twice = sum(v for _, v in twice); total_int = sum(v for _, v in interior)
    top = lambda L: [{'area_m2': round(v, 3), 'gap_mm': round(pair_gap[k] * 1000, 2), 'a': table[k[0]], 'b': table[k[1]], 'at': pair_pt[k]} for k, v in L[:40]]
    return {'triangles': T_n, 'bins': nbins, 'tested': tested, 'overlap_m2': round(total, 3), 'pairs': len(cop),
            'twice_m2': round(total_twice, 3), 'twice_pairs': len(twice), 'interior_m2': round(total_int, 3), 'interior_pairs': len(interior),
            'close_m2': round(total_close, 3), 'close_pairs': len(close),
            'top': top(cop), 'top_twice': top(twice), 'top_interior': top(interior), 'top_close': top(close),
            'by_kind': kinds(cop, table), 'by_material': by_material(cop, table), 'by_material_close': by_material(close, table),
            'secs': round(time.time() - t0, 1), 'max_m2': round(max_m2, 2), 'max_pair_m2': max_pair,
            'worst_pair_m2': round(max([v for _, v in cop] + [v for _, v in twice] + [0.0]), 3),
            'pass': bool(total <= max_m2 and total_twice <= max_m2 and max([v for _, v in cop] + [v for _, v in twice] + [0.0]) <= max_pair)}


def by_material(pairs, table):
    """the overlap area per material pair (names without their hashes), largest first"""
    out = collections.defaultdict(lambda: [0, 0.0])
    for (a, b), v in pairs:
        ka = (table[a]['material'] or '').split('#')[0]; kb = (table[b]['material'] or '').split('#')[0]
        k = ' <-> '.join(sorted([ka, kb]))
        out[k][0] += 1; out[k][1] += v
    return [{'materials': k, 'pairs': n, 'm2': round(m, 2)} for k, (n, m) in sorted(out.items(), key=lambda kv: -kv[1][1])[:40]]


def kinds(pairs, table):
    out = collections.defaultdict(lambda: [0, 0.0])
    for (a, b), v in pairs:
        A, Bt = table[a], table[b]
        k = ('far' if A['far'] else 'dress' if A['dress'] else 'cell') + '+' + ('far' if Bt['far'] else 'dress' if Bt['dress'] else 'cell')
        k += ' same-file' if A['file'] == Bt['file'] else ' across-files'
        out[k][0] += 1; out[k][1] += v
    return {k: {'pairs': n, 'm2': round(m, 2)} for k, (n, m) in out.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--glb-dir', action='append', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--night', action='store_true'); ap.add_argument('--classes', default='2,26,33,34,35'); ap.add_argument('--far-all', action='store_true')
    # GB43 (2026-10-12): --max-m2 is the total per 150 cell files (a world three times the cells holds three times the
    # joints), and no one pair may pass --max-pair (every defect found so far was one large pair: 20 to 86 m2)
    ap.add_argument('--max-m2', type=float, default=10.0); ap.add_argument('--max-pair', type=float, default=5.0); ap.add_argument('--jobs', type=int, default=0)
    ap.add_argument('--with-shadow-only', action='store_true', help='count the shadowOnly nodes as drawn (the worlds before the fix drew them)')
    a = ap.parse_args()
    paths = sorted(p for d in a.glb_dir for p in glob.glob(os.path.join(d, '*.glb')))
    if not paths: print('no glb'); sys.exit(2)
    classes = set(int(x) for x in a.classes.split(',')) if a.classes else None
    t0 = time.time()
    T, S, table = load(paths, classes, a.night, a.far_all, a.with_shadow_only)
    if T is None: print('no triangles'); sys.exit(2)
    ncells = sum(1 for p in paths if os.path.basename(p)[0] in '-0123456789')   # (the cells: <cx>_<cz>.glb; far packages are L*_)
    R = gate(T, S, table, a.max_m2 * max(1.0, ncells / 150.0), jobs=a.jobs, max_pair=a.max_pair)
    R.update(files=len(paths), sources=len(table), load_s=round(time.time() - t0 - R['secs'], 1), night=a.night, classes=sorted(classes or []))
    os.makedirs(a.out, exist_ok=True)
    json.dump(R, open(os.path.join(a.out, 'dupgate.json'), 'w'), indent=1, default=lambda o: o.item() if hasattr(o, 'item') else str(o))
    print(json.dumps({k: R[k] for k in ('files', 'sources', 'triangles', 'pairs', 'overlap_m2', 'twice_pairs', 'twice_m2', 'interior_pairs', 'interior_m2',
                                        'close_pairs', 'close_m2', 'pass', 'by_kind', 'load_s', 'secs')}))
    for lab, L in (('coplanar', R['by_material']), ('close', R['by_material_close'])):
        for t in L[:10]:
            print(f"  {lab:8s} {t['m2']:10.2f} m2 {t['pairs']:5d} pairs  {t['materials'][:110]}")
    for t in R['top'][:10] + R['top_twice'][:6] + R['top_interior'][:3] + R['top_close'][:4]:
        print(f"  {t['area_m2']:8.2f} m2 gap {t['gap_mm']:6.2f} mm  {t['a']['file']}:{t['a']['node']}:{(t['a']['material'] or '')[:28]}  <->  {t['b']['file']}:{t['b']['node']}:{(t['b']['material'] or '')[:28]}  at {t['at']}")
    sys.exit(0 if R['pass'] else 3)


if __name__ == '__main__':
    main()
