#!/bin/bash
# Starts the Unreal renderer client from the editor build (development; the packaged build is ValdradaUE.sh) against a
# core on PORT, rendering offscreen on one GPU.
#   PORT=2000 GPU_PCI=61 RES=1280x720 bash ue_client/ValdradaUE/Tools/run_client.sh [log file] [extra engine arguments]
#   NULLRHI=1: no GPU at all (streaming and state only; captures answer an error)
# GPU_PCI is the bus id of the GPU as nvidia-smi prints it (61 is index 2 on cs3gpu); DRI_PRIME puts it first for Vulkan.
set -u
UE_ROOT=${UE_ROOT:-/data0/projectnyc_aux/ue/UE_5.8}
HERE=$(cd "$(dirname "$0")/.." && pwd)
LOG=${1:-$HERE/Saved/client.log}; shift || true
RES=${RES:-1280x720}
ulimit -c 0
args=("$HERE/ValdradaUE.uproject" /Game/Client/Maps/City -game -windowed "-ResX=${RES%x*}" "-ResY=${RES#*x}" -Unattended -NoSplash
      -NoLoadingScreen -nosound -log -stdout -FullStdOutLogOutput "-ValdradaPort=${PORT:-2000}" "-ValdradaHost=${HOST:-127.0.0.1}")
if [ "${NULLRHI:-0}" = 1 ]; then
  args+=(-nullrhi)
else
  args+=(-RenderOffscreen -graphicsadapter=0)
  export DRI_PRIME=pci-0000_${GPU_PCI:-61}_00_0
  [ -f /usr/share/vulkan/icd.d/nvidia_icd.json ] && export VK_ICD_FILENAMES=${VK_ICD_FILENAMES:-/usr/share/vulkan/icd.d/nvidia_icd.json}
fi
mkdir -p "$(dirname "$LOG")"
exec "$UE_ROOT/Engine/Binaries/Linux/UnrealEditor" "${args[@]}" "$@" > "$LOG" 2>&1
