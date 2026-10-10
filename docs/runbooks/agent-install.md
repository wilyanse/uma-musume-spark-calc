# Windows agent install and H4 runbook

T10/T10b status is **Partial** until real Windows execution and H4 are recorded (T10b adds support-card sync, §3a). macOS cross-target build/publish is NOT a WGC/OCR/DPAPI or real-game test. Do not close M2 on compile evidence alone. The agent is assisted-only: it never navigates the game, injects input, reads memory or inspects game traffic.

## 1. Requirements and packaging

- Windows 10 version 2004/build 19041 or newer (Windows 11 supported by the target), x64, a working graphics driver and Windows Graphics Capture enabled. Run as the same ordinary Windows user as the game; elevation is not required.
- Install English (United States) language/OCR under Windows Settings > Time & language. An actionable error appears if `Windows.Media.Ocr` cannot create an English recognizer. This is a native H4 check, not proven on Mac.
- The **game client area** (without borders/titlebar) must be 16:9 and at least 1920×1080 physical pixels. Larger supported 16:9 clients are normalized by Core's `ParseAsync`; smaller and other aspect ratios are refused before OCR. Windows display scaling is accounted for by the per-monitor-V2 manifest; test it at H4.
- Use windowed/borderless mode and restore the game (not minimized). The system capture border is retained. Capture is client-area only; desktop and window chrome are not used as game pixels.
- Building/testing requires the .NET SDK selected by `agent/global.json` (9.0.100 with latestMajor roll-forward) and a native .NET 8 runtime for net8 tests. The published win-x64 binary is self-contained; no .NET install is required merely to launch it.

From the repository root (PowerShell on Windows):

```powershell
dotnet build agent/Uma.Agent.sln -c Release
dotnet test agent/tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj -c Release
dotnet test agent/tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release
dotnet test agent/tests/Uma.Agent.Windows.Tests/Native/Uma.Agent.Windows.Tests.csproj -c Release
dotnet publish agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o agent-publish
```

`IncludeAllContentForSelfExtract` is set in the project: read-only layout, templates, published master bundle and appsettings.json are bundled with the assemblies/native libraries. Single-file startup/data extraction must be checked on Windows.

Image libraries (T16b): PNG framing and resampling are Core's own managed code; decode compression uses SharpZipLib 1.4.2 (MIT) and encode compression uses the .NET base library. The new compression dependency's licence copy and T19 inventory are in `agent/legal/`. No image package, license key, account or environment variable is involved; no `SixLaborsLicenseKey` or `sixlabors.lic` is used or needed. The only bundled native library is SQLite's `e_sqlite3.dll`. Release blocker: the published EXE does not yet carry the third-party licence texts of its bundled components (.NET runtime, SQLite, Serilog and others). Do not publish an `agent-v*` release until the queued licence/notice packaging task (T19) ships them. The standard Release commands above (audit enabled, warnings as errors) are the supported path.

Only the EXE is needed; the two PDBs are optional symbols, not credentials. The existing T12 tag release workflow builds this project and uploads the EXE; do NOT tag/push/deploy during task implementation.

Verify before use:

```powershell
Get-Item .\agent-publish\Uma.Agent.Windows.exe
Get-FileHash .\agent-publish\Uma.Agent.Windows.exe -Algorithm SHA256
.\agent-publish\Uma.Agent.Windows.exe
```

The first launch opens a status/checklist window and a tray icon. Closing the status window does not exit; use tray **Exit**. No startup registration or system-wide settings are changed. There is one instance per Windows session; exit the tray app before running the CLI recorder.

Mac/Linux compile checks (no native execution):

```sh
dotnet build agent/Uma.Agent.sln -c Release -p:EnableWindowsTargeting=true
dotnet build agent/tests/Uma.Agent.Windows.Tests/Native/Uma.Agent.Windows.Tests.csproj -c Release -p:EnableWindowsTargeting=true
dotnet publish agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableWindowsTargeting=true -o "$TMPDIR/t10-publish"
```

