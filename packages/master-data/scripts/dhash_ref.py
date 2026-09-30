#!/usr/bin/env python3
"""Independent reference implementation of the dHash in src/dhash.ts; writes test/dhash.vectors.json.

Pure Python integers only (no numpy/PIL), so it shares no code with the TypeScript version.
Run: python3 scripts/dhash_ref.py
"""
import json
import os

MASK32 = 0xFFFFFFFF


def gen_image(g):
    w, h, kind = g["width"], g["height"], g["kind"]
    px = []
    if kind == "lcg":
        s = g["seed"] & MASK32
        for _ in range(w * h):
            p = []
            for _c in range(4):
                s = (s * 1664525 + 1013904223) & MASK32
                p.append(s >> 24)
            if not g.get("alpha", False):
                p[3] = 255
            px.append(p)
        return px
    for y in range(h):
        for x in range(w):
            if kind == "gradient-x-asc":
                v = x * 255 // (w - 1)
            elif kind == "gradient-x-desc":
                v = 255 - x * 255 // (w - 1)
            elif kind == "gradient-y":
                v = y * 255 // (h - 1)
            elif kind == "checker":
                v = 255 if ((x // 3) + (y // 3)) % 2 == 0 else 0
            else:
                raise ValueError(kind)
            px.append([v, v, v, 255])
    return px


def dhash(w, h, px, box):
    x0, x1 = box[0] * w // 1000, box[2] * w // 1000
    y0, y1 = box[1] * h // 1000, box[3] * h // 1000
    cw, ch = x1 - x0, y1 - y0
    assert cw >= 9 and ch >= 8
    # cell boundaries floor(i*cw/9): pixel x belongs to the cell i with b[i] <= x < b[i+1]
    cb = [i * cw // 9 for i in range(10)]
    rb = [j * ch // 8 for j in range(9)]
    sums = [[0] * 9 for _ in range(8)]
    cnts = [[0] * 9 for _ in range(8)]
    for j in range(8):
        for i in range(9):
            for y in range(rb[j], rb[j + 1]):
                for x in range(cb[i], cb[i + 1]):
                    r, g, b, a = px[(y0 + y) * w + (x0 + x)]
                    f = [(c * a + 255 * (255 - a) + 127) // 255 for c in (r, g, b)]
                    sums[j][i] += 299 * f[0] + 587 * f[1] + 114 * f[2]
                    cnts[j][i] += 1
    bits = 0
    for j in range(8):
        for i in range(8):
            bit = 1 if sums[j][i] * cnts[j][i + 1] > sums[j][i + 1] * cnts[j][i] else 0
            bits = (bits << 1) | bit
    return format(bits, "016x")


FULL = [0, 0, 1000, 1000]
CASES = [
    ("horizontal gradient ascending -> every left cell is darker -> all zero", dict(kind="gradient-x-asc", width=90, height=80), FULL),
    ("horizontal gradient descending -> every left cell is brighter -> all one", dict(kind="gradient-x-desc", width=90, height=80), FULL),
    ("vertical gradient: rows are constant -> equal cells -> all zero", dict(kind="gradient-y", width=64, height=64), FULL),
    ("minimum size 9x8 gradient descending", dict(kind="gradient-x-desc", width=9, height=8), FULL),
    ("checker 3px, size not divisible by 9/8", dict(kind="checker", width=37, height=29), FULL),
    ("seeded noise 128x128", dict(kind="lcg", seed=1, width=128, height=128), FULL),
    ("seeded noise 233x256 (veteran icon size)", dict(kind="lcg", seed=20260930, width=233, height=256), FULL),
    ("seeded noise with alpha, 101x77", dict(kind="lcg", seed=7, width=101, height=77, alpha=True), FULL),
    ("seeded noise 128x128, card-art crop", dict(kind="lcg", seed=42, width=128, height=128), [100, 340, 900, 780]),
    ("seeded noise 256x256, char-icon crop", dict(kind="lcg", seed=99, width=256, height=256), [180, 150, 820, 750]),
    ("seeded noise 233x256, veteran-icon crop", dict(kind="lcg", seed=5, width=233, height=256), [220, 150, 780, 700]),
]


def main():
    out = []
    for name, g, box in CASES:
        px = gen_image(g)
        out.append({"name": name, "generator": g, "crop": dict(zip(["x0", "y0", "x1", "y1"], box)), "hash": dhash(g["width"], g["height"], px, box)})
    path = os.path.join(os.path.dirname(__file__), "..", "test", "dhash.vectors.json")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump({"definition": "src/dhash.ts, DHASH_VERSION 1", "vectors": out}, f, indent=2)
        f.write("\n")
    print("wrote", len(out), "vectors")
    for v in out:
        print(v["hash"], v["name"])


if __name__ == "__main__":
    main()
