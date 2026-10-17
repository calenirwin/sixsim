# BX-SOLID (SOLID12, 2026-10-09): the window AC units that the web's facade shader paints, as instanced geometry in the
# take's USD, so Blender Cycles and Unreal draw a solid unit at every opening where the web draws one.
#
# The web (world/materials.js, makeFacadeMaterial: the WL11 block of the punched-window branch) paints a unit into about a
# quarter of the residential openings: styles 0-2 above 6 m and WB13's sided houses above 3.2 m, by the integer hash
# wlHash (bit-exact in GLSL and JS) of the facade's colour seed (aux2.z) and the opening's bay and floor, hard left or right
# in its opening, in three tints. Every input is per wall (aux, aux2, aux3) and the facade uv, which the BX-WIN facade bake
# (harvest_facades.mjs) already saves per triangle in geo/bxw_<shot>_fac<k>.bin. This hook replays the shader's lattice on
# those triangles (the bay layout, WL11's per-bay jitter, its bricked-up openings, the door bay, the storefront storey,
# BW28's exposed lot-line walls) and its AC gate, and writes, per static layer:
#   /World/Facade/ac_t<k>: one PointInstancer per tint, a kit-style unit (facadeKit.js's window AC: the body, its louvred
#   grille and control panel, two brackets) scaled to the painted unit's width and height in the opening; its depth out of
#   the wall is the hero ring's (heroFacades.js, hash 1993: 0.26-0.36 m), its back 0.3 of that inside the wall plane.
# The units cover the bake's painted ones exactly, so nothing doubles; harvest.mjs passes heroskip=ac so the hero ring's
# own AC boxes stay out of the harvest (the instances replace them). Materials: /World/Looks/bxsolid_ac_<tint>_{body,grille},
# a UsdPreviewSurface with the `plain` bx tag (Blender build_plain, Unreal's plain master; region 'buildings').
#   --nofacdetail: off.  --facdetail-stats: per-gate counts in the take's stats.
# CLI check (no USD): python usd_facdetail.py --harvest H --shot S [--frames 0,54,107 --web DIR --out DIR]: the units of
# the harvest projected onto the web take's frames (outlines), the placement check against the painted units.
import json, math, os, sys
import numpy as np

STATE = {'on': True}
TINTS = [(1.04, 1.03, 1.0), (0.94, 0.92, 0.84), (0.66, 0.67, 0.70)]   # the shader's acTint (acT < 0.5, < 0.78, else)
AC_RGB = (0.60, 0.61, 0.60)                                          # the shader's acCol before its tint and slat term


def wlh(a, b):
    """world/materials.js wlHash (the GLSL wlh): integer LCG mod 4093 with two squarings; a, b non-negative integers."""
    a = np.asarray(a, dtype=np.int64); b = np.asarray(b, dtype=np.int64)
    s = (a * 127 + b * 311 + 7) % 4093
    s = (s * s + 1153) % 4093
    s = (s * 137 + 59) % 4093
    s = (s * s + 2411) % 4093
    return s / 4093.0


def wlsg(a, b):
    return wlh(a, b) * 2.0 - 1.0


def load_bxw(IN, shot=None):
    """every wall triangle of the shot's facade bake: pos (n,3,3) world, fuv (n,3,2) facade metres, nrm (n,3), tri (n,13)."""
    p = os.path.join(IN, 'bxwin.json')
    if not os.path.exists(p):
        return None
    J = json.load(open(p))
    if J.get('version') == 2:
        shots = J.get('shots') or {}
        f = shots.get(shot) if shot in shots else next(iter(shots.values()), None)
        if not f or not os.path.exists(os.path.join(IN, f)):
            return None
        bx = json.load(open(os.path.join(IN, f)))
    else:
        bx = J
    P, U, N, T = [], [], [], []
    for at in bx.get('atlases', []):
        g = at['geo']
        fp = os.path.join(IN, g['file'])
        if not os.path.exists(fp):
            continue
        raw = open(fp, 'rb').read()
        L = {x['name']: x for x in g['layout']}
        arr = lambda n, w: np.frombuffer(raw, dtype=np.float32, count=L[n]['count'], offset=L[n]['offset']).reshape(-1, w)
        pos = arr('pos', 9).reshape(-1, 3, 3); nrm = arr('nrm', 9).reshape(-1, 3, 3); fuv = arr('fuv', 6).reshape(-1, 3, 2)
        tri = arr('tri', 13)
        good = np.isfinite(pos).all((1, 2)) & np.isfinite(tri).all(1) & np.isfinite(fuv).all((1, 2))
        P.append(pos[good]); U.append(fuv[good]); N.append(nrm[good].mean(1)); T.append(tri[good])
    if not P:
        return None
    return {'pos': np.concatenate(P).astype(np.float64), 'fuv': np.concatenate(U).astype(np.float64),
            'nrm': np.concatenate(N).astype(np.float64), 'tri': np.concatenate(T).astype(np.float64)}


