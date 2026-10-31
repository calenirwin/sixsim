# Legacy corridor study

The standalone `corridor.html` and `toronto.html` pages are retained data-inspection studies. They are not the main Toronto simulation or its current demo entrypoint.

Use the [Toronto demo walkthrough](demo.md) for the shared world, main browser renderer, district geometry, scheduled transit and fixed-dwell experiment. The [architecture and roadmap](vision.md) and [source register](data-sources.md) describe the model and its limitations.

To inspect the historical study locally, `npm --prefix client run review:toronto` opens its route-view page. Its separate 15-record massing crop and procedural fixture must not be confused with the real district dataset used by the main application. Original source attribution remains with each fixture.