Retained verification tools (task-owned, not shipped, not tests): `agent/tests/Uma.Agent.Windows.Tests/Tools/` (see its README): `MemoryProbe` (managed memory held by the real pipeline) and `bundle_probe.py` (bundled data in a published EXE matches repository bytes).

On non-Windows, test the Core and Portable projects separately. `dotnet test agent/Uma.Agent.sln` now also includes the Windows-native project and cannot run it on Mac. Do not use major roll-forward as native .NET 8 evidence; the Core suite contains a native-runtime guard. Use an isolated .NET 8 host via `-- RunConfiguration.DotNetHostPath=/absolute/path/to/dotnet8/dotnet` if no .NET 8 runtime is globally installed. Do not alter global SDK/runtime configuration for the task.

## 2. First-run Settings and privacy

Follow `cloudflare-setup.md` at H2 for the deployed API/Access service-auth policy. No Cloudflare account or live endpoint is needed to write/build/test T10. The shipped appsettings.json API address is intentionally empty; **never guess an endpoint**.

1. Tray > **Settings**: enter your own deployed site's HTTPS base address, e.g. the address supplied by your H2 setup (not the `/api/v1/veterans` endpoint). It must have no embedded user/password, query or fragment; HTTP including localhost is refused. Trailing slash is normalized.
2. Process defaults to the spec's `UmamusumePrettyDerby`. If necessary, copy the actual process name from Task Manager (without `.exe`). An optional title substring is used only as fallback when the configured process has no usable window. More than one fallback title match is refused; narrow the substring/use the exact process instead. Among process matches the largest visible client is selected, then handle order; confirm the target in H4.
3. Enter both Access client ID and secret in the masked fields. Blank **both** fields keeps the saved token; entering either requires both. Neither is loaded back into the dialog. Do not paste values into chat, shell arguments, files or logs.
4. Save. Token storage uses `ProtectedData` **CurrentUser**; only the protected blob is written. Upload requests read the decrypted value on demand. Values are not silently trimmed/repaired; control characters are refused. A copied blob from a different user cannot be decrypted; re-enter it under the current Windows user.
5. Settings changes stop/join the watcher. Start again explicitly. Changing the destination with pending items requires confirmation: those existing items will upload to the new address. Be sure it is your own API. Addresses are compared after normalisation, so case, spaces or a trailing slash alone do not count as a change.
6. If `settings.json` is unreadable (malformed JSON), the agent does not stop: it renames the file to `settings.json.bad-<UTC timestamp>` (never overwriting an earlier backup), loads the shipped defaults (empty API address, so uploads pause), and shows a message naming the backup. Re-enter the address/process in Settings. The file holds no token, so the backup holds no secret.

Local files under `%LOCALAPPDATA%\UmaSparkCalc`:

- `settings.json`: API address/process/title only, no token fields.
- `service-token.bin`: DPAPI CurrentUser protected ID+secret, never plaintext.
- `outbox.db`: captured veteran/crop payloads and retry metadata, not credentials.
- `logs\agent-<date>.log`: Serilog rolling daily, seven retained files. Error **categories** only; no request headers, token values, raw API bodies or HTTP exception messages.
- `ocr-recordings\...`: local dev recordings (may contain guest trainer names). These do not upload automatically.

Windows OCR provides no confidence score. The adapter assigns a documented constant 1.0 (NOT measured confidence); vocab match scores/margins, templates/pixel checks and Core validation still apply. H4 must validate the actual Windows output, especially ambiguous glyphs and digits. Every parser ROI is enlarged ×2 and boxes mapped back to reference coordinates. Full-frame OCR is read through ×2 tiles that respect the native maximum image dimension and overlap by 600 reference px, longer than any recorded fixture line (the longest is 493 px, on fixture 14 (support-card detail; fixture 13 is the old-seam regression)). A line is kept only from a tile that contains its whole box, so a line crossing a tile edge is never recorded in pieces. A longer seam-cut line gets its own band re-read once at ×2. Nothing is fabricated from fixtures.

