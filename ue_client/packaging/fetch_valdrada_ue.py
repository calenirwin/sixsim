#!/usr/bin/env python3
"""Download, verify and assemble ValdradaUE, the Unreal Engine 5 build of Valdrada.

    python3 fetch_valdrada_ue.py                         the latest version for this system, into ./ValdradaUE-<version>-<platform>
    python3 fetch_valdrada_ue.py --version 0.5.0 --platform linux --dest ~/ValdradaUE
    python3 fetch_valdrada_ue.py --mirror huggingface    from the Hugging Face copy instead of GitHub (HF_TOKEN if it is private)
    python3 fetch_valdrada_ue.py --from-dir ~/Downloads  use release files already downloaded by hand (checked, not fetched)
    python3 fetch_valdrada_ue.py --verify --dest DIR     check an installed package against its manifest

A release is described by its manifest, ValdradaUE-<version>-<platform>.json, published next to the files. Every item
of the manifest is one file of the installed package or one archive to unpack into it, stored as one or more parts
(GitHub accepts files up to 2 GiB). Each part is downloaded (resumed when interrupted), checked against its SHA256,
then the parts of an item are joined and the item is checked against its own SHA256 before it is written or unpacked.
Nothing that fails a check is installed. Python 3.8 or later, standard library only.
"""
import argparse
import concurrent.futures as cf
import hashlib
import io
import json
import os
import platform
import shutil
import sys
import tarfile
import time
import urllib.error
import urllib.request
import zipfile

SCHEMA = 'valdrada.ue.release/1'
REPO = 'mkturkcan/valdrada'
GITHUB = 'https://github.com/{repo}/releases/download/v{version}/'
GITHUB_LATEST = 'https://api.github.com/repos/{repo}/releases/latest'
HF = 'https://huggingface.co/datasets/mehmetkeremturkcan/valdrada-ue/resolve/v{version}/'
CHUNK = 1 << 20
UA = {'User-Agent': 'fetch_valdrada_ue/1'}


def log(*a):
    print('[fetch]', *a, flush=True)


def human(n):
    for u in ('B', 'KB', 'MB', 'GB', 'TB'):
        if n < 1000 or u == 'TB':
            return f'{n:.1f} {u}' if u != 'B' else f'{n} B'
        n /= 1000


def sha256_file(path, progress=None):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(CHUNK * 4), b''):
            h.update(b)
            if progress:
                progress(len(b))
    return h.hexdigest()


def this_platform():
    s = platform.system()
    if s == 'Linux':
        return 'linux'
    if s == 'Windows':
        return 'win64'
    sys.exit(f'ValdradaUE is built for Linux and Windows x64; this system is {s}')


def latest_version():
    req = urllib.request.Request(GITHUB_LATEST.format(repo=REPO), headers=dict(UA, Accept='application/vnd.github+json'))
    with urllib.request.urlopen(req, timeout=60) as r:
        tag = json.load(r)['tag_name']
    return tag[1:] if tag.startswith('v') else tag


def open_url(url, start=0):
    headers = dict(UA)
    # a private Hugging Face copy needs a token (HF_TOKEN); it is sent to huggingface.co only
    if os.environ.get('HF_TOKEN') and url.startswith('https://huggingface.co/'):
        headers['Authorization'] = 'Bearer ' + os.environ['HF_TOKEN']
    if start:
        headers['Range'] = f'bytes={start}-'
    return urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=120)


def download(url, dest, size, sha, retries=6):
    """Fetch url into dest (resuming a .partial file), check its size and SHA256; True when dest is good."""
    if os.path.exists(dest) and os.path.getsize(dest) == size and sha256_file(dest) == sha:
        return True
    part = dest + '.partial'
    for attempt in range(retries):
        try:
            have = os.path.getsize(part) if os.path.exists(part) else 0
            if have > size:
                os.remove(part); have = 0
            if have < size:
                with open_url(url, have) as r:
                    if have and r.status != 206:      # the server ignored the range: start over
                        have = 0
                    with open(part, 'ab' if have else 'wb') as f:
                        shutil.copyfileobj(r, f, CHUNK)
            if os.path.getsize(part) != size:
                raise IOError(f'size {os.path.getsize(part)} instead of {size}')
            got = sha256_file(part)
            if got != sha:
                os.remove(part)
                raise IOError(f'SHA256 mismatch ({got[:12]}... instead of {sha[:12]}...)')
            os.replace(part, dest)
            return True
        except (urllib.error.URLError, IOError, OSError) as e:
            wait = min(60, 5 * 2 ** attempt)
            log(f'  {os.path.basename(dest)}: {e}; retry {attempt + 1}/{retries} in {wait} s')
            time.sleep(wait)
    return False


