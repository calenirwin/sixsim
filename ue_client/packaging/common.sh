# Shared settings of the ValdradaUE packaging scripts (sourced, not run). Every value can be set in the environment first.
#
#   UE_ROOT        the engine (a source build of Unreal Engine 5.8; default: the development machine's)
#   VUE_PROJECT    the .uproject to build and package (default: ue_client/ValdradaUE/ValdradaUE.uproject)
#   VUE_OUT        where builds, staged packages, logs and release files go (default: ue_client/packaging/out)
#   VUE_JOBS       parallel compile actions (default 32: a full engine game build at 128 actions needs ~200 GB of RAM)
#   VUE_MIN_FREE_GB  refuse to start a cook or build when `free -g` reports less available memory (default 150)
#   UE_LOCAL_DDC   the derived data cache (default /data0/projectnyc_aux/ue/ddc: never the home drive)

PKG_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd "$PKG_DIR/../.." && pwd)
UE_ROOT=${UE_ROOT:-/data0/projectnyc_aux/ue/UE_5.8}
VUE_PROJECT=${VUE_PROJECT:-$REPO_DIR/ue_client/ValdradaUE/ValdradaUE.uproject}
VUE_OUT=${VUE_OUT:-$PKG_DIR/out}
VUE_JOBS=${VUE_JOBS:-32}
VUE_MIN_FREE_GB=${VUE_MIN_FREE_GB:-150}
VUE_NAME=$(basename "$VUE_PROJECT" .uproject)
export UE_ROOT VUE_PROJECT VUE_OUT VUE_JOBS VUE_NAME

# the engine's caches on the data drive (no shared DDC); no core files (a crashing editor once wrote 143 GB to /).
# The cache variables have a hyphen in their names, which bash cannot export: uenv passes them to one command.
UE_LOCAL_DDC=${UE_LOCAL_DDC:-/data0/projectnyc_aux/ue/ddc}
uenv() { env "UE-LocalDataCachePath=$UE_LOCAL_DDC" "UE-SharedDataCachePath=None" "$@"; }
export TMPDIR=${TMPDIR:-/data0/projectnyc_aux/tmp}
ulimit -c 0
unset ELECTRON_RUN_AS_NODE

UBT="$UE_ROOT/Engine/Build/BatchFiles/RunUBT.sh"
UAT="$UE_ROOT/Engine/Build/BatchFiles/RunUAT.sh"

say() { echo "[$(date +%H:%M:%S)] $*"; }
die() { echo "[$(date +%H:%M:%S)] FAILED: $*" >&2; exit 1; }

check_engine() {
  [ -x "$UBT" ] || die "no engine at UE_ROOT=$UE_ROOT (RunUBT.sh missing)"
  [ -f "$VUE_PROJECT" ] || die "no project at VUE_PROJECT=$VUE_PROJECT"
  local v; v=$(python3 -c "import json;d=json.load(open('$UE_ROOT/Engine/Build/Build.version'));print('%d.%d.%d'%(d['MajorVersion'],d['MinorVersion'],d['PatchVersion']))")
  say "engine $v at $UE_ROOT; project $VUE_PROJECT"
}

# available memory in GB (the "available" column of free -g)
avail_gb() { free -g | awk '/^Mem:/ {print $7}'; }
check_memory() {
  local a; a=$(avail_gb)
  [ "$a" -ge "$VUE_MIN_FREE_GB" ] || die "only $a GB of memory available, $VUE_MIN_FREE_GB GB required (VUE_MIN_FREE_GB)"
  say "memory available: $a GB"
}

# run "$@", append "<label> <seconds> <exit>" to $VUE_OUT/times.tsv, return its exit code
timed() {
  local label=$1; shift
  local t0 rc; t0=$(date +%s)
  "$@"; rc=$?
  mkdir -p "$VUE_OUT"
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date +%FT%T)" "$VUE_NAME" "$label" "$(( $(date +%s) - t0 ))" "$rc" >> "$VUE_OUT/times.tsv"
  say "$label: $(( $(date +%s) - t0 )) s, exit $rc"
  return $rc
}