## 3. Assisted capture workflow and tray states

1. Start the game in English at the supported client size. Open the first veteran's Details screen at the top of **Skills**, then tray > **Start watching**.
2. Show **Checklist / status** (or double-click the tray). Scroll Skills slowly from its top to its bottom, with overlapping views. **Dwell at least two seconds at each view**: full-frame dHash can collide for small scroll changes (real fixtures 02/03 do), so after two seconds an unchanged-hash frame is re-read if its bytes changed at all (SHA-256 of the frame). A byte-identical still view is parsed once, however long you dwell. Polling is at most 4fps; OCR can reduce actual throughput.
3. Open Inspiration and likewise cover top through bottom, all three spark-owner blocks with overlapping readable rows. A missing/unknown scrollbar thumb cannot prove completeness. No fabricated "content fits" shortcut is used.
4. Open Career Info at the top (six deck cards/two parents) and scroll through career rows (races, wins, fans if available, scenario and acquired date). Checklist has five detailed sections but tray groups them into **Capturing (n/3)** tabs. All sections must be complete.
5. For uncertain parent portraits/outfits/guest trainer, manually open the parent Sparks popups **before moving to another veteran**. The shell never taps for you.
6. A complete current session is queued when another veteran identity appears, or when you choose **Stop / save complete captures** (also at Exit). The header/session identity includes the five stats; outfit/name/rating alone cannot mix two veterans. Do not navigate away until OCR has recognized the intended new screen.
7. Stop waits for active frame/OCR work to finish, then assembles and enqueues only Core-sealed `Uploadable` results with `EnqueueCapture`. Incomplete/diagnostic results are never uploaded; the status lists blockers. An enqueue/database failure retains its exact sealed result in memory for another Stop attempt and pauses collection BEFORE accepting any further evidence, including the identity-transition frame. At most one sealed unsaved result is held (JSON and review PNGs; never evicted). Failed Stop retries remain paused; successful durable retry preserves the exact ID/payload/PNGs and makes the current frame fresh for resumed collection. Do not Exit if the UI says **not saved** unless you deliberately accept losing that unsaved collection.
8. Start after Stop starts fresh evidence. Start and **Exit** follow the same rules: an incomplete in-memory collection is dropped only after you confirm; a complete capture that was **not saved** refuses Start (retry Stop) and makes Exit ask, because exiting loses it. Persisted outbox items remain unchanged. An already queued veteran is frozen for upload: returning to it shows **already queued** and stores nothing; Stop/Start to deliberately recapture after corrections.
9. Live reference-frame and unsaved sealed-result retention are bounded within one watch, so large rosters need no periodic Stop/Start for frame memory. Small queued/overflow identity tombstones grow with distinct veterans to prevent duplicate upload or silent overflow recovery; this is not a constant-total-heap claim. A veteran's frames are released as soon as it is queued (on leaving it, or at Stop). A view whose parsed evidence is identical to one already collected for that veteran (a moving clock or sparkle) is not kept again. At most **2** unqueued veterans are kept: starting a third releases the least recently visited incomplete one, and the status says so (it was never uploaded; recapture it from the top). Each veteran keeps at most **40** distinct views. Once any distinct view is rejected beyond that cap, this collection is permanently overflow-blocked, its displayed checklist cannot claim completion, and Stop/identity transition will NOT save it. Unchanged polls, returning to earlier evidence/identity, eviction and Stop never clear that blocker. Stop, then explicitly confirm Start a fresh collection to recapture with fewer, longer scroll stops. Other collections can still be saved. Enqueue failure pauses before any new capture, retaining at most one sealed unsaved result; repair access and retry Stop without exiting. The 9-view fixture veteran is far below the limit. Measured managed heap on Mac (real Core/fixtures, `Tools/MemoryProbe`): +11 MB on a still view after 60 s; +75 MB for the current veteran during a 20-veteran watch (constant from veteran 5 to 20) and +9 MB after Stop; worst case at both limits +672 MB (2 × 40 × 8.3 MB frames). These are Mac managed-heap figures, not Windows process memory. H4 must record Windows Task Manager memory during the ≥20-veteran import.

