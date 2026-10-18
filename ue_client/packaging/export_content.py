#!/usr/bin/env python3
"""List, or pack for transfer, the uncooked packages a Windows build of ValdradaUE must cook: exactly the packages the
Linux cook cooked, so the Windows machine receives neither the city build's stale levels nor its other projects' work.

  python3 export_content.py --list content_files.txt          the files, relative to the project's Content/
  python3 export_content.py --tar ValdradaUE-content.tar      a tar of them
  python3 export_content.py --tar ... --part-mib 1900         cut into parts for a file system or upload limit

Reads the cooked tree of the last Linux cook (ue_client/ValdradaUE/Saved/Cooked/Linux/ValdradaUE/Content) and finds each
package's source in the project's Content/ (which may be a symbolic link to the city build's project). On the Windows
machine, unpack it into ue_client\\ValdradaUE\\Content (a real folder there): tar -xf ValdradaUE-content.tar -C Content
(Windows 10 and 11 have tar.exe).
"""
import argparse, os, subprocess, sys, tarfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.abspath(os.path.join(HERE, '..', 'ValdradaUE'))
SRC_EXT = ('.uasset', '.umap')
SIDE_EXT = ('.ubulk', '.uptnl', '.upayload', '.m.ubulk')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--project', default=PROJ, help='the project folder (default %(default)s)')
    ap.add_argument('--cooked', default=None, help='the cooked Content folder (default <project>/Saved/Cooked/Linux/<name>/Content)')
    ap.add_argument('--list', help='write the relative paths here')
    ap.add_argument('--tar', help='write a tar of the files here')
    ap.add_argument('--part-mib', type=int, default=0, help='cut the tar into parts of this size (0: one file)')
    a = ap.parse_args()
    name = os.path.basename(os.path.normpath(a.project))
    cooked = a.cooked or os.path.join(a.project, 'Saved', 'Cooked', 'Linux', name, 'Content')
    content = os.path.realpath(os.path.join(a.project, 'Content'))
    if not os.path.isdir(cooked):
        sys.exit(f'no cooked content at {cooked}: cook for Linux first (package_linux.sh)')
    files, missing, total = [], 0, 0
    for dp, dn, fn in os.walk(cooked):
        dn.sort()
        for f in sorted(fn):
            stem, ext = os.path.splitext(f)
            if ext not in SRC_EXT:
                continue
            rel_dir = os.path.relpath(dp, cooked)
            src = os.path.join(content, rel_dir, f)
            if not os.path.exists(src):
                missing += 1
                continue
            for e in (ext,) + SIDE_EXT:
                q = os.path.join(content, rel_dir, stem + e)
                if os.path.exists(q):
                    rel = os.path.normpath(os.path.join(rel_dir, stem + e)).replace(os.sep, '/')
                    files.append(rel); total += os.path.getsize(q)
    print(f'{len(files)} files, {total / 1e9:.2f} GB from {content}' + (f'; {missing} cooked packages have no source here (engine or plugin content)' if missing else ''))
    if a.list:
        with open(a.list, 'w') as f:
            f.write('\n'.join(files) + '\n')
    if a.tar:
        t0 = time.time()
        with tarfile.open(a.tar, 'w', format=tarfile.PAX_FORMAT) as t:
            for rel in files:
                t.add(os.path.join(content, rel), rel, recursive=False)
        print(f'{a.tar}: {os.path.getsize(a.tar) / 1e9:.2f} GB in {time.time() - t0:.0f} s')
        if a.part_mib:
            subprocess.run(['split', '-b', f'{a.part_mib}M', '-d', '-a', '3', a.tar, a.tar + '.'], check=True)
            os.remove(a.tar)
            print(f'cut into parts {a.tar}.000 ... (join: cat {os.path.basename(a.tar)}.* > {os.path.basename(a.tar)}; '
                  f'Windows: copy /b {os.path.basename(a.tar)}.000+{os.path.basename(a.tar)}.001+... {os.path.basename(a.tar)})')


if __name__ == '__main__':
    main()
