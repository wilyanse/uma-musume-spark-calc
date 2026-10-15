#!/usr/bin/env python3
"""Verify repository provenance INSIDE hash-pinned runtime/host archives, not cache metadata."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

from verification_safety import Failure, require

REQUIRED = {
    'Microsoft.NETCore.App.Runtime.win-x64': 'https://github.com/dotnet/runtime',
    'Microsoft.NETCore.App.Host.win-x64': 'https://github.com/dotnet/runtime',
    'Microsoft.WindowsDesktop.App.Runtime.win-x64': 'https://github.com/dotnet/windowsdesktop',
}


def check_archive(path, expected_hash, repository, source):
    require(isinstance(repository, dict), 'archive provenance: missing inventory repository')
    require(isinstance(repository.get('url'), str) and
            re.fullmatch('[0-9a-f]{40}', str(repository.get('commit', ''))),
            'archive provenance: invalid inventory repository')
    require(repository['commit'] in source and repository['url'] in source,
            'archive provenance: source does not identify inventory repository URL/commit')
    require(path.stat().st_size <= 1024 * 1024 * 1024, 'archive provenance: archive exceeds bound')
    data = path.read_bytes()
    require(hashlib.sha256(data).hexdigest() == expected_hash, 'archive provenance: nupkg sha256 differs')
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            require(len(z.infolist()) <= 10000, 'archive provenance: member count exceeds bound')
            members = [i for i in z.infolist() if i.filename.endswith('.nuspec')]
            require(len(members) == 1 and members[0].file_size <= 1024 * 1024,
                    'archive provenance: need exactly one bounded nuspec')
            xml = z.read(members[0])
            require(b'<!DOCTYPE' not in xml.upper() and b'<!ENTITY' not in xml.upper(),
                    'archive provenance: XML declarations forbidden')
            repos = [e.attrib for e in ET.fromstring(xml).iter() if e.tag.split('}')[-1] == 'repository']
            require(len(repos) == 1, 'archive provenance: need exactly one nuspec repository')
            observed = repos[0]
    except (zipfile.BadZipFile, ET.ParseError, RuntimeError) as e:
        raise Failure('archive provenance: unreadable nupkg/nuspec: ' + str(e)) from e
    require(observed.get('type') == 'git' and observed.get('url') == repository['url'] and
            observed.get('commit') == repository['commit'],
            'archive provenance: nuspec repository differs: observed %r; inventory %r' % (observed, repository))
    return observed


def check_record(packages, key, record):
    name, version = key.removeprefix('runtimepack.').split('/')
    if name not in REQUIRED:
        return None
    repository = record.get('repository')
    require(isinstance(repository, dict) and repository.get('url') == REQUIRED[name],
            'archive provenance: required repository missing/wrong for ' + name)
    path = Path(packages) / name.lower() / version / (name.lower() + '.' + version + '.nupkg')
    return check_archive(path, record['nupkgSha256'], repository, record.get('source', ''))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--inventory', type=Path, default=Path(__file__).parent.parent / 'inventory.json')
    ap.add_argument('--packages', required=True)
    a = ap.parse_args()
    try:
        inv = json.loads(a.inventory.read_bytes())
        records = [(c['deps'], c) for c in inv['components']]
        h = inv['singleFileHost']; records.append((h['package'] + '/' + h['version'], h))
        count = 0
        for key, record in records:
            observed = check_record(a.packages, key, record)
            if observed is not None:
                count += 1
                print('%s: exact hash-pinned archive repository %r' % (key, observed))
        require(count == len(REQUIRED), 'archive provenance: required archive set incomplete')
        print('archive provenance: %d required archives verified' % count)
    except (Failure, OSError, ValueError, KeyError) as e:
        print('ARCHIVE PROVENANCE FAILED: ' + str(e), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