States:

- **Idle**: not watching (background outbox upload can still run).
- **Watching**: waiting for a recognized veteran screen.
- **Capturing (n/3)**: collection/checklist progress; no incomplete upload.
- **Uploading (n)**: waiting for strict JSON acknowledgement. Crops precede their veteran; a valid API `200/201 {veteranId, created}` is required before completion. HTML/redirect/login success is never an acknowledgement.
- **Error**: actionable client-size/window/native failure, missing destination/token with pending work, refused auth, rejected item, or a per-veteran evidence limit. Open checklist/status for detail. A local failure with a known cause shows its own message (unsupported client size, token with control characters, capture unavailable); anything else shows only its error category.
  - A **transient capture error** (client too small / not 16:9, game window missing or minimized, geometry mismatch) clears by itself as soon as a captured frame has a valid size again; the tray returns to Capturing/Watching. Geometry is checked before the unchanged-frame check, so the same still screen as before the resize (reported as unchanged), a valid non-capture screen, veteran progress/queued/already queued, an incomplete-veteran notice or a support-card screen all clear it. A frame that is still too small or not 16:9 keeps it; while collection is paused by an unsaved capture, frames are not examined and the error is left as is. **Durable** notices (capture not saved, evidence limit) are separate and are never cleared by this recovery; they keep the tray in Error until their own recovery (successful Stop retry / confirmed fresh Start).

**Open web app** opens only the configured HTTPS address in the default browser (no service token passed to it). Browser Access login follows H2. **Capture support cards** opens the support-card window (§3a).

## 3a. Support cards (T10b, F03)

The shell uses the reviewed T11 Core API (`CardSyncSession`, `OwnedCardsUploadCoordinator`, `OwnedCardsUploader`); it has no card logic of its own. **Every sync replaces the whole owned-card list stored by the API (Q-150). A partial sync is destructive: cards not in the scan disappear from the web app.**

