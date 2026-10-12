"""Makes the tileable ground textures the 3D view blends by terrain type.

Every texture wraps on both axes, so the shader can repeat it across the map.
Noise comes from filtering white noise in the frequency domain, which is periodic by construction.
Output: public3d/terrain/*.jpg (colour) and *_n.jpg (normal maps, OpenGL convention).
Usage: python3 scripts/terrain_textures.py
"""
import math
import os

import numpy as np
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'public3d', 'terrain')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(42)


def pnoise(n, scale, seed, octaves=3, gain=0.5):
    """Periodic noise in [0, 1]. scale: feature size in pixels."""
    r = np.random.default_rng(seed)
    fy = np.fft.fftfreq(n)[:, None]
    fx = np.fft.fftfreq(n)[None, :]
    f = np.sqrt(fx * fx + fy * fy)
    out = np.zeros((n, n))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        s = scale / (2 ** o)
        w = r.standard_normal((n, n))
        filt = np.exp(-(f * s) ** 2 * 4.0)
        layer = np.real(np.fft.ifft2(np.fft.fft2(w) * filt))
        layer = (layer - layer.mean()) / (layer.std() + 1e-9)
        out += amp * layer
        tot += amp
        amp *= gain
    out /= tot
    return np.clip(0.5 + out * 0.22, 0, 1)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def mix(a, b, t):
    t = np.asarray(t)
    return a + (b - a) * t[..., None]


def strokes(n, count, seed, length=(3, 8), angle=(-1.25, 0.45), width=1, light=(150, 200), dark=(70, 110)):
    """Short light and dark dashes that wrap at the edges. Returns -1..1."""
    r = np.random.default_rng(seed)
    img = Image.new('L', (n, n), 128)
    d = ImageDraw.Draw(img)
    px = r.integers(0, n, count)
    py = r.integers(0, n, count)
    ln = r.uniform(*length, count)
    an = r.normal(angle[0], angle[1], count)
    val = np.where(r.random(count) < 0.5, r.integers(*dark, count), r.integers(*light, count))
    for i in range(count):
        x0, y0 = int(px[i]), int(py[i])
        x1, y1 = int(x0 + math.cos(an[i]) * ln[i]), int(y0 + math.sin(an[i]) * ln[i])
        for ox in (-n, 0, n):
            for oy in (-n, 0, n):
                if -10 < x0 + ox < n + 10 and -10 < y0 + oy < n + 10:
                    d.line((x0 + ox, y0 + oy, x1 + ox, y1 + oy), fill=int(val[i]), width=width)
    return (np.asarray(img, np.float64) - 128) / 128


def dots(n, clusters, per, seed, radius=(1.2, 2.4), spread=14, colors=None):
    """Wrapped clusters of small dots (flowers, pebbles). Returns (rgb, alpha)."""
    r = np.random.default_rng(seed)
    img = Image.new('RGB', (n, n))
    msk = Image.new('L', (n, n))
    d1, d2 = ImageDraw.Draw(img), ImageDraw.Draw(msk)
    for _ in range(clusters):
        cx, cy = r.integers(0, n, 2)
        c = colors[r.integers(0, len(colors))]
        for _ in range(int(r.integers(per[0], per[1]))):
            ox, oy = r.normal(0, spread, 2)
            rad = r.uniform(*radius)
            for wx in (-n, 0, n):
                for wy in (-n, 0, n):
                    x, y = cx + ox + wx, cy + oy + wy
                    if -5 < x < n + 5 and -5 < y < n + 5:
                        d1.ellipse((x - rad, y - rad, x + rad, y + rad), fill=c)
                        d2.ellipse((x - rad, y - rad, x + rad, y + rad), fill=255)
    return np.asarray(img, np.float64) / 255, np.asarray(msk, np.float64) / 255


