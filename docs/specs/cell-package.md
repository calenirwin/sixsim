# Cell packages (v0, 2026-10-11)

The contract between the cell builder (`tools/cells/`, module cellbuild) and every renderer and the simulation core. One
package holds the static city of one 128 m cell at level L0 (docs/notes/tile-system.md, revision 4, section 4): its
buildings and facades, ground, street furniture and trees, with material keys and labels, plus a sidecar with what the
simulation needs. A region index lists the cells and their content hashes. Schema strings: `valdrada.cell/0` (the glTF
root node), `valdrada.cellsidecar/0`, `valdrada.cellindex/0`. JSON schemas: `docs/specs/schemas/`.

v0 is what round 1 bakes from today's client (the assembly running headless is the first generator). Fields marked
*declared* are part of the contract but not filled yet.

## 1. Space, cells, keys

| item | value |
|---|---|
| world axes | x east, y up, z south (north is -z), metres; the projection is `client/src/shared/geo.js` (`project(lon, lat)`, anchor 40.7831 N, 73.9712 W) |
| cell | a 128 m square; key `"<cx>_<cz>"` with `cx = floor(x / 128)`, `cz = floor(z / 128)`; origin `(128 cx, 0, 128 cz)` |
| tile | today's compiled 512 m tile (`client/public/tiles/t_<tx>_<tz>.bin`) holds 4 x 4 cells |
| glTF axes | glTF's own: +Y up, right-handed, metres; the world axes map to glTF axes one to one (glTF +X = east, +Z = south) |

## 2. The cache

```
/data0/projectnyc_aux/cellcache/
  index.json                 every baked cell of every region (the loader reads this one)
  index/<region>.json        one region's cells
  <hash>/cell.glb            the package (glTF 2.0 binary)
  <hash>/cell.json           the sidecar
  <hash>/meta.json           the inputs that made it, the bake's numbers
  protos/<hash>.glb          the shared prototype library: one instanced set's geometry and material each, by content
  tex/<hash>.png             the shared texture store: every texture of the packaged materials, by content
  plain/<region>/<cell>.glb  self-contained uncompressed copies on demand (tools/cells/export_plain.mjs): prototypes
                             copied in, textures as glTF textures on image files in plain/<region>/tex/
```

- `<hash>` is the first 24 hex digits of SHA-256 over the cell's inputs (`meta.json` `inputs`): the schema, the cell key,
  the git tree hashes of the working `client/src` (taken through a temporary index, less `client/src/cells`) and of
  `src/` (the subproject the page imports as `@nyc`: the dresser's materials and their painted textures), a digest of
  the page's other files (`client/public` less the tiles: each file's path, size and modification time, so a touched
  file counts as changed), the baker's files and options, and the SHA-256 of every tile file the cell reads (its own tile, and the neighbouring tile
  across any tile edge within 64 m of the cell). A cell whose hash is in the cache is never rebuilt.
- Entries are written to a temporary folder and renamed into place; an entry is never deleted (a rebuilt one is moved
  aside as `<hash>.old-<time>`).

## 3. cell.glb

One scene with one root node, `cell_<key>`, translated to the cell origin; root `extras`:
`{ "schema": "valdrada.cell/0", "cell": "16_-22", "origin": [2048, 0, -2816], "size": 128 }`.
Its children are of two kinds.

**Mesh nodes** (`extras.kind = "mesh"`): one primitive each, triangles, indexed, positions relative to the cell origin.
A node is everything of one material key, one attribute layout and one set of draw flags in the cell, merged.

