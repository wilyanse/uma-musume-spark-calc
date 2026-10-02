#!/usr/bin/env python3
"""Records ROI OCR fixtures for the ROIs whose full-frame OCR merges glyphs (deck/list 'Lvl N').
ROIs come from agent/layouts/global-2026-09.json via the same formulas the C# parsers use
(round-half-away-from-zero of x0 + t*pitch). Apple Vision stands in for Windows OCR; H4 re-records.
Usage: python3 agent/tests/tools/record_roi_ocr.py   (run from the repo root, needs macOS swift)"""
import json, math, subprocess, sys, os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..'))
layout = json.load(open(os.path.join(ROOT, 'agent/layouts/global-2026-09.json')))
def rnd(v): return int(math.floor(v + 0.5))
def deck_rois():
    d = layout['screens']['details.career']['grids']['deck']
    return [[rnd(d['tileX'] + t * d['tilePitch']) + d['levelRoi'][0], d['levelRoi'][1], d['levelRoi'][2], d['levelRoi'][3]] for t in range(6)]
def list_rois():
    g = layout['screens']['cards.list']['grids']['tiles']
    out = []
    for r, y in enumerate(g['diamondRows']):
        for c in range(g['columns']):
            x = rnd(g['tileX'] + c * g['tilePitch'])
            out.append([x + g['levelRoi'][0], y + g['levelRoi'][1], g['levelRoi'][2], g['levelRoi'][3]])
    return out
jobs = {'05-veteran-details-career-info-deck-legacy': deck_rois(), '13-support-card-list': list_rois()}
for fixture, rois in jobs.items():
    png = os.path.join(ROOT, 'docs/reference/screenshots', fixture + '.png')
    args = ['swift', os.path.join(ROOT, 'agent/tests/tools/record-roi-ocr.swift'), png] + [','.join(map(str, r)) for r in rois]
    data = json.loads(subprocess.check_output(args))
    data['fixture'] = fixture
    out = os.path.join(ROOT, 'agent/tests/fixtures/ocr-roi', fixture + '.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(data, open(out, 'w'), indent=1, sort_keys=True, ensure_ascii=False)
    print(fixture, len(data['roiLines']), 'rois')
