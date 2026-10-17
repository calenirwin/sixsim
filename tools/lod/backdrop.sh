#!/usr/bin/env bash
# The backdrop's chain (docs/notes/r2-backdrop.md; tile-system.md D12): records, ground, far levels, merged into a lod16
# folder beside the city's chunks, so the backdrop ships as L3 to L6 chunks with the city's.
#
#   tools/lod/backdrop.sh records            the records from client/data/raw/backdrop (and client/data/raw/enc_water.json):
#                                            OSM extracts, the DEM grid, land and water, the ground heights, the buildings
#   tools/lod/backdrop.sh ground <run dir>   the ground of every chunk (terrain, canopy, texture, night map) into <run>/ground
#   tools/lod/backdrop.sh build <lod16 dir> <run dir>
#                                            the city's L3 where an L4 it shares is refined by the backdrop (build_persistent.mjs
#                                            --levels 3), then the backdrop's chunks and landmarks (build_backdrop.mjs), merged
#                                            into <lod16 dir>/index.json
# BD_REC (the records, default /data0/projectnyc_aux/tiles_backdrop/records) and BD_JOBS (processes, default 48).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source /data0/projectnyc_aux/env.sh
cd "$ROOT"
P=client/tools/pipeline/backdrop
JOBS="${BD_JOBS:-48}"
REC="${BD_REC:-/data0/projectnyc_aux/tiles_backdrop/records}"
case "${1:-}" in
  records)
    python3 $P/osm_extract.py
    python3 $P/terrain.py
    python3 $P/land.py
    python3 tools/lod/water_l6.py
    python3 $P/land.py final client/data/raw/water_l6.wkb
    python3 $P/heights.py
    python3 $P/buildings.py
    ;;
  ground)
    python3 tools/lod/backdrop_ground.py --out "$2" --jobs "$JOBS"
    ;;
  build)
    OUT="$2"; RUN="$3"
    # the city's L3: every child of an L4 chunk the city shares with a backdrop L3 chunk (a chunk gives way only to all its
    # children, so the city's part of such a chunk needs its own L3)
    L3=$(node -e '
      const fs = require("fs");
      const plan = JSON.parse(fs.readFileSync(process.argv[1] + "/ground/plan.json", "utf8"));
      const idx = JSON.parse(fs.readFileSync(process.argv[2] + "/index.json", "utf8"));
      const city4 = new Set(Object.entries((idx.chunks || {})["4"] || {}).filter(([, e]) => e.f).map(([k]) => k));
      const par = new Set((plan["3"] || []).map(([i, j]) => `${Math.floor(i / 2)}_${Math.floor(j / 2)}`));
      const out = [];
      for (const p of par) if (city4.has(p)) { const [i, j] = p.split("_").map(Number); for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) out.push(`3:${i * 2 + di}_${j * 2 + dj}`); }
      process.stdout.write(out.join(","));' "$RUN" "$OUT")
    if [ -n "$L3" ]; then node --max-old-space-size=24000 tools/lod/build_persistent.mjs --out "$OUT" --levels 3 --only "$L3"; fi
    for k in $(seq 0 7); do
      node --max-old-space-size=24000 tools/lod/build_backdrop.mjs --out "$OUT" --ground "$RUN/ground" --rec "$REC" --part "$k/8" &
    done
    wait
    node --max-old-space-size=8000 tools/lod/build_backdrop.mjs --out "$OUT" --ground "$RUN/ground" --rec "$REC" --merge
    ;;
  *)
    echo "usage: tools/lod/backdrop.sh records | ground <run dir> | build <lod16 dir> <run dir>" >&2; exit 2;;
esac
