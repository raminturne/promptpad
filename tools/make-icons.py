# -*- coding: utf-8 -*-
"""Builds every icon the app ships, from Logox.png.
Run from the repo root:  python tools/make-icons.py

    build/icon-1024.png   macOS source (electron-builder makes the .icns)
    build/icon.png        Linux, and the window icon off Windows
    build/icon.ico        Windows: exe, taskbar and tray, 7 sizes in one file

The mark is a pair of brackets with a caret between them — the placeholder
syntax the app is built around.

Two things this does that a plain resize does not:

* The source is 1148x1156, four pixels off square, so it is re-centred on a
  square canvas first. Scaling a not-quite-square source straight down
  squashes the brackets by a fraction of a percent: invisible at 256,
  obvious at 16.

* 16, 24 and 32 are drawn on the pixel grid rather than resampled. Three
  thin vertical strokes with a one-pixel gap either side is below what a
  16-pixel grid can hold, and resampling turned the mark into a smudge —
  in the taskbar, which is where most people will ever see it. From 48 up
  the source is sharp enough to scale.
"""
import io
import os
import struct
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'Logox.png')
BUILD = os.path.join(ROOT, 'build')

BG = (27, 30, 35, 255)
FG = (247, 248, 249, 255)

src = Image.open(SRC).convert('RGBA')
side = max(src.size)
square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
square.paste(src, ((side - src.size[0]) // 2, (side - src.size[1]) // 2))
print('source %dx%d -> square %d' % (src.size[0], src.size[1], side))


def hand(size):
    """A bracket pair with a caret, laid out on whole pixels."""
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if size == 16:
        d.rounded_rectangle([0, 0, 15, 15], radius=4, fill=BG)
        d.rectangle([3, 4, 3, 11], fill=FG)      # left bracket
        d.rectangle([3, 4, 5, 4], fill=FG)
        d.rectangle([3, 11, 5, 11], fill=FG)
        d.rectangle([7, 5, 7, 10], fill=FG)      # caret
        d.rectangle([11, 4, 11, 11], fill=FG)    # right bracket
        d.rectangle([9, 4, 11, 4], fill=FG)
        d.rectangle([9, 11, 11, 11], fill=FG)
    elif size == 24:
        d.rounded_rectangle([0, 0, 23, 23], radius=6, fill=BG)
        d.rectangle([5, 6, 5, 17], fill=FG)
        d.rectangle([5, 6, 8, 6], fill=FG)
        d.rectangle([5, 17, 8, 17], fill=FG)
        d.rectangle([11, 7, 12, 16], fill=FG)
        d.rectangle([18, 6, 18, 17], fill=FG)
        d.rectangle([15, 6, 18, 6], fill=FG)
        d.rectangle([15, 17, 18, 17], fill=FG)
    else:                                        # 32
        d.rounded_rectangle([0, 0, 31, 31], radius=8, fill=BG)
        d.rectangle([7, 8, 8, 23], fill=FG)
        d.rectangle([7, 8, 12, 9], fill=FG)
        d.rectangle([7, 22, 12, 23], fill=FG)
        d.rectangle([15, 10, 16, 21], fill=FG)
        d.rectangle([23, 8, 24, 23], fill=FG)
        d.rectangle([19, 8, 24, 9], fill=FG)
        d.rectangle([19, 22, 24, 23], fill=FG)
    return im


def png(name, size):
    p = os.path.join(BUILD, name)
    square.resize((size, size), Image.LANCZOS).save(p, 'PNG', optimize=True)
    print('  %-16s %4d  %d bytes' % (name, size, os.path.getsize(p)))


png('icon-1024.png', 1024)
png('icon.png', 512)

SIZES = [16, 24, 32, 48, 64, 128, 256]
images = [hand(s) if s <= 32 else square.resize((s, s), Image.LANCZOS) for s in SIZES]

# An .ico is a 6-byte header, a 16-byte directory entry per image, then the
# image data. PNG payloads are what Windows has read since Vista, and the
# file this replaces was already PNG-in-ICO.
blobs = []
for im in images:
    b = io.BytesIO()
    im.save(b, 'PNG', optimize=True)
    blobs.append(b.getvalue())

out = io.BytesIO()
out.write(struct.pack('<HHH', 0, 1, len(SIZES)))
offset = 6 + 16 * len(SIZES)
for s, blob in zip(SIZES, blobs):
    out.write(struct.pack('<BBBBHHII',
                          0 if s >= 256 else s,    # 0 means 256
                          0 if s >= 256 else s,
                          0, 0, 1, 32, len(blob), offset))
    offset += len(blob)
for blob in blobs:
    out.write(blob)

p = os.path.join(BUILD, 'icon.ico')
open(p, 'wb').write(out.getvalue())
print('  %-16s       %d bytes, sizes %s' % ('icon.ico', os.path.getsize(p), SIZES))
