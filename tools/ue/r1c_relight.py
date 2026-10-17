#!/usr/bin/env python3
# R1C (lane C, 2026-10-11): a take's light rig in its own sublevel of the persistent world (the time of day is the take's,
# the cells carry no lights): ue_light.apply with the take's prep data, the light pass (lamps, sky captures, exposure,
# grade) taken from a recorded light pass of the same street and time of day until lane D writes the take's own, the rig
# spawned into the take's sublevel (the world's own earlier rig, BX_ actors in any level, goes as ue_light does; the take's
# lens is kept), headlamps on the take's moving vehicles from their lamp masks.
#   python3 tools/ue/r1c_relight.py --world-level <level> --sublevel <name> --side <the take's prep json>
#       --light-harvest <harvest dir with light_static.json> --light-side <that take's prep json> --run <run.json> --out <dir>
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
EXPORT = os.path.abspath(os.path.join(HERE, '..', '..', 'client', 'tools', 'ar34', 'export'))
PROJECT = os.path.join(EXPORT, 'ue_project', 'BoundlessUE.uproject')
UE_ROOT = os.environ.get('UE_ROOT', '/data0/projectnyc_aux/ue/UE_5.8')


def in_engine():
    import unreal, traceback
    for p in (EXPORT, os.path.join(EXPORT, 'ue_project', 'Python')):
        if p not in sys.path: sys.path.insert(0, p)
    import importlib, ue_light
    importlib.reload(ue_light)
    C = json.load(open(os.environ['R1C_RELIGHT_CFG']))
    els = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    ue_light.els = els
    T = {}
    t0 = time.time()
    unreal.EditorLoadingAndSavingUtils.load_map(C['world_level'])
    world = unreal.EditorLevelLibrary.get_editor_world()
    try: unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).set_current_level_by_name(C['sublevel'])
    except Exception as e: T['current_error'] = str(e)[:160]
    kept = []
    for a in els.get_all_level_actors():   # (the take's lens survives ue_light's sweep of BX_ actors)
        if a.get_actor_label() == 'BX_Camera': a.set_actor_label('R1C_keep_camera'); kept.append(a)
    side = json.load(open(C['side'])); ls_side = json.load(open(C['light_side']))
    side['data'] = dict(side['data'], harvest=C['light_harvest'], time=ls_side['data'].get('time') or 'night')
    for k in ('sky', 'ambient'): side[k] = ls_side.get(k)
    side['emit_lights'] = []
    run = json.load(open(C['run']))
    try:
        out = ue_light.apply(side, C['dest'], run, world) or {}
        T['light'] = {k: out.get(k) for k in ('mode', 'night', 'lamps', 'headlamps', 'film', 'fog', 'sky', 'importer_lights_removed')}
    except Exception as e:
        T['light_error'] = f'{type(e).__name__}: {e}'; unreal.log_error('[r1c] relight: ' + traceback.format_exc())
    for a in kept: a.set_actor_label('BX_Camera')
    unreal.EditorLoadingAndSavingUtils.save_dirty_packages(True, True)
    T['secs'] = round(time.time() - t0, 1)
    json.dump(T, open(C['result'], 'w'), indent=1, default=str)
    unreal.log('[r1c] RELIGHT_DONE ' + json.dumps(T, default=str)[:2000])


def main():
    import argparse
    ap = argparse.ArgumentParser()
    for k in ('world-level', 'sublevel', 'side', 'light-harvest', 'light-side', 'run', 'out'): ap.add_argument('--' + k, required=True)
    ap.add_argument('--dest', default=None)
    a = ap.parse_args()
    out = os.path.abspath(a.out); os.makedirs(out, exist_ok=True)
    C = {'world_level': a.world_level, 'sublevel': a.sublevel, 'side': a.side, 'light_harvest': a.light_harvest, 'light_side': a.light_side,
         'run': a.run, 'dest': a.dest or '/Game/R1C/Light/' + a.sublevel, 'result': os.path.join(out, 'relight.json')}
    cp = os.path.join(out, 'relight_cfg.json'); json.dump(C, open(cp, 'w'), indent=1)
    env = dict(os.environ, R1C_RELIGHT_CFG=cp, **{'UE-LocalDataCachePath': os.environ.get('BXUE_DDC', '/data0/projectnyc_aux/ue/ddc'), 'UE-SharedDataCachePath': 'None'})
    env['UE_PYTHONPATH'] = os.pathsep.join([EXPORT, os.path.join(EXPORT, 'ue_project', 'Python'), HERE])
    t0 = time.time()
    with open(os.path.join(out, 'relight.log'), 'w') as lf:
        code = subprocess.call([os.path.join(UE_ROOT, 'Engine', 'Binaries', 'Linux', 'UnrealEditor-Cmd'), PROJECT, '-run=pythonscript',
                                f'-script={os.path.abspath(__file__)}', '-unattended', '-nosplash', '-nullrhi', '-stdout', '-FullStdOutLogOutput'],
                               stdout=lf, stderr=subprocess.STDOUT, env=env)
    rec = {'process_s': round(time.time() - t0, 1), 'exit': code}
    try: rec['result'] = json.load(open(C['result']))
    except Exception: rec['result'] = None
    json.dump(rec, open(os.path.join(out, 'relight_run.json'), 'w'), indent=1)
    print(json.dumps(rec)[:1500])


if __name__ == '__main__':
    try:
        import unreal  # noqa: F401
        IN_ENGINE = True
    except ImportError:
        IN_ENGINE = False
    in_engine() if IN_ENGINE else main()
