#!/usr/bin/env python3
"""T19: verify and package third-party licence/NOTICE delivery for the win-x64 single-file agent.

Stdlib only (Python >= 3.9). Commands:

  verify-exe EXE (--packages DIR | --assets obj/project.assets.json) [--legal DIR]
      Fail unless the published single-file EXE:
        * embeds exactly the inventory's notice files (plus inventory.json) under legal/,
          uncompressed and byte-identical to agent/legal (and to the inventory SHA-256);
        * has a deps.json runtime graph whose libraries are exactly the inventory's
          components plus first-party projects, at the exact versions (runtime packs too);
        * has runtimeconfig includedFrameworks equal to the runtime-pack versions;
        * contains only bundle entries attributable to a byte-identical file in the actually
          restored package/runtime pack (NuGet global-packages DIR), first-party output,
          app data or legal/;
        * was produced by the inventory's single-file host build, and every restored
          package/pack .nupkg has the inventory SHA-256 and every pack licence text that
          is redistributed equals the copy delivered here.
  package EXE OUT.zip --packages DIR [--legal DIR]
      verify-exe, then write a deterministic ZIP (Uma.Agent.Windows.exe + LICENSES/*),
      then verify-zip.
  verify-zip ZIP --packages DIR [--legal DIR]
      Fail unless the ZIP holds exactly the EXE and LICENSES/<every notice + inventory.json>,
      byte-identical, and the contained EXE passes verify-exe.
  check-legal [--legal DIR]
      Inventory self-consistency only (no EXE): every notice file hash/reference.
  report EXE
      Print the published deps.json graph (use it to update agent/legal after a dependency/runtime change).

Graph entries that ship no runtime/native/resource asset are accepted only when their package id is in
inventory graphOnly (with a reason); any such package that starts shipping files fails.

Exit status 0 = pass, 1 = verification failure (all problems printed), 2 = usage error.
This inspects bytes. It does not run Windows code or decide legal sufficiency.
"""
import argparse
import hashlib
import io
import json
import os
import re
import struct
import sys
import tempfile
import zipfile

SIGNATURE = bytes.fromhex('8b1202b96a612038727b930214d7a03213f5b9e6efae3318ee3b2dce24b36aae')
DEFAULT_LEGAL = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
EXE_NAME = 'Uma.Agent.Windows.exe'
ZIP_DIR = 'LICENSES/'
ZIP_TIME = (1980, 1, 1, 0, 0, 0)
ASSET_SECTIONS = ('runtime', 'native', 'resources')
PACK_PREFIXES = ('runtimes/win-x64/lib/net8.0/', 'runtimes/win-x64/native/', 'lib/net8.0/')


from verification_safety import (Failure, json_object, path_ok, require, validate_inventory,
                                 validate_deps, validate_rc, verify_host)
from render_sdk_license import render as render_sdk
from windows_licensing import check as check_windows_licensing
from package_provenance import check_record as check_package_provenance


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def read(path):
    n = os.path.getsize(path)
    require(n <= 1024 * 1024 * 1024, 'file exceeds 1 GiB bound: ' + str(path))
    with open(path, 'rb') as f:
        b = f.read(n + 1)
    require(len(b) == n, 'file changed while reading: ' + str(path))
    return b


# ---------------------------------------------------------------------------------------------
# legal directory / inventory


