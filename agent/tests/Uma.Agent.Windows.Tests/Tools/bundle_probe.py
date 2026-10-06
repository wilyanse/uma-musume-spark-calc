#!/usr/bin/env python3
"""T10 verification tool: check the data bundled in a published single-file Uma.Agent.Windows.exe.

Parses the .NET single-file bundle manifest (bundle v6) independently of the SDK and compares every bundled
layout/template/master JSON and appsettings.json with the repository bytes, and lists key assemblies.
Usage: python3 bundle_probe.py <published.exe> <repo-root>
Exit code 1 if any expected file is missing, compressed or different.
Provenance: the T10 review round 1 reviewer's probe (~/.hermes/cache/scratch/T10-review/bundle_probe.py), retained
here with only this header and the exit code added. The EXE SHA-256 it prints is NOT reproducible across publishes
(bytes differ between publishes; size and the bundled data match); do not quote it as an artifact identifier.
"""
import struct, sys, hashlib, os
exe, repo = sys.argv[1], sys.argv[2]
data = open(exe, 'rb').read()
sig = bytes.fromhex('8b1202b96a612038727b930214d7a03213f5b9e6efae3318ee3b2dce24b36aae')
i = data.find(sig)
assert i > 8, 'bundle signature not found'
hdr = struct.unpack_from('<q', data, i - 8)[0]
p = hdr
major, minor, count = struct.unpack_from('<IIi', data, p); p += 12
def s(p):
    n = 0; shift = 0
    while True:
        b = data[p]; p += 1; n |= (b & 0x7f) << shift; shift += 7
        if b < 0x80: break
    return data[p:p+n].decode(), p + n
bid, p = s(p)
if major >= 2: p += 8*4 + 8  # deps/runtimeconfig offsets+sizes, flags
entries = []
for _ in range(count):
    off, size, csize = struct.unpack_from('<qqq', data, p); p += 24
    typ = data[p]; p += 1
    path, p = s(p)
    entries.append((path, off, size, csize, typ))
print('bundle', major, minor, 'entries', len(entries))
pairs = {'appsettings.json': 'agent/src/Uma.Agent.Windows/appsettings.json'}
for root, rel in [('agent/layouts', 'data/layouts'), ('apps/web/public/master', 'data/master')]:
    for d, _, fs in os.walk(os.path.join(repo, root)):
        for f in fs:
            if f.endswith('.json'):
                full = os.path.join(d, f)
                pairs[os.path.join(rel, os.path.relpath(full, os.path.join(repo, root))).replace(os.sep, '/')] = os.path.relpath(full, repo)
byname = {e[0].replace('\\', '/'): e for e in entries}
ok = 0
for bpath, rpath in sorted(pairs.items()):
    e = byname.get(bpath)
    if e is None: print('MISSING', bpath); continue
    if e[3] != 0: print('COMPRESSED', bpath); continue
    blob = data[e[1]:e[1]+e[2]]
    same = blob == open(os.path.join(repo, rpath), 'rb').read()
    ok += same
    print('MATCH' if same else 'DIFF', bpath)
print('matches', ok, 'of', len(pairs))
for n in ['Uma.Agent.Core.dll', 'Uma.Agent.Windows.dll', 'Microsoft.Windows.SDK.NET.dll', 'WinRT.Runtime.dll', 'e_sqlite3.dll', 'System.Security.Cryptography.ProtectedData.dll', 'Serilog.dll']:
    print(n, n in byname)
print('sha256 (this publish only; not reproducible)', hashlib.sha256(data).hexdigest())
sys.exit(0 if ok == len(pairs) else 1)
