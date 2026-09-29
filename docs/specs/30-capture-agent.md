# 30 — Capture agent (Windows)

Owner tasks: **T09** (Core, cross-platform), **T10** (Windows shell), **T11** (support cards), **T14** (auto-navigation, M5).
Solution: `agent/Uma.Agent.sln`.

## 1. Split: what's testable on macOS
| Project | TFM | Contains | Built and tested on |
|---|---|---|---|
| `Uma.Agent.Core` | `net8.0` | Layout profiles, screen classifier, all parsers (stars, LB, grade, pill colour, text normalisation, vocab matching), veteran assembler, validator, fingerprint, outbox (SQLite via `Microsoft.Data.Sqlite`), API client | macOS CI + Windows |
| `Uma.Agent.Core.Tests` | `net8.0` | xUnit, fixture tests against `docs/reference/screenshots` | macOS CI |
| `Uma.Agent.Windows` | `net8.0-windows10.0.19041.0` | WPF tray app, `Windows.Graphics.Capture`, `Windows.Media.Ocr` adapter, `SendInput` (T14), DPAPI secret storage | Windows only (compile check on macOS with `EnableWindowsTargeting`) |

Core depends only on abstractions:
```csharp
interface IFrameSource { Task<Frame> NextAsync(CancellationToken ct); }         // Frame = BGRA byte[] + width/height
interface IOcrEngine   { Task<IReadOnlyList<OcrLine>> ReadAsync(Frame f, Rect roi, OcrMode mode); } // OcrMode: Text | Digits
interface IClock, IInput (T14)
```
Image processing uses **SixLabors.ImageSharp** (cross-platform). Don't use OpenCvSharp, which needs native Windows binaries.

**OCR on macOS tests:** don't use a real OCR engine in Core tests. `FixtureOcrEngine` replays OCR output recorded per fixture: `agent/tests/fixtures/ocr/<fixture>.json`, produced once by the spike tool (`spike/ocr/ocr.swift`) and later re-recorded on Windows with `Uma.Agent.Windows --record-ocr`. The OCR text parsing is tested on this recorded output. Pixel-based parsers (stars, LB, grades, colours) run on the real PNGs.

## 2. Coordinates
- Every ROI is in **reference space 1920×1080** (the game client area). The agent scales linearly for other 16:9 sizes. For non-16:9 sizes it refuses and shows "unsupported aspect ratio".
- The capture target is the game window's client area, found by process name (`UmamusumePrettyDerby`; make it configurable) with a fallback to a window-title match.

## 3. Layout profile (`agent/layouts/global-2026-09.json`)
```jsonc
{ "version": "global-2026-09", "reference": [1920,1080],
  "screens": { "<screenId>": { "anchors": [{ "roi":[x,y,w,h], "dhash":"…", "maxDistance": 10 }],
                                "rois": { "<field>": [x,y,w,h] }, "grids": { … } } },
  "cardArtCrop": { … } }   // must mirror packages/master-data/src/art-crop.ts
```
The screen IDs to support, with evidence in `docs/reference/screenshots/`:
| screenId | Fixture(s) | Anchor idea |
|---|---|---|
| `details.skills` | 01, 15 | Title "Umamusume Details" + active tab Skills (green tab at ~x266–456, y446–482) |
| `details.inspiration` | 02, 03, 04 | Active tab Inspiration |
| `details.career` | 05, 06, 07 | Active tab Career Info |
| `sparks.popup` | 08, 09, 11, 12 | Title "Sparks", no "Guest's Trainer" |
| `sparks.popup.guest` | 10 | Title "Sparks" + "Guest's Trainer" |
| `cards.list` | 13 | "Support Card List" + `Held N/255` |
| `cards.detail` | 14 | Title "Featured Cards" |
| `unknown` | anything else | — |

Classification = the anchor dHash distance **plus** OCR of the popup title. An unknown screen means the frame is ignored; nothing is stored.

