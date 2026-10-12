"""Shrinks the nature kit's textures for phones. Called by scripts/assets3d.mjs.

Leaf textures are swapped for the kit's white masks, so the 3D view can tint each tree.
Output: .tex-tmp/<source name>.<jpg|png>
"""
import os
import sys

from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else 'assets-src/nature'
OUT = '.tex-tmp'
os.makedirs(OUT, exist_ok=True)

# Source file -> (output size, format). Leaf colour versions (_C) use the white mask instead.
SPEC = {
    'Bark_NormalTree.png': (512, 'jpg'),
    'Bark_NormalTree_Normal.png': (512, 'jpg'),
    'Bark_TwistedTree.png': (512, 'jpg'),
    'Bark_TwistedTree_Normal.png': (512, 'jpg'),
    'Bark_DeadTree.png': (512, 'jpg'),
    'Bark_DeadTree_Normal.png': (512, 'jpg'),
    'Leaves_NormalTree.png': (512, 'png'),
    'Leaves_TwistedTree.png': (512, 'png'),
    'Leaf_Pine.png': (512, 'png'),
    'Leaves.png': (512, 'png'),
    'Grass.png': (256, 'jpg'),
    'Flowers.png': (512, 'png'),
    'Rocks_Diffuse.png': (1024, 'jpg'),
    'PathRocks_Diffuse.png': (512, 'jpg'),
    'Mushrooms.png': (256, 'png'),
}

for name, (size, fmt) in SPEC.items():
    src = os.path.join(SRC, name)
    if not os.path.exists(src):
        print('missing', src)
        continue
    im = Image.open(src)
    has_alpha = im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info)
    im = im.convert('RGBA' if has_alpha and fmt == 'png' else 'RGB')
    im = im.resize((size, size), Image.LANCZOS)
    out = os.path.join(OUT, name.rsplit('.', 1)[0] + '.' + fmt)
    if fmt == 'jpg':
        im.save(out, quality=90 if 'Normal' in name else 84, optimize=True)
    else:
        im.save(out, optimize=True)
    print(f'{name} -> {os.path.basename(out)} {os.path.getsize(out) // 1024} KB')
