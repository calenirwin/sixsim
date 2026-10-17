#!/usr/bin/env python3
# R1C (lane C, 2026-10-11): the cross-renderer gate. The same take's frame from three.js and from Unreal (one camera path,
# one frame index: the two line up to a pixel) compared on STRUCTURE, not colour: the gradients of the log luminance (a
# change of exposure or of colour grading scales the luminance and leaves them alone), per 64 px tile at full resolution,
#   energy  the tile's gradient energy in each render: a sign drawn twice or a whole atlas page in place of its slot adds
#           strokes the other has not (|log2| of the ratio)
#   shape   the orientation histogram of its gradients (8 bins, magnitude-weighted): letters against a plain face,
#           two facades fighting against one (1 - cosine)
# disagreement = energy + shape, over the tiles with edges in either render (the luminance 3x3-smoothed first: the dither
# and the denoiser's grain of a night sky are not structure). A tile disagrees above --tile in at least two of three
# consecutive frames; neighbouring disagreeing tiles make a region. Trees, shadows and the far city differ between the
# renderers by design, so the verdict reads the SIGNS: with --world and --cam, the world's sign faces, street-name blades
# and shop sign bands are projected through the take's camera and kept where Unreal's depth sees them; on each sign tile
# (a quarter of its pixels on a sign) the two renders' gradient magnitudes are correlated over shifts of up to 4 px (the same
# letters in the same places correlate whatever their colour); a sign region under --ncc (0.4) in two of three consecutive
# frames that spans two tiles or more, or one under --ncc-fail (0.25), fails the take. Every region, sign or not, is
# reported with its frames and a 1:1 crop (three.js left, Unreal right, three consecutive frames down).
#   python3 tools/ue/r1c_xgate.py --three <three.js clip dir> --ue <Unreal clip dir> --out <dir> [--world <world dir>
#       --cam <cam json>] [--frames a-b] [--step 1]
# Exit 0 pass, 3 fail, 2 no frame pairs.
import argparse, glob, json, math, os, re, struct, sys, time
import numpy as np
from PIL import Image, ImageDraw

TILE = 64


def lum(path):
    a = np.asarray(Image.open(path).convert('RGB'), np.float32) / 255.0
    a = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def feats(L):
    """per tile: gradient energy and an 8-bin orientation histogram of the log luminance's gradients"""
    Lp = np.pad(L, 1, mode='edge')
    L = sum(Lp[i:i + L.shape[0], j:j + L.shape[1]] for i in range(3) for j in range(3)) / 9.0
    g = np.log(L + 0.03)
    gx = np.zeros_like(g); gy = np.zeros_like(g)
    gx[:, 1:-1] = (g[:, 2:] - g[:, :-2]) * 0.5; gy[1:-1] = (g[2:] - g[:-2]) * 0.5
    m = np.hypot(gx, gy)
    m = np.where(m > 0.05, m, 0.0)                     # (below: noise, banding, the dither of a dark sky)
    ang = (np.arctan2(gy, gx) % np.pi) / np.pi * 8.0   # (an edge and its reverse are one orientation)
    b = np.minimum(ang.astype(np.int64), 7)
    H, W = L.shape; th, tw = H // TILE, W // TILE
    m = m[:th * TILE, :tw * TILE]; b = b[:th * TILE, :tw * TILE]
    hist = np.zeros((th, tw, 8), np.float64)
    mt = m.reshape(th, TILE, tw, TILE).transpose(0, 2, 1, 3).reshape(th, tw, -1)
    bt = b.reshape(th, TILE, tw, TILE).transpose(0, 2, 1, 3).reshape(th, tw, -1)
    for k in range(8): hist[..., k] = (mt * (bt == k)).sum(-1)
    e = mt.sum(-1) / (TILE * TILE)
    return e, hist


def disagree(A, B):
    (ea, ha), (eb, hb) = A, B
    floor = 0.02
    act = np.maximum(ea, eb) > floor
    en = np.abs(np.log2((eb + floor) / (ea + floor)))
    cs = (ha * hb).sum(-1) / (np.linalg.norm(ha, axis=-1) * np.linalg.norm(hb, axis=-1) + 1e-9)
    sh = 1.0 - cs
    d = en + sh
    return np.where(act, d, 0.0), en, sh


