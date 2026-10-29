#!/usr/bin/env python3
"""
Draws the Simple layout's mountain backgrounds (night for dark mode, dawn for light mode) as SVG files in app/img/.
Run once after changing it:  python3 tools/make-backdrop.py
Layered ridges, each paler toward the horizon, with mist between them; the same seed always gives the same mountains.
"""
import os
import random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'img')
W, H = 1920, 1080


def ridge(rng, base, height, rough, steps=9):
    """Midpoint displacement: a natural-looking ridgeline from left to right."""
    n = 2 ** steps
    ys = [0.0] * (n + 1)
    ys[0], ys[n] = rng.uniform(-1, 1), rng.uniform(-1, 1)
    step, scale = n, 1.0
    while step > 1:
        half = step // 2
        for i in range(half, n, step):
            ys[i] = (ys[i - half] + ys[i + half]) / 2 + rng.uniform(-1, 1) * scale
        step, scale = half, scale * rough
    lo, hi = min(ys), max(ys)
    return [(W * i / n, base - height * (y - lo) / (hi - lo)) for i, y in enumerate(ys)]


def path(points):
    d = 'M0,%d ' % H + ' '.join('L%.1f,%.1f' % p for p in points) + ' L%d,%d Z' % (W, H)
    return d


# (base y, height, roughness) from the far range to the nearest
LAYERS = [(600, 320, 0.56), (680, 280, 0.54), (760, 240, 0.52), (860, 220, 0.5), (990, 200, 0.48)]

PALETTES = {
    'dark': {
        'sky': [('0', '#04060C'), ('0.5', '#0C1528'), ('1', '#22324D')],
        'glow': '#4A6488',
        'ridges': ['#34465F', '#26354B', '#1A2638', '#111A28', '#080D15'],
        'mist': '#2A3B57',
        'stars': True,
        'moon': ('#E9EEF6', '#9FB4D3'),
    },
    'light': {
        'sky': [('0', '#C9D3E2'), ('0.6', '#E4E2E6'), ('1', '#F4E6DC')],
        'glow': '#FBE9DA',
        'ridges': ['#B7C1D0', '#9EAABD', '#8392A8', '#697A93', '#53647D'],
        'mist': '#E9E6EA',
        'stars': False,
        'moon': None,
    },
}


def svg(name, pal):
    rng = random.Random(7)
    ridges = [ridge(rng, b, h, r) for b, h, r in LAYERS]
    out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" preserveAspectRatio="xMidYMid slice">' % (W, H), '<defs>',
           '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">' +
           ''.join('<stop offset="%s" stop-color="%s"/>' % s for s in pal['sky']) + '</linearGradient>',
           '<radialGradient id="glow" cx="0.62" cy="0.62" r="0.55"><stop offset="0" stop-color="%s" stop-opacity=".55"/>'
           '<stop offset="1" stop-color="%s" stop-opacity="0"/></radialGradient>' % (pal['glow'], pal['glow']),
           '<linearGradient id="mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="%s" stop-opacity="0"/>'
           '<stop offset="1" stop-color="%s" stop-opacity=".45"/></linearGradient>' % (pal['mist'], pal['mist']),
           '</defs>',
           '<rect width="%d" height="%d" fill="url(#sky)"/>' % (W, H),
           '<rect width="%d" height="%d" fill="url(#glow)"/>' % (W, H)]
    if pal['stars']:
        srng = random.Random(3)
        for _ in range(170):
            x, y = srng.uniform(0, W), srng.uniform(0, H * 0.55) ** 1.0
            r = srng.choice([0.6, 0.8, 0.8, 1.0, 1.0, 1.3, 1.7])
            out.append('<circle cx="%.0f" cy="%.0f" r="%.1f" fill="#fff" opacity="%.2f"/>' % (x, y, r, srng.uniform(0.15, 0.7)))
    if pal['moon']:
        mx, my = W * 0.74, H * 0.2
        out.append('<radialGradient id="halo"><stop offset="0" stop-color="%s" stop-opacity=".35"/>'
                   '<stop offset=".3" stop-color="%s" stop-opacity=".12"/><stop offset="1" stop-color="%s" stop-opacity="0"/></radialGradient>'
                   % (pal['moon'][1], pal['moon'][1], pal['moon'][1]))
        out.append('<circle cx="%.0f" cy="%.0f" r="220" fill="url(#halo)"/>' % (mx, my))
        out.append('<circle cx="%.0f" cy="%.0f" r="30" fill="%s" opacity=".92"/>' % (mx, my, pal['moon'][0]))
    for i, pts in enumerate(ridges):
        out.append('<path d="%s" fill="%s"/>' % (path(pts), pal['ridges'][i]))
        if i < len(ridges) - 1:
            top = min(p[1] for p in ridges[i + 1])
            out.append('<rect y="%.0f" width="%d" height="%.0f" fill="url(#mist)"/>' % (top - 120, W, 160))
    out.append('</svg>')
    with open(os.path.join(OUT, 'mountains-%s.svg' % name), 'w') as f:
        f.write('\n'.join(out))


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for n, p in PALETTES.items():
        svg(n, p)
    print('Wrote app/img/mountains-dark.svg and mountains-light.svg')
