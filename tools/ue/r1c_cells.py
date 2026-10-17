#!/usr/bin/env python3
# R1C (lane C, 2026-10-11): lane A's cell packages imported once into a persistent Unreal world (docs/specs/cell-package.md
# section 9): each cell's uncompressed glb (tools/cells/export_plain.mjs) through Interchange's scene import into one
# level (the cell root at its origin, mesh nodes as Nanite static meshes); the instanced nodes (EXT_mesh_gpu_instancing,
# which Interchange does not read) as one actor per instance from the glb's own instance accessors (Nanite instances
# them); the light rig of a take (ue_light.apply with that take's prep and settings). Then any camera path renders
# from this level with tools/ue/r1c_path.py --level (no per-shot import).
#   python3 tools/ue/r1c_cells.py --cells <plain dir>/<region> [--only 0_6,-1_6] --level /Game/R1C/World/L_cplake
#       --light-side <prep json> --light-run <run.json> --out <dir>
import json, os, re, struct, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
EXPORT = os.path.abspath(os.path.join(HERE, '..', '..', 'client', 'tools', 'ar34', 'export'))
PROJECT = os.path.join(EXPORT, 'ue_project', 'BoundlessUE.uproject')
UE_ROOT = os.environ.get('UE_ROOT', '/data0/projectnyc_aux/ue/UE_5.8')


