# Toronto massing subset: Queen / Spadina

15 source polygons in a block-sized window northeast of Queen Street West and
Spadina Avenue. This is a bounded **massing import**, separate from the procedural
NYC building fixture. It is not a traffic simulation or a complete city renderer.

Contains information licensed under the
[Open Government Licence – Toronto](https://open.toronto.ca/open-data-licence/).
Source: [City of Toronto, 3D Massing](https://open.toronto.ca/dataset/3d-massing/).
No City endorsement. Verify independently before legal or official use.

## Licence evidence and decision (accessed 2026-10-21)

| Official evidence | Observed value / implication |
|---|---|
| [Dataset page](https://open.toronto.ca/dataset/3d-massing/), Licence link | `Open Government Licence - Toronto`, linking directly to the City's licence. |
| [Package API](https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=3d-massing), `result.notes` | Starts its usage limitation with “Further to the Open Government Licence”; describes illustrative use, accuracy limitations and independent verification for official use. |
| Same API, structured fields | `license_id: notspecified`, `license_title: License not specified`, `isopen: false`, no `license_url`. These fields conflict with the affirmative page/notes. |
| [City licence](https://open.toronto.ca/open-data-licence/), “Using Information”, “You are free to”, attribution and exemptions | Permits adaptation and redistribution, including commercial use, with attribution; excludes rights the City cannot grant and disallows implied endorsement. Version 1.0. |

Decision: use the affirmative dataset-specific page and notes, together with the
linked City licence, as the permission for this attributed massing subset. The
unspecified CKAN tag is treated as a catalogue metadata defect, not as an explicit
contrary restriction. This resolves the previous pilot's reason to defer this
subset; it does **not** claim the API has been corrected or that City staff have
confirmed the interpretation. Preserve that residual metadata uncertainty in
`provenance.json`. No MPAC/parcel/ownership records, third-party photographs or
restricted assets are imported. The dataset itself warns that some assessment
information cannot be supplied; this importer does not fill those gaps.

## Exact source and transformations

- Resource `667237d6-4d3c-4cf3-8cb7-e91c48d59375`,
  `3DMassingShapefile_2025_WGS84.zip`, 81,415,175 bytes. Official download URL and
  full SHA256 are in [provenance.json](provenance.json). Only this archive was
  downloaded (~81 MB), not the ~145 MB multipatch or any multiGB city bank.
- `.prj` says `WGS_1984_Web_Mercator_Auxiliary_Sphere`, with metre units
  (EPSG:3857 equivalent). **The filename does not mean lon/lat degrees.** Extractor
  checks the archive hash and CRS declaration before inverse spherical Mercator
  conversion. Raw archive and extracted working files are ignored.
- Window `[west,south,east,north] = [-79.3965,43.6484,-79.3948,43.6498]`, approximately
  137 × 156 m. Keep whole polygons fully covered by that box: 15 retained, 10
  boundary intersections excluded. No clipping, geometry repair or deduplication.
  Source Z values are not used as footprint coordinates. Validity checked with
  Shapely; holes/multipart topology is retained by extraction and tile encoding.
- The DBF has no `OBJECTID`, despite the workbook listing one. IDs are explicitly
  snapshot-qualified, zero-based record indices, tied to the archive hash. Do not
  treat these as persistent building, property or parcel identifiers.
- `AVG_HEIGHT` is the observed height field in metres (range 3.5731–23.9340 in this
  subset), not a floor-count estimate. The archive workbook describes it as the
  maximum average footprint height. `HEIGHT_SRC`, `BLDG_SRC`, min/max heights,
  `HEIGHT_MSL` and `SURF_ELEV` are retained in the source subset. These selected
  records are LiDAR-derived/photogrammetric; the workbook associates LiDAR heights
  with 2015 data. “2025 archive” is not a claim of a 2025 survey of every building.
- The viewer extrudes each record to `AVG_HEIGHT` on **flat local y=0**. Surface
  elevations and roof tiers are not modelled. Records can be parts of the same
  building; the count is source masses, not unique buildings. No facades, floors,
  land use, roads, elevation surface or traffic are invented.

## Reproduce without a download

From repository root (Node >=22.12; verified with Node 24):

```sh
npm ci --ignore-scripts
npm --prefix client ci --ignore-scripts
npm --prefix client run dev:toronto
# http://127.0.0.1:5219/toronto.html
npm --prefix client run test:toronto
CHROMIUM_PATH=/usr/bin/chromium npm --prefix client run test:toronto:browser
```

Use an existing Chromium path or Playwright's installed browser (omit
`CHROMIUM_PATH`; `npx playwright install chromium` at root if needed).

`compile:toronto` creates ignored `client/.generated/toronto/0_0.bin` and
`manifest.json`. It uses upstream `binio.mjs` and the existing 44-byte `bldg`,
`bldgXZ` and `bholes` contracts. A profile header stores an explicit origin
(43.65,-79.397), units, source identities, flat-base decision and unknown fields.
The shared local projection follows upstream's x east / y up / z south convention.

The viewer fetches that CTL1 tile and uses upstream `parseTile`, `buildingsOf` and
`holesOf`; `buildingsOf(..., {applyOverrides:false})` prevents NYC landmark facts
from contaminating Toronto records. The default is unchanged for the NYC client.
Neutral Three.js extrusion is a small inspection surface. **Full `assembleTile`,
streaming, traffic, Electron/Python API and UE are not adapted or tested for
Toronto.** Do not put this tile into the NYC public bank: facade style is deliberately
unclassified (255), floors unknown (0), and terrain is a display plane.

Tests cover exact subset hash, deterministic binary output, source IDs/heights,
coordinate round trips, winding, synthetic holes/multipart cases, rejected invalid
heights/bounds, and both enabled/disabled NYC overrides. Browser tests check real
rendering (15 masses / 528 triangles), picking a known record, attribution,
downloadable source/provenance, licence notices and no external/root-relative
requests when served below `/sixsim/`. Screenshots are CI artifacts and ignored
locally at `client/shots/toronto-*.png`.

## Optional source re-extraction

Normal build and CI use the small committed GeoJSON; neither needs Python or the
81 MB archive. To audit the extraction:

```sh
python -m venv client/data/toronto/.venv
client/data/toronto/.venv/bin/pip install -r client/tools/toronto/requirements.txt
# Obtain the exact archive URL from provenance.json into the ignored path below.
# Expected size 81,415,175 bytes; cap a transfer at 90,000,000 bytes.
client/data/toronto/.venv/bin/python client/tools/toronto/extract.py client/data/toronto/massing-2025.zip
npm --prefix client run test:toronto
```

Extractor refuses a different hash, size, CRS declaration or invalid geometry.
Do not update the pinned revision automatically. A new source revision needs a
fresh provenance and licensing review; the raw archive is never committed.
