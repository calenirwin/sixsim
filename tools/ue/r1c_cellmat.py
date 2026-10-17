#!/usr/bin/env python3
# R1C (lane C, 2026-10-11): the cells world's materials resolved by key (docs/specs/cell-package.md section 4) from the
# takes' resolved materials: a cell material (Interchange's instance of its glTF factors) whose three.js name matches a
# tagged material of an imported take (ue_prep's `bx` tags, ue_mat's instances of the family masters) takes that
# instance's master, parameters and blend overrides. The per-vertex data the masters read from the takes' UV sets (the
# kit's tint, vertex colours) is not in the cells' meshes, so those switches go off. Materials with no match keep their
# glTF factors.
#   python3 tools/ue/r1c_cellmat.py --world-dest /Game/R1C/W_cplake --cells <plain dir>/<region>
#       --take /Game/Takes/r1c_scLakeGolden=<prep json> [--take ...] --out <dir>
import json, os, re, struct, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
EXPORT = os.path.abspath(os.path.join(HERE, '..', '..', 'client', 'tools', 'ar34', 'export'))
PROJECT = os.path.join(EXPORT, 'ue_project', 'BoundlessUE.uproject')
UE_ROOT = os.environ.get('UE_ROOT', '/data0/projectnyc_aux/ue/UE_5.8')
OFF = ('FkOn', 'VcOn')   # (switches that read the takes' st1-st3 data)


def san(s):
    return re.sub(r'[^A-Za-z0-9]', '_', s or '')


def cell_records(cells):
    """{sanitised material name: three record} over every cell glb of the region"""
    R = {}
    for fn in sorted(os.listdir(cells)):
        if not fn.endswith('.glb'): continue
        f = open(os.path.join(cells, fn), 'rb').read()
        L = struct.unpack('<I', f[12:16])[0]
        J = json.loads(f[20:20 + L])
        ground = set()
        for n in J.get('nodes', []):   # (the ground's materials: the nodes whose class is per vertex, -1)
            if (n.get('extras') or {}).get('class') == -1 and 'mesh' in n:
                ground |= {pr.get('material') for pr in J['meshes'][n['mesh']]['primitives']}
        for mi, m in enumerate(J.get('materials', [])):
            r = dict((m.get('extras') or {}).get('three') or {})
            if mi in ground: r['_kind'] = 'ground'
            R.setdefault(san(m.get('name')), r)
    return R


