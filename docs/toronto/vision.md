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
| Rendering and recording | Browser engine, tile streamer, ATRK actor replay; remote renderer protocol | Main browser selects neutral source massing and scheduled-trip symbols. NYC assembly is loaded only for its profile. Remote sensors, Electron and Unreal require further adaptation |

## Dataset and motion contracts

Building inputs live in `client/fixtures/toronto/`, with source provenance and transformation details. Transit inputs live in `client/fixtures/transit/`: routes, stops, shapes, trips, stop times, calendars and exceptions for a pinned service day. Bulk archives stay outside Git. Derived CTL1 files are regenerated under `client/.generated/toronto/`.

The Toronto profile anchors local coordinates at latitude 43.65, longitude −79.397. Building base elevation and transit elevation are flat local y=0 assumptions, not a measured terrain surface. The Spadina district uses 19 near-detail tiles with whole polygon-part ownership and a shared origin. Official centrelines and four routes’ GTFS paths/stops provide context; scheduled transit extends along the full included route.

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

Extend the existing browser profile from neutral source massing and scheduled-trip symbols to neighbourhood geometry and appropriate licensed assets. Remove operational dependence on NYC landmarks, street dressing, station details and facade overrides without deleting their attribution or historical implementations. Preserve neutral geometry where source data cannot justify detailed appearance.

### Scenarios and validation

Introduce explicit demand, capacities and interventions; compare outputs with suitable observed counts and travel times. Report coverage and uncertainty. Expand neighbourhood size only after measuring memory, load time and source coverage; a full-city archive is not a prerequisite for testing the shared contracts.

## Data and resource boundaries

The [source register](data-sources.md) records ownership, formats, coordinates, update cadence, access and licence evidence. Source licences are independent of code licences. In particular, the official City portal’s Toronto Open Government Licence evidence and conflicting CKAN fields remain explicit; they do not provide clearance for unrelated third-party assets.

The main publication build is capped at 18 MB, including inherited lazy code chunks, with at most 1.5 MB of streamed building tiles. Near-detail tiles are loaded around the camera target; no Toronto macro geometry is invented. The retained single-block inspection fixture separately enforces 2,600,000 total bytes, 700,000 JavaScript bytes and 16,384 tile bytes. These are distribution limits, not simulation memory estimates. The inherited NYC workflow requires substantially larger external datasets and assets. Live feeds, city-scale processing and hosted services are separate resource decisions; the included offline server requires none of them.

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
