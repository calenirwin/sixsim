# The light showcase build (Hugging Face Space)

A small, static build of the client for ordinary computers: the trailer's camera moves played live in a curated tour of
Central Park, Harlem's 125th Street, Columbia and Midtown, with an Explore mode. Only the tiles each scene can see and
the assets the tour requests are shipped, with textures downsized for 2020-era graphics cards.

```
node tools/lite/build_lite.mjs --out <dir>                                  # client + scene tiles
GPU_LANE=34 node tools/withgpu.mjs lite -- node tools/lite/trace_lite.mjs --out <dir> --fallback   # list the assets the tour uses
node tools/lite/build_lite.mjs --out <dir> --assets <dir>/../trace.txt --trailer <trailer.mp4>
python3 tools/lite/ktx_shrink.py <dir>                                      # textures to 512/1024 px (needs basisu)
GPU_LANE=34 node tools/withgpu.mjs lite -- node tools/lite/trace_lite.mjs --out <dir>              # the final check: no 404s, every scene plays
```

The scenes are in `build_lite.mjs` (`SCENES`, from `tools/ad/shots.json`); the light settings are `QUERY` (pixel ratio,
shadow map, near and far radii, walker and vehicle sets). `client/src/game/showcase.js` is the tour and its interface.
