#!/usr/bin/env python3
"""Records ROI OCR fixtures (agent/tests/fixtures/ocr-roi/<fixture>.json) for the ROIs whose full-frame recording
misses or merges glyphs: the per-tile 'Lvl N' text of the Career Info deck (fixture 05) and the support card list (13).
ROIs come from agent/layouts/global-2026-09.json using the same formulas as the C# parsers
(round-half-away-from-zero of x0 + t*pitch). Apple Vision on the ROI crop upscaled x2 stands in for the Windows adapter
(30 §7); H4 re-records on Windows. Usage (repo root, macOS): python3 agent/tests/tools/record_roi_ocr.py"""
import json, math, subprocess, os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
layout = json.load(open(os.path.join(ROOT, 'agent/layouts/global-2026-09.json')))
def rnd(v): return int(math.floor(v + 0.5))
def deck_rois():
    d = layout['career']['deck']; r = d['levelRoi']
    return [[rnd(d['tileX'] + t * d['tilePitch']) + r[0], r[1], r[2], r[3]] for t in range(d['tiles'])]
def list_rois():
    g = layout['cardsList']; r = g['levelRoi']; out = []
    for y in g['diamondRows']:
        if y > g['visibleBottom']: break
        for c in range(g['columns']):
            out.append([rnd(g['tileX'] + c * g['tilePitch']) + r[0], y + r[1], r[2], r[3]])
    return out
jobs = {'05-veteran-details-career-info-deck-legacy': deck_rois(), '13-support-card-list': list_rois()}
for fixture, rois in jobs.items():
    png = os.path.join(ROOT, 'docs/reference/screenshots', fixture + '.png')
    args = ['swift', os.path.join(ROOT, 'agent/tests/tools/record-roi-ocr.swift'), png] + [','.join(map(str, r)) for r in rois]
    data = json.loads(subprocess.check_output(args))
    data['fixture'] = fixture
    out = os.path.join(ROOT, 'agent/tests/fixtures/ocr-roi', fixture + '.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w') as fh: json.dump(data, fh, indent=1, sort_keys=True, ensure_ascii=False); fh.write('\n')
    print(fixture, len(data['roiLines']), 'rois')