1. Tray > **Capture support cards** > **Start new scan**. Make sure **Start watching** is on (the window says NOT WATCHING otherwise). Open the in-game **Support Card List** (`Held N/255` visible).
2. Scroll slowly with overlapping rows and dwell ≥ 2 s per view. Card screens use the same capture/OCR path and frame gate as veterans; they never touch veteran sessions, the veteran checklist or the outbox. While a veteran capture is **not saved** (collection paused), card frames are not read either.
3. The window shows `Collected n of Held N`, blockers, conflicts and **pending tiles** with candidates. For a pending tile: select it, click **Select pending tile**, then open that card in game (the `cards.detail` screen); the exact title/name resolves it. Ambiguity is never guessed.
4. **Send full sync…** is enabled only when Core reports a gap-free scan whose distinct count equals Held with nothing pending or conflicting; it still asks before replacing the list. Fixture 13 (20 of Held 208) is never a full sync. A partly filled last row keeps blocking full sync: the parser has no verified empty-cell classifier (Q-154), so the shell never declares cells empty.
5. **Send PARTIAL sync (replaces entire list)…** shows a DESTRUCTIVE warning with Core's exact message (n of Held N, the list is replaced, no merge) and the destination; **No is the default**. Cancel sends nothing.
6. The view you confirmed is the only one sent. If a new frame changes the collection, the scan is reset/replaced/cancelled, or the API settings change (address **or** service token, for example Settings saved from the tray while the confirmation is open), nothing is sent and you review/confirm again. Only one sync runs at a time. The confirmation shows the destination; the address and a nonsecret token version are re-read after you answer and re-checked immediately before **every** attempt, including Core's retries. Saving Settings during a send stops it before its next attempt: no further request goes to the old address, and a new token is never sent to the old address. A request the server already received cannot be undone (check the web app).
7. Results: **Synced** only after the API's documented `200 {count, partial, syncedAt}` matching what was sent. **Auth** (401/403/redirect/Access login): fix the token in Settings, then send again from the same scan (partial asks again); not retried automatically. **Rejected** (422 etc.): shown with the API's field paths; not retried. **Failed** (network/5xx/429/unexpected 200): Core's bounded retry (4 attempts, 2 s doubling, ≤ 30 s) ran inside that one send; nothing retries in the background. The web list may or may not have been replaced: the window then shows **Web app card list: UNKNOWN** and labels the last acknowledged sync as historical only. The same happens when a send that already made a request is stopped (scan changed, Settings changed, Exit) or a late 200 arrives for a scan that is no longer current: a stale acknowledgement is never shown as synced. Check the web app, then send again from the unchanged scan or rescan; the next acknowledged sync clears UNKNOWN. A request already received by the server cannot be undone, and there is no server-side ordering check.
8. Card scans live in memory only (Q-152): nothing card-related is written to disk and no outbox row is created. Stop/Start watching keeps the scan. **Start new scan**, **Reset** and **Cancel** ask before dropping unsynced cards, and the answer only covers the counts you were shown: if more cards arrive while the question is open, nothing is dropped and the window says the scan changed, so choose again. **Exit** asks before dropping unsynced cards, while a send is waiting for your confirmation (nothing sent yet) or while a request is being sent; exiting stops further attempts. While Exit is asking, no new card send can start (the send buttons are disabled and a confirmation answered meanwhile sends nothing); cancelling Exit restores sending. After an app restart, scan again.
9. A scan belongs to the API address configured when it started. Saving Settings with a different address cancels that scan immediately (and any later send of it is refused), and its acknowledged/unknown history is not shown for the new address; start a new scan. A scan started while no valid address was configured adopts the address at its first confirmed send. Changing only the service token keeps the scan: after an auth refusal, update the token, then send the same scan again (asked again).

## 4. Authentication and rejected-upload recovery

- Uploader explicitly uses Core's `UploadClient.CreateHandler()` with redirects disabled. 401/403/3xx or an HTML login page produce auth Error and bounded Core backoff, not deletion/dead-lettering.
- Correct the Access service-auth policy/token using H2 guidance. Re-enter both token values in Settings and Save: token write and `RetryAuthNow()` are serialized with uploads, so held items become due immediately. Leaving both fields blank does not rotate/retry the token; re-enter if repairing auth. Do not guess credentials/endpoints.
- Transport/server errors, 408/429/unacknowledged responses retry with bounded exponential backoff (up to one hour); no raw response bodies are persisted/logged.
- Other rejected 4xx items remain in the outbox as dead items. **Review rejected uploads** lists row ID, capture ID, kind/path, category and attempts. Select **Requeue** (confirmation) after fixing the underlying issue; or **Discard entire capture** (confirmation naming group/count). Discard removes the capture's veteran and crops together; a veteran is never sent without its required crop. There is no hidden blanket-delete/requeue button.
- **Stop stops capture, NOT the uploader.** Exit the agent before backing up/recovering its database. Check the process exited; then copy `outbox.db` and any `outbox.db-wal`/`outbox.db-shm` together into a new backup directory. Never reset/replace a live database.

Legacy T09 outbox recovery is **operator-directed only** (T09 changelog SF4): preserve/backup payload bytes, retries and stable IDs. Either resume the existing pending group unchanged to finish its upload, or have the coordinator/operator explicitly mark the selected pending item dead through Core's `Dead(item, category)` before using confirmed whole-group Discard. The shell does not automatically mark legacy pending rows dead, guess/backfill hashes, overwrite payloads or add crops. There is intentionally no UI auto-migration recovery action. Already acknowledged legacy capture IDs with unknown hashes remain fail-closed; a recapture needs a fresh ID. Core's existing oldest-duplicate migration remains unchanged.

## 5. Record actual Windows OCR for H4 (15 + per-ROI 05/13)

