"""Terrain sources for R5.6 (docs/notes/tile-system.md): unpack, survey and hillshade the bare-earth DEMs.

  python3 dem_tools.py unzip <zip> <member> <out>          stream-inflate one member of a (64-bit) zip, CRC-checked
  python3 dem_tools.py info <tif>                          size, tiling, codec, georeference, extent (EPSG and lon/lat)
  python3 dem_tools.py coverage <tif> <out.png> <out.json> every tile decoded once: valid share, min and max per tile
  python3 dem_tools.py hillshade <tif> <lon> <lat> <half_px> <out.png> [label]
                                                           a full-resolution hillshade crop centred on a point

The city's 2017 DEM (bh_NYC.tif) is a BigTIFF of 154,859 x 153,378 one-foot float32 cells in 512-pixel LZW tiles, so
nothing here reads the whole raster: tiles are decoded one at a time from their offsets (tifffile + imagecodecs).
Elevations are US survey feet (NAVD88) on EPSG:2263 for the city set, metres (NAVD88) on UTM 18N for the USGS tiles.
"""
import json
import math
import struct
import sys
import zlib

import numpy as np


def unzip_member(zpath, member, out):
    with open(zpath, 'rb') as f:
        f.seek(0, 2)
        total = f.tell()
        f.seek(max(0, total - 65536 - 22))
        tail = f.read()
        i = tail.rfind(b'PK\x05\x06')
        _, _, _, _, ntot, cdsize, cdoff, _ = struct.unpack('<IHHHHIIH', tail[i:i + 22])
        z = tail.rfind(b'PK\x06\x07')
        if z >= 0 and (cdoff == 0xFFFFFFFF or ntot == 0xFFFF):
            off64 = struct.unpack('<Q', tail[z + 8:z + 16])[0]
            f.seek(off64)
            rec = f.read(56)
            cdsize, cdoff = struct.unpack('<QQ', rec[40:56])
        f.seek(cdoff)
        cd = f.read(cdsize)
        p = 0
        hit = None
        while p < len(cd) and cd[p:p + 4] == b'PK\x01\x02':
            (_, _, _, _, meth, _, _, crc, csz, usz, fnl, exl, cml, _, _, _, lho) = struct.unpack('<IHHHHHHIIIHHHHHII', cd[p:p + 46])
            name = cd[p + 46:p + 46 + fnl].decode('utf-8', 'replace')
            extra = cd[p + 46 + fnl:p + 46 + fnl + exl]
            q = 0
            while q + 4 <= len(extra):
                hid, hsz = struct.unpack('<HH', extra[q:q + 4])
                body = extra[q + 4:q + 4 + hsz]
                if hid == 1:
                    k = 0
                    if usz == 0xFFFFFFFF: usz = struct.unpack('<Q', body[k:k + 8])[0]; k += 8
                    if csz == 0xFFFFFFFF: csz = struct.unpack('<Q', body[k:k + 8])[0]; k += 8
                    if lho == 0xFFFFFFFF: lho = struct.unpack('<Q', body[k:k + 8])[0]; k += 8
                q += 4 + hsz
            if name == member:
                hit = (meth, crc, csz, usz, lho)
            p += 46 + fnl + exl + cml
        if not hit:
            raise SystemExit('member not found: ' + member)
        meth, crc, csz, usz, lho = hit
        f.seek(lho)
        lh = f.read(30)
        fnl, exl = struct.unpack('<HH', lh[26:30])
        f.seek(lho + 30 + fnl + exl)
        d = zlib.decompressobj(-15) if meth == 8 else None
        left, c, n = csz, 0, 0
        with open(out, 'wb') as o:
            while left > 0:
                chunk = f.read(min(left, 16 << 20))
                if not chunk:
                    break
                left -= len(chunk)
                data = d.decompress(chunk) if d else chunk
                c = zlib.crc32(data, c)
                n += len(data)
                o.write(data)
            if d:
                data = d.flush()
                c = zlib.crc32(data, c)
                n += len(data)
                o.write(data)
        ok = (c & 0xFFFFFFFF) == crc and n == usz
        print(json.dumps({'member': member, 'bytes': n, 'expected': usz, 'crc': '%08x' % (c & 0xFFFFFFFF), 'crcExpected': '%08x' % crc, 'ok': ok}))
        if not ok:
            raise SystemExit(1)


