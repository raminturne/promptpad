# -*- coding: utf-8 -*-
"""Assembles the app icons from the renders tools/make-next-icons.cjs produced.

    electron tools/make-next-icons.cjs   # renders build/icon-src/icon-<n>.png
    python tools/make-next-icons.py      # writes build/icon.ico, icon.png, icon-1024.png

Windows picks the ICO entry closest to the size it needs, so the small sizes
are their own vector renders rather than a downscale of the big one.
"""
import io
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'build', 'icon-src')
BUILD = os.path.join(ROOT, 'build')

ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]


def load(size):
    im = Image.open(os.path.join(SRC, 'icon-%d.png' % size)).convert('RGBA')
    assert im.size == (size, size), (size, im.size)
    return im


frames = [load(s) for s in ICO_SIZES]
frames[-1].save(os.path.join(BUILD, 'icon.ico'), format='ICO',
                sizes=[(s, s) for s in ICO_SIZES], append_images=frames[:-1])

load(512).save(os.path.join(BUILD, 'icon.png'))
load(1024).save(os.path.join(BUILD, 'icon-1024.png'))

ico = Image.open(os.path.join(BUILD, 'icon.ico'))
print('icon.ico   ', sorted(ico.info.get('sizes', [])))
for name in ('icon.ico', 'icon.png', 'icon-1024.png'):
    p = os.path.join(BUILD, name)
    print('%-13s %6.1f KB' % (name, os.path.getsize(p) / 1024.0))
