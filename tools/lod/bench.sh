#!/usr/bin/env bash
# Lane B perf: fps, draw calls, triangles and GPU time of the whole frame at the Low tier settings (pr=1, gi=0, probe=0,
# nocascade2=1, 1920 x 1080), with ?lod16=1 (and its tier hidden in the same page) and without it, plus the page's peak GPU
# memory (nvidia-smi, the Chromium GPU process on this lane's GPU).
#   GPU_LANE=36 bash tools/lod/bench.sh <cams.json> <views> [out]
set -u
source /data0/projectnyc_aux/env.sh
cd "$(dirname "$0")/../.."
CAMS=$1; VIEWS=$2; OUT=${3:-client/shots/arch_r1b/bench}
mkdir -p "$OUT"
export GPU_LANE=${GPU_LANE:-36}
GPU=$(( (GPU_LANE - 1) % 3 ))
for MODE in lod16 base; do
  F="pr=1&gi=0&probe=0&nocascade2=1"; [ "$MODE" = lod16 ] && F="$F&lod16=1"
  MEM="$OUT/mem_$MODE.txt"; : > "$MEM"
  ( while true; do nvidia-smi -i $GPU | awk '/C\+G/ {gsub("MiB","",$(NF-1)); print $(NF-1)}' | sort -n | tail -1 >> "$MEM"; sleep 1; done ) &
  POLL=$!
  timeout 1500 node tools/bshot.mjs --cams "$CAMS" --views "$VIEWS" --time day --size 1920x1080 --flags "$F" --label "bench_$MODE" --evalfile tools/lod/bench_eval.js --out "$OUT" 2>&1 | grep -E "^shot|eval" | cut -c1-2000
  kill $POLL 2>/dev/null
  echo "$MODE peak GPU process memory MiB: $(sort -n "$MEM" | tail -1)"
done
