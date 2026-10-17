"""A core take's actor tracks as the export pipeline's moving-set file (mov_<shot>.json, the format harvest.mjs writes
for usd_write.py, docs/notes/ar34-bx-seq.md), so the USD / Unreal / Blender path takes the core's vehicles, train cars
and signal states with no page harvest of the take. The vehicle groups (each kind's drawn parts, moving and parked) and
the train parts' geometry are reused from a template harvest of any shot (the fleet's bodies and the train models do not
change between takes); the cars, their per-frame matrices, lamps, wheel spin, steering and bend come from the tracks; the
train parts from tools/core/tracks_to_trains.mjs (--trains); the Lake's boats, rowers and oars from
tools/core/tracks_to_boats.mjs (--boats; the template must then be a harvest with the boats in it, e.g. the page's
harvest of a Lake shot); the signal heads from tools/core/signals_dump.mjs (--signals) with their lenses switched by the
take's signal states.

By default it writes an actors-only harvest: no static city (the cells are the city), no lights, the camera from the
tracks (cam_<shot>.json); --with-static keeps the template's static city and camera instead.

    python3 tools/core/tracks_to_mov.py --tracks <take>/tracks.atrk --template /data0/projectnyc_aux/tmp/bx/win/ht2 \
        --out <take>/harvest [--trains <take>/trains_<shot>.json] [--boats <take>/boats_<shot>.json] \
        [--signals shots/core/signals/<shot>.json]
then
    uv run --no-project --with usd-core --with numpy --with pillow python client/tools/ar34/export/usd_write.py \
        --in <out> --out <usd dir> --shots <shot> --nokeys --nohooks
(tools/core/actor_layers.sh runs the whole chain, walkers included.)
"""
import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from read_tracks import read_tracks  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--tracks', required=True)
ap.add_argument('--template', required=True, help='a harvest directory (harvest.mjs output) for the fleet groups and the static files')
ap.add_argument('--out', required=True)
ap.add_argument('--trains', default=None, help='the take\'s train part tracks (tools/core/tracks_to_trains.mjs) to add as movers')
ap.add_argument('--boats', default=None, help='the take\'s boat part tracks (tools/core/tracks_to_boats.mjs) to add as movers')
ap.add_argument('--signals', default=None, help='the signal heads and lenses around the take (tools/core/signals_dump.mjs) for its static layer, switched by state')
ap.add_argument('--signal-radius', type=float, default=400.0, help='signal heads within this many metres of the lens path')
ap.add_argument('--with-static', action='store_true', help='keep the template harvest\'s static city and camera (default: actors only, the camera from the tracks)')
a = ap.parse_args()

T = read_tracks(a.tracks)
H = T['header']
shot = H['shot']
nF = len(T['frames'])
man = json.load(open(os.path.join(a.template, 'manifest.json')))
tshot = next(iter(man['shots']))
tmov = json.load(open(os.path.join(a.template, man['shots'][tshot]['movFile'])))
groups = tmov['groups']
by_kind = {}
for G in groups:
    by_kind[(G['kind'], bool(G['moving']))] = G['gi']
kinds = [k['kind'] for k in H['vehicleKinds']]
actors = {x['id']: x for x in H['actors']}


def m12(x, y, z, q):
    qx, qy, qz, qw = q
    # rotation matrix columns (three's column-major elements without the last row: x axis, y axis, z axis, translation)
    xx, yy, zz, xy, xz, yz, wx, wy, wz = qx * qx, qy * qy, qz * qz, qx * qy, qx * qz, qy * qz, qw * qx, qw * qy, qw * qz
    return [round(v, 5) for v in (1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy),
                                  2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx),
                                  2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy),
                                  x, y, z)]


cars = {}
missing = {}
for f, F in enumerate(T['frames']):
    for v in F['veh']:
        kind = kinds[v['kind']]
        g = by_kind.get((kind, True))
        if g is None:
            missing[kind] = missing.get(kind, 0) + 1
            continue
        c = cars.get(v['id'])
        if c is None:
            A = actors[v['id']]
            c = cars[v['id']] = {'id': 'core:%d' % v['id'], 'g': g, 'slot': v['id'], 'kind': kind, 'moving': True, 'f0': f, 'f1': f, 'seed': A['seed'],
                                 'col': A['col'], 'paint': [A['metal'], A['grime'], A['rough']], 'drawn': 0, 'm': [], 'spin': [], 'steer': [], 'mask': [], 'bend': []}
        while c['f0'] + len(c['m']) < f:   # a frame it left the region in between holds its last pose
            for k in ('m', 'spin', 'steer', 'mask', 'bend'):
                c[k].append(c[k][-1])
        c['m'].append(m12(v['x'], v['y'], v['z'], v['q']))
        c['spin'].append(round(v['spin'], 4)); c['steer'].append(round(v['steer'], 4)); c['mask'].append(v['lamps']); c['bend'].append(round(v['bend'], 4))
        c['f1'] = f
        c['drawn'] += 1
