# The build graph and `valdrada` (v0, 2026-10-11)

docs/notes/tile-system.md section 10, as a working command: `tools/valdrada.mjs` runs the lanes' own tools, unchanged,
as steps of one graph, and skips every step whose inputs have not changed since it last ran. The cache manifest is
`/data0/projectnyc_aux/cache/graph.json` (schema `valdrada.graph/0`); a content-hash cache beside it
(`graph.hashcache.json`) remembers each file's SHA-256 by path, size and modification time, so unchanged files are not
read again.

## 1. Commands

```
node tools/valdrada.mjs lod                                   the persistent tier and its packages
node tools/valdrada.mjs cells --shot <s> | --bbox x0,z0,x1,z1 | --cells a,b [--name n]
node tools/valdrada.mjs take <shot> [--seed 1]                the take, its actor layers and light, then its load set
node tools/valdrada.mjs render <shot> --renderer three|ue|blender [--frames a-b] [--time t] [--nolod16] [--seed 1]
node tools/valdrada.mjs gate <shot> [--renderer three|ue] [--frames a-b]
node tools/valdrada.mjs trailer <seq.json> [--renderer three|ue] [--frames a-b] [--name n] [--seed 1]
node tools/valdrada.mjs status [--steps]
  every command: --force (run regardless), --dry (say what would run), --keep-going (do not stop at a failed step)
```

GPU steps take this machine's GPU lock on `GPU_LANE` (default 36): the tools they call (`record.mjs`, `withgpu.mjs` for
lane A's bake) hold it. One `valdrada` process at a time writes the manifest.

## 2. Steps

| step key | runs (unchanged tools) | inputs (hashed) | outputs (hashed) |
|---|---|---|---|
| `lod:build` | `tools/lod/build_persistent.mjs` | the compiled tiles (every `t_*.bin`, `far_*.bin`, `manifest.json`), LF39, the landmark registry, the builder and the client modules it imports | `/data0/projectnyc_aux/cache/lod16/` |
| `lod:export` | `tools/lod/export_packages.mjs`, then `--plain --levels 6,5` | `lod:build`'s output hash, the registry and its binary, the exporter, the FW14 texture | `cellcache/lod16/index.json`, `cellcache/plain/lod16/index.json` (content-addressed entries) |
| `cells:<name>` | lane A's `tools/cells/bake.mjs --cells ... --name <name>` (through `withgpu.mjs`), then `export_plain.mjs --region <name>` | the cell list (a shot's load-set grids: baked and missing, or a box, or a list), the tiles under them and their neighbours, `tools/cells/`, `client/src` | `cellcache/index/<name>.json`, `cellcache/plain/<name>/index.json` |
| `take:<shot>:s<seed>` | lane D's `tools/core/actor_layers.sh <shot> <seed>` (take, actor layers, light; publishes `takes/<shot>/v<stamp>/` atomically) | the shot (its shots.json entry and `_meta`), the seed, the take's code (`core/sim`, `core/tracks`, `core/world`, `core/env`, `client/src/sim`, `client/src/shared`, the `tools/core` writers, `usd_write.py`, `usd_peds.py`), the tiles within 1.6 km of the shot's keys | owned: this run's `tracks.atrk` and `stats.json`, snapshotted to `cache/steps/take_<shot>_s<seed>/<input hash>/`; published (checked to exist): `cellcache/takes/<shot>/tracks.atrk`, `usd/`, `harvest/` |
| `loadset:<shot>:cinematic` | `tools/core/loadsets.mjs <shot> --take <snapshot>` | the snapshot's `tracks.atrk`, the LOD packages' index, the entries of lane A's cell index for the cells the take's cameras can reach (the cinematic grid round every frame), `tiers.json`, the shot, `core/streaming` and the tool | owned: `cache/steps/loadset_<shot>_cinematic/<input hash>/loadset.json`; published: `cellcache/takes/<shot>/loadset.json` |
| `render:three:<shot>:<frames>` | `tools/ad/record.mjs --shot <s> --start a --end b --out client/shots/valdrada/three/<frames> --encode 0 --noqa --flags <film flags>&lod16=1&cells=1&cellsbase=<served cellcache>&replay=<served take>`: the source Unreal renders, the graph's own take (its snapshot of `tracks.atrk`) replayed and lane A's packages, both served for the recording by a CORS file server over the aux tree on port 47000 + GPU_LANE; `--live` renders the page's own simulation and live city instead | the shot, frames, time, flags, the page's code (`client/src` less `client/src/cells` unless `cells=1`, `index.html`, `vite.config.js`, `record.mjs`), the tiles near the path, the shot's load set (the city it needs), `client/public/models`, `client/public/textures`, the LOD index and the registry, and (not `--live`) the take step's output hash and `cellcache/index.json` | `client/shots/valdrada/three/<frames>/clips/<shot>/` |
| `render:blender:<shot>:<frames>` | `blender -b --python client/tools/ar34/export/blender_take.py -- --usd <take>/usd/<shot>.usda --frames a-b --outdir ...` on the lane's GPU | the take's output hash, the load set, the Blender scripts, frames, samples | `client/shots/valdrada/blender/<shot>_<frames>/` |
| `render:ue:<shot>:<frames>` | `tools/ue/render_take.sh <shot> [--frames a-b] --out client/shots/valdrada/ue` (GPU 0 under the shared Unreal GPU lock): the take's world (its load set's cells at their current hashes in lane A's indexes, the far chunks drawn on its frames, the landmarks) and the take (actors, light) are each built once and reused by their keys; a rerun with nothing changed costs only the render. Exit 0 frames written, 2 inputs missing, 3 world, 4 take, 5 render (after one retry), 6 frames | the take step's output hash, the load set, `cellcache/index.json`, `cellcache/plain/lod16/index.json`, `tools/ue/` and the `ue_*.py` exporters, frames | `client/shots/valdrada/ue/<frames>/clips/<shot>/` (`take_ue.json` beside the frames: keys, reused or built, seconds per stage) |
| `gate:<renderer>:<shot>:<frames>` | `tools/ad/temporal_scan.py` on the render's frames | the render's output hash, the scanner | `client/shots/valdrada/<renderer>/<frames>/_gate/<shot>.json`; `verdict` pass or fail (exit 3) in the step |
| `cut:<name>:<renderer>:<frames>` | `tools/ad/teaser_area_cut.mjs --name <name> --seq <seq> --clips <render root>/clips` | the sequence, every shot's render output hash, the cutter | `client/shots/ad/nyc_<name>.mp4` (`<name>` defaults to `vg_<seq>` for three.js and `vg_<seq>_<renderer>` otherwise, never an existing cut) |

