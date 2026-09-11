#!/usr/bin/env python3
"""Read-only release preflight. Reports all deterministic failures in one JSON result."""
import argparse
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path


def check_release(root, jar=None, expected_sha512=None, expected_module=None):
    root = Path(root)
    errors = []
    warnings = []
    def fail(code, file, message):
        errors.append(dict(code=code, file=str(file), message=message))
    def read_json(file):
        try:
            value = json.loads((root / file).read_text())
            if not isinstance(value, dict):
                raise ValueError('expected a JSON object')
            return value
        except (OSError, ValueError) as error:
            fail('json', file, str(error).replace(str(root), '<repo>'))
            return {}
    props = {}
    try:
        for line in (root / 'gradle.properties').read_text().splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                key, value = line.split('=', 1)
                props[key.strip()] = value.strip()
    except OSError:
        fail('properties', 'gradle.properties', 'Missing gradle.properties')
    version = props.get('mod_version', '')
    archive = props.get('archives_base_name', '')
    minecraft = props.get('minecraft_version', '')
    for key in ['mod_version', 'archives_base_name', 'minecraft_version']:
        if not props.get(key):
            fail('property', 'gradle.properties', f'Missing {key}')
    # These values are filenames/version identifiers, never paths.
    for value in [version, archive, minecraft]:
        if value and not re.fullmatch(r'[A-Za-z0-9_.+\-]+', value):
            fail('identifier', 'gradle.properties', 'Invalid release identifier')
    metadata_file = 'src/main/resources/fabric.mod.json'
    metadata = read_json(metadata_file)
    module_id = metadata.get('id')
    if not isinstance(module_id, str) or not re.fullmatch(r'[a-z][a-z0-9_-]{1,63}', module_id):
        fail('module-id', metadata_file, 'Expected a valid non-empty Fabric module id')
    if expected_module is not None and module_id != expected_module:
        fail('module-identity', metadata_file, 'Module id differs from the selected registered module')
    if metadata.get('version') not in ['${version}', version]:
        fail('version', metadata_file, 'Version differs from mod_version')
    depends = metadata.get('depends', {})
    if not isinstance(depends, dict):
        fail('dependencies', metadata_file, 'depends must be an object')
        depends = {}
    if depends.get('minecraft') != '~' + minecraft:
        fail('minecraft', metadata_file, 'Expected configured ~minecraft_version; review custom ranges explicitly')
    if depends.get('java') != '>=25':
        fail('java', metadata_file, 'Expected Java >=25')
    if metadata.get('id') != 'totem-core' and not depends.get('totem-core'):
        fail('core', metadata_file, 'Missing required TotemCore range')
    if version and re.fullmatch(r'[A-Za-z0-9_.+\-]+', version):
        notes = Path('.github/staging') / f'modrinth-changelog-{version}.md'
        if not (root / notes).is_file() or not (root / notes).read_text().strip():
            fail('changelog', notes, 'Missing release changelog')

    # Compare argument position and conversion, allowing positional translation reordering.
    def formats(text):
        result = []
        index = 0
        previous = None
        for match in re.finditer(r'%(?:(\d+)\$)?([-#+ 0,(<]*)(?:\d+)?(?:\.\d+)?([tT][a-zA-Z]|[a-zA-Z%])', text):
            position, flags, kind = match.groups()
            if kind in ['%', 'n']:
                continue
            if position:
                argument = int(position)
            elif '<' in flags:
                argument = previous
            else:
                index += 1
                argument = index
            previous = argument
            result.append((argument, kind.lower()))
        return sorted(result, key=str)
    locale_count = 0
    for english in sorted((root / 'src/main/resources/assets').glob('*/lang/en_us.json')):
        source = read_json(english.relative_to(root))
        for locale in sorted(english.parent.glob('*.json')):
            if locale == english:
                continue
            locale_count += 1
            relative = locale.relative_to(root)
            target = read_json(relative)
            for key, text in source.items():
                if key not in target:
                    fail('locale-key', relative, f'Missing {key}')
                elif not isinstance(text, str) or not isinstance(target[key], str):
                    fail('locale-type', relative, f'Non-string value: {key}')
                elif formats(text) != formats(target[key]):
                    fail('locale-format', relative, f'Format arguments differ: {key}')
    artifact = dict(checked=False)
    if jar:
        file = Path(jar)
        try:
            digest = hashlib.sha512(file.read_bytes()).hexdigest()
            artifact = dict(checked=True, filename=file.name, sha512=digest)
            if file.name != f'{archive}-{version}.jar':
                fail('artifact-name', file.name, 'JAR filename differs from configured release')
            if expected_sha512 and digest != expected_sha512:
                fail('artifact-hash', file.name, 'SHA-512 differs from expected artifact')
            with zipfile.ZipFile(file) as content:
                names = content.namelist()
                for name in names:
                    if name.startswith('/') or '..' in Path(name).parts or re.search(r'(^|/)(\.git|\.gradle|\.env|gametest|test-results)(/|$)', name):
                        fail('artifact-content', file.name, f'Unexpected archive entry: {name}')
                packed = json.loads(content.read('fabric.mod.json'))
                expected = json.loads(json.dumps(metadata).replace('${version}', version))
                if packed != expected:
                    fail('artifact-metadata', file.name, 'Packaged metadata differs from source release metadata')
        except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
            fail('artifact', file.name, str(error).replace(str(root), '<repo>'))
    elif expected_sha512:
        fail('artifact-required', 'artifact', '--expected-sha512 requires --jar')
    else:
        warnings.append('Source-only preflight; artifact content and SHA-512 have not been checked.')
    return dict(schemaVersion=1, status='failed' if errors else 'passed', version=version,
                module=metadata.get('id'), localesChecked=locale_count, artifact=artifact, errors=errors, warnings=warnings)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repo')
    parser.add_argument('--jar')
    parser.add_argument('--expected-sha512')
    parser.add_argument('--expected-module')
    parser.add_argument('--report')
    parser.add_argument('--full', action='store_true')
    args = parser.parse_args()
    result = check_release(args.repo, args.jar, args.expected_sha512, args.expected_module)
    payload = json.dumps(result, ensure_ascii=False)
    if args.report:
        Path(args.report).write_text(payload + '\n')
    summary = dict(result, errorCount=len(result['errors']), errors=result['errors'][:20])
    if len(result['errors']) > 20:
        summary['detail'] = args.report or 'Use --full to inspect every failure'
    print(payload if args.full else json.dumps(summary, ensure_ascii=False))
    return 1 if result['errors'] else 0


if __name__ == '__main__':
    sys.exit(main())