def load_legal(legal_dir):
    """Return (inventory, inventory_bytes, {notice name: bytes}) and a list of problems."""
    problems = []
    inv_path = os.path.join(legal_dir, 'inventory.json')
    try:
        inv_bytes = read(inv_path)
        inv = json_object(inv_bytes, 'inventory.json')
        validate_inventory(inv)
    except (OSError, ValueError) as e:
        raise Failure('cannot read inventory %s: %s' % (inv_path, e))
    notices_dir = os.path.join(legal_dir, 'notices')
    texts = {}
    for name, meta in sorted(inv.get('notices', {}).items()):
        path = os.path.join(notices_dir, name)
        if not os.path.isfile(path):
            problems.append('inventory notice missing from %s: %s' % (notices_dir, name))
            continue
        b = read(path)
        if sha256(b) != meta.get('sha256'):
            problems.append('notice text changed or truncated: %s sha256 %s, inventory %s' % (name, sha256(b), meta.get('sha256')))
        if not b.strip():
            problems.append('notice text is empty: %s' % name)
        texts[name] = b
    if os.path.isdir(notices_dir):
        for name in sorted(os.listdir(notices_dir)):
            if name not in inv.get('notices', {}):
                problems.append('unlisted file in %s: %s' % (notices_dir, name))
    if 'INDEX.txt' not in inv.get('notices', {}):
        problems.append('inventory must list the recipient index INDEX.txt')
    referenced = set()
    for c in inv.get('components', []):
        if not c.get('notices'):
            problems.append('component without notices: %s' % c.get('deps'))
        for n in c.get('notices', []):
            referenced.add(n)
            if n not in inv.get('notices', {}):
                problems.append('component %s references unknown notice %s' % (c.get('deps'), n))
        for field in ('deps', 'kind', 'nupkgSha256', 'licence', 'copyright', 'source'):
            if not c.get(field):
                problems.append('component %s lacks %s' % (c.get('deps'), field))
        for n in c.get('packTexts', {}).values():
            if n not in inv.get('notices', {}):
                problems.append('component %s pack text maps to unknown notice %s' % (c.get('deps'), n))
    for name, reason in sorted(inv.get('graphOnly', {}).items()):
        if not isinstance(reason, str) or not reason.strip():
            problems.append('graphOnly %s needs a reason' % name)
    host = inv.get('singleFileHost', {})
    for n in host.get('packTexts', {}).values():
        referenced.add(n)
        if n not in inv.get('notices', {}):
            problems.append('single-file host pack text maps to unknown notice %s' % n)
    for n in sorted(set(inv.get('notices', {})) - referenced - {'INDEX.txt'}):
        problems.append('notice not referenced by any component: %s' % n)
    index = texts.get('INDEX.txt', b'').decode('utf-8', 'replace')
    for n in inv.get('notices', {}):
        if n != 'INDEX.txt' and n not in index:
            problems.append('INDEX.txt does not mention %s' % n)
    for c in inv.get('components', []):
        name, _, version = c['deps'].partition('/')
        if version not in index:
            problems.append('INDEX.txt does not mention version %s of %s' % (version, name))
    try:
        check_windows_licensing(inv, texts)
        derived = 'Windows-SDK-LICENSE-derived.txt'
        rtf = 'Microsoft.Windows.SDK.NET.Ref-10.0.19041.57-LICENSE.rtf'
        if derived in texts:
            require(rtf in texts, 'SDK derived rendering lacks original RTF')
            require(render_sdk(texts[rtf]) == texts[derived], 'SDK derived rendering differs from reproducible original RTF render')
    except Failure as e:
        problems.append(str(e))
    return inv, inv_bytes, texts, problems


# ---------------------------------------------------------------------------------------------
# .NET single-file bundle (v6) parsing


def parse_bundle(data):
    require(len(data) <= 1024 * 1024 * 1024, 'EXE exceeds 1 GiB bound')
    i = data.find(SIGNATURE)
    require(i >= 8, 'not a .NET single-file bundle (signature missing)')
    p = struct.unpack_from('<q', data, i - 8)[0]
    require(0 < p <= len(data) - 12, 'bundle header offset out of range')
    header = p

    def take(fmt):
        nonlocal p
        size = struct.calcsize(fmt)
        require(0 <= p <= len(data) - size, 'truncated bundle header/entry at offset %d' % p)
        result = struct.unpack_from(fmt, data, p)
        p += size
        return result

    major, minor, count = take('<IIi')
    require(major == 6 and minor == 0, 'unsupported bundle version %d.%d' % (major, minor))
    require(0 < count <= 10000, 'bundle entry count out of bounds: %d' % count)

    def text():
        nonlocal p
        n = 0
        for shift in range(0, 35, 7):
            b = take('<B')[0]
            n |= (b & 0x7f) << shift
            if b < 0x80:
                break
        else:
            raise Failure('invalid bundle string length')
        require(n <= 4096 and p <= len(data) - n, 'bundle string length out of bounds')
        try:
            s = data[p:p + n].decode('utf-8')
        except UnicodeError as e:
            raise Failure('invalid UTF-8 bundle string at %d' % p) from e
        p += n
        return s

    text()  # bundle id
    take('<qqqqQ')  # deps/runtimeconfig offsets and sizes, flags
    entries = []
    for _ in range(count):
        offset, size, csize, kind = take('<qqqB')
        path = text().replace('\\', '/')
        require(path_ok(path), 'invalid bundle entry path: ' + path)
        require(0 <= offset <= header and 0 <= size <= header and 0 <= csize <= header and
                offset + (csize or size) <= header, 'bundle entry out of range: ' + path)
        entries.append({'path': path, 'offset': offset, 'size': size, 'csize': csize, 'kind': kind})
    return entries


