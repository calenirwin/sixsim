// The bridge records: which CSCL segments are a bridge's deck (BRIDGE_DEFS), and the deck, towers and water run of every
// bridge, written to <tiles>/bridges.json for city/bridgeKit.js, the traffic (sim/traffic.js) and the headless core.
//
// compile.mjs collects the deck segments while it loads the streets (matchBridgeDef), then calls bridgeInputs() and
// buildBridgeRecords(). bridgeInputs() is everything the records read from the rest of the compile, made serialisable:
// the segments, the lifted road ends near each bridge (the ramps a deck end meets), the OSM landings, and per bridge a
// land raster (2 m) and a terrain raster (4 m) over its box. compile.mjs writes it beside bridges.json as
// bridge_inputs.json, and the records are built from it in both runs, so a change to this file rebuilds bridges.json in
// seconds without a compile:
//
//   node tools/pipeline/bridges.mjs <tiles dir>    (reads <dir>/bridge_inputs.json, writes <dir>/bridges.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { project } from '../../src/shared/geo.js';
import { simplify, alongPolyline, polylineLength } from './geom.mjs';
import { backdropHeights } from '../../../tools/lod/backdrop_heights.mjs';

// the backdrop's ground (tools/lod/backdrop_heights.mjs: the region's 8 m terrain the backdrop draws, BD_REC), opened on
// first use: the New Jersey ends of the bridges to New Jersey stand on it (null when it is not on this machine)
let BH = undefined;
const backdrop = () => {
  if (BH === undefined) { try { BH = backdropHeights(); } catch (e) { BH = null; console.log(` bridges: no backdrop heights (${e.message.slice(0, 80)}); the New Jersey ends keep the compile's ground`); } }
  return BH;
};