def in_engine():
    import unreal
    for p in (EXPORT, os.path.join(EXPORT, 'ue_project', 'Python')):
        if p not in sys.path: sys.path.insert(0, p)
    import ue_mat
    C = json.load(open(os.environ['R1C_CELLMAT_CFG']))
    eal = unreal.EditorAssetLibrary; mel = unreal.MaterialEditingLibrary
    T = {'lib': 0, 'matched': 0, 'unmatched': {}, 'by_name': {}}
    t0 = time.time()
    lib = {}
    for tk in C['takes']:
        tags = json.load(open(tk['side'])).get('materials') or {}
        for ap in eal.list_assets(tk['dest'], recursive=True, include_folder=False):
            if '/BxTex/' in ap or eal.find_asset_data(ap).asset_class_path.asset_name != 'MaterialInstanceConstant': continue
            mi = eal.load_asset(ap)
            nm = ap.split('/')[-1].split('.')[0]
            for pn in (ue_mat.prim_names(mi) or [nm[3:] if nm.startswith('MI_') else nm]):
                tg = tags.get(pn)
                if tg and tg.get('name') and tg['name'] not in lib:
                    lib[tg['name']] = mi
                if tg and tg.get('kind') == 'ground' and '#ground' not in lib:   # (the ground by its family)
                    lib['#ground'] = mi
    T['lib'] = len(lib)
    recs = json.load(open(C['records']))
    keys = sorted(recs, key=len, reverse=True)
    for ap in eal.list_assets(C['world_dest'], recursive=True, include_folder=False):
        if eal.find_asset_data(ap).asset_class_path.asset_name != 'MaterialInstanceConstant': continue
        nm = ap.split('/')[-1].split('.')[0]
        k = next((k for k in keys if nm.startswith(k)), None)
        three = recs.get(k) or {}
        tname = three.get('name') or ''
        gen_alpha = (not tname) and float(three.get('alphaTest') or 0) > 0 and any((t or {}).get('generated') for t in (three.get('textures') or {}).values())
        if tname in (C.get('hide') or []) or (gen_alpha and C.get('hide_generated_alpha')):   # (sets that do not resolve yet: alpha cards
            # whose atlas is generated at run time (v0 exports none: the willows' and ferns' crowns) and named sets listed;
            # drawn by the hidden master, counted)
            mi = eal.load_asset(ap); hm = eal.load_asset('/Game/Bx/M_bx_hidden')
            if hm is not None:
                mel.set_material_instance_parent(mi, hm); mel.update_material_instance(mi)
                T['hidden'] = T.get('hidden', 0) + 1; continue
        src = lib.get(tname) if tname else None
        if src is None and three.get('_kind') == 'ground': src = lib.get('#ground'); tname = tname or '#ground'
        if src is None:
            T['unmatched'][tname or '(unnamed)'] = T['unmatched'].get(tname or '(unnamed)', 0) + 1
            continue
        mi = eal.load_asset(ap)
        try:
            mel.set_material_instance_parent(mi, src.get_editor_property('parent'))
            for prop in ('scalar_parameter_values', 'vector_parameter_values', 'texture_parameter_values'):
                mi.set_editor_property(prop, src.get_editor_property(prop))
            try: mi.set_editor_property('base_property_overrides', src.get_editor_property('base_property_overrides'))
            except Exception: pass
            for p_ in (() if C.get('keep_switches') else OFF):   # (cells with the packed UV sets keep them, tools/ue/r1c_glbuv.py)
                try: mel.set_material_instance_scalar_parameter_value(mi, p_, 0.0)
                except Exception: pass
            mel.update_material_instance(mi)
            T['matched'] += 1; T['by_name'][tname] = T['by_name'].get(tname, 0) + 1
        except Exception as e:
            T.setdefault('failed', {})[nm] = str(e)[:160]
    t = time.time()
    eal.save_directory(C['world_dest'], only_if_is_dirty=True, recursive=True)
    T['save_s'] = round(time.time() - t, 1)
    T['secs'] = round(time.time() - t0, 1)
    T['unmatched'] = dict(sorted(T['unmatched'].items(), key=lambda kv: -kv[1])[:40])
    json.dump(T, open(C['result'], 'w'), indent=1)
    unreal.log('[r1c] CELLMAT_DONE ' + json.dumps({k: v for k, v in T.items() if k not in ('by_name', 'unmatched')}))


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--world-dest', required=True); ap.add_argument('--cells', required=True)
    ap.add_argument('--take', action='append', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--hide', default='', help='comma-separated three.js material names drawn hidden (sets that do not resolve yet)')
    ap.add_argument('--hide-generated-alpha', action='store_true', help='hide unnamed alpha cards whose atlas is generated at run time')
    ap.add_argument('--keep-switches', action='store_true', help='the cells carry the packed UV sets (r1c_glbuv.py): the masters\' kit and colour switches stay')
    a = ap.parse_args()
    out = os.path.abspath(a.out); os.makedirs(out, exist_ok=True)
    rp = os.path.join(out, 'records.json'); json.dump(cell_records(a.cells), open(rp, 'w'))
    C = {'world_dest': a.world_dest, 'records': rp, 'result': os.path.join(out, 'cellmat.json'), 'keep_switches': a.keep_switches,
         'hide': [x for x in a.hide.split(',') if x], 'hide_generated_alpha': a.hide_generated_alpha,
         'takes': [{'dest': t.split('=')[0], 'side': t.split('=')[1]} for t in a.take]}
    cp = os.path.join(out, 'cellmat_cfg.json'); json.dump(C, open(cp, 'w'), indent=1)
    env = dict(os.environ, R1C_CELLMAT_CFG=cp, **{'UE-LocalDataCachePath': os.environ.get('BXUE_DDC', '/data0/projectnyc_aux/ue/ddc'), 'UE-SharedDataCachePath': 'None'})
    env['UE_PYTHONPATH'] = os.pathsep.join([EXPORT, os.path.join(EXPORT, 'ue_project', 'Python'), HERE])
    t0 = time.time()
    with open(os.path.join(out, 'cellmat.log'), 'w') as lf:
        code = subprocess.call([os.path.join(UE_ROOT, 'Engine', 'Binaries', 'Linux', 'UnrealEditor-Cmd'), PROJECT, '-run=pythonscript',
                                f'-script={os.path.abspath(__file__)}', '-unattended', '-nosplash', '-nullrhi', '-stdout', '-FullStdOutLogOutput'],
                               stdout=lf, stderr=subprocess.STDOUT, env=env)
    rec = {'process_s': round(time.time() - t0, 1), 'exit': code}
    try: rec['result'] = json.load(open(C['result']))
    except Exception: rec['result'] = None
    json.dump(rec, open(os.path.join(out, 'cellmat_run.json'), 'w'), indent=1)
    r = rec['result'] or {}
    print(json.dumps({'process_s': rec['process_s'], 'exit': code, 'lib': r.get('lib'), 'matched': r.get('matched'), 'save_s': r.get('save_s'),
                      'unmatched_top': list((r.get('unmatched') or {}).items())[:12]}))


if __name__ == '__main__':
    try:
        import unreal  # noqa: F401
        IN_ENGINE = True
    except ImportError:
        IN_ENGINE = False
    in_engine() if IN_ENGINE else main()
