# Toronto vision and architecture

Build a reproducible Toronto city simulation on the Valdrada framework: retain its useful spatial, rendering and control contracts, replace geographic assumptions and source data deliberately, and extend transit through the shared world clock and API. Visual detail and simulated behavior must remain distinguishable from source observations.

Display branding is configurable and independent of dataset IDs, geographic profiles, Python imports and protocol names. SixSim is a working name; changing it must not require a data migration.

## Shared architecture

| Layer | Contract | Toronto adaptation |
|---|---|---|
| Source acquisition | Versioned source subsets with provenance | City building massing, source centreline topology and TTC GTFS; retain URLs, retrieval dates, hashes, licence evidence and original identifiers |
| Normalization | Explicit geographic profile and units | WGS84 inputs projected to metres: x east, y up, z south; API locations use x east, y north, z up |
| Spatial pipeline | CTL1 tiles and manifests | Building footprints, holes and heights use the inherited writer/decoder; NYC correction passes are disabled for Toronto |
| World simulation | Fixed-step clock, streamed spatial data, model updates, post-step hooks | Scheduled trip positions advance with the inherited clock; traffic and pedestrians require a Toronto navigation graph |
| Control API | Existing framed TCP transport and shared bridge | Map metadata and geographic conversion use the selected origin; Python clients query scheduled transit and advance the world |
| Cameras | Geographic path keys projected into the world frame | Headless camera paths use the tile manifest’s origin; legacy manifests retain the inherited NYC frame |
| Rendering and recording | Browser engine, tile streamer, ATRK actor replay; remote renderer protocol | Main browser selects source massing with explicitly illustrative procedural materials and scheduled-trip symbols. NYC assembly is loaded only for its profile. Remote sensors, Electron and Unreal require further adaptation |

## Dataset and motion contracts

Building inputs live in `client/fixtures/toronto/`, with source provenance and transformation details. Transit inputs live in `client/fixtures/transit/`: routes, stops, shapes, trips, stop times, calendars and exceptions for a pinned service day. Bulk archives stay outside Git. Derived CTL1 files are regenerated under `client/.generated/toronto/`.

The Toronto profile anchors local coordinates at latitude 43.65, longitude −79.397. The district simulation’s building base elevation and transit elevation are flat local y=0 assumptions, not a measured terrain surface. The Spadina district uses 29 near-detail tiles with whole polygon-part ownership and a shared origin. Official centrelines and four routes’ GTFS paths/stops provide context; scheduled transit extends along the full included route.

The GTFS actor model compiles directed stop-to-stop service links from published shapes and stop distances. Stop occurrences remain separate across patterns and loops; spatial crossings do not create connections. Stops must anchor within 25 metres of their shape position, link distances and travel durations must increase, and incompatible trips, including links with zero geometric extent, are explicitly omitted with reasons. Actors occupy a stop node during dwell or one directed link during travel. Published distances, arrival times and departure times determine progress; geometric link lengths are separately measured in local metres. Service-day times beyond 24:00 remain on the selected calendar day in America/Toronto. Trip IDs are namespaced by service date; they are not live vehicle identities. Invalid or missing shapes produce explicit omissions. This model does not infer acceleration, signal response, vehicle capacity, passenger demand, collision avoidance or calibration.

The shared API exposes source GeoJSON and intersection-ID adjacency through `map.get_source_network` / Python `world.get_source_network()`, in EPSG:4326 with provenance and `routing: false`. It exposes `transit.get_graph` / Python `world.get_transit_graph()` with EPSG:4326 link geometry, source hash and service day. Graph IDs are scoped to the compiled snapshot, not permanent physical track identifiers. `transit.get_state` includes actor node/link identity, progress, occupancy and omission reasons, also available as Python `world.get_transit_state()`. Its actors use ENU locations, with source trip/route/shape IDs, motion basis, service day, timezone and service seconds. They are read-only scheduled actors, separate from controllable vehicles in the inherited actor API. Server capabilities identify whether road navigation, pedestrians and scheduled transit are configured. Unsupported navigation and remote renderer operations fail explicitly. Rendering capabilities are declared by the map; the presence of a traffic model does not enable renderer access.

## Roadmap

### Geographic coherence