export const BRIDGE_DEFS = [
  // `layout` (see layoutOf): tower centres over the water from the NOAA Electronic Navigational Charts (ENC Direct,
  // harbour scale, cells US5NYCDG and US5NYCFG: "bridge pylon" / "bridge pier" areas, the centre of each area's least
  // rectangle; public domain), spans and heights from the bridges' published dimensions.
  // The Brooklyn Bridge (1883): main span 1,595.5 ft (486.3 m), side spans 930 ft (283.5 m); towers 278 ft (84.8 m) over
  // mean high water, the roadway through the arches at 119.25 ft (36.35 m), 127 ft (38.7 m) of clearance at mid-span
  // under the floor (the roadway ~135 ft, 41.15 m), side spans and approaches at 3.25 % (the anchorages' roadway 27.1 m).
  // The ENC holds the Manhattan tower's pier only; the Brooklyn tower stands one main span on. `approach`: the elevated
  // rw_type 1 pieces of the same name carry the deck on to Centre Street and to Adams Street.
  { key: 'brooklyn', re: /^BROOKLYN BR(G|DG)$/, type: 'suspension', tower: 'gothic', clearance: 38, towerH: 84.8, color: 0xc9b7975, promenade: true,
    width: 25.9, approach: true,
    layout: { towers: [[-73.998327, 40.707279], { near: [-73.9945, 40.7041] }], main: 486.3, side: [283.5, 283.5], yTower: 36.35, yMid: 41.15, yAnch: 27.1,
      ends: [[-74.006032, 40.711914], [-73.988533, 40.699335]] } },
  // the Manhattan Bridge (1909): main span 1,470 ft (448 m), side spans 725 ft (221 m), towers 336 ft (102 m) to the cable
  // saddles over mean high water (finials 350 ft), 135 ft (41.1 m) of clearance under the stiffening trusses at mid-span;
  // the upper roadways ~8.5 m over that (the trusses 24-26 ft deep), the anchorages 135 ft (41 m) high
  { key: 'manhattanBr', re: /^MANHATTAN BRG$/, type: 'suspension', tower: 'steel', clearance: 40, towerH: 102.4,
    width: 36.6, approach: true,
    layout: { towers: [[-73.991488, 40.708823], [-73.989417, 40.705111]], main: 448.1, side: [221, 221], yTower: 45.6, yMid: 49.9, yAnch: 37.5,
      ends: [[-73.995319, 40.715694], [-73.986291, 40.699254]] } },
  // the Williamsburg Bridge (1903): main span 1,600 ft (487.7 m), side spans 596 ft (181.7 m) carried by trusses on
  // intermediate towers (not suspended), towers 335 ft (102 m), 135 ft (41.1 m) of clearance at mid-span; the stiffening
  // trusses 40 ft (12.2 m) deep, the roadways at their bottom chords
  { key: 'williamsburg', re: /^WILLIAMSBURG BRG$/, type: 'suspension', tower: 'steelTruss', clearance: 41, towerH: 102.1,
    width: 36, approach: true,
    layout: { towers: [[-73.974805, 40.714399], [-73.969440, 40.712763]], main: 487.7, side: [181.7, 181.7], yTower: 39.6, yMid: 43.2, yAnch: 33.0,
      ends: [[-73.985769, 40.7177], [-73.96038, 40.710052]] } },
  // the Queensboro Bridge (Gustav Lindenthal, engineer; Henry Hornbostel, architect; 1909): five cantilever truss spans,
  // 143.1 / 360.3 / 192.0 / 299.9 / 139.9 m from the Manhattan anchorage; its four piers (OpenStreetMap `bridge:support`
  // pylons, 110 m to the finials) 360.9, 191.6 and 300.0 m apart along this line; two levels, 130 ft (40 m) of clearance
  { key: 'queensboro', re: /^ED KOCH QUEENSBORO BRG$/, type: 'cantilever', clearance: 40, towerH: 105, width: 26.2, approach: true,
    layout: { towers: [[-73.959115, 40.758905], [-73.955402, 40.757295], [-73.953438, 40.756438], [-73.950342, 40.7551]], side: [143.1, 139.9],
      yTower: 45.0, yMid: [48.6, 46.6, 48.2], yAnch: 36.0, ends: [[-73.963392, 40.760631], [-73.940848, 40.750936]] } },
  // `osm`: the deck carries on along the bridge's OSM alignment to its New Jersey landing (LANDINGS); main span 3,500 ft
  // towers on the ENC (US5NYCFG/FH: the New Jersey tower's pier, the New York tower's two leg piers), side spans 610 ft
  // (New Jersey) and 650 ft (New York); the upper roadway ~72 m over the river at mid-span (65 m of clearance under the
  // 1962 trusses), ~66 m at the towers, at the cliff tops' height at the anchorages
  { key: 'gwb', re: /^GEORGE WASHINGTON BRG$/, type: 'suspension', tower: 'lattice', clearance: 65, towerH: 184.1, span: 1067, osm: 'gwb', width: 36.3,
    layout: { towers: [[-73.95877, 40.852852], [-73.94653, 40.850461]], main: 1066.8, side: [185.9, 198.1], yTower: 66.0, yMid: 72.0, yAnch: 62.0, vc: 120 } },
  // Staten Island to New Jersey: the Bayonne Bridge (steel arch, 1,675 ft span, deck raised in 2019 to 215 ft of
  // clearance under the crown 325 ft over the water), the Goethals Bridge (twin cable-stayed spans of 2017, 900 ft main
  // span, 135 ft clearance, pylons ~272 ft) and the Outerbridge Crossing (cantilever truss of 1928, 750 ft span, 135 ft)
  // (the arch: 1,675 ft (510.5 m) between its skewbacks, OpenStreetMap's abutments 534 m apart centre to centre; the
  // roadway raised in 2019 to 215 ft (65.5 m) of clearance, ~69 m)
  { key: 'bayonne', re: /^BAYONNE BRG$/, type: 'arch', clearance: 65.5, archRise: 32, osm: 'bayonne', approach: true, width: 26,
    layout: { kind: 'arch', arches: [[[-74.142214, 40.641854], 510.5]], y: 69.0, flat: 30, vc: 120 } },
  // the Kosciuszko Bridge (2017 Queens-bound, 2019 Brooklyn-bound): two parallel cable-stayed spans over Newtown Creek, each
  // with its own two towers of ~287 ft (87.5 m); the main span ~600 ft (183 m), the charted channel span (ENC, "Kosciuszko
  // Fixed Bridge", VERCLR 27.4 m), its towers at its two ends: each span's centre from the chart, the towers 91.5 m either
  // side along the decks' alignment (the centreline strands' direction there, 0.667 / -0.745)
  { key: 'kosciuszko', re: /^KOSCIUSZKO BRG$/, type: 'cablestayed', clearance: 27.4, towerH: 87.5, span: 183, approach: true, width: 24,
    // (`ends`: the Queens-bound strands' ends, Meeker Ave to the Long Island Expressway's ramps)
    layout: { pairs: [[[-73.929699, 40.726909], [-73.929937, 40.727088]], [[-73.928252, 40.728136], [-73.928490, 40.728315]]], main: 183, side: [91, 91], yTower: 30.0, yMid: 30.8, yAnch: 28.5,
      ends: [[-73.933615, 40.724784], [-73.924985, 40.731998]] } },
  { key: 'goethals', re: /^GOETHALS BRG$/, type: 'cablestayed', clearance: 41.5, towerH: 83, span: 274, osm: 'goethals', approach: true, width: 18,
    // (OpenStreetMap's supports: two pylon lines 274 m apart, each a pair 31 m across, one pylon a deck)
    layout: { pairs: [[[-74.196078, 40.634659], [-74.195874, 40.634889]], [[-74.198741, 40.636067], [-74.198525, 40.636311]]], main: 274.3, side: [90, 90], yTower: 44.0, yMid: 45.5, yAnch: 42.0 } },
  // (OpenStreetMap's piers: the anchor piers 112-113 m outside the main piers, 228 m apart)
  { key: 'outerbridge', re: /^OUTERBRIDGE XING$/, type: 'cantilever', clearance: 41, towerH: 60, span: 229, osm: 'outerbridge', approach: true, width: 18.5,
    layout: { towers: [[-74.249437, 40.52468], [-74.246734, 40.52483]], side: [112.8, 112.2], yTower: 44.5, yMid: [45.8], yAnch: 43.0, vc: 80, spans: true } },
  // the Verrazzano-Narrows Bridge (1964): main span 4,260 ft (1,298 m) between towers 693 ft (211 m) high, 228 ft (69.5 m)
  // of clearance at mid-span (MTA Bridges and Tunnels). `span` stands the towers that far apart about the middle of the
  // water run (the 22 % / 78 % rule put them 0.8 km apart across the Narrows).
  // CSCL draws it as four strands (two carriageways, each on two levels) whose rw_type 3 pieces run anchorage to
  // anchorage; `approach` adds the elevated rw_type 1 viaducts of the same name (CSCL levels 17 / 21), so the climb to the
  // 71.5 m apex starts where the ramps meet them, `centre` moves the deck from one carriageway onto the axis between both,
  // and `width` is the real 103 ft (31 m) deck.
  { key: 'verrazzano', re: /^VERRAZZANO BRG$/, type: 'suspension', tower: 'steel', clearance: 69.5, towerH: 211, span: 1298,
    width: 31, centre: true, approach: true, decks: 2,
    // towers on the ENC piers (US5NYCCF: 91 x 62 m caissons), 1,295 m apart; side spans 1,215 ft; the upper roadway 75.5 m
    // over the water at mid-span (69.5 m of clearance under the 7.3 m stiffening trusses), 63 m at the towers, 52 m at the
    // anchorages
    layout: { towers: [[-74.052516, 40.604043], [-74.038379, 40.608606]], main: 1298.4, side: [370.3, 370.3], yTower: 63.0, yMid: 75.5, yAnch: 52.0, vc: 120 } },
  // the Bronx-Whitestone Bridge (Othmar Ammann, 1939): main span 2,300 ft (701 m), side spans 735 ft (224 m), towers 377 ft
  // (115 m), the roadway 150 ft (45.7 m) over mean high water at mid-span (134 ft 10 in of clearance under the girders);
  // two cables, a 74 ft deck between them on 11 ft plate girders (the 1946 trusses removed in 2003 for triangular
  // fairings); concrete anchorages 180 x 110 ft. The approaches: plate-girder viaducts (CSCL rw_type 1 and 2)
  { key: 'whitestone', re: /^WHITESTONE BRG$/, type: 'suspension', tower: 'portal', clearance: 41.1, towerH: 115, width: 22.6, approach: true, approachRw: [1, 2],
    layout: { towers: [[-73.831595, 40.804867], [-73.827926, 40.799204]], main: 701, side: [224, 224], yTower: 39.5, yMid: 45.7, yAnch: 28.0,
      ends: [[-73.836249, 40.81247], [-73.825631, 40.795635]] } },
  // the Throgs Neck Bridge (Othmar Ammann, 1961): main span 1,800 ft (549 m), side spans 555 ft (169 m), towers 346 ft
  // (105.5 m) over mean high water (closed boxes, arched struts at the top), 142 ft (43.3 m) of clearance under the 28 ft
  // (8.5 m) stiffening trusses, two three-lane roadways of 37 ft; concrete anchorages 250 x 350 ft
  { key: 'throgs', re: /^THROGS NECK BRG$/, type: 'suspension', tower: 'portal', clearance: 43.3, towerH: 105.5, width: 25.6, approach: true,
    layout: { towers: [[-73.793606, 40.802772], [-73.793605, 40.797819]], main: 548.6, side: [169.2, 169.2], yTower: 49.4, yMid: 52.1, yAnch: 44.0,
      ends: [[-73.797396, 40.815764], [-73.790811, 40.788427]] } },
  // the RFK (Triborough) Bridge's suspension span over Hell Gate (Othmar Ammann, 1936): main span 1,380 ft (421 m),
  // side spans 700 ft (213 m), towers 315 ft (96 m) of two legs with simple cross bracing, Art Deco saddles and 30 ft
  // lanterns; a 98 ft (30 m) deck of eight lanes between Warren stiffening trusses, 143 ft (43.6 m) of clearance; two
  // cables of 20 in. Its towers from OpenStreetMap (`bridge:support` pylons, 420.7 m apart); `box`: the span and its
  // viaducts to Wards Island's turn and into Astoria (the rest of the RFK's 24 km of strands stay roads)
  { key: 'rfk', re: /^ROBERT F KENNEDY BRG$/, box: [3380, -420, 4400, 1260], type: 'suspension', tower: 'portal', clearance: 43.6, towerH: 96, width: 30,
    approach: true,
    layout: { towers: [[-73.92798, 40.781295], [-73.925479, 40.778019]], main: 420.6, side: [213.4, 213.4], yTower: 45.5, yMid: 49.0, yAnch: 38.5,
      ends: [[-73.929754, 40.786330], [-73.919839, 40.772275]] } },
  // the Hell Gate Bridge (Gustav Lindenthal, 1916): a steel spandrel-braced arch of 1,017 ft (310 m) between granite-faced
  // towers, its crown 305 ft (93 m) over the water, the deck 135 ft (41 m) over it; ~5 km of elevated railway in all, on
  // viaducts across Astoria and Wards and Randalls Islands to the Bronx. Drawn on the planimetric railroad lines coded
  // elevated (2410) and viaduct (2430), which the rail layer leaves to the structures that draw them; the arch towers
  // from OpenStreetMap (330 m apart, centre to centre)
  // (`re` claims the CSCL's path over the arch, which the rail alignment replaces)
  // the RFK Bridge's Bronx Kill crossing (1936): a fixed through truss of 383 ft (117 m) over the Bronx Kill between Randalls
  // Island and the Bronx, 55 ft (17 m) of clearance, 1,600 ft (488 m) with its approaches: the segments of the RFK's name
  // north of the suspension span's box, the truss centred on the Kill where the deck crosses it (the borough boundaries'
  // water, 4,395 / -1,757)
  { key: 'rfkBronxKill', re: /^ROBERT F KENNEDY BRG$/, box: [4300, -2150, 4650, -1600], type: 'truss', clearance: 17, approach: true,
    layout: { kind: 'truss', piers: [[-73.919443, 40.798453], [-73.918727, 40.799370]], y: 19.0, flat: 8 } },
  { key: 'hellgate', re: /^HELL GATE (BRIDGE|BRG)$/, rail: { re: /CONNECTING RR|CONRAIL-AMTRAK/, codes: ['2410', '2430'], box: [3800, -2650, 5750, 2350] }, type: 'archRail', clearance: 41, width: 19, foot: true,
    layout: { towers: [[-73.923419, 40.783585], [-73.920641, 40.781499]], main: 330, side: [0, 0], yTower: 43.5, yMid: 44.0, yAnch: 43.5, vc: 200,
      // (the ends of the planimetric lines' connected run, 16 km of tracks: beyond them the lines come in pieces 30-500 m
      // apart where the tracks leave the viaducts for embankments)
      ends: [[-73.907459, 40.767243], [-73.907615, 40.805288]] } },
  // the Henry Hudson Bridge (David Steinman, 1936; the upper level 1938): a steel deck arch of 840 ft (256 m) over the
  // Spuyten Duyvil, 142.5 ft (43.4 m) over the water at its crown (the ENC's span area for its centre)
  { key: 'henryHudson', re: /^HENRY HUDSON BRG$/, type: 'arch', clearance: 44,
    layout: { kind: 'arch', arches: [[[-73.921939, 40.877903], 256]], y: 45.5 } },   // (the springings: OpenStreetMap's `bridge:support` skewbacks, 269 m apart)
  // the Washington Bridge (William R. Hutton, 1889): two steel deck arches of 508 ft (155 m) on a central pier (the
  // ENC's span area over the channel for the first), 135 ft (41 m) of clearance, masonry approach arches
  { key: 'washingtonBr', re: /^WASHINGTON BRG$/, type: 'arch', clearance: 41,
    layout: { kind: 'arch', arches: [[[-73.927881, 40.846782], 155], [[-73.926157, 40.846026], 155]], y: 46.0,   // (OSM: the west abutment and the central pier, 168 m apart)
      ends: [[-73.930893, 40.848127], [-73.923936, 40.844795]] } },
  // the Alexander Hamilton Bridge (1963): a steel deck arch of 555 ft (169 m), 103 ft (31 m) of clearance
  { key: 'hamiltonBr', re: /^ALEXANDER HAMILTON BRG$/, type: 'arch', clearance: 31,
    layout: { kind: 'arch', arches: [[[-73.928807, 40.845629], 160]], y: 36.5 } },   // (OSM: the skewbacks, 166 m apart)
  // the High Bridge (John B. Jervis, 1848; the river span a steel arch of 450 ft (137 m) since 1928): 116 ft over the
  // river, masonry arches on the banks; a walkway (the ENC's span area for the arch's centre)
  { key: 'highBr', re: /^HIGH BR(IDGE|G)$/, type: 'arch', clearance: 31, foot: true,
    layout: { kind: 'arch', arches: [[[-73.930512, 40.842358], 137]], y: 37.5 } },   // (OSM: the arch's piers, 142 m apart)
  // the Harlem River's swing bridges: the pivot piers from the ENC (their fenders' footprints), the swing spans' lengths
  // and the roadway's height over the closed span's clearance (ENC VERCCL, 25-30 ft)
  // Macombs Dam Bridge (Alfred Pancoast Boller, 1895): a 415 ft (126.5 m) camelback through-truss swing span
  { key: 'macombs', re: /^MACOMBS DAM BR(G|DG)$/, type: 'swing', clearance: 9, approach: true,
    layout: { kind: 'swing', piers: [[-73.93387, 40.828133]], span: 126.5, y: 11.0 } },
  // the 145th Street Bridge (1905; the swing span replaced in 2006): a 300 ft (91.4 m) through-truss swing span
  { key: 'br145', re: /^145 ST +BRIDGE$/, type: 'swing', clearance: 8, approach: true,
    layout: { kind: 'swing', piers: [[-73.933132, 40.819489]], span: 91.4, y: 11.0 } },
  // the Madison Avenue Bridge (Alfred Pancoast Boller, 1910): a 300 ft (91.4 m) through-truss swing span
  { key: 'madisonAv', re: /^MADISON AVE +BRIDGE$/, type: 'swing', clearance: 8, approach: true,
    layout: { kind: 'swing', piers: [[-73.933168, 40.81419]], span: 91.4, y: 10.5 } },
  // the Third Avenue Bridge (2004): a 350 ft (106.7 m) through-truss swing span
  { key: 'thirdAv', re: /^3 AVE? +BRIDGE$/, type: 'swing', clearance: 8, approach: true,
    layout: { kind: 'swing', piers: [[-73.932604, 40.807554]], span: 106.7, y: 10.5 } },
  // the Willis Avenue Bridge (2010): a 350 ft (106.7 m) through-truss swing span, rest piers either side (ENC)
  { key: 'willis', re: /^WILLIS AVE +BRIDGE$/, type: 'swing', clearance: 8, approach: true,
    layout: { kind: 'swing', piers: [[-73.929024, 40.803465]], span: 106.7, y: 10.2 } },
  // the University Heights Bridge (William H. Burr, 1908; rebuilt 1992): a 265 ft (80.8 m) through-truss swing span
  { key: 'universityHts', re: /^UNIVERSITY HEIGHTS BRG$/, type: 'swing', clearance: 8, approach: true,
    layout: { kind: 'swing', piers: [[-73.91487, 40.86277]], span: 80.8, y: 10.5 } },
  // the Broadway Bridge (1962): a 304 ft lift span between towers on the ENC's two piers, 24 ft (7.3 m) of clearance
  // closed: the roadway ~9.6 m, the 1 train's deck over it
  { key: 'broadwayBr', re: /^BROADWAY BRG$/, type: 'lift', clearance: 8, approach: true,
    layout: { kind: 'lift', piers: [[-73.911467, 40.873311], [-73.91069, 40.873914]], y: 9.6, flat: 6 } },
  // the Roosevelt Island Bridge (1955): a 418 ft (127.4 m) lift span; the ENC holds the Queens tower's pier, the island's
  // tower stands one span on; 40 ft of clearance closed
  { key: 'rooseveltBr', re: /^ROOSEVELT (ISLAND|IS) BR(IDGE|G)$/, type: 'lift', clearance: 12, approach: true,
    layout: { kind: 'lift', piers: [[-73.946547, 40.763773], [-73.945203, 40.763116]], y: 14.2, flat: 6 } },   // (OSM: both towers' piers, 135 m apart)
  // the Pulaski Bridge (1954): a double-leaf bascule over Newtown Creek, its two bascule piers from OpenStreetMap's supports
  // (49 m apart), 39 ft (11.9 m) of clearance closed: the roadway ~13.4 m; its approaches on the same name to 11th St and
  // McGuinness Blvd
  // the Marine Parkway-Gil Hodges Memorial Bridge (1937): a vertical lift over Rockaway Inlet, the ENC's four bridge piers
  // (the towers on the inner two, 164 m apart; flanking truss spans to the outer two), 55 ft (16.7 m) of clearance closed:
  // the roadway ~18.6 m
  { key: 'marinePkwy', re: /^MARINE PY-GIL HODGES MEMORIAL BRG$/, type: 'lift', clearance: 16.7, approach: true,
    layout: { kind: 'lift', piers: [[-73.886198, 40.575607], [-73.88538, 40.574208], [-73.884507, 40.572736], [-73.883651, 40.571357]], y: 18.6, flat: 10 } },
  { key: 'pulaski', re: /^PULASKI BR(IDGE|G)/, type: 'bascule', clearance: 12, approach: true,
    layout: { kind: 'bascule', piers: [[-73.952602, 40.739468], [-73.952695, 40.739016]], y: 13.4, flat: 8 } },
  // the Wards Island Bridge (103rd Street footbridge, Othmar Ammann, 1951): a 312 ft (95 m) lift span between towers on
  // the ENC's piers, 55 ft (16.8 m) of clearance closed
  { key: 'wardsFoot', re: /^WARDS ISLAND FOOTBRIDGE|103 STREET FOOTBRIDGE/, type: 'lift', clearance: 16, foot: true,
    layout: { kind: 'lift', piers: [[-73.937805, 40.786343], [-73.936817, 40.785931]], y: 18.6, flat: 6 } },
];

