# Fork and reference audit — 2026-10-22

**The Toronto port is not complete.** Branding correction, geographic adaptation and third-party attribution are separate tasks. This audit corrects the repository and documentation entry points while preserving the working importer/demo and upstream implementation.

## Provenance and scope

GitHub identifies `mkturkcan/valdrada` as both parent and source of `calenirwin/sixsim`. Main and the fork base are `eaee8b10b7962ca71efbeedfe80a7634405c1286`. The inspected PR #1 head was `48f3de238efa23d9600fbe7a4656714be3065f4b`. Upstream HEAD observed on this date was `3a017c1cb4c49b4a669043526e67a0e4118b3a30`; the base was zero commits ahead and one behind it. No upstream update was merged. BoundlessNYC names occur in inherited files; this does not establish a second independent source repository or permission grant.

The [inventory](reference-inventory.tsv) records all 476 tracked UTF-8 files containing case-insensitive `nyc`, `new york`, `valdrada` or `boundless` at that PR head (2720 matches). It is a reproducible file-level lexical inventory, not proof that every historical identifier needs changing or that nonmatching geographic assumptions are absent. Mixed files can contain both operational names and attribution. Binary assets were not text-audited.

| Class / examples | Disposition | Remaining work |
|---|---|---|
| Original author, MIT copyright, acknowledgements, citation, OSM and asset notices | Preserve verbatim; SixSim credit is additional | Check notices for every future bundled asset; code licence never replaces data terms |
| README and MkDocs product identity | Present SixSim as Toronto fork, preserve upstream overview separately | Keep status tied to actual reviewed branch rather than implying main contains the prototype |
| NYC guides, API examples, media and legacy fixture | Label as inherited NYC reference | Rewrite individual examples only when their Toronto path exists and is tested |
| `client/src/shared/geo.js`, `server/main.js`, `core/api/session.mjs`, bridge map metadata | Retain existing NYC defaults; Toronto profile is isolated | City-profile propagation through all clients, API origins and map metadata is not implemented |
| Compiler/source fetchers, landmarks, facades, Central Park and NYC actor assets | Preserve upstream behaviour and licence headers | Toronto-specific inputs and deliberate feature selection; no blind substitutions |
| Python `valdrada` namespace, `@nyc` aliases, Electron `boundless://`, environment variables, package names and Unreal paths | Retain compatibility identifiers | Rename only with migration plan, import/protocol tests and a demonstrated need |
| Upstream release, Hugging Face and project links | Retain where they actually identify upstream resources | They are not SixSim Toronto releases; access failures must not be bypassed |

## Licensing boundary

[LICENSING.md](../licensing.md) and [ACKNOWLEDGEMENTS.md](../acknowledgements.md) remain authoritative repository inventories of inherited component notices. Code is MIT; documentation/original media are CC BY 4.0. OSM-derived NYC data are ODbL, CARLA and several models are CC BY, other assets include CC0 and font licences. MetaHuman and packaged Unreal content carry additional restrictions. The large external asset bundle has not been comprehensively downloaded or re-audited here, so this is not clearance to redistribute it.

The separate Toronto subset has its own provenance and Toronto licence notice; it does not convert inherited OSM databases or third-party art into Toronto-licensed content. See [source evidence](data-sources.md#massing-licence-evidence). Original copyright, citation and attribution were not removed or reassigned.

## What this pass changes

The top-level README and site home explain current Toronto scope and point to a roadmap, data register and decision list. The upstream README is retained as `UPSTREAM.md`; inherited site guides receive a visible scope notice. Site repository identity and included-file links point to SixSim. This is documentation/configuration work, not a renderer, API, simulation or full-city port. Existing deployment workflow reconciliation remains later technical debt.