class Chain(io.RawIOBase):
    """The parts of an item read as one stream, hashed on the way (for unpacking without writing the joined file)."""

    def __init__(self, paths):
        self.paths = list(paths); self.f = None; self.h = hashlib.sha256()

    def readable(self):
        return True

    def readinto(self, b):
        while True:
            if self.f is None:
                if not self.paths:
                    return 0
                self.f = open(self.paths.pop(0), 'rb')
            n = self.f.readinto(b)
            if n:
                self.h.update(memoryview(b)[:n])
                return n
            self.f.close(); self.f = None

    def drain(self):
        while self.readinto(bytearray(CHUNK)):
            pass
        return self.h.hexdigest()


def safe_join(root, rel):
    p = os.path.realpath(os.path.join(root, rel))
    if not (p == os.path.realpath(root) or p.startswith(os.path.realpath(root) + os.sep)):
        raise ValueError(f'unsafe path in archive: {rel}')
    return p


def unpack(item, paths, dest):
    """Unpack a tar (any compression tarfile reads) or zip archive item from its verified parts into dest/item['dest']."""
    root = os.path.join(dest, item.get('dest', '.'))
    os.makedirs(root, exist_ok=True)
    strip = item.get('strip', '')
    if item['format'] == 'zip':
        joined = paths[0]
        if len(paths) > 1:
            joined = os.path.join(os.path.dirname(paths[0]), item['name'])
            with open(joined, 'wb') as g:
                for p in paths:
                    with open(p, 'rb') as f:
                        shutil.copyfileobj(f, g, CHUNK)
        with zipfile.ZipFile(joined) as z:
            for m in z.infolist():
                name = m.filename[len(strip):] if strip and m.filename.startswith(strip) else m.filename
                if not name or (strip and not m.filename.startswith(strip)):
                    continue
                out = safe_join(root, name)
                if m.is_dir():
                    os.makedirs(out, exist_ok=True); continue
                os.makedirs(os.path.dirname(out), exist_ok=True)
                with z.open(m) as f, open(out, 'wb') as g:
                    shutil.copyfileobj(f, g, CHUNK)
                mode = (m.external_attr >> 16) & 0o777
                if mode & 0o111:
                    os.chmod(out, mode)
        return None
    stream = Chain(paths)
    with tarfile.open(fileobj=io.BufferedReader(stream, CHUNK), mode='r|*') as t:
        for m in t:
            name = m.name[len(strip):] if strip and m.name.startswith(strip) else m.name
            if not name or (strip and not m.name.startswith(strip)):
                continue
            if m.issym() or m.islnk():
                safe_join(root, os.path.join(os.path.dirname(name), m.linkname))
            m.name = name
            safe_join(root, name)
            if hasattr(tarfile, 'data_filter'):
                t.extract(m, root, filter='data')
            else:
                t.extract(m, root)
    return stream.drain()


