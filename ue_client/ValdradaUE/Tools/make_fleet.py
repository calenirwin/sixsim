"""The fleet library the client draws vehicles with: each kind's model (client/public/models/fleet24/<kind>.glb, the
web's own fleet) imported once as /Game/Client/Fleet/<kind>/SM_<kind>, its LOD0 only (the client's instanced meshes take the
engine's own levels of detail), from the importer's copies Tools/fleet_glb.mjs writes to Saved/fleet_glb (uncompressed,
PNG textures). Runs inside the editor:

    UnrealEditor-Cmd ue_client/ValdradaUE/ValdradaUE.uproject -run=pythonscript -script=<this file> -unattended -nosplash -nullrhi

FLEET_SRC overrides the model folder; FLEET_KINDS (comma separated) imports only those kinds. The assets made are listed
in Saved/fleet_assets.json (the client's own content: /Game/Client only).
"""
import json
import os
import struct

import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
SRC = os.environ.get('FLEET_SRC') or os.path.join(PROJECT, 'Saved', 'fleet_glb')
DEST = '/Game/Client/Fleet'
TMP = os.path.join(PROJECT, 'Saved', 'fleet_src')


def lod0_only(src, dst):
    """the model with its root and the LOD0 node only (the buffers kept whole: the unused views are left behind)"""
    b = open(src, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    J = json.loads(b[20:20 + n])
    rest = b[20 + n:]
    root = J['nodes'][J['scenes'][0]['nodes'][0]]
    keep = [c for c in root.get('children', []) if J['nodes'][c].get('name') == 'LOD0'] or root.get('children', [])[:1]
    root['children'] = keep
    # the root's extras hold the kind's metadata (lights, hubs); nothing in Unreal reads them
    js = json.dumps(J, separators=(',', ':')).encode('utf8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + len(rest)
    with open(dst, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A))
        f.write(js)
        f.write(rest)
    return J['nodes'][J['scenes'][0]['nodes'][0]].get('extras') or {}


def main():
    os.makedirs(TMP, exist_ok=True)
    only = set(filter(None, (os.environ.get('FLEET_KINDS') or '').split(',')))
    eal = unreal.EditorAssetLibrary
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    out = {}
    for fn in sorted(os.listdir(SRC)):
        if not fn.endswith('.glb'):
            continue
        kind = fn[:-4]
        if only and kind not in only:
            continue
        dest = f'{DEST}/{kind}'
        if eal.does_asset_exist(f'{dest}/SM_{kind}'):
            out[kind] = {'mesh': f'{dest}/SM_{kind}', 'kept': True}
            continue
        tmp = os.path.join(TMP, fn)
        meta = lod0_only(os.path.join(SRC, fn), tmp)
        t = unreal.AssetImportTask()
        t.set_editor_property('filename', tmp)
        t.set_editor_property('destination_path', dest)
        t.set_editor_property('automated', True)
        t.set_editor_property('replace_existing', True)
        t.set_editor_property('save', False)
        tools.import_asset_tasks([t])
        made = [p for p in eal.list_assets(dest, recursive=True, include_folder=False)]
        meshes = [p for p in made if isinstance(eal.load_asset(p), unreal.StaticMesh)]
        rec = {'assets': made, 'size': meta.get('size')}
        if meshes:
            sm = eal.load_asset(meshes[0])
            target = f'{dest}/SM_{kind}'
            if meshes[0].split('.')[0] != target:
                eal.rename_asset(meshes[0].split('.')[0], target)
            sm = eal.load_asset(target)
            bb = sm.get_bounding_box()
            rec.update(mesh=target, bounds_cm=[bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z])
        else:
            rec['error'] = 'no static mesh imported'
        eal.save_directory(dest, only_if_is_dirty=False, recursive=True)
        rec['assets'] = list(eal.list_assets(dest, recursive=True, include_folder=False))
        out[kind] = rec
        unreal.log(f'[fleet] {kind}: {rec.get("mesh") or rec.get("error")} {rec.get("bounds_cm")}')
    # the client draws a kind as one instanced mesh: without Nanite (the models' glass is translucent, which Nanite does
    # not draw) and with every material instance marked for instanced meshes (the importer's glTF masters are not, and a
    # cooked build cannot add the usage at run time)
    mel = unreal.MaterialEditingLibrary
    for kind, rec in out.items():
        dest = f'{DEST}/{kind}'
        sm = eal.load_asset(f'{dest}/SM_{kind}')
        if sm is None:
            continue
        ns = sm.get_editor_property('nanite_settings')
        if ns.get_editor_property('enabled'):
            ns.set_editor_property('enabled', False)
            sm.set_editor_property('nanite_settings', ns)
        n_mi = 0
        for p in eal.list_assets(dest, recursive=True, include_folder=False):
            a = eal.load_asset(p)
            if isinstance(a, unreal.MaterialInstanceConstant):
                mel.set_material_usage_override(a, unreal.MaterialUsage.MATUSAGE_INSTANCED_STATIC_MESHES, True, True)
                mel.update_material_instance(a)
                n_mi += 1
        eal.save_directory(dest, only_if_is_dirty=False, recursive=True)
        rec.update(nanite=False, instanced_usage=n_mi)
        unreal.log(f'[fleet] {kind}: Nanite off, {n_mi} material instances for instanced meshes')
    json.dump(out, open(os.path.join(PROJECT, 'Saved', 'fleet_assets.json'), 'w'), indent=1)
    unreal.log(f'[fleet] {len(out)} kinds; list in Saved/fleet_assets.json')


main()