// the def whose deck a CSCL segment is (rw_type 3, or an `approach` def's elevated rw_type 1 viaduct), null otherwise;
// ramps, paths and the bridges' bike and walk ways stay roads
// `box` [x0, z0, x1, z1]: does a segment's middle (by length: the middle vertex of a two-point segment is its end) lie
// inside a def's box (one part of a long structure of one name)
function inBoxOf(d, pts) {
  if (!d.box) return true;
  if (!pts || pts.length < 2) return false;
  const [x, z] = alongPolyline(pts, polylineLength(pts) / 2);
  return x >= d.box[0] && x <= d.box[2] && z >= d.box[1] && z <= d.box[3];
}
export function matchBridgeDef(rawName, rw, lvA, lvB, pts = null) {
  if (rw !== 3 && rw !== 1 && rw !== 2) return null;
  const nm = rawName.replace(/ +/g, ' ');
  const bd = BRIDGE_DEFS.find((d) => (rw === 3 || (d.approach && (lvA > 13 || lvB > 13) && (d.approachRw || [1]).includes(rw))) && d.re && d.re.test(nm) && inBoxOf(d, pts));
  return bd && !/EXIT|ENTRANCE|EN RP|RAMP|PATH|BIKE|PED/.test(rawName) ? bd : null;
}
// each kit bridge's own walkways and bike paths in CSCL (rw_type 3): the kit draws the walks, so these stay out of the
// roads (compiled as paths at their CSCL levels' heights, they floated under or over the decks: the Brooklyn Bridge's
// promenade at 26 m under the 41 m deck)
const WALKS = {
  brooklyn: /^BROOKLYN BR(IDGE|DG) PEDESTRIAN PATH$/,
  manhattanBr: /^MANHATTAN BRIDGE (PEDESTRIAN|BIKE) PATH$/,
  williamsburg: /^WILLIAMSBURG BR(IDGE)? (BIKE|PEDESTRIAN|BIKE AND PED) PATH$/,
  queensboro: /^ED KOCH QUEENSBORO BR (PED|BIKE) PATH$/,
  rfk: /^RFK BR(IDGE)? ((QUEENS|BRONX) )?PED AND BIKE PATH$/,
  gwb: /^GEORGE WASHINGTON BRDG (PED|BIKE) PATH$/,
  washingtonBr: /^WASHINGTON BRIDGE (PED|BIKE) PATH$/,
  macombs: /^MACOMBS DAM BR(IDGE|DG) PEDESTRIAN PATH$/,
  br145: /^145 ST BRIDGE PED AND BIKE PATH$/,
  madisonAv: /^MADISON AV BRDG PED & BIKE PATH$/,
  thirdAv: /^3 AV(ENUE)? BRIDGE (PED AND )?BIKE PATH$/,
  willis: /^WILLIS AVENUE BRIDGE BIKE PATH$/,
  pulaski: /^PULASKI BRIDGE (PEDESTRIAN|BIKE) PATH$/,
  marinePkwy: /^MARINE PY-GIL HODGES BR BIKE PATH$/,
  rfkBronxKill: /^RFK BR(IDGE)? BRONX PED AND BIKE PATH$/,
};
export function bridgeWalkDef(rawName, rw, pts) {
  if (rw !== 3) return null;
  const nm = rawName.toUpperCase().replace(/ +/g, ' ').trim();
  for (const [key, re] of Object.entries(WALKS)) {
    if (!re.test(nm)) continue;
    const d = BRIDGE_DEFS.find((x) => x.key === key);
    if (d && inBoxOf(d, pts)) return d;
  }
  return null;
}

// an OpenStreetMap building that is a bridge's own structure (a tower, pier or anchorage: `bridge:support`, or
// building=bridge): the bridge kit draws these, so the building gap-fill leaves them out
export function isBridgeStructure(t) {
  return !!t['bridge:support'] || t.building === 'bridge' || t.man_made === 'bridge';
}

