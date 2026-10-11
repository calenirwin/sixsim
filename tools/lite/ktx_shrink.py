#!/usr/bin/env python3
"""LITE15: shrink the light build's KTX2 textures in place (UASTC, zstd, mipmaps kept; arrays keep their layers).
   python3 tools/lite/ktx_shrink.py <built dir> [--jobs 48]
Rules: walker texture arrays (models/peds24) to at most 512 px, every other texture to at most 1024 px. A texture is
decoded once (basisu -unpack, the BC7 transcode of its UASTC data, which is near lossless), resampled by a power of two
and re-encoded; colour maps keep sRGB, data maps (normal, roughness, ORM, displacement...) are encoded linear."""
import multiprocessing as mp
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile

BASISU = os.environ.get('BASISU') or shutil.which('basisu') or '/data0/projectnyc_aux/.tools/basisu/basis_universal-1_60/bin/basisu'
LINEAR = re.compile(r'(nrm|normal|orm|rgh|rough|disp|height|_ao|metal|mask|spec|_n\.|_r\.)', re.I)


def header(p):
    b = open(p, 'rb').read(48)
    if b[:12] != b'\xabKTX 20\xbb\r\n\x1a\n':
        return None
    vk, ts, w, h, d, layers, faces, levels, sc = struct.unpack('<9I', b[12:48])
    return dict(vk=vk, w=w, h=h, layers=layers, faces=faces, levels=levels, sc=sc)


def target(rel):
    # tiling material sets repeat at real scale, so 512 px stays sharp; walker arrays 512; the rest 1024
    return 512 if rel.startswith(('models/peds24/', 'textures/pbr/')) else 1024


def shrink(args):
    root, rel = args
    p = os.path.join(root, rel)
    hd = header(p)
    if not hd or hd['vk'] != 0 or hd['faces'] != 1:
        return rel, 'skip (not a Basis 2D texture)', 0, 0
    tgt = target(rel)
    big = max(hd['w'], hd['h'])
    if big <= tgt:
        return rel, 'small enough', 0, 0
    f = tgt / big
    tmp = tempfile.mkdtemp(prefix='ktxs_')
    try:
        r = subprocess.run([BASISU, '-unpack', p, '-format_only', '6'], cwd=tmp, capture_output=True, text=True)
        if r.returncode:
            return rel, 'unpack failed', 0, 0
        stem = os.path.splitext(os.path.basename(p))[0]
        n = max(1, hd['layers'])
        layer0 = [os.path.join(tmp, f'{stem}_unpacked_rgba_BC7_RGBA_level_0_face_0_layer_{i:04d}.png') for i in range(n)]
        if not all(os.path.exists(x) for x in layer0):
            return rel, 'no level-0 images', 0, 0
        out = os.path.join(tmp, 'out.ktx2')
        cmd = [BASISU, '-ktx2', '-uastc', '-mipmap', '-resample_factor', f'{f:.6f}', '-output_file', out]
        if LINEAR.search(rel):
            cmd.append('-linear')
        if hd['layers'] > 0:
            cmd += ['-tex_type', '2darray', '-multifile_printf', os.path.join(tmp, f'{stem}_unpacked_rgba_BC7_RGBA_level_0_face_0_layer_%04u.png'),
                    '-multifile_num', str(n), '-multifile_first', '0']
        else:
            cmd.append(layer0[0])
        r = subprocess.run(cmd, cwd=tmp, capture_output=True, text=True)
        if r.returncode or not os.path.exists(out):
            return rel, 'encode failed: ' + (r.stdout + r.stderr)[-200:].replace('\n', ' '), 0, 0
        before, after = os.path.getsize(p), os.path.getsize(out)
        oh = header(out)
        if not oh or max(1, oh['layers']) != n:
            return rel, f'layer mismatch {oh}', 0, 0
        shutil.move(out, p)
        return rel, f"{hd['w']}->{oh['w']}", before, after
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    root = sys.argv[1]
    jobs = int(sys.argv[sys.argv.index('--jobs') + 1]) if '--jobs' in sys.argv else 48
    rels = []
    for dp, _, fs in os.walk(root):
        for fn in fs:
            if fn.endswith('.ktx2'):
                rels.append(os.path.relpath(os.path.join(dp, fn), root))
    with mp.Pool(jobs) as pool:
        res = pool.map(shrink, [(root, r) for r in rels], chunksize=1)
    b0 = sum(r[2] for r in res); b1 = sum(r[3] for r in res)
    for rel, msg, a, b in sorted(res, key=lambda r: -r[2])[:15]:
        print(f'{a/1048576:7.1f} -> {b/1048576:6.1f} MB  {msg:24s} {rel}')
    bad = [r for r in res if 'fail' in r[1] or 'mismatch' in r[1] or 'no level' in r[1]]
    print(f'[shrink] {len(rels)} textures; shrunk {sum(1 for r in res if r[2])}: {b0/1048576:.1f} -> {b1/1048576:.1f} MB; problems {len(bad)}')
    for r in bad:
        print('  PROBLEM', r[0], r[1])


if __name__ == '__main__':
    main()
