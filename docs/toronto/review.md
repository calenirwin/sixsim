# Review checkpoint: one Toronto streetcar corridor

The working name **SixSim is provisional**. This checkpoint asks for a review of the corridor and proposed direction, not a naming decision or deployment approval. It combines the pinned 510 Spadina schedule study, source evidence and a short Toronto roadmap in one locally runnable page.

## Open the review

On the current draft PR branch, with Node 24, run from the repository root:

```sh
npm ci --ignore-scripts
npm --prefix client ci --ignore-scripts
npm --prefix client run review:toronto
```

Open `http://127.0.0.1:5219/corridor.html` if the browser does not open automatically. No data download, credentials or backend is required. The checked-in subset is sufficient. Use the massing-study link to inspect the existing real building crop separately.

For ordinary static serving:

```sh
npm --prefix client run build:toronto
python3 -m http.server 8000 --bind 127.0.0.1 --directory client/dist-toronto
```

Then open `http://127.0.0.1:8000/corridor.html`. This starts a local server only; it does not publish anything.

## Five-minute review

1. At 08:00, play the schedule and switch between northbound and southbound trips. Orange dots are **schedule-derived positions, not observed vehicles**.
2. Focus on Queen/Spadina, then select a stop from the touch/keyboard-friendly list or tap its map ring. Return to the whole route to see the waterfront branches.
3. Choose 25:00. Those trips belong to the selected October 22 service day, although the service-hour notation extends past midnight.
4. Read the adjacent “From one corridor to Toronto” panel. It distinguishes the current prototype, the next experiment and the longer-term proposal.
5. Open the source/provenance links and the massing study if a claim or location needs closer inspection.

## Sources, attribution and limits

The pinned TTC merged GTFS slice contains 378 trips, 34 scheduled stops, two parent stations and seven shapes for October 22, 2026. Published shapes/stops and schedule times are source records; movement between stops is interpolation. The City portal links the Open Government Licence – Toronto while CKAN says the licence is not specified. The conflict remains documented, not City-confirmed. Contains information licensed under the Open Government Licence – Toronto. Source hashes, retrieval date and exact resource are retained with the [fixture documentation](https://github.com/calenirwin/sixsim/blob/pilot/toronto-readiness/client/fixtures/transit/README.md).

The separate massing crop contains 15 City records. Neither study is a complete city, measured traffic simulation, surveyed track model or live feed. Adjacent-day aggregation and DST-transition conversion are not implemented. Original Valdrada copyright and attribution remain intact; [component licensing](../licensing.md) is separate from Toronto data terms. Renaming the display does not rename data IDs: the two Toronto entries share `client/src/toronto/identity.js` for the provisional display name.

## Recommended next data increment

Add a **bounded Toronto Centreline road/walkway crop around Queen/Spadina**, then assess sidewalk-inventory evidence for crossings and access. Keep it separate from GTFS: the centreline is a transport reference, not proof that every segment is walkable or that grade-separated lines connect. Verify feature classes, coordinates, topology and source terms before integration. The sidewalk inventory’s older imagery and possible centreline mismatch require explicit checks. This would connect the current stop and building studies to a concrete pedestrian-access question without needing live feeds or citywide processing. See the [source register](data-sources.md) for primary URLs and open questions.

## Review evidence

Open the inspected review snapshots directly: [desktop, 1440 px](review-desktop.png) · [mobile, 390 px](review-mobile.png). These capture the implemented review controls and preserve the on-page attribution. CI also regenerates screenshots from the current commit.

`npm --prefix client run test:transit:browser` builds the static package and generates these files under `client/shots/` (Chromium required):

- `toronto-review-desktop.png` — 1440-pixel desktop layout, stop selected, direction/source context visible.
- `toronto-review-mobile.png` — 390-pixel touch layout, with the same data and review context.

CI uploads them in `fixture-screenshots` and the runnable package in `toronto-static-demo`. Tests cover both mount paths, touch controls, stop selection, readable directions, crop/route views, presets, horizontal overflow, playback and failure/omission states. The final handoff identifies the exact commit and CI artifacts; screenshots are not a public deployment.

No material decision blocks the next bounded experiment. Feedback on whether stop-to-street access is the most useful next review target is welcome, but is not required to run this checkpoint.
