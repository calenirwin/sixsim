#!/bin/bash
# Builds the client's editor target (the ValdradaUE game module, ValdradaRender, ValdradaCells) against the engine at
# UE_ROOT. A new project's first build runs the engine's metadata step, which rewrites the engine's module manifests;
# -NoManifestChanges makes it fail rather than change their contents (the engine's build id is recycled when no engine
# module is newer than its manifest), so a shared engine other editors start from keeps working.
#   bash ue_client/ValdradaUE/Tools/build_editor.sh [log file]
set -u
UE_ROOT=${UE_ROOT:-/data0/projectnyc_aux/ue/UE_5.8}
HERE=$(cd "$(dirname "$0")/.." && pwd)
LOG=${1:-$HERE/Saved/build_editor.log}
mkdir -p "$(dirname "$LOG")"
cd "$UE_ROOT" || exit 2
nice -n 5 Engine/Build/BatchFiles/Linux/Build.sh ValdradaUEEditor Linux Development -Project="$HERE/ValdradaUE.uproject" \
  -NoManifestChanges -MaxParallelActions=${UE_BUILD_JOBS:-32} -WaitMutex > "$LOG" 2>&1
code=$?
grep -E "error|Result:|Total execution" "$LOG" | head -60
( cd "$UE_ROOT" && [ -f "${ENGINE_MD5:-/nonexistent}" ] && md5sum -c --quiet "$ENGINE_MD5" && echo "engine manifests unchanged" )
echo "build exit $code"
exit $code
