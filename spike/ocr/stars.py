"""Spike: count gold stars under each spark pill in the 'Sparks' popup / Inspiration tab.

Approach: find spark label rows via OCR boxes (passed in), then scan a strip below each label
for three star-sized blobs and classify each as gold (filled) or grey (empty) by hue.
Here we locate star strips directly by colour to keep the spike self-contained.
"""
import sys
import numpy as np
from PIL import Image


def star_mask(a):
    r, g, b = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
    gold = (r > 200) & (g > 150) & (b < 90) & (r - b > 130)
    return gold


def grey_star_mask(a):
    r, g, b = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
    return (abs(r - g) < 12) & (abs(g - b) < 12) & (r > 175) & (r < 225)


def count_stars(img, x, y, w=60, h=18):
    """Split the strip into 3 equal cells; a cell is filled if >15% of its pixels are gold."""
    a = np.asarray(img.convert("RGB"))[y:y + h, x:x + w]
    m = star_mask(a)
    cells = np.array_split(m, 3, axis=1)
    ratios = [c.mean() for c in cells]
    return sum(r > 0.15 for r in ratios), [round(r, 2) for r in ratios]


if __name__ == "__main__":
    img = Image.open(sys.argv[1])
    a = np.asarray(img.convert("RGB"))
    # Pill columns in the Sparks popup (1920x1080): left pills x≈280-548, right x≈558-826.
    # Star strips are centred under each pill at x≈385 (left) and x≈665 (right).
    m = star_mask(a)
    for col_name, x0 in (("L", 382), ("R", 662)):
        rows = m[:, x0:x0 + 70].sum(axis=1)
        ys = np.where(rows > 3)[0]
        # group consecutive rows into strips
        groups, start = [], None
        for i, y in enumerate(ys):
            if start is None:
                start = prev = y
            elif y - prev > 3:
                groups.append((start, prev)); start = y
            prev = y
        if start is not None:
            groups.append((start, prev))
        for g0, g1 in groups:
            if g1 - g0 < 8:
                continue
            n, ratios = count_stars(img, x0, g0, 70, g1 - g0 + 1)
            print(col_name, f"y={g0}-{g1}", "stars=", n, ratios)
