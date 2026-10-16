# -*- coding: utf-8 -*-
"""Rewrites the download buttons in README.md for a given version.

    python tools/readme-downloads.py 4.2.0

The buttons point straight at that release's files rather than at the releases
page, so one click gets the installer. That means they go stale the moment a
new version ships — hence this script, which the release flow runs.
"""
import io
import os
import re
import sys

VER = sys.argv[1] if len(sys.argv) > 1 else None
if not VER:
    raise SystemExit('usage: readme-downloads.py <version>')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = 'raminturne/promptpad'
BASE = 'https://github.com/%s/releases/download/v%s/' % (REPO, VER)

# label, right-hand text, colour, logo, file
BUTTONS = [
    ('Windows', 'Installer v%s' % VER, '0b65c2', 'windows', 'PromptPad-Setup-%s.exe' % VER),
    ('macOS', 'Apple Silicon v%s' % VER, '1b1b1f', 'apple', 'PromptPad-%s-arm64.dmg' % VER),
    ('macOS', 'Intel v%s' % VER, '3a3a40', 'apple', 'PromptPad-%s.dmg' % VER),
    ('Linux', '.deb v%s' % VER, 'e05a1b', 'linux', 'promptpad_%s_amd64.deb' % VER),
    ('Linux', '.AppImage v%s' % VER, '5a5a60', 'linux', 'PromptPad-%s.AppImage' % VER),
]


def esc(s):
    return s.replace('-', '--').replace('_', '__').replace(' ', '%20')


lines = []
for label, right, colour, logo, filename in BUTTONS:
    img = ('https://img.shields.io/badge/%s-%s-%s?style=for-the-badge&logo=%s&logoColor=white'
           % (esc(label), esc(right), colour, logo))
    lines.append('[![%s %s](%s)](%s%s)' % (label, right, img, BASE, filename))

block = '\n'.join(lines)

path = os.path.join(ROOT, 'README.md')
src = io.open(path, encoding='utf-8', newline='').read()
crlf = '\r\n' in src
s = src.replace('\r\n', '\n')

start, end = '<!-- downloads:start -->', '<!-- downloads:end -->'
assert s.count(start) == 1 and s.count(end) == 1, 'download markers missing from README'
a = s.index(start) + len(start)
b = s.index(end)
s = s[:a] + '\n' + block + '\n' + s[b:]

# the version inside the release badge line, so the two never disagree
s = re.sub(r'(releases/download/v)\d+\.\d+\.\d+(/)', r'\g<1>%s\g<2>' % VER, s)

io.open(path, 'w', encoding='utf-8', newline='').write(s.replace('\n', '\r\n') if crlf else s)
print('download buttons -> v%s' % VER)