def glb_instances(path):
    """{node name: (mesh index, [(t, r, s)...])} for the EXT_mesh_gpu_instancing nodes, in the cell root's frame"""
    import numpy as np
    f = open(path, 'rb').read()
    L = struct.unpack('<I', f[12:16])[0]
    J = json.loads(f[20:20 + L])
    o = 20 + L
    bl = struct.unpack('<I', f[o:o + 4])[0]
    B = f[o + 8:o + 8 + bl]
    CT = {5126: ('f4', 4), 5123: ('u2', 2), 5121: ('u1', 1), 5122: ('i2', 2), 5120: ('i1', 1)}
    NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

    def acc(i):
        a = J['accessors'][i]; bv = J['bufferViews'][a['bufferView']]
        dt, sz = CT[a['componentType']]; n = NC[a['type']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        st = bv.get('byteStride') or sz * n
        raw = np.frombuffer(B, dtype=np.uint8, count=st * (a['count'] - 1) + sz * n, offset=off)
        arr = np.lib.stride_tricks.as_strided(raw, shape=(a['count'], sz * n), strides=(st, 1)).copy().view('<' + dt).reshape(a['count'], n)
        if a.get('normalized') and dt != 'f4':
            arr = arr.astype(np.float64) / {'u1': 255.0, 'u2': 65535.0, 'i1': 127.0, 'i2': 32767.0}[dt]
        return arr.astype(np.float64)
    out = {}
    for n in J['nodes']:
        ex = (n.get('extensions') or {}).get('EXT_mesh_gpu_instancing')
        if not ex or 'mesh' not in n: continue
        at = ex['attributes']
        T = acc(at['TRANSLATION']) if 'TRANSLATION' in at else None
        R = acc(at['ROTATION']) if 'ROTATION' in at else None
        S = acc(at['SCALE']) if 'SCALE' in at else None
        cnt = len(T if T is not None else R if R is not None else S)
        kind = (n.get('extras') or {}).get('kind')
        # GB43 KIT: a kit set's custom data per instance: tint, then KITA (grime, base, cornice shadow), KITB (texture offset u
        # v, size), then 1 (r1c_cellmat2.py's KitOn)
        cd = None
        if kind == 'kit':
            C3 = acc(at['_COLOR']) if '_COLOR' in at else np.ones((cnt, 3))
            A3 = acc(at['_KITA']) if '_KITA' in at else np.zeros((cnt, 3))
            B3 = acc(at['_KITB']) if '_KITB' in at else np.zeros((cnt, 3))
            cd = np.concatenate([C3, A3, B3, np.ones((cnt, 1))], axis=1)
        out[n.get('name') or f"node{J['nodes'].index(n)}"] = {'mesh': n['mesh'], 'mesh_name': J['meshes'][n['mesh']].get('name'), 'T': T, 'R': R, 'S': S, 'n': cnt,
                                                            'pool': (n.get('extras') or {}).get('pool'), 'kind': kind, 'cd': cd,
                                                            'node_t': n.get('translation'), 'node_r': n.get('rotation'), 'node_s': n.get('scale')}
    root = J['nodes'][J['scenes'][0]['nodes'][0]]
    return out, root


def board_uvs(path, out_dir):
    """BOARD45 (2026-10-15, the owner: Times Square's billboard textures broken, every board the whole ad atlas): a package
    whose board primitives carry the web's playlist (_aAd: class base, count, phase, duration; _aSize) as a copy with it in
    UV sets 1-3 as ue_prep's board_pack writes it for M_bx_board (st1 = base, count; st2 = phase, duration; st3 = size; a
    vinyl board as its fixed cell, a cycling board's phase reduced modulo its playlist; the city's sim time 0). Returns the
    copy's path, or None when the package has no board"""
    import numpy as np
    f = open(path, 'rb').read()
    L = struct.unpack('<I', f[12:16])[0]; J = json.loads(f[20:20 + L]); o = 20 + L
    B = f[o + 8:o + 8 + struct.unpack('<I', f[o:o + 4])[0]]
    mats = {i for i, m in enumerate(J.get('materials', [])) if 'aAd' in (((m.get('extras') or {}).get('three') or {}).get('obcAttrs') or [])}
    if not mats: return None
    extra = bytearray(); base0 = len(B) + (-len(B)) % 4
    def rd(ai, nc):
        a = J['accessors'][ai]; bv = J['bufferViews'][a['bufferView']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); st = bv.get('byteStride') or 4 * nc
        if st == 4 * nc: return np.frombuffer(B, '<f4', a['count'] * nc, off).reshape(-1, nc).astype(np.float64)
        return np.stack([np.frombuffer(B, '<f4', nc, off + i * st) for i in range(a['count'])]).astype(np.float64)
    def add(arr):
        data = np.ascontiguousarray(arr.astype('<f4')).tobytes(); off = base0 + len(extra)
        J['bufferViews'].append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}); extra.extend(data + b'\0' * ((-len(data)) % 4))
        J['accessors'].append({'bufferView': len(J['bufferViews']) - 1, 'componentType': 5126, 'count': int(arr.shape[0]), 'type': 'VEC2'})
        return len(J['accessors']) - 1
    n = 0
    for mesh in J['meshes']:
        for pr in mesh['primitives']:
            at = pr['attributes']
            if pr.get('material') not in mats or '_aAd' not in at: continue
            ad = rd(at['_aAd'], 4); sz = rd(at['_aSize'], 2) if '_aSize' in at else np.zeros((len(ad), 2))
            bs, cnt, ph, du = np.round(ad[:, 0]), np.round(ad[:, 1]), ad[:, 2].copy(), ad[:, 3].copy()
            vin = du > 1e5
            if vin.any():
                k_ = np.floor(ph[vin] / du[vin]); c_ = np.maximum(cnt[vin], 1)
                bs[vin] = bs[vin] + (k_ - c_ * np.floor(k_ / c_)); cnt[vin] = 1; ph[vin] = 0.0; du[vin] = 1000.0
            cyc = (du > 0) & ~vin & (cnt >= 1); per = cnt[cyc] * du[cyc]
            ph[cyc] = ph[cyc] - np.floor(ph[cyc] / per) * per
            at['TEXCOORD_1'] = add(np.stack([bs, cnt], 1)); at['TEXCOORD_2'] = add(np.stack([ph, du], 1)); at['TEXCOORD_3'] = add(sz[:, :2])
            if 'TEXCOORD_0' not in at: at['TEXCOORD_0'] = add(np.zeros((len(ad), 2)))
            n += 1
    if not n: return None
    NB = B + b'\0' * (base0 - len(B)) + bytes(extra); J['buffers'][0]['byteLength'] = len(NB)
    js = json.dumps(J, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
    os.makedirs(out_dir, exist_ok=True); dst = os.path.join(out_dir, os.path.basename(path))
    with open(dst, 'wb') as w:
        w.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(NB)))
        w.write(struct.pack('<II', len(js), 0x4E4F534A)); w.write(js); w.write(struct.pack('<II', len(NB), 0x004E4942)); w.write(NB)
    return dst