SIGN_MATS = ('ar33sign:mask', 'ar33sign:face', 'signs', 'signText')


def sign_tris(world):
    """the world's sign faces (the sign kit's faces, the dresser's shop sign bands, the street-name blades), world metres"""
    out = []
    for fp in sorted(glob.glob(os.path.join(world, 'cells_uv', '*.glb'))):
        f = open(fp, 'rb').read(); L = struct.unpack('<I', f[12:16])[0]; J = json.loads(f[20:20 + L]); o = 20 + L
        B = f[o + 8:o + 8 + struct.unpack('<I', f[o:o + 4])[0]]
        root = J['nodes'][J['scenes'][0]['nodes'][0]] if J.get('scenes') and J['scenes'][0].get('nodes') else {}
        org = np.asarray(root.get('translation') or [0, 0, 0], np.float64)
        for n in J['nodes']:
            if 'mesh' not in n: continue
            for p in J['meshes'][n['mesh']]['primitives']:
                m = J['materials'][p['material']] if 'material' in p else {}
                t = (m.get('extras') or {}).get('three') or {}
                nm = t.get('name') or ''
                tx = (t.get('textures') or {}).get('map') or {}
                if not (nm.startswith(SIGN_MATS) or (tx.get('name') or '').startswith('signText') or t.get('cellTexture')) or 'indices' not in p: continue
                P = _acc(J, B, p['attributes']['POSITION']).astype(np.float64) + org
                I = _acc(J, B, p['indices']).reshape(-1, 3).astype(np.int64)
                out.append(P[I])
    return np.concatenate(out) if out else np.zeros((0, 3, 3))


def _acc(J, B, i):
    CT = {5126: ('f4', 4), 5123: ('u2', 2), 5121: ('u1', 1), 5125: ('u4', 4)}; NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
    a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]
    dt, sz = CT[a['componentType']]; n = NC[a['type']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); st = bv.get('byteStride') or sz * n
    raw = np.frombuffer(B, np.uint8, st * (a['count'] - 1) + sz * n, off)
    return np.lib.stride_tricks.as_strided(raw, (a['count'], sz * n), (st, 1)).copy().view('<' + dt).reshape(a['count'], n)


def sign_mask(tris, cam, depth_png, W, H):
    """the pixels of the frame on a sign that Unreal's depth sees (planar depth within 3 % or 0.3 m of the sign's)"""
    M = np.asarray(cam['m'], np.float64).reshape(4, 4).T
    Vw = np.linalg.inv(M)
    th = math.tan(math.radians(cam['fov']) / 2) / (cam.get('zoom') or 1); asp = cam.get('aspect') or W / H
    P = tris.reshape(-1, 3) @ Vw[:3, :3].T + Vw[:3, 3]
    z = -P[:, 2]
    ok = (z > 0.5).reshape(-1, 3).all(1)
    x = (P[:, 0] / np.maximum(z, 1e-6) / (th * asp) + 1) * 0.5 * W; y = (1 - P[:, 1] / np.maximum(z, 1e-6) / th) * 0.5 * H
    X = x.reshape(-1, 3)[ok]; Y = y.reshape(-1, 3)[ok]; Z = z.reshape(-1, 3)[ok]
    dep = None
    if depth_png and os.path.exists(depth_png):
        v = np.asarray(Image.open(depth_png), np.float64)
        dep = 2.0 ** (v / 65535.0 * 18.0 - 2.0)
    mask = np.zeros((H, W), bool)
    for xs, ys, zs in zip(X, Y, Z):
        x0, x1 = max(int(xs.min()), 0), min(int(xs.max()) + 1, W); y0, y1 = max(int(ys.min()), 0), min(int(ys.max()) + 1, H)
        if x1 <= x0 or y1 <= y0 or (x1 - x0) * (y1 - y0) > W * H // 2: continue
        gy, gx = np.mgrid[y0:y1, x0:x1] + 0.5
        d = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0])
        if abs(d) < 1e-9: continue
        l1 = ((xs[1] - gx) * (ys[2] - gy) - (xs[2] - gx) * (ys[1] - gy)) / d
        l2 = ((xs[2] - gx) * (ys[0] - gy) - (xs[0] - gx) * (ys[2] - gy)) / d
        l3 = 1 - l1 - l2
        ins = (l1 >= 0) & (l2 >= 0) & (l3 >= 0)
        if not ins.any(): continue
        if dep is not None:
            zz = 1.0 / (l1 / zs[0] + l2 / zs[1] + l3 / zs[2])   # (perspective-correct planar depth)
            dd = dep[y0:y1, x0:x1]
            ins &= np.abs(dd - zz) < np.maximum(0.3, 0.03 * zz)
        mask[y0:y1, x0:x1] |= ins
    return mask


