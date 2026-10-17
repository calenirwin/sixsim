"""The backdrop's shared definitions (docs/notes/r2-backdrop.md): the projection of client/src/shared/geo.js, the region,
the paths, and the CTL1 container of client/tools/pipeline/binio.mjs (read and write), so the Python records steps and
the Node builders exchange the same files.
"""
import json
import math
import os
import struct

import numpy as np

# ---- client/src/shared/geo.js
LAT0 = 40.7831
LON0 = -73.9712
M_PER_DEG_LAT = 111132.0
M_PER_DEG_LON = 111320.0 * math.cos(math.radians(LAT0))
TILE = 512
MACRO = 2048


def project(lon, lat):
    """lon/lat (degrees, arrays or scalars) -> world x (east), z (south) in metres"""
    return (np.asarray(lon) - LON0) * M_PER_DEG_LON, -(np.asarray(lat) - LAT0) * M_PER_DEG_LAT


def unproject(x, z):
    return np.asarray(x) / M_PER_DEG_LON + LON0, -np.asarray(z) / M_PER_DEG_LAT + LAT0


# ---- the region: the five boroughs' line buffered by BUFFER_M, inside the box (lon/lat)
BUFFER_M = 25000.0
BOX_LONLAT = (-74.56, 40.27, -73.40, 41.15)   # west, south, east, north
_bx0, _bz1 = project(BOX_LONLAT[0], BOX_LONLAT[1])
_bx1, _bz0 = project(BOX_LONLAT[2], BOX_LONLAT[3])
BOX_XZ = (float(_bx0), float(_bz0), float(_bx1), float(_bz1))   # x0, z0, x1, z1 (world metres)

# ---- levels (the persistent tier's chunk grid: L<n> squares of 128 * 2^n m from the world origin)
LEVEL_SIZE = {3: 1024, 4: 2048, 5: 4096, 6: 8192}

# ---- paths
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))   # the checkout
RAW = os.path.join(ROOT, 'client', 'data', 'raw')
RAW_BD = os.path.join(RAW, 'backdrop')
AUX = os.environ.get('BD_AUX', '/data0/projectnyc_aux/tiles_backdrop')
WORK = os.environ.get('BD_WORK', os.path.join(AUX, 'work'))
REC = os.environ.get('BD_REC', os.path.join(AUX, 'records'))


def ensure(d):
    os.makedirs(d, exist_ok=True)
    return d


# ---- CTL1: magic 'CTL1' u32 | header length u32 | header JSON | pad to 4 | sections (each padded to 4)
_TYPES = {'Float32Array': np.float32, 'Uint8Array': np.uint8, 'Uint32Array': np.uint32, 'Int16Array': np.int16,
          'Uint16Array': np.uint16, 'Int32Array': np.int32, 'Float64Array': np.float64}
_NAMES = {np.dtype(v).str: k for k, v in _TYPES.items()}


def write_ctl(path, header, sections):
    """sections: [(name, numpy array)] in a JS typed-array dtype; written atomically"""
    meta, bufs, off = [], [], 0
    for name, arr in sections:
        a = np.ascontiguousarray(arr)
        t = _NAMES.get(a.dtype.newbyteorder('<').str if a.dtype.byteorder == '>' else a.dtype.str)
        if t is None:
            raise ValueError(f'{name}: dtype {a.dtype} has no typed array')
        b = a.astype(a.dtype.newbyteorder('<'), copy=False).tobytes()
        meta.append({'name': name, 'type': t, 'offset': off, 'bytes': len(b), 'length': int(a.size)})
        bufs.append(b)
        off += len(b)
        if off % 4:
            pad = 4 - off % 4
            bufs.append(b'\0' * pad)
            off += pad
    h = json.dumps({**header, 'sections': meta}, separators=(',', ':')).encode('utf-8')
    pre = struct.pack('<II', 0x43544C31, len(h))
    pad = (4 - (8 + len(h)) % 4) % 4
    tmp = f'{path}.{os.getpid()}.tmp'
    with open(tmp, 'wb') as f:
        f.write(pre + h + b'\0' * pad)
        for b in bufs:
            f.write(b)
    os.replace(tmp, path)


def read_ctl(path):
    buf = open(path, 'rb').read()
    magic, hl = struct.unpack('<II', buf[:8])
    if magic != 0x43544C31:
        raise ValueError('bad CTL1 magic: ' + path)
    header = json.loads(buf[8:8 + hl].decode('utf-8'))
    base = 8 + hl + (4 - (8 + hl) % 4) % 4
    S = {}
    for s in header['sections']:
        S[s['name']] = np.frombuffer(buf, _TYPES[s['type']], s['length'], base + s['offset'])
    return header, S
