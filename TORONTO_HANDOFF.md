# SixSim: Toronto adaptation handoff

## Runs now

SixSim is `calenirwin/sixsim`, a fork of Mehmet Kerem Turkcan's Valdrada (formerly
BoundlessNYC). There are now **two distinct, small browser paths**:

| Path | What is real / procedural | Start from repository root |
|---|---|---|
| Toronto massing study | 15 real City of Toronto massing records near Queen/Spadina, in a ~24 KB attributed source subset. Observed footprints/AVG_HEIGHT; flat display base, no inferred facades/roads/traffic. | `npm --prefix client run dev:toronto`, open `http://127.0.0.1:5219/toronto.html` |
| Upstream generator fixture | Procedural NYC rowhouse/mixed-use examples, explicitly **not Toronto data**. | `npm --prefix client run dev:fixture`, open `http://127.0.0.1:5219/fixture.html` |

Both use port 5219; run one development server at a time. Setup with Node >=22.12
(verified with 24.19.0): `npm ci --ignore-scripts` then
`npm --prefix client ci --ignore-scripts`. The normal build/test path needs no city
archive or multiGB asset banks. Ignoring install scripts avoids an unnecessary
ffmpeg download; film-rendering tools need their own setup.

The Toronto path compiles one ~4 KB CTL1 tile using the existing binary writer,
then fetches and decodes it with the existing runtime tile reader. A neutral
massing inspector lets you orbit, look from above and select source records. This
is a bounded **import/decoder/rendering vertical slice**, not the full Toronto
simulation. It does not run `assembleTile`, the city streamer, traffic, the
Electron/Python API or UE. Default NYC simulation coordinates remain unchanged.

See [source evidence and reproduction](client/fixtures/toronto/README.md),
[machine-readable provenance](client/fixtures/toronto/provenance.json) and
[free hosting assessment](client/fixtures/toronto/HOSTING.md).

## Source/licence resolution

The first pilot deferred Toronto data because the API licence tag was unspecified.
On the continuation, the official dataset page's explicit licence link, the
package's dataset-specific licence reference, and the linked City licence were
checked together. They support this attributed subset under the Open Government
Licence – Toronto. The inconsistent CKAN fields remain recorded; no claim is made
that the City fixed them or separately confirmed the interpretation.

One official 81,415,175-byte 2025 archive was downloaded and hashed. No multipatch,
full-city NYC bank, restricted parcel source or imagery was downloaded. Only 15
whole polygons fit the selected ~137 × 156 m window; ten boundary intersections
were excluded. Source details matter:

- The archive filename says WGS84, but its `.prj` is Web Mercator metres. It is
  explicitly transformed to longitude/latitude before local metric projection.
- The DBF lacks an official OBJECTID despite the metadata workbook. IDs are
  snapshot-qualified archive record indices, not stable building/property IDs.
- `AVG_HEIGHT` is retained as observed; floors/use/facades remain unknown. Source
  masses may be parts of buildings, and older measurements exist in the 2025
  archive. This is illustrative, not surveyed current building truth.
- The source subset, derived Toronto-only tile and code have separately stated
  licences. Existing NYC/OSM/CARLA/MetaHuman terms remain unchanged. No OSM geometry
  is merged into the Toronto subset. Original LICENSE/citations are preserved;
  LICENSING.md adds a scoped Toronto exception with attribution and evidence.

## Checks

```sh
npm --prefix client run test:toronto
CHROMIUM_PATH=/usr/bin/chromium npm --prefix client run test:toronto:browser
CHROMIUM_PATH=/usr/bin/chromium npm --prefix client run test:fixture
npm --prefix client run build
```

Use an existing Chromium, or `npx playwright install chromium` at the root and omit
`CHROMIUM_PATH`. Browser tests launch/close their own loopback servers. Screenshots
are in ignored `client/shots/` and uploaded by the PR workflow.

- Six Toronto Node tests cover provenance hashes, deterministic CTL1 encoding,
  source identities/heights/coordinates, projection/winding, holes/multipart
  handling, rejected invalid inputs and preservation/opt-out of NYC overrides.
- Toronto production browser test renders 15 masses / 528 triangles with no
  captured errors or context loss, picks a known source record and checks source,
  provenance and licence files. It runs below `/sixsim/` to exercise project-path
  static hosting, with one tile request and no external/root-relative requests.
- Procedural fixture smoke renders both upstream scenes. The full client build
  passes with existing dynamic-import and large-chunk warnings.
- Original `npm --prefix client test` still requires absent
  `public/tiles/manifest.json`; no silent skip or claim that full-data tests pass.
