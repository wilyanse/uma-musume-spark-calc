#!/usr/bin/env python3
"""Deterministic archive-source and framework-set regressions for T19 fix2 (Sol)."""
import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

import package_provenance as pp
import recipient_notices as rn
from test_recipient_notices import Fixture


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='t19-r2-archive-')
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'pack.nupkg'
        self.repository = {'url': 'https://github.com/dotnet/runtime', 'commit': '1' * 40}
        self.source = self.repository['url'] + '/tree/' + self.repository['commit']
        self.make('<repository type="git" url="%s" commit="%s" />' %
                  (self.repository['url'], self.repository['commit']))

    def make(self, repository_xml):
        with zipfile.ZipFile(self.path, 'w') as z:
            z.writestr('pack.nuspec', '<package xmlns="http://schemas.microsoft.com/packaging/2013/05/nuspec.xsd"><metadata>' + repository_xml + '</metadata></package>')
        self.digest = hashlib.sha256(self.path.read_bytes()).hexdigest()

    def check(self, repository=None, source=None, digest=None):
        return pp.check_archive(self.path, digest or self.digest,
                                self.repository if repository is None else repository,
                                self.source if source is None else source)

    def test_exact_archive_commit(self):
        self.assertEqual(self.check()['commit'], '1' * 40)

    def test_wrong_inventory_commit_even_with_matching_source(self):
        bad = dict(self.repository, commit='2' * 40)
        with self.assertRaisesRegex(rn.Failure, 'nuspec repository differs'):
            self.check(bad, bad['url'] + '/tree/' + bad['commit'])

    def test_wrong_source_string(self):
        with self.assertRaisesRegex(rn.Failure, 'source does not identify'):
            self.check(source=self.source.replace('1' * 40, '2' * 40))

    def test_wrong_repository_url(self):
        bad = dict(self.repository, url='https://github.com/other/runtime')
        with self.assertRaisesRegex(rn.Failure, 'nuspec repository differs'):
            self.check(bad, bad['url'] + '/tree/' + bad['commit'])

    def test_archive_hash_must_match_before_xml(self):
        with self.assertRaisesRegex(rn.Failure, 'sha256 differs'):
            self.check(digest='0' * 64)

    def test_missing_archive_repository(self):
        self.make('')
        with self.assertRaisesRegex(rn.Failure, 'exactly one nuspec repository'):
            self.check()

    def test_duplicate_archive_repository(self):
        self.make('<repository /><repository />')
        with self.assertRaisesRegex(rn.Failure, 'exactly one nuspec repository'):
            self.check()

    def test_required_record_cannot_omit_repository(self):
        with self.assertRaisesRegex(rn.Failure, 'required repository missing'):
            pp.check_record(self.temp.name, 'Microsoft.NETCore.App.Host.win-x64/8.0.31', {})


class FrameworkTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='t19-r2-framework-')
        self.addCleanup(self.temp.cleanup)
        self.f = Fixture(self.temp.name)

    def check(self, frameworks):
        self.f.runtimeconfig['runtimeOptions']['includedFrameworks'] = frameworks
        return rn.verify_exe_bytes(self.f.exe(), self.f.packages, self.f.legal)

    def test_valid_set(self):
        self.assertGreater(self.check([{'name': 'Fake.NETCore.App', 'version': '8.0.24'}])['entries'], 0)

    def test_duplicate_framework_name(self):
        fw = {'name': 'Fake.NETCore.App', 'version': '8.0.24'}
        with self.assertRaisesRegex(rn.Failure, 'duplicate includedFramework name'):
            self.check([fw, copy.deepcopy(fw)])

    def test_missing_expected_framework(self):
        with self.assertRaisesRegex(rn.Failure, 'differs from actual framework runtime packs'):
            self.check([{'name': 'Microsoft.WindowsDesktop.App', 'version': '8.0.24'}])

    def test_extra_framework(self):
        with self.assertRaisesRegex(rn.Failure, 'differs from actual framework runtime packs'):
            self.check([{'name': 'Fake.NETCore.App', 'version': '8.0.24'},
                        {'name': 'Microsoft.WindowsDesktop.App', 'version': '8.0.24'}])

    def test_wrong_version(self):
        with self.assertRaisesRegex(rn.Failure, 'differs from actual framework runtime packs'):
            self.check([{'name': 'Fake.NETCore.App', 'version': '8.0.31'}])


if __name__ == '__main__':
    unittest.main()