// ---------------------------------------------------------------- inputs (serialisable)
// (the terrain raster's 4 m nodes, its box on 16 m, hold every node of the compile's terrain grids (16, 8 and 4 m cells
// from the tile origins), so its bilinear lookup returns what sampleTerrain does)
const LAND_RES = 2, TER_RES = 4, MARGIN = 800;
// rows of a land raster over box [x0, z0, x1, z1] at `res`, as run lengths (water first): each polygon's rings filled
// even-odd along the row's centre line, the polygons OR'd
function rasterLand(LAND, box, res) {
  const [x0, z0, x1, z1] = box, W = Math.ceil((x1 - x0) / res), H = Math.ceil((z1 - z0) / res);
  const polys = LAND.filter((L) => !(L.bbox[2] < x0 || L.bbox[0] > x1 || L.bbox[3] < z0 || L.bbox[1] > z1));
  // each polygon's edges bucketed by row
  const rowsOf = polys.map((L) => {
    const buckets = new Map();
    for (const ring of [L.outer, ...L.holes]) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xa, za] = ring[j], [xb, zb] = ring[i];
      if (za === zb) continue;
      const lo = Math.max(0, Math.ceil((Math.min(za, zb) - z0) / res - 0.5)), hi = Math.min(H - 1, Math.floor((Math.max(za, zb) - z0) / res - 0.5));
      for (let r = lo; r <= hi; r++) { let a = buckets.get(r); if (!a) buckets.set(r, (a = [])); a.push(xa, za, xb, zb); }
    }
    return buckets;
  });
  const rows = [], line = new Uint8Array(W);
  for (let r = 0; r < H; r++) {
    line.fill(0);
    const z = z0 + (r + 0.5) * res;
    for (const buckets of rowsOf) {
      const e = buckets.get(r);
      if (!e) continue;
      const xs = [];
      for (let k = 0; k < e.length; k += 4) {
        const [xa, za, xb, zb] = [e[k], e[k + 1], e[k + 2], e[k + 3]];
        if ((za > z) !== (zb > z)) xs.push(xa + ((z - za) * (xb - xa)) / (zb - za));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - x0) / res - 0.5)), c1 = Math.min(W - 1, Math.floor((xs[k + 1] - x0) / res - 0.5));
        for (let c = c0; c <= c1; c++) line[c] = 1;
      }
    }
    const runs = [];
    let cur = 0, n = 0;
    for (let c = 0; c < W; c++) { if (line[c] === cur) n++; else { runs.push(n); cur = line[c]; n = 1; } }
    runs.push(n);
    rows.push(runs);
  }
  return { box, res, W, H, rows };
}
// a terrain raster (cm, run-length coded per row as [value, count] pairs)
function rasterTerrain(sampleTerrain, box, res) {
  const [x0, z0, x1, z1] = box, W = Math.ceil((x1 - x0) / res) + 1, H = Math.ceil((z1 - z0) / res) + 1;
  const rows = [];
  for (let r = 0; r < H; r++) {
    const runs = [];
    for (let c = 0; c < W; c++) {
      const v = Math.round(sampleTerrain(x0 + c * res, z0 + r * res) * 100);
      if (runs.length && runs[runs.length - 2] === v) runs[runs.length - 1]++; else runs.push(v, 1);
    }
    rows.push(runs);
  }
  return { box, res, W, H, rows };
}
// segs: Map key -> [{ pts, width, name }]; roads: the compile's road list; LAND: [{ outer, holes, bbox }]; LANDINGS: the OSM
// landings (lon, lat)
export function bridgeInputs({ segs, roads, LAND, sampleTerrain, LANDINGS, raw = null }) {
  const out = { version: 1, bridges: {} };
  // `rail`: a railway bridge drawn on the NYC Planimetric railroad centre lines (data/raw/rail_lines.geojson) whose
  // name and feature code match, inside its box (the CSCL carries only a path over the Hell Gate arch)
  const railDefs = BRIDGE_DEFS.filter((d) => d.rail);
  if (railDefs.length && raw && fs.existsSync(path.join(raw, 'rail_lines.geojson'))) {
    const fc = JSON.parse(fs.readFileSync(path.join(raw, 'rail_lines.geojson'), 'utf8'));
    for (const d of railDefs) {
      const list = [];
      for (const f of fc.features) {
        const p = f.properties || {}, g = f.geometry;
        if (!g || !d.rail.re.test(p.name || '') || !d.rail.codes.includes(String(p.feat_code))) continue;
        const lines = g.type === 'MultiLineString' ? g.coordinates : [g.coordinates];
        for (const ln of lines) {
          const pts = ln.map((c) => project(c[0], c[1]));
          const [mx, mz] = pts[Math.floor(pts.length / 2)];
          if (mx < d.rail.box[0] || mx > d.rail.box[2] || mz < d.rail.box[1] || mz > d.rail.box[3] || pts.length < 2) continue;
          list.push({ pts, width: d.width || 18, name: p.name });
        }
      }
      if (list.length) segs.set(d.key, list);
    }
  }
  for (const [key, list] of segs) {
    const def = BRIDGE_DEFS.find((d) => d.key === key);
    let x0 = 1e12, z0 = 1e12, x1 = -1e12, z1 = -1e12;
    const grow = (x, z) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
    for (const s of list) for (const [x, z] of s.pts) grow(x, z);
    const Lg = def?.osm && LANDINGS[def.osm];
    if (Lg) for (const [lon, lat] of [...(Lg.bridge || []), ...(Lg.approach || [])]) grow(...project(lon, lat));
    const box = [Math.floor((x0 - MARGIN) / 16) * 16, Math.floor((z0 - MARGIN) / 16) * 16, Math.ceil((x1 + MARGIN) / 16) * 16, Math.ceil((z1 + MARGIN) / 16) * 16];
    const lifts = [];
    const inBox = ([x, z]) => x >= box[0] && x <= box[2] && z >= box[1] && z <= box[3];
    for (const r of roads) {
      if (!(r.lA > 0 || r.lB > 0) || r.pts.length < 2) continue;
      const a = r.pts[0], b = r.pts[r.pts.length - 1];
      if (inBox(a) || inBox(b)) lifts.push([+a[0].toFixed(2), +a[1].toFixed(2), r.lA || 0, +b[0].toFixed(2), +b[1].toFixed(2), r.lB || 0]);
    }
    // the roads and paths near the bridge (their centre lines within 60 m of a deck segment): which ones pass under the
    // deck, and where, is worked out on the final centre line (`under` in the record)
    const near = [];
    const segPts = list.flatMap((s) => s.pts);
    const close = (p) => segPts.some((q) => Math.abs(q[0] - p[0]) < 60 && Math.abs(q[1] - p[1]) < 60);
    for (const r of roads) {
      if (r.pts.length < 2 || !r.pts.some(inBox)) continue;
      if (!r.pts.some(close)) continue;
      near.push({ w: +(+r.width || 6).toFixed(1), lA: r.lA || 0, lB: r.lB || 0, rc: r.rclass, pts: r.pts.map(([x, z]) => [+x.toFixed(2), +z.toFixed(2)]) });
    }
    out.bridges[key] = {
      segs: list.map((s) => ({ name: s.name, width: s.width, pts: s.pts.map(([x, z]) => [+x.toFixed(2), +z.toFixed(2)]) })),
      lifts, near,
      landing: Lg ? { bridge: Lg.bridge || [], approach: Lg.approach || [] } : null,
      land: rasterLand(LAND, box, LAND_RES),
      terrain: rasterTerrain(sampleTerrain, box, TER_RES),
    };
  }
  return out;
}

// lookups over one bridge's rasters
function landLookup(R) {
  const [x0, z0] = R.box, grid = new Uint8Array(R.W * R.H);
  R.rows.forEach((runs, r) => { let c = 0, v = 0; for (const n of runs) { if (v) grid.fill(1, r * R.W + c, r * R.W + c + n); c += n; v ^= 1; } });
  let warned = false;
  return (x, z) => {
    const c = Math.floor((x - x0) / R.res), r = Math.floor((z - z0) / R.res);
    if (c < 0 || r < 0 || c >= R.W || r >= R.H) { if (!warned) { warned = true; console.warn('  bridges: a land test outside the raster at', x.toFixed(0), z.toFixed(0)); } return false; }
    return grid[r * R.W + c] === 1;
  };
}
function terrainLookup(R) {
  const [x0, z0] = R.box, grid = new Float32Array(R.W * R.H);
  R.rows.forEach((runs, r) => { let c = 0; for (let k = 0; k < runs.length; k += 2) { grid.fill(runs[k] / 100, r * R.W + c, r * R.W + c + runs[k + 1]); c += runs[k + 1]; } });
  return (x, z) => {
    const fx = Math.max(0, Math.min(R.W - 1.001, (x - x0) / R.res)), fz = Math.max(0, Math.min(R.H - 1.001, (z - z0) / R.res));
    const c = Math.floor(fx), r = Math.floor(fz), u = fx - c, v = fz - r;
    const g = (cc, rr) => grid[rr * R.W + cc];
    return (g(c, r) * (1 - u) + g(c + 1, r) * u) * (1 - v) + (g(c, r + 1) * (1 - u) + g(c + 1, r + 1) * u) * v;
  };
}