- PR workflow checks both small browser paths and the full build. It has read-only
  contents permissions and no deployment step. No merge or deployment performed.

## Fork audit and architecture

Initial origin main was `eaee8b10b7962ca71efbeedfe80a7634405c1286`, local `work`
was clean at that commit and origin had only main. GitHub confirms parent/source
`mkturkcan/valdrada`. At inspection upstream HEAD was
`3a017c1cb4c49b4a669043526e67a0e4118b3a30`: the fork had zero unique commits and
was one commit behind (55 files, +1585/-159). That upstream rendering/core/replay
change was inspected, not merged. All work remains on `pilot/toronto-readiness`.
No project AGENTS.md or project skill files were present; workspace instruction
directories were empty.

| Stage | Existing implementation | Toronto status / next work |
|---|---|---|
| Records | `client/tools/pipeline/fetch.mjs`, `client/DATA_SOURCES.md` | Keep NYC schema handling; separate bounded Toronto extractor is `client/tools/toronto/extract.py`. |
| Compiler | `compile.mjs`, `classify.mjs`, `binio.mjs` | Small Toronto importer reuses `binio.mjs`, 44-byte building records and hole sidecar; full compiler stays NYC. |
| Coordinates | `client/src/shared/geo.js` | Fixed Manhattan origin remains. New explicit local-frame helper/profile is used only by the Toronto slice. |
| Runtime | `client/src/world/{streamer,tiledata,assemble}.js`, `core/` | Existing parser/building/hole iterators decode Toronto CTL1; optional NYC override opt-out defaults to existing behaviour. Full assembly is not yet city-profile aware. |
| API | `server/main.js`, `client/src/api/bridge.js`, `PythonAPI/valdrada`, `core/api/session.mjs` | Client frame x east/y up/z south; API ENU x east/y north/z up. Server/core also hard-code Manhattan, bridge map name is NYC. Coordinate/profile migration must update them together later. |
| Assets | `client/public` basis/data/fonts/luts/settings (~52 MB) | Original tiles/models/textures absent. Upstream guide describes 3.1 GB banks and 17.7 GB peak full compile memory; setup reported asset HTTP 503. No access bypass or full-city compile attempted. |

## Hosting and next two experiments

The Toronto build is ~650 KB and entirely static. GitHub Pages (public project)
and Hugging Face **Static** Spaces are viable CAD $0/month candidates within the
user's CAD $20–30 monthly ceiling. No paid compute is needed for this study. The
[assessment](client/fixtures/toronto/HOSTING.md) records official limits and the
existing documentation Pages workflow conflict to resolve before publishing.
No hosting destination, account, DNS, secret or deployment was changed.

1. **Review source geometry and height interpretation.** Validate the selected
   record IDs against a bounded official source/map, confirm whether the window is
   the desired neighbourhood and inspect overlapping/tier records. Compare
   AVG_HEIGHT/MAX_HEIGHT with explicit labels before choosing a richer envelope;
   retain provenance and never invent missing values. Decide whether to extend
   the crop to complete the physical block. The present crop excludes boundary
   buildings and is not complete coverage.
2. **Integrate one tile into the real city runtime.** Introduce a shared city
   profile for compiler/client/API origin and map reporting, retaining NYC as the
   default. Explicitly disable NYC dressing/landmarks/ground overlays for Toronto
   before using `assembleTile`. Verify client↔ENU transforms, source IDs/heights,
   camera placement and zero background city-bank requests. Only then consider a
   licensed Toronto Centreline segment; distinguish measured widths/lane counts
   from inference. This is the remaining simulation integration, not something
   this massing viewer claims to have completed.

## Static delivery continuation

The bounded demo now has a default index, a deterministic SHA256 file inventory,
automatic byte-budget checks and a CI `toronto-static-demo` artifact. Five delivery
unit tests and a plain-server browser suite cover failure/reload behaviour and
root/nested deployment paths; two clean builds must match. See the
[delivery evidence and commands](client/fixtures/toronto/HOSTING.md#verified-static-package-and-recovery).
This continuation changes transport/boot and packaging only; source GeoJSON,
provenance, compiler, projection and shared decoder remain as previously reviewed.

Next independent review: audit importer/runtime regressions and coordinate/data
integrity against the exact PR head. Check the source revision/selection/height
semantics, multipart/hole winding and bounds, NYC override opt-out/default
preservation and client-frame assumptions. Report reproducible findings first;
coordinate any implementation edits before overlapping these files. Full-city
assembly/API integration remains the next implementation decision, not a feature
of this static delivery pass. Design exploration is paused.
