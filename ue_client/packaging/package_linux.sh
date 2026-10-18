#!/usr/bin/env bash
# Cook, stage and package ValdradaUE for Linux with RunUAT BuildCookRun, then measure what was made.
#
#   bash build_linux.sh Shipping && bash package_linux.sh Shipping      the release build
#   bash package_linux.sh Development                                    a build with logging and the console
#   bash package_linux.sh Shipping --build                               let BuildCookRun compile the game target too
#   bash package_linux.sh Shipping --stage-only                          re-stage and re-package the last cook
#
# Output (VUE_OUT, default ue_client/packaging/out):
#   archive/<Config>/Linux/            the packaged app: ValdradaUE.sh (Epic's start script), Engine/, ValdradaUE/Binaries,
#                                      ValdradaUE/Content/Paks/pakchunk<N>-Linux{.pak,.utoc,.ucas,_s<k>.ucas}
#   logs/package_<Config>_<time>.log   UAT's output; logs/uat_<Config>_<time>/ holds the cook's and UnrealPak's logs
#   package_<Config>.json              stage times, the cooked size, every pak file with its size, the archive size
#   times.tsv                          one row per stage
#
# The project's DefaultGame.ini must hold the packaging block (config/DefaultGame.packaging.ini, marker
# "; valdrada-packaging"). The cook needs the project's editor modules (build_linux.sh builds them) and memory: it refuses
# to start below VUE_MIN_FREE_GB available. Shader compile workers are capped at half the hardware threads
# (VUE_SCW_UNUSED: the threads left free; a commandlet ignores the engine's percentage setting) so a cook does not starve
# other work on the machine, and the cooker collects garbage whenever less than VUE_COOK_MIN_FREE_MB (64 GB) of memory is
# free, so a long cook does not take the memory other processes need. VUE_COOK_PROCESSES=N cooks with N processes
# (-CookProcessCount: the whole city's 205k packages cook at about 2.5 a second in one process); VUE_COOK_MAX_USED_MB
# caps each process's memory before it collects garbage. The cooked files (Saved/Cooked/Linux) and the staging folder stay for an
# incremental re-cook; delete them with --clean once the archive is copied out.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

CONFIG=Shipping; BUILD=0; COOK=1; CLEAN=0; EXTRA=()
while [ $# -gt 0 ]; do
  case $1 in
    Shipping|Development|Test|DebugGame) CONFIG=$1 ;;
    --build) BUILD=1 ;;
    --stage-only) COOK=0 ;;
    --clean) CLEAN=1 ;;
    --) shift; EXTRA=("$@"); break ;;
    -h|--help) sed -n 2,22p "$0"; exit 0 ;;
    *) die "unknown argument $1" ;;
  esac
  shift
done

check_engine
PROJ_DIR=$(dirname "$VUE_PROJECT")
grep -q '^; valdrada-packaging' "$PROJ_DIR/Config/DefaultGame.ini" || die "$PROJ_DIR/Config/DefaultGame.ini lacks the packaging block (append $PKG_DIR/config/DefaultGame.packaging.ini)"
check_memory
STAGE="$VUE_OUT/staging/$CONFIG"; ARCH="$VUE_OUT/archive/$CONFIG"
mkdir -p "$VUE_OUT/logs"
LOG="$VUE_OUT/logs/package_${CONFIG}_$(date +%Y%m%d-%H%M%S).log"

COMMON=(BuildCookRun -project="$VUE_PROJECT" -target="$VUE_NAME" -platform=Linux -clientconfig="$CONFIG"
        -unattended -utf8output -nop4 -nocompileeditor)
[ $BUILD = 1 ] && COMMON+=(-build) || COMMON+=(-skipbuild)
COOKER="-ini:Engine:[DevOptions.Shaders]:NumUnusedShaderCompilingThreads=${VUE_SCW_UNUSED:-$(( $(nproc) / 2 ))}"
# (the engine collects only when both limits are crossed, so a per-process cap clears the free-memory limit)
[ "${VUE_COOK_MAX_USED_MB:-0}" -gt 0 ] && MINFREE_DEF=0 || MINFREE_DEF=65536
COOKER+=" -ini:Editor:[CookSettings]:MemoryMinFreePhysical=${VUE_COOK_MIN_FREE_MB:-$MINFREE_DEF}"
# several cook processes (one director and its workers) share the packages; each collects garbage above
# VUE_COOK_MAX_USED_MB of its own memory
[ "${VUE_COOK_PROCESSES:-1}" -gt 1 ] && COOKER+=" -CookProcessCount=$VUE_COOK_PROCESSES"
[ "${VUE_COOK_MAX_USED_MB:-0}" -gt 0 ] && COOKER+=" -ini:Editor:[CookSettings]:MemoryMaxUsedPhysical=$VUE_COOK_MAX_USED_MB"
COOK_ARGS=(-cook -manifests -AdditionalCookerOptions="$COOKER")
STAGE_ARGS=(-skipcook -stage -package -pak -iostore -compressed -manifests -archive -archivedirectory="$ARCH" -stagingdirectory="$STAGE"
            -nodebuginfo)
[ "$CONFIG" = Shipping ] && STAGE_ARGS+=(-distribution)
# UAT writes its logs (and the cook's) to ~/Library/Logs on Linux unless told otherwise: keep them with the build
RUN_ID=$(date +%Y%m%d-%H%M%S)
export uebp_LogFolder="$VUE_OUT/logs/uat_${CONFIG}_$RUN_ID"
mkdir -p "$uebp_LogFolder"

