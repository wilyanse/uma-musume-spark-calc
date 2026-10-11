#!/usr/bin/env python3
"""T19 deterministic regressions for recipient_notices.py.

Builds a synthetic .NET single-file bundle (format v6), a synthetic NuGet global-packages folder and a
synthetic agent/legal directory in a temporary directory, then checks the valid path and each fail-closed
path (missing/truncated/changed notice, unresolved/drifted/stale dependency, runtime-pack drift, foreign
bundle entry, compressed entry, wrong host build, ZIP tampering). No network, no real packages.

  python3 agent/legal/tools/test_recipient_notices.py
"""
import contextlib
import hashlib
import io
import json
import os
import shutil
import struct
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import recipient_notices as rn  # noqa: E402

HOST_PV = '8,0,9999,1 @Commit: 0000000000000000000000000000000000000001'
RT = 'runtimepack.Fake.NETCore.App.Runtime.win-x64/8.0.24'
PKG = 'Fake.Lib/1.2.3'


def sha(b):
    return hashlib.sha256(b).hexdigest()


def varstr(s):
    b = s.encode()
    out = bytearray()
    n = len(b)
    while True:
        out.append((n & 0x7f) | (0x80 if n > 0x7f else 0))
        n >>= 7
        if not n:
            break
    return bytes(out) + b


def build_bundle(files, host=None):
    """files: list of (path, bytes, kind, compressed_flag). Returns EXE bytes."""
    host = host if host is not None else b'MZ' + HOST_PV.encode('utf-16-le') + b'\0' * 64
    placeholder_at = len(host)
    data = bytearray(host + b'\0' * 8 + rn.SIGNATURE)
    entries = []
    for path, blob, kind, compressed in files:
        off = len(data)
        data += blob
        entries.append((off, len(blob), len(blob) if compressed else 0, kind, path))
    manifest_at = len(data)
    data += struct.pack('<IIi', 6, 0, len(entries)) + varstr('bundle-id') + b'\0' * 40
    for off, size, csize, kind, path in entries:
        data += struct.pack('<qqq', off, size, csize) + bytes([kind]) + varstr(path)
    struct.pack_into('<q', data, placeholder_at, manifest_at)
    return bytes(data)


