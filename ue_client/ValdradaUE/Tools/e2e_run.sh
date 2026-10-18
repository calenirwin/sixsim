#!/bin/bash
# One end-to-end run on one GPU: the headless core on PORT, the Unreal client (editor build) attached to it, and
# Tools/e2e_check.py driving both through the Python API; everything it started is stopped by its PID at the end.
#   OUT=<dir> PORT=2010 GPU_PCI=61 FRAMES=50 bash ue_client/ValdradaUE/Tools/e2e_run.sh
# The GPU is taken with the take renderer's lock (render_take.py: /data0/projectnyc_aux/tmp/ue_gpu_locks).
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
REPO=$(cd "$HERE/../.." && pwd)
PORT=${PORT:-2010}; GPU_PCI=${GPU_PCI:-61}; FRAMES=${FRAMES:-50}
OUT=${OUT:-/data0/projectnyc_aux/dev/v2/ueclient/e2e/ue_$(date +%H%M)}
mkdir -p "$OUT"
LOCK=/data0/projectnyc_aux/tmp/ue_gpu_locks/pci-0000_${GPU_PCI}_00_0.lock
exec 9>>"$LOCK"
flock -w 1800 9 || { echo "GPU $GPU_PCI busy"; exit 3; }
echo "pid $$ $(date) valdrada ue client e2e" >&9
cd "$REPO"
node tools/core/serve.mjs --port "$PORT" > "$OUT/core.log" 2>&1 &
CORE=$!
PORT=$PORT GPU_PCI=$GPU_PCI bash "$HERE/Tools/run_client.sh" "$OUT/client.log" &
CLIENT=$!
echo "core $CORE client $CLIENT out $OUT"
python3 "$HERE/Tools/e2e_check.py" --port "$PORT" --frames "$FRAMES" --out "$OUT" ${E2E_ARGS:-} 2>&1 | tee "$OUT/e2e.log"
code=${PIPESTATUS[0]}
kill "$CLIENT" "$CORE" 2>/dev/null
for i in $(seq 1 30); do kill -0 "$CLIENT" 2>/dev/null || break; sleep 1; done
kill -9 "$CLIENT" 2>/dev/null
echo "e2e exit $code"
exit $code