def entry_bytes(data, e):
    if e['csize']:
        raise Failure('bundle entry is compressed (recipients and this check need plain bytes): %s' % e['path'])
    return data[e['offset']:e['offset'] + e['size']]


# ---------------------------------------------------------------------------------------------
# EXE verification


def runtime_list(pack_dir):
    path = os.path.join(pack_dir, 'data', 'RuntimeList.xml')
    if not os.path.isfile(path):
        return None
    files = {}
    for m in re.finditer(r'Path="([^"]+)"', read(path).decode('utf-8-sig')):
        rel = m.group(1)
        short = rel
        for pre in PACK_PREFIXES:
            if rel.startswith(pre):
                short = rel[len(pre):]
                break
        files.setdefault(short, []).append(os.path.join(pack_dir, *rel.split('/')))
    return files


def pack_dir_for(packages, deps_key):
    name, _, version = deps_key.partition('/')
    if name.startswith('runtimepack.'):
        name = name[len('runtimepack.'):]
    return os.path.join(packages, name.lower(), version)


def nupkg_check(problems, packages, deps_key, expected):
    d = pack_dir_for(packages, deps_key)
    name, _, version = deps_key.partition('/')
    name = name[len('runtimepack.'):] if name.startswith('runtimepack.') else name
    nupkg = os.path.join(d, '%s.%s.nupkg' % (name.lower(), version))
    if not os.path.isfile(nupkg):
        problems.append('restored package not found for %s: %s' % (deps_key, nupkg))
        return d
    got = sha256(read(nupkg))
    if got != expected:
        problems.append('restored package %s sha256 %s differs from inventory %s' % (deps_key, got, expected))
    return d


def pack_texts_check(problems, pack_dir, deps_key, mapping, texts):
    for src, notice in sorted(mapping.items()):
        path = os.path.join(pack_dir, src)
        if not os.path.isfile(path):
            problems.append('%s: pack licence text %s missing in %s' % (deps_key, src, pack_dir))
        elif notice in texts and read(path) != texts[notice]:
            problems.append('%s: restored pack %s differs from delivered %s (runtime/licence drift)' % (deps_key, src, notice))


