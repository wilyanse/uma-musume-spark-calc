#!/usr/bin/env python3
"""Real published-artifact controls for T19 r1. No execution of Windows code.

Run after publish: python real_artifact_controls.py EXE --packages DIR [--verifier PY]
Uses a scratch TemporaryDirectory (TMPDIR must be set by the caller). The alternate verifier
option retains honest RED against the reviewed candidate. Every negative must exit 1 with
Failure diagnostics and no traceback. Tamper controls are independently asserted, not swallowed.
"""
import argparse
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile

import recipient_notices as rn


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('exe')
    ap.add_argument('--packages', required=True)
    ap.add_argument('--verifier', default=str(Path(__file__).with_name('recipient_notices.py')))
    a = ap.parse_args()
    verifier = Path(a.verifier).resolve()
    legal = verifier.parent.parent
    data = Path(a.exe).read_bytes()
    entries = {e['path']: e for e in rn.parse_bundle(data)}
    inv = json.loads((legal / 'inventory.json').read_bytes())
    pv = inv['singleFileHost']['productVersion'].encode('utf-16-le')
    first = min(e['offset'] for e in entries.values())
    positions = []
    pos = data.find(pv)
    while 0 <= pos < first:
        positions.append(pos); pos = data.find(pv, pos + len(pv))
    assert len(positions) >= 2, 'need both real host ProductVersion occurrences'
    failures = 0
    with tempfile.TemporaryDirectory(prefix='t19-real-') as td:
        root = Path(td)
        def run(name, blob, needle='', legal_override=None, expected=1):
            nonlocal failures
            exe = root / 'probe.exe'; exe.write_bytes(blob)
            args = [sys.executable, '-B', str(verifier), 'verify-exe', str(exe), '--packages', a.packages]
            if legal_override: args += ['--legal', str(legal_override)]
            p = subprocess.run(args, capture_output=True, text=True)
            text = p.stdout + p.stderr
            ok = p.returncode == expected and (expected == 0 or ('RECIPIENT NOTICE CHECK FAILED' in text and
                 'Traceback' not in text and needle in text))
            print('%s: exit=%d expected=%d %s' % (name, p.returncode, expected, 'PASS' if ok else 'FAIL'))
            print(text[:1500].rstrip())
            if not ok: failures += 1
        run('valid', data, expected=0)
        b = bytearray(data); b[0x2000] ^= 1
        run('host-code-byte', b, 'host')
        for i, p in enumerate(positions):
            b = bytearray(data); b[p] ^= 1
            run('host-version-copy-%d' % i, b, 'host')
        b = bytearray(data); i = data.find(rn.SIGNATURE); struct.pack_into('<q', b, i - 8, len(b) - 3)
        run('header-near-eof', b, 'header')
        run('truncated-real-exe', data[:len(data) * 3 // 5], 'header')
        for suffix in ('.deps.json', '.runtimeconfig.json'):
            e = next(e for n, e in entries.items() if n.endswith(suffix))
            b = bytearray(data); b[e['offset']] = ord('?')
            run('malformed' + suffix, b, 'JSON')
        # Semantic JSON-only mutations: retain size/offsets, all licence/DLL bytes unchanged.
        e = entries['Uma.Agent.Windows.runtimeconfig.json']
        rc = json.loads(rn.entry_bytes(data, e))
        fw = rc['runtimeOptions']['includedFrameworks']
        for name, frameworks, needle in [
                ('runtimeconfig-missing-desktop', [f for f in fw if f['name'] != 'Microsoft.WindowsDesktop.App'], 'differs from actual framework runtime packs'),
                ('runtimeconfig-duplicate-core', [next(f for f in fw if f['name'] == 'Microsoft.NETCore.App')] * 2, 'duplicate includedFramework name')]:
            mutated = json.loads(json.dumps(rc))
            mutated['runtimeOptions']['includedFrameworks'] = frameworks
            blob = json.dumps(mutated).encode()
            assert len(blob) <= e['size']
            b = bytearray(data)
            b[e['offset']:e['offset'] + e['size']] = blob + b' ' * (e['size'] - len(blob))
            assert b[:e['offset']] == data[:e['offset']] and b[e['offset'] + e['size']:] == data[e['offset'] + e['size']:]
            assert json.loads(rn.entry_bytes(b, e)) == mutated
            run(name, b, needle)
        b = bytearray(data); p = b.rfind(b'Uma.Agent.Windows.deps.json'); assert p > 0
        b[p + len(b'Uma.Agent.Windows.deps.')] = ord('X')
        run('missing-deps', b, 'exactly one deps.json')
        for n in ('legal/INDEX.txt', 'e_sqlite3.dll', 'D3DCompiler_47_cor3.dll'):
            e = entries[n]; b = bytearray(data); b[e['offset'] + 20] ^= 1
            run('tamper-' + n, b, 'changed' if n.startswith('legal/') else 'differs')
        for name, edit in [('component-missing-deps', lambda v: v['components'][0].pop('deps')),
                           ('inventory-wrong-type', lambda v: v.update(components='bad'))]:
            copy = root / name; shutil.copytree(legal, copy, ignore=shutil.ignore_patterns('__pycache__'))
            v = json.loads((copy / 'inventory.json').read_bytes()); edit(v)
            (copy / 'inventory.json').write_text(json.dumps(v))
            run(name, data, 'inventory', legal_override=copy)
        copy = root / 'invalid-json'; shutil.copytree(legal, copy, ignore=shutil.ignore_patterns('__pycache__'))
        (copy / 'inventory.json').write_bytes(b'not json')
        run('inventory-malformed-json', data, 'inventory', legal_override=copy)
    print('real artifact controls: %d unexpected result(s)' % failures)
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
