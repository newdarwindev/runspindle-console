#!/usr/bin/env python3
"""Check that independent projection assertions reject deliberate broken variants."""
import json
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
source = (root / 'src/projection.js').read_text()
tests = (root / 'test/projection.test.js').read_text()
mutations = {
    'duplicate_revision': ('update.revision <= record.revision', 'update.revision < record.revision'),
    'wrong_identity': ('if (!sameIdentity(target, incoming)', 'if (false'),
    'unknown_is_fresh': ("let freshness = 'unknown';", "let freshness = 'fresh';"),
}
observations = []
for name, (old, new) in mutations.items():
    assert source.count(old) == 1, f'mutation anchor changed: {name}'
    with tempfile.TemporaryDirectory(prefix='runspindle-console-mutation-') as directory:
        temporary = Path(directory)
        (temporary / 'projection.mjs').write_text(source.replace(old, new))
        (temporary / 'projection.test.mjs').write_text(tests.replace('../src/projection.js', './projection.mjs'))
        result = subprocess.run(['node', '--test', '--test-reporter=tap', str(temporary / 'projection.test.mjs')], capture_output=True, text=True, timeout=20)
        assert result.returncode == 1 and '# fail ' in result.stdout, f'mutation was not detected: {name}'
        observations.append({'mutation': name, 'status': 'detected', 'exit_code': result.returncode})
print(json.dumps({'evidence_class': 'synthetic_component_mutation', 'observations': observations}, sort_keys=True))
