# Modules, folders and owners (v0, 2026-10-10)

The module boundaries of docs/notes/tile-system.md (revision 4), mapped onto the repository as it is today and as it
moves. Each module owns one kind of data and publishes it through a versioned contract in `docs/specs/`. A module's
folders are edited only by its owner; a change that another module needs goes through the merge queue with that module's
checks. `OWNERS` lists the current owners; `tools/dev/check_deps.mjs` enforces the dependency rules.

| module | folders today | folders it moves to | contract |
|---|---|---|---|
| records | `client/tools/pipeline/` (the tile compiler), `client/public/tiles/` (output) | `records/` | `docs/specs/records.md` (to write) |
| layers | the area modules' data in `client/src/city/*Data.js`, `lk/lkData.js` | `layers/<region>/` | `docs/specs/layers.md` (to write) |
| landmarks | `client/public/data/landmarks.json` (round 1) | `layers/landmarks/` | in `docs/specs/cell-package.md` |
| generators | `client/src/city/`, `client/src/world/assemble.js` (runtime today) | `generators/<domain>/` | the scene description (to write) |
| cellbuild | `tools/cells/` (round 1) | `cellbuild/` | `docs/specs/cell-package.md` |
| lod | `client/src/lod/`, `tools/lod/` (round 1) | `cellbuild/lod/` (build), `renderers/three/lod/` (runtime) | in `docs/specs/cell-package.md` |
| core | `core/` (round 1: sim, tracks, streaming, api), the page's `client/src/sim/` today | `core/` | `docs/specs/actor-tracks.md`, `docs/specs/load-set.md`, `docs/api/protocol.md` |
| director | `tools/ad/` (shots, takes, cuts) | `director/` | `tools/ad/shots.json` schema (to write) |
| renderers | three.js: `client/`; Unreal: `client/tools/ar34/export/ue_*`, `ue_project/`; Blender: `client/tools/ar34/export/blender_*` | `renderers/three/`, `renderers/unreal/`, `renderers/blender/` | `docs/specs/render-protocol.md` |
| farm | `/data0/projectnyc_aux/tmp/bx/*/queue_lane*.sh` (scripts) | `farm/` | jobs and frame cache (to write) |
| qa | `tools/ad/temporal_scan.py`, `qa_scan.py`, the gates | `qa/` | verdict JSON (to write) |
| edit | `tools/ad/cut*.mjs`, captions | `edit/` | |
| scheduler | `tools/gpulock.mjs`, `tools/withgpu.mjs`, the Unreal GPU locks | `tools/dev/` | |
| dev tooling | `tools/dev/` (worktrees, the dependency check) | | |

Moves happen module by module, each with re-export shims in the old place until no caller uses it, so a lane never breaks
another lane's paths.

## Dependency rules

1. `core/` never imports three.js rendering (WebGLRenderer, materials, instancers, loaders) or any renderer module.
2. Nothing under `generators/`, `cellbuild/`, `core/` or `layers/` imports from `renderers/` or `client/src/core/engine.js`.
3. Renderers never create, move or reclassify content: they read packages and state (checked by review and by the
   parity gates, not by the import scan).
4. `layers/` contains data only (JSON, JSON lines, glTF), never code.
5. Only the scheduler starts a GPU engine (Unreal, Blender, Chromium renders): tools call `tools/withgpu.mjs` or the farm.

## Working in parallel

- One git worktree per agent: `tools/dev/worktree.sh add <name>`, which links the ignored tiles and node modules.
- One module or region per agent; shared files only through the merge queue: commit on your branch in your worktree,
  then `tools/dev/merge_queue.sh agent/<name>` (from any worktree) rebases it onto main, runs the checks and
  fast-forwards main, or rejects it whole. A rejected branch rebases and tries again; nobody edits main's checkout by
  hand while agents run.
- GPU lanes: `GPU_LANE=<n>` maps to GPU (n - 1) mod 3; Unreal takes the PCI lock of its GPU.
- The Unreal project is shared by every worktree (its `/Game` content is not isolated by git), so no lane changes a
  shared asset in place: new masters and instances go under versioned or lane-private names (`/Game/<lane>/...`,
  `..._v2`) and are bound only by that lane's worlds until verified, then promoted and announced.
- Status in each lane's own notes file (`docs/notes/<lane>.md`); no shared, hand-edited status file.
