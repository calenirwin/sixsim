# Explore Toronto's Spadina district

Toronto's public records can form the starting point for a city simulation: buildings give it spatial context, streets describe connections, and transit schedules give movement a clock. This project brings those layers into the existing Valdrada framework, with the aim of testing urban mobility scenarios while keeping source observations separate from modeled behavior.

![Toronto source buildings and scheduled transit in the main browser renderer](demo.jpg)

The browser uses the same tiled geometry, geographic frame and recorded actors as the headless world. It is a lightweight way to explore the model; it does not connect to a live transit feed or a hosted simulation server.

## A two-minute walkthrough

1. Open the main application using the instructions below. Choose **Queen & Spadina** to focus on the district. Drag to orbit, right-drag or use two fingers to pan, and scroll/pinch to zoom.
2. Watch the orange scheduled-trip symbols. Grey lines are City centrelines, ochre lines are GTFS service paths, blue points are stops, and teal links show occupied directed service links.
3. **Pause** and move the **Playback time** slider from 0 to 120 seconds. The slider pauses playback so that positions and occupancy can be inspected at a fixed time. Arrow keys move it by one second. **Restart** returns to the beginning.
4. Seek to **70 seconds** and choose **+60s dwell experiment** under **Recording**. Switching pauses at the same time and preserves the camera. Choose **Focus comparison trip**: the targeted trip holds at Willcocks Street while its baseline counterpart is already on a service link. Switch back to **Published timetable** to compare. The readout reports graph phase and modeled departure deviation; other trips are unchanged.
5. Open **About & sources** for coverage, controls, source attribution and the distinction between measured records and modeled positions. Close it or press Escape to return to the city.

The recording runs from 08:00 to 08:05 on the pinned **2026-10-22 service day**, in **America/Toronto**. It stops after five minutes. The source timetable includes service times after 24:00, even though this short recording shows the morning.

## What the model contains

| Layer | Included | Boundary |
| --- | --- | --- |
| Buildings | 5,587 City massing records, 5,774 polygon parts, 29 streamed tiles | About 5.14 km² around Spadina; source heights on flat ground, not complete Toronto or detailed facades |
| Streets | 1,589 City centreline segments and intersection identifiers | Source context, not a lane or walkable-routing model |
| Transit context | Paths and 81 stops for 501, 505, 506 and 510 | GTFS geometry, not surveyed tracks |
| Moving transit | 378 route-510 trips across seven validated service patterns | Scheduled symbolic positions, not observed vehicles or interacting traffic |
| Experiment | One fixed +60-second stop dwell propagated downstream | An explicit what-if input, without recovery, passenger, signal or collision modeling |

The moving route continues beyond the building crop. The absence of a building tile beyond that crop is not evidence that a location is empty.

## Run the existing application

With Node 24, from the repository root:

```sh
npm ci --ignore-scripts
npm --prefix client ci --ignore-scripts
npm --prefix client run dev:city
```

Open the URL printed by Vite with `?city=toronto`. This regenerates the five-minute recording from the inherited world and opens its main renderer; no bulk data download, new credentials or backend is needed.

The selector uses two world-generated recordings included in the static package. A failed or incompatible load retains the previous recording and displays an error. The comparison is finite playback, not a live connection to the API.

To choose a different valid build-time scenario as the initial recording:

```sh
TORONTO_TRANSIT_SCENARIO=tools/toronto/scenarios/510-stop-dwell.json npm --prefix client run dev:city
```

