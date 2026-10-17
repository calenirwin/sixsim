#!/usr/bin/env python3
# R1C (lane C, 2026-10-11): every surface drawn once, and no two in one plane. Run on a world's packed cells (after
# r1c_glbuv.py, which drops the shadowOnly tile facades a cell marks for the buildings it holds dressed):
#   1. a building near a cell's edge is dressed in one cell while its tile facade also lies in the next cell's tile facade
#      nodes, unmarked: drawn, it doubles the dressed walls (the client hides it by the tile's hide mask, which knows every
#      dressed building). Every tile facade building (a tile facade node's triangles of one _aBid) whose walls lie on a
#      dressed building's walls (same facing, within 2 cm, overlapping: r1c_dupgate.py's test) over a fifth of its area is
#      removed, whichever cell it is in; of one less covered (any 0.02 m2), each triangle on the dressed walls is cut into
#      pieces of at most 1 m2: the pieces a dressed wall covers by half are removed, those it covers less are moved 6 cm in
#      behind it (the rest stays, as the client's hide mask leaves the texels of the lots the dresser did not dress);
#   2. two surfaces of the packages in one plane (a gap under 1 mm, facing the same way: a cornice band on its wall, a
#      shop's steel on its fill, two rooms of the facade kit whose boxes overlap) fight in any renderer: the triangles of
#      the smaller of the two that lie on the other (0.5 % of a triangle) are moved 2 mm out along their normal (their
#      vertices copied, so the rest of their mesh stays where it is), the larger surface showing behind them as it does at
#      their edges. The night parts are in it (a lit pane on its room fill).
#   python3 tools/ue/r1c_dedupe.py --dir <the world's cells_uv> [--out <json>] [--keep <file.glb>] [--jobs <n>]
# Rewrites the affected glbs in place (a copy of each original is kept beside it as .orig). GB43: with --keep (the cell
# cache's runs: a cell and its eight neighbours, the centre kept), only the triangles near the kept file's own are
# scanned, only pairs with one of its surfaces decide, and only it is rewritten; the sources' areas are still those of
# the whole neighbourhood, so two neighbouring runs decide a pair they share alike. --jobs caps the scan's workers (48
# runs at once each forking 24 had a thousand processes on 128 cores).
import argparse, collections, glob, json, os, struct, sys, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import r1c_dupgate as dg

NUDGE = 0.002   # (a layer moved out of the plane it shares)
MIN_COVER = 0.004   # (m2: a triangle this much on another surface moves however large it is; GB43, a 62 m sliver of wall
                    # slab under a row of sills was covered under the relative 0.5 %, and the overlap gate failed on it)
JOBS = 0
BACK = 0.06     # (a tile facade's piece partly on a dressed wall moved in behind it)
CLASSES = (2, 26, 33, 34, 35)


def glb(fp):
    f = open(fp, 'rb').read()
    L = struct.unpack('<I', f[12:16])[0]
    J = json.loads(f[20:20 + L]); o = 20 + L
    B = f[o + 8:o + 8 + struct.unpack('<I', f[o:o + 4])[0]]
    return J, B


def subdivide(P, maxa):
    """a triangle cut along its longest edge until each piece is at most maxa m2: the pieces as barycentric corner rows,
    wound as the triangle"""
    out, st = [], [np.eye(3)]
    while st:
        Bc = st.pop(); X = Bc @ P
        if np.linalg.norm(np.cross(X[1] - X[0], X[2] - X[0])) / 2 <= maxa or len(out) + len(st) > 20000: out.append(Bc); continue
        e = [np.linalg.norm(X[1] - X[0]), np.linalg.norm(X[2] - X[1]), np.linalg.norm(X[0] - X[2])]
        k = int(np.argmax(e)); i, j, l = k, (k + 1) % 3, (k + 2) % 3
        m = (Bc[i] + Bc[j]) / 2
        st.append(np.array([Bc[i], m, Bc[l]])); st.append(np.array([m, Bc[j], Bc[l]]))
    return out


