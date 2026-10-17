#!/usr/bin/bash
# R1C (lane C, 2026-10-10): one UE take for the round's spikes on GPU 0 (PCI 01), the trailer's sharp flags with the
# samples and AA given per variant. Usage:
#   r1c_take.sh <usd root> <work dir> <out dir> <log> [extra ue_take.py flags...]
# Environment passes through (BXUE_AA, BXUE_TAKENAME, BXTREES_ASSETS, ...).
set -u
source /data0/projectnyc_aux/env.sh
export DRI_PRIME=pci-0000_01_00_0
USD=$1; WORK=$2; OUT=$3; LOG=$4; shift 4
X=/data0/projectnyc/client/tools/ar34/export
SHARP="--mblur 0.25 --treewind 0.5 --fstop 8 --cvar r.Tonemapper.Sharpen=0.5 --cvar r.ViewDistanceScale=4 --cvar r.StaticMeshLODDistanceScale=0.25 --cvar foliage.LODDistanceScale=4 --cvar r.Nanite.MaxPixelsPerEdge=0.5"
echo "### $(date '+%F %T') r1c_take $USD -> $OUT ($*)" >> $LOG
python3 $X/ue_take.py --usd $USD --work $WORK --outdir $OUT --res 2560x1440 --gpu 0 --cine $SHARP "$@" >> $LOG 2>&1
echo "### $(date '+%F %T') exit $?" >> $LOG
