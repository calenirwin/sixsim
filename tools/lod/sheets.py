# Lane B proof sheets: base (far boxes + fog) above lod16, 1:1 crops of the same region, from client/shots/arch_r1b.
#   python tools/lod/sheets.py
import os
from PIL import Image, ImageDraw
R = os.path.join(os.path.dirname(__file__), '..', '..', 'client', 'shots', 'arch_r1b')
OUT = os.path.join(R, 'sheets')
os.makedirs(OUT, exist_ok=True)
PAIRS = [
    # name, base file, lod16 file, crop box (1:1)
    ('bethesda_day', 'probe/scTerraceGolden_day_base_day.png', 'probe/scTerraceGolden_day_lod16_day.png', (640, 0, 1920, 640)),
    ('bethesda_night', 'probe/scTerraceGolden_night_base_night.png', 'probe/scTerraceGolden_night_lod16_night.png', (640, 0, 1920, 640)),
    ('bethesda_golden', 'probe/scTerraceGolden_golden_base_golden.png', 'probe/scTerraceGolden_golden_lod16_golden.png', (640, 0, 1920, 640)),
    ('viaduct_deck_day', 'sky/viaMid_day_base.png', 'sky/viaMid_day_lod16.png', (700, 300, 1920, 700)),
    ('viaduct_deck_night', 'sky/viaMid_night_base.png', 'sky/viaMid_night_lod16.png', (700, 300, 1920, 700)),
    ('terrace_mall_day', 'sky/bethMid_day_base.png', 'sky/bethMid_day_lod16.png', (300, 100, 1920, 520)),
    ('terrace_mall_night', 'sky/bethMid_night_base.png', 'sky/bethMid_night_lod16.png', (300, 100, 1920, 520)),
    ('aerial_day', 'sky/airS_day_base.png', 'sky/airS_day_lod16.png', (0, 300, 1920, 760)),
    ('aerial_night', 'sky/airS_night_base.png', 'sky/airS_night_lod16.png', (0, 300, 1920, 760)),
]
for name, fb, fl, box in PAIRS:
    pb, pl = os.path.join(R, fb), os.path.join(R, fl)
    if not (os.path.exists(pb) and os.path.exists(pl)):
        print('skip', name); continue
    a, b = Image.open(pb).convert('RGB').crop(box), Image.open(pl).convert('RGB').crop(box)
    w, h = a.size
    im = Image.new('RGB', (w, h * 2 + 8), (200, 30, 30))
    im.paste(a, (0, 0)); im.paste(b, (0, h + 8))
    d = ImageDraw.Draw(im)
    for y, t in ((4, 'far boxes + fog (today)'), (h + 12, '?lod16=1 (persistent tier, landmarks, no fog)')):
        d.rectangle((4, y, 8 + 7 * len(t), y + 14), fill=(0, 0, 0)); d.text((6, y + 1), t, fill=(255, 255, 255))
    f = os.path.join(OUT, name + '.png'); im.save(f); print(f, im.size)
