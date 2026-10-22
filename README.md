# SixSim — Toronto adaptation of Valdrada

SixSim is Calen Irwin’s Toronto-focused fork of [Valdrada](https://github.com/mkturkcan/valdrada), created by Mehmet Kerem Turkcan. The repository inherits the NYC simulator and its earlier BoundlessNYC identifiers. **This is an early adaptation, not a completed Toronto city simulator.**

## What exists today

On [draft PR #1](https://github.com/calenirwin/sixsim/pull/1), a real Toronto massing prototype imports 15 City source records into the existing CTL1 binary tile contract and renders them in a separate web entry point. It includes provenance, picking, loading failures, a reproducible static package and browser tests. It uses flat ground and neutral building extrusions. A separate [510 Spadina offline GTFS study](client/fixtures/transit/README.md) now shows one pinned service day and schedule-derived positions, sharing the massing coordinate frame. There is no Toronto traffic, terrain, live tracking or calibrated simulation. The separate procedural fixture is synthetic and is not Toronto evidence. The unmerged `main` branch still represents the inherited NYC application.

The NYC compiler, renderer special cases, simulation defaults, Electron/server/Python API and Unreal client remain upstream implementations. Renaming them would not port their geography or behaviour. See the [reference audit](docs/toronto/reference-audit.md).

## Review the current corridor

[Open the local review checkpoint](docs/toronto/review.md): one command starts the corridor, with desktop/mobile controls, source evidence and the proposed Toronto direction in the same page. No credentials or new data download are needed.

## Direction and data

- [Toronto vision and architecture roadmap](docs/toronto/vision.md): proposed capability layers, boundaries and milestones.
- [Data-source register](docs/toronto/data-sources.md): primary sources, licences, coordinates, access and integration status.
- [Decisions and actual unblockers](docs/toronto/decisions-needed.md): what needs Calen’s input and what can proceed now.
- [Technical handoff](TORONTO_HANDOFF.md), [sample provenance](client/fixtures/toronto/README.md) and [static hosting assessment](client/fixtures/toronto/HOSTING.md).

## Run the bounded prototype

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