class Fixture:
    def __init__(self, root):
        self.root = root
        self.packages = os.path.join(root, 'packages')
        self.legal = os.path.join(root, 'legal')
        os.makedirs(os.path.join(self.legal, 'notices'))
        self.notices = {
            'INDEX.txt': b'Fake runtime 8.0.24 -> rt-LICENSE.txt rt-TPN.txt\nFake.Lib 1.2.3 -> lib-LICENSE.txt\n',
            'rt-LICENSE.txt': b'MIT licence of the fake runtime\r\n',
            'rt-TPN.txt': b'Third party notices of the fake runtime\r\n',
            'lib-LICENSE.txt': b'Apache licence text of Fake.Lib\n' * 20,
        }
        self.corelib = b'MZ fake corelib'
        self.libdll = b'MZ fake lib'
        self.native = b'MZ fake native'
        self.host_dir = os.path.join(self.packages, 'fake.netcore.app.host.win-x64', '8.0.24')
        self.rt_dir = os.path.join(self.packages, 'fake.netcore.app.runtime.win-x64', '8.0.24')
        self.lib_dir = os.path.join(self.packages, 'fake.lib', '1.2.3')
        self.write(self.rt_dir, 'runtimes/win-x64/lib/net8.0/System.Private.CoreLib.dll', self.corelib)
        self.write(self.rt_dir, 'runtimes/win-x64/native/fakeclr.dll', self.native)
        self.write(self.rt_dir, 'data/RuntimeList.xml', (
            '<FileList><File Type="Managed" Path="runtimes/win-x64/lib/net8.0/System.Private.CoreLib.dll" />'
            '<File Type="Native" Path="runtimes/win-x64/native/fakeclr.dll" /></FileList>').encode())
        for d in (self.rt_dir, self.host_dir):
            self.write(d, 'LICENSE.TXT', self.notices['rt-LICENSE.txt'])
            self.write(d, 'THIRD-PARTY-NOTICES.TXT', self.notices['rt-TPN.txt'])
        self.write(self.lib_dir, 'lib/net8.0/Fake.Lib.dll', self.libdll)
        self.nupkg = {}
        for d, n in ((self.rt_dir, 'fake.netcore.app.runtime.win-x64.8.0.24.nupkg'),
                     (self.host_dir, 'fake.netcore.app.host.win-x64.8.0.24.nupkg'),
                     (self.lib_dir, 'fake.lib.1.2.3.nupkg')):
            b = ('nupkg ' + n).encode()
            self.write(d, n, b)
            self.nupkg[d] = sha(b)
        for name, b in self.notices.items():
            self.write(self.legal, 'notices/' + name, b)
        self.inventory = {
            'schema': 1,
            'runtimeTarget': '.NETCoreApp,Version=v8.0/win-x64',
            'firstParty': ['App/0.1.0'],
            'appEntries': {'exact': ['appsettings.json', 'App.deps.json', 'App.runtimeconfig.json'],
                           'dataPattern': r'^data/(layouts|master)/[A-Za-z0-9._/-]+\.json$'},
            'singleFileHost': {'package': 'Fake.NETCore.App.Host.win-x64', 'version': '8.0.24',
                               'nupkgSha256': self.nupkg[self.host_dir], 'productVersion': HOST_PV,
                               'packTexts': {'LICENSE.TXT': 'rt-LICENSE.txt', 'THIRD-PARTY-NOTICES.TXT': 'rt-TPN.txt'}},
            'components': [
                {'deps': RT, 'kind': 'runtimepack', 'nupkgSha256': self.nupkg[self.rt_dir], 'licence': 'MIT',
                 'copyright': 'c', 'source': 's', 'notices': ['rt-LICENSE.txt', 'rt-TPN.txt'],
                 'packTexts': {'LICENSE.TXT': 'rt-LICENSE.txt', 'THIRD-PARTY-NOTICES.TXT': 'rt-TPN.txt'}},
                {'deps': PKG, 'kind': 'package', 'nupkgSha256': self.nupkg[self.lib_dir], 'licence': 'Apache-2.0',
                 'copyright': 'c', 'source': 's', 'notices': ['lib-LICENSE.txt']},
            ],
            'notices': {n: {'source': 'test', 'sha256': sha(b)} for n, b in self.notices.items()},
        }
        self.save_inventory()
        self.deps = {
            'runtimeTarget': {'name': '.NETCoreApp,Version=v8.0/win-x64'},
            'targets': {'.NETCoreApp,Version=v8.0/win-x64': {
                'App/0.1.0': {'runtime': {'App.dll': {}}},
                RT: {'runtime': {'System.Private.CoreLib.dll': {}}, 'native': {'fakeclr.dll': {}}},
                PKG: {'runtime': {'lib/net8.0/Fake.Lib.dll': {}}},
            }},
            'libraries': {'App/0.1.0': {'type': 'project'}, RT: {'type': 'runtimepack'},
                          PKG: {'type': 'package', 'path': 'fake.lib/1.2.3'}},
        }
        self.runtimeconfig = {'runtimeOptions': {'includedFrameworks': [
            {'name': 'Fake.NETCore.App', 'version': '8.0.24'}]}}

    def write(self, base, rel, b):
        p = os.path.join(base, *rel.split('/'))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'wb') as f:
            f.write(b)

    def save_inventory(self):
        self.write(self.legal, 'inventory.json', json.dumps(self.inventory, indent=1).encode())

    def files(self):
        inv = open(os.path.join(self.legal, 'inventory.json'), 'rb').read()
        fs = [('App.dll', b'MZ app', 1, False),
              ('System.Private.CoreLib.dll', self.corelib, 1, False),
              ('fakeclr.dll', self.native, 2, False),
              ('Fake.Lib.dll', self.libdll, 1, False),
              ('appsettings.json', b'{}', 0, False),
              ('data/master/latest.json', b'{}', 0, False),
              ('App.deps.json', json.dumps(self.deps).encode(), 3, False),
              ('App.runtimeconfig.json', json.dumps(self.runtimeconfig).encode(), 4, False),
              ('legal/inventory.json', inv, 0, False)]
        fs += [('legal/' + n, b, 0, False) for n, b in sorted(self.notices.items())]
        return fs

    def exe(self, files=None, host=None):
        return build_bundle(self.files() if files is None else files, host)


class RecipientNoticeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='t19-rn-', dir=os.environ.get('TMPDIR'))
        self.f = Fixture(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def ok(self, exe):
        return rn.verify_exe_bytes(exe, self.f.packages, self.f.legal)

    def fails(self, exe, needle):
        with self.assertRaises(rn.Failure) as cm:
            self.ok(exe)
        self.assertIn(needle, str(cm.exception))
        return str(cm.exception)

    def replace(self, path, blob=None, drop=False, compressed=False):
        out = []
        for p, b, k, c in self.f.files():
            if p == path:
                if drop:
                    continue
                out.append((p, b if blob is None else blob, k, compressed))
            else:
                out.append((p, b, k, c))
        return out

    # valid ------------------------------------------------------------------------------
    def test_valid_exe_passes_and_counts_entries(self):
        r = self.ok(self.f.exe())
        self.assertEqual(r['legal'], 5)
        self.assertEqual(r['attributed'], 3)

    def test_valid_zip_is_deterministic_and_verifies(self):
        exe = self.f.exe()
        a, b = os.path.join(self.tmp, 'a.zip'), os.path.join(self.tmp, 'b.zip')
        rn.write_zip(exe, a, self.f.legal)
        rn.write_zip(exe, b, self.f.legal)
        self.assertEqual(open(a, 'rb').read(), open(b, 'rb').read())
        rn.verify_zip(a, self.f.packages, self.f.legal)
        names = zipfile.ZipFile(a).namelist()
        self.assertEqual(names[0], rn.EXE_NAME)
        self.assertIn('LICENSES/INDEX.txt', names)
        self.assertIn('LICENSES/inventory.json', names)

    def test_cli_exit_codes(self):
        exe = os.path.join(self.tmp, 'x.exe')
        open(exe, 'wb').write(self.f.exe())
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(rn.main(['verify-exe', exe, '--packages', self.f.packages, '--legal', self.f.legal]), 0)
            assets = os.path.join(self.tmp, 'project.assets.json')
            with open(assets, 'w') as f:
                json.dump({'packageFolders': {self.f.packages + os.sep: {}}}, f)
            self.assertEqual(rn.main(['verify-exe', exe, '--assets', assets, '--legal', self.f.legal]), 0)
            with open(assets, 'w') as f:
                json.dump({'packageFolders': {os.path.join(self.tmp, 'other') + os.sep: {}}}, f)
            self.assertEqual(rn.main(['verify-exe', exe, '--assets', assets, '--legal', self.f.legal]), 1)
            out = os.path.join(self.tmp, 'cli.zip')
            self.assertEqual(rn.main(['package', exe, out, '--packages', self.f.packages, '--legal', self.f.legal]), 0)
            self.assertEqual(rn.main(['verify-zip', out, '--packages', self.f.packages, '--legal', self.f.legal]), 0)
            open(exe, 'wb').write(self.f.exe(self.replace('legal/INDEX.txt', drop=True)))
            os.remove(out)
            self.assertEqual(rn.main(['package', exe, out, '--packages', self.f.packages, '--legal', self.f.legal]), 1)
            self.assertFalse(os.path.exists(out), 'a failed check must not leave a release ZIP')
            self.assertEqual(rn.main(['verify-exe', exe, '--packages', self.f.packages, '--legal', self.f.legal]), 1)

    # missing / truncated / changed notices ----------------------------------------------
    def test_exe_without_notices_fails(self):
        files = [x for x in self.f.files() if not x[0].startswith('legal/')]
        msg = self.fails(self.f.exe(files), 'lacks recipient notice legal/INDEX.txt')
        self.assertIn('legal/inventory.json', msg)

    def test_missing_single_notice_fails(self):
        self.fails(self.f.exe(self.replace('legal/rt-TPN.txt', drop=True)), 'lacks recipient notice legal/rt-TPN.txt')

    def test_truncated_notice_in_exe_fails(self):
        self.fails(self.f.exe(self.replace('legal/lib-LICENSE.txt', self.f.notices['lib-LICENSE.txt'][:40])),
                   'legal/lib-LICENSE.txt is truncated or changed')

    def test_compressed_notice_fails(self):
        self.fails(self.f.exe(self.replace('legal/lib-LICENSE.txt', compressed=True)), 'compressed')

    def test_unexpected_legal_entry_fails(self):
        files = self.f.files() + [('legal/extra.txt', b'x', 0, False)]
        self.fails(self.f.exe(files), 'unexpected legal entry legal/extra.txt')

    def test_corrupted_repository_notice_fails(self):
        self.f.write(self.f.legal, 'notices/lib-LICENSE.txt', b'Apache licence text of Fake.Lib\n')
        self.fails(self.f.exe(), 'notice text changed or truncated: lib-LICENSE.txt')

    def test_deleted_repository_notice_fails(self):
        os.remove(os.path.join(self.f.legal, 'notices', 'rt-TPN.txt'))
        self.fails(self.f.exe(), 'inventory notice missing')

    def test_index_must_name_every_notice_and_version(self):
        self.f.notices['INDEX.txt'] = b'Fake runtime -> rt-LICENSE.txt rt-TPN.txt\n'
        self.f.write(self.f.legal, 'notices/INDEX.txt', self.f.notices['INDEX.txt'])
        self.f.inventory['notices']['INDEX.txt']['sha256'] = sha(self.f.notices['INDEX.txt'])
        self.f.save_inventory()
        msg = self.fails(self.f.exe(), 'INDEX.txt does not mention lib-LICENSE.txt')
        self.assertIn('INDEX.txt does not mention version 1.2.3', msg)

    # dependency / runtime inventory drift ------------------------------------------------
    def test_unresolved_new_dependency_fails(self):
        t = self.f.deps['targets']['.NETCoreApp,Version=v8.0/win-x64']
        t['New.Dep/2.0.0'] = {'runtime': {'lib/net8.0/New.Dep.dll': {}}}
        files = self.f.files() + [('New.Dep.dll', b'MZ new', 1, False)]
        msg = self.fails(self.f.exe(files), 'shipped dependency New.Dep/2.0.0 has no inventory entry')
        self.assertIn('New.Dep.dll is not attributable', msg)

    def test_package_version_drift_fails(self):
        t = self.f.deps['targets']['.NETCoreApp,Version=v8.0/win-x64']
        t['Fake.Lib/1.2.4'] = t.pop(PKG)
        msg = self.fails(self.f.exe(), 'shipped Fake.Lib/1.2.4 but inventory covers Fake.Lib/1.2.3')
        self.assertIn('stale inventory: Fake.Lib/1.2.3', msg)

    def test_runtime_patch_drift_fails(self):
        t = self.f.deps['targets']['.NETCoreApp,Version=v8.0/win-x64']
        t['runtimepack.Fake.NETCore.App.Runtime.win-x64/8.0.25'] = t.pop(RT)
        self.f.runtimeconfig['runtimeOptions']['includedFrameworks'][0]['version'] = '8.0.25'
        msg = self.fails(self.f.exe(), 'inventory covers runtimepack.Fake.NETCore.App.Runtime.win-x64/8.0.24')
        self.assertIn('runtimeconfig includes Fake.NETCore.App 8.0.25', msg)

    def test_restored_runtime_pack_notice_drift_fails(self):
        self.f.write(self.f.rt_dir, 'THIRD-PARTY-NOTICES.TXT', b'newer notices\r\n')
        self.fails(self.f.exe(), 'restored pack THIRD-PARTY-NOTICES.TXT differs from delivered rt-TPN.txt')

    def test_restored_package_hash_drift_fails(self):
        self.f.write(self.f.lib_dir, 'fake.lib.1.2.3.nupkg', b'other bytes')
        self.fails(self.f.exe(), 'restored package Fake.Lib/1.2.3 sha256')

    def test_listed_graph_only_package_passes_and_unlisted_fails(self):
        t = self.f.deps['targets']['.NETCoreApp,Version=v8.0/win-x64']
        t['Build.Only/1.0.0'] = {}
        self.fails(self.f.exe(), 'graph entry Build.Only/1.0.0 ships no files but is not listed')
        self.f.inventory['graphOnly'] = {'Build.Only': 'build-time package, no shipped asset'}
        self.f.save_inventory()
        self.ok(self.f.exe())

    def test_graph_only_package_that_ships_files_fails(self):
        self.f.inventory['graphOnly'] = {'Build.Only': 'build-time package'}
        self.f.save_inventory()
        t = self.f.deps['targets']['.NETCoreApp,Version=v8.0/win-x64']
        t['Build.Only/1.0.0'] = {'runtime': {'lib/net8.0/Build.Only.dll': {}}}
        self.fails(self.f.exe(self.f.files() + [('Build.Only.dll', b'MZ', 1, False)]), 'graph-only package Build.Only/1.0.0 now ships files')

    def test_graph_only_without_reason_fails(self):
        self.f.inventory['graphOnly'] = {'Build.Only': ''}
        self.f.save_inventory()
        self.fails(self.f.exe(), 'graphOnly Build.Only needs a reason')

    def test_stale_inventory_component_fails(self):
        self.f.inventory['components'].append(dict(self.f.inventory['components'][1], deps='Gone.Lib/9.0.0'))
        self.f.save_inventory()
        self.fails(self.f.exe(), 'stale inventory: Gone.Lib/9.0.0')

    def test_component_without_notice_fails(self):
        self.f.inventory['components'][1]['notices'] = []
        self.f.save_inventory()
        self.fails(self.f.exe(), 'component without notices: Fake.Lib/1.2.3')

    def test_bundle_entry_bytes_must_match_restored_package(self):
        self.fails(self.f.exe(self.replace('Fake.Lib.dll', b'MZ patched')), 'Fake.Lib.dll differs from the restored package')

    def test_foreign_bundle_entry_fails(self):
        files = self.f.files() + [('sqlcipher.dll', b'MZ', 2, False)]
        self.fails(self.f.exe(files), 'sqlcipher.dll is not attributable')

    def test_different_single_file_host_build_fails(self):
        host = b'MZ' + '8,0,9999,2 @Commit: x'.encode('utf-16-le') + b'\0' * 64
        self.fails(self.f.exe(host=host), 'single-file host is not build')

    def test_not_a_bundle_fails(self):
        with self.assertRaises(rn.Failure):
            self.ok(b'MZ plain exe')

    # ZIP tampering ------------------------------------------------------------------------
    def make_zip(self, mutate):
        good = os.path.join(self.tmp, 'good.zip')
        rn.write_zip(self.f.exe(), good, self.f.legal)
        bad = os.path.join(self.tmp, 'bad.zip')
        with zipfile.ZipFile(good) as zi, zipfile.ZipFile(bad, 'w') as zo:
            for i in zi.infolist():
                b = mutate(i.filename, zi.read(i.filename))
                if b is not None:
                    zo.writestr(i, b)
            extra = mutate(None, None)
            if extra:
                zo.writestr(*extra)
        return bad

    def zip_fails(self, path, needle):
        with self.assertRaises(rn.Failure) as cm:
            rn.verify_zip(path, self.f.packages, self.f.legal)
        self.assertIn(needle, str(cm.exception))

    def test_zip_missing_notice_fails(self):
        self.zip_fails(self.make_zip(lambda n, b: None if n == 'LICENSES/rt-TPN.txt' else b), 'ZIP lacks LICENSES/rt-TPN.txt')

    def test_zip_exe_alone_fails(self):
        self.zip_fails(self.make_zip(lambda n, b: b if n in (None, rn.EXE_NAME) else None), 'ZIP lacks LICENSES/INDEX.txt')

    def test_zip_truncated_notice_fails(self):
        self.zip_fails(self.make_zip(lambda n, b: b[:10] if n == 'LICENSES/lib-LICENSE.txt' else b),
                       'ZIP LICENSES/lib-LICENSE.txt is truncated or changed')

    def test_zip_extra_member_fails(self):
        self.zip_fails(self.make_zip(lambda n, b: ('README.txt', b'x') if n is None else b), 'unexpected member README.txt')

    def test_zip_with_exe_lacking_notices_fails(self):
        bare = self.f.exe([x for x in self.f.files() if not x[0].startswith('legal/')])
        self.zip_fails(self.make_zip(lambda n, b: bare if n == rn.EXE_NAME else b), 'ZIP Uma.Agent.Windows.exe lacks recipient notice')


class RealInventoryTests(unittest.TestCase):
    def test_repository_legal_inventory_is_consistent(self):
        inv, _, texts, problems = rn.load_legal(rn.DEFAULT_LEGAL)
        self.assertEqual(problems, [])
        deps = {c['deps'] for c in inv['components']}
        for want in ('runtimepack.Microsoft.NETCore.App.Runtime.win-x64/8.0.24',
                     'runtimepack.Microsoft.WindowsDesktop.App.Runtime.win-x64/8.0.24',
                     'runtimepack.Microsoft.Windows.SDK.NET.Ref/10.0.19041.57',
                     'SharpZipLib/1.4.2', 'Serilog/4.3.0', 'Serilog.Sinks.File/6.0.0',
                     'SQLitePCLRaw.lib.e_sqlite3/2.1.12', 'Microsoft.Data.Sqlite.Core/10.0.3'):
            self.assertIn(want, deps)
        index = texts['INDEX.txt'].decode()
        self.assertIn('2000-2018', index)  # T16b N7: licence file date ...
        self.assertIn('2000-2022', index)  # ... and package metadata date, both cited
        self.assertIn('does not include SQLCipher or OpenSSL', index)


if __name__ == '__main__':
    unittest.main(verbosity=2)