`trailer <seq.json>` runs, per shot of the sequence (`{ first, shots: [{ name, in, beats }] }`), `take`, `loadset`,
`render` and `gate`, then `cut`, and lists the shots whose gate failed.

## 3. Hashes and skipping

- Owned outputs live where only the graph writes: a tool that publishes to a shared folder other agents also publish to
  (lane D's takes) gets its run's files snapshotted under the step's input hash, so another agent's publish cannot erase
  the graph's record; the shared copies are checked to exist, not by hash.
- An input is a file (its SHA-256), a folder (a tree hash over each file's relative path and SHA-256, previous takes
  `*_prev_*`, `.old-*` and temporaries left out), a list of files, a JSON value, or another step's output hash.
- A step's input hash is the SHA-256 of its named input hashes. It is skipped when the manifest holds the same input
  hash, the last run succeeded, and every recorded output still has its recorded hash. Otherwise it runs, and the
  manifest records its inputs, outputs, output hash, exit code, time and command (`--dry` shows the reason: never built,
  which inputs changed, the last run failed, the outputs changed).
- Steps feed each other by output hashes, and the writers make their outputs deterministic (the load set carries no time
  or commit stamp, and hashes the take's camera rows, not the whole tracks file), so a change stops where an output does
  not change: a re-baked cell changes lane A's index, every load set is recomputed (a fraction of a second each), and
  only the shots whose load set lists that cell render again; their cut follows.

## 4. Proof on t8LenoxDive (2026-10-11)

Run in a worktree (`/data0/projectnyc_wt/valdrada-proof`, the code of the main checkout's working tree at 03:00 copied in,
so the other lanes' live edits could not move the inputs during the proof); log in
`client/shots/arch_r1b/valdrada/proof_t8LenoxDive.log`:

| command | step | result | seconds |
|---|---|---|---|
| `valdrada take t8LenoxDive` | `take:t8LenoxDive:s1` (lane D's layers) | ran | 55.7 |
| | `loadset:t8LenoxDive:cinematic` | ran | 0.2 |
| `valdrada render t8LenoxDive --renderer three --frames 0-12` | `render:three:t8LenoxDive:f0-12` (record.mjs, 12 frames) | ran | 295.2 |
| the same two commands again | all three steps | skipped | 0.1 in all |

Before it, the runs in the main checkout showed the graph tracking live changes from the other lanes: the take re-ran
when lane D edited `core/sim/world.mjs` and when another agent republished the shared take folder (hence the snapshots
of section 3); the load set re-ran whenever lane A's baker wrote its index (hence the per-shot cell entries as inputs),
and the render then skipped because the load set came out byte-identical.
