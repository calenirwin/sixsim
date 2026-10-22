# 510 Spadina: pinned offline GTFS experiment

Service day **2026-10-22**, timezone **America/Toronto**, TTC merged feed version **S1000542** (September 30–October 31, 2026). This is a historical schedule snapshot, not a promise of current service, a realtime feed or vehicle tracking.

The feed lists 510 Spadina as route type 0 (streetcar). It passes the Queen/Spadina massing crop and provides a bounded first corridor. All 378 active trips for the day, 34 scheduled stops plus two referenced parent stations, 5,984 stop-time rows and seven shapes (1,553 points) are retained, including short turns and waterfront branches. No inferred rail network, basemap or vehicle identity is supplied. Latest stop departure is 25:47:00 on the selected service day.

## Source and permissions

- [Official merged GTFS catalogue](https://open.toronto.ca/dataset/merged-gtfs-ttc-routes-and-schedules/)
- [Official metadata API](https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=merged-gtfs-ttc-routes-and-schedules)
- [Open Government Licence – Toronto](https://open.toronto.ca/open-data-licence/)
- Exact resource URL, retrieval timestamp, SHA-256 and subset hash: [provenance.json](provenance.json).

Contains information licensed under the Open Government Licence – Toronto.

The official catalogue presents this licence, which permits use/adaptation/redistribution subject to conditions and exemptions. CKAN nevertheless reports `license_id=notspecified` and `isopen=false`. This conflict is preserved in provenance, not presented as City-confirmed clearance. No additional click-through agreement or credential was encountered or accepted. No TTC/City endorsement. The importer is covered by the repository's code licence; that does not replace the data terms.

The public ZIP was 84,337,545 bytes (download capped at 100 MB). Its uncompressed tables total approximately 432 MB; extraction streams CSV rows without expanding the archive or loading all stop times into memory. The archive is ignored under `client/data/toronto/`, not redistributed in Git. No future network fetch is required to build or run the checked-in slice.

## Reproduce

With the exact archive already available locally, from the repository root:

```sh
python3 client/tools/transit/extract.py client/data/toronto/completegtfs.zip
npm --prefix client run test:transit
npm --prefix client run build:toronto
```

Open `corridor.html` from an ordinary server serving `client/dist-toronto/`, or run the existing Toronto dev command and navigate to `/corridor.html`. The adjacent massing page links to it. The extractor defaults to the pinned route/day, sorts rows deterministically and records the archive hash. A replaced archive at the same URL is a new version: do not overwrite provenance or interpret it as a reproducible copy of this snapshot.

`calendar` date ranges and weekdays are evaluated first; `calendar_dates` additions/removals override them, including exception-only services. Selected trips retain their route/service/shape IDs. Source exception rows are retained as context even when no selected trip uses that service; this is a derived JSON study fixture, not a complete redistributable GTFS feed. UTF-8 CSV parsing uses the Python standard library, including quoted fields. Source tables are preserved as records rather than inferred geometry.

## Playback contract and limitations

The view uses the same explicit local metric frame as the massing study. Published shape distances and stop-time distances share the feed's distance units; no conversion to seconds or assumption that those units are metres is made. Between scheduled departure and next arrival, distance advances linearly along the shape; at a scheduled dwell it stays at the stop's shape distance. This is a visualization assumption, not observed speed. `timepoint=0` times remain provider-estimated schedule times. Missing/invalid shape-distance associations omit a trip from playback with a visible count; they are never replaced by invented lines.

Times are seconds from the GTFS service-day origin and displayed as service-hour notation (including 24+). This experiment does not convert service times to wall-clock UTC instants or resolve DST-transition service days; its chosen day has no DST transition. Trips from adjacent service days are not combined into a complete wall-clock fleet view. Direction controls expose GTFS direction IDs, not an assumption that every branch shares one compass heading. Stop hover labels show published names. Rendering is north-up and flat, with a box marking the existing building crop.

The combined static package is about 2.44 MB uncompressed, mostly the 1.77 MB schedule subset (~91 KB gzip). The total package ceiling increases from 800 KB to 2.6 MB for this explicit addition; JavaScript and binary-tile ceilings remain unchanged. The massing entry does not fetch the schedule JSON. Both pages use relative paths, require no backend or credentials and are tested under `/sixsim/`. No deployment was performed.

Tests cover calendar exceptions, CSV quoting, missing shapes, monotonic times, source hashes, route/service references, coordinate alignment, midnight/dwell/interpolation, deterministic extraction, browser playback/direction, subpaths and failure/recovery. Full-archive byte-for-byte reproduction is a local check; CI uses the small fixture and synthetic parser tests, never downloads the archive.

Next: review the selected route/day against TTC source interpretation, then add a small licensed street/walkway graph and accessible transfers. Live BusTime would require the separately specified surface GTFS identifiers and access review; this merged static feed does not establish their compatibility.
