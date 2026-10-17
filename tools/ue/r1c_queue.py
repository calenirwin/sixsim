#!/usr/bin/env python3
# R1C (lane C, 2026-10-10): a persistent render worker, first form: one Unreal -game process renders several takes back to
# back from one Movie Render Queue manifest (the queue's jobs in one session: the engine, the shader and derived-data
# caches and the GPU context stay up between shots; each job loads its own level).
#   python3 tools/ue/r1c_queue.py --takes <take>=<work dir>[:<a-b>],... --out <dir> [--warmup N] [--gpu-pci 01]
#       [--name r1c_worker] [--norender]
# <take> is a take's UE name (/Game/Takes/<take>, imported by ue_take.py), <work dir> that take's (its run.json). Each
# take's jobs are built by ue_take.mrq_manifest with the take's own settings, output into <out>/<take>/, all in one queue
# (the editor, -nullrhi) saved as Saved/MovieRenderPipeline/<name>.utxt and rendered by one process. Per job the first
# and last frame times (the files' mtimes) and the gaps between jobs go to <out>/worker.json.
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
EXPORT = os.path.abspath(os.path.join(HERE, '..', '..', 'client', 'tools', 'ar34', 'export'))
PROJECT = os.path.join(EXPORT, 'ue_project', 'BoundlessUE.uproject')
UE_ROOT = os.environ.get('UE_ROOT', '/data0/projectnyc_aux/ue/UE_5.8')
SAVED = os.path.join(EXPORT, 'ue_project', 'Saved')


def in_engine():
    """the queue: each take's jobs built by ue_take.mrq_manifest itself (its settings), into one queue kept across the
    takes (a proxy keeps the function from clearing or saving the queue between takes), then saved once"""
    import unreal, shutil
    for p in (EXPORT, os.path.join(EXPORT, 'ue_project', 'Python')):
        if p not in sys.path: sys.path.insert(0, p)
    import ue_take
    cfg = json.load(open(os.environ['R1C_QUEUE_CFG']))
    realq = unreal.get_editor_subsystem(unreal.MoviePipelineQueueSubsystem).get_queue()
    realq.delete_all_jobs()
    dummy = os.path.join(os.path.dirname(cfg['dst']), 'r1c_dummy.utxt')
    open(dummy, 'w').write('r1c')

    class _Q:
        def __init__(s, q): s._q = q
        def delete_all_jobs(s): pass
        def __getattr__(s, k): return getattr(s._q, k)

    class _Sub:
        def get_queue(s): return _Q(realq)

    class _Lib:
        @staticmethod
        def save_queue_to_manifest_file(q): return (None, dummy)

    class _U:
        def __getattr__(s, k): return _Lib if k == 'MoviePipelineEditorLibrary' else getattr(unreal, k)
        def get_editor_subsystem(s, c): return _Sub()

    out = {'jobs': []}
    for t in cfg['takes']:
        run = json.load(open(t['run']))
        side = json.load(open(run['side']))
        tk = t['take']
        lo, hi = side['frames']
        rng = [t['frames']] if t.get('frames') else [[lo, hi]]
        c = dict(run, shot=tk, rawdir=t['rawdir'])
        if t.get('warmup') is not None: c['warmup'] = int(t['warmup'])
        n0 = len(realq.get_jobs())
        ue_take.mrq_manifest(_U(), c, side, f'/Game/Takes/{tk}/L_{tk}', f'/Game/Takes/{tk}/LS_{tk}.LS_{tk}', 'r1cq', rng)
        for j in list(realq.get_jobs())[n0:]:
            out['jobs'].append({'take': tk, 'job': str(j.get_editor_property('job_name')), 'rawdir': t['rawdir'], 'ranges': rng})
    ret = unreal.MoviePipelineEditorLibrary.save_queue_to_manifest_file(realq)
    srcp = next((x for x in (ret if isinstance(ret, (tuple, list)) else [ret]) if isinstance(x, str)), None)
    if not srcp: srcp = os.path.join(unreal.Paths.project_saved_dir(), 'MovieRenderPipeline', 'QueueManifest.utxt')
    srcp = unreal.Paths.convert_relative_path_to_full(srcp) if not os.path.isabs(srcp) else srcp
    shutil.copyfile(srcp, cfg['dst'])
    realq.delete_all_jobs()
    out['manifest'] = cfg['dst']
    json.dump(out, open(cfg['result'], 'w'), indent=1)
    unreal.log('[r1c] QUEUE_DONE ' + json.dumps(out))


