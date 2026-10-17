#!/usr/bin/env python3
# R1C (lane C, 2026-10-10): a camera path rendered from a world imported once (no per-shot import). In an existing take's
# level (the persistent world) a new camera, keyed from another shot's lens path moved into this world's frame by the two
# harvests' origins, gets its own level sequence (the world's importer sequence as a subsequence: the traffic and walkers
# move) and a Movie Render Queue manifest with the world take's settings; then one -game process renders it.
#   python3 tools/ue/r1c_path.py --world <take> --world-side <prep json> --world-run <run.json> --path-side <prep json>
#       --name <path name> --out <raw dir> [--frames a-b] [--warmup 48] [--gpu-pci 01] [--norender]
#   ... --level /Game/R1C/World/L_cplake --world-origin 0,0,0 --world-run <run.json> ... (a level that is not a take: the
#       cells world, absolute coordinates; the run.json gives the render settings)
# Timing (time to the first frame, s/frame) from the frames' files into <out>/path.json.
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
EXPORT = os.path.abspath(os.path.join(HERE, '..', '..', 'client', 'tools', 'ar34', 'export'))
PROJECT = os.path.join(EXPORT, 'ue_project', 'BoundlessUE.uproject')
UE_ROOT = os.environ.get('UE_ROOT', '/data0/projectnyc_aux/ue/UE_5.8')


