# SixSim: Toronto adaptation handoff

## Start here

SixSim is the `calenirwin/sixsim` fork of Mehmet Kerem Turkcan's Valdrada (formerly
BoundlessNYC). The current runnable slice is a **procedural NYC building fixture**,
not a Toronto digital twin. It exercises the existing shared building generator in
a browser without downloading city tiles, models or textures. No Toronto records
or invented Toronto geometry have been added.

From the repository root, with Node >=22.12 (verified here with 24.19.0):

```sh
npm ci --ignore-scripts
npm --prefix client ci --ignore-scripts
npm --prefix client run dev:fixture
# http://127.0.0.1:5219/fixture.html
```

The fixture has rowhouse and mixed-use views. Drag to orbit, scroll to zoom.
Its separate Vite configuration excludes public banks and builds only the fixture:

```sh
npm --prefix client run build:fixture
CHROMIUM_PATH=/usr/bin/chromium npm --prefix client run test:fixture
```

Point `CHROMIUM_PATH` at an existing Chromium, or install Playwright's browser with
`npx playwright install chromium` at the root and omit that variable. The browser
install is optional and separate from city assets. `--ignore-scripts` avoids the
unneeded ffmpeg binary installer for this path; offline film tools need their own
setup. The smoke test launches and closes its own loopback preview server, rejects
external HTTP requests, checks page/console/HTTP errors, rendered mesh/triangle
counts and context health for both views. Screenshots go to ignored
`client/shots/fixture-{rowhouse,mixeduse}.png`. This verifies the shared generator,
not city streaming, traffic, perception or the Python server.

## Fork audit (2026-10-21)

- Origin default branch `main`: `eaee8b10b7962ca71efbeedfe80a7634405c1286`.
  Initial local branch `work` was clean and at that exact commit; origin had only
  `main` at inspection. Work is isolated on `pilot/toronto-readiness`.
- GitHub identifies `mkturkcan/valdrada` as parent and source. The fork has zero
  unique commits against upstream HEAD `3a017c1cb4c49b4a669043526e67a0e4118b3a30`
  and is one commit behind. That commit touches 55 files (+1585/-159), including
  rendering, tower geometry, core API buffering and replay tools. It was inspected,
  not merged. Compare separately before any later upstream sync.
- No project AGENTS.md or project skill files were present. Workspace instruction
  directories were empty. Existing README, BUILDING, LICENSING, client docs,
  compiler, projection, tile reader, server and core API were inspected.
- Original LICENSE, LICENSING, ACKNOWLEDGEMENTS and citations remain unchanged.
  New fixture code follows the repository MIT licence; this document follows its
  documentation licensing. Namespaces and upstream branding were not mass-renamed.

## Data and execution path

| Stage | Existing implementation | Toronto implication |
|---|---|---|
| Records | `client/tools/pipeline/fetch.mjs`, `client/DATA_SOURCES.md` | NYC Socrata/PLUTO/CSCL schemas cannot consume Toronto records unchanged. |
| Compiler | `compile.mjs`, `classify.mjs`, `binio.mjs` in that pipeline | Keep binary sections/manifest contract; add a small explicit input adapter. NYC facade classifications are assumptions, not Toronto observations. |
| Coordinates | `client/src/shared/geo.js` | Fixed Manhattan anchor (40.7831,-73.9712); 512 m near tiles, 2048 m far tiles; x east, y up, z south. Do not just change camera latitude. |
| Runtime | `client/src/world/{streamer,tiledata,assemble}.js`, `core/` | Tiles feed buildings/roads, graphs, furniture, simulation and rendering. NYC landmark overrides and dressing require an explicit Toronto opt-out. |
| API | `server/main.js` hosts Electron/client `?api=1`; `client/src/api/bridge.js` implements calls; `PythonAPI/valdrada` is TCP client | API coordinates are ENU, x east/y north/z up. `server/main.js` and `core/api/session.mjs` also hard-code the Manhattan origin; bridge map name is NYC. Update and test together in a later change. |
| Renderer options | WebGL client, headless core and UE renderer | Preserve these paths. This pilot does not validate Electron, Python stepping or UE. |

The fixture imports `src/main.js`, the existing procedural building demo consumed
by the city's `@nyc` subproject. It is deliberately separate from `client/src/main.js`.
The original client entry and production build remain intact.