## 4. Field extraction, by region (approximate reference coords from the spike; **calibrate on the fixtures**)
Popup panel: x≈256–856.
| Field | ROI / method |
|---|---|
| Outfit title | OCR text ~(540,95,300,30). Strip the brackets; OCR reads `]` as `l`, so normalise `[Xl` → `X` |
| Character name | OCR ~(540,122,300,32) |
| Rank badge | template match ~(440,90,80,80) against rank templates cut from fixtures (A+, UG…) |
| Epithet | OCR ~(520,168,210,30) → train mode (01 §6) |
| Rating | digit OCR ~(320,222,110,30); strip commas |
| Stats | digit OCR per stat, value boxes at y≈286–318, x≈ spd 318–372, sta 432–486, pow 540–596, gut 658–712, wit 768–822. Validate 1–2000 |
| Stat grades | ignored (derivable) |
| Aptitude grades | template match of the coloured letter at the right end of each aptitude chip: rows y≈352 (track), 386 (distance), 420 (style). Chip letters at x≈ 476/576 (track), 476/576/690/800 (distance, style). The templates G–S come from the fixtures; mode `S`, `A`, `B`, `C`, `D`, `E`, `F`, `G` are all present in fixtures 01 and 15 |
| Skills list (Skills tab) | 2 columns of pills, left x≈270–545, right x≈552–828, pill pitch ≈62 px starting y≈512. OCR each pill; `Lvl N` inside a pill = unique skill level. Scroll (T10) until the last pill repeats |
| Sparks (Inspiration tab) | Pills in 2 columns. The label is OCR'd. **Type from pill colour** (sample the pill background: blue ≈ (64,170,240), pink ≈ (240,110,160), green ≈ (130,200,60), white/grey ≈ (225,225,230); nearest colour with a max distance). **Stars**: gold-pixel ratio in 3 equal cells of the star strip under the pill (spike `spike/ocr/stars.py`: gold = R>200, G>150, B<90, R−B>130; a cell is filled if the ratio > 0.15). Section order: self block (portrait at left), then "Legacy Origin" heading, then parent1 block, then parent2 block (each starts with a new portrait at x≈300). Owner is assigned by block order |
| Deck (Career Info) | 6 tiles at y≈520–640. Tile pitch ≈93 px from x≈280. **LB**: 4 fixed diamond centres per tile, 5×5 patch, filled if >50% of pixels have B−R>60 and G>140 (spike `lb.py`, deck row y=625, 6th "Friends" tile at y=610). Level: OCR `Lvl N`. Borrowed: OCR "Friends" under the tile. Card identity: dHash of the art crop vs `cards.json.artHashes` (Hamming ≤ 10; the best match must beat the second-best by ≥ 4, else low confidence) |
| Parents (Career Info) | Legacy 1 box x≈276–550, Legacy 2 box x≈556–830, y≈670–880. Big portrait = parent; two small portraits = grandparents. Identify by dHash vs `characters.json.iconHashes`. "Guest" badge OCR under the portrait → `isGuest`. **Fallback:** if the portrait match is low-confidence, the user taps the portrait → the `sparks.popup` screen gives the exact `[Outfit]` + name (and trainer for guests) |
| Career block (Career Info) | OCR key/value rows: Career Record (Races/Wins), Fans Earned, Career Scenario → `scenarioId` via vocab, Date Acquired → `YYYY-MM-DD` |

**Text normalisation** (unit-tested, derived from the spike output in `docs/specs/30` Appendix A): trim; strip leading `•`, `)`, `L`, `T` artefacts when followed by a known label; map a trailing ` O`, ` ®`, ` @`, ` ◯` to ` ◯`; collapse spaces. Then vocab matching: exact → case-insensitive → normalised Levenshtein (score = 1 − dist/maxLen). Accept if score ≥ 0.85 and it beats the runner-up by ≥ 0.05; otherwise `low_confidence` with the top 3 candidates.

## 5. Assembly
A **CaptureSession** collects frames for one veteran. The veteran identity is the header (outfit + name + rating); a header change starts a new session. The session is complete when `details.skills`, `details.inspiration` (all 3 blocks seen) and `details.career` (deck + parents + career block) are captured. The tray shows a live checklist. When it completes: assemble `VeteranCapture` (01 §3), validate, compute the fingerprint, write it to the outbox, and queue the crops for low-confidence fields.

