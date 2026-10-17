"""Reads an ATRK v1 actor-tracks file (docs/specs/actor-tracks.md) with the standard library only, so it runs inside
Unreal's or Blender's Python as it is.

    python3 tools/core/read_tracks.py shots/core/tuApolloSweep_s1/tracks.atrk          # a summary
    python3 tools/core/read_tracks.py <file> --frame 0 --ue                              # frame 0's actors in Unreal units

In a script:
    from read_tracks import read_tracks, to_ue
    T = read_tracks(path)            # {'header': {...}, 'frames': [{'veh': [...], 'walk': [...], 'sig': bytes}, ...]}
    loc_cm, quat_xyzw = to_ue(v['x'], v['y'], v['z'], v['q'])
"""
import json
import math
import struct
import sys

MAGIC = 0x4B525441  # 'ATRK'
VEH = struct.Struct('<I3f4f4fBBH')     # 52 bytes
WALK = struct.Struct('<I3f6fBBH')      # 44 bytes
TRAIN = struct.Struct('<I4f4f4f3fBBBbBBH')   # 72 bytes


def read_tracks(path):
    with open(path, 'rb') as f:
        b = f.read()
    magic, version, hl = struct.unpack_from('<III', b, 0)
    if magic != MAGIC:
        raise ValueError('not an ATRK file')
    header = json.loads(b[12:12 + hl].decode('utf-8'))
    o = 12 + hl
    (n,) = struct.unpack_from('<I', b, o)
    o += 4
    offsets = struct.unpack_from('<%dI' % n, b, o)
    frames = []
    for p in offsets:
        nv, nw, ns, nt = struct.unpack_from('<4H', b, p)
        p += 8
        veh, walk, train = [], [], []
        for _ in range(nv):
            r = VEH.unpack_from(b, p)
            p += VEH.size
            veh.append({'id': r[0], 'x': r[1], 'y': r[2], 'z': r[3], 'q': r[4:8], 'v': r[8], 'spin': r[9], 'steer': r[10], 'bend': r[11],
                        'lamps': r[12], 'flags': r[13], 'kind': r[14]})
        for _ in range(nw):
            r = WALK.unpack_from(b, p)
            p += WALK.size
            walk.append({'id': r[0], 'x': r[1], 'y': r[2], 'z': r[3], 'yaw': r[4], 'v': r[5], 'phase': r[6], 'hz': r[7], 'sxz': r[8], 'sy': r[9],
                         'amp': r[10] / 255.0, 'pose': r[11], 'pace': r[12] / 10000.0})
        sig = b[p:p + ns]
        p += (ns + 3) & ~3
        for _ in range(nt):
            r = TRAIN.unpack_from(b, p)
            p += TRAIN.size
            train.append({'id': r[0], 'x': r[1], 'y': r[2], 'z': r[3], 'yaw': r[4], 'ta': r[5:9], 'tb': r[9:13], 'roll': r[13], 'doors': r[14], 'v': r[15],
                          'lamps': r[16], 'kind': r[17], 'flags': r[18], 'side': r[19], 'num': r[20], 'dest': r[21]})
        frames.append({'veh': veh, 'walk': walk, 'sig': sig, 'train': train})
    return {'version': version, 'header': header, 'frames': frames}


def to_ue(x, y, z, q=None, origin=(0.0, 0.0, 0.0)):
    """The tracks' world (metres; x east, y up, z south) -> Unreal (cm; X east, Y south, Z up), the convention of the
    export's ue_light.ue_pos. A rotation follows the same axis swap: quaternion (x, y, z, w) -> (-x, -z, -y, w)."""
    loc = ((x - origin[0]) * 100.0, (z - origin[2]) * 100.0, (y - origin[1]) * 100.0)
    if q is None:
        return loc
    return loc, (-q[0], -q[2], -q[1], q[3])


def yaw_quat(yaw):
    """a walker's yaw (radians about +y, 0 = facing +z) as a quaternion (x, y, z, w) in the tracks' world"""
    return (0.0, math.sin(yaw / 2), 0.0, math.cos(yaw / 2))


SIG = 'RAG'


def signal_states(code):
    """a signal byte -> (north-south state, east-west state), each 'R', 'A' or 'G'"""
    return SIG[code & 3], SIG[(code >> 2) & 3]


if __name__ == '__main__':
    path = sys.argv[1]
    T = read_tracks(path)
    H = T['header']
    kinds = [k['kind'] for k in H['vehicleKinds']]
    acts = H['actors']
    print('%s seed %s: %d frames at %s fps, %d vehicles + %d walkers + %d train cars tracked, %d parked, %d signals' % (
        H.get('shot'), H.get('seed'), len(T['frames']), H.get('fps'), sum(a['type'] == 'vehicle' for a in acts),
        sum(a['type'] == 'walker' for a in acts), sum(a['type'] == 'train' for a in acts), len(H['parked']), len(H['signals']['list'])))
    if '--frame' in sys.argv:
        i = int(sys.argv[sys.argv.index('--frame') + 1])
        F = T['frames'][i]
        ue = '--ue' in sys.argv
        for v in F['veh'][:12]:
            pos = to_ue(v['x'], v['y'], v['z'], v['q']) if ue else ((v['x'], v['y'], v['z']), v['q'])
            print('veh %5d %-10s v %5.2f lamps %02x loc %s q %s' % (v['id'], kinds[v['kind']], v['v'], v['lamps'],
                  tuple(round(c, 2) for c in pos[0]), tuple(round(c, 4) for c in pos[1])))
        for w in F['walk'][:12]:
            pos = to_ue(w['x'], w['y'], w['z'], yaw_quat(w['yaw'])) if ue else ((w['x'], w['y'], w['z']), yaw_quat(w['yaw']))
            print('walk %5d v %4.2f phase %.3f amp %.0f loc %s' % (w['id'], w['v'], w['phase'], w['amp'], tuple(round(c, 2) for c in pos[0])))
        for t in F['train'][:4]:
            print('train %5d %-5s v %5.2f doors %.2f loc %s yaw %.3f' % (t['id'], H['trainKinds'][t['kind']], t['v'], t['doors'],
                  tuple(round(c, 2) for c in (to_ue(t['x'], t['y'], t['z']) if ue else (t['x'], t['y'], t['z']))), t['yaw']))
        if F['sig']:
            print('signals ns/ew:', signal_states(F['sig'][0]))