def gmag(L):
    Lp = np.pad(L, 1, mode='edge')
    L = sum(Lp[i:i + L.shape[0], j:j + L.shape[1]] for i in range(3) for j in range(3)) / 9.0
    g = np.log(L + 0.03); gx = np.zeros_like(g); gy = np.zeros_like(g)
    gx[:, 1:-1] = (g[:, 2:] - g[:, :-2]) * 0.5; gy[1:-1] = (g[2:] - g[:-2]) * 0.5
    return np.hypot(gx, gy)


def sign_ncc(Gt, Gu, share, min_share, R=4):
    """per sign tile: the best normalised correlation of the two renders' gradient magnitudes over shifts of +-R px (the
    same letters in the same places correlate whatever their colour; another page's letters or a second copy do not)"""
    th, tw = share.shape; H, W = Gt.shape
    out = np.full((th, tw), np.nan)
    for ty in range(th):
        for tx in range(tw):
            if share[ty, tx] < min_share: continue
            a = Gt[ty * TILE:(ty + 1) * TILE, tx * TILE:(tx + 1) * TILE]
            b0 = Gu[ty * TILE:(ty + 1) * TILE, tx * TILE:(tx + 1) * TILE]
            if a.std() < 0.01 and b0.std() < 0.01: continue   # (a plain face in both)
            aa = a - a.mean(); na = np.sqrt((aa * aa).sum())
            best = -1.0
            for dy in range(-R, R + 1):
                for dx in range(-R, R + 1):
                    y0, x0 = ty * TILE + dy, tx * TILE + dx
                    if y0 < 0 or x0 < 0 or y0 + TILE > H or x0 + TILE > W: continue
                    bb = Gu[y0:y0 + TILE, x0:x0 + TILE]; bb = bb - bb.mean()
                    best = max(best, float((aa * bb).sum() / (na * np.sqrt((bb * bb).sum()) + 1e-9)))
            out[ty, tx] = best
    return out


