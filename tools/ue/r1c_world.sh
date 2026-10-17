#!/usr/bin/bash
# R1C (lane C, 2026-10-11): a take's persistent world end to end, as run for the round's proof: every cell lane A baked for
# the take's load set (UV data packed, embedded images stripped, four batch levels imported in parallel and joined as
# streaming levels), the load set's far chunks and landmarks masked under the cells, materials by key from imported takes,
# the shell master, lane D's actor layers into a sublevel, lane D's light pass, the render (one retry on a GPU fault).
#   R1C_WORK=<work dir> tools/ue/r1c_world.sh <shot> <night 0|1> <take=prep json,...> <run.json> <lane A plain dir> [batches]
# Needs <work>/lscells_<shot>/src (the load set's 16 cells) and <work>/ls_<shot> (tools/ue/r1c_plain.mjs).
set -u
S=$1; NIGHT=$2; LIBS=$3; RUN=$4; NEWDIR=$5; NB=${6:-4}
source /data0/projectnyc_aux/env.sh
cd /data0/projectnyc
T=${R1C_WORK:-/data0/projectnyc_aux/tmp/r1c}
D=/data0/projectnyc_aux/cellcache/takes/$S/usd
W=/Game/R1C/W6_$S
L=$T/w6_$S.log
echo "### $(date '+%F %T') start" >> $L
mkdir -p $T/w6cells_$S/src
for f in $T/lscells_$S/src/*.glb $NEWDIR/*.glb; do [ -e "$f" ] && ln -sf $(readlink -f $f) $T/w6cells_$S/src/$(basename $f); done
uv run --no-project --with numpy python tools/ue/r1c_glbuv.py --strip-images --src $T/w6cells_$S/src --dst $T/w6cells_$S/uv >> $L 2>&1
N=$(ls $T/w6cells_$S/uv/*.glb | wc -l); echo "### $(date '+%F %T') $N cells packed" >> $L
i=0; for f in $(ls $T/w6cells_$S/uv/*.glb); do b=$((i % NB)); mkdir -p $T/w6cells_$S/b$b; ln -sf $f $T/w6cells_$S/b$b/$(basename $f); i=$((i+1)); done
uv run --no-project --with numpy python tools/ue/r1c_lodprep.py --loadset /data0/projectnyc_aux/cellcache/takes/$S/loadset.json --mask-dir $T/w6cells_$S/uv --src $T/ls_$S --dst $T/w6far_$S >> $L 2>&1
pids=""
for b in $(seq 0 $((NB-1))); do
  uv run --no-project --with numpy python tools/ue/r1c_cells.py --cells $T/w6cells_$S/b$b --level $W/L_cells_$b --dest $W/C$b --tree-from /Game/Takes/r1c_scLakeGolden,/Game/Takes/r1c_scBowGolden,/Game/Takes/r1c_tuApolloSweep --out $T/w6cellsimp_${S}_$b >> $L.b$b 2>&1 &
  pids="$pids $!"
done
uv run --no-project --with numpy python tools/ue/r1c_cells.py --cells $T/w6far_$S --level $W/L_$S --dest /Game/R1C/W6F_$S --out $T/w6farimp_$S >> $L.far 2>&1 &
pids="$pids $!"
wait $pids
echo "### $(date '+%F %T') cells and far done" >> $L
LV=$(for b in $(seq 0 $((NB-1))); do printf "%s/L_cells_%s," $W $b; done); LV=${LV%,}
python3 tools/ue/r1c_addlevels.py --world-level $W/L_$S --levels $LV --out $T/w6add_$S >> $L 2>&1
TK=""; for l in ${LIBS//,/ }; do TK="$TK --take $l"; done
python3 tools/ue/r1c_cellmat.py --keep-switches --hide cpr34:contact --hide-generated-alpha --world-dest $W --cells $T/w6cells_$S/uv $TK --out $T/w6mat_$S >> $L 2>&1 &
python3 tools/ue/r1c_lodmat.py --dest /Game/R1C/W6F_$S --fw14 /data0/projectnyc_aux/cellcache/tex/daab9257ff80ba32fbedb2bd.png --night $NIGHT --wink 3 --out $T/w6lodmat_$S >> $L 2>&1 &
wait
echo "### $(date '+%F %T') materials done" >> $L
uv run --no-project --with usd-core --with numpy python tools/ue/r1c_actors.py --norender --world-level $W/L_$S --shot $S --tag _f --template $D/$S.usda --layers $D/cam_$S.usda,$D/mov_$S.usdc,$D/peds_$S.usdc,$D/looks.usdc,$D/geo.usdc --run $T/scLakeGolden/ue/run.json --out $T/w6act_$S >> $L 2>&1
echo "### $(date '+%F %T') actors done" >> $L
python3 tools/ue/r1c_relight.py --world-level $W/L_$S --sublevel L_act_${S}_f --side $T/w6act_$S/prep/ue_$S.json --light-harvest /data0/projectnyc_aux/cellcache/takes/$S/harvest --light-side $T/w6act_$S/prep/ue_$S.json --run $RUN --dest /Game/R1C/Light/${S}_f --out $T/w6light_$S >> $L 2>&1
echo "### $(date '+%F %T') light done" >> $L
for try in 1 2; do
  uv run --no-project --with usd-core --with numpy python tools/ue/r1c_actors.py --stage render --world-level $W/L_$S --shot $S --tag _f --template $D/$S.usda --layers $D/cam_$S.usda,$D/mov_$S.usdc,$D/peds_$S.usdc,$D/looks.usdc,$D/geo.usdc --run $T/scLakeGolden/ue/run.json --out $T/w6act_$S >> $L 2>&1
  grep -q '"render_exit": 0' $T/w6act_$S/actors.json && break
  echo "### $(date '+%F %T') render try $try failed" >> $L
done
echo "### $(date '+%F %T') CHAIN_DONE" >> $L