parked = []
for p in H['parked']:
    g = by_kind.get((p['kind'], False))
    if g is None:
        missing[p['kind'] + ' (parked)'] = missing.get(p['kind'] + ' (parked)', 0) + 1
        continue
    parked.append({'id': 'core:p%d' % p['id'], 'g': g, 'slot': p['id'], 'kind': p['kind'], 'moving': False, 'f0': 0, 'f1': nF - 1, 'seed': p['seed'],
                   'col': p['col'], 'paint': [p['metal'], p['grime'], p['rough']], 'drawn': nF, 'm': [m12(p['x'], p['y'], p['z'], p['q'])], 'spin': [0], 'steer': [0], 'mask': [0], 'bend': [0]})
# signal lenses: the template's on-sets by (north-south, east-west) state, applied to the take's states
SIG = 'RAG'
states = [(SIG[F['sig'][0] & 3], SIG[(F['sig'][0] >> 2) & 3]) if F['sig'] else (None, None) for F in T['frames']]
# frames whose region holds no signal still have the shared 40 s clock (sim/signals.js signalState on the sim time)
def _state(t, ew):
    c = t % 40.0
    if not ew: return 'G' if c < 15 else 'A' if c < 18 else 'R'
    return 'G' if 20 <= c < 35 else 'A' if 35 <= c < 38 else 'R'
states = [s_ if s_[0] is not None else (_state(H['simTime'][i], False), _state(H['simTime'][i], True)) for i, s_ in enumerate(states)]
on_by_state = {}
for i, s in enumerate(tmov.get('sig') or []):
    if not s or s.get('ns') is None:
        continue
    key = (s['ns'], s['ew'])
    if key not in on_by_state:
        on_by_state[key] = {nm: per[i] for nm, per in (tmov.get('sigOn') or {}).items() if i < len(per)}
sig_on = {nm: [on_by_state.get(st, {}).get(nm) for st in states] for nm in (tmov.get('sigOn') or {})}
mov = {'fps': H['fps'], 'frames': nF, 'simTime': H['simTime'], 'night': [H.get('night', 0)] * nF,
       'sig': [{'ns': ns, 'ew': ew} for ns, ew in states], 'sigOn': sig_on,
       'groups': groups, 'cars': list(cars.values()) + parked, 'movers': [], 'trains': [None] * nF, 'fleetErr': tmov.get('fleetErr'),
       'source': {'core': os.path.relpath(a.tracks), 'made': H.get('made'), 'seed': H.get('seed'), 'template': a.template}}
os.makedirs(a.out, exist_ok=True)
# train cars as movers: each part set (a train car kind's body material at a level, its doors, trucks, wheels, coupling
# gaps) matched to the template harvest's mover of the same material and vertex count, which carries its geometry and
# material numbers
ntrain = 0
if a.trains:
    TR = json.load(open(a.trains))
    by_sig = {}
    for mv in tmov.get('movers') or []:
        g = man['geos'][mv['geo']] if isinstance(mv.get('geo'), int) and mv['geo'] < len(man['geos']) else None
        cnt = next((L['count'] for L in (g or {}).get('layout', []) if L['name'] == 'position'), None)
        mname = man['mats'][mv['mats'][0]]['name'] if mv.get('mats') and mv['mats'][0] < len(man['mats']) else None
        by_sig.setdefault((mname, cnt), mv)
    for S_ in TR['sets']:
        mv = by_sig.get(('tr:' + S_['mat'], S_['vtx']))
        if mv is None:
            missing['train %s %s %s' % (S_['kind'], S_['role'], S_['mat'])] = len(S_['tracks'])
            continue
        mov['movers'].append({'key': 'core:%s:%s:%d:%s' % (S_['kind'], S_['role'], S_.get('lod', 0), S_['mat']), 'name': 'trains:tr:%s < trains' % S_['mat'], 'geo': mv['geo'], 'mats': mv['mats'],
                              'castShadow': mv.get('castShadow', True), 'tracks': S_['tracks']})
        ntrain += len(S_['tracks'])
    mov['trains'] = TR.get('cars') or mov['trains']
