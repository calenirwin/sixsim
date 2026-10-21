# Free static hosting assessment (2026-10-21)

The Toronto massing viewer is a good fit for **CAD $0/month static hosting** within
the user's CAD $20–30/month total ceiling. No hosting, account change, paid plan,
compute, DNS change or deployment has been performed in this pass.

`npm --prefix client run build:toronto` produces `client/dist-toronto/` (~640 KB
uncompressed; ~605 KB JS, 24 KB source subset, 4 KB CTL1 tile plus HTML/provenance/
notices). It runs WebGL on the visitor's device and needs only static file serving.
The browser test serves it at `/sixsim/`, rejects nonlocal/root-relative requests,
and verifies that the single tile and downloadable evidence load. No remote data
API, server-side rendering, secrets, cookies or database are required.

| Option | Fit and limits | Later deployment work, not executed |
|---|---|---|
| GitHub Pages | Free for public repositories; SixSim is public. Published site limit 1 GB; soft bandwidth limit 100 GB/month. This bounded demo is far below those limits. Pages terms exclude commercial transaction/SaaS hosting; this proposal is a project demonstration. | Publish only `dist-toronto` to an agreed project path, keeping assets and notices together. Use `toronto.html` as the entry or deliberately rename it to `index.html`. Preserve/reconcile the existing docs Pages workflow rather than silently replacing it. |
| Hugging Face Static Space | Official docs say static Spaces are free and do not run compute. Supports plain HTML, or a build command with `app_file`. | Use `sdk: static`, `app_file: toronto.html` and upload the prebuilt folder plus its attributed data/notices. Requires an explicitly chosen Space and authorized access; none created. Avoid choosing Docker/Gradio/paid hardware for this viewer. |

Primary sources checked:
[GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits),
[Hugging Face static HTML Spaces](https://huggingface.co/docs/hub/spaces-sdks-static).
No guarantee of unlimited traffic or service availability is implied. Free hosting
here applies to this compact static study, **not** to full-city asset hosting,
Electron/Python TCP simulation, UE rendering or server GPU workloads.

Before deployment: choose the destination, verify the final built screenshot and
included notices, and decide how to retain the upstream documentation site. No
paid fallback is authorized or necessary for this limited demo.
