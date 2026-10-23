# Toronto vision and architecture

Build a reproducible Toronto city simulation on the Valdrada framework: retain its useful spatial, rendering and control contracts, replace geographic assumptions and source data deliberately, and extend transit through the shared world clock and API. Visual detail and simulated behavior must remain distinguishable from source observations.

Display branding is configurable and independent of dataset IDs, geographic profiles, Python imports and protocol names. SixSim is a working name; changing it must not require a data migration.

## Shared architecture

| Layer | Contract | Toronto adaptation |
|---|---|---|
| Source acquisition | Versioned source subsets with provenance | City building massing and TTC GTFS; retain URLs, retrieval dates, hashes, licence evidence and original identifiers |
| Normalization | Explicit geographic profile and units | WGS84 inputs projected to metres: x east, y up, z south; API locations use x east, y north, z up |
| Spatial pipeline | CTL1 tiles and manifests | Building footprints, holes and heights use the inherited writer/decoder; NYC correction passes are disabled for Toronto |
| World simulation | Fixed-step clock, streamed spatial data, model updates, post-step hooks | Scheduled trip positions advance with the inherited clock; traffic and pedestrians require a Toronto navigation graph |
| Control API | Existing framed TCP transport and shared bridge | Map metadata and geographic conversion use the selected origin; Python clients query scheduled transit and advance the world |
| Cameras | Geographic path keys projected into the world frame | Headless camera paths use the tile manifest’s origin; legacy manifests retain the inherited NYC frame |
| Rendering and recording | Browser assembly, renderer protocol, actor recording, Electron and Unreal clients | Toronto asset selection, correction-pass isolation and transit actor rendering must be implemented before those clients can consume the Toronto world |

## Dataset and motion contracts

Building inputs live in `client/fixtures/toronto/`, with source provenance and transformation details. Transit inputs live in `client/fixtures/transit/`: routes, stops, shapes, trips, stop times, calendars and exceptions for a pinned service day. Bulk archives stay outside Git. Derived CTL1 files are regenerated under `client/.generated/toronto/`.

The Toronto profile anchors local coordinates at latitude 43.65, longitude −79.397. Building base elevation and transit elevation are flat local y=0 assumptions, not a measured terrain surface. Only the building crop has spatial coverage; scheduled transit extends along the full included route.

The GTFS actor model uses published distances, arrival times and departure times to interpolate motion and hold at stops. Service-day times beyond 24:00 remain on the selected calendar day in America/Toronto. Trip IDs are namespaced by service date; they are not live vehicle identities. Invalid or missing shapes produce explicit omissions. This model does not infer acceleration, signal response, vehicle capacity, passenger demand, collision avoidance or calibration.

The shared API exposes `transit.get_state`, also available as Python `world.get_transit_state()`. Its actors use ENU locations, with source trip/route/shape IDs, motion basis, service day, timezone and service seconds. They are read-only scheduled actors, separate from controllable vehicles in the inherited actor API. Server capabilities identify whether road navigation, pedestrians and scheduled transit are configured. Unsupported navigation and renderer operations fail explicitly.

## Roadmap

### Geographic coherence

Propagate city profiles through browser startup, Electron and renderer handshakes as well as the headless world. Keep geographic camera keys, API coordinates, compiled geometry and client metadata consistent. Reject mismatched data profiles rather than silently interpreting Toronto coordinates as Manhattan.

### Connected spatial data

Extend the shared tile pipeline with a bounded Toronto Centreline/track-and-intersection graph around Queen/Spadina. Match GTFS stops and shapes using documented tolerances and retain unmatched records. Add a licensed elevation crop with explicit horizontal and vertical datums. Shapes alone do not establish track topology, right-of-way or signal phases.

### Transit and street interactions

Start with stop/link occupancy and travel-time diagnostics. Add movement constraints and signal interactions only when the necessary geometry and rules are available. Keep schedule-derived motion, simulated behavior and measured observations distinguishable in APIs and exports.

### Toronto rendering

Reuse the inherited scene and rendering systems while selecting Toronto geometry and appropriate licensed assets. Remove operational dependence on NYC landmarks, street dressing, station details and facade overrides without deleting their attribution or historical implementations. Preserve neutral geometry where source data cannot justify detailed appearance.

### Scenarios and validation

Introduce explicit demand, capacities and interventions; compare outputs with suitable observed counts and travel times. Report coverage and uncertainty. Expand neighbourhood size only after measuring memory, load time and source coverage; a full-city archive is not a prerequisite for testing the shared contracts.

## Data and resource boundaries

The [source register](data-sources.md) records ownership, formats, coordinates, update cadence, access and licence evidence. Source licences are independent of code licences. In particular, the official City portal’s Toronto Open Government Licence evidence and conflicting CKAN fields remain explicit; they do not provide clearance for unrelated third-party assets.

The static inspection package enforces 2,600,000 total bytes, 700,000 JavaScript bytes and 16,384 tile bytes. These are distribution limits, not simulation memory estimates. The inherited NYC workflow requires substantially larger external datasets and assets. Live feeds, city-scale processing and hosted services are separate resource decisions; the included offline server requires none of them.
