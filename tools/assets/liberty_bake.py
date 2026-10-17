#!/usr/bin/env python3
# The Statue of Liberty's statue, from a photogrammetry scan of a 19th-century bronze model of it ("Statue Of Liberty Bronze
# Model" by jerryfisher, https://sketchfab.com/3d-models/statue-of-liberty-bronze-model-5b9aa58d51624f01b9009b52379bf18a,
# CC BY 4.0; the copy from Objaverse, allenai/objaverse glbs/000-057/5b9aa58d51624f01b9009b52379bf18a.glb), fitted to the
# Historic American Engineering Record's measurements (HAER NY-138: the statue's base 43.49 m and the flame's top 88.42 m
# over the fort's entrance, her front and side elevations) and given her copper's verdigris, baked per vertex from the
# form: the hollows of the folds darker, the faces turned to the rain washed pale, the sheltered ones deeper blue-green,
# streaks run down under the edges. Writes the fitted, coloured mesh for tools/assets/liberty_statue.mjs (levels of
# detail, GLB).
#   uv run --no-project --with trimesh --with embreex --with numpy --with scipy python tools/assets/liberty_bake.py \
#     <scan.glb> <out dir>
import sys, os, json, struct, math, time
import numpy as np
import trimesh

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
t0 = time.time()

def read_glb(path):
    b = open(path, 'rb').read()
    _, _, L = struct.unpack('<III', b[:12]); off = 12; js = None; binc = None
    while off < L:
        cl, ct = struct.unpack('<II', b[off:off + 8]); chunk = b[off + 8:off + 8 + cl]; off += 8 + cl
        if ct == 0x4E4F534A: js = json.loads(chunk)
        elif ct == 0x004E4942: binc = chunk
    def acc(i):
        a = js['accessors'][i]; bv = js['bufferViews'][a['bufferView']]
        dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a['componentType']]
        n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        start = bv.get('byteOffset', 0) + a.get('byteOffset', 0); stride = bv.get('byteStride', 0)
        if stride and stride != n * np.dtype(dt).itemsize:
            raw = np.frombuffer(binc, dtype=np.uint8, count=stride * a['count'], offset=start).reshape(a['count'], stride)
            return np.frombuffer(raw[:, :n * np.dtype(dt).itemsize].tobytes(), dtype=dt).reshape(a['count'], n)
        return np.frombuffer(binc, dtype=dt, count=a['count'] * n, offset=start).reshape(a['count'], n)
    def mat(n):
        if 'matrix' in n: return np.array(n['matrix'], dtype=np.float64).reshape(4, 4).T
        T = np.eye(4); t = n.get('translation', [0, 0, 0]); r = n.get('rotation', [0, 0, 0, 1]); s = n.get('scale', [1, 1, 1])
        x, y, z, w = r
        R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        T[:3, :3] = R * np.array(s); T[:3, 3] = t; return T
    V, F = [], []; nv = 0
    def walk(i, M):
        nonlocal nv
        n = js['nodes'][i]; W = M @ mat(n)
        if 'mesh' in n:
            for p in js['meshes'][n['mesh']]['primitives']:
                P = acc(p['attributes']['POSITION']).astype(np.float64)
                P = (W[:3, :3] @ P.T).T + W[:3, 3]
                I = acc(p['indices']).reshape(-1, 3).astype(np.int64) if 'indices' in p else np.arange(len(P)).reshape(-1, 3)
                V.append(P); F.append(I + nv); nv += len(P)
        for c in n.get('children', []): walk(c, W)
    for s in js['scenes'][js.get('scene', 0)]['nodes']: walk(s, np.eye(4))
    return np.concatenate(V), np.concatenate(F)

V, F = read_glb(SRC)
mesh = trimesh.Trimesh(V, F, process=True)
mesh.merge_vertices()
print(f'scan: {len(mesh.vertices)} vertices, {len(mesh.faces)} triangles ({time.time() - t0:.1f} s)', flush=True)
# ---- the scan's frame is hers (+x her left, +y up, +z her front); its stepped base (the bronze model's) is cut off where
# the horizontal extent leaves the base's rectangle
P = mesh.vertices
y0, y1 = P[:, 1].min(), P[:, 1].max()
step = (y1 - y0) / 400
ext = []
for k in range(400):
    sel = (P[:, 1] >= y0 + k * step) & (P[:, 1] < y0 + (k + 1) * step)
    ext.append((P[sel, 0].max() - P[sel, 0].min(), P[sel, 2].max() - P[sel, 2].min()) if sel.sum() > 20 else (0, 0))
