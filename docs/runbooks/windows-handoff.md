# Windows handoff — start here

Audience: the user on Windows and a Claude agent working in this checkout. This is **validation of an implemented application**, not permission to restart the orchestration plan, implement T14, deploy, or alter game mechanics. Give Claude `docs/tasks/H4-windows-validation.prompt.md`.

## 1. Get the correct code before installing anything

The Mac coordinator has locally merged T19 (`832129bdc6ab5c9418f3502244777491cfa8a9c1`). At preparation time local main was **206 commits ahead of origin/main**. A normal GitHub clone may NOT contain the reviewed agent or these instructions until the user authorizes and completes a push. Do not assume a successful clone is the current application.

A coordinator-provided Git bundle is an alternative transfer without publishing. Download it, then in PowerShell (substitute the actual downloaded path):

```powershell
git clone --branch main 'C:\path\to\uma-spark-windows-handoff.bundle' uma-musume-spark-calc
Set-Location uma-musume-spark-calc
git status --short
git log -1 --oneline
git merge-base --is-ancestor 832129bdc6ab5c9418f3502244777491cfa8a9c1 HEAD
if ($LASTEXITCODE -ne 0) { throw 'Missing reviewed T19 merge; stop and obtain the current handoff.' }
git switch -c qa/H4-windows-validation
```

Bundle-clone origin points to the bundle, not GitHub. Do not push to it or change remotes automatically. Send results back as a sanitized report/patch, or arrange a normal private remote with the user later. If cloning GitHub instead, use the user's usual authenticated clone mechanism and run the same ancestry check. The Mac-only `github-personal` SSH alias is not a portable Windows remote address. Verify repository identity and handoff files exist; no reset/clean/rebase of an existing checkout.

## 2. What the human needs to do, in order

### A. Prepare Windows — no hosting needed yet

- Use x64 Windows 10 build19041+ or Windows11, supported graphics driver and a normal non-admin user. Tell Claude your Windows build; do not expose machine/user/account identifiers in shared evidence.
- Install Git, the **exact .NET SDK10.0.401**, and a separate **.NET8 runtime** for tests. For the Windows-native/WPF test host, ensure the **.NET8 Desktop Runtime** is present (it also provides Microsoft.NETCore.App). Run `dotnet --list-runtimes` to verify. Do not assume SDK10 supplies runtime8.
- Install Python3 for notice tools and ensure `python` resolves to the real interpreter, not only a Microsoft Store alias. Claude must check executable/version. Existing runbook `python3` examples may be run with verified `python` on Windows.
- Only if running the web app locally: Node>=22.18, package-manager version from root package.json and frozen-lockfile install. This is optional for offline native checks; use no recursive build.
- Install English (United States) language/OCR through Windows Settings. Permit the user-level screen capture if Windows asks. Do not disable OS protections or run the game/agent as administrator to hide a failure.
- Start Global English Steam Uma Musume, restored, windowed/borderless, **16:9 client area at least1920x1080 physical pixels**. Record display scaling and actual client size. Smaller/non16:9 capture is unsupported; do not fake larger pixels or edit thresholds.

Claude can build, run tests, inspect safe logs and guide you. **You** operate the game, approve uploads/replacements, enter secrets only in the agent's masked Settings, and verify game facts. There is no game bot: independent training is the in-game feature; the agent only captures screens/OCR.

### B. Native/offline checks first

Have Claude execute section3. You dismiss any OCR recorder completion/error dialog, inspect the tray app and provide real screen observations. Capture the H3 screenshots while already in game (section5). Without hosting, mark real imports/live card PUTs **BLOCKED H2**, not passed. Empty API settings are intentional; never point the agent at a guessed site, disable Access or replace HTTPS with localhost to force a success.

### C. Private hosting before live imports

If not already provisioned, the human follows `cloudflare-setup.md`: Cloudflare account/Zero Trust, protected host, D1/R2, service-auth policy/token, production secret/config, live verification, encrypted backup/restore and real Worker CPU checks. Its shell examples are **bash**, not PowerShell; use a user-approved bash environment or have the coordinator prepare a separately reviewed PowerShell equivalent. Do not paste bash syntax into PowerShell.

This remains an explicit approval boundary: no Claude deployment, account checkout, billing/payment decision, secret entry or production data modification is implied by this handoff. Review current provider terms/plan/payment requirements in the dashboard rather than assuming historical free-tier notes are current. Do not create a paid resource to get unstuck. Do not paste credentials into Claude/chat/terminal arguments/logs. Do not accept Microsoft distribution terms on the user's behalf; existing notice delivery does not constitute legal clearance for distribution.

After the site is protected and verified, the human enters its HTTPS base address and Access client ID+secret in **tray > Settings**. Never include those values or `service-token.bin` in evidence. Confirm the destination and permission to send real data before starting live acceptance.

### D. Real game acceptance

