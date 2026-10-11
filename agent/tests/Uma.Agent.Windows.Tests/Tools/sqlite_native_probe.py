#!/usr/bin/env python3
"""T18: prove a win-x64 single-file publish contains the selected native package.

Usage: sqlite_native_probe.py published.exe exact-native.nupkg
This inspects bytes and RID/PE architecture; it does NOT execute Windows code.
"""
import hashlib
import pathlib
import struct
import sys
import zipfile

exe, package = map(pathlib.Path, sys.argv[1:])
data = exe.read_bytes()
signature = bytes.fromhex('8b1202b96a612038727b930214d7a03213f5b9e6efae3318ee3b2dce24b36aae')
i = data.find(signature)
assert i >= 8, 'bundle signature missing'
p = struct.unpack_from('<q', data, i - 8)[0]
major, minor, count = struct.unpack_from('<IIi', data, p)
p += 12
assert major == 6, f'unsupported bundle version {major}'

def text():
    global p
    length, shift = 0, 0
    while True:
        b = data[p]
        p += 1
        length |= (b & 0x7f) << shift
        shift += 7
        if b < 0x80:
            break
        assert shift < 35, 'invalid string length'
    result = data[p:p + length].decode()
    p += length
    return result

text()  # bundle ID
p += 40
entries = []
for _ in range(count):
    offset, size, compressed = struct.unpack_from('<qqq', data, p)
    p += 24
    kind = data[p]
    p += 1
    entries.append((text(), offset, size, compressed, kind))
native = [e for e in entries if e[0] == 'e_sqlite3.dll']
assert len(native) == 1, 'expected exactly one SQLite native library'
name, offset, size, compressed, kind = native[0]
assert compressed == 0 and kind == 2, 'SQLite must be an uncompressed native bundle entry'
blob = data[offset:offset + size]
assert len(blob) == size
asset = 'runtimes/win-x64/native/e_sqlite3.dll'
with zipfile.ZipFile(package) as z:
    expected = z.read(asset)
    nuspec = z.read(next(n for n in z.namelist() if n.endswith('.nuspec')))
    assert b'<version>2.1.12</version>' in nuspec, 'unexpected native package pin'
assert blob == expected, 'published DLL differs from exact NuGet RID asset'
assert blob[:2] == b'MZ'
pe = struct.unpack_from('<I', blob, 0x3c)[0]
assert blob[pe:pe + 4] == b'PE\0\0'
machine = struct.unpack_from('<H', blob, pe + 4)[0]
magic = struct.unpack_from('<H', blob, pe + 24)[0]
assert machine == 0x8664 and magic == 0x20b, 'not PE32+ AMD64'
source = b'2026-06-26 20:14:12 d4c0e51e4aeb96955b99185ab9cde75c339e2c29c3f3f12428d364a10d782c62'
assert source + b'\0' in blob and b'3.53.3\0' in blob, 'unexpected embedded SQLite identity'
print('bundle', major, minor, 'entries', count)
print('package SHA256', hashlib.sha256(package.read_bytes()).hexdigest())
print(asset, 'size', size, 'PE32+ AMD64 (0x8664)', 'SHA256', hashlib.sha256(blob).hexdigest())
print('Embedded SQLite 3.53.3; source_id', source.decode())
print('Exact native package asset matches published bundle; Windows execution remains H4')
