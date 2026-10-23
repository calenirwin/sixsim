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
    print(world.get_transit_state())
finally:
    client.close()
PY
```

The `valdrada` import and protocol identifiers remain stable for compatibility. `transit.get_state` returns schedule-derived trip positions in the API’s east/north/up coordinate frame. It does not report observed vehicles. For a deterministic JSON export without a server:

```sh
node tools/toronto/simulate.mjs > /tmp/toronto-simulation.json
```

## Data and behavior

The included data covers 15 City building records near Queen/Spadina and route 510 on the **2026-10-22 service day**, in **America/Toronto**. Route coverage extends beyond the building crop. Buildings use source average heights on a flat local base; transit positions interpolate published shapes and schedules, including times beyond 24:00. Missing shapes are omitted explicitly.

Road traffic, pedestrian navigation, passenger demand, signal interaction and calibrated vehicle dynamics require Toronto network and behavioral inputs. Those models are disabled for this dataset. The main browser selects Toronto massing and symbolic trip markers through the inherited renderer, tile streamer and ATRK actor replay. The NYC profile retains its own assembly and assets. Electron, Unreal and live remote sensor rendering are not adapted to the Toronto dataset; unsupported requests fail explicitly.

## Browser

```sh
npm --prefix client ci --ignore-scripts
npm --prefix client run dev:city
```

This opens the main application with `?city=toronto`. It renders the source buildings and scheduled-trip **symbols**, using the inherited engine, tile streamer and actor-replay pools. Drag to orbit, scroll to zoom, Space to pause and R to restart. The five-minute ATRK recording runs from 08:00 to 08:05 on the included service day, sampled once per second. It is regenerated from the shared headless world before startup; it is not a live connection to the TCP server. Markers do not represent measured vehicle dimensions or heading. Geometry outside the building crop is absent, and the grid is a coordinate reference rather than measured terrain.

`npm --prefix client run build` builds the application. The default browser profile and `node tools/core/serve.mjs --city nyc` retain the inherited NYC path, which requires its separately obtained assets and data. See [the upstream guide](UPSTREAM.md) for those requirements.

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