Do this on **Windows**, after exiting the tray. Never replace recorded OCR/labels on Mac. CLI has no fixture-replay fallback: it constructs the real English Windows OCR adapter.

From the repository root, first write to a new comparison directory (recommended; no overwrite):

```powershell
$out = Join-Path $env:LOCALAPPDATA ('UmaSparkCalc\ocr-recordings\H4-' + (Get-Date -Format yyyyMMdd-HHmmss))
$exe = (Resolve-Path .\agent-publish\Uma.Agent.Windows.exe).Path
$p = Start-Process -FilePath $exe -ArgumentList @('--record-ocr', 'docs/reference/screenshots', '--out', ('"' + $out + '"')) -PassThru -Wait
if ($p.ExitCode -ne 0) { throw "OCR recorder failed ($($p.ExitCode)); see its actionable dialog/category log." }
$full = @(Get-ChildItem (Join-Path $out 'ocr') -Filter *.json)
$roi = @(Get-ChildItem (Join-Path $out 'ocr-roi') -Filter *.json)
if ($full.Count -ne 15 -or $roi.Count -ne 2) { throw 'Expected 15 full-frame + 2 per-ROI recordings.' }
$full | ForEach-Object { $d = Get-Content $_.FullName -Raw | ConvertFrom-Json; if ($d.engine -notlike 'windows-media-ocr-*') { throw 'Not actual Windows OCR' } }
```

The WinExe displays a completion/error dialog (dismiss it for `-Wait` to return). It writes:

- `ocr/<each of the 15 PNG names>.json`: `{engine, reference:[1920,1080], lines:[{text,confidence,box:[x,y,w,h]}]}`, reference boxes sorted top-to-bottom.
- `ocr-roi/05-veteran-details-career-info-deck-legacy.json`: six level ROIs.
- `ocr-roi/13-support-card-list.json`: twenty level ROIs.
- Engine identifies `windows-media-ocr-en-US` and ROI variant `...-roi-x2` (actual installed English language tag). No made-up output/labels.

Input can be one PNG, several PNGs, or a directory. Files must be exactly 1920×1080; recorder refuses other sizes rather than silently changing fixture geometry. Default output (when `--out` omitted) is a timestamped local directory, not repository fixtures. Existing files are refused unless `--overwrite` is explicitly passed.

Compare the new recordings with the originals. Only after user-directed backup/review on Windows, replace repository recordings for the real Core accuracy run:

```powershell
# HUMAN-DIRECTED overwrite only. Back up the existing fixtures first; do not automate this on Mac.
$p = Start-Process -FilePath $exe -ArgumentList @('--record-ocr', 'docs/reference/screenshots', '--out', 'agent/tests/fixtures', '--overwrite') -PassThru -Wait
if ($p.ExitCode -ne 0) { throw 'OCR recorder failed.' }
dotnet test agent/tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj -c Release
```

Alternatively tray **Record OCR fixture (dev)** stops watching, captures the real client, normalizes supported sizes, classifies the screen, and writes actual full-frame + applicable Career/Card-list ROI OCR into a fresh local folder. It does not write labels, upload, overwrite fixtures or save a screenshot.

## 6. H4 acceptance — exact human procedure

Record real command output/screens/observations and test results in the T10 changelog (and linked T09 evidence), with machine/Windows build/client size/master/layout versions. Do not mark done just because the binary starts.

