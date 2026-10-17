#!/usr/bin/env python3
# GB43 KIT (docs/notes/ue-city-architecture.md): the kit, imported once. Every prototype a cell's kit sets name
# (cellcache/protos/<hash>.glb, written once by content by the bake) is decompressed (r1c_decomp.mjs), imported into
# /Game/Kit/P_<hash> (its static mesh on Nanite) and its material bound by the cells' own machinery (r1c_bind.py on the
# kit's folders); the kit index (ue_cache/kit/index.json: hash -> mesh path and the material tools it was bound with) is
# what the cell tables (vcel_write.py) name. A prototype already in the index, bound with today's tools, is left alone.
#   python3 tools/ue/kit_import.py --cells <dir of packed cell glbs> [--out <dir>]
import json, os, struct, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
EXPORT = os.path.abspath(os.path.join(HERE, '..', '..', 'client', 'tools', 'ar34', 'export'))
PROJECT = os.path.join(EXPORT, 'ue_project', 'BoundlessUE.uproject')
UE_ROOT = os.environ.get('UE_ROOT', '/data0/projectnyc_aux/ue/UE_5.8')
CELLCACHE = '/data0/projectnyc_aux/cellcache'
KIT = '/data0/projectnyc_aux/ue_cache/kit'
ROOT_UE = '/Game/Kit'


def in_engine():
    import unreal
    C = json.load(open(os.environ['KIT_IMPORT_CFG']))
    eal = unreal.EditorAssetLibrary
    mgr = unreal.InterchangeManager.get_interchange_manager_scripted()
    out = {}
    for h in C['hashes']:
        t = time.time(); dest = f'{ROOT_UE}/P_{h}'
        src = unreal.InterchangeManager.create_source_data(os.path.join(KIT, 'src', f'{h}.glb'))
        prm = unreal.ImportAssetParameters(); prm.is_automated = True
        ok = mgr.import_asset(dest, src, prm)
        try: mgr.wait_until_all_tasks_done(False)
        except Exception: pass
        mesh = None
        for ap in eal.list_assets(dest, recursive=True, include_folder=False):
            if eal.find_asset_data(ap).asset_class_path.asset_name == 'StaticMesh':
                mesh = ap.split('.')[0]; sm = eal.load_asset(ap)
                ns = sm.get_editor_property('nanite_settings'); ns.set_editor_property('enabled', True); sm.set_editor_property('nanite_settings', ns)
                break
        eal.save_directory(dest, only_if_is_dirty=True, recursive=True)
        out[h] = {'ok': bool(ok) and mesh is not None, 'mesh': mesh, 'secs': round(time.time() - t, 2)}
    json.dump(out, open(C['result'], 'w'), indent=1)


def kit_hashes(cells):
    """the prototype hashes of the kit sets in a folder of cell glbs"""
    H = set()
    for fn in os.listdir(cells):
        if not fn.endswith('.glb'): continue
        b = open(os.path.join(cells, fn), 'rb').read(); L = struct.unpack('<I', b[12:16])[0]
        for n in json.loads(b[20:20 + L]).get('nodes', []):
            ex = n.get('extras') or {}
            if ex.get('kind') == 'kit' and ex.get('protoHash'): H.add(ex['protoHash'])
    return H