ext = np.array(ext)
bx, bz = np.median(ext[2:12, 0]), np.median(ext[2:12, 1])
k = 2
while k < 200 and ext[k, 0] > 0.97 * bx and ext[k, 1] > 0.97 * bz: k += 1
ycut = y0 + k * step
print(f'base: {bx:.3f} x {bz:.3f} scan units, its top at {ycut:.3f} (slab {k})', flush=True)
# ---- scale: the statue's base to the flame's top, 44.93 m (HAER: 142 ft 8 1/4 in to 290 ft 1 in)
S = 44.93 / (y1 - ycut)
# ---- the offset across: fitted to the front and side elevations (HAER: the body's extents every 0.2 m, city/libertyData.js)
import re
_js = open(os.path.join(os.path.dirname(__file__), '..', '..', 'client', 'src', 'city', 'libertyData.js')).read()
body = json.loads(re.search(r'export const BODY = (\[.*?\]);\n', _js, re.S).group(1))
def extents(P, ys):
    out = []
    for y in ys:
        sel = np.abs(P[:, 1] - y) < 0.12
        out.append((P[sel, 0].min(), P[sel, 0].max(), P[sel, 2].min(), P[sel, 2].max()) if sel.sum() > 30 else (np.nan,) * 4)
    return np.array(out)
Q = (P - [0, ycut, 0]) * S
cx0 = (np.median(Q[(Q[:, 1] > -0.3) & (Q[:, 1] < 0), 0]) if False else 0)
rows = np.array([r for r in body if 0.6 <= r[0] <= 16.0])
best = None
for ang in np.radians(np.arange(-12, 12.1, 1.0)):
    c, s = math.cos(ang), math.sin(ang)
    R = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    Qr = Q @ R.T
    E = extents(Qr, rows[:, 0])
    ok = ~np.isnan(E[:, 0])
    # the offsets that best match each side's extents (least squares: the mean of the differences)
    dx = np.mean(((rows[ok, 1] - E[ok, 0]) + (rows[ok, 2] - E[ok, 1])) / 2)
    dz = np.mean(((rows[ok, 3] - E[ok, 2]) + (rows[ok, 4] - E[ok, 3])) / 2)
    err = np.mean(np.abs(rows[ok, 1] - E[ok, 0] - dx) + np.abs(rows[ok, 2] - E[ok, 1] - dx) + np.abs(rows[ok, 3] - E[ok, 2] - dz) + np.abs(rows[ok, 4] - E[ok, 3] - dz)) / 4
    if best is None or err < best[0]: best = (err, ang, dx, dz)
err, ang, dx, dz = best
print(f'fit: turned {math.degrees(ang):.1f} deg, offset {dx:.2f} / {dz:.2f} m, mean extent error {err:.2f} m', flush=True)
c, s = math.cos(ang), math.sin(ang)
R = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
Q = Q @ R.T + [dx, 0, dz]
# the torch's and head's places against the elevations
for nm, (ya, yb) in {'torch (36-40 m)': (36, 40), 'head (30-33 m)': (30, 33)}.items():
    sel = (Q[:, 1] > ya) & (Q[:, 1] < yb)
    if nm.startswith('torch'): sel &= Q[:, 0] < -2.5
    print(f'  {nm}: L {Q[sel, 0].min():.2f}..{Q[sel, 0].max():.2f}  F {Q[sel, 2].min():.2f}..{Q[sel, 2].max():.2f}')
# ---- cut the base: triangles wholly under the statue's base go; those crossing it are kept (hidden in the plinth)
mesh.vertices = Q
keep = Q[mesh.faces].max(axis=1)[:, 1] > 0.02
mesh.update_faces(keep)
mesh.remove_unreferenced_vertices()
print(f'cut: {len(mesh.vertices)} vertices, {len(mesh.faces)} triangles; height {mesh.vertices[:, 1].max():.2f} m', flush=True)
# ---- the verdigris, per vertex: the occlusion of the hemisphere round the normal (the folds' hollows), the openness to the
# rain falling from above (washed pale where open, deeper blue-green where sheltered), streaks under the edges
V = mesh.vertices; N = mesh.vertex_normals
nV = len(V)
rng = np.random.default_rng(7)
def hemi(n, k):
    d = rng.normal(size=(k, 3)); d /= np.linalg.norm(d, axis=1, keepdims=True)
    return d
K = 24
dirs = hemi(None, K)
ao = np.zeros(nV)
org = V + N * 0.04
for i in range(K):
    d = np.tile(dirs[i], (nV, 1))
    flip = (d * N).sum(1) < 0
    d[flip] *= -1
    hit, idx_ray = mesh.ray.intersects_any(org, d), None
    # (near occluders matter: a hit counts when within 6 m)
    loc, ri, ti = mesh.ray.intersects_location(org[hit], d[hit], multiple_hits=False)
    near = np.zeros(nV, dtype=bool)
    if len(ri):
        hits = np.where(hit)[0][ri]
        dist = np.linalg.norm(loc - org[hits], axis=1)
        near[hits[dist < 6.0]] = True
    ao += (~near) * np.maximum(0.0, (d * N).sum(1))
    print(f'  ao ray {i + 1}/{K}', flush=True) if (i + 1) % 6 == 0 else None
ao = ao / (K * 0.5)
ao = np.clip(ao, 0, 1)
# rain: a cone of 12 rays round straight down (from above): the share that reach the sky
rain = np.zeros(nV)
for i in range(12):
    a = 2 * math.pi * i / 12; tilt = 0.35
    d = np.array([math.sin(tilt) * math.cos(a), math.cos(tilt), math.sin(tilt) * math.sin(a)])
    hit = mesh.ray.intersects_any(V + N * 0.05 + [0, 0.05, 0], np.tile(d, (nV, 1)))
    rain += ~hit
