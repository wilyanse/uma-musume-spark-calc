#!/usr/bin/env python3
"""T19 r1 deterministic parser, host, licensing, rendering and real Git checkout regressions."""
import contextlib
import copy
import io
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest

import recipient_notices as rn
from test_recipient_notices import Fixture, build_bundle, synthetic_host
from verification_safety import json_object, verify_host
from windows_licensing import check, REQUIRED, LIBRARY


class BoundsTests(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory()
        self.addCleanup(self.t.cleanup)
        self.f = Fixture(self.t.name)

    def rejected(self, data, text):
        with self.assertRaisesRegex(rn.Failure, text):
            rn.verify_exe_bytes(data, self.f.packages, self.f.legal)

    def test_inventory_host_identity_is_not_invented(self):
        self.f.inventory['singleFileHost']['productVersion'] = 'not a real host identity'
        self.f.save_inventory()
        self.rejected(self.f.exe(), 'inventory host ProductVersion differs')

    def test_host_code_tamper(self):
        b = bytearray(self.f.exe()); b[520] ^= 1
        self.rejected(bytes(b), 'stable PE section .text')

    def test_host_version_tamper(self):
        b = bytearray(self.f.exe()); b[1120] ^= 1
        self.rejected(bytes(b), 'host PE resource')

    def test_header_near_eof(self):
        b = bytearray(self.f.exe()); p = b.find(rn.SIGNATURE)
        struct.pack_into('<q', b, p - 8, len(b) - 3)
        self.rejected(bytes(b), 'header offset out of range')

    def test_negative_and_huge_entry_count(self):
        for count in (-1, 10001):
            b = bytearray(self.f.exe()); i = b.find(rn.SIGNATURE)
            p = struct.unpack_from('<q', b, i - 8)[0]
            struct.pack_into('<i', b, p + 8, count)
            self.rejected(bytes(b), 'entry count out of bounds')

    def test_truncated_manifest(self):
        self.rejected(self.f.exe()[:-3], 'bundle string length out of bounds')

    def test_invalid_utf8(self):
        fs = self.f.files(); b = bytearray(build_bundle(fs)); p = b.rfind(b'legal/inventory.json')
        b[p] = 255
        self.rejected(bytes(b), 'invalid UTF-8')

    def test_unbounded_varint(self):
        b = bytearray(self.f.exe()); i = b.find(rn.SIGNATURE); p = struct.unpack_from('<q', b, i - 8)[0]
        b[p + 12:p + 17] = b'\xff' * 5
        self.rejected(bytes(b), 'invalid bundle string length')

    def test_invalid_json_and_schema(self):
        for suffix in ('deps.json', 'runtimeconfig.json'):
            fs = [(n, b'?' + b[1:] if n.endswith(suffix) else b, k, c) for n, b, k, c in self.f.files()]
            self.rejected(build_bundle(fs), 'invalid JSON')
        self.f.inventory['components'][0].pop('deps'); self.f.save_inventory()
        self.rejected(self.f.exe(), 'lacks/invalid deps')

    def test_missing_deps(self):
        self.rejected(build_bundle([x for x in self.f.files() if not x[0].endswith('.deps.json')]), 'exactly one deps.json')

    def test_inventory_unsafe_notice_path(self):
        self.f.inventory['notices']['../escape.txt'] = {'source': 'test', 'sha256': '0' * 64}
        self.f.save_inventory()
        self.rejected(self.f.exe(), 'invalid notice path')

    def test_duplicate_json_key(self):
        with self.assertRaisesRegex(rn.Failure, 'duplicate JSON key'):
            json_object(b'{"x":1,"x":2}', 'test')

    def test_wrong_json_type(self):
        for blob in (b'[]', b'null', b'"string"'):
            with self.assertRaisesRegex(rn.Failure, 'JSON must be an object'):
                json_object(blob, 'test')

    def test_cli_parse_failure_is_diagnostic_not_traceback(self):
        p = Path(self.t.name) / 'bad.exe'; p.write_bytes(self.f.exe()[:-3])
        out = io.StringIO()
        with contextlib.redirect_stderr(out):
            rc = rn.main(['verify-exe', str(p), '--packages', self.f.packages, '--legal', self.f.legal])
        self.assertEqual(rc, 1)
        self.assertIn('RECIPIENT NOTICE CHECK FAILED', out.getvalue())
        self.assertNotIn('Traceback', out.getvalue())


class LicenceTests(unittest.TestCase):
    def setUp(self):
        self.inv, _, self.texts, problems = rn.load_legal(rn.DEFAULT_LEGAL)
        self.assertEqual(problems, [])

    def test_all_named_native_licences(self):
        check(self.inv, self.texts, REQUIRED)

    def test_mapping_omitted_or_mislabelled(self):
        for n in REQUIRED:
            for value in (None, 'dotnet-runtime-8.0.31-LICENSE.TXT'):
                inv = copy.deepcopy(self.inv)
                if value is None: del inv['windowsLicensing']['native'][n]
                else: inv['windowsLicensing']['native'][n] = value
                with self.assertRaisesRegex(rn.Failure, 'native licence mappings'):
                    check(inv, self.texts)

    def test_singlefile_licence_and_human_gate_required(self):
        for key in ('singleFileRuntime', 'publicationGate'):
            inv = copy.deepcopy(self.inv); del inv['windowsLicensing'][key]
            with self.assertRaises(rn.Failure): check(inv, self.texts)

    def test_native_actual_bundle_required(self):
        with self.assertRaisesRegex(rn.Failure, 'WPF native absent'):
            check(self.inv, self.texts, {})

    def test_runtime_mit_only_is_rejected(self):
        inv = copy.deepcopy(self.inv); inv['components'][0]['licence'] = 'MIT'
        with self.assertRaisesRegex(rn.Failure, 'mislabelled'): check(inv, self.texts)

    def test_sdk_render_byte_reproducible(self):
        from render_sdk_license import render
        rtf = self.texts['Microsoft.Windows.SDK.NET.Ref-10.0.19041.57-LICENSE.rtf']
        self.assertEqual(render(rtf), self.texts['Windows-SDK-LICENSE-derived.txt'])
        self.assertIn(b'MICROSOFT SOFTWARE LICENSE TERMS', render(rtf))
        self.assertIn(b'original RTF is authoritative', render(rtf))


class GitCheckoutTests(unittest.TestCase):
    def test_real_autocrlf_checkout_and_negative_without_attributes(self):
        """Commit legal bytes only in a disposable repo; clone with real Git autocrlf=true.

        Negative removes only attributes, not notice text/hash. Never changes repo/global config.
        """
        root = Path(rn.DEFAULT_LEGAL).parents[1]
        with tempfile.TemporaryDirectory(prefix='t19-git-') as td:
            src = Path(td) / 'source'; src.mkdir()
            shutil.copytree(root / 'agent/legal', src / 'agent/legal', ignore=shutil.ignore_patterns('__pycache__'))
            shutil.copyfile(root / '.gitattributes', src / '.gitattributes')
            def git(*args, cwd=src):
                return subprocess.check_output(['git', '-c', 'core.autocrlf=false', '-c', 'user.name=T19 test',
                                                '-c', 'user.email=t19-test@example.invalid', *args], cwd=cwd, stderr=subprocess.STDOUT)
            git('init'); git('add', '.'); git('commit', '-m', 'verbatim legal regression')
            for attributes, expected in ((True, 0), (False, 1)):
                if not attributes:
                    git('rm', '.gitattributes'); git('commit', '-m', 'negative: no byte attributes')
                dst = Path(td) / ('good' if attributes else 'bad')
                subprocess.check_output(['git', '-c', 'core.autocrlf=true', 'clone', '--no-local', str(src), str(dst)], stderr=subprocess.STDOUT)
                p = subprocess.run([sys.executable, '-B', str(dst / 'agent/legal/tools/recipient_notices.py'), 'check-legal'],
                                   capture_output=True, text=True)
                self.assertEqual(p.returncode, expected, p.stdout + p.stderr)
                if not attributes: self.assertIn('notice text changed or truncated', p.stderr)
                else:
                    for n, b in self.texts_for_checkout().items():
                        self.assertEqual((dst / 'agent/legal/notices' / n).read_bytes(), b)

    @staticmethod
    def texts_for_checkout():
        return rn.load_legal(rn.DEFAULT_LEGAL)[2]


if __name__ == '__main__':
    unittest.main(verbosity=2)