rm -rf "$ARCH"
t0=$(date +%s)
# memory while cooking: the machine's available memory and the cook process's resident size, every 30 s
MEMLOG="$VUE_OUT/logs/mem_${CONFIG}_$RUN_ID.tsv"
sample_mem() {
  while :; do
    local rss=0 p
    for p in $(pgrep -f -i -- "-run=cook" 2>/dev/null); do   # the director runs -run=Cook, its workers -run=cook
      grep -q -- "$VUE_PROJECT" "/proc/$p/cmdline" 2>/dev/null || continue
      rss=$((rss + $(awk '/VmRSS/ {print $2}' "/proc/$p/status" 2>/dev/null || echo 0)))
    done
    printf '%s\t%s\t%s\n' "$(date +%T)" "$(avail_gb)" "$((rss / 1048576))" >> "$MEMLOG"
    sleep 30
  done
}
if [ $COOK = 1 ]; then
  printf 'time\tavailable_gb\tcook_rss_gb\n' > "$MEMLOG"
  sample_mem & SAMPLER=$!
  trap 'kill $SAMPLER 2>/dev/null' EXIT
  say "cook $CONFIG (log $LOG, UAT logs $uebp_LogFolder)"
  timed "cook-$CONFIG" uenv nice -n 10 "$UAT" "${COMMON[@]}" "${COOK_ARGS[@]}" "${EXTRA[@]}" > "$LOG" 2>&1 \
    || { grep -E "Error|ERROR|error:" "$LOG" | tail -20; die "cook failed (log $LOG)"; }
  kill $SAMPLER 2>/dev/null
  say "cook memory: peak resident $(awk 'NR > 1 && $3 > m {m = $3} END {print m + 0}' "$MEMLOG") GB, lowest available $(awk 'NR > 1 && (n == "" || $2 < n) {n = $2} END {print n + 0}' "$MEMLOG") GB ($MEMLOG)"
fi
# The cooker writes the chunk manifests (Metadata/ChunkManifest/pakchunk<N>.txt) with Windows separators, which UAT on a
# Linux host does not match against the staged files, so every package would land in pakchunk0: use forward slashes.
MAN="$PROJ_DIR/Saved/Cooked/Linux/$VUE_NAME/Metadata/ChunkManifest"
[ -f "$MAN/pakchunklist.txt" ] || die "no chunk manifests in $MAN (is bGenerateChunks=True in the packaging block?)"
sed -i 's|\\|/|g' "$MAN"/pakchunk*.txt
say "chunk manifests: $(ls "$MAN"/pakchunk[0-9]*.txt | wc -l) chunks"
say "stage, IoStore, package, archive $CONFIG"
timed "stage-$CONFIG" uenv nice -n 10 "$UAT" "${COMMON[@]}" "${STAGE_ARGS[@]}" "${EXTRA[@]}" >> "$LOG" 2>&1
rc=$?
t1=$(date +%s)
[ $rc = 0 ] || { grep -E "Error|ERROR|error:" "$LOG" | tail -20; die "staging exit $rc (log $LOG)"; }

# the stage times UAT reports, and the sizes
APP="$ARCH/Linux"
[ -d "$APP" ] || die "no packaged app at $APP"
python3 - "$LOG" "$PROJ_DIR" "$APP" "$CONFIG" "$((t1 - t0))" "$VUE_OUT/package_$CONFIG.json" <<'PY'
import json, os, re, sys
log, proj, app, config, secs, out = sys.argv[1:7]
text = open(log, errors='replace').read()
def du(p):
    n = b = 0
    for dp, _, fn in os.walk(p):
        for f in fn:
            q = os.path.join(dp, f)
            if not os.path.islink(q):
                n += 1; b += os.path.getsize(q)
    return n, b
stages = {}
for name, pat in (('cook', r'Cook command time: ([\d.]+) s'), ('stage', r'Copy Build to Staging Directory.*?time: ([\d.]+) s'),
                  ('pak_iostore', r'IoStore.*?(?:completed|time)[^\d]*([\d.]+) s'), ('total', r'BuildCookRun time: ([\d.]+) s')):
    m = re.findall(pat, text)
    if m: stages[name] = float(m[-1])
cooked = os.path.join(proj, 'Saved', 'Cooked', 'Linux')
paks_dir = None
for dp, dn, fn in os.walk(app):
    if os.path.basename(dp) == 'Paks':
        paks_dir = dp; break
paks = sorted((f, os.path.getsize(os.path.join(paks_dir, f))) for f in os.listdir(paks_dir)) if paks_dir else []
chunks = {}
for f, s in paks:
    m = re.match(r'(pakchunk\d+)', f)
    k = m.group(1) if m else f
    chunks[k] = chunks.get(k, 0) + s
n_app, b_app = du(app)
n_c, b_c = du(cooked) if os.path.isdir(cooked) else (0, 0)
info = {'config': config, 'seconds': int(secs), 'uat_stages_s': stages,
        'cooked': {'files': n_c, 'bytes': b_c}, 'app': {'files': n_app, 'bytes': b_app, 'path': app},
        'paks': [{'name': f, 'bytes': s} for f, s in paks], 'chunks_bytes': chunks,
        'largest_file': max((s for _, s in paks), default=0)}
json.dump(info, open(out, 'w'), indent=1)
print(f'packaged {config} in {int(secs)} s: app {n_app} files {b_app / 1e9:.2f} GB, cooked {b_c / 1e9:.2f} GB, '
      f'{len(paks)} pak files, largest {info["largest_file"] / 2**20:.0f} MiB')
for k, v in sorted(chunks.items()):
    print(f'  {k}: {v / 1e9:.3f} GB')
PY
if [ $CLEAN = 1 ]; then
  say "deleting the cook output and the staging folder (the archive stays)"
  rm -rf "$PROJ_DIR/Saved/Cooked/Linux" "$STAGE"
fi
say "done: $APP"