def verify_exe_bytes(data, packages, legal_dir, label='EXE'):
    inv, inv_bytes, texts, problems = load_legal(legal_dir)
    entries = parse_bundle(data)
    by_path = {}
    for e in entries:
        if e['path'] in by_path:
            problems.append('duplicate bundle entry %s' % e['path'])
        by_path[e['path']] = e

    check_windows_licensing(inv, texts, by_path)

    # 1. embedded legal texts
    expected_legal = {'legal/' + n: b for n, b in texts.items()}
    expected_legal['legal/inventory.json'] = inv_bytes
    for path, want in sorted(expected_legal.items()):
        e = by_path.get(path)
        if e is None:
            problems.append('%s lacks recipient notice %s' % (label, path))
            continue
        try:
            got = entry_bytes(data, e)
        except Failure as f:
            problems.append(str(f))
            continue
        if got != want:
            problems.append('%s notice %s is truncated or changed (sha256 %s, expected %s)' % (label, path, sha256(got), sha256(want)))
    for path in sorted(p for p in by_path if p.startswith('legal/') and p not in expected_legal):
        problems.append('%s has unexpected legal entry %s' % (label, path))

    # 2. deps.json graph vs inventory
    deps_name = [p for p in by_path if p.endswith('.deps.json')]
    if len(deps_name) != 1:
        raise Failure('%s must contain exactly one deps.json, found %d' % (label, len(deps_name)))
    deps = json_object(entry_bytes(data, by_path[deps_name[0]]), 'deps.json')
    validate_deps(deps)
    target = deps.get('runtimeTarget', {}).get('name')
    if target != inv.get('runtimeTarget'):
        problems.append('runtime target %s differs from inventory %s' % (target, inv.get('runtimeTarget')))
    libs = deps.get('targets', {}).get(target, {})
    components = {c['deps']: c for c in inv.get('components', [])}
    first_party = set(inv.get('firstParty', []))
    graph_only = inv.get('graphOnly', {})
    for key in sorted(libs):
        if key in first_party or key in components:
            continue
        if not any(libs[key].get(sec) for sec in ASSET_SECTIONS):
            if key.partition('/')[0] in graph_only:
                continue  # listed graph-only package: the publish ships no file from it
            problems.append('graph entry %s ships no files but is not listed in inventory graphOnly' % key)
            continue
        if key.partition('/')[0] in graph_only:
            problems.append('graph-only package %s now ships files; inventory it as a component' % key)
            continue
        name = key.partition('/')[0]
        near = [k for k in components if k.partition('/')[0] == name] + [k for k in first_party if k.partition('/')[0] == name]
        if near:
            problems.append('shipped %s but inventory covers %s (dependency/runtime version drift; update agent/legal)' % (key, ', '.join(near)))
        else:
            problems.append('shipped dependency %s has no inventory entry or notices' % key)
    for key in sorted(set(components) | first_party):
        if key not in libs:
            problems.append('stale inventory: %s is not in the published graph' % key)

    # 3. runtimeconfig includedFrameworks vs runtime packs
    rc_name = [p for p in by_path if p.endswith('.runtimeconfig.json')]
    if len(rc_name) == 1:
        rc = json_object(entry_bytes(data, by_path[rc_name[0]]), 'runtimeconfig.json')
        frameworks = validate_rc(rc)
        # Only framework runtime packs, never the Windows SDK projection runtimepack.
        suffix = '.Runtime.win-x64'
        packs = {k.partition('/')[0][len('runtimepack.'):-len(suffix)]: k.partition('/')[2]
                 for k in libs if k in components and k.startswith('runtimepack.') and
                 k.partition('/')[0].endswith(suffix)}
        if frameworks != packs:
            problems.append('runtimeconfig includedFrameworks differs from actual framework runtime packs: %r; expected %r' %
                            (frameworks, packs))
    else:
        problems.append('%s must contain exactly one runtimeconfig.json' % label)

    # 4. attribute every bundle entry to a byte-identical restored source
    sources = {}  # bundle path -> list of candidate files
    owner = {}
    for key, lib in libs.items():
        if key in first_party:
            for f in list(lib.get('runtime', {})) + list(lib.get('native', {})):
                owner[f.split('/')[-1]] = 'first-party'
            continue
        if key not in components:
            continue
        if key.startswith('runtimepack.'):
            d = pack_dir_for(packages, key)
            rl = runtime_list(d)
            if rl is None:
                problems.append('restored runtime pack for %s has no data/RuntimeList.xml in %s' % (key, d))
                continue
            for short, paths in rl.items():
                sources.setdefault(short, []).extend(paths)
        else:
            d = os.path.join(packages, *libs_path(deps, key).split('/'))
            for sec in ('runtime', 'native'):
                for f in lib.get(sec, {}):
                    sources.setdefault(f.split('/')[-1], []).append(os.path.join(d, *f.split('/')))
    app = inv.get('appEntries', {})
    data_re = re.compile(app.get('dataPattern', '^$'))
    attributed = 0
    for e in entries:
        path = e['path']
        if path.startswith('legal/') or path in app.get('exact', []) or data_re.match(path):
            continue
        if owner.get(path) == 'first-party':
            continue
        cands = sources.get(path)
        if not cands:
            problems.append('%s entry %s is not attributable to the inventory graph' % (label, path))
            continue
        try:
            blob = entry_bytes(data, e)
        except Failure as f:
            problems.append(str(f))
            continue
        if not any(os.path.isfile(c) and read(c) == blob for c in cands):
            problems.append('%s entry %s differs from the restored package file(s) %s' % (label, path, ', '.join(cands)))
        else:
            attributed += 1

    # 5. restored package identities and redistributed pack texts
    for key, c in sorted(components.items()):
        d = nupkg_check(problems, packages, key, c['nupkgSha256'])
        pack_texts_check(problems, d, key, c.get('packTexts', {}), texts)
        try:
            check_package_provenance(packages, key, c)
        except (Failure, OSError) as e:
            problems.append(key + ': ' + str(e))
    host = inv.get('singleFileHost', {})
    hkey = '%s/%s' % (host.get('package'), host.get('version'))
    hd = nupkg_check(problems, packages, hkey, host.get('nupkgSha256'))
    pack_texts_check(problems, hd, hkey, host.get('packTexts', {}), texts)
    try:
        check_package_provenance(packages, hkey, host)
    except (Failure, OSError) as e:
        problems.append(hkey + ': ' + str(e))
    hp = os.path.join(hd, 'runtimes', 'win-x64', 'native', 'singlefilehost.exe')
    if not os.path.isfile(hp):
        problems.append('single-file host original missing: ' + hp)
    else:
        try:
            original_host = read(hp)
            require(host['productVersion'].encode('utf-16-le') in original_host, 'inventory host ProductVersion differs from restored original host')
            verify_host(data, original_host)
        except Failure as e:
            problems.append('single-file host: ' + str(e))
    if problems:
        raise Failure('\n'.join(problems))
    return {'entries': len(entries), 'attributed': attributed, 'legal': len(expected_legal), 'components': len(components)}


