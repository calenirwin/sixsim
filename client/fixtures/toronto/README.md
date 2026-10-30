# Toronto district sources and extraction

Contains information licensed under the [Open Government Licence – Toronto](https://open.toronto.ca/open-data-licence/). Sources: [City 3D Massing](https://open.toronto.ca/dataset/3d-massing/), [Toronto Centreline](https://open.toronto.ca/dataset/toronto-centreline-tcl/) and [merged TTC GTFS](https://open.toronto.ca/dataset/merged-gtfs-ttc-routes-and-schedules/). No City endorsement. Verify independently before legal or official use.

## Coverage and contracts

`district.geojson` retains 5,587 massing records, comprising 5,774 polygon parts, within `[west,south,east,north] = [-79.410,43.642,-79.385,43.665]`. This is approximately 5.14 km² around Spadina, from Harbord toward the rail corridor. Source parts are assigned once to the 512 m tile containing their bounding-box centre; vertices crossing internal tile boundaries remain intact. There are 29 near-detail tiles, with no fabricated far-distance macros. Panning streams neighbouring tiles through the inherited renderer.

Extraction retains whole records covered by the geographic crop. The provenance records 126 outer-boundary exclusions, invalid source record 137520 and tiny-ring record 137415. Any record containing a ring below 0.011 m² in the local metric approximation is omitted whole; geometry is not repaired, clipped or deduplicated. Source records can be parts of one physical building, so record counts are not building counts.

`district-network.json` retains 1,589 City centreline segments and 1,146 source intersection IDs. Whole lines intersecting the crop are retained, including endpoints outside it. Selected source classes cover roads, railways, trails and walkways; names, feature codes, intersection IDs and one-way attributes remain explicit. Connectivity uses official endpoint IDs, never geometric snapping. It does not establish lane connections, legal turns, surveyed streetcar tracks, signal phases, widths or traffic behavior.

GTFS context includes 25 clipped service shapes and 81 stops for routes 501, 505, 506 and 510 active on service day 2026-10-22, America/Toronto. Clipping creates display endpoints only, not network junctions. Paths are not surveyed rails; stop proximity does not establish a pedestrian transfer. Only the separately pinned route 510 schedule drives moving actors.

The original `block.geojson` / `provenance.json` pair remains a 15-record import regression fixture. It is separate from the procedural NYC building fixture and the district runtime.

## Provenance, coordinates and licence evidence

- `district-provenance.json` pins the massing archive URL, SHA256, extraction rules and subset hash. The archive is 81,415,175 bytes. Despite its WGS84 filename, its `.prj` declares Web Mercator metres (EPSG:3857 equivalent). Extraction checks that declaration before conversion to GeoJSON longitude/latitude.
- Massing IDs are snapshot-qualified zero-based DBF record indices, not persistent City property IDs. The source lacks `OBJECTID`. `AVG_HEIGHT` supplies extrusion height; other original height/source fields remain in GeoJSON. The 2025 archive includes earlier measurements, including LiDAR-derived fields associated with 2015 data.
- `network-provenance.json` pins the 29,511,680-byte centreline GeoPackage, retrieved 2026-10-23, its full SHA256 and selected resource URL. EPSG:4326 is verified through `gpkg_geometry_columns`. GTFS provenance references the pinned archive and existing transit provenance.
- The shared coordinate origin is latitude 43.65, longitude −79.397. CTL1 and browser coordinates use metres east/up/south. Building and transit elevations assume flat local y=0; no measured terrain is claimed. The source-network API returns explicitly labelled EPSG:4326 GeoJSON.
- Official dataset pages link the Toronto OGL. Massing notes additionally reference it explicitly. CKAN massing fields say `notspecified`; centreline licence fields are null and `isopen` is false. The subsets rely on the affirmative official page/licence evidence, retaining that discrepancy. No clarification from City staff or legal assurance is claimed. Code licensing does not grant rights to unrelated imagery, MPAC data or third-party assets.

## Build and use

Normal builds use committed subsets and need no archive downloads or Python geospatial dependencies:

```sh
npm ci --ignore-scripts
npm --prefix client ci --ignore-scripts
npm --prefix client run dev:city
npm run serve:toronto
```

The shared world compiles district CTL1 files and source-network metadata under ignored `client/.generated/toronto/`. Python `world.get_source_network()` returns the source graph with `routing: false`; `world.get_transit_state()` returns scheduled route 510 positions in API ENU coordinates. Traffic, pedestrian navigation and remote sensor rendering remain unavailable.

## Re-extract the pinned sources

Place the exact archives named below in ignored `client/data/toronto/`, using the URLs and hashes in the provenance files. Do not substitute a newer revision silently.

```sh
python -m venv client/data/toronto/.venv
client/data/toronto/.venv/bin/pip install -r client/tools/toronto/requirements.txt
# massing-2025.zip, centreline-20261023.gpkg, completegtfs.zip
client/data/toronto/.venv/bin/python client/tools/toronto/extract_district.py client/data/toronto
node --test client/tools/tests/district.mjs
```

The extractor is offline, verifies input hashes and emits deterministic source subsets. Raw archives and working files stay outside Git. The separate `extract.py` retains the original small-fixture extraction contract.

## Illustrative materials

The main renderer uses original deterministic procedural colours and anti-aliased window patterns on the source extrusions, with darker roof surfaces and a neutral textured flat ground plane bounded by the source crop. These are visual conventions, not observed facades, floor counts, roof materials, land use or elevation. No texture library, aerial imagery or new licence dependency is required. `AVG_HEIGHT` values up to the bounded 600 m import limit are retained; the selected maximum is 443 m. Whole invalid geometries and rings below the documented minimum area remain excluded, with snapshot IDs recorded in provenance.

## Green-space context

`green-spaces.geojson` contains 44 clipped official [Green Spaces](https://open.toronto.ca/dataset/green-spaces/) polygons; `green-spaces-provenance.json` pins the GeoPackage hash, CRS, licence evidence and clipping IDs. Reproduce with `python client/tools/toronto/extract_green_spaces.py client/data/toronto/green-spaces-20261030.gpkg` after installing the existing extraction requirements. The raw 8.9 MB GeoPackage stays ignored. The extractor verifies the exact source hash and EPSG:4326, preserves holes, and records invalid geometries rather than repairing them.

These generalized designations include potentially paved/private areas; they are not exhaustive land cover, access permissions or terrain. The renderer's class colours and flat elevation are illustrative. The same records are carried in `world.get_source_network()['greenSpaces']`; display clipping creates no routing edges.
