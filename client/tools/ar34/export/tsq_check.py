# TSQADS (2026-10-08): the Times Square boards of a take, frame by frame, as the web's TA31 shader picks them
# (billboards.js ensureTA): every board quad of the take's USD (the meshes with the aAd primvar) projected through the
# harvest's camera, its cell and wipe at the frame's sim time (the camera's bx:simT), and the web take and a renderer's
# take (Unreal or Cycles) cropped side by side at 1:1 per board, with a match score: the correlation of the two crops'
# luminance over the board's box (the same ad scores high whatever the exposure, a different ad near 0).
#   uv run --no-project --with usd-core --with numpy --with pillow python tsq_check.py --usd <u>/<shot>.usda \
#     --web <web take dir> --ren <renderer take dir> --frames 0,54,107 --out <dir> [--min 2500] [--top 6]
# Writes <out>/tsq_<shot>.json (per frame: each board's box, cell, wipe share, score) and <out>/tsq_<shot>_f<frame>.jpg
# (the boards' crops, web left, renderer right, 1:1).
import argparse, json, math, os
import numpy as np
from PIL import Image, ImageDraw
from pxr import Usd, UsdGeom, UsdShade

ap = argparse.ArgumentParser()
ap.add_argument('--usd', required=True); ap.add_argument('--web', required=True); ap.add_argument('--ren', required=True)
ap.add_argument('--frames', default='0,54,107'); ap.add_argument('--out', required=True)
ap.add_argument('--min', type=float, default=2500.0, help='the smallest board box scored, px^2')
ap.add_argument('--top', type=int, default=6, help='boards per frame on the sheet')
ap.add_argument('--maxcrop', type=int, default=900, help='the largest crop side at 1:1 (a bigger board is cropped about its centre)')
ap.add_argument('--maskout', default=None, help='write the renderer\'s frames of --frames (a-b allowed) with everything but the '
                'board quads blacked out, as <maskout>/<shot>/frame_%%05d.jpg, for tools/ad/temporal_scan.py on the boards alone')
ap.add_argument('--depth', default=None, help='the renderer\'s planar depth (ue_frames.py _depth/depth_%%04d.png; default <ren>/_depth): '
                'a board is scored on its visible pixels only (its own depth within 4 %% of the frame\'s), the occluded ones skipped')
ap.add_argument('--pred', action='store_true', help='the renderer side drawn here: each board quad textured with the cell the '
                'shader picks (perspective-correct, the atlas as exported, no gains): checks the export without a render')
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)

st = Usd.Stage.Open(a.usd)
rl = st.GetRootLayer()
data = dict(rl.customLayerData)
shot = data.get('shot') or os.path.splitext(os.path.basename(a.usd))[0]
og = np.array([float(v) for v in (data.get('origin') or [0, 0, 0])])
cams = json.load(open(os.path.join(data.get('harvest') or '', f'cam_{shot}.json')))
cp = st.GetPrimAtPath(data.get('camera') or '')
sa = cp.GetAttribute('bx:simT') if cp else None
simT = [float(sa.Get(Usd.TimeCode(f))) for f in range(len(cams))] if sa and sa.HasValue() else [c.get('simT') for c in cams]

