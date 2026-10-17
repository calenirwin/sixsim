#!/usr/bin/env bash
# Lane B: the persistent tier's GPU cost with the GPU saturated (tools/lod/bench_sat.js), at the views of tools/lod/cams.json,
# at ?tier=low and at the default settings (?lod16=1 only), with the GPU's clock, load and power sampled alongside.
#   GPU_LANE=36 bash tools/lod/bench_sat.sh [views] [out]     (default viaMid,bethMid; client/shots/arch_r1b/bench_sat)
set -u
source /data0/projectnyc_aux/env.sh
cd "$(dirname "$0")/../.."
VIEWS=${1:-viaMid,bethMid}; OUT=${2:-client/shots/arch_r1b/bench_sat}
mkdir -p "$OUT"
export GPU_LANE=${GPU_LANE:-36}
GPU=$(( (GPU_LANE - 1) % 3 ))
for SET in low default; do
  F="lod16=1"; [ "$SET" = low ] && F="tier=low"
  for V in ${VIEWS//,/ }; do
    CLK="$OUT/clock_${V}_${SET}.csv"
    nvidia-smi -i $GPU --query-gpu=timestamp,clocks.sm,clocks.mem,utilization.gpu,power.draw --format=csv,noheader -lms 250 > "$CLK" &
    SMI=$!
    echo "== $V $SET $(date +%H:%M:%S)"
    timeout 1500 node tools/bshot.mjs --cams tools/lod/cams.json --views "$V" --time day --size 1920x1080 --flags "$F" --label "sat_$SET" --evalfile tools/lod/bench_sat.js --out "$OUT" 2>&1 | grep -E "eval" | cut -c1-3000
    kill $SMI 2>/dev/null
  done
done
echo "== done $(date +%H:%M:%S)"