def voronoi(n, cells, seed, jitter=0.8):
    """Periodic Voronoi: F1, F2 distances (in cell units) and a per-cell random tone."""
    r = np.random.default_rng(seed)
    pts = (r.random((cells, cells, 2)) * jitter + (1 - jitter) / 2)
    tone = r.random((cells, cells))
    g = (np.arange(n) + 0.5) / n * cells
    gx, gy = np.meshgrid(g, g)
    ix, iy = np.floor(gx).astype(int), np.floor(gy).astype(int)
    d1 = np.full((n, n), 9.0)
    d2 = np.full((n, n), 9.0)
    tb = np.zeros((n, n))
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            cx, cy = ix + ox, iy + oy
            wx, wy = cx % cells, cy % cells
            px = cx + pts[wy, wx, 0]
            py = cy + pts[wy, wx, 1]
            d = np.sqrt((gx - px) ** 2 + (gy - py) ** 2)
            closer = d < d1
            d2 = np.where(closer, d1, np.minimum(d2, d))
            tb = np.where(closer, tone[wy, wx], tb)
            d1 = np.where(closer, d, d1)
    return d1, d2, tb


def normal_from_height(h, strength):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    nx, ny = -gx * strength, gy * strength
    l = np.sqrt(nx * nx + ny * ny + 1)
    return np.stack([nx / l, ny / l, 1 / l], -1) * 0.5 + 0.5


def save(name, arr, q=88):
    Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, name), quality=q, optimize=True)


N = 512

# Grass: two greens, dry patches, blade grain, a few flowers. Repeats every 2 tiles in the shader.
n1, n2 = pnoise(N, 90, 1), pnoise(N, 22, 2)
grass = mix(rgb('#46672f'), rgb('#557837'), smooth(0.25, 0.75, n1))
grass = mix(grass, rgb('#6c8a45'), smooth(0.55, 0.85, n2) * 0.35)
grass = mix(grass, rgb('#8a875a'), smooth(0.7, 0.9, n1 * 0.6 + n2 * 0.4) * 0.2)
st = strokes(N, 14000, 3)
grass *= (1 + st * 0.13)[..., None]
fc, fa = dots(N, 7, (6, 18), 4, colors=[(245, 245, 235), (250, 222, 90), (190, 150, 230), (250, 170, 190)])
grass = mix(grass, fc, fa * 0.9)
save('grass.jpg', grass)
save('grass_n.jpg', normal_from_height(n2 * 0.6 + st * 0.35, 2.2), 90)

# Meadow (pasture floor): lighter, lusher, more flowers.
m1 = pnoise(N, 70, 5)
meadow = mix(rgb('#5e8040'), rgb('#71904a'), smooth(0.3, 0.75, m1))
meadow *= (1 + strokes(N, 16000, 6, length=(4, 9)) * 0.12)[..., None]
fc, fa = dots(N, 14, (8, 22), 7, colors=[(250, 250, 240), (252, 226, 92), (236, 140, 170)])
meadow = mix(meadow, fc, fa * 0.9)
save('meadow.jpg', meadow)

# Dirt (raptor pens, rock bases): packed earth, pebbles, faint claw scratches.
d1n, d2n = pnoise(N, 60, 8), pnoise(N, 10, 9)
dirt = mix(rgb('#735a3b'), rgb('#866944'), smooth(0.3, 0.7, d1n))
dirt *= (0.86 + 0.28 * d2n)[..., None]
pc, pa = dots(N, 40, (2, 6), 10, radius=(1.0, 2.6), spread=8, colors=[(120, 108, 92), (150, 138, 118), (90, 80, 70)])
dirt = mix(dirt, pc, pa * 0.8)
scr = Image.new('L', (N, N))
sd = ImageDraw.Draw(scr)
for _ in range(10):
    cx, cy = rng.uniform(0, N, 2)
    a = rng.uniform(0, math.pi * 2)
    L = rng.uniform(18, 34)
    for j in range(3):
        o = (j - 1) * 5
        sx, sy = cx + math.cos(a + math.pi / 2) * o, cy + math.sin(a + math.pi / 2) * o
        for wx in (-N, 0, N):
            for wy in (-N, 0, N):
                sd.line((sx + wx, sy + wy, sx + math.cos(a) * L + wx, sy + math.sin(a) * L + wy), fill=255, width=2)
sc = np.asarray(scr, np.float64) / 255
dirt *= (1 - 0.35 * sc)[..., None]
save('dirt.jpg', dirt)
save('dirt_n.jpg', normal_from_height(d2n * 0.7 + pa * 0.8 - sc * 0.6, 2.5), 90)

