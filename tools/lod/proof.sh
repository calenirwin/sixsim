#!/usr/bin/env bash
# Lane B proof frames: the shot cameras of scTerraceGolden (Bethesda) and t7ArchTrack (the 125th St viaduct), day and
# night, with ?lod16=1 and without it, at the Low tier settings (pr=1, gi=0, probe=0, nocascade2=1), 1920 x 1080.
#   GPU_LANE=36 bash tools/lod/proof.sh [out]      (default client/shots/arch_r1b)
set -u
source /data0/projectnyc_aux/env.sh
cd "$(dirname "$0")/../.."
OUT=${1:-client/shots/arch_r1b}
mkdir -p "$OUT"
LOW="pr=1&gi=0&probe=0&nocascade2=1"
BASE="hud=0&lmwait=150&life=0&clean=1"
export GPU_LANE=${GPU_LANE:-36}
for T in day night; do
  for MODE in lod16 base; do
    F="$BASE&$LOW"; [ "$MODE" = lod16 ] && F="$F&lod16=1"
    echo "== $T $MODE $(date +%H:%M:%S)"
    timeout 1500 node tools/ad/record.mjs --shot scTerraceGolden,t7ArchTrack --probe 1 --time "$T" --flags "$F" --label "$MODE" --out "$OUT" 2>&1 | grep -E "probe|frame|wrote|error|ERR|INVALID" | grep -v PIXEL_PACK | tail -8
  done
done
echo "== done $(date +%H:%M:%S)"