// ---------------------------------------------------------------- the records
export function buildBridgeRecords(inputs, log = console.log) {
  const bridgesOut = [];
  for (const [key, B] of Object.entries(inputs.bridges)) {
    const def = BRIDGE_DEFS.find((d) => d.key === key);
    const segs = B.segs;
    const onLand = landLookup(B.land), sampleTerrain = terrainLookup(B.terrain);
    // merge into strands: pick longest chain through endpoint graph
    const eps = 8;
    const kk = (p) => `${Math.round(p[0] / eps)}_${Math.round(p[1] / eps)}`;
    const adj = new Map();
    for (const s of segs) {
      const a = kk(s.pts[0]), b = kk(s.pts[s.pts.length - 1]);
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push({ s, rev: false, to: b });
      adj.get(b).push({ s, rev: true, to: a });
    }
    // BFS diameter
    const bfs = (start) => {
      const dist = new Map([[start, 0]]);
      const prev = new Map();
      const q = [start];
      while (q.length) {
        const cur = q.shift();
        for (const e of adj.get(cur) || []) {
          if (!dist.has(e.to)) {
            dist.set(e.to, dist.get(cur) + polylineLength(e.s.pts));
            prev.set(e.to, { from: cur, e });
            q.push(e.to);
          }
        }
      }
      let far = start, fd = 0;
      for (const [k2, d] of dist) if (d > fd) { fd = d; far = k2; }
      return { far, fd, prev };
    };
    const first = adj.keys().next().value;
    const r1 = bfs(first);
    const r2 = bfs(r1.far);
    // reconstruct path r1.far -> r2.far
    const chain = [];
    let cur = r2.far;
    while (cur !== r1.far && r2.prev.has(cur)) {
      const { from, e } = r2.prev.get(cur);
      chain.unshift(e);
      cur = from;
    }
    let pts = [];
    for (const e of chain) {
      const p = e.rev ? [...e.s.pts].reverse() : e.s.pts;
      if (pts.length) pts.pop();
      pts = pts.concat(p);
    }
    // `layout.ends`: the deck runs between these two points by the shortest way through the segments instead of along
    // the graph's longest path (which wandered off along a ramp)
    if (def?.layout?.ends) {
      const c = chainBetween(segs, def.layout.ends.map((ll) => project(ll[0], ll[1])));
      if (c) { pts = c.pts; log(` bridge ${key}: deck from end to end by the shortest way (${c.len.toFixed(0)} m, ${c.jumps} jump${c.jumps === 1 ? '' : 's'} between carriageways)`); }
      else log(` bridge ${key}: no way between its ends, the longest path kept`);
    }
    if (pts.length < 2) { pts = segs[0].pts; }
    pts = simplify(pts, 1.0);
    // `centre`: the chain follows ONE strand (one carriageway of a divided deck); shift it sideways by the mean signed
    // offset of every strand's vertices, which is the axis between the carriageways
    if (def?.centre && pts.length >= 2) {
      let sum = 0, n = 0;
      for (const sg of segs) for (const [x, z] of sg.pts) {
        let bd2 = 1e18, off = 0;
        for (let i = 1; i < pts.length; i++) {
          const [x1, z1] = pts[i - 1], [x2, z2] = pts[i];
          const dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz || 1e-9;
          const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / L2));
          const px = x1 + dx * t, pz = z1 + dz * t, d2 = (x - px) ** 2 + (z - pz) ** 2;
          if (d2 < bd2) { bd2 = d2; off = ((x - x1) * -dz + (z - z1) * dx) / Math.sqrt(L2); }   // + = left of travel
        }
        if (bd2 < 40 * 40) { sum += off; n++; }
      }
      const m = n ? sum / n : 0;
      pts = pts.map((p, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
        return [p[0] - (dz / l) * m, p[1] + (dx / l) * m];
      });
      log(` bridge ${key}: deck moved ${m.toFixed(1)} m onto the axis of ${segs.length} strand pieces`);
    }
    // `osm`: carry the deck on along the bridge's OpenStreetMap alignment to its New Jersey landing (the CSCL chain ends
    // at the state line). The chain's New Jersey-side end is projected onto the OSM strand and the strand followed from
    // there, the approach past the abutment while it stays on the landing's land; the strand is shifted onto the chain's
    // end (a carriageway apart at most), the shift fading out over 300 m so the deck lands where the road does.
    let njFrom = null;
    if (def?.osm && B.landing && pts.length >= 2) {
      const Lg = B.landing;
      const O = Lg.bridge.map(([lon, lat]) => project(lon, lat));
      const ap = (Lg.approach || []).map(([lon, lat]) => project(lon, lat));
      for (let i = 1; i < ap.length; i++) { if (!onLand(ap[i][0], ap[i][1])) break; O.push(ap[i]); }
      const nj = O[O.length - 1];
      if (Math.hypot(pts[0][0] - nj[0], pts[0][1] - nj[1]) < Math.hypot(pts[pts.length - 1][0] - nj[0], pts[pts.length - 1][1] - nj[1])) pts = pts.slice().reverse();
      const E = pts[pts.length - 1];
      njFrom = E;   // (the CSCL chain's New Jersey end, the state line: the stations past it are New Jersey's)
      let best = null;
      for (let i = 1; i < O.length; i++) {
        const [x1, z1] = O[i - 1], [x2, z2] = O[i], dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((E[0] - x1) * dx + (E[1] - z1) * dz) / L2));
        const px = x1 + dx * t, pz = z1 + dz * t, d = Math.hypot(E[0] - px, E[1] - pz);
        if (!best || d < best.d) best = { d, i, x: px, z: pz };
      }
      if (best && best.d < 150) {
        const sx = E[0] - best.x, sz = E[1] - best.z;
        let run = 0, prev = [best.x, best.z];
        const add = [];
        for (let i = best.i; i < O.length; i++) {
          run += Math.hypot(O[i][0] - prev[0], O[i][1] - prev[1]);
          prev = O[i];
          const f = Math.max(0, 1 - run / 300);
          add.push([O[i][0] + sx * f, O[i][1] + sz * f]);
        }
        pts = pts.concat(simplify(add, 1.0));
        log(` bridge ${key}: deck carried ${polylineLength([E, ...add]).toFixed(0)} m on to its New Jersey landing (OSM; joined ${best.d.toFixed(1)} m from the CSCL end)`);
        // ...and back to the New York abutment when the CSCL chain starts short of it over the water (the Goethals
        // Bridge's chain began 13 m off the Staten Island shore): the OSM strand from its first point to where the
        // chain's start projects onto it, shifted onto that start the same way
        const S0 = pts[0];
        let b0 = null;
        for (let i = 1; i < O.length; i++) {
          const [x1, z1] = O[i - 1], [x2, z2] = O[i], dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz || 1e-9;
          const t = Math.max(0, Math.min(1, ((S0[0] - x1) * dx + (S0[1] - z1) * dz) / L2));
          const px = x1 + dx * t, pz = z1 + dz * t, d = Math.hypot(S0[0] - px, S0[1] - pz);
          if (!b0 || d < b0.d) b0 = { d, i, x: px, z: pz };
        }
        if (b0 && b0.d < 150 && !onLand(S0[0], S0[1])) {
          const sx = S0[0] - b0.x, sz = S0[1] - b0.z, pre = [];
          let run = 0, prev = [b0.x, b0.z];
          for (let i = b0.i - 1; i >= 0; i--) {
            run += Math.hypot(O[i][0] - prev[0], O[i][1] - prev[1]);
            prev = O[i];
            const f = Math.max(0, 1 - run / 300);
            pre.push([O[i][0] + sx * f, O[i][1] + sz * f]);
          }
          if (pre.length) { pts = simplify(pre.reverse(), 1.0).concat(pts); log(` bridge ${key}: deck carried ${polylineLength([...pre, S0]).toFixed(0)} m back to its New York abutment (OSM)`); }
        }
      } else log(` bridge ${key}: OSM alignment ${best ? best.d.toFixed(0) + ' m' : 'not'} near the CSCL end, deck left as it was`);
    }
    // a deck end still over water (the CSCL piece stops short of the shore): carried straight on, up to 600 m, to the
    // first land; an end left more than 12 m over the ground there keeps the deck's height and stands on an abutment
    // (city/bridgeKit.js draws one under every deck end above the ground)
    const keepHigh = [false, false];
    // (not for a deck with its own `ends`: those are where the streets take over, at grade or on their ramps)
    for (const endI of def?.layout?.ends ? [] : [0, 1]) {
      const P = endI === 0 ? pts[0] : pts[pts.length - 1], Q = endI === 0 ? pts[1] : pts[pts.length - 2];
      if (!P || !Q || onLand(P[0], P[1])) continue;
      const dl = Math.hypot(P[0] - Q[0], P[1] - Q[1]) || 1, ux = (P[0] - Q[0]) / dl, uz = (P[1] - Q[1]) / dl;
      let hit = 0;
      for (let d = 5; d <= 600; d += 5) if (onLand(P[0] + ux * d, P[1] + uz * d)) { hit = d + 8; break; }
      if (!hit) { log(` bridge ${key}: an end over water with no land within 600 m`); continue; }
      const Pn = [P[0] + ux * hit, P[1] + uz * hit];
      if (endI === 0) pts = [Pn, ...pts]; else pts = [...pts, Pn];
      keepHigh[endI] = true;
      log(` bridge ${key}: ${endI ? 'end' : 'start'} over water carried ${hit.toFixed(0)} m to land`);
    }
    // a bridge with its own layout: the main structure on its tower axis
    // `layout.pairs` (twin decks, the Goethals'): each pylon line a pair of supports, one a deck; this deck's are the ones
    // nearer its centre line, the other deck lies at their mean offset (`twin` in the record)
    let LAY = def?.layout || null, twin = null;
    if (LAY?.pairs) {
      // the two decks' lines: each pair's members split by the side of the line through the pairs' centres; this deck is
      // the side whose members lie nearer the centre line on the whole (a chain may cross from one deck to the other)
      const P = LAY.pairs.map((pair) => pair.map((ll) => ({ ll, p: project(ll[0], ll[1]) })));
      const C = P.map((pr) => [(pr[0].p[0] + pr[1].p[0]) / 2, (pr[0].p[1] + pr[1].p[1]) / 2]);
      const ux = C[C.length - 1][0] - C[0][0], uz = C[C.length - 1][1] - C[0][1], ul = Math.hypot(ux, uz) || 1;
      const side = (q, c) => Math.sign((q[0] - c[0]) * uz / ul - (q[1] - c[1]) * ux / ul);
      const bySide = { 1: [], [-1]: [] };
      P.forEach((pr, i) => pr.forEach((m) => bySide[side(m.p, C[i])].push(m)));
      const near = (list) => list.reduce((a, m) => a + stationOf(pts, m.p[0], m.p[1]).off, 0) / Math.max(1, list.length);
      const mine = near(bySide[1]) <= near(bySide[-1]) ? 1 : -1;
      LAY = { ...LAY, towers: bySide[mine].map((m) => m.ll) };
      // the other deck's signed offset across this one's line (+ to the left of increasing stations, as the kit's o)
      const other = bySide[-mine], ownA = bySide[mine][0].p, ownB = bySide[mine][bySide[mine].length - 1].p;
      const dx = ownB[0] - ownA[0], dz = ownB[1] - ownA[1], dl = Math.hypot(dx, dz) || 1;
      const oAcross = other.reduce((a, m) => a + ((m.p[0] - ownA[0]) * (dz / dl) - (m.p[1] - ownA[1]) * (dx / dl)), 0) / other.length;
      twin = +oAcross.toFixed(2);
      log(` bridge ${key}: twin deck ${twin} m across (sign along the pylon line from the first pair)`);
    }
    if (LAY?.towers) pts = straightenOnTowers(LAY, pts, log, key);
    const L = polylineLength(pts);
    // find in-water run
    let wStart = -1, wEnd = -1;
    const NSAMP = 60;
    for (let i = 0; i <= NSAMP; i++) {
      const [x, z] = alongPolyline(pts, (i / NSAMP) * L);
      const water = !onLand(x, z);
      if (water && wStart < 0) wStart = (i / NSAMP) * L;
      if (water) wEnd = (i / NSAMP) * L;
    }
    if (wStart < 0) { wStart = L * 0.3; wEnd = L * 0.7; }
    const clearance = def?.clearance ?? 10;
    let endAY = Math.max(sampleTerrain(pts[0][0], pts[0][1]), 2.5);
    let endBY = Math.max(sampleTerrain(pts[pts.length - 1][0], pts[pts.length - 1][1]), 2.5);
    // an `approach` deck ends where its ramps take over: each end rises to the highest lifted road ending within 12 m of
    // it (roadY's lift, 7 m a CSCL level), so the Verrazzano's 14 m upper-level ramps meet the deck instead of a 3 m end
    if (def?.approach) {
      const endLift = ([x, z]) => {
        let lv = 0;
        for (const [ax, az, lA, bx, bz, lB] of B.lifts) {
          if (Math.hypot(ax - x, az - z) < 12) lv = Math.max(lv, lA);
          if (Math.hypot(bx - x, bz - z) < 12) lv = Math.max(lv, lB);
        }
        return lv;
      };
      const la = endLift(pts[0]), lb = endLift(pts[pts.length - 1]);
      if (la > 0) endAY = Math.max(endAY, Math.max(sampleTerrain(pts[0][0], pts[0][1]), 1.5) + la * 7 + 0.02);
      if (lb > 0) endBY = Math.max(endBY, Math.max(sampleTerrain(pts[pts.length - 1][0], pts[pts.length - 1][1]), 1.5) + lb * 7 + 0.02);
      log(` bridge ${key}: deck ends at ${endAY.toFixed(1)} / ${endBY.toFixed(1)} m (ramp levels ${la} / ${lb})`);
    }
    // an end carried to land keeps the deck's height when the deck stands over 12 m above the ground there
    if (keepHigh[0] && clearance + 2 - endAY > 12) endAY = clearance + 2;
    if (keepHigh[1] && clearance + 2 - endBY > 12) endBY = clearance + 2;
    // ==== the New Jersey end (the bridges to New Jersey, `osm`): on the backdrop's ground, at the real grade the layout or
    // the profile gives toward it, no plateau (the landing patches go; until the backdrop drops its plateau blend at the
    // George Washington Bridge the lookup itself gives ~62 m there)
    const nj = def?.osm && njFrom ? backdrop() : null;
    const sNJ = nj ? stationOf(pts, njFrom[0], njFrom[1]).s : Infinity;
    if (nj) {
      const E = pts[pts.length - 1], hb = nj.at(E[0], E[1]);
      if (hb !== null && Number.isFinite(hb)) { const was = endBY; endBY = Math.max(hb, 1.0) + 0.3; log(` bridge ${key}: New Jersey end on the backdrop's ground at ${endBY.toFixed(1)} m (was ${was.toFixed(1)})`); }
    }
    const apex = Math.max(clearance + 2, endAY + 3, endBY + 3);
    const width = def?.width ?? Math.max(...segs.map((s) => s.width), 12);
    // deck profile: smooth ends->apex over water
    const smooth = (t2) => t2 * t2 * (3 - 2 * Math.min(1, Math.max(0, t2)));
    let prof = (d) => {
      if (d < wStart) { const t2 = d / Math.max(1, wStart); return endAY + (apex - endAY) * smooth(t2); }
      if (d > wEnd) { const t2 = (L - d) / Math.max(1, L - wEnd); return endBY + (apex - endBY) * smooth(t2); }
      return apex;
    };
    // `layout`: the bridge's own geometry (tower positions, spans, the roadway's real profile), see layoutOf
    const lay = LAY ? layoutOf(key, LAY, pts, L, endAY, endBY, log) : null;
    if (lay && twin !== null) {
      // the kit's o is + to the left of increasing stations: flip the twin's sign when the deck runs against the pylon
      // line's direction (first pair to last)
      const [t0, t1] = [lay.out.towers[0], lay.out.towers[lay.out.towers.length - 1]];
      const f = project(...LAY.towers[0]), sameDir = Math.hypot(t0.x - f[0], t0.z - f[1]) < Math.hypot(t1.x - f[0], t1.z - f[1]);
      lay.out.twin = sameDir ? twin : -twin;
    }
    if (lay) prof = lay.prof;
    const deck = [], ground = [];
    for (let d = 0; d <= L + 0.01; d += Math.max(8, L / 200)) {
      const dd = Math.min(d, L);
      const [x, z] = alongPolyline(pts, dd);
      deck.push([+x.toFixed(1), +prof(dd).toFixed(2), +z.toFixed(1)]);
      // the ground under the deck for the kit's piers: the terrain on land, null over the water (past the state line the
      // backdrop's ground where it is land, over 1 m)
      const hb = dd > sNJ ? nj.at(x, z) : null;
      ground.push(hb !== null && Number.isFinite(hb) && hb > 1.05 ? +hb.toFixed(2) : onLand(x, z) ? +sampleTerrain(x, z).toFixed(2) : null);
    }
    // towers
    const towers = [];
    if (lay) {
      for (const t of lay.towers) towers.push({ x: t.x, z: t.z, dirx: t.dirx, dirz: t.dirz, deckY: t.y, s: t.s });
    } else if (def && (def.type === 'suspension' || def.type === 'cantilever' || def.type === 'cablestayed')) {
      const tf = def.type === 'suspension' ? [0.22, 0.78] : [0.28, 0.72];
      // a def with the real main span puts the towers span / 2 either side of the water run's middle
      const tds = def.span ? [-0.5, 0.5].map((s) => Math.max(0, Math.min(L, (wStart + wEnd) / 2 + s * def.span)))
        : tf.map((f) => wStart + (wEnd - wStart) * f);
      for (const d of tds) {
        const [x, z, dx, dz] = alongPolyline(pts, d);
        towers.push({ x: +x.toFixed(1), z: +z.toFixed(1), dirx: +dx.toFixed(3), dirz: +dz.toFixed(3), deckY: +prof(d).toFixed(1) });
      }
    }
    bridgesOut.push({
      key, name: segs[0].name || key, type: def?.type ?? 'girder', tower: def?.tower, foot: !!def?.foot,
      towerH: def?.towerH ?? 0, clearance, width: +width.toFixed(1), promenade: !!def?.promenade,
      ...(def?.archRise ? { archRise: def.archRise } : {}), ...(def?.decks ? { decks: def.decks } : {}), ...(def?.span ? { span: def.span } : {}),
      deck, towers, waterRun: [+wStart.toFixed(1), +wEnd.toFixed(1)], length: +L.toFixed(1),
      ground, under: underDeck(B.near || [], pts, width), ...(lay ? { layout: lay.out } : {}),
    });
  }
  return bridgesOut;
}