def libs_path(deps, key):
    lib = deps.get('libraries', {}).get(key, {})
    path = lib.get('path')
    if not path:
        name, _, version = key.partition('/')
        path = '%s/%s' % (name.lower(), version)
    return path


# ---------------------------------------------------------------------------------------------
# ZIP


def zip_members(legal_dir):
    inv, inv_bytes, texts, problems = load_legal(legal_dir)
    if problems:
        raise Failure('\n'.join(problems))
    members = {ZIP_DIR + n: b for n, b in texts.items()}
    members[ZIP_DIR + 'inventory.json'] = inv_bytes
    return members


def write_zip(exe_bytes, out, legal_dir):
    members = zip_members(legal_dir)
    tmp = out + '.tmp'
    with zipfile.ZipFile(tmp, 'w') as z:
        for name, b in [(EXE_NAME, exe_bytes)] + sorted(members.items()):
            info = zipfile.ZipInfo(name, ZIP_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, b)
    os.replace(tmp, out)


def verify_zip(path, packages, legal_dir):
    try:
        z = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile) as e:
        raise Failure('not a readable ZIP: %s' % e)
    problems = []
    with z:
        infos = z.infolist()
        require(len(infos) <= 1000, 'ZIP member count exceeds bound')
        for info in infos:
            limit = 1024 * 1024 * 1024 if info.filename == EXE_NAME else 16 * 1024 * 1024
            require(info.file_size <= limit, 'ZIP uncompressed member exceeds bound: ' + info.filename)
        require(sum(i.file_size for i in infos) <= 2 * 1024 * 1024 * 1024, 'ZIP uncompressed total exceeds bound')
        bad = z.testzip()
        if bad:
            raise Failure('ZIP CRC failure in %s' % bad)
        names = z.namelist()
        if len(names) != len(set(names)):
            problems.append('ZIP has duplicate member names')
        want = zip_members(legal_dir)
        want_names = set(want) | {EXE_NAME}
        for n in sorted(want_names - set(names)):
            problems.append('ZIP lacks %s' % n)
        for n in sorted(set(names) - want_names):
            problems.append('ZIP has unexpected member %s' % n)
        for n, b in sorted(want.items()):
            if n in names and z.read(n) != b:
                problems.append('ZIP %s is truncated or changed' % n)
        if problems:
            raise Failure('\n'.join(problems))
        return verify_exe_bytes(z.read(EXE_NAME), packages, legal_dir, label='ZIP ' + EXE_NAME)