def in_engine():
    import unreal
    for p in (EXPORT, os.path.join(EXPORT, 'ue_project', 'Python')):
        if p not in sys.path: sys.path.insert(0, p)
    import ue_light, ue_take
    C = json.load(open(os.environ['R1C_PATH_CFG']))
    eal = unreal.EditorAssetLibrary
    els = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    T = {}
    t0 = time.time()
    world = C.get('world')
    level = C.get('level') or f'/Game/Takes/{world}/L_{world}'
    unreal.EditorLoadingAndSavingUtils.load_map(level)
    T['load_map_s'] = round(time.time() - t0, 1)
    sw = json.load(open(C['world_side'])) if C.get('world_side') else None
    run = json.load(open(C['world_run']))
    # one camera per path, the paths back to back on the sequence's timeline, a camera cut per path (Movie Render Queue
    # renders each cut as a shot with its own warm-up: one map load for all of them)
    paths = C.get('path_sides') or [C['path_side']]
    lin = unreal.MovieSceneKeyInterpolation.LINEAR
    dest = '/Game/R1C'
    ls_path = f'{dest}/LS_{C["name"]}'
    if eal.does_asset_exist(ls_path): eal.delete_asset(ls_path)
    ls = unreal.AssetToolsHelpers.get_asset_tools().create_asset(f'LS_{C["name"]}', dest, unreal.LevelSequence, unreal.LevelSequenceFactoryNew())
    cut = ls.add_track(unreal.MovieSceneCameraCutTrack)
    start, fps, T['paths'] = 0, 30, []
    for pi, pth in enumerate(paths):
        sp_ = json.load(open(pth))
        fps = int(round(sp_.get('fps') or 30))
        ow = C.get('world_origin') or sw['data']['origin']   # (a world in the cells' absolute frame: 0, 0, 0)
        op = sp_['data']['origin']
        d = [(op[0] - ow[0]) * 100.0, (op[2] - ow[2]) * 100.0, (op[1] - ow[1]) * 100.0]   # (USD x, z, y metres -> UE x, y, z cm)
        U = [dict(c, p=[c['p'][0] + d[0], c['p'][1] + d[1], c['p'][2] + d[2]]) for c in sp_['camera']['ue']]
        side2 = dict(sp_); side2['camera'] = dict(sp_['camera'], ue=U)
        lab = f"R1C_{C['name']}_{pi}"
        for a in els.get_all_level_actors():
            if a.get_actor_label() == lab: els.destroy_actor(a)
        c0 = U[0]
        cam = els.spawn_actor_from_class(unreal.CineCameraActor, unreal.Vector(*c0['p']), ue_light._rot(c0['f'], c0['u']))
        cam.set_actor_label(lab)
        ue_light.camera_settings(cam, side2, run)
        if run.get('cine'):   # (the world take's depth of field: manual focus at 20 m, its f-stop)
            cc = cam.get_cine_camera_component()
            fs = cc.get_editor_property('focus_settings')
            fs.set_editor_property('focus_method', unreal.CameraFocusMethod.MANUAL); fs.set_editor_property('manual_focus_distance', 2000.0)
            cc.set_editor_property('focus_settings', fs); cc.set_editor_property('current_aperture', float(run['cine'].get('fstop', 8.0)))
        b = ls.add_possessable(cam)
        n = len(U)
        cs = cut.add_section(); cs.set_range(start, start + n)
        try: bid = unreal.MovieSceneSequenceExtensions.get_portable_binding_id(ls, ls, b)
        except Exception: bid = ls.get_binding_id(b)
        cs.set_camera_binding_id(bid)
        tr = b.add_track(unreal.MovieScene3DTransformTrack)
        sec = tr.add_section(); sec.set_range(start, start + n)
        ch = sec.get_all_channels()
        rots = [ue_light._rot(c['f'], c['u']) for c in U]
        cols = [[c['p'][0] for c in U], [c['p'][1] for c in U], [c['p'][2] for c in U],
                ue_light._unwrap([r.roll for r in rots]), ue_light._unwrap([r.pitch for r in rots]), ue_light._unwrap([r.yaw for r in rots])]
        for i in range(6):
            for k, v in enumerate(cols[i]):
                ch[i].add_key(unreal.FrameNumber(start + k), float(v), 0.0, unreal.MovieSceneTimeUnit.DISPLAY_RATE, lin)
        for i in range(6, 9):
            ch[i].add_key(unreal.FrameNumber(start), 1.0, 0.0, unreal.MovieSceneTimeUnit.DISPLAY_RATE, lin)
        T['paths'].append({'path': pth, 'frames': [start, start + n - 1], 'offset_cm': [round(x, 1) for x in d]})
        start += n
    nF = start
    ls.set_display_rate(unreal.FrameRate(fps, 1)); ls.set_playback_start(0); ls.set_playback_end(nF)
    pick = None
    if world and sw:   # (a take's level: its importer sequence moves the traffic and walkers)
        stem = os.path.splitext(os.path.basename(sw['ue_root']))[0]
        seqs = [a for a in eal.list_assets(f'/Game/Takes/{world}', recursive=True, include_folder=False)
                if eal.find_asset_data(a).asset_class_path.asset_name == 'LevelSequence' and '/LevelSequences/' in a]
        pick = next((a for a in seqs if a.split('/')[-1].split('.')[0] in ('LS_' + stem, stem)), seqs[0] if seqs else None)
    if pick:
        sub = ls.add_track(unreal.MovieSceneSubTrack); sec = sub.add_section(); sec.set_sequence(eal.load_asset(pick)); sec.set_range(0, nF)
    eal.save_loaded_asset(ls)
    world_obj = unreal.EditorLevelLibrary.get_editor_world()
    unreal.EditorLoadingAndSavingUtils.save_map(world_obj, level)
    side2 = dict(json.load(open(paths[0])))
    # the manifest: the world take's render settings
    cfg = dict(run, shot=C['name'], rawdir=C['out'], warmup=int(C.get('warmup') or run.get('warmup', 48)))
    fr = C.get('frames') or [0, nF - 1]
    side2['frames'] = [0, nF - 1]
    T['mrq'] = ue_take.mrq_manifest(unreal, cfg, side2, level, ls.get_path_name(), 'path', [fr])
    T['secs'] = round(time.time() - t0, 1)
    json.dump(T, open(C['result'], 'w'), indent=1)
    unreal.log('[r1c] PATH_DONE ' + json.dumps(T))