// ---------------------------------------------------------------- a deck between two points
// the segments' ends clustered within 8 m (true distances, not a grid: two ends 0.2 m apart either side of a grid line
// were two nodes, and a bridge's carriageways came out as two to four separate graphs); carriageways that still do not
// meet are joined where they pass within 45 m of each other, at four times the cost of their length (the jump is a
// straight line, inside the stretch later put on the tower axis); the shortest way by Dijkstra
function chainBetween(segs, [A, B]) {
  const P = [];
  segs.forEach((s) => { P.push(s.pts[0], s.pts[s.pts.length - 1]); });
  const par = P.map((_, i) => i), find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const cells = new Map(), C = 8, ck = (x, z) => `${Math.floor(x / C)}_${Math.floor(z / C)}`;
  P.forEach((p, i) => { const k = ck(p[0], p[1]); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(i); });
  P.forEach((p, i) => {
    const cx = Math.floor(p[0] / C), cz = Math.floor(p[1] / C);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const j of cells.get(`${cx + dx}_${cz + dz}`) || []) {
      if (j !== i && Math.hypot(P[j][0] - p[0], P[j][1] - p[1]) < C) par[find(j)] = find(i);
    }
  });
  const nodeOf = P.map((_, i) => find(i)), ids = [...new Set(nodeOf)];
  const pos = new Map(ids.map((id) => [id, [0, 0, 0]]));
  P.forEach((p, i) => { const q = pos.get(nodeOf[i]); q[0] += p[0]; q[1] += p[1]; q[2]++; });
  for (const q of pos.values()) { q[0] /= q[2]; q[1] /= q[2]; }
  const adj = new Map(ids.map((id) => [id, []]));
  segs.forEach((s, k) => {
    const a = nodeOf[2 * k], b = nodeOf[2 * k + 1], L = polylineLength(s.pts);
    adj.get(a).push({ to: b, w: L, pts: s.pts });
    adj.get(b).push({ to: a, w: L, pts: [...s.pts].reverse() });
  });
  // components, then the jumps between them
  const comp = new Map();
  let nc = 0;
  for (const id of ids) {
    if (comp.has(id)) continue;
    nc++; const st = [id]; comp.set(id, nc);
    while (st.length) { const x = st.pop(); for (const e of adj.get(x)) if (!comp.has(e.to)) { comp.set(e.to, nc); st.push(e.to); } }
  }
  if (nc > 1) for (const a of ids) for (const b of ids) {
    if (a >= b || comp.get(a) === comp.get(b)) continue;
    const pa = pos.get(a), pb = pos.get(b), d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
    if (d > 45) continue;
    adj.get(a).push({ to: b, w: 4 * d, pts: [[pa[0], pa[1]], [pb[0], pb[1]]], jump: true });
    adj.get(b).push({ to: a, w: 4 * d, pts: [[pb[0], pb[1]], [pa[0], pa[1]]], jump: true });
  }
  const nearest = ([x, z]) => { let best = null, bd = 1e18; for (const id of ids) { const q = pos.get(id), d = (q[0] - x) ** 2 + (q[1] - z) ** 2; if (d < bd) { bd = d; best = id; } } return best; };
  const src = nearest(A), dst = nearest(B);
  const dist = new Map([[src, 0]]), prev = new Map(), done = new Set();
  for (;;) {
    let cur = null, cd = Infinity;
    for (const [k, d] of dist) if (!done.has(k) && d < cd) { cd = d; cur = k; }
    if (cur === null || cur === dst) break;
    done.add(cur);
    for (const e of adj.get(cur)) { const nd = cd + e.w; if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, { from: cur, e }); } }
  }
  if (!prev.has(dst)) return null;
  const path = [];
  for (let cur = dst; cur !== src;) { const { from, e } = prev.get(cur); path.unshift(e); cur = from; }
  let pts = [];
  for (const e of path) { if (pts.length) pts.pop(); pts = pts.concat(e.pts); }
  return { pts: simplify(pts, 1.0), len: polylineLength(pts), jumps: path.filter((e) => e.jump).length };
}