def ue_transforms(rec, cell_origin):
    """per instance the Unreal location (cm), rotation axes and scale: M_ue = C M_gltf C^-1, C = 100 x (x, z, y)"""
    import numpy as np
    n = rec['n']
    T = rec['T'] if rec['T'] is not None else np.zeros((n, 3))
    R = rec['R'] if rec['R'] is not None else np.tile([0, 0, 0, 1.0], (n, 1))
    S = rec['S'] if rec['S'] is not None else np.ones((n, 3))
    x, y, z, w = R[:, 0], R[:, 1], R[:, 2], R[:, 3]
    M = np.empty((n, 3, 3))
    M[:, 0, 0] = 1 - 2 * (y * y + z * z); M[:, 0, 1] = 2 * (x * y - z * w); M[:, 0, 2] = 2 * (x * z + y * w)
    M[:, 1, 0] = 2 * (x * y + z * w); M[:, 1, 1] = 1 - 2 * (x * x + z * z); M[:, 1, 2] = 2 * (y * z - x * w)
    M[:, 2, 0] = 2 * (x * z - y * w); M[:, 2, 1] = 2 * (y * z + x * w); M[:, 2, 2] = 1 - 2 * (x * x + y * y)
    A = M * S[:, None, :]                                    # (rotation x scale, columns scaled)
    P = np.array([[1, 0, 0], [0, 0, 1], [0, 1, 0]], float)
    Aue = P @ A @ P                                          # (the linear part in Unreal's axes; the 100 cancels)
    t = (np.asarray(cell_origin, float)[None] + T) @ P.T * 100.0
    cols = np.sqrt((Aue ** 2).sum(axis=1))                   # (the scale per column j: the norm over rows i)
    det = np.linalg.det(Aue)
    cols[:, 0] *= np.where(det < 0, -1.0, 1.0)
    Rue = Aue / cols[:, None, :]
    return t, Rue, cols


