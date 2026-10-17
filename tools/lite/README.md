# The light showcase build (Hugging Face Space)

A small, static build of the client for ordinary computers: the trailer's camera moves played live in a curated tour of
Central Park, Harlem's 125th Street, Columbia and Midtown, and a menu (Esc, the Menu button or a gamepad's Start) that
sets the mode (Tour, Walk, Drone, Drive), the place, the time of day and the quality. Only the tiles a visitor can reach
and the assets the trace saw requested are shipped, with textures downsized for 2020-era graphics cards.

```
node tools/lite/build_lite.mjs --out <dir>                                  # client + reachable tiles
GPU_LANE=34 node tools/withgpu.mjs lite -- node tools/lite/trace_lite.mjs --out <dir> --fallback --modes   # list the assets the tour and the modes use
node tools/lite/build_lite.mjs --out <dir> --assets <dir>/../trace.txt --trailer <trailer.mp4>
python3 tools/lite/ktx_shrink.py <dir>                                      # textures to 512/1024 px (needs basisu)
node tools/lite/sizes.mjs <dir>                                             # every file's size, for the loader's progress (after the shrink)
GPU_LANE=34 node tools/withgpu.mjs lite -- node tools/lite/trace_lite.mjs --out <dir> --modes             # the final check: no 404s, every scene and mode plays
GPU_LANE=34 node tools/withgpu.mjs lite -- node tools/lite/live_check.mjs --dir <dir> --redirect          # the six checks (the throttle check behind cross-origin redirects, as on the Space)
GPU_LANE=34 node tools/withgpu.mjs lite -- node tools/lite/tour_mem.mjs 20 --dir <dir> [--session places] # the browser's memory over the tour, or every place in each mode
```

The loader counts the bytes of each finished request at its size in `sizes.json`: on the published Space the large files
are LFS redirects to a CDN on another origin that sends no Timing-Allow-Origin, so Resource Timing reports their sizes as 0.

The scenes and the places of the menu are in `build_lite.mjs` (`SCENES` from `tools/ad/shots.json`, `PLACES`: where Walk,
Drone and Drive start and the disc each may roam; the tiles within the near radius of every point of a disc ship); the
light settings are `QUERY` (pixel ratio, shadow map, near and far radii, walker and vehicle sets). `--modes` makes the trace
fly the drone over each place's disc at two heights, walk and drive there, and switch the time of day, so the asset list
covers what the modes can reach. In the client, `client/src/game/showcase.js` is the tour, the modes and the input,
`showcaseUI.js` the interface and `drone.js` the quadcopter; Walk and Drive are `game/control.js`'s play controller.