// ---------------------------------------------------------------- what passes under the deck
// station intervals [s0, s1, lift, rclass] where a road or path crosses under the deck's centre line (the road's width
// over the sine of the crossing angle, 2 m either side): the kit keeps its piers and walls out of them
function underDeck(near, pts, width) {
  const out = [];
  let run = 0;
  const segs = [];
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push([pts[i - 1], pts[i], run, l]); run += l; }
  for (const r of near) {
    for (let j = 1; j < r.pts.length; j++) {
      const [cx, cz] = r.pts[j - 1], [dx2, dz2] = r.pts[j];
      for (const [[ax, az], [bx, bz], s0, l] of segs) {
        const ex = bx - ax, ez = bz - az, fx = dx2 - cx, fz = dz2 - cz, den = ex * fz - ez * fx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((cx - ax) * fz - (cz - az) * fx) / den, u = ((cx - ax) * ez - (cz - az) * ex) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const sin = Math.abs(den) / (l * Math.hypot(fx, fz) || 1);
        const half = Math.min(60, r.w / 2 / Math.max(0.2, sin) + 2);
        const lift = r.lA + (r.lB - r.lA) * ((j - 1 + u) / Math.max(1, r.pts.length - 1));
        out.push([+(s0 + t * l - half).toFixed(1), +(s0 + t * l + half).toFixed(1), +lift.toFixed(2), r.rc]);
      }
    }
  }
  out.sort((a, b) => a[0] - b[0]);
  return out;
}

// ---------------------------------------------------------------- a bridge's own layout
// def.layout: { towers: [[lon, lat] | { near: [lon, lat] }, ...] (each tower's centre; a tower without a position stands
// `main` from the other, on the side toward `near`), main, side: [m, m] (the side spans, tower to anchorage), and the
// roadway's profile over mean high water (the water plane, y 0): yTower at the towers, yMid at mid-span (a parabola
// between), yAnch at the anchorages (straight side spans); past the anchorages the approach runs straight to the deck's
// end height, which the ramps and streets there set }. Every break of grade is rounded by a vertical curve (a moving
// average over `vc` metres). Stations are metres along the deck's centre line from its first point.
function stationOf(pts, x, z) {
  let best = { d2: 1e18, s: 0 }, run = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x1, z1] = pts[i - 1], [x2, z2] = pts[i], dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz || 1e-9, l = Math.sqrt(L2);
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / L2));
    const d2 = (x1 + dx * t - x) ** 2 + (z1 + dz * t - z) ** 2;
    if (d2 < best.d2) best = { d2, s: run + t * l };
    run += l;
  }
  return { s: best.s, off: Math.sqrt(best.d2) };
}
// the main structure on the line through its towers: a chain that follows one carriageway lies a roadway off the axis,
// so the deck's centre line between the anchorages (and `reach` metres past them) is replaced by the tower line, and
// eased back onto the chain over `ease` metres beyond; returns the new centre line
export function straightenOnTowers(LA, pts, log = () => {}, key = '') {
  // (a bridge of several spans, every pier given: the axis runs from the first pier to the last)
  if (LA.towers.length > 2) {
    const f = project(...LA.towers[0]), l = project(...LA.towers[LA.towers.length - 1]);
    LA = { ...LA, towers: [LA.towers[0], LA.towers[LA.towers.length - 1]], main: Math.hypot(l[0] - f[0], l[1] - f[1]) };
  }
  const T = LA.towers.map((t) => (Array.isArray(t) ? project(t[0], t[1]) : null));
  let A = T[0] || T[1], u;
  if (T[0] && T[1]) { const dx = T[1][0] - T[0][0], dz = T[1][1] - T[0][1], l = Math.hypot(dx, dz); u = [dx / l, dz / l]; LA = { ...LA, main: l }; }
  else {
    // one tower known: the chain's own direction over the main span, pointing toward the other tower's `near`
    const i = T[0] ? 1 : 0, near = project(...LA.towers[i].near);
    const s0 = stationOf(pts, A[0], A[1]).s, s1 = stationOf(pts, near[0], near[1]).s;
    const p0 = alongPolyline(pts, s0), p1 = alongPolyline(pts, s0 + Math.sign(s1 - s0) * Math.min(LA.main, Math.abs(s1 - s0) || LA.main));
    const dx = p1[0] - p0[0], dz = p1[1] - p0[1], l = Math.hypot(dx, dz) || 1;
    u = [dx / l, dz / l];
    if (i === 0) u = [-u[0], -u[1]];   // u runs from tower 0 to tower 1
  }
  if (!T[0]) A = [A[0] - u[0] * LA.main, A[1] - u[1] * LA.main];
  // the axis frame: r along u from tower 0, the signed offset across
  const rOf = (p) => (p[0] - A[0]) * u[0] + (p[1] - A[1]) * u[1];
  const oOf = (p) => -(p[0] - A[0]) * u[1] + (p[1] - A[1]) * u[0];
  const reach = LA.reach ?? 40, ease = LA.ease ?? 150;
  const r0 = -(LA.side[0] + reach), r1 = LA.main + LA.side[1] + reach;
  // resample the chain at 2 m so the eased stretch bends smoothly
  const Lc = polylineLength(pts), dense = [];
  for (let d = 0; d <= Lc + 1e-6; d += 2) dense.push(alongPolyline(pts, Math.min(d, Lc)).slice(0, 2));
  let moved = 0;
  const out = dense.map((p) => {
    const r = rOf(p), o = oOf(p);
    const w = r >= r0 && r <= r1 ? 1 : r < r0 ? Math.max(0, 1 - (r0 - r) / ease) : Math.max(0, 1 - (r - r1) / ease);
    if (w <= 0) return p;
    const k = w * w * (3 - 2 * w), oo = o * (1 - k);
    moved = Math.max(moved, Math.abs(o * k));
    return [A[0] + u[0] * r - u[1] * oo, A[1] + u[1] * r + u[0] * oo];
  });
  log(` bridge ${key}: centre line put on the tower axis between the anchorages (moved up to ${moved.toFixed(1)} m)`);
  return simplify(out, 0.05);
}
function layoutOf(key, LA, pts, L, endAY, endBY, log) {
  if (LA.kind === 'arch') return layoutArch(key, LA, pts, L, endAY, endBY, log);
  if (LA.kind) return layoutMovable(key, LA, pts, L, endAY, endBY, log);
  if (LA.towers.length > 2 || LA.spans) return layoutSpans(key, LA, pts, L, endAY, endBY, log);
  const tw = LA.towers.map((t) => (Array.isArray(t) ? stationOf(pts, ...project(t[0], t[1])) : null));
  for (let i = 0; i < tw.length; i++) if (!tw[i]) {
    const o = tw[1 - i], near = stationOf(pts, ...project(LA.towers[i].near[0], LA.towers[i].near[1]));
    tw[i] = { s: o.s + Math.sign(near.s - o.s) * LA.main, off: 0, placed: true };
  }
  const [a, b] = tw[0].s <= tw[1].s ? [tw[0], tw[1]] : [tw[1], tw[0]];
  const sA = a.s, sB = b.s, mid = (sA + sB) / 2, half = (sB - sA) / 2;
  // `side` is listed in the order of `towers`: re-ordered with them
  const side = tw[0].s <= tw[1].s ? LA.side : [LA.side[1], LA.side[0]];
  const sAn = [sA - side[0], sB + side[1]];
  if (sAn[0] < 0 || sAn[1] > L) log(` bridge ${key}: an anchorage lies past the deck's end (${sAn[0].toFixed(0)}, ${sAn[1].toFixed(0)} of ${L.toFixed(0)} m)`);
  const yT = LA.yTower, yM = LA.yMid, yAn = LA.yAnch ?? yT;
  const raw = (s) => {
    if (s >= sA && s <= sB) { const u = (s - mid) / half; return yT + (yM - yT) * (1 - u * u); }
    if (s < sA) {
      if (s >= sAn[0]) return yAn + ((yT - yAn) * (s - sAn[0])) / Math.max(1, side[0]);
      return sAn[0] <= 0 ? yAn : endAY + ((yAn - endAY) * s) / sAn[0];
    }
    if (s <= sAn[1]) return yT + ((yAn - yT) * (s - sB)) / Math.max(1, side[1]);
    return sAn[1] >= L ? yAn : yAn + ((endBY - yAn) * (s - sAn[1])) / (L - sAn[1]);
  };
  // vertical curves: a moving average over vc metres, a 1 m grid, the ends pinned (the window shrinks to them)
  const vc = LA.vc ?? 60, h = vc / 2, N = Math.ceil(L) + 1, Y = new Float64Array(N), S = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) Y[i] = raw(Math.min(i, L));
  for (let i = 0; i < N; i++) S[i + 1] = S[i] + Y[i];
  const Ys = new Float64Array(N);
  for (let i = 0; i < N; i++) { const w = Math.min(h, i, N - 1 - i), i0 = Math.round(i - w), i1 = Math.round(i + w); Ys[i] = (S[i1 + 1] - S[i0]) / (i1 - i0 + 1); }
  const prof = (s) => { const f = Math.max(0, Math.min(N - 1.0001, s)), i = Math.floor(f), t = f - i; return Ys[i] * (1 - t) + Ys[i + 1] * t; };
  const at = (s) => { const [x, z, dx, dz] = alongPolyline(pts, Math.max(0, Math.min(L, s))); return { s: +s.toFixed(2), x: +x.toFixed(2), z: +z.toFixed(2), dirx: +dx.toFixed(4), dirz: +dz.toFixed(4), y: +prof(s).toFixed(2) }; };
  const towers = [at(sA), at(sB)], anchorages = sAn.map(at);
  const grades = [(yAn - endAY) / Math.max(1, sAn[0]), (endBY - yAn) / Math.max(1, L - sAn[1])].map((g) => (100 * g).toFixed(1) + ' %');
  log(` bridge ${key}: towers at ${sA.toFixed(0)} / ${sB.toFixed(0)} m (${b.s - a.s > 0 ? (sB - sA).toFixed(1) : '?'} m apart; off the deck line ${a.off.toFixed(1)} / ${b.off.toFixed(1)} m), anchorages at ${sAn.map((v) => v.toFixed(0)).join(' / ')}, approach grades ${grades.join(' / ')}`);
  return { prof, towers, out: { towers, anchorages, main: [+sA.toFixed(2), +sB.toFixed(2)], side, mid: +mid.toFixed(2), yTower: yT, yMid: yM, yAnch: yAn } };
}

