# Toronto vision and architecture roadmap

SixSim’s proposed direction is a reproducible Toronto city model that can support exploration and, eventually, explicit mobility and urban scenarios. Visual detail should remain traceable to sources; simulated behaviour should state its assumptions. This is a direction for discussion, not approval of a fixed feature set or a claim of predictive validity.

## Current boundary

The draft branch contains a 15-record real massing slice, a small binary importer and an isolated Three.js viewer. Buildings use observed average heights on a flat plane. No Toronto streets, terrain, transit, population, demand model or simulation are integrated. The procedural NYC fixture exercises inherited rendering but supplies no Toronto facts. Main remains the upstream NYC baseline until review.

## Preserve the architecture, make geography explicit

| Boundary | Existing contract | Toronto increment |
|---|---|---|
| Source acquisition | Offline pipeline tools and source files | Pin source URL, date, checksum, licence, CRS and extent before conversion; keep bulk originals outside Git |
| Normalization | Geographic inputs compiled to local coordinates | Explicit city profile; validate horizontal/vertical units, axis direction, stable source identity and missing attributes |
| Tile compilation | Existing CTL1 writer and decoder | Retain format and hole semantics; add bounded datasets with round-trip checks before format changes |
| Runtime and rendering | Shared tile decoding plus NYC-specific assembly, facades and landmarks | Toronto viewer already uses shared decoding and disables NYC overrides; progressively isolate actual geographic assumptions rather than relabel NYC landmarks |
| Simulation | Inherited road/actor systems, server and API | Build a Toronto graph first; separate observed schedules and positions from synthetic demand and behaviour |
| Application/API | Web, Electron, Python API and Unreal clients | Keep the web slice the cheapest validation surface; port other clients only when a concrete use case requires parity |

The present Toronto entry point does not exercise the complete upstream tile assembly or simulation. A shared binary format alone does not establish compatibility with every downstream client. Changing origins must cover server/session metadata, picking, camera positions and exported coordinates together.

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

The inherited full NYC workflow documents multi-gigabyte assets and substantial compile memory; it is not the default Toronto path. Static packaging demonstrates distribution mechanics, not a completed product. Keep the current roughly 650 KB demo budget until a justified expansion is measured. A docs Pages workflow already exists: selecting a future demo URL requires reconciling that workflow and testing subpaths, not replacing it silently. No deployment is requested here. Live feeds, server hosting, persistent storage and full-city processing remain optional later decisions.