# ---------------------------------------------------------------------------------------------


def packages_from_assets(path):
    try:
        folders = list(json.loads(read(path)).get('packageFolders', {}))
    except (OSError, ValueError) as e:
        raise Failure('cannot read %s: %s' % (path, e))
    if len(folders) != 1:
        raise Failure('%s must name exactly one package folder, found %d' % (path, len(folders)))
    return folders[0]


def main(argv=None):
    ap = argparse.ArgumentParser(description=(__doc__ or "").split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    for name in ('verify-exe', 'package', 'verify-zip', 'check-legal', 'report'):
        sp = sub.add_parser(name)
        if name in ('verify-exe', 'package', 'report'):
            sp.add_argument('exe')
        if name == 'package':
            sp.add_argument('out')
        if name == 'verify-zip':
            sp.add_argument('zip')
        if name not in ('check-legal', 'report'):
            g = sp.add_mutually_exclusive_group(required=True)
            g.add_argument('--packages', help='NuGet global-packages folder used by the publish')
            g.add_argument('--assets', help="the publish's obj/project.assets.json; its packageFolders entry is used")
        sp.add_argument('--legal', default=DEFAULT_LEGAL)
    a = ap.parse_args(argv)
    try:
        if a.cmd not in ('check-legal', 'report') and not a.packages:
            a.packages = packages_from_assets(a.assets)
        if a.cmd == 'check-legal':
            inv, _, texts, problems = load_legal(a.legal)
            if problems:
                raise Failure('\n'.join(problems))
            print('legal inventory ok: %d components, %d notice files' % (len(inv['components']), len(texts)))
        elif a.cmd == 'report':
            data = read(a.exe)
            by = {e['path']: e for e in parse_bundle(data)}
            names = [p for p in by if p.endswith('.deps.json')]
            require(len(names) == 1, 'report needs exactly one deps.json')
            deps = json_object(entry_bytes(data, by[names[0]]), 'deps.json')
            validate_deps(deps)
            for key, lib in sorted(deps['targets'][deps['runtimeTarget']['name']].items()):
                n = sum(len(lib.get(sec, {})) for sec in ASSET_SECTIONS)
                print('%-70s %4d shipped asset(s)' % (key, n))
        elif a.cmd == 'verify-exe':
            r = verify_exe_bytes(read(a.exe), a.packages, a.legal)
            print('recipient notices ok: %(entries)d bundle entries, %(attributed)d byte-matched to restored packages, '
                  '%(components)d inventory components, %(legal)d legal files embedded' % r)
        elif a.cmd == 'package':
            exe = read(a.exe)
            verify_exe_bytes(exe, a.packages, a.legal)
            write_zip(exe, a.out, a.legal)
            r = verify_zip(a.out, a.packages, a.legal)
            print('release ZIP ok: %s sha256 %s; EXE + %d LICENSES files; %d bundle entries, %d byte-matched' % (
                a.out, sha256(read(a.out)), r['legal'], r['entries'], r['attributed']))
        else:
            r = verify_zip(a.zip, a.packages, a.legal)
            print('release ZIP ok: EXE + %(legal)d LICENSES files; %(entries)d bundle entries, %(attributed)d byte-matched' % r)
    except (Failure, OSError, ValueError, TypeError, KeyError, IndexError, struct.error, UnicodeError, RecursionError) as f:
        print('RECIPIENT NOTICE CHECK FAILED:', file=sys.stderr)
        for line in str(f).split('\n'):
            print('  - ' + line, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