def main():
    import argparse
    ap = argparse.ArgumentParser()
    for k in ('world-run', 'path-side', 'name', 'out'): ap.add_argument('--' + k, required=True)
    ap.add_argument('--world', default=None); ap.add_argument('--world-side', default=None)
    ap.add_argument('--level', default=None, help='a level that is not a take (e.g. the cells world)')
    ap.add_argument('--world-origin', default=None, help='x,y,z metres of the level\'s frame (the cells world: 0,0,0)')
    ap.add_argument('--frames', default=None); ap.add_argument('--warmup', default=None)
    ap.add_argument('--gpu-pci', default='01'); ap.add_argument('--res', default='2560x1440'); ap.add_argument('--norender', action='store_true')
    a = ap.parse_args()
    out = os.path.abspath(a.out); os.makedirs(out, exist_ok=True)
    C = {'world': a.world, 'world_side': a.world_side, 'world_run': a.world_run, 'path_side': a.path_side.split(',')[0], 'path_sides': a.path_side.split(','), 'name': a.name, 'out': out,
         'level': a.level, 'world_origin': [float(x) for x in a.world_origin.split(',')] if a.world_origin else None,
         'frames': [int(x) for x in a.frames.split('-')] if a.frames else None, 'warmup': a.warmup, 'result': os.path.join(out, 'path_import.json')}
    cp = os.path.join(out, 'path_cfg.json'); json.dump(C, open(cp, 'w'), indent=1)
    env = dict(os.environ, R1C_PATH_CFG=cp, **{'UE-LocalDataCachePath': os.environ.get('BXUE_DDC', '/data0/projectnyc_aux/ue/ddc'), 'UE-SharedDataCachePath': 'None'})
    env['UE_PYTHONPATH'] = os.pathsep.join([EXPORT, os.path.join(EXPORT, 'ue_project', 'Python'), HERE])
    if os.path.exists('/usr/share/vulkan/icd.d/nvidia_icd.json'): env.setdefault('VK_ICD_FILENAMES', '/usr/share/vulkan/icd.d/nvidia_icd.json')
    rec = {'started': time.ctime()}
    t0 = time.time()
    with open(os.path.join(out, 'path_setup.log'), 'w') as lf:
        code = subprocess.call([os.path.join(UE_ROOT, 'Engine', 'Binaries', 'Linux', 'UnrealEditor-Cmd'), PROJECT, '-run=pythonscript',
                                f'-script={os.path.abspath(__file__)}', '-unattended', '-nosplash', '-nullrhi', '-stdout', '-FullStdOutLogOutput'],
                               stdout=lf, stderr=subprocess.STDOUT, env=env)
    rec['setup_s'] = round(time.time() - t0, 1); rec['setup_exit'] = code
    try: rec['setup'] = json.load(open(C['result']))
    except Exception: print('setup failed', code); json.dump(rec, open(os.path.join(out, 'path.json'), 'w'), indent=1); sys.exit(2)
    if a.norender: print(json.dumps(rec, indent=1)); return
    rel = rec['setup']['mrq']['manifest']
    W, H = a.res.split('x')
    env2 = dict(env); env2.pop('R1C_PATH_CFG', None); env2['DRI_PRIME'] = f'pci-0000_{a.gpu_pci}_00_0'
    import fcntl
    gl = open(os.path.join('/data0/projectnyc_aux/tmp/ue_gpu_locks', f"pci-0000_{a.gpu_pci}_00_0.lock"), 'a+')
    tw = time.time(); fcntl.flock(gl, fcntl.LOCK_EX); rec['gpu_wait_s'] = round(time.time() - tw, 1)
    gl.seek(0); gl.truncate(); gl.write(f'pid {os.getpid()} {time.ctime()} r1c path'); gl.flush()
    t1 = time.time()
    with open(os.path.join(out, 'render.log'), 'w') as lf:
        code = subprocess.call([os.path.join(UE_ROOT, 'Engine', 'Binaries', 'Linux', 'UnrealEditor'), PROJECT, 'MoviePipelineEntryMap', '-game',
                                f'-MoviePipelineConfig={rel}', '-RenderOffscreen', '-Unattended', '-NoSplash', '-NoLoadingScreen', '-nosound', '-windowed',
                                f'-resx={W}', f'-resy={H}', '-graphicsadapter=0', '-log', '-stdout', '-FullStdOutLogOutput', '-NoTextureStreaming'],
                               stdout=lf, stderr=subprocess.STDOUT, env=env2)
    rec['render_s'] = round(time.time() - t1, 1); rec['render_exit'] = code
    fs = sorted(f for f in os.listdir(out) if f.endswith('_FinalImage.png'))
    ts = [os.path.getmtime(os.path.join(out, f)) for f in fs]
    if ts:
        dts = sorted(b - a_ for a_, b in zip(ts, ts[1:]))
        rec.update(frames=len(ts), first_frame_s=round(ts[0] - t1, 1), mean_frame_s=round((ts[-1] - ts[0]) / max(len(ts) - 1, 1), 3),
                   median_frame_s=round(dts[len(dts) // 2], 3) if dts else None)
    json.dump(rec, open(os.path.join(out, 'path.json'), 'w'), indent=1)
    print(json.dumps({k: v for k, v in rec.items() if k != 'setup'}, indent=1))


if __name__ == '__main__':
    try:
        import unreal  # noqa: F401
        IN_ENGINE = True
    except ImportError:
        IN_ENGINE = False
    in_engine() if IN_ENGINE else main()
