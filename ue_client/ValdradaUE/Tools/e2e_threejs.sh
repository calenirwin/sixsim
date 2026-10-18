#!/bin/bash
# The same end-to-end requests against the three.js build (the release's Electron server and Content, headless on one
# GPU through ANGLE Vulkan, as release_bx/start_test.sh runs it), for comparing pose and framing with the Unreal client.
#   OUT=<dir> PORT=2011 GPU_PCI=61 FRAMES=50 bash ue_client/ValdradaUE/Tools/e2e_threejs.sh
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
R=/data0/projectnyc_aux/boundless-nyc
REL=${REL:-$(ls -d $R/release/Valdrada_*_win64 | sort -V | tail -1)}
E=$R/server/node_modules/electron/dist/electron
PORT=${PORT:-2011}; GPU_PCI=${GPU_PCI:-61}; FRAMES=${FRAMES:-50}
OUT=${OUT:-/data0/projectnyc_aux/dev/v2/ueclient/e2e/three_$(date +%H%M)}
mkdir -p "$OUT"
LOCK=/data0/projectnyc_aux/tmp/ue_gpu_locks/pci-0000_${GPU_PCI}_00_0.lock
exec 9>>"$LOCK"
flock -w 1800 9 || { echo "GPU $GPU_PCI busy"; exit 3; }
echo "pid $$ $(date) valdrada three.js e2e" >&9
export DRI_PRIME=pci-0000_${GPU_PCI}_00_0
env -u ELECTRON_RUN_AS_NODE "$E" "$R/server" --content "$REL/Content" --port "$PORT" --headless --res 1280x720 \
  --ozone-platform=headless --use-angle=vulkan --enable-features=Vulkan > "$OUT/server.log" 2>&1 &
SP=$!
for i in $(seq 1 120); do (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null && break; kill -0 $SP 2>/dev/null || break; sleep 1; done
python3 "$HERE/Tools/e2e_check.py" --port "$PORT" --frames "$FRAMES" --out "$OUT" 2>&1 | tee "$OUT/e2e.log"
code=${PIPESTATUS[0]}
kill $SP 2>/dev/null; wait $SP 2>/dev/null
echo "e2e exit $code"
exit $code