Propagate city profiles through browser startup, Electron and renderer handshakes as well as the headless world. Keep geographic camera keys, API coordinates, compiled geometry and client metadata consistent. Reject mismatched data profiles rather than silently interpreting Toronto coordinates as Manhattan.

### Connected spatial data

Turn the Spadina district’s source centreline/intersection adjacency into a validated lane and track graph. Keep official IDs, grade separation and direction evidence distinct from inferred connections. Match GTFS stops and shapes using documented tolerances and retain unmatched records. Add a licensed elevation crop with explicit horizontal and vertical datums. Shapes alone do not establish track topology, right-of-way or signal phases.

### Transit and street interactions

Start with stop/link occupancy and travel-time diagnostics. Add movement constraints and signal interactions only when the necessary geometry and rules are available. Keep schedule-derived motion, simulated behavior and measured observations distinguishable in APIs and exports.

### Toronto rendering

Expand the existing browser profile through bounded neighbourhood geometry and appropriate licensed assets, keeping measured geometry separate from illustrative materials. Remove operational dependence on NYC landmarks, street dressing, station details and facade overrides without deleting their attribution or historical implementations. Preserve neutral geometry where source data cannot justify detailed appearance.

### Scenarios and validation

Introduce explicit demand, capacities and interventions; compare outputs with suitable observed counts and travel times. Report coverage and uncertainty. Expand neighbourhood size only after measuring memory, load time and source coverage; a full-city archive is not a prerequisite for testing the shared contracts.

## Data and resource boundaries

The [source register](data-sources.md) records ownership, formats, coordinates, update cadence, access and licence evidence. Source licences are independent of code licences. In particular, the official City portal’s Toronto Open Government Licence evidence and conflicting CKAN fields remain explicit; they do not provide clearance for unrelated third-party assets.

The main publication build is capped at 150 MB, including at most 120 MB of municipal building tiles and 1.5 MB of district building tiles. Municipal tiles total about 95.55 MB on disk; they are not an initial download. The municipal loader fetches at most two tiles concurrently and retains at most nine tiles, 12 MB of tile bytes and 1.2 million vertices. It verifies byte counts and hashes, aborts obsolete requests and disposes distant geometry. Near-detail tiles are loaded around the camera target; no Toronto macro geometry is invented. The retained single-block inspection fixture separately enforces 2,600,000 total bytes, 700,000 JavaScript bytes and 16,384 tile bytes. These are distribution limits, not simulation memory estimates. The inherited NYC workflow requires substantially larger external datasets and assets. City terrain adds a lazy-loaded 1,263,832-byte height grid, at most 25 near patches and a 512 m overview. Municipal classified-cover tiles have a separate 6 MB distribution cap. Near cover retains at most 25 textures (409,600 RGBA bytes) and 12,800 triangles, with two concurrent requests; overview does not fetch cover. The full package remains capped at 150 MB. Live feeds and hosted services are separate resource decisions; the included offline server requires none of them.

## Browser actor and asset contract

The main application selects its map with `?city=toronto` or `?city=nyc`. Toronto uses the inherited `Engine`, `Streamer`, ATRK v1 decoder and `CoreReplay` instance-pool update path. Its CTL1 assembly preserves source footprints, holes, record identities and heights without NYC landmark or facade overrides. No NYC models, textures or correction tables are selected for this profile.

The headless world exports a five-minute recording at one-second intervals through the existing ATRK writer. Header metadata carries the geographic profile, service day, motion basis and both datasets’ provenance. Stable numeric actor IDs map back to service-day/trip IDs. The ATRK header also carries the service graph and per-frame actor occupancy; the main renderer highlights occupied links from those recorded states. Binary positions use x east, y up, z south; the API exposes the equivalent east/north/up frame. The browser checks actor and geometry profiles before loading them together.

Scheduled trips use a symbolic marker pool rather than an unverified streetcar model. ATRK vehicle slots carry the positions; unused heading, speed and animation fields are zero placeholders, not observations. The playback is finite and independent of the live TCP session. Connecting a live browser transport and adapting remote sensor/Unreal clients are separate port steps; they must preserve capability checks and coordinate/provenance contracts.

## Fixed extra-dwell experiment