def regions(mask):
    """8-connected components of a boolean tile grid"""
    H, W = mask.shape; lab = -np.ones((H, W), np.int64); out = []
    for y in range(H):
        for x in range(W):
            if not mask[y, x] or lab[y, x] >= 0: continue
            st = [(y, x)]; lab[y, x] = len(out); cells = []
            while st:
                cy, cx = st.pop(); cells.append((cy, cx))
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < H and 0 <= nx < W and mask[ny, nx] and lab[ny, nx] < 0:
                            lab[ny, nx] = len(out); st.append((ny, nx))
            out.append(cells)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--three', required=True); ap.add_argument('--ue', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--frames', default=None); ap.add_argument('--step', type=int, default=1)
    ap.add_argument('--tile', type=float, default=1.2); ap.add_argument('--fail', type=float, default=1.2); ap.add_argument('--min-tiles', type=int, default=1)
    ap.add_argument('--world', default=None); ap.add_argument('--cam', default=None); ap.add_argument('--sign-share', type=float, default=0.25)
    ap.add_argument('--ncc', type=float, default=0.4); ap.add_argument('--ncc-fail', type=float, default=0.25)
    ap.add_argument('--crops', type=int, default=12)
    a = ap.parse_args()
    t0 = time.time()
    num = lambda p: int(re.findall(r'(\d+)', os.path.basename(p))[-1])
    tf = {num(p): p for p in glob.glob(os.path.join(a.three, 'frame_*.jpg'))}
    uf = {num(p): p for p in glob.glob(os.path.join(a.ue, 'frame_*.jpg'))}
    idx = sorted(set(tf) & set(uf))
    if a.frames:
        lo, hi = (int(x) for x in a.frames.split('-')); idx = [i for i in idx if lo <= i <= hi]
    idx = idx[::a.step]
    if len(idx) < 3: print('fewer than three frame pairs'); sys.exit(2)
    D = {}
    for i in idx:
        d, en, sh = disagree(feats(lum(tf[i])), feats(lum(uf[i])))
        D[i] = d
    th, tw = D[idx[0]].shape
    # the signs Unreal shows, per frame (a share of each tile)
    SG = {}
    if a.world and a.cam:
        tris = sign_tris(a.world); cams = json.load(open(a.cam))
        H_, W_ = lum(uf[idx[0]]).shape
        for i in idx:
            if i >= len(cams): continue
            m_ = sign_mask(tris, cams[i], os.path.join(a.ue, '_depth', 'depth_%04d.png' % i), W_, H_)
            SG[i] = m_[:th * TILE, :tw * TILE].reshape(th, TILE, tw, TILE).mean((1, 3))
    NC = {i: sign_ncc(gmag(lum(tf[i])), gmag(lum(uf[i])), SG[i], a.sign_share) for i in idx if i in SG}
    # a tile disagrees in at least two of three consecutive frames (a passing car or a walker's step is not a defect)
    regs = []
    for j in range(1, len(idx) - 1):
        trio = [idx[j - 1], idx[j], idx[j + 1]]
        hits = sum((D[k] > a.tile).astype(np.int64) for k in trio)
        mask = hits >= 2
        mean = np.mean([D[k] for k in trio], axis=0)
        for cells in regions(mask):
            ys = [c[0] for c in cells]; xs = [c[1] for c in cells]
            score = float(np.mean([mean[c] for c in cells]))
            sg = float(np.mean([max(SG[k][c] for k in trio if k in SG) if any(k in SG for k in trio) else 0.0 for c in cells]))
            regs.append({'frames': trio, 'tiles': len(cells), 'score': round(score, 3), 'sign': round(sg, 2),
                         'box': [min(xs) * TILE, min(ys) * TILE, (max(xs) + 1) * TILE, (max(ys) + 1) * TILE]})
    # the signs: a sign tile whose letters do not correlate (under --ncc) in two of three consecutive frames
    sregs = []
    for j in range(1, len(idx) - 1):
        trio = [idx[j - 1], idx[j], idx[j + 1]]
        if not all(k in NC for k in trio): continue
        low = sum(np.nan_to_num(NC[k] < a.ncc, nan=0).astype(np.int64) for k in trio)
        for cells in regions(low >= 2):
            ys = [c[0] for c in cells]; xs = [c[1] for c in cells]
            v = float(np.nanmean([np.nanmean([NC[k][c] for k in trio]) for c in cells]))
            sregs.append({'frames': trio, 'tiles': len(cells), 'ncc': round(v, 3), 'sign': 1.0, 'score': round(1.0 - v, 3),
                          'box': [min(xs) * TILE, min(ys) * TILE, (max(xs) + 1) * TILE, (max(ys) + 1) * TILE]})
    sregs.sort(key=lambda r: r['ncc'])
    skept = []
    for r in sregs:
        bx = r['box']
        if any(abs(k['frames'][1] - r['frames'][1]) <= 6 and not (bx[2] <= k['box'][0] or bx[0] >= k['box'][2] or bx[3] <= k['box'][1] or bx[1] >= k['box'][3]) for k in skept): continue
        skept.append(r)
    # one region per place: the same box over consecutive trios kept once (its best trio)
    regs.sort(key=lambda r: (-r['score'] * min(r['tiles'], 6)))
    kept = []
    for r in regs:
        bx = r['box']
        if any(abs(k['frames'][1] - r['frames'][1]) <= 6 and not (bx[2] <= k['box'][0] or bx[0] >= k['box'][2] or bx[3] <= k['box'][1] or bx[1] >= k['box'][3]) for k in kept): continue
        kept.append(r)
    # the verdict: the signs when the world is given (their letters must match), else every region over --fail
    # (a sign region fails when it spans two tiles or more, or its letters correlate under --ncc-fail: one tile at a sign's
    # edge under a tree or at a grazing angle correlates 0.29-0.39 when the sign is right; a wrong page or a second copy
    # spans its whole face at 0.00-0.08)
    bad = [r for r in skept if r['tiles'] >= 2 or r['ncc'] < a.ncc_fail] if SG else [r for r in kept if r['tiles'] >= a.min_tiles and r['score'] > a.fail]
    os.makedirs(a.out, exist_ok=True)
    # the crops: three.js | Unreal, the region's three frames down, 1:1 (a region larger than 768 x 512 px is cut to its centre)
    order = bad + [k for k in kept if k not in bad]
    for n, r in enumerate(order[:a.crops]):
        x0, y0, x1, y1 = r['box']
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        w, h = min(max(x1 - x0 + 64, 256), 768), min(max(y1 - y0 + 64, 192), 512)
        bx = (max(0, cx - w // 2), max(0, cy - h // 2)); bx = (bx[0], bx[1], bx[0] + w, bx[1] + h)
        sheet = Image.new('RGB', (w * 2 + 8, h * 3 + 16), (255, 255, 255))
        for k, fi in enumerate(r['frames']):
            for c, src in enumerate((tf[fi], uf[fi])):
                im = Image.open(src).convert('RGB').crop(bx)
                dr = ImageDraw.Draw(im); dr.rectangle([x0 - bx[0], y0 - bx[1], x1 - bx[0] - 1, y1 - bx[1] - 1], outline=(255, 0, 255) if r in bad else (255, 200, 0))
                sheet.paste(im, (c * (w + 8), k * (h + 8)))
        r['crop'] = os.path.join(a.out, f'region_{n:02d}_f{r["frames"][1]:04d}_x{x0}_y{y0}.jpg')
        sheet.save(r['crop'], quality=92)
    R = {'pairs': len(idx), 'frames': [idx[0], idx[-1]], 'tiles': [tw, th], 'regions': len(kept), 'failing': len(bad), 'pass': not bad,
         'signs': bool(SG), 'sign_tiles': int(sum(int((~np.isnan(v)).sum()) for v in NC.values())),
         'sign_ncc_median': round(float(np.nanmedian(np.concatenate([v[~np.isnan(v)] for v in NC.values()]))), 3) if NC and any((~np.isnan(v)).any() for v in NC.values()) else None,
         'sign_regions_failing': skept[:20],
         'thresholds': {'tile': a.tile, 'fail': a.fail, 'min_tiles': a.min_tiles},
         'mean_disagreement': round(float(np.mean([D[i][D[i] > 0].mean() if (D[i] > 0).any() else 0 for i in idx])), 3),
         'worst': kept[:20], 'secs': round(time.time() - t0, 1)}
    json.dump(R, open(os.path.join(a.out, 'xgate.json'), 'w'), indent=1)
    print(json.dumps({k: R[k] for k in ('pairs', 'frames', 'regions', 'signs', 'sign_tiles', 'sign_ncc_median', 'failing', 'pass', 'mean_disagreement', 'secs')}))
    for r in (bad + [k for k in kept if k not in bad])[:12]:
        print(f"  {'FAIL' if r in bad else '    '} score {r['score']:.2f} {('ncc %.2f' % r['ncc']) if 'ncc' in r else ''} tiles {r['tiles']:3d} frames {r['frames']} box {r['box']} {os.path.basename(r.get('crop') or '')}")
    sys.exit(0 if not bad else 3)


if __name__ == '__main__':
    main()
