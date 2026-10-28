---
title: Toronto city simulation
emoji: 🚋
colorFrom: blue
colorTo: gray
sdk: static
app_file: index.html
short_description: Toronto source geometry and scheduled transit in the Valdrada framework
---

# Toronto city simulation

Explore real City building massing and streets around Spadina with TTC 510 schedule-derived transit playback. Use **Queen & Spadina**, **About & sources**, Pause/Play, Restart and the time slider. Drag to orbit and scroll/pinch to zoom. WebGL2 is required; all rendering runs on your device.

This is a bounded Toronto adaptation of [Valdrada](https://github.com/mkturkcan/valdrada), created by Mehmet Kerem Turkcan. [SixSim](https://github.com/calenirwin/sixsim) is the fork's provisional working name, maintained by Calen Irwin.

The five-minute recording uses the pinned 2026-10-22 service day in America/Toronto. Buildings cover about 2.15 km²; route coverage extends beyond them. Moving symbols are scheduled positions, not live vehicle observations, surveyed track positions or interacting traffic. Ground is flat. An extra-dwell scenario, when selected at build time, is labeled in the application.

Code is MIT; documentation and data retain their separate terms in [component licensing](LICENSING.md.txt). Contains information licensed under the Open Government Licence – Toronto. [Source provenance](DATA_SOURCES.json), [upstream acknowledgements](ACKNOWLEDGEMENTS.md.txt), and the [code licence](LICENSE.txt) accompany this package. No City or TTC endorsement is implied.

This prebuilt static package needs no server process, API key, GPU instance or external asset CDN. Its commit identity is recorded in `deployment.json`.