# the board quads: consecutive triangle pairs with one playlist
xc = UsdGeom.XformCache()
quads = []
for p in st.Traverse():
    if not p.IsA(UsdGeom.Mesh): continue
    pv = UsdGeom.PrimvarsAPI(p)
    q = pv.GetPrimvar('aAd')
    if not q or not q.HasValue(): continue
    ad = np.asarray(q.ComputeFlattened(), np.float64).reshape(-1, 4)
    sq = pv.GetPrimvar('aSize')
    sz = np.asarray(sq.ComputeFlattened(), np.float64).reshape(len(ad), -1)[:, :2] if sq and sq.HasValue() else np.zeros((len(ad), 2))
    m = UsdGeom.Mesh(p)
    P = np.asarray(m.GetPointsAttr().Get(), np.float64)
    M = np.array(xc.GetLocalToWorldTransform(p))
    Pw = (np.c_[P, np.ones(len(P))] @ M)[:, :3] + og
    idx = np.asarray(m.GetFaceVertexIndicesAttr().Get(), np.int64).reshape(-1, 3)
    vert = q.GetInterpolation() == 'vertex'
    sp_ = pv.GetPrimvar('st')
    stv = np.asarray(sp_.ComputeFlattened(), np.float64).reshape(-1, 2) if sp_ and sp_.HasValue() else None
    stfv = sp_ is not None and sp_.GetInterpolation() == 'faceVarying'
    mb = UsdShade.MaterialBindingAPI(p).ComputeBoundMaterial()[0]
    tag = json.loads(mb.GetPrim().GetCustomDataByKey('bx') or '{}') if mb else {}
    t = 0
    while t < len(idx):
        tri = idx[t]
        key = ad[tri[0]] if vert else ad[t * 3]
        pts = list(tri)
        if t + 1 < len(idx) and np.allclose(ad[idx[t + 1][0]] if vert else ad[(t + 1) * 3], key):
            pts += list(idx[t + 1]); t += 2
        else:
            t += 1
        u = sorted(set(pts))
        tris = []
        for tt in ([t - 2, t - 1] if len(pts) == 6 else [t - 1]):
            tv = idx[tt]
            tris.append((Pw[tv], (stv[tt * 3:tt * 3 + 3] if stfv else stv[tv]) if stv is not None else np.zeros((3, 2))))
        quads.append({'prim': p.GetName(), 'ad': [float(v) for v in key], 'size': [float(v) for v in (sz[tri[0]] if vert else sz[0])], 'pts': Pw[u],
                      'tris': tris, 'tag': tag})
print(f'{shot}: {len(quads)} board quads, sim time {simT[0]} .. {simT[-1]}')


def cell(ad, T):
    """the shader's cell, the wipe's share (0 when none) and the next cell at sim time T (billboards.js TA31 / M_bx_board)."""
    base, n, ph, du = ad
    n = round(n)
    if n < 1: return None, 0.0, None
    if du < 0: return int(base + (math.floor(ph + 0.5) % n)), 0.0, None
    tt = (T + ph) / du; k = math.floor(tt); f = tt - k
    tw = min(0.6 / du, 0.25)
    s0, s1 = int(base + k % n), int(base + (k + 1) % n)
    return s0, ((f - (1 - tw)) / tw if (f > 1 - tw and n > 1) else 0.0), s1


def project(c, X):
    Mw = np.array(c['m'], np.float64).reshape(4, 4).T          # three's column-major world matrix
    V = np.linalg.inv(Mw)
    Xc = (np.c_[X, np.ones(len(X))] @ V.T)[:, :3]
    if (Xc[:, 2] > -c['near']).any(): return None
    th = math.tan(math.radians(c['fov']) / 2)
    x = Xc[:, 0] / -Xc[:, 2] / (th * c['aspect']); y = Xc[:, 1] / -Xc[:, 2] / th
    return x, y


def lum(im):
    a_ = np.asarray(im.convert('RGB').resize((64, 32), Image.BILINEAR), np.float64)
    return a_ @ np.array([0.2126, 0.7152, 0.0722])


_ATL = {}


