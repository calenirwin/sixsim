# SixSim — Toronto adaptation of Valdrada

SixSim is a **provisional working name** for Calen Irwin’s Toronto-focused fork of [Valdrada](https://github.com/mkturkcan/valdrada), created by Mehmet Kerem Turkcan. The repository inherits the NYC simulator and its earlier BoundlessNYC identifiers. **This is an early adaptation, not a completed Toronto city simulator.**

## What exists today

On [draft PR #1](https://github.com/calenirwin/sixsim/pull/1), the inherited headless world now loads a real Toronto CTL1 massing tile and advances 510 Spadina GTFS trip actors on its simulation clock. This is a **non-interacting, schedule-driven motion baseline**, not live tracking or a calibrated traffic simulation. It uses 15 building records and the pinned 2026-10-22 service day; the full route extends beyond the building crop.

There is no Toronto road graph, terrain, passenger demand, collision response or signal interaction yet. NYC traffic, pedestrians and train services are disabled in this bounded run. The inherited NYC application, Electron/server/Python API, Unreal client and geographic camera paths remain NYC-specific. The procedural rendering fixture is synthetic. See the [reference audit](docs/toronto/reference-audit.md).

## Run the Toronto simulation slice

With Node 24, from the repository root:

```sh
npm ci --ignore-scripts
node tools/toronto/simulate.mjs > /tmp/toronto-simulation.json
npm run test:toronto:sim
```

The command compiles the checked-in building subset, loads it through the inherited headless streamer, and records 61 snapshots from 08:00:00 to 08:01:00 America/Toronto. Output includes stable service-day/trip IDs, local metric positions, source provenance and omitted-trip IDs. No city download, renderer, credentials or fleet models are required. See [the simulation and data contract](docs/toronto/vision.md#current-simulation-contract).

The existing massing viewer and corridor study remain data-inspection tools; they are not the simulation entry point. `main` remains the inherited baseline until this draft is reviewed and merged.

## Direction and data

- [Toronto vision and architecture roadmap](docs/toronto/vision.md): proposed capability layers, boundaries and milestones.
- [Data-source register](docs/toronto/data-sources.md): primary sources, licences, coordinates, access and integration status.
- [Decisions and actual unblockers](docs/toronto/decisions-needed.md): what needs Calen’s input and what can proceed now.
- [Technical handoff](TORONTO_HANDOFF.md), [sample provenance](client/fixtures/toronto/README.md) and [static hosting assessment](client/fixtures/toronto/HOSTING.md).

## Inspect the source geometry

Use the PR branch until it is reviewed and merged. With Node 24 (the CI version):

```sh
npm ci --ignore-scripts
npm --prefix client ci --ignore-scripts
npm --prefix client run dev:toronto
```

The checked-in source subset is sufficient; no city archive or new credentials are needed. `npm --prefix client run build:toronto` produces `client/dist-toronto/`. Source/runtime checks: `npm --prefix client run test:toronto`; delivery checks: `npm --prefix client run test:toronto:delivery`. Browser checks require Chromium; exact commands and limitations are in the handoff. Do not run the full NYC fetch/compile just to try this prototype.

## Attribution and licensing

Original Valdrada code is copyright © 2026 Mehmet Kerem Turkcan under the [MIT licence](LICENSE). SixSim preserves that copyright, [upstream acknowledgements](ACKNOWLEDGEMENTS.md) and [citation](CITATION.cff). [The upstream overview](UPSTREAM.md) documents the inherited NYC project, not SixSim’s shipped features.

Code permission does not confer permission for every dataset or asset. [LICENSING.md](LICENSING.md) records the separate documentation, OSM-derived city, models, fonts and engine terms. The Toronto subset carries this notice: **Contains information licensed under the Open Government Licence – Toronto.** Its [provenance](client/fixtures/toronto/provenance.json) and [licence evidence](docs/toronto/data-sources.md#massing-licence-evidence) record the conflicting CKAN metadata; no City endorsement or legal assurance is implied. No full-city data redistribution or public deployment is part of this work.