def open_tif(path):
    import tifffile
    tif = tifffile.TiffFile(path)
    page = tif.pages[0]
    tags = page.tags
    scale = tags['ModelPixelScaleTag'].value
    tie = tags['ModelTiepointTag'].value
    nod = tags.get('GDAL_NODATA')
    nodata = float(nod.value) if nod is not None else None
    geo = {'x0': tie[3] - tie[0] * scale[0], 'y0': tie[4] + tie[1] * scale[1], 'sx': scale[0], 'sy': scale[1], 'nodata': nodata}
    return tif, page, geo


def epsg_of(page):
    # DEM_EPSG overrides (the city's file defines its State Plane zone by parameters, not by code: EPSG:2263 per its
    # metadata); otherwise the projected CRS key, then the geographic one
    import os
    if os.environ.get('DEM_EPSG'):
        return int(os.environ['DEM_EPSG'])
    gk = page.tags.get('GeoKeyDirectoryTag')
    if gk is None:
        return None
    v = list(gk.value)
    keys = {v[i]: (v[i + 1], v[i + 3]) for i in range(4, len(v), 4)}
    for k in (3072, 2048):
        if k in keys and keys[k][0] == 0 and keys[k][1] not in (0, 32767):
            if k == 2048 and 3072 in keys:   # a user-defined projection over a geographic datum: not a lon/lat raster
                return None
            return keys[k][1]
    return None


def info(path):
    import os
    tif, page, geo = open_tif(path)
    W, H = page.imagewidth, page.imagelength
    epsg = epsg_of(page)
    out = {
        'file': os.path.basename(path), 'bytes': os.path.getsize(path), 'width': W, 'height': H,
        'tile': [page.tilewidth, page.tilelength], 'tiles': len(page.dataoffsets), 'dtype': str(page.dtype),
        'compression': str(page.compression), 'predictor': str(page.predictor), 'epsg': epsg, 'pixel': [geo['sx'], geo['sy']],
        'extent': [geo['x0'], geo['y0'] - H * geo['sy'], geo['x0'] + W * geo['sx'], geo['y0']], 'nodata': geo['nodata'],
    }
    if epsg:
        from pyproj import Transformer
        t = Transformer.from_crs(epsg, 4326, always_xy=True)
        x0, y0, x1, y1 = out['extent']
        lo0, la0 = t.transform(x0, y0)
        lo1, la1 = t.transform(x1, y1)
        out['lonlat'] = [round(lo0, 5), round(la0, 5), round(lo1, 5), round(la1, 5)]
    print(json.dumps(out))
    return out