def pred_image(f, Wd, Hd):
    """the boards alone, each quad textured perspective-correct with the cell (and the wipe, the ticker's scroll) the
    shader picks at frame f, from the atlas as exported (sRGB, no gains), on black."""
    img = np.zeros((Hd, Wd, 3), np.float64)
    c = cams[f]; T = simT[f]
    Mw = np.array(c['m'], np.float64).reshape(4, 4).T; V = np.linalg.inv(Mw)
    th = math.tan(math.radians(c['fov']) / 2)
    for Q in quads:
        tg = Q['tag']; rects = tg.get('rects'); tf = (tg.get('tex') or {}).get('map')
        if not rects or not tf: continue
        tf = os.path.normpath(os.path.join(os.path.dirname(a.usd), tf))
        if tf not in _ATL: _ATL[tf] = np.asarray(Image.open(tf).convert('RGB'), np.float64)
        A = _ATL[tf]; AH, AW = A.shape[:2]
        base, n, ph, du = Q['ad']; n = max(1, round(n))
        for P3, UV in Q['tris']:
            Xc = (np.c_[P3, np.ones(3)] @ V.T)[:, :3]
            if (Xc[:, 2] > -c['near']).any(): continue
            w = -Xc[:, 2]
            sx = (Xc[:, 0] / w / (th * c['aspect']) + 1) / 2 * Wd; sy = (1 - Xc[:, 1] / w / th) / 2 * Hd
            x0, x1 = max(0, int(sx.min())), min(Wd - 1, int(math.ceil(sx.max()))); y0, y1 = max(0, int(sy.min())), min(Hd - 1, int(math.ceil(sy.max())))
            if x1 < x0 or y1 < y0: continue
            gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            d = (sy[1] - sy[2]) * (sx[0] - sx[2]) + (sx[2] - sx[1]) * (sy[0] - sy[2])
            if abs(d) < 1e-9: continue
            l0 = ((sy[1] - sy[2]) * (gx - sx[2]) + (sx[2] - sx[1]) * (gy - sy[2])) / d
            l1 = ((sy[2] - sy[0]) * (gx - sx[2]) + (sx[0] - sx[2]) * (gy - sy[2])) / d
            l2 = 1 - l0 - l1
            ins = (l0 >= 0) & (l1 >= 0) & (l2 >= 0)
            if not ins.any(): continue
            q0, q1, q2 = l0 / w[0], l1 / w[1], l2 / w[2]; qs = q0 + q1 + q2
            u = (q0 * UV[0, 0] + q1 * UV[1, 0] + q2 * UV[2, 0]) / qs; v = (q0 * UV[0, 1] + q1 * UV[1, 1] + q2 * UV[2, 1]) / qs
            def tap(slot, lu, lv):
                r = rects[int(min(max(slot, 0), len(rects) - 1))]
                px = np.clip(((r[0] + lu * r[2]) * AW).astype(np.int64), 0, AW - 1); py = np.clip(((1 - (r[1] + lv * r[3])) * AH).astype(np.int64), 0, AH - 1)
                return A[py, px]
            if du < 0:
                slot = base + (math.floor(ph + 0.5) % n)
                s_ = np.mod(u + T * -du, 1.0) * 2.0; row = np.floor(s_)
                col = tap(slot, np.mod(s_, 1.0), (1 - row) * 0.5 + v * 0.5)
            else:
                tt = (T + ph) / du; k = math.floor(tt); fr = tt - k; tw = min(0.6 / du, 0.25)
                col = tap(base + k % n, u, v)
                if fr > 1 - tw and n > 1:
                    pp = (fr - (1 - tw)) / tw
                    e = np.clip((u - (pp - 0.015)) / 0.03, 0, 1); e = e * e * (3 - 2 * e)
                    col = tap(base + (k + 1) % n, u, v) * (1 - e)[..., None] + col * e[..., None]
            sub = img[y0:y1 + 1, x0:x1 + 1]
            sub[ins] = col[ins]
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), 'RGB')