# the Lake's boats as movers: each part set (the fleet's hull, inner shell, wood, floor, metal and oars, each rower or
# passenger at a level, the moored boats' hull and inner shell) matched to the template harvest's mover of the same mesh
# name and vertex count, which carries its geometry and material numbers
nboat = 0
if a.boats:
    BO = json.load(open(a.boats))
    by_name = {}
    for mv in tmov.get('movers') or []:
        g = man['geos'][mv['geo']] if isinstance(mv.get('geo'), int) and mv['geo'] < len(man['geos']) else None
        cnt = next((L['count'] for L in (g or {}).get('layout', []) if L['name'] == 'position'), None)
        by_name.setdefault((mv['name'].split(' < ')[0], cnt), mv)
    for S_ in BO.get('sets') or []:
        nm = S_['name'].split(' < ')[0]
        mv = by_name.get((nm, S_['vtx']))
        if mv is None:
            missing['boat set ' + nm] = len(S_['tracks'])
            continue
        mov['movers'].append({'key': 'core:' + nm, 'name': S_['name'], 'geo': mv['geo'], 'mats': mv['mats'],
                              'castShadow': S_.get('castShadow', mv.get('castShadow', True)), 'tracks': S_['tracks']})
        nboat += len(S_['tracks'])
keep = (lambda name: True) if a.with_static else (lambda name: name in ('geo', 'tex', 'textures'))
for name in os.listdir(a.template):
    dst = os.path.join(a.out, name)
    if name.startswith('mov_') or name == 'manifest.json' or os.path.lexists(dst) or not keep(name):
        continue
    os.symlink(os.path.join(os.path.abspath(a.template), name), dst)