rain /= 12
up = np.clip(N[:, 1], -1, 1)
print(f'occlusion and rain baked ({time.time() - t0:.0f} s)', flush=True)
# streaks: the rain's openness carried down the surface (each vertex takes the openness of the vertices a little above it,
# through a vertical smear), so pale runs fall from washed edges onto sheltered faces and dark runs from the hollows
from scipy.spatial import cKDTree
tree = cKDTree(V[:, [0, 2]])
smear = rain.copy()
for it in range(3):
    # neighbours within 0.6 m across, above by up to 2.5 m: their mean openness
    nb = tree.query_ball_point(V[:, [0, 2]], r=0.35)
    new = smear.copy()
    for i in range(nV):
        js = nb[i]
        if len(js) < 2: continue
        js = np.array(js); dy = V[js, 1] - V[i, 1]
        sel = js[(dy > 0.05) & (dy < 2.5)]
        if len(sel): new[i] = 0.5 * smear[i] + 0.5 * smear[sel].mean()
    smear = new
    print(f'  streak pass {it + 1}/3', flush=True)
noise = np.sin(V[:, 0] * 3.1 + np.sin(V[:, 2] * 2.3) * 2.0) * np.sin(V[:, 2] * 2.7 + V[:, 0] * 0.9) * 0.5 + 0.5
noise2 = np.sin(V[:, 0] * 11.0 + np.sin(V[:, 1] * 1.7) * 2.0) * np.sin(V[:, 2] * 9.0 + V[:, 1] * 0.8) * 0.5 + 0.5
cav = np.clip((0.62 - ao) / 0.5, 0, 1) ** 1.3
# drips: the darkness of the hollows and the ledges run down the surface (each vertex takes the darkest cavity of the
# vertices up to 2.5 m above it within 0.12 m across, fading with the drop), the dark runs under the folds and the arm
drip = np.zeros(nV)
nb = tree.query_ball_point(V[:, [0, 2]], r=0.12)
for i in range(nV):
    js = nb[i]
    if len(js) < 2: continue
    js = np.array(js); dy = V[js, 1] - V[i, 1]
    sel = (dy > 0.1) & (dy < 2.5)
    if sel.any(): drip[i] = np.max(cav[js[sel]] * (1 - dy[sel] / 2.5))
print(f'drips ({time.time() - t0:.0f} s)', flush=True)
# the colour, designed in sRGB and stored linear (glTF's COLOR_0): pale washed verdigris on the faces the rain reaches,
# sheltered blue-green, the deep hollows' brown-black cuprite, dark runs under them
pale = np.array([0.67, 0.85, 0.77]); mid = np.array([0.42, 0.64, 0.58]); deep = np.array([0.15, 0.23, 0.20])
wash = np.clip(0.62 * smear + 0.22 * np.clip(up, 0, 1) + 0.16 * noise, 0, 1)
wash = np.clip((wash - 0.18) / 0.64, 0, 1) ** 0.9
col = mid[None, :] * (1 - wash[:, None]) + pale[None, :] * wash[:, None]
col = col * (1 - 0.8 * cav[:, None]) + deep[None, :] * 0.8 * cav[:, None]
col = col * (1 - 0.35 * np.clip(drip, 0, 1)[:, None])
col *= (0.9 + 0.1 * noise2)[:, None]
lin = np.where(col <= 0.04045, col / 12.92, ((col + 0.055) / 1.055) ** 2.4)
rough = np.clip(0.5 + 0.28 * (1 - wash) + 0.15 * cav, 0, 1)
print(f'colour (sRGB): mean {col.mean(0).round(3)}, ao mean {ao.mean():.2f}, rain mean {rain.mean():.2f} ({time.time() - t0:.0f} s)', flush=True)
col = lin
# ---- write: positions, normals (f32), colours + roughness (u8), indices (u32), and a header
np.asarray(V, dtype=np.float32).tofile(os.path.join(OUT, 'pos.f32'))
np.asarray(N, dtype=np.float32).tofile(os.path.join(OUT, 'nrm.f32'))
c8 = np.clip(np.concatenate([col, rough[:, None]], 1) * 255 + 0.5, 0, 255).astype(np.uint8)
c8.tofile(os.path.join(OUT, 'col.u8'))
np.asarray(mesh.faces, dtype=np.uint32).tofile(os.path.join(OUT, 'idx.u32'))
json.dump({'vertices': int(nV), 'triangles': int(len(mesh.faces)), 'scale': S, 'cut': float(ycut), 'turn_deg': math.degrees(ang), 'offset': [dx, dz],
           'fit_err_m': err, 'height_m': float(V[:, 1].max())}, open(os.path.join(OUT, 'header.json'), 'w'), indent=1)
print(f'written to {OUT} ({time.time() - t0:.0f} s)')
