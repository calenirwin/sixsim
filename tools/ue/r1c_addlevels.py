#!/usr/bin/env python3
# R1C (lane C, 2026-10-11): a persistent world assembled from levels imported in parallel (r1c_cells.py, one level per
# batch of cells): the batch levels added to the world's level as always-loaded streaming levels, saved.
#   python3 tools/ue/r1c_addlevels.py --world-level /Game/R1C/W6_x/L_x --levels /Game/R1C/W6_x/L_cells_0,... --out <dir> [--new]
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
EXPORT = os.path.abspath(os.path.join(HERE, '..', '..', 'client', 'tools', 'ar34', 'export'))
PROJECT = os.path.join(EXPORT, 'ue_project', 'BoundlessUE.uproject')
UE_ROOT = os.environ.get('UE_ROOT', '/data0/projectnyc_aux/ue/UE_5.8')


def in_engine():
    import unreal
    C = json.load(open(os.environ['R1C_ADDLEVELS_CFG']))
    t0 = time.time()
    if C.get('new'):   # (a take's own level: a new map holding the world's content levels, which stay shared and untouched)
        unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
    else:
        unreal.EditorLoadingAndSavingUtils.load_map(C['world_level'])
    world = unreal.EditorLevelLibrary.get_editor_world()
    T = {'added': [], 'errors': {}}
    for lv in C['levels']:
        try:
            unreal.EditorLevelUtils.add_level_to_world(world, lv, unreal.LevelStreamingAlwaysLoaded)
            T['added'].append(lv)
        except Exception as e:
            T['errors'][lv] = str(e)[:200]
    unreal.EditorLoadingAndSavingUtils.save_map(world, C['world_level'])
    T['secs'] = round(time.time() - t0, 1)
    json.dump(T, open(C['result'], 'w'), indent=1)
    unreal.log('[r1c] ADDLEVELS_DONE ' + json.dumps(T))


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--world-level', required=True); ap.add_argument('--levels', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--new', action='store_true', help='create --world-level as a new map holding the levels')
    a = ap.parse_args()
    out = os.path.abspath(a.out); os.makedirs(out, exist_ok=True)
    C = {'world_level': a.world_level, 'levels': a.levels.split(','), 'result': os.path.join(out, 'addlevels.json'), 'new': a.new}
    cp = os.path.join(out, 'addlevels_cfg.json'); json.dump(C, open(cp, 'w'), indent=1)
    env = dict(os.environ, R1C_ADDLEVELS_CFG=cp, **{'UE-LocalDataCachePath': os.environ.get('BXUE_DDC', '/data0/projectnyc_aux/ue/ddc'), 'UE-SharedDataCachePath': 'None'})
    t0 = time.time()
    with open(os.path.join(out, 'addlevels.log'), 'w') as lf:
        code = subprocess.call([os.path.join(UE_ROOT, 'Engine', 'Binaries', 'Linux', 'UnrealEditor-Cmd'), PROJECT, '-run=pythonscript',
                                f'-script={os.path.abspath(__file__)}', '-unattended', '-nosplash', '-nullrhi', '-stdout', '-FullStdOutLogOutput'],
                               stdout=lf, stderr=subprocess.STDOUT, env=env)
    try: r = json.load(open(C['result']))
    except Exception: r = None
    print(json.dumps({'process_s': round(time.time() - t0, 1), 'exit': code, 'result': r}))
    sys.exit(0 if (code == 0 and r and not r.get('errors')) else 1)


if __name__ == '__main__':
    try:
        import unreal  # noqa: F401
        IN_ENGINE = True
    except ImportError:
        IN_ENGINE = False
    in_engine() if IN_ENGINE else main()