info = dict(man['shots'][tshot]) if a.with_static else {}
info['movFile'] = 'mov_%s.json' % shot
man2 = dict(man)
if not a.with_static:
    # actors only: an empty static city (the cells are the city), no lights of the page's (the renderer lights its own),
    # the camera from the tracks (three's camera matrix per frame, as harvest.mjs writes cam_<shot>.json)
    empty = {'objects': [], 'pools': [], 'instanced': [], 'hide': {}, 'nearTiles': {}}
    shot_static = dict(empty)
    if a.signals and not os.path.exists(a.signals):   # (GB43: a shot with no signal in range writes no signals file: over a river)
        print(f'[mov] no signals file ({a.signals}): no signal heads')
    if a.signals and os.path.exists(a.signals):
        # the signal heads the cells leave out: the page's head and lens instances near the path (their geometry and
        # material numbers from the template harvest's pools of the same names), the lenses at full scale; the lens
        # on-sets per frame from the core's signal states through the registry (sim/signals.js SignalController rules)
        SD = json.load(open(a.signals))
        tst = json.load(open(os.path.join(a.template, 'static.json')))
        tpools = {p_['name']: p_ for p_ in tst.get('pools', [])}
        path_pts = (H.get('region') or {}).get('path') or [[c[0], c[2]] for c in H['camera']['rows']]
        R2 = a.signal_radius ** 2
        near = lambda x, z: any((x - px) ** 2 + (z - pz) ** 2 <= R2 for px, pz in path_pts)
        keep_slots = {}
        for name in ('signalHead', 'signalLens', 'sigR', 'sigA', 'sigG', 'pedHand', 'pedMan'):
            tp = tpools.get(name)
            inst = [e for e in SD['pools'].get(name, []) if near(e['m'][12], e['m'][14])]
            if not tp or not inst:
                if inst: missing['signal pool ' + name] = len(inst)
                continue
            mats16 = []
            for e in inst:
                m = list(e['m'])
                for c in (0, 4, 8):   # each axis back to unit length: a dark lens is claimed at 0.001
                    L = math.sqrt(m[c] ** 2 + m[c + 1] ** 2 + m[c + 2] ** 2) or 1.0
                    m[c] /= L; m[c + 1] /= L; m[c + 2] /= L
                mats16.extend(m)
            cols = []
            for e in inst: cols.extend(e.get('c') or [1.0, 1.0, 1.0])
            shot_static['pools'].append({'name': name, 'geo': tp['geo'], 'mats': tp['mats'], 'n': len(inst), 'matrices': mats16, 'colors': cols,
                                         'slots': [e['slot'] for e in inst], 'isTree': False, 'castShadow': tp.get('castShadow', False)})
            keep_slots[name] = set(e['slot'] for e in inst)
        sig_on = {lp: [] for lp in ('sigR', 'sigA', 'sigG', 'pedHand', 'pedMan')}
        for ns, ew in states:
            on = {lp: [] for lp in sig_on}
            for e in SD['reg']:
                ids = e.get('ids') or {}
                if e.get('heads'):
                    st_ = ew if e.get('servesEW') else ns
                    for lp in ('sigR', 'sigA', 'sigG'):
                        if st_ == lp[3]: on[lp].extend(i for i in (ids.get(lp) or []) if i is not None and i >= 0)
                    continue
                rot = e.get('rot') or 0.0
                axis_ew = abs(math.sin(rot)) > abs(math.cos(rot))
                st_ = ew if axis_ew else ns
                if e.get('veh'):
                    for lp in ('sigR', 'sigA', 'sigG'):
                        if st_ == lp[3] and isinstance(ids.get(lp), int) and ids[lp] >= 0: on[lp].append(ids[lp])
                else:
                    walk = st_ == 'G'
                    lp = 'pedMan' if walk else 'pedHand'
                    if isinstance(ids.get(lp), int) and ids[lp] >= 0: on[lp].append(ids[lp])
            for lp in sig_on: sig_on[lp].append(sorted(i for i in on[lp] if i in keep_slots.get(lp, ())))
        mov['sigOn'] = sig_on
        nsig_heads = sum(p_['n'] for p_ in shot_static['pools'] if p_['name'] == 'signalHead')
        print('signals: %d heads, %s lens instances near the path; the lenses switch with the core\'s states' % (nsig_heads, {p_['name']: p_['n'] for p_ in shot_static['pools'] if p_['name'] not in ('signalHead', 'signalLens')}))
        json.dump(mov, open(os.path.join(a.out, 'mov_%s.json' % shot), 'w'))
    json.dump(empty, open(os.path.join(a.out, 'static.json'), 'w'))
    json.dump(shot_static, open(os.path.join(a.out, 'static_%s.json' % shot), 'w'))
    # the take's own light (tools/core/light_bake.mjs) when it has been baked into this folder; else no page lights
    if not os.path.exists(os.path.join(a.out, 'lights.json')):
        L = json.load(open(os.path.join(a.template, 'lights.json'))); L['lights'] = []
        json.dump(L, open(os.path.join(a.out, 'lights.json'), 'w'))
    cams = []
    for r in H['camera']['rows']:
        x, y, z, qx, qy, qz, qw, fov = r
        xx, yy, zz, xy, xz, yz, wx, wy, wz = qx * qx, qy * qy, qz * qz, qx * qy, qx * qz, qy * qz, qw * qx, qw * qy, qw * qz
        m = [1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy), 0, 2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx), 0, 2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy), 0, x, y, z, 1]
        cams.append({'m': m, 'fov': fov, 'aspect': 16 / 9, 'near': 0.4, 'far': 20000, 'zoom': 1, 'filmGauge': 35, 'filmOffset': 0, 'focus': 10})
    json.dump(cams, open(os.path.join(a.out, 'cam_%s.json' % shot), 'w'))
    c0 = H['camera']['rows'][0]
    info.update({'title': H.get('title', ''), 'time': H.get('time', ''), 'frames': nF, 'fov': c0[7], 'camFile': 'cam_%s.json' % shot,
                 'staticFile': 'static_%s.json' % shot, 'key': [], 'hide': {}})
    man2['centreXZ'] = [round(c0[0], 2), round(c0[2], 2)]   # the take root recentres /World here (usd_write root_layer)
    man2['flags'] = (H.get('query') or '').lstrip('?')
    man2['when'] = 'core take %s seed %s (%s)' % (shot, H.get('seed'), (H.get('made') or {}).get('code', ''))
prev = json.load(open(os.path.join(a.out, 'manifest.json'))) if os.path.exists(os.path.join(a.out, 'manifest.json')) else None
man2['shots'] = {shot: {**((prev or {}).get('shots', {}).get(shot, {})), **info}}
json.dump(man2, open(os.path.join(a.out, 'manifest.json'), 'w'))
json.dump(mov, open(os.path.join(a.out, 'mov_%s.json' % shot), 'w'))
print('%s: %d moving + %d parked vehicles, %d train part tracks, %d boat part tracks over %d frames into %s; signal states mapped %d of %d frames; without a template part: %s' % (
    shot, len(cars), len(parked), ntrain, nboat, nF, a.out, sum(1 for s in states if s in on_by_state), nF, missing or 'none'))
if a.with_static and shot != tshot:
    print('note: the template harvest is of %s; its static files and camera are that shot\'s' % tshot)
