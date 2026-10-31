# Toronto city simulation

A Toronto adaptation of [Valdrada](https://github.com/mkturkcan/valdrada), bringing the city’s buildings, streets and transit into a shared simulation framework. The aim is to explore how Toronto moves and how changes to its transport network affect urban life, with traceable source data and explicit behavioral assumptions.

The project builds on Valdrada’s tile pipeline, simulation clock, rendering architecture, TCP API and Python client. **SixSim is the working name**; display identity is separate from geographic profiles and data contracts.

## Run

Requires Node 24. From the repository root:

```sh
npm ci --ignore-scripts
npm run serve:toronto
```

The headless server listens on `127.0.0.1:2000`. It compiles the included Toronto massing subset and loads a pinned 510 Spadina GTFS service day. No city archive, GPU or credentials are required. To choose another local port:

```sh
node tools/core/serve.mjs --city toronto --port 2020
```

Use the existing Python client (Python 3.9+):

```sh
PYTHONPATH=PythonAPI python3 - <<'PY'
import valdrada
client = valdrada.Client()
try:
    world = client.get_world()
    print(client.get_server_info())
    world.tick()
    print(world.get_transit_graph())
    print(world.get_transit_state())
finally:
    client.close()
PY
```

The browser’s **Downstream departures & gaps** panel compares timetable and experiment departures for the included comparison trip, with gaps to the preceding same-pattern trip. These are schedule-derived events, not live service headways.

The `valdrada` import and protocol identifiers remain stable for compatibility. `transit.get_state` returns schedule-derived trip positions in the API’s east/north/up coordinate frame. It does not report observed vehicles. For a deterministic JSON export without a server:

```sh
node tools/toronto/simulate.mjs > /tmp/toronto-simulation.json
```

## Data and behavior

Coverage is layer-specific: **municipal bare-earth terrain** follows the official Toronto boundary (about 641.57 km²), with **427,584 source building records in 2,469 municipal tiles**. Classified cover and road context remain the **5.14 km² Spadina district**. Moving actors remain the pinned **510 schedule**, not citywide interacting traffic. The geographic goal is the full municipality, not the GTA.

Use **Municipal buildings & terrain** in the main browser to inspect source elevations across Toronto, with a 512 m overview and 64 m near detail. Terrain loads on demand and uses CGVD2013 metres at true vertical scale. Colours indicate elevation, not land cover. **Return to district simulation** restores the camera and paused recording. Municipal buildings preserve source footprints and average heights on illustrative level bases sampled from the terrain. These are not surveyed foundations: source surface datums remain unresolved, slopes may intersect bases, and roads/bridges/actors are not draped onto bare earth. The district simulation retains its flat vertical model. Python `world.get_elevation(longitude, latitude)` returns the same sampled surface and explicit missing values; it does not return road or actor elevation.

The separate simulation district covers 5,587 City massing records (5,774 polygon parts) across 29 streamed tiles around Spadina, from Harbord toward the rail corridor. Its geographic bounds are longitude −79.410 to −79.385 and latitude 43.642 to 43.665, approximately 5.14 km². The source network adds 1,589 City centreline segments and 81 stops with GTFS paths for routes 501, 505, 506 and 510. Moving actors use route 510 on the **2026-10-22 service day**, in **America/Toronto**. Route coverage extends beyond the building crop. A toggleable layer adds 44 official green-space designations; these include potentially paved/private areas and do not establish vegetation or public access. An optional 2018 City classified-cover layer distinguishes historical canopy, grass, shrub and impervious classes at approximately 4 m display resolution. It replaces the designation overlay when enabled; canopy does not reveal the surface underneath, and neither layer supplies elevation. Buildings use source average heights on a flat local base, with original procedural colours/window patterns rather than measured facade textures; transit actors follow validated directed stop-to-stop GTFS links, with explicit stop dwell and link occupancy, including times beyond 24:00. Missing shapes are omitted explicitly. Source centrelines retain official intersection IDs and one-way attributes; GTFS paths are service geometry, not surveyed rails or inferred transfer walks.

Road traffic, pedestrian navigation, passenger demand, signal interaction and calibrated vehicle dynamics require Toronto network and behavioral inputs. Those models are disabled for this dataset. Python `world.get_source_network()` exposes the source GeoJSON and intersection adjacency in EPSG:4326, without asserting a routable lane graph. The main browser selects Toronto massing, centreline/path context and symbolic trip markers through the inherited renderer, tile streamer and ATRK actor replay. The NYC profile retains its own assembly and assets. Electron, Unreal and live remote sensor rendering are not adapted to the Toronto dataset; unsupported requests fail explicitly.

## Browser

```sh
npm --prefix client ci --ignore-scripts
npm --prefix client run dev:city
```

This opens the main application with `?city=toronto`. It renders the source buildings and scheduled-trip **symbols**, using the inherited engine, tile streamer and actor-replay pools. Drag to orbit, right-drag or use two fingers to pan, and scroll or pinch to zoom. Grey lines are City centrelines, ochre lines are GTFS service paths and blue points are stops. Teal links show scheduled graph occupancy. Use Pause/Play and Restart, or Space and R on a keyboard. The Recording selector compares the published timetable with the +60-second dwell experiment at the same paused time; Focus comparison trip locates the affected marker. The five-minute ATRK recording runs from 08:00 to 08:05 on the included service day, sampled once per second. It is regenerated from the shared headless world before startup; it is not a live connection to the TCP server. Markers do not represent measured vehicle dimensions or heading. Whole building polygon parts are assigned once to a 512 m tile and retain their boundaries. Source records with invalid geometry or rings below 0.011 m² are listed as exclusions in provenance. Geometry outside the crop and far-distance building substitutes are absent; pan to stream neighbouring tiles. The grid is a coordinate reference rather than measured terrain.

`npm --prefix client run build` builds the application. The default browser profile and `node tools/core/serve.mjs --city nyc` retain the inherited NYC path, which requires its separately obtained assets and data. See [the upstream guide](UPSTREAM.md) for those requirements.

A [fixed extra-dwell experiment](docs/toronto/vision.md#fixed-extra-dwell-experiment) can hold one scheduled trip for 60 additional seconds at a selected stop and propagate the delay downstream through the shared runtime. The baseline remains the default.

For a concise presentation, source coverage and local Hugging Face static packaging, see the [Toronto demo walkthrough](docs/toronto/demo.md). The package uses this same application and requires no hosted backend.

## Roadmap

1. Carry explicit Toronto geography and source identity through the existing runtime, APIs and clients.
2. Connect building massing, elevation, streets and streetcar tracks in the shared tile pipeline.
3. Match GTFS stops and shapes to a navigable network; model stop/link occupancy before adding traffic and signal interactions.
4. Adapt the existing renderer and asset selection to Toronto, preserving measured geometry and source attribution.
5. Introduce demand and scenario experiments with stated assumptions and comparison against observed data.

[Architecture and roadmap](docs/toronto/vision.md) · [Data sources and licensing evidence](docs/toronto/data-sources.md)

## Attribution and licensing

This fork is maintained by Calen Irwin. Valdrada was created by Mehmet Kerem Turkcan; original code is copyright © 2026 Mehmet Kerem Turkcan under the [MIT licence](LICENSE). The [upstream acknowledgements](ACKNOWLEDGEMENTS.md), [citation](CITATION.cff) and historical BoundlessNYC compatibility identifiers are preserved.

Code, documentation, datasets and art assets have separate terms; see [LICENSING.md](LICENSING.md). **Contains information licensed under the Open Government Licence – Toronto.** Building and transit fixtures retain source URLs, retrieval dates, checksums and transformation details. The [source register](docs/toronto/data-sources.md#massing-licence-evidence) records the official Toronto licence evidence and conflicting CKAN metadata. No City endorsement is implied, and Toronto data terms do not replace inherited third-party licences.
