"""MkDocs hook. Some site pages include files from outside docs/ (BUILDING.md, ACKNOWLEDGEMENTS.md, client/*.md),
whose relative links are written against the repository. On those pages, links to files that are also site pages are
pointed at the pages, and links to any other repository file are pointed at GitHub."""
import os
import posixpath
import re
import subprocess

REPO = "https://github.com/calenirwin/sixsim"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# Link included source files to the revision being documented, including new fixtures.
try:
    REVISION = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()
except (OSError, subprocess.CalledProcessError):
    REVISION = "c10289dba8d24a2138b99976c26394c0944575da"  # Source archive fallback containing both Toronto studies.
SITE = {  # repository path -> site page (directory URL)
    "BUILDING.md": "building/",
    "ACKNOWLEDGEMENTS.md": "acknowledgements/",
    "LICENSING.md": "licensing/",
    "client/DATA_SOURCES.md": "data-sources/",
    "client/README.md": "client/",
    "docs/api/getting_started.md": "api/getting_started/",
    "docs/api/python_api.md": "api/python_api/",
    "docs/api/protocol.md": "api/protocol/",
}
INCLUDED = {  # site page -> repository directory of the file it includes
    "building.md": "", "acknowledgements.md": "", "licensing.md": "", "data-sources.md": "client", "client.md": "client",
}
HREF = re.compile(r'href="([^"#]*)(#[^"]*)?"')


def on_page_content(html, page, config, files):
    base = INCLUDED.get(page.file.src_uri)
    if base is None:
        return html
    up = "../" * page.url.count("/")

    def fix(m):
        href, frag = m.group(1), m.group(2) or ""
        if not href or re.match(r"^[a-z]+:", href) or href.startswith("/"):
            return m.group(0)
        rel = posixpath.normpath(posixpath.join(base, href))
        if rel.startswith(".."):
            return m.group(0)
        if rel in SITE:
            return f'href="{up}{SITE[rel]}{frag}"'
        full = os.path.join(ROOT, *rel.split("/"))
        if os.path.exists(full):
            return f'href="{REPO}/{"tree" if os.path.isdir(full) else "blob"}/{REVISION}/{rel}{frag}"'
        return m.group(0)

    return HREF.sub(fix, html)


def on_page_markdown(markdown, page, config, files):
    """Keep inherited documentation visibly distinct from Toronto capability."""
    path = page.file.src_uri
    if path == "index.md" or path.startswith("toronto/") or path in {"licensing.md", "acknowledgements.md", "citation.md"}:
        return markdown
    return ("> **Inherited Valdrada / NYC reference.** These capabilities and examples are not a completed Toronto port. "
            "See the SixSim Toronto roadmap and source register in the navigation.\n\n" + markdown)