1. Launch the **single-file published EXE**, configure your own API/token. Check tray menus, start/stop/restart, title fallback (the agent's own windows are never selected), minimized/closed game, DPI/clientarea alignment, resize from valid to below-reference/non16:9 then back, device recreation and Exit cancellation (Exit asks before dropping an incomplete collection, like Start). Also corrupt `settings.json` (e.g. `{not json`) and confirm the backup/defaults message.
   - **Capture geometry check (S5).** With the game still and windowed, Start watching for 30 s on Windows 10 (build 19041+) and on Windows 11 if available. The status must not stay on "The game window is resizing". If it does, the log contains one `Capture geometry size-mismatch: texture WxH; dwm frame WxH at X,Y; client WxH at X,Y` line (numbers only, no titles). Record that line, the Windows build and the display scaling. Failing closed is correct; this check is about whether the WGC content size matches `DWMWA_EXTENDED_FRAME_BOUNDS` on that build. Also confirm that a moving game (menu animation) is read from the newest frame: the status follows a scroll within about one poll. Confirm no partial group uploads, no unconfirmed or stale card sync, no secret in files/logs; protected blob decrypts only for current user. Verify startup extracted layout/master data work with just the EXE.
2. Run the three targeted test projects above on a native .NET 8 runtime. Run real Windows OCR recording for all **15** screenshots plus six/twenty ROIs (section 5). Core accuracy must remain >=99% overall and **100% stats/stars/LB**. If Windows output differs, retain the failing output and ask the owning task/coordinator to recalibrate; do not silently alter labels/thresholds or claim pass.
3. Open each of the 15 labels alongside its PNG and verify every value, including 01/15 ◯ vs ◎, 03 clipped rows, 10 guest trainer, 13 Held 208/exact LB values and tile0 sameCardAs14. Explicitly verify all **six art-only deck card IDs** matched in fixture05 by opening the cards in-game/comparing known art:
   - `card:touching-sleeves-is-good-luck-matikanefukukitaru`
   - `card:piece-of-mind-super-creek`
   - `card:winning-dream-silence-suzuka`
   - `card:q-0-agnes-tachyon`
   - `card:dazzling-day-in-the-snow-marvelous-sunday`
   - `card:esteemed-and-adored-the-throne-s-assemblage`
   These are T09's matched candidates, **not independently human-verified identities**. No title is visible on the tiles; do not infer unknown characters from uncertain art.
4. Capture **3 real veterans** first (at least one guest-parent case and one Manual-mode case). Complete every checklist section, open uncertain parent popups, Stop to finalize. Confirm each acknowledged upload in the web roster and compare header/stats/aptitudes/skills/sparks/deck/parents/career with the game. Verify independent/manual mode (F02) against epithet; don't invent overrides.
5. After those three succeed, import **at least 20 real veterans** total. Spot-check **3** in the web app against the game, including stats, star counts, deck IDs/LB/levels/borrowed, parents/guest and acquired date. Retain failure observations as well as success counts. Confirm low-confidence items are visible in review rather than silently resolved.
6. Exercise actual refused token/Access redirects then Settings rotation/retry, recover one rejected item with confirmations, and restart with a pending outbox to prove durable acknowledged completion. Tokens never appear in evidence. Actual game captures cannot be replaced by fixtures or synthetic thumbs.
7. **Support cards (T10b, needs H2 for the live PUT).** On Windows with the real game: (a) scan the real inventory top to bottom; record Held, collected count, pending/conflict counts and whether full sync became available (Q-151: does Held count distinct cards?; Q-153: scroll placement; Q-154: partly filled last row); (b) resolve one real ambiguous tile through the detail screen; (c) cancel a partial confirmation and confirm no request was made (web list unchanged); (d) send one confirmed sync to the deployed API and compare the web owned-card list and `syncedAt`; (e) with a deliberately wrong token, confirm Auth is shown and nothing is retried, then repair and resend; (f) scroll during an open confirmation and confirm it is refused as changed; (g) Exit with an unsynced scan asks first; (h) with a partial confirmation open, open tray > Settings, save a different address (or only a new token), then answer Yes: nothing is sent and the scan is cancelled (address) or must be confirmed again (token); repeat during a slow send (e.g. network unplugged) and confirm no further attempt; (i) with Reset/Cancel/Start-new-scan question open, let more cards be read, then Yes: nothing is dropped; (j) open Exit's question while a send confirmation is open: the Exit text says nothing was sent, and choosing No restores the send buttons. Record Windows Task Manager memory during a long scan. Card frames must not appear in the veteran checklist or outbox.
8. Parent/orchestrator independently reviews the implementation and records H4 evidence before declaring T10/T10b/M2 Done.

## 7. Troubleshooting

- **Below 1920×1080 / unsupported aspect ratio**: enlarge the physical game client to supported 16:9. Do not retune pixel thresholds on synthetic lower-resolution resampling.
- **Unknown screen**: no anchor/title/tab evidence means ignored, nothing stored. Open a supported Details tab, allow OCR to settle; no automated clicking occurs.
- **Incomplete Skills/Inspiration**: start at top, scroll slowly with overlap, dwell >=2 seconds, reach a detectable end thumb. Missing thumb is unknown (Q-93), not proof of a short list.
- **Unaligned rows**: revisit the intervening view slowly; a gap is not bridged/guessed. An incomplete session stays out of uploads.
- **English OCR missing**: install English OCR/language, restart. There is no Apple Vision/fixture fallback in production.
- **No WGC frame / resize / device failure**: restore the game, avoid exclusive fullscreen, hold its size steady. Stop/Start recreates native resources. If a device repeatedly fails, update the graphics driver and retain category logs for H4. A persistent "resizing" status with a still window: send the `Capture geometry ...` log line (numbers only) with the Windows build.
- **Evidence limit reached for a veteran**: rejected distinct evidence invalidates uploadability permanently for this scan, even after an earlier complete checklist. Stop cannot save that veteran. Confirm Start a fresh collection and recapture with fewer, longer scroll stops. The blocker remains visible across polls and identity changes; released-collection warnings have a separate acknowledgement menu that cannot clear unsaved or overflow errors.
- **Settings reset message**: the old file is kept as `settings.json.bad-<timestamp>`; re-enter values in Settings.
- **Auth Error**: correct H2 Access Service Auth policy/token, enter both masked fields and save to RetryAuthNow. Browser login HTML/302 cannot acknowledge a native upload.
- **Capture not saved**: keep the agent open, repair outbox file access, Retry Stop (the exact sealed capture, same ID, is retried; its frames are already released). Collection (both parsed frames and OCR processing) is paused until it is saved. Successful retry resets the frame gate; Start is refused until saved; Exit asks before losing it. Neither replaces the existing database.
- **Support cards: Full sync not available**: read the blockers (n of Held, pending tiles, separate parts, unread tiles). Keep scrolling or resolve pending tiles via the detail screen. Partial sync is possible but replaces the whole stored list.
- **Support cards: "collection changed since it was shown"**: a frame arrived after the window drew the view you confirmed. Review the updated numbers and confirm again.
- **Support cards: no acknowledgement / Web app card list: UNKNOWN**: check the web app's card list; then send again from the unchanged scan or rescan. Nothing retries by itself.
- **Support cards: "API settings changed"**: Settings were saved during the confirmation or send. Nothing more was sent with the old settings; review the scan (or start a new one for a new address) and confirm again.
- **Support cards: "scan changed while you were deciding"**: more cards arrived while a Reset/Cancel/Start question was open; nothing was dropped. Choose again.

## Integration status

T10b wires the reviewed T11 Core Cards API into the shell (`Portable/CardSyncController.cs`, `CardSyncWindow.cs`). Portable tests drive it through the real `CapturePipeline` with fixtures 13/14 and a scripted fake HTTP handler. Native WPF/WGC/Windows OCR/DPAPI and a real deployed PUT have NOT been run (H4/H2).

## API references

Microsoft references checked during implementation (direct HTTPS retrieval when the extraction service returned 403):
- https://learn.microsoft.com/en-us/windows/uwp/audio-video-camera/screen-capture — explicitly permits pulling frames with TryGetNextFrame, disposing frames to return buffers, and pool Recreate on size/device changes.
- https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.direct3d11captureframepool.createfreethreaded — removes DispatcherQueue dependency; native callback thread must not touch UI.
- https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine.maximagedimension — native recognition dimension limit; the recorder tiles ×2 input rather than guessing recognition results.
