# Toronto city simulation

A Toronto city model built on Valdrada’s simulation framework: traceable buildings and transport networks, shared spatial tiles, scheduled transit and explicit behavioral models. The goal is to explore urban mobility and compare scenarios without confusing simulated behavior with observations.

![Toronto source geometry and scheduled transit](toronto/demo.jpg)

Start with the [Toronto demo and walkthrough](toronto/demo.md), then the [architecture and roadmap](toronto/vision.md) and [data-source register](toronto/data-sources.md). The walkthrough includes source coverage, a fixed-dwell experiment and local static Space packaging. The repository README explains how to run the Toronto headless server and connect the existing Python client. The upstream guides describe the inherited NYC dataset and renderer; their assets and geographic assumptions are not interchangeable with Toronto.

SixSim is a working name. This fork is maintained by Calen Irwin and derives from [Valdrada](https://github.com/mkturkcan/valdrada), created by Mehmet Kerem Turkcan. Original copyright and component terms are preserved in [licensing](licensing.md), [acknowledgements](acknowledgements.md) and [citation](citation.md). Contains information licensed under the Open Government Licence – Toronto; dataset provenance and conflicting catalogue metadata are documented in the source register.