def frames_of(d):
    fs = sorted(f for f in os.listdir(d) if f.endswith('_FinalImage.png')) if os.path.isdir(d) else []
    return [(f, os.path.getmtime(os.path.join(d, f))) for f in fs]


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--takes', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--gpu-pci', default='01'); ap.add_argument('--name', default='r1c_worker')
    ap.add_argument('--res', default='2560x1440'); ap.add_argument('--norender', action='store_true')
    ap.add_argument('--warmup', type=int, default=None, help='warm-up frames per job (default: each take\'s own)')
    a = ap.parse_args()
    out = os.path.abspath(a.out); os.makedirs(out, exist_ok=True)
    takes = []
    for spec in a.takes.split(','):
        spec, _, fr = spec.partition(':')
        tk, _, wd = spec.partition('=')
        run = os.path.join(wd, 'run.json')
        if not os.path.exists(run): sys.exit(f'no run.json for {tk}: {run}')
        rd = os.path.join(out, tk); os.makedirs(rd, exist_ok=True)
        takes.append({'take': tk, 'run': run, 'rawdir': rd, 'frames': [int(x) for x in fr.split('-')] if fr else None, 'warmup': a.warmup})
    rel = f'MovieRenderPipeline/{a.name}.utxt'
    cfg = {'takes': takes, 'dst': os.path.join(SAVED, rel), 'result': os.path.join(out, 'queue.json')}
    cp = os.path.join(out, 'queue_cfg.json'); json.dump(cfg, open(cp, 'w'), indent=1)
    env = dict(os.environ, R1C_QUEUE_CFG=cp, **{'UE-LocalDataCachePath': os.environ.get('BXUE_DDC', '/data0/projectnyc_aux/ue/ddc'), 'UE-SharedDataCachePath': 'None'})
    env['UE_PYTHONPATH'] = os.pathsep.join([EXPORT, os.path.join(EXPORT, 'ue_project', 'Python'), HERE])
    if os.path.exists('/usr/share/vulkan/icd.d/nvidia_icd.json'): env.setdefault('VK_ICD_FILENAMES', '/usr/share/vulkan/icd.d/nvidia_icd.json')
    rec = {'takes': [t['take'] for t in takes], 'started': time.ctime()}
    t0 = time.time()
    with open(os.path.join(out, 'queue.log'), 'w') as lf:
        code = subprocess.call([os.path.join(UE_ROOT, 'Engine', 'Binaries', 'Linux', 'UnrealEditor-Cmd'), PROJECT, '-run=pythonscript',
                                f'-script={os.path.abspath(__file__)}', '-unattended', '-nosplash', '-nullrhi', '-stdout', '-FullStdOutLogOutput'],
                               stdout=lf, stderr=subprocess.STDOUT, env=env)
    rec['queue_s'] = round(time.time() - t0, 1); rec['queue_exit'] = code
    if code != 0 or not os.path.exists(cfg['result']): print('queue failed', code); json.dump(rec, open(os.path.join(out, 'worker.json'), 'w'), indent=1); sys.exit(2)
    if a.norender: print(json.dumps(rec)); return
    W, H = a.res.split('x')
    env2 = dict(env); env2.pop('R1C_QUEUE_CFG', None); env2['DRI_PRIME'] = f'pci-0000_{a.gpu_pci}_00_0'
    import fcntl
    gl = open(os.path.join('/data0/projectnyc_aux/tmp/ue_gpu_locks', f"pci-0000_{a.gpu_pci}_00_0.lock"), 'a+')
    tw = time.time(); fcntl.flock(gl, fcntl.LOCK_EX); rec['gpu_wait_s'] = round(time.time() - tw, 1)
    gl.seek(0); gl.truncate(); gl.write(f'pid {os.getpid()} {time.ctime()} r1c worker'); gl.flush()
    t1 = time.time()
    with open(os.path.join(out, 'render.log'), 'w') as lf:
        code = subprocess.call([os.path.join(UE_ROOT, 'Engine', 'Binaries', 'Linux', 'UnrealEditor'), PROJECT, 'MoviePipelineEntryMap', '-game',
                                f'-MoviePipelineConfig={rel}', '-RenderOffscreen', '-Unattended', '-NoSplash', '-NoLoadingScreen', '-nosound', '-windowed',
                                f'-resx={W}', f'-resy={H}', '-graphicsadapter=0', '-log', '-stdout', '-FullStdOutLogOutput', '-NoTextureStreaming'],
                               stdout=lf, stderr=subprocess.STDOUT, env=env2)
    t2 = time.time()
    rec['render_s'] = round(t2 - t1, 1); rec['render_exit'] = code
    prev = t1
    for t in takes:
        fr = frames_of(t['rawdir'])
        if not fr: rec.setdefault('jobs', []).append({'take': t['take'], 'frames': 0}); continue
        ts = [m for _, m in fr]
        dts = sorted(b - a_ for a_, b in zip(ts, ts[1:]))
        j = {'take': t['take'], 'frames': len(fr), 'first_after_prev_s': round(ts[0] - prev, 1), 'span_s': round(ts[-1] - ts[0], 1),
             'median_frame_s': round(dts[len(dts) // 2], 3) if dts else None, 'mean_frame_s': round((ts[-1] - ts[0]) / max(len(ts) - 1, 1), 3)}
        rec.setdefault('jobs', []).append(j); prev = ts[-1]
    rec['tail_s'] = round(t2 - prev, 1)
    json.dump(rec, open(os.path.join(out, 'worker.json'), 'w'), indent=1)
    print(json.dumps(rec, indent=1))


if __name__ == '__main__':
    try:
        import unreal  # noqa: F401
        IN_ENGINE = True
    except ImportError:
        IN_ENGINE = False
    in_engine() if IN_ENGINE else main()
