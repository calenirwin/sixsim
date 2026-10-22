# Toronto vision and architecture roadmap

SixSim’s proposed direction is a reproducible Toronto city model that can support exploration and, eventually, explicit mobility and urban scenarios. Visual detail should remain traceable to sources; simulated behaviour should state its assumptions. This is a direction for discussion, not approval of a fixed feature set or a claim of predictive validity.

## Working identity

**SixSim is a provisional working name.** A more Toronto-specific, professional public identity may replace it; no name or repository change is decided here. Keep display branding separate from provider IDs, data schemas, source provenance and geographic profiles. New user-facing surfaces should share configurable display identity where practical, rather than introducing product-name dependencies into import/runtime contracts or new infrastructure. The GTFS slice uses TTC IDs, route numbers and service dates, not a SixSim-specific data namespace.

## Current boundary

The draft branch contains a 15-record real massing slice, a small binary importer and an isolated Three.js viewer. Buildings use observed average heights on a flat plane. The inherited headless world now steps 510 Spadina trip actors from a pinned static GTFS service day alongside the massing tile; the separate corridor page remains an inspection aid. No Toronto street graph, terrain, population, demand model or calibrated simulation is integrated. The procedural NYC fixture exercises inherited rendering but supplies no Toronto facts. Main remains the upstream NYC baseline until review.

## Preserve the architecture, make geography explicit

| Boundary | Existing contract | Toronto increment |
|---|---|---|
| Source acquisition | Offline pipeline tools and source files | Pin source URL, date, checksum, licence, CRS and extent before conversion; keep bulk originals outside Git |
| Normalization | Geographic inputs compiled to local coordinates | Explicit city profile; validate horizontal/vertical units, axis direction, stable source identity and missing attributes |
| Tile compilation | Existing CTL1 writer and decoder | Retain format and hole semantics; add bounded datasets with round-trip checks before format changes |
| Runtime and rendering | Shared tile decoding plus NYC-specific assembly, facades and landmarks | Toronto viewer already uses shared decoding and disables NYC overrides; progressively isolate actual geographic assumptions rather than relabel NYC landmarks |
| Simulation | Inherited fixed-step world, tile streamer, road/actor systems | GTFS actor model now runs inside the world step; build a Toronto navigation graph before enabling interactions |
| Application/API | Web, Electron, Python API and Unreal clients | Keep the web slice the cheapest validation surface; port other clients only when a concrete use case requires parity |

The headless Toronto entry point exercises the inherited world step and tile streamer, with NYC correction passes explicitly disabled. It does not exercise the complete upstream renderer, road traffic, recording format or Python API. A shared binary format alone does not establish compatibility with every downstream client. Changing origins must cover server/session metadata, picking, camera positions and exported coordinates together.

## Proposed capability layers

1. **Evidence-backed city base:** buildings, terrain and transport geometry with source versions, coverage and uncertainty visible.
2. **Coherent city explorer:** streamed bounded neighbourhoods, reliable camera/picking, performance budgets and source inspection; architectural style remains separate from measured geometry.
3. **Multimodal network and time:** walkable connections, TTC route/stop topology and service calendars; then GO/UP connections where useful. Timetable animation is not a calibrated traffic model.
4. **Scenario simulation:** explicit demand, capacities, movement rules and interventions, compared against observed counts with documented error. Missing socioeconomic or travel-demand inputs must not be invented.
5. **Reproducible experiments:** versioned scenarios, seeds, source manifests and evaluation outputs through existing APIs where practical.

## Next milestones and acceptance evidence

| Milestone | Bounded result | Acceptance gate |
|---|---|---|
| M1: reference and source clarity | This roadmap, register and audit | Readers can distinguish upstream capability, Toronto prototype and proposals |
| M2: spatial integrity | Current block plus nearby street/walkway graph | CRS/axis/height checks, graph exclusions, preserved provenance; no fake connections across grade-separated infrastructure |
| M3: scheduled transit experiment | One TTC corridor and service day | Routes/stops/shapes join correctly; calendar exceptions, after-midnight times and timezone handled; no live-feed dependency |
| M4: terrain and neighbourhood | Small licensed elevation crop, then bounded adjacent tiles | Vertical datum reconciled, seams checked, reproducible output and explicit memory/download budgets |
| M5: simulation question | One chosen mobility/scenario question | Named inputs, validation baseline and success metric agreed before expanding actors or geography |

M2 and M3 can proceed as independent experiments with separate data outputs; a terrain feasibility investigation can run alongside them. Importer/runtime regression and coordinate review should remain a separate review stream to avoid competing edits to the current slice. Do not combine all sources into one irreversible database before their terms and joins are understood.

## Limitations and later technical debt

