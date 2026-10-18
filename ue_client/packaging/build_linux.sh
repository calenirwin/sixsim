#!/usr/bin/env bash
# Compile ValdradaUE for Linux: the editor target (the cook loads the project's modules into the editor) and the game
# target in Development and/or Shipping. Nothing is cooked here (package_linux.sh does that).
#
#   bash build_linux.sh                    editor + Development + Shipping
#   bash build_linux.sh Shipping           editor + Shipping
#   bash build_linux.sh Development --no-editor
#
# One UnrealBuildTool runs per engine at a time; -WaitMutex queues this build behind any other (an editor build of the
# runtime, another package). The editor target is built with -NoEngineChanges: it may compile the project's modules but
# never the engine's, whose binaries the editors on this machine are running. The game target is monolithic, so its
# first build compiles the engine's runtime modules into the project's Intermediate/Build/Linux/x64/<Name> (about 8 min
# at 32 actions, 11 GiB for Development and Shipping). Times go to $VUE_OUT/times.tsv, logs to $VUE_OUT/logs/.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

CONFIGS=(); EDITOR=1
for a in "$@"; do
  case $a in
    Development|Shipping|DebugGame|Test) CONFIGS+=("$a") ;;
    both) CONFIGS+=(Development Shipping) ;;
    --no-editor) EDITOR=0 ;;
    -h|--help) sed -n 2,13p "$0"; exit 0 ;;
    *) die "unknown argument $a" ;;
  esac
done
[ ${#CONFIGS[@]} -gt 0 ] || CONFIGS=(Development Shipping)

check_engine
check_memory
mkdir -p "$VUE_OUT/logs"
UBTARGS=(-Project="$VUE_PROJECT" -WaitMutex -SkipUBTBuild -NoHotReload -MaxParallelActions="$VUE_JOBS")

if [ $EDITOR = 1 ]; then
  say "editor target ${VUE_NAME}Editor (Development)"
  timed "build-editor" uenv nice -n 10 "$UBT" "${VUE_NAME}Editor" Linux Development "${UBTARGS[@]}" -NoEngineChanges \
    > "$VUE_OUT/logs/build_editor.log" 2>&1 || { tail -30 "$VUE_OUT/logs/build_editor.log"; die "editor build (log: $VUE_OUT/logs/build_editor.log)"; }
fi
for c in "${CONFIGS[@]}"; do
  say "game target $VUE_NAME ($c)"
  timed "build-$c" uenv nice -n 10 "$UBT" "$VUE_NAME" Linux "$c" "${UBTARGS[@]}" \
    > "$VUE_OUT/logs/build_$c.log" 2>&1 || { tail -30 "$VUE_OUT/logs/build_$c.log"; die "$c build (log: $VUE_OUT/logs/build_$c.log)"; }
  bin="$(dirname "$VUE_PROJECT")/Binaries/Linux/$VUE_NAME$([ "$c" = Development ] || echo "-Linux-$c")"
  [ -x "$bin" ] && say "  $(basename "$bin"): $(du -h "$bin" | cut -f1)" || say "  (binary not found at $bin)"
done
say "done"
