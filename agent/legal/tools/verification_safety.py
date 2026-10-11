"""Bounded manifest/PE checks for recipient_notices (stdlib only)."""
import json
import re
import struct


class Failure(Exception):
    pass


def require(ok, message):
    if not ok:
        raise Failure(message)


def json_object(data, label):
    require(len(data) <= 16 * 1024 * 1024, label + ': JSON exceeds 16 MiB limit')
    def pairs(items):
        d = {}
        for k, v in items:
            require(k not in d, label + ': duplicate JSON key ' + k)
            d[k] = v
        return d
    try:
        result = json.loads(data, object_pairs_hook=pairs)
    except (ValueError, UnicodeError, RecursionError) as e:
        raise Failure('%s: invalid JSON (%s)' % (label, e)) from e
    require(isinstance(result, dict), label + ': JSON must be an object')
    return result


def path_ok(s):
    return (isinstance(s, str) and 0 < len(s) <= 4096 and '\\' not in s and
            not s.startswith('/') and all(p not in ('', '.', '..') for p in s.split('/')) and
            not any(ord(c) < 32 or c == ':' for c in s))


def validate_inventory(inv):
    for key, typ in [('schema', int), ('runtimeTarget', str), ('components', list),
                     ('notices', dict), ('firstParty', list), ('singleFileHost', dict),
                     ('appEntries', dict), ('graphOnly', dict)]:
        require(isinstance(inv.get(key), typ), 'inventory lacks/invalid ' + key)
    require(inv['schema'] in (1, 2), 'inventory unsupported schema')
    require(0 < len(inv['components']) <= 500 and 0 < len(inv['notices']) <= 500,
            'inventory component/notice count out of bounds')
    def strings(xs, label):
        require(isinstance(xs, list) and all(isinstance(s, str) for s in xs), label + ' must be a string list')
    def digest(s, label):
        require(isinstance(s, str) and re.fullmatch('[0-9a-f]{64}', s), label + ' invalid sha256')
    def texts(mapping, label):
        require(isinstance(mapping, dict) and all(path_ok(k) and isinstance(v, str) and v in inv['notices']
                                                for k, v in mapping.items()), label + ' invalid packTexts')
    seen = set()
    for c in inv['components']:
        require(isinstance(c, dict), 'inventory component must be an object')
        for k in ('deps', 'kind', 'nupkgSha256', 'licence', 'copyright', 'source'):
            require(isinstance(c.get(k), str) and c[k], 'inventory component %s lacks/invalid %s' % (c.get('deps'), k))
        require(path_ok(c['deps']) and c['deps'].count('/') == 1, 'inventory invalid deps ' + c['deps'])
        require(c['deps'] not in seen, 'inventory duplicate component ' + c['deps'])
        seen.add(c['deps'])
        strings(c.get('notices'), c['deps'] + ' notices')
        require(all(n in inv['notices'] for n in c['notices']), c['deps'] + ' references unknown notice')
        digest(c['nupkgSha256'], c['deps'])
        if 'packageDir' in c:
            require(path_ok(c['packageDir']), 'inventory invalid packageDir')
        if 'packTexts' in c:
            texts(c['packTexts'], c['deps'])
    for n, m in inv['notices'].items():
        require(path_ok(n) and '/' not in n, 'inventory invalid notice path ' + str(n))
        require(isinstance(m, dict) and isinstance(m.get('source'), str), 'inventory invalid notice metadata ' + n)
        digest(m.get('sha256'), n)
    h = inv['singleFileHost']
    for k in ('package', 'version', 'productVersion', 'nupkgSha256'):
        require(isinstance(h.get(k), str) and h[k], 'inventory host lacks/invalid ' + k)
    digest(h['nupkgSha256'], 'host')
    require(re.fullmatch(r'[A-Za-z0-9_.-]+', h['package']) is not None and
            re.fullmatch(r'[A-Za-z0-9.+-]+', h['version']) is not None, 'inventory invalid host package/version')
    require(len(h['productVersion']) <= 4096, 'inventory host ProductVersion exceeds bound')
    texts(h.get('packTexts', {}), 'host')
    strings(inv['firstParty'], 'firstParty')
    require(all(path_ok(s) for s in inv['firstParty']), 'invalid firstParty path')
    require(all(isinstance(k, str) and isinstance(v, str) for k, v in inv['graphOnly'].items()), 'invalid graphOnly')
    strings(inv['appEntries'].get('exact'), 'appEntries exact')
    pattern = inv['appEntries'].get('dataPattern')
    require(isinstance(pattern, str) and len(pattern) < 1000, 'invalid dataPattern')
    try:
        re.compile(pattern)
    except re.error as e:
        raise Failure('inventory invalid dataPattern: ' + str(e)) from e