The inherited full NYC workflow documents multi-gigabyte assets and substantial compile memory; it is not the default Toronto path. Static packaging demonstrates distribution mechanics, not a completed product. The current combined static inspection package measures 2,439,400 bytes, including 615,049 bytes of JavaScript and the 1,774,875-byte GTFS subset (uncompressed file sums in `client/dist-toronto/PACKAGE.json`). Its enforced limits are 2,600,000 total bytes, 700,000 JavaScript bytes and 16,384 tile bytes; these are static-package limits, not headless runtime memory estimates. A docs Pages workflow already exists: selecting a future demo URL requires reconciling that workflow and testing subpaths, not replacing it silently. No deployment is requested here. Live feeds, server hosting, persistent storage and full-city processing remain optional later decisions.

## Current simulation contract

Run `node tools/toronto/simulate.mjs` after root `npm ci --ignore-scripts`; redirect stdout to a JSON file. The default experiment produces 61 snapshots at one-second intervals from 08:00 on **2026-10-22**, in **America/Toronto**. `npm run test:toronto:sim` verifies real-data integration. No browser or external request is involved.

`tools/toronto/simulate.mjs` verifies the pinned GTFS subset hash, compiles the massing subset using the existing CTL1 writer, and calls `core/sim/world.mjs`. The world loads the tile through `HeadlessStreamer`/`simTile`, advances its existing clock and invokes `scheduledTransit.update` before post-step hooks. Existing NYC defaults remain enabled for other callers. The Toronto call explicitly disables NYC surface/building corrections, road traffic, pedestrians and NYC train services. Disabled models are null, not fabricated empty traffic; the existing recorder/API must not be used with this configuration yet. Geographic camera paths reject this mode because their projection still assumes NYC; local controllers can position the spectator.

Actors retain service-day/trip identities and route/shape references. Positions use the same x-east/z-south metric frame as the massing tile; y=0 is an explicit assumption. GTFS published distances and arrival/departure times determine motion and dwell. Times beyond 24:00 remain attached to the selected service day; no host timezone conversion or date rollover occurs. Missing or invalid shapes produce omitted-trip IDs, never invented positions. This baseline contains no acceleration, headway control, collisions, signal response, capacity or passenger model. Buildings load into the existing spatial/collider machinery but do not alter scheduled motion. Whole-route positions extend beyond the single loaded building tile.

### Organized inputs and derived outputs

| Input / output | Location and contract |
|---|---|
| Building source subset | `client/fixtures/toronto/block.geojson` plus adjacent provenance: source archive checksum, crop, original records, height fields and licence evidence |
| Transit source subset | `client/fixtures/transit/510-20261022.json` plus adjacent provenance: routes, trips, stops, shapes, stop times, calendars and exceptions; source and subset SHA-256 |
| Derived spatial tile | Ignored `client/.generated/toronto/`: deterministic CTL1 and manifest, explicit geographic profile; rebuilt from checked-in source |
| Derived motion | JSON stdout: profile, source provenance, service date/timezone, omitted trips and per-step actors. No live vehicle IDs or unverified observation claims |
| Bulk upstream archives | Ignored local caches only; not needed to run this slice |

**Next integration:** a bounded Toronto Centreline/track-and-intersection graph around Queen/Spadina, matched to GTFS shapes and stops with explicit tolerances and unmatched records. Verify source licence/CRS before acquisition, then add stop/link occupancy and measured travel-time diagnostics before attempting signal or congestion response. GTFS shapes alone do not establish road connectivity, right-of-way or signal phases. This is the next technical experiment, not a claim that synthetic demand or a full-city scope is approved. Existing source terms and the CKAN licence discrepancy remain recorded in the [source register](data-sources.md).

### Regression evidence and limits

`npm run test:nyc:core-parity` compares the current core against pre-integration commit `3e73317d551fc2ddbd1d640ce2e4f795ca09016c` in separate processes. Both enable the default NYC traffic, pedestrians, trains and correction passes, load a synthetic CTL1 tile with terrain and a signal node, and step through zero and positive durations. Snapshots compare model initialization, clocks, hook ordering, terrain, signals, actors and the seeded random stream. The baseline commit must be present locally; CI fetches that exact object. This is a direct regression test of the available initialization/step path, **not full NYC parity**: the fixture has no road edges or fleet assets and does not prove populated vehicle/pedestrian motion, city-scale streaming or renderer behavior. The full inherited asset set remains unavailable and is not downloaded by this test.

Offline tests install a rejecting fetch implementation **before** importing the core shim, which captures it for absolute requests. Deliberate string, URL and Request probes verify that external fetches fail before network I/O; the actual simulation must record no attempts. `W.fetches` is checked only for local shim requests, not used as evidence of external isolation. This guard covers fetch, not arbitrary sockets or subprocess networking.
