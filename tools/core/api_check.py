"""Every method of docs/api/protocol.md that needs no pixels, called once against a running server (the page's, through
server/main.js, or the headless core's, tools/core/serve.mjs) with a check of what comes back; the sensors' listen is
expected to answer needs_renderer on the core and data on a renderer. Prints one line per method and a summary.

    python3 tools/core/api_check.py [--port 2000] [--host 127.0.0.1] [--json out.json]
"""
import argparse
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'PythonAPI'))
import valdrada  # noqa: E402
from valdrada.transport import ValdradaError  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--host', default='127.0.0.1')
ap.add_argument('--port', type=int, default=2000)
ap.add_argument('--json', default=None)
a = ap.parse_args()
client = valdrada.Client(a.host, a.port, timeout=60)
client.set_timeout(120)
T = client._transport
rows = []


def call(m, **p):
    return T.call(m, p)


def check(method, fn, expect_error=None):
    t0 = time.time()
    try:
        r = fn()
        ok, note = (False, 'expected the error %s' % expect_error) if expect_error else (True, r if isinstance(r, str) else '')
    except ValdradaError as e:
        ok, note = (e.code == expect_error), '%s: %s' % (e.code, str(e)[:90])
    except AssertionError as e:
        ok, note = False, 'check failed: %s' % e
    except Exception as e:  # noqa: BLE001
        ok, note = False, '%s: %s' % (type(e).__name__, str(e)[:120])
    rows.append({'method': method, 'ok': ok, 'note': str(note)[:160], 'ms': round((time.time() - t0) * 1000, 1)})
    print('%-30s %s %7.1f ms  %s' % (method, 'PASS' if ok else 'FAIL', rows[-1]['ms'], rows[-1]['note']))
    return ok


