# Toronto framework guide

SixSim is a provisional working name for the Toronto adaptation of Mehmet Kerem
Turkcan's Valdrada (formerly BoundlessNYC). The primary experience uses the
inherited world, tile streamer, actor replay and browser renderer.

## Run the application

Use Node >=22.12 (Node 24 in CI):

```sh
npm ci --ignore-scripts
npm --prefix client ci --ignore-scripts
npm --prefix client run dev:city
```

Open the URL printed by Vite with `?city=toronto`. The app includes source building
massing, street/GTFS context, scheduled 510 motion and a baseline/+60-second dwell
comparison. `npm run serve:toronto` exposes the same world through TCP/Python;
`npm run sim:toronto` exports deterministic world state. The `valdrada` Python
package and protocol names remain compatibility identifiers.

`build:publish` and `build:space` under `client` prepare static packages for the
existing publication path and relative-path static hosting respectively. Building
creates no deployment. See [the walkthrough](docs/toronto/demo.md).

## Coverage and boundaries

The included source crop is approximately 5.14 km² around Spadina: longitude
−79.410 to −79.385, latitude 43.642 to 43.665. It contains 5,587 massing records
(5,774 polygon parts), 29 streamed tiles, 1,589 source centreline segments and 81
context stops for routes 501/505/506/510. Only pinned route 510 schedules drive
moving symbols, on service day 2026-10-22 in America/Toronto.

A toggleable ground layer adds 44 generalized City green-space designations, also available in the source-network API; it does not establish vegetation, access rights or routing. An optional 2018 City classified-cover layer distinguishes historical canopy, grass, shrub and impervious classes at approximately 4 m display resolution. It replaces the designation overlay when enabled; canopy does not reveal the surface underneath, and neither layer supplies elevation. Ground is flat. Source footprints, holes and average heights are retained;
procedural colours/window patterns and ground texture are original illustration,
not measured facades, floor counts, land cover or terrain. GTFS links are service
geometry, not surveyed rails. No live tracking, collision response, interacting
traffic or whole-city completion is implied. Near tiles stream around the camera
target; no fabricated distant-city macros are supplied.

The 15-record `dev:toronto` inspector is a legacy import regression fixture.
`dev:fixture` uses upstream procedural NYC examples, explicitly not Toronto data.
Neither is the main Toronto runtime.

## Sources and reproduction

[Source register](docs/toronto/data-sources.md) ·
[Extraction/tile contracts](client/fixtures/toronto/README.md) ·
[Architecture and roadmap](docs/toronto/vision.md)

Normal builds use committed bounded fixtures and need no city-archive download.
Optional extraction verifies pinned official archive hashes before selecting
whole source records. Raw archives stay ignored. The main dataset page and
source-specific notes link OGL–Toronto; inconsistent CKAN licence tags remain
recorded in provenance, without claiming City clarification or legal assurance.
Code permission and data terms remain separate. Preserve [upstream attribution](ACKNOWLEDGEMENTS.md)
and [licensing notes](LICENSING.md).

The main renderer also exposes **City terrain · 2023**, a lazy-loaded municipal bare-earth inspection mode with CGVD2013 heights, 64 m near detail and a 512 m overview. It pauses/hides the flat district and restores it on return. Terrain coverage follows the official Toronto boundary; building, cover and interaction coverage do not become citywide with it. `world.get_elevation(longitude, latitude)` queries the same coarse surface and returns explicit missing status. Vertical alignment remains separate from terrain availability.