**Instanced nodes** (`extras.kind = "pool" | "inst"`): drawn at every instance by `EXT_mesh_gpu_instancing`:
`TRANSLATION` (relative to the cell origin), `ROTATION` (unit quaternion), `SCALE` (a mirrored instance has a negative x
scale), `_COLOR` (the instance's linear RGB multiplier), and `_<name>` for any other per-instance attribute. The
prototype (the set's geometry in its own space, at its finest level, with its material) is in the shared library,
`extras.proto` = `protos/<hash>.glb` relative to the cache root (`<hash>`: SHA-256 of the material key and the
geometry's bytes, 24 hex digits), so a tree used in sixteen cells is stored once; the node's own mesh is a placeholder
(one degenerate triangle with the set's material), so the cell stays a valid glTF for any reader.
`tools/cells/export_plain.mjs` writes self-contained copies with the prototypes copied in and no compression. `pool`
names the instancer pool of today's client (street furniture, trees: `treeQCrown`, `lampCobra`, `hydrant` ...), which a
renderer may map to its own prototype; `inst` is any other instanced set (tree pits, park lamps and benches).

Node `extras` (schema `docs/specs/schemas/cell-gltf-extras.v0.schema.json`):

| field | meaning |
|---|---|
| `kind` | `mesh`, `pool` or `inst` |
| `matKey` | the material key (section 4) |
| `class` | the label class id (section 6); `-1`: per vertex from `_matId` (the ground) |
| `castShadow`, `receiveShadow`, `renderOrder`, `layers` | the client's draw flags (`layers`: three.js layer bit mask; bit 3 is the far shadow cascade's buildings) |
| `dress` | the dresser's buildings (whole buildings; see section 7) |
| `nightOnly` | drawn only at night: the dresser's lit window parts, and the street furniture's lamp glows (instanced, `...Glow` pools) |
| `shadowOnly` | the tile facades of buildings the package holds dressed: the client's facade shader discards them through the tile's hide mask, so they only cast the buildings' shadows; a renderer without the mask draws them as shadow casters only |
| `sources` | the client objects merged into the node (names), for debugging |
| `pool`, `name`, `count` | instanced nodes: the pool, the set's name, the instance count |
| `proto`, `protoHash` | instanced nodes: the prototype in the shared library |

Vertex attributes: `POSITION`, `NORMAL`, `TANGENT`, `TEXCOORD_0` (three.js `uv`), `TEXCOORD_1` (`uv1`), `COLOR_0`
(`color`, linear), and every other attribute of the client as `_<three.js name>`, with its type and normalisation kept
(float32, or 8 and 16-bit integers). The ones that occur:

| attribute | meaning (writer) |
|---|---|
| `_matId` | the ground's surface kind per vertex (`client/src/world/materials.js`; the class table in section 6) |
| `_aBid` | a tile facade's building index in its tile (the tile's hide mask) |
| `_aFkTr` | the facade kit's per-vertex tint ratio (`city/fk/`) |
| `_aGrime`, `_aWeather` | weathering terms of the kit and the dresser |
| `_gpK` | the ground's kerb frame (`world/gpKerbWorker.js`) |
| `_sgRect`, `_sgBg`, `_sgFg`, `_sgLamp`, `_sgP`, `_sgF` | sign faces (`city/fk/signKit.js`, `city/hptSign*.js`) |
| `_aRv`, `_aJ` | the viaducts' rivet rows and joints (`city/vk/`) |
| `_aAd`, `_aSize` | billboard playlists and LED size (`city/billboards.js`) |

Compression: `EXT_meshopt_compression` (required), lossless byte codecs only (no quantisation, no filters), after
identical vertices are welded. Decoders: three.js `meshopt_decoder.module.js` (vendored as
`client/src/cells/meshoptDecoder.js`), glTF-Transform, meshoptimizer. `EXT_mesh_gpu_instancing` is not marked required.

## 4. Materials

A material is named by its key, `<name>#<16 hex>` (`@<tile>` added for the tile facades, which each carry their tile's
hide mask): a hash of what the material is in the client (`client/src/cells/cellRules.js` `materialSignature`: type,
name, scalar parameters, colours, texture identities, shader-patch hash, defines, user data), never of object ids, so
it is the same in every page load. Each renderer resolves a key to its own material:

- three.js: the client's own live material of the same key (exact parity); the glTF factors as a stand-in when none.
- Unreal and Blender: by `extras.three.userData.pbr` (the PBR library set, the key of the high-quality sets in
  `ue_families.json`), the family fields, or the glTF factors.

glTF material: `pbrMetallicRoughness` factors from the client's colour, roughness and metalness; `alphaMode` from
transparency and alpha test; `doubleSided`. `extras`: `{ key, three: { type, name, side, transparent, alphaTest,
opacity, vertexColors, depthWrite, blending, polygonOffset*, color, emissive, roughness, metalness, ..., textures,
userData, uniforms, uni, obcUni, obcAttrs, defines, obc, sig, keys } }`:

- `textures`: every map by slot (`map`, `normalMap`, `roughnessMap`, `metalnessMap`, `aoMap`, `emissiveMap`, `alphaMap`,
  `bumpMap`) with `file` (the image in the shared texture store, `cellcache/tex/<hash>.png` relative to the cache root,
  read back whatever its source: files, canvases and atlases the client paints at run time, data, KTX2; from the source
  itself when the page holds it on the CPU (canvases, images, 8-bit data and data arrays), compressed ones and their
  array layers in a WebGL2 context of their own from the blocks the loader keeps, the rest from the GPU), at
  its own size up to 4096 px (`capped` when it was larger), `w`, `h` (the source's size), `colorSpace`, `opaque`,
  `wrap`, `repeat`, `offset`, `channel`, `blank` (the read came back empty in every try: an empty canvas), and `uri`
  (relative to `client/public`) when the client loaded it from a file. Images are stored as glTF samples them with the
  package's uvs. Uniforms that hold the page's state rather than a look are listed as `{ dynamic: true }` and not
  read back: `nearMask`, `uHide`, `hideTex`, the trees' dither frames (`uDith<n>`) and the clocks (the objects
  ENV.windT and ENV.time, whatever a shader calls them: `windT`, `cpwT`, `rtWind`, `fwT`, ...).
- `obcUni`: the uniforms the material's shader patch installs, read on a stand-in shader: the PBR library's
  `pbAlb`, `pbNrm`, `pbOrm` (texture references as above) with `pbSize` (metres per texture tile), `pbRatio` (tint), the
  facade kit's terms and so on; `obcAttrs` the vertex attributes the patch reads. `uni`: a ShaderMaterial's own uniforms.
- `sig` is the level-1 signature, `keys` the key at levels 0, 1 and 2.
- `procedural`: a shader-only material drawn by a standard stand-in in glTF: the ground-contact AO skirt (black-blue,
  alpha from `COLOR_0.a`) and the boulders' contact shade (black, alpha = the disc texture times `COLOR_0.a`, uv from the
  disc coordinates); the glTF material, `COLOR_0` and `TEXCOORD_0` carry the stand-in, the extras the client's formula.
- `cellTexture: true` (by default since 2026-10-11 03:50; `--nosigncells` turns it off): the material's `map` was made for this cell alone, the street-name
  blades' text: the page's atlas of names (city/signText.js) hands out its 512 x 32 px slots in the order its tiles come
  in, so its layout differs between two page loads; the baker packs the names the cell's blades show into a texture of
  their own, one slot each in name order, painted as the page paints them, and moves the triangles' uvs onto it. A
  renderer draws the material with that file (the three.js loader clones the live material onto it), never with a
  live atlas.

## 5. The sidecar (cell.json)

Schema `docs/specs/schemas/cell-sidecar.v0.schema.json`.

| field | content |
|---|---|
| `schema`, `cell`, `hash`, `origin`, `size`, `bounds` | identity; `bounds` = `[x0, y0, z0, x1, y1, z1]` world metres |
| `tile` | the 512 m tile that holds the cell |
| `buildings` | every building record whose footprint centroid is in the cell: `key` (`<tile>:<index>`), `tile`, `bid`, `cx`, `cz`, `height`, `baseY`, `style`, `ring` (the footprint, world x z), `dressed` (rebuilt by the dresser in the package, else drawn as the tile facade); `bin`, `bbl` *declared* |
| `ground.heights` | the terrain grid: 33 x 33 heights at 4 m from the cell origin (`values[j * 33 + i]` at `x0 + 4 i, z0 + 4 j`) |
| `ground.surface` | the top surface at 2 m: 64 x 64 cells, `kind` index into `kinds` (asphalt, sidewalk, gutter, busred, grass ...) or -1, `top` height |
| `nav.roads` | the road centrelines that touch the cell (whole polylines, world x y z), with the compiler's fields |
| `nav.nodes` | road graph nodes in the cell, `signal` where signalised |
| `nav.lanes`, `nav.sidewalks`, `nav.crossings` | *declared* (the walker and lane graphs, for the core) |
| `signals` | signal masts, heads and pedestrian heads (kind, position, heading), drawn live in v0 |
| `lights` | every lamp head the page lights the city with (`world/life.js` lampSpots, one per 0.5 m as `world/cityLamps.js` keeps them), positions at full precision: `kind` (`cobra`: an arm-mounted cobrahead; `crook`: a Bishop's crook teardrop; `signalArm`: a lamp on a signal mast's arm; `parkPost`: a park post top; `acorn`: a park globe; `post`), `x`, `y` (the ground point under the head), `z`, `headY` (the head's world height), `fixture`: `{ key, index, mount, height, yaw }` with `key` the luminaire the page chose (`world/night11.js` FIXTURES: `led3000`, `led4000`, `hps2000`, `acorn3000`; `legacy` with `?n11=0`), `mount` `arm` or `postTop`, `height` the head over the ground point, `yaw` the arm's heading (radians, three.js rotation about +y; null for a post top) |
| `furniture` | instance counts by pool |
| `materials` | the cell's material keys with their PBR set and textures |
| `colliders`, `spawns` | *declared* |

## 6. Classes

`class` ids are the segmentation table of `client/src/perception/segRender.js` (`CLASS_ROWS`): 0 unlabeled, 2
building, 3 road, 4 sidewalk, 5 curb, 6 road marking, 7 crosswalk, 15 terrain, 16 grass, 17 vegetation, 24 traffic
signal, 26 street sign, 27 street light, 28 hydrant, 29 street furniture, 30 bus shelter, 31 subway entrance, 33
building appurtenance, 34 roof structure, 35 bridge (the full table is in the file). Pools are classed by
segRender's pool table, other meshes by its fallback rules (the baker mirrors them). `-1` is the ground: its class
is per vertex, `_matId` through segRender's `MATID_CLASS` (0 asphalt -> road, 1 sidewalk, 2 curb, 3 white paint, 4
yellow paint, 5 grass, 6 park path, 7 terrain, 9 bike lane, 10 plaza, 11 gutter, 12 bus lane, 13 and 14 detectable
warning, 15 lawn, 16 plaza pavers, 17 gravel walks).

## 7. What goes where (the baker and the three.js loader apply the same tests: `client/src/cells/cellRules.js`)

| content | rule |
|---|---|
| static meshes (tiles' ground, kerbs, paint, tile facades, the facade kit, viaducts, signs, landmarks, park kits) | every triangle to the cell of its plan centroid; levels of detail at their finest (the film policy's path held over the region) |
| the dresser's buildings (`world/nycDress.js`) | whole, to the cell of the building's footprint centroid; every dressable building of a baked cell is dressed, and its tile facade is dropped |
| tile facades of a dressed building | kept apart as `shadowOnly` nodes (the tile's hide mask hides them; they cast the shadow, as in today's client) |
| instancer pools (furniture, trees) | every live instance to the cell of its position |
| other instanced sets | every instance to the cell of its position |
| moving objects | what the baker sees move over 1.5 s with the camera still (the Lake's rowboats ...) is not packaged; its names are in the index's `movers`, and renderers leave those objects live |
| not packaged in cells | moving actors (vehicles, walkers, trains, seated people), the far level (macro tiles, crowns, far terrain, the park's far mesh), the hero trim ring (camera-driven), signal lenses and heads and lamp glows (state changes at run time), custom instanced geometry (grass blades, fountain spray), sky and water |
| water (R2B, 2026-10-11) | packaged at the far level (section 12): one `water` node in every L6 chunk with water, its square's real water at y 0 (the charts' depth areas, each chart scale only where no finer one covers, and the strip to the city's bulkheads, tools/lod/water_l6.py; BD40: the backdrop's land outside the city is the exact complement of this water, client/tools/pipeline/backdrop/land.py), material `lod16Water`, class 18 water; the L6 squares round the city with water but no land or buildings get chunks of water alone. A renderer that draws the packages draws its rivers and harbour from these nodes, whole under the cells (land in the cells stands ~3 m over the water, river beds ~3.6 m under it), whichever level draws the square; three.js keeps the page's own plane (client/src/main.js) and does not read them |

## 8. The region index (index.json, index/<region>.json)

Schema `docs/specs/schemas/cell-index.v0.schema.json`: `cellSize`, `generated`, `regions`, `movers` (object names the
baker saw moving), and `cells`: per key `{ hash, bytes: { glb, sidecar }, bounds, tris, instances, draws, tile }`.

## 9. Renderers

- **three.js** (`client/src/cells/cellLoader.js`, `?cells=1`, `?cellsbase=<url>` for the cache): see the file's head.
  Tiles still assemble (the simulations read their roads, surfaces and colliders); inside the baked cells the live
  static content is taken out by the rules of section 7, in the frame the cell's package joins, and the packages are
  drawn with the client's own materials (by key, re-keyed afresh on a miss, retried while textures load; a mesh whose
  key does not resolve waits hidden and the live meshes of that key stay). A map the page paints at run time
  (`generated`: the storefront signs' face, mask and shade pages, the shop and street-name atlases, painted facades, the
  crown atlas) is drawn from the package's file on a clone of the live material (its shader hooks kept): an atlas's
  layout and a sign's occupant depend on what the page built before, so the live texture under the same key can hold
  another sign at the package's uvs. A cell joins once those images have loaded. Pool instances are claimed back into the
  client's instancer pools (its culling, levels and shadow sets apply); other instanced sets are drawn with the shared
  prototypes. The dresser keeps its ring; a baked building takes its slot without being built.
- **Unreal** (lane C): one level instance per cell at the root translation; mesh nodes as Nanite static meshes, pools
  and instanced sets as instanced static meshes (one per node); the material by key (section 4); `class` into custom
  primitive data or the stencil. glTF to Unreal axes: the importer's own conversion (glTF +Y up, metres).
- **Blender**: the same, as collection instances per cell.

## 10. Levels and landmarks (declared for lane B)

Chunk packages for L1 to L6 use this format with `level` in the root `extras` (absent or 0: L0) and a chunk key
`L<n>_<i>_<j>` on the 128 x 2^n grid. Landmarks (`client/public/data/landmarks.json`) are never merged into cells:
their nodes carry `extras.landmark = <key>` and are packaged on their own.

## 11. Known gaps in v0

Textures are capped at 4096 px. The meshes visible only at night are the dresser's lit window parts and the lamp
glows, both packaged as `nightOnly` (a day and a night page of both test regions show no other); the night look of
everything else is the materials' (window and sign emission by the clock). The signal heads and lenses stay live
(their state is the simulation's). The sidecar's walker and lane graphs and colliders are declared, not filled. The package
holds the dressed buildings at full detail everywhere in the cell, where today's client dresses a 150 m ring; the
three.js loader therefore shows more dressed buildings than today's client past that ring.

Not packaged, by design: the grass blades round the lens (world/vg36.js: rings that follow the camera, a renderer's
own), the fountain spray, rain and birds (custom instanced, simulated), the movers (`movers` in the index).

Determinism: two bakes of the same inputs give the same packages, byte for byte (cell -1_6, 2026-10-11 04:54: cell.glb
and cell.json identical), but for the storefront kit of 125th Street, whose
faces and parts depend on what has loaded when they are built: a painter's font (city/fk/custom/bid4.js `yogaV` draws
in Montserrat or its fallback) and the PBR library's index (city/fk/kitMats.js `sharedBase`). The street-name texture
per cell holds what the page's atlas held: the atlas has 512 slots, and a name that found it full has no quad.

## 12. LOD chunks and landmark packages (lane B, 2026-10-11; section 10 filled)

Written by `tools/lod/export_packages.mjs` from the persistent tier's chunk files (`tools/lod/build_persistent.mjs`,
docs/notes/arch-r1-b.md) and the landmark registry (`client/public/data/landmarks.json`): the skyline three.js draws with
`?lod16=1`, for Unreal and Blender.