fin = lambda *v: all(isinstance(x, (int, float)) and math.isfinite(x) for x in v)
loc = lambda d: (d['x'], d['y'], d['z'])
S = {}
check('server.status', lambda: (lambda r: (r['ready'] or (_ for _ in ()).throw(AssertionError('not ready'))) and '')(call('server.status')))
check('server.ping', lambda: (call('server.ping') == 'pong' or (_ for _ in ()).throw(AssertionError('no pong'))) and '')
check('server.info', lambda: '%s, api %s, %s' % (call('server.info').get('engine'), call('server.info')['api_version'], call('server.info')['resolution']))
check('map.info', lambda: call('map.info')['name'])
here = call('geo.to_location', lat=40.80955, lon=-73.95905)
check('geo.to_location', lambda: (fin(*loc(here)) or (_ for _ in ()).throw(AssertionError(here))) and '%.1f %.1f' % (here['x'], here['y']))
check('geo.to_geolocation', lambda: (lambda g: (abs(g['lat'] - 40.80955) < 1e-5 and abs(g['lon'] + 73.95905) < 1e-5 or (_ for _ in ()).throw(AssertionError(g))) and '')(call('geo.to_geolocation', **here)))
check('world.get_settings', lambda: call('world.get_settings'))
check('world.apply_settings', lambda: call('world.apply_settings', synchronous_mode=True, fixed_delta_seconds=0.05)['frame'] >= 0 and '')
check('actor.set_transform', lambda: call('actor.set_transform', id=1, transform={'location': {'x': here['x'], 'y': here['y'], 'z': here['z'] + 40}, 'rotation': {'pitch': -90, 'yaw': 0, 'roll': 0}}) and '(spectator)')
check('world.wait_until_loaded', lambda: (lambda r: (r['loaded'] or (_ for _ in ()).throw(AssertionError(r))) and '%s tiles' % r['tiles'])(call('world.wait_until_loaded', timeout=60)))
bps = call('world.get_blueprints')
check('world.get_blueprints', lambda: '%d vehicle, %d walker, %d sensor' % tuple(sum(1 for b in bps if b['id'].startswith(k)) for k in ('vehicle.', 'walker.', 'sensor.')))
sp_all = call('map.get_spawn_points', center=here, radius=90)
check('map.get_spawn_points', lambda: (len(sp_all) > 0 or (_ for _ in ()).throw(AssertionError('none'))) and '%d' % len(sp_all))
# the spawn points no vehicle of another client stands on (a script that stopped half way leaves its actors behind)
taken = [loc(v['transform']['location']) for v in call('world.get_actors', filter='vehicle.*')]
sp = [s_ for s_ in sp_all if all(math.dist(loc(s_['location'])[:2], t[:2]) > 8 for t in taken)] or sp_all
check('map.get_junctions', lambda: (lambda j: (len(j) > 0 or (_ for _ in ()).throw(AssertionError('none'))) and '%d, first %s signalized %s' % (len(j), j[0]['id'], j[0]['signalized']))(call('map.get_junctions', center=here, radius=80)))
wp = call('map.get_waypoint', location=sp[0]['location'])
check('map.get_waypoint', lambda: (wp and wp['id'] or (_ for _ in ()).throw(AssertionError('none'))) and wp['id'])
check('map.waypoint_next', lambda: (lambda n: (len(n) > 0 or (_ for _ in ()).throw(AssertionError('none'))) and '%d at 30 m' % len(n))(call('map.waypoint_next', id=wp['id'], distance=30)))
check('map.get_surface', lambda: (lambda s: (s['height'] is not None or (_ for _ in ()).throw(AssertionError(s))) and '%s %.2f' % (s['kind'], s['height']))(call('map.get_surface', location=sp[0]['location'])))
check('map.plan_walk_route', lambda: '%.0f m' % call('map.plan_walk_route', start={'x': here['x'] - 25, 'y': here['y'] - 25, 'z': 0}, end={'x': here['x'] + 25, 'y': here['y'] + 25, 'z': 0})['length'])
check('map.get_semantic_classes', lambda: (lambda c: (len(c) > 0 or (_ for _ in ()).throw(AssertionError('none'))) and '%d classes' % len(c))(call('map.get_semantic_classes')))
check('world.get_traffic_light_state', lambda: (lambda r: '%s, %.1f s left' % (r['state'], r['time_left']))(call('world.get_traffic_light_state', heading=90)))
check('world.set_weather', lambda: call('world.set_weather', time_of_day='night', rain=0.4))
check('world.get_weather', lambda: (lambda w: (w['time_of_day'] == 'night' or (_ for _ in ()).throw(AssertionError(w))) and w)(call('world.get_weather')))
check('world.set_weather (bad)', lambda: call('world.set_weather', time_of_day='noon'), expect_error='bad_weather')
call('world.set_weather', time_of_day='day', rain=0)
check('world.set_ambient_traffic', lambda: call('world.set_ambient_traffic', vehicles=60, walkers=120))
check('world.get_ambient_traffic', lambda: call('world.get_ambient_traffic'))
# a car on autopilot, a manual car, a hero car, a walker under direct control, a walker with the AI controller
car = call('world.spawn_actor', blueprint='vehicle.taxi2', transform=sp[0])
S['car'] = car['id']
check('world.spawn_actor', lambda: '%s %d' % (car['type_id'], car['id']))
check('world.spawn_actor (bad)', lambda: call('world.spawn_actor', blueprint='vehicle.tank'), expect_error='unknown_blueprint')
check('vehicle.set_autopilot', lambda: call('vehicle.set_autopilot', id=car['id'], enabled=True, route=['left', 'straight']))
start = loc(call('actor.get_transform', id=car['id'])['location'])
check('world.tick', lambda: (lambda r: '%s frames, last %.1f ms' % (r['frame'], r['timing']['total_ms']))([call('world.tick') for _ in range(60)][-1]))
check('actor.get_transform', lambda: (lambda t: (fin(*loc(t['location'])) and math.dist(loc(t['location']), start) > 0.05 or (_ for _ in ()).throw(AssertionError(t))) and 'moved %.1f m on autopilot' % math.dist(loc(t['location']), start))(call('actor.get_transform', id=car['id'])))
check('actor.get_velocity', lambda: (lambda v: '%.2f m/s' % math.hypot(v['x'], v['y']))(call('actor.get_velocity', id=car['id'])))
check('actor.get_bounding_box', lambda: call('actor.get_bounding_box', id=car['id'])['extent'])
check('vehicle.get_obstacle_ahead', lambda: str(call('vehicle.get_obstacle_ahead', id=car['id'], max_distance=60)))
check('vehicle.apply_control (autopilot)', lambda: call('vehicle.apply_control', id=car['id'], throttle=1), expect_error='autopilot')
check('vehicle.set_autopilot (off)', lambda: call('vehicle.set_autopilot', id=car['id'], enabled=False))
check('vehicle.apply_control', lambda: call('vehicle.apply_control', id=car['id'], throttle=0.6, steer=0.0))
p0 = loc(call('actor.get_transform', id=car['id'])['location'])
for _ in range(40):
    call('world.tick')
check('vehicle.get_control', lambda: call('vehicle.get_control', id=car['id']))
check('manual driving', lambda: (lambda d: (d > 1 or (_ for _ in ()).throw(AssertionError('%.2f m' % d))) and '%.1f m in 2 s at throttle 0.6' % d)(math.dist(loc(call('actor.get_transform', id=car['id'])['location']), p0)))
check('actor.set_target_velocity', lambda: call('actor.set_target_velocity', id=car['id'], velocity={'x': 3, 'y': 0, 'z': 0}))
hero = call('world.spawn_actor', blueprint='vehicle.taxi2', transform=sp[min(3, len(sp) - 1)], attributes={'role_name': 'hero'})
S['hero'] = hero['id']
check('world.spawn_actor (hero)', lambda: '%d' % hero['id'])
check('spectator.follow', lambda: call('spectator.follow', id=hero['id'], mode='chase'))
check('world.start_take', lambda: call('world.start_take', id=hero['id'], name='api_check'))
call('vehicle.apply_control', id=hero['id'], throttle=0.7)
for _ in range(30):
    call('world.tick')