## 6. Outbox and upload
- SQLite at `%LOCALAPPDATA%/UmaSparkCalc/outbox.db`: `outbox(id, kind, payload_json, attempts, next_attempt_at, last_error)`.
- The uploader retries with exponential backoff (max 1 h) and sends crops before the veteran.
- Headers on every request: `CF-Access-Client-Id` and `CF-Access-Client-Secret` (service token), stored with Windows DPAPI (`ProtectedData`, CurrentUser). Configure through the tray *Settings* dialog; never in plain text on disk.
- The API base URL is configurable, with a default from `appsettings.json`.

## 7. Windows shell (T10)
- A tray icon with the states Idle / Watching / Capturing (n/3) / Uploading / Error. Menu: Start watching, Stop, Capture support cards (T11), Open web app, Settings, Record OCR fixture (dev), Exit.
- Frame loop: poll at 4 fps with WGC. Skip unchanged frames (dHash of the whole frame).
- The OCR adapter uses `Windows.Media.Ocr` with the English language on ROI crops upscaled ×2. `OcrMode.Digits` post-filters `[0-9,]`.
- **Assisted mode only** in T10: no input injection.
- Logs: Serilog rolling file at `%LOCALAPPDATA%/UmaSparkCalc/logs`.
- Packaging: `dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true`. Document it in `docs/runbooks/agent-install.md`.

## 8. Support cards (T11, F03)
- On `cards.list`: read `Held N/255`; a 5-column grid at 1920×1080 with the first diamond centre x=283, tile pitch 114.25, diamond pitch 12.0, diamond row y ∈ {215, 369, 524, 679} (spike, 20/20 correct). Card art is dHash-matched against master data. `Lvl N` is OCR'd.
- Scrolling in assisted mode: the user scrolls and the agent de-duplicates tiles by (cardId, lb, level, grid position relative to the previous frame). T14 adds auto-scroll.
- A low-confidence art match prompts the user to open the card (the `cards.detail` screen). Its title and name are OCR'd exactly, which resolves the card.
- Finish: when the unique card count equals `Held N`, send `OwnedCardsSync`. Otherwise the user can "Send partial".

## 9. Auto-navigation (T14, M5, opt-in)
Blocked on Q-2 (veteran list screenshot). Plan: open each veteran from the list, cycle the 3 tabs, scroll, close, next. Use `SendInput` with randomised 250–700 ms delays, and abort on any unknown screen.

## 10. Acceptance
- **T09:** `Uma.Agent.Core.Tests` includes one test per fixture that asserts the full parsed output against `agent/tests/fixtures/labels/<fixture>.json`. Field accuracy is ≥ 99% overall; stats, spark stars and LB are 100%. Assembling fixtures 01–07 produces a valid `VeteranCapture` for Mejiro McQueen with 3 spark blocks, 6 deck cards, 2 parents (parent 2 a guest T.M. Opera O) and scenario URA Finale. The fingerprint equals the shared vectors.
- The labels are written by T09 from the screenshots, then **checked by the user at checkpoint H4** before M2 closes.
- **T10:** `dotnet build -p:EnableWindowsTargeting=true` of `Uma.Agent.Windows` succeeds on macOS. The runbook covers the human run: capture 3 veterans on Windows and check them against the web roster.
- **T11:** parses fixture 13 into 20 cards with correct LB `[2,4,4,4,4 | 0,0,1,0,4 | 0,4,0,4,4 | 0,0,4,4,0]` (row-major).

## Appendix A — recorded OCR fixtures
`agent/tests/fixtures/ocr/<fixture>.json` holds the Apple Vision output for **all 15** screenshots: `{engine, reference, lines:[{text, confidence, box:[x,y,w,h]}]}`, sorted top-to-bottom. `FixtureOcrEngine` returns the lines whose box centre falls inside the requested ROI. Windows OCR output will differ, so T10's `--record-ocr` writes the same format and H4 re-records the fixtures on Windows. Known artefacts are listed in `spike/ocr/README.md`.
