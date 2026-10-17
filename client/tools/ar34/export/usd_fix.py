"""Small-fix override for an exported take: apply a source fix to a take's existing USD without a new harvest or a new
USD write. Today it handles the LIFE street items (lk/lkData.js): the items whose position changed between two versions
of lkData.js are moved in the take's merged lk meshes, piece by piece, and the result goes into a fix layer that the
take's root layers load first. Renderers that read the take (ue_prep / Unreal, Blender) pick it up unchanged.

  uv run --no-project --with usd-core --with numpy --with scipy python usd_fix.py --take <take>/u --shot <shot> \
      [--old <lkData.js at the harvest>] [--new <lkData.js now>]

--old defaults to lkData.js at git HEAD, --new to the working copy. The fix layer is u/fix_<shot>.usdc; u/fix_<shot>.json
records what moved and the hashes of both lkData versions, so a later harvest (which already has the fix) can drop it.
The fix stands in for a source change until the next harvest; it never invents a change the source does not have.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys

import numpy as np
from pxr import Sdf, Usd, UsdGeom, Vt
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
LK = 'src/city/lk/lkData.js'
ROW = re.compile(r'\["(\w+)",(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(\{.*?\})\]')
REACH = 2.0      # a mesh piece belongs to the nearest item whose centre is within this many metres (xz)


def items(text):
    out = {}
    for kind, x, z, yaw, params in ROW.findall(text):
        p = json.loads(params)
        out[p['id']] = (kind, float(x), float(z))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--take', required=True, help="the take's u/ folder")
    ap.add_argument('--shot', required=True)
    ap.add_argument('--old', help='lkData.js the harvest used (default: git HEAD)')
    ap.add_argument('--new', help='lkData.js with the fix (default: the working copy)')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()

    old_txt = open(a.old).read() if a.old else subprocess.run(
        ['git', '-C', REPO, 'show', f'HEAD:client/{LK}'], capture_output=True, text=True, check=True).stdout
    new_txt = open(a.new or os.path.join(REPO, LK)).read()
    old, new = items(old_txt), items(new_txt)
    moved = {i: (new[i][1] - old[i][1], new[i][2] - old[i][2]) for i in old
             if i in new and (abs(new[i][1] - old[i][1]) > 1e-4 or abs(new[i][2] - old[i][2]) > 1e-4)}
    print(f'lkData: {len(old)} items, {len(moved)} moved')
    if not moved:
        return
    ids = list(old)
    cxz = np.array([[old[i][1], old[i][2]] for i in ids])
    dxz = np.array([moved.get(i, (0.0, 0.0)) for i in ids])

    root = os.path.join(a.take, f'{a.shot}.usda')
    static = os.path.join(a.take, f'static_{a.shot}.usdc')
    st = Usd.Stage.Open(root)   # composed: the static layer's meshes reference their geometry in geo.usdc
    wxf = np.array(UsdGeom.Xformable(st.GetPrimAtPath('/World')).ComputeLocalToWorldTransform(Usd.TimeCode.Default()))
    wxf_inv = np.linalg.inv(wxf)
    fix_path = os.path.join(a.take, f'fix_{a.shot}.usdc')
    fix = Sdf.Layer.CreateNew(fix_path) if not os.path.exists(fix_path) else Sdf.Layer.FindOrOpen(fix_path)
    fix.Clear()
    fst = Usd.Stage.Open(fix)
    report = []
    for prim in st.Traverse():
        if prim.GetTypeName() != 'Mesh' or not re.match(r'o\d+_lk_', prim.GetName()):
            continue
        m = UsdGeom.Mesh(prim)
        pts = np.array(m.GetPointsAttr().Get(), dtype=np.float64)
        if pts.size == 0:
            continue
        xf = np.array(UsdGeom.Xformable(prim).ComputeLocalToWorldTransform(Usd.TimeCode.Default())) @ wxf_inv
        if not np.allclose(xf, np.eye(4), atol=1e-6):
            print(f'  skip {prim.GetPath()}: not in world space')
            continue
        counts = np.array(m.GetFaceVertexCountsAttr().Get())
        idx = np.array(m.GetFaceVertexIndicesAttr().Get())
        # weld by position (the export writes unwelded triangles), then connect each face's corners
        _, weld = np.unique(np.round(pts * 1e4).astype(np.int64), axis=0, return_inverse=True)
        weld = weld.ravel()
        starts = np.repeat(np.cumsum(counts) - counts, counts)
        nxt = np.arange(len(idx)) + 1
        last = np.cumsum(counts) - 1
        nxt[last] = starts[last]
        a_ = weld[idx]
        b_ = weld[idx[nxt]]
        n = int(weld.max()) + 1
        g = coo_matrix((np.ones(len(a_)), (a_, b_)), shape=(n, n))
        ncomp, lab = connected_components(g, directed=False)
        comp_of_pt = lab[weld]
        # each piece goes with the nearest item within REACH; only the pieces of moved items move
        sums = np.zeros((ncomp, 2))
        np.add.at(sums, comp_of_pt, pts[:, [0, 2]])
        cnt = np.bincount(comp_of_pt, minlength=ncomp)[:, None]
        cen = sums / np.maximum(cnt, 1)
        d2 = ((cen[:, None, :] - cxz[None, :, :]) ** 2).sum(-1)
        near = d2.argmin(1)
        ok = d2[np.arange(ncomp), near] <= REACH ** 2
        shift = np.where(ok[:, None], dxz[near], 0.0)
        if not np.any(shift):
            continue
        out = pts.copy()
        out[:, 0] += shift[comp_of_pt, 0]
        out[:, 2] += shift[comp_of_pt, 1]
        hit = sorted({ids[k] for k in near[ok & (np.abs(shift).sum(1) > 0)]})
        report.append({'prim': str(prim.GetPath()), 'pieces': int((np.abs(shift).sum(1) > 0).sum()), 'items': hit})
        if not a.dry_run:
            over = fst.OverridePrim(prim.GetPath())
            UsdGeom.Mesh(over).CreatePointsAttr().Set(Vt.Vec3fArray.FromNumpy(out.astype(np.float32)))
            lo, hi = out.min(0), out.max(0)
            UsdGeom.Mesh(over).CreateExtentAttr().Set(Vt.Vec3fArray([tuple(lo), tuple(hi)]))
    for r in report:
        print(f"  {r['prim']}: {r['pieces']} pieces of {', '.join(r['items'])}")
    if a.dry_run or not report:
        print('nothing written' if not report else 'dry run: nothing written')
        return
    fix.Save()
    # the fix layer goes first (strongest) in the take's root and preview roots
    for f in sorted(os.listdir(a.take)):
        if not (f.startswith(a.shot) and f.endswith('.usda')):
            continue
        lay = Sdf.Layer.FindOrOpen(os.path.join(a.take, f))
        subs = list(lay.subLayerPaths)
        name = os.path.basename(fix_path)
        if f'static_{a.shot}.usdc' in subs and name not in subs:
            lay.subLayerPaths.insert(0, name)
            lay.Save()
            print(f'  {f}: fix layer added')
    h = lambda t: hashlib.sha1(t.encode()).hexdigest()[:12]
    json.dump({'shot': a.shot, 'lkData_old': h(old_txt), 'lkData_new': h(new_txt),
               'moved': {i: [round(v, 4) for v in moved[i]] for i in moved}, 'meshes': report},
              open(os.path.join(a.take, f'fix_{a.shot}.json'), 'w'), indent=1)
    print(f'wrote {fix_path}')


if __name__ == '__main__':
    sys.exit(main())
