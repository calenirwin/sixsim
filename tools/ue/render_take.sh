#!/usr/bin/bash
# R1C (lane C, 2026-10-11): render a take in Unreal from its shot name (see tools/ue/render_take.py for the inputs, the
# world and take caches, the output layout and the exit codes).
#   tools/ue/render_take.sh <shot> [--frames a-b] [--out <root>] [--gpu-pci 01] [--rebuild-world] [--rebuild-take] [--keep-raw]
set -u
source /data0/projectnyc_aux/env.sh
cd "$(dirname "$0")/../.."
exec python3 tools/ue/render_take.py "$@"