# Jungle floor (T. rex paddock): moss, leaf litter, dark damp earth.
j1, j2 = pnoise(N, 80, 11), pnoise(N, 16, 12)
jungle = mix(rgb('#2f3d1f'), rgb('#4b5a2a'), smooth(0.3, 0.7, j1))
jungle = mix(jungle, rgb('#4a3a26'), smooth(0.6, 0.8, j2) * 0.45)
leaves = Image.new('RGB', (N, N))
lm = Image.new('L', (N, N))
l1, l2 = ImageDraw.Draw(leaves), ImageDraw.Draw(lm)
for _ in range(2600):
    cx, cy = rng.uniform(0, N, 2)
    a = rng.uniform(0, math.pi)
    L, Wd = rng.uniform(4, 9), rng.uniform(1.6, 3.2)
    c = [(96, 84, 38), (120, 96, 44), (70, 82, 34), (138, 110, 52), (60, 70, 30)][rng.integers(0, 5)]
    pts = [(cx + math.cos(a) * L, cy + math.sin(a) * L), (cx + math.cos(a + 1.57) * Wd, cy + math.sin(a + 1.57) * Wd),
           (cx - math.cos(a) * L, cy - math.sin(a) * L), (cx - math.cos(a + 1.57) * Wd, cy - math.sin(a + 1.57) * Wd)]
    for wx in (-N, 0, N):
        for wy in (-N, 0, N):
            sh = [(x + wx, y + wy) for x, y in pts]
            l1.polygon(sh, fill=c)
            l2.polygon(sh, fill=255)
la = np.asarray(lm, np.float64) / 255 * (0.35 + 0.65 * smooth(0.35, 0.65, pnoise(N, 50, 13)))
jungle = mix(jungle, np.asarray(leaves, np.float64) / 255, la * 0.8)
jungle *= (1 + strokes(N, 6000, 14, length=(3, 6)) * 0.1)[..., None]
save('jungle.jpg', jungle)
save('jungle_n.jpg', normal_from_height(j2 * 0.5 + la * 0.6, 2.4), 90)

# Flagstones (paths): pale sandstone slabs with dark joints. One texture spans 3 tiles.
F1, F2, tone = voronoi(1024, 10, 15)
edge = smooth(0.0, 0.07, F2 - F1)
s1 = pnoise(1024, 30, 16)
stone = mix(rgb('#ad9a7b'), rgb('#cbb994'), tone)
stone *= (0.9 + 0.2 * s1)[..., None]
stone *= (1 + (rng.random((1024, 1024)) - 0.5) * 0.08)[..., None]
stone = mix(rgb('#6d6250'), stone, edge)
Image.fromarray((np.clip(stone, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, 'flagstone.jpg'), quality=88, optimize=True)
fh = edge * 0.9 + s1 * 0.12 + smooth(0.0, 0.3, F2 - F1) * 0.3
save('flagstone_n.jpg', normal_from_height(fh, 6.0), 90)

# Gravel (fence strips), sand (shore), concrete (pads), mud (wet spots).
g1 = rng.random((N, N))
gravel = mix(rgb('#7c776c'), rgb('#a39d8f'), g1) * (0.9 + 0.2 * pnoise(N, 12, 17))[..., None]
save('gravel.jpg', gravel)
sand = mix(rgb('#a8956b'), rgb('#c7b386'), pnoise(N, 40, 18)) * (0.94 + 0.12 * rng.random((N, N)))[..., None]
save('sand.jpg', sand)
conc = mix(rgb('#8f8c86'), rgb('#a8a59e'), pnoise(N, 50, 19)) * (1 + (rng.random((N, N)) - 0.5) * 0.06)[..., None]
seams = ((np.arange(N) % 128) < 2)
conc[seams, :, :] *= 0.8
conc[:, seams, :] *= 0.8
save('concrete.jpg', conc)
mud = mix(rgb('#3d3123'), rgb('#5a4733'), pnoise(N, 50, 20)) * (0.9 + 0.2 * pnoise(N, 8, 21))[..., None]
save('mud.jpg', mud)

# Macro noise for breaking up repetition across the map.
mac = np.stack([pnoise(256, 40, 22), pnoise(256, 12, 23), pnoise(256, 80, 24)], -1)
save('macro.jpg', mac, 92)
print('terrain textures written to', os.path.abspath(OUT))
for f in sorted(os.listdir(OUT)):
    print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, 'KB')
