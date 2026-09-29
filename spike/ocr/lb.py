"""Spike: read limit break (LB) by sampling 4 fixed diamond centres per support-card tile.

Cyan (filled) vs grey (empty) is decided per 5x5 patch. Colour-run scanning failed because card art
bleeds cyan into the band, so fixed slot positions per layout are used instead.
Verified 20/20 on the Support Card List (1920x1080) and 6/6 on the Career Info deck.
Usage: python lb.py <image> list|deck
"""
import sys
import numpy as np
from PIL import Image

# layout -> (first slot x, tile pitch, slot pitch, row ys, tiles per row)
LAYOUTS = {
    "list": (283, 114.25, 12.0, (215, 369, 524, 679), 5),
    "deck": (287, 93.0, 9.6, (625,), 5),   # 6th tile (Friends) is read at y=610
}


def is_filled(a, cx, cy):
    p = a[cy - 2:cy + 3, cx - 2:cx + 3].reshape(-1, 3).astype(int)
    return ((p[:, 2] - p[:, 0] > 60) & (p[:, 1] > 140)).mean() > 0.5


def read(a, first, pitch, sp, y, n):
    return [sum(is_filled(a, int(round(first + t * pitch + k * sp)), y) for k in range(4)) for t in range(n)]


if __name__ == "__main__":
    a = np.asarray(Image.open(sys.argv[1]).convert("RGB"))
    first, pitch, sp, ys, n = LAYOUTS[sys.argv[2]]
    for y in ys:
        print(y, read(a, first, pitch, sp, y, n))
    if sys.argv[2] == "deck":
        print("friend", read(a, first + 5 * pitch, pitch, sp, 610, 1))