check('world.stop_take', lambda: (lambda tk: (tk['frames'] > 0 or (_ for _ in ()).throw(AssertionError(tk))) and '%d frames, %s' % (tk['frames'], tk.get('mode')))(call('world.stop_take')))
check('spectator.follow (stop)', lambda: call('spectator.follow', id=0))
wbp = next(b['id'] for b in bps if b['id'].startswith('walker.pedestrian.'))
corner = call('map.get_junctions', center=here, radius=80)[0]['location']
w = call('world.spawn_actor', blueprint=wbp, transform={'location': {'x': corner['x'] + 12, 'y': corner['y'] + 12, 'z': corner['z']}, 'rotation': {'pitch': 0, 'yaw': 0, 'roll': 0}})
S['walker'] = w['id']
check('world.spawn_actor (walker)', lambda: '%s %d' % (w['type_id'], w['id']))
check('walker.apply_control', lambda: call('walker.apply_control', id=w['id'], direction={'x': 1, 'y': 0, 'z': 0}, speed=1.4))
q0 = loc(call('actor.get_transform', id=w['id'])['location'])
for _ in range(20):
    call('world.tick')
check('walking', lambda: (lambda d: (d > 0.5 or (_ for _ in ()).throw(AssertionError('%.2f m' % d))) and '%.2f m in 1 s' % d)(math.dist(loc(call('actor.get_transform', id=w['id'])['location']), q0)))
ai = call('world.spawn_actor', blueprint='controller.ai.walker', transform={'location': {'x': 0, 'y': 0, 'z': 0}}, attach_to=w['id'])
S['ai'] = ai['id']
check('world.spawn_actor (ai)', lambda: '%d on %d' % (ai['id'], ai['parent']))
check('walker_ai.start', lambda: call('walker_ai.start', id=ai['id']))
check('walker_ai.set_max_speed', lambda: call('walker_ai.set_max_speed', id=ai['id'], speed=1.5))
check('walker_ai.go_to_location', lambda: (lambda r: '%s, %.0f m' % (r['state'], r['length']))(call('walker_ai.go_to_location', id=ai['id'], location={'x': corner['x'] - 12, 'y': corner['y'] + 12, 'z': 0})))
for _ in range(40):
    call('world.tick')
check('walker_ai.get_state', lambda: call('walker_ai.get_state', id=ai['id'])['state'])
check('walker_ai.stop', lambda: call('walker_ai.stop', id=ai['id']))
check('world.get_snapshot', lambda: '%d actors at frame %d' % (len(call('world.get_snapshot')['actors']), call('world.get_snapshot')['frame']))
check('world.get_actors', lambda: '%d vehicles' % len(call('world.get_actors', filter='vehicle.*')))
check('world.get_actor', lambda: call('world.get_actor', id=car['id'])['type_id'])
check('world.get_actor (bad)', lambda: call('world.get_actor', id=999999), expect_error='no_such_actor')
cam = call('world.spawn_actor', blueprint='sensor.camera.rgb', transform={'location': {'x': -6, 'y': 0, 'z': 3}, 'rotation': {'pitch': -10, 'yaw': 0, 'roll': 0}}, attach_to=car['id'])
S['cam'] = cam['id']
check('world.spawn_actor (sensor)', lambda: '%s %d on %d' % (cam['type_id'], cam['id'], cam['parent']))
info = call('server.info')
check('sensor.listen', lambda: call('sensor.listen', id=cam['id']), expect_error='needs_renderer' if info.get('engine') == 'valdrada-core' else None)
check('sensor.stop', lambda: call('sensor.stop', id=cam['id']))
car2 = call('world.spawn_actor', blueprint='vehicle.taxi2', transform=sp[min(1, len(sp) - 1)])
S['car2'] = car2['id']
call('vehicle.set_autopilot', id=car2['id'], enabled=True)
check('world.apply_settings (async)', lambda: call('world.apply_settings', synchronous_mode=False))
a0 = loc(call('actor.get_transform', id=car2['id'])['location'])
time.sleep(2.0)
check('asynchronous run', lambda: (lambda d: (d > 0.2 or (_ for _ in ()).throw(AssertionError('%.2f m' % d))) and 'a car on autopilot moved %.1f m in 2 s of wall time' % d)(math.dist(loc(call('actor.get_transform', id=car2['id'])['location']), a0)))
check('world.tick (async)', lambda: call('world.tick'), expect_error='not_synchronous')
call('world.apply_settings', synchronous_mode=True, fixed_delta_seconds=0.05)
for k in ('cam', 'ai', 'walker', 'hero', 'car', 'car2'):
    check('world.destroy_actor (%s)' % k, lambda k=k: (call('world.destroy_actor', id=S[k])['destroyed'] or (_ for _ in ()).throw(AssertionError('not destroyed'))) and '')
n_ok = sum(r['ok'] for r in rows)
print('%d of %d checks pass' % (n_ok, len(rows)))
if a.json:
    json.dump({'server': info, 'rows': rows}, open(a.json, 'w'), indent=1)
sys.exit(0 if n_ok == len(rows) else 1)
