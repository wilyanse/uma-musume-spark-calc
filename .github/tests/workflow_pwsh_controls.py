#!/usr/bin/env python3
"""Execute YAML-extracted release bodies under real pwsh with in-process dotnet/gh mocks.

No GitHub commands/network/credentials. The real Python verifier handles real EXE bytes and
restored assets. Ruby YAML is used only to extract steps. Requires --pwsh, --exe, --assets.
Every run gets its own scratch workspace (including spaces); reviewer scratch is never deleted.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile

REPO = Path(__file__).resolve().parents[2]
PREAMBLE = r'''
$ErrorActionPreference = 'Stop'
function global:dotnet {
    Add-Content -LiteralPath $env:MOCKLOG -Value ('dotnet ' + (ConvertTo-Json -Compress @($args)))
    if ($args[0] -ceq '--version') { $global:LASTEXITCODE = 0; $env:MOCKSDK; return }
    if ($args[0] -cne 'publish') { throw 'Unexpected dotnet invocation' }
    if ($env:MOCKDOTNETFAIL -eq '1') { $global:LASTEXITCODE = 7; return }
    $idx = [Array]::IndexOf($args, '-o')
    if ($idx -lt 0) { throw 'Mock publish lacks output path' }
    New-Item -ItemType Directory -Force -Path $args[$idx + 1] | Out-Null
    Copy-Item -LiteralPath $env:MOCKEXE -Destination (Join-Path $args[$idx + 1] 'Uma.Agent.Windows.exe')
    $global:LASTEXITCODE = 0
}
function global:gh {
    Add-Content -LiteralPath $env:MOCKLOG -Value ('gh ' + (ConvertTo-Json -Compress @($args)))
    $global:LASTEXITCODE = 0
}
function global:python {
    Add-Content -LiteralPath $env:MOCKLOG -Value ('python ' + (ConvertTo-Json -Compress @($args)))
    if ($env:MOCKNOPython -eq '1') { throw 'Mock python unavailable' }
    & $env:REALPYTHON @args
    $global:LASTEXITCODE = $LASTEXITCODE
}
'''


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--pwsh', required=True)
    ap.add_argument('--exe', required=True)
    ap.add_argument('--assets', required=True)
    ap.add_argument('--baseline-exe')
    ap.add_argument('--logs', help='retain execution logs here (scratch only)')
    a = ap.parse_args()
    ruby = "require 'yaml';require 'json';s=YAML.load_file(ARGV[0])['jobs']['release']['steps'];puts JSON.generate([s.find{|x|x['id']=='build'}['run'],s.find{|x|x['name']=='Create GitHub release'}['run']])"
    bodies = json.loads(subprocess.check_output(['ruby', '-e', ruby, str(REPO / '.github/workflows/agent-release.yml')]))
    results = []
    with tempfile.TemporaryDirectory(prefix='t19-pwsh-') as td:
        root = Path(td)
        for name, body in zip(('build', 'create'), bodies): (root / (name + '.ps1')).write_text(PREAMBLE + '\n' + body)
        for name, sdk, fail_publish, no_python, tamper, tag, exe, want in [
            ('valid', '10.0.401', False, False, False, 'agent-v1.2.3', a.exe, (0, 0)),
            ('tamper-before-release', '10.0.401', False, False, True, 'agent-v1.2.3', a.exe, (0, 1)),
            ('bad-tag', '10.0.401', False, False, False, 'agent-v1.2.3;whoami', a.exe, (1, None)),
            ('wrong-sdk', '10.0.103', False, False, False, 'agent-v1.2.3', a.exe, (1, None)),
            ('publish-failure', '10.0.401', True, False, False, 'agent-v1.2.3', a.exe, (1, None)),
            ('no-python', '10.0.401', False, True, False, 'agent-v1.2.3', a.exe, (1, None)),
        ] + ([('baseline-no-notices', '10.0.401', False, False, False, 'agent-v1.2.3', a.baseline_exe, (1, None))] if a.baseline_exe else []):
            ws = root / (name + ' workspace with spaces'); ws.mkdir()
            shutil.copytree(REPO / 'agent/legal', ws / 'agent/legal', ignore=shutil.ignore_patterns('__pycache__'))
            for n in ('.gitattributes', 'agent/global.json', 'agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj'):
                dst = ws / n; dst.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(REPO / n, dst)
            dest = ws / 'agent/src/Uma.Agent.Windows/obj/project.assets.json'; dest.parent.mkdir(parents=True)
            shutil.copyfile(a.assets, dest)
            log = root / (name + '.mock.log'); output = root / (name + '.output'); output.write_text('')
            env = dict(os.environ, MOCKLOG=str(log), MOCKSDK=sdk, MOCKDOTNETFAIL='1' if fail_publish else '0',
                       MOCKNOPython='1' if no_python else '0', MOCKEXE=str(Path(exe).resolve()),
                       REALPYTHON=sys.executable, GITHUB_OUTPUT=str(output), TAG=tag, PYTHONDONTWRITEBYTECODE='1')
            env.pop('GH_TOKEN', None)  # Not needed by mock; never borrow a real credential.
            def run(step):
                p = subprocess.run([a.pwsh, '-NoProfile', '-NonInteractive', '-File', str(root / (step + '.ps1'))],
                                   cwd=ws, env=env, capture_output=True, text=True)
                (root / (name + '.' + step + '.log')).write_text(p.stdout + p.stderr)
                return p.returncode
            zip_path = None
            b = run('build'); c = None
            out = output.read_text(encoding='utf-8-sig').strip()
            if b == 0:
                assert out.startswith('zip=') and '\n' not in out, (name, out)
                zip_path = Path(out[4:]); assert zip_path.is_file()
                if tamper:
                    tmp = zip_path.with_suffix('.tampered')
                    with zipfile.ZipFile(zip_path) as zi, zipfile.ZipFile(tmp, 'w') as zo:
                        for i in zi.infolist():
                            blob = zi.read(i.filename)
                            if i.filename == 'LICENSES/Serilog-4.3.0-LICENSE.txt': blob = blob[:500]
                            zo.writestr(i, blob)
                    tmp.replace(zip_path)
                env['ZIP'] = str(zip_path); c = run('create')
            else:
                assert not out, (name, 'failed build produced ZIP output')
            records = log.read_text().splitlines() if log.exists() else []
            gh = [json.loads(x[3:]) for x in records if x.startswith('gh ')]
            if want == (0, 0):
                assert gh == [['release', 'create', tag, str(zip_path), '--verify-tag', '--generate-notes']], gh
            else: assert not gh, (name, 'unexpected GH mock invocation', gh)
            if name == 'bad-tag': assert not records, records
            if name == 'wrong-sdk': assert len(records) == 1 and records[0].startswith('dotnet '), records
            if name != 'valid':
                expected_text = {'tamper-before-release': 'release ZIP verification failed', 'bad-tag': 'Unexpected tag format',
                                 'wrong-sdk': 'Recipient publish requires SDK', 'publish-failure': 'dotnet publish failed',
                                 'no-python': 'Mock python unavailable', 'baseline-no-notices': 'recipient notice packaging failed'}[name]
                error = (root / (name + ('.create.log' if tamper else '.build.log'))).read_text()
                assert expected_text in error, (name, 'wrong failure reason', error[-3000:])
            ok = (b, c) == want
            print('%s: build=%s create=%s expected=%s %s' % (name, b, c, want, 'PASS' if ok else 'FAIL'))
            results.append(ok)
        if a.logs:
            dest = Path(a.logs); dest.mkdir(parents=True, exist_ok=True)
            for p in root.glob('*'):
                if p.is_file(): shutil.copyfile(p, dest / p.name)
    assert all(results), 'PowerShell workflow control failed; inspect logs'
    print('YAML-extracted pwsh controls: %d passed; dotnet/gh mocked, Python verifier real; no publication' % len(results))


if __name__ == '__main__': main()