def cover_of(T, S, movers, fixed_mask, allowed=None, ahead=None, cop_only=False):
    """per mover source (each one triangle): the area of it lying on the fixed sources (with allowed, a map from a mover
    to the set of sources it may lie on, only those; with ahead, a dict filled with how far in front of the mover, along
    its normal, the surface it lies on is: the largest over its partners)"""
    O, _ = dg.overlaps(T, S, JOBS)
    cov = collections.defaultdict(float)
    cop = dg.G['cop']
    for (x, y), (ar_, gap, pt) in O.items():
        if cop_only:   # (GB43: only the contacts under 1 mm (COP_GAP); a layer a centimetre off is not brought forward)
            ar_ = cop.get((x, y), 0.0)
            if ar_ <= 0: continue
        for mv, fx in ((x, y), (y, x)):
            if mv in movers and fixed_mask[fx] and (allowed is None or fx in allowed.get(mv, ())):
                cov[mv] += ar_
                # (GB43: the partner's farthest point, not its mean: a lit quad moved past a tilted pane's mean offset still
                # crossed the pane along a band)
                if ahead is not None: ahead[mv] = max(ahead.get(mv, 0.0), dg.G['dmax' if cop_only else 'dir'].get((mv, fx), 0.0))
                break
    return cov


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', required=True); ap.add_argument('--out', default=None)
    ap.add_argument('--share', type=float, default=0.2)
    ap.add_argument('--keep', default=None); ap.add_argument('--jobs', type=int, default=0)
    ap.add_argument('--check', action='store_true', help='GB43: the kept cell\'s report (its pairs\' contacts under 1 mm, the gate\'s classes), nothing rewritten')
    a = ap.parse_args()
    global JOBS
    JOBS = a.jobs
    t0 = time.time()
    tris, srcs, table = [], [], []
    files = sorted(glob.glob(os.path.join(a.dir, '*.glb')))
    sel_of = {}   # source id -> the triangle indices of its primitive it holds
    for fp in files:
        J, B = glb(fp)
        root = J['nodes'][J['scenes'][0]['nodes'][0]] if J.get('scenes') and J['scenes'][0].get('nodes') else {}
        org = np.asarray(root.get('translation') or [0, 0, 0], np.float64)
        for ni, n in enumerate(J['nodes']):
            ex = n.get('extras') or {}
            if 'mesh' in n and ex.get('kind') == 'kit' and ex.get('class') in CLASSES:   # (GB43 KIT: dressed walls that hold still)
                tri, p = dg.kit_tris(J, B, n)
                if not len(tri): continue
                m = J['materials'][p['material']] if 'material' in p else {}
                table.append({'file': os.path.basename(fp), 'node': n.get('name'), 'mesh': n['mesh'], 'prim': 0, 'material': m.get('name') or '', 'dress': True, 'tile': False, 'kit': True,
                              'node_i': ni, 'tpi': len(tri) // max(1, len(dg.read(J, B, n['extensions']['EXT_mesh_gpu_instancing']['attributes']['TRANSLATION'])))})
                sel_of[len(table) - 1] = np.arange(len(tri))
                tris.append(tri + org); srcs.append(np.full(len(tri), len(table) - 1, np.int64))
                continue
            if 'mesh' not in n or ex.get('kind') != 'mesh' or ex.get('class') not in CLASSES: continue
            for pi, p in enumerate(J['meshes'][n['mesh']]['primitives']):
                m = J['materials'][p['material']] if 'material' in p else {}
                three = (m.get('extras') or {}).get('three') or {}
                if dg.overlay(three) or 'indices' not in p: continue
                dress, tile = bool(ex.get('dress')), '_aBid' in p['attributes'] and not ex.get('dress')
                two = int(three.get('side') or 0) == 2 or bool(m.get('doubleSided'))
                P = dg.read(J, B, p['attributes']['POSITION']).astype(np.float64) + org
                I = dg.read(J, B, p['indices']).reshape(-1, 3).astype(np.int64)
                if two and not tile:   # (a two-sided surface faces both ways: its triangles once more, wound the other way)
                    table.append(dict(base := {'file': os.path.basename(fp), 'node': n.get('name'), 'mesh': n['mesh'], 'prim': pi, 'material': m.get('name') or '', 'dress': dress, 'tile': False}))
                    sel_of[len(table) - 1] = np.concatenate([np.arange(len(I)), np.arange(len(I))])
                    tris.append(np.concatenate([P[I], P[I[:, ::-1]]])); srcs.append(np.full(2 * len(I), len(table) - 1, np.int64))
                    continue
                base = {'file': os.path.basename(fp), 'node': n.get('name'), 'mesh': n['mesh'], 'prim': pi, 'material': m.get('name') or '', 'dress': dress, 'tile': tile}
                if tile:
                    bid = dg.read(J, B, p['attributes']['_aBid'])[:, 0][I[:, 0]].astype(np.int64)
                    for b in np.unique(bid):
                        sel = np.flatnonzero(bid == b)
                        table.append(dict(base, bid=int(b))); sel_of[len(table) - 1] = sel
                        tris.append(P[I[sel]]); srcs.append(np.full(len(sel), len(table) - 1, np.int64))
                else:
                    table.append(base); sel_of[len(table) - 1] = np.arange(len(I))
                    tris.append(P[I]); srcs.append(np.full(len(I), len(table) - 1, np.int64))
    if not tris: print(json.dumps({'dropped': 0})); return
    T = np.concatenate(tris); S = np.concatenate(srcs)
    cr = np.linalg.norm(np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]), axis=1) / 2.0
    own = np.bincount(S, weights=cr, minlength=len(table))
    is_dress = np.array([t['dress'] for t in table]); is_tile = np.array([t['tile'] for t in table])
    rep = {'sources': len(table), 'triangles': int(len(T))}
    if a.keep:
        mine = np.array([t['file'] == a.keep for t in table], bool)
        km = mine[S]
        if not km.any(): print(json.dumps({'dropped': 0, 'keep': 'empty'})); return
        lo = T[km].min(axis=(0, 1)) - 0.05; hi = T[km].max(axis=(0, 1)) + 0.05
        near = (T.max(1) >= lo).all(1) & (T.min(1) <= hi).all(1)
        O, info = dg.overlaps(T[near], S[near], JOBS)
        O = {k: v for k, v in O.items() if mine[k[0]] or mine[k[1]]}
        COP = dict(dg.G['cop'])
        rep.update(scanned=int(near.sum()))
    else:
        mine = np.ones(len(table), bool); near = np.ones(len(T), bool)
        O, info = dg.overlaps(T, S, JOBS)
        COP = dict(dg.G['cop'])
    if a.check:   # (GB43: the city build's per-cell gate, kept with the cell: r1c_dupgate.py's classes over the pairs touching it)
        intr = lambda k: all((table[x]['material'] or '').startswith('fk:int_') for x in k)
        cop_l, tw_l, top = [], [], []
        for k, v in O.items():
            c = COP.get(k, 0.0)
            if c <= 0: continue
            if (is_tile[k[0]] and is_dress[k[1]]) or (is_tile[k[1]] and is_dress[k[0]]): tw_l.append(c)
            elif intr(k): continue
            else: cop_l.append(c)
            top.append((round(c, 3), table[k[0]]['file'], table[k[0]]['material'].split('#')[0], table[k[1]]['file'], table[k[1]]['material'].split('#')[0], v[2]))
        rep.update(check=True, cop_m2=round(sum(cop_l), 3), twice_m2=round(sum(tw_l), 3), worst_pair_m2=round(max(cop_l + tw_l + [0.0]), 3),
                   pairs=len(cop_l), top=sorted(top, reverse=True)[:12], secs=round(time.time() - t0, 1))
        if a.out: json.dump(rep, open(a.out, 'w'), indent=1)
        print(json.dumps({k: v for k, v in rep.items() if k != 'top'}))
        return
    # ---- 1. the tile facades on dressed walls
    cover = collections.defaultdict(float)
    for (x, y), (ar_, gap, pt) in O.items():
        if is_tile[x] and is_dress[y]: cover[x] += ar_
        elif is_tile[y] and is_dress[x]: cover[y] += ar_
    drop_b = {sid for sid, v in cover.items() if v >= a.share * own[sid]}
    drops = collections.defaultdict(list)   # (file, mesh, prim) -> triangle indices to drop
    offs = collections.defaultdict(dict)    # (file, mesh, prim) -> {triangle: its offset along its normal (m)}
    kmov = collections.defaultdict(lambda: collections.defaultdict(dict))   # GB43 KIT: (file, node) -> {instance: {face normal: offset}}
    kidx = {}
    for sid in drop_b:
        t = table[sid]; drops[(t['file'], t['mesh'], t['prim'])].append(sel_of[sid])
    part = [sid for sid, v in cover.items() if sid not in drop_b and v >= 0.02 and mine[sid]]
    n_part = 0; n_pieces_gone = 0; n_pieces_back = 0
    splits = collections.defaultdict(dict)  # (file, mesh, prim) -> {triangle: the barycentric pieces of it kept}
    if part:
        dsel = np.flatnonzero(is_dress[S] & near)
        rows, ss, back = [T[dsel]], [S[dsel]], {}
        nxt = len(table)
        for sid in part:
            idx = np.flatnonzero(S == sid)
            rows.append(T[idx]); ids = np.arange(nxt, nxt + len(idx), dtype=np.int64); ss.append(ids)
            for k_, i_ in zip(ids.tolist(), sel_of[sid].tolist()): back[k_] = (sid, i_)
            nxt += len(idx)
        T2 = np.concatenate(rows); S2 = np.concatenate(ss)
        fixed = np.zeros(nxt, bool); fixed[:len(table)] = is_dress
        car = np.linalg.norm(np.cross(T2[:, 1] - T2[:, 0], T2[:, 2] - T2[:, 0]), axis=1) / 2.0
        own2 = dict(zip(S2.tolist(), car.tolist()))
        cand = [k_ for k_, v in cover_of(T2, S2, set(back), fixed).items() if v >= min(0.02, 0.01 * own2[k_])]
        # each such triangle cut into pieces of at most 1 m2, and the pieces a dressed wall covers (30 %) dropped: the tile
        # facade stays where the dresser left the building alone, as the client's hide mask leaves those texels
        pieces, pk, nxt2 = [], [], nxt
        rows4, ss4 = [T[dsel]], [S[dsel]]
        for k_ in cand:
            tri = T2[np.flatnonzero(S2 == k_)[0]]
            for Bc in subdivide(tri, 1.0):
                pieces.append((k_, Bc)); rows4.append((Bc @ tri)[None]); ss4.append(np.array([nxt2], np.int64)); nxt2 += 1
        if pieces:
            T4 = np.concatenate(rows4); S4 = np.concatenate(ss4)
            fixed4 = np.zeros(nxt2, bool); fixed4[:len(table)] = is_dress
            pid0 = nxt
            car4 = np.linalg.norm(np.cross(T4[:, 1] - T4[:, 0], T4[:, 2] - T4[:, 0]), axis=1) / 2.0
            own4 = dict(zip(S4.tolist(), car4.tolist()))
            cov4 = cover_of(T4, S4, set(range(pid0, nxt2)), fixed4)
            byt = collections.defaultdict(list)
            for j_, (k_, Bc) in enumerate(pieces):
                c_ = cov4.get(pid0 + j_, 0.0) / max(own4[pid0 + j_], 1e-12)
                byt[k_].append((Bc, 'gone' if c_ >= 0.5 else 'back' if c_ >= 0.01 else 'keep'))
            for k_, L_ in byt.items():
                sid, i_ = back[k_]; t = table[sid]
                splits[(t['file'], t['mesh'], t['prim'])][i_] = [(Bc, st == 'back') for Bc, st in L_ if st != 'gone']
                n_part += 1; n_pieces_gone += sum(1 for _, st in L_ if st == 'gone'); n_pieces_back += sum(1 for _, st in L_ if st == 'back')
    rep.update(tile_buildings=int(is_tile.sum()), tile_buildings_dropped=len(drop_b), tile_dropped_m2=round(float(sum(own[s] for s in drop_b)), 1),
               tile_partial_buildings=len(part), tile_partial_triangles_cut=n_part, tile_pieces_dropped=n_pieces_gone, tile_pieces_moved_in=n_pieces_back)
    # ---- 2. two surfaces of the packages in one plane: the smaller one's triangles on the other moved out 2 mm
    pairs = [(k, (COP[k],) + tuple(v[1:])) for k, v in O.items() if COP.get(k, 0.0) >= 0.0005 and not (is_tile[k[0]] and is_dress[k[1]]) and not (is_tile[k[1]] and is_dress[k[0]])
             and k[0] not in drop_b and k[1] not in drop_b]   # (GB43: by the pair's contacts under 1 mm, not its mean gap)
    movers = {}
    for (x, y), v in pairs:
        mv, fx = (x, y) if own[x] <= own[y] else (y, x)
        if not mine[mv]: continue   # (--keep: a neighbour's layer moves in its own run)
        movers.setdefault(mv, set()).add(fx)
    n_move = 0
    if movers:
        fixed_ids = set(f for fs in movers.values() for f in fs)   # (a source both moves on one and holds still for another)
        rows, ss, back = [], [], {}
        for f_ in fixed_ids:
            idx = np.flatnonzero(S == f_); rows.append(T[idx]); ss.append(np.full(len(idx), f_, np.int64))
        nxt = len(table)
        for sid in movers:
            idx = np.flatnonzero(S == sid)
            rows.append(T[idx]); ids = np.arange(nxt, nxt + len(idx), dtype=np.int64); ss.append(ids)
            for k_, i_ in zip(ids.tolist(), sel_of[sid].tolist()): back[k_] = (sid, i_)
            nxt += len(idx)
        T3 = np.concatenate(rows); S3 = np.concatenate(ss)
        fixed = np.zeros(nxt, bool)
        if fixed_ids: fixed[np.array(sorted(fixed_ids))] = True
        car = np.linalg.norm(np.cross(T3[:, 1] - T3[:, 0], T3[:, 2] - T3[:, 0]), axis=1) / 2.0
        own3 = dict(zip(S3.tolist(), car.tolist()))
        ahead = {}
        for k_, v in cover_of(T3, S3, set(back), fixed, {k: movers[back[k][0]] for k in back}, ahead, cop_only=True).items():
            if v >= (1e-4 if table[back[k_][0]].get('kit') else min(0.005 * own3[k_], MIN_COVER)):   # (a kit instance moves for any contact: 2 mm of a whole part)
                # (out past the surface it lies on: a layer a hair behind its wall comes 2 mm in front of it, not level)
                sid, i_ = back[k_]; t = table[sid]
                if t.get('kit'):   # (GB43 KIT: the whole instance moves, out along each face of it that lies on another surface)
                    if sid not in kidx: kidx[sid] = np.flatnonzero(S == sid)
                    tr = T[kidx[sid][i_]]; nv = np.cross(tr[1] - tr[0], tr[2] - tr[0]); nv /= max(np.linalg.norm(nv), 1e-12)
                    d_ = kmov[(t['file'], t['node_i'])][int(i_) // max(1, t['tpi'])]; kn = tuple(np.round(nv, 2))
                    d_[kn] = max(d_.get(kn, 0.0), max(0.0, ahead.get(k_, 0.0)) + NUDGE); n_move += 1
                    continue
                offs[(t['file'], t['mesh'], t['prim'])].setdefault(i_, max(0.0, ahead.get(k_, 0.0)) + NUDGE); n_move += 1
    rep.update(coplanar_pairs=len(pairs), coplanar_m2=round(float(sum(v[0] for _, v in pairs)), 1), moved_triangles=n_move,
               moved_examples=sorted({f"{table[s]['material'].split('#')[0]} on {table[f]['material'].split('#')[0]}" for s, fs in movers.items() for f in fs})[:30])
    # ---- the rewrite
    files_ = sorted({k[0] for k in drops} | {k[0] for k in offs} | {k[0] for k in splits} | {k[0] for k in kmov})
    if a.keep: files_ = [f for f in files_ if f == a.keep]
    rep.update(kit_instances_moved=sum(len(v) for v in kmov.values()))
    for fn in files_:
        fp = os.path.join(a.dir, fn)
        J, B = glb(fp)
        extra = bytearray(); base = len(B) + (-len(B)) % 4
        def add(arr, typ, ctype, normalized=False):
            dt = {5126: '<f4', 5125: '<u4', 5123: '<u2', 5121: '<u1', 5122: '<i2', 5120: '<i1'}[ctype]
            data = np.ascontiguousarray(arr.astype(dt)).tobytes()
            J['bufferViews'].append({'buffer': 0, 'byteOffset': base + len(extra), 'byteLength': len(data)})
            extra.extend(data + b'\0' * ((-len(data)) % 4))
            acc = {'bufferView': len(J['bufferViews']) - 1, 'componentType': ctype, 'count': int(arr.shape[0]), 'type': typ}
            if normalized: acc['normalized'] = True
            if typ != 'SCALAR' and ctype == 5126:
                a2 = arr.reshape(arr.shape[0], -1); acc['min'] = a2.min(0).astype(float).tolist(); acc['max'] = a2.max(0).astype(float).tolist()
            J['accessors'].append(acc); return len(J['accessors']) - 1
        for (kf, ni_), mv_ in kmov.items():   # (GB43 KIT: the moved instances' translations, and scales)
            if kf != fn or not mv_: continue
            nd_ = J['nodes'][ni_]; at_ = nd_['extensions']['EXT_mesh_gpu_instancing']['attributes']
            Tn = dg.read(J, B, at_['TRANSLATION']).astype(np.float64)
            Rq = dg.read(J, B, at_['ROTATION']).astype(np.float64) if 'ROTATION' in at_ else np.tile([0, 0, 0, 1.0], (len(Tn), 1))
            Sn = dg.read(J, B, at_['SCALE']).astype(np.float64) if 'SCALE' in at_ else np.ones((len(Tn), 3))
            Pp = dg.read(J, B, J['meshes'][nd_['mesh']]['primitives'][0]['attributes']['POSITION']).astype(np.float64)
            plo, phi = Pp.min(0), Pp.max(0)   # (the prototype's own bounds)
            scaled = False
            for ii, dd_ in mv_.items():
                x, y, z, w = Rq[ii]
                Rm = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                               [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                               [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
                # (per local axis, how far each of its two faces must go: a face on one side only moves the instance out
                # along it; faces on both sides, as two boxes of one height, shrink it so both sit behind the other surface)
                need = {}
                for kn, dv in dd_.items():
                    nv = np.asarray(kn, np.float64); nv /= max(np.linalg.norm(nv), 1e-9)
                    ln = Rm.T @ nv; j = int(np.argmax(np.abs(ln))); sg = 1 if ln[j] > 0 else -1
                    need.setdefault(j, {})[sg] = max(need.get(j, {}).get(sg, 0.0), dv)
                for j, sd in need.items():
                    if 1 in sd and -1 in sd and abs(Sn[ii, j]) * (phi[j] - plo[j]) > sd[1] + sd[-1] + 0.004:
                        L_ = Sn[ii, j] * (phi[j] - plo[j]); s2 = Sn[ii, j] * (L_ - sd[1] - sd[-1]) / L_
                        tj = Sn[ii, j] * plo[j] + sd[-1] - s2 * plo[j]
                        Tn[ii] += Rm[:, j] * tj; Sn[ii, j] = s2; scaled = True
                    else:
                        for sg, dv in sd.items(): Tn[ii] += Rm[:, j] * sg * dv
            at_['TRANSLATION'] = add(Tn, 'VEC3', 5126)
            if scaled: at_['SCALE'] = add(Sn, 'VEC3', 5126)
        keys = sorted({(k[1], k[2]) for k in drops if k[0] == fn} | {(k[1], k[2]) for k in offs if k[0] == fn} | {(k[1], k[2]) for k in splits if k[0] == fn})
        for mi, pi in keys:
            p = J['meshes'][mi]['primitives'][pi]
            I = dg.read(J, B, p['indices']).reshape(-1, 3).astype(np.int64)
            keep = np.ones(len(I), bool)
            for sel in drops.get((fn, mi, pi), []): keep[sel] = False
            od = offs.get((fn, mi, pi), {})
            sp = splits.get((fn, mi, pi), {})
            at = p['attributes']
            arrs, accs, changed = {}, {}, False
            if od or sp:
                for k_, acc_i in at.items(): arrs[k_] = dg.read(J, B, acc_i); accs[k_] = J['accessors'][acc_i]
            mv = np.array(sorted(od), np.int64)
            if len(mv): mv = mv[keep[mv]]
            if len(mv):
                # the moved triangles' vertices copied (every attribute), the copies 2 mm out along their face's normal
                nv = len(arrs['POSITION'])
                src_v = I[mv].reshape(-1)
                tri = arrs['POSITION'].astype(np.float64)[I[mv]]
                fnrm = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]); fnrm /= np.maximum(np.linalg.norm(fnrm, axis=1, keepdims=True), 1e-12)
                dist = np.array([od[int(t_)] for t_ in mv], np.float64)
                newP = (tri + fnrm[:, None, :] * dist[:, None, None]).reshape(-1, 3)
                for k_ in arrs:
                    rows_ = newP.astype(arrs[k_].dtype) if k_ == 'POSITION' else arrs[k_][src_v]
                    arrs[k_] = np.concatenate([arrs[k_], rows_.reshape(len(src_v), -1)])
                I[mv] = (nv + np.arange(len(src_v))).reshape(-1, 3); changed = True
            extra_I = np.zeros((0, 3), np.int64)
            sp = {t_: L_ for t_, L_ in sp.items() if keep[t_]}
            if sp:
                # the cut triangles: their kept pieces' corners, every attribute interpolated from the triangle's three
                nv = len(arrs['POSITION'])
                W_, V_, BK = [], [], []
                for t_, L_ in sp.items():
                    keep[t_] = False
                    for Bc, bk in L_: W_.append(Bc); V_.append(I[t_]); BK.append(bk)
                if W_:
                    W_ = np.concatenate(W_).reshape(-1, 3); V_ = np.repeat(np.array(V_), 3, axis=0)   # (one row per new corner)
                    for k_ in arrs:
                        arr = arrs[k_]
                        new = (arr[V_].astype(np.float64) * W_[:, :, None]).sum(1)
                        if k_ == 'POSITION' and any(BK):
                            # (a piece partly on a dressed wall: in behind it, the rest of it a step back rather than a hole)
                            tri = new.reshape(-1, 3, 3)
                            fn_ = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]); fn_ /= np.maximum(np.linalg.norm(fn_, axis=1, keepdims=True), 1e-12)
                            tri = tri - fn_[:, None, :] * (np.array(BK, np.float64) * BACK)[:, None, None]
                            new = tri.reshape(-1, 3)
                        if arr.dtype.kind in 'iu': new = np.rint(new)
                        arrs[k_] = np.concatenate([arr, new.astype(arr.dtype).reshape(len(new), -1)])
                    extra_I = (nv + np.arange(len(W_))).reshape(-1, 3)
                changed = True
            if changed:
                for k_, arr in arrs.items():
                    acc = accs[k_]
                    at[k_] = add(arr.reshape(len(arr), -1), acc['type'], acc['componentType'], bool(acc.get('normalized')))
            p['indices'] = add(np.concatenate([I[keep], extra_I]).reshape(-1), 'SCALAR', 5125)
            if not keep.any() and not len(extra_I): p['_r1c_empty'] = True
        for me in J['meshes']:   # (a primitive left with no triangle goes)
            me['primitives'] = [p for p in me['primitives'] if not p.pop('_r1c_empty', False)] or me['primitives'][:1]
        NB = B + b'\0' * (base - len(B)) + bytes(extra)
        J['buffers'][0]['byteLength'] = len(NB)
        js = json.dumps(J, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
        if not os.path.exists(fp + '.orig'): os.replace(fp, fp + '.orig')
        tmp = fp + f'.tmp{os.getpid()}'
        with open(tmp, 'wb') as w:
            w.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(NB)))
            w.write(struct.pack('<II', len(js), 0x4E4F534A)); w.write(js)
            w.write(struct.pack('<II', len(NB), 0x004E4942)); w.write(NB)
        os.replace(tmp, fp)
    rep.update(files=len(files_), secs=round(time.time() - t0, 1))
    if a.out: json.dump(rep, open(a.out, 'w'), indent=1)
    print(json.dumps(rep)[:1800])


if __name__ == '__main__':
    main()
