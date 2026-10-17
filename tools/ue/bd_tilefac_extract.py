# BD40 (backdrop lane): the facade's own GLSL out of the dumped program (tools/ue/bd_tilefac_dump.js): its colour block and
# its later blocks, preprocessed with the program's defines (gcc -E), for tools/ue/bd_tilefac_port.py. python3 bd_tilefac_extract.py <dir>
import re, subprocess, sys, os
D = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(D, 'facade_0.frag')).read().split('\n')
def block_from(i0):
    """the brace block opening on line i0 (index), to its matching close"""
    depth = 0; started = False
    for i in range(i0, len(src)):
        s = re.sub(r'//.*', '', src[i])
        for ch in s:
            if ch == '{': depth += 1; started = True
            elif ch == '}': depth -= 1
        if started and depth == 0: return i0, i
    raise SystemExit('unbalanced')
k = next(i for i, l in enumerate(src) if 'building rebuilt by the NYC dresser' in l)
b0 = k - 1
assert src[b0].strip() == '{', src[b0]
c0, c1 = block_from(b0)
defs = [l for l in src[:200] if l.startswith('#define') and '(' not in l.split()[1]]
def pre(lines):
    txt = '\n'.join(defs + lines)
    r = subprocess.run(['gcc', '-E', '-P', '-x', 'c', '-std=c99', '-w', '-'], input=txt, capture_output=True, text=True)
    if r.returncode: print(r.stderr[:2000]); raise SystemExit(1)
    return r.stdout
open(os.path.join(D, 'fac_color.glsl'), 'w').write(pre(src[c0:c1 + 1]))
# later blocks: roughness (from 'roughnessFactor = FAC_rough;' to the end of its damp block), normal, emissive
def span(start_pat, end_pat):
    a = next(i for i, l in enumerate(src) if start_pat in l)
    b = next(i for i in range(a, len(src)) if end_pat in src[i])
    return src[a:b + 1]
open(os.path.join(D, 'fac_rough.glsl'), 'w').write(pre(span('roughnessFactor = FAC_rough;', 'roughnessFactor = mix(roughnessFactor, 0.4, dampF * 0.55);')))
open(os.path.join(D, 'fac_normal.glsl'), 'w').write(pre(span('normal = normalize(normal + FAC_nrmAdj);', 'diffuseColor.rgb *= FAC_grainV;')))
print('colour block lines', c0 + 1, c1 + 1, '->', len(open(os.path.join(D, 'fac_color.glsl')).read().split('\n')), 'after preprocessing')
