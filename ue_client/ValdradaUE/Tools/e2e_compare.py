"""Side by side of two e2e_check.py runs of the same requests (the Unreal client and the three.js build): per place, the
last RGB frame of each, their depth planes in false colour on one scale and their semantic planes, one PNG per place in
--out; the depth planes' agreement (median absolute difference over pixels both see within 200 m) goes to compare.json.

    python3 ue_client/ValdradaUE/Tools/e2e_compare.py <unreal run dir> <three.js run dir> --out <dir>
"""
import argparse
import glob
import json
import os

import numpy as np
from PIL import Image, ImageDraw


def last(d, place, kind, ext):
    fs = sorted(glob.glob(os.path.join(d, f'{place}_{kind}_*{ext}')))
    return fs[-1] if fs else None


def depth_rgb(d, far=200.0):
    t = np.clip(d / far, 0, 1) ** 0.5
    return (np.stack([t, 1 - np.abs(t - 0.5) * 2, 1 - t], -1) * 255).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('ue')
    ap.add_argument('three')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    rep = {}
    for place in ('w125', 'tsq'):
        tiles, names = [], []
        for name, d in (('unreal', a.ue), ('three.js', a.three)):
            rgb = last(d, place, 'rgb', '.png')
            dep = last(d, place, 'depth', '.npy')
            if rgb:
                tiles.append(Image.open(rgb).convert('RGB').resize((640, 360)))
                names.append(f'{name} rgb {os.path.basename(rgb)}')
            if dep:
                tiles.append(Image.fromarray(depth_rgb(np.load(dep))).resize((640, 360)))
                names.append(f'{name} depth')
            sem = last(d, place, 'semantic_segmentation', '.png')
            if sem:
                tiles.append(Image.open(sem).convert('RGB').resize((640, 360), Image.NEAREST))
                names.append(f'{name} semantic')
        if not tiles:
            continue
        cols = 3
        sheet = Image.new('RGB', (640 * cols, 360 * ((len(tiles) + cols - 1) // cols)), (0, 0, 0))
        dr = ImageDraw.Draw(sheet)
        for i, (t, n) in enumerate(zip(tiles, names)):
            x, y = (i % cols) * 640, (i // cols) * 360
            sheet.paste(t, (x, y))
            dr.text((x + 8, y + 8), n, fill=(255, 255, 255))
        p = os.path.join(a.out, f'{place}_unreal_vs_threejs.png')
        sheet.save(p)
        du, dt = last(a.ue, place, 'depth', '.npy'), last(a.three, place, 'depth', '.npy')
        r = {'sheet': p}
        if du and dt:
            A, B = np.load(du), np.load(dt)
            if A.shape == B.shape:
                m = (A < 200) & (B < 200)
                r.update(pixels_both=int(m.sum()), median_abs_m=float(np.median(np.abs(A[m] - B[m]))) if m.any() else None,
                         median_rel=float(np.median(np.abs(A[m] - B[m]) / np.maximum(B[m], 0.1))) if m.any() else None,
                         sky_unreal=float((A >= 999).mean()), sky_three=float((B >= 999).mean()))
        rep[place] = r
        print(place, json.dumps(r))
    json.dump(rep, open(os.path.join(a.out, 'compare.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