```
/data0/projectnyc_aux/cellcache/lod16/
  index.json                 every chunk and landmark package (schema valdrada.cellindex/0, "kind": "lod16")
  <hash>/cell.glb            one chunk L<n>_<i>_<j>, or one landmark LM_<key> (EXT_meshopt_compression, as section 3)
  <hash>/meta.json           inputs (the source file's SHA-256, the exporter version) and the entry's numbers
/data0/projectnyc_aux/cellcache/plain/lod16/
  <key>.glb, index.json      uncompressed copies (L6, L5 and the landmarks; `--plain --levels 4` adds L4)
/data0/projectnyc_aux/cellcache/tex/<hash>.png   the FW14 window grid the shell material uses (shared store)
```

`<hash>`: the first 24 hex digits of SHA-256 over the exporter's version, the key, the material keys and the source
file's bytes. Entries are written to a temporary folder and renamed; a rebuilt one moves the old aside.

| level | chunk (key `L<n>_<i>_<j>`, origin `(size i, 0, size j)`) | geometric error | packages | triangles |
|---|---|---|---|---|
| L6 (persistent: always resident at every tier) | 8,192 m | 10 m | 19 (+ the water-only squares, R2B) | 1,301,715 (with the ground) |
| L5 | 4,096 m | 5 m | 62 | 4,074,538 |
| L4 | 2,048 m | 2.5 m | 211 | 10,088,295 |
| landmarks `LM_<key>` (persistent) | the landmark's own origin | at most 2,000 triangles each | 39 | 33,081 |

