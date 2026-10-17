# Actor tracks (ATRK v1)

A take's moving actors, frame by frame, as the headless core simulates them (tools/core/take.mjs), for any renderer to
replay without running a simulation: Unreal, Blender, or the three.js page itself. One file per take,
`tracks.atrk`, little-endian, a JSON header followed by one fixed-layout record block per frame. Same tiles, same code,
same seed and same step count give a byte-identical file.

## Coordinates and units

- The world of the tiles and of three.js: metres, **x east, y up, z south** (north is -z), origin at lon -73.9712,
  lat 40.7831 (client/src/shared/geo.js `project`).
- Rotations are quaternions (x, y, z, w) in that frame. A vehicle model faces **+z** with its left side at +x
  (sim/fleet24.js model frame); a walker faces +z at yaw 0, yaw counter-clockwise seen from above (about +y).
- Unreal, the convention of the export's ue_light.py (`ue_pos`): location `(x, z, y) * 100` cm, so X east, Y south,
  Z up. The same axis swap on a rotation gives the Unreal quaternion `(-qx, -qz, -qy, qw)` (use unreal.Quat directly, not
  a Rotator). A model that faces +z here faces +Y in Unreal; an asset authored facing +X needs a fixed -90 degree yaw
  about Z. tools/core/read_tracks.py `to_ue` does the conversion.
- Time: frame `i` is at `header.simTime[i]` seconds of the simulation clock (traffic.time), `header.dt` apart (1/30 s);
  frame 0 is the take's first frame (no step before it).

## File layout

| offset | type | content |
|---|---|---|
| 0 | u32 | magic `0x4B525441` ('ATRK') |
| 4 | u32 | version (1) |
| 8 | u32 | header length H in bytes (padded with spaces to a multiple of 4) |
| 12 | H bytes | header, UTF-8 JSON |
| 12 + H | u32 | frame count N |
| 16 + H | u32 x N | byte offset of each frame block from the start of the file |
| ... | | N frame blocks |

Frame block:

| type | content |
|---|---|
| u16, u16, u16, u16 | vehicle count V, walker count P, signal count S, train car count C |
| V x 52 bytes | vehicle records |
| P x 44 bytes | walker records |
| S bytes, padded to 4 | one state byte per signal of `header.signals.list`, in that order |
| C x 72 bytes | train car records |

Vehicle record (52 bytes):

