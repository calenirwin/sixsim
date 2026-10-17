#!/usr/bin/env python3
# GB43 KIT: a cell glb without its kit sets (their nodes out of the scene, their meshes out of the mesh list, the other
# nodes' mesh indices renumbered), for the import of the cell's unique meshes; its kit sets reach Unreal as its table
# (vcel_write.py) drawn by the cell actor. The buffers are kept as they are (an accessor no mesh names is not imported).
#   python3 tools/ue/kit_strip.py <src.glb> <dst.glb>
import json, os, struct, sys


def strip(src, dst):
    b = open(src, 'rb').read()
    L = struct.unpack('<I', b[12:16])[0]
    J = json.loads(b[20:20 + L]); rest = b[20 + L:]
    kit = {i for i, n in enumerate(J.get('nodes', [])) if (n.get('extras') or {}).get('kind') == 'kit'}
    if not kit:
        if src != dst: open(dst, 'wb').write(b)
        return 0
    drop_mesh = {J['nodes'][i]['mesh'] for i in kit if 'mesh' in J['nodes'][i]}
    keep_mesh = [m for m in range(len(J.get('meshes', []))) if m not in drop_mesh]
    remap = {old: new for new, old in enumerate(keep_mesh)}
    J['meshes'] = [J['meshes'][m] for m in keep_mesh]
    for i, n in enumerate(J['nodes']):
        if i in kit:
            n.pop('mesh', None); n.pop('extensions', None); n['extras'] = {'kind': 'kit_stripped'}
        elif 'mesh' in n:
            n['mesh'] = remap[n['mesh']]
        if 'children' in n: n['children'] = [c for c in n['children'] if c not in kit]
    for sc in J.get('scenes', []): sc['nodes'] = [c for c in sc.get('nodes', []) if c not in kit]
    js = json.dumps(J, separators=(',', ':')).encode(); js += b' ' * ((-len(js)) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + len(rest)) + struct.pack('<II', len(js), 0x4E4F534A) + js + rest
    tmp = dst + f'.{os.getpid()}.tmp'
    open(tmp, 'wb').write(out); os.replace(tmp, dst)
    return len(kit)


if __name__ == '__main__':
    print(strip(sys.argv[1], sys.argv[2]))