// a bridge of several spans on piers (the Queensboro's cantilevers): every pier's position given; the roadway at yTower
// over each pier, a parabolic crown in each span (yMid, a number or one per span), straight anchor arms down to yAnch at
// the anchorages (`side`: the anchor arms' lengths, first and last), the approaches to the ends
function layoutSpans(key, LA, pts, L, endAY, endBY, log) {
  let st = LA.towers.map((t) => stationOf(pts, ...project(t[0], t[1])).s);
  let order = st.map((_, i) => i);
  if (st[0] > st[st.length - 1]) order = order.reverse();
  st = order.map((i) => st[i]);
  const yMid = Array.isArray(LA.yMid) ? order.slice(0, -1).map((_, k) => LA.yMid[order[0] === 0 ? k : LA.yMid.length - 1 - k]) : st.slice(1).map(() => LA.yMid);
  const side = order[0] === 0 ? LA.side : [LA.side[1], LA.side[0]];
  const sA = st[0], sB = st[st.length - 1], sAn = [sA - side[0], sB + side[1]];
  const yT = LA.yTower, yAn = LA.yAnch ?? yT;
  const raw = (s) => {
    for (let k = 0; k + 1 < st.length; k++) if (s >= st[k] && s <= st[k + 1]) { const m = (st[k] + st[k + 1]) / 2, h = (st[k + 1] - st[k]) / 2, u = (s - m) / h; return yT + (yMid[k] - yT) * (1 - u * u); }
    if (s < sA) { if (s >= sAn[0]) return yAn + ((yT - yAn) * (s - sAn[0])) / Math.max(1, side[0]); return sAn[0] <= 0 ? yAn : endAY + ((yAn - endAY) * s) / sAn[0]; }
    if (s <= sAn[1]) return yT + ((yAn - yT) * (s - sB)) / Math.max(1, side[1]);
    return sAn[1] >= L ? yAn : yAn + ((endBY - yAn) * (s - sAn[1])) / (L - sAn[1]);
  };
  const vc = LA.vc ?? 60, h = vc / 2, N = Math.ceil(L) + 1, Y = new Float64Array(N), S = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) Y[i] = raw(Math.min(i, L));
  for (let i = 0; i < N; i++) S[i + 1] = S[i] + Y[i];
  const Ys = new Float64Array(N);
  for (let i = 0; i < N; i++) { const w = Math.min(h, i, N - 1 - i), i0 = Math.round(i - w), i1 = Math.round(i + w); Ys[i] = (S[i1 + 1] - S[i0]) / (i1 - i0 + 1); }
  const prof = (s) => { const f = Math.max(0, Math.min(N - 1.0001, s)), i = Math.floor(f), t = f - i; return Ys[i] * (1 - t) + Ys[i + 1] * t; };
  const at = (s) => { const [x, z, dx, dz] = alongPolyline(pts, Math.max(0, Math.min(L, s))); return { s: +s.toFixed(2), x: +x.toFixed(2), z: +z.toFixed(2), dirx: +dx.toFixed(4), dirz: +dz.toFixed(4), y: +prof(s).toFixed(2) }; };
  const towers = st.map(at), anchorages = sAn.map(at);
  const grades = [(yAn - endAY) / Math.max(1, sAn[0]), (endBY - yAn) / Math.max(1, L - sAn[1])].map((g) => (100 * g).toFixed(1) + ' %');
  log(` bridge ${key}: piers at ${st.map((v) => v.toFixed(0)).join(' / ')} m (spans ${st.slice(1).map((v, k) => (v - st[k]).toFixed(1)).join(', ')}), anchorages at ${sAn.map((v) => v.toFixed(0)).join(' / ')}, approach grades ${grades.join(' / ')}`);
  return { prof, towers, out: { towers, anchorages, main: [+sA.toFixed(2), +sB.toFixed(2)], side, mid: +((sA + sB) / 2).toFixed(2), piers: st.map((v) => +v.toFixed(2)), yTower: yT, yMid, yAnch: yAn } };
}

// a movable bridge (LA.kind 'swing', 'lift' or 'bascule'): its piers (a swing span's pivot, a lift span's two towers, a
// bascule's two piers) from the ENC; the roadway level at LA.y over the movable span and `flat` metres either side of it,
// the approaches straight to the deck's ends, vertical curves over `vc`
// an arch bridge (LA.kind 'arch'): each arch given by its centre and span ([[lon, lat], m]); the roadway at LA.y over the
// arches and `flat` metres either side, the approaches straight to the ends
function layoutArch(key, LA, pts, L, endAY, endBY, log) {
  const arches = LA.arches.map(([ll, span]) => { const c = stationOf(pts, ...project(ll[0], ll[1])).s; return [c - span / 2, c + span / 2]; }).sort((a, b) => a[0] - b[0]);
  const flat = LA.flat ?? 15, c0 = Math.max(1, arches[0][0] - flat), c1 = Math.min(L - 1, arches[arches.length - 1][1] + flat);
  const raw = (s) => (s < c0 ? endAY + ((LA.y - endAY) * s) / c0 : s > c1 ? LA.y + ((endBY - LA.y) * (s - c1)) / Math.max(1, L - c1) : LA.y);
  const vc = LA.vc ?? 50, h = vc / 2, N = Math.ceil(L) + 1, Y = new Float64Array(N), S = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) Y[i] = raw(Math.min(i, L));
  for (let i = 0; i < N; i++) S[i + 1] = S[i] + Y[i];
  const Ys = new Float64Array(N);
  for (let i = 0; i < N; i++) { const w = Math.min(h, i, N - 1 - i), i0 = Math.round(i - w), i1 = Math.round(i + w); Ys[i] = (S[i1 + 1] - S[i0]) / (i1 - i0 + 1); }
  const prof = (s) => { const f = Math.max(0, Math.min(N - 1.0001, s)), i = Math.floor(f), t = f - i; return Ys[i] * (1 - t) + Ys[i + 1] * t; };
  const at = (s) => { const [x, z, dx, dz] = alongPolyline(pts, Math.max(0, Math.min(L, s))); return { s: +s.toFixed(2), x: +x.toFixed(2), z: +z.toFixed(2), dirx: +dx.toFixed(4), dirz: +dz.toFixed(4), y: +prof(s).toFixed(2) }; };
  const grades = [(LA.y - endAY) / c0, (endBY - LA.y) / Math.max(1, L - c1)].map((g) => (100 * g).toFixed(1) + ' %');
  log(` bridge ${key}: arches ${arches.map(([a, b]) => `${a.toFixed(0)}-${b.toFixed(0)}`).join(', ')} m, the roadway at ${LA.y} m, approach grades ${grades.join(' / ')}`);
  return { prof, towers: [], out: { kind: 'arch', arches: arches.map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)]), y: LA.y, towers: arches.map(([a, b]) => at((a + b) / 2)), main: [+arches[0][0].toFixed(2), +arches[arches.length - 1][1].toFixed(2)], anchorages: [at(c0), at(c1)] } };
}
function layoutMovable(key, LA, pts, L, endAY, endBY, log) {
  // (a pier given as { after: m } stands that far on from the one before it along the deck)
  const st0 = [];
  for (const p of LA.piers) st0.push(Array.isArray(p) ? stationOf(pts, ...project(p[0], p[1])).s : st0[st0.length - 1] + p.after);
  const st = st0.sort((a, b) => a - b);
  const half = LA.kind === 'swing' ? LA.span / 2 : 0, flat = LA.flat ?? 20;
  const c0 = Math.max(1, st[0] - half - flat), c1 = Math.min(L - 1, st[st.length - 1] + half + flat);
  const raw = (s) => (s < c0 ? endAY + ((LA.y - endAY) * s) / c0 : s > c1 ? LA.y + ((endBY - LA.y) * (s - c1)) / Math.max(1, L - c1) : LA.y);
  const vc = LA.vc ?? 50, h = vc / 2, N = Math.ceil(L) + 1, Y = new Float64Array(N), S = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) Y[i] = raw(Math.min(i, L));
  for (let i = 0; i < N; i++) S[i + 1] = S[i] + Y[i];
  const Ys = new Float64Array(N);
  for (let i = 0; i < N; i++) { const w = Math.min(h, i, N - 1 - i), i0 = Math.round(i - w), i1 = Math.round(i + w); Ys[i] = (S[i1 + 1] - S[i0]) / (i1 - i0 + 1); }
  const prof = (s) => { const f = Math.max(0, Math.min(N - 1.0001, s)), i = Math.floor(f), t = f - i; return Ys[i] * (1 - t) + Ys[i + 1] * t; };
  const at = (s) => { const [x, z, dx, dz] = alongPolyline(pts, Math.max(0, Math.min(L, s))); return { s: +s.toFixed(2), x: +x.toFixed(2), z: +z.toFixed(2), dirx: +dx.toFixed(4), dirz: +dz.toFixed(4), y: +prof(s).toFixed(2) }; };
  const towers = st.map(at);
  const grades = [(LA.y - endAY) / c0, (endBY - LA.y) / Math.max(1, L - c1)].map((g) => (100 * g).toFixed(1) + ' %');
  log(` bridge ${key}: ${LA.kind} piers at ${st.map((v) => v.toFixed(0)).join(' / ')} m, the roadway at ${LA.y} m from ${c0.toFixed(0)} to ${c1.toFixed(0)}, approach grades ${grades.join(' / ')}`);
  return { prof, towers, out: { kind: LA.kind, towers, piers: st.map((v) => +v.toFixed(2)), span: LA.span ?? null, y: LA.y, main: [+st[0].toFixed(2), +st[st.length - 1].toFixed(2)], anchorages: [at(c0), at(c1)] } };
}

// ---------------------------------------------------------------- standalone: rebuild a tile set's bridges.json
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.resolve(process.argv[2] || 'public/tiles');
  const inputs = JSON.parse(fs.readFileSync(path.join(dir, 'bridge_inputs.json'), 'utf8'));
  const out = buildBridgeRecords(inputs);
  const file = path.join(dir, 'bridges.json');
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`bridges: ${out.length} written to ${file}: ${out.map((b) => b.key).join(', ')}`);
}