A frozen scenario can add 60 seconds to one trip's specified stop occurrence. Arrival at that stop is unchanged; departure and every downstream arrival/departure shift by 60 seconds. Travel durations are unchanged and there is no recovery policy. Repeated stop IDs are disambiguated by zero-based occurrence, and service times beyond 24:00 retain their service-day identity. All other trips remain unchanged. A zero-second input is supported for parity testing; other durations, unknown targets and incompatible service days are rejected.

The included `tools/toronto/scenarios/510-stop-dwell.json` targets trip `122948020`, occurrence 3 (stop `8134`), on the pinned service day. Run the existing TCP world or browser with the same configuration:

```sh
TORONTO_TRANSIT_SCENARIO=tools/toronto/scenarios/510-stop-dwell.json npm run serve:toronto
TORONTO_TRANSIT_SCENARIO=tools/toronto/scenarios/510-stop-dwell.json npm --prefix client run dev:city
```

Relative scenario paths resolve from the repository root. Omitting the environment variable selects the unchanged baseline. Inputs are copied and frozen when the world is created; changing the file requires rebuilding/restarting. The API exposes the scenario and scheduled arrival/departure deviations in `transit.get_state`; active targeted actors report the relevant stop occurrence's deviation. ATRK records the same inputs, deviations and resulting occupancy. The browser identifies the experiment explicitly. Its Recording selector compares the published timetable and the included +60-second scenario at the same paused time, preserving the camera. Both recordings come from the same world exporter; mismatched clocks, profiles, source provenance or service graphs are rejected before replacement. The previous recording remains usable if loading fails. A separate initial build scenario is labeled as such. This tests schedule perturbation only: it does not model passenger exchange, vehicle conflicts, traffic signals or observed delays.

### Departure-event comparisons

The shared scheduled-transit model computes baseline and selected departures for a requested trip, with the preceding departure and gap at each same-pattern stop occurrence. `transit.get_departures` accepts `trip_id`; Python exposes `world.get_transit_departures(trip_id)`. Unknown or graph-omitted trips are unavailable. The API covers all valid occurrences of that trip; the browser shows the first three from the included experiment stop, carried in its ATRK header from the same model. Pattern identity includes route, direction, shape and ordered stop distances, so these gaps intentionally do not aggregate all service at a physical stop.

Departure ordering is recomputed independently for baseline and selected schedules; changing order can change the predecessor. Ties use trip ID, the first departure has no predecessor, and there is no service-day wrapping. Replay validates topology identity, service day, finite event times, gap arithmetic and scenario departure deviations before replacing the displayed recording. Published GTFS times remain the source; no live observations or physical conflict resolution are inferred.

Departure-comparison schema version 2 adds `following` (trip ID and departure seconds, or null) and `followingGapSeconds` to each baseline/selected event. The gap is from the requested trip to the immediately following same-pattern departure at that occurrence. Version 1 recordings remain readable without following rows. The API, world export and browser share the same chronological selection; following-trip service times remain unchanged unless that trip is itself the configured dwell target. No car-following, collision or passenger interaction is inferred from these gaps.

### Coverage and visual materials

The pinned district extraction uses longitude −79.410 to −79.385 and latitude 43.642 to 43.665 (about 5.14 km²), retaining whole source geometry without clipping or repair. The 512 m tile pipeline supports bounded adjacent extracts; raw archives remain outside Git. Near-detail streaming is retained rather than loading the whole archive. Original procedural colours, window patterns and ground texture are illustrative, independently replaceable from source geometry. They do not supply measured facade textures, floors, land cover or elevation. Further expansion must keep explicit source coverage, omission provenance and byte/rendering budgets.

### Municipal terrain and citywide layer progression

The official municipal boundary scopes Toronto coverage; GTA municipalities are excluded. A 2023 bare-earth PolygonZ TIN supplies CGVD2013 heights, sampled inside its original triangles at shared 64 m nodes. Missing/conflicting source samples remain missing. Rendering switches between a whole-boundary 512 m overview and bounded 64 m near patches without mixed-resolution edge cracks. Conservative boundary-cell omission can hide narrow islands/coastal strips; it is not a claim of absent land.