def install(man, args):
    plat, ver = man['platform'], man['version']
    dest = os.path.abspath(args.dest or f'ValdradaUE-{ver}-{plat}')
    dl = os.path.abspath(args.from_dir or os.path.join(dest, '.download'))
    os.makedirs(dest, exist_ok=True); os.makedirs(dl, exist_ok=True)
    base = man['mirrors'].get(args.mirror) if not args.base_url else args.base_url
    if not base and not args.from_dir:
        sys.exit(f'the manifest names no {args.mirror} mirror (it has: {", ".join(man["mirrors"])})')
    parts = [(it, p) for it in man['items'] for p in it['parts']]
    need = sum(p['size'] for _, p in parts) + sum(it['size'] for it in man['items'] if len(it['parts']) > 1 and it['kind'] == 'file')
    free = shutil.disk_usage(dest).free
    log(f'ValdradaUE {ver} for {plat}: {len(man["items"])} items in {len(parts)} files, {human(man["download_bytes"])} to download, '
        f'{human(man["installed_bytes"])} installed; {human(free)} free at {dest}')
    if free < man['installed_bytes'] + (0 if args.from_dir else man['download_bytes']) and not args.force:
        sys.exit(f'not enough disk space: {human(man["installed_bytes"] + man["download_bytes"])} needed (--force to try anyway)')

    # 1. every part, downloaded and checked
    def get(it_p):
        it, p = it_p
        path = os.path.join(dl, p['asset'])
        if args.from_dir:
            ok = os.path.exists(path) and os.path.getsize(path) == p['size'] and sha256_file(path) == p['sha256']
        else:
            ok = download(base + p['asset'], path, p['size'], p['sha256'])
        return p['asset'], ok
    t0 = time.time(); done = 0; failed = []
    with cf.ThreadPoolExecutor(args.jobs) as ex:
        for name, ok in ex.map(get, parts):
            done += 1
            log(f'  [{done}/{len(parts)}] {name}: {"ok" if ok else "FAILED"}')
            if not ok:
                failed.append(name)
    if failed:
        sys.exit(f'{len(failed)} files failed (run again to resume): {", ".join(failed[:5])}')
    log(f'downloaded and checked in {time.time() - t0:.0f} s')

    # 2. the items, assembled and checked, then written or unpacked
    for it in man['items']:
        paths = [os.path.join(dl, p['asset']) for p in it['parts']]
        if it['kind'] == 'file':
            out = safe_join(dest, it['name'])
            os.makedirs(os.path.dirname(out), exist_ok=True)
            if len(paths) == 1:
                if os.path.exists(out):
                    os.remove(out)
                if args.from_dir or args.keep_downloads:
                    try:
                        os.link(paths[0], out)          # same file system: no copy
                    except OSError:
                        shutil.copyfile(paths[0], out)
                else:
                    shutil.move(paths[0], out)
            else:
                with open(out + '.partial', 'wb') as g:
                    for p in paths:
                        with open(p, 'rb') as f:
                            shutil.copyfileobj(f, g, CHUNK)
                if sha256_file(out + '.partial') != it['sha256']:
                    os.remove(out + '.partial')
                    sys.exit(f'{it["name"]}: the joined parts do not match the SHA256 of the manifest')
                os.replace(out + '.partial', out)
            if it.get('mode'):
                os.chmod(out, int(it['mode'], 8))
            log(f'  wrote {it["name"]}')
        else:
            h = unpack(it, paths, dest)
            if h and h != it['sha256']:
                sys.exit(f'{it["name"]}: the archive does not match the SHA256 of the manifest')
            log(f'  unpacked {it["name"]} into {it.get("dest", ".")}')
    with open(os.path.join(dest, 'valdrada_ue_manifest.json'), 'w') as f:
        json.dump(man, f, indent=1)
    if not args.from_dir and not args.keep_downloads:
        shutil.rmtree(dl, ignore_errors=True)
    run = './ValdradaUE.sh' if plat == 'linux' else 'ValdradaUE.bat'
    log(f'installed in {dest}\n  start:   {run}\n  Python:  pip install {os.path.join(dest, "PythonAPI")}\n  then:    '
        f'import valdrada; client = valdrada.Client("localhost", 2000)')


def verify(man, args):
    dest = os.path.abspath(args.dest)
    bad = 0
    for it in man['items']:
        if it['kind'] != 'file':
            continue
        p = os.path.join(dest, it['name'])
        ok = os.path.exists(p) and os.path.getsize(p) == it['size'] and sha256_file(p) == it['sha256']
        bad += not ok
        log(f'  {it["name"]}: {"ok" if ok else "MISSING OR CHANGED"}')
    log('all files match' if not bad else f'{bad} files do not match: run the download again')
    return 1 if bad else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--version', help='the release (default: the latest on GitHub)')
    ap.add_argument('--platform', choices=['linux', 'win64'], help='default: this system')
    ap.add_argument('--dest', help='the folder to install into (default ./ValdradaUE-<version>-<platform>)')
    ap.add_argument('--mirror', default='github', choices=['github', 'huggingface'])
    ap.add_argument('--manifest', help='a manifest file or URL instead of the release\'s')
    ap.add_argument('--base-url', help='where the release files are (overrides the mirror; for tests)')
    ap.add_argument('--from-dir', help='a folder that already holds the release files (nothing is downloaded)')
    ap.add_argument('--jobs', type=int, default=4, help='parallel downloads (default 4)')
    ap.add_argument('--keep-downloads', action='store_true', help='keep the downloaded files after installing')
    ap.add_argument('--verify', action='store_true', help='check an installed package (--dest) against its manifest')
    ap.add_argument('--force', action='store_true', help='skip the disk space check')
    a = ap.parse_args()
    plat = a.platform or this_platform()
    if a.verify:
        m = os.path.join(a.dest or '.', 'valdrada_ue_manifest.json')
        sys.exit(verify(json.load(open(m)), a))
    if a.manifest:
        src = a.manifest
    else:
        ver = a.version or latest_version()
        name = f'ValdradaUE-{ver}-{plat}.json'
        src = os.path.join(a.from_dir, name) if a.from_dir else (GITHUB.format(repo=REPO, version=ver) if a.mirror == 'github' else HF.format(version=ver)) + name
    if src.startswith(('http://', 'https://')):
        with open_url(src) as r:
            man = json.load(r)
    else:
        man = json.load(open(src))
    if man.get('schema') != SCHEMA:
        sys.exit(f'unknown manifest schema {man.get("schema")} (this script reads {SCHEMA}; download the script of that release)')
    if man['platform'] != plat:
        log(f'note: installing the {man["platform"]} build on a {this_platform()} system')
    install(man, a)


if __name__ == '__main__':
    main()