def visible(Q, f, box, D):
    """the board quad's pixels in box (x0, y0, x1, y1) that the frame shows: its planar depth (perspective-correct over its
    triangles) within 4 % of the frame's depth D (metres); None where no depth."""
    x0, y0, x1, y1 = box
    c = cams[f]; Mw = np.array(c['m'], np.float64).reshape(4, 4).T; V = np.linalg.inv(Mw)
    th = math.tan(math.radians(c['fov']) / 2); Hd, Wd = D.shape
    gx, gy = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
    on = np.zeros(gx.shape, bool); dq = np.full(gx.shape, np.inf)
    for P3, _uv in Q['tris']:
        Xc = (np.c_[P3, np.ones(3)] @ V.T)[:, :3]
        if (Xc[:, 2] > -c['near']).any(): continue
        w = -Xc[:, 2]
        sx = (Xc[:, 0] / w / (th * c['aspect']) + 1) / 2 * Wd; sy = (1 - Xc[:, 1] / w / th) / 2 * Hd
        d = (sy[1] - sy[2]) * (sx[0] - sx[2]) + (sx[2] - sx[1]) * (sy[0] - sy[2])
        if abs(d) < 1e-9: continue
        l0 = ((sy[1] - sy[2]) * (gx - sx[2]) + (sx[2] - sx[1]) * (gy - sy[2])) / d
        l1 = ((sy[2] - sy[0]) * (gx - sx[2]) + (sx[0] - sx[2]) * (gy - sy[2])) / d
        l2 = 1 - l0 - l1
        ins = (l0 >= 0) & (l1 >= 0) & (l2 >= 0)
        z = 1.0 / np.maximum(l0 / w[0] + l1 / w[1] + l2 / w[2], 1e-9)
        dq = np.where(ins, np.minimum(dq, z), dq); on |= ins
    dr_ = D[y0:y1, x0:x1]
    return on & (np.abs(dq - dr_) <= 0.04 * dr_)


out = {'shot': shot, 'frames': {}}
FR = []
for part in a.frames.split(','):
    if '-' in part: lo_, hi_ = part.split('-'); FR += list(range(int(lo_), int(hi_) + 1))
    elif part: FR.append(int(part))
if a.maskout:   # the boards alone: each quad's polygon through the harvest camera, the rest black
    md = os.path.join(a.maskout, shot); os.makedirs(md, exist_ok=True)
    for f in FR:
        R_ = Image.open(os.path.join(a.ren, f'frame_{f:05d}.jpg')).convert('RGB'); Wd, Hd = R_.size
        m = Image.new('L', (Wd, Hd), 0); dr = ImageDraw.Draw(m)
        for Q in quads:
            for P3, _uv in Q['tris']:
                pr = project(cams[f], P3)
                if pr is None: continue
                x, y = pr
                dr.polygon([((x[k] + 1) / 2 * Wd, (1 - y[k]) / 2 * Hd) for k in range(3)], fill=255)
        Image.composite(R_, Image.new('RGB', (Wd, Hd)), m).save(os.path.join(md, f'frame_{f:05d}.jpg'), quality=95)
    print(f'masked {len(FR)} frames into {md}')
    raise SystemExit(0)
