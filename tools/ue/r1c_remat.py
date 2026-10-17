#!/usr/bin/env python3
# R1C (lane C, 2026-10-11): the take's materials made again on an imported actor folder (ue_mat.apply with the take's prep
# data): for an actor import whose shared texture assets another import rewrote at the same time (two editor processes
# writing the same walker textures leave the walkers white).
#   python3 tools/ue/r1c_remat.py --dest /Game/R1C/Act/<shot><tag> --side <prep json> --run <run.json> --out <dir>
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
EXPORT = os.path.abspath(os.path.join(HERE, '..', '..', 'client', 'tools', 'ar34', 'export'))
PROJECT = os.path.join(EXPORT, 'ue_project', 'BoundlessUE.uproject')
UE_ROOT = os.environ.get('UE_ROOT', '/data0/projectnyc_aux/ue/UE_5.8')


def in_engine():
    import unreal
    for p in (EXPORT, os.path.join(EXPORT, 'ue_project', 'Python')):
        if p not in sys.path: sys.path.insert(0, p)
    import ue_mat
    C = json.load(open(os.environ['R1C_REMAT_CFG']))
    t0 = time.time()
    side = json.load(open(C['side'])); run = json.load(open(C['run']))
    out = ue_mat.apply(side, C['dest'], run) or {}
    unreal.EditorAssetLibrary.save_directory(C['dest'], only_if_is_dirty=False, recursive=True)
    T = {'walkers': out.get('walkers'), 'assets': out.get('assets'), 'secs': round(time.time() - t0, 1)}
    json.dump(T, open(C['result'], 'w'), indent=1, default=str)
    unreal.log('[r1c] REMAT_DONE ' + json.dumps(T, default=str))


def main():
    import argparse
    ap = argparse.ArgumentParser()
    for k in ('dest', 'side', 'run', 'out'): ap.add_argument('--' + k, required=True)
    a = ap.parse_args()
    out = os.path.abspath(a.out); os.makedirs(out, exist_ok=True)
    C = {'dest': a.dest, 'side': a.side, 'run': a.run, 'result': os.path.join(out, 'remat.json')}
    cp = os.path.join(out, 'remat_cfg.json'); json.dump(C, open(cp, 'w'), indent=1)
    env = dict(os.environ, R1C_REMAT_CFG=cp, **{'UE-LocalDataCachePath': os.environ.get('BXUE_DDC', '/data0/projectnyc_aux/ue/ddc'), 'UE-SharedDataCachePath': 'None'})
    env['UE_PYTHONPATH'] = os.pathsep.join([EXPORT, os.path.join(EXPORT, 'ue_project', 'Python'), HERE])
    t0 = time.time()
    with open(os.path.join(out, 'remat.log'), 'w') as lf:
        code = subprocess.call([os.path.join(UE_ROOT, 'Engine', 'Binaries', 'Linux', 'UnrealEditor-Cmd'), PROJECT, '-run=pythonscript',
                                f'-script={os.path.abspath(__file__)}', '-unattended', '-nosplash', '-nullrhi', '-stdout', '-FullStdOutLogOutput'],
                               stdout=lf, stderr=subprocess.STDOUT, env=env)
    try: r = json.load(open(C['result']))
    except Exception: r = None
    print(json.dumps({'process_s': round(time.time() - t0, 1), 'exit': code, 'result': r}, default=str))


if __name__ == '__main__':
    try:
        import unreal  # noqa: F401
        IN_ENGINE = True
    except ImportError:
        IN_ENGINE = False
    in_engine() if IN_ENGINE else main()
