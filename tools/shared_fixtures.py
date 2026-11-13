"""Verify a separately reviewed fixture pin before loading any vendored Python."""
import hashlib
import json
from pathlib import Path
import re
import types

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / 'fixtures/shared-v1'
PIN = ROOT / 'fixtures/shared-v1.pin.json'
FILES = {'artifact.txt', 'contract.json', 'fixturekit.py', 'golden.json', 'vectors.json'}


def _read(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 65536:
        raise ValueError('invalid fixture file')
    return path.read_bytes()


def _json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('duplicate fixture key')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique)


def verify_pin(bundle=BUNDLE, pin_path=PIN):
    """The pin is trusted Git-reviewed input; self-consistent bundles are insufficient."""
    bundle, pin_path = Path(bundle), Path(pin_path)
    if bundle.is_symlink() or not bundle.is_dir():
        raise ValueError('invalid fixture directory')
    pin = _json(_read(pin_path))
    if set(pin) != {'composition_commit', 'schema', 'component', 'origin_manifest_sha256', 'subset_manifest_sha256'}:
        raise ValueError('invalid fixture pin')
    if pin['schema'] != 'runspindle.fixture.v1' or pin['component'] != 'console':
        raise ValueError('fixture pin identity mismatch')
    if not isinstance(pin['composition_commit'], str) or not re.fullmatch('[0-9a-f]{40}', pin['composition_commit']):
        raise ValueError('invalid fixture source commit')
    for key in ['origin_manifest_sha256', 'subset_manifest_sha256']:
        if not isinstance(pin[key], str) or not re.fullmatch('[0-9a-f]{64}', pin[key]):
            raise ValueError('invalid fixture pin digest')
    raw = _read(bundle / 'manifest.json')
    if hashlib.sha256(raw).hexdigest() != pin['subset_manifest_sha256']:
        raise ValueError('fixture manifest differs from reviewed pin')
    manifest = _json(raw)
    if set(manifest) != {'component', 'schema', 'origin_manifest_sha256', 'files'} or manifest['component'] != pin['component'] or manifest['schema'] != pin['schema'] or manifest['origin_manifest_sha256'] != pin['origin_manifest_sha256']:
        raise ValueError('fixture source identity mismatch')
    if set(manifest['files']) != FILES or {p.name for p in bundle.iterdir()} != FILES | {'manifest.json'}:
        raise ValueError('fixture inventory mismatch')
    verified = {}
    for name, expected in manifest['files'].items():
        raw = _read(bundle / name)
        verified[name] = raw
        if hashlib.sha256(raw).hexdigest() != expected:
            raise ValueError('fixture bytes differ from reviewed manifest')
    return manifest, verified


def load_kit(bundle=BUNDLE, pin_path=PIN):
    _, verified = verify_pin(bundle, pin_path)
    path = Path(bundle) / 'fixturekit.py'
    module = types.ModuleType('console_pinned_fixturekit_v1')
    module.__file__ = str(path)
    # No vendored code is imported until the independent pin and every byte pass.
    exec(compile(verified['fixturekit.py'], str(path), 'exec'), module.__dict__)
    module.verify_bundle(bundle)
    return module


if __name__ == '__main__':
    kit = load_kit()
    print(json.dumps({'status': 'passed', 'evidence_class': 'pinned_synthetic_fixture_integrity',
                      'integration': 'not-run', 'live_acceptance': 'not-run'}))
