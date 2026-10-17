# UE (AR34, 2026-10-06): the `bx` material families as instances of the project's master materials (ue_project/Python/
# ue_masters.py), the counterpart of blender_nodes.py's apply(). Runs inside the engine from ue_take.py after the USD import.
#
# The mapping is data: ue_families.json (family or asset kind -> master and parameter rows). The importer translates every
# USD material's UsdPreviewSurface into a material instance of its own; each one whose prim (the asset's USD user data,
# else its name) carries a `bx` tag (usd_mat.py; ue_prep.py copies the tags into ue_<shot>.json with absolute texture
# paths), or whose name matches an asset rule, is re-parented to its master and filled from the tag alone. FN below are the
# values the table derives (blender_nodes.py's 'web' trim mode: every surface keeps the web's balance against the road).
# Also here, for what a -game render cannot fix itself: the USD plugin's own masters copied with the Nanite and instancing
# usages, leaf cards alpha-tested (Nanite draws no translucency), the families that cast no shadow, the assets drawn
# without Nanite. Textures are imported once per take into /Game/Takes/<shot>/BxTex.
import json, math, os, re, time
import unreal

mel = unreal.MaterialEditingLibrary
eal = unreal.EditorAssetLibrary
HERE = os.path.dirname(os.path.abspath(__file__))
TABLE = json.load(open(os.path.join(HERE, 'ue_families.json')))
USAGES = ('MATUSAGE_NANITE', 'MATUSAGE_INSTANCED_STATIC_MESHES', 'MATUSAGE_SKELETAL_MESH', 'MATUSAGE_GEOMETRY_CACHE')