def read_window(tif, page, c0, r0, w, h):
    """float32 window (rows r0..r0+h, cols c0..c0+w) decoded tile by tile; NaN outside the raster"""
    TW, TH = page.tilewidth, page.tilelength
    W, H = page.imagewidth, page.imagelength
    nx = (W + TW - 1) // TW
    out = np.full((h, w), np.nan, np.float32)
    fh = tif.filehandle
    for ty in range(max(0, r0 // TH), min((H - 1) // TH, (r0 + h - 1) // TH) + 1):
        for tx in range(max(0, c0 // TW), min((W - 1) // TW, (c0 + w - 1) // TW) + 1):
            idx = ty * nx + tx
            off, cnt = page.dataoffsets[idx], page.databytecounts[idx]
            if not cnt:
                continue
            fh.seek(off)
            seg = page.decode(fh.read(cnt), idx)[0]
            tile = np.asarray(seg, np.float32).reshape(TH, TW)
            ya, xa = ty * TH, tx * TW
            y0, y1 = max(ya, r0), min(ya + TH, r0 + h)
            x0, x1 = max(xa, c0), min(xa + TW, c0 + w)
            out[y0 - r0:y1 - r0, x0 - c0:x1 - c0] = tile[y0 - ya:y1 - ya, x0 - xa:x1 - xa]
    return out


def coverage(path, png, js):
    from PIL import Image
    import time
    tif, page, geo = open_tif(path)
    TW, TH = page.tilewidth, page.tilelength
    W, H = page.imagewidth, page.imagelength
    nx, ny = (W + TW - 1) // TW, (H + TH - 1) // TH
    share = np.zeros((ny, nx), np.float32)
    nvalid = 0
    lo = np.full((ny, nx), np.nan, np.float32)
    hi = np.full((ny, nx), np.nan, np.float32)
    nod = geo['nodata']
    fh = tif.filehandle
    t0 = time.time()
    for idx in range(nx * ny):
        cnt = page.databytecounts[idx]
        if not cnt:
            continue
        fh.seek(page.dataoffsets[idx])
        a = np.asarray(page.decode(fh.read(cnt), idx)[0], np.float32).reshape(TH, TW)
        ty, tx = divmod(idx, nx)
        a = a[:min(TH, H - ty * TH), :min(TW, W - tx * TW)]
        ok = np.isfinite(a)
        if nod is not None:
            ok &= a > nod + 1
        k = ok.mean()
        nvalid += int(ok.sum())
        share[ty, tx] = k
        if k > 0:
            v = a[ok]
            lo[ty, tx], hi[ty, tx] = v.min(), v.max()
        if idx % 5000 == 0:
            print('tile', idx, 'of', nx * ny, round(time.time() - t0), 's', flush=True)
    img = (np.clip(share, 0, 1) * 255).astype(np.uint8)
    Image.fromarray(img).save(png)
    # the city's raster is in US survey feet (EPSG:2263), the USGS tiles in metres (UTM)
    feet = epsg_of(page) == 2263
    u = 0.3048006096012192 if feet else 1.0
    res = {
        'tiles': int(nx * ny), 'tilesWithData': int((share > 0).sum()), 'validCells': nvalid,
        'validAreaKm2': round(nvalid * geo['sx'] * geo['sy'] * u * u / 1e6, 1), 'units': 'US survey ft' if feet else 'm',
        'elevationRange': [float(np.nanmin(lo)), float(np.nanmax(hi))], 'seconds': round(time.time() - t0),
    }
    json.dump(res, open(js, 'w'), indent=1)
    print(json.dumps(res))


def hillshade_arr(z, cell, az=315.0, alt=45.0):
    zz = np.where(np.isfinite(z), z, np.nan)
    gy, gx = np.gradient(zz, cell)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    a, b = math.radians(360.0 - az + 90.0), math.radians(alt)
    hs = np.sin(b) * np.cos(slope) + np.cos(b) * np.sin(slope) * np.cos(a - aspect)
    return np.clip(hs, 0, 1)


def hillshade(path, lon, lat, half, png, label=''):
    from PIL import Image, ImageDraw
    from pyproj import Transformer
    tif, page, geo = open_tif(path)
    epsg = epsg_of(page)
    x, y = Transformer.from_crs(4326, epsg, always_xy=True).transform(lon, lat)
    c = int((x - geo['x0']) / geo['sx'])
    r = int((geo['y0'] - y) / geo['sy'])
    z = read_window(tif, page, c - half, r - half, 2 * half, 2 * half)
    nod = geo['nodata']
    if nod is not None:
        z[z <= nod + 1] = np.nan
    hs = hillshade_arr(z, geo['sx'])
    valid = np.isfinite(z)
    zmin, zmax = (float(np.nanmin(z)), float(np.nanmax(z))) if valid.any() else (None, None)
    # hillshade with a light elevation tint: low ground blue-grey, high ground warm
    t = np.zeros_like(z)
    if zmin is not None and zmax > zmin:
        t = np.clip((np.nan_to_num(z, nan=zmin) - zmin) / (zmax - zmin), 0, 1)
    base = np.nan_to_num(hs, nan=0.0)
    rgb = np.stack([base * (0.80 + 0.25 * t), base * (0.84 + 0.12 * t), base * (0.92 - 0.12 * t)], -1)
    rgb[~valid] = [0.12, 0.16, 0.22]
    img = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8))
    if label:
        d = ImageDraw.Draw(img)
        d.rectangle([0, 0, img.width, 22], fill=(0, 0, 0))
        d.text((6, 5), label, fill=(255, 255, 255))
    img.save(png)
    print(json.dumps({'png': png, 'center': [lon, lat], 'px': 2 * half, 'cell': geo['sx'], 'zmin': zmin, 'zmax': zmax, 'valid': round(float(valid.mean()), 4)}))


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'unzip':
        unzip_member(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == 'info':
        info(sys.argv[2])
    elif cmd == 'coverage':
        coverage(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == 'hillshade':
        hillshade(sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), int(sys.argv[5]), sys.argv[6], sys.argv[7] if len(sys.argv) > 7 else '')