The included comparison scenario adds 60 seconds at Spadina Avenue / Willcocks Street for one specified trip. It is labeled in the clock and source panel. Willcocks is within the Spadina district building crop. Other trips remain unchanged. See [the scenario contract](vision.md#fixed-extra-dwell-experiment) for exact inputs, timing and API access.

## A personal project page and a static Space

A useful presentation pairs this explanation and a Toronto screenshot with the interactive application. Link to the model and its sources rather than implying the whole upstream NYC feature set has been ported. The project follows [Valdrada's personal-site project page](https://mehmetkeremturkcan.com/valdrada/) and [static Space](https://huggingface.co/spaces/mehmetkeremturkcan/valdrada) as a presentation pattern; Toronto has different data and capability boundaries.

Build the precompiled static Space package:

```sh
npm --prefix client run build:space
python3 -m http.server 8000 --bind 127.0.0.1 --directory client/dist-space
```

Open `http://127.0.0.1:8000/`. The directory contains the same main application, relative asset URLs, a Space card (`sdk: static`, `app_file: index.html`), source provenance and licence notices. It needs WebGL2 on the visitor's device, not server compute or an external asset CDN. The existing GitHub Pages build remains separate and keeps its `/sixsim/` base path.

[Hugging Face's static SDK documentation](https://huggingface.co/docs/hub/spaces-sdks-static) describes free static serving without a compute instance. Preparing this directory does not create or publish a Space. Release requires an authorized Space owner/name, the owner's account access and approval to upload this package. No credentials are needed to build or inspect it locally. Host-specific behavior remains unverified until an authorized deployment is tested.

For a personal blog, use this page's explanation and screenshot, then link to the approved app URL. An optional iframe should use the actual URL supplied by the hosting platform, retain a descriptive title and a direct-link fallback, and be tested on mobile. See the [official embedding guide](https://huggingface.co/docs/hub/spaces-embed). No personal-site repository change is needed to prepare the app package.

## Sources and credit

The Toronto adaptation is maintained by Calen Irwin; **SixSim is a working name**. The simulation framework is [Valdrada](https://github.com/mkturkcan/valdrada), by Mehmet Kerem Turkcan, with its original copyright and licence preserved.

Contains information licensed under the Open Government Licence – Toronto. City building massing and centreline records and TTC GTFS retain source URLs, retrieval dates, checksums and transformation details in the [source register](data-sources.md). The register records the conflicting CKAN licence metadata alongside the official licence evidence; no City clarification or endorsement is implied. Code, documentation and source data have separate [licensing terms](../licensing.md).

Next development layers are explained in the [architecture and roadmap](vision.md): richer network topology, explicit behavioral assumptions and comparisons of reproducible scenarios. Photorealistic NYC footage, upstream sensors, traffic interaction and full-city coverage should not be presented as Toronto results.

### Downstream departures

Open **Downstream departures & gaps** in the main renderer. The table compares the timetable with the selected recording at Willcocks, College and Nassau for trip `122948020`. Choosing the +60-second experiment moves its Willcocks departure from 08:00:36 to 08:01:36 and increases its gap behind trip `41623020` from 720 to 780 seconds. Selecting the timetable restores the baseline values. These events describe the full pinned service-day schedule and do not advance with the five-minute playback cursor; a departure can lie beyond the recording window.

A gap is measured from the chronologically preceding departure at the same directed GTFS pattern and stop occurrence. It excludes other patterns, directions and service days; it is not route-wide headway, passenger waiting time or observed reliability. Equal departures use trip-ID order deterministically and can have a zero gap. No predecessor is shown as —, without wrapping to yesterday. Times retain hours beyond 24:00 in America/Toronto service-day notation. This is a schedule perturbation without vehicle conflicts or recovery.

Each stop also lists the chronologically following trip and its departure beside the target. At Willcocks, following trip `18005020` departs at 08:12:36 in both recordings, while its gap after the target changes from 720 to 660 seconds. The target's own gap from its predecessor grows to 780 seconds. These are temporal gaps at a stop, not spatial separation or a simulated response by the following vehicle. Following IDs are chosen independently in each recording and may differ if departure order changes; the final departure has no following trip, without wrapping to the next service day.

### District navigation and appearance

Use **Harbord & Spadina** to inspect the northern extension, then **Queen & Spadina** to return to the transit comparison. Panning streams the same 512 m source tiles; near detail remains bounded around the camera target, with no invented far-city buildings. The crop is 5.14 km², not all of Toronto. Original procedural window patterns, palette and flat ground texture improve depth and surface readability but do not represent measured facades, floor counts or terrain. Source heights, footprints and holes remain unchanged.

### Official green-space designations

Use **Grange Park** to focus a named source polygon, and **Green-space designations: on/off** to compare against the neutral ground. The overlay contains 44 generalized City park/open-space records clipped to the same district. Green represents Park/Open Green Space, tan represents civic squares and grey represents other designations. Colours are illustrative: a designation can contain paving or private land and does not establish vegetation or public access. Source holes and boundaries are retained, with district-edge clipping explicitly recorded. The ground remains flat; transit and routing behavior are unchanged.

### Historical classified cover

At **Grange Park**, enable **2018 classified cover** to compare mapped canopy, grass, shrub and impervious classes with the surrounding buildings and streets. Expand the class legend for colours and limits. This replaces the green-space designation overlay; toggling it off restores the neutral ground, while selecting designations restores that separate layer. The 512 × 640 display grid samples the City's 2018 classification at approximately 4 m. Canopy can obscure streets and other ground surfaces. Source dates differ from the building and designation layers; colours are illustrative, elevation remains flat, and no current vegetation, public access or physical traffic parameters are inferred. Both recordings use the same source context.

### Municipal elevation

Select **City terrain · 2023** to inspect the municipal bare-earth surface in the same renderer. Overview shows the full boundary at 512 m display spacing; Etobicoke, North York and Scarborough controls select bounded 64 m near patches. These are display resolutions, not the original LiDAR resolution. Colours indicate elevation, not vegetation. CGVD2013 heights retain true vertical scale. Missing cells are not filled.

The district recording pauses and its flat geometry is hidden while inspecting terrain. **Return to district simulation** restores the previous camera and recording position. Terrain does not imply citywide buildings, cover, routing or transit interactions; their coverage is unchanged. Mobile evidence from automated checks represents resized desktop Chromium with touch, not native iOS/Android performance.
