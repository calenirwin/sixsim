# Load sets (v0, 2026-10-11)

What a renderer holds and draws at each frame of a take, decided by the single streaming manager
(`core/streaming/stream.mjs`, docs/notes/tile-system.md section 6) that the three.js client also runs (`?lod16=1`,
`client/src/lod/manager.js`), so Unreal, Blender and three.js load the identical city by construction. Written beside a
take by `tools/core/loadsets.mjs <shot>`: `/data0/projectnyc_aux/cellcache/takes/<shot>/loadset.json`. Schema string
`valdrada.loadset/0`.

## 1. The manager's rules

| rule | value |
|---|---|
| inputs per tick | the cameras (position, vertical field of view, viewport height in pixels), the tier, the time step |
| L0 | the tier's loaded grid of 128 m cells (lane A's cells, docs/specs/cell-package.md) round each camera's cell: Low 5 x 5, Medium 7 x 7, High 9 x 9, Cinematic 11 x 11; a cell stays until it is outside the grid + 2 |
| persistent | every L6 chunk and every landmark, always |
| refinement | from each L6 root down, a chunk is replaced by its four children (the 128 x 2^(n-1) chunks inside it) only when its screen-space error, `err x heightPx / (2 tan(fovV / 2)) / distance(camera, chunk box)` (the largest over the cameras), is over the tier's threshold (Low 3, Medium 2, High 1, Cinematic 1 px), and all four are resident; a refined chunk returns below 0.8 x the threshold, once its children have settled |
| fades | a chunk entering or leaving the drawn set fades over 0.45 s; `alpha` is its visible share; `mode` 0 (incoming or steady) keeps the pixels whose screen threshold is under `alpha`, mode 1 (outgoing) those at or over `1 - alpha`, so a parent and its children cover complementary pixels; a chunk nothing else covers appears at once |
| budgets | past the persistent tier, resident chunks over the tier's bytes or count are evicted (invisible, not wanted for 4 s, least recently wanted first) |
| masks | where the L0 cells (or today's near tiles in three.js) draw the city, a renderer hides the chunks and landmarks under them |

The tiers' numbers are `client/public/data/tiers.json` (`screenErrorPx`, `loadedGrid.cells`, `lod.maxBytes`,
`lod.maxNodes`).

## 2. loadset.json

| field | content |
|---|---|
| `schema`, `shot`, `title`, `time`, `tier`, `fps`, `frames` (count), `viewport` | identity; `viewport` [w, h] px is the render size the screen error is measured in (the trailer's 2560 x 1440) |
| `rules` | the manager's parameters for this file: `sse`, `hysteresis`, `fadeS`, `grid`, `cellSize`, `finest` (the finest chunk level, 4), `persistentLevel` (6), `warmFrames` (steps run on frame 0's camera first, so frame 0 starts settled), `residency` |
| `sources` | `camera`: the take's own rows (`takes/<shot>/tracks.atrk` and the SHA-256 of its camera rows) or the shot's path; `lod`: the chunk packages' index (its SHA-256); `cells`: lane A's index and its regions; `landmarks`; `tiers` |
| `made` | `by`, `code` (SHA-256 of the manager and the tool); no time or commit stamp, so the same inputs give the same bytes (the build graph stops at an unchanged load set) |
| `persistent` | `chunks` (the L6 keys) and `landmarks`: resident for the whole take |
| `union` | what to preload before frame 0: `chunks` (persistent included), `cells` (baked L0 cells), `cellsMissing` (grid cells lane A has not baked: the chunks cover them), `landmarks`, `drawnBy` (landmarks a module already draws in full, e.g. the bridges), `bytes` per kind, `files` (key -> path relative to `/data0/projectnyc_aux/cellcache/`) |
| `stats` | `maxFading` (chunks in a fade in any frame), `levelsInUnion` |
| `frames[]` | per frame `f`: `cam` [x, y, z], `chunks` (keys drawn at full alpha), `fading` ([key, alpha, mode] for chunks mid-fade), `cells` (the baked cells drawn) |

Keys: chunks `L<n>_<i>_<j>` (cell-package.md section 12), cells `<cx>_<cz>` (section 1), landmarks by registry key.
Residency in the file is immediate: a renderer preloads the union before frame 0, then nothing streams during the take.

## 3. Renderers

- three.js: `client/src/lod/manager.js` runs the same `StreamManager` live, with its own residency (fetches) and the
  page's clock; the load set of a take equals the page's steady state at each frame once the union is resident.
- Unreal (lane C) and Blender: load the union's packages before frame 0 (level instances or collections, the L6 chunks and
  landmarks for the whole take), then per frame show `chunks` and fade `fading` (a dither on alpha and mode, or a plain
  switch at `alpha` 0.5 where the renderer has no dither), hide chunks and landmarks under the drawn cells, and skip
  `drawnBy` landmarks where that module's content is present.