Terrain inspection shares the existing engine and geographic frame but pauses/hides the flat district simulation. This prevents a new datum from silently changing replay or treating bridges and tunnels as bare earth. `map.get_elevation` / Python `world.get_elevation` returns interpolated terrain separately, with datum, source year, basis and missing status. Neither this API nor terrain colours claim citywide routing, vegetation or vehicle interactions.

The municipal building pipeline streams the pinned 428,184-record archive through the official boundary into 2,469 CTL1 tiles: 427,584 retained source records and 427,946 polygon parts. Whole-part ownership, source heights and holes are preserved. Invalid geometry, tiny rings and missing terrain anchors are recorded as omissions. Level bases sample the independent 64 m terrain at footprint representative points; this is explicitly illustrative placement, not a conversion of `SURF_ELEV` or `HEIGHT_MSL`. Archive metadata does not establish their vertical datum, so zeros and large differences are never treated as a constant offset. `map.get_city_building_tiles` / Python `world.get_city_building_tiles` exposes bounded tile metadata and the placement rule, separately from physical simulation. Municipal historical cover streams separately on the terrain grid. Establish access/turn constraints and structural elevations before changing actor or collision contracts. Scheduled route coverage and interaction capabilities remain separate milestones.

### Municipal historical classified cover

The 2018 source polygons are sampled at 16 m cell centres in the shared local geographic frame and packaged as 1,024 m tiles. Code 0 remains unknown (including blank source classifications and outside-mask cells); code 9 records overlapping different classes. Same-class overlap is unioned. Unknown/conflict cells remain transparent, never inferred as bare ground. Municipal masking uses the official boundary. Narrow features may disappear at this display resolution.

The optional overlay uses exactly the existing near-terrain triangles with nearest-category texture sampling, so it does not introduce a second elevation model or class interpolation. The historical top-down classes can cover underlying roads; draping them onto 2023 terrain is contextual visualization, not a measured combined surface or physical simulation parameter. Turning cover off, zooming to overview or returning to the district cancels pending requests and releases geometry/textures. Source-network API metadata carries its vintage, coverage counts, provenance and `simulation_ground: false`.

## Municipal street topology

The pinned Toronto Centreline source supplies 43,036 municipal expressway, ramp, arterial, collector and local-street features in 660 cartographic tiles. Nearby lines split at the existing terrain triangle boundaries and follow that surface with a small display offset. This is a map overlay, not measured road pavement, bridge or tunnel elevation. Missing terrain segments are omitted. Tiles are checked against the terrain/boundary lineage and their byte hashes; the renderer retains at most 25 tiles, two concurrent requests, 4 MB of source bytes and 300,000 vertices. The 7.23 MB tile distribution has a 15 MB cap inside the existing 150 MB publication limit. Overview omits road detail.

The offline world loads a separate directed source graph: 31,641 intersection IDs, 42,877 source edge records with direction codes, and 80,165 directed traversal arcs. Python `world.find_source_road_path(from_intersection, to_intersection)` / `map.find_source_road_path` returns a shortest source-length path, or explicit unreachable status. It follows source direction codes and intersection IDs, never joins geometric crossings, and excludes boundary-crossing edges, unselected jurisdictions and inconsistent endpoint IDs. The browser does not download the full graph. Results contain source IDs and endpoint coordinates, not a traversable path geometry; `navigation_ready` and `traffic_interactions` remain false. No turn restrictions, access guarantees, lanes, geometric connectors or vehicle interactions are inferred. The 510 schedule and replay remain independent.

The next routing step is a persistent queue and downstream capacity model; verified access, turn permissions and structural elevations remain separate requirements for navigation claims. Cartographic coverage alone is not a navigation contract.

## Constrained Wellington movement

The single-probe contract remains available for legacy recordings and diagnostics. New recordings present the shared Wellington/Bathurst experiment described below.

A source-connected Wellington Street corridor west of Spadina retains five original Centreline geometries (about 440 m in the shared local frame), four exact endpoint joins and source forward-direction codes. It provides a bounded geometric experiment through the existing world clock, TCP/Python API and ATRK browser recording. The violet symbol is a prescribed probe, not a vehicle model, observed service or legally navigable route.

The probe begins 10 m into the first 106.3 m source segment, advances at a fixed experimental 5 m/s and reaches its first holding point at about 17.26 seconds. Without an admission policy, it remains there. These insets are scenario parameters, not surveyed stop lines or validated safety distances. Source jurisdiction/direction do not establish access or turn permission.

