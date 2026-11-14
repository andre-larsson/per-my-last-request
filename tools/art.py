#!/usr/bin/env python3
"""Cut the generated portraits in assets-src/raw/ down to the size the game loads.

Usage: python3 tools/art.py
Writes assets/art/<name>.webp at 384 px. Where two variants were generated, PICKS names the one in use.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'assets-src' / 'raw'
OUT = ROOT / 'assets' / 'art'
SIZE = 384
PICKS = {'hero': 'hero-a', 'champion': 'champion-a'}
NAMES = ['hero', 'camp', 'rat', 'noticeboard', 'boar', 'purse', 'bruiser', 'medic', 'quickfoot', 'armorer', 'bench', 'champion', 'road']

OUT.mkdir(parents=True, exist_ok=True)
for name in NAMES:
    source = RAW / f'{PICKS.get(name, name)}.png'
    if not source.exists():
        print(f'missing {source.relative_to(ROOT)}; the game shows a letter placeholder for {name}')
        continue
    image = Image.open(source).convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)
    target = OUT / f'{name}.webp'
    image.save(target, 'WEBP', quality=86, method=6)
    print(f'{target.relative_to(ROOT)}  {target.stat().st_size // 1024} KB  corner #{"%02x%02x%02x" % image.getpixel((4, 4))}')
