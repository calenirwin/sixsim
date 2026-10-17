"""Walk and drive from a script: a hero taxi under VehicleControl and a hero pedestrian under WalkerControl, each
followed by the play mode's camera, each run recorded as a take.

A vehicle or walker spawned with role_name 'hero' moves with the play mode's bodies: arcade car dynamics with a steering
lock that falls with speed, and collisions with kerbs, buildings, street furniture, cars and pedestrians; a walker that
collides and steps up kerbs. The spectator follows one with `Spectator.follow` ('chase' or 'bonnet' for a vehicle,
'third' or 'first' for a walker); a camera attached to the spectator sees that view. `World.start_take` /
`World.stop_take` record a run (the camera and the body every frame) for tools/ad/record.mjs and the offline export.

    python walk_and_drive.py [--host 127.0.0.1] [--port 2000] [--drive 300] [--walk 240] [--out _out/walk_and_drive]
"""
import argparse
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))   # run from a source checkout
import valdrada  # noqa: E402
from valdrada import Location, Rotation, Transform, VehicleControl, Vector3D, WalkerControl  # noqa: E402


def angle_to(tr: Transform, target: Location) -> float:
    """Signed angle (rad) from the actor's heading to the target, positive to the left (yaw counter-clockwise)."""
    dx, dy = target.x - tr.location.x, target.y - tr.location.y
    a = math.atan2(dy, dx) - math.radians(tr.rotation.yaw)
    return math.atan2(math.sin(a), math.cos(a))


def drive(world, m, lib, here, ticks, out, every):
    bp = lib.find("vehicle.taxi2")
    bp.set_attribute("role_name", "hero")
    spawn = m.get_spawn_points(center=here, radius=80, spacing=20)[0]
    car = world.spawn_actor(bp, spawn)
    print("spawned", car, "at", spawn.location)
    print("follow:", world.get_spectator().follow(car, "chase"))
    cam = attach_camera(world, out, "drive", every)
    world.start_take(car, "api_drive")
    target_speed, integ = 9.0, 0.0
    for i in range(ticks):
        tr = car.get_transform()
        v = car.get_speed()
        # pure pursuit on the lane: a waypoint 6 m + 0.5 s ahead
        wp = m.get_waypoint(tr.location, heading=tr.rotation.yaw)
        ahead = wp.next(6.0 + 0.5 * v) if wp else []
        steer = 0.0
        if ahead:
            alpha = angle_to(tr, ahead[0].transform.location)
            steer = max(-1.0, min(1.0, -alpha * 1.6))          # steer > 0 turns right
        # speed: a PI loop, and a stop for whatever is in the lane ahead
        obstacle = car.get_obstacle_ahead(max_distance=25.0)
        want = target_speed if not obstacle else max(0.0, min(target_speed, (obstacle["distance"] - 4.0) * 0.8))
        err = want - v
        integ = max(-5.0, min(5.0, integ + err * 0.05))
        ctl = VehicleControl(throttle=max(0.0, min(1.0, 0.35 * err + 0.08 * integ)), steer=steer,
                             brake=max(0.0, min(1.0, -0.25 * err)) if err < -0.5 else 0.0)
        car.apply_control(ctl)
        frame = world.tick()
        if i % 30 == 0:
            loc = car.get_location()
            print(f"drive frame {frame}: {v * 3.6:5.1f} km/h at ({loc.x:8.1f}, {loc.y:8.1f}) {ctl}"
                  + (f" obstacle {obstacle['kind']} at {obstacle['distance']:.1f} m" if obstacle else ""))
    take = world.stop_take(os.path.join(out, "api_drive_take.json"))
    print(f"drive take: {take['frames']} frames, {take['duration']} s -> {out}/api_drive_take.json")
    cam.stop(); cam.destroy()
    return car


def walk(world, m, lib, here, ticks, out, every):
    bp = lib.find("walker.pedestrian.0011") if any(b.id == "walker.pedestrian.0011" for b in lib) else next(iter(lib.filter("walker.pedestrian.*")))
    bp.set_attribute("role_name", "hero")
    j = m.get_junctions(center=here, radius=80)[0]
    start = j.location + Location(14, 12, 0)
    walker = world.spawn_actor(bp, Transform(start, Rotation(yaw=180)))
    length, path = m.plan_walk_route(start, j.location + Location(-30, 40, 0))
    print("spawned", walker, f"route {length:.0f} m, {len(path)} points")
    print("follow:", world.get_spectator().follow(walker, "third"))
    cam = attach_camera(world, out, "walk", every)
    world.start_take(walker, "api_walk")
    k = 0
    for i in range(ticks):
        loc = walker.get_location()
        while k < len(path) - 1 and math.hypot(path[k].x - loc.x, path[k].y - loc.y) < 0.8:
            k += 1
        d = path[k] - loc
        n = math.hypot(d.x, d.y) or 1.0
        walker.apply_control(WalkerControl(direction=Vector3D(d.x / n, d.y / n, 0), speed=1.5 if k < len(path) - 1 or n > 0.8 else 0.0))
        frame = world.tick()
        if i % 30 == 0:
            print(f"walk frame {frame}: {walker.get_speed():.2f} m/s at ({loc.x:8.1f}, {loc.y:8.1f}), point {k}/{len(path) - 1}")
    take = world.stop_take(os.path.join(out, "api_walk_take.json"))
    print(f"walk take: {take['frames']} frames, {take['duration']} s -> {out}/api_walk_take.json")
    cam.stop(); cam.destroy()
    return walker


def attach_camera(world, out, tag, every):
    """An RGB camera on the spectator: it sees the follow camera's view; every `every`-th frame is saved."""
    bp = world.get_blueprint_library().find("sensor.camera.rgb")
    cam = world.spawn_actor(bp, Transform(), attach_to=world.get_spectator())
    count = {"n": 0}

    def save(image):
        if count["n"] % every == 0:
            image.save_to_disk(os.path.join(out, f"{tag}_{image.frame:06d}.png"))
        count["n"] += 1
    cam.listen(save)
    return cam


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=2000)
    ap.add_argument("--drive", type=int, default=300, help="ticks of driving (30 per second)")
    ap.add_argument("--walk", type=int, default=240, help="ticks of walking")
    ap.add_argument("--every", type=int, default=30, help="save every n-th camera frame")
    ap.add_argument("--out", default="_out/walk_and_drive")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    client = valdrada.Client(a.host, a.port)
    client.set_timeout(180.0)
    world = client.get_world()
    print("server", client.get_server_version(), "client", client.get_client_version())
    world.apply_settings(valdrada.WorldSettings(synchronous_mode=True, fixed_delta_seconds=1 / 30))
    m = world.get_map()
    here = m.geolocation_to_location(40.80955, -73.95905)            # W 120th St & Amsterdam Ave
    world.get_spectator().set_transform(Transform(here + Location(-40, -40, 35), Rotation(pitch=-30, yaw=45)))
    print("loading:", world.wait_until_loaded())
    lib = world.get_blueprint_library()
    actors = []
    try:
        if a.drive:
            actors.append(drive(world, m, lib, here, a.drive, a.out, a.every))
        if a.walk:
            actors.append(walk(world, m, lib, here, a.walk, a.out, a.every))
    finally:
        world.get_spectator().unfollow()
        for x in actors:
            x.destroy()
    print("done")


if __name__ == "__main__":
    main()
