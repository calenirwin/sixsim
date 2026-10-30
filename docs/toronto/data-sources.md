# Toronto data-source register

Source evidence and retrieval dates are recorded per resource. “Catalogue verified” means official metadata was read; it does not imply that an archive was downloaded, parsed or integrated. The included inputs are Spadina district massing, Toronto Centreline and route 510 schedules, with 501/505/506/510 path-and-stop context for a pinned service day; see the [transit provenance](https://github.com/calenirwin/sixsim/blob/pilot/toronto-readiness/client/fixtures/transit/provenance.json). No live feed is configured.

For City entries below, the primary catalogue and CKAN metadata links identify the exact source. Catalogue pages present the [Open Government Licence – Toronto](https://open.toronto.ca/open-data-licence/); metadata fields can be missing or contradictory. Before adding a source, retain its specific terms and exemptions, attribution and resource evidence. The licence permits adaptation and redistribution subject to its conditions, excludes rights the City cannot grant and does not imply endorsement. Use the required notice: **Contains information licensed under the Open Government Licence – Toronto.** Do not treat all Toronto-related data as City-licensed.

Public catalogue/API metadata was accessible without credentials. Resource access, authentication, quotas and service availability are **not established by that observation**; no rate limit or unlimited-use permission is assumed. Unless stated otherwise, download sizes and exact resource CRS remain to be checked before acquisition. Bulk sources belong in ignored local storage, not Git; small fixtures need source URL/date/hash, extent, transformation and licence evidence. Derived outputs must retain that lineage and applicable terms. Metadata refresh dates are not observation dates.

## Massing licence evidence

The [official massing page](https://open.toronto.ca/dataset/3d-massing/) presents the Toronto licence link. The [dataset API](https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=3d-massing) notes explicitly refer to the Open Government Licence and restrict the model’s suitability to illustrative information, requiring verification for official uses. However, on the audit date its structured fields remain `license_id: notspecified`, `license_title: License not specified`, `isopen: false`. These fields have **not** been corrected or confirmed by the City.

The existing subset relies on the affirmative official portal and dataset-note evidence, preserves attribution and records the conflict. This is a documented interpretation, not a legal assurance or written City confirmation. Do not silently extend it to third-party content or broader redistribution when additional restrictions emerge. The [sample provenance](https://github.com/calenirwin/sixsim/blob/pilot/toronto-readiness/client/fixtures/toronto/provenance.json) pins resource `667237d6-4d3c-4cf3-8cb7-e91c48d59375`, source checksum, crop and conversion. The 2025 archive filename does not establish that all underlying measurements are from 2025. No MPAC data or OSM geometry was added to this subset.

## City source records

### 3D Massing

[Official catalogue](https://open.toronto.ca/dataset/3d-massing/) · [Official metadata](https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=3d-massing)

| Field | Record |
|---|---|
| Owner / geography | City of Toronto — City Planning; Toronto |
| Status | Integrated bounded subset |
| Format / coordinates | SHP archive; actual .prj Web Mercator metres despite WGS84 filename; converted to EPSG:4326, then local east/up/south metres. Heights are AVG_HEIGHT, not terrain elevations. |
| Update evidence | Catalogue cadence: Annually; last refresh: 2025-12-05 13:38:35. These describe publication, not accuracy or measurement date. |
| Terms / attribution / redistribution | Toronto portal licence evidence as above; CKAN licence: License not specified, id: notspecified. Preserve source-specific limitations; verify selected resource terms before redistribution. |
| Access / quotas | Public metadata read without authentication; resource/service requirements and quotas not verified. No credential supplied or requested. |
| Source versus derived storage | Pinned 81,415,175-byte archive outside Git; 5,587 source records / 5,774 polygon parts in district GeoJSON; 29 CTL1 tiles derived during build. The original 15-record regression fixture is retained. |
| Next integration step | Validate elevations and source updates before increasing detail. Provenance lists 126 boundary exclusions, one invalid geometry and one tiny-ring record; no repair or clipping. |

### Toronto Centreline (TCL)

[Official catalogue](https://open.toronto.ca/dataset/toronto-centreline-tcl/) · [Official metadata](https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=toronto-centreline-tcl)

| Field | Record |
|---|---|
| Owner / geography | City of Toronto — Information & Technology; Toronto |
| Status | Integrated district source connectivity: 1,589 segments, official intersection IDs; not a lane-routing model |
| Format / coordinates | Pinned 4326 GeoPackage; EPSG:4326 verified from gpkg_geometry_columns. Whole intersecting features retained for road/rail classes 201100–202002 and trail/walkway classes 204001/204002. |
| Update evidence | Catalogue cadence: Daily; selected resource modified 2026-10-22T18:15:12.599704, retrieved 2026-10-23. These describe publication, not accuracy or measurement date. |
| Terms / attribution / redistribution | Toronto portal licence evidence as above; CKAN licence: missing, id: missing. Preserve source-specific limitations; verify selected resource terms before redistribution. |
| Access / quotas | Public metadata read without authentication; resource/service requirements and quotas not verified. No credential supplied or requested. |
| Source versus derived storage | 29,511,680-byte GPKG retained outside Git. Pinned archive SHA and URL, selected GeoJSON and provenance tracked under client/fixtures/toronto/. Source lines are not clipped; boundary endpoints can extend outside the building crop. |
| Next integration step | Validate direction semantics, grade separation, legal turns, lanes and crossing/transfer links before enabling traffic routing. Do not infer tracks from centreline proximity. |

### Sidewalk Inventory

[Official catalogue](https://open.toronto.ca/dataset/sidewalk-inventory/) · [Official metadata](https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=sidewalk-inventory)

| Field | Record |
|---|---|
| Owner / geography | City of Toronto — Transportation Services; Toronto |
| Status | Catalogue verified, not imported |
| Format / coordinates | SHP/ZIP; CRS must be read from selected .prj. Inventory uses 2015 imagery and may use an older centreline. |
| Update evidence | Catalogue cadence: As available; last refresh: 2019-07-23 17:59:24.7985. These describe publication, not accuracy or measurement date. |
| Terms / attribution / redistribution | Toronto portal licence evidence as above; CKAN licence: open-government-licence-toronto, id: open-government-licence-toronto. Preserve source-specific limitations; verify selected resource terms before redistribution. |
| Access / quotas | Public metadata read without authentication; resource/service requirements and quotas not verified. No credential supplied or requested. |
| Source versus derived storage | Cache selected original and licence evidence; derive presence/access attributes separately from centreline geometry. |
| Next integration step | Check age, correspondence and crossings; sidewalk presence alone does not prove a routable pedestrian network. |

### Triangular Irregular Network (TIN)

[Official catalogue](https://open.toronto.ca/dataset/triangular-irregular-network-tin/) · [Official metadata](https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=triangular-irregular-network-tin)

| Field | Record |
|---|---|
| Owner / geography | City of Toronto — Information & Technology; Toronto |
| Status | Catalogue verified, not imported |
| Format / coordinates | SHP polygons from 2023 LiDAR-derived 2.5 m bare-earth source; horizontal EPSG:2952; vertical CGVD2013. |
| Update evidence | Catalogue cadence: As available; last refresh: 2024-09-04 19:27:22. These describe publication, not accuracy or measurement date. |
| Terms / attribution / redistribution | Toronto portal licence evidence as above; CKAN licence: License not specified, id: notspecified. Preserve source-specific limitations; verify selected resource terms before redistribution. |
| Access / quotas | Public metadata read without authentication; resource/service requirements and quotas not verified. No credential supplied or requested. |
| Source versus derived storage | Do not fetch citywide archive by default; first establish small extract availability and size. Keep source elevation separate from building height. |
| Next integration step | Confirm vertex elevation representation versus polygon Avg_Elev before terrain reconstruction; reconcile vertical datum. |

### Merged GTFS - TTC Routes and Schedules

[Official catalogue](https://open.toronto.ca/dataset/merged-gtfs-ttc-routes-and-schedules/) · [Official metadata](https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=merged-gtfs-ttc-routes-and-schedules)

| Field | Record |
|---|---|
| Owner / geography | City of Toronto — Toronto Transit Commission; Toronto |
| Status | Integrated: route 510, service day 2026-10-22; 378 trips, 34 scheduled stops plus two parent stations, seven shapes. District context additionally retains 25 clipped service paths and 81 stops across routes 501/505/506/510; these do not add moving actors |
| Format / coordinates | GTFS ZIP, all subway/streetcar/bus modes. GTFS geographic coordinates are WGS84; verify agency timezone and service calendars in archive. |
| Update evidence | Catalogue cadence: Quarterly; last refresh: 2026-09-30 14:17:52. These describe publication, not accuracy or measurement date. |
| Terms / attribution / redistribution | Toronto portal licence evidence as above; CKAN licence: License not specified, id: notspecified. Preserve source-specific limitations; verify selected resource terms before redistribution. |
| Access / quotas | Public metadata read without authentication; 84.3 MB public archive downloaded without credentials under a 100 MB cap; quotas not established. No live service accessed. |
| Source versus derived storage | Pin one schedule snapshot/checksum outside Git; retain a small relationally complete route/day fixture only after terms check. |
| Next integration step | Prefer this for offline all-mode planning; validate stops, shapes, trips, calendars and times beyond 24:00. |

### TTC Routes and Schedules

[Official catalogue](https://open.toronto.ca/dataset/ttc-routes-and-schedules/) · [Official metadata](https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=ttc-routes-and-schedules)

| Field | Record |
|---|---|
| Owner / geography | City of Toronto — Toronto Transit Commission; Toronto |
| Status | Legacy catalogue, not preferred |
| Format / coordinates | GTFS ZIP; description points to new merged all-mode dataset. |
| Update evidence | Catalogue cadence: Monthly; last refresh: 2026-09-25 14:08:04. These describe publication, not accuracy or measurement date. |
| Terms / attribution / redistribution | Toronto portal licence evidence as above; CKAN licence: License not specified, id: notspecified. Preserve source-specific limitations; verify selected resource terms before redistribution. |
| Access / quotas | Public metadata read without authentication; resource/service requirements and quotas not verified. No credential supplied or requested. |
| Source versus derived storage | Do not create duplicate source pipeline. |
| Next integration step | Use merged dataset unless a specific compatibility requirement is demonstrated. |

### TTC Subway Shapefiles

[Official catalogue](https://open.toronto.ca/dataset/ttc-subway-shapefiles/) · [Official metadata](https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=ttc-subway-shapefiles)

| Field | Record |
|---|---|
| Owner / geography | City of Toronto — Toronto Transit Commission; Toronto |
| Status | Legacy geometry only; not imported |
| Format / coordinates | SHP, filename WGS84; verify .prj. Catalogue says four lines and last refresh 2019-07-23. |
| Update evidence | Catalogue cadence: As available; last refresh: 2019-07-23 18:13:00.719515. These describe publication, not accuracy or measurement date. |
| Terms / attribution / redistribution | Toronto portal licence evidence as above; CKAN licence: License not specified, id: notspecified. Preserve source-specific limitations; verify selected resource terms before redistribution. |
| Access / quotas | Public metadata read without authentication; resource/service requirements and quotas not verified. No credential supplied or requested. |
| Source versus derived storage | Keep historical geometry distinct from current service topology. |
| Next integration step | Do not infer current network coverage from this dated file; prefer validated current GTFS. |

### TTC BusTime Real-Time Next Vehicle Arrival (NVAS)

[Official catalogue](https://open.toronto.ca/dataset/ttc-bustime-real-time-next-vehicle-arrival-nvas/) · [Official metadata](https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=ttc-bustime-real-time-next-vehicle-arrival-nvas)

| Field | Record |
|---|---|
| Owner / geography | City of Toronto — Toronto Transit Commission; Toronto |
| Status | Replacement service documented; no live feed consumed |
| Format / coordinates | GTFS-realtime, geographic coordinates per feed specification. Catalogue explicitly requires SurfaceGTFS.ZIP for buses/streetcars. |
| Update evidence | Catalogue cadence: Real-time; last refresh: 2024-08-14 14:12:25.433768. These describe publication, not accuracy or measurement date. |
| Terms / attribution / redistribution | Toronto portal licence evidence as above; CKAN licence: License not specified, id: notspecified. Preserve source-specific limitations; verify selected resource terms before redistribution. |
| Access / quotas | Public metadata read without authentication; resource/service requirements and quotas not verified. No credential supplied or requested. |
| Source versus derived storage | No continuous collector, token or archive approved. Decide retention and attribution before storing positions. |
| Next integration step | Verify current endpoint access, quotas and identifier joins with surface schedule; do not assume subway coverage or IDs matching merged GTFS. |

### Zoning By-law

[Official catalogue](https://open.toronto.ca/dataset/zoning-by-law/) · [Official metadata](https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=zoning-by-law)

| Field | Record |
|---|---|
| Owner / geography | City of Toronto — City Planning; Toronto |
| Status | Catalogue verified, not imported |
| Format / coordinates | CSV/SHP/GeoJSON/GPKG; inspect selected resource CRS. Zoning is regulation, not observed occupancy or land use. |
| Update evidence | Catalogue cadence: As available; last refresh: 2026-02-20 21:29:39.13994. These describe publication, not accuracy or measurement date. |
| Terms / attribution / redistribution | Toronto portal licence evidence as above; CKAN licence: missing, id: missing. Preserve source-specific limitations; verify selected resource terms before redistribution. |
| Access / quotas | Public metadata read without authentication; resource/service requirements and quotas not verified. No credential supplied or requested. |
| Source versus derived storage | Version geometry together with referenced bylaw text/amendment date; avoid pretending a polygon alone supplies legal meaning. |
| Next integration step | Notes say amendments through June 18, 2023 despite newer metadata. Verify currency; only use as contextual scenario input. |

### Forest and Land Cover

[Official catalogue](https://open.toronto.ca/dataset/forest-and-land-cover/) · [Official metadata](https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=forest-and-land-cover)

| Field | Record |
|---|---|
| Owner / geography | City of Toronto — Parks, Forestry & Recreation; Toronto |
| Status | Integrated historical 2018 classified-cover grid over the 5.14 km² district; available in the source-network API and renderer, separately from green-space designations |
| Format / coordinates | Selected 2018 OpenFileGDB layer `LandCover2018`, verified EPSG:2952. Derived 512 × 640 grid is EPSG:4326, north-first rows, approximately 4 m cells. The older 2008 NAD27 metadata does not apply. |
| Update evidence | Study vintage 2018; selected archive published 2022-08-17; cadence “As available”. Not current vegetation. |
| Terms / attribution / redistribution | Official catalogue and CKAN `license_id=open-government-licence-toronto` identify OGL–Toronto. Contains information licensed under the Open Government Licence – Toronto. Keep attribution, original class meanings and transformations with derived data; no City endorsement. |
| Access / quotas | Public archive downloaded without authentication; no stated quota verified. 436,398,730-byte ZIP, 650,677,998 bytes expanded; not a runtime dependency. No matching bounded land-cover layer was found in the inspected official GIS directory. |
| Source versus derived storage | Raw archive/GDB stay in ignored `client/data/toronto`; source SHA, URL, vintage, selected feature IDs and derived SHA are in `land-cover-provenance.json`. Commit only the 397 KB categorical RLE grid and provenance. |
| Processing / uncertainty | 91 spatially selected source features; 751 self-touching polygon parts normalized using GEOS `make_valid`, accepting only valid polygonal output with area change ≤0.01 m² (observed maximum 2.1e-9 m²). No parts omitted. Rasterize pixel centers without simplification; cross-class conflicts become unknown, never an arbitrary winning class. This crop has no unknown/conflicting cells. This policy does not alter the massing importer. |
| Meaning / next integration | Tree, grass, bare, water, building, road, other paving and shrub are historical top-down classes. Canopy can cover streets; do not infer ground under it, walkability, hydrology or current vegetation. Mixed-vintage massing/designations can disagree. Seek a newer comparable source before physical-surface simulation. |

Reproduce with the pinned packages in `client/tools/toronto/land-cover-requirements.txt`, the exact archive linked by the provenance file, and its extracted `LandCover2018.gdb` in the ignored raw directory:

```sh
python client/tools/toronto/extract_land_cover.py client/data/toronto
python client/tools/toronto/check_land_cover.py client/data/toronto
```

The [official 2018 methodology](https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/61642048-56bb-4050-b7c3-f569fcf94527/resource/0b1a8fa1-3a3a-4dd2-a10c-2a1022207de2/download/2018-land-cover-documentation.docx) explains the top-down classification and differences between study vintages. Display colours are illustrative; geometry remains flat.

### Traffic Volumes - Multimodal Intersection Turning Movement Counts

[Official catalogue](https://open.toronto.ca/dataset/traffic-volumes-at-intersections-for-all-modes/) · [Official metadata](https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=traffic-volumes-at-intersections-for-all-modes)

| Field | Record |
|---|---|
| Owner / geography | City of Toronto — Transportation Services; Toronto |
| Status | Catalogue verified, not imported |
| Format / coordinates | CSV/XML/JSON counts; inspect station coordinates and join keys. Short observations since 1984, not continuous demand. |
| Update evidence | Catalogue cadence: Daily; last refresh: 2026-10-21 22:47:21.54179. These describe publication, not accuracy or measurement date. |
| Terms / attribution / redistribution | Toronto portal licence evidence as above; CKAN licence: License not specified, id: notspecified. Preserve source-specific limitations; verify selected resource terms before redistribution. |
| Access / quotas | Public metadata read without authentication; resource/service requirements and quotas not verified. No credential supplied or requested. |
| Source versus derived storage | Store observation date, interval and mode alongside derived aggregates. |
| Next integration step | Pick one nearby intersection; distinguish sampling windows and validate a simulation hypothesis before calibration. |

## Transit freshness and compatibility

The [old TTC NVAS catalogue](https://open.toronto.ca/dataset/ttc-real-time-next-vehicle-arrival-nvas/) and its [official API record](https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=ttc-real-time-next-vehicle-arrival-nvas) mark it retired and announce XML service decommissioning effective **November 30, 2025**. The notice directs users to [BusTime GTFS-realtime](https://bustime.ttc.ca/gtfsrt) and the [replacement catalogue](https://open.toronto.ca/dataset/ttc-bustime-real-time-next-vehicle-arrival-nvas/). This audit verifies the notice, not a test of whether the old endpoint still responds. Do not build against the old Umo/NextBus XML examples.

BusTime’s catalogue requires the [surface routes and schedules](https://open.toronto.ca/dataset/surface-routes-and-schedules-for-bustime/). The merged all-mode schedule is a different planning input; a correct live integration must establish identifier compatibility. Merged GTFS notes say approximately six-week updates while its cadence field says quarterly: check archive service dates instead of trusting either as a guarantee. The [GTFS specifications](https://gtfs.org/documentation/) define formats, not the provider’s licence or access permission.

## GO Transit / UP Express (Metrolinx)

[Official developer page and Access and Use Agreement](https://www.gotransit.com/en/partner-with-us/software-developers). Owner: Metrolinx; geography: regional GO and UP services beyond Toronto. Verified on 2026-10-22: static GTFS downloads listed for GO (updated October 20, 2026) and UP (October 7, 2026); typical updates every few weeks. Format: GTFS ZIP, WGS84 stop/shape coordinates; inspect calendars/timezone. Status: source and agreement verified, no download or integration.

This is **not** the Toronto OGL. Downloading accepts Metrolinx’s Access and Use Agreement. It grants conditional, revocable use/reproduction/redistribution rights, requires its specified prominent legend and excludes trademark use; read the full agreement before adoption. Public links are visible, but quotas and any realtime authentication are unverified. Keep original snapshots outside Git and derived regional connections separate until terms and joins are recorded. Next step: decide whether the first corridor needs GO/UP; if so review agreement before acquiring a bounded fixture. [Metrolinx open-data information](https://www.metrolinx.com/en/about-us/open-data) is a discovery source, not proof that an unrestricted realtime API or approved token exists.

## Additional candidates, not verified inputs

Ontario/NRCan elevation products are alternatives if City TIN cannot provide a bounded usable crop; exact product, coverage, vertical datum, access and terms remain unselected. Population, jobs, travel demand, signal timing, parking, building use and accessibility are needed for some simulation questions but are **not yet approved inputs or calibrated parameters**. Do not substitute zoning for actual activity, aerial canopy for walkability, or short traffic counts for an origin-destination model. Select the question first, then add primary-source records with the same fields above.

## Recommended next two experiments

1. A street/walkway crop around the existing massing block: validate CRS, source IDs, feature filtering and connectivity against the source before rendering it.
2. One TTC corridor and one service day from merged static GTFS: validate referential integrity, calendars, shapes and after-midnight timing offline. Live tracking and Metrolinx access are unnecessary for this experiment.

## Green Spaces ground context

[Official dataset](https://open.toronto.ca/dataset/green-spaces/) · [Official metadata](https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=green-spaces) · [Licence](https://open.toronto.ca/open-data-licence/)

| Field | Source / integration |
| --- | --- |
| Owner / geography | City Parks, Forestry & Recreation with Geospatial Competency Centre; Toronto |
| Format / coordinates | Official 8,896,512-byte GeoPackage, EPSG:4326 verified from geometry metadata; no elevation |
| Update / snapshot | Monthly; resource modified 2026-10-27, retrieved 2026-10-30; hash and URL pinned in green-spaces-provenance.json |
| Licence / access | Dataset page and CKAN explicitly identify OGL–Toronto; attribution retained in app and package. Public download, no authentication; no API quota dependency at runtime |
| Source versus derived | Raw archive ignored; 44 polygons clipped to the existing 5.14 km² district, with holes retained and no repair/simplification. GeoJSON and provenance committed; deterministic offline extraction |
| Meaning / limits | Generalized parks/open-space designations, not exhaustive land cover. Includes potentially private and paved areas. No inferred vegetation, public access, land title, terrain height or navigation |
| Integration | Shared source-network API context and a merged flat browser overlay; illustrative class colours, toggle and Grange Park focus. Does not alter roads, actors or routing |
| Next step | Compare appropriately licensed actual land-cover/elevation observations before assigning physical surfaces or terrain heights |
