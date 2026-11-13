"""Standalone pinned fixture-consumer conformance, separate from JS runtime parity."""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import socket
import tempfile
import unittest
from unittest.mock import patch

from tools.shared_fixtures import BUNDLE, PIN, load_kit, verify_pin


class SharedFixtureTests(unittest.TestCase):
    def setUp(self):
        self.network = patch.object(socket, 'socket', side_effect=AssertionError('network forbidden'))
        self.socket = self.network.start()
        self.addCleanup(self.network.stop)
        self.addCleanup(self.socket.assert_not_called)
        self.kit = load_kit()
        self.golden = self.kit.load_json(BUNDLE / 'golden.json')
        self.vectors = self.kit.load_json(BUNDLE / 'vectors.json')

    def observations(self, fixture):
        observations = {}
        if fixture['state'] in ['delivered', 'persisted', 'serving']:
            observations[fixture['state']] = {'identity': copy.deepcopy(fixture['identity']),
                                              'detail': copy.deepcopy(fixture['detail'])}
        if fixture['kind'] == 'artifact.observed':
            observations['accepted_digest'] = hashlib.sha256((BUNDLE / 'artifact.txt').read_bytes()).hexdigest()
        return observations

    def test_positive_console_subset_with_independent_synthetic_receipts(self):
        self.assertEqual({x['kind'] for x in self.golden}, {
            'native.observed', 'browser.observed', 'artifact.observed', 'telemetry.observed'})
        for fixture in self.golden:
            with self.subTest(kind=fixture['kind']):
                self.assertTrue(self.kit.assert_conforms(copy.deepcopy(fixture), copy.deepcopy(fixture['identity']),
                                                        fixture['state'], self.observations(fixture)))

    def test_every_negative_vector_rejects_with_declared_error(self):
        self.assertEqual(len(self.vectors), 12)
        for vector in self.vectors:
            with self.subTest(vector=vector['id']):
                golden = next(x for x in self.golden if x['kind'] == vector['kind'])
                changed = copy.deepcopy(golden)
                parent = changed
                for key in vector['mutation']['path'][:-1]:
                    parent = parent[key]
                parent[vector['mutation']['path'][-1]] = vector['mutation']['value']
                with self.assertRaises(self.kit.ContractError) as result:
                    self.kit.assert_conforms(changed, copy.deepcopy(golden['identity']), golden['state'], self.observations(golden))
                self.assertEqual(str(result.exception), vector['expected_error'])

    def test_corrupted_validator_fails_before_its_code_can_execute(self):
        with tempfile.TemporaryDirectory(prefix='runspindle-console-fixtures-') as directory:
            bundle = Path(directory) / 'bundle'
            shutil.copytree(BUNDLE, bundle)
            (bundle / 'fixturekit.py').write_text("raise AssertionError('tampered code executed')\n")
            with self.assertRaisesRegex(ValueError, 'fixture bytes differ'):
                load_kit(bundle, PIN)

    def test_self_rehashed_manifest_still_fails_independent_pin(self):
        with tempfile.TemporaryDirectory(prefix='runspindle-console-fixtures-') as directory:
            bundle = Path(directory) / 'bundle'
            shutil.copytree(BUNDLE, bundle)
            (bundle / 'artifact.txt').write_bytes(b'changed synthetic bytes')
            manifest = json.loads((bundle / 'manifest.json').read_text())
            manifest['files']['artifact.txt'] = hashlib.sha256((bundle / 'artifact.txt').read_bytes()).hexdigest()
            (bundle / 'manifest.json').write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n')
            with self.assertRaisesRegex(ValueError, 'manifest differs from reviewed pin'):
                verify_pin(bundle, PIN)

    def test_unexpected_file_or_symlink_rejected(self):
        for symlink in [False, True]:
            with self.subTest(symlink=symlink), tempfile.TemporaryDirectory(prefix='runspindle-console-fixtures-') as directory:
                bundle = Path(directory) / 'bundle'
                shutil.copytree(BUNDLE, bundle)
                if symlink:
                    (bundle / 'artifact.txt').unlink()
                    (bundle / 'artifact.txt').symlink_to(BUNDLE / 'artifact.txt')
                else:
                    (bundle / 'unexpected.txt').write_text('unreviewed extra')
                with self.assertRaises(ValueError):
                    load_kit(bundle, PIN)


if __name__ == '__main__':
    unittest.main()
