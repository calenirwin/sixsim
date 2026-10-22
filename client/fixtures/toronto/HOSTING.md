# Free static hosting assessment (2026-10-21)

The Toronto massing viewer is a good fit for **CAD $0/month static hosting** within
the user's CAD $20–30/month total ceiling. No hosting, account change, paid plan,
compute, DNS change or deployment has been performed in this pass.

`npm --prefix client run build:toronto` produces `client/dist-toronto/` (~650 KB
uncompressed, including a default index.html, provenance, source subset and notices). It runs WebGL on the visitor's device and needs only static file serving.
The browser test serves it at `/sixsim/`, rejects nonlocal/root-relative requests,
and verifies that the single tile and downloadable evidence load. No remote data
API, server-side rendering, secrets, cookies or database are required.

| Option | Fit and limits | Later deployment work, not executed |
|---|---|---|
| GitHub Pages | Free for public repositories; SixSim is public. Published site limit 1 GB; soft bandwidth limit 100 GB/month. This bounded demo is far below those limits. Pages terms exclude commercial transaction/SaaS hosting; this proposal is a project demonstration. | Publish only `dist-toronto` to an agreed project path, keeping assets and notices together. Use the generated `index.html`; `toronto.html` remains a compatible entry. Preserve/reconcile the existing docs Pages workflow rather than silently replacing it. |
| Hugging Face Static Space | Official docs say static Spaces are free and do not run compute. Supports plain HTML, or a build command with `app_file`. | Use `sdk: static`, `app_file: index.html` and upload the prebuilt folder plus its attributed data/notices. Requires an explicitly chosen Space and authorized access; none created. Avoid choosing Docker/Gradio/paid hardware for this viewer. |

Primary sources checked:
[GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits),
[Hugging Face static HTML Spaces](https://huggingface.co/docs/hub/spaces-sdks-static).
No guarantee of unlimited traffic or service availability is implied. Free hosting
here applies to this compact static study, **not** to full-city asset hosting,
Electron/Python TCP simulation, UE rendering or server GPU workloads.

Before deployment: choose the destination, verify the final built screenshot and
included notices, and decide how to retain the upstream documentation site. No
paid fallback is authorized or necessary for this limited demo.

## Verified static package and recovery

`build:toronto` now emits a default `index.html` and deterministic `PACKAGE.json`
with relative file paths, exact bytes and SHA256 hashes (no timestamp). The
package includes the original licences and attributed source/provenance downloads.
Builds fail above **800,000 bytes total**, **700,000 bytes JavaScript**, or one
**16,384-byte tile**, and reject unexpected asset types/symlinks. These are demo
budgets, not hosting-provider quotas. Current checked output is 648,573 bytes,
with 607,481 bytes of JS and a 4,084-byte tile.

```sh
npm --prefix client run test:toronto:delivery
npm --prefix client run test:toronto:repro
CHROMIUM_PATH=/usr/bin/chromium npm --prefix client run test:toronto:static
# Optional manual inspection of the ordinary static directory:
python -m http.server 8080 --directory client/dist-toronto --bind 127.0.0.1
# http://127.0.0.1:8080/
```

The reproducibility check compares two clean builds under the same installed
lockfile dependencies/Node environment. It is not a claim of byte identity across
arbitrary Vite, Node or OS versions. CI uploads `toronto-static-demo` as a reviewable
build artifact; upload is not a website deployment.

A plain HTTP file server (no Vite fallback) is tested at `/`, `/sixsim/` and
`/nested/demo/`. Missing files return 404 rather than an HTML app fallback.
Transport tests bound the tile download to 15 seconds, including response-body
stalls, and 16 KiB, including chunked transfers. Browser tests cover HTTP failures,
network failures, HTML fallback responses, truncated and oversized tiles, module
load failure, unavailable WebGL and WebGL context loss. The viewer reports a failure, disables view
controls and offers a full reload; recovery produces one canvas. It does not
silently retry, fetch a city bank or infer missing geometry.

Limits: an unavailable initial bootstrap script or disabled JavaScript cannot run
this recovery logic; the page includes a noscript explanation. A successful fetch
is still subject to the existing decoder. Importer/schema/coordinate integrity
review is separate from these transport and packaging checks.

## Subsequent offline corridor addition

The 510 Spadina schedule study adds `corridor.html` and a pinned 1.77 MB JSON slice. The combined package is now approximately 2.44 MB uncompressed with a 2.6 MB ceiling; JavaScript/tile ceilings remain unchanged. The original massing page does not fetch this schedule asset. Both entries remain static and require no new service. See `../transit/README.md` for provenance and limitations. Earlier sizes above describe the massing-only baseline.