| offset | type | field | meaning |
|---|---|---|---|
| 0 | u32 | id | the actor's id (stable for the take; `header.actors`) |
| 4 | f32 x 3 | x, y, z | the body's origin: ground centre of the model, metres |
| 16 | f32 x 4 | qx, qy, qz, qw | the body's rotation (yaw, plus the model's small pitch under braking and roll in turns) |
| 32 | f32 | v | speed along its path, m/s (the traffic model's own value) |
| 36 | f32 | spin | wheel rotation angle, radians (distance / hub radius, wrapped) |
| 40 | f32 | steer | front wheel steering angle, radians (+ left), from the yaw rate and wheelbase |
| 44 | f32 | bend | articulated bus: the rear body's angle about the turntable pivot, radians (+ left); 0 otherwise |
| 48 | u8 | lamps | bit 0 head, 1 tail, 2 brake, 3 left blinker, 4 right blinker, 5 siren (a renderer flashes blinkers and sirens itself) |
| 49 | u8 | flags | bit 0 double-parked (standing in the kerb lane), bit 1 bus |
| 50 | u16 | kind | index into `header.vehicleKinds` |

Walker record (44 bytes):

| offset | type | field | meaning |
|---|---|---|---|
| 0 | u32 | id | the actor's id |
| 4 | f32 x 3 | x, y, z | the feet, on the pavement surface |
| 16 | f32 | yaw | heading, radians about +y (0 faces +z) |
| 20 | f32 | v | ground speed from the last frame, m/s (0 on the first frame and when standing) |
| 24 | f32 | phase | gait phase, the fraction [0, 1) of the walk cycle |
| 28 | f32 | hz | walk cycles per second at this frame |
| 32 | f32 | sxz | body scale across (build) |
| 36 | f32 | sy | body scale in height |
| 40 | u8 | amp | 0 standing, 255 walking (the model's walk amplitude) |
| 41 | u8 | pose | 0 standing or walking; a seated pose id otherwise (sim/crowd.js: 1 upright ... 7 bench) |
| 42 | u16 | pace | the walk-rate factor x 10000 (1 = the walker's own pace; a walker slowed behind someone plays its walk slower) |

The walk cycle follows the page's walker rig (sim/pedmesh.js): phase = t x rate + offset with rate = 4.4 x the walker's
pace (one cycle per 1.43 m walked whatever the speed); a walker slowed behind someone plays its cycle slower without a
jump. A renderer syncs its walk clip to `phase` (cycle start = the rig's phase 0) at `hz`, and blends to its idle on
`amp`.

Train car record (72 bytes; the 1 train on the Manhattan Valley viaduct and Metro-North on the Park Avenue viaduct,
sim/trains.js: timetabled runs, closed-form in the simulation clock, phased per take so a train is in frame):

| offset | type | field | meaning |
|---|---|---|---|
| 0 | u32 | id | the car's id (`header.actors`: service, run, car index in the consist) |
| 4 | f32 x 3 | x, y, z | the car body's centre at rail height |
| 16 | f32 | yaw | heading about +y; a train car model faces **+x** at yaw 0 (the page's car models) |
| 20 | f32 x 4 | truck A | the leading truck's centre (x, y, z) and yaw (trucks follow the curves) |
| 36 | f32 x 4 | truck B | the trailing truck's |
| 52 | f32 | roll | wheel rotation angle, radians (wrapped) |
| 56 | f32 | doors | door opening 0..1 (on the `side` of the car) |
| 60 | f32 | v | speed, m/s |
| 64 | u8 | lamps | bit 0 front white, 1 front red, 2 rear white, 3 rear red (a car's own +x end is its front) |
| 65 | u8 | kind | index into `header.trainKinds` (r62a, m7a, m8) |
| 66 | u8 | flags | bit 0 reversed (the second car of a married pair), 1 last car, 2 in the enclosed station, 3 near the end of the drawn track |
| 67 | i8 | side | the car's local side facing the platform, +1 (+z) or -1 |
| 68 | u8 | num | the car number's index (decals) |
| 69 | u8 | dest | destination sign index |
| 70 | u16 | | reserved |

Signal byte: bits 0-1 the north-south axis, bits 2-3 the east-west axis; 0 red, 1 amber, 2 green. The axis is the one
traffic.js phases a car on: a car whose travel direction at the junction is mostly along x is served by east-west
(sim/signals.js, a 40 s cycle on the simulation clock: north-south green 0-15 s, amber 15-18 s, all red 18-20 s,
east-west green 20-35 s, amber 35-38 s, all red 38-40 s). Pedestrian heads show WALK for the crossings parallel to a
green axis.

## Header

| key | content |
|---|---|
| format, version | `"actor-tracks"`, 1 |
| shot, title, time, night | the shot (tools/ad/shots.json), its time of day and the night factor (lamps on above 0.35) |
| seed, fps, dt, warm | the simulation seed, frame rate, step, warm-up steps before frame 0 |
| query | the page query the simulation ran under (every `?flag` the sim modules read is the page's) |
| region | `radius` (m) and `path` (33 points on the lens path): an actor is recorded on the frames it is within the radius of a path point (train cars: the radius + 300 m) |
| made | `by` (`core`), `git` (the commit, `+dirty` if the sim or core files differ from it), `code` (hash of the sim and core sources) |
| frames, simTime | N, and the simulation clock per frame |
| camera | `fields` and one row per frame: position, rotation quaternion, vertical field of view in degrees |
| vehicleKinds | per kind index: `kind`, `size` [w, h, l] m, `wheelbase`, `hubs` (wheel centres in the model frame and radii, ids 1-4 FL FR RL RR, 5-6 a bus's rear axle), `articulated` (`pivot` in the model frame, `tow` m to the rear axle) or null, `palette` |
| signals | `cycle` (40 s), `axes` (the bit layout), `list`: `{key, x, z}` per signalised junction near the path |
| trainKinds, trainCue | the train car kinds; the timetable shift per service chosen for this take's path (sim/trains.js cue) |
| parked | the parked vehicles near the path (static for the take): `id, kind, x, y, z, q, seed, col, metal, grime, rough` |
| actors | per moving actor: vehicles `id, type: "vehicle", kind, seed, color, col, metal, grime, rough, f0, f1`; walkers `id, type: "walker", variant, outfit, bagTone, umbTone, color, col (linear), speed (m/s), phase0, f0, f1`; train cars `id, type: "train", key, service, run, car, kind, num, dest, f0, f1` |

`f0`, `f1` are the first and last frames the actor is recorded on. Vehicle paint follows the page's renderer
(sim/fleet24.js paintFor): `col` is the linear RGB base colour (taxis yellow, liveries white = the texture's own),
`metal` the metallic flake, `grime` and `rough` the clear coat's dirt and roughness, all from the vehicle's `seed`
and its storage colour `color`. A walker's `variant` (0..1) picks its body and clothes from the renderer's own pool
(sim/crowd.js: `pool[floor(variant x pool length)]`); `outfit` bits: 4 backpack, 8 bag.

## Reading

- Node: core/tracks/format.mjs `readTracks(file)`.
- Python (standard library only, runs in Unreal's and Blender's Python): tools/core/read_tracks.py `read_tracks(file)`,
  `to_ue(...)`, `signal_states(byte)`; `python3 tools/core/read_tracks.py <file> --frame 0 --ue` prints a frame.
- Browser: client/src/replay/coreReplay.js `parseTracks(arrayBuffer)`.

## Replaying in three.js

`?replay=<take folder | tracks.atrk URL>` (client/src/replay/coreReplay.js): the page's traffic and walker models do
not step; each frame the take's records go into their instance storage and the page's own drawing does the rest (the
fleet with the take's seed, spin, steering, lamps and bend; the crowd through setAnim / setStyle / setAmp / setPace /
setPose; the train sets with the take's cars). The page's simulation clock picks the frame (frame i at `simTime[i]`), so
a recording that warms up as the take did (tools/ad/record.mjs with the shot's `warm`) draws the take frame for frame.

## Replaying in Unreal (the intended consumer)

One actor per id: a vehicle blueprint per `kind` (its wheels turned by `spin` and `steer`, lamp materials by `lamps`,
the articulated rear body by `bend`), a skeletal walker per walker id (mesh by `variant`, walk clip synced to `phase`,
idle when `amp` is 0). Spawn at `f0`, hide after `f1`, and key the transform on every frame (a Level Sequence at
`fps`), so the take needs no simulation in Unreal. Parked vehicles and signal heads come from the header and the
per-frame signal bytes.

## Into today's export pipeline (Unreal, Blender)

`tools/core/actor_layers.sh <shot>` turns a take into the export's own USD layers with its writers unchanged, and
publishes them to `/data0/projectnyc_aux/cellcache/takes/<shot>/` (a README there):

- vehicles: tools/core/tracks_to_mov.py writes the moving-set file harvest.mjs writes for usd_write.py (`mov_<shot>.json`),
  reusing the fleet's drawn parts (the groups) from any earlier harvest;
- train cars: tools/core/tracks_to_trains.mjs places every car's parts (body per material, door leaves, trucks, wheelsets,
  coupling gap) from its record as sim/trains.js does, and tracks_to_mov.py `--trains` adds them as movers matched to an
  earlier harvest's train parts by material and vertex count;
- the Lake's boats (not in the actor tracks: closed-form in the sim clock): tools/core/tracks_to_boats.mjs builds the
  rowing fleet, its rowers, passengers and oars and the moored boats with the page's own builders, steps them on
  `header.simTime` with the lens of each frame and reads every instance matrix back; tracks_to_mov.py `--boats` adds
  them as movers matched to an earlier harvest's boat parts by mesh name and vertex count;
- walkers: tools/core/tracks_to_peds.mjs writes the walker files harvest_peds.mjs writes for usd_peds.py (per frame each
  drawn walker's crowd state and skinning matrices), deriving the crowd's state from the track with sim/crowd.js's own
  rules and evaluating the pose on the CPU;
- signals: the heads and lenses (tools/core/signals_dump.mjs) into the static layer, the lenses switched per frame from
  the signal bytes;
- the camera: `cam_<shot>.json` from `header.camera`.

Field map of the vehicles:

| actor tracks | mov_<shot>.json |
|---|---|
| vehicle `id` | car `id` `core:<id>`, `slot` = id |
| `kind` (index into `vehicleKinds`) | car `kind`, `g` = the template group of that kind (moving, or parked for `header.parked`) |
| `x, y, z, q` per frame | `m`: three's column-major matrix without its last row (x axis, y axis, z axis, translation) |
| `lamps`, `spin`, `steer`, `bend` per frame | `mask`, `spin`, `steer`, `bend` |
| actor `seed`, `col`, `metal, grime, rough` | `seed`, `col`, `paint` |
| actor `f0`, `f1` | `f0`, `f1` (a frame outside the region in between holds the last pose) |
| signal byte | `sig` `{ns, ew}`; `sigOn` per lens pool from the signal registry |

Walkers: the actor's `variant` is the crowd's seed (its body variant, walk style, height, props and bottoms and shoes
follow from it), `speed` and `phase0` are what the walker model gave the crowd rig, `outfit` its outfit bits, `col` the
top's tint; per frame `amp` (walking or standing) and `pace` drive the clip choice and playback rate.