def ac_units(B, stats=None):
    """the shader's AC units on the bake's wall triangles: dict of arrays (centre-bottom world position, outward normal,
    width, height, depth out, tint index), one row per unit."""
    st = stats if stats is not None else {}
    tri, fuv, pos = B['tri'], B['fuv'], B['pos']
    floorH, winW, storeH, style = tri[:, 0], tri[:, 1], tri[:, 2], tri[:, 3]
    bldgH, cvar, flags = tri[:, 4], tri[:, 6], tri[:, 7]
    wallLen, doorPack, apm = np.maximum(tri[:, 8], 0.01), tri[:, 10], tri[:, 12]
    fl = flags.astype(np.int64)
    isRoof = (fl >> 2) & 1 == 1
    blind = (fl >> 1) & 1 == 1
    store = (fl >> 3) & 1 == 1
    sidingS = (style > 13.5) & (style < 14.5)
    # the AC gate's styles (style < 2.5 or a sided house) are never glass, loft or condo
    keep = (apm > 0) & ~isRoof & ((style < 2.5) | sidingS) & (winW > 0.3) & (floorH > 1.0)
    keep &= ~blind | (bldgH > 36.0)          # BW28: a blind wall over 36 m is windowed above 26 m
    st['wall_tris'] = int((apm > 0).sum()); st['ac_style_tris'] = int(keep.sum())
    idx = np.nonzero(keep)[0]
    if not len(idx):
        return None
    bayN = np.floor((wallLen - 0.44) / winW)
    sideM = (wallLen - np.maximum(bayN, 0) * winW) * 0.5
    # candidate openings: the cells under each triangle's uv box
    u0 = fuv[:, :, 0].min(1); u1 = fuv[:, :, 0].max(1); v0 = fuv[:, :, 1].min(1); v1 = fuv[:, :, 1].max(1)
    cu0 = np.clip(np.floor((u0 - sideM) / winW), 0, None); cu1 = np.minimum(np.floor((u1 - sideM) / winW), bayN - 1)
    cv0 = np.clip(np.floor(v0 / floorH), 0, None); cv1 = np.floor(v1 / floorH)
    nu = (cu1 - cu0 + 1); nv = (cv1 - cv0 + 1)
    ok = keep & (bayN >= 1) & (nu >= 1) & (nv >= 1) & (nu * nv < 20000)
    idx = np.nonzero(ok)[0]
    if not len(idx):
        return None
    cnt = (nu[idx] * nv[idx]).astype(np.int64)
    t = np.repeat(idx, cnt)
    k = np.arange(cnt.sum()) - np.repeat(np.cumsum(cnt) - cnt, cnt)
    nuT = nu[t].astype(np.int64)
    cellU = cu0[t] + (k % nuT); cellV = cv0[t] + (k // nuT)
    st['candidates'] = int(len(t))
    ci = cellU.astype(np.int64); cj = cellV.astype(np.int64)
    cvI = np.floor(cvar[t] * 1024.0 + 0.5).astype(np.int64)
    fH = floorH[t]; wW = winW[t]; dP = doorPack[t]; bN = bayN[t]
    wlDC = np.where(dP >= 8.0, np.floor(dP / 8.0) - 1.0, -1.0)
    pin = np.where(cellU == wlDC, 0.0, 1.0)
    bk = np.clip(ci, 0, 4090) + 1
    bkv = (ci % 64) + (cj % 64) * 64 + 1
    off = wlsg(cvI + 17, bk) * 0.028 * pin
    wsc = 1.0 + wlsg(cvI + 53, bk) * 0.026 * pin
    sJ = wlsg(cvI + 89, bkv) * (0.02 / np.maximum(fH, 2.0))
    sid = sidingS[t]
    bx0 = np.where(sid, 0.30, 0.2); bx1 = np.where(sid, 0.70, 0.8); by0 = np.where(sid, 0.28, 0.3)
    x0 = 0.5 + (bx0 - 0.5) * wsc + off
    x1 = 0.5 + (bx1 - 0.5) * wsc + off
    y0 = by0 + sJ
    # the AC gate (WL11): apartment-clustered rate, side, width, height, tint; the hero ring's depth
    acR = wlh(cvI + 1667, bkv) * 0.45 + wlh(cvI + 1789, ((ci // 2) % 64) + (cj % 64) * 64 + 1) * 0.55
    acW2 = 0.10 + 0.05 * wlh(cvI + 1861, bkv)
    side = np.where(wlh(cvI + 1907, bkv) < 0.5, 0.0, 1.0)
    acCx = (x0 + acW2 + 0.03) * (1.0 - side) + (x1 - acW2 - 0.03) * side
    acTop = y0 + 0.26 + 0.14 * wlh(cvI + 2039, bkv)
    acT = wlh(cvI + 2113, bkv)
    tint = np.where(acT < 0.5, 0, np.where(acT < 0.78, 1, 2))
    depth = 0.26 + 0.10 * wlh(cvI + 1993, bkv)
    # the painted unit's half-coverage edges, in facade metres
    uL = sideM[t] + (cellU + acCx - acW2 + 0.02) * wW
    uR = sideM[t] + (cellU + acCx + acW2 - 0.02) * wW
    vB = (cellV + y0 + 0.04) * fH
    vT = (cellV + acTop - 0.02) * fH
    uc = 0.5 * (uL + uR); vc = 0.5 * (vB + vT)
    g = acR < 0.26
    st['gate_rate'] = int(g.sum())
    # the opening exists: in the bay run, under the top floor's last 0.8 m, not the door, not bricked up, not the shop storey
    g &= (vc <= bldgH[t] - 0.8) & (vc >= 0.15)
    g &= ~(blind[t] & ~(vc > 26.0))
    g &= ~(store[t] & (vc < storeH[t]))
    g &= vc > np.where(sid, 3.2, 6.0)
    doorWall = (dP >= 8.0) & (bN >= 1) & ~store[t] & (wallLen[t] > 3.6)
    doorCell = np.floor(dP / 8.0) - 1.0
    g &= ~(doorWall & (cellU == doorCell) & (vc < 3.6))
    brW = (bN >= 2) & (wlh(cvI + 211, np.full_like(cvI, 3)) < 0.38)
    endB = (cellU < 0.5) | (cellU > bN - 1.5)
    colR = wlh(cvI + 307, np.clip(ci, 0, 4090) + 1)
    opR = wlh(cvI + 401, bkv)
    br = brW & ((opR < np.where(endB, 0.20, 0.025)) | (colR < 0.05))
    br &= ~(doorWall & (cellV < 1.5)) & (cellU != wlDC)
    st['bricked'] = int((g & br).sum())
    g &= ~br
    st['gated'] = int(g.sum())
    sel = np.nonzero(g)[0]
    if not len(sel):
        return None
    t = t[sel]; uc = uc[sel]; vc = vc[sel]; vB = vB[sel]; uL = uL[sel]; uR = uR[sel]; vT = vT[sel]
    # the opening on this triangle: barycentric test in facade uv, then the triangle's affine map to world
    A = fuv[t]; Pw = pos[t]
    e1 = A[:, 1] - A[:, 0]; e2 = A[:, 2] - A[:, 0]
    det = e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]
    good = np.abs(det) > 1e-9
    det = np.where(good, det, 1.0)
    def bary(u, v):
        du = u - A[:, 0, 0]; dv = v - A[:, 0, 1]
        b1 = (du * e2[:, 1] - dv * e2[:, 0]) / det
        b2 = (e1[:, 0] * dv - e1[:, 1] * du) / det
        return b1, b2
    b1, b2 = bary(uc, vc)
    inside = good & (b1 >= -1e-6) & (b2 >= -1e-6) & (b1 + b2 <= 1 + 1e-6)
    st['outside_tri'] = int((~inside).sum())
    s2 = np.nonzero(inside)[0]
    t = t[s2]; uc = uc[s2]; vB = vB[s2]; uL = uL[s2]; uR = uR[s2]; vT = vT[s2]
    Pw = Pw[s2]; e1 = e1[s2]; e2 = e2[s2]; det = det[s2]; A = A[s2]
    # world = P0 + M (uv - uv0), M = [P1 - P0, P2 - P0] inv([e1 e2])
    D1 = Pw[:, 1] - Pw[:, 0]; D2 = Pw[:, 2] - Pw[:, 0]
    inv = np.stack([np.stack([e2[:, 1], -e2[:, 0]], 1), np.stack([-e1[:, 1], e1[:, 0]], 1)], 1) / det[:, None, None]
    # M = [D1 D2] @ inv: dP/du = D1 inv00 + D2 inv10, dP/dv = D1 inv01 + D2 inv11
    dPdu = D1 * inv[:, 0, 0][:, None] + D2 * inv[:, 1, 0][:, None]
    dPdv = D1 * inv[:, 0, 1][:, None] + D2 * inv[:, 1, 1][:, None]
    base = Pw[:, 0] + dPdu * (uc - A[:, 0, 0])[:, None] + dPdv * (vB - A[:, 0, 1])[:, None]
    n = B['nrm'][t].copy(); n[:, 1] = 0.0
    nl = np.linalg.norm(n, axis=1)
    alt = np.cross(dPdu, np.array([0.0, 1.0, 0.0]))   # fall back to the wall direction when the corners carry no normal
    altl = np.linalg.norm(alt, axis=1)
    use = nl < 0.5
    n[use] = alt[use] / np.maximum(altl[use], 1e-9)[:, None]
    n /= np.maximum(np.linalg.norm(n, axis=1), 1e-9)[:, None]
    lu = np.linalg.norm(dPdu, axis=1)
    width = (uR - uL) * lu; height = (vT - vB) * np.linalg.norm(dPdv, axis=1)
    okw = (lu > 0.5) & (lu < 2.0) & (width > 0.1) & (height > 0.1)
    # one unit per opening: two triangles sharing an edge give the same point
    q = np.round(base / 0.05).astype(np.int64)
    _, first = np.unique(q, axis=0, return_index=True)
    mask = np.zeros(len(base), bool); mask[first] = True
    mask &= okw
    st['units'] = int(mask.sum())
    tv = tint[sel][s2]; dv_ = depth[sel][s2]
    out = {'pos': base[mask], 'nrm': n[mask], 'w': width[mask], 'h': height[mask], 'd': dv_[mask], 'tint': tv[mask],
           'tri': t[mask], 'vb': vB[mask]}
    st['by_tint'] = [int((out['tint'] == i).sum()) for i in range(3)]
    return out


# ---- the unit: facadeKit.js's window AC in unit space (x across -0.5..0.5, y up 0..1, z out of the wall 0..1, the back
# 0.3 inside), faces as flat quads; part 0 the body (and brackets), part 1 the grille and the control panel
def _unit_mesh():
    P, F, Nn, part = [], [], [], []
    def box(x0, x1, y0, y1, z0, z1, pt, faces='all'):
        c = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        quads = {'+z': ((4, 5, 6, 7), (0, 0, 1)), '-z': ((1, 0, 3, 2), (0, 0, -1)), '+x': ((5, 1, 2, 6), (1, 0, 0)),
                 '-x': ((0, 4, 7, 3), (-1, 0, 0)), '+y': ((7, 6, 2, 3), (0, 1, 0)), '-y': ((0, 1, 5, 4), (0, -1, 0))}
        for key, (qd, nn) in quads.items():
            if faces != 'all' and key not in faces:
                continue
            b = len(P)
            for i in qd:
                P.append(c[i]); Nn.append(nn)
            F.append((b, b + 1, b + 2, b + 3)); part.append(pt)
    box(-0.5, 0.5, 0.0, 1.0, -0.3, 1.0, 0, faces=('+z', '+x', '-x', '+y', '-y'))          # the body (the back is in the wall)
    for i in range(7):                                                                    # louvres across 72 % of the face
        y = 0.17 + i * 0.10
        box(-0.44, 0.22, y, y + 0.045, 1.0, 1.05, 1, faces=('+z', '+y', '-y', '-x', '+x'))
    box(0.28, 0.44, 0.17, 0.83, 1.0, 1.025, 1, faces=('+z', '+y', '-y', '-x', '+x'))       # the control panel
    for x in (-0.40, 0.36):                                                               # two brackets under it
        box(x, x + 0.04, -0.45, 0.0, 0.0, 0.35, 0, faces=('+z', '+x', '-x', '-y'))
    return np.array(P, np.float32), np.array(F, np.int32), np.array(Nn, np.float32), np.array(part, np.int32)


def _quat_y(n):
    th = np.arctan2(n[:, 0], n[:, 2])
    return np.stack([np.cos(th / 2), np.zeros_like(th), np.sin(th / 2), np.zeros_like(th)], 1)


def _hero_band(IN, shot, B, U, stats):
    """a harvest made before SOLID12 (no heroskip=ac in its page url) carries the hero ring's own AC boxes: on the buildings
    whose centre is within 95 m of the lens path (FP37: the band by the take's nearest approach, heroFacades.js DETAIL_R)
    on the rows below 42 m (fineRow). Those units are left to the hero boxes, so nothing doubles."""
    try:
        url = json.load(open(os.path.join(IN, 'manifest.json'))).get('url') or ''
    except Exception:
        url = ''
    import re
    m = re.search(r'[?&]heroskip=([^&]*)', url)
    if m and 'ac' in m.group(1).split(','):
        stats['hero_band'] = 'harvest without hero AC boxes'
        return U
    try:
        cams = json.load(open(os.path.join(IN, f'cam_{shot}.json')))
        path = np.array([[c['m'][12], c['m'][14]] for c in cams], np.float64)
    except Exception:
        stats['hero_band'] = 'no camera path'
        return U
    tri = B['tri']
    key = (np.round(tri[:, 11]).astype(np.int64) + 1) * 2048 + np.floor(tri[:, 6] * 1024.0 + 0.5).astype(np.int64)
    cxz = B['pos'][:, :, [0, 2]].mean(1)
    uk, inv = np.unique(key, return_inverse=True)
    cen = np.zeros((len(uk), 2)); np.add.at(cen, inv, cxz); cen /= np.bincount(inv, minlength=len(uk))[:, None]
    bc = cen[inv[U['tri']]]
    d = np.full(len(bc), np.inf)
    for i in range(0, len(path), 4):
        d = np.minimum(d, np.hypot(bc[:, 0] - path[i, 0], bc[:, 1] - path[i, 1]))
    drop = (d < 95.0) & (U['vb'] < 42.0)
    stats['hero_band'] = f'old harvest: {int(drop.sum())} units left to the hero ring'
    keep = ~drop
    if not keep.any():
        return None
    return {k: v[keep] for k, v in U.items()}


def setup(ctx):
    STATE['on'] = '--nofacdetail' not in (getattr(ctx, 'argv', None) or [])
    STATE['ctx'] = ctx


def _materials(ctx):
    if STATE.get('mats'):
        return STATE['mats']
    from pxr import UsdShade, Sdf
    looks = ctx.stage_looks
    out = {}
    for ti, tn in enumerate(TINTS):
        for part, (k, rough) in enumerate(((0.90, 0.45), (0.55, 0.60))):
            col = [round(AC_RGB[c] * tn[c] * k, 4) for c in range(3)]
            mp = f'/World/Looks/bxsolid_ac{ti}_{"body" if part == 0 else "grille"}'
            mat = UsdShade.Material.Define(looks, mp)
            sh = UsdShade.Shader.Define(looks, mp + '/pbr'); sh.CreateIdAttr('UsdPreviewSurface')
            sh.CreateInput('diffuseColor', Sdf.ValueTypeNames.Color3f).Set(tuple(col))
            sh.CreateInput('roughness', Sdf.ValueTypeNames.Float).Set(rough)
            sh.CreateInput('metallic', Sdf.ValueTypeNames.Float).Set(0.1)
            mat.CreateSurfaceOutput().ConnectToSource(sh.ConnectableAPI(), 'surface')
            P = {'kind': 'plain', 'color': col, 'rough': rough, 'metal': 0.1, 'vc': 0, 'fktr': 0, 'kit': 0, 'src': 'SOLID12 window AC'}
            mat.GetPrim().SetCustomDataByKey('bx', json.dumps(P, separators=(',', ':')))
            out[(ti, part)] = mp
    STATE['mats'] = out
    return out


def static(ctx, stage):
    if not STATE['on']:
        return
    from pxr import UsdGeom, UsdShade, Sdf, Gf, Vt
    layer = os.path.basename(stage.GetRootLayer().identifier)
    shot = layer[len('static_'):-len('.usdc')] if layer.startswith('static_') else None
    B = load_bxw(ctx.IN, shot)
    stats = ctx.stats.setdefault('facdetail', {}).setdefault(layer, {})
    if B is None:
        stats['skipped'] = 'no facade bake'
        return
    U = ac_units(B, stats)
    if U is None:
        return
    U = _hero_band(ctx.IN, shot, B, U, stats)
    if U is None:
        return
    mats = _materials(ctx)
    V, F, Nn, part = _unit_mesh()
    UsdGeom.Scope.Define(stage, '/World/Facade')
    for ti in range(3):
        s = np.nonzero(U['tint'] == ti)[0]
        if not len(s):
            continue
        ip = f'/World/Facade/ac_t{ti}'
        pi = UsdGeom.PointInstancer.Define(stage, ip)
        m = UsdGeom.Mesh.Define(stage, ip + '/protos/p0')
        m.CreatePointsAttr(Vt.Vec3fArray.FromNumpy(np.ascontiguousarray(V)))
        m.CreateFaceVertexCountsAttr(Vt.IntArray.FromNumpy(np.full(len(F), 4, np.int32)))
        m.CreateFaceVertexIndicesAttr(Vt.IntArray.FromNumpy(np.ascontiguousarray(F.reshape(-1))))
        m.CreateNormalsAttr(Vt.Vec3fArray.FromNumpy(np.ascontiguousarray(Nn)))
        m.SetNormalsInterpolation(UsdGeom.Tokens.vertex)
        m.CreateSubdivisionSchemeAttr(UsdGeom.Tokens.none)
        m.CreateExtentAttr([Gf.Vec3f(*map(float, V.min(0))), Gf.Vec3f(*map(float, V.max(0)))])
        for pt in (0, 1):
            ss = UsdGeom.Subset.Define(stage, ip + f'/protos/p0/s{pt}')
            ss.CreateElementTypeAttr(UsdGeom.Tokens.face); ss.CreateFamilyNameAttr('materialBind')
            ss.CreateIndicesAttr(Vt.IntArray.FromNumpy(np.nonzero(part == pt)[0].astype(np.int32)))
            api = UsdShade.MaterialBindingAPI.Apply(ss.GetPrim())
            api.GetPrim().CreateRelationship('material:binding', False).SetTargets([Sdf.Path(mats[(ti, pt)])])
        UsdShade.MaterialBindingAPI.Apply(m.GetPrim())
        m.GetPrim().CreateRelationship('material:binding', False).SetTargets([Sdf.Path(mats[(ti, 0)])])
        pi.CreatePrototypesRel().SetTargets([m.GetPath()])
        pi.CreateProtoIndicesAttr(Vt.IntArray.FromNumpy(np.zeros(len(s), np.int32)))
        pi.CreatePositionsAttr(Vt.Vec3fArray.FromNumpy(np.ascontiguousarray(U['pos'][s].astype(np.float32))))
        q = _quat_y(U['nrm'][s])
        pi.CreateOrientationsAttr(Vt.QuathArray([Gf.Quath(float(w), float(x), float(y), float(z)) for w, x, y, z in q]))
        sc = np.stack([U['w'][s], U['h'][s], U['d'][s]], 1).astype(np.float32)
        pi.CreateScalesAttr(Vt.Vec3fArray.FromNumpy(np.ascontiguousarray(sc)))
        stats.setdefault('instancers', []).append({'path': ip, 'n': int(len(s))})


# ---- CLI: the units projected onto the web take (the placement check)
def _project(cam, W, H, P):
    M = np.array(cam['m'], np.float64).reshape(4, 4).T          # three's column-major matrixWorld
    Vm = np.linalg.inv(M)
    ph = np.concatenate([P, np.ones((len(P), 1))], 1) @ Vm.T
    z = -ph[:, 2]
    f = 1.0 / math.tan(math.radians(cam['fov']) / 2)
    x = ph[:, 0] / np.maximum(z, 1e-6) * f / cam.get('aspect', W / H)
    y = ph[:, 1] / np.maximum(z, 1e-6) * f
    return np.stack([(x + 1) * 0.5 * W, (1 - y) * 0.5 * H], 1), z


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--harvest', required=True); ap.add_argument('--shot', required=True)
    ap.add_argument('--frames', default='0,54,107'); ap.add_argument('--web', default=None); ap.add_argument('--out', default=None)
    ap.add_argument('--depth', default=None, help="a take's _depth folder (ue_frames.py): units behind the drawn surface left out")
    a = ap.parse_args()
    B = load_bxw(a.harvest, a.shot)
    st = {}
    U = ac_units(B, st) if B is not None else None
    print(json.dumps(st))
    if U is None or not a.web:
        return
    from PIL import Image, ImageDraw
    cams = json.load(open(os.path.join(a.harvest, f'cam_{a.shot}.json')))
    os.makedirs(a.out, exist_ok=True)
    for fr in [int(x) for x in a.frames.split(',')]:
        im = Image.open(os.path.join(a.web, f'frame_{fr:05d}.jpg')).convert('RGB')
        W, H = im.size
        cam = cams[min(fr, len(cams) - 1)]
        n = U['nrm']; xa = np.stack([n[:, 2], np.zeros(len(n)), -n[:, 0]], 1)
        cs = []
        for sx, sy in ((-0.5, 0), (0.5, 0), (0.5, 1), (-0.5, 1)):
            cs.append(U['pos'] + xa * (sx * U['w'])[:, None] + np.array([0, 1.0, 0]) * (sy * U['h'])[:, None] + n * U['d'][:, None])
        dr = ImageDraw.Draw(im)
        vis = 0
        pr = [_project(cam, W, H, c) for c in cs]
        dmap = None
        dp = os.path.join(a.depth, 'depth_%04d.png' % fr) if a.depth else None
        if dp and os.path.exists(dp):
            dv = np.asarray(Image.open(dp), np.float64)
            dmap = np.power(2.0, dv / 65535.0 * 18.0 - 2.0)
            cc, cz = _project(cam, W, H, U['pos'] + np.array([0, 1.0, 0]) * (0.5 * U['h'])[:, None] + n * U['d'][:, None])
        for i in range(len(U['pos'])):
            pts = [tuple(p[0][i]) for p in pr]
            if min(p[1][i] for p in pr) < 1.0:
                continue
            xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
            if max(xs) < 0 or min(xs) > W or max(ys) < 0 or min(ys) > H:
                continue
            if dmap is not None:
                hy, hx = dmap.shape
                px = int(np.clip(cc[i, 0] * hx / W, 0, hx - 1)); py = int(np.clip(cc[i, 1] * hy / H, 0, hy - 1))
                if cz[i] > dmap[py, px] * 1.02 + 0.6:
                    continue
            vis += 1
            dr.polygon(pts, outline=(255, 0, 255))
        im.save(os.path.join(a.out, f'{a.shot}_f{fr:03d}_acproj.jpg'), quality=90)
        print(f'frame {fr}: {vis} units in view')


if __name__ == '__main__':
    main()