def main():
    import argparse
    from render_take import mat_sig
    ap = argparse.ArgumentParser()
    ap.add_argument('--cells', required=True); ap.add_argument('--out', default=os.path.join(KIT, 'runs', time.strftime('%Y%m%d-%H%M%S')))
    ap.add_argument('--jobs', type=int, default=4, help='editors importing at once (each its share of the new prototypes)')
    a = ap.parse_args()
    for d in ('src', 'runs'): os.makedirs(os.path.join(KIT, d), exist_ok=True)
    out = os.path.abspath(a.out); os.makedirs(out, exist_ok=True)
    ixp = os.path.join(KIT, 'index.json')
    IX = json.load(open(ixp)) if os.path.exists(ixp) else {}
    msig = mat_sig()
    want = kit_hashes(a.cells)
    new = sorted(h for h in want if not (IX.get(h) or {}).get('mesh'))
    rec = {'kit': len(want), 'new': len(new)}
    t0 = time.time()
    if new:   # (decompressed once, by hash)
        jobs = [[os.path.join(CELLCACHE, 'protos', f'{h}.glb'), os.path.join(KIT, 'src', f'{h}.glb')] for h in new if not os.path.exists(os.path.join(KIT, 'src', f'{h}.glb'))]
        if jobs:
            jp = os.path.join(out, 'decomp.json'); json.dump(jobs, open(jp, 'w'))
            subprocess.check_call(['node', os.path.join(HERE, 'r1c_decomp.mjs'), jp], stdout=subprocess.DEVNULL)
        nj = max(1, min(a.jobs, len(new))); procs = []
        for j in range(nj):
            cfg = {'hashes': new[j::nj], 'result': os.path.join(out, f'import{j}.json')}
            cp = os.path.join(out, f'cfg{j}.json'); json.dump(cfg, open(cp, 'w'))
            env = dict(os.environ, KIT_IMPORT_CFG=cp, **{'UE-LocalDataCachePath': os.environ.get('BXUE_DDC', '/data0/projectnyc_aux/ue/ddc'), 'UE-SharedDataCachePath': 'None'})
            env['UE_PYTHONPATH'] = os.pathsep.join([EXPORT, os.path.join(EXPORT, 'ue_project', 'Python'), HERE])
            procs.append((cfg, subprocess.Popen([os.path.join(UE_ROOT, 'Engine', 'Binaries', 'Linux', 'UnrealEditor-Cmd'), PROJECT, '-run=pythonscript',
                                                 f'-script={os.path.abspath(__file__)}', '-unattended', '-nosplash', '-nullrhi', '-stdout', '-FullStdOutLogOutput'],
                                                stdout=open(os.path.join(out, f'import{j}.log'), 'w'), stderr=subprocess.STDOUT, env=env)))
        R = {}; code = 0
        for cfg, p_ in procs:
            code = max(code, p_.wait())
            if os.path.exists(cfg['result']): R.update(json.load(open(cfg['result'])))
        for h, r in R.items():
            if r.get('ok'): IX[h] = {'mesh': r['mesh'], 'mat': None}
        rec.update(import_exit=code, imported=sum(1 for r in R.values() if r.get('ok')), import_s=round(time.time() - t0, 1))
    unbound = sorted(h for h in want if (IX.get(h) or {}).get('mesh') and IX[h].get('mat') != msig)
    if unbound:   # (the kit's materials by the cells' own binding, its folders and its prototypes' records)
        t1 = time.time(); md = os.path.join(out, 'bind_src'); os.makedirs(md, exist_ok=True)
        for h in unbound:
            p = os.path.join(md, f'{h}.glb')
            if not os.path.exists(p): os.symlink(os.path.join(KIT, 'src', f'{h}.glb'), p)
        code = subprocess.call(['python3', os.path.join(HERE, 'r1c_bind.py'), '--world-dest', ','.join(f'{ROOT_UE}/P_{h}' for h in unbound), '--cells', md,
                                '--out', os.path.join(out, 'bind')], stdout=open(os.path.join(out, 'bind.log'), 'w'), stderr=subprocess.STDOUT)
        if code == 0 and os.path.exists(os.path.join(out, 'bind', 'cellmat2.json')):
            for h in unbound: IX[h]['mat'] = msig
        rec.update(bind_exit=code, bound=len(unbound), bind_s=round(time.time() - t1, 1))
    tmp = ixp + f'.{os.getpid()}'; json.dump(IX, open(tmp, 'w'), indent=1); os.replace(tmp, ixp)
    rec['secs'] = round(time.time() - t0, 1)
    print(json.dumps(rec))


if __name__ == '__main__':
    try:
        import unreal  # noqa: F401
        IN_ENGINE = True
    except ImportError:
        IN_ENGINE = False
    in_engine() if IN_ENGINE else main()