Follow `agent-install.md` §6 exactly, starting with3 veterans before attempting20:

1. Run published single-file EXE and test native capture, newest-frame/scroll behavior, DPI/client geometry, minimize/restore, resize recovery, stop/restart/Exit cancellation, safe secret storage and extracted layout/master/legal files. Do not assert extraction just because build passed.
2. Record real Windows OCR for15 fixtures plus2 ROI JSON files and validate unchanged labels/accuracy in an isolated validation checkout (section4).
3. Human-check all15 labels, including circles, clipped rows, guest-parent details, exact star/LB counts and **six art-only deck card identities** listed in `agent-install.md` §6. A nearest art hash is not human identification.
4. Capture3 real veterans with complete Skills/Inspiration/Career coverage, including a manual-training and guest-parent case. Scroll slowly with overlap and dwell>=2s. Open uncertain parent popups manually. Stop/save and confirm actual acknowledged web records match the game before scaling up.
5. Reach>=20 real veteran imports total, spot-check>=3 in the web app, retain failures and review-queue counts, and record Windows Task Manager memory during the run. Parser-accepted/manually corrected fields are eligible; any remaining low-confidence field excludes a veteran from training. Do not alter numeric confidence to force inclusion.
6. Live auth rotation/retry, restart with pending outbox, rejected-upload recovery and support-card controls: follow full runbook §6, with explicit human consent before any intentional invalid credential/destination scenario or destructive sync. **Every card sync replaces the whole web collection**; partial is not merge. Confirming a partial send can remove cards. Back up and ask first; cancellations/stale confirmations must not send.

## 3. Commands Claude should run (no secrets)

From checkout root, create an external local evidence folder; do not store credentials there:

```powershell
$root = (Get-Location).Path
$evidence = Join-Path $env:LOCALAPPDATA ('UmaSparkCalc\validation\H4-' + (Get-Date -Format yyyyMMdd-HHmmss))
New-Item -ItemType Directory -Path $evidence -ErrorAction Stop | Out-Null
git rev-parse HEAD
dotnet --list-sdks
dotnet --list-runtimes
python --version
```

For each external command, **check `$LASTEXITCODE` immediately**, record command/output/status and stop on failure. PowerShell does not make native exit failures terminate a script merely because `$ErrorActionPreference='Stop'`. No trailing successful command may mask a failure.