def _lum3(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


NET = (TABLE.get('trim') or {}).get('mode', 'web') == 'net'


def factors(tags, phys=False):
    """the night level and the trims (ue_families.json trim.mode): 'net', the web's net diffuse albedo (applyLightTrim's
    lt = mix(0.30, 0.88, night) x the material's trim); 'web', blender_nodes.py's mode (ROAD_K, UNTRIM_K); phys (R3-PHYS,
    ue_take --light phys, the default): the untrimmed albedos, as blender_nodes --bxtrim phys (no trim, no street
    calibration, the walls' value curve x 1)."""
    g = next((P for P in tags.values() if P.get('kind') == 'ground'), None)
    night = float((g or {}).get('night', next((P.get('night') for P in tags.values() if P.get('night') is not None), 0.05)) or 0.0)
    cal = (g or {}).get('lb14StCal') or [1.94, 1.70, 1.47]
    lt = 0.30 + 0.58 * night
    road_k = _lum3([c + (1.0 - c) * night for c in cal])
    if phys: return {'night': night, 'lt': lt, 'road_k': 1.0, 'untrim_k': 1.0, 'net': False, 'phys': True}   # R3-PHYS
    if NET: return {'night': night, 'lt': lt, 'road_k': 1.0 / lt, 'untrim_k': 1.0, 'net': True}
    return {'night': night, 'lt': lt, 'road_k': road_k, 'untrim_k': 1.0 / (lt * road_k), 'net': False}


def get(P, path, default=None):
    """a dotted path into a tag ('tex.alb', 'pbMetal.1', 'gpA.4')."""
    cur = P
    for part in str(path).split('.'):
        if isinstance(cur, dict): cur = cur.get(part)
        elif isinstance(cur, list) and part.isdigit() and int(part) < len(cur): cur = cur[int(part)]
        else: cur = None
        if cur is None: return default
    return cur


def _trim(P, F):
    if P.get('lt') is None or F.get('phys'): return 1.0   # R3-PHYS: untrimmed
    return float(P['lt']) if F.get('net') else 1.0 / F['road_k']


def _flag(v):
    if v in (None, False, '', 0, 0.0): return 0.0
    if isinstance(v, (int, float)): return 1.0 if float(v) > 0.5 else 0.0
    return 1.0


# the derived values the table names ({"fn": ...}); each takes the tag, the scene factors, the take and the row's arguments
FN = {
    'origin': lambda P, F, S, a: list((S['data'].get('origin') or [0, 0, 0])[:3]),
    'flag': lambda P, F, S, a: _flag(get(P, a['key'])),
    'wall_k': lambda P, F, S, a: ((1.0 if (F.get('net') or F.get('phys')) else 1.0 / (float(P.get('lt') or 0.329) * F['road_k'])) if float((P.get('pbFac') or [1])[0]) > 0.5 else 0.0),
    'trim_v': lambda P, F, S, a: [1, 1, 1] if (F.get('phys') or float((P.get('pbFac') or [1])[0]) > 0.5) else [_trim(P, F) * float(k) for k in (P.get('trimK') or [1, 1, 1])],
    'base_y': lambda P, F, S, a: float(P.get('pbBaseY', -1e4)) if float(P.get('pbBaseY', -1e4)) > -9000 else 3.5,
    'trim_kit': lambda P, F, S, a: [_trim(P, F) if P.get('kit') else 1.0] * 3,
    'trim_all': lambda P, F, S, a: [_trim(P, F)] * 3,
    'lb14': lambda P, F, S, a: [b if F.get('phys') else b * ((float(c) + (1.0 - float(c)) * float(P.get('night', F['night']) or 0)) if (not a.get('only_if') or float(P.get(a['only_if']) or 0) > 0.5) else 1.0)
                               * (F['lt'] if F.get('net') else 1.0 / F['road_k']) for b, c in zip(a['base'], P.get(a['cal']) or [1.94, 1.70, 1.47])],
    'night': lambda P, F, S, a: float(a.get('k', 1.0)) * float(P['night'] if P.get('night') is not None else F['night']),
    'untrim_k': lambda P, F, S, a: F['untrim_k'],
    'untrim_road': lambda P, F, S, a: [1.0 if F.get('net') else 1.0 / F['road_k']] * 3,
    'untrim_k3': lambda P, F, S, a: [F['untrim_k']] * 3,
    'emit_k': lambda P, F, S, a: _emit_k(P),
    'emi_color': lambda P, F, S, a: _emi(P),
    # R4-PEDS: the last _-separated token of the material's path as a number (the walker looks' class), a sibling file (the
    # layer's mip-6 albedo beside its albedo), a constant mixed by the night level
    'path_tail': lambda P, F, S, a: float(str(P.get('path') or '0').rsplit('_', 1)[-1]) if str(P.get('path') or '').rsplit('_', 1)[-1].isdigit() else float(a.get('default', 1)),
    'sibling': lambda P, F, S, a: (lambda f: f.replace(a['from'], a['to']) if f and os.path.exists(f.replace(a['from'], a['to'])) else f)(get(P, a['key'])),
    'mixnight': lambda P, F, S, a: float(a['a0']) + (float(a['a1']) - float(a['a0'])) * float(F['night']),
    # R9 (UE track, 2026-10-08): round 9's looks, k (x the night when 'night' is set); 0 with BXUE_R9OFF (a test aid: the
    # same take without them, for before-and-after crops)
    'r9': lambda P, F, S, a: 0.0 if os.environ.get('BXUE_R9OFF') else float(a.get('k', 1.0)) * (float(F['night']) if a.get('night') else 1.0),
    'first': lambda P, F, S, a: next((get(P, k) for k in a.get('keys', []) if get(P, k) is not None), a.get('default')),   # R3-HQ
    'xf': lambda P, F, S, a: _xf(P, a)[0],
    'xf_rot': lambda P, F, S, a: _xf(P, a)[1],
    'lerp_night': lambda P, F, S, a: (lambda d0, d1: d0 + (d1 - d0) * FN['night'](P, F, S, {}))(float(get(P, a['a'], 0.0)), float(get(P, a['b'], 0.0))),
    'sky_mean': lambda P, F, S, a: list((S.get('sky') or {}).get('vis_mean') or [0.6, 0.7, 0.9])[:3],
}
# MESH11 (UE track, 2026-10-08): k while the environment names 'env', else 0 (the facade's windows inset follow
# BXUE_FACNANITE, which makes the facade bake's meshes Nanite)
FN['env'] = lambda P, F, S, a: float(os.environ.get(a.get('test') or a['env'] + '_K') or a.get('k', 1.0)) if os.environ.get(a['env'], a.get('default', '')) not in ('', '0') else 0.0   # (a test value: the row's 'test' variable, else <env>_K; 'default': the switch when unset)
# the relief's switch: on where the set has a height map; 0 with BXUE_DISPOFF (a test aid: the same take flat, for
# before-and-after crops with the same masters)
FN['disp_k'] = lambda P, F, S, a: 0.0 if os.environ.get('BXUE_DISPOFF') else _flag(get(P, a['key']))
# MESH11 end


# TSQADS (2026-10-08): the TA31 boards (usd_mat `board`, M_bx_board). board_k: the boards' gain to the take's exposure
# (the row's k, or BXUE_BOARDK, a test aid). board_take (ue_take, after the hooks): each board instance's cell table
# (ue_prep board_tab_*.png) as an uncompressed, unfiltered texture, and the web's sim time of every frame (ue_prep simT)
# keyed on MPC_bx.SimT in the take's sequence, so every board shows the web's ad on the web's frame
FN['board_k'] = lambda P, F, S, a: float(os.environ.get('BXUE_BOARDK') or a.get('k', 1.0))


def board_take(side, dest, cfg, ls):
    import ue_masters
    out = {'boards': 0, 'tables': 0, 'simT': None}
    tags = side.get('materials') or {}
    tabs = {}
    for ap in [a for a in eal.list_assets(dest, recursive=True, include_folder=False)
               if eal.find_asset_data(a).asset_class_path.asset_name == 'MaterialInstanceConstant' and '/BxTex/' not in a]:
        mi = eal.load_asset(ap)
        par = mi.get_editor_property('parent')
        if par is None or par.get_path_name().split('.')[0] != '/Game/Bx/M_bx_board': continue
        pns = prim_names(mi) or [ap.split('/')[-1].split('.')[0]]
        P = next((tags[x] for x in pns if x in tags and tags[x].get('kind') == 'board'), None)
        fp = (P or {}).get('tab')
        if not fp or not os.path.exists(fp): continue
        t = tabs.get(fp)
        if t is None:
            t = ue_masters.import_texture(fp, f'{dest}/BxTex', 'T_' + re.sub(r'[^A-Za-z0-9_]', '_', os.path.splitext(os.path.basename(fp))[0]), False)
            if t is None: continue
            t.set_editor_property('compression_settings', unreal.TextureCompressionSettings.TC_VECTOR_DISPLACEMENTMAP)
            t.set_editor_property('mip_gen_settings', unreal.TextureMipGenSettings.TMGS_NO_MIPMAPS)
            t.set_editor_property('filter', unreal.TextureFilter.TF_NEAREST)
            t.set_editor_property('srgb', False)
            eal.save_loaded_asset(t)
            tabs[fp] = t; out['tables'] += 1
        mel.set_material_instance_texture_parameter_value(mi, 'Tab', t)
        try:   # the atlas in BC7 (sRGB), not the default BC1: the ads' small type and gradients at 1:1
            at = mel.get_material_instance_texture_parameter_value(mi, 'Tex')
            if at is not None and at.get_editor_property('compression_settings') != unreal.TextureCompressionSettings.TC_BC7:
                at.set_editor_property('compression_settings', unreal.TextureCompressionSettings.TC_BC7)
                eal.save_loaded_asset(at); out['atlas_bc7'] = at.get_name()
        except Exception as e:
            out['atlas_bc7'] = f'{type(e).__name__}: {e}'
        mel.update_material_instance(mi)
        eal.save_loaded_asset(mi)
        out['boards'] += 1
    st = side.get('simT')
    if ls is not None and st:
        tr = ls.add_track(unreal.MovieSceneMaterialParameterCollectionTrack)
        tr.set_editor_property('mpc', ue_masters.board_mpc())
        sec = tr.add_section()
        n = len(st)
        sec.set_range(-8, n + 8)   # (the shutter's samples before the first frame and after the last)
        tick = ls.get_tick_resolution()
        tpf = (float(tick.numerator) / float(tick.denominator)) / float(side.get('fps') or 30)
        dv = (st[-1] - st[0]) / max(n - 1, 1)
        for i in range(-4, n + 4):   # every frame, and linear on beyond both ends
            v = st[i] if 0 <= i < n else (st[0] + i * dv if i < 0 else st[-1] + (i - n + 1) * dv)
            sec.add_scalar_parameter_key('SimT', unreal.FrameNumber(int(round(i * tpf))), float(v))
        out['simT'] = [st[0], st[-1], n, tpf]
    return out
# TSQADS end


def _emi(P):
    """the emissive colour: the preview's constant, else its emissive texture's scale (the web's emissive x intensity over
    its map: a billboard's warm (1, 0.89, 0.72)), else none."""
    e = get(P, 'preview.emissiveColor')
    if e: return e
    if get(P, 'preview.tex.emissiveColor.file'): return list((get(P, 'preview.tex.emissiveColor.scale') or [1.0, 1.0, 1.0])[:3])
    return [0.0, 0.0, 0.0]


def _emit_k(P):
    """the emission gain: a luminaire lens (ue_families.json emitters: a warm-white constant without a map, not the facade
    kit's lit interiors, as blender_light.setup_emitters) x lens_k, else k."""
    R = TABLE.get('emitters') or {}
    e = _emi(P)
    if max(e) <= 0: return 0.0
    mapped = bool(get(P, 'preview.tex.emissiveColor.file'))
    lens = (not mapped and not str(P.get('name') or '').startswith(tuple(R.get('not_names', ['fk:', 'tr:'])))
            and max(e) >= R.get('min', 0.9) and all(R[c][0] <= v <= R[c][1] for c, v in zip('rgb', e[:3])))
    return float(R.get('lens_k', 1.0) if lens else R.get('k', 1.0))


def _xf(P, a):
    """a texture's UsdTransform2d (ue_prep's preview 'xf': scale, rotation in degrees, translation) -> the masters' Xf
    (scale xy, translation zw) and XfR (cos, sin); the first of the row's keys that has one, else the identity."""
    x = next((get(P, k + '.xf') for k in a.get('keys', []) if get(P, k + '.xf')), None) or [1.0, 1.0, 0.0, 0.0, 0.0]
    r = math.radians(float(x[2]))
    return [float(x[0]), float(x[1]), float(x[3]), float(x[4])], [math.cos(r), math.sin(r), 0.0, 0.0]


def _roles(S):
    """the window kit's material roles (bxwin_usd.json beside the take's USD: kit glass, the rooms' fill, lit blinds,
    sheers, the storefront interiors), by material name."""
    try: return json.load(open(os.path.join(os.path.dirname(S['usd']), 'bxwin_usd.json'))).get('roles') or {}
    except Exception: return {}


def _role_row(rec):
    """a role record -> (its ue_families.json roles row with the parameters of the family it extends, the record). The
    harvests from before the kit glass was tagged: 'glass' with the kit's flag or colour is kit glass, at the shop's or the
    pane's f0, roughness and dirt (blender_windows.after_import)."""
    if not rec: return None
    R = TABLE.get('roles') or {}
    role = rec.get('role')
    al = R.get('_kitglass_alias') or {}
    if role == 'glass' and al:
        col, kc = rec.get('color'), al['color']
        if rec.get('fk') or (col and max(abs(col[i] - kc[i]) for i in range(3)) < al['tol']):
            shop = float(rec.get('opacity') or 0.36) < al['shop_below']
            rec = dict(rec, **(al['shop'] if shop else al['pane'])); rec['role'] = role = 'kitglass'
    row = R.get(role)
    if not isinstance(row, dict) or not row.get('master'): return None
    base = list((TABLE['families'].get(row.get('extends')) or {}).get('params', []))
    over = {r[0]: r for r in row.get('params', [])}
    params = [over.pop(r[0], r) for r in base] + list(over.values())
    return dict(row, params=params), rec


class Tex:
    """texture files -> Texture2D assets of this take (sRGB colour or linear data), imported once each."""
    def __init__(self, dest):
        self.dest = dest + '/BxTex'
        self.cache = {}
        self.n = 0

    def get(self, path, srgb):
        if not path or not isinstance(path, str) or not os.path.exists(path): return None
        key = (path, bool(srgb))
        if key in self.cache: return self.cache[key]
        import ue_masters, hashlib
        name = 'T_' + re.sub(r'[^A-Za-z0-9_]', '_', os.path.splitext(os.path.basename(path))[0]) + ('' if srgb else '_lin')
        # R4-CACHE: the CC0 sets (outside every take) are imported once for all takes, into /Game/BxShared/HQ
        hq_root = os.path.dirname(os.environ.get('BXUE_HQ') or (TABLE.get('hq') or {}).get('manifest') or '/data0/projectnyc_aux/assets/hq/hq.json')
        dest = '/Game/BxShared/HQ' if os.path.abspath(path).startswith(hq_root + os.sep) else self.dest
        # R9-TEX (UE track, 2026-10-08): a take's own textures are named by file AND path: the crowd sets share file names
        # (textures/peds/peds24/albedo_046.png and textures/peds/rb27/albedo_046.png), and by name alone the rb27 walkers
        # drew peds24's textures (red and green bodysuits, camouflage, grey heads). The HQ sets' names are unique already.
        if dest == self.dest:
            name = name[:2] + hashlib.sha1(os.path.realpath(path).encode()).hexdigest()[:6] + '_' + name[2:]
        ap = f'{dest}/{name}'
        t = eal.load_asset(ap) if eal.does_asset_exist(ap) else ue_masters.import_texture(path, dest, name, srgb)
        if dest != self.dest and t is not None:
            try: eal.save_loaded_asset(t)
            except Exception: pass
        self.cache[key] = t
        self.n += 1
        return t


def prim_names(mi):
    """the USD material prims an imported instance stands for (the importer shares one between identical shaders)."""
    try:
        for ud in (mi.get_editor_property('asset_user_data') or []):
            try: pp = ud.get_editor_property('prim_paths')
            except Exception: continue
            if pp: return [str(x).rstrip('/').split('/')[-1] for x in pp]
    except Exception:
        pass
    return []


def prim_name(mi):
    n = prim_names(mi)
    return n[0] if n else None


def _color(v):
    v = [float(x) for x in (v if isinstance(v, (list, tuple)) else [v])] + [0.0, 0.0, 0.0, 0.0]
    return unreal.LinearColor(v[0], v[1], v[2], v[3])


def fill(mi, master, rows, P, F, S, tex):
    """re-parent an instance to a master and set its parameters from the table's rows."""
    mel.set_material_instance_parent(mi, master)
    mel.clear_all_material_instance_parameters(mi)
    for row in rows:
        name, typ, src = row[0], row[1], row[2]
        default = row[3] if len(row) > 3 else None
        if isinstance(src, dict) and 'fn' in src: val = FN[src['fn']](P, F, S, src)
        elif isinstance(src, str): val = get(P, src, default)
        else: val = src
        if val is None: continue
        if typ == 's': mel.set_material_instance_scalar_parameter_value(mi, name, float(val))
        elif typ == 'v': mel.set_material_instance_vector_parameter_value(mi, name, _color(val))
        elif typ in ('ts', 'tl'):
            t = tex.get(val, typ == 'ts')
            if t is not None: mel.set_material_instance_texture_parameter_value(mi, name, t)
    if int(P.get('side', 0) or 0) == 2:
        try:
            bo = mi.get_editor_property('base_property_overrides')
            bo.set_editor_property('override_two_sided', True); bo.set_editor_property('two_sided', True)
            mi.set_editor_property('base_property_overrides', bo)
        except Exception:
            pass
    mel.update_material_instance(mi)


def _asset_rule(name):
    for r in TABLE.get('assets', []):
        m = r['match']
        if ((r.get('how') == 'prefix' and (name.startswith(m) or name.startswith('MI_' + m))) or (r.get('how') == 'suffix' and name.endswith(m))) \
                and r.get('contains', '') in name:   # R4-PEDS: and a part of the name
            if r.get('master') in (os.environ.get('BXUE_SKIPMASTERS') or '').split(','): return None   # (a diagnosis aid)
            return r
    return None


def _asset_tag(rule, name, S):
    """the tag of an asset rule; the facade bake's: its atlas textures from bxwin_usd.json beside the take's USD."""
    if rule.get('source') == 'preview':   # an untagged material's preview surface (ue_prep's previews)
        return (S.get('previews') or {}).get(name)
    if rule.get('source') != 'bxwin_usd.json': return {}
    k = re.findall(r'fac(\d+)', name)
    try: j = json.load(open(os.path.join(os.path.dirname(S['usd']), 'bxwin_usd.json')))
    except Exception: return None
    at = next((a for a in j.get('atlases', []) if k and int(a.get('k', -1)) == int(k[0])), None)
    if not at: return None
    d = os.path.dirname(S['usd'])
    return {'tex': {kk: os.path.join(d, v) for kk, v in (at.get('tex') or {}).items()}, 'hq': (S.get('hq') or {}).get('facade')}   # R3-HQ


# UELOOK10 (2026-10-08): each Lake person's seed (M_bx_person) as custom primitive data 0 on its actor's components: the
# person's model and instance (ue_mv<k>_cp33l_person_<model>_<lod>_<part>/i<n>), so its hair and body share it
def persons():
    import zlib
    # (UELOOK10, the Lake people on the walkers' looks: each opaque body's own instances of its M_bx_walker slots with the
    # web's outfit tints, cpLakeside.js TOPS at 0.9 and BOTS at 0.8, the palette entry by the person's seed: the web's own
    # pick per boat and seat is per frame and not in the export)
    LP = TABLE.get('lake_people') or {}
    tops, bots = LP.get('tops') or [], LP.get('bots') or []
    wm = eal.load_asset('/Game/Bx/M_bx_walker') if tops and bots else None
    atools = unreal.AssetToolsHelpers.get_asset_tools()
    n_ = nt = 0
    for a in unreal.EditorLevelLibrary.get_all_level_actors():
        par = a.get_attach_parent_actor()
        if par is None or 'cp33l_person' not in par.get_actor_label(): continue
        key = re.sub(r'_(opaque|hair)$', '', re.sub(r'^ue_mv\d+_', '', par.get_actor_label())) + '/' + a.get_actor_label()
        sd = (zlib.crc32(key.encode()) % 100003) / 100003.0
        for c in a.get_components_by_class(unreal.MeshComponent):
            c.set_default_custom_primitive_data_float(0, sd); n_ += 1
            if wm is None or not par.get_actor_label().endswith('_opaque'): continue
            for i in range(c.get_num_materials()):
                m = c.get_material(i)
                if not isinstance(m, unreal.MaterialInstanceConstant): continue
                base = m
                while isinstance(base, unreal.MaterialInstance): base = base.get_editor_property('parent')
                if base != wm: continue
                nm = re.sub(r'[^A-Za-z0-9_]', '_', f'MI_lp_{par.get_actor_label()}_{a.get_actor_label()}_{i}')
                if m.get_name() == nm: m = m.get_editor_property('parent')   # (a kept stage: this person's own from the last run)
                ap_ = f"{m.get_path_name().rsplit('/', 1)[0]}/LakePeople/{nm}"
                mic = eal.load_asset(ap_) if eal.does_asset_exist(ap_) else atools.create_asset(nm, ap_.rsplit('/', 1)[0], unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
                mel.set_material_instance_parent(mic, m)
                t_, b_ = tops[int(sd * 7919) % len(tops)], bots[int(sd * 104729) % len(bots)]
                mel.set_material_instance_vector_parameter_value(mic, 'TA', unreal.LinearColor(t_[0], t_[1], t_[2], float(LP.get('top_a', 0.9))))
                mel.set_material_instance_vector_parameter_value(mic, 'TB', unreal.LinearColor(b_[0], b_[1], b_[2], float(LP.get('bottom_a', 0.8))))
                mel.update_material_instance(mic)
                c.set_material(i, mic); nt += 1
    return {'components': n_, 'tinted_slots': nt}
# UELOOK10 end


# UELOOK10 (2026-10-08): the facade bake's rooms (M_bx_facade RoomOn: the rooms atlas and its per-slot gains, ue_families.json
# facade_rooms), set on each bxw_ instance after fill(), whose rows clear every other parameter
def _rooms(mi, tex):
    R = TABLE.get('facade_rooms') or {}
    if not R or os.environ.get('BXUE_NOROOMS'): return 0
    ap = os.environ.get('BXUE_ROOMS') or R.get('atlas')
    t = tex.get(ap, True) if ap else None
    if t is None: return 0
    g = [float(x) for x in (R.get('gain') or [1.0] * 8)]
    try: g = [float(x) for x in json.load(open(os.path.splitext(ap)[0] + '.json')).get('gain', g)][:8]
    except Exception: pass
    g = (g + [1.0] * 8)[:8]
    mel.set_material_instance_texture_parameter_value(mi, 'Rooms', t)
    mel.set_material_instance_vector_parameter_value(mi, 'RG0', unreal.LinearColor(g[0], g[1], g[2], g[3]))
    mel.set_material_instance_vector_parameter_value(mi, 'RG1', unreal.LinearColor(g[4], g[5], g[6], g[7]))
    mel.set_material_instance_scalar_parameter_value(mi, 'RoomOn', 1.0)
    mel.set_material_instance_scalar_parameter_value(mi, 'RoomEK', float(R.get('emit_k', 1.0)))
    mel.update_material_instance(mi)
    return 1
# UELOOK10 end


# UELOOK10 (2026-10-08): the web's alpha-tested and transparent materials drawn as the web draws them. usd_write writes a
# material's alpha (the map's alpha or the alphaMap's red, the opacity, alphaTest as opacityThreshold) only when the web
# material is alpha-tested or transparent; UE dropped it (the plain family's master is opaque; the importer's own masters
# blend whatever the threshold). Here, after the families and rules: an instance on the plain master, or on the
# importer's own, whose preview carries that alpha goes to M_bx_plain_mask (cut at its alphaTest) or M_bx_plain_blend
# (blended), filled from its family's rows or, for the importer's own, from its preview (ue_families.json web_alpha); a
# transparent custom shader the export could not carry (ue_prep's 'web' record: a ShaderMaterial, nothing to draw but a
# white sheet: cpRocks.js cpr34:contact's shade discs) takes the hidden master. Every other master keeps its own alpha.
ALPHA_KEEP = ('M_bx_leaf', 'M_bx_decal', 'M_bx_sign', 'M_bx_glass', 'M_bx_veil', 'M_bx_board', 'M_bx_walker', 'M_bx_foliage',
              'M_bx_foliage_mask', 'M_bx_bark', 'M_bx_water', 'M_bx_bronze', 'M_bx_person', 'M_bx_facade', 'M_bx_lens', 'M_bx_paint',
              'M_bx_pbr', 'M_bx_vk', 'M_bx_ground', 'M_bx_ground6')
ALPHA_MINE = ('M_bx_plain_mask', 'M_bx_plain_blend', 'M_bx_plain_add', 'M_bx_hidden')   # (a kept stage's instances from an earlier run: decided again)


def web_alpha(side, dest, mis, tex, F):
    out = {'mask': 0, 'blend': 0, 'add': 0, 'hidden': 0, 'materials': []}
    if os.environ.get('BXUE_NOALPHA'): out['off'] = True; return out   # (a test aid: the take without this pass)
    W_ = TABLE.get('web_alpha') or {}
    tags, pvs, fams = side['materials'], side.get('previews') or {}, TABLE['families']
    amx = {}
    try:
        man = json.load(open(os.path.join(side['data'].get('harvest') or '', 'manifest.json')))
        tx_ = {int(t_['id']): t_ for t_ in man.get('texs') or [] if t_.get('id') is not None}
        for m_ in man.get('mats') or []:
            t_ = tx_.get(int((m_.get('maps') or {}).get('alphaMap', -1)))
            e_ = (t_ or {}).get('matrix')
            if e_: amx[int(m_['id'])] = [math.hypot(e_[0], e_[1]), math.hypot(e_[3], e_[4]), math.degrees(math.atan2(e_[1], e_[0])), e_[6], e_[7]]
    except Exception:
        pass
    ms = {k: eal.load_asset(f'/Game/Bx/M_bx_{k}') for k in ('plain_mask', 'plain_blend', 'plain_add', 'hidden')}
    if any(v is None for v in ms.values()): out['error'] = 'masters missing'; return out
    for ap in mis:
        try:
            mi = eal.load_asset(ap)
            nm = ap.split('/')[-1].split('.')[0]
            pns = prim_names(mi); pn = pns[0] if pns else nm
            if _asset_rule(pn) or _asset_rule(nm): continue   # walkers, trees, the facade bake, hidden: their own masters
            par = mi.get_editor_property('parent')
            pnm = par.get_name() if par is not None else ''
            if pnm in ALPHA_KEEP: continue
            mine = pnm in ALPHA_MINE
            own = not mine and (par is None or not par.get_path_name().startswith('/Game/Bx/M_bx_'))   # the importer's own (its /Game/Bx/Usd copy)
            if not (own or mine or pnm == 'M_bx_plain'): continue
            P = tags.get(pn) or tags.get(nm) or tags.get(re.sub(r'_\d+$', '', nm))
            pv = dict((P or {}).get('preview') or {k: v for k, v in (pvs.get(pn) or {}).items() if k not in ('kind', 'path')})
            web = (P or pvs.get(pn) or {}).get('web') or {}
            tx = pv.get('tex') or {}
            ot = tx.get('opacity') or {}
            op = pv.get('opacity')
            has_tex = bool(ot.get('file'))
            k_ = float(op) if isinstance(op, (int, float)) else (float(web.get('op', 1.0)) if (web.get('tr') and has_tex) else 1.0)   # (a texture's alpha x the web's opacity; none written: opaque, as the exporter chose)
            th = float(pv.get('opacityThreshold') or 0.0)
            if not (has_tex or k_ < 0.999):
                # (the importer shares one instance between identical surfaces: hidden only when every prim it stands for is one)
                wl = [((tags.get(x) or pvs.get(x) or {}).get('web') or {}) for x in (pns or [pn])]
                if all(w_.get('type') == 'ShaderMaterial' and w_.get('tr') for w_ in wl):
                    fill(mi, ms['hidden'], [], {}, F, side, tex); out['hidden'] += 1; out['materials'].append([pn, 'hidden', web.get('name')])
                continue
            mode = 'mask' if th > 0.0 else 'add' if int(web.get('bl') or 1) == 2 else 'blend'   # (three's AdditiveBlending: 2)
            if mode == 'add' and not (tx.get('diffuseColor') or {}).get('file'):
                # an additive glow made of an alpha map alone (sim/carlights.js's head, tail and pool sprites: camera-facing quads
                # whose per-sprite colours are not exported): UE draws those lights for real (ue_light's headlamps and lenses)
                fill(mi, ms['hidden'], [], {}, F, side, tex); out['hidden'] += 1; out['materials'].append([pn, 'hidden', web.get('name') or 'additive sprite']); continue
            rows = None
            if P is not None:
                kind = P.get('kind')
                tr = next((r for r in TABLE.get('tag_rules', []) if r.get('kind') in (None, kind) and all(x in (P.get('name') or '') for x in (r.get('name_contains', '') if isinstance(r.get('name_contains'), list) else [r.get('name_contains', '')]))), None)
                if tr is not None and tr.get('master') == 'plain': rows = list(tr['params'])
                elif (fams.get(kind) or {}).get('master') == 'plain': rows = list(fams[kind]['params'])
            if rows is None: rows = list(W_.get('preview_params') or [])
            km = re.match(r'm(\d+)', pn)
            if has_tex and not ot.get('xf') and not tx.get('diffuseColor') and km and int(km.group(1)) in amx:   # an alphaMap alone: its own repeat
                xf_ = amx[int(km.group(1))]; r_ = math.radians(xf_[2])
                rows += [['Xf', 'v', [xf_[0], xf_[1], xf_[3], xf_[4]]], ['XfR', 'v', [math.cos(r_), math.sin(r_), 0.0, 0.0]]]
            rows += [['OpTex', 'ts', 'preview.tex.opacity.file'], ['HasOp', 's', 1.0 if has_tex else 0.0],
                     ['OpCh', 's', 1.0 if str(ot.get('out') or 'a') == 'r' else 0.0], ['OpK', 's', k_]]
            Q = dict(P or {}); Q['preview'] = pv
            if web.get('side') == 2: Q['side'] = 2
            fill(mi, ms['plain_' + mode], rows, Q, F, side, tex)
            if mode == 'mask':
                bo = mi.get_editor_property('base_property_overrides')
                bo.set_editor_property('override_opacity_mask_clip_value', True); bo.set_editor_property('opacity_mask_clip_value', th)
                mi.set_editor_property('base_property_overrides', bo)
                mel.update_material_instance(mi)
            out[mode] += 1; out['materials'].append([pn, mode, web.get('name') or (P or {}).get('name') or ''])
        except Exception as e:
            out.setdefault('failed', {})[ap.split('/')[-1]] = str(e)[:120]
    return out
# UELOOK10 end


def apply(side, dest, cfg):
    t0 = time.time()
    if cfg.get('nomat'): return {'skipped': True}
    tags = side['materials']
    F = factors(tags, phys=str(cfg.get('light') or 'phys') != 'web')   # R3-PHYS
    fams = TABLE['families']
    masters = {}

    def master(name):
        if name not in masters:   # (BXUE_MASTER_<NAME>=<other>: a test aid, a family's master swapped for another)
            masters[name] = eal.load_asset(f"/Game/Bx/M_bx_{os.environ.get('BXUE_MASTER_' + name.upper()) or name}")
        return masters[name]
    tex = Tex(dest)
    out = {'by_kind': {}, 'assets': {}, 'roles': {}, 'untagged': 0, 'failed': {}, 'factors': F, 'merged_mixed': []}
    roles = _roles(side)
    no_shadow, no_nanite = set(), set()
    fam_of, cpd_mats = {}, set()
    mis = [a for a in eal.list_assets(dest, recursive=True, include_folder=False)
           if eal.find_asset_data(a).asset_class_path.asset_name == 'MaterialInstanceConstant' and '/BxTex/' not in a]
    for ap in mis:
        mi = eal.load_asset(ap)
        nm = ap.split('/')[-1].split('.')[0]
        pns = prim_names(mi)
        pn = pns[0] if pns else nm
        looks = sorted({tags[x].get('look') for x in pns if x in tags})
        if len(looks) > 1:   # different looks in one instance (ue_prep's bxLook input should prevent it)
            out['merged_mixed'].append({'asset': nm, 'prims': pns[:12], 'looks': len(looks)})
        try:
            rule = _asset_rule(pn) or _asset_rule(nm)
            if rule is not None:
                P = _asset_tag(rule, pn, side)
                if P is not None and master(rule['master']) is not None:
                    fill(mi, master(rule['master']), rule.get('params', []), P, F, side, tex)
                    if rule.get('master') == 'facade': out['rooms'] = out.get('rooms', 0) + _rooms(mi, tex)   # UELOOK10
                    out['assets'][rule['match']] = out['assets'].get(rule['match'], 0) + 1
                    if rule.get('no_nanite'): no_nanite.add('SM_' + rule['match'])
                    if rule.get('no_shadow'): no_shadow.add(mi.get_path_name())
                continue
            P = tags.get(pn) or tags.get(nm) or tags.get(re.sub(r'_\d+$', '', nm))
            rr = _role_row(roles.get(pn) or roles.get(nm))
            if rr is not None and master(rr[0]['master']) is not None:
                # the window kit's roles (ue_families.json roles), tagged or not: the tag with its preview, else the preview
                Q = dict(P or {})
                if 'preview' not in Q: Q['preview'] = {k: v for k, v in ((side.get('previews') or {}).get(pn) or {}).items() if k not in ('kind', 'path')}
                Q['role'] = rr[1]
                fill(mi, master(rr[0]['master']), rr[0]['params'], Q, F, side, tex)
                if rr[0].get('no_shadow'): no_shadow.add(mi.get_path_name())
                out['roles'][rr[1]['role']] = out['roles'].get(rr[1]['role'], 0) + 1
                if P is not None: fam_of[mi.get_path_name()] = P.get('kind')
                continue
            if P is None:
                # R5-ROOF: an untagged preview surface with its opacity in its colour map's alpha (the writer's stain and
                # paint layers over roofs and walls) takes ue_families.json preview_rules (the matte decal master): the
                # importer's translucent master mirrored the sky on every flat roof's stain layer
                pv = (side.get('previews') or {}).get(pn) or {}
                tx = pv.get('tex') or {}
                pr = next((r for r in TABLE.get('preview_rules', []) if r.get('when') == 'opacity_in_diffuse'
                           and (tx.get('opacity') or {}).get('file') and (tx.get('opacity') or {}).get('file') == (tx.get('diffuseColor') or {}).get('file')), None)
                if pr is not None and master(pr['master']) is not None:
                    fill(mi, master(pr['master']), pr['params'], {'preview': {k: v for k, v in pv.items() if k not in ('kind', 'path')}}, F, side, tex)
                    out['previews_ruled'] = out.get('previews_ruled', 0) + 1
                    continue
                out['untagged'] += 1; continue
            kind = P.get('kind'); fam = fams.get(kind)
            tr = next((r for r in TABLE.get('tag_rules', []) if r.get('kind') in (None, kind) and all(x in (P.get('name') or '') for x in (r.get('name_contains', '') if isinstance(r.get('name_contains'), list) else [r.get('name_contains', '')]))), None)
            if tr is not None and master(tr['master']) is not None:
                fill(mi, master(tr['master']), tr['params'], P, F, side, tex)
                if tr.get('cpd'): cpd_mats.add(mi.get_path_name())
                out['by_kind'][tr['master']] = out['by_kind'].get(tr['master'], 0) + 1
                continue
            if fam is None: continue
            if fam.get('keep'):
                sc = fam.get('scale_colors')
                k = FN[sc['fn']](P, F, side, sc) if sc else 1.0
                for pname in ('BaseColor', 'DiffuseColor', 'Base Color', 'diffuseColor'):
                    try:
                        c = mel.get_material_instance_vector_parameter_value(mi, pname)
                        if c is not None: mel.set_material_instance_vector_parameter_value(mi, pname, unreal.LinearColor(min(0.92, c.r * k), min(0.92, c.g * k), min(0.92, c.b * k), c.a))
                    except Exception:
                        pass
                mel.update_material_instance(mi)
            else:
                if any(get(P, r) is None for r in fam.get('requires', [])) or master(fam['master']) is None: continue
                fill(mi, master(fam['master']), fam['params'], P, F, side, tex)
                if fam.get('no_shadow'): no_shadow.add(mi.get_path_name())
            out['by_kind'][kind] = out['by_kind'].get(kind, 0) + 1
            fam_of[mi.get_path_name()] = kind
        except Exception as e:
            unreal.log_warning(f'[bxue] ue_mat {nm}: {e}')
            out['failed'][nm] = str(e)[:120]
    out['textures'] = tex.n
    out['instances'] = len(mis)
    out['usage'] = own_masters(mis)
    # MESH11 (UE track, 2026-10-08): the facade bake's meshes are Nanite again (BXUE_FACNANITE, on unless 0, 2026-10-09), so
    # the facade master's displacement insets the windows (the reveals as geometry)
    if os.environ.get('BXUE_FACNANITE', '1') != '0':
        no_nanite.discard('SM_bxw_')
        out['facade_nanite'] = 0
        for ap in eal.list_assets(dest, recursive=True, include_folder=False):
            if not ap.split('/')[-1].startswith('SM_bxw_'): continue
            sm = eal.load_asset(ap)
            if not isinstance(sm, unreal.StaticMesh): continue
            ns = sm.get_editor_property('nanite_settings')
            if not ns.get_editor_property('enabled'):
                ns.set_editor_property('enabled', True); sm.set_editor_property('nanite_settings', ns); out['facade_nanite'] += 1
            # (the bake's walls are a few hundred to a few thousand triangles a mesh: its fallback and its ray tracing proxy
            # keep all of them, so the lamps' ray-traced shadows and Lumen see the walls Nanite draws, not a simplified shell)
            try:
                FT = unreal.NaniteFallbackTarget.PERCENT_TRIANGLES
                ns = sm.get_editor_property('nanite_settings')
                if ns.get_editor_property('fallback_target') != FT or ns.get_editor_property('fallback_percent_triangles') < 1.0:
                    ns.set_editor_property('fallback_target', FT); ns.set_editor_property('fallback_percent_triangles', 1.0)
                    sm.set_editor_property('nanite_settings', ns); out['facade_fallback'] = out.get('facade_fallback', 0) + 1
                # UE13 (2026-10-09): 15-bit normals (8 by default), so the rooms' wall seed (its plane from the normal) holds
                ns = sm.get_editor_property('nanite_settings')
                if ns.get_editor_property('normal_precision') != 15:
                    ns.set_editor_property('normal_precision', 15); sm.set_editor_property('nanite_settings', ns)
                    out['facade_normal15'] = out.get('facade_normal15', 0) + 1
                rp = sm.get_editor_property('ray_tracing_proxy_settings')
                if rp.get_editor_property('fallback_target') != FT or rp.get_editor_property('fallback_percent_triangles') < 1.0:
                    rp.set_editor_property('fallback_target', FT); rp.set_editor_property('fallback_percent_triangles', 1.0)
                    sm.set_editor_property('ray_tracing_proxy_settings', rp); out['facade_rtproxy'] = out.get('facade_rtproxy', 0) + 1
            except Exception as e:
                out['facade_proxy_error'] = str(e)[:120]
    # the facade instances two-sided: BXUE_FACTWO=1, a test aid (tried for the Nanite bake's lost sun shadow, which it did
    # not bring back; the cause was tessellation in the shadow pass). A reused stage keeps its instances, so the override
    # is set or cleared on every import
    two_ = os.environ.get('BXUE_FACNANITE', '1') != '0' and os.environ.get('BXUE_FACTWO') == '1'
    out['facade_two_sided'] = 0
    fm_ = master('facade')
    for mp in mis:
        try:
            mi = eal.load_asset(mp)
            if fm_ is None or mi.get_editor_property('parent') != fm_: continue
            bo = mi.get_editor_property('base_property_overrides')
            if bool(bo.get_editor_property('override_two_sided')) == two_: continue
            bo.set_editor_property('override_two_sided', two_); bo.set_editor_property('two_sided', two_)
            mi.set_editor_property('base_property_overrides', bo); mel.update_material_instance(mi); out['facade_two_sided'] += 1
        except Exception as e:
            unreal.log_warning(f'[bxue] facade two-sided {mp}: {e}')
    # MESH11 end
    out['no_nanite'] = mesh_rules(dest, tuple(sorted(no_nanite)))
    # the families that cast no shadow (the ground: its stacked layers, a few mm apart, shadow each other at a low sun;
    # blender_render.py's rule)
    ng = 0
    for a in unreal.EditorLevelLibrary.get_all_level_actors():
        for c in a.get_components_by_class(unreal.StaticMeshComponent):
            if any(m is not None and m.get_path_name() in no_shadow for m in c.get_materials()):
                c.set_editor_property('cast_shadow', False); ng += 1
    out['no_shadow_components'] = ng
    out['regions'] = regions(fam_of)
    out['paint'] = paint(side, cpd_mats)
    out['walkers'] = walkers(side, dest)   # R4-PEDS
    out['persons'] = persons()   # UELOOK10
    out['web_alpha'] = web_alpha(side, dest, mis, tex, F)   # UELOOK10
    out['secs'] = round(time.time() - t0, 1)
    return out


def paint(side, cpd_mats):
    """each car's own paint (ue_prep's moving: the fleet's linear colour) as custom primitive data 0-2 on the components of
    its actor that use a paint material; R3-PAINT: 3 metalness, 4 road-film dirt, 5 roughness (fleet24's aPaint), 6 the
    car's seed, 7 its kind's height in metres."""
    recs = {}
    for r in side.get('moving') or []:
        if r.get('paint'):
            parts = r['path'].split('/'); px = r.get('paintx') or [0.0, 0.0, 0.35]
            recs[(parts[-2], parts[-1])] = list(r['paint'][:3]) + [px[0], px[1], px[2], float(r.get('seed') or 0.0), float(r.get('sizeY') or 1.5)]
    n = 0
    for a in unreal.EditorLevelLibrary.get_all_level_actors():
        par = a.get_attach_parent_actor()
        key = (par.get_actor_label(), a.get_actor_label()) if par is not None else None
        stack = [a]
        pc = recs.get(key)
        if pc is None: continue
        while stack:
            q = stack.pop()
            for c in q.get_components_by_class(unreal.MeshComponent):
                if any(m is not None and m.get_path_name() in cpd_mats for m in c.get_materials()):
                    for i_, v in enumerate(pc[:8]): c.set_default_custom_primitive_data_float(i_, float(v))   # (the default is saved with the level; set_custom_primitive_data is transient)
                    n += 1
            stack += list(q.get_attached_actors())
    return n


def walkers(side, dest):
    """R4-PEDS: each walker's three tints (top, bottom, shoes; rgba; ue_prep's walkers, from its SkelRoot) on its own instances
    of its garment materials (children of the walker master's instances, under <dest>/Walkers), set on its skeletal mesh
    components' slots. Walkers without a tint keep the shared instances."""
    W = side.get('walkers') or {}
    if not W: return {'walkers': 0}
    master = eal.load_asset('/Game/Bx/M_bx_walker')
    atools = unreal.AssetToolsHelpers.get_asset_tools()
    n = mics = 0
    for a in unreal.EditorLevelLibrary.get_all_level_actors():
        t = W.get(a.get_actor_label())
        if not t or max(t[3], t[7], t[11]) <= 0.0: continue
        stack = [a]
        while stack:
            q = stack.pop()
            for c in q.get_components_by_class(unreal.SkeletalMeshComponent):
                for i in range(c.get_num_materials()):
                    m = c.get_material(i)
                    if not isinstance(m, unreal.MaterialInstanceConstant): continue
                    base = m
                    while isinstance(base, unreal.MaterialInstance): base = base.get_editor_property('parent')
                    if base != master or mel.get_material_instance_scalar_parameter_value(m, 'Cls') != 1.0: continue
                    nm = f"MI_{a.get_actor_label()}_{i}"
                    if m.get_name() == nm: m = m.get_editor_property('parent')   # (a kept stage: the walker's own from the last run)
                    ap_ = f"{dest}/Walkers/{nm}"
                    mic = eal.load_asset(ap_) if eal.does_asset_exist(ap_) else atools.create_asset(nm, dest + '/Walkers', unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
                    mel.set_material_instance_parent(mic, m)
                    for k, j in (('TA', 0), ('TB', 4), ('TC', 8)):
                        mel.set_material_instance_vector_parameter_value(mic, k, unreal.LinearColor(*[float(x) for x in t[j:j + 4]]))
                    mel.update_material_instance(mic)
                    c.set_material(i, mic); mics += 1
                n += 1
            stack += list(q.get_attached_actors())
    return {'walkers': n, 'instances': mics}


def regions(fam_of):
    """each component's region as its custom stencil value (ue_families.json regions), for the take's data pass."""
    R = TABLE['regions']; ids = R['ids']; cnt = {}
    for a in unreal.EditorLevelLibrary.get_all_level_actors():
        chain, q = [], a
        while q is not None:
            chain.append(q.get_actor_label()); q = q.get_attach_parent_actor()
        moving = any(l.startswith('ue_') for l in chain)
        for c in a.get_components_by_class(unreal.PrimitiveComponent):
            mats = [m for m in (c.get_materials() if hasattr(c, 'get_materials') else []) if m is not None]
            fams = {fam_of.get(m.get_path_name()) for m in mats}
            names = [m.get_name() for m in mats]
            reg = R['default']
            for r in R['rules']:
                if (r.get('moving') and moving) or ('family' in r and r['family'] in fams) or \
                   ('material_prefix' in r and any(n.startswith(tuple(r['material_prefix'])) for n in names)):
                    reg = r['region']; break
            c.set_editor_property('render_custom_depth', True)
            c.set_editor_property('custom_depth_stencil_value', int(ids[reg]))
            cnt[reg] = cnt.get(reg, 0) + 1
    return cnt


def mesh_rules(dest, prefixes):
    """the assets drawn without Nanite (ue_families.json no_nanite): Nanite's coarse levels bridge the disjoint walls of
    a mesh kilometres across."""
    n = 0
    if not prefixes: return 0
    for ap in eal.list_assets(dest, recursive=True, include_folder=False):
        nm = ap.split('/')[-1].split('.')[0]
        if not nm.startswith(prefixes): continue
        sm = eal.load_asset(ap)
        if not isinstance(sm, unreal.StaticMesh): continue
        ns = sm.get_editor_property('nanite_settings')
        if ns.get_editor_property('enabled'):
            ns.set_editor_property('enabled', False); sm.set_editor_property('nanite_settings', ns); n += 1
    return n


def own_masters(mis):
    """the importer's own instances (untagged materials) hang off the USD plugin's masters, which lack the Nanite and
    instancing usages a -game render needs (it falls back to the default material, and a Nanite mesh to its coarse
    fallback mesh): those masters are copied once into /Game/Bx/Usd/ with the usages set, and the instances re-parented.
    Leaf cards (the importer makes them translucent, which Nanite cannot draw) are alpha-tested."""
    dup = {}
    n = leaves = 0
    for ap in mis:
        mi = eal.load_asset(ap)
        par = mi.get_editor_property('parent')
        if 'leaf' in mi.get_name().lower():
            if isinstance(par, unreal.Material) and 'Translucent' in par.get_name():
                par = unreal.load_asset(par.get_path_name().replace('UsdPreviewSurfaceTranslucent', 'UsdPreviewSurface')) or par
                if par.get_path_name().startswith('/Game/'): mel.set_material_instance_parent(mi, par)
            bo = mi.get_editor_property('base_property_overrides')
            for k, v in (('override_blend_mode', True), ('blend_mode', unreal.BlendMode.BLEND_MASKED),
                         ('override_opacity_mask_clip_value', True), ('opacity_mask_clip_value', 0.5)):
                try: bo.set_editor_property(k, v)
                except Exception: pass
            mi.set_editor_property('base_property_overrides', bo)
            leaves += 1
        if not isinstance(par, unreal.Material) or par.get_path_name().startswith('/Game/'): continue
        key = par.get_path_name()
        if key not in dup:
            dst = '/Game/Bx/Usd/' + par.get_name()
            m = eal.load_asset(dst) if eal.does_asset_exist(dst) else eal.duplicate_asset(key, dst)
            for u in USAGES:
                try: mel.set_material_usage(m, getattr(unreal.MaterialUsage, u))
                except Exception: pass
            eal.save_loaded_asset(m)
            dup[key] = m
        mel.set_material_instance_parent(mi, dup[key]); n += 1
    return {'masters_copied': len(dup), 'instances_reparented': n, 'leaves_masked': leaves}
# AAA11 (2026-10-08): the layered materials' rows (ue_families.json aaa11): the rows a family takes besides its own (the
# ground's night for its wet gutters), and a tag rule per stone name (kind plain, after every other rule) giving the web's
# stone materials M_bx_plain's weathering (AaW)
def _aaa11_rows():
    A = TABLE.get('aaa11') or {}
    n_ = 0
    for fam, rows in (A.get('rows') or {}).items():
        f = TABLE['families'].get(fam)
        if not f: continue
        have = {r[0] for r in f.get('params', [])}
        f['params'] = list(f.get('params', [])) + [r for r in rows if r[0] not in have]
        n_ += 1
    if os.environ.get('BXUE_AAA11OFF'):   # a test aid: the same take without the layers (before-and-after crops)
        for f in [TABLE['families'].get(k) for k in ('ground', 'vk', 'pbr')] + [r for r in TABLE.get('assets', []) if r.get('master') == 'facade']:
            if f is not None: f['params'] = list(f.get('params', [])) + [['AaOn', 's', 0.0]]
        return 'off'
    # 'set': rows that replace a family's own of the same name (the HQ sets' cavity, so the joints read), or an asset
    # rule's ('asset:<match>')
    for fam, rows in (A.get('set') or {}).items():
        f = next((r for r in TABLE.get('assets', []) if r.get('match') == fam[6:]), None) if fam.startswith('asset:') else TABLE['families'].get(fam)
        if not f: continue
        names = {r[0] for r in rows}
        f['params'] = [r for r in f.get('params', []) if r[0] not in names] + [list(r) for r in rows]
        n_ += 1
    st = A.get('stone') or {}
    base = list((TABLE['families'].get('plain') or {}).get('params', []))
    for nm in st.get('names', []):
        TABLE.setdefault('tag_rules', []).append({'kind': 'plain', 'name_contains': [nm], 'master': 'plain', 'params': base + list(st.get('params', [])), '_doc': 'AAA11'})
        n_ += 1
    return n_


try: AAA11_ROWS = _aaa11_rows()
except Exception as e: AAA11_ROWS = f'error {e}'
# AAA11 end
# LOOK13 (2026-10-09): the rows ue_families.json look13 adds to a family (the ground's lawn and gravel sets, LkOn on where
# the prep found them); BXUE_LOOK13OFF=1 (a test aid) renders a take without them
def _look13_rows():
    A = TABLE.get('look13') or {}
    n_ = 0
    for fam, rows in (A.get('rows') or {}).items():
        f = TABLE['families'].get(fam)
        if not f: continue
        have = {r[0] for r in f.get('params', [])}
        f['params'] = list(f.get('params', [])) + [r for r in rows if r[0] not in have]
        if os.environ.get('BXUE_LOOK13OFF'): f['params'] = [r for r in f['params'] if r[0] != 'LkOn'] + [['LkOn', 's', 0.0]]
        n_ += 1
    # 'set': rows that replace a family's own of the same name (after AAA11's: the pbr walls' cavity, from a tag's hq.cav13
    # where the prep gives one)
    for fam, rows in (A.get('set') or {}).items():
        f = TABLE['families'].get(fam)
        if not f: continue
        names = {r[0] for r in rows}
        f['params'] = [r for r in f.get('params', []) if r[0] not in names] + [list(r) for r in rows]
        n_ += 1
    return n_


try: LOOK13_ROWS = _look13_rows()
except Exception as e: LOOK13_ROWS = f'error {e}'
# LOOK13 end
# LOOK13b (2026-10-09): the reeds' family (ue_families.json look13b.family: M_bx_reed), for the materials ue_prep tags 'reed'
try:
    if (TABLE.get('look13b') or {}).get('family'): TABLE['families'].setdefault('reed', TABLE['look13b']['family'])
except Exception as e:
    print(f'[bxue] LOOK13b: {e}')
# LOOK13b end
# LOOK13d (2026-10-09): the tag rules ue_families.json look13d adds (Bryant Park's pools on M_bx_water with their landing
# foam), after every other rule
try:
    for _r in (TABLE.get('look13d') or {}).get('tag_rules', []): TABLE.setdefault('tag_rules', []).append(_r)
except Exception as e:
    print(f'[bxue] LOOK13d: {e}')
# LOOK13d end
