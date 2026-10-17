#!/usr/bin/env bash
# A shot's actor layers for Unreal (or any USD renderer) from the headless core, with no three.js page: the core's take
# (tools/core/take.mjs), its walkers as the crowd's walker files (tracks_to_peds.mjs), its vehicles, train cars and the
# Lake's boats as the moving-set file (tracks_to_trains.mjs, tracks_to_boats.mjs, tracks_to_mov.py), the signal heads
# with their lenses switched by state (signals_dump.mjs once per shot), the take's light and sky (light_bake.mjs), then
# the export's own writers, unchanged (usd_write.py for the camera and the moving set, usd_peds.py for the walkers),
# published to /data0/projectnyc_aux/cellcache/takes/<shot>/.
#
#   tools/core/actor_layers.sh <shot> [seed] [template harvest]
# (the template gives the vehicle, train and boat parts' geometry; by default win/ht2, and for a take with boats on the
# Lake the page's harvest of the shot, /data0/projectnyc_aux/tmp/bx/trailer2/ue/<shot>/h, which has the boats)
#
# Publishing is atomic: each build goes into its own folder, <shot>/v<stamp>/ (harvest/, usd/, tracks.atrk, stats.json),
# and only when it is complete do <shot>/harvest, usd, tracks.atrk and stats.json switch to it, each in one rename of a
# symbolic link. A consumer that opened an earlier build keeps reading it whole (builds are never deleted), and the take
# roots record their own build's harvest folder (customLayerData.harvest), a path that never changes.
set -euo pipefail
SHOT="$1"; SEED="${2:-1}"; TEMPLATE_ARG="${3:-}"; TEMPLATE="${TEMPLATE_ARG:-/data0/projectnyc_aux/tmp/bx/win/ht2}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source /data0/projectnyc_aux/env.sh
TAKE="$ROOT/shots/core/r2/${SHOT}_s${SEED}"
PUB="/data0/projectnyc_aux/cellcache/takes/$SHOT"
EXP="$ROOT/client/tools/ar34/export"
UVRUN=(uv run --offline --no-project --with usd-core --with numpy --with pillow python)
cd "$ROOT"
STAMP="$(date +%Y%m%d-%H%M%S)"
VER="v$STAMP"
BUILD="$PUB/$VER"
HV="$BUILD/harvest"; USD="$BUILD/usd"
if [ -d "$TAKE" ]; then mv "$TAKE" "${TAKE}_prev_$STAMP"; fi   # an earlier take of the shot: moved aside, never deleted
node tools/core/take.mjs --shot "$SHOT" --seed "$SEED" --out "$TAKE" --stats-every 0 ${TAKE_RADIUS:+--radius $TAKE_RADIUS} | grep '^\[core\]'
mkdir -p "$HV" "$USD"
# the street lamps, the signal heads (the cells leave them out) and their registry: the page writes them once per shot
SIGF="$ROOT/shots/core/signals/${SHOT}.json"
[ -f "$SIGF" ] || node tools/core/signals_dump.mjs --shot "$SHOT" --out "$SIGF" | grep -E '^\[signals\]|FAILED'
# the light: the page's own light code on SwiftShader, no city (sun, sky domes, exposure, lamps from the cell packages,
# headlamp beams per frame)
node tools/core/light_bake.mjs --take "$TAKE" --out "$HV" | grep -E '^\[light\] '"$SHOT"'( lamps)?:|FAILED'
node tools/core/tracks_to_peds.mjs --tracks "$TAKE/tracks.atrk" --out "$HV" | grep '^\[peds\]'
node tools/core/tracks_to_trains.mjs --tracks "$TAKE/tracks.atrk" --out "$TAKE/trains_${SHOT}.json" | grep '^\[trains\]'
node tools/core/tracks_to_boats.mjs --tracks "$TAKE/tracks.atrk" --out "$TAKE/boats_${SHOT}.json" | grep '^\[boats\]'
BOATS="$(python3 -c 'import json, sys; print(len(json.load(open(sys.argv[1]))["sets"]))' "$TAKE/boats_${SHOT}.json")"
if [ -z "$TEMPLATE_ARG" ] && [ "$BOATS" != "0" ] && [ -f "/data0/projectnyc_aux/tmp/bx/trailer2/ue/$SHOT/h/manifest.json" ]; then
  TEMPLATE="/data0/projectnyc_aux/tmp/bx/trailer2/ue/$SHOT/h"; echo "template: $TEMPLATE (the take has boats)"
fi
python3 tools/core/tracks_to_mov.py --tracks "$TAKE/tracks.atrk" --template "$TEMPLATE" --out "$HV" --trains "$TAKE/trains_${SHOT}.json" --boats "$TAKE/boats_${SHOT}.json" --signals "$SIGF"
(cd "$EXP" && "${UVRUN[@]}" usd_write.py --in "$HV" --out "$USD" --shots "$SHOT" --nokeys --nohooks > "$TAKE/usd_write.log" 2>&1) || { tail -5 "$TAKE/usd_write.log"; exit 1; }
(cd "$EXP" && "${UVRUN[@]}" usd_peds.py --in "$HV" --out "$USD" --shots "$SHOT" > "$TAKE/usd_peds.log" 2>&1) || { tail -5 "$TAKE/usd_peds.log"; exit 1; }
grep '^\[usd_peds\] '"$SHOT" "$TAKE/usd_peds.log" | cut -c1-200
cp "$TAKE/tracks.atrk" "$TAKE/stats.json" "$BUILD/"
# the switch: each published name becomes a link to this build in one rename (a real folder or file from before the
# versioned layout is moved aside once, never deleted)
for n in harvest usd tracks.atrk stats.json; do
  if [ -e "$PUB/$n" ] && [ ! -L "$PUB/$n" ]; then
    case "$n" in *.*) mv "$PUB/$n" "$PUB/${n%.*}_prev_$STAMP.${n##*.}" ;; *) mv "$PUB/$n" "$PUB/${n}_prev_$STAMP" ;; esac
  fi
  ln -sfn "$VER/$n" "$PUB/.$n.$STAMP" && mv -T "$PUB/.$n.$STAMP" "$PUB/$n"
done
echo "published $PUB -> $VER ($(du -sh "$USD" | cut -f1) usd, $(du -sh "$HV" | cut -f1) harvest)"
