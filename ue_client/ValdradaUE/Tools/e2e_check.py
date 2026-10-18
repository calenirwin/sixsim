"""End to end through the Python API, the same requests against any renderer: an RGB, a depth and a semantic camera on
West 125th Street by the Apollo and in Times Square, a taxi on autopilot in front of the first, 50 synchronous ticks;
the images, the depth planes and the tick times are written to --out.

    python3 ue_client/ValdradaUE/Tools/e2e_check.py [--host 127.0.0.1] [--port 2000] [--frames 50] [--out <dir>]

Run it against the headless core with the Unreal client attached (Tools/run_client.sh) and against the three.js build
(server/main.js) to compare pose and framing.
"""
import argparse
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', '..', 'PythonAPI'))   # run from a source checkout
import valdrada  # noqa: E402

# (lat, lon, height over the street m, pitch, yaw): yaw counter-clockwise from east; the Manhattan grid's streets run
# 29 degrees off the parallels, so 151 looks west along 125th Street (from the Apollo) and 241 south down Broadway and
# Seventh Avenue (from Duffy Square to One Times Square); each camera stands on the nearest lane's centre
PLACES = {
    'w125': (40.81010, -73.95000, 3.0, -4.0, 151.0),
    'tsq': (40.75870, -73.98515, 4.0, 4.0, 241.0),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--port', type=int, default=2000)
    ap.add_argument('--frames', type=int, default=50)
    ap.add_argument('--every', type=int, default=5, help='save every n-th frame (and the last)')
    ap.add_argument('--load-timeout', type=float, default=1800.0)
    ap.add_argument('--out', default='/data0/projectnyc_aux/dev/v2/ueclient/e2e/run')
    ap.add_argument('--time', default='day', help='world.set_weather time_of_day before the ticks: day, golden, dusk, night')
    ap.add_argument('--only', default='', help='comma separated places (w125, tsq); all by default')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    rep = {'started': time.strftime('%Y-%m-%d %H:%M:%S'), 'places': PLACES}

    client = valdrada.Client(a.host, a.port)
    client.set_timeout(max(600.0, a.load_timeout + 60))
    world = client.get_world()
    # a headless core serves sensors once a renderer client has attached (the three.js build has its own)
    t = time.time()
    while True:
        info = client.get_server_info()
        if info.get('engine') != 'valdrada-core' or info.get('renderer') or time.time() - t > a.load_timeout:
            break
        time.sleep(2)
    rep['renderer'] = info.get('renderer') or info.get('gpu')
    print('renderer:', rep['renderer'], flush=True)
    world.apply_settings(valdrada.WorldSettings(synchronous_mode=True, fixed_delta_seconds=0.05))
    m = world.get_map()
    lib = world.get_blueprint_library()

    cams, saved = {}, {}
    spectator = world.get_spectator()
    t = time.time()
    if a.only:
        for k in [k for k in PLACES if k not in a.only.split(',')]:
            del PLACES[k]
    for name, (lat, lon, up, pitch, yaw) in reversed(list(PLACES.items())):
        # the core simulates and samples the ground round the spectator: go there first (the first place last, so the
        # taxi's street is the one simulated)
        loc = m.geolocation_to_location(lat, lon)
        spectator.set_transform(valdrada.Transform(valdrada.Location(loc.x, loc.y, loc.z + 60), valdrada.Rotation(pitch=-30, yaw=yaw)))
        print(name, 'spectator there:', world.wait_until_loaded(timeout=a.load_timeout), flush=True)
        wp = m.get_waypoint(loc, max_distance=60)
        if wp is not None:
            loc = valdrada.Location(wp.transform.location.x, wp.transform.location.y, loc.z)
        h = m.get_surface(loc).get('height')
        if h is None:
            raise SystemExit(f'{name}: no ground under {lat}, {lon}')
        tf = valdrada.Transform(valdrada.Location(loc.x, loc.y, h + up), valdrada.Rotation(pitch=pitch, yaw=yaw))
        for kind in ('rgb', 'depth', 'semantic_segmentation'):
            bp = lib.find('sensor.camera.' + kind)
            bp.set_attribute('fov', 90)
            bp.set_attribute('image_size_x', 1280)
            bp.set_attribute('image_size_y', 720)
            s = world.spawn_actor(bp, tf)
            cams[(name, kind)] = s
            saved[(name, kind)] = []
        rep[name] = {'location': [loc.x, loc.y, h + up], 'rotation': [pitch, yaw]}

    # the taxi: the lane point nearest to 40 m ahead of the 125th Street camera
    lat, lon, up, pitch, yaw = PLACES.get('w125') or next(iter(PLACES.values()))
    c = m.geolocation_to_location(lat, lon)
    ahead = valdrada.Location(c.x + 40 * math.cos(math.radians(yaw)), c.y + 40 * math.sin(math.radians(yaw)), c.z)
    sps = m.get_spawn_points(center=ahead, radius=60)
    taxi = None
    for sp in sps:
        try:
            taxi = world.spawn_actor(lib.find('vehicle.taxi2'), sp)
            break
        except Exception as e:  # noqa: BLE001
            print('spawn failed:', e)
    if taxi is not None:
        taxi.set_autopilot(True)
        rep['taxi'] = {'id': taxi.id, 'spawn': [sp.location.x, sp.location.y, sp.location.z]}

    def keep(key):
        name, kind = key

        def cb(img):
            i = img.frame
            last = len(saved[key]) == 0 or i % a.every == 0 or i >= frame0 + a.frames
            if not last:
                return
            p = os.path.join(a.out, f'{name}_{kind}_{i:04d}' + ('.npy' if kind == 'depth' else '.png'))
            img.save_to_disk(p)
            if kind == 'depth':
                img.save_to_disk(p[:-4] + '.png')
            saved[key].append(p)
        return cb

    if a.time != 'day':
        world.set_weather(valdrada.WeatherParameters(time_of_day=a.time))
    rep['time'] = a.time
    loaded = world.wait_until_loaded(timeout=10)
    frame0 = world.get_snapshot().frame
    for key, s in cams.items():
        s.listen(keep(key))
    # the cameras' cells stream once they listen (the core's load set follows the listening cameras)
    while True:
        loaded = world.wait_until_loaded(timeout=60)
        print('loading', round(time.time() - t), 's:', loaded, flush=True)
        if loaded.get('loaded') or time.time() - t > a.load_timeout:
            break
    rep['load_s'] = round(time.time() - t, 1)
    rep['loaded'] = loaded
    ticks = []
    for i in range(a.frames):
        t0 = time.time()
        f = world.tick()
        ticks.append(round(time.time() - t0, 3))
        if i % 10 == 0:
            print(f'tick {i}: frame {f}, {ticks[-1]} s' + (f', taxi at {taxi.get_location()}' if taxi else ''), flush=True)
    rep['tick_s'] = ticks
    rep['tick_mean_s'] = round(sum(ticks) / len(ticks), 3)
    rep['images'] = {f'{k[0]}_{k[1]}': v for k, v in saved.items()}
    try:
        rep['server'] = client.get_server_info()
    except Exception:  # noqa: BLE001
        pass
    for s in cams.values():
        s.stop()
        s.destroy()
    if taxi is not None:
        taxi.destroy()
    json.dump(rep, open(os.path.join(a.out, 'report.json'), 'w'), indent=1, default=str)
    print('wrote', sum(len(v) for v in saved.values()), 'files to', a.out, '; mean tick', rep['tick_mean_s'], 's')


if __name__ == '__main__':
    main()