The default `tools/toronto/scenarios/wellington-admission.json` is an original illustrative rule, separate from source permissions. Its open interval is [30, 40) seconds of elapsed world time. Admission requires a continuous interval long enough to travel from the incoming holding point to the outgoing holding point: about 4.19 seconds. The model grants entry at 30 s, changes source-edge identity at the exact common endpoint at 32 s, and holds 10 m before the next source node at about 34.19 s. It permits at most this one source-node transition. It is not an observed signal phase, legal right of way, physical clearance model or collision simulation.

Policies and modeled interruption intervals are frozen when the world is constructed. Sorted, non-overlapping half-open interruptions are subtracted from each admission window. The earliest remaining interval that accommodates the **whole passage** is reserved; otherwise the probe remains held. For example, an interruption [30, 35) defers admission to 35 s. An interruption [34, 40) leaves insufficient time and prevents admission. Once a passage is reserved, it is not revoked mid-crossing; these are predeclared scenario interruptions, not a live emergency-control API. A reservation may end exactly when a closure begins. Invalid IDs, rights claims, intervals or policy fields fail closed. Movement still has no acceleration, braking, lane, collision or real-signal model.

`world.get_road_probe()` / `experimental.get_road_probe` returns the base definition, optional illustrative admission policy and current state. `definition.policy` retains the no-admission baseline; `admission` is the separate modeled override, never a change to source access/turn rights. State coordinates are explicitly local east/up/south metres. Probe time is elapsed world time, independent of GTFS service-day time. Long steps, subdivision and replay seeking evaluate the same closed-form position; the endpoint hold does not wrap or disappear. Baseline and dwell recordings contain identical probe states. In legacy recordings without shared admission, **Wellington geometric probe** focuses and resets the recording; Play or the existing time slider advances it. Municipal inspection hides and pauses the recording as before.

The district's flat vertical convention remains explicit. Probe state has y=0; the rendered octahedron is a symbol lifted above that plane for visibility. Bare-earth terrain is not used to infer pavement or bridge elevation. Foundation datum uncertainty remains unchanged. The illustrative reservation does not establish real access/turn rights or enable the road-navigation capability. Older recordings without admission retain their first-segment hold; new recordings preserve the selected policy, phases and positions in the same ATRK contract.

## Shared Wellington/Bathurst admission

The branching source node `13467884` has four incident selected street records. Two source-connected movements retain the original vertices: Bathurst `8457361 → 1146640` and Wellington `14025464 → 8491785`. Both follow source digitization; Wellington carries forward-only direction codes, while the Bathurst records are two-way. Exact endpoint equality establishes topological continuity, not turn permission, lane alignment or physical conflict geometry.

`tools/toronto/scenarios/shared-junction.json` defines one conservative shared resource for both movements. Each point probe starts 20 m before the node at its configured elapsed start time, approaches at a prescribed 5 m/s, and waits 10 m before it. Passage to a holding point 10 m beyond the node requires a four-second reservation. These distances and speed are authored model inputs, not surveyed stop lines, vehicle dimensions or calibrated clearance times. Both movements conflict in this model; there is no inferred conflict polygon or claim of physical collision prevention.

Requests are ordered by ready time and then stable ASCII probe ID. A central planner subtracts frozen interruption intervals from the open windows, chooses a complete fitting passage, and advances shared availability to that reservation's end. Later requests cannot overlap an earlier reservation. No suitable interval means the probe stays held. Intervals are half-open: clearance and the next admission can share a timestamp with exactly one owner. A reservation is not withdrawn during passage; interruptions are predeclared scenario inputs, not live emergency control. Policies, source definitions, plans and state are exposed as defensive snapshots.

With the version-1 [10, 30) window and simultaneous starts, both probes are ready at 2 s. The ID tie-break grants Bathurst [10, 14), then Wellington [14, 18). Source-edge transitions occur at 12 s and 16 s respectively. Each clears once and remains at its outgoing holding point; there is no looping or downstream routing. Ready-time ordering precedes the tie-break. Insufficient windows may leave one or both probes held indefinitely; this finite, frozen experiment does not claim queue fairness for dynamically arriving agents.