## Verified state and gaps

- Clean lockfile installs with `npm ci --ignore-scripts` passed in root and client.
- Fixture production build: ~1.3 MB, no public asset banks. Chromium WebGL smoke
  passed: rowhouse 12 meshes / 20,982 rendered triangles; mixed-use 33 meshes /
  33,182 triangles; neither lost its context or emitted captured errors. Screenshots
  were produced and the rowhouse frame visually inspected. These are upstream
  procedural visuals, not validated Toronto architecture or city simulation.

- `npm --prefix client run build`: passed; upstream dynamic-import and large-chunk
  warnings remain. A successful bundle does not establish a loaded city.
- `npm --prefix client test`: fails with ENOENT for `public/tiles/manifest.json`.
  The original full-data suite remains strict; it is not silently skipped.
- `client/public` has committed basis/data/fonts/luts/settings (~52 MB), but no
  tiles/models/textures banks. Some committed data is NYC/OSM-derived (ODbL), not
  a Toronto fixture. The procedural fixture does not copy those banks.
- BUILDING describes 3.1 GB binary banks and 17.7 GB peak memory for a full city
  compile. No full compile or binary-bank download was attempted. Setup reported
  an upstream asset HTTP 503; this run did not retry or bypass it. The guide also
  describes access-controlled periods for the dataset. No credentials were added.
- Existing CI only deploys docs on main/manual dispatch. This branch adds a
  pull-request fixture/build check with read-only contents permission and no
  deployment step. Nothing is merged or hosted by this work.

## Toronto source decision before importing

On 2026-10-21, metadata was fetched (no archive download) from the official
[3D Massing catalogue](https://open.toronto.ca/dataset/3d-massing/) and its
[CKAN package API](https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=3d-massing).
The portal lists Open Government Licence – Toronto, while CKAN returns
`license_title: "License not specified"` and no licence URL. Package notes refer
to the Open Government Licence and describe illustrative-use limitations.
Resolve and record the applicable licence/attribution for the selected resource
before committing a redistributed subset. This is a provenance gap, not a claim
that public records require new credentials.

The listed 2025 WGS84 shapefile is resource
`667237d6-4d3c-4cf3-8cb7-e91c48d59375` (81,415,175 bytes); the multipatch archive is
145,110,632 bytes. Neither was downloaded. Confirm actual schema, CRS and height
semantics after retrieval; filename alone is not validation. Package notes also
identify MPAC/parcel information that the City cannot provide: do not recreate a
PLUTO equivalent from restricted assessment data or assume ownership/use fields.
Use only published fields and explicitly mark missing heights, floors and use.
Do not bring MetaHuman pedestrians into training/evaluation datasets; preserve
all component-specific terms in LICENSING.md when later assets are used.

## Next two experiments

1. **A real Toronto block, geometry only.** Choose one 512 m study area (proposed:
   Queen/Spadina; confirm this is the desired first neighbourhood). Resolve the
   source licence discrepancy above, then obtain the named ~81 MB public archive
   or a documented bounded official export. Keep raw data ignored; record URL,
   resource ID, retrieval date, SHA256, licence, source CRS and crop bounds. Extract
   at most 50 intersecting footprints with original IDs and observed height fields;
   retain missing values rather than inventing floors/heights. Inspect geometry
   validity, holes, units and extrema. A tiny fixture with explicit provenance and
   a reviewed local map overlay is the deliverable. Stop if access requires a new
   account, purchase or restricted parcel source.
2. **One tile through existing contracts.** After experiment 1, add a city profile
   shared by compiler, client and API origin reporting (default remains NYC).
   Adapt the subset into `binio.mjs` sections plus manifest, then exercise
   `parseTile`/`buildingsOf` and existing assembly at a Toronto camera location.
   Disable NYC-specific dressing/landmarks for that profile. Test lon/lat round
   trips, east/north orientation, negative tile boundaries, known footprint widths
   and client↔ENU transforms. Acceptance: the same real source IDs and heights
   survive decode, visible buildings stay inside the crop, NYC fixture still
   passes, and no background full-city requests occur. Add a verified Toronto
   Centreline segment only after this, marking lane count/width inference openly.
