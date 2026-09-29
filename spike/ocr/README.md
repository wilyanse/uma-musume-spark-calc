# OCR feasibility spike

Reference material only. Nothing here is part of the build.

| File | Purpose |
|---|---|
| `ocr.swift` | Apple Vision OCR (a stand-in for Windows.Media.Ocr). `swift ocr.swift <png> [x y w h]` prints `x,y wxh conf text` in 1920×1080 coordinates. With `OCR_JSON=1` it prints JSON; that's how `agent/tests/fixtures/ocr/*.json` was recorded. |
| `stars.py` | Counts spark stars from the gold-pixel ratio in 3 cells under each pill. Correct on every pill checked in fixtures 08–12. |
| `lb.py` | Counts limit-break diamonds at fixed slot centres. 20/20 on the card list (fixture 13) and 6/6 on the deck (fixture 05). |

Setup: `python3 -m venv spike/.venv && spike/.venv/bin/pip install pillow numpy`.

## Findings
- After vocab matching, text is effectively 100% correct on names, stats, rating, scenario and date.
- OCR artefacts to normalise:
  - `]` is read as `l` (`[Frontline Elegancel`).
  - The `◯` suffix is read as ` O`, ` ®` or ` @`.
  - Stat icons are read as `•`, `L` or `T` prefixes, and some pills get a leading `)`.
  - The `Wit` label comes back with confidence 0.3.
- Grade letters, card identity and portraits can't be read by OCR. They need template or hash matching.
- LB diamonds are cyan (filled) or grey (empty). Colour-run scanning failed because of cyan in the card art, so fixed slot sampling is used.