def in_engine():
    import unreal
    for p in (EXPORT, os.path.join(EXPORT, 'ue_project', 'Python')):
        if p not in sys.path: sys.path.insert(0, p)
    C = json.load(open(os.environ['R1C_CELLS_CFG']))
    eal = unreal.EditorAssetLibrary
    els = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    T = {'cells': {}}
    t0 = time.time()
    level = C['level']
    if C.get('append'):   # (lane B's far city into an existing world: its level loaded, no light rig)
        unreal.EditorLoadingAndSavingUtils.load_map(level)
    else:
        unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
    world = unreal.EditorLevelLibrary.get_editor_world()
    mgr = unreal.InterchangeManager.get_interchange_manager_scripted()
    # the tree pools drawn with the second tree set's prototypes (as usd_trees.py does: the Trunk pool's matrices, the Crown
    # pool dropped), from takes already imported (--tree-from: their SM_<F>_<size><v>_lod0 meshes and opaque leaves)
    import re
    TREE = re.compile(r'^tree([A-Z])(\d?)(Trunk|Crown)$')
    protos = {}
    for d in C.get('tree_from') or []:
        for ap in eal.list_assets(d, recursive=True, include_folder=False):
            nm = ap.split('/')[-1].split('.')[0]
            if re.match(r'^SM_[A-Z]_[yml]\d+_lod0$', nm): protos.setdefault(nm, ap.split('.')[0])
    T['tree_protos'] = len(protos)
    allp = sorted(protos)
    def proto_for(F, v, k):
        # (the size the pool asks for, else any size of the species, else any tree of the set: a web crown drawn without
        # its alpha reads as a dark angular blob, so every tree pool takes a prototype)
        names = [f'SM_{F}_y0_lod0', f'SM_{F}_y1_lod0'] if v == '9' else [f'SM_{F}_m0_lod0', f'SM_{F}_m1_lod0', f'SM_{F}_l0_lod0']
        names = [n for n in names if n in protos] or [n for n in allp if n.startswith(f'SM_{F}_')] or allp
        return eal.load_asset(protos[names[k % len(names)]]) if names else None
    # ==== GB43 (2026-10-12): one cell's import as a function: the glb's scene, its instance sets as ONE actor each with an
    # instanced static mesh component (all its transforms in one call; one actor per instance, ~160,000 in a world, was most
    # of the import and of the render's load), the trees by prototype; the cell's meshes on Nanite except the facades
    # carrying eight UV sets. Per-cell mode (C['per_cell']): each cell in its own level, <root>/<key>/L, under its content key
    sds = unreal.get_engine_subsystem(unreal.SubobjectDataSubsystem)
    SDL = unreal.SubobjectDataBlueprintFunctionLibrary
    def ism_actor(label, mesh, mats, xforms, folder, cd=None):
        act = els.spawn_actor_from_class(unreal.Actor, unreal.Vector(0, 0, 0))
        act.set_actor_label(label)
        root = sds.k2_gather_subobject_data_for_instance(act)[0]
        h, fail = sds.add_new_subobject(unreal.AddNewSubobjectParams(parent_handle=root, new_class=unreal.InstancedStaticMeshComponent))
        comp = SDL.get_object(SDL.get_data(h))
        comp.set_static_mesh(mesh)
        for i, m in enumerate(mats):
            if m is not None: comp.set_material(i, m)
        if cd:   # (GB43 KIT: the instances' custom data, r1c_cellmat2.py's K* inputs)
            comp.set_num_custom_data_floats(len(cd[0]))
        comp.add_instances(xforms, False, True)
        if cd:
            setter = getattr(comp, 'set_custom_data', None)
            for i_, v_ in enumerate(cd):
                if setter: setter(i_, v_, False)
                else:   # (5.8's Python has the one-value setter only)
                    for j_, f_ in enumerate(v_): comp.set_custom_data_value(i_, j_, float(f_), False)
            try: comp.mark_render_state_dirty()
            except Exception: pass
        act.set_folder_path(folder)
        return act
    def xf(v):
        rot = unreal.MathLibrary.make_rot_from_xz(unreal.Vector(*v[3:6]), unreal.Vector(*v[9:12]))   # (X and Z axes; Y follows)
        return unreal.Transform(unreal.Vector(*v[0:3]), rot, unreal.Vector(*v[12:15]))
    # ==== city v2: the shared material library (tools/ue/matlib.py). The pipeline asset (Interchange's glTF scene assets
    # pipeline with its material import off) is made once under a versioned name; each imported mesh's slots are pointed at
    # the library's instance of the slot's name (Interchange names a slot by the glTF material's sanitised name)
    LIBX = json.load(open(C['matlib'])) if C.get('matlib') else None
    NOMAT_PIPE = '/Game/V2/Pipelines/P_GLTFSceneAssetsNoMat_v1.P_GLTFSceneAssetsNoMat_v1'
    if LIBX is not None and unreal.load_asset(NOMAT_PIPE) is None:
        sa_ = unreal.load_asset('/Interchange/Pipelines/DefaultGLTFSceneAssetsPipeline.DefaultGLTFSceneAssetsPipeline')
        p_ = unreal.AssetToolsHelpers.get_asset_tools().duplicate_asset('P_GLTFSceneAssetsNoMat_v1', '/Game/V2/Pipelines', sa_)
        mp_ = p_.get_editor_property('material_pipeline')
        for k_, v_ in (('import_materials', False), ('create_new_materials', False), ('reuse_existing_materials', False)): mp_.set_editor_property(k_, v_)
        eal.save_loaded_asset(p_)
    LIBM = {}
    LIBH = {}   # (the library's keys by their content hash: a slot whose name Unreal suffixed still finds its key)
    for k_ in (LIBX or {}):
        for h_ in re.findall(r'(?<![0-9a-f])[0-9a-f]{16}(?![0-9a-f])', k_): LIBH.setdefault(h_, []).append(k_)
    def libkey(nm):
        if nm in LIBX: return nm
        cands = [c for h_ in re.findall(r'(?<![0-9a-f])[0-9a-f]{16}(?![0-9a-f])', nm) for c in LIBH.get(h_, [])]
        if not cands: return None
        def lcp(c):
            i = 0
            while i < min(len(c), len(nm)) and c[i] == nm[i]: i += 1
            return i
        return max(cands, key=lcp)
    MISSED = set()
    def libslots(dest):
        n_ = miss_ = 0
        for ap in eal.list_assets(dest, recursive=True, include_folder=False):
            if str(eal.find_asset_data(ap).asset_class_path.asset_name) != 'StaticMesh': continue
            sm = eal.load_asset(ap); ch = False
            for i, sl in enumerate(sm.get_editor_property('static_materials')):
                nm = str(sl.get_editor_property('material_slot_name'))
                lk = libkey(nm); e = LIBX.get(lk) if lk else None
                if not e: miss_ += 1; MISSED.add(nm); continue
                nm = lk
                if nm not in LIBM: LIBM[nm] = eal.load_asset(e['path'])
                if LIBM[nm] is not None: sm.set_material(i, LIBM[nm]); ch = True; n_ += 1
                else: miss_ += 1
            if ch: eal.save_loaded_asset(sm, only_if_is_dirty=False)
        return {'lib_slots': n_, 'lib_missing': miss_, 'lib_missed': sorted(MISSED)[:20]}
    def wide_of(key):
        w = set()
        try:
            b = open(os.path.join(C['dir'], f'{key}.glb'), 'rb').read(); n = int.from_bytes(b[12:16], 'little')
            g = json.loads(b[20:20 + n])
            for mi, me in enumerate(g.get('meshes', [])):
                if any('TEXCOORD_4' in p.get('attributes', {}) for p in me.get('primitives', [])): w.add(me.get('name') or 'm%d' % mi)
                # (GB43, 2026-10-14: and the tower glass, the meshes carrying the tower kit's glass attributes: Nanite drew
                # nothing of them, and 270 Park and One Vanderbilt were see-through grids)
                elif any('_aTkS' in p.get('attributes', {}) or '_aTkW' in p.get('attributes', {}) for p in me.get('primitives', [])): w.add(me.get('name') or 'm%d' % mi)
        except Exception as e_:
            T['wide_scan_error'] = str(e_)[:160]
        return w
    def nanite(dest, wide):
        """the cell's meshes on Nanite, the facades with eight UV sets off it (Nanite keeps four)"""
        nn = npl = 0
        for ap in eal.list_assets(dest, recursive=True, include_folder=False):
            if eal.find_asset_data(ap).asset_class_path.asset_name != 'StaticMesh': continue
            sm = eal.load_asset(ap); ns = sm.get_editor_property('nanite_settings')
            on = ap.split('/')[-1].split('.')[0] not in wide
            if ns.get_editor_property('enabled') != on:
                ns.set_editor_property('enabled', on); sm.set_editor_property('nanite_settings', ns)
            if on: nn += 1
            else: npl += 1
        return nn, npl
    def import_cell(key, dest, folder):
        glb = (C.get('board_src') or {}).get(key) or os.path.join(C['dir'], f'{key}.glb')   # (BOARD45: the copy with the boards' UV sets)
        t = time.time()
        before = set(a.get_name() for a in els.get_all_level_actors())
        src = unreal.InterchangeManager.create_source_data(glb)
        prm = unreal.ImportAssetParameters(); prm.is_automated = True
        if LIBX is not None:   # (city v2: the glTF scene stack with the assets pipeline that imports no materials)
            prm.set_editor_property('override_pipelines', [unreal.SoftObjectPath(NOMAT_PIPE), unreal.SoftObjectPath('/Interchange/Pipelines/DefaultGLTFPipeline.DefaultGLTFPipeline'),
                                                           unreal.SoftObjectPath('/Interchange/Pipelines/DefaultSceneLevelPipeline.DefaultSceneLevelPipeline')])
        ok = mgr.import_scene(dest, src, prm)
        try: mgr.wait_until_all_tasks_done(False)
        except Exception: pass
        new = [a for a in els.get_all_level_actors() if a.get_name() not in before]
        rec = {'ok': bool(ok), 'import_s': round(time.time() - t, 1), 'actors': len(new)}
        if LIBX is not None: rec.update(libslots(dest))
        insts = json.load(open(os.path.join(C['inst_dir'], f'{key}.json')))
        by_label = {}
        for a in new:
            by_label.setdefault(a.get_actor_label(), a)
        n_inst = n_ism = miss = n_tree = 0
        for name, ir in insts.items():
            a = by_label.get(name) or next((x for lb, x in by_label.items() if lb.startswith(name)), None)
            smc = a.get_component_by_class(unreal.StaticMeshComponent) if a else None
            sm = smc.get_editor_property('static_mesh') if smc else None
            if sm is None: miss += 1; continue
            mats = [smc.get_material(i) for i in range(smc.get_num_materials())]
            tm = TREE.match(ir.get('pool') or '') if protos else None
            if tm and tm.group(3) == 'Crown' and proto_for(tm.group(1), tm.group(2), 0) is not None:
                els.destroy_actor(a); continue
            tree = tm is not None and tm.group(3) == 'Trunk' and proto_for(tm.group(1), tm.group(2), 0) is not None
            if tree:   # (each instance its prototype by its index, as before: one component per prototype)
                byp = {}
                for k, v in enumerate(ir['x']):
                    pm = proto_for(tm.group(1), tm.group(2), k); byp.setdefault(pm.get_path_name(), (pm, []))[1].append(xf(v))
                for pi, (pm, xs) in enumerate(byp.values()):
                    ism_actor(f'{name}_t{pi}', pm, [], xs, folder)
                n_tree += ir['n']
            else:
                ism_actor(f'{name}_ism', sm, mats, [xf(v) for v in ir['x']], folder, ir.get('cd'))
            n_inst += ir['n']; n_ism += 1
            els.destroy_actor(a)
        rec.update(trees=n_tree, ism=n_ism, instances=n_inst, ism_missing=miss)
        t2 = time.time(); rec['nanite'], rec['plain'] = nanite(dest, wide_of(key)); rec['nanite_s'] = round(time.time() - t2, 1)
        return rec
    if C.get('per_cell'):
        for key in C['cells']:
            lvl = f"{C['per_cell']}/{key}/L"
            t = time.time()
            unreal.EditorLoadingAndSavingUtils.new_blank_map(False)
            world = unreal.EditorLevelLibrary.get_editor_world()
            rec = import_cell(key, f"{C['per_cell']}/{key}", f'R1C/{key}')
            eal.save_directory(f"{C['per_cell']}/{key}", only_if_is_dirty=True, recursive=True)
            rec['saved'] = bool(unreal.EditorLoadingAndSavingUtils.save_map(world, lvl))
            rec['level'] = lvl; rec['cell_s'] = round(time.time() - t, 1)
            T['cells'][key] = rec
            unreal.log(f'[r1c] cell {key} ' + json.dumps(rec))
            # (GB43, 2026-10-14: an editor importing 1,100 cells one after another grew to 126 GB and the machine ran out of
            # memory; each cell's objects collected, and the result written as each cell is saved, so a killed editor's
            # cells are kept)
            unreal.SystemLibrary.collect_garbage()
            json.dump(T, open(C['result'] + '.part', 'w')); os.replace(C['result'] + '.part', C['result'])
        T['import_all_s'] = round(time.time() - t0, 1); T['secs'] = T['import_all_s']
        json.dump(T, open(C['result'], 'w'), indent=1)
        unreal.log('[r1c] CELLS_DONE ' + json.dumps({k: v for k, v in T.items() if k != 'cells'})[:2000])
        return
    for key in C['cells']:
        rec = import_cell(key, f"{C['dest']}/{key}", f'R1C/{key}')
        T['cells'][key] = rec
        unreal.log(f'[r1c] cell {key} ' + json.dumps(rec))
    T['import_all_s'] = round(time.time() - t0, 1)
    # ==== GB43 end
    # the light rig of a take
    t = time.time()
    if C.get('append'): C['light_side'] = None
    try:
        if not C.get('light_side'): raise StopIteration
        import ue_light, importlib; importlib.reload(ue_light)
        side = json.load(open(C['light_side'])); run = json.load(open(C['light_run']))
        T['light'] = {k: v for k, v in (ue_light.apply(side, C['dest'] + '/Light', run, world) or {}).items() if k in ('mode', 'sun', 'sky', 'film', 'fog')}
    except StopIteration:
        T['light'] = 'kept'
    except Exception as e:
        import traceback
        T['light_error'] = f'{type(e).__name__}: {e}'; unreal.log_error('[r1c] light: ' + traceback.format_exc())
    T['light_s'] = round(time.time() - t, 1)
    t = time.time()
    eal.save_directory(C['dest'], only_if_is_dirty=True, recursive=True)
    unreal.EditorLoadingAndSavingUtils.save_map(world, level)
    T['save_s'] = round(time.time() - t, 1)
    T['secs'] = round(time.time() - t0, 1)
    json.dump(T, open(C['result'], 'w'), indent=1)
    unreal.log('[r1c] CELLS_DONE ' + json.dumps(T)[:3000])


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--cells', required=True); ap.add_argument('--only', default=None)
    ap.add_argument('--level', default='/Game/R1C/World/L_cplake'); ap.add_argument('--dest', default='/Game/R1C/World')
    ap.add_argument('--light-side', default=None); ap.add_argument('--light-run', default=None); ap.add_argument('--out', required=True)
    ap.add_argument('--append', action='store_true', help='import into the existing level (lane B\'s far city), keep its light')
    ap.add_argument('--tree-from', default=None, help='comma-separated content folders of imported takes whose tree prototypes draw the tree pools')
    ap.add_argument('--per-cell', default=None, help='GB43: each cell into its own level <root>/<key>/L under this content root (the cell cache)')
    ap.add_argument('--matlib', default=None, help='city v2: the shared material library\'s index (tools/ue/matlib.py): no materials imported, the slots pointed at the library')
    a = ap.parse_args()
    out = os.path.abspath(a.out); os.makedirs(out, exist_ok=True)
    keys = a.only.split(',') if a.only else sorted(f[:-4] for f in os.listdir(a.cells) if f.endswith('.glb'))
    C = {'dir': os.path.abspath(a.cells), 'cells': keys, 'level': a.level, 'dest': a.dest, 'light_side': a.light_side, 'light_run': a.light_run,
         'result': os.path.join(out, 'cells_import.json'), 'tree_from': a.tree_from.split(',') if a.tree_from else [], 'append': a.append,
         'per_cell': a.per_cell, 'matlib': os.path.abspath(a.matlib) if a.matlib else None}
    C['inst_dir'] = os.path.join(out, 'inst'); os.makedirs(C['inst_dir'], exist_ok=True)
    for key in keys:
        insts, root = glb_instances(os.path.join(a.cells, f'{key}.glb'))
        org = root.get('translation') or [0, 0, 0]
        J = {}
        for name, ir in insts.items():
            t_, R_, S_ = ue_transforms(ir, org)
            J[name] = {'n': ir['n'], 'pool': ir.get('pool'), 'x': [list(map(float, t_[k])) + list(map(float, R_[k][:, 0])) + list(map(float, R_[k][:, 1])) + list(map(float, R_[k][:, 2])) + list(map(float, S_[k]))
                                          for k in range(ir['n'])]}
            if ir.get('cd') is not None: J[name]['cd'] = [list(map(float, r_)) for r_ in ir['cd']]
        json.dump(J, open(os.path.join(C['inst_dir'], f'{key}.json'), 'w'))
        bp = board_uvs(os.path.join(a.cells, f'{key}.glb'), os.path.join(out, 'board'))   # BOARD45
        if bp: C.setdefault('board_src', {})[key] = bp
    cp = os.path.join(out, 'cells_cfg.json'); json.dump(C, open(cp, 'w'), indent=1)
    env = dict(os.environ, R1C_CELLS_CFG=cp, **{'UE-LocalDataCachePath': os.environ.get('BXUE_DDC', '/data0/projectnyc_aux/ue/ddc'), 'UE-SharedDataCachePath': 'None'})
    env['UE_PYTHONPATH'] = os.pathsep.join([EXPORT, os.path.join(EXPORT, 'ue_project', 'Python'), HERE])
    t0 = time.time()
    with open(os.path.join(out, 'cells_import.log'), 'w') as lf:
        code = subprocess.call([os.path.join(UE_ROOT, 'Engine', 'Binaries', 'Linux', 'UnrealEditor-Cmd'), PROJECT, '-run=pythonscript',
                                f'-script={os.path.abspath(__file__)}', '-unattended', '-nosplash', '-nullrhi', '-stdout', '-FullStdOutLogOutput'],
                               stdout=lf, stderr=subprocess.STDOUT, env=env)
    rec = {'process_s': round(time.time() - t0, 1), 'exit': code}
    try: rec['import'] = json.load(open(C['result']))
    except Exception: rec['import'] = None
    json.dump(rec, open(os.path.join(out, 'cells.json'), 'w'), indent=1)
    print(json.dumps({k: v for k, v in rec.items() if k != 'import'}), json.dumps({k: v for k, v in (rec['import'] or {}).items() if k != 'cells'})[:1500])


if __name__ == '__main__':
    try:
        import unreal  # noqa: F401
        IN_ENGINE = True
    except ImportError:
        IN_ENGINE = False
    in_engine() if IN_ENGINE else main()