**Root node** `cell_<key>`, translated to the origin; `extras`: `{ schema: "valdrada.cell/0", cell: "<key>", level,
origin, size, err, persistent }`; a landmark's root also `landmark: "<key>"`. The index's `chunks[key]` (and
`landmarks[key]`) give `file`, `hash`, `level`, `bounds` (world `[x0, y0, z0, x1, y1, z1]`), `tris`, `draws`, `bytes`;
`persistent` lists the L6 keys; `levels` the size and error per level.

**Nodes** (`extras.kind = "mesh"`, section 3's fields):

| node | matKey | class | attributes |
|---|---|---|---|
| `shells` (every chunk): merged block shells and tower silhouettes | `lod16Shell#<16 hex>` | 2 building | `POSITION`, `NORMAL` (flat, per face), `TEXCOORD_0` (the FW14 window grid: along the wall in metres from the world origin / 12, height / 15.2; roofs on texel (0.06, 0.24)), `COLOR_0` (linear albedo: the wall colour from the building records, a region's area-weighted mean), `_lit` (float, the lit share: the night window term's chance), `_bkey` (uint32, index into the node's `extras.buildings`) |
| `ground` (L6 only): the coarse ground, 0.5 m under the near tiles' | `lod16Ground#<16 hex>` | 15 terrain | `POSITION`, `NORMAL`, `_matId` (8: the client's far terrain) |
| `water` (L6 only; R2B, 2026-10-11): the page's water plane at y 0 over the part of the chunk's square that is water (client/data/raw/water_l6.json from tools/lod/water_l6.py: NOAA ENC depth, dredged and unsurveyed areas (tools/lod/fetch_enc_water.mjs), each chart scale only where no finer chart's coverage reaches, and the city's land grown 60 m inside the city's line where a chart's water lies within 150 m; the united polygon beside it as water_l6.wkb), triangles facing up; `extras.water: true`. The L6 squares water_l6.json lists (BD40: the backdrop's, x -57,344 to +49,152 m and z -40,960 to +57,344 m; R2B had x -32,768 to +32,768 m and z -24,576 to +40,960 m) that the persistent tier leaves out but that hold water are chunks of a `water` node alone (root `extras.waterOnly`, index entry `waterOnly`); a square with no water has no water node | `lod16Water#<16 hex>` (`extras.three`: the client's makeWaterMaterial) | 18 water | `POSITION`, `NORMAL`, `TEXCOORD_0` (metres / 100 from the chunk's corner) |
| `<landmark key>` (landmark packages) | `lod16Shell#...` | 2, or 35 bridge | as `shells`, without `_bkey`; `extras` add `landmark`, `name`, `lmId` (shared/landmarkSpec.js) or `feature`, `drawnBy`, `priority`, `night` |

`extras.buildings` (shells): the building keys `<tile>:<index>` (the client's record: the tile `t_<tile>.bin`, the
record's index in its `bldg` section, LF39 records after the compiled ones). A tower silhouette's vertices carry its own
key; a merged block shell's carry its region's largest building (a block is one label at these levels).

**Materials**: the shell material's `extras.three` describes the client's (MeshBasicMaterial lit in the shader,
`client/src/lod/shellMaterial.js`): `textures.map` = the FW14 window grid (`file` in the shared store, `uri` under
`client/public`, repeat wrap); `userData.lod16` = the lighting (flat facet normals; sky ambient times the city AO and a 0.5
sky-view factor on walls; sun times N.L, none under the horizon), and the night term: a window (70 x 65 % of each 3 m x
3.8 m bay) is lit where a per-bay hash is under `_lit x 0.28`, colour (1.0, 0.82, 0.5) x 1.1, walls only; where a bay is
under two pixels, 2, 4, 8 bays are taken at a time with the same chance and glazed share (the same mean). A renderer
maps it to an emissive mask on the window grid. The ground material is the client's ground shader at matId 8
(`extras.three.color` = a stand-in albedo).

**Drawing them** (the three.js manager's rules, `client/src/lod/manager.js`): every L6 package and every landmark is always
resident; a chunk is replaced by its four children (the 128 x 2^(n-1) chunks inside it) only when all of them are loaded,
and when its screen-space error (`err` x pixels per radian / distance to its box) is over the tier's threshold (3, 2,
1 px for Low, Medium, High); cross-fades are dithered. A renderer that already draws the city near the camera at full
detail hides these packages there (three.js: per 512 m tile once the tile is assembled). Landmarks whose `drawnBy` names
a module (`bridgeKit`: the bridges) are already resident at full detail in the client and are not drawn twice there.