def validate_deps(deps):
    require(isinstance(deps.get('runtimeTarget'), dict) and isinstance(deps['runtimeTarget'].get('name'), str),
            'deps.json lacks runtimeTarget.name')
    t = deps['runtimeTarget']['name']
    require(isinstance(deps.get('targets'), dict) and isinstance(deps['targets'].get(t), dict), 'deps.json lacks target ' + t)
    require(isinstance(deps.get('libraries'), dict), 'deps.json lacks libraries')
    libs = deps['targets'][t]
    require(len(libs) <= 5000, 'deps.json exceeds library count limit')
    for k, lib in libs.items():
        require(path_ok(k) and k.count('/') == 1 and isinstance(lib, dict), 'deps.json invalid library ' + str(k))
        require(isinstance(deps['libraries'].get(k, {}), dict), 'deps.json invalid library metadata ' + k)
        p = deps['libraries'].get(k, {}).get('path')
        require(p is None or path_ok(p), 'deps.json invalid package path ' + k)
        for sec in ('runtime', 'native', 'resources'):
            require(isinstance(lib.get(sec, {}), dict), 'deps.json invalid asset section ' + k + '/' + sec)
            require(all(path_ok(f) for f in lib.get(sec, {})), 'deps.json invalid asset path ' + k)


def validate_rc(rc):
    require(isinstance(rc.get('runtimeOptions'), dict), 'runtimeconfig.json lacks runtimeOptions')
    fw = rc['runtimeOptions'].get('includedFrameworks')
    require(isinstance(fw, list) and 0 < len(fw) < 20, 'runtimeconfig.json lacks includedFrameworks')
    require(all(isinstance(f, dict) and isinstance(f.get('name'), str) and isinstance(f.get('version'), str) for f in fw),
            'runtimeconfig.json invalid includedFrameworks')


def pe_sections(data):
    def u(fmt, p):
        require(0 <= p <= len(data) - struct.calcsize(fmt), 'PE header/section out of bounds')
        return struct.unpack_from(fmt, data, p)
    require(data[:2] == b'MZ', 'host is not PE (MZ missing)')
    p = u('<I', 60)[0]
    require(data[p:p + 4] == b'PE\0\0', 'host PE signature missing')
    machine, count = u('<HH', p + 4)
    require(machine == 0x8664 and 0 < count <= 96, 'host must be bounded AMD64 PE')
    opt = u('<H', p + 20)[0]
    require(opt >= 112 and u('<H', p + 24)[0] == 0x20b, 'host must be PE32+')
    sections = {}
    for i in range(count):
        name, vs, va, size, ptr = u('<8sIIII', p + 24 + opt + 40 * i)
        name = name.rstrip(b'\0').decode('ascii', 'strict')
        require(name not in sections and ptr <= len(data) - size, 'invalid host section ' + name)
        sections[name] = (vs, va, size, ptr)
    return sections


def resource_leaves(data, sections):
    require('.rsrc' in sections, 'host lacks .rsrc')
    vs, va, size, base = sections['.rsrc']
    require(vs <= size, 'host resource virtual size exceeds raw size')
    end = base + vs
    leaves = {}
    visited = set()

    def name_value(n):
        if not n & 0x80000000:
            return n
        rel = n & 0x7fffffff
        require(rel <= vs - 2, 'PE resource name out of bounds')
        count = struct.unpack_from('<H', data, base + rel)[0]
        require(count <= 4096 and rel + 2 + count * 2 <= vs, 'PE resource name length out of bounds')
        return data[base + rel + 2:base + rel + 2 + count * 2].decode('utf-16-le')

    def walk(rel, depth, path=()):
        require(depth <= 3 and rel not in visited and 0 <= rel <= vs - 16, 'invalid/cyclic PE resource directory')
        visited.add(rel)
        p = base + rel
        named, ids = struct.unpack_from('<HH', data, p + 12)
        count = named + ids
        require(count <= 4096 and p + 16 + count * 8 <= end, 'PE resource entries out of bounds')
        for i in range(count):
            name, target = struct.unpack_from('<II', data, p + 16 + 8 * i)
            key = path + (name_value(name),)
            if target & 0x80000000:
                walk(target & 0x7fffffff, depth + 1, key)
            else:
                require(0 <= target <= vs - 16, 'PE resource leaf out of bounds')
                rva, length = struct.unpack_from('<II', data, base + target)
                off = base + rva - va
                require(base <= off <= end - length and length <= 16 * 1024 * 1024, 'PE resource data out of bounds')
                require(key not in leaves, 'duplicate PE resource path')
                leaves[key] = data[off:off + length]
    walk(0, 0)
    require(leaves, 'host lacks resources')
    return leaves


def verify_host(data, original):
    """Compare stable executable sections AND every original parsed PE resource leaf.

    .data is SDK-patched with bundle offset/application path; .rsrc gains app resources.
    Do not compare those sections wholesale. Each original resource (including embedded
    runtime images containing both host ProductVersion copies) must remain byte-identical
    at its parsed type/name/language path, even if app resources are added.
    """
    actual, expected = pe_sections(data), pe_sections(original)
    problems = []
    require(set(actual) == set(expected), 'host PE section set differs from restored singlefilehost.exe')
    for n in expected:
        if n in ('.data', '.rsrc'):
            continue
        vs, va, sz, p = expected[n]
        avs, ava, asz, ap = actual[n]
        if (vs, va, sz) != (avs, ava, asz) or data[ap:ap + sz] != original[p:p + sz]:
            problems.append('host stable PE section %s differs from restored singlefilehost.exe' % n)
    resources = resource_leaves(data, actual)
    for path, blob in resource_leaves(original, expected).items():
        if resources.get(path) != blob:
            problems.append('host PE resource %r differs from restored singlefilehost.exe' % (path,))
    if problems:
        raise Failure('\n'.join(problems))