for f in FR:
    wf, rf = os.path.join(a.web, f'frame_{f:05d}.jpg'), os.path.join(a.ren, f'frame_{f:05d}.jpg')
    if not (os.path.exists(wf) and (a.pred or os.path.exists(rf))):
        print(f'f{f}: missing {wf if not os.path.exists(wf) else rf}'); continue
    W_ = Image.open(wf).convert('RGB')
    R_ = pred_image(f, *W_.size) if a.pred else Image.open(rf).convert('RGB')
    if R_.size != W_.size: R_ = R_.resize(W_.size, Image.LANCZOS)
    Wd, Hd = W_.size
    dd = a.depth or os.path.join(a.ren, '_depth')
    dp = os.path.join(dd, f'depth_{f:04d}.png')
    D = None
    if not a.pred and os.path.exists(dp):
        Dm = Image.open(dp)
        if Dm.size != (Wd, Hd): Dm = Dm.resize((Wd, Hd), Image.NEAREST)
        D = 2.0 ** (np.asarray(Dm, np.float64) / 65535.0 * 18.0 - 2.0)
    Wl = np.asarray(W_, np.float64) @ np.array([0.2126, 0.7152, 0.0722]); Rl = np.asarray(R_, np.float64) @ np.array([0.2126, 0.7152, 0.0722])
    rows = []
    for i, Q in enumerate(quads):
        pr = project(cams[f], Q['pts'])
        if pr is None: continue
        x, y = pr
        px, py = (x + 1) / 2 * Wd, (1 - y) / 2 * Hd
        x0, x1, y0, y1 = max(0, px.min()), min(Wd, px.max()), max(0, py.min()), min(Hd, py.max())
        if x1 - x0 < 4 or y1 - y0 < 4: continue
        area = (x1 - x0) * (y1 - y0)
        s0, wipe, s1 = cell(Q['ad'], simT[f])
        r = {'q': i, 'prim': Q['prim'], 'box': [int(x0), int(y0), int(math.ceil(x1)), int(math.ceil(y1))], 'area': int(area), 'cell': s0,
             'next': s1 if wipe > 0 else None, 'wipe': round(wipe, 3), 'ticker': Q['ad'][3] < 0, 'led': Q['size'][0] > 0}
        if area >= a.min and D is not None:
            x0_, y0_, x1_, y1_ = r['box']
            vm = visible(Q, f, (x0_, y0_, x1_, y1_), D)
            r['vis'] = round(float(vm.mean()), 3)
            if vm.sum() >= 400 and r['vis'] >= 0.3:
                lw, lr = Wl[y0_:y1_, x0_:x1_][vm], Rl[y0_:y1_, x0_:x1_][vm]
                lw, lr = lw - lw.mean(), lr - lr.mean()
                d = math.sqrt((lw * lw).sum() * (lr * lr).sum())
                r['score'] = round(float((lw * lr).sum() / d), 3) if d > 1e-6 else None
        elif area >= a.min:
            b = tuple(r['box'])
            lw, lr = lum(W_.crop(b)), lum(R_.crop(b))
            lw, lr = lw - lw.mean(), lr - lr.mean()
            d = math.sqrt((lw * lw).sum() * (lr * lr).sum())
            r['score'] = round(float((lw * lr).sum() / d), 3) if d > 1e-6 else None
        rows.append(r)
    rows.sort(key=lambda r: -r['area'])
    out['frames'][f] = {'simT': simT[f], 'boards': rows}
    sc = [r['score'] for r in rows if r.get('score') is not None]
    print(f'f{f}: sim time {simT[f]:.4f}, {len(rows)} boards in view, {len(sc)} scored, min {min(sc) if sc else None}, '
          f'mean {round(sum(sc) / len(sc), 3) if sc else None}; mid-wipe {sum(1 for r in rows if r["wipe"] > 0)}')
    # the sheet: the largest boards, each web | renderer at 1:1 (cropped about the board's centre past maxcrop)
    pairs = []
    for r in [r for r in rows if r.get('score') is not None][:a.top]:
        x0, y0, x1, y1 = r['box']
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        w2, h2 = min(a.maxcrop, x1 - x0 + 40) // 2, min(a.maxcrop, y1 - y0 + 40) // 2
        b = (max(0, cx - w2), max(0, cy - h2), min(Wd, cx + w2), min(Hd, cy + h2))
        pairs.append((r, W_.crop(b), R_.crop(b)))
    if pairs:
        Wt = max(p[1].size[0] for p in pairs) * 2 + 30
        Ht = sum(p[1].size[1] + 28 for p in pairs) + 10
        sheet = Image.new('RGB', (Wt, Ht), (16, 16, 16)); dr = ImageDraw.Draw(sheet)
        yy = 5
        for r, cw, cr in pairs:
            dr.text((8, yy), f"{shot} f{f} board {r['q']} cell {r['cell']}{' -> ' + str(r['next']) + ' wipe ' + str(r['wipe']) if r['next'] is not None else ''}"
                    f"{' ticker' if r['ticker'] else ''}  score {r['score']}   web | renderer, 1:1", fill=(230, 230, 230))
            yy += 20
            sheet.paste(cw, (8, yy)); sheet.paste(cr, (8 + cw.size[0] + 14, yy))
            yy += cw.size[1] + 8
        sheet.save(os.path.join(a.out, f'tsq_{shot}_f{f:03d}.jpg'), quality=92)
json.dump(out, open(os.path.join(a.out, f'tsq_{shot}.json'), 'w'), indent=1)