Run dotnet **inside agent/** so global.json selects exact SDK:

```powershell
Push-Location agent
try {
    $sdk = (dotnet --version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'SDK selection failed.' }
    if ($sdk -ne '10.0.401') { throw "Expected SDK10.0.401; got $sdk" }
    dotnet build Uma.Agent.sln -c Release
    if ($LASTEXITCODE -ne 0) { throw 'Native solution build failed.' }
    dotnet test tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj -c Release --logger 'trx;LogFileName=core.trx' --results-directory $evidence
    if ($LASTEXITCODE -ne 0) { throw 'Core tests failed.' }
    dotnet test tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj -c Release --logger 'trx;LogFileName=portable.trx' --results-directory $evidence
    if ($LASTEXITCODE -ne 0) { throw 'Portable tests failed.' }
    dotnet test tests/Uma.Agent.Windows.Tests/Native/Uma.Agent.Windows.Tests.csproj -c Release --logger 'trx;LogFileName=native.trx' --results-directory $evidence
    if ($LASTEXITCODE -ne 0) { throw 'Windows Native tests failed.' }
    $publish = Join-Path $evidence 'publish'
    dotnet publish src/Uma.Agent.Windows/Uma.Agent.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o $publish
    if ($LASTEXITCODE -ne 0) { throw 'Publish failed.' }
} finally { Pop-Location }
```

Run all3 strict Python suites from root; inspect each exit before proceeding:

```powershell
python -X dev -W error agent/legal/tools/test_recipient_notices.py
if ($LASTEXITCODE -ne 0) { throw 'Notice tests failed.' }
python -X dev -W error agent/legal/tools/test_review_r1.py
if ($LASTEXITCODE -ne 0) { throw 'R1 tests failed.' }
python -X dev -W error agent/legal/tools/test_review_r2.py
if ($LASTEXITCODE -ne 0) { throw 'R2 tests failed.' }
$exe = Join-Path $publish 'Uma.Agent.Windows.exe'
$zip = Join-Path $evidence 'uma-agent-win-x64.zip'
python agent/legal/tools/recipient_notices.py package $exe $zip --assets agent/src/Uma.Agent.Windows/obj/project.assets.json
if ($LASTEXITCODE -ne 0) { throw 'Recipient package verification failed.' }
python agent/legal/tools/recipient_notices.py verify-zip $zip --assets agent/src/Uma.Agent.Windows/obj/project.assets.json
if ($LASTEXITCODE -ne 0) { throw 'Final ZIP verification failed.' }
Get-FileHash $exe -Algorithm SHA256
Get-FileHash $zip -Algorithm SHA256
```

Before running EXE or recorder, verify source ancestry and package gates succeeded. Launch exactly `$exe` as normal user. Actual GUI/OCR/game acceptance follows only after human readiness. A build/test error is evidence to report, **not** permission to upgrade packages/frameworks, suppress audit, weaken assertions or regenerate golden/master data. Don't run `pnpm -r build`, `pnpm build` or blanket formatting. No downloaded game art or secret/key files in commits.

## 4. Real Windows OCR without destroying the baseline

Exit tray process first; see `agent-install.md` §5 for recorder format/dialogs. Save into a **fresh external** folder, never `--overwrite` on baseline fixtures by default:

```powershell
$ocrOut = Join-Path $evidence 'windows-ocr'
$p = Start-Process -FilePath $exe -ArgumentList @('--record-ocr', 'docs/reference/screenshots', '--out', ('"' + $ocrOut + '"')) -PassThru -Wait
if ($p.ExitCode -ne 0) { throw 'Real Windows OCR recording failed.' }
$full = @(Get-ChildItem (Join-Path $ocrOut 'ocr') -Filter *.json)
$roi = @(Get-ChildItem (Join-Path $ocrOut 'ocr-roi') -Filter *.json)
if ($full.Count -ne 15 -or $roi.Count -ne 2) { throw 'Expected15 full-frame and2 per-ROI JSON files.' }
$full | ForEach-Object {
    $record = Get-Content $_.FullName -Raw | ConvertFrom-Json
    if ($record.engine -notlike 'windows-media-ocr-*') { throw 'Not actual Windows OCR.' }
}
```

The user must dismiss the WinExe completion/error dialog for Wait to finish. Do not fabricate recordings if OCR is unavailable.

For accuracy against **these new** recordings: make a separate disposable validation worktree/checkout at the same reviewed SHA; preserve the baseline and record before/after hashes. Copy ONLY the15 `ocr/*.json` and2 `ocr-roi/*.json` there, keeping names; do NOT change labels, screenshots, thresholds, templates or master data. This explicitly permits local recording substitution in that isolated validation checkout, **not committing fixture replacements**. Run Core FixtureTests there from `agent/`, with detailed output, on native .NET8. Retain actual failures and `accuracy-report.txt` from the test output directory. The run is accepted only at>=99% overall,100% stats/stars/LB and no wrong-confident results. Baseline replay passing alone is not Windows OCR accuracy. Any mismatch goes back to the coordinator with raw recording and expected/actual field, no silent label adjustment.

## 5. Screenshots to return (H3)

Use native game-client screenshots without resizing; keep originals private until reviewed for trainer/account names. Curated screenshots may be added only under `docs/reference/screenshots/`, never elsewhere in git.

- Veteran List at **top** with visible sort/filter controls and scrollbar.
- The **same list in the middle**, showing overlapping entries, scrollbar and current sort.
- Career Info with a **grandparent portrait**, and the result after you tap it. Report whether a popup/detail screen opens, nothing happens, or another action is needed. Do not infer that your veteran's parents equal the planner child's parents: retain the existing lineage terminology.
- If supported client geometry cannot be obtained, send the actual width/height and display scaling/error category. Do not invent navigation coordinates or implement automated clicks.

## 6. What to send back

Claude fills `docs/reference/windows/H4-REPORT-TEMPLATE.md` into a **new report**, such as `docs/reference/windows/H4-<date>-report.md`, on qa/H4-windows-validation. Include exact HEAD, architecture/OS build/scaling/client dimensions, real command results/TRX counts including skipped tests, final artifact hashes,15+2 OCR counts and actual accuracy, six card identities marked verified/unverified, live imports/spot checks/memory, card sync/negative scenarios, H3 answers and blockers.

Use explicit **PASS / FAIL / BLOCKED / NOT RUN** per item. Do not mark H4/M2 or legal/publication complete yourself; coordinator independently reviews evidence. If a phase needs an absent site, game interaction, credentials, or consent, stop only that phase and continue independent offline checks.

Return a sanitized report plus selected OCR/TRX/log evidence and H3 images, not `%LOCALAPPDATA%\UmaSparkCalc` wholesale. Exclude service-token.bin, settings files, raw DB/crops unless separately authorized, private keys, environment dumps, signed URLs, access headers and raw request bodies. Screenshots/OCR can contain guest trainer names; redact a sharing copy (not source evidence used for accuracy). Record redaction without fabricating values. Do not alter test input to make a redacted sharing copy pass.

No push/commit of game screenshots, OCR replacements or sensitive evidence without human review. Claude may leave the new report uncommitted and provide a diff; scoped fixes need coordinator assignment and independent review. Send me the report and failing evidence, then I will triage native bugs, scope fixes/review, and schedule real calibration after real data is available.