The world steps shared admission on the existing simulation clock. Python `world.get_shared_junction()` / `experimental.get_shared_junction` returns the source definition, policy, reservation plan and state, including the unique `ownerId`. Coordinates are local east/up/south metres; y=0 retains the district's illustrative flat model. ATRK records carry the same policy and states, which are validated before replay. Baseline/dwell switching, seek/reset and municipal inspection preserve the experiment without changing route 510. New recordings replace the single-probe visual focus; older recordings with no shared extension keep their previous behavior. The old diagnostic API remains available independently.

The next useful extension is multiple arrivals with explicit downstream capacity and deterministic queue handling at this source branch. Real access/turn rights, calibrated road geometry, structural elevations and traffic-body collisions remain separate data/model requirements. The road-navigation capability remains false.

## FIFO queue and downstream storage

The compatibility scenario `tools/toronto/scenarios/shared-junction-queue.json` uses policy version 2. It retains the same two source movements and adds one authored storage slot for each outgoing edge. The Bathurst slot starts occupied until elapsed 20 s; Wellington starts empty. These are illustrative capacity and release inputs, not observed vehicles, road widths or calibrated flow rates. A null release means the initial occupant never clears.

Ready requests remain in a strict ready-time/ID FIFO until admitted. A blocked head is not overtaken, even if the other movement has a free exit. Admission requires both a complete uninterrupted four-second junction window and an available outgoing slot. That slot is reserved at entry, becomes occupied at clearance, and remains occupied while the probe holds. Junction clearance alone never frees downstream storage. No exit drain, downstream route or hidden removal is simulated.

Both probes queue from 2 s. Bathurst's modeled occupant clears at 20 s, permitting Bathurst [20, 24) and Wellington [24, 28). The default open window is [10, 40). Insufficient windows or a permanently occupied head's exit leave requests queued indefinitely. Queue snapshots report ready time, elapsed wait and the current blocking reason; downstream snapshots separate initial occupancy, reserved probes, cleared probes and remaining capacity. Half-open timestamps allow an initial release and reservation at the same instant without overbooking.

World, API and ATRK replay expose those same snapshots. The finite scenario is evaluated from frozen inputs and elapsed simulation time, so subdivided steps, seeks and reset reproduce the same queue rather than silently dropping waiting requests. Version-1 policies and recordings retain their original state contract. This is a bounded two-request FIFO experiment, not dynamic demand, a lane-level queue, physical collision avoidance or verified signal control.

## Finite arrivals and explicit discharge

The default `tools/toronto/scenarios/shared-junction-arrivals.json` uses policy version 3: three requests per source movement, starting at elapsed 0, 4 and 8 s. Each request has a stable ID and source path ID. Arrival order is normalized by ready time then ASCII ID; input array order does not change arbitration. At most 32 finite requests are accepted. These are authored demand inputs, not measured arrival rates or passenger demand.

Each outgoing slot declares `dischargeAfterSeconds`: an eight-second hold after junction clearance in the default scenario. A null delay retains occupancy indefinitely; zero releases exactly at clearance. Admission reserves the exit before entry, clearance changes reservation to occupancy, and only the explicit discharge releases capacity. Requests retain their outgoing endpoint coordinates and become `discharged`/not present at that timestamp. This is removal at a modeled sink, not teleportation to another road, downstream route generation or a surveyed exit.

Default passage intervals are Bathurst [20,24), Wellington [24,28), Bathurst-2 [32,36), Wellington-2 [36,40), Bathurst-3 [44,48), Wellington-3 [48,52). Releases occur at 32, 36, 44, 48, 56 and 60 s. Half-open occupancy lets a discharge and a new reservation share an instant without exceeding capacity. A blocked FIFO head still prevents overtaking; unavailable windows or a permanently occupied exit can leave later requests held indefinitely.

World/API/ATRK state includes each request's path and discharge timestamp; replay creates markers per request, hides discharged markers, and restores them correctly on seek/reset. The browser reports queue length/head reason, occupied/reserved exits and discharged count. Symbols awaiting the same movement can coincide at its holding point: queue order is logical, not a physical lane queue or collision model. Version-1/2 policies and recordings retain their prior behavior. City layers and scheduled route 510 remain independent of these illustrative demand and sink rules.
